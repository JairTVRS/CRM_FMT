/**
 * Para o servidor local do CRM (o processo do `npm run dev`).
 *
 * Existe para não precisar de `Stop-Process`/`taskkill` soltos, que sempre
 * pedem confirmação e podem atingir processos de outros projetos.
 *
 * Regras:
 *   - a porta vem do `--port` do script `dev` no package.json; nada fixo aqui;
 *   - só encerra node.exe que estiver ESCUTANDO nessa porta, com a árvore de
 *     filhos dele (/T), para não deixar um workerd órfão segurando a porta;
 *   - qualquer outro processo na porta é só relatado, nunca encerrado;
 *   - não aceita argumentos: qualquer argumento é recusado.
 *
 * Uso: node dev/para-servidor.mjs
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.length > 2) {
  console.error(`Argumento recusado: ${process.argv.slice(2).join(' ')}. Este script não aceita parâmetros.`);
  process.exit(2);
}

if (process.platform !== 'win32') {
  console.error('Somente Windows. Em outro sistema, pare o processo do `npm run dev` pelo terminal.');
  process.exit(2);
}

const pacote = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
const m = String(pacote.scripts?.dev || '').match(/--port[ =](\d+)/);
const PORTA = m ? Number(m[1]) : NaN;
if (!Number.isInteger(PORTA) || PORTA < 1 || PORTA > 65535) {
  console.error('Não achei `--port <número>` no script "dev" do package.json. Nada foi encerrado.');
  process.exit(2);
}

function roda(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
}

function quemEscuta() {
  const pids = new Set();
  for (const linha of (roda('netstat', ['-ano', '-p', 'TCP']).stdout || '').split(/\r?\n/)) {
    const c = linha.trim().split(/\s+/);
    if (c.length >= 5 && c[3] === 'LISTENING' && c[1].endsWith(`:${PORTA}`)) pids.add(Number(c[4]));
  }
  return [...pids].filter((p) => p > 0);
}

function nomeDe(pid) {
  const saida = (roda('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']).stdout || '').trim();
  const r = saida.match(/^"([^"]+)"/);
  return r ? r[1].toLowerCase() : null;
}

const ouvintes = quemEscuta();
if (!ouvintes.length) {
  console.log(`porta ${PORTA} já estava livre`);
  process.exit(0);
}

for (const pid of ouvintes) {
  const nome = nomeDe(pid);
  if (nome === 'node.exe') {
    const r = roda('taskkill', ['/PID', String(pid), '/T', '/F']);
    console.log(r.status === 0 ? `encerrado node.exe ${pid} (e filhos) na porta ${PORTA}` : `não consegui encerrar ${pid}: ${(r.stderr || '').trim()}`);
  } else {
    console.log(`porta ${PORTA} ocupada por ${nome || 'desconhecido'} (PID ${pid}): NÃO encerrado`);
  }
}

await new Promise((r) => setTimeout(r, 1500));
const resta = quemEscuta();
console.log(resta.length ? `AINDA OCUPADA por PID ${resta.join(',')}` : `porta ${PORTA} livre`);
process.exit(resta.length ? 1 : 0);
