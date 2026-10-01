/**
 * Prova do cancelamento com motivo (2.36.2).
 *
 * Pedido de 01/10/2026. O que importa:
 *   - cancelar exige um dos quatro motivos do ERP; a observação é livre;
 *   - guarda quem cancelou e quando, e o próximo contato do lead anda;
 *   - a lista "Situação" não cancela sem motivo;
 *   - só o agendado se cancela — nem o em andamento, nem o realizado;
 *   - cancelar fecha a gravação que ficou aberta (o caso de 29/09);
 *   - voltar a situação para outra apaga o motivo.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as agenda from '../../functions/api/agenda.js';
import { MOTIVOS_CANCELAMENTO } from '../../functions/api/_lib/agenda.js';

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
bd.exec(readFileSync(`${RAIZ}/db/migracao-017-agenda-lead.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-019-ia-e-roteiros.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-020-gravacao.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-021-reuniao-iniciar-finalizar.sql`, 'utf8'));

console.log('\n=== 1. A migração 022 ===');
bd.exec(readFileSync(`${RAIZ}/db/migracao-022-cancelamento-motivo.sql`, 'utf8'));
const colunas = bd.prepare("SELECT name FROM pragma_table_info('agenda_lead')").all().map((c) => c.name);
ok(['cancelamento_motivo', 'cancelamento_obs', 'cancelada_em', 'cancelada_por'].every((c) => colunas.includes(c)),
  'as quatro colunas existem');
ok(Object.values(MOTIVOS_CANCELAMENTO).join('|')
  === 'Cancelado pelo cliente|Cancelado pelo consultor|Cancelado pelo agendamento|Proposta cancelada pelo cliente',
  'os quatro motivos do ERP, na ordem do ERP');

const reuniao = (id, inicio) => bd.prepare(
  `INSERT INTO agenda_lead (id, lead_id, tipo, inicio, duracao_min, local_tipo, status, responsavel, criado_por, criado_em)
   VALUES (?, 1, 'reuniao', ?, 60, 'online', 'agendada', 'jair@formatar.com.br', 'x', 'x')`).run(id, inicio);
reuniao(10, '2026-10-02T14:00');
reuniao(20, '2026-10-09T10:00');
reuniao(30, '2026-10-12T10:00');
bd.exec(`INSERT INTO agenda_lead (id, lead_id, tipo, inicio, canal, status, criado_por, criado_em)
         VALUES (40, 1, 'contato', '2026-10-05T09:00', 'ligacao', 'agendada', 'x', 'x')`);
bd.exec("UPDATE leads SET data_proximo_contato = '2026-10-02'");
// A gravação presa de 29/09: começou antes da 2.36.0, sem iniciar a reunião.
bd.exec(`INSERT INTO gravacoes (id, reuniao_id, lead_id, modo, consentimento_por, consentimento_em, transcritor, status, iniciada_por, iniciada_em)
         VALUES (1, 10, 1, 'online', 'jair@formatar.com.br', 'x', 'workers-ai', 'gravando', 'jair@formatar.com.br', 'x')`);

const JAIR = { email: 'Jair@formatar.com.br' };
const cab = { 'Content-Type': 'application/json' };
const ctx = (metodo, url, corpo, usuario) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, { method: metodo, headers: cab, body: JSON.stringify(corpo) }),
  env: { DB },
  data: { cabecalhos: cab, usuario }
});
const ler = async (r) => ({ status: r.status, corpo: await r.json() });
const PUT = (id, corpo) => agenda.onRequestPut(ctx('PUT', `/api/agenda?id=${id}`, corpo, JAIR)).then(ler);
const item = (id) => bd.prepare('SELECT * FROM agenda_lead WHERE id = ?').get(id);
const lead = () => bd.prepare('SELECT * FROM leads WHERE id = 1').get();

/* ==========================================================================
   2. SEM MOTIVO, NÃO CANCELA
   ========================================================================== */

console.log('\n=== 2. Sem motivo, não cancela ===');

const pelaLista = await PUT(10, { status: 'cancelada' });
ok(pelaLista.status === 400 && pelaLista.corpo.code === 'CANCELAR_COM_MOTIVO', 'a lista "Situação" não cancela', pelaLista.corpo.error);
const semMotivo = await PUT(10, { acao: 'cancelar' });
ok(semMotivo.status === 400 && semMotivo.corpo.code === 'MOTIVO_OBRIGATORIO', 'sem motivo, recusa');
ok((await PUT(10, { acao: 'cancelar', motivo: 'toString' })).corpo.code === 'MOTIVO_OBRIGATORIO', 'motivo inventado, recusa');
ok(item(10).status === 'agendada', 'e nada mudou');

/* ==========================================================================
   3. CANCELAR
   ========================================================================== */

console.log('\n=== 3. Cancelar ===');

const antes = Date.now();
const c = await PUT(10, { acao: 'cancelar', motivo: 'cliente', observacao: '  O sócio viajou; retomar em novembro.  ' });
ok(c.status === 200 && c.corpo.item.status === 'cancelada' && c.corpo.item.lead_nome === 'Cedro', 'cancela, e devolve o compromisso com o lead');
const r10 = item(10);
ok(r10.cancelamento_motivo === 'cliente' && r10.cancelamento_obs === 'O sócio viajou; retomar em novembro.',
  'guarda o motivo e a observação (sem espaços nas pontas)');
ok(r10.cancelada_por === 'jair@formatar.com.br' && Date.parse(r10.cancelada_em) >= antes - 1000,
  'e quem cancelou, em minúsculas, e quando');
ok(lead().data_proximo_contato === '2026-10-05', 'o próximo contato do lead anda para o seguinte agendado', lead().data_proximo_contato);
ok(bd.prepare('SELECT status FROM gravacoes WHERE id = 1').get().status === 'encerrada', 'a gravação que ficou aberta é encerrada');

const sem = await PUT(40, { acao: 'cancelar', motivo: 'consultor' });
ok(sem.status === 200 && item(40).cancelamento_obs === null, 'contato também se cancela, e a observação é opcional');
ok((await PUT(10, { acao: 'cancelar', motivo: 'consultor' })).corpo.code === 'NAO_AGENDADO', 'o já cancelado não se cancela de novo');
ok(item(10).cancelamento_motivo === 'cliente', 'e o motivo original fica');

/* ==========================================================================
   4. O QUE NÃO SE CANCELA
   ========================================================================== */

console.log('\n=== 4. O que não se cancela ===');

await PUT(20, { acao: 'iniciar' });
ok((await PUT(20, { acao: 'cancelar', motivo: 'cliente' })).corpo.code === 'EM_ANDAMENTO', 'a reunião em andamento não se cancela');
await PUT(20, { acao: 'finalizar' });
ok((await PUT(20, { acao: 'cancelar', motivo: 'cliente' })).corpo.code === 'NAO_AGENDADO', 'a realizada também não');
ok(item(20).status === 'realizada' && item(20).cancelamento_motivo === null, 'e ela continua realizada, sem motivo');

/* ==========================================================================
   5. EDITAR O CANCELADO
   ========================================================================== */

console.log('\n=== 5. Editar o cancelado ===');

const pauta = await PUT(10, { pauta: 'Levar a proposta' });
ok(pauta.status === 200 && item(10).pauta === 'Levar a proposta' && item(10).cancelamento_motivo === 'cliente'
  && item(10).cancelada_por === 'jair@formatar.com.br', 'editar a pauta mantém o motivo, quem e quando');

const volta = await PUT(10, { status: 'agendada' });
const r10b = item(10);
ok(volta.status === 200 && r10b.status === 'agendada'
  && [r10b.cancelamento_motivo, r10b.cancelamento_obs, r10b.cancelada_em, r10b.cancelada_por].every((v) => v === null),
  'voltar para agendada apaga os quatro campos do cancelamento');
ok(lead().data_proximo_contato === '2026-10-02', 'e o próximo contato volta a ser ela');

const remarca = await PUT(30, { remarcar_para: '2026-10-20T10:00' });
const nova = item(remarca.corpo.item.id);
ok(remarca.status === 200 && nova.status === 'agendada' && nova.cancelamento_motivo === null, 'remarcar continua igual, sem motivo na nova');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
