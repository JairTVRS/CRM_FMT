/**
 * _lib/site.js — Leitura do site institucional do lead.
 *
 * Busca o HTML da página, extrai o texto útil e devolve um recorte
 * para servir de contexto ao modelo. A IA passa a analisar o que a
 * empresa REALMENTE diz de si, em vez de lembrar do que leu no treino.
 *
 * Também tenta a página "sobre/quem somos", que costuma concentrar
 * histórico e posicionamento — justamente o que a aba 01 pede.
 */

const TIMEOUT_MS = 10000;
const LIMITE_CARACTERES = 8000;
const LIMITE_BYTES_HTML = 2_000_000; // 2 MB: acima disso não é página institucional

const CAMINHOS_SOBRE = ['/sobre', '/quem-somos', '/sobre-nos', '/a-empresa', '/institucional'];

/* ==========================================================================
   EXTRAÇÃO DE TEXTO
   ========================================================================== */

const ENTIDADES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&apos;': "'", '&ndash;': '–',
  '&mdash;': '—', '&hellip;': '…', '&aacute;': 'á', '&eacute;': 'é',
  '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú', '&atilde;': 'ã',
  '&otilde;': 'õ', '&ccedil;': 'ç', '&acirc;': 'â', '&ecirc;': 'ê', '&ocirc;': 'ô'
};

function decodificarEntidades(texto) {
  return texto
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-zA-Z#0-9]+;/g, (e) => ENTIDADES[e.toLowerCase()] ?? e);
}

/**
 * Converte HTML em texto corrido, descartando o que não é conteúdo.
 */
export function htmlParaTexto(html) {
  let t = html;

  // Blocos que nunca contêm conteúdo institucional
  t = t.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  t = t.replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');

  // Quebras onde havia separação visual, para o texto não virar um bloco só
  t = t.replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)\s*>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');

  t = t.replace(/<[^>]+>/g, ' ');
  t = decodificarEntidades(t);

  // Normalização de espaços preservando parágrafos
  t = t.replace(/[ \t\u00a0]+/g, ' ');
  t = t.replace(/\n\s*\n\s*\n+/g, '\n\n');
  t = t.split('\n').map((l) => l.trim()).join('\n');

  return t.trim();
}

/**
 * Extrai os metadados que resumem o posicionamento declarado.
 */
export function extrairMeta(html) {
  const pegar = (regex) => {
    const m = html.match(regex);
    return m ? decodificarEntidades(m[1]).trim() : null;
  };

  return {
    titulo: pegar(/<title[^>]*>([\s\S]*?)<\/title>/i),
    descricao:
      pegar(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      pegar(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i),
    ogTitulo: pegar(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i),
    ogDescricao: pegar(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
  };
}

/* ==========================================================================
   BUSCA
   ========================================================================== */

export function normalizarUrl(entrada) {
  let url = String(entrada || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString();
  } catch (e) {
    return null;
  }
}

async function buscarPagina(url) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(url, {
      signal: controle.signal,
      redirect: 'follow',
      headers: {
        // Alguns servidores recusam requisição sem User-Agent de navegador
        'User-Agent': 'Mozilla/5.0 (compatible; CRM-Formatar/1.0; +https://crm-fmt.pages.dev)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      }
    });

    if (!resposta.ok) return { ok: false, erro: `HTTP ${resposta.status}` };

    const tipo = resposta.headers.get('content-type') || '';
    if (!tipo.includes('html')) return { ok: false, erro: `Conteúdo não é HTML (${tipo})` };

    const tamanho = Number(resposta.headers.get('content-length') || 0);
    if (tamanho > LIMITE_BYTES_HTML) return { ok: false, erro: 'Página grande demais.' };

    const html = await resposta.text();
    if (html.length > LIMITE_BYTES_HTML) return { ok: false, erro: 'Página grande demais.' };

    return { ok: true, html, urlFinal: resposta.url || url };

  } catch (e) {
    return { ok: false, erro: e.name === 'AbortError' ? 'Tempo esgotado.' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/* ==========================================================================
   API PÚBLICA DO MÓDULO
   ========================================================================== */

/**
 * Lê o site do lead e devolve texto pronto para virar contexto da IA.
 *
 * @param {string} siteEntrada  URL com ou sem protocolo
 * @returns {Promise<{ok: boolean, texto?: string, meta?: object, paginas?: string[], erro?: string}>}
 *
 * Nunca lança: site fora do ar não pode impedir a geração do dossiê.
 */
export async function lerSite(siteEntrada) {
  const url = normalizarUrl(siteEntrada);
  if (!url) return { ok: false, erro: 'URL de site ausente ou inválida.' };

  const principal = await buscarPagina(url);
  if (!principal.ok) return { ok: false, erro: principal.erro };

  const meta = extrairMeta(principal.html);
  const partes = [htmlParaTexto(principal.html)];
  const paginas = [principal.urlFinal];

  // Tenta uma página "sobre" — para no primeiro acerto.
  for (const caminho of CAMINHOS_SOBRE) {
    if (partes.join('\n').length >= LIMITE_CARACTERES) break;

    try {
      const alvo = new URL(caminho, principal.urlFinal).toString();
      const extra = await buscarPagina(alvo);
      if (extra.ok) {
        const texto = htmlParaTexto(extra.html);
        if (texto.length > 200) {
          partes.push(`\n\n--- ${caminho} ---\n${texto}`);
          paginas.push(alvo);
          break;
        }
      }
    } catch (e) {
      // caminho inexistente é o caso comum: segue adiante
    }
  }

  let texto = partes.join('\n');
  const truncado = texto.length > LIMITE_CARACTERES;
  if (truncado) texto = `${texto.slice(0, LIMITE_CARACTERES)}\n[...texto truncado...]`;

  if (texto.trim().length < 100) {
    return { ok: false, erro: 'Site sem texto legível (provavelmente renderizado por JavaScript).' };
  }

  return { ok: true, texto, meta, paginas, truncado };
}
