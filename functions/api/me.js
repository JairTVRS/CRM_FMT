/**
 * GET /api/me — quem está logado nesta sessão.
 *
 * Só responde se o _middleware.js já tiver validado o token e confirmado
 * o cadastro ativo no hub. O frontend usa isso para exibir nome/foto e,
 * principalmente, para confirmar que o acesso continua valendo.
 *
 * É também onde a sessão de 7 dias nasce e se renova: o _middleware.js
 * anexa o cookie a esta resposta. `sessao.ate` diz à página até quando
 * ela pode dispensar o token do Google — ou `null`, quando o servidor
 * está sem SESSAO_SECRET e nada foi emitido.
 *
 * DESDE A 2.31.0, mais duas coisas, porque a página chama isto uma vez a
 * cada abertura:
 *
 *   - `usuario.admin` e `usuario.grupo`, lidos do grupo no hub. A tela
 *     usa para mostrar ou não os controles de admin; quem manda de
 *     verdade é a guarda em cada rota (`exigirAdmin`).
 *   - registra quem entrou em `usuarios_crm`. É dali que sai a lista de
 *     responsáveis do lead: quem usa o CRM, não todo operador do hub.
 *
 * Nenhuma das duas pode derrubar o login. Sem a migração 016 ou sem a
 * permissão de grupos, a pessoa entra do mesmo jeito — só não é admin.
 */

import { avaliarAdmin } from './_lib/admin.js';

async function registrarAcesso(db, usuario, grupo) {
  if (!db || !usuario?.email) return;
  const agora = new Date().toISOString();
  try {
    await db.prepare(
      `INSERT INTO usuarios_crm (email, nome, hub_id, grupo, primeiro_acesso, ultimo_acesso)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         nome = excluded.nome, hub_id = excluded.hub_id,
         grupo = COALESCE(excluded.grupo, usuarios_crm.grupo),
         ultimo_acesso = excluded.ultimo_acesso`
    ).bind(
      String(usuario.email).toLowerCase(), usuario.nome || null,
      usuario.id != null ? String(usuario.id) : null, grupo, agora, agora
    ).run();
  } catch (e) {
    // Sem a migração 016 a tabela não existe. O login segue.
    console.log(`[me] acesso não registrado: ${e.message}`);
  }
}

export async function onRequestGet(context) {
  const usuario = context.data.usuario;
  const { admin, grupo, aviso } = await avaliarAdmin(context.env, usuario);

  await registrarAcesso(context.env.DB, usuario, grupo);

  return new Response(
    JSON.stringify({
      usuario: { ...usuario, admin, grupo, avisoAdmin: aviso },
      sessao: { ate: context.data.sessaoAte || null }
    }),
    { status: 200, headers: context.data.cabecalhos }
  );
}
