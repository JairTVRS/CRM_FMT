/**
 * Prova dos núcleos pelas carteiras do ERP (2.44.0).
 *
 * O que importa:
 *   - núcleo do cliente = Time dos tipos de reunião das carteiras ATIVAS;
 *   - sem repetir o mesmo Time, e carteira inativa não conta;
 *   - o filtro por núcleo da Jornada usa essa lista (quadro e lista);
 *   - salvar a ficha não mexe mais na coluna `nucleos` antiga;
 *   - ERP fora do ar: sem núcleos, com o motivo, e sem quebrar a tela.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { nucleosDasCarteiras, clientesDoNucleo } from '../../functions/api/_lib/nucleos-erp.js';
import { esquecerMemoria } from '../../functions/api/_lib/hub.js';
import * as clientesApi from '../../functions/api/clientes.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;
function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

let foraDoAr = false;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (foraDoAr) return new Response('fora', { status: 503 });
  const lista = (data) => new Response(JSON.stringify({ size: data.length, data }), { status: 200 });
  if (u.pathname.endsWith('/portfolios')) {
    return lista([
      { id: 'p1', customer: 'zanna', meetingType: 'tFIN', isActive: true },
      { id: 'p2', customer: 'zanna', meetingType: 'tFIN2', isActive: true },   // mesmo time: não repete
      { id: 'p3', customer: 'zanna', meetingType: 'tOPE', isActive: true },
      { id: 'p4', customer: 'bloo', meetingType: 'tOPE', isActive: true },
      { id: 'p5', customer: 'bloo', meetingType: 'tGOV', isActive: false },  // inativa: não conta
      { id: 'p6', customer: 'bloo', meetingType: 'tSEMTIME', isActive: true }
    ]);
  }
  if (u.pathname.endsWith('/meeting-types')) {
    return lista([
      { id: 'tFIN', title: 'Indicadores Financeiro', teams: ['FIN'] },
      { id: 'tFIN2', title: 'Conselho Financeiro', teams: ['FIN'] },
      { id: 'tOPE', title: 'Logística', teams: ['OPE'] },
      { id: 'tGOV', title: 'Conselho', teams: ['GOV'] },
      { id: 'tSEMTIME', title: 'Avulsa', teams: [] }
    ]);
  }
  if (u.pathname.endsWith('/teams')) {
    return lista([
      { id: 'FIN', title: 'Gestão Financeira' }, { id: 'OPE', title: 'Gestão de Operações' }, { id: 'GOV', title: 'Governança' }
    ]);
  }
  return new Response('{}', { status: 404 });
};
const env = { HUB_API_KEY: 'chave', HUB_BASE_URL: 'http://hub.teste/v1' };

console.log('\n=== 1. As carteiras viram núcleos ===');
let n = await nucleosDasCarteiras(env);
ok(n.consultado, 'o ERP foi consultado');
ok(n.porCliente.get('zanna').map((x) => x.nome).join(',') === 'Gestão de Operações,Gestão Financeira',
  'Zanna: Financeira (duas carteiras do mesmo time, uma vez só) e Operações, em ordem', n.porCliente.get('zanna').map((x) => x.nome).join(','));
ok(n.porCliente.get('bloo').map((x) => x.nome).join(',') === 'Gestão de Operações', 'carteira inativa e tipo sem time não contam');
ok(n.nucleos.map((x) => x.nome).join(',') === 'Gestão Financeira,Gestão de Operações'.split(',').sort((a, b) => a.localeCompare(b, 'pt-BR')).join(','),
  'a lista do filtro: só os núcleos em uso');
ok(clientesDoNucleo(n, 'OPE').sort().join(',') === 'bloo,zanna', 'quem tem o núcleo Operações');

console.log('\n=== 2. A API de clientes ===');
const bd = new DatabaseSync(':memory:');
bd.exec(`CREATE TABLE etapas (id INTEGER PRIMARY KEY, nome TEXT, cor TEXT, ordem INTEGER, encerra INTEGER DEFAULT 0, pipeline TEXT, ativo INTEGER DEFAULT 1, resultado TEXT);
  INSERT INTO etapas (id, nome, ordem, pipeline) VALUES (7, 'Boas-vindas', 1, 'jornada');`);
const sql = readFileSync(`${RAIZ}/db/migracao-007-jornada-cx.sql`, 'utf8');
const criaClientes = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS clientes'), sql.indexOf(');', sql.indexOf('CREATE TABLE IF NOT EXISTS clientes')) + 2);
bd.exec(criaClientes);
for (const col of ['erp_id TEXT', 'lead_id INTEGER', 'etapa_desde TEXT', 'posicao INTEGER NOT NULL DEFAULT 0']) {
  try { bd.exec(`ALTER TABLE clientes ADD COLUMN ${col}`); } catch (e) { /* já existe */ }
}
bd.exec(`INSERT INTO clientes (id, nome, documento, etapa_id, nucleos, erp_id, criado_por, criado_em, ativo) VALUES
  (1, 'ZANNA SOUND', '19131243000197', 7, '[1,2,3]', 'zanna', 'x', '2026-01-01', 1),
  (2, 'AGENCIA BLOO', '11222333000181', 7, '[]', 'bloo', 'x', '2026-01-01', 1),
  (3, 'SEM ERP', '07091149000172', 7, '[]', NULL, 'x', '2026-01-01', 1)`);
const DB = {
  prepare(q) {
    const st = bd.prepare(q); let a = [];
    const o = { bind(...x) { a = x.map((v) => (v === undefined ? null : v)); return o; }, async first() { return st.get(...a) ?? null; },
      async all() { return { results: st.all(...a) }; }, async run() { return /RETURNING/i.test(q) ? { results: st.all(...a) } : st.run(...a); } };
    return o;
  },
  async batch(l) { const r = []; for (const s of l) r.push(await s.run()); return r; }
};
const cab = { 'Content-Type': 'application/json' };
const ctx = (metodo, url, corpo) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : { method: metodo, headers: cab, body: JSON.stringify(corpo) }),
  env: { DB, ...env }, data: { cabecalhos: cab, usuario: { email: 'jair@formatar.com.br' } }
});
const GET = async (q) => (await clientesApi.onRequestGet(ctx('GET', `/api/clientes?${q}`))).json();

let d = await GET('nucleos=1');
ok(d.consultado && d.nucleos.length === 2, 'GET ?nucleos=1: as opções do filtro');
d = await GET('id=1');
ok(d.cliente.nucleosErp.map((x) => x.nome).join(',') === 'Gestão de Operações,Gestão Financeira' && d.nucleosConsultados, 'a ficha traz os núcleos do ERP');
d = await GET('id=3');
ok(d.cliente.nucleosErp.length === 0 && /sem vínculo/i.test(d.nucleosMotivo), 'cliente sem ERP: sem núcleos, e diz por quê');
d = await GET('pagina=1&nucleo=FIN');
ok(d.clientes.length === 1 && d.clientes[0].nome === 'ZANNA SOUND' && d.clientes[0].nucleosErp.length === 2, 'filtro Financeira: só a Zanna', d.clientes.map((c) => c.nome).join(','));
d = await GET('pagina=1&nucleo=OPE');
ok(d.clientes.length === 2, 'filtro Operações: Zanna e Bloo');

// Salvar a ficha não apaga a coluna antiga (fica no banco, sem uso).
const r = await clientesApi.onRequestPut(ctx('PUT', '/api/clientes?id=1', { nome: 'ZANNA SOUND', documento: '19.131.243/0001-97', etapa_id: 7 }));
ok(r.status === 200 && bd.prepare('SELECT nucleos FROM clientes WHERE id = 1').get().nucleos === '[1,2,3]', 'salvar a ficha não mexe mais na coluna de núcleos antiga', String(r.status));

console.log('\n=== 3. ERP fora do ar ===');
esquecerMemoria();
foraDoAr = true;
n = await nucleosDasCarteiras(env);
ok(!n.consultado && n.motivo && n.porCliente.size === 0, 'sem núcleos, com o motivo — e nada fica memorizado');
foraDoAr = false;
ok((await nucleosDasCarteiras(env)).consultado, 'voltou o ERP: consulta de novo');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
