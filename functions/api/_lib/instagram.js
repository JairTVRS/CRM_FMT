/**
 * _lib/instagram.js — Presença digital do lead no Instagram.
 *
 * Duas implementações atrás da MESMA interface:
 *
 *   manual     — o consultor cola bio e legendas no modal.  ATIVO HOJE.
 *   graph_api  — Business Discovery da Meta.  Entra quando o app
 *                CRM Formatar (ID 1415964077067177) for aprovado.
 *
 * A troca é por variável de ambiente, sem mexer em quem chama.
 * O campo `origem` acompanha o dado até o dossiê, para que o
 * documento sempre declare de onde veio cada informação.
 *
 * Não há e nunca haverá caminho de scraping aqui: o Instagram
 * bloqueia acesso não autenticado e o risco é banimento da conta.
 */

const GRAPH_VERSAO = 'v21.0';
const TIMEOUT_MS = 10000;
const LIMITE_LEGENDAS = 12;

/* ==========================================================================
   UTILIDADES
   ========================================================================== */

/**
 * Extrai o @usuario de uma URL de perfil ou de um texto solto.
 */
export function extrairUsuario(entrada) {
  const valor = String(entrada || '').trim();
  if (!valor) return null;

  const comUrl = valor.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (comUrl) return comUrl[1].replace(/\/$/, '');

  const arroba = valor.match(/^@?([A-Za-z0-9._]{1,30})$/);
  return arroba ? arroba[1] : null;
}

function resultadoVazio(motivo) {
  return { ok: false, origem: 'ausente', erro: motivo };
}

/* ==========================================================================
   IMPLEMENTAÇÃO 1 — ENTRADA MANUAL
   ========================================================================== */

/**
 * O consultor cola a bio e algumas legendas. Leva segundos e é dado real.
 */
function coletarManual({ perfil, bio, legendas }) {
  const usuario = extrairUsuario(perfil);
  const textoBio = String(bio || '').trim();

  const lista = Array.isArray(legendas)
    ? legendas
    : String(legendas || '').split(/\n{2,}/);

  const legendasLimpas = lista
    .map((l) => String(l).trim())
    .filter((l) => l.length > 10)
    .slice(0, LIMITE_LEGENDAS);

  if (!textoBio && legendasLimpas.length === 0) {
    return resultadoVazio('Nenhum conteúdo de Instagram informado.');
  }

  return {
    ok: true,
    origem: 'manual',
    dados: {
      usuario,
      url: usuario ? `https://www.instagram.com/${usuario}` : null,
      bio: textoBio || null,
      seguidores: null,      // indisponível na entrada manual
      totalPosts: null,
      legendas: legendasLimpas
    },
    aviso: 'Conteúdo informado manualmente pelo consultor; métricas de alcance não disponíveis.'
  };
}

/* ==========================================================================
   IMPLEMENTAÇÃO 2 — GRAPH API (BUSINESS DISCOVERY)
   ========================================================================== */

/**
 * Consulta o perfil de terceiro pela conta Business da Formatar.
 *
 * Requisitos no ambiente:
 *   IG_BUSINESS_ACCOUNT_ID   — ID da conta Instagram da Formatar
 *   INSTAGRAM_ACCESS_TOKEN   — token de Usuário do Sistema (não expira)
 *
 * Limitação da própria Meta: só retorna dados de contas Business ou
 * Creator. Perfil pessoal responde com erro — e nesse caso caímos
 * de volta para o manual, em vez de falhar o dossiê inteiro.
 */
async function coletarGraphApi({ perfil }, env) {
  const usuario = extrairUsuario(perfil);
  if (!usuario) return resultadoVazio('Perfil de Instagram não informado.');

  const contaId = env.IG_BUSINESS_ACCOUNT_ID;
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  if (!contaId || !token) {
    return resultadoVazio('Integração com a Graph API não configurada.');
  }

  const campos =
    `business_discovery.username(${usuario}){` +
    'username,name,biography,website,followers_count,media_count,' +
    `media.limit(${LIMITE_LEGENDAS}){caption,like_count,comments_count,media_type,timestamp,permalink}` +
    '}';

  const url =
    `https://graph.facebook.com/${GRAPH_VERSAO}/${contaId}` +
    `?fields=${encodeURIComponent(campos)}&access_token=${encodeURIComponent(token)}`;

  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(url, { signal: controle.signal });
    const corpo = await resposta.json();

    if (!resposta.ok || corpo.error) {
      const msg = corpo.error?.message || `HTTP ${resposta.status}`;
      // Perfil pessoal, inexistente ou privado
      if (/does not exist|not a business|cannot be found/i.test(msg)) {
        return resultadoVazio('Perfil não é conta Business/Creator ou não foi encontrado.');
      }
      return resultadoVazio(`Graph API: ${msg}`);
    }

    const bd = corpo.business_discovery;
    if (!bd) return resultadoVazio('Graph API não retornou dados do perfil.');

    const legendas = (bd.media?.data || [])
      .map((m) => String(m.caption || '').trim())
      .filter((c) => c.length > 10)
      .slice(0, LIMITE_LEGENDAS);

    return {
      ok: true,
      origem: 'graph_api',
      dados: {
        usuario: bd.username || usuario,
        url: `https://www.instagram.com/${bd.username || usuario}`,
        nome: bd.name || null,
        bio: bd.biography || null,
        website: bd.website || null,
        seguidores: bd.followers_count ?? null,
        totalPosts: bd.media_count ?? null,
        legendas,
        engajamentoRecente: (bd.media?.data || []).slice(0, 6).map((m) => ({
          curtidas: m.like_count ?? null,
          comentarios: m.comments_count ?? null,
          tipo: m.media_type || null,
          data: m.timestamp || null
        }))
      }
    };

  } catch (e) {
    return resultadoVazio(
      e.name === 'AbortError' ? 'Graph API: tempo esgotado.' : `Graph API: ${e.message}`
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ==========================================================================
   API PÚBLICA DO MÓDULO
   ========================================================================== */

/**
 * Coleta a presença digital no Instagram pela fonte configurada.
 *
 * @param {object} entrada  { perfil, bio, legendas }
 * @param {object} env      variáveis de ambiente da Function
 * @returns {Promise<{ok: boolean, origem: string, dados?: object, erro?: string}>}
 *
 * INSTAGRAM_FONTE = 'graph_api' ativa a Meta; qualquer outro valor
 * (ou ausência) mantém a entrada manual.
 */
export async function coletarInstagram(entrada = {}, env = {}) {
  const fonte = env.INSTAGRAM_FONTE === 'graph_api' ? 'graph_api' : 'manual';

  if (fonte === 'graph_api') {
    const resultado = await coletarGraphApi(entrada, env);
    if (resultado.ok) return resultado;

    // Graph API indisponível para este perfil: aproveita o que foi
    // colado manualmente, se houver, em vez de devolver nada.
    const alternativa = coletarManual(entrada);
    if (alternativa.ok) {
      return { ...alternativa, aviso: `${resultado.erro} Usado o conteúdo informado manualmente.` };
    }
    return resultado;
  }

  return coletarManual(entrada);
}
