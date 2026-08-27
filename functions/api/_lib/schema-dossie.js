/**
 * _lib/schema-dossie.js — O contrato do dossiê.
 *
 * Este arquivo é a fronteira entre FATO e INTERPRETAÇÃO.
 *
 *   `empresa`  — vem da Receita Federal e do site. A IA NUNCA escreve aqui.
 *   `analise`  — vem do modelo. É leitura, opinião, hipótese.
 *
 * O template de renderização consome esta estrutura, e só ela. Se um dia
 * trocarmos de provedor de IA ou mudarmos o layout, o contrato permanece.
 *
 * O validador é deliberadamente tolerante: descarta o que veio errado e
 * segue com o resto. Um dossiê com quatro seções verdadeiras vale mais
 * que uma falha porque o modelo esqueceu um campo.
 */

export const CONFIANCAS = ['alta', 'media', 'baixa'];
export const QUADRANTES = ['forcas', 'atencao', 'oportunidades', 'riscos'];

/* ==========================================================================
   INSTRUÇÃO DE FORMATO PARA O MODELO
   Enviada no prompt. Descreve apenas a parte `analise` — os fatos já
   estão prontos e não passam pelo modelo.
   ========================================================================== */

export const FORMATO_ANALISE = `{
  "historico": "2 a 3 parágrafos em HTML simples (<p>) sobre a trajetória da empresa. Use APENAS os fatos fornecidos e o que o site diz. Se souber pouco, escreva pouco.",
  "estruturaSocietaria": "1 parágrafo em HTML interpretando o quadro societário fornecido (concentração, tempo de sociedade, perfil). NÃO invente nomes ou percentuais.",
  "portfolio": {
    "descricao": "1 parágrafo em HTML sobre o que a empresa oferece, com base no site e no CNAE.",
    "itens": ["produto ou serviço 1", "produto ou serviço 2"]
  },
  "presencaDigital": {
    "descricao": "1 parágrafo em HTML sobre como a empresa se posiciona nos canais digitais.",
    "canais": [{ "nome": "Site institucional", "url": "https://...", "observacao": "o que se observa" }]
  },
  "sinaisTransformacao": [
    { "titulo": "título curto", "descricao": "o que indica", "evidencia": "onde isso aparece nos dados fornecidos" }
  ],
  "hipotesesDores": [
    { "dor": "hipótese de dor do negócio", "fundamento": "por que se supõe isso", "confianca": "alta|media|baixa" }
  ],
  "kpis": [
    { "rotulo": "rótulo curto", "valor": "valor ou faixa", "observacao": "contexto breve" }
  ],
  "momento": { "titulo": "título do momento atual", "descricao": "1 parágrafo em HTML" },
  "radar": {
    "forcas":        [{ "titulo": "...", "descricao": "..." }],
    "atencao":       [{ "titulo": "...", "descricao": "..." }],
    "oportunidades": [{ "titulo": "...", "descricao": "..." }],
    "riscos":        [{ "titulo": "...", "descricao": "..." }]
  },
  "recomendacao": "1 parágrafo em HTML com a abordagem comercial sugerida."
}`;

/* ==========================================================================
   UTILIDADES DE SANEAMENTO
   ========================================================================== */

const TAGS_PERMITIDAS = /<\/?(p|strong|em|b|i|ul|ol|li|br)\s*\/?>/gi;

/**
 * O modelo devolve HTML. Removemos qualquer tag fora da lista branca —
 * o conteúdo vai para dentro de um iframe, mas defesa em profundidade
 * custa pouco e evita surpresa.
 */
function limparHtml(valor, limite = 4000) {
  if (typeof valor !== 'string') return null;

  let t = valor
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/ on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');

  // Remove tags não permitidas, preservando o texto interno
  t = t.replace(/<[^>]+>/g, (tag) => {
    TAGS_PERMITIDAS.lastIndex = 0;
    return TAGS_PERMITIDAS.test(tag) ? tag : '';
  });

  t = t.trim();
  if (!t) return null;
  return t.length > limite ? `${t.slice(0, limite)}…` : t;
}

function texto(valor, limite = 400) {
  if (typeof valor !== 'string') return null;
  const t = valor.replace(/<[^>]+>/g, '').trim();
  if (!t) return null;
  return t.length > limite ? `${t.slice(0, limite)}…` : t;
}

function url(valor) {
  if (typeof valor !== 'string') return null;
  try {
    const u = new URL(valor.trim());
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch (e) {
    return null;
  }
}

function lista(valor, mapear, maximo) {
  if (!Array.isArray(valor)) return [];
  return valor.map(mapear).filter(Boolean).slice(0, maximo);
}

function itemRadar(item) {
  if (!item || typeof item !== 'object') return null;
  const titulo = texto(item.titulo, 120);
  const descricao = texto(item.descricao, 400);
  return titulo ? { titulo, descricao } : null;
}

/* ==========================================================================
   VALIDAÇÃO
   ========================================================================== */

/**
 * Normaliza a resposta do modelo contra o contrato.
 *
 * @returns {{analise: object, avisos: string[], seccoesVazias: string[]}}
 *
 * Nunca lança. Campos inválidos viram null ou lista vazia, e o template
 * simplesmente não renderiza a seção correspondente.
 */
export function validarAnalise(bruto) {
  const avisos = [];
  const vazias = [];

  if (!bruto || typeof bruto !== 'object') {
    return {
      analise: null,
      avisos: ['A resposta do modelo não é um objeto JSON válido.'],
      seccoesVazias: []
    };
  }

  const a = {
    historico: limparHtml(bruto.historico),
    estruturaSocietaria: limparHtml(bruto.estruturaSocietaria, 2000),

    portfolio: {
      descricao: limparHtml(bruto.portfolio?.descricao, 2000),
      itens: lista(bruto.portfolio?.itens, (i) => texto(i, 160), 12)
    },

    presencaDigital: {
      descricao: limparHtml(bruto.presencaDigital?.descricao, 2000),
      canais: lista(
        bruto.presencaDigital?.canais,
        (c) => {
          const nome = texto(c?.nome, 80);
          return nome ? { nome, url: url(c?.url), observacao: texto(c?.observacao, 300) } : null;
        },
        6
      )
    },

    sinaisTransformacao: lista(
      bruto.sinaisTransformacao,
      (s) => {
        const titulo = texto(s?.titulo, 120);
        return titulo
          ? { titulo, descricao: texto(s?.descricao, 500), evidencia: texto(s?.evidencia, 300) }
          : null;
      },
      8
    ),

    hipotesesDores: lista(
      bruto.hipotesesDores,
      (h) => {
        const dor = texto(h?.dor, 200);
        if (!dor) return null;
        const conf = String(h?.confianca || '').toLowerCase();
        return {
          dor,
          fundamento: texto(h?.fundamento, 400),
          confianca: CONFIANCAS.includes(conf) ? conf : 'baixa'
        };
      },
      8
    ),

    kpis: lista(
      bruto.kpis,
      (k) => {
        const rotulo = texto(k?.rotulo, 60);
        const valor = texto(k?.valor, 60);
        return rotulo && valor ? { rotulo, valor, observacao: texto(k?.observacao, 200) } : null;
      },
      8
    ),

    momento: (() => {
      const titulo = texto(bruto.momento?.titulo, 140);
      const descricao = limparHtml(bruto.momento?.descricao, 2000);
      return titulo || descricao ? { titulo, descricao } : null;
    })(),

    radar: QUADRANTES.reduce((acc, q) => {
      acc[q] = lista(bruto.radar?.[q], itemRadar, 6);
      return acc;
    }, {}),

    recomendacao: limparHtml(bruto.recomendacao, 2500)
  };

  // Diagnóstico do que veio vazio — o template omite, mas o log registra.
  if (!a.historico) vazias.push('historico');
  if (!a.estruturaSocietaria) vazias.push('estruturaSocietaria');
  if (!a.portfolio.descricao && a.portfolio.itens.length === 0) vazias.push('portfolio');
  if (!a.presencaDigital.descricao && a.presencaDigital.canais.length === 0) vazias.push('presencaDigital');
  if (a.sinaisTransformacao.length === 0) vazias.push('sinaisTransformacao');
  if (a.hipotesesDores.length === 0) vazias.push('hipotesesDores');
  if (a.kpis.length === 0) vazias.push('kpis');
  if (!a.momento) vazias.push('momento');
  if (QUADRANTES.every((q) => a.radar[q].length === 0)) vazias.push('radar');
  if (!a.recomendacao) vazias.push('recomendacao');

  if (vazias.length >= 6) {
    avisos.push('O modelo devolveu muito pouco conteúdo aproveitável.');
  }

  return { analise: a, avisos, seccoesVazias: vazias };
}

/**
 * Considera-se utilizável um dossiê que tenha ao menos o núcleo
 * da aba 01 e algo da aba 02.
 */
export function analiseUtilizavel(analise) {
  if (!analise) return false;
  const temAba1 = !!(analise.historico || analise.portfolio?.descricao);
  const temAba2 = !!(
    analise.momento ||
    analise.kpis?.length ||
    QUADRANTES.some((q) => analise.radar?.[q]?.length)
  );
  return temAba1 && temAba2;
}

/* ==========================================================================
   MONTAGEM DO DOCUMENTO FINAL
   ========================================================================== */

/**
 * Junta a camada factual com a interpretativa no formato que o
 * template consome — e que fica guardado em `dados_json`.
 */
export function montarDossie({ cnpjDados, siteDados, instagramDados, analise, meta }) {
  return {
    empresa: {
      razaoSocial: cnpjDados?.razaoSocial || meta?.nomeInformado || null,
      nomeFantasia: cnpjDados?.nomeFantasia || null,
      cnpj: cnpjDados?.cnpj || meta?.cnpj || null,
      cnpjFormatado: cnpjDados?.cnpjFormatado || null,
      dataAbertura: cnpjDados?.dataAbertura || null,
      anosDeMercado: cnpjDados?.anosDeMercado ?? null,
      situacao: cnpjDados?.situacao || null,
      naturezaJuridica: cnpjDados?.naturezaJuridica || null,
      porte: cnpjDados?.porte || null,
      capitalSocial: cnpjDados?.capitalSocial ?? null,
      cnaePrincipal: cnpjDados?.cnaePrincipal || null,
      cnaesSecundarios: cnpjDados?.cnaesSecundarios || [],
      endereco: cnpjDados?.endereco || null,
      socios: cnpjDados?.socios || [],
      quantidadeSocios: cnpjDados?.quantidadeSocios ?? null,

      site: siteDados?.paginas?.[0] || meta?.site || null,
      siteTitulo: siteDados?.meta?.titulo || null,
      siteDescricao: siteDados?.meta?.descricao || null,

      instagram: instagramDados?.url || null,
      instagramSeguidores: instagramDados?.seguidores ?? null,
      instagramBio: instagramDados?.bio || null
    },

    analise,

    fontes: {
      cnpj: meta?.fonteCnpj || 'indisponivel',
      site: meta?.fonteSite || 'falha',
      instagram: meta?.fonteInstagram || 'ausente',
      avisos: meta?.avisosFonte || []
    },

    gerado: {
      em: meta?.geradoEm || new Date().toISOString(),
      por: meta?.geradoPor || null,
      provider: meta?.provider || null,
      versao: meta?.versao ?? null
    }
  };
}
