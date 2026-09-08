/**
 * Prova dos GATILHOS da migração 011, contra SQLite de verdade.
 *
 * Conferir o texto do .sql não prova nada: gatilho é lógica, e lógica
 * errada em gatilho falha em silêncio — que é exatamente o modo de falha
 * que esta migração existe para evitar.
 *
 * O SQL dos gatilhos é LIDO DO ARQUIVO, não recopiado aqui. Se a
 * migração mudar, é a versão nova que é testada.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let ok = 0, falhas = 0;

function conferir(descricao, condicao, detalhe) {
  if (condicao) { ok++; console.log(`  OK    ${descricao}`); }
  else { falhas++; console.log(` FALHA  ${descricao}${detalhe ? ` — ${detalhe}` : ''}`); }
}

const db = new DatabaseSync(':memory:');

// As duas tabelas, reduzidas ao que o gatilho toca.
db.exec(`
  CREATE TABLE clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT, etapa_id INTEGER, posicao INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1
  );
  CREATE TABLE leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT, etapa_id INTEGER, posicao INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1
  );
`);

// Uma linha ANTES da migração: é o caso de todos os registros de hoje.
db.exec(`INSERT INTO clientes (nome, etapa_id) VALUES ('Antigo', 1)`);

// Aplica a migração de verdade, lida do arquivo.
const sql = readFileSync(`${RAIZ}/db/migracao-011-etapa-desde.sql`, 'utf8');
db.exec(sql);

const hoje = new Date().toISOString().slice(0, 10);
const cli = (id) => db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);

/* --- Linha que já existia ---------------------------------------------- */

conferir('registro anterior à migração fica com etapa_desde NULO',
  cli(1).etapa_desde === null,
  `veio ${JSON.stringify(cli(1).etapa_desde)}`);

/* --- INSERT ------------------------------------------------------------ */

db.exec(`INSERT INTO clientes (nome, etapa_id) VALUES ('Novo', 2)`);
conferir('cliente novo com etapa nasce com a data de hoje',
  cli(2).etapa_desde === hoje, `veio ${cli(2).etapa_desde}`);

db.exec(`INSERT INTO clientes (nome, etapa_id) VALUES ('Sem etapa', NULL)`);
conferir('cliente sem etapa NÃO ganha data — não está em etapa nenhuma',
  cli(3).etapa_desde === null);

db.exec(`INSERT INTO clientes (nome, etapa_id, etapa_desde) VALUES ('Importado', 2, '2019-09-11')`);
conferir('data informada na importação é respeitada, não sobrescrita',
  cli(4).etapa_desde === '2019-09-11');

/* --- UPDATE: o caso que mais importa ----------------------------------- */

db.exec(`UPDATE clientes SET etapa_desde = '2020-01-01' WHERE id = 2`);
db.exec(`UPDATE clientes SET etapa_id = 5 WHERE id = 2`);
conferir('mover para outra etapa carimba a data nova',
  cli(2).etapa_desde === hoje, `veio ${cli(2).etapa_desde}`);

// Reordenar dentro da MESMA coluna: o comandosDeMover regrava etapa_id
// mesmo quando o cartão não mudou de coluna.
db.exec(`UPDATE clientes SET etapa_desde = '2020-01-01' WHERE id = 2`);
db.exec(`UPDATE clientes SET etapa_id = 5, posicao = 3 WHERE id = 2`);
conferir('REORDENAR na mesma coluna NÃO zera o tempo de etapa',
  cli(2).etapa_desde === '2020-01-01', `veio ${cli(2).etapa_desde}`);

// Mexer em outra coluna qualquer não pode disparar nada.
db.exec(`UPDATE clientes SET nome = 'Renomeado' WHERE id = 2`);
conferir('renomear o cliente não mexe na data',
  cli(2).etapa_desde === '2020-01-01');

// Sair de "sem etapa" para uma etapa: NULL -> 7. É o `IS NOT` que resolve.
db.exec(`UPDATE clientes SET etapa_id = 7 WHERE id = 3`);
conferir('entrar numa etapa vindo de NULO carimba a data',
  cli(3).etapa_desde === hoje, `veio ${cli(3).etapa_desde}`);

// E o inverso: 7 -> NULL também é mudança.
db.exec(`UPDATE clientes SET etapa_id = NULL WHERE id = 3`);
conferir('sair para NULO também é mudança de etapa',
  cli(3).etapa_desde === hoje);

/* --- O registro velho ganha data no primeiro movimento ------------------ */

db.exec(`UPDATE clientes SET etapa_id = 9 WHERE id = 1`);
conferir('registro antigo passa a ter data na primeira vez que é movido',
  cli(1).etapa_desde === hoje);

/* --- leads: mesma regra ------------------------------------------------ */

db.exec(`INSERT INTO leads (nome, etapa_id) VALUES ('Lead', 1)`);
const lead = () => db.prepare('SELECT * FROM leads WHERE id = 1').get();
conferir('o funil tem a mesma regra do CX', lead().etapa_desde === hoje);

db.exec(`UPDATE leads SET etapa_desde = '2020-01-01' WHERE id = 1`);
db.exec(`UPDATE leads SET etapa_id = 1, posicao = 2 WHERE id = 1`);
conferir('reordenar lead na mesma coluna também não zera',
  lead().etapa_desde === '2020-01-01');

/* --- Nada de recursão -------------------------------------------------- */

conferir('o gatilho não se dispara em cascata — só um UPDATE por movimento',
  (() => {
    db.exec(`UPDATE clientes SET etapa_id = 11 WHERE id = 2`);
    return cli(2).etapa_desde === hoje;
  })());

/* ---------------------------------------------------------------------- */

console.log(`\n${ok} conferências passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
