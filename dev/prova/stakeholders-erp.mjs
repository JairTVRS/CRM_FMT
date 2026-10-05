/**
 * Prova da aba Stakeholders com as pessoas do ERP (2.43.0).
 *
 * O que importa:
 *   - as pessoas vêm do `contacts` do ERP, com o código `_id`;
 *   - a avaliação da CX é gravada presa ao código e volta na leitura;
 *   - gravar de novo atualiza (uma avaliação por pessoa);
 *   - quem sai do ERP some da lista; a avaliação fica guardada e contada;
 *   - sem código do ERP, não grava;
 *   - o cargo (`office`) sai legível em texto ou objeto, e nunca como código.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as api from '../../functions/api/stakeholders.js';
import { traduzirContato, esquecerMemoria } from '../../functions/api/_lib/hub.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;
function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

console.log('\n=== 1. O cargo do ERP ===');
ok(traduzirContato({ _id: 'x1', name: 'A', office: 'SÓCIO' }).cargo === 'SÓCIO', 'office em texto');
ok(traduzirContato({ _id: 'x1', name: 'A', office: { _id: 'o1', name: 'Diretor' } }).cargo === 'Diretor', 'office como objeto: o nome');
ok(traduzirContato({ _id: 'x1', name: 'A', office: '64e3bcef79332f21f3dfc3bd' }).cargo === null, 'office como código de outra coleção: nulo, nunca o código');
ok(traduzirContato({ _id: 'x1', name: 'A' }).erp_id === 'x1', 'o código vem do _id');

console.log('\n=== 2. A aba ===');
const bd = new DatabaseSync(':memory:');
bd.exec(`
  CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT, nome_fantasia TEXT, documento TEXT, telefone TEXT, email TEXT,
    classificacao TEXT, etapa_id INTEGER, data_inicio TEXT, nucleos TEXT DEFAULT '[]', erp_id TEXT, observacoes TEXT, ativo INTEGER DEFAULT 1);
  CREATE TABLE nucleos (id INTEGER PRIMARY KEY, nome TEXT, cor TEXT);
  CREATE TABLE papeis (id INTEGER PRIMARY KEY, nome TEXT);
  CREATE TABLE etapas (id INTEGER PRIMARY KEY, nome TEXT, cor TEXT, pipeline TEXT);
  INSERT INTO clientes (id, nome, nome_fantasia, documento, erp_id) VALUES (1, 'DIVICAL CALÇADOS LTDA', 'DIVINÓPOLIS CALÇADOS', '19131243000197', '64e3bcef79332f21f3dfc3bd');
`);
bd.exec(readFileSync(`${RAIZ}/db/migracao-008-stakeholders-dossie-cx.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-029-stakeholders-erp.sql`, 'utf8'));
ok(!bd.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_stakeholders_nome'").get(), 'a 029 tira a trava de nome único (o ERP pode ter duas "Júlia")');

const DB = {
  prepare(sql) {
    const st = bd.prepare(sql); let a = [];
    const o = {
      bind(...x) { a = x.map((v) => (v === undefined ? null : v)); return o; },
      async first() { return st.get(...a) ?? null; },
      async all() { return { results: st.all(...a) }; },
      async run() { return st.run(...a); }
    };
    return o;
  }
};

let contatos = [
  { _id: '66a1f0c0e4b0a1b2c3d4e5c1', name: 'JÚLIO CÉLIO SILVA', office: 'SÓCIO', phone: '3732290202', phoneCategory: 'fixo', demands: [] },
  { _id: '66a1f0c0e4b0a1b2c3d4e5c2', name: 'JÚLIA', office: 'SÓCIO', email: 'jsilva@grupodivical.com.br', phone: '37984016424', demands: ['PCOM'] }
];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (/\/customers\/[^/]+$/.test(u.pathname)) {
    return new Response(JSON.stringify({ data: { id: '64e3bcef79332f21f3dfc3bd', companyName: 'DIVICAL', document: '19131243000197', contacts: contatos } }), { status: 200 });
  }
  if (/\/(meetings|meeting-types|teams)$/.test(u.pathname)) return new Response(JSON.stringify({ size: 0, data: [] }), { status: 200 });
  return new Response('{}', { status: 404 });
};

const cab = { 'Content-Type': 'application/json' };
const ctx = (metodo, url, corpo) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : { method: metodo, headers: cab, body: JSON.stringify(corpo) }),
  env: { DB, HUB_API_KEY: 'chave', HUB_BASE_URL: 'http://hub.teste/v1' },
  data: { cabecalhos: cab, usuario: { email: 'jair@formatar.com.br' } }
});
const LER = async () => { esquecerMemoria(); const r = await api.onRequestGet(ctx('GET', '/api/stakeholders?cliente_id=1')); return { status: r.status, d: await r.json() }; };
const GRAVAR = async (codigo, corpo) => { const r = await api.onRequestPut(ctx('PUT', `/api/stakeholders?cliente_id=1&erp_contato_id=${codigo}`, corpo)); return { status: r.status, d: await r.json() }; };

let { status, d } = await LER();
ok(status === 200 && d.consultado && d.pessoas.length === 2, 'as 2 pessoas vêm do cadastro do ERP', JSON.stringify({ status, n: d.pessoas?.length, motivo: d.motivo }));
const julia = d.pessoas.find((p) => p.nome === 'JÚLIA');
ok(julia?.erpContatoId === '66a1f0c0e4b0a1b2c3d4e5c2' && julia.cargo === 'SÓCIO' && julia.email === 'jsilva@grupodivical.com.br', 'com código, cargo e contato do ERP');
ok(d.pessoas.every((p) => !p.avaliada && p.influencia === 'desconhecida'), 'ninguém avaliado ainda: "não avaliada", nunca inventado');

let g = await GRAVAR('66a1f0c0e4b0a1b2c3d4e5c2', { nome: 'JÚLIA', influencia: 'alta', postura: 'promotor', patrocinador: true, observacoes: 'Decide o comercial.' });
ok(g.status === 200 && g.d.avaliacao.influencia === 'alta', 'a avaliação é gravada');
({ d } = await LER());
const j2 = d.pessoas.find((p) => p.erpContatoId === '66a1f0c0e4b0a1b2c3d4e5c2');
ok(j2.avaliada && j2.influencia === 'alta' && j2.postura === 'promotor' && j2.patrocinador && j2.observacoes === 'Decide o comercial.', 'e volta na leitura, presa à pessoa do ERP');

g = await GRAVAR('66a1f0c0e4b0a1b2c3d4e5c2', { nome: 'JÚLIA', influencia: 'media', postura: 'promotor', patrocinador: false });
ok(bd.prepare("SELECT COUNT(*) n FROM stakeholders WHERE erp_contato_id = '66a1f0c0e4b0a1b2c3d4e5c2' AND ativo = 1").get().n === 1, 'gravar de novo atualiza: uma avaliação por pessoa');
ok(bd.prepare("SELECT influencia, criado_por, atualizado_por FROM stakeholders WHERE erp_contato_id = '66a1f0c0e4b0a1b2c3d4e5c2'").get().influencia === 'media', 'com o valor novo');

g = await GRAVAR('x', { influencia: 'alta' });
ok(g.status === 400 && g.d.code === 'SEM_CODIGO', 'sem código do ERP não grava');
g = await GRAVAR('66a1f0c0e4b0a1b2c3d4e5c1', { nome: 'JÚLIO', influencia: 'inventada', postura: 'xyz' });
ok(bd.prepare("SELECT influencia, postura FROM stakeholders WHERE erp_contato_id = '66a1f0c0e4b0a1b2c3d4e5c1'").get().influencia === 'desconhecida', 'valor fora da lista vira "não avaliada"');

// O ERP renomeia a Júlia: a avaliação continua com ela (o código é o mesmo).
contatos[1] = { ...contatos[1], name: 'JÚLIA SILVA' };
({ d } = await LER());
ok(d.pessoas.find((p) => p.erpContatoId === '66a1f0c0e4b0a1b2c3d4e5c2')?.influencia === 'media', 'nome mudou no ERP: a avaliação acompanha pelo código');

// A Júlia é excluída no ERP: some da lista; a avaliação fica guardada e contada.
contatos = [contatos[0]];
({ d } = await LER());
ok(d.pessoas.length === 1 && !d.pessoas.some((p) => p.erpContatoId === '66a1f0c0e4b0a1b2c3d4e5c2'), 'quem sai do ERP some da lista');
ok(d.avaliacoesSemPessoa === 1, 'e a avaliação dela fica guardada, contada à parte');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
