/**
 * /api/preferencias — o que cada usuário escolheu para as suas telas.
 *
 * Autenticação garantida pelo _middleware.js. A preferência é SEMPRE do
 * usuário da sessão: o e-mail vem de context.data.usuario, nunca da
 * requisição — ninguém lê nem grava a preferência de outra pessoa.
 *
 * GET ?chave=plano-colunas   { valor } — `null` quando nunca gravou
 * PUT ?chave=plano-colunas   corpo { valor }: grava por cima
 *
 * O servidor não interpreta o `valor`: a tela que grava é dona do
 * formato. Ele só limita o tamanho e exige JSON.
 *
 * Sem a migração 013 o GET responde `valor: null` em vez de erro: a tela
 * abre no padrão, que é o que ela faria para quem nunca configurou.
 */

const CHAVE_VALIDA = /^[a-z0-9-]{1,40}$/;
const LIMITE_BYTES = 8 * 1024;

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const semTabela = (e) => /no such table/i.test(String(e?.message));

function lerChave(context) {
  const chave = new URL(context.request.url).searchParams.get('chave') || '';
  return CHAVE_VALIDA.test(chave) ? chave : null;
}

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const chave = lerChave(context);
  if (!chave) return json({ error: 'Chave de preferência inválida.', code: 'CHAVE_INVALIDA' }, 400, cabecalhos);

  try {
    const linha = await db
      .prepare('SELECT valor, atualizado_em FROM preferencias_usuario WHERE email = ? AND chave = ?')
      .bind(context.data.usuario.email, chave)
      .first();

    let valor = null;
    try { valor = linha ? JSON.parse(linha.valor) : null; } catch (e) { valor = null; }

    return json({ valor, atualizadoEm: linha?.atualizado_em || null }, 200, cabecalhos);

  } catch (e) {
    if (semTabela(e)) return json({ valor: null, semTabela: true }, 200, cabecalhos);
    return json({ error: 'Falha ao ler a preferência.', details: e.message }, 500, cabecalhos);
  }
}

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const chave = lerChave(context);
  if (!chave) return json({ error: 'Chave de preferência inválida.', code: 'CHAVE_INVALIDA' }, 400, cabecalhos);

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos); }

  if (!corpo || corpo.valor === undefined) {
    return json({ error: 'Informe o valor.', code: 'VALOR_OBRIGATORIO' }, 400, cabecalhos);
  }

  const texto = JSON.stringify(corpo.valor);
  if (new TextEncoder().encode(texto).length > LIMITE_BYTES) {
    return json({ error: 'Preferência grande demais.', code: 'GRANDE_DEMAIS' }, 413, cabecalhos);
  }

  const agora = new Date().toISOString();

  try {
    await db
      .prepare(
        `INSERT INTO preferencias_usuario (email, chave, valor, atualizado_em)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (email, chave) DO UPDATE
            SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`
      )
      .bind(context.data.usuario.email, chave, texto, agora)
      .run();

    return json({ ok: true, atualizadoEm: agora }, 200, cabecalhos);

  } catch (e) {
    if (semTabela(e)) {
      return json({
        error: 'O banco ainda não tem a migração 013 (preferências). A configuração vale só até recarregar.',
        code: 'SEM_MIGRACAO_013'
      }, 503, cabecalhos);
    }
    return json({ error: 'Falha ao salvar a preferência.', details: e.message }, 500, cabecalhos);
  }
}
