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

import { limparCnpj, cnpjValido } from './_lib/cnpj.js';

/**
 * O documento é a identidade do lead: alimenta o contexto da IA e
 * impede duplicidade. Aceita CPF (11) ou CNPJ (14), e ambos passam
 * pelo dígito verificador — checar só o tamanho deixaria passar
 * quase todo erro de digitação.
 */
function cpfValido(valor) {
  const c = String(valor || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;

  const dv = (ate) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(c[i]) * (ate + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function documentoValido(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (d.length === 11) return cpfValido(d);
  if (d.length === 14) return cnpjValido(d);
  return false;
}

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
    canal: texto(corpo.canal, 60),
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
  'canal', 'atendente', 'advisor_id', 'etapa_id',
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

    // --- Listagem paginada ---
    const pagina = Math.max(1, Number(searchParams.get('pagina') || 1));
    const porPagina = Math.min(MAX_POR_PAGINA, Number(searchParams.get('porPagina') || POR_PAGINA));
    const busca = texto(searchParams.get('busca'), 100);
    const ramo = texto(searchParams.get('ramo'), 60);
    const segmento = texto(searchParams.get('segmento'), 60);

    const condicoes = ['ativo = 1'];
    const valores = [];

    if (busca) {
      // Busca por nome, documento ou telefone — o que o campo da tela promete
      condicoes.push('(nome LIKE ? OR documento LIKE ? OR telefone LIKE ?)');
      const curinga = `%${busca}%`;
      const soDigitos = busca.replace(/\D/g, '');
      valores.push(curinga, soDigitos ? `%${soDigitos}%` : curinga, curinga);
    }
    if (ramo) { condicoes.push('ramo = ?'); valores.push(ramo); }
    if (segmento) { condicoes.push('segmento = ?'); valores.push(segmento); }

    const onde = `WHERE ${condicoes.join(' AND ')}`;

    const total = await db
      .prepare(`SELECT COUNT(*) AS n FROM leads ${onde}`)
      .bind(...valores)
      .first();

    const { results } = await db
      .prepare(
        `SELECT * FROM leads ${onde}
         ORDER BY criado_em DESC, id DESC
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

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID do lead ausente.' }, 400, cabecalhos);

  let corpo;
  try {
    corpo = await context.request.json();
  } catch (e) {
    return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos);
  }

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
