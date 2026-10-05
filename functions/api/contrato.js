/**
 * /api/contrato — o contrato de prestação de serviços (Lote G, 2.40.0).
 *
 * GET  ?lead_id=N                      versões + o que falta para gerar
 * GET  ?lead_id=N&html=1[&versao=V]    o documento
 * GET  ?cliente_id=N                   as versões do lead de origem (ficha do cliente)
 * POST ?lead_id=N                      gera a próxima versão
 *
 * O contrato é o quarto documento do `_lib/versionamento.js`: gerar de
 * novo NUNCA sobrescreve, e o HTML guardado é o que foi para assinatura.
 * Tudo vem do banco — o lead, a última proposta, a forma de preço e a
 * contratada —; a tela salva o lead antes de pedir a geração.
 */

import { criarVersionador } from './_lib/versionamento.js';
import { prepararContrato, buscarContratadaDoLead, hojeEmBrasilia } from './_lib/contrato.js';
import { renderizarContrato } from './_lib/contrato-template.js';
import { nomeDeDocumento, TIPO_DOCUMENTO } from './_lib/documento-base.js';
import { registrarEventoLead } from './_lib/lead-eventos.js';

const contratos = criarVersionador({
  tabela: 'contratos',
  chave: 'lead_id',
  rotulo: 'do contrato',
  colunasResumo: ['cliente_nome', 'documento', 'proposta_versao']
});

const propostas = criarVersionador({ tabela: 'propostas', chave: 'lead_id', rotulo: 'da proposta' });

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

/** O nome do arquivo de uma versão (o padrão da 2.39.1): Contrato_Cliente_2026_10_v1.html */
const comArquivo = (v) => ({
  ...v,
  arquivo: `${nomeDeDocumento(TIPO_DOCUMENTO.CONTRATO, v.cliente_nome, v.gerado_em)}_v${v.versao}.html`
});

/** O lead, a última proposta, a forma e a contratada — o que `prepararContrato` precisa. */
export async function carregarContexto(db, leadId) {
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ? AND ativo = 1').bind(leadId).first();
  if (!lead) return null;

  const [ultima, dadosProposta, forma, contratada] = await Promise.all([
    propostas.buscarUltima(db, leadId),
    propostas.lerDados(db, leadId),
    lead.forma_preco_id
      ? db.prepare('SELECT * FROM formas_preco WHERE id = ?').bind(lead.forma_preco_id).first()
      : null,
    buscarContratadaDoLead(db, lead)
  ]);

  return {
    lead,
    proposta: ultima && dadosProposta ? { versao: ultima.versao, gerado_em: ultima.gerado_em, dados: dadosProposta } : null,
    forma: forma || null,
    contratada
  };
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    // --- Na ficha do cliente: o contrato do lead que o originou ---
    const clienteId = Number(searchParams.get('cliente_id'));
    if (clienteId) {
      const lead = await db.prepare(
        `SELECT l.id, l.nome FROM clientes c JOIN leads l ON l.id = c.lead_id WHERE c.id = ?`
      ).bind(clienteId).first();
      if (!lead) return json({ lead: null, versoes: [] }, 200, cabecalhos);
      const versoes = await contratos.listarVersoes(db, lead.id);
      return json({ lead, versoes: versoes.map(comArquivo) }, 200, cabecalhos);
    }

    const leadId = Number(searchParams.get('lead_id'));
    if (!leadId) return json({ error: 'Informe o lead.' }, 400, cabecalhos);

    if (searchParams.get('html')) {
      const html = await contratos.lerHtml(db, leadId, Number(searchParams.get('versao')) || null);
      if (!html) return json({ error: 'Contrato não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
      return new Response(html, {
        status: 200,
        headers: { ...cabecalhos, 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'inline' }
      });
    }

    const ctx = await carregarContexto(db, leadId);
    if (!ctx) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

    const { faltando } = prepararContrato({ ...ctx, hoje: hojeEmBrasilia() });
    const versoes = await contratos.listarVersoes(db, leadId);
    return json({
      versoes: versoes.map(comArquivo),
      faltando,
      origem: {
        proposta: ctx.proposta ? { versao: ctx.proposta.versao, gerado_em: ctx.proposta.gerado_em } : null,
        forma: ctx.forma ? { id: ctx.forma.id, nome: ctx.forma.nome } : null,
        contratada: ctx.contratada ? { id: ctx.contratada.id, razao_social: ctx.contratada.razao_social } : null
      }
    }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao consultar o contrato.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — gera a próxima versão
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const leadId = Number(searchParams.get('lead_id'));
  if (!leadId) return json({ error: 'Informe o lead.' }, 400, cabecalhos);

  let dados = null;
  try {
    const ctx = await carregarContexto(db, leadId);
    if (!ctx) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

    const preparo = prepararContrato({ ...ctx, hoje: hojeEmBrasilia() });
    if (preparo.faltando.length) {
      return json({
        error: `Para gerar o contrato falta:\n• ${preparo.faltando.join('\n• ')}`,
        code: 'FALTANDO',
        faltando: preparo.faltando
      }, 400, cabecalhos);
    }
    dados = { ...preparo.dados, gerado: { em: new Date().toISOString(), por: usuario.email } };

    const gravacao = await contratos.salvar({
      db,
      valorChave: leadId,
      usuario,
      dados,
      montarHtml: (versao) => renderizarContrato(dados, versao),
      extras: {
        cliente_nome: dados.contratante.nome,
        documento: dados.contratante.documento,
        contratada_id: dados.contratada.id,
        proposta_versao: dados.proposta.versao
      }
    });

    if (!gravacao.ok) {
      await contratos.registrarErro({ db, valorChave: leadId, usuario, mensagem: gravacao.erro, extras: { cliente_nome: dados.contratante.nome } });
      return json({ error: 'Falha ao gerar o contrato.', details: gravacao.erro }, 500, cabecalhos);
    }

    console.log(`[contrato] lead ${leadId} v${gravacao.versao} por ${usuario.email}`);
    await registrarEventoLead(db, {
      leadId, evento: 'contrato_gerado', por: usuario.email,
      detalhe: { versao: gravacao.versao, proposta_versao: dados.proposta.versao }
    });
    return json({ ok: true, versao: gravacao.versao, tamanhoBytes: gravacao.tamanhoBytes }, 201, cabecalhos);

  } catch (e) {
    await contratos.registrarErro({ db, valorChave: leadId, usuario, mensagem: e.message, extras: { cliente_nome: dados?.contratante?.nome || null } })
      .catch(() => {});
    return json({ error: 'Falha ao gerar o contrato.', details: e.message }, 500, cabecalhos);
  }
}
