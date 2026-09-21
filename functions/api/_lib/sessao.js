/**
 * _lib/sessao.js — a sessão de 7 dias, num cookie assinado pelo servidor.
 *
 * POR QUE EXISTE
 *
 * O login do Google entrega um ID token que vive ~1 hora e só existe na
 * memória da página. Recarregar a página o perdia, e o CRM voltava à tela
 * de login a cada F5. Decidido com o usuário em 11/09/2026 (opção B do
 * Lote 4) e pedido de novo em 21/09: a sessão dura 7 dias.
 *
 * COMO
 *
 * Depois que o token do Google é validado, o servidor emite um cookie
 * `crm_sessao` com { email, nome, foto, exp }, assinado com HMAC-SHA-256
 * e o segredo `SESSAO_SECRET`. Nas requisições seguintes o middleware
 * aceita o cookie no lugar do token.
 *
 *   - HttpOnly: o JavaScript da página não lê o cookie.
 *   - Secure, SameSite=Strict, Path=/api: só vai para a API, só em HTTPS,
 *     e nunca numa requisição que nasceu noutro site.
 *   - Sem tabela no banco (stateless). O que preserva a revogação é que
 *     o middleware continua perguntando ao hub se o e-mail está ativo — a
 *     cada 5 minutos, pelo cache que já existia. Quem for desativado no
 *     ERP perde o acesso em até 5 minutos, com ou sem cookie.
 *   - Renovado a cada abertura do CRM (`/api/me`): quem usa todo dia não
 *     sai nunca; quem passa 7 dias sem abrir entra de novo.
 *
 * SEM `SESSAO_SECRET` o CRM funciona como antes: nenhum cookie é emitido
 * nem aceito. A chave é Secret na Cloudflare.
 */

export const NOME_COOKIE = 'crm_sessao';
export const DURACAO_SESSAO_S = 7 * 24 * 60 * 60;

const codificador = new TextEncoder();

function paraBase64Url(bytes) {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(texto) {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function chaveHmac(segredo) {
  return crypto.subtle.importKey(
    'raw', codificador.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

/** Monta o valor do cookie: `<dados>.<assinatura>`, os dois em base64url. */
export async function assinarSessao({ email, nome = null, foto = null }, segredo, agora = Date.now()) {
  const dados = paraBase64Url(codificador.encode(JSON.stringify({
    email, nome, foto, exp: Math.floor(agora / 1000) + DURACAO_SESSAO_S
  })));
  const assinatura = await crypto.subtle.sign('HMAC', await chaveHmac(segredo), codificador.encode(dados));
  return `${dados}.${paraBase64Url(new Uint8Array(assinatura))}`;
}

/** O valor de um cookie pelo nome, do cabeçalho `Cookie`. */
export function lerCookie(cabecalho, nome = NOME_COOKIE) {
  for (const parte of String(cabecalho || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return null;
}

/**
 * Confere a assinatura e a validade. Devolve { email, nome, foto, exp }
 * ou `null` — nunca lança: cookie ruim é só "não há sessão".
 *
 * `crypto.subtle.verify` compara em tempo constante; comparar as strings
 * da assinatura com === vazaria, pelo tempo, quantos bytes acertaram.
 */
export async function lerSessao(valor, segredo, agora = Date.now()) {
  if (!valor || !segredo) return null;
  const [dados, assinatura, sobra] = String(valor).split('.');
  if (!dados || !assinatura || sobra !== undefined) return null;

  try {
    const valida = await crypto.subtle.verify(
      'HMAC', await chaveHmac(segredo), deBase64Url(assinatura), codificador.encode(dados)
    );
    if (!valida) return null;

    const sessao = JSON.parse(new TextDecoder().decode(deBase64Url(dados)));
    if (!sessao?.email || !sessao.exp || sessao.exp * 1000 <= agora) return null;
    return sessao;
  } catch (e) {
    return null;
  }
}

export function cabecalhoDeSessao(valor) {
  return `${NOME_COOKIE}=${valor}; Max-Age=${DURACAO_SESSAO_S}; Path=/api; HttpOnly; Secure; SameSite=Strict`;
}

export function cabecalhoDeSaida() {
  return `${NOME_COOKIE}=; Max-Age=0; Path=/api; HttpOnly; Secure; SameSite=Strict`;
}
