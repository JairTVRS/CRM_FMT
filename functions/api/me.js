/**
 * GET /api/me — quem está logado nesta sessão.
 *
 * Só responde se o _middleware.js já tiver validado o token e confirmado
 * o cadastro ativo no hub. O frontend usa isso para exibir nome/foto e,
 * principalmente, para confirmar que o acesso continua valendo.
 *
 * É também onde a sessão de 7 dias nasce e se renova: o _middleware.js
 * anexa o cookie a esta resposta. `sessao.ate` diz à página até quando
 * ela pode dispensar o token do Google — ou `null`, quando o servidor
 * está sem SESSAO_SECRET e nada foi emitido.
 */
export async function onRequestGet(context) {
  return new Response(
    JSON.stringify({
      usuario: context.data.usuario,
      sessao: { ate: context.data.sessaoAte || null }
    }),
    { status: 200, headers: context.data.cabecalhos }
  );
}
