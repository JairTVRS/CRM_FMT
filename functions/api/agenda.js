/**
 * /api/agenda — a agenda do lead (2.32.0).
 *
 * GET    ?tipos=1                          tipos de reunião do Time Vendas (hub)
 * GET    ?lead_id=N                        tudo de um lead, o mais recente primeiro
 * GET    ?de=AAAA-MM-DD&ate=AAAA-MM-DD     o período da visão Agenda
 *        [&responsavel=email|__sem__] [&busca=texto]
 * POST                                     cria um compromisso
 * PUT    ?id=N                             altera; `remarcar_para` remarca
 * DELETE ?id=N                             exclui (lógica) — para o que foi
 *                                          lançado por engano; o que não
 *                                          aconteceu é "cancelada"
 *
 * A AGENDA DO LEAD MORA NO CRM. Decidido em 28/09/2026: o ERP só entra
 * quando o lead vira cliente, e as reuniões de venda não vão para o
 * Painel de Operações.
 *
 * Toda escrita recalcula `leads.data_proximo_contato` na mesma transação
 * — é ele que o quadro e a ficha mostram como "próximo contato".
 */

import {
  TIPOS, STATUS, LOCAIS, CANAIS, normalizarInicio,
  comandoRecalcularProximo, comandoUltimoContato, usuarioDoCrm, tiposDeVendas
} from './_lib/agenda.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const texto = (v, limite) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, limite) : null;
};

const dataIso = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[0] : null;
};

const SEM_RESPONSAVEL = '__sem__';

/** O que a tela precisa de cada compromisso, com o lead junto. */
const SELECT_ITEM = `
  SELECT a.*, l.nome AS lead_nome, l.documento AS lead_documento,
         l.etapa_id AS lead_etapa_id, l.responsavel AS lead_responsavel
    FROM agenda_lead a
    JOIN leads l ON l.id = a.lead_id`;

/**
 * Monta o compromisso a gravar a partir do corpo, já conferido.
 *
 * @param anterior  o compromisso no banco (edição) ou null (criação)
 * @returns { item } ou { erro }
 */
async function montarItem(db, corpo, anterior, lead, usuario) {
  // O que não veio no corpo fica como estava: mudar só o status não pode
  // apagar a pauta, e remarcar não pode perder o link da sala.
  const v = (campo) => (corpo[campo] !== undefined ? corpo[campo] : anterior?.[campo]);

  const tipo = v('tipo');
  if (!TIPOS.includes(tipo)) return { erro: { error: 'Escolha reunião ou contato.', code: 'TIPO_INVALIDO' } };

  const inicio = normalizarInicio(v('inicio'));
  if (!inicio) return { erro: { error: 'Informe a data e a hora.', code: 'INICIO_INVALIDO' } };

  const status = v('status') ?? 'agendada';
  if (!STATUS.includes(status)) return { erro: { error: 'Status inválido.', code: 'STATUS_INVALIDO' } };

  // Responsável: o da escolha, ou o do lead, ou quem está lançando.
  const pedido = texto(corpo.responsavel, 160)?.toLowerCase() || null;
  const responsavel = pedido
    || anterior?.responsavel
    || lead.responsavel
    || String(usuario.email || '').toLowerCase();
  const jaEra = [anterior?.responsavel, lead.responsavel].includes(responsavel);
  if (pedido && !jaEra && !(await usuarioDoCrm(db, pedido))) {
    return { erro: { error: 'O responsável escolhido não é um usuário do CRM.', code: 'RESPONSAVEL_INVALIDO' } };
  }

  const item = {
    tipo, inicio, status, responsavel,
    participantes: texto(v('participantes'), 500),
    pauta: texto(v('pauta'), 4000),
    duracao_min: null, tipo_reuniao_erp_id: null, tipo_reuniao_nome: null,
    local_tipo: null, local_texto: null, canal: null
  };

  if (tipo === 'reuniao') {
    const duracao = Number(v('duracao_min') ?? 60);
    if (!Number.isInteger(duracao) || duracao < 15 || duracao > 600) {
      return { erro: { error: 'A duração vai de 15 minutos a 10 horas.', code: 'DURACAO_INVALIDA' } };
    }
    const local = v('local_tipo');
    if (!LOCAIS.includes(local)) {
      return { erro: { error: 'Escolha o local: online, presencial ou externo.', code: 'LOCAL_INVALIDO' } };
    }
    Object.assign(item, {
      duracao_min: duracao,
      local_tipo: local,
      local_texto: texto(v('local_texto'), 500),
      tipo_reuniao_erp_id: texto(v('tipo_reuniao_erp_id'), 64),
      // O nome da época: o histórico continua legível se o tipo mudar no hub.
      tipo_reuniao_nome: texto(v('tipo_reuniao_nome'), 120)
    });
  } else {
    const canal = v('canal');
    if (!CANAIS.includes(canal)) {
      return { erro: { error: 'Escolha o canal: ligação, WhatsApp, e-mail ou outro.', code: 'CANAL_INVALIDO' } };
    }
    item.canal = canal;
  }

  return { item };
}

const COLUNAS = [
  'tipo', 'inicio', 'status', 'responsavel', 'participantes', 'pauta',
  'duracao_min', 'tipo_reuniao_erp_id', 'tipo_reuniao_nome',
  'local_tipo', 'local_texto', 'canal'
];

/** Realizada conta como último contato do lead — só a data. */
const ultimoSeRealizada = (db, leadId, item) =>
  item.status === 'realizada' ? [comandoUltimoContato(db, leadId, item.inicio.slice(0, 10))] : [];

async function leadAtivo(db, id) {
  return db.prepare('SELECT id, nome, responsavel FROM leads WHERE id = ? AND ativo = 1').bind(Number(id)).first();
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (searchParams.get('tipos')) {
    try {
      return json(await tiposDeVendas(context.env), 200, cabecalhos);
    } catch (e) {
      // Sem os tipos a agenda funciona — a reunião só fica sem tipo.
      return json({ tipos: [], aviso: `Não foi possível ler os tipos de reunião no hub: ${e.message}` }, 200, cabecalhos);
    }
  }

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    const leadId = Number(searchParams.get('lead_id'));
    if (leadId) {
      const { results } = await db
        .prepare(`${SELECT_ITEM} WHERE a.lead_id = ? AND a.ativo = 1 ORDER BY a.inicio DESC, a.id DESC`)
        .bind(leadId).all();
      return json({ itens: results || [] }, 200, cabecalhos);
    }

    const de = dataIso(searchParams.get('de'));
    const ate = dataIso(searchParams.get('ate'));
    if (!de || !ate || ate < de) {
      return json({ error: 'Informe o período (de, ate).', code: 'PERIODO_INVALIDO' }, 400, cabecalhos);
    }

    // `ate` inclui o dia inteiro: 'AAAA-MM-DDT~' é maior que qualquer hora.
    const condicoes = ['a.ativo = 1', 'l.ativo = 1', 'a.inicio >= ?', 'a.inicio <= ?'];
    const valores = [de, `${ate}T~`];

    const responsavel = texto(searchParams.get('responsavel'), 160);
    if (responsavel === SEM_RESPONSAVEL) condicoes.push('a.responsavel IS NULL');
    else if (responsavel) { condicoes.push('a.responsavel = ?'); valores.push(responsavel.toLowerCase()); }

    const busca = texto(searchParams.get('busca'), 100);
    if (busca) { condicoes.push('l.nome LIKE ?'); valores.push(`%${busca}%`); }

    const { results } = await db
      .prepare(`${SELECT_ITEM} WHERE ${condicoes.join(' AND ')} ORDER BY a.inicio, a.id LIMIT 1000`)
      .bind(...valores).all();
    return json({ itens: results || [] }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao consultar a agenda.', details: e.message }, 500, cabecalhos);
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
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  const lead = await leadAtivo(db, corpo.lead_id);
  if (!lead) return json({ error: 'Escolha o lead.', code: 'LEAD_OBRIGATORIO' }, 400, cabecalhos);

  const { item, erro } = await montarItem(db, corpo, null, lead, usuario);
  if (erro) return json(erro, 400, cabecalhos);

  try {
    const agora = new Date().toISOString();
    const [criado] = await db.batch([
      db.prepare(
        `INSERT INTO agenda_lead (lead_id, ${COLUNAS.join(', ')}, criado_por, criado_em, ativo)
         VALUES (?, ${COLUNAS.map(() => '?').join(', ')}, ?, ?, 1) RETURNING id`
      ).bind(lead.id, ...COLUNAS.map((c) => item[c]), usuario.email, agora),
      comandoRecalcularProximo(db, lead.id),
      ...ultimoSeRealizada(db, lead.id, item)
    ]);

    const id = criado?.results?.[0]?.id ?? criado?.meta?.last_row_id ?? criado?.lastInsertRowid;
    const salvo = await db.prepare(`${SELECT_ITEM} WHERE a.id = ?`).bind(Number(id)).first();
    return json({ item: salvo }, 201, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao salvar na agenda.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   PUT — altera, ou remarca
   ========================================================================== */

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'Compromisso ausente.' }, 400, cabecalhos);

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  const anterior = await db.prepare('SELECT * FROM agenda_lead WHERE id = ? AND ativo = 1').bind(id).first();
  if (!anterior) return json({ error: 'Compromisso não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
  const lead = await leadAtivo(db, anterior.lead_id);
  if (!lead) return json({ error: 'O lead deste compromisso foi excluído.', code: 'LEAD_EXCLUIDO' }, 409, cabecalhos);

  const agora = new Date().toISOString();

  // --- Remarcar: esta vira 'remarcada' e nasce outra na data nova ---
  if (corpo.remarcar_para !== undefined) {
    if (anterior.status !== 'agendada') {
      return json({ error: 'Só um compromisso agendado pode ser remarcado.', code: 'NAO_AGENDADO' }, 409, cabecalhos);
    }
    const { item, erro } = await montarItem(db, { ...corpo, inicio: corpo.remarcar_para, status: 'agendada' }, anterior, lead, usuario);
    if (erro) return json(erro, 400, cabecalhos);

    try {
      const [nova] = await db.batch([
        db.prepare(
          `INSERT INTO agenda_lead (lead_id, ${COLUNAS.join(', ')}, criado_por, criado_em, ativo)
           VALUES (?, ${COLUNAS.map(() => '?').join(', ')}, ?, ?, 1) RETURNING id`
        ).bind(lead.id, ...COLUNAS.map((c) => item[c]), usuario.email, agora),
        db.prepare(
          `UPDATE agenda_lead SET status = 'remarcada', atualizado_por = ?, atualizado_em = ?,
                  remarcada_para_id = (SELECT MAX(id) FROM agenda_lead WHERE lead_id = ?)
            WHERE id = ?`
        ).bind(usuario.email, agora, lead.id, id),
        comandoRecalcularProximo(db, lead.id)
      ]);
      const novaId = nova?.results?.[0]?.id ?? nova?.meta?.last_row_id ?? nova?.lastInsertRowid;
      const salvo = await db.prepare(`${SELECT_ITEM} WHERE a.id = ?`).bind(Number(novaId)).first();
      return json({ item: salvo, remarcado: id }, 200, cabecalhos);
    } catch (e) {
      return json({ error: 'Falha ao remarcar.', details: e.message }, 500, cabecalhos);
    }
  }

  // --- Alteração comum ---
  const { item, erro } = await montarItem(db, corpo, anterior, lead, usuario);
  if (erro) return json(erro, 400, cabecalhos);

  try {
    await db.batch([
      db.prepare(
        `UPDATE agenda_lead SET ${COLUNAS.map((c) => `${c} = ?`).join(', ')},
                atualizado_por = ?, atualizado_em = ?
          WHERE id = ? AND ativo = 1`
      ).bind(...COLUNAS.map((c) => item[c]), usuario.email, agora, id),
      comandoRecalcularProximo(db, lead.id),
      ...ultimoSeRealizada(db, lead.id, item)
    ]);
    const salvo = await db.prepare(`${SELECT_ITEM} WHERE a.id = ?`).bind(id).first();
    return json({ item: salvo }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao salvar na agenda.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   DELETE — lançado por engano
   ========================================================================== */

export async function onRequestDelete(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const id = Number(searchParams.get('id'));
  const anterior = id
    ? await db.prepare('SELECT lead_id FROM agenda_lead WHERE id = ? AND ativo = 1').bind(id).first()
    : null;
  if (!anterior) return json({ error: 'Compromisso não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

  try {
    await db.batch([
      db.prepare('UPDATE agenda_lead SET ativo = 0, atualizado_por = ?, atualizado_em = ? WHERE id = ?')
        .bind(usuario.email, new Date().toISOString(), id),
      comandoRecalcularProximo(db, anterior.lead_id)
    ]);
    return json({ ok: true, id }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao excluir.', details: e.message }, 500, cabecalhos);
  }
}
