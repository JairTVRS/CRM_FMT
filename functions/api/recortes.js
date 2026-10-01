/**
 * /api/recortes — recortes e roteiro da reunião (2.37.0).
 *
 * GET  ?reuniao_id=N             a última análise da reunião (ou null)
 * POST { reuniao_id, forcar }    analisa a conversa agora e guarda
 *
 * Pedido de 01/10/2026 (lote JL): durante a reunião, as falas do lead que
 * revelam expectativa, dor, objeção ou como decide; o roteiro coberto e o
 * que falta; e até 3 perguntas sugeridas. A IA é a escolhida nas
 * Configurações. O que ela CITA é conferido por código contra a
 * transcrição (_lib/recortes.js) — citação que não existe é descartada.
 *
 * Sem trecho novo desde a última análise, a POST devolve a última sem
 * chamar a IA (`sem_novidade`): a tela pede a cada ~2 min, e a reunião
 * pode estar em silêncio.
 */

import { chamarIA, extrairJson, chaveConfigurada } from './_lib/ia.js';
import { ambienteDeIA, provedorAtivo } from './_lib/chaves-ia.js';
import {
  conferirAnalise, separacaoDeVozes, montarPrompt, resumoDoDossie,
  SYSTEM_PROMPT, CONVERSA_MINIMA
} from './_lib/recortes.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

async function reuniaoComLead(db, id) {
  return db.prepare(
    `SELECT a.id, a.lead_id, a.tipo, a.tipo_reuniao_erp_id, a.tipo_reuniao_nome,
            l.nome AS lead_nome, l.documento AS lead_documento
       FROM agenda_lead a JOIN leads l ON l.id = a.lead_id
      WHERE a.id = ? AND a.ativo = 1`
  ).bind(id).first();
}

/** A transcrição inteira da reunião: todas as gravações (retomar cria outra). */
async function trechosDaReuniao(db, reuniaoId) {
  const { results } = await db.prepare(
    `SELECT t.gravacao_id, t.origem, t.inicio_s, t.texto
       FROM transcricao_trechos t JOIN gravacoes g ON g.id = t.gravacao_id
      WHERE g.reuniao_id = ?
      ORDER BY t.gravacao_id, t.inicio_s`
  ).bind(reuniaoId).all();
  return results || [];
}

async function ultimaAnalise(db, reuniaoId) {
  const r = await db.prepare(
    'SELECT * FROM reuniao_analises WHERE reuniao_id = ? ORDER BY gerado_em DESC, id DESC LIMIT 1'
  ).bind(reuniaoId).first();
  if (!r) return null;
  let resultado = null;
  try { resultado = JSON.parse(r.resultado); } catch (e) { /* ilegível: fica sem */ }
  return { id: r.id, trechos: r.trechos, provedor: r.provedor, descartados: r.descartados,
    gerado_por: r.gerado_por, gerado_em: r.gerado_em, ...resultado };
}

/**
 * O roteiro da reunião: a versão em que a gravação começou (a reunião fica
 * presa a ela); sem isso, o roteiro em vigor do tipo.
 */
async function roteiroDaReuniao(db, reuniao) {
  try {
    const daGravacao = await db.prepare(
      `SELECT r.id, r.versao, r.tipo_reuniao_nome, r.conteudo FROM gravacoes g JOIN roteiros r ON r.id = g.roteiro_id
        WHERE g.reuniao_id = ? ORDER BY g.id DESC LIMIT 1`
    ).bind(reuniao.id).first();
    if (daGravacao) return daGravacao;
    if (!reuniao.tipo_reuniao_erp_id) return null;
    return await db.prepare(
      `SELECT id, versao, tipo_reuniao_nome, conteudo FROM roteiros
        WHERE tipo_reuniao_erp_id = ? AND ativo = 1 ORDER BY versao DESC LIMIT 1`
    ).bind(reuniao.tipo_reuniao_erp_id).first();
  } catch (e) {
    return null;                                   // sem a migração 019
  }
}

async function dossieDoLead(db, documento) {
  const cnpj = String(documento || '').replace(/\D/g, '');
  if (cnpj.length !== 14) return null;
  try {
    const r = await db.prepare(
      `SELECT dados_json FROM dossies WHERE cnpj = ? AND status = 'concluido' ORDER BY versao DESC LIMIT 1`
    ).bind(cnpj).first();
    return r ? resumoDoDossie(r.dados_json) : null;
  } catch (e) {
    return null;
  }
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const id = Number(new URL(context.request.url).searchParams.get('reuniao_id'));
  if (!id) return json({ error: 'Reunião ausente.' }, 400, cabecalhos);
  try {
    return json({ analise: await ultimaAnalise(db, id) }, 200, cabecalhos);
  } catch (e) {
    if (/no such table/i.test(e.message || '')) return json({ analise: null, aviso: 'Falta aplicar a migração 024.' }, 200, cabecalhos);
    return json({ error: 'Falha ao ler a análise.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — analisa agora
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const env = await ambienteDeIA(context.env);
  const db = env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  const reuniao = await reuniaoComLead(db, Number(corpo.reuniao_id));
  if (!reuniao || reuniao.tipo !== 'reuniao') {
    return json({ error: 'Reunião não encontrada.', code: 'NAO_ENCONTRADA' }, 404, cabecalhos);
  }

  const trechos = await trechosDaReuniao(db, reuniao.id);
  const tamanho = trechos.reduce((n, t) => n + String(t.texto || '').length, 0);
  if (tamanho < CONVERSA_MINIMA) {
    return json({ error: 'Ainda há pouca conversa para analisar.', code: 'POUCA_CONVERSA' }, 400, cabecalhos);
  }

  // Sem a 024 não há anterior; o aviso da migração vem ao guardar.
  const anterior = await ultimaAnalise(db, reuniao.id).catch((e) => {
    if (/no such table/i.test(e.message || '')) return null;
    throw e;
  });
  if (anterior && anterior.trechos === trechos.length && !corpo.forcar) {
    return json({ analise: anterior, sem_novidade: true }, 200, cabecalhos);
  }

  const provider = await provedorAtivo(env);
  if (!chaveConfigurada(provider, env)) {
    return json({ error: 'Nenhuma IA configurada: cadastre uma chave em Configurações.', code: 'SEM_IA' }, 400, cabecalhos);
  }

  const [roteiro, dossie] = await Promise.all([roteiroDaReuniao(db, reuniao), dossieDoLead(db, reuniao.lead_documento)]);
  const { separacao } = separacaoDeVozes(trechos);

  let bruto;
  try {
    bruto = await chamarIA({
      provider, env,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: montarPrompt({ leadNome: reuniao.lead_nome, separacao, dossie, roteiro: roteiro?.conteudo, trechos }),
      maxTokens: 2500,
      jsonMode: true
    });
  } catch (e) {
    return json({ error: `A IA não respondeu: ${e.message}`, code: 'IA_FALHOU' }, 502, cabecalhos);
  }
  const lido = extrairJson(bruto);
  if (!lido) return json({ error: 'A IA não devolveu um JSON válido. Tente de novo.', code: 'JSON_INVALIDO' }, 502, cabecalhos);

  const conferido = conferirAnalise(lido, trechos, { temRoteiro: !!roteiro });
  const resultado = {
    recortes: conferido.recortes,
    roteiro: roteiro ? { id: roteiro.id, versao: roteiro.versao, nome: roteiro.tipo_reuniao_nome, itens: conferido.roteiro } : null,
    sugestoes: conferido.sugestoes,
    separacao: conferido.separacao,
    com_dossie: !!dossie
  };
  const agora = new Date().toISOString();
  const eu = String(usuario?.email || '').toLowerCase();

  try {
    await db.prepare(
      `INSERT INTO reuniao_analises (reuniao_id, lead_id, trechos, provedor, resultado, descartados, gerado_por, gerado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(reuniao.id, reuniao.lead_id, trechos.length, provider, JSON.stringify(resultado),
      conferido.descartados, eu, agora).run();
  } catch (e) {
    const semTabela = /no such table/i.test(e.message || '');
    return json({ error: semTabela ? 'Falta aplicar a migração 024.' : 'Falha ao guardar a análise.', details: e.message }, 500, cabecalhos);
  }

  console.log(`[recortes] reunião ${reuniao.id}: ${resultado.recortes.length} recorte(s), ${conferido.descartados} descartado(s), ${provider}`);
  return json({ analise: await ultimaAnalise(db, reuniao.id) }, 200, cabecalhos);
}
