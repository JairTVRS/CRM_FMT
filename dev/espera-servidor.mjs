/**
 * Espera o servidor local do CRM (ou o dublê do hub) responder.
 *
 * Existe para o agente não montar laços de `sleep` + `grep` no shell, que
 * são comandos compostos e pedem permissão toda vez (SKILL_AGENTS_IA_EDITOR,
 * seção 5.1).
 *
 * Regras:
 *   - a porta vem da configuração: `--port` do script `dev` no package.json,
 *     ou dev/porta-hub.mjs com `--hub`; nada fixo aqui;
 *   - só pergunta a 127.0.0.1, só com GET; qualquer resposta HTTP conta como
 *     "no ar" (o dublê responde 401/404 na raiz, e está no ar);
 *   - desiste em 90 s;
 *   - aceita só `--hub`; qualquer outro argumento é recusado.
 *
 * Uso: node dev/espera-servidor.mjs          (o servidor do `npm run dev`)
 *      node dev/espera-servidor.mjs --hub    (o dublê do hub)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--hub')) {
  console.error(`Argumento recusado: ${args.join(' ')}. Use sem argumentos ou com --hub.`);
  process.exit(2);
}

let porta;
if (args[0] === '--hub') {
  porta = (await import('./porta-hub.mjs')).PORTA_HUB;
} else {
  const pacote = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  const m = String(pacote.scripts?.dev || '').match(/--port[ =](\d+)/);
  porta = m ? Number(m[1]) : NaN;
}
if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
  console.error('Não achei a porta na configuração (script "dev" do package.json ou dev/porta-hub.mjs).');
  process.exit(2);
}

const endereco = `http://127.0.0.1:${porta}/`;
const limite = Date.now() + 90_000;
while (Date.now() < limite) {
  try {
    const r = await fetch(endereco, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
    console.log(`No ar: ${endereco} respondeu ${r.status}.`);
    process.exit(0);
  } catch {
    await new Promise((ok) => setTimeout(ok, 1000));
  }
}
console.error(`Nada respondeu em ${endereco} em 90 s.`);
process.exit(1);
