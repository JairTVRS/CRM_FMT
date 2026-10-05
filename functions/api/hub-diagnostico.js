/**
 * /api/hub-diagnostico — conferência das pessoas dos clientes no ERP
 * (2.42.0, Fase 3 da 2.24.0). Só admin.
 *
 * GET ?erp_id=XXX          um cliente específico (o id do ERP, o da URL do hub)
 * GET [?amostra=8]         até 8 clientes do CRM ligados ao ERP, sorteados
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

const ID_ERP = /^[A-Za-z0-9_-]{6,64}$/;

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  const recusa = await exigirAdmin(context);
  if (recusa) return recusa;

  try {
    let alvos = [];
    const unico = (searchParams.get('erp_id') || '').trim();
    if (unico) {
      if (!ID_ERP.test(unico)) return json({ error: 'Id do ERP inválido.' }, 400, cabecalhos);
      const noCrm = db ? await db.prepare('SELECT id, nome FROM clientes WHERE erp_id = ?').bind(unico).first() : null;
      alvos = [{ erpId: unico, nome: noCrm?.nome || null }];
    } else {
      const n = Math.min(Math.max(Number(searchParams.get('amostra')) || 8, 1), 15);
      const { results } = await db.prepare(
        `SELECT erp_id, nome FROM clientes WHERE ativo = 1 AND erp_id IS NOT NULL AND erp_id <> ''
         ORDER BY RANDOM() LIMIT ?`
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
