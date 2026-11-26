/**
 * Confere uma rota do servidor LOCAL do CRM: situação, tipo e o começo do
 * conteúdo.
 *
 * Existe para o agente não usar `curl` solto (literal que nunca casa de
 * novo com uma regra, e às vezes composto com grep/head) — SKILL_AGENTS_IA_
 * EDITOR, seção 5.1.
 *
 * Regras:
 *   - a porta vem do `--port` do script `dev` no package.json; nada fixo aqui;
 *   - só 127.0.0.1 e só GET: nada é gravado; produção NÃO passa por aqui;
 *   - a rota começa com "/" e não pode ser endereço completo nem "//";
 *   - aceita só a rota; qualquer outro argumento é recusado.
 *
 * Uso: node dev/confere-local.mjs /bio
 *      node dev/confere-local.mjs "/publico/bio"
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rota = args[0];
if (args.length !== 1 || !/^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]{0,300}$/.test(rota)) {
  console.error('Uso: node dev/confere-local.mjs /rota  (uma rota local começando com "/", sem endereço completo).');
  process.exit(2);
}

const pacote = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
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

try {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
  const tipo = r.headers.get('content-type') || '—';
  const corpo = await r.text();
  console.log(`HTTP ${r.status} · ${tipo} · ${Buffer.byteLength(corpo)} bytes · ${url.pathname}${url.search}`);
  console.log(corpo.slice(0, 600));
  process.exit(r.ok ? 0 : 1);
} catch (e) {
  console.error(`O servidor local não respondeu em ${url.origin} (${e.message}). Ele está no ar? (npm run dev)`);
  process.exit(1);
}
