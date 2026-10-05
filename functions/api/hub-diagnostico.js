/**
 * /api/hub-diagnostico — conferência das pessoas dos clientes no ERP
 * (2.42.0, Fase 3 da 2.24.0). Só admin.
 *
 * GET ?lista=1             os clientes ligados ao ERP, pelo nome (para escolher na tela)
 * GET ?cliente_id=N        um cliente do CRM — o id do ERP o CRM já sabe
 * GET [?amostra=8]         até 8 clientes ligados ao ERP, sorteados
 *
 * Decidido em 05/10/2026: ninguém precisa saber o id do ERP; a tela
 * escolhe o cliente pelo nome.
 *
 * Devolve só a FORMA do que o ERP mandou — nomes de campos, quantidades,
 * quantos têm código — nunca nome, e-mail ou telefone de ninguém
 * (_lib/diagnostico-pessoas.js).
 */

import { exigirAdmin } from './_lib/admin.js';
import { diagnosticarCliente, resumir } from './_lib/diagnostico-pessoas.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const LIGADO_AO_ERP = "ativo = 1 AND erp_id IS NOT NULL AND erp_id <> ''";

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  const recusa = await exigirAdmin(context);
  if (recusa) return recusa;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    if (searchParams.get('lista')) {
      const { results } = await db.prepare(
        `SELECT id, COALESCE(NULLIF(nome_fantasia, ''), nome) AS nome FROM clientes
          WHERE ${LIGADO_AO_ERP} ORDER BY 2 COLLATE NOCASE`
      ).all();
      return json({ clientes: results || [] }, 200, cabecalhos);
    }

    let alvos = [];
    const clienteId = Number(searchParams.get('cliente_id'));
    if (clienteId) {
      const c = await db.prepare(
        `SELECT erp_id, COALESCE(NULLIF(nome_fantasia, ''), nome) AS nome FROM clientes WHERE id = ? AND ${LIGADO_AO_ERP}`
      ).bind(clienteId).first();
      if (!c) return json({ error: 'Cliente não encontrado ou sem ligação com o ERP.' }, 404, cabecalhos);
      alvos = [{ erpId: c.erp_id, nome: c.nome }];
    } else {
      const n = Math.min(Math.max(Number(searchParams.get('amostra')) || 8, 1), 15);
      const { results } = await db.prepare(
        `SELECT erp_id, COALESCE(NULLIF(nome_fantasia, ''), nome) AS nome FROM clientes
          WHERE ${LIGADO_AO_ERP} ORDER BY RANDOM() LIMIT ?`
      ).bind(n).all();
      alvos = (results || []).map((r) => ({ erpId: r.erp_id, nome: r.nome }));
    }

    // Um cliente por vez: três pedidos cada, e o hub pede pausa (429) em rajada.
    const resultados = [];
    for (const a of alvos) {
      resultados.push({ ...(await diagnosticarCliente(context.env, a.erpId)), nome: a.nome });
    }

    console.log(`[hub-diagnostico] ${resultados.length} cliente(s) por ${context.data.usuario?.email}`);
    return json({ em: new Date().toISOString(), resumo: resumir(resultados), clientes: resultados }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha na conferência.', details: e.message }, 500, cabecalhos);
  }
}
