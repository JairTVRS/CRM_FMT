/**
 * /api/proposta — geração e histórico das propostas comerciais.
 *
 * Autenticação garantida pelo _middleware.js.
 *
 * GET  ?lead_id=N                    última versão + histórico (sem o HTML)
 * GET  ?lead_id=N&html=true[&versao=] o documento, para abrir e imprimir
 * POST ?lead_id=N                    gera a próxima versão
 *
 * Regra central, herdada do dossiê: gerar de novo NUNCA sobrescreve.
 * Aqui ela pesa mais — a proposta é o documento que foi para a mão do
 * cliente, e precisa ser reproduzível exatamente como foi enviado,
 * mesmo depois de o template mudar.
 */

import { renderizarProposta, SERVICOS } from './_lib/proposta-template.js';
import { criarVersionador } from './_lib/versionamento.js';

/**
 * O versionamento é o mesmo dos dois dossiês e mora no
 * `_lib/versionamento.js` desde a 2.17.0.
 *
 * Sem `provider` nas colunas de resumo, ao contrário dos outros dois: a
 * proposta sai de um formulário preenchido por gente, não de um modelo.
 * Uma coluna que seria sempre nula documentaria uma semelhança que não
 * existe.
 */
const propostas = criarVersionador({
  tabela: 'propostas',
  chave: 'lead_id',
  rotulo: 'da proposta',
  colunasResumo: ['cliente_nome', 'documento']
});

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const texto = (v, limite = 500) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, limite) : null;
};

/** Aceita "R$ 25.424,00", "25424.00" ou número; devolve centavos. */
function paraCentavos(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return Math.round(valor * 100);

  const limpo = String(valor).replace(/[R$\s]/g, '');
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;

  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const paraData = (v) => {
  const m = String(v || '').match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
};

/**
 * Extrai do corpo apenas o que a proposta conhece, já saneado.
 *
 * Os valores comerciais — km, rescisão, início do pagamento — são
 * preenchidos na geração, e não guardados como política do sistema:
 * foi assim que combinamos, porque variam por negociação.
 */
function normalizar(corpo, lead) {
  const c = corpo || {};

  return {
    cliente: {
      nome: texto(c.cliente?.nome, 200) || lead.nome,
      documento: texto(c.cliente?.documento, 20) || lead.documento,
      cidade: texto(c.cliente?.cidade, 120) || lead.cidade
    },
    contato: {
      nome: texto(c.contato?.nome, 120) || lead.contato_nome,
      cargo: texto(c.contato?.cargo, 120),
      telefone: texto(c.contato?.telefone, 40) || lead.telefone,
      email: texto(c.contato?.email, 160) || lead.email
    },

    objeto: texto(c.objeto, 1200),

    // Só chaves conhecidas do catálogo: um valor inventado viraria uma
    // seção vazia no documento entregue ao cliente.
    escopo: Array.isArray(c.escopo)
      ? [...new Set(c.escopo.filter((k) => Object.hasOwn(SERVICOS, k)))]
      : [],

    diagnostico: {
      valor: paraCentavos(c.diagnostico?.valor),
      condicoes: texto(c.diagnostico?.condicoes, 300),
      prazo: texto(c.diagnostico?.prazo, 200)
    },
    consultoria: {
      valor: paraCentavos(c.consultoria?.valor),
      meses: texto(c.consultoria?.meses, 10),
      inicio: texto(c.consultoria?.inicio, 200),
      condicoes: texto(c.consultoria?.condicoes, 300)
    },

    km: paraCentavos(c.km),
    rescisao: texto(c.rescisao, 300),

    validade: paraData(c.validade),
    elaboradoEm: paraData(c.elaboradoEm) || new Date().toISOString().slice(0, 10),

    responsavel: {
      nome: texto(c.responsavel?.nome, 120),
      cargo: texto(c.responsavel?.cargo, 120)
    }
  };
}

async function buscarLead(db, id) {
  return db
    .prepare('SELECT * FROM leads WHERE id = ? AND ativo = 1')
    .bind(id)
    .first();
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const { searchParams } = new URL(context.request.url);
  const db = context.env.DB;

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const leadId = Number(searchParams.get('lead_id'));
  if (!leadId) return json({ error: 'Informe o lead.' }, 400, cabecalhos);

  try {
    // --- O documento, para abrir numa aba ---
    if (searchParams.get('html')) {
      const versao = Number(searchParams.get('versao')) || null;
      const html = await propostas.lerHtml(db, leadId, versao);

      if (!html) {
        return json({ error: 'Proposta não encontrada.', code: 'NAO_ENCONTRADA' }, 404, cabecalhos);
      }

      return new Response(html, {
        status: 200,
        headers: {
          ...cabecalhos,
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': 'inline'
        }
      });
    }

    // --- Histórico e dados da última, para preencher o formulário ---
    const [versoes, dados] = await Promise.all([
      propostas.listarVersoes(db, leadId),
      propostas.lerDados(db, leadId)
    ]);

    return json({ versoes, dados }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao consultar as propostas.', details: e.message }, 500, cabecalhos);
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

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos); }

  const lead = await buscarLead(db, leadId);
  if (!lead) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

  const dados = normalizar(corpo, lead);

  if (dados.escopo.length === 0) {
    return json({
      error: 'Selecione ao menos um serviço para compor o escopo da proposta.',
      code: 'ESCOPO_VAZIO'
    }, 400, cabecalhos);
  }

  try {
    // A proposta não estampa a versão no documento — ao contrário dos
    // dossiês, cuja capa a exibe. Por isso `montarHtml` ignora o número
    // que recebe; a assinatura é a do módulo comum, não uma exigência
    // deste documento.
    const gravacao = await propostas.salvar({
      db,
      valorChave: leadId,
      usuario,
      dados,
      montarHtml: () => renderizarProposta(dados),
      extras: {
        documento: dados.cliente.documento || null,
        cliente_nome: dados.cliente.nome || null
      }
    });

    if (!gravacao.ok) {
      // Desde a 2.17.0 a proposta também deixa rastro quando falha. Era a
      // única das três sem isso — e foi justamente ela que quebrou em
      // produção na v2.13.0, sem que o banco guardasse uma linha sequer.
      await propostas.registrarErro({
        db,
        valorChave: leadId,
        usuario,
        mensagem: gravacao.erro,
        extras: { cliente_nome: dados.cliente.nome || null }
      });

      return json({ error: 'Falha ao gerar a proposta.', details: gravacao.erro }, 500, cabecalhos);
    }

    console.log(`[proposta] lead ${leadId} v${gravacao.versao} por ${usuario.email}`);
    return json({
      ok: true,
      versao: gravacao.versao,
      tamanhoBytes: gravacao.tamanhoBytes
    }, 201, cabecalhos);

  } catch (e) {
    // Sobrou algo que o `salvar` não previu — renderização, por exemplo.
    // Também deixa rastro, pelo mesmo motivo.
    await propostas.registrarErro({
      db, valorChave: leadId, usuario, mensagem: e.message,
      extras: { cliente_nome: dados?.cliente?.nome || null }
    });

    return json({ error: 'Falha ao gerar a proposta.', details: e.message }, 500, cabecalhos);
  }
}
