/**
 * Prova do histórico do lead (2.41.0).
 *
 * O que importa:
 *   - criar, alterar, mover, gerar proposta e excluir viram registro, com
 *     quem e quando;
 *   - a alteração guarda campo por campo, como estava e como ficou;
 *   - salvar sem mudar nada NÃO vira registro (nem o resumo da IA que o
 *     navegador reescreve);
 *   - a leitura traduz ids e centavos em nomes e reais;
 *   - sem a migração 028 o lead salva normalmente e o histórico avisa.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as leadsApi from '../../functions/api/leads.js';
import * as propostaApi from '../../functions/api/proposta.js';
import { diferencas } from '../../functions/api/_lib/lead-eventos.js';

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

console.log('\n=== 1. O que conta como mudança ===');
ok(diferencas({ nome: 'A', tags: '[2,1]' }, { nome: 'A', tags: '[1,2]' }, ['nome', 'tags']).length === 0, 'mesmas tags em outra ordem não é mudança');
ok(diferencas({ telefone: '' }, { telefone: null }, ['telefone']).length === 0, 'vazio e nulo são a mesma coisa');
ok(diferencas({ resumo_ia: '<p class="x">Empresa  de   aço</p>' }, { resumo_ia: "<p class='x'>Empresa de aço</p>" }, ['resumo_ia']).length === 0,
  'o resumo da IA reescrito pelo navegador não é mudança');
const r = diferencas({ resumo_ia: '<p>A</p>' }, { resumo_ia: '<p>B</p>' }, ['resumo_ia']);
ok(r.length === 1 && !('de' in r[0]), 'resumo mudado de verdade: registra só que mudou, sem o texto');

/* ========================================================================== */
const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
bd.exec(`
  CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, documento TEXT,
    telefone TEXT, origem TEXT, observacoes TEXT, email TEXT, contato_nome TEXT, cep TEXT,
    cidade TEXT, endereco TEXT, site TEXT, instagram TEXT, ramo TEXT, segmento TEXT, resumo_ia TEXT,
    criado_por TEXT NOT NULL, criado_em TEXT NOT NULL, atualizado_por TEXT, atualizado_em TEXT,
    ativo INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, documento TEXT,
    lead_id INTEGER, etapa_id INTEGER, ativo INTEGER DEFAULT 1);
`);
for (const m of ['004-funil', '005-pipelines-classificacao', '016-funil-responsavel-perda', '006-propostas', '009-propostas-status', '027-contrato']) {
  bd.exec(readFileSync(`${RAIZ}/db/migracao-${m}.sql`, 'utf8'));
}
bd.exec("INSERT OR IGNORE INTO usuarios_crm (email, nome, primeiro_acesso, ultimo_acesso) VALUES ('jair@formatar.com.br', 'Jair Tavares', 'x', 'x')");

const JAIR = { email: 'Jair@formatar.com.br' };
const cab = { 'Content-Type': 'application/json' };
const ctx = (metodo, url, corpo) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : { method: metodo, headers: cab, body: JSON.stringify(corpo) }),
  env: { DB }, data: { cabecalhos: cab, usuario: JAIR }
});
const ler = async (p) => { const x = await p; return { status: x.status, corpo: await x.json() }; };
const etapa = (nome) => bd.prepare('SELECT id FROM etapas WHERE nome = ?').get(nome).id;
const NOVO = etapa('Novo Lead');
const QUALIF = etapa('Qualificação');
const HIST = (id) => ler(leadsApi.onRequestGet(ctx('GET', `/api/leads?eventos=${id}`)));

console.log('\n=== 2. Sem a migração 028 ===');
let x = await ler(leadsApi.onRequestPost(ctx('POST', '/api/leads', { nome: 'Antes da 028', documento: '11.222.333/0001-81', etapa_id: NOVO, responsavel: 'jair@formatar.com.br' })));
ok(x.status === 201, 'o lead é criado mesmo sem a tabela do histórico');
const ANTIGO = x.corpo.lead.id;
let h = (await HIST(ANTIGO)).corpo;
ok(/028/.test(h.aviso || '') && h.eventos.length === 1 && h.eventos[0].sintetico, 'o histórico avisa e mostra só a criação', h.aviso);

bd.exec(readFileSync(`${RAIZ}/db/migracao-028-lead-eventos.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-028-lead-eventos.sql`, 'utf8'));
ok(true, 'a 028 roda duas vezes sem erro');

console.log('\n=== 3. Criar, alterar, mover ===');
const base = { nome: 'CEDRO MATERIAIS LTDA', documento: '19.131.243/0001-97', etapa_id: NOVO, responsavel: 'jair@formatar.com.br', telefone: '37 9999-0000' };
x = await ler(leadsApi.onRequestPost(ctx('POST', '/api/leads', base)));
const ID = x.corpo.lead.id;
// A tela reenvia a ficha inteira; o que o servidor preencheu na criação também.
base.atendente = x.corpo.lead.atendente;
base.data_cadastro = x.corpo.lead.data_cadastro;
h = (await HIST(ID)).corpo;
ok(h.eventos.length === 1 && h.eventos[0].evento === 'criado' && !h.eventos[0].sintetico, 'a criação vira registro');
ok(h.eventos[0].por_nome === 'Jair Tavares', 'com o nome de quem fez (e-mail em minúsculas)', h.eventos[0].por);
ok(h.eventos[0].mudancas.some((m) => m.rotulo === 'Telefone' && m.para === '37 9999-0000'), 'e o que veio preenchido');

x = await ler(leadsApi.onRequestPut(ctx('PUT', `/api/leads?id=${ID}`, { ...base, nome: 'CEDRO MATERIAIS E CONSTRUÇÃO LTDA', etapa_id: QUALIF, km_valor: '1,90', telefone: '' })));
ok(x.status === 200, 'alteração salva');
h = (await HIST(ID)).corpo;
const alt = h.eventos[0];
ok(alt.evento === 'alterado' && alt.mudancas.length === 4, 'um registro, com os 4 campos que mudaram', alt.mudancas.map((m) => m.rotulo).join(', '));
const m = Object.fromEntries(alt.mudancas.map((y) => [y.campo, y]));
ok(m.nome.de === 'CEDRO MATERIAIS LTDA' && m.nome.para === 'CEDRO MATERIAIS E CONSTRUÇÃO LTDA', 'como estava e como ficou');
ok(m.etapa_id.de === 'Novo Lead' && m.etapa_id.para === 'Qualificação', 'a etapa sai pelo nome');
ok(m.km_valor.de === null && m.km_valor.para === 'R$ 1,90', 'o km sai em reais', m.km_valor.para);
ok(m.telefone.de === '37 9999-0000' && m.telefone.para === null, 'apagar um campo: de valor para vazio');

x = await ler(leadsApi.onRequestPut(ctx('PUT', `/api/leads?id=${ID}`, { ...base, nome: 'CEDRO MATERIAIS E CONSTRUÇÃO LTDA', etapa_id: QUALIF, km_valor: '1,90', telefone: '' })));
h = (await HIST(ID)).corpo;
ok(h.eventos.length === 2, 'salvar de novo sem mudar nada não vira registro', h.eventos.length);

await ler(leadsApi.onRequestPut(ctx('PUT', '/api/leads?mover=1', { id: ID, etapa_id: QUALIF, ordem: [ID] })));
h = (await HIST(ID)).corpo;
ok(h.eventos.length === 2, 'reordenar na mesma coluna não vira registro');
const PROPOSTA = etapa('Proposta');
await ler(leadsApi.onRequestPut(ctx('PUT', '/api/leads?mover=1', { id: ID, etapa_id: PROPOSTA, ordem: [ID] })));
h = (await HIST(ID)).corpo;
ok(h.eventos[0].evento === 'movido' && h.eventos[0].de === 'Qualificação' && h.eventos[0].para === 'Proposta', 'arrastar no quadro: de etapa para etapa');

console.log('\n=== 4. Documentos e exclusão ===');
x = await ler(propostaApi.onRequestPost(ctx('POST', `/api/proposta?lead_id=${ID}`, { escopo: ['diagnostico'], diagnostico: { valor: '8.800,00' } })));
h = (await HIST(ID)).corpo;
ok(x.status === 201 && h.eventos[0].evento === 'proposta_gerada' && h.eventos[0].detalhe.versao === 1, 'proposta gerada entra, com a versão');

await ler(leadsApi.onRequestDelete(ctx('DELETE', `/api/leads?id=${ID}`)));
h = (await HIST(ID)).corpo;
ok(h.eventos[0].evento === 'excluido', 'a exclusão entra (o histórico continua consultável)');
ok(h.eventos.map((e) => e.evento).join(',') === 'excluido,proposta_gerada,movido,alterado,criado', 'a ordem: do mais novo para o mais antigo');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
