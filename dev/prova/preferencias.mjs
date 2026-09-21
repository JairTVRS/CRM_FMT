/**
 * Prova das preferências por usuário (2.28.0) — a engrenagem do Plano.
 *
 * O que importa: a preferência é do usuário DA SESSÃO, e de mais ninguém;
 * e sem a migração 013 a tela abre no padrão em vez de quebrar.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { onRequestGet as prefGet, onRequestPut as prefPut } from '../../functions/api/preferencias.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

function d1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { return stmt.get(...args) ?? null; },
        async run() { return stmt.run(...args); }
      };
      return api;
    }
  };
}

const bd = new DatabaseSync(':memory:');
bd.exec(readFileSync(`${RAIZ}/db/migracao-013-preferencias.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-013-preferencias.sql`, 'utf8'));

const ctx = (url, { email = 'jair@formatar.com.br', corpo, db = d1(bd) } = {}) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? {} : {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
  }),
  env: { DB: db },
  data: { cabecalhos: { 'Content-Type': 'application/json' }, usuario: { email } }
});
const ler = async (r) => ({ status: r.status, corpo: await r.json() });

const URL_PREF = '/api/preferencias?chave=plano-colunas';
const valor = { sequencia: ['cliente', 'acao', 'status'], ocultas: ['onde'], porPagina: 100, ordem: { chave: 'cliente', sentido: -1 } };

console.log('\n=== 1. Gravar e ler ===');
ok(true, 'a 013 roda duas vezes sem erro');
const vazio = await ler(await prefGet(ctx(URL_PREF)));
ok(vazio.status === 200 && vazio.corpo.valor === null, 'quem nunca configurou recebe null — a tela usa o padrão');

const gravou = await ler(await prefPut(ctx(URL_PREF, { corpo: { valor } })));
ok(gravou.status === 200 && gravou.corpo.ok, 'grava');
const lido = await ler(await prefGet(ctx(URL_PREF)));
ok(JSON.stringify(lido.corpo.valor) === JSON.stringify(valor), 'e devolve exatamente o que gravou');

await prefPut(ctx(URL_PREF, { corpo: { valor: { ...valor, porPagina: 50 } } }));
ok((await ler(await prefGet(ctx(URL_PREF)))).corpo.valor.porPagina === 50, 'gravar de novo substitui');
ok(bd.prepare('SELECT COUNT(*) AS n FROM preferencias_usuario').get().n === 1, 'sem duplicar a linha');

console.log('\n=== 2. De cada um ===');
const outra = await ler(await prefGet(ctx(URL_PREF, { email: 'olivia@formatar.com.br' })));
ok(outra.corpo.valor === null, 'a preferência do Jair não aparece para a Olivia');
await prefPut(ctx(URL_PREF, { email: 'olivia@formatar.com.br', corpo: { valor: { ocultas: ['como'] } } }));
ok((await ler(await prefGet(ctx(URL_PREF)))).corpo.valor.porPagina === 50,
  'e a da Olivia não mexe na do Jair');
const fonte = readFileSync(`${RAIZ}/functions/api/preferencias.js`, 'utf8');
ok(!/get\('email'\)|corpo\.email/.test(fonte) && (fonte.match(/context\.data\.usuario\.email/g) || []).length === 2,
  'o e-mail nunca vem da requisição — só da sessão');

console.log('\n=== 3. Recusas ===');
ok((await prefGet(ctx('/api/preferencias?chave=../x'))).status === 400, 'chave com caractere estranho: 400');
ok((await prefGet(ctx('/api/preferencias'))).status === 400, 'sem chave: 400');
ok((await prefPut(ctx(URL_PREF, { corpo: {} }))).status === 400, 'sem valor: 400');
ok((await prefPut(ctx(URL_PREF, { corpo: { valor: 'x'.repeat(9000) } }))).status === 413, 'maior que 8 KB: 413');

console.log('\n=== 4. Sem a migração 013 ===');
const semTabela = d1(new DatabaseSync(':memory:'));
const g = await ler(await prefGet(ctx(URL_PREF, { db: semTabela })));
ok(g.status === 200 && g.corpo.valor === null, 'o GET responde null: a tela abre no padrão, não quebra');
const p = await ler(await prefPut(ctx(URL_PREF, { db: semTabela, corpo: { valor } })));
ok(p.status === 503 && p.corpo.code === 'SEM_MIGRACAO_013', 'o PUT diz qual migração falta', p.corpo.error);

console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
