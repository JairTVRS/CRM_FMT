/**
 * /api/leads — CRUD dos leads.
 *
 * Autenticação garantida pelo _middleware.js: se chegou aqui, o usuário
 * tem ID token válido e cadastro ativo no hub.
 *
 * GET    ?pagina=1&busca=&ramo=&segmento=   lista paginada
 * GET    ?id=123                            um lead
 * POST                                      cria
 * PUT    ?id=123                            atualiza
 * DELETE ?id=123                            exclui (lógica)
 *
 * Exclusão é lógica (ativo = 0). Histórico comercial não se apaga sem
 * rastro, e um lead excluído por engano precisa ter volta.
 *
 * DESDE A 2.31.0 (migração 016):
 *   - `responsavel` é o e-mail de um usuário do CRM. Nasce com quem
 *     cadastrou e pode ser trocado por qualquer outro de `usuarios_crm`.
 *   - Entrar numa etapa de PERDA exige motivo — no PUT da ficha e no
 *     arraste do quadro, as duas portas. Sair dela apaga o motivo: um lead
 *     reaberto não está perdido. Quem já estava em Perdido antes da regra
 *     segue sem motivo ("não informado") e pode ser editado normalmente.
 */

import { limparCnpj } from './_lib/cnpj.js';
import { documentoValido, cpfValido } from './_lib/documento.js';
import { montarQuadro, comandosDeMover } from './_lib/quadro.js';
import { registrarEventoLead, diferencas, listarEventosLead } from './_lib/lead-eventos.js';

/** Converte "R$ 25.424,00", "25424.00" ou 25424 em centavos. */
function paraCentavos(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return Math.round(valor * 100);

  const limpo = String(valor).replace(/[R$\s]/g, '');
  // Formato brasileiro: ponto separa milhar, vírgula separa decimal
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;

  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Aceita DD/MM/AA, DD/MM/AAAA ou ISO; devolve AAAA-MM-DD. */
function paraDataIso(valor) {
  if (!valor) return null;
  const t = String(valor).trim();

  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (br) {
    const [, d, m, a] = br;
    const ano = a.length === 2 ? `20${a}` : a;
    return `${ano}-${m}-${d}`;
  }

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

const POR_PAGINA = 10;
const MAX_POR_PAGINA = 100;

/* ==========================================================================
   UTILIDADES
   ========================================================================== */

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const texto = (v, limite = 500) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, limite) : null;
};

/**
 * Extrai do corpo apenas os campos conhecidos, já saneados.
 * Ignora qualquer coisa a mais que o cliente mande.
 */
function normalizarLead(corpo) {
  return {
    nome: texto(corpo.nome, 200),
    documento: corpo.documento ? limparCnpj(corpo.documento).slice(0, 14) : null,
    telefone: texto(corpo.telefone, 30),
    origem: texto(corpo.origem, 60),
    observacoes: texto(corpo.observacoes, 4000),

    email: texto(corpo.email, 160),
    contato_nome: texto(corpo.contato_nome, 120),
    cep: texto(corpo.cep, 12),
    cidade: texto(corpo.cidade, 120),
    endereco: texto(corpo.endereco, 300),

    site: texto(corpo.site, 300),
    instagram: texto(corpo.instagram, 300),
    ramo: texto(corpo.ramo, 60),
    segmento: normalizarSegmento(corpo.segmento),
    resumo_ia: texto(corpo.resumo_ia, 20000),

    // --- Funil comercial ---
    // Aceita `origem` como sinônimo de entrada: a ficha da tela nasceu
    // com esse nome e o campo virou `canal` no Lote A. Sem este fallback
    // o valor digitado no formulário era descartado em silêncio.
    canal: texto(corpo.canal ?? corpo.origem, 60),
    classificacao: normalizarClassificacao(corpo.classificacao),
    atendente: texto(corpo.atendente, 160),
    advisor_id: corpo.advisor_id ? Number(corpo.advisor_id) : null,
    etapa_id: corpo.etapa_id ? Number(corpo.etapa_id) : null,

    data_cadastro: paraDataIso(corpo.data_cadastro),
    data_ultimo_contato: paraDataIso(corpo.data_ultimo_contato),
    data_proximo_contato: paraDataIso(corpo.data_proximo_contato),
    data_fechamento: paraDataIso(corpo.data_fechamento),

    valor_proposta: paraCentavos(corpo.valor_proposta),
    valor_diagnostico: paraCentavos(corpo.valor_diagnostico),

    tags: normalizarTags(corpo.tags),

    // --- 2.31.0 ---
    responsavel: normalizarEmail(corpo.responsavel),
    motivo_perda_id: Number(corpo.motivo_perda_id) > 0 ? Number(corpo.motivo_perda_id) : null,
    motivo_perda_obs: texto(corpo.motivo_perda_obs, 1000),

    // --- 2.40.0: o contrato (aba Contrato) ---
    km_valor: paraCentavos(corpo.km_valor),
    forma_preco_id: Number(corpo.forma_preco_id) > 0 ? Number(corpo.forma_preco_id) : null,
    contratada_id: Number(corpo.contratada_id) > 0 ? Number(corpo.contratada_id) : null,
    rep_nome: texto(corpo.rep_nome, 120),
    rep_cpf: String(corpo.rep_cpf || '').replace(/\D/g, '').slice(0, 11) || null,
    rep_nacionalidade: texto(corpo.rep_nacionalidade, 40),
    rep_estado_civil: texto(corpo.rep_estado_civil, 40),
    rep_profissao: texto(corpo.rep_profissao, 80),
    rep_residencia: texto(corpo.rep_residencia, 120)
  };
}

/** E-mail em minúsculas, que é como se compara com `usuarios_crm`. */
function normalizarEmail(valor) {
  const t = texto(valor, 160);
  return t && t.includes('@') ? t.toLowerCase() : null;
}

/** SERVIÇO (planilha) e SERVIÇOS (sistema) são o mesmo segmento. */
function normalizarSegmento(valor) {
  const t = texto(valor, 60);
  if (!t) return null;
  const mapa = {
    'SERVICO': 'SERVIÇOS', 'SERVIÇO': 'SERVIÇOS', 'SERVICOS': 'SERVIÇOS',
    'INDUSTRIA': 'INDÚSTRIA', 'VAREJO': 'VAREJO', 'ONG': 'ONG'
  };
  const chave = t.toUpperCase();
  return mapa[chave] || t.toUpperCase();
}

/**
 * Classificação é a escala interna de complexidade do projeto, de 1 a 6.
 *
 * Valor fora da faixa vira nulo em vez de recusar o salvamento: é campo
 * opcional, e derrubar a gravação inteira do lead por causa dele seria
 * desproporcional.
 */
function normalizarClassificacao(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

/** Tags chegam como lista de IDs; guardamos JSON com números. */
function normalizarTags(valor) {
  if (!Array.isArray(valor)) return '[]';
  const ids = [...new Set(
    valor.map(Number).filter((n) => Number.isInteger(n) && n > 0)
  )].slice(0, 20);
  return JSON.stringify(ids);
}

const CAMPOS = [
  'nome', 'documento', 'telefone', 'observacoes',
  'email', 'contato_nome', 'cep', 'cidade', 'endereco',
  'site', 'instagram', 'ramo', 'segmento', 'resumo_ia',
  'canal', 'classificacao', 'atendente', 'advisor_id', 'etapa_id',
  // `data_proximo_contato` saiu na 2.32.0: é derivado da agenda (/api/agenda).
  'data_cadastro', 'data_ultimo_contato', 'data_fechamento',
  'valor_proposta', 'valor_diagnostico', 'tags',
  'responsavel', 'motivo_perda_id', 'motivo_perda_obs',
  // 2.40.0 — o contrato
  'km_valor', 'forma_preco_id', 'contratada_id',
  'rep_nome', 'rep_cpf', 'rep_nacionalidade', 'rep_estado_civil', 'rep_profissao', 'rep_residencia'
];

/**
 * Nome e documento são obrigatórios. O documento é a identidade do
 * lead — alimenta o contexto da IA no dossiê e é o que impede
 * duplicidade — então precisa ser um CPF ou CNPJ válido de verdade,
 * não apenas um número com a quantidade certa de dígitos.
 */
function validarObrigatorios(lead) {
  if (!lead.nome) {
    return { error: 'O nome ou razão social é obrigatório.', code: 'NOME_OBRIGATORIO' };
  }
  if (!lead.documento) {
    return {
      error: 'Informe o CNPJ ou CPF. Ele identifica o lead e serve de contexto para a inteligência comercial.',
      code: 'DOCUMENTO_OBRIGATORIO'
    };
  }
  if (!documentoValido(lead.documento)) {
    return {
      error: 'O CNPJ ou CPF informado é inválido. Confira os números.',
      code: 'DOCUMENTO_INVALIDO'
    };
  }
  // 2.40.0: o CPF de quem assina pelo cliente vai para o contrato.
  if (lead.rep_cpf && !cpfValido(lead.rep_cpf)) {
    return { error: 'O CPF de quem assina pelo cliente (aba Contrato) é inválido. Confira os números.', code: 'REP_CPF_INVALIDO' };
  }
  return null;
}

/**
 * Monta o WHERE compartilhado pela listagem e pelo quadro.
 *
 * As duas telas oferecem os mesmos filtros, e alternar entre tabela e
 * quadro não pode mudar o conjunto de leads exibido. Uma função só
 * garante isso — duas cópias divergiriam na primeira manutenção.
 */
function montarFiltro(searchParams) {
  const condicoes = ['ativo = 1'];
  const valores = [];

  const busca = texto(searchParams.get('busca'), 100);
  const ramo = texto(searchParams.get('ramo'), 60);
  const segmento = texto(searchParams.get('segmento'), 60);
  const canal = texto(searchParams.get('canal'), 60);
  const classificacao = normalizarClassificacao(searchParams.get('classificacao'));
  const etapaId = Number(searchParams.get('etapa_id')) || null;
  const responsavel = texto(searchParams.get('responsavel'), 160);

  if (busca) {
    // Busca por nome, documento ou telefone — o que o campo da tela promete
    condicoes.push('(nome LIKE ? OR documento LIKE ? OR telefone LIKE ?)');
    const curinga = `%${busca}%`;
    const soDigitos = busca.replace(/\D/g, '');
    valores.push(curinga, soDigitos ? `%${soDigitos}%` : curinga, curinga);
  }
  if (ramo) { condicoes.push('ramo = ?'); valores.push(ramo); }
  if (segmento) { condicoes.push('segmento = ?'); valores.push(segmento); }
  // Leads anteriores ao Lote A guardaram o valor em `origem`. Filtrar só
  // por `canal` esconderia justamente os mais antigos da base.
  if (canal) { condicoes.push('COALESCE(canal, origem) = ?'); valores.push(canal); }
  if (classificacao) { condicoes.push('classificacao = ?'); valores.push(classificacao); }
  if (etapaId) { condicoes.push('etapa_id = ?'); valores.push(etapaId); }
  // "Sem responsável" é um valor do filtro, não a ausência dele.
  if (responsavel === SEM_RESPONSAVEL) condicoes.push('responsavel IS NULL');
  else if (responsavel) { condicoes.push('responsavel = ?'); valores.push(responsavel.toLowerCase()); }

  return { onde: `WHERE ${condicoes.join(' AND ')}`, valores };
}

/**
 * O montador do quadro mora em _lib/quadro.js desde o Lote H, quando a
 * jornada do cliente virou o segundo consumidor da mesma mecânica.
 *
 * O pipeline é fixo em 'comercial' e NÃO vem mais da query string. Ler
 * o pipeline do parâmetro deixava /api/leads?pipeline=jornada devolver
 * as nove colunas do CX cheias de zero — colunas de uma trilha com os
 * registros da outra. Cada endpoint responde pela sua trilha.
 */
const PIPELINE_LEADS = 'comercial';

/** Valor do filtro para os leads sem responsável. */
const SEM_RESPONSAVEL = '__sem__';

/* ==========================================================================
   REGRAS DO FUNIL (2.31.0)

   Valem nas duas portas por onde um lead muda de etapa — o PUT da ficha
   e o arraste do quadro. Uma função só, para as duas não divergirem.
   ========================================================================== */

async function resultadoDaEtapa(db, etapaId) {
  if (!etapaId) return null;
  const e = await db.prepare('SELECT resultado FROM etapas WHERE id = ?').bind(Number(etapaId)).first();
  return e?.resultado || null;
}

/**
 * Confere e ajusta o motivo da perda.
 *
 * @param anterior  { etapa_id } de como o lead está no banco (null ao criar)
 * @param destino   id da etapa para onde ele vai
 * @param motivo    { motivo_perda_id, motivo_perda_obs } pedidos
 * @returns { erro } ou { motivo } já ajustado para gravar
 */
async function conferirPerda(db, anterior, destino, motivo) {
  const vaiPerder = (await resultadoDaEtapa(db, destino)) === 'perdido';

  // Fora da perda, motivo não existe. Apagar em vez de guardar: um lead
  // reaberto com "Fechou com concorrente" na ficha contaria duas vezes.
  if (!vaiPerder) return { motivo: { motivo_perda_id: null, motivo_perda_obs: null } };

  if (motivo.motivo_perda_id) {
    const existe = await db
      .prepare('SELECT id FROM motivos_perda WHERE id = ?')
      .bind(motivo.motivo_perda_id).first();
    if (!existe) {
      return { erro: { error: 'O motivo de perda escolhido não existe mais. Escolha outro.', code: 'MOTIVO_INVALIDO' } };
    }
    return { motivo: { motivo_perda_id: motivo.motivo_perda_id, motivo_perda_obs: motivo.motivo_perda_obs } };
  }

  // Sem motivo só passa se o lead JÁ estava perdido antes da regra.
  const jaEstava = anterior && (await resultadoDaEtapa(db, anterior.etapa_id)) === 'perdido';
  if (jaEstava) return { motivo: { motivo_perda_id: null, motivo_perda_obs: motivo.motivo_perda_obs } };

  return { erro: { error: 'Informe o motivo da perda.', code: 'MOTIVO_OBRIGATORIO' } };
}

/**
 * O responsável tem que ser alguém que usa o CRM.
 *
 * Só confere quando MUDA: um lead cujo responsável ainda não abriu o CRM
 * depois da migração continua editável, sem a ficha trocá-lo sozinha.
 */
async function conferirResponsavel(db, anterior, responsavel) {
  if (!responsavel || responsavel === anterior?.responsavel) return null;
  try {
    const existe = await db
      .prepare('SELECT email FROM usuarios_crm WHERE email = ?')
      .bind(responsavel).first();
    if (existe) return null;
  } catch (e) {
    return { error: 'Falta aplicar a migração 016 para escolher o responsável.', code: 'SEM_MIGRACAO' };
  }
  return { error: 'O responsável escolhido não é um usuário do CRM.', code: 'RESPONSAVEL_INVALIDO' };
}

function erroDeBanco(e) {
  const msg = String(e?.message || '');
  if (/UNIQUE.*documento|idx_leads_documento_unico/i.test(msg)) {
    return { codigo: 'DUPLICADO', mensagem: 'Já existe um lead ativo com este CNPJ/CPF.' };
  }
  return null;
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const { searchParams } = new URL(context.request.url);
  const db = context.env.DB;

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    // --- 2.41.0: o histórico do lead (o relógio da ficha) ---
    const eventosDe = Number(searchParams.get('eventos'));
    if (eventosDe) {
      const historico = await listarEventosLead(db, eventosDe);
      if (!historico) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
      return json(historico, 200, cabecalhos);
    }

    // --- Um lead específico ---
    const id = searchParams.get('id');
    if (id) {
      const lead = await db
        .prepare('SELECT * FROM leads WHERE id = ? AND ativo = 1')
        .bind(Number(id))
        .first();

      if (!lead) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
      return json({ lead }, 200, cabecalhos);
    }

    // --- Canais em uso, para montar o filtro ---
    //
    // A lista sai do banco, não de um enum fixo na tela: a importação de
    // planilha aceita qualquer texto no canal, e um enum deixaria leads
    // fora do filtro sem que ninguém percebesse.
    if (searchParams.get('canais')) {
      const { results } = await db
        .prepare(
          `SELECT DISTINCT COALESCE(canal, origem) AS canal FROM leads
           WHERE ativo = 1 AND COALESCE(canal, origem) IS NOT NULL
             AND TRIM(COALESCE(canal, origem)) <> ''
           ORDER BY 1 COLLATE NOCASE`
        )
        .all();
      return json({ canais: (results || []).map((r) => r.canal) }, 200, cabecalhos);
    }

    // --- Quadro: todas as colunas de uma vez ---
    if (searchParams.get('quadro')) {
      const { onde, valores } = montarFiltro(searchParams);
      const quadro = await montarQuadro(db, {
        tabela: 'leads',
        pipeline: PIPELINE_LEADS,
        onde,
        valores,
        somaColuna: 'valor_proposta',
        porColuna: searchParams.get('porColuna')
      });
      return json(quadro, 200, cabecalhos);
    }

    // --- Listagem paginada ---
    // Também serve ao "carregar mais" de uma coluna do quadro, que passa
    // etapa_id e pagina.
    const pagina = Math.max(1, Number(searchParams.get('pagina') || 1));
    const porPagina = Math.min(MAX_POR_PAGINA, Number(searchParams.get('porPagina') || POR_PAGINA));
    const { onde, valores } = montarFiltro(searchParams);

    // No quadro a ordem é a da coluna; na tabela, a cronológica
    const ordenacao = searchParams.get('etapa_id')
      ? 'posicao, id DESC'
      : 'criado_em DESC, id DESC';

    const total = await db
      .prepare(`SELECT COUNT(*) AS n FROM leads ${onde}`)
      .bind(...valores)
      .first();

    const { results } = await db
      .prepare(
        `SELECT * FROM leads ${onde}
         ORDER BY ${ordenacao}
         LIMIT ? OFFSET ?`
      )
      .bind(...valores, porPagina, (pagina - 1) * porPagina)
      .all();

    const totalRegistros = Number(total?.n || 0);

    return json({
      leads: results || [],
      total: totalRegistros,
      pagina,
      porPagina,
      totalPaginas: Math.max(1, Math.ceil(totalRegistros / porPagina))
    }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao consultar os leads.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — cria
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  let corpo;
  try {
    corpo = await context.request.json();
  } catch (e) {
    return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos);
  }

  const lead = normalizarLead(corpo);

  const invalido = validarObrigatorios(lead);
  if (invalido) return json(invalido, 400, cabecalhos);

  const agora = new Date().toISOString();

  // Sem etapa informada, entra na primeira coluna do funil COMERCIAL.
  //
  // O filtro por pipeline não é zelo: a jornada do cliente também tem
  // uma etapa de ordem 1, e sem ele o desempate entre as duas ficava por
  // conta do banco — um lead novo podia nascer numa coluna do CX.
  if (!lead.etapa_id) {
    const primeira = await db
      .prepare('SELECT id FROM etapas WHERE ativo = 1 AND pipeline = ? ORDER BY ordem LIMIT 1')
      .bind(PIPELINE_LEADS)
      .first();
    lead.etapa_id = primeira?.id || null;
  }
  if (!lead.data_cadastro) lead.data_cadastro = agora.slice(0, 10);
  if (!lead.atendente) lead.atendente = usuario.email;

  // Quem cadastra é o responsável, a menos que a ficha já tenha escolhido
  // outro. Comparar com o próprio e-mail dispensa a consulta nesse caso.
  const quemCadastra = normalizarEmail(usuario.email);
  if (!lead.responsavel) lead.responsavel = quemCadastra;
  const recusaResp = await conferirResponsavel(db, { responsavel: quemCadastra }, lead.responsavel);
  if (recusaResp) return json(recusaResp, 400, cabecalhos);

  const perda = await conferirPerda(db, null, lead.etapa_id, lead);
  if (perda.erro) return json(perda.erro, 400, cabecalhos);
  Object.assign(lead, perda.motivo);

  try {
    const marcadores = CAMPOS.map(() => '?').join(', ');
    const resultado = await db
      .prepare(
        `INSERT INTO leads (${CAMPOS.join(', ')}, criado_por, criado_em, ativo)
         VALUES (${marcadores}, ?, ?, 1)
         RETURNING *`
      )
      .bind(...CAMPOS.map((c) => lead[c]), usuario.email, agora)
      .first();

    console.log(`[leads] criado ${resultado.id} por ${usuario.email}`);
    // 2.41.0: a criação, com o que já veio preenchido.
    await registrarEventoLead(db, {
      leadId: resultado.id, evento: 'criado', por: usuario.email,
      detalhe: { mudancas: diferencas({}, resultado, CAMPOS).map(({ campo, para }) => ({ campo, para })) }
    });
    return json({ lead: resultado }, 201, cabecalhos);

  } catch (e) {
    const conhecido = erroDeBanco(e);
    if (conhecido) {
      // Devolve o lead existente para a tela poder oferecer abrir em vez de criar
      const existente = await db
        .prepare('SELECT id, nome, documento FROM leads WHERE documento = ? AND ativo = 1')
        .bind(lead.documento)
        .first();
      return json({ error: conhecido.mensagem, code: conhecido.codigo, existente }, 409, cabecalhos);
    }
    return json({ error: 'Falha ao salvar o lead.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   PUT — atualiza
   ========================================================================== */

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  let corpo;
  try {
    corpo = await context.request.json();
  } catch (e) {
    return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos);
  }

  // --- Mover cartão no quadro ---
  //
  // Vem ANTES da checagem de id porque a operação afeta a coluna inteira,
  // não um lead só. Uma chamada por soltar, não uma por cartão.
  //
  // Só a coluna de destino é regravada. A de origem fica com um buraco na
  // sequência de `posicao` — e um buraco é inofensivo, já que a ordenação
  // é relativa. Regravar as duas dobraria a escrita para nada.
  if (searchParams.get('mover')) {
    const idMovido = Number(corpo.id);
    const etapaId = Number(corpo.etapa_id);
    const ordem = Array.isArray(corpo.ordem) ? corpo.ordem.map(Number).filter(Number.isInteger) : [];

    if (!idMovido || !etapaId) {
      return json({ error: 'Informe o lead e a etapa de destino.' }, 400, cabecalhos);
    }
    if (ordem.length > 500) {
      return json({ error: 'Coluna grande demais para reordenar de uma vez.' }, 400, cabecalhos);
    }

    try {
      const anterior = await db
        .prepare('SELECT etapa_id FROM leads WHERE id = ? AND ativo = 1')
        .bind(idMovido).first();
      if (!anterior) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

      // Reordenar DENTRO da mesma coluna não é entrar nem sair de etapa
      // nenhuma: nem pede motivo, nem apaga o que existe.
      const mudouDeEtapa = Number(anterior.etapa_id) !== etapaId;
      let motivo = null;

      if (mudouDeEtapa) {
        const perda = await conferirPerda(db, anterior, etapaId, {
          motivo_perda_id: Number(corpo.motivo_perda_id) > 0 ? Number(corpo.motivo_perda_id) : null,
          motivo_perda_obs: texto(corpo.motivo_perda_obs, 1000)
        });
        if (perda.erro) return json(perda.erro, 400, cabecalhos);
        motivo = perda.motivo;
      }

      const agora = new Date().toISOString();
      await db.batch([
        ...comandosDeMover(db, {
          tabela: 'leads',
          id: idMovido,
          etapaId,
          ordem,
          usuario: usuario.email,
          agora
        }),
        ...(motivo ? [db.prepare(
          'UPDATE leads SET motivo_perda_id = ?, motivo_perda_obs = ? WHERE id = ? AND ativo = 1'
        ).bind(motivo.motivo_perda_id, motivo.motivo_perda_obs, idMovido)] : [])
      ]);

      console.log(`[leads] movido ${idMovido} para etapa ${etapaId} por ${usuario.email}`);
      // 2.41.0: só troca de etapa entra no histórico; reordenar na coluna não.
      if (mudouDeEtapa) {
        await registrarEventoLead(db, {
          leadId: idMovido, evento: 'movido', por: usuario.email,
          detalhe: { de: anterior.etapa_id, para: etapaId, ...(motivo?.motivo_perda_id ? { motivo_perda_id: motivo.motivo_perda_id } : {}) }
        });
      }
      return json({ ok: true }, 200, cabecalhos);
    } catch (e) {
      return json({ error: 'Falha ao mover o lead.', details: e.message }, 500, cabecalhos);
    }
  }

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID do lead ausente.' }, 400, cabecalhos);

  const lead = normalizarLead(corpo);

  const invalido = validarObrigatorios(lead);
  if (invalido) return json(invalido, 400, cabecalhos);

  // A linha inteira (2.41.0): o histórico compara campo por campo.
  const anterior = await db
    .prepare('SELECT * FROM leads WHERE id = ? AND ativo = 1')
    .bind(id).first();
  if (!anterior) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

  const recusaResp = await conferirResponsavel(db, anterior, lead.responsavel);
  if (recusaResp) return json(recusaResp, 400, cabecalhos);

  const perda = await conferirPerda(db, anterior, lead.etapa_id, lead);
  if (perda.erro) return json(perda.erro, 400, cabecalhos);
  Object.assign(lead, perda.motivo);

  try {
    const atribuicoes = CAMPOS.map((c) => `${c} = ?`).join(', ');
    const resultado = await db
      .prepare(
        `UPDATE leads SET ${atribuicoes}, atualizado_por = ?, atualizado_em = ?
         WHERE id = ? AND ativo = 1
         RETURNING *`
      )
      .bind(...CAMPOS.map((c) => lead[c]), usuario.email, new Date().toISOString(), id)
      .first();

    if (!resultado) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

    console.log(`[leads] atualizado ${id} por ${usuario.email}`);
    // 2.41.0: salvar sem mudar nada não vira registro.
    const mudancas = diferencas(anterior, resultado, CAMPOS);
    if (mudancas.length) {
      await registrarEventoLead(db, { leadId: id, evento: 'alterado', por: usuario.email, detalhe: { mudancas } });
    }
    return json({ lead: resultado }, 200, cabecalhos);

  } catch (e) {
    const conhecido = erroDeBanco(e);
    if (conhecido) return json({ error: conhecido.mensagem, code: conhecido.codigo }, 409, cabecalhos);
    return json({ error: 'Falha ao atualizar o lead.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   DELETE — exclusão lógica
   ========================================================================== */

export async function onRequestDelete(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID do lead ausente.' }, 400, cabecalhos);

  try {
    const resultado = await db
      .prepare(
        `UPDATE leads SET ativo = 0, atualizado_por = ?, atualizado_em = ?
         WHERE id = ? AND ativo = 1
         RETURNING id, nome`
      )
      .bind(usuario.email, new Date().toISOString(), id)
      .first();

    if (!resultado) return json({ error: 'Lead não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

    console.log(`[leads] excluido ${id} por ${usuario.email}`);
    await registrarEventoLead(db, { leadId: id, evento: 'excluido', por: usuario.email });
    return json({ ok: true, id: resultado.id }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao excluir o lead.', details: e.message }, 500, cabecalhos);
  }
}
