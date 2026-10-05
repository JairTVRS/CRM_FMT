/**
 * Prova da conferência das pessoas no ERP (2.42.0).
 *
 * O que importa:
 *   - só admin usa;
 *   - a resposta descreve a FORMA e nunca leva nome, e-mail ou telefone;
 *   - campo recusado pelo ERP (400) vira "recusado", com o motivo, sem
 *     derrubar a conferência dos outros caminhos;
 *   - o resumo conta pessoas e quantas têm código.
 */
import { DatabaseSync } from 'node:sqlite';
import * as api from '../../functions/api/hub-diagnostico.js';
import { descreverForma } from '../../functions/api/_lib/diagnostico-pessoas.js';
import { esquecerMemoria } from '../../functions/api/_lib/hub.js';

let falhas = 0;
function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

console.log('\n=== 1. A forma, sem os valores ===');
const f = descreverForma([
  { id: 'a1', name: 'Júlio Célio Silva', role: { id: 'r1', name: 'SÓCIO' }, email: '', phone: '3732290202' },
  { _id: 'a2', name: 'Júlia', role: { id: 'r1', name: 'SÓCIO' }, email: 'jsilva@grupodivical.com.br', phone: '37984016424' },
  { name: 'Sem código', email: null }
]);
ok(f.quantidade === 3 && f.comId === 2, 'conta pessoas e quantas têm código (id ou _id)', JSON.stringify({ q: f.quantidade, c: f.comId }));
ok(f.chaves.email === 1 && f.chaves.name === 3, 'diz em quantas pessoas cada campo vem preenchido');
ok(JSON.stringify(f.subchaves.role) === '["id","name"]', 'e as subchaves de campo que é objeto (cargo)');
ok(!/Júlio|jsilva|3732290202/.test(JSON.stringify(f)), 'nenhum valor sai na descrição');
ok(descreverForma(undefined).presente === false, 'campo que não veio: presente = false');

console.log('\n=== 2. A rota ===');
const bd = new DatabaseSync(':memory:');
bd.exec(`CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT, erp_id TEXT, ativo INTEGER DEFAULT 1);
         INSERT INTO clientes (nome, erp_id) VALUES ('DIVINÓPOLIS CALÇADOS', '64e3bcef79332f21f3dfc3bd'), ('Sem pessoas', 'aaaaaaaaaaaaaaaaaaaaaaaa');`);
const DB = {
  prepare(sql) {
    const st = bd.prepare(sql); let a = [];
    const o = { bind(...x) { a = x; return o; }, async first() { return st.get(...a) ?? null; }, async all() { return { results: st.all(...a) }; } };
    return o;
  }
};

const pedidos = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  pedidos.push(`${u.pathname}?fields=${u.searchParams.get('fields') || ''}`);
  const campos = u.searchParams.get('fields') || '';
  if (u.pathname.endsWith('/stakeholders')) return new Response('{"error":"not found"}', { status: 404 });
  if (campos.includes('stakeholders')) return new Response('{"error":"API_FIELDS_VALIDATION: stakeholders"}', { status: 400 });
  const id = u.pathname.split('/').pop();
  const contacts = id === '64e3bcef79332f21f3dfc3bd'
    ? [{ id: 'c1', name: 'Júlio Célio Silva', role: 'SÓCIO', phone: '3732290202' }, { id: 'c2', name: 'Júlia', role: 'SÓCIO', email: 'jsilva@grupodivical.com.br' }]
    : [];
  return new Response(JSON.stringify({ data: { id, companyName: 'X', contacts } }), { status: 200 });
};

const cab = { 'Content-Type': 'application/json' };
const ctx = (url, usuario) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`),
  env: { DB, HUB_API_KEY: 'chave', HUB_BASE_URL: 'http://hub.teste/v1' },
  data: { cabecalhos: cab, usuario }
});
const SOCIO = { email: 'socio@formatar.com.br', grupoId: '64e678a7d2042dae072ef102' };
const OUTRO = { email: 'cx@formatar.com.br', grupoId: 'grupo-cx' };

let r = await api.onRequestGet(ctx('/api/hub-diagnostico', OUTRO));
ok(r.status === 403, 'quem não é admin não usa');

esquecerMemoria();
r = await api.onRequestGet(ctx('/api/hub-diagnostico?erp_id=64e3bcef79332f21f3dfc3bd', SOCIO));
let d = await r.json();
const texto = JSON.stringify(d);
ok(r.status === 200 && d.clientes.length === 1 && d.clientes[0].nome === 'DIVINÓPOLIS CALÇADOS', 'um cliente pelo id do ERP, com o nome do cadastro do CRM');
ok(d.resumo.contacts.pessoas === 2 && d.resumo.contacts.pessoasComCodigo === 2, 'contacts: 2 pessoas, as 2 com código');
ok(d.clientes[0].contacts.oQueOCrmEntende.pessoasComNome === 2, 'e o leitor do CRM as reconhece');
ok(d.clientes[0].stakeholders.ok === false && /API_FIELDS_VALIDATION/.test(d.clientes[0].stakeholders.mensagem), 'campo "stakeholders" recusado: vira recusado, com o motivo');
ok(d.clientes[0].rotaStakeholders.ok === false && d.clientes[0].rotaStakeholders.status === 404, 'rota inexistente: 404, sem derrubar a conferência');
ok(!/Júlio|Júlia|jsilva|3732290202/.test(texto), 'nenhum nome, e-mail ou telefone de pessoa na resposta');

r = await api.onRequestGet(ctx('/api/hub-diagnostico', SOCIO));
d = await r.json();
ok(d.clientes.length === 2 && d.resumo.contacts.clientesComPessoas === 1, 'sem id: sorteia entre os clientes ligados ao ERP');
r = await api.onRequestGet(ctx('/api/hub-diagnostico?erp_id=../../x', SOCIO));
ok(r.status === 400, 'id com caractere estranho é recusado');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
