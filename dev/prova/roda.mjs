/**
 * Roda todas as suítes e sai com erro se qualquer uma falhar.
 *
 * Existe para `npm run prova` — uma linha só, para que rodar as provas
 * nunca seja mais trabalhoso que não rodar.
 *
 * Uma a uma, em processos separados: `plano.mjs` sobe o dublê do hub
 * numa porta fixa, e duas suítes em paralelo brigariam por ela.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = fileURLToPath(new URL('.', import.meta.url));

const suites = readdirSync(AQUI)
  .filter((f) => f.endsWith('.mjs') && f !== 'roda.mjs')
  .sort();

let total = 0;
const falharam = [];

for (const suite of suites) {
  const r = spawnSync(process.execPath, [suite], { cwd: AQUI, encoding: 'utf8' });
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  const passaram = (saida.match(/^\s{2}OK\s{2}/gm) || []).length;
  total += passaram;

  if (r.status === 0) {
    console.log(`  ${suite.padEnd(20)} ${String(passaram).padStart(3)}  passou`);
  } else {
    falharam.push(suite);
    console.log(`  ${suite.padEnd(20)} ${String(passaram).padStart(3)}  FALHOU`);
    for (const linha of saida.split('\n').filter((l) => /FALHA|Error/.test(l))) {
      console.log(`      ${linha.trim()}`);
    }
  }
}

console.log(`\n${total} conferências em ${suites.length} suítes.`);

if (falharam.length) {
  console.log(`FALHARAM: ${falharam.join(', ')}`);
  process.exit(1);
}
