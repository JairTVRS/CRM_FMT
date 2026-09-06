/**
 * /api/conversao — o lead vira cliente.
 *
 * Autenticação garantida pelo _middleware.js.
 *
 * GET  ?lead_id=N   o que a tela de conversão precisa saber
 * POST ?lead_id=N   converte, criando a linha em `clientes`
 *
 * É o primeiro dos DOIS caminhos que levam um cliente à trilha de CX. O
 * outro — os ativos que já existem no ERP aparecerem sozinhos — depende
 * da chave do hub com escopo ampliado e não está aqui.
 *
 * TRÊS COISAS QUE DEFINEM O DESENHO
 *
 * 1. Lead finalizado NÃO vira cliente sozinho. Abre uma tela de setup, e
 *    só com ela preenchida grava. Decisão registrada no roadmap: a
 *    conversão exige informação que o funil não tem — etapa da jornada,
 *    núcleos de atendimento, data de início da relação.
 *
 * 2. Endpoint separado do `/api/clientes` de propósito. Aquele é o
 *    cadastro manual, e ele exclui `lead_id` e `erp_id` da lista de
 *    campos justamente para que nenhuma requisição carimbe um vínculo à
 *    mão. Aqui o `lead_id` é o assunto, não um campo do formulário.
 *
 * 3. A TRAVA DO ERP se liga sozinha. A regra do roadmap — "todo cliente
 *    de CX tem que existir no ERP" — só pode ser cumprida com a chave do
 *    hub. Então o comportamento depende do que o ambiente tem:
 *
 *      chave presente e o CNPJ existe no ERP  → converte e grava `erp_id`
 *      chave presente e o CNPJ NÃO existe     → barra e avisa
 *      chave ausente ou o hub fora do ar      → converte com `erp_id` nulo
 *
 *    A última linha é deliberada: barrar sem poder verificar deixaria a
 *    conversão inutilizável, e um cliente sem `erp_id` já é dito na tela
 *    como "sem ERP" — cadastro não conferido, que é diferente de cliente
 *    fora do ERP.
 */

import { limparCnpj, cnpjValido } from './_lib/cnpj.js';
import { buscarClientePorCnpj, hubConfigurado, ErroHub } from './_lib/hub.js';

const PIPELINE_JORNADA = 'jornada';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const texto = (v, limite = 200) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, limite) : null;
};

/** A escala 1–6 é a do ERP, e na conversão ela é herdada, não redigitada. */
function normalizarClassificacao(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

function normalizarNucleos(valor) {
  if (!Array.isArray(valor)) return '[]';
  const ids = [...new Set(
    valor.map(Number).filter((n) => Number.isInteger(n) && n > 0)
  )].slice(0, 20);
  return JSON.stringify(ids);
}

function paraDataIso(valor) {
  const t = texto(valor, 20);
  if (!t) return null;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!br) return null;
  const [, d, m, a] = br;
  return `${a.length === 2 ? `20${a}` : a}-${m}-${d}`;
}

/**
 * Reúne lead, cliente já convertido (se houver) e o veredito.
 *
 * Uma função só, usada pelo GET e pelo POST: as duas precisam enxergar
 * exatamente o mesmo estado, ou a tela ofereceria uma conversão que a
 * gravação recusaria.
 */
async function examinar(db, leadId) {
  const lead = await db
    .prepare('SELECT * FROM leads WHERE id = ? AND ativo = 1')
    .bind(leadId)
    .first();

  if (!lead) return { lead: null };

  const documento = lead.documento ? limparCnpj(lead.documento) : '';

  const [etapa, jaConvertido, mesmoCnpj] = await Promise.all([
    lead.etapa_id
      ? db.prepare('SELECT id, nome, encerra, pipeline FROM etapas WHERE id = ?')
          .bind(lead.etapa_id).first()
      : Promise.resolve(null),

    // Este lead já virou cliente?
    db.prepare('SELECT id, nome, ativo FROM clientes WHERE lead_id = ?')
      .bind(leadId).first(),

    // Outro caminho pode ter criado o mesmo CNPJ — cadastro manual, ou
    // uma conversão anterior a partir de um lead duplicado.
    documento.length === 14
      ? db.prepare('SELECT id, nome, lead_id FROM clientes WHERE documento = ? AND ativo = 1')
          .bind(documento).first()
      : Promise.resolve(null)
  ]);

  // Motivos que impedem a conversão, do mais específico ao mais geral.
  let impedimento = null;

  if (jaConvertido?.ativo) {
    impedimento = {
      code: 'JA_CONVERTIDO',
      mensagem: `Este lead já virou o cliente "${jaConvertido.nome}".`,
      cliente: jaConvertido
    };
  } else if (mesmoCnpj) {
    impedimento = {
      code: 'CNPJ_JA_E_CLIENTE',
      mensagem: `Já existe um cliente ativo com este CNPJ: "${mesmoCnpj.nome}".`,
      cliente: mesmoCnpj
    };
  } else if (!documento) {
    impedimento = {
      code: 'SEM_DOCUMENTO',
      mensagem: 'Este lead não tem CNPJ. Preencha o CNPJ na ficha antes de converter — é por ele que o cliente será casado com o cadastro do ERP.'
    };
  } else if (!cnpjValido(documento)) {
    // CPF cai aqui, e é de propósito: cliente de CX é empresa
    // contratante. Um cliente com CPF nunca seria encontrado no ERP.
    impedimento = {
      code: 'DOCUMENTO_NAO_E_CNPJ',
      mensagem: 'O documento deste lead não é um CNPJ válido. Cliente de CX é a empresa contratante.'
    };
  }

  return { lead, etapa, documento, jaConvertido, impedimento };
}

/**
 * Pergunta ao ERP se este CNPJ existe.
 *
 * Nunca lança: falha de hub não pode derrubar a conversão. Devolve o
 * veredito e o motivo, e quem chama decide o que fazer com ele.
 *
 * @returns {{consultado: boolean, achado: object|null, aviso: string|null}}
 */
async function conferirNoErp(env, documento) {
  if (!hubConfigurado(env)) {
    return {
      consultado: false,
      achado: null,
      aviso: 'O CRM ainda não consegue conferir este CNPJ no ERP: falta a chave do hub. O cliente nasce marcado como "sem ERP".'
    };
  }

  try {
    const achado = await buscarClientePorCnpj(env, documento);
    return { consultado: true, achado, aviso: null };

  } catch (e) {
    // Sem permissão, hub fora do ar, limite excedido: em todos os casos
    // a conversão segue, porque o problema é nosso e não do usuário.
    const motivo = e instanceof ErroHub ? e.message : e.message;
    return {
      consultado: false,
      achado: null,
      aviso: `Não deu para conferir este CNPJ no ERP (${motivo}). O cliente nasce marcado como "sem ERP".`
    };
  }
}

/* ==========================================================================
   GET — o que a tela precisa saber antes de oferecer a conversão
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const leadId = Number(searchParams.get('lead_id'));
  if (!leadId) return json({ error: 'Informe o lead.', code: 'LEAD_OBRIGATORIO' }, 400, cabecalhos);

  try {
    const { lead, etapa, documento, impedimento } = await examinar(db, leadId);

    if (!lead) {
      return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
    }

    // O ERP só é consultado quando não há impedimento anterior: não faz
    // sentido gastar uma chamada para um lead que já é cliente.
    const erp = impedimento
      ? { consultado: false, achado: null, aviso: null }
      : await conferirNoErp(context.env, documento);

    // A trava do roadmap: com o ERP consultável, CNPJ que não está lá não
    // vira cliente de CX.
    const impedimentoFinal = impedimento || (erp.consultado && !erp.achado
      ? {
          code: 'NAO_ESTA_NO_ERP',
          mensagem: 'Este CNPJ não existe no ERP. Todo cliente de CX precisa existir lá — cadastre-o no ERP antes de converter.'
        }
      : null);

    return json({
      pode: !impedimentoFinal,
      impedimento: impedimentoFinal || null,

      // O que o ERP respondeu, para a tela poder mostrar a quem o CNPJ
      // corresponde antes de converter.
      erp: {
        consultado: erp.consultado,
        encontrado: !!erp.achado,
        nome: erp.achado?.nome || null,
        nid: erp.achado?.erp_nid ?? null,
        status: erp.achado?.status || null,
        aviso: erp.aviso
      },

      // O que a tela usa para pré-preencher. Herdado do lead, não
      // redigitado: quem já respondeu isso no funil não deve responder
      // de novo na conversão.
      sugestao: {
        nome: lead.nome || null,
        documento: documento || null,
        telefone: lead.telefone || null,
        email: lead.email || null,
        contato_nome: lead.contato_nome || null,
        cidade: lead.cidade || null,
        classificacao: lead.classificacao ?? null
      },

      // Para a tela explicar por que o botão apareceu.
      etapaAtual: etapa ? { id: etapa.id, nome: etapa.nome, encerra: !!etapa.encerra } : null
    }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao consultar a conversão.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — converte
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const leadId = Number(searchParams.get('lead_id'));
  if (!leadId) return json({ error: 'Informe o lead.', code: 'LEAD_OBRIGATORIO' }, 400, cabecalhos);

  let corpo = {};
  try { corpo = await context.request.json(); } catch (e) { corpo = {}; }

  const { lead, documento, impedimento } = await examinar(db, leadId);

  if (!lead) {
    return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
  }

  // A mesma checagem do GET, refeita aqui. Não é redundância: entre a
  // tela abrir e o botão ser clicado, outra pessoa pode ter convertido o
  // mesmo lead.
  if (impedimento) {
    return json({ error: impedimento.mensagem, code: impedimento.code, cliente: impedimento.cliente || null }, 409, cabecalhos);
  }

  // A trava do ERP, refeita pelo mesmo motivo — e é aqui que o `erp_id`
  // é obtido. Ele nunca vem do corpo da requisição: vínculo digitado à
  // mão é pior que vínculo nenhum, porque a trava passaria a confiar nele.
  const erp = await conferirNoErp(context.env, documento);

  if (erp.consultado && !erp.achado) {
    return json({
      error: 'Este CNPJ não existe no ERP. Todo cliente de CX precisa existir lá — cadastre-o no ERP antes de converter.',
      code: 'NAO_ESTA_NO_ERP'
    }, 409, cabecalhos);
  }

  const agora = new Date().toISOString();

  // Etapa da jornada: a escolhida na tela, ou a primeira da trilha. O
  // filtro por pipeline é o que impede o cliente de nascer numa etapa do
  // funil comercial — as duas trilhas têm uma etapa de ordem 1.
  let etapaId = corpo.etapa_id ? Number(corpo.etapa_id) : null;
  if (etapaId) {
    const valida = await db
      .prepare('SELECT id FROM etapas WHERE id = ? AND pipeline = ? AND ativo = 1')
      .bind(etapaId, PIPELINE_JORNADA)
      .first();
    if (!valida) etapaId = null;
  }
  if (!etapaId) {
    const primeira = await db
      .prepare('SELECT id FROM etapas WHERE ativo = 1 AND pipeline = ? ORDER BY ordem LIMIT 1')
      .bind(PIPELINE_JORNADA)
      .first();
    etapaId = primeira?.id || null;
  }

  const cliente = {
    // Herdados do lead — a tela pode ter corrigido, mas o padrão é o que
    // já estava lá.
    nome: texto(corpo.nome, 200) || texto(lead.nome, 200),
    documento,
    telefone: texto(corpo.telefone, 30) ?? texto(lead.telefone, 30),
    email: texto(corpo.email, 160) ?? texto(lead.email, 160),
    contato_nome: texto(corpo.contato_nome, 120) ?? texto(lead.contato_nome, 120),
    cidade: texto(corpo.cidade, 120) ?? texto(lead.cidade, 120),
    classificacao: corpo.classificacao !== undefined
      ? normalizarClassificacao(corpo.classificacao)
      : normalizarClassificacao(lead.classificacao),

    // Próprios da trilha de CX — é por isso que a conversão precisa de
    // uma tela em vez de acontecer sozinha.
    nome_fantasia: texto(corpo.nome_fantasia, 200),
    etapa_id: etapaId,
    nucleos: normalizarNucleos(corpo.nucleos),
    data_inicio: paraDataIso(corpo.data_inicio) || agora.slice(0, 10),
    observacoes: texto(corpo.observacoes, 4000)
  };

  if (!cliente.nome) {
    return json({ error: 'A razão social é obrigatória.', code: 'NOME_OBRIGATORIO' }, 400, cabecalhos);
  }

  const CAMPOS = [
    'nome', 'nome_fantasia', 'documento', 'telefone', 'email', 'contato_nome',
    'cidade', 'etapa_id', 'nucleos', 'classificacao', 'data_inicio', 'observacoes'
  ];

  try {
    const registro = await db
      .prepare(
        `INSERT INTO clientes (${CAMPOS.join(', ')}, lead_id, erp_id, criado_por, criado_em, ativo)
         VALUES (${CAMPOS.map(() => '?').join(', ')}, ?, ?, ?, ?, 1)
         RETURNING *`
      )
      .bind(
        ...CAMPOS.map((c) => cliente[c]),
        leadId,
        erp.achado?.erp_id || null,
        usuario.email, agora
      )
      .first();

    console.log(`[conversao] lead ${leadId} -> cliente ${registro.id} por ${usuario.email}${registro.erp_id ? ` (ERP ${registro.erp_id})` : ' (sem ERP)'}`);

    return json({ ok: true, cliente: registro, avisoErp: erp.aviso }, 201, cabecalhos);

  } catch (e) {
    // A corrida perdida cai aqui: o índice único de CNPJ é a defesa real
    // contra duas conversões simultâneas do mesmo lead.
    if (/UNIQUE|constraint/i.test(e.message || '')) {
      const existente = await db
        .prepare('SELECT id, nome FROM clientes WHERE documento = ? AND ativo = 1')
        .bind(documento)
        .first();

      return json({
        error: `Já existe um cliente ativo com este CNPJ${existente ? `: "${existente.nome}"` : ''}.`,
        code: 'CNPJ_JA_E_CLIENTE',
        cliente: existente || null
      }, 409, cabecalhos);
    }

    return json({ error: 'Falha ao converter o lead em cliente.', details: e.message }, 500, cabecalhos);
  }
}
