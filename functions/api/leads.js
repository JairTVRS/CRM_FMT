/**
 * /api/leads — CRUD dos leads.
 *
 * Autenticação garantida pelo _middleware.js: se chegou aqui, o usuário
 * tem ID token válido e cadastro ativo no hub.
 *
 * GET    ?pagina=1&busca=&ramo=&segmento=   lista paginada
 * GET    ?id=123                            um lead
 * POST                                      cria
 * PUT    ?id=123                            atualiza
 * DELETE ?id=123                            exclui (lógica)
 *
 * Exclusão é lógica (ativo = 0). Histórico comercial não se apaga sem
 * rastro, e um lead excluído por engano precisa ter volta.
 */

import { limparCnpj } from './_lib/cnpj.js';
import { documentoValido } from './_lib/documento.js';

/** Converte "R$ 25.424,00", "25424.00" ou 25424 em centavos. */
function paraCentavos(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return Math.round(valor * 100);

  const limpo = String(valor).replace(/[R$\s]/g, '');
  // Formato brasileiro: ponto separa milhar, vírgula separa decimal
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;

  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Aceita DD/MM/AA, DD/MM/AAAA ou ISO; devolve AAAA-MM-DD. */
function paraDataIso(valor) {
  if (!valor) return null;
  const t = String(valor).trim();

  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (br) {
    const [, d, m, a] = br;
    const ano = a.length === 2 ? `20${a}` : a;
    return `${ano}-${m}-${d}`;
  }

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

const POR_PAGINA = 10;
const MAX_POR_PAGINA = 100;

/* ==========================================================================
   UTILIDADES
   ========================================================================== */

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const texto = (v, limite = 500) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, limite) : null;
};

/**
 * Extrai do corpo apenas os campos conhecidos, já saneados.
 * Ignora qualquer coisa a mais que o cliente mande.
 */
function normalizarLead(corpo) {
  return {
    nome: texto(corpo.nome, 200),
    documento: corpo.documento ? limparCnpj(corpo.documento).slice(0, 14) : null,
    telefone: texto(corpo.telefone, 30),
    origem: texto(corpo.origem, 60),
    observacoes: texto(corpo.observacoes, 4000),

    email: texto(corpo.email, 160),
    contato_nome: texto(corpo.contato_nome, 120),
    cep: texto(corpo.cep, 12),
    cidade: texto(corpo.cidade, 120),
    endereco: texto(corpo.endereco, 300),

    site: texto(corpo.site, 300),
    instagram: texto(corpo.instagram, 300),
    ramo: texto(corpo.ramo, 60),
    segmento: normalizarSegmento(corpo.segmento),
    resumo_ia: texto(corpo.resumo_ia, 20000),

    // --- Funil comercial ---
    // Aceita `origem` como sinônimo de entrada: a ficha da tela nasceu
    // com esse nome e o campo virou `canal` no Lote A. Sem este fallback
    // o valor digitado no formulário era descartado em silêncio.
    canal: texto(corpo.canal ?? corpo.origem, 60),
    classificacao: normalizarClassificacao(corpo.classificacao),
    atendente: texto(corpo.atendente, 160),
    advisor_id: corpo.advisor_id ? Number(corpo.advisor_id) : null,
    etapa_id: corpo.etapa_id ? Number(corpo.etapa_id) : null,

    data_cadastro: paraDataIso(corpo.data_cadastro),
    data_ultimo_contato: paraDataIso(corpo.data_ultimo_contato),
    data_proximo_contato: paraDataIso(corpo.data_proximo_contato),
    data_fechamento: paraDataIso(corpo.data_fechamento),

    valor_proposta: paraCentavos(corpo.valor_proposta),
    valor_diagnostico: paraCentavos(corpo.valor_diagnostico),

    tags: normalizarTags(corpo.tags)
  };
}

/** SERVIÇO (planilha) e SERVIÇOS (sistema) são o mesmo segmento. */
function normalizarSegmento(valor) {
  const t = texto(valor, 60);
  if (!t) return null;
  const mapa = {
    'SERVICO': 'SERVIÇOS', 'SERVIÇO': 'SERVIÇOS', 'SERVICOS': 'SERVIÇOS',
    'INDUSTRIA': 'INDÚSTRIA', 'VAREJO': 'VAREJO', 'ONG': 'ONG'
  };
  const chave = t.toUpperCase();
  return mapa[chave] || t.toUpperCase();
}

/**
 * Classificação é a escala interna de complexidade do projeto, de 1 a 6.
 *
 * Valor fora da faixa vira nulo em vez de recusar o salvamento: é campo
 * opcional, e derrubar a gravação inteira do lead por causa dele seria
 * desproporcional.
 */
function normalizarClassificacao(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

/** Tags chegam como lista de IDs; guardamos JSON com números. */
function normalizarTags(valor) {
  if (!Array.isArray(valor)) return '[]';
  const ids = [...new Set(
    valor.map(Number).filter((n) => Number.isInteger(n) && n > 0)
  )].slice(0, 20);
  return JSON.stringify(ids);
}

const CAMPOS = [
  'nome', 'documento', 'telefone', 'observacoes',
  'email', 'contato_nome', 'cep', 'cidade', 'endereco',
  'site', 'instagram', 'ramo', 'segmento', 'resumo_ia',
  'canal', 'classificacao', 'atendente', 'advisor_id', 'etapa_id',
  'data_cadastro', 'data_ultimo_contato', 'data_proximo_contato', 'data_fechamento',
  'valor_proposta', 'valor_diagnostico', 'tags'
];

/**
 * Nome e documento são obrigatórios. O documento é a identidade do
 * lead — alimenta o contexto da IA no dossiê e é o que impede
 * duplicidade — então precisa ser um CPF ou CNPJ válido de verdade,
 * não apenas um número com a quantidade certa de dígitos.
 */
function validarObrigatorios(lead) {
  if (!lead.nome) {
    return { error: 'O nome ou razão social é obrigatório.', code: 'NOME_OBRIGATORIO' };
  }
  if (!lead.documento) {
    return {
      error: 'Informe o CNPJ ou CPF. Ele identifica o lead e serve de contexto para a inteligência comercial.',
      code: 'DOCUMENTO_OBRIGATORIO'
    };
  }
  if (!documentoValido(lead.documento)) {
    return {
      error: 'O CNPJ ou CPF informado é inválido. Confira os números.',
      code: 'DOCUMENTO_INVALIDO'
    };
  }
  return null;
}

/**
 * Monta o WHERE compartilhado pela listagem e pelo quadro.
 *
 * As duas telas oferecem os mesmos filtros, e alternar entre tabela e
 * quadro não pode mudar o conjunto de leads exibido. Uma função só
 * garante isso — duas cópias divergiriam na primeira manutenção.
 */
function montarFiltro(searchParams) {
  const condicoes = ['ativo = 1'];
  const valores = [];

  const busca = texto(searchParams.get('busca'), 100);
  const ramo = texto(searchParams.get('ramo'), 60);
  const segmento = texto(searchParams.get('segmento'), 60);
  const canal = texto(searchParams.get('canal'), 60);
  const classificacao = normalizarClassificacao(searchParams.get('classificacao'));
  const etapaId = Number(searchParams.get('etapa_id')) || null;

  if (busca) {
    // Busca por nome, documento ou telefone — o que o campo da tela promete
    condicoes.push('(nome LIKE ? OR documento LIKE ? OR telefone LIKE ?)');
    const curinga = `%${busca}%`;
    const soDigitos = busca.replace(/\D/g, '');
    valores.push(curinga, soDigitos ? `%${soDigitos}%` : curinga, curinga);
  }
  if (ramo) { condicoes.push('ramo = ?'); valores.push(ramo); }
  if (segmento) { condicoes.push('segmento = ?'); valores.push(segmento); }
  // Leads anteriores ao Lote A guardaram o valor em `origem`. Filtrar só
  // por `canal` esconderia justamente os mais antigos da base.
  if (canal) { condicoes.push('COALESCE(canal, origem) = ?'); valores.push(canal); }
  if (classificacao) { condicoes.push('classificacao = ?'); valores.push(classificacao); }
  if (etapaId) { condicoes.push('etapa_id = ?'); valores.push(etapaId); }

  return { onde: `WHERE ${condicoes.join(' AND ')}`, valores };
}

/**
 * Monta o quadro inteiro em duas consultas, não uma por coluna.
 *
 * Os cartões saem por ROW_NUMBER() particionado pela etapa: assim o teto
 * por coluna é aplicado no banco, e uma coluna com centenas de leads não
 * trafega inteira só para o navegador jogar fora o excedente. Os totais
 * vêm à parte porque precisam contar TUDO, não só o que é exibido.
 *
 * Lead sem etapa cai na primeira coluna. Não deveria existir — a 004
 * preencheu todos e a exclusão de etapa em uso é bloqueada —, mas um
 * cartão invisível seria pior que um cartão no lugar errado.
 */
async function montarQuadro(db, searchParams) {
  const pipeline = texto(searchParams.get('pipeline'), 30) || 'comercial';
  const porColuna = Math.min(200, Math.max(1, Number(searchParams.get('porColuna') || 50)));
  const { onde, valores } = montarFiltro(searchParams);

  const [etapas, totais, cartoes] = await Promise.all([
    db.prepare(
      `SELECT id, nome, cor, ordem, encerra FROM etapas
       WHERE ativo = 1 AND pipeline = ? ORDER BY ordem`
    ).bind(pipeline).all(),

    db.prepare(
      `SELECT etapa_id, COUNT(*) AS n, COALESCE(SUM(valor_proposta), 0) AS soma
       FROM leads ${onde} GROUP BY etapa_id`
    ).bind(...valores).all(),

    db.prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY etapa_id ORDER BY posicao, id DESC
         ) AS rn
         FROM leads ${onde}
       ) WHERE rn <= ?`
    ).bind(...valores, porColuna).all()
  ]);

  const listaEtapas = etapas.results || [];
  const primeira = listaEtapas[0]?.id ?? null;
  const daEtapa = (v) => (v == null ? primeira : v);

  const resumo = new Map();
  for (const t of totais.results || []) {
    const chave = daEtapa(t.etapa_id);
    const atual = resumo.get(chave) || { total: 0, soma: 0 };
    resumo.set(chave, { total: atual.total + Number(t.n || 0), soma: atual.soma + Number(t.soma || 0) });
  }

  const porEtapa = new Map();
  for (const lead of cartoes.results || []) {
    const chave = daEtapa(lead.etapa_id);
    if (!porEtapa.has(chave)) porEtapa.set(chave, []);
    porEtapa.get(chave).push(lead);
  }

  return {
    pipeline,
    porColuna,
    colunas: listaEtapas.map((etapa) => {
      const r = resumo.get(etapa.id) || { total: 0, soma: 0 };
      return {
        etapa,
        total: r.total,
        soma: r.soma,          // centavos; a tela é que formata
        leads: porEtapa.get(etapa.id) || []
      };
    })
  };
}

function erroDeBanco(e) {
  const msg = String(e?.message || '');
  if (/UNIQUE.*documento|idx_leads_documento_unico/i.test(msg)) {
    return { codigo: 'DUPLICADO', mensagem: 'Já existe um lead ativo com este CNPJ/CPF.' };
  }
  return null;
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const { searchParams } = new URL(context.request.url);
  const db = context.env.DB;

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    // --- Um lead específico ---
    const id = searchParams.get('id');
    if (id) {
      const lead = await db
        .prepare('SELECT * FROM leads WHERE id = ? AND ativo = 1')
        .bind(Number(id))
        .first();

      if (!lead) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
      return json({ lead }, 200, cabecalhos);
    }

    // --- Canais em uso, para montar o filtro ---
    //
    // A lista sai do banco, não de um enum fixo na tela: a importação de
    // planilha aceita qualquer texto no canal, e um enum deixaria leads
    // fora do filtro sem que ninguém percebesse.
    if (searchParams.get('canais')) {
      const { results } = await db
        .prepare(
          `SELECT DISTINCT COALESCE(canal, origem) AS canal FROM leads
           WHERE ativo = 1 AND COALESCE(canal, origem) IS NOT NULL
             AND TRIM(COALESCE(canal, origem)) <> ''
           ORDER BY 1 COLLATE NOCASE`
        )
        .all();
      return json({ canais: (results || []).map((r) => r.canal) }, 200, cabecalhos);
    }

    // --- Quadro: todas as colunas de uma vez ---
    if (searchParams.get('quadro')) {
      return json(await montarQuadro(db, searchParams), 200, cabecalhos);
    }

    // --- Listagem paginada ---
    // Também serve ao "carregar mais" de uma coluna do quadro, que passa
    // etapa_id e pagina.
    const pagina = Math.max(1, Number(searchParams.get('pagina') || 1));
    const porPagina = Math.min(MAX_POR_PAGINA, Number(searchParams.get('porPagina') || POR_PAGINA));
    const { onde, valores } = montarFiltro(searchParams);

    // No quadro a ordem é a da coluna; na tabela, a cronológica
    const ordenacao = searchParams.get('etapa_id')
      ? 'posicao, id DESC'
      : 'criado_em DESC, id DESC';

    const total = await db
      .prepare(`SELECT COUNT(*) AS n FROM leads ${onde}`)
      .bind(...valores)
      .first();

    const { results } = await db
      .prepare(
        `SELECT * FROM leads ${onde}
         ORDER BY ${ordenacao}
         LIMIT ? OFFSET ?`
      )
      .bind(...valores, porPagina, (pagina - 1) * porPagina)
      .all();

    const totalRegistros = Number(total?.n || 0);

    return json({
      leads: results || [],
      total: totalRegistros,
      pagina,
      porPagina,
      totalPaginas: Math.max(1, Math.ceil(totalRegistros / porPagina))
    }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao consultar os leads.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — cria
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  let corpo;
  try {
    corpo = await context.request.json();
  } catch (e) {
    return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos);
  }

  const lead = normalizarLead(corpo);

  const invalido = validarObrigatorios(lead);
  if (invalido) return json(invalido, 400, cabecalhos);

  const agora = new Date().toISOString();

  // Sem etapa informada, entra na primeira coluna do funil
  if (!lead.etapa_id) {
    const primeira = await db
      .prepare('SELECT id FROM etapas WHERE ativo = 1 ORDER BY ordem LIMIT 1')
      .first();
    lead.etapa_id = primeira?.id || null;
  }
  if (!lead.data_cadastro) lead.data_cadastro = agora.slice(0, 10);
  if (!lead.atendente) lead.atendente = usuario.email;

  try {
    const marcadores = CAMPOS.map(() => '?').join(', ');
    const resultado = await db
      .prepare(
        `INSERT INTO leads (${CAMPOS.join(', ')}, criado_por, criado_em, ativo)
         VALUES (${marcadores}, ?, ?, 1)
         RETURNING *`
      )
      .bind(...CAMPOS.map((c) => lead[c]), usuario.email, agora)
      .first();

    console.log(`[leads] criado ${resultado.id} por ${usuario.email}`);
    return json({ lead: resultado }, 201, cabecalhos);

  } catch (e) {
    const conhecido = erroDeBanco(e);
    if (conhecido) {
      // Devolve o lead existente para a tela poder oferecer abrir em vez de criar
      const existente = await db
        .prepare('SELECT id, nome, documento FROM leads WHERE documento = ? AND ativo = 1')
        .bind(lead.documento)
        .first();
      return json({ error: conhecido.mensagem, code: conhecido.codigo, existente }, 409, cabecalhos);
    }
    return json({ error: 'Falha ao salvar o lead.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   PUT — atualiza
   ========================================================================== */

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  let corpo;
  try {
    corpo = await context.request.json();
  } catch (e) {
    return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos);
  }

  // --- Mover cartão no quadro ---
  //
  // Vem ANTES da checagem de id porque a operação afeta a coluna inteira,
  // não um lead só. Uma chamada por soltar, não uma por cartão.
  //
  // Só a coluna de destino é regravada. A de origem fica com um buraco na
  // sequência de `posicao` — e um buraco é inofensivo, já que a ordenação
  // é relativa. Regravar as duas dobraria a escrita para nada.
  if (searchParams.get('mover')) {
    const idMovido = Number(corpo.id);
    const etapaId = Number(corpo.etapa_id);
    const ordem = Array.isArray(corpo.ordem) ? corpo.ordem.map(Number).filter(Number.isInteger) : [];

    if (!idMovido || !etapaId) {
      return json({ error: 'Informe o lead e a etapa de destino.' }, 400, cabecalhos);
    }
    if (ordem.length > 500) {
      return json({ error: 'Coluna grande demais para reordenar de uma vez.' }, 400, cabecalhos);
    }

    try {
      const agora = new Date().toISOString();
      const comandos = [
        db.prepare(
          `UPDATE leads SET etapa_id = ?, atualizado_por = ?, atualizado_em = ?
           WHERE id = ? AND ativo = 1`
        ).bind(etapaId, usuario.email, agora, idMovido),

        // Os cartões que a tela não carregou vão para o fim da coluna.
        //
        // Sem isto, a reordenação só valeria dentro do teto por coluna: os
        // visíveis receberiam 0..n-1 e os demais continuariam em 0,
        // embaralhando-se com eles na próxima leitura. "O que não coube na
        // tela vem depois do que você arrumou" é previsível; interleaving
        // silencioso não é.
        db.prepare(
          `UPDATE leads SET posicao = 100000
           WHERE etapa_id = ? AND ativo = 1
             AND id NOT IN (SELECT value FROM json_each(?))`
        ).bind(etapaId, JSON.stringify(ordem)),

        ...ordem.map((idLead, i) =>
          db.prepare('UPDATE leads SET posicao = ? WHERE id = ? AND ativo = 1').bind(i, idLead)
        )
      ];
      await db.batch(comandos);

      console.log(`[leads] movido ${idMovido} para etapa ${etapaId} por ${usuario.email}`);
      return json({ ok: true }, 200, cabecalhos);
    } catch (e) {
      return json({ error: 'Falha ao mover o lead.', details: e.message }, 500, cabecalhos);
    }
  }

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID do lead ausente.' }, 400, cabecalhos);

  const lead = normalizarLead(corpo);

  const invalido = validarObrigatorios(lead);
  if (invalido) return json(invalido, 400, cabecalhos);

  try {
    const atribuicoes = CAMPOS.map((c) => `${c} = ?`).join(', ');
    const resultado = await db
      .prepare(
        `UPDATE leads SET ${atribuicoes}, atualizado_por = ?, atualizado_em = ?
         WHERE id = ? AND ativo = 1
         RETURNING *`
      )
      .bind(...CAMPOS.map((c) => lead[c]), usuario.email, new Date().toISOString(), id)
      .first();

    if (!resultado) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

    console.log(`[leads] atualizado ${id} por ${usuario.email}`);
    return json({ lead: resultado }, 200, cabecalhos);

  } catch (e) {
    const conhecido = erroDeBanco(e);
    if (conhecido) return json({ error: conhecido.mensagem, code: conhecido.codigo }, 409, cabecalhos);
    return json({ error: 'Falha ao atualizar o lead.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   DELETE — exclusão lógica
   ========================================================================== */

export async function onRequestDelete(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID do lead ausente.' }, 400, cabecalhos);

  try {
    const resultado = await db
      .prepare(
        `UPDATE leads SET ativo = 0, atualizado_por = ?, atualizado_em = ?
         WHERE id = ? AND ativo = 1
         RETURNING id, nome`
      )
      .bind(usuario.email, new Date().toISOString(), id)
      .first();

    if (!resultado) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

    console.log(`[leads] excluido ${id} por ${usuario.email}`);
    return json({ ok: true, id: resultado.id }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao excluir o lead.', details: e.message }, 500, cabecalhos);
  }
}
