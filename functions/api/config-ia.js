/**
 * /api/config-ia — provedor de IA e chaves (2.34.0).
 *
 * GET  qualquer usuário: o provedor em uso, a situação de cada chave
 *      (sem a chave!) e se o Workers AI está ligado
 * PUT  só admin, um de três pedidos:
 *        { provedor_ativo: 'deepseek' }           escolhe o provedor
 *        { provedor: 'chatgpt', chave: 'sk-…' }   cadastra/troca a chave
 *        { provedor: 'chatgpt', remover: true }   apaga a chave do CRM
 *
 * A chave do painel da Cloudflare vale primeiro e não se apaga daqui.
 */

import { PROVEDORES } from './_lib/ia.js';
import {
  ambienteDeIA, situacaoDasChaves, provedorAtivo, provedorEscolhido, cifrar, NOME_PROVEDOR
} from './_lib/chaves-ia.js';
import { exigirAdmin } from './_lib/admin.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

async function situacao(env) {
  const envIA = await ambienteDeIA(env);
  return {
    provedorAtivo: await provedorAtivo(envIA),
    provedorEscolhido: env.DB ? await provedorEscolhido(env.DB) : null,
    provedores: await situacaoDasChaves(env),
    // O Workers AI (transcrição grátis dos testes, 2.35.0) é um binding
    // do projeto no painel, não uma chave.
    workersAI: !!env.AI,
    podeGuardarChave: !!env.CHAVES_SECRET
  };
}

export async function onRequestGet(context) {
  return json(await situacao(context.env), 200, context.data.cabecalhos);
}

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const env = context.env;
  const db = env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const recusa = await exigirAdmin(context);
  if (recusa) return recusa;

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  const agora = new Date().toISOString();

  try {
    // --- Provedor em uso ---
    if (corpo.provedor_ativo !== undefined) {
      if (!PROVEDORES.includes(corpo.provedor_ativo)) {
        return json({ error: 'Provedor desconhecido.', code: 'PROVEDOR_INVALIDO' }, 400, cabecalhos);
      }
      await db.prepare(
        `INSERT INTO config_geral (chave, valor, atualizado_por, atualizado_em)
         VALUES ('provedor_ativo', ?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor,
           atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em`
      ).bind(corpo.provedor_ativo, usuario.email, agora).run();
      console.log(`[config-ia] provedor ativo = ${corpo.provedor_ativo} por ${usuario.email}`);
      return json(await situacao(env), 200, cabecalhos);
    }

    const provedor = corpo.provedor;
    if (!PROVEDORES.includes(provedor)) {
      return json({ error: 'Provedor desconhecido.', code: 'PROVEDOR_INVALIDO' }, 400, cabecalhos);
    }

    // --- Apagar a chave do CRM ---
    if (corpo.remover) {
      await db.prepare('DELETE FROM chaves_ia WHERE provedor = ?').bind(provedor).run();
      console.log(`[config-ia] chave de ${provedor} removida por ${usuario.email}`);
      return json(await situacao(env), 200, cabecalhos);
    }

    // --- Cadastrar ou trocar ---
    if (!env.CHAVES_SECRET) {
      return json({
        error: 'O servidor não tem o segredo CHAVES_SECRET, e sem ele a chave ficaria guardada em claro. Cadastre-o no painel da Cloudflare.',
        code: 'SEM_CHAVES_SECRET'
      }, 503, cabecalhos);
    }
    const chave = String(corpo.chave || '').trim();
    if (chave.length < 20 || /\s/.test(chave)) {
      return json({ error: `Isso não parece uma chave de ${NOME_PROVEDOR[provedor]}. Cole a chave inteira.`, code: 'CHAVE_INVALIDA' }, 400, cabecalhos);
    }

    await db.prepare(
      `INSERT INTO chaves_ia (provedor, cifrada, final, atualizado_por, atualizado_em)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provedor) DO UPDATE SET cifrada = excluded.cifrada, final = excluded.final,
         atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em`
    ).bind(provedor, await cifrar(chave, env.CHAVES_SECRET), chave.slice(-4), usuario.email, agora).run();

    // Nunca a chave no log — só quem mexeu e em qual provedor.
    console.log(`[config-ia] chave de ${provedor} cadastrada por ${usuario.email}`);
    return json(await situacao(env), 200, cabecalhos);

  } catch (e) {
    const semTabela = /no such table/i.test(e.message || '');
    return json({
      error: semTabela ? 'Falta aplicar a migração 019.' : 'Falha ao salvar a configuração de IA.',
      details: e.message
    }, 500, cabecalhos);
  }
}
