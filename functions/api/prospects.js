/**
 * /api/prospects — os prospects do ERP no funil (2.33.0).
 *
 * GET   as últimas importações, para as Configurações dizerem quando foi
 *       a última e o que trouxe
 * POST  roda uma importação:
 *         - pelo Worker diário (`workers/prospects-diario`), que se
 *           identifica com o CRON_SECRET no middleware — uma vez por dia;
 *         - pelo admin, no botão "Importar agora" — quando quiser.
 *
 * A regra está em `_lib/prospects.js`.
 */

import { importarProspects } from './_lib/prospects.js';
import { exigirAdmin } from './_lib/admin.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    const [rodadas, conta] = await Promise.all([
      db.prepare('SELECT * FROM importacoes_erp ORDER BY id DESC LIMIT 5').all(),
      db.prepare(
        `SELECT COUNT(*) AS n FROM leads l JOIN prospects_erp p ON p.lead_id = l.id
          WHERE p.situacao = 'criado' AND l.ativo = 1 AND l.responsavel IS NULL`
      ).first()
    ]);
    return json({
      importacoes: rodadas.results || [],
      semResponsavel: Number(conta?.n || 0)
    }, 200, cabecalhos);
  } catch (e) {
    return json({ importacoes: [], aviso: 'Falta aplicar a migração 018.', details: e.message }, 200, cabecalhos);
  }
}

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  // O Worker entra pelo segredo (usuario.sistema); gente, só admin.
  const origem = usuario?.sistema ? 'diaria' : 'manual';
  if (origem === 'manual') {
    const recusa = await exigirAdmin(context);
    if (recusa) return recusa;
  }

  try {
    const rodada = await importarProspects(context.env, db, { usuario: usuario.email, origem });
    return json({ ok: true, importacao: rodada }, 200, cabecalhos);
  } catch (e) {
    // O código do hub (sem permissão, fora do ar) vai junto: a tela e o
    // log do Worker precisam dizer o que falhou, não só que falhou.
    return json({
      error: 'A importação dos prospects falhou.', details: e.message, code: e.codigo || 'ERRO'
    }, 502, cabecalhos);
  }
}
