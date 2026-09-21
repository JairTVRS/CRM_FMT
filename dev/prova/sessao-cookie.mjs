/**
 * Prova da sessão de 7 dias (2.27.0) — o cookie assinado.
 *
 * Chama o _middleware.js de verdade contra o dublê do hub. O que importa:
 *
 *   1. Cookie válido entra sem token do Google — é o F5 que não derruba.
 *   2. Cookie adulterado, vencido ou assinado com outra chave não entra.
 *   3. O hub continua mandando: desativado no ERP, o cookie não salva.
 *   4. Sem SESSAO_SECRET nada muda em relação a antes.
 *   5. O /api/me renova o cookie; o /api/sair o apaga.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { onRequest } from '../../functions/api/_middleware.js';
import { onRequestGet as meGet } from '../../functions/api/me.js';
import { onRequestPost as sairPost } from '../../functions/api/sair.js';
import {
  assinarSessao, lerSessao, lerCookie, NOME_COOKIE, DURACAO_SESSAO_S
} from '../../functions/api/_lib/sessao.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

async function subirDuble(args = []) {
  const p = spawn(process.execPath, [`${RAIZ}/dev/hub-stub.mjs`, ...args], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { await fetch('http://127.0.0.1:8787/v1/customers'); return p; }
    catch (e) { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('o dublê não subiu');
}

const SEGREDO = 'segredo-de-teste-com-tamanho-razoavel';
const EMAIL = 'jairdasilvatj@gmail.com';

const env = (extra = {}) => ({
  GOOGLE_CLIENT_ID: 'cliente-teste',
  HUB_API_KEY: 'chave-de-teste',
  HUB_USERS_URL: 'http://127.0.0.1:8787/v1/users',
  SESSAO_SECRET: SEGREDO,
  ...extra
});

/** Roda o middleware; `next` responde como o endpoint responderia. */
async function passar(caminho, { cookie = null, metodo = 'GET', ambiente = env(), endpoint = null } = {}) {
  const headers = new Headers({ Origin: 'https://crm-fmt.pages.dev' });
  if (cookie) headers.set('Cookie', cookie);
  const context = {
    request: new Request(`https://crm-fmt.pages.dev${caminho}`, { method: metodo, headers }),
    env: ambiente,
    data: {},
    next: async () => (endpoint
      ? endpoint(context)
      : new Response(JSON.stringify({ chegou: true, usuario: context.data.usuario }), { status: 200 }))
  };
  const r = await onRequest(context);
  return { status: r.status, corpo: await r.json().catch(() => ({})), setCookie: r.headers.get('Set-Cookie') };
}

const cookieDe = (valor) => `outro=1; ${NOME_COOKIE}=${valor}`;

let duble = await subirDuble();

try {
  console.log('\n=== 1. O cookie, isolado ===');
  const valor = await assinarSessao({ email: EMAIL, nome: 'Jair', foto: null }, SEGREDO);
  const lida = await lerSessao(valor, SEGREDO);
  ok(lida?.email === EMAIL, 'assina e lê de volta');
  ok(Math.abs(lida.exp - (Date.now() / 1000 + DURACAO_SESSAO_S)) < 5, 'vale 7 dias', `exp=${lida.exp}`);
  ok(lerCookie(cookieDe(valor)) === valor, 'acha o cookie no meio de outros');

  const [dados, assinatura] = valor.split('.');
  const forjado = Buffer.from(JSON.stringify({ email: 'intruso@x.com', exp: 9999999999 })).toString('base64url');
  ok(await lerSessao(`${forjado}.${assinatura}`, SEGREDO) === null, 'trocar o e-mail invalida a assinatura');
  ok(await lerSessao(valor, 'outra-chave') === null, 'assinado com outra chave não vale');
  ok(await lerSessao(`${dados}.${assinatura}.x`, SEGREDO) === null, 'formato estranho não vale');
  ok(await lerSessao('lixo', SEGREDO) === null, 'lixo não lança, só não vale');

  const antigo = await assinarSessao({ email: EMAIL }, SEGREDO, Date.now() - 8 * 86400000);
  ok(await lerSessao(antigo, SEGREDO) === null, 'com 8 dias, venceu');

  console.log('\n=== 2. O middleware aceita o cookie ===');
  const entra = await passar('/api/leads', { cookie: cookieDe(valor) });
  ok(entra.status === 200 && entra.corpo.chegou, 'cookie válido chega ao endpoint sem token do Google', `status=${entra.status}`);
  ok(entra.corpo.usuario?.email === EMAIL, 'com o usuário do hub em context.data');
  ok(!entra.setCookie, 'rota comum não reemite o cookie');

  const semNada = await passar('/api/leads');
  ok(semNada.status === 401 && semNada.corpo.code === 'TOKEN_AUSENTE', 'sem token e sem cookie: TOKEN_AUSENTE, como antes');

  const vencido = await passar('/api/leads', { cookie: cookieDe(antigo) });
  ok(vencido.status === 401 && vencido.corpo.code === 'TOKEN_INVALIDO',
    'cookie vencido: TOKEN_INVALIDO — a página volta ao login', vencido.corpo.error);

  const forja = await passar('/api/leads', { cookie: cookieDe(`${forjado}.${assinatura}`) });
  ok(forja.status === 401, 'cookie forjado: 401');

  const semSegredo = await passar('/api/leads', { cookie: cookieDe(valor), ambiente: env({ SESSAO_SECRET: undefined }) });
  ok(semSegredo.status === 401 && semSegredo.corpo.code === 'TOKEN_AUSENTE',
    'sem SESSAO_SECRET o cookie é ignorado: o comportamento é o de antes');

  const desconhecido = await assinarSessao({ email: 'ninguem@formatar.com.br' }, SEGREDO);
  const semCadastro = await passar('/api/leads', { cookie: cookieDe(desconhecido) });
  ok(semCadastro.status === 403 && semCadastro.corpo.code === 'SEM_CADASTRO',
    'cookie legítimo de quem não está no hub: 403 SEM_CADASTRO');

  console.log('\n=== 3. O /api/me renova; o /api/sair apaga ===');
  const me = await passar('/api/me', { cookie: cookieDe(valor), endpoint: meGet });
  ok(me.status === 200 && me.corpo.usuario?.email === EMAIL, 'o /api/me responde pelo cookie');
  ok(/^crm_sessao=[^;]+; Max-Age=604800; Path=\/api; HttpOnly; Secure; SameSite=Strict$/.test(me.setCookie || ''),
    'e devolve o cookie renovado: 7 dias, HttpOnly, Secure, Strict, só /api', me.setCookie);
  ok(me.corpo.sessao?.ate && Date.parse(me.corpo.sessao.ate) > Date.now() + 6 * 86400000,
    'e diz à página até quando a sessão vale', me.corpo.sessao?.ate);

  const meSemSegredo = await passar('/api/me', { cookie: cookieDe(valor), ambiente: env({ SESSAO_SECRET: undefined }) });
  ok(meSemSegredo.status === 401, 'sem SESSAO_SECRET, o /api/me não abre sessão por cookie');

  const sair = await passar('/api/sair', { metodo: 'POST', ambiente: env(), endpoint: sairPost });
  ok(sair.status === 200 && /crm_sessao=; Max-Age=0/.test(sair.setCookie || ''),
    'o /api/sair é público e apaga o cookie', sair.setCookie);

  console.log('\n=== 4. O hub continua mandando ===');
  duble.kill();
  await new Promise((r) => setTimeout(r, 400));
  duble = await subirDuble(['--inativo']);
  // O middleware guarda o "ativo" por 5 minutos; outro e-mail escapa do
  // cache e mostra o que o hub diz agora. O dublê só conhece um usuário,
  // então a prova usa o mesmo e-mail com caixa diferente.
  const outraCaixa = await assinarSessao({ email: EMAIL.toUpperCase() }, SEGREDO);
  const inativo = await passar('/api/leads', { cookie: cookieDe(outraCaixa) });
  ok(inativo.status === 403 && inativo.corpo.code === 'INATIVO',
    'desativado no ERP, o cookie de 7 dias não salva ninguém', `status=${inativo.status} ${inativo.corpo.code}`);

  console.log('\n=== 5. O front usa o cookie ===');
  const authJs = readFileSync(`${RAIZ}/public/js/auth.js`, 'utf8');
  ok(/fetchOriginal\('\/api\/me'\)/.test(authJs), 'ao abrir, pergunta ao /api/me sem token antes de pedir o Google');
  ok(/if \(!usarToken && !sessaoPorCookie\(\)\)/.test(authJs),
    'sem token, a requisição segue quando o cookie vale — a trava que o Lote 4 apontou em auth.js:258');
  ok(/isNotDisplayed\(\)/.test(authJs), 'o `renovando` volta a false quando o One Tap não aparece');

} finally {
  duble.kill();
}

console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
