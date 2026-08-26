/**
 * GET /api/config — rota PÚBLICA (liberada no _middleware.js)
 *
 * Devolve apenas o que o frontend precisa para iniciar o login.
 * O Client ID do Google não é segredo: ele aparece no HTML de qualquer
 * site que use o Login do Google. O que é segredo (HUB_API_KEY, chaves
 * de IA) nunca sai daqui.
 */
export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;

  return new Response(
    JSON.stringify({
      googleClientId: context.env.GOOGLE_CLIENT_ID || null
    }),
    { status: 200, headers: cabecalhos }
  );
}
