/**
 * _lib/admin.js — quem é admin no CRM (2.31.0).
 *
 * O CRM não tem cadastro de perfis. Quem decide é o GRUPO do usuário no
 * hub: os grupos listados em `GRUPOS_ADMIN` administram as Configurações
 * (motivos de perda hoje; chaves de IA e roteiros nos lotes seguintes).
 * Decidido em 28/09/2026: "Planejamento e Controle de Produção" e
 * "Sócios".
 *
 * A comparação é pelo NOME do grupo, sem diferenciar maiúsculas nem
 * acentos: "Socios", "SÓCIOS" e "Sócios" são o mesmo grupo. O hub não
 * tem outra marca estável que o CRM possa conhecer de antemão — o id do
 * grupo só existe lá.
 *
 * `ADMIN_GRUPOS` no ambiente (lista separada por vírgula) substitui o
 * padrão sem precisar de deploy. Fica no painel da Cloudflare, e não no
 * banco, de propósito: se ficasse numa tela, um admin poderia se
 * descadastrar por engano, e ninguém mais conseguiria voltar.
 *
 * NA DÚVIDA, NÃO É ADMIN. Hub fora do ar, chave sem a permissão
 * `hub:user-groups:read`, usuário sem grupo: todos caem em "não admin",
 * com o motivo em `aviso` para a tela poder explicar em vez de só
 * esconder os botões.
 */

import { mapaDeGrupos, ErroHub } from './hub.js';

export const GRUPOS_ADMIN_PADRAO = ['Planejamento e Controle de Produção', 'Sócios'];

/** "Sócios" → "socios": sem acento, sem maiúscula, espaços únicos. */
export function normalizarGrupo(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function gruposAdmin(env) {
  const doAmbiente = String(env?.ADMIN_GRUPOS || '')
    .split(',').map((g) => g.trim()).filter(Boolean);
  return (doAmbiente.length ? doAmbiente : GRUPOS_ADMIN_PADRAO).map(normalizarGrupo);
}

/**
 * @param env      o ambiente da Function
 * @param usuario  `context.data.usuario`, com o `grupoId` do middleware
 * @returns {Promise<{admin: boolean, grupo: string|null, aviso: string|null}>}
 */
export async function avaliarAdmin(env, usuario) {
  if (!usuario?.grupoId) {
    return { admin: false, grupo: null, aviso: 'Seu usuário não tem grupo no hub.' };
  }

  let grupos;
  try {
    grupos = await mapaDeGrupos(env);
  } catch (e) {
    const aviso = e instanceof ErroHub && e.codigo === 'HUB_SEM_PERMISSAO'
      ? 'A chave do hub não tem a permissão hub:user-groups:read. Sem ela o CRM não sabe quem é admin — conceda a permissão à chave no hub.'
      : `Não foi possível consultar os grupos no hub: ${e.message}`;
    return { admin: false, grupo: null, aviso };
  }

  const grupo = grupos.get(String(usuario.grupoId)) || null;
  if (!grupo) {
    return { admin: false, grupo: null, aviso: 'O grupo do seu usuário não foi encontrado no hub.' };
  }

  return { admin: gruposAdmin(env).includes(normalizarGrupo(grupo)), grupo, aviso: null };
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
