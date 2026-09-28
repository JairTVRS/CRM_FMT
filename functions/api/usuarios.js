/**
 * GET /api/usuarios — quem pode ser responsável por um lead (2.31.0).
 *
 * São os usuários que já entraram no CRM, gravados pelo /api/me a cada
 * abertura. Não é a lista inteira do hub: lá estão todos os operadores
 * da Formatar, inclusive quem nunca abriu o CRM — decidido em 28/09/2026,
 * "os usuários dentro do CRM somente".
 *
 * Sem a migração 016 a tabela não existe; a resposta vem vazia com o
 * aviso, e a ficha continua mostrando o responsável que o lead já tem.
 */

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    const { results } = await db
      .prepare(
        `SELECT email, nome, grupo, ultimo_acesso FROM usuarios_crm
         ORDER BY COALESCE(nome, email) COLLATE NOCASE`
      )
      .all();
    return json({ usuarios: results || [] }, 200, cabecalhos);
  } catch (e) {
    return json({ usuarios: [], aviso: 'Falta aplicar a migração 016.', details: e.message }, 200, cabecalhos);
  }
}
