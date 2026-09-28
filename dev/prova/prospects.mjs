/**
 * Prova da importação dos prospects do ERP (2.33.0).
 *
 * O que importa:
 *   - prospect novo vira lead em "Novo Lead", canal ERP, sem responsável;
 *   - mesmo CNPJ de lead ativo NÃO duplica: vincula o erp_id;
 *   - CNPJ que só existe em lead excluído não volta — nem hoje, nem amanhã;
 *   - lead importado e depois excluído não volta na rodada seguinte;
 *   - a diária roda uma vez por dia; a manual é só de admin;
 *   - o Worker entra pelo CRON_SECRET, só em POST /api/prospects.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { planejar, importarProspects, hojeEmBrasilia, CANAL_ERP } from '../../functions/api/_lib/prospects.js';
import * as rota from '../../functions/api/prospects.js';
import { onRequest as middleware } from '../../functions/api/_middleware.js';

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
      async run() { return stmt.run(...args); }
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
   ESQUEMA E DADOS
   ========================================================================== */

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
bd.exec(`
  CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, documento TEXT,
    telefone TEXT, origem TEXT, observacoes TEXT, email TEXT, contato_nome TEXT, cep TEXT,
    cidade TEXT, endereco TEXT, site TEXT, instagram TEXT, ramo TEXT, segmento TEXT, resumo_ia TEXT,
    criado_por TEXT NOT NULL, criado_em TEXT NOT NULL, atualizado_por TEXT, atualizado_em TEXT,
    ativo INTEGER NOT NULL DEFAULT 1);
  CREATE UNIQUE INDEX idx_leads_documento_unico ON leads (documento)
    WHERE ativo = 1 AND documento IS NOT NULL AND documento <> '';
`);
bd.exec(readFileSync(`${RAIZ}/db/migracao-004-funil.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-005-pipelines-classificacao.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-016-funil-responsavel-perda.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-018-prospects-erp.sql`, 'utf8'));

// Um lead ativo (vai ser vinculado) e um excluído (não pode voltar).
bd.exec(`
  INSERT INTO leads (id, nome, documento, criado_por, criado_em, etapa_id, responsavel, ativo) VALUES
    (1, 'Já é lead', '19131243000197', 'jair@formatar.com.br', '2026-08-01', 3, 'jair@formatar.com.br', 1),
    (2, 'Foi excluído', '11222333000181', 'jair@formatar.com.br', '2026-08-01', 2, NULL, 0);
`);
const NOVO_LEAD = bd.prepare("SELECT id FROM etapas WHERE nome = 'Novo Lead'").get().id;

// Os prospects do ERP, como o hub devolve.
const PROSPECTS = [
  { id: 'p-novo', companyName: 'Acme Prospect Ltda', document: '11.444.777/0001-61', phone1: '31999990000', email: 'a@acme.com', status: 'prospect' },
  { id: 'p-existe', companyName: 'Já é lead (no ERP)', document: '19131243000197', status: 'prospect' },
  { id: 'p-excluido', companyName: 'Foi excluído (no ERP)', document: '11222333000181', status: 'prospect' },
  { id: 'p-sem-doc', tradingName: 'Sem CNPJ', document: '', status: 'prospect' },
  { id: 'p-repetido', companyName: 'Acme de novo', document: '11444777000161', status: 'prospect' }
];

let hubStatus = 200;
let pedidos = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  pedidos.push(u.pathname + u.search);
  if (hubStatus !== 200) return new Response('{}', { status: hubStatus });
  if (!u.pathname.endsWith('/customers')) return new Response('{}', { status: 404 });
  const pagina = Number(u.searchParams.get('page') || 1);
  const lista = PROSPECTS.filter((p) => p.status === u.searchParams.get('status'));
  return new Response(JSON.stringify({ size: lista.length, data: pagina > 1 ? [] : lista }), { status: 200 });
};
const ENV = { DB, HUB_API_KEY: 'x' };
const lead = (sql, ...a) => bd.prepare(sql).get(...a);

/* ==========================================================================
   1. A REGRA, SEM GRAVAR
   ========================================================================== */

console.log('\n=== 1. O plano ===');

const traduzidos = PROSPECTS.map((p) => ({
  erp_id: p.id, nome: p.companyName || p.tradingName, documento: String(p.document).replace(/\D/g, '') || null
}));
const plano = planejar(traduzidos, new Set(['p-sem-doc']),
  [{ id: 1, documento: '19131243000197', ativo: 1 }, { id: 2, documento: '11222333000181', ativo: 0 }]);
const acoes = Object.fromEntries(plano.map((x) => [x.prospect.erp_id, x.acao]));
ok(acoes['p-novo'] === 'criar', 'prospect novo: criar');
ok(acoes['p-existe'] === 'vincular', 'mesmo CNPJ de lead ativo: vincular');
ok(acoes['p-excluido'] === 'excluido', 'CNPJ só em lead excluído: não recriar');
ok(!('p-sem-doc' in acoes), 'o que o CRM já viu é pulado');
ok(acoes['p-repetido'] === 'vincular', 'o mesmo CNPJ duas vezes no ERP vira um lead só');

/* ==========================================================================
   2. A PRIMEIRA RODADA
   ========================================================================== */

console.log('\n=== 2. A primeira rodada ===');

const r1 = await importarProspects(ENV, DB, { usuario: 'jair@formatar.com.br', origem: 'manual' });
ok(r1.total_hub === 5 && r1.criados === 2 && r1.vinculados === 2 && r1.ignorados === 1,
  'números da rodada', JSON.stringify(r1));
ok(pedidos.some((p) => p.includes('status=prospect')), 'pede ao hub só os prospects');

const acme = lead("SELECT * FROM leads WHERE erp_id = 'p-novo'");
ok(acme && acme.nome === 'Acme Prospect Ltda' && acme.documento === '11444777000161'
  && acme.canal === CANAL_ERP && acme.etapa_id === NOVO_LEAD && acme.responsavel === null && acme.ativo === 1,
  'o novo entra em Novo Lead, canal ERP, sem responsável', JSON.stringify(acme));
ok(acme.telefone === '31999990000' && acme.email === 'a@acme.com', 'com telefone e e-mail do ERP');

const semDoc = lead("SELECT * FROM leads WHERE erp_id = 'p-sem-doc'");
ok(semDoc && semDoc.documento === null && semDoc.nome === 'Sem CNPJ', 'prospect sem CNPJ entra também, sem documento');

ok(lead('SELECT erp_id FROM leads WHERE id = 1').erp_id === 'p-existe', 'o lead que já existia ganha o erp_id, sem duplicar');
ok(lead("SELECT COUNT(*) n FROM leads WHERE documento = '19131243000197'").n === 1, 'continua um lead só com aquele CNPJ');
ok(lead("SELECT COUNT(*) n FROM leads WHERE documento = '11222333000181' AND ativo = 1").n === 0, 'o excluído não voltou');
ok(lead("SELECT COUNT(*) n FROM leads WHERE documento = '11444777000161'").n === 1, 'o CNPJ repetido no ERP virou um lead só');

const memoria = bd.prepare('SELECT erp_id, situacao, lead_id FROM prospects_erp ORDER BY erp_id').all();
ok(memoria.length === 5 && memoria.find((m) => m.erp_id === 'p-novo').lead_id === acme.id,
  'todos ficam na memória, com o lead de cada um', JSON.stringify(memoria));

/* ==========================================================================
   3. OS DIAS SEGUINTES
   ========================================================================== */

console.log('\n=== 3. As rodadas seguintes ===');

const r2 = await importarProspects(ENV, DB, { usuario: 'jair@formatar.com.br', origem: 'manual' });
ok(r2.criados === 0 && r2.vinculados === 0 && r2.ignorados === 0, 'rodar de novo não traz nada');

bd.prepare("UPDATE leads SET ativo = 0 WHERE erp_id = 'p-novo'").run();
const r3 = await importarProspects(ENV, DB, { usuario: 'jair@formatar.com.br', origem: 'manual' });
ok(r3.criados === 0 && lead("SELECT COUNT(*) n FROM leads WHERE erp_id = 'p-novo' AND ativo = 1").n === 0,
  'lead importado e depois excluído não volta');

PROSPECTS.push({ id: 'p-amanha', companyName: 'Chegou hoje', document: '04252011000110', status: 'prospect' });
const agora = new Date('2026-09-29T12:00:00Z');
const d1r = await importarProspects(ENV, DB, { usuario: 'importacao-diaria@crm', origem: 'diaria', agora });
ok(d1r.criados === 1 && !d1r.jaFeita, 'a diária traz o prospect novo');
const d2r = await importarProspects(ENV, DB, { usuario: 'importacao-diaria@crm', origem: 'diaria', agora });
ok(d2r.jaFeita === true, 'a diária não roda duas vezes no mesmo dia');

ok(hojeEmBrasilia(new Date('2026-09-30T02:00:00Z')) === '2026-09-29', 'o dia é o de Brasília: 23h do dia 29 ainda é dia 29');

hubStatus = 403;
let falhou = null;
try { await importarProspects(ENV, DB, { usuario: 'jair@formatar.com.br', origem: 'manual' }); } catch (e) { falhou = e; }
const registro = bd.prepare('SELECT * FROM importacoes_erp ORDER BY id DESC LIMIT 1').get();
ok(falhou && registro.erro && /permiss/i.test(registro.erro), 'hub recusando: a rodada fica registrada com o erro', registro.erro);
hubStatus = 200;

/* ==========================================================================
   4. A ROTA E O MIDDLEWARE
   ========================================================================== */

console.log('\n=== 4. Quem pode rodar ===');

const cab = { 'Content-Type': 'application/json' };
const ctx = (usuario, metodo = 'POST') => ({
  request: new Request('https://crm-fmt.pages.dev/api/prospects', { method: metodo, headers: cab, body: metodo === 'POST' ? '{}' : undefined }),
  env: ENV, data: { cabecalhos: cab, usuario }
});

const naoAdmin = await rota.onRequestPost(ctx({ email: 'marina@formatar.com.br', grupoId: 'outro' }));
ok(naoAdmin.status === 403, 'quem não é admin não roda a importação manual');

const admin = await rota.onRequestPost(ctx({ email: 'jair@formatar.com.br', grupoId: '64e678a7d2042dae072ef102' }));
ok(admin.status === 200, 'admin roda');

const lista = await (await rota.onRequestGet(ctx({ email: 'x' }, 'GET'))).json();
ok(lista.importacoes.length === 5 && lista.importacoes[0].origem === 'manual', 'as últimas rodadas para a tela');

const chamar = (cabecalhos, metodo = 'POST', caminho = '/api/prospects') => {
  let entregue = null;
  return middleware({
    request: new Request(`https://crm-fmt.pages.dev${caminho}`, { method: metodo, headers: cabecalhos, body: metodo === 'POST' ? '{}' : undefined }),
    env: { GOOGLE_CLIENT_ID: 'g', HUB_API_KEY: 'h', CRON_SECRET: 'segredo-do-cron' },
    data: {},
    next: async function () { entregue = this?.data?.usuario || true; return new Response('passou'); }
  }).then(async (r) => ({ status: r.status, texto: await r.text() }));
};

const certo = await chamar({ 'X-Cron-Secret': 'segredo-do-cron' });
ok(certo.status === 200 && certo.texto === 'passou', 'o Worker com o segredo certo entra');
const errado = await chamar({ 'X-Cron-Secret': 'outro' });
ok(errado.status === 401, 'segredo errado cai no login normal (401)');
const outraRota = await chamar({ 'X-Cron-Secret': 'segredo-do-cron' }, 'POST', '/api/leads');
ok(outraRota.status === 401, 'o segredo não abre nenhuma outra rota');
const get = await chamar({ 'X-Cron-Secret': 'segredo-do-cron' }, 'GET');
ok(get.status === 401, 'nem outro método na mesma rota');

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
