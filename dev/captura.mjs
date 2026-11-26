/**
 * Captura de tela de uma página do servidor LOCAL, no Edge sem janela.
 *
 * Existe para conferir telas antes de subir (forma de trabalho do CRM) sem
 * chamar o navegador direto, que pedia permissão a cada captura, e sem
 * salvar imagens no scratchpad, fora do projeto (SKILL_AGENTS_IA_EDITOR,
 * seção 5.1 e Anexo D).
 *
 * Regras:
 *   - só http://127.0.0.1:<porta do `npm run dev`>; a porta vem do package.json;
 *   - argumentos do navegador FIXOS; perfil próprio em .wrangler/ (fora do Git),
 *     nunca o perfil do usuário;
 *   - largura 320–2000, altura 300–6000, nome só com [a-z0-9-];
 *   - a imagem vai para dev/capturas/<nome>.png (fora do Git);
 *   - qualquer argumento a mais ou fora da regra é recusado.
 *
 * Uso: node dev/captura.mjs /bio#conversar 1100 1750 questionario-pc
 *
 * O Edge sem janela não desenha abaixo de ~500 px de largura: para o
 * celular, use 500 (a página se comporta igual nessa faixa).
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const args = process.argv.slice(2);
const [rota, larguraTxt, alturaTxt, nome] = args;
const largura = Number(larguraTxt);
const altura = Number(alturaTxt);
const valido = args.length === 4
  && /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]{0,300}$/.test(rota || '')
  && Number.isInteger(largura) && largura >= 320 && largura <= 2000
  && Number.isInteger(altura) && altura >= 300 && altura <= 6000
  && /^[a-z0-9-]{1,40}$/.test(nome || '');
if (!valido) {
  console.error('Uso: node dev/captura.mjs /rota <largura 320-2000> <altura 300-6000> <nome [a-z0-9-]>');
  process.exit(2);
}
if (process.platform !== 'win32') {
  console.error('Somente Windows (usa o Microsoft Edge instalado).');
  process.exit(2);
}

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const pacote = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
const m = String(pacote.scripts?.dev || '').match(/--port[ =](\d+)/);
const porta = m ? Number(m[1]) : NaN;
if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
  console.error('Não achei `--port <número>` no script "dev" do package.json.');
  process.exit(2);
}
const url = new URL(rota, `http://127.0.0.1:${porta}`);
if (url.hostname !== '127.0.0.1' || url.port !== String(porta)) {
  console.error('Recusado: a rota saiu do servidor local.');
  process.exit(2);
}

const edge = [
  join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
].find((c) => existsSync(c));
if (!edge) {
  console.error('Microsoft Edge não encontrado.');
  process.exit(1);
}

const pasta = join(RAIZ, 'dev', 'capturas');
mkdirSync(pasta, { recursive: true });
const saida = join(pasta, `${nome}.png`);
const perfil = join(RAIZ, '.wrangler', 'edge-captura');

const r = spawnSync(edge, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--disable-extensions', '--disable-sync',
  `--user-data-dir=${perfil}`,
  `--window-size=${largura},${altura}`,
  '--virtual-time-budget=8000',
  `--screenshot=${saida}`,
  url.href
], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });

if (r.error || !existsSync(saida)) {
  console.error(`A captura falhou${r.error ? `: ${r.error.message}` : ''}.`);
  process.exit(1);
}
console.log(`Captura salva em dev/capturas/${nome}.png (${largura}×${altura}) de ${url.pathname}${url.search}${url.hash}`);
if (largura < 500) console.log('Aviso: o Edge sem janela não desenha abaixo de ~500 px; a imagem pode sair cortada à direita.');
