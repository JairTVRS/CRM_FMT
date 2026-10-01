/**
 * Prova do resetar (2.36.4).
 *
 * Pedido de 01/10/2026, como o "resetar reunião" do ERP: o compromisso
 * volta a ser só o que foi cadastrado — agendado, no horário de origem.
 *   - some início, fim, cancelamento e a gravação com a transcrição;
 *   - a gravação de OUTRA reunião não é tocada;
 *   - remarcada e a que já está só agendada não se resetam;
 *   - só o CX responsável, quem iniciou ou admin.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as agenda from '../../functions/api/agenda.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

function d1(db) {
  const preparar = (sql) => {
    const stmt = db.prepare(sql);
    let args = [];
    const api = {
      bind(...a) { args = a.map((v) => (v === undefined ? null : v)); return api; },
      async first() { return stmt.get(...args) ?? null; },
      async all() { return { results: stmt.all(...args) }; },
      async run() {
        if (/RETURNING/i.test(sql)) return { results: stmt.all(...args) };
        return stmt.run(...args);
      }
    };
    return api;
  };
  return {
    prepare: preparar,
    async batch(lista) {
      db.exec('BEGIN');
      try { const r = []; for (const s of lista) r.push(await s.run()); db.exec('COMMIT'); return r; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}

/* ==========================================================================
   ESQUEMA
   ========================================================================== */

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
bd.exec(`
  CREATE TABLE leads (id INTEGER PRIMARY KEY, nome TEXT, documento TEXT, etapa_id INTEGER, responsavel TEXT,
                      ativo INTEGER DEFAULT 1, data_proximo_contato TEXT, data_ultimo_contato TEXT);
  INSERT INTO leads (id, nome, responsavel) VALUES (1, 'Cedro', 'jair@formatar.com.br');
`);
for (const m of ['017-agenda-lead', '019-ia-e-roteiros', '020-gravacao', '021-reuniao-iniciar-finalizar', '022-cancelamento-motivo', '023-agenda-eventos', '024-reuniao-analises']) {
  bd.exec(readFileSync(`${RAIZ}/db/migracao-${m}.sql`, 'utf8'));
}

const reuniao = (id, inicio, responsavel = 'jair@formatar.com.br') => bd.prepare(
  `INSERT INTO agenda_lead (id, lead_id, tipo, inicio, duracao_min, local_tipo, status, responsavel, criado_por, criado_em)
   VALUES (?, 1, 'reuniao', ?, 60, 'online', 'agendada', ?, 'x', 'x')`).run(id, inicio, responsavel);
reuniao(10, '2026-10-01T09:00');
reuniao(20, '2026-10-02T10:00');
reuniao(30, '2026-10-03T10:00');
reuniao(40, '2026-10-05T10:00', 'marina@formatar.com.br');

const JAIR = { email: 'Jair@formatar.com.br' };
const MARINA = { email: 'marina@formatar.com.br' };
const OUTRO = { email: 'outro@formatar.com.br' };
const SOCIO = { email: 'socio@formatar.com.br', grupoId: '64e678a7d2042dae072ef102' };
const cab = { 'Content-Type': 'application/json' };
const ctx = (url, corpo, usuario) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, { method: 'PUT', headers: cab, body: JSON.stringify(corpo) }),
  env: { DB },
  data: { cabecalhos: cab, usuario }
});
const PUT = (id, corpo, u = JAIR) => agenda.onRequestPut(ctx(`/api/agenda?id=${id}`, corpo, u))
  .then(async (r) => ({ status: r.status, corpo: await r.json() }));
const item = (id) => bd.prepare('SELECT * FROM agenda_lead WHERE id = ?').get(id);
const conta = (sql) => bd.prepare(sql).get().n;
const gravar = (gid, reuniaoId) => {
  bd.prepare(`INSERT INTO gravacoes (id, reuniao_id, lead_id, modo, consentimento_por, consentimento_em, transcritor, status, iniciada_por, iniciada_em)
              VALUES (?, ?, 1, 'online', 'jair@formatar.com.br', 'x', 'workers-ai', 'encerrada', 'jair@formatar.com.br', 'x')`).run(gid, reuniaoId);
  bd.prepare(`INSERT INTO transcricao_trechos (gravacao_id, origem, seq, inicio_s, texto, criado_em)
              VALUES (?, 'lead', 1, 0, 'um dois testes', 'x')`).run(gid);
};

/* ==========================================================================
   1. O QUE NÃO SE RESETA
   ========================================================================== */

console.log('\n=== 1. O que não se reseta ===');

ok((await PUT(10, { acao: 'resetar' })).corpo.code === 'NADA_A_RESETAR', 'a que já está só agendada');
const remarca = await PUT(30, { remarcar_para: '2026-10-20T10:00' });
ok((await PUT(30, { acao: 'resetar' })).corpo.code === 'REMARCADA', 'a remarcada (a nova é que vale)', remarca.corpo.error);

/* ==========================================================================
   2. A REALIZADA VOLTA A SÓ AGENDADA
   ========================================================================== */

console.log('\n=== 2. A realizada volta a só agendada ===');

await PUT(10, { acao: 'iniciar' });
gravar(1, 10);
gravar(2, 20);                       // de outra reunião: não pode sumir
await PUT(10, { acao: 'finalizar' });
ok(item(10).status === 'realizada' && item(10).finalizada_em, 'preparo: a 10 foi iniciada, gravada e finalizada');

const r = await PUT(10, { acao: 'resetar' });
const r10 = item(10);
ok(r.status === 200 && r.corpo.item.status === 'agendada' && r.corpo.item.lead_nome === 'Cedro', 'volta a agendada, com o lead junto');
ok([r10.iniciada_em, r10.iniciada_por, r10.finalizada_em, r10.finalizada_por].every((v) => v === null), 'sem início nem fim');
ok(r10.inicio === '2026-10-01T09:00' && r10.duracao_min === 60, 'no horário de origem, com a duração cadastrada');
ok(conta('SELECT COUNT(*) n FROM gravacoes WHERE reuniao_id = 10') === 0
  && conta('SELECT COUNT(*) n FROM transcricao_trechos WHERE gravacao_id = 1') === 0, 'a gravação e a transcrição dela somem');
ok(conta('SELECT COUNT(*) n FROM gravacoes WHERE reuniao_id = 20') === 1
  && conta('SELECT COUNT(*) n FROM transcricao_trechos WHERE gravacao_id = 2') === 1, 'a gravação de outra reunião fica');
ok(bd.prepare('SELECT data_proximo_contato d FROM leads WHERE id = 1').get().d === '2026-10-01', 'e ela volta a ser o próximo contato do lead');

ok((await PUT(10, { acao: 'iniciar' })).status === 200, 'pode ser iniciada de novo');
ok((await PUT(10, { acao: 'resetar' })).status === 200 && !item(10).iniciada_em, 'a em andamento também se reseta');

/* ==========================================================================
   3. A CANCELADA E A NÃO COMPARECEU
   ========================================================================== */

console.log('\n=== 3. Cancelada e não compareceu ===');

await PUT(20, { acao: 'cancelar', motivo: 'cliente', observacao: 'viajou' });
await PUT(20, { acao: 'resetar' });
const r20 = item(20);
ok(r20.status === 'agendada' && [r20.cancelamento_motivo, r20.cancelamento_obs, r20.cancelada_em, r20.cancelada_por].every((v) => v === null),
  'a cancelada volta, sem o motivo');

await PUT(20, { status: 'nao_compareceu' });
ok((await PUT(20, { acao: 'resetar' })).status === 200 && item(20).status === 'agendada', 'a "não compareceu" também');

/* ==========================================================================
   4. QUEM RESETA
   ========================================================================== */

console.log('\n=== 4. Quem reseta ===');

await PUT(40, { acao: 'cancelar', motivo: 'consultor' }, MARINA);
const deOutro = await PUT(40, { acao: 'resetar' }, OUTRO);
ok(deOutro.status === 403 && deOutro.corpo.code === 'SEM_PERMISSAO' && item(40).status === 'cancelada', 'quem não é o CX nem admin, não');
ok((await PUT(40, { acao: 'resetar' }, SOCIO)).status === 200, 'admin (Sócios) pode');
await PUT(40, { acao: 'cancelar', motivo: 'consultor' }, MARINA);
ok((await PUT(40, { acao: 'resetar' }, MARINA)).status === 200, 'o CX responsável pode');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
