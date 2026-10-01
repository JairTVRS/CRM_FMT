/**
 * /api/agenda — a agenda do lead (2.32.0).
 *
 * GET    ?tipos=1                          tipos de reunião do Time Vendas (hub)
 * GET    ?lead_id=N                        tudo de um lead, o mais recente primeiro
 * GET    ?de=AAAA-MM-DD&ate=AAAA-MM-DD     o período da visão Agenda
 *        [&responsavel=email|__sem__] [&busca=texto]
 * GET    ?em_andamento=1                   a reunião que EU iniciei e não finalizei
 * GET    ?eventos=N                        o histórico do compromisso (2.36.5)
 * POST                                     cria um compromisso
 * PUT    ?id=N                             altera; `remarcar_para` remarca
 * PUT    ?id=N { acao: 'iniciar' }         a reunião começa agora (2.36.0)
 * PUT    ?id=N { acao: 'finalizar' }       a reunião termina agora e vira realizada
 * PUT    ?id=N { acao: 'cancelar', motivo, observacao }
 *                                          cancela com um dos motivos do ERP (2.36.2)
 * PUT    ?id=N { acao: 'resetar' }         volta a ser só agendada (2.36.4)
 * DELETE ?id=N                             exclui (lógica) — para o que foi
 *                                          lançado por engano; o que não
 *                                          aconteceu é "cancelada"
 *
 * INICIAR E FINALIZAR (2.36.0, pedido de 30/09/2026): a reunião só vira
 * "realizada" quando o CX a finaliza, e o CRM guarda a hora real de
 * início e de fim. Cada pessoa tem no máximo UMA reunião em andamento —
 * a API confere e o índice da migração 021 garante.
 *
 * A AGENDA DO LEAD MORA NO CRM. Decidido em 28/09/2026: o ERP só entra
 * quando o lead vira cliente, e as reuniões de venda não vão para o
 * Painel de Operações.
 *
 * Toda escrita grava o seu evento em `agenda_eventos` (2.36.5, migração
 * 023) no mesmo lote: quem, quando e o que mudou.
 *
 * Toda escrita recalcula `leads.data_proximo_contato` na mesma transação
 * — é ele que o quadro e a ficha mostram como "próximo contato".
 */

import {
  TIPOS, STATUS, LOCAIS, CANAIS, normalizarInicio,
  comandoRecalcularProximo, comandoUltimoContato, usuarioDoCrm, tiposDeVendas,
  emAndamento, diaEmBrasilia, MOTIVOS_CANCELAMENTO,
  mudancas, comandoEvento, comandoEventoDoNovo
} from './_lib/agenda.js';
import { avaliarAdmin } from './_lib/admin.js';

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
  // Reunião vira realizada por "Finalizar" (2.36.0), que guarda a hora de
  // início e de fim. Escolher "Realizada" na lista pularia os dois.
  if (tipo === 'reuniao' && status === 'realizada' && anterior?.status !== 'realizada') {
    return { erro: { error: 'Reunião vira realizada ao ser finalizada: use "Iniciar reunião" e depois "Finalizar".', code: 'REALIZADA_SO_FINALIZANDO' } };
  }
  // A situação é automática (2.36.3): o que já se encerrou (realizado,
  // cancelado, remarcado, não compareceu) não volta nem troca de situação.
  if (anterior && status !== anterior.status && anterior.status !== 'agendada') {
    return { erro: { error: 'Este compromisso já foi encerrado; a situação dele não muda mais.', code: 'JA_ENCERRADO' } };
  }
  // Cancelar pede o motivo (2.36.2): só pelo botão "Cancelar".
  if (status === 'cancelada' && anterior?.status !== 'cancelada') {
    return { erro: { error: 'Para cancelar, use o botão "Cancelar" e escolha o motivo.', code: 'CANCELAR_COM_MOTIVO' } };
  }

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

  // O motivo do cancelamento só vale enquanto a situação for "cancelada":
  // voltar para outra apaga os quatro campos.
  const cancelada = status === 'cancelada';
  const item = {
    tipo, inicio, status, responsavel,
    participantes: texto(v('participantes'), 500),
    pauta: texto(v('pauta'), 4000),
    duracao_min: null, tipo_reuniao_erp_id: null, tipo_reuniao_nome: null,
    local_tipo: null, local_texto: null, canal: null,
    cancelamento_motivo: cancelada ? anterior?.cancelamento_motivo ?? null : null,
    cancelamento_obs: cancelada ? anterior?.cancelamento_obs ?? null : null,
    cancelada_em: cancelada ? anterior?.cancelada_em ?? null : null,
    cancelada_por: cancelada ? anterior?.cancelada_por ?? null : null
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
  'local_tipo', 'local_texto', 'canal',
  'cancelamento_motivo', 'cancelamento_obs', 'cancelada_em', 'cancelada_por'
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
    if (searchParams.get('em_andamento')) {
      const usuario = context.data.usuario;
      return json({ item: await emAndamento(db, usuario.email, SELECT_ITEM) }, 200, cabecalhos);
    }

    const doHistorico = Number(searchParams.get('eventos'));
    if (doHistorico) return json(await historico(db, doHistorico), 200, cabecalhos);

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
      ...ultimoSeRealizada(db, lead.id, item),
      comandoEventoDoNovo(db, { leadId: lead.id, evento: 'criada', por: usuario.email, em: agora })
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

  if (corpo.acao === 'iniciar') return iniciar(context, anterior, lead, agora);
  if (corpo.acao === 'finalizar') return finalizar(context, anterior, lead, agora);
  if (corpo.acao === 'cancelar') return cancelar(context, anterior, lead, agora, corpo);
  if (corpo.acao === 'resetar') return resetar(context, anterior, lead, agora);
  if (corpo.acao !== undefined) return json({ error: 'Ação desconhecida.', code: 'ACAO_INVALIDA' }, 400, cabecalhos);

  // Em andamento, a reunião só termina finalizando: remarcar, cancelar ou
  // mudar a situação deixaria a hora de início sem fim.
  const andando = anterior.iniciada_em && !anterior.finalizada_em;
  if (andando && (corpo.remarcar_para !== undefined || (corpo.status !== undefined && corpo.status !== anterior.status))) {
    return json({ error: 'A reunião está em andamento. Finalize-a antes de mudar a situação.', code: 'EM_ANDAMENTO' }, 409, cabecalhos);
  }

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
        comandoRecalcularProximo(db, lead.id),
        // As duas pontas: esta diz para onde foi; a nova, de onde veio.
        comandoEvento(db, { agendaId: id, leadId: lead.id, evento: 'remarcada', detalhe: { para: item.inicio }, por: usuario.email, em: agora }),
        comandoEventoDoNovo(db, { leadId: lead.id, evento: 'criada', detalhe: { remarcada_de: id, de_inicio: anterior.inicio }, por: usuario.email, em: agora })
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
  // Salvar sem mudar nada não vira evento.
  const mudou = mudancas(anterior, item);

  try {
    await db.batch([
      db.prepare(
        `UPDATE agenda_lead SET ${COLUNAS.map((c) => `${c} = ?`).join(', ')},
                atualizado_por = ?, atualizado_em = ?
          WHERE id = ? AND ativo = 1`
      ).bind(...COLUNAS.map((c) => item[c]), usuario.email, agora, id),
      comandoRecalcularProximo(db, lead.id),
      ...ultimoSeRealizada(db, lead.id, item),
      ...(mudou.length
        ? [comandoEvento(db, { agendaId: id, leadId: lead.id, evento: 'alterada', detalhe: { mudancas: mudou }, por: usuario.email, em: agora })]
        : [])
    ]);
    const salvo = await db.prepare(`${SELECT_ITEM} WHERE a.id = ?`).bind(id).first();
    return json({ item: salvo }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao salvar na agenda.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   INICIAR e FINALIZAR a reunião (2.36.0)
   ========================================================================== */

/** D1 devolve `meta.changes`; o SQLite das provas, `changes`. */
const alteradas = (r) => Number(r?.meta?.changes ?? r?.changes ?? 0);

async function iniciar(context, anterior, lead, agora) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const eu = String(context.data.usuario.email || '').toLowerCase();

  if (anterior.tipo !== 'reuniao') {
    return json({ error: 'Só reunião se inicia — contato não.', code: 'NAO_E_REUNIAO' }, 400, cabecalhos);
  }
  if (anterior.iniciada_em) {
    return json({ error: anterior.finalizada_em ? 'Esta reunião já foi realizada.' : 'Esta reunião já está em andamento.', code: 'JA_INICIADA' }, 409, cabecalhos);
  }
  if (anterior.status !== 'agendada') {
    return json({ error: 'Só uma reunião agendada pode ser iniciada.', code: 'NAO_AGENDADO' }, 409, cabecalhos);
  }

  // A conferência e a gravação num comando só: duas abas iniciando ao
  // mesmo tempo não passam as duas. O índice da 021 segura o resto.
  let resultado;
  try {
    resultado = await db.prepare(
      `UPDATE agenda_lead SET iniciada_em = ?, iniciada_por = ?, atualizado_por = ?, atualizado_em = ?
        WHERE id = ? AND ativo = 1 AND iniciada_em IS NULL AND status = 'agendada'
          AND NOT EXISTS (SELECT 1 FROM agenda_lead o
                           WHERE o.iniciada_por = ? AND o.iniciada_em IS NOT NULL
                             AND o.finalizada_em IS NULL AND o.ativo = 1)`
    ).bind(agora, eu, eu, agora, anterior.id, eu).run();
  } catch (e) {
    if (!/UNIQUE/i.test(e.message || '')) {
      const semColuna = /no such column/i.test(e.message || '');
      return json({ error: semColuna ? 'Falta aplicar a migração 021.' : 'Falha ao iniciar a reunião.', details: e.message }, 500, cabecalhos);
    }
    resultado = null;
  }

  if (!alteradas(resultado)) {
    const outra = await emAndamento(db, eu, SELECT_ITEM);
    if (outra) {
      return json({
        error: `Você já tem uma reunião em andamento: ${outra.lead_nome}. Finalize-a antes de iniciar outra.`,
        code: 'OUTRA_EM_ANDAMENTO', emAndamento: outra
      }, 409, cabecalhos);
    }
    return json({ error: 'Esta reunião já foi iniciada.', code: 'JA_INICIADA' }, 409, cabecalhos);
  }

  await comandoEvento(db, { agendaId: anterior.id, leadId: lead.id, evento: 'iniciada', por: eu, em: agora }).run();
  console.log(`[agenda] ${eu} iniciou a reunião ${anterior.id} (lead ${lead.id})`);
  const salvo = await db.prepare(`${SELECT_ITEM} WHERE a.id = ?`).bind(anterior.id).first();
  return json({ item: salvo }, 200, cabecalhos);
}

async function finalizar(context, anterior, lead, agora) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const eu = String(context.data.usuario.email || '').toLowerCase();

  if (!anterior.iniciada_em) {
    return json({ error: 'Esta reunião ainda não foi iniciada.', code: 'NAO_INICIADA' }, 409, cabecalhos);
  }
  if (anterior.finalizada_em) {
    const salvo = await db.prepare(`${SELECT_ITEM} WHERE a.id = ?`).bind(anterior.id).first();
    return json({ item: salvo }, 200, cabecalhos);
  }
  // Quem iniciou finaliza. Admin também, para destravar a reunião de quem
  // saiu sem finalizar.
  if (anterior.iniciada_por !== eu && !(await avaliarAdmin(context.env, context.data.usuario)).admin) {
    return json({ error: `Só quem iniciou a reunião (${anterior.iniciada_por}) pode finalizá-la.`, code: 'DE_OUTRA_PESSOA' }, 403, cabecalhos);
  }

  await db.batch([
    db.prepare(
      `UPDATE agenda_lead SET finalizada_em = ?, finalizada_por = ?, status = 'realizada',
              atualizado_por = ?, atualizado_em = ?
        WHERE id = ? AND finalizada_em IS NULL`
    ).bind(agora, eu, eu, agora, anterior.id),
    // Gravação que ficou aberta (navegador fechado, PC reiniciado) termina
    // com a reunião.
    db.prepare(`UPDATE gravacoes SET status = 'encerrada', encerrada_em = ? WHERE reuniao_id = ? AND status = 'gravando'`)
      .bind(agora, anterior.id),
    comandoRecalcularProximo(db, lead.id),
    // O último contato é o dia em que a reunião ACONTECEU, não o marcado.
    comandoUltimoContato(db, lead.id, diaEmBrasilia(anterior.iniciada_em)),
    comandoEvento(db, { agendaId: anterior.id, leadId: lead.id, evento: 'finalizada', por: eu, em: agora })
  ]);

  console.log(`[agenda] ${eu} finalizou a reunião ${anterior.id} (lead ${lead.id})`);
  const salvo = await db.prepare(`${SELECT_ITEM} WHERE a.id = ?`).bind(anterior.id).first();
  return json({ item: salvo }, 200, cabecalhos);
}

/* ==========================================================================
   CANCELAR com motivo (2.36.2)
   ========================================================================== */

/**
 * Pedido de 01/10/2026: cancelar pede um dos quatro motivos do ERP e
 * aceita uma observação. Só o que está agendado e não começou.
 */
async function cancelar(context, anterior, lead, agora, corpo) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const eu = String(context.data.usuario.email || '').toLowerCase();

  if (anterior.iniciada_em && !anterior.finalizada_em) {
    return json({ error: 'A reunião está em andamento. Finalize-a antes de mudar a situação.', code: 'EM_ANDAMENTO' }, 409, cabecalhos);
  }
  if (anterior.status !== 'agendada') {
    return json({ error: 'Só um compromisso agendado pode ser cancelado.', code: 'NAO_AGENDADO' }, 409, cabecalhos);
  }
  const motivo = String(corpo.motivo || '');
  if (!Object.hasOwn(MOTIVOS_CANCELAMENTO, motivo)) {
    return json({ error: 'Escolha o motivo do cancelamento.', code: 'MOTIVO_OBRIGATORIO' }, 400, cabecalhos);
  }

  try {
    await db.batch([
      db.prepare(
        `UPDATE agenda_lead SET status = 'cancelada', cancelamento_motivo = ?, cancelamento_obs = ?,
                cancelada_em = ?, cancelada_por = ?, atualizado_por = ?, atualizado_em = ?
          WHERE id = ? AND ativo = 1 AND status = 'agendada'`
      ).bind(motivo, texto(corpo.observacao, 1000), agora, eu, eu, agora, anterior.id),
      // Gravação que ficou aberta de antes da 2.36.0 termina aqui.
      db.prepare(`UPDATE gravacoes SET status = 'encerrada', encerrada_em = ? WHERE reuniao_id = ? AND status = 'gravando'`)
        .bind(agora, anterior.id),
      comandoRecalcularProximo(db, lead.id),
      comandoEvento(db, { agendaId: anterior.id, leadId: lead.id, evento: 'cancelada',
        detalhe: { motivo, observacao: texto(corpo.observacao, 1000) }, por: eu, em: agora })
    ]);
  } catch (e) {
    const semColuna = /no such column/i.test(e.message || '');
    return json({ error: semColuna ? 'Falta aplicar a migração 022.' : 'Falha ao cancelar.', details: e.message }, 500, cabecalhos);
  }

  console.log(`[agenda] ${eu} cancelou ${anterior.id} (lead ${lead.id}): ${motivo}`);
  const salvo = await db.prepare(`${SELECT_ITEM} WHERE a.id = ?`).bind(anterior.id).first();
  return json({ item: salvo }, 200, cabecalhos);
}

/* ==========================================================================
   RESETAR (2.36.4)
   ========================================================================== */

/**
 * Pedido de 01/10/2026, como o "resetar reunião" do ERP: o compromisso
 * volta a ser SÓ o que foi cadastrado — agendado, no horário de origem
 * (que nunca muda ao iniciar). Some o que aconteceu depois: início e fim,
 * cancelamento, não compareceu, e a gravação com a transcrição.
 *
 * Remarcada não se reseta: a nova já existe e é ela que vale.
 * Quem reseta: o CX responsável, quem iniciou, ou admin — apaga
 * transcrição, então não é de qualquer um.
 */
async function resetar(context, anterior, lead, agora) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const eu = String(context.data.usuario.email || '').toLowerCase();

  if (anterior.status === 'remarcada') {
    return json({ error: 'Remarcada não se reseta: abra a reunião nova, que substituiu esta.', code: 'REMARCADA' }, 409, cabecalhos);
  }
  if (anterior.status === 'agendada' && !anterior.iniciada_em) {
    return json({ error: 'Este compromisso já está só agendado.', code: 'NADA_A_RESETAR' }, 409, cabecalhos);
  }
  const dono = [anterior.responsavel, anterior.iniciada_por].includes(eu);
  if (!dono && !(await avaliarAdmin(context.env, context.data.usuario)).admin) {
    return json({ error: 'Só o CX responsável, quem iniciou a reunião ou um admin pode resetá-la.', code: 'SEM_PERMISSAO' }, 403, cabecalhos);
  }

  const { n: gravacoes } = await db.prepare('SELECT COUNT(*) AS n FROM gravacoes WHERE reuniao_id = ?').bind(anterior.id).first();
  await db.batch([
    db.prepare(
      `UPDATE agenda_lead SET status = 'agendada',
              iniciada_em = NULL, iniciada_por = NULL, finalizada_em = NULL, finalizada_por = NULL,
              cancelamento_motivo = NULL, cancelamento_obs = NULL, cancelada_em = NULL, cancelada_por = NULL,
              atualizado_por = ?, atualizado_em = ?
        WHERE id = ? AND ativo = 1`
    ).bind(eu, agora, anterior.id),
    db.prepare('DELETE FROM transcricao_trechos WHERE gravacao_id IN (SELECT id FROM gravacoes WHERE reuniao_id = ?)')
      .bind(anterior.id),
    db.prepare('DELETE FROM gravacoes WHERE reuniao_id = ?').bind(anterior.id),
    // Os recortes (2.37.0) saem da transcrição: vão junto.
    db.prepare('DELETE FROM reuniao_analises WHERE reuniao_id = ?').bind(anterior.id),
    // O Dossiê da Reunião (2.38.0) também: era desta conversa, que some.
    db.prepare('DELETE FROM dossies_reuniao WHERE reuniao_id = ?').bind(anterior.id),
    comandoRecalcularProximo(db, lead.id),
    comandoEvento(db, { agendaId: anterior.id, leadId: lead.id, evento: 'resetada',
      detalhe: { estava: anterior.iniciada_em && !anterior.finalizada_em ? 'andamento' : anterior.status, gravacoes: Number(gravacoes) },
      por: eu, em: agora })
  ]);

  console.log(`[agenda] ${eu} resetou ${anterior.id} (lead ${lead.id}), que estava ${anterior.status}`);
  const salvo = await db.prepare(`${SELECT_ITEM} WHERE a.id = ?`).bind(anterior.id).first();
  return json({ item: salvo }, 200, cabecalhos);
}

/* ==========================================================================
   O HISTÓRICO (2.36.5)
   ========================================================================== */

/**
 * Os eventos do compromisso, do mais novo ao mais antigo. O que nasceu
 * antes da migração 023 não tem o evento de criação: ele é montado a
 * partir de `criado_por`/`criado_em`, marcado `sintetico`, e a tela
 * avisa que o histórico começa ali.
 */
async function historico(db, agendaId) {
  const item = await db.prepare('SELECT id, lead_id, criado_por, criado_em FROM agenda_lead WHERE id = ?').bind(agendaId).first();
  if (!item) return { eventos: [] };

  let eventos = [];
  let aviso = null;
  try {
    const { results } = await db.prepare('SELECT * FROM agenda_eventos WHERE agenda_id = ? ORDER BY em DESC, id DESC').bind(agendaId).all();
    eventos = (results || []).map((e) => {
      let detalhe = null;
      try { detalhe = e.detalhe ? JSON.parse(e.detalhe) : null; } catch (x) { /* ilegível: fica sem */ }
      return { ...e, detalhe };
    });
  } catch (e) {
    if (!/no such table/i.test(e.message || '')) throw e;
    aviso = 'Falta aplicar a migração 023: o histórico ainda não é gravado.';
  }

  if (!eventos.some((e) => e.evento === 'criada')) {
    eventos.push({
      id: 0, agenda_id: item.id, lead_id: item.lead_id, evento: 'criada', detalhe: null,
      por: String(item.criado_por || '').toLowerCase(), em: item.criado_em, sintetico: true
    });
  }
  return { eventos, aviso };
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
    ? await db.prepare('SELECT lead_id, iniciada_em, finalizada_em FROM agenda_lead WHERE id = ? AND ativo = 1').bind(id).first()
    : null;
  if (!anterior) return json({ error: 'Compromisso não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
  if (anterior.iniciada_em && !anterior.finalizada_em) {
    return json({ error: 'A reunião está em andamento. Finalize-a antes de excluir.', code: 'EM_ANDAMENTO' }, 409, cabecalhos);
  }

  try {
    const agora = new Date().toISOString();
    await db.batch([
      db.prepare('UPDATE agenda_lead SET ativo = 0, atualizado_por = ?, atualizado_em = ? WHERE id = ?')
        .bind(usuario.email, agora, id),
      comandoRecalcularProximo(db, anterior.lead_id),
      comandoEvento(db, { agendaId: id, leadId: anterior.lead_id, evento: 'excluida', por: usuario.email, em: agora })
    ]);
    return json({ ok: true, id }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao excluir.', details: e.message }, 500, cabecalhos);
  }
}
