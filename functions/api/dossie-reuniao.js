/**
 * /api/dossie-reuniao — o Dossiê da Reunião (2.38.0).
 *
 * GET  ?reuniao_id=N                      as versões, a instrução em vigor e se dá para gerar
 * GET  ?cliente_id=N                      a pré-venda do cliente: os dossiês do lead de origem (2.38.2)
 * GET  ?reuniao_id=N&html=1[&versao=V]    o documento (a última, ou a versão V)
 * POST { reuniao_id }                     gera a próxima versão
 *
 * Pedido de 01/10/2026. A instrução é o .md enviado nas Configurações
 * para o tipo da reunião (finalidade 'dossie_reuniao'). A IA é a escolhida
 * nas Configurações. Gerar de novo nunca sobrescreve: cria a versão
 * seguinte (_lib/versionamento.js). Só registra — não mexe no lead.
 *
 * Leva de 1 a 2 minutos: a IA escreve um documento longo. A requisição
 * espera a resposta (uma Function não tem limite de tempo enquanto o
 * navegador espera; o waitUntil teria, de 30 s).
 */

import { chamarIA, chaveConfigurada } from './_lib/ia.js';
import { ambienteDeIA, provedorAtivo } from './_lib/chaves-ia.js';
import { criarVersionador } from './_lib/versionamento.js';
import { separacaoDeVozes, CONVERSA_MINIMA } from './_lib/recortes.js';
import {
  SYSTEM_PROMPT, MAX_TOKENS_DOSSIE_REUNIAO, montarPrompt, limparConteudo, conferirCitacoes, montarDocumento
} from './_lib/dossie-reuniao.js';

const dossiesReuniao = criarVersionador({
  tabela: 'dossies_reuniao',
  chave: 'reuniao_id',
  rotulo: 'do dossiê da reunião',
  colunasResumo: ['provider', 'instrucao_versao', 'citacoes', 'citacoes_nao_encontradas']
});

/** Conteúdo menor que isto não é um dossiê: a IA recusou ou respondeu outra coisa. */
const CONTEUDO_MINIMO = 400;

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const ROTULO_LOCAL = { online: 'Online', presencial: 'Presencial', externo: 'Externo' };

async function reuniaoCompleta(db, id) {
  return db.prepare(
    `SELECT a.*, l.nome AS lead_nome, u.nome AS responsavel_nome
       FROM agenda_lead a
       JOIN leads l ON l.id = a.lead_id
       LEFT JOIN usuarios_crm u ON u.email = a.responsavel
      WHERE a.id = ? AND a.ativo = 1`
  ).bind(id).first();
}

/** A instrução em vigor do tipo da reunião. */
async function instrucaoDoTipo(db, tipoId) {
  if (!tipoId) return null;
  try {
    return await db.prepare(
      `SELECT id, versao, nome_arquivo, conteudo, enviado_em FROM roteiros
        WHERE tipo_reuniao_erp_id = ? AND finalidade = 'dossie_reuniao' AND ativo = 1
        ORDER BY versao DESC LIMIT 1`
    ).bind(tipoId).first();
  } catch (e) {
    return null;                                     // sem a migração 025
  }
}

async function trechosDaReuniao(db, reuniaoId) {
  const { results } = await db.prepare(
    `SELECT t.gravacao_id, t.origem, t.inicio_s, t.texto
       FROM transcricao_trechos t JOIN gravacoes g ON g.id = t.gravacao_id
      WHERE g.reuniao_id = ? ORDER BY t.gravacao_id, t.inicio_s`
  ).bind(reuniaoId).all();
  return results || [];
}

/** Por que (ainda) não dá para gerar — ou null se dá. */
function impedimento(reuniao, instrucao, tamanhoDaConversa) {
  if (!reuniao.finalizada_em) return { code: 'NAO_REALIZADA', error: 'O dossiê é da reunião finalizada: finalize-a primeiro.' };
  if (!reuniao.tipo_reuniao_erp_id) return { code: 'SEM_TIPO', error: 'A reunião não tem tipo: escolha o tipo de reunião e salve.' };
  if (!instrucao) {
    return { code: 'SEM_INSTRUCAO', error: `O tipo "${reuniao.tipo_reuniao_nome || 'desta reunião'}" ainda não tem a instrução do dossiê: envie o arquivo em Configurações → Roteiros.` };
  }
  if (tamanhoDaConversa < CONVERSA_MINIMA) return { code: 'POUCA_CONVERSA', error: 'A reunião não tem transcrição suficiente para o dossiê.' };
  return null;
}

/** Os dados da reunião como aparecem no documento e no prompt. */
function dadosDaReuniao(r) {
  const dataBr = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const horaBr = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const min = r.iniciada_em && r.finalizada_em ? Math.round((Date.parse(r.finalizada_em) - Date.parse(r.iniciada_em)) / 60000) : null;
  return {
    lead_nome: r.lead_nome,
    tipo_reuniao_nome: r.tipo_reuniao_nome,
    data: r.iniciada_em ? dataBr(r.iniciada_em) : null,
    horario: r.iniciada_em && r.finalizada_em ? `${horaBr(r.iniciada_em)} às ${horaBr(r.finalizada_em)} (${min} min)` : null,
    condutor: r.responsavel_nome || r.responsavel || null,
    participantes: r.participantes || null,
    local: [ROTULO_LOCAL[r.local_tipo], r.local_texto].filter(Boolean).join(' — ') || null
  };
}

/**
 * A PRÉ-VENDA DO CLIENTE (2.38.2). Pedido de 01/10/2026: o Dossiê da
 * Reunião vai junto quando o lead vira cliente. Nada é copiado — o cliente
 * guarda de qual lead veio (`clientes.lead_id`, desde a conversão) e cada
 * dossiê guarda o seu lead; então os dossiês aparecem na ficha do cliente,
 * inclusive os gerados depois da conversão.
 *
 * @returns { lead: {id, nome} | null, reunioes: [{ reuniao_id, inicio, tipo_reuniao_nome, iniciada_em, finalizada_em, versoes }] }
 */
async function preVendaDoCliente(db, clienteId) {
  const cliente = await db.prepare(
    `SELECT c.lead_id, l.nome AS lead_nome FROM clientes c LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.id = ? AND c.ativo = 1`
  ).bind(clienteId).first();
  if (!cliente?.lead_id) return { lead: null, reunioes: [] };

  const { results } = await db.prepare(
    `SELECT d.reuniao_id, d.versao, d.gerado_em, d.gerado_por, d.instrucao_versao, d.citacoes, d.citacoes_nao_encontradas,
            a.inicio, a.tipo_reuniao_nome, a.iniciada_em, a.finalizada_em
       FROM dossies_reuniao d
       LEFT JOIN agenda_lead a ON a.id = d.reuniao_id
      WHERE d.lead_id = ? AND d.status = 'concluido'
      ORDER BY a.inicio DESC, d.reuniao_id DESC, d.versao DESC`
  ).bind(cliente.lead_id).all();

  const porReuniao = new Map();
  for (const r of results || []) {
    if (!porReuniao.has(r.reuniao_id)) {
      porReuniao.set(r.reuniao_id, {
        reuniao_id: r.reuniao_id, inicio: r.inicio, tipo_reuniao_nome: r.tipo_reuniao_nome,
        iniciada_em: r.iniciada_em, finalizada_em: r.finalizada_em, versoes: []
      });
    }
    porReuniao.get(r.reuniao_id).versoes.push({
      versao: r.versao, gerado_em: r.gerado_em, gerado_por: r.gerado_por, instrucao_versao: r.instrucao_versao,
      citacoes: r.citacoes, citacoes_nao_encontradas: r.citacoes_nao_encontradas
    });
  }
  return { lead: { id: cliente.lead_id, nome: cliente.lead_nome }, reunioes: [...porReuniao.values()] };
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  // A pré-venda do cliente (2.38.2): os dossiês das reuniões do lead de origem.
  const clienteId = Number(searchParams.get('cliente_id'));
  if (clienteId) {
    try {
      return json(await preVendaDoCliente(db, clienteId), 200, cabecalhos);
    } catch (e) {
      if (/no such table/i.test(e.message || '')) return json({ reunioes: [], aviso: 'Falta aplicar a migração 025.' }, 200, cabecalhos);
      return json({ error: 'Falha ao consultar a pré-venda.', details: e.message }, 500, cabecalhos);
    }
  }

  const reuniaoId = Number(searchParams.get('reuniao_id'));
  if (!reuniaoId) return json({ error: 'Reunião ausente.' }, 400, cabecalhos);

  try {
    if (searchParams.get('html')) {
      const html = await dossiesReuniao.lerHtml(db, reuniaoId, Number(searchParams.get('versao')) || null);
      if (!html) return json({ error: 'Dossiê não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
      return new Response(html, { status: 200, headers: { ...cabecalhos, 'Content-Type': 'text/html; charset=utf-8' } });
    }

    const reuniao = await reuniaoCompleta(db, reuniaoId);
    if (!reuniao) return json({ error: 'Reunião não encontrada.', code: 'NAO_ENCONTRADA' }, 404, cabecalhos);
    const [versoes, instrucao, trechos] = await Promise.all([
      dossiesReuniao.listarVersoes(db, reuniaoId),
      instrucaoDoTipo(db, reuniao.tipo_reuniao_erp_id),
      trechosDaReuniao(db, reuniaoId)
    ]);
    const tamanho = trechos.reduce((n, t) => n + String(t.texto || '').length, 0);
    const motivo = impedimento(reuniao, instrucao, tamanho);
    return json({
      versoes,
      instrucao: instrucao ? { versao: instrucao.versao, nome_arquivo: instrucao.nome_arquivo } : null,
      pode_gerar: !motivo,
      motivo: motivo?.error || null
    }, 200, cabecalhos);
  } catch (e) {
    if (/no such table/i.test(e.message || '')) return json({ versoes: [], pode_gerar: false, motivo: 'Falta aplicar a migração 025.' }, 200, cabecalhos);
    return json({ error: 'Falha ao consultar o dossiê da reunião.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — gera a próxima versão
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

  const reuniao = await reuniaoCompleta(db, Number(corpo.reuniao_id));
  if (!reuniao || reuniao.tipo !== 'reuniao') return json({ error: 'Reunião não encontrada.', code: 'NAO_ENCONTRADA' }, 404, cabecalhos);

  const [instrucao, trechos] = await Promise.all([
    instrucaoDoTipo(db, reuniao.tipo_reuniao_erp_id),
    trechosDaReuniao(db, reuniao.id)
  ]);
  const tamanho = trechos.reduce((n, t) => n + String(t.texto || '').length, 0);
  const motivo = impedimento(reuniao, instrucao, tamanho);
  if (motivo) return json(motivo, 400, cabecalhos);

  const provider = await provedorAtivo(env);
  if (!chaveConfigurada(provider, env)) {
    return json({ error: 'Nenhuma IA configurada: cadastre uma chave em Configurações.', code: 'SEM_IA' }, 400, cabecalhos);
  }

  const dados = dadosDaReuniao(reuniao);
  const { separacao } = separacaoDeVozes(trechos);
  const extras = {
    lead_id: reuniao.lead_id, lead_nome: reuniao.lead_nome, provider,
    instrucao_id: instrucao.id, instrucao_versao: instrucao.versao
  };
  const falhou = async (mensagem, code, status) => {
    await dossiesReuniao.registrarErro({ db, valorChave: reuniao.id, usuario, mensagem, extras });
    return json({ error: mensagem, code }, status, cabecalhos);
  };

  let bruto;
  try {
    bruto = await chamarIA({
      provider, env,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: montarPrompt({ instrucao: instrucao.conteudo, reuniao: dados, separacao, trechos }),
      maxTokens: MAX_TOKENS_DOSSIE_REUNIAO,
      jsonMode: false
    });
  } catch (e) {
    return falhou(`A IA não respondeu: ${e.message}`, 'IA_FALHOU', 502);
  }

  const limpo = limparConteudo(bruto);
  if (limpo.replace(/<[^>]+>/g, '').trim().length < CONTEUDO_MINIMO) {
    return falhou('A IA devolveu um conteúdo curto demais para ser o dossiê. Tente de novo.', 'CONTEUDO_INSUFICIENTE', 502);
  }
  const { html: conteudo, citacoes, naoEncontradas } = conferirCitacoes(limpo, trechos);

  const agora = new Date().toISOString();
  const eu = String(usuario?.email || '').toLowerCase();
  const meta = (versao) => ({
    versao, geradoEm: agora, geradoPor: eu, instrucaoVersao: instrucao.versao, provider,
    citacoes, naoEncontradas, separacao
  });

  const salvo = await dossiesReuniao.salvar({
    db, valorChave: reuniao.id, usuario: { email: eu },
    montarHtml: (versao) => montarDocumento({ conteudo, reuniao: dados, meta: meta(versao) }),
    dados: (versao) => ({ reuniao: dados, meta: meta(versao), conteudo }),
    extras: { ...extras, citacoes, citacoes_nao_encontradas: naoEncontradas }
  });
  if (!salvo.ok) {
    const semTabela = /no such table/i.test(salvo.erro || '');
    return json({ error: semTabela ? 'Falta aplicar a migração 025.' : `Falha ao guardar o dossiê: ${salvo.erro}`, code: 'FALHA_AO_SALVAR' }, 500, cabecalhos);
  }

  console.log(`[dossie-reuniao] reunião ${reuniao.id} v${salvo.versao}: ${citacoes} citação(ões), ${naoEncontradas} não encontrada(s), ${provider}`);
  return json({ ok: true, versao: salvo.versao, citacoes, citacoes_nao_encontradas: naoEncontradas }, 201, cabecalhos);
}
