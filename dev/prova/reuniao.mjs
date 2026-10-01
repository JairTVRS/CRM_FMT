/**
 * Prova de iniciar e finalizar a reunião do lead (2.36.0).
 *
 * Pedido de 30/09/2026. O que importa:
 *   - cada pessoa tem no máximo UMA reunião em andamento — a API recusa
 *     a segunda dizendo qual está aberta, e o índice da 021 segura no banco;
 *   - iniciar e finalizar guardam o instante real e quem fez;
 *   - reunião só vira "realizada" finalizando (a lista não pula o fim);
 *   - em andamento não se cancela, remarca nem exclui;
 *   - finalizar fecha a gravação que ficou aberta e leva o último
 *     contato para o dia em que a reunião ACONTECEU (Brasília);
 *   - só se grava a reunião iniciada, por quem a iniciou.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as agenda from '../../functions/api/agenda.js';
import * as gravacoes from '../../functions/api/gravacoes.js';
import { diaEmBrasilia } from '../../functions/api/_lib/agenda.js';

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
  INSERT INTO leads (id, nome, responsavel, data_ultimo_contato) VALUES
    (1, 'Cedro', 'jair@formatar.com.br', '2026-01-01'),
    (2, 'Feheros', 'marina@formatar.com.br', NULL);
`);
bd.exec(readFileSync(`${RAIZ}/db/migracao-017-agenda-lead.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-019-ia-e-roteiros.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-020-gravacao.sql`, 'utf8'));

console.log('\n=== 1. A migração 021 ===');
bd.exec(readFileSync(`${RAIZ}/db/migracao-021-reuniao-iniciar-finalizar.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-022-cancelamento-motivo.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-023-agenda-eventos.sql`, 'utf8'));
const colunas = bd.prepare("SELECT name FROM pragma_table_info('agenda_lead')").all().map((c) => c.name);
ok(['iniciada_em', 'iniciada_por', 'finalizada_em', 'finalizada_por'].every((c) => colunas.includes(c)),
  'as quatro colunas existem');
ok(!!bd.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_agenda_uma_em_andamento'").get(), 'e o índice da trava');

const reuniao = (id, lead, inicio) => bd.prepare(
  `INSERT INTO agenda_lead (id, lead_id, tipo, inicio, duracao_min, local_tipo, status, responsavel, criado_por, criado_em)
   VALUES (?, ?, 'reuniao', ?, 60, 'online', 'agendada', 'jair@formatar.com.br', 'x', 'x')`).run(id, lead, inicio);
reuniao(10, 1, '2026-10-02T14:00');
reuniao(20, 2, '2026-10-02T14:30');
reuniao(30, 1, '2026-10-09T10:00');
reuniao(40, 2, '2026-10-12T10:00');
bd.exec(`INSERT INTO agenda_lead (id, lead_id, tipo, inicio, canal, status, criado_por, criado_em)
         VALUES (50, 1, 'contato', '2026-10-05T09:00', 'ligacao', 'agendada', 'x', 'x')`);
bd.exec("UPDATE leads SET data_proximo_contato = '2026-10-02'");

/* ==========================================================================
   CONTEXTO
   ========================================================================== */

const JAIR = { email: 'Jair@formatar.com.br' };            // a caixa não importa
const MARINA = { email: 'marina@formatar.com.br' };
const SOCIO = { email: 'socio@formatar.com.br', grupoId: '64e678a7d2042dae072ef102' };
const cab = { 'Content-Type': 'application/json' };
const ctx = (metodo, url, corpo, usuario, env = {}) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : {
    method: metodo, headers: cab, body: JSON.stringify(corpo)
  }),
  env: { DB, ...env },
  data: { cabecalhos: cab, usuario }
});
const ler = async (r) => ({ status: r.status, corpo: await r.json() });
const PUT = (id, corpo, u = JAIR) => agenda.onRequestPut(ctx('PUT', `/api/agenda?id=${id}`, corpo, u)).then(ler);
const DEL = (id, u = JAIR) => agenda.onRequestDelete(ctx('DELETE', `/api/agenda?id=${id}`, undefined, u)).then(ler);
const GET = (q, u = JAIR) => agenda.onRequestGet(ctx('GET', `/api/agenda?${q}`, undefined, u)).then(ler);
const item = (id) => bd.prepare('SELECT * FROM agenda_lead WHERE id = ?').get(id);
const lead = (id) => bd.prepare('SELECT * FROM leads WHERE id = ?').get(id);

/* ==========================================================================
   2. INICIAR
   ========================================================================== */

console.log('\n=== 2. Iniciar ===');

ok((await PUT(50, { acao: 'iniciar' })).corpo.code === 'NAO_E_REUNIAO', 'contato não se inicia');
ok((await PUT(10, { acao: 'pular' })).corpo.code === 'ACAO_INVALIDA', 'ação desconhecida é recusada');

const antes = Date.now();
const i1 = await PUT(10, { acao: 'iniciar' });
ok(i1.status === 200 && i1.corpo.item.iniciada_por === 'jair@formatar.com.br' && Date.parse(i1.corpo.item.iniciada_em) >= antes - 1000,
  'inicia, guardando quem e o instante', JSON.stringify({ por: i1.corpo.item?.iniciada_por, em: i1.corpo.item?.iniciada_em }));
ok(i1.corpo.item.status === 'agendada' && !i1.corpo.item.finalizada_em && i1.corpo.item.lead_nome === 'Cedro',
  'em andamento: ainda sem fim, com o lead junto');
ok((await PUT(10, { acao: 'iniciar' })).corpo.code === 'JA_INICIADA', 'a mesma reunião não se inicia duas vezes');

console.log('\n=== 3. Uma em andamento por pessoa ===');

const segunda = await PUT(20, { acao: 'iniciar' });
ok(segunda.status === 409 && segunda.corpo.code === 'OUTRA_EM_ANDAMENTO' && segunda.corpo.emAndamento?.id === 10
  && /Cedro/.test(segunda.corpo.error), 'a segunda é recusada, dizendo qual está aberta', segunda.corpo.error);
ok(!item(20).iniciada_em, 'e nada foi gravado nela');

const daMarina = await PUT(20, { acao: 'iniciar' }, MARINA);
ok(daMarina.status === 200, 'outra pessoa inicia a dela ao mesmo tempo (a trava é por pessoa)');

const minha = await GET('em_andamento=1');
ok(minha.corpo.item?.id === 10 && minha.corpo.item.lead_nome === 'Cedro', 'a consulta "em andamento" devolve a minha');
ok((await GET('em_andamento=1', { email: 'ninguem@formatar.com.br' })).corpo.item === null, 'quem não tem nenhuma recebe nada');

let barrou = false;
try { bd.prepare("UPDATE agenda_lead SET iniciada_em = 'x', iniciada_por = 'jair@formatar.com.br' WHERE id = 30").run(); }
catch (e) { barrou = /UNIQUE/i.test(e.message); }
ok(barrou, 'o banco também recusa uma segunda em andamento (índice da 021)');

console.log('\n=== 4. Em andamento, só finalizando ===');

ok((await PUT(10, { status: 'cancelada' })).corpo.code === 'EM_ANDAMENTO', 'não se cancela');
ok((await PUT(10, { remarcar_para: '2026-10-20T10:00' })).corpo.code === 'EM_ANDAMENTO', 'não se remarca');
ok((await DEL(10)).corpo.code === 'EM_ANDAMENTO', 'não se exclui');
const edita = await PUT(10, { status: 'agendada', pauta: 'Levar a proposta' });
ok(edita.status === 200 && item(10).pauta === 'Levar a proposta' && item(10).iniciada_em,
  'a pauta se edita, e a hora de início continua lá');

const pulando = await PUT(30, { status: 'realizada' });
ok(pulando.status === 400 && pulando.corpo.code === 'REALIZADA_SO_FINALIZANDO', 'reunião não vira realizada pela lista');
ok((await PUT(50, { status: 'realizada' })).status === 200, 'contato continua virando realizado pela lista');

/* ==========================================================================
   5. FINALIZAR
   ========================================================================== */

console.log('\n=== 5. Finalizar ===');

ok((await PUT(40, { acao: 'finalizar' })).corpo.code === 'NAO_INICIADA', 'não se finaliza o que não começou');

const deOutro = await PUT(20, { acao: 'finalizar' });
ok(deOutro.status === 403 && deOutro.corpo.code === 'DE_OUTRA_PESSOA', 'só quem iniciou finaliza');
const peloSocio = await PUT(20, { acao: 'finalizar' }, SOCIO);
ok(peloSocio.status === 200 && peloSocio.corpo.item.finalizada_por === 'socio@formatar.com.br',
  'admin finaliza a de outra pessoa (para destravar)');

// A gravação que ficou aberta (o PC reiniciou) e o início às 22:30 de
// Brasília do dia 02, que em UTC já é dia 03.
bd.exec(`INSERT INTO gravacoes (id, reuniao_id, lead_id, modo, consentimento_por, consentimento_em, status, iniciada_por, iniciada_em)
         VALUES (7, 10, 1, 'online', 'jair@formatar.com.br', 'x', 'gravando', 'jair@formatar.com.br', 'x')`);
bd.exec("UPDATE agenda_lead SET iniciada_em = '2026-10-03T01:30:00.000Z' WHERE id = 10");
// O contato realizado acima (05/10) já levou o último contato adiante, e
// ele nunca anda para trás: volta a janeiro para a conta aparecer.
bd.exec("UPDATE leads SET data_ultimo_contato = '2026-01-01' WHERE id = 1");
ok(diaEmBrasilia('2026-10-03T01:30:00.000Z') === '2026-10-02', 'o dia em Brasília de um instante UTC');

const fim = await PUT(10, { acao: 'finalizar' });
const r10 = item(10);
ok(fim.status === 200 && r10.status === 'realizada' && r10.finalizada_por === 'jair@formatar.com.br' && r10.finalizada_em,
  'finaliza: realizada, com quem e o instante', fim.corpo.error);
ok(bd.prepare('SELECT status FROM gravacoes WHERE id = 7').get().status === 'encerrada', 'a gravação que ficou aberta é encerrada junto');
ok(lead(1).data_ultimo_contato === '2026-10-02', 'o último contato é o dia em que aconteceu, em Brasília', lead(1).data_ultimo_contato);
ok(lead(1).data_proximo_contato === '2026-10-09', 'e o próximo contato passa ao compromisso seguinte', lead(1).data_proximo_contato);

ok((await PUT(10, { acao: 'finalizar' })).status === 200 && item(10).finalizada_em === r10.finalizada_em,
  'finalizar de novo não muda a hora de fim');
ok((await PUT(10, { acao: 'iniciar' })).corpo.code === 'JA_INICIADA', 'realizada não se inicia de novo');
ok((await PUT(30, { acao: 'iniciar' })).status === 200, 'finalizada a primeira, a pessoa inicia outra');

/* ==========================================================================
   6. GRAVAR SÓ A REUNIÃO INICIADA
   ========================================================================== */

console.log('\n=== 6. A gravação acompanha a reunião ===');

const AI = { run: async () => ({ text: 'ok' }) };
const GRAVAR = (corpo, u = JAIR) => gravacoes.onRequestPost(ctx('POST', '/api/gravacoes', corpo, u, { AI })).then(ler);
const pedido = (id) => ({ reuniao_id: id, consentimento: true, modo: 'presencial' });

ok((await GRAVAR(pedido(40))).corpo.code === 'NAO_INICIADA', 'reunião não iniciada não se grava');
ok((await GRAVAR(pedido(10))).corpo.code === 'NAO_INICIADA', 'reunião finalizada não se grava');
ok((await GRAVAR(pedido(30), MARINA)).corpo.code === 'DE_OUTRA_PESSOA', 'quem grava é quem iniciou');

const g1 = await GRAVAR(pedido(30));
ok(g1.status === 201, 'quem iniciou grava', g1.corpo.error);
const g2 = await GRAVAR(pedido(30));
ok(g2.status === 201 && bd.prepare('SELECT status FROM gravacoes WHERE id = ?').get(g1.corpo.gravacao.id).status === 'encerrada',
  'retomar a gravação encerra a que ficou aberta');

const encerra = await gravacoes.onRequestPut(ctx('PUT', `/api/gravacoes?id=${g2.corpo.gravacao.id}`, { encerrar: true, duracao_s: 60 }, JAIR)).then(ler);
ok(encerra.status === 200 && item(30).status === 'agendada' && !item(30).finalizada_em,
  'encerrar a gravação não finaliza a reunião (quem finaliza é "Finalizar")');

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
