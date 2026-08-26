/**
 * GET /api/me — quem está logado nesta sessão.
 *
 * Só responde se o _middleware.js já tiver validado o token e confirmado
 * o cadastro ativo no hub. O frontend usa isso para exibir nome/foto e,
 * principalmente, para confirmar que o acesso continua valendo.
 */
export async function onRequestGet(context) {
  return new Response(
    JSON.stringify({ usuario: context.data.usuario }),
    { status: 200, headers: context.data.cabecalhos }
  );
}
