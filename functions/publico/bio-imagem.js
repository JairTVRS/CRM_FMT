/**
 * GET /publico/bio-imagem?vaga=capa&v=3 — a imagem de uma vaga da página
 * pública /bio (2.45.0). Sem login, só leitura, só as vagas da lista fixa.
 *
 * Com `v` igual à versão atual, a resposta fica em cache por um ano: trocar
 * a imagem no CRM sobe a versão, e o endereço novo busca a imagem nova.
 * Com `v` diferente (endereço velho), entrega a atual com cache curto.
 */

import { vagaValida, comoBytes } from '../api/_lib/bio.js';

const naoEncontrada = () => new Response('Imagem não encontrada.', {
  status: 404,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' }
});

export async function onRequestGet(context) {
  const params = new URL(context.request.url).searchParams;
  const vaga = params.get('vaga');
  if (!vagaValida(vaga)) return naoEncontrada();

  let linha = null;
  try {
    linha = await context.env.DB
      .prepare('SELECT imagem, imagem_tipo, versao FROM bio_vagas WHERE vaga = ?')
      .bind(vaga)
      .first();
  } catch (e) {
    return naoEncontrada();
  }

  const bytes = comoBytes(linha?.imagem);
  if (!bytes || !bytes.length || !linha.imagem_tipo) return naoEncontrada();

  const versaoCerta = params.get('v') === String(linha.versao);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': linha.imagem_tipo,
      'Cache-Control': versaoCerta ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
