/**
 * /api/stakeholders — as pessoas do lado do cliente (2.43.0, Fase 3 da 2.24.0).
 *
 * Decidido com o Jair em 05/10/2026:
 *   - as pessoas SÃO as do cadastro do cliente no ERP (campo `contacts`,
 *     conferido na 2.42.0: todas com código `_id`). Quem sai é excluído
 *     no ERP e some daqui;
 *   - a CX não cadastra pessoa no CRM — o cadastro é no ERP;
 *   - o CRM guarda só a AVALIAÇÃO da CX: influência, postura, patrocinador
 *     e observações, presa ao código da pessoa no ERP (migração 029).
 *
 * GET ?cliente_id=N                       as pessoas do ERP, cada uma com a avaliação
 * PUT ?cliente_id=N&erp_contato_id=X      grava a avaliação de uma pessoa
 *
 * A leitura é a mesma do Dossiê de Experiência (`reunirConta`): a aba e o
 * documento enxergam exatamente as mesmas pessoas, com os mesmos núcleos.
 * Não há mais POST nem DELETE: criar e excluir pessoa é no ERP.
 */

import { INFLUENCIAS, POSTURAS } from './_lib/schema-dossie-cx.js';
import { reunirConta } from './dossie-cx.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const texto = (v, limite = 500) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, limite) : null;
};

/**
 * Fora da lista vira 'desconhecida': cadastrar não é avaliar, e qualquer
 * outro padrão carimbaria um juízo que ninguém emitiu.
 */
const umDe = (valor, permitidos) => {
  const v = String(valor || '').toLowerCase();
  return permitidos.includes(v) ? v : 'desconhecida';
};

const CODIGO_ERP = /^[A-Za-z0-9_-]{6,64}$/;

/* ==========================================================================
   GET — as pessoas do ERP, com a avaliação da CX
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const clienteId = Number(searchParams.get('cliente_id'));
  if (!clienteId) return json({ error: 'Informe o cliente.' }, 400, cabecalhos);

  try {
    const conta = await reunirConta(db, clienteId, context.env);
    if (!conta) return json({ error: 'Cliente não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

    const p = conta.fontes.pessoas;
    return json({
      consultado: !!p.consultado,
      motivo: p.motivo || null,
      // Gente que o ERP tem e não sabemos nomear (contato como referência).
      totalNoErp: p.totalNoErp,
      avaliacoesSemPessoa: p.avaliacoesSemPessoa || 0,
      nucleosConsultados: !!conta.fontes.nucleos.consultado,
      pessoas: conta.stakeholders.map((s) => ({
        erpContatoId: s.erpContatoId,
        nome: s.nome,
        cargo: s.cargo,
        email: s.email,
        telefone: s.telefone,
        principal: s.principal,
        nucleos: s.nucleos || [],
        influencia: s.influencia,
        postura: s.postura,
        patrocinador: !!s.patrocinador,
        observacoes: s.observacoes,
        avaliada: !!s.avaliada,
        origem: s.origem
      }))
    }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao consultar as pessoas.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   PUT — a avaliação de uma pessoa do ERP
   ========================================================================== */

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const clienteId = Number(searchParams.get('cliente_id'));
  const codigo = String(searchParams.get('erp_contato_id') || '').trim();
  if (!clienteId) return json({ error: 'Informe o cliente.' }, 400, cabecalhos);
  if (!CODIGO_ERP.test(codigo)) {
    return json({ error: 'Pessoa sem código do ERP: a avaliação só é guardada para quem está no cadastro do cliente no ERP.', code: 'SEM_CODIGO' }, 400, cabecalhos);
  }

  let corpo;
  try { corpo = await context.request.json(); } catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  const cliente = await db.prepare('SELECT id FROM clientes WHERE id = ?').bind(clienteId).first();
  if (!cliente) return json({ error: 'Cliente não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

  // O nome, o cargo e o contato vão como FOTO do que o ERP dizia quando a
  // avaliação foi gravada: servem a quem ler o banco, não à tela, que
  // sempre mostra o ERP de agora.
  const v = {
    nome: texto(corpo.nome, 120) || '(sem nome no ERP)',
    cargo: texto(corpo.cargo, 120),
    email: texto(corpo.email, 160),
    telefone: texto(corpo.telefone, 30),
    influencia: umDe(corpo.influencia, INFLUENCIAS),
    postura: umDe(corpo.postura, POSTURAS),
    patrocinador: corpo.patrocinador ? 1 : 0,
    observacoes: texto(corpo.observacoes, 2000)
  };
  const agora = new Date().toISOString();

  try {
    const existente = await db.prepare(
      'SELECT id FROM stakeholders WHERE cliente_id = ? AND erp_contato_id = ? AND ativo = 1'
    ).bind(clienteId, codigo).first();

    let registro;
    if (existente) {
      registro = await db.prepare(
        `UPDATE stakeholders SET nome = ?, cargo = ?, email = ?, telefone = ?,
                influencia = ?, postura = ?, patrocinador = ?, observacoes = ?,
                atualizado_por = ?, atualizado_em = ?
          WHERE id = ? RETURNING *`
      ).bind(v.nome, v.cargo, v.email, v.telefone, v.influencia, v.postura, v.patrocinador, v.observacoes,
        usuario.email, agora, existente.id).first();
    } else {
      registro = await db.prepare(
        `INSERT INTO stakeholders (cliente_id, erp_contato_id, nome, cargo, email, telefone,
                                   influencia, postura, patrocinador, nucleos, observacoes,
                                   criado_por, criado_em, ativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 1) RETURNING *`
      ).bind(clienteId, codigo, v.nome, v.cargo, v.email, v.telefone, v.influencia, v.postura,
        v.patrocinador, v.observacoes, usuario.email, agora).first();
    }

    console.log(`[stakeholders] cliente ${clienteId} pessoa ${codigo} avaliada por ${usuario.email}`);
    return json({
      ok: true,
      avaliacao: {
        erpContatoId: codigo,
        influencia: registro.influencia,
        postura: registro.postura,
        patrocinador: !!registro.patrocinador,
        observacoes: registro.observacoes
      }
    }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao gravar a avaliação.', details: e.message }, 500, cabecalhos);
  }
}
