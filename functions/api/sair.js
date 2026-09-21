/**
 * POST /api/sair — encerra a sessão de 7 dias.
 *
 * Rota pública no _middleware.js: apagar o cookie tem de funcionar mesmo
 * com a sessão já vencida ou o hub fora do ar. O cookie é HttpOnly, então
 * só o servidor consegue apagá-lo — o botão "Sair" da página não alcança.
 */
import { cabecalhoDeSaida } from './_lib/sessao.js';

export async function onRequestPost(context) {
  const cabecalhos = new Headers(context.data.cabecalhos || { 'Content-Type': 'application/json' });
  cabecalhos.append('Set-Cookie', cabecalhoDeSaida());
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cabecalhos });
}
