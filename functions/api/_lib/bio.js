/**
 * _lib/bio.js — a página pública /bio (2.45.0).
 *
 * Três coisas que a API do CRM (/api/bio, com login) e as rotas públicas
 * (/publico/bio, /publico/bio-imagem, sem login) dividem:
 *
 *   1. As VAGAS: os lugares de imagem da página. Só estes nomes existem;
 *      qualquer outro é recusado — a rota pública nunca lê vaga arbitrária.
 *   2. A conferência da IMAGEM: o tipo sai dos primeiros bytes do arquivo,
 *      não do que o navegador disse. Só JPEG, PNG e WebP: SVG fica de fora
 *      porque carrega script.
 *   3. Os VÍDEOS do YouTube, do feed público do canal (sem chave de API).
 */

/** Os lugares de imagem. `link`: a vaga aceita um endereço junto. */
export const VAGAS = {
  'avatar':    { rotulo: 'Foto do perfil (avatar)', link: false },
  'capa':      { rotulo: 'Capa do topo',            link: false },
  'solucao-1': { rotulo: 'Solução: Consultoria e Assessoria',           link: true },
  'solucao-2': { rotulo: 'Solução: Famílias, sociedade e governança',   link: true },
  'solucao-3': { rotulo: 'Solução: Serviços técnicos e especializados', link: true },
  'post-1':    { rotulo: 'Postagem 1', link: true },
  'post-2':    { rotulo: 'Postagem 2', link: true },
  'post-3':    { rotulo: 'Postagem 3', link: true },
  'post-4':    { rotulo: 'Postagem 4', link: true },
  'post-5':    { rotulo: 'Postagem 5', link: true },
  'post-6':    { rotulo: 'Postagem 6', link: true }
};

export const vagaValida = (vaga) => Object.prototype.hasOwnProperty.call(VAGAS, vaga || '');

/** Acima disto a API recusa. O navegador já reduz e comprime antes. */
export const LIMITE_IMAGEM_BYTES = 900 * 1024;

const LIMITE_LINK = 500;

/** O tipo pelo conteúdo. `null` quando não é JPEG, PNG nem WebP. */
export function tipoDaImagem(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  const ascii = (i, n) => String.fromCharCode(...bytes.slice(i, i + n));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/** "data:image/webp;base64,AAAA" (ou só o base64) → bytes. `null` se malformado. */
export function bytesDoDataUrl(texto) {
  if (typeof texto !== 'string' || !texto) return null;
  const base64 = texto.startsWith('data:') ? texto.slice(texto.indexOf(',') + 1) : texto;
  try {
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  } catch (e) {
    return null;
  }
}

/**
 * O link de uma vaga: vazio vira `null` (sem link); fora isso, só https.
 * Devolve `{ link }` ou `{ erro }`.
 */
export function normalizarLink(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return { link: null };
  if (texto.length > LIMITE_LINK) return { erro: 'O link é longo demais.' };
  let url;
  try { url = new URL(texto); } catch (e) { return { erro: 'O link não é um endereço válido. Comece com https://' }; }
  if (url.protocol !== 'https:') return { erro: 'O link precisa começar com https://' };
  return { link: url.toString() };
}

/** D1 devolve BLOB como ArrayBuffer ou como lista de números; o node:sqlite, Uint8Array. */
export const comoBytes = (valor) => (valor == null ? null : new Uint8Array(valor));

/* ==========================================================================
   VÍDEOS DO YOUTUBE
   O feed público do canal traz os 15 últimos, com código, título e data.
   O código do canal foi conferido em 23/11/2026 a partir do
   @formatar.gestaoegovernanca.
   ========================================================================== */

export const YOUTUBE_CANAL_ID = 'UCtQ8OcizsjatsDHyW9pn2HQ';
export const YOUTUBE_FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CANAL_ID}`;
const VIDEOS_NA_PAGINA = 6;

const desfazerEntidades = (t) => t
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** O XML do feed → [{ id, titulo, publicado }], do mais novo para o mais antigo. */
export function lerFeedDoYoutube(xml) {
  const videos = [];
  for (const [, entrada] of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = entrada.match(/<yt:videoId>([\w-]{6,20})<\/yt:videoId>/)?.[1];
    const titulo = entrada.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const publicado = entrada.match(/<published>([^<]+)<\/published>/)?.[1];
    if (id && titulo) videos.push({ id, titulo: desfazerEntidades(titulo.trim()), publicado: publicado || null });
  }
  return videos.slice(0, VIDEOS_NA_PAGINA);
}

/**
 * Os últimos vídeos. O feed é lido no máximo uma vez por hora (cache da
 * Cloudflare); se o YouTube falhar, a página só não mostra a seção.
 */
export async function buscarVideos({ buscar = fetch, cache = globalThis.caches?.default } = {}) {
  try {
    let resposta = cache ? await cache.match(YOUTUBE_FEED) : null;
    if (!resposta) {
      const nova = await buscar(YOUTUBE_FEED, { signal: AbortSignal.timeout(5000) });
      if (!nova.ok) return [];
      const texto = await nova.text();
      resposta = new Response(texto, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } });
      if (cache) await cache.put(YOUTUBE_FEED, resposta.clone());
    }
    return lerFeedDoYoutube(await resposta.text());
  } catch (e) {
    return [];
  }
}
