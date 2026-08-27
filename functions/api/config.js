/**
 * GET /api/config — rota PÚBLICA (liberada no _middleware.js)
 *
 * Fonte única da versão do sistema.
 *
 * A versão vive no package.json e em mais lugar nenhum. Antes ela estava
 * duplicada numa constante do app.js, num comentário do cabeçalho e na
 * mensagem de commit — e as três divergiram na prática (o rodapé exibia
 * v2.5.22 com o código já em v2.6.1). Agora o frontend pergunta ao
 * servidor, e o servidor lê do arquivo que o npm mantém.
 *
 * Para subir a versão, um comando só:
 *     npm version 2.7.0 --no-git-tag-version
 *
 * O Client ID do Google não é segredo: ele aparece no HTML de qualquer
 * site que use o Login do Google. O que é segredo (HUB_API_KEY, chaves
 * de IA) nunca sai daqui.
 */

import pkg from '../../package.json';

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;

  // CF_PAGES_COMMIT_SHA é injetada pelo Cloudflare Pages em cada build.
  // Útil para saber exatamente qual deploy está no ar quando algo
  // se comporta de forma inesperada.
  const commit = context.env.CF_PAGES_COMMIT_SHA
    ? String(context.env.CF_PAGES_COMMIT_SHA).slice(0, 7)
    : null;

  return new Response(
    JSON.stringify({
      googleClientId: context.env.GOOGLE_CLIENT_ID || null,
      versao: `v${pkg.version}`,
      commit,
      ambiente: context.env.CF_PAGES_BRANCH || null
    }),
    { status: 200, headers: cabecalhos }
  );
}
