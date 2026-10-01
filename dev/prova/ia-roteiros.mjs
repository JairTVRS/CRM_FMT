/**
 * Prova das chaves de IA no CRM e dos roteiros (2.34.0).
 *
 * O que importa:
 *   - a chave fica CIFRADA no banco e NUNCA volta ao navegador;
 *   - a do painel da Cloudflare vale primeiro;
 *   - o provedor em uso é o escolhido nas Configurações, se tiver chave;
 *     senão o primeiro que tiver;
 *   - só admin muda provedor, chave e roteiro;
 *   - roteiro enviado de novo vira versão nova, e a antiga continua lá.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  cifrar, decifrar, ambienteDeIA, provedorAtivo, situacaoDasChaves
} from '../../functions/api/_lib/chaves-ia.js';
import * as configIa from '../../functions/api/config-ia.js';
import * as roteiros from '../../functions/api/roteiros.js';

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
        bind(...a) { args = a.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return stmt.get(...args) ?? null; },
        async all() { return { results: stmt.all(...args) }; },
        async run() { return stmt.run(...args); }
      };
      return api;
    }
  };
}

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
const M019 = readFileSync(`${RAIZ}/db/migracao-019-ia-e-roteiros.sql`, 'utf8');
bd.exec(M019);
bd.exec(M019);
// 2.38.0: os roteiros ganham a finalidade (roteiro | instrução do dossiê).
bd.exec(readFileSync(`${RAIZ}/db/migracao-025-dossie-reuniao.sql`, 'utf8'));

const SEGREDO = 'segredo-de-teste-das-chaves';
const ADMIN = { email: 'jair@formatar.com.br', grupoId: '64e678a7d2042dae072ef102' };
const OUTRO = { email: 'marina@formatar.com.br', grupoId: 'grupo-operacoes' };
const cab = { 'Content-Type': 'application/json' };

const ctx = (metodo, url, corpo, usuario = ADMIN, env = {}) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : {
    method: metodo, headers: cab, body: JSON.stringify(corpo)
  }),
  env: { DB, CHAVES_SECRET: SEGREDO, DEEPSEEK_API_KEY: 'sk-deepseek-do-painel-000000000000', ...env },
  data: { cabecalhos: cab, usuario }
});
const ler = async (r) => ({ status: r.status, texto: await r.clone().text(), corpo: await r.json() });

/* ==========================================================================
   1. A CIFRA
   ========================================================================== */

console.log('\n=== 1. A cifra ===');

ok(true, 'a 019 roda duas vezes sem erro');
const guardado = await cifrar('sk-minha-chave-secreta-123456', SEGREDO);
ok(!guardado.includes('minha-chave'), 'cifrado não contém a chave');
ok(await decifrar(guardado, SEGREDO) === 'sk-minha-chave-secreta-123456', 'e volta com o mesmo segredo');
ok(await cifrar('x'.repeat(30), SEGREDO) !== await cifrar('x'.repeat(30), SEGREDO), 'a mesma chave cifra diferente a cada vez (IV novo)');
let recusou = false;
try { await decifrar(guardado, 'outro-segredo'); } catch (e) { recusou = true; }
ok(recusou, 'segredo errado não decifra');

/* ==========================================================================
   2. CADASTRAR PELA TELA
   ========================================================================== */

console.log('\n=== 2. Cadastrar pela tela ===');

const CHAVE_OPENAI = 'sk-proj-abcdefghijklmnopqrstuvwxyz-9f3e';

const naoAdmin = await ler(await configIa.onRequestPut(ctx('PUT', '/api/config-ia', { provedor: 'chatgpt', chave: CHAVE_OPENAI }, OUTRO)));
ok(naoAdmin.status === 403, 'quem não é admin não cadastra chave');

const curta = await ler(await configIa.onRequestPut(ctx('PUT', '/api/config-ia', { provedor: 'chatgpt', chave: 'abc' })));
ok(curta.status === 400 && curta.corpo.code === 'CHAVE_INVALIDA', 'chave curta demais é recusada');

const semSegredo = await ler(await configIa.onRequestPut(ctx('PUT', '/api/config-ia', { provedor: 'chatgpt', chave: CHAVE_OPENAI }, ADMIN, { CHAVES_SECRET: undefined })));
ok(semSegredo.status === 503 && semSegredo.corpo.code === 'SEM_CHAVES_SECRET', 'sem CHAVES_SECRET o CRM não guarda chave em claro');

const salvou = await ler(await configIa.onRequestPut(ctx('PUT', '/api/config-ia', { provedor: 'chatgpt', chave: CHAVE_OPENAI })));
ok(salvou.status === 200 && salvou.corpo.provedores.chatgpt.origem === 'crm' && salvou.corpo.provedores.chatgpt.final === '9f3e',
  'admin cadastra; a tela sabe a origem e os 4 últimos', JSON.stringify(salvou.corpo.provedores.chatgpt));
ok(!salvou.texto.includes(CHAVE_OPENAI) && !salvou.texto.includes('abcdefghij'), 'a resposta NÃO traz a chave');

const noBanco = bd.prepare("SELECT cifrada FROM chaves_ia WHERE provedor = 'chatgpt'").get().cifrada;
ok(!noBanco.includes('abcdefghij'), 'no banco ela está cifrada');

const leitura = await ler(await configIa.onRequestGet(ctx('GET', '/api/config-ia', undefined, OUTRO)));
ok(!leitura.texto.includes(CHAVE_OPENAI) && leitura.corpo.provedores.chatgpt.configurado, 'o GET também não traz a chave, a qualquer um');

/* ==========================================================================
   3. QUEM VALE
   ========================================================================== */

console.log('\n=== 3. Quem vale ===');

const env = await ambienteDeIA(ctx('GET', '/').env);
ok(env.OPENAI_API_KEY === CHAVE_OPENAI, 'a chave do CRM preenche o que o painel não tem');
ok(env.DEEPSEEK_API_KEY === 'sk-deepseek-do-painel-000000000000', 'a do painel continua');

bd.prepare("INSERT INTO chaves_ia VALUES ('deepseek', ?, 'crm1', 'x', 'x')").run(await cifrar('sk-deepseek-do-crm-111111111111', SEGREDO));
const env2 = await ambienteDeIA(ctx('GET', '/').env);
ok(env2.DEEPSEEK_API_KEY === 'sk-deepseek-do-painel-000000000000', 'havendo as duas, a do painel vale primeiro');
const sit = await situacaoDasChaves(ctx('GET', '/').env);
ok(sit.deepseek.origem === 'painel' && sit.deepseek.sombreada === true, 'e a tela sabe que a do CRM está sendo ignorada');

const envTrocado = await ambienteDeIA({ ...ctx('GET', '/').env, CHAVES_SECRET: 'mudou' });
ok(!envTrocado.OPENAI_API_KEY, 'se o CHAVES_SECRET mudar, a chave do CRM some em vez de quebrar');

/* ==========================================================================
   4. O PROVEDOR EM USO
   ========================================================================== */

console.log('\n=== 4. O provedor em uso ===');

ok(await provedorAtivo(env) === 'deepseek', 'sem escolha: o primeiro com chave');

const escolhe = await ler(await configIa.onRequestPut(ctx('PUT', '/api/config-ia', { provedor_ativo: 'chatgpt' })));
ok(escolhe.status === 200 && escolhe.corpo.provedorAtivo === 'chatgpt', 'admin escolhe o ChatGPT');
ok(await provedorAtivo(env) === 'chatgpt', 'e é ele que os geradores usam');

await configIa.onRequestPut(ctx('PUT', '/api/config-ia', { provedor_ativo: 'gemini' }));
const semChave = await ler(await configIa.onRequestGet(ctx('GET', '/api/config-ia')));
ok(semChave.corpo.provedorEscolhido === 'gemini' && semChave.corpo.provedorAtivo === 'deepseek',
  'escolhido sem chave: a tela mostra a escolha e o que está em uso de fato');

const lixo = await ler(await configIa.onRequestPut(ctx('PUT', '/api/config-ia', { provedor_ativo: 'skynet' })));
ok(lixo.status === 400, 'provedor desconhecido é recusado');

await configIa.onRequestPut(ctx('PUT', '/api/config-ia', { provedor: 'chatgpt', remover: true }));
ok(!(await ambienteDeIA(ctx('GET', '/').env)).OPENAI_API_KEY, 'remover apaga a chave do CRM');

/* ==========================================================================
   5. ROTEIROS
   ========================================================================== */

console.log('\n=== 5. Roteiros ===');

const post = (corpo, usuario = ADMIN) => roteiros.onRequestPost(ctx('POST', '/api/roteiros', corpo, usuario)).then(ler);
const get = (q) => roteiros.onRequestGet(ctx('GET', `/api/roteiros${q}`)).then(ler);

const R1 = '# Diagnóstico\r\n\r\n## Objetivos\r\n- entender a dor\r\n';
ok((await post({ tipo_reuniao_erp_id: 't1', tipo_reuniao_nome: 'Diagnóstico', nome_arquivo: 'd.md', conteudo: R1 }, OUTRO)).status === 403,
  'quem não é admin não envia roteiro');
ok((await post({ tipo_reuniao_erp_id: 't1', nome_arquivo: 'd.pdf', conteudo: R1 })).status === 400, 'só .md (ou .txt)');
ok((await post({ tipo_reuniao_erp_id: 't1', nome_arquivo: 'd.md', conteudo: '   ' })).status === 400, 'arquivo vazio é recusado');
ok((await post({ tipo_reuniao_erp_id: 't1', nome_arquivo: 'd.md', conteudo: 'x'.repeat(200_001) })).status === 400, 'maior que o limite é recusado');

const v1 = await post({ tipo_reuniao_erp_id: 't1', tipo_reuniao_nome: 'Diagnóstico', nome_arquivo: 'd.md', conteudo: R1 });
ok(v1.status === 201 && v1.corpo.versao === 1, 'o primeiro vira a versão 1');
const v2 = await post({ tipo_reuniao_erp_id: 't1', tipo_reuniao_nome: 'Diagnóstico', nome_arquivo: 'd2.md', conteudo: '# Diagnóstico v2' });
ok(v2.corpo.versao === 2, 'enviar de novo cria a versão 2');
await post({ tipo_reuniao_erp_id: 't2', tipo_reuniao_nome: 'Apresentação', nome_arquivo: 'a.md', conteudo: '# Apresentação' });

const vigentes = await get('');
ok(vigentes.corpo.roteiros.length === 2 && vigentes.corpo.roteiros.find((r) => r.tipo_reuniao_erp_id === 't1').versao === 2,
  'a lista traz o em vigor de cada tipo');
ok(!('conteudo' in vigentes.corpo.roteiros[0]), 'a lista não carrega o texto');

const atual = await get('?tipo=t1');
ok(atual.corpo.roteiro.conteudo === '# Diagnóstico v2', 'o em vigor é o último');
const antigo = await get('?tipo=t1&versao=1');
ok(antigo.corpo.roteiro.conteudo === '# Diagnóstico\n\n## Objetivos\n- entender a dor\n', 'a versão 1 continua lá (com as quebras de linha normalizadas)');
const historico = await get('?tipo=t1&historico=1');
ok(historico.corpo.versoes.map((v) => v.versao).join(',') === '2,1', 'o histórico, do mais novo ao mais antigo');
ok((await get('?tipo=t9')).status === 404, 'tipo sem roteiro responde 404 com a explicação');

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
