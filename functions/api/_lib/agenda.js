/**
 * _lib/agenda.js — as regras da agenda do lead (2.32.0).
 *
 * Mora aqui, e não só no `api/agenda.js`, porque a importação de planilha
 * também escreve na agenda: a coluna "Próximo contato" da planilha vira
 * um contato agendado, como a migração 017 fez com os que já existiam.
 * Duas cópias da regra "o próximo contato é a primeira data agendada"
 * divergiriam na primeira manutenção.
 */

import { mapaDeTiposDeReuniao, mapaDeTimes, memorizar } from './hub.js';

export const TIPOS = ['reuniao', 'contato'];
export const STATUS = ['agendada', 'realizada', 'remarcada', 'cancelada', 'nao_compareceu'];
export const LOCAIS = ['online', 'presencial', 'externo'];
export const CANAIS = ['ligacao', 'whatsapp', 'email', 'outro'];

/**
 * Os motivos de cancelamento (2.36.2): os quatro do Painel de Operações
 * do ERP, na mesma ordem. O `agenda.js` da tela tem os mesmos rótulos.
 */
export const MOTIVOS_CANCELAMENTO = {
  cliente: 'Cancelado pelo cliente',
  consultor: 'Cancelado pelo consultor',
  agendamento: 'Cancelado pelo agendamento',
  proposta: 'Proposta cancelada pelo cliente'
};

/* ==========================================================================
   O HISTÓRICO DE CADA COMPROMISSO (2.36.5, migração 023)
   ========================================================================== */

/** Os campos que o histórico acompanha numa alteração (o id do tipo não: vale o nome). */
export const CAMPOS_DO_HISTORICO = [
  'tipo', 'inicio', 'duracao_min', 'tipo_reuniao_nome', 'local_tipo', 'local_texto',
  'canal', 'responsavel', 'participantes', 'pauta', 'status'
];

/** O que mudou de `antes` para `depois`, campo a campo. Textos longos vão cortados. */
export function mudancas(antes, depois) {
  const curto = (v) => (v == null || v === '' ? null : String(v).slice(0, 300));
  return CAMPOS_DO_HISTORICO
    .filter((c) => depois[c] !== undefined && curto(antes?.[c]) !== curto(depois[c]))
    .map((c) => ({ campo: c, de: curto(antes?.[c]), para: curto(depois[c]) }));
}

/** Um evento de um compromisso que já tem id. */
export function comandoEvento(db, { agendaId, leadId, evento, detalhe = null, por, em }) {
  return db.prepare(
    `INSERT INTO agenda_eventos (agenda_id, lead_id, evento, detalhe, por, em) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(agendaId, leadId, evento, detalhe ? JSON.stringify(detalhe) : null,
    String(por || '').toLowerCase(), em);
}

/**
 * Um evento do compromisso que ACABOU de ser criado no mesmo lote: o id
 * ainda não é conhecido, e é o maior do lead (o mesmo recurso do remarcar).
 */
export function comandoEventoDoNovo(db, { leadId, evento, detalhe = null, por, em }) {
  return db.prepare(
    `INSERT INTO agenda_eventos (agenda_id, lead_id, evento, detalhe, por, em)
     SELECT MAX(id), ?, ?, ?, ?, ? FROM agenda_lead WHERE lead_id = ?`
  ).bind(leadId, evento, detalhe ? JSON.stringify(detalhe) : null,
    String(por || '').toLowerCase(), em, leadId);
}

/** Hora em que cai um contato que só tem data (planilha, migração). */
export const HORA_PADRAO = '09:00';

/**
 * 'AAAA-MM-DDTHH:MM' (ou com espaço no lugar do T) → o mesmo texto,
 * conferido. Rejeita 31/02 e 25:00 em vez de deixar o banco guardar uma
 * data que a agenda não saberia onde desenhar.
 */
export function normalizarInicio(valor) {
  const m = String(valor || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, a, mes, d, h, min] = m.map(Number);
  if (h > 23 || min > 59) return null;
  const teste = new Date(Date.UTC(a, mes - 1, d));
  if (teste.getUTCFullYear() !== a || teste.getUTCMonth() !== mes - 1 || teste.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

/**
 * `leads.data_proximo_contato` é DERIVADO: a primeira data ainda
 * agendada. Uma agendada vencida continua contando — é o contato que
 * atrasou, e a ficha mostra "N dias em atraso", que é exatamente o aviso.
 */
export function comandoRecalcularProximo(db, leadId) {
  return db.prepare(
    `UPDATE leads SET data_proximo_contato = (
       SELECT MIN(substr(inicio, 1, 10)) FROM agenda_lead
        WHERE lead_id = ? AND ativo = 1 AND status = 'agendada')
     WHERE id = ?`
  ).bind(leadId, leadId);
}

/**
 * Realizou: o "Último contato" anda para a frente, nunca para trás. A
 * data que veio da planilha pode ser mais nova que a da agenda, e
 * apagá-la seria perder informação.
 */
export function comandoUltimoContato(db, leadId, data) {
  return db.prepare(
    `UPDATE leads SET data_ultimo_contato = ?
      WHERE id = ? AND (data_ultimo_contato IS NULL OR data_ultimo_contato < ?)`
  ).bind(data, leadId, data);
}

/**
 * O "Próximo contato" de uma linha da planilha vira contato agendado.
 * Pelo documento, porque na importação o lead novo ainda não tem id no
 * momento em que os comandos são montados. Não duplica: uma segunda
 * importação com a mesma data não cria outro contato.
 */
export function comandosDoImportado(db, { documento, data, usuario, agora }) {
  const dia = String(data || '').slice(0, 10);
  return [
    db.prepare(
      `INSERT INTO agenda_lead (lead_id, tipo, inicio, responsavel, status, criado_por, criado_em)
       SELECT l.id, 'contato', ?, l.responsavel, 'agendada', ?, ?
         FROM leads l
        WHERE l.documento = ? AND l.ativo = 1
          AND NOT EXISTS (SELECT 1 FROM agenda_lead a
                           WHERE a.lead_id = l.id AND a.ativo = 1 AND a.status = 'agendada'
                             AND substr(a.inicio, 1, 10) = ?)`
    ).bind(`${dia}T${HORA_PADRAO}`, usuario, agora, documento, dia),

    db.prepare(
      `UPDATE leads SET data_proximo_contato = (
         SELECT MIN(substr(a.inicio, 1, 10)) FROM agenda_lead a
          WHERE a.lead_id = leads.id AND a.ativo = 1 AND a.status = 'agendada')
       WHERE documento = ? AND ativo = 1`
    ).bind(documento)
  ];
}

/**
 * A reunião que a pessoa iniciou e não finalizou (2.36.0) — no máximo
 * uma, pelo índice da migração 021. `select` é o SELECT da tela, com o
 * lead junto.
 */
export async function emAndamento(db, email, select) {
  return db.prepare(
    `${select} WHERE a.iniciada_por = ? AND a.iniciada_em IS NOT NULL
        AND a.finalizada_em IS NULL AND a.ativo = 1
      ORDER BY a.iniciada_em DESC LIMIT 1`
  ).bind(String(email || '').toLowerCase()).first();
}

/** O dia, em Brasília (UTC−3, sem horário de verão), de um instante ISO. */
export function diaEmBrasilia(iso) {
  return new Date(Date.parse(iso) - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** O e-mail é de alguém que já entrou no CRM? */
export async function usuarioDoCrm(db, email) {
  if (!email) return false;
  const r = await db.prepare('SELECT email FROM usuarios_crm WHERE email = ?').bind(email).first();
  return !!r;
}

/* ==========================================================================
   OS TIPOS DE REUNIÃO DE VENDAS

   Decidido em 28/09/2026: os tipos de reunião do lead são os do HUB cujo
   Time é "Vendas". Cadastrar um tipo novo lá, no Time Vendas, o faz
   aparecer aqui sem mexer no CRM. `TIME_VENDAS` no ambiente troca o nome
   do Time, se um dia ele for renomeado.

   Usa `hub:meeting-types:read` e `hub:teams:read`, que a chave já tem.
   ========================================================================== */

const semAcento = (t) => String(t || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function tiposDeVendas(env) {
  const nomeDoTime = env?.TIME_VENDAS || 'Vendas';
  return memorizar(`tipos-vendas:${nomeDoTime}`, 10 * 60 * 1000, async () => {
    const [tipos, times] = await Promise.all([mapaDeTiposDeReuniao(env), mapaDeTimes(env)]);

    const idsDoTime = [...times.values()]
      .filter((t) => semAcento(t.nome) === semAcento(nomeDoTime))
      .map((t) => String(t.erp_id));

    const lista = [...tipos.values()]
      .filter((t) => t.ativo && (t.timesErpIds || []).some((id) => idsDoTime.includes(String(id))))
      .map((t) => ({ erp_id: t.erp_id, nome: t.nome }))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    let aviso = null;
    if (!idsDoTime.length) {
      aviso = `O Time "${nomeDoTime}" não existe no hub. Cadastre-o e ligue a ele os tipos de reunião de venda.`;
    } else if (!lista.length) {
      aviso = `O Time "${nomeDoTime}" existe no hub, mas nenhum tipo de reunião ativo está ligado a ele.`;
    }
    return { tipos: lista, aviso };
  });
}
