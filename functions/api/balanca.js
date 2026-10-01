/**
 * /api/balanca — a Balança Avaliativa do cliente (2.39.0).
 *
 * GET  ?cliente_id=N                      as versões, a instrução em uso e se dá para gerar
 * GET  ?cliente_id=N&html=1[&versao=V]    o documento (a última, ou a versão V)
 * POST { cliente_id }                     gera a próxima versão
 *
 * Lê do ERP as reuniões REALIZADAS dos últimos 6 meses (com a ata) e as
 * canceladas pelo cliente; do CRM, as ações do plano e o Dossiê da Reunião
 * da pré-venda. A instrução é a enviada nas Configurações (finalidade
 * 'balanca'); sem ela, a padrão V1.0 (_lib/instrucao-balanca.js). Gerar
 * de novo nunca sobrescreve. Só registra — não mexe no cliente.
 *
 * Leva de 1 a 2 minutos, como o Dossiê da Reunião: a requisição espera.
 */

import { chamarIA, chaveConfigurada } from './_lib/ia.js';
import { ambienteDeIA, provedorAtivo } from './_lib/chaves-ia.js';
import { criarVersionador } from './_lib/versionamento.js';
import { hubConfigurado, listarReunioes, mapaDeTiposDeReuniao, consultarHub, STATUS_REALIZADA } from './_lib/hub.js';
import { limparConteudo, MAX_TOKENS_DOSSIE_REUNIAO } from './_lib/dossie-reuniao.js';
import {
  SYSTEM_PROMPT, inicioDoPeriodo, montarFonte, calcularNumeros, montarPrompt, preVendaParaPrompt,
  conferirCitacoes, montarDocumento
} from './_lib/balanca.js';
import { INSTRUCAO_PADRAO, VERSAO_INSTRUCAO_PADRAO } from './_lib/instrucao-balanca.js';
import { nomeDeDocumento } from './_lib/documento-base.js';
import { TIPO_BALANCA } from './_lib/balanca.js';

/**
 * O nome do arquivo de uma versão (2.39.1): o mesmo título do documento,
 * com a versão — "Balanca_Avaliativa_Zanna-Sound_2026_10_v1.html". A tela
 * mostra este nome antes de baixar, e é com ele que o arquivo é salvo.
 */
const nomeDoArquivo = (v) => `${nomeDeDocumento(TIPO_BALANCA, v.cliente_nome, v.gerado_em)}_v${v.versao}.html`;

const balancas = criarVersionador({
  tabela: 'balancas',
  chave: 'cliente_id',
  rotulo: 'da balança avaliativa',
  colunasResumo: ['cliente_nome', 'provider', 'instrucao', 'periodo_de', 'periodo_ate', 'reunioes', 'acoes', 'citacoes', 'citacoes_nao_encontradas']
});

/** Conteúdo menor que isto não é uma balança: a IA recusou ou respondeu outra coisa. */
const CONTEUDO_MINIMO = 400;
const FECHADAS = ['concluida', 'cancelada', 'saiu_da_ata'];

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

async function clienteAtivo(db, id) {
  return db.prepare(
    'SELECT id, nome, nome_fantasia, documento, erp_id, lead_id FROM clientes WHERE id = ? AND ativo = 1'
  ).bind(id).first();
}

const nomeDoCliente = (c) => c.nome_fantasia || c.nome;

/** A instrução enviada nas Configurações, ou a padrão. */
async function instrucaoEmUso(db) {
  try {
    const enviada = await db.prepare(
      `SELECT id, versao, nome_arquivo, conteudo FROM roteiros
        WHERE finalidade = 'balanca' AND ativo = 1 ORDER BY versao DESC LIMIT 1`
    ).first();
    if (enviada) return { conteudo: enviada.conteudo, rotulo: `v${enviada.versao}`, versao: enviada.versao, nome_arquivo: enviada.nome_arquivo, padrao: false };
  } catch (e) { /* sem a 025: só a padrão */ }
  return { conteudo: INSTRUCAO_PADRAO, rotulo: `padrão ${VERSAO_INSTRUCAO_PADRAO}`, versao: VERSAO_INSTRUCAO_PADRAO, padrao: true };
}

/** As ações do plano: as do período e as que seguem em aberto. */
async function acoesDoCliente(db, erpId, desde) {
  try {
    const { results } = await db.prepare(
      `SELECT numero_cliente, descricao, status, prazo, data_prevista, responsavel, tipo_reuniao, reuniao_em
         FROM acoes_cx WHERE cliente_erp_id = ? ORDER BY numero_cliente`
    ).bind(erpId).all();
    return (results || []).filter((a) => !FECHADAS.includes(a.status) || String(a.reuniao_em || '') >= desde);
  } catch (e) {
    return [];                                   // sem a migração 012
  }
}

async function preVendaDoCliente(db, leadId) {
  if (!leadId) return null;
  try {
    const r = await db.prepare(
      `SELECT dados_json FROM dossies_reuniao WHERE lead_id = ? AND status = 'concluido'
        ORDER BY gerado_em DESC LIMIT 1`
    ).bind(leadId).first();
    return r ? preVendaParaPrompt(r.dados_json) : null;
  } catch (e) {
    return null;                                 // sem a migração 025
  }
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const clienteId = Number(searchParams.get('cliente_id'));
  if (!clienteId) return json({ error: 'Cliente ausente.' }, 400, cabecalhos);

  try {
    if (searchParams.get('html')) {
      const html = await balancas.lerHtml(db, clienteId, Number(searchParams.get('versao')) || null);
      if (!html) return json({ error: 'Balança não encontrada.', code: 'NAO_ENCONTRADA' }, 404, cabecalhos);
      return new Response(html, { status: 200, headers: { ...cabecalhos, 'Content-Type': 'text/html; charset=utf-8' } });
    }

    const cliente = await clienteAtivo(db, clienteId);
    if (!cliente) return json({ error: 'Cliente não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
    const [versoes, instrucao] = await Promise.all([balancas.listarVersoes(db, clienteId), instrucaoEmUso(db)]);
    let motivo = null;
    if (!cliente.erp_id) motivo = 'Este cliente não está vinculado ao ERP: as atas vêm de lá. Vincule-o (na Jornada, pelo CNPJ) para gerar a Balança.';
    else if (!hubConfigurado(context.env)) motivo = 'O servidor não tem a chave do hub: as atas vêm do ERP.';
    return json({
      versoes: versoes.map((v) => ({ ...v, arquivo: nomeDoArquivo(v) })),
      instrucao: { rotulo: instrucao.rotulo, padrao: instrucao.padrao, nome_arquivo: instrucao.nome_arquivo || null },
      periodo: { de: inicioDoPeriodo(), ate: new Date().toISOString().slice(0, 10) },
      pode_gerar: !motivo,
      motivo
    }, 200, cabecalhos);
  } catch (e) {
    if (/no such table/i.test(e.message || '')) return json({ versoes: [], pode_gerar: false, motivo: 'Falta aplicar a migração 026.' }, 200, cabecalhos);
    return json({ error: 'Falha ao consultar a balança.', details: e.message }, 500, cabecalhos);
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

  const cliente = await clienteAtivo(db, Number(corpo.cliente_id));
  if (!cliente) return json({ error: 'Cliente não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
  if (!cliente.erp_id) {
    return json({ error: 'Este cliente não está vinculado ao ERP: as atas vêm de lá.', code: 'SEM_ERP' }, 400, cabecalhos);
  }
  if (!hubConfigurado(env)) return json({ error: 'O servidor não tem a chave do hub.', code: 'SEM_HUB' }, 400, cabecalhos);

  const provider = await provedorAtivo(env);
  if (!chaveConfigurada(provider, env)) {
    return json({ error: 'Nenhuma IA configurada: cadastre uma chave em Configurações.', code: 'SEM_IA' }, 400, cabecalhos);
  }

  const hoje = new Date();
  const de = inicioDoPeriodo(hoje);
  const ate = hoje.toISOString().slice(0, 10);

  // Do ERP: as realizadas (com a ata), as canceladas pelo cliente e os nomes dos núcleos.
  const [realizadas, canceladas, tipos] = await Promise.all([
    consultarHub('reuniões', () => listarReunioes(env, { clienteErpId: cliente.erp_id, status: STATUS_REALIZADA, desde: de })),
    consultarHub('cancelamentos', () => listarReunioes(env, { clienteErpId: cliente.erp_id, status: 'canceled_by_customer', desde: de, maxPaginas: 3 })),
    consultarHub('tipos de reunião', () => mapaDeTiposDeReuniao(env))
  ]);
  if (!realizadas.consultado) {
    return json({ error: `O ERP não respondeu às reuniões: ${realizadas.erro?.mensagem || 'falha'}`, code: 'HUB_FALHOU' }, 502, cabecalhos);
  }
  const nomeDoNucleo = (id) => (tipos.consultado ? tipos.dado.get(id)?.nome : null) || null;
  const reunioes = realizadas.dado.reunioes.map((r) => ({
    erp_id: r.erp_id, inicio: r.inicio, titulo: r.titulo, nucleo: nomeDoNucleo(r.nucleoErpId), ata: r.ata
  }));

  const [acoes, preVenda, instrucao] = await Promise.all([
    acoesDoCliente(db, cliente.erp_id, de),
    preVendaDoCliente(db, cliente.lead_id),
    instrucaoEmUso(db)
  ]);

  const fonte = montarFonte(reunioes, acoes);
  if (!fonte.linhas.length) {
    return json({ error: 'Não há ata nem ação do plano nos últimos 6 meses para pesar.', code: 'SEM_MATERIAL' }, 400, cabecalhos);
  }
  const numeros = calcularNumeros({
    reunioes, acoes, de, ate, hoje,
    canceladas: canceladas.consultado ? canceladas.dado.reunioes.length : null
  });

  const nome = nomeDoCliente(cliente);
  const extras = {
    cliente_nome: nome, provider, instrucao: instrucao.rotulo, periodo_de: de, periodo_ate: ate,
    reunioes: reunioes.length, acoes: acoes.length
  };
  const falhou = async (mensagem, code, status) => {
    await balancas.registrarErro({ db, valorChave: cliente.id, usuario, mensagem, extras });
    return json({ error: mensagem, code }, status, cabecalhos);
  };

  let bruto;
  try {
    bruto = await chamarIA({
      provider, env,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: montarPrompt({ instrucao: instrucao.conteudo, cliente: { nome }, numeros, fonte, preVenda }),
      maxTokens: MAX_TOKENS_DOSSIE_REUNIAO,
      jsonMode: false
    });
  } catch (e) {
    return falhou(`A IA não respondeu: ${e.message}`, 'IA_FALHOU', 502);
  }

  const limpo = limparConteudo(bruto);
  if (limpo.replace(/<[^>]+>/g, '').trim().length < CONTEUDO_MINIMO) {
    return falhou('A IA devolveu um conteúdo curto demais para ser a balança. Tente de novo.', 'CONTEUDO_INSUFICIENTE', 502);
  }
  const { html: conteudo, citacoes, naoEncontradas } = conferirCitacoes(limpo, fonte.linhas);

  const agora = new Date().toISOString();
  const eu = String(usuario?.email || '').toLowerCase();
  const meta = (versao) => ({
    versao, geradoEm: agora, geradoPor: eu, instrucao: instrucao.rotulo, provider,
    citacoes, naoEncontradas, atasOmitidas: fonte.atasOmitidas
  });

  const salvo = await balancas.salvar({
    db, valorChave: cliente.id, usuario: { email: eu },
    montarHtml: (versao) => montarDocumento({ conteudo, cliente: { nome }, numeros, meta: meta(versao) }),
    dados: (versao) => ({ cliente: { nome }, numeros, meta: meta(versao), conteudo }),
    extras: { ...extras, citacoes, citacoes_nao_encontradas: naoEncontradas }
  });
  if (!salvo.ok) {
    const semTabela = /no such table/i.test(salvo.erro || '');
    return json({ error: semTabela ? 'Falta aplicar a migração 026.' : `Falha ao guardar a balança: ${salvo.erro}`, code: 'FALHA_AO_SALVAR' }, 500, cabecalhos);
  }

  console.log(`[balanca] cliente ${cliente.id} v${salvo.versao}: ${reunioes.length} reunião(ões), ${acoes.length} ação(ões), ${citacoes} citação(ões), ${naoEncontradas} não encontrada(s)`);
  return json({ ok: true, versao: salvo.versao, citacoes, citacoes_nao_encontradas: naoEncontradas, reunioes: reunioes.length, acoes: acoes.length }, 201, cabecalhos);
}
