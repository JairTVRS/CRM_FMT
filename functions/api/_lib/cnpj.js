/**
 * _lib/cnpj.js — Camada FACTUAL do dossiê.
 *
 * Busca dados cadastrais reais na Receita Federal, via APIs públicas.
 * Nada aqui passa por modelo de IA: é fato ou não entra.
 *
 * Fontes, em ordem de tentativa:
 *   1. BrasilAPI  — sem token, sem cadastro
 *   2. OpenCNPJ   — sem token, usada quando a primeira falha
 *
 * O resultado é normalizado para um formato único, para que o
 * template do dossiê não precise saber de qual fonte veio.
 */

const FONTES = [
  { nome: 'brasilapi', url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}` },
  { nome: 'opencnpj', url: (c) => `https://api.opencnpj.org/${c}` }
];

const TIMEOUT_MS = 8000;
const TTL_CACHE_DIAS = 30;

/* ==========================================================================
   UTILIDADES
   ========================================================================== */

export function limparCnpj(valor) {
  return String(valor || '').replace(/\D/g, '');
}

export function cnpjValido(valor) {
  const c = limparCnpj(valor);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false; // 00000000000000 e afins

  const calcular = (base, pesoInicial) => {
    let soma = 0;
    let peso = pesoInicial;
    for (const digito of base) {
      soma += Number(digito) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const dv1 = calcular(c.slice(0, 12), 5);
  const dv2 = calcular(c.slice(0, 13), 6);
  return dv1 === Number(c[12]) && dv2 === Number(c[13]);
}

export function formatarCnpj(valor) {
  const c = limparCnpj(valor);
  if (c.length !== 14) return valor;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

function anosEntre(dataIso) {
  if (!dataIso) return null;
  const inicio = new Date(dataIso);
  if (Number.isNaN(inicio.getTime())) return null;
  const diff = Date.now() - inicio.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

async function buscarComTimeout(url) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controle.signal,
      headers: { Accept: 'application/json' }
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ==========================================================================
   NORMALIZAÇÃO
   As duas APIs usam nomes de campo diferentes. Esta função entrega
   sempre a mesma forma, com null onde a fonte não informou.
   ========================================================================== */

function normalizar(bruto, fonte) {
  const socios = (bruto.qsa || bruto.socios || []).map((s) => ({
    nome: s.nome_socio || s.nome || null,
    qualificacao: s.qualificacao_socio || s.qualificacao || null,
    entrada: s.data_entrada_sociedade || s.data_entrada || null,
    faixaEtaria: s.faixa_etaria || null
  })).filter((s) => s.nome);

  const secundarios = (bruto.cnaes_secundarios || bruto.cnaes_secundarias || [])
    .map((c) => ({
      codigo: String(c.codigo || c.code || ''),
      descricao: c.descricao || c.text || null
    }))
    .filter((c) => c.descricao);

  const abertura =
    bruto.data_inicio_atividade || bruto.data_abertura || bruto.abertura || null;

  // As duas APIs divergem no nome de vários campos, e a OpenCNPJ ainda
  // usa grafias alternativas. Cada linha tenta as variantes conhecidas.
  const cnpjBruto = bruto.cnpj || bruto.cnpj_raiz || bruto.estabelecimento?.cnpj || '';

  return {
    cnpj: limparCnpj(cnpjBruto),
    cnpjFormatado: formatarCnpj(cnpjBruto),

    razaoSocial: bruto.razao_social || bruto.nome || bruto.razaoSocial || null,
    nomeFantasia: bruto.nome_fantasia || bruto.fantasia || bruto.nomeFantasia
      || bruto.nome_fantasia_estabelecimento || bruto.estabelecimento?.nome_fantasia || null,

    dataAbertura: abertura,
    anosDeMercado: anosEntre(abertura),

    situacao: bruto.descricao_situacao_cadastral || bruto.situacao || null,
    dataSituacao: bruto.data_situacao_cadastral || bruto.data_situacao || null,

    naturezaJuridica: bruto.natureza_juridica || null,
    porte: bruto.porte || bruto.descricao_porte || bruto.porte_empresa
      || bruto.descricao_porte_empresa || bruto.codigo_porte || null,
    capitalSocial: (() => {
      const v = bruto.capital_social ?? bruto.capitalSocial ?? bruto.capital ?? null;
      if (v == null || v === '') return null;
      // A OpenCNPJ pode devolver string ("100000.00" ou "100.000,00")
      const n = typeof v === 'number'
        ? v
        : Number(String(v).replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    })(),
    simplesNacional: bruto.opcao_pelo_simples ?? null,

    cnaePrincipal: {
      codigo: String(bruto.cnae_fiscal || bruto.cnae_fiscal_principal || '') || null,
      descricao: bruto.cnae_fiscal_descricao || bruto.atividade_principal?.[0]?.text || null
    },
    cnaesSecundarios: secundarios,

    endereco: {
      logradouro: bruto.logradouro || null,
      numero: bruto.numero || null,
      bairro: bruto.bairro || null,
      municipio: bruto.municipio || bruto.cidade || null,
      uf: bruto.uf || bruto.estado || null,
      cep: bruto.cep || null
    },

    contato: {
      telefone: bruto.ddd_telefone_1 || bruto.telefone || null,
      email: bruto.email || null
    },

    socios,
    quantidadeSocios: socios.length,

    _fonte: fonte,
    _buscadoEm: new Date().toISOString()
  };
}

/* ==========================================================================
   CACHE EM D1
   ========================================================================== */

async function lerCache(db, cnpj) {
  if (!db) return null;
  try {
    const linha = await db
      .prepare('SELECT payload_json, fonte, expira_em FROM cache_cnpj WHERE cnpj = ?')
      .bind(cnpj)
      .first();

    if (!linha) return null;
    if (new Date(linha.expira_em) < new Date()) return null;

    return JSON.parse(linha.payload_json);
  } catch (e) {
    return null; // cache nunca deve derrubar a requisição
  }
}

async function gravarCache(db, cnpj, dados) {
  if (!db) return;
  try {
    const agora = new Date();
    const expira = new Date(agora.getTime() + TTL_CACHE_DIAS * 24 * 60 * 60 * 1000);

    await db
      .prepare(
        `INSERT INTO cache_cnpj (cnpj, payload_json, fonte, buscado_em, expira_em)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(cnpj) DO UPDATE SET
           payload_json = excluded.payload_json,
           fonte        = excluded.fonte,
           buscado_em   = excluded.buscado_em,
           expira_em    = excluded.expira_em`
      )
      .bind(cnpj, JSON.stringify(dados), dados._fonte, agora.toISOString(), expira.toISOString())
      .run();
  } catch (e) {
    // Falha de cache é silenciosa: o dado já foi obtido.
  }
}

/* ==========================================================================
   API PÚBLICA DO MÓDULO
   ========================================================================== */

/**
 * Consulta os dados cadastrais de um CNPJ.
 *
 * @param {string} cnpjEntrada  CNPJ com ou sem máscara
 * @param {object} opcoes       { db: D1Database, ignorarCache: boolean }
 * @returns {Promise<{ok: boolean, dados?: object, fonte: string, erro?: string}>}
 *
 * Nunca lança: o dossiê deve conseguir seguir mesmo sem os dados da Receita.
 */
export async function consultarCnpj(cnpjEntrada, opcoes = {}) {
  const cnpj = limparCnpj(cnpjEntrada);

  if (!cnpjValido(cnpj)) {
    return { ok: false, fonte: 'invalido', erro: 'CNPJ inválido ou incompleto.' };
  }

  if (!opcoes.ignorarCache) {
    const cacheado = await lerCache(opcoes.db, cnpj);
    if (cacheado) {
      return { ok: true, dados: cacheado, fonte: `${cacheado._fonte} (cache)` };
    }
  }

  const falhas = [];

  for (const fonte of FONTES) {
    try {
      const resposta = await buscarComTimeout(fonte.url(cnpj));

      if (resposta.status === 404) {
        return { ok: false, fonte: fonte.nome, erro: 'CNPJ não encontrado na Receita Federal.' };
      }
      if (!resposta.ok) {
        falhas.push(`${fonte.nome}: HTTP ${resposta.status}`);
        continue;
      }

      const bruto = await resposta.json();
      const dados = normalizar(bruto, fonte.nome);

      if (!dados.razaoSocial) {
        falhas.push(`${fonte.nome}: resposta sem razão social`);
        continue;
      }

      await gravarCache(opcoes.db, cnpj, dados);
      return { ok: true, dados, fonte: fonte.nome };

    } catch (e) {
      falhas.push(`${fonte.nome}: ${e.name === 'AbortError' ? 'tempo esgotado' : e.message}`);
    }
  }

  return {
    ok: false,
    fonte: 'indisponivel',
    erro: `Não foi possível consultar o CNPJ. ${falhas.join(' | ')}`
  };
}
