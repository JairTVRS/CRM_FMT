/**
 * Prova do histórico de cada compromisso (2.36.5).
 *
 * Pedido de 01/10/2026: um relógio na janela abre o histórico — quem,
 * quando e o que mudou —, como o "Histórico de alterações" do ERP.
 *   - toda escrita grava o seu evento, com quem (minúsculas) e quando;
 *   - a alteração guarda campo a campo o "de → para"; salvar sem mudar
 *     nada não vira evento;
 *   - remarcar deixa as duas pontas ligadas;
 *   - o compromisso de antes da 023 mostra a criação pelo próprio cadastro.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as agenda from '../../functions/api/agenda.js';
import { mudancas } from '../../functions/api/_lib/agenda.js';

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
  INSERT INTO leads (id, nome, responsavel) VALUES (1, 'Cedro', 'jair@formatar.com.br'), (2, 'Feheros', 'jair@formatar.com.br');
  CREATE TABLE usuarios_crm (email TEXT PRIMARY KEY);
  INSERT INTO usuarios_crm (email) VALUES ('jair@formatar.com.br'), ('marina@formatar.com.br');
`);
for (const m of ['017-agenda-lead', '019-ia-e-roteiros', '020-gravacao', '021-reuniao-iniciar-finalizar', '022-cancelamento-motivo']) {
  bd.exec(readFileSync(`${RAIZ}/db/migracao-${m}.sql`, 'utf8'));
}
// Uma reunião de ANTES da 023, sem nenhum evento.
bd.exec(`INSERT INTO agenda_lead (id, lead_id, tipo, inicio, duracao_min, local_tipo, status, responsavel, criado_por, criado_em)
         VALUES (5, 2, 'reuniao', '2026-09-29T16:00', 30, 'online', 'agendada', 'jair@formatar.com.br', 'Jair@formatar.com.br', '2026-09-29T19:00:00.000Z')`);

const JAIR = { email: 'Jair@formatar.com.br' };
const cab = { 'Content-Type': 'application/json' };
const ctx = (metodo, url, corpo, usuario = JAIR) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : {
    method: metodo, headers: cab, body: JSON.stringify(corpo)
  }),
  env: { DB },
  data: { cabecalhos: cab, usuario }
});
const ler = async (r) => ({ status: r.status, corpo: await r.json() });
const POST = (corpo) => agenda.onRequestPost(ctx('POST', '/api/agenda', corpo)).then(ler);
const PUT = (id, corpo) => agenda.onRequestPut(ctx('PUT', `/api/agenda?id=${id}`, corpo)).then(ler);
const DEL = (id) => agenda.onRequestDelete(ctx('DELETE', `/api/agenda?id=${id}`)).then(ler);
const HIST = (id) => agenda.onRequestGet(ctx('GET', `/api/agenda?eventos=${id}`)).then(ler);

/* ==========================================================================
   1. ANTES DA MIGRAÇÃO 023
   ========================================================================== */

console.log('\n=== 1. Antes da migração 023 ===');

const sem = await HIST(5);
ok(sem.status === 200 && /023/.test(sem.corpo.aviso || ''), 'o histórico avisa que falta a migração, sem quebrar');
ok(sem.corpo.eventos.length === 1 && sem.corpo.eventos[0].evento === 'criada' && sem.corpo.eventos[0].sintetico,
  'e mostra a criação pelo cadastro');

bd.exec(readFileSync(`${RAIZ}/db/migracao-023-agenda-eventos.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-023-agenda-eventos.sql`, 'utf8'));
ok(true, 'a 023 roda duas vezes sem erro');
bd.exec(readFileSync(`${RAIZ}/db/migracao-024-reuniao-analises.sql`, 'utf8'));   // o resetar apaga as análises
bd.exec(readFileSync(`${RAIZ}/db/migracao-025-dossie-reuniao.sql`, 'utf8'));   // e os dossiês da reunião

const antiga = (await HIST(5)).corpo;
ok(!antiga.aviso && antiga.eventos[0].por === 'jair@formatar.com.br' && antiga.eventos[0].em === '2026-09-29T19:00:00.000Z',
  'a reunião antiga: criação por quem cadastrou, quando cadastrou');

/* ==========================================================================
   2. CRIAR E ALTERAR
   ========================================================================== */

console.log('\n=== 2. Criar e alterar ===');

const criada = await POST({ lead_id: 1, tipo: 'reuniao', inicio: '2026-10-05T09:00', duracao_min: 60, local_tipo: 'online' });
const id = criada.corpo.item.id;
let h = (await HIST(id)).corpo.eventos;
ok(criada.status === 201 && h.length === 1 && h[0].evento === 'criada' && !h[0].sintetico && h[0].por === 'jair@formatar.com.br',
  'criar grava o evento, com quem em minúsculas', JSON.stringify(h[0]));

await PUT(id, { pauta: 'Levar a proposta', local_tipo: 'presencial', responsavel: 'marina@formatar.com.br' });
h = (await HIST(id)).corpo.eventos;
const alt = h[0];
const campos = (alt.detalhe?.mudancas || []).map((m) => `${m.campo}:${m.de}→${m.para}`).sort();
ok(alt.evento === 'alterada' && campos.join(' | ')
  === 'local_tipo:online→presencial | pauta:null→Levar a proposta | responsavel:jair@formatar.com.br→marina@formatar.com.br',
  'alterar guarda campo a campo o de → para', campos.join(' | '));

await PUT(id, { pauta: 'Levar a proposta' });
ok((await HIST(id)).corpo.eventos.length === 2, 'salvar sem mudar nada não vira evento');

ok(mudancas({ pauta: 'a'.repeat(500) }, { pauta: 'b'.repeat(500) })[0].para.length === 300, 'texto longo vai cortado em 300');

/* ==========================================================================
   3. INICIAR, FINALIZAR, RESETAR, CANCELAR
   ========================================================================== */

console.log('\n=== 3. Iniciar, finalizar, resetar, cancelar ===');

await PUT(id, { acao: 'iniciar' });
await PUT(id, { acao: 'finalizar' });
await PUT(id, { acao: 'resetar' });
await PUT(id, { acao: 'cancelar', motivo: 'cliente', observacao: 'O sócio viajou.' });
h = (await HIST(id)).corpo.eventos;
ok(h.map((e) => e.evento).join(',') === 'cancelada,resetada,finalizada,iniciada,alterada,criada',
  'cada passo vira um evento, do mais novo ao mais antigo', h.map((e) => e.evento).join(','));
ok(h[0].detalhe.motivo === 'cliente' && h[0].detalhe.observacao === 'O sócio viajou.', 'o cancelamento guarda motivo e observação');
ok(h[1].detalhe.estava === 'realizada' && h[1].detalhe.gravacoes === 0, 'o reset guarda de onde voltou e quantas gravações apagou');

/* ==========================================================================
   4. REMARCAR E EXCLUIR
   ========================================================================== */

console.log('\n=== 4. Remarcar e excluir ===');

const outra = (await POST({ lead_id: 1, tipo: 'contato', inicio: '2026-10-06T10:00', canal: 'ligacao' })).corpo.item.id;
const nova = (await PUT(outra, { remarcar_para: '2026-10-08T15:00' })).corpo.item.id;
const daVelha = (await HIST(outra)).corpo.eventos[0];
const daNova = (await HIST(nova)).corpo.eventos;
ok(daVelha.evento === 'remarcada' && daVelha.detalhe.para === '2026-10-08T15:00', 'a remarcada diz para onde foi');
ok(daNova.length === 1 && daNova[0].evento === 'criada' && daNova[0].detalhe.remarcada_de === outra
  && daNova[0].detalhe.de_inicio === '2026-10-06T10:00', 'a nova diz de onde veio');

await DEL(nova);
const exc = (await HIST(nova)).corpo.eventos[0];
ok(exc.evento === 'excluida' && exc.por === 'jair@formatar.com.br', 'excluir também fica registrado');
ok(bd.prepare('SELECT COUNT(*) n FROM agenda_eventos WHERE lead_id = 1').get().n === 10, 'e tudo amarrado ao lead (6 + 2 + 2 eventos)');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
