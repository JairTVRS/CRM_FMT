/**
 * _lib/admin.js — quem é admin no CRM (2.31.0, revisto na 2.31.1).
 *
 * O CRM não tem cadastro de perfis. Quem decide é o GRUPO do usuário no
 * hub: os grupos listados aqui administram as Configurações (motivos de
 * perda hoje; chaves de IA e roteiros nos lotes seguintes). Decidido em
 * 28/09/2026: "Sócios" e "Planejamento e Controle de Produção".
 *
 * A COMPARAÇÃO É PELO ID DO GRUPO, não pelo nome. O id chega junto com o
 * usuário (`userGroup` de `GET /users`, permissão `hub:users:read`, a
 * mesma do login). O nome exigiria `GET /user-groups`, e essa permissão
 * fica FECHADA por decisão de 28/09/2026: ela abre a árvore de acesso dos
 * usuários do hub, que não é assunto do CRM. A 2.31.0 consultava os
 * nomes; a 2.31.1 deixou de consultar — o CRM nunca pede `/user-groups`.
 *
 * Os ids foram copiados do endereço de edição de cada grupo no hub. Os
 * nomes abaixo servem só para a tela dizer "grupo Sócios" em vez de um
 * ObjectId; quem manda é o id.
 *
 * `ADMIN_GRUPOS` no ambiente (ids separados por vírgula) substitui a
 * lista sem precisar de deploy de código. Fica no painel da Cloudflare, e
 * não numa tela do CRM, de propósito: numa tela, um admin poderia se
 * descadastrar por engano e ninguém mais conseguiria voltar.
 *
 * NA DÚVIDA, NÃO É ADMIN: usuário sem grupo, ou num grupo fora da lista.
 */

export const GRUPOS_ADMIN_PADRAO = {
  '64e678a7d2042dae072ef102': 'Sócios',
  '6699523a12251d23d507cb91': 'Planejamento e Controle de Produção'
};

export function gruposAdmin(env) {
  const doAmbiente = String(env?.ADMIN_GRUPOS || '')
    .split(',').map((g) => g.trim().toLowerCase()).filter(Boolean);
  return doAmbiente.length ? doAmbiente : Object.keys(GRUPOS_ADMIN_PADRAO);
}

/**
 * @param env      o ambiente da Function
 * @param usuario  `context.data.usuario`, com o `grupoId` do middleware
 * @returns {Promise<{admin: boolean, grupo: string|null, aviso: string|null}>}
 *   `grupo` é o nome, quando o CRM o conhece (só os grupos de admin).
 */
export async function avaliarAdmin(env, usuario) {
  const id = String(usuario?.grupoId || '').trim().toLowerCase();
  if (!id) {
    return { admin: false, grupo: null, aviso: 'Seu usuário não tem grupo no hub.' };
  }
  return {
    admin: gruposAdmin(env).includes(id),
    grupo: GRUPOS_ADMIN_PADRAO[id] || null,
    aviso: null
  };
}

/**
 * Guarda para as rotas que só admin usa. Devolve `null` quando pode
 * seguir, ou a Response de recusa.
 */
export async function exigirAdmin(context) {
  const { admin, aviso } = await avaliarAdmin(context.env, context.data.usuario);
  if (admin) return null;
  return new Response(JSON.stringify({
    error: aviso || 'Só administradores do CRM podem alterar esta configuração.',
    code: 'SO_ADMIN'
  }), { status: 403, headers: context.data.cabecalhos });
}
