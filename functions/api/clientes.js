/**
 * /api/clientes — a trilha de CX.
 *
 * Autenticação garantida pelo _middleware.js: se chegou aqui, o usuário
 * tem ID token válido e cadastro ativo no hub.
 *
 * GET    ?pagina=1&busca=&nucleo=&classificacao=   lista paginada
 * GET    ?id=123                                   um cliente
 * GET    ?quadro=1                                 a jornada em colunas
 * GET    ?inativos=1                               os desligados
 * POST                                             cria
 * PUT    ?id=123                                   atualiza
 * PUT    ?mover=1                                  move o cartão na jornada
 * DELETE ?id=123                                   inativa (exclusão lógica)
 *
 * Espelha o /api/leads de propósito — mesma paginação, mesmo formato de
 * erro, mesma exclusão lógica. Quem já mexeu num não precisa reaprender
 * o outro. O que NÃO se espelha são os campos: cliente não tem canal,
 * proposta nem advisor, e lead não tem núcleo nem ERP.
 *
 * O que este arquivo deliberadamente NÃO faz é conversar com o ERP. A
 * regra "todo cliente de CX tem que existir no ERP" vira trava no Lote
 * F, quando a chave do hub com escopo ampliado chegar. Até lá `erp_id`
 * nasce nulo e significa "cadastrado à mão, ainda não conferido".
 */

import { limparCnpj } from './_lib/cnpj.js';
import { cnpjValido } from './_lib/documento.js';
import { montarQuadro, comandosDeMover } from './_lib/quadro.js';

const PIPELINE = 'jornada';
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

/** Aceita DD/MM/AA, DD/MM/AAAA ou ISO; devolve AAAA-MM-DD. */
function paraDataIso(valor) {
  if (!valor) return null;
  const t = String(valor).trim();

  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (br) {
    const [, d, m, a] = br;
    return `${a.length === 2 ? `20${a}` : a}-${m}-${d}`;
  }

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

/**
 * Mesma escala 1–6 do lead, porque é a escala que o ERP usa. Na
 * conversão do Lote F ela é herdada, não redigitada.
 *
 * Valor fora da faixa vira nulo em vez de recusar a gravação: é campo
 * opcional, e derrubar o cadastro inteiro por causa dele seria
 * desproporcional.
 */
function normalizarClassificacao(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

/** Núcleos chegam como lista de IDs; guardamos JSON com números. */
function normalizarNucleos(valor) {
  if (!Array.isArray(valor)) return '[]';
  const ids = [...new Set(
    valor.map(Number).filter((n) => Number.isInteger(n) && n > 0)
  )].slice(0, 20);
  return JSON.stringify(ids);
}

function normalizarCliente(corpo) {
  return {
    nome: texto(corpo.nome, 200),
    nome_fantasia: texto(corpo.nome_fantasia, 200),
    documento: corpo.documento ? limparCnpj(corpo.documento).slice(0, 14) : null,

    telefone: texto(corpo.telefone, 30),
    email: texto(corpo.email, 160),
    contato_nome: texto(corpo.contato_nome, 120),
    cidade: texto(corpo.cidade, 120),

    etapa_id: corpo.etapa_id ? Number(corpo.etapa_id) : null,
    nucleos: normalizarNucleos(corpo.nucleos),
    classificacao: normalizarClassificacao(corpo.classificacao),
    data_inicio: paraDataIso(corpo.data_inicio),
    observacoes: texto(corpo.observacoes, 4000)
  };
}

/**
 * `erp_id` e `lead_id` ficam FORA desta lista de propósito.
 *
 * Os dois são vínculos, não campos de formulário: quem os preenche é a
 * conversão do Lote F, a partir do que o hub responder. Deixá-los aqui
 * permitiria a qualquer requisição carimbar um ID de ERP à mão — e um
 * vínculo falso com o ERP é pior que vínculo nenhum, porque a trava do
 * Lote F passaria a confiar nele.
 */
const CAMPOS = [
  'nome', 'nome_fantasia', 'documento',
  'telefone', 'email', 'contato_nome', 'cidade',
  'etapa_id', 'nucleos', 'classificacao', 'data_inicio', 'observacoes'
];

/**
 * Razão social e CNPJ são obrigatórios.
 *
 * Aqui é CNPJ e não "CNPJ ou CPF": cliente de CX é empresa contratante,
 * e o CNPJ é a chave pela qual o Lote F vai casar este registro com o
 * ERP. Aceitar CPF criaria um cliente que a conversão nunca encontraria.
 */
function validarObrigatorios(cliente) {
  if (!cliente.nome) {
    return { error: 'A razão social é obrigatória.', code: 'NOME_OBRIGATORIO' };
  }
  if (!cliente.documento) {
    return {
      error: 'Informe o CNPJ. É por ele que o cliente será casado com o cadastro do ERP.',
      code: 'DOCUMENTO_OBRIGATORIO'
    };
  }
  if (cliente.documento.length !== 14) {
    return {
      error: 'Cliente de CX precisa de CNPJ, não CPF — é a chave do cadastro no ERP.',
      code: 'CNPJ_OBRIGATORIO'
    };
  }
  if (!cnpjValido(cliente.documento)) {
    return { error: 'O CNPJ informado é inválido. Confira os números.', code: 'DOCUMENTO_INVALIDO' };
  }
  return null;
}

/**
 * WHERE compartilhado pela listagem e pelo quadro.
 *
 * Mesma razão do funil comercial: alternar entre tabela e quadro não
 * pode mudar o conjunto exibido, e duas cópias do filtro divergiriam na
 * primeira manutenção.
 */
function montarFiltro(searchParams) {
  // `inativos=1` é a aba dos desligados. Cliente inativado segue
  // consultável — foi decisão explícita do roadmap —, então a listagem
  // precisa saber olhar para o outro lado do `ativo`.
  const condicoes = [searchParams.get('inativos') ? 'ativo = 0' : 'ativo = 1'];
  const valores = [];

  const busca = texto(searchParams.get('busca'), 100);
  const classificacao = normalizarClassificacao(searchParams.get('classificacao'));
  const nucleo = Number(searchParams.get('nucleo')) || null;
  const etapaId = Number(searchParams.get('etapa_id')) || null;

  if (busca) {
    condicoes.push('(nome LIKE ? OR nome_fantasia LIKE ? OR documento LIKE ?)');
    const curinga = `%${busca}%`;
    const soDigitos = busca.replace(/\D/g, '');
    valores.push(curinga, curinga, soDigitos ? `%${soDigitos}%` : curinga);
  }
  if (classificacao) { condicoes.push('classificacao = ?'); valores.push(classificacao); }
  if (etapaId) { condicoes.push('etapa_id = ?'); valores.push(etapaId); }

  // Núcleo mora num JSON de IDs. EXISTS com json_each em vez de LIKE:
  // um LIKE '%1%' casaria com 1, 10, 11 e 21.
  if (nucleo) {
    condicoes.push('EXISTS (SELECT 1 FROM json_each(clientes.nucleos) WHERE value = ?)');
    valores.push(nucleo);
  }

  return { onde: `WHERE ${condicoes.join(' AND ')}`, valores };
}

function erroDeBanco(e) {
  const msg = String(e?.message || '');
  if (/UNIQUE.*documento|idx_clientes_documento/i.test(msg)) {
    return { codigo: 'DUPLICADO', mensagem: 'Já existe um cliente ativo com este CNPJ.' };
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
    // --- Um cliente específico ---
    //
    // Sem filtro por `ativo`: a aba de inativos precisa poder abrir a
    // ficha de quem foi desligado.
    const id = searchParams.get('id');
    if (id) {
      const cliente = await db
        .prepare('SELECT * FROM clientes WHERE id = ?')
        .bind(Number(id))
        .first();

      if (!cliente) return json({ error: 'Cliente não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
      return json({ cliente }, 200, cabecalhos);
    }

    // --- Quadro: a jornada inteira de uma vez ---
    if (searchParams.get('quadro')) {
      const { onde, valores } = montarFiltro(searchParams);
      const quadro = await montarQuadro(db, {
        tabela: 'clientes',
        pipeline: PIPELINE,
        onde,
        valores,
        // A jornada não soma dinheiro. O valor do contrato é do Lote G,
        // e somar zero no cabeçalho seria pior que não mostrar nada.
        somaColuna: null,
        porColuna: searchParams.get('porColuna')
      });
      return json(quadro, 200, cabecalhos);
    }

    // --- Listagem paginada ---
    // Também serve ao "carregar mais" de uma coluna do quadro.
    const pagina = Math.max(1, Number(searchParams.get('pagina') || 1));
    const porPagina = Math.min(MAX_POR_PAGINA, Number(searchParams.get('porPagina') || POR_PAGINA));
    const { onde, valores } = montarFiltro(searchParams);

    const ordenacao = searchParams.get('etapa_id')
      ? 'posicao, id DESC'
      : 'nome COLLATE NOCASE';

    const total = await db
      .prepare(`SELECT COUNT(*) AS n FROM clientes ${onde}`)
      .bind(...valores)
      .first();

    const { results } = await db
      .prepare(`SELECT * FROM clientes ${onde} ORDER BY ${ordenacao} LIMIT ? OFFSET ?`)
      .bind(...valores, porPagina, (pagina - 1) * porPagina)
      .all();

    const totalRegistros = Number(total?.n || 0);

    return json({
      clientes: results || [],
      total: totalRegistros,
      pagina,
      porPagina,
      totalPaginas: Math.max(1, Math.ceil(totalRegistros / porPagina))
    }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao consultar os clientes.', details: e.message }, 500, cabecalhos);
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
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos); }

  const cliente = normalizarCliente(corpo);

  const invalido = validarObrigatorios(cliente);
  if (invalido) return json(invalido, 400, cabecalhos);

  const agora = new Date().toISOString();

  // Sem etapa informada, entra na primeira coluna da JORNADA. O filtro
  // por pipeline é o que impede o cliente de nascer numa etapa do funil
  // comercial — as duas trilhas têm uma etapa de ordem 1.
  if (!cliente.etapa_id) {
    const primeira = await db
      .prepare('SELECT id FROM etapas WHERE ativo = 1 AND pipeline = ? ORDER BY ordem LIMIT 1')
      .bind(PIPELINE)
      .first();
    cliente.etapa_id = primeira?.id || null;
  }
  if (!cliente.data_inicio) cliente.data_inicio = agora.slice(0, 10);

  try {
    const marcadores = CAMPOS.map(() => '?').join(', ');
    const resultado = await db
      .prepare(
        `INSERT INTO clientes (${CAMPOS.join(', ')}, criado_por, criado_em, ativo)
         VALUES (${marcadores}, ?, ?, 1)
         RETURNING *`
      )
      .bind(...CAMPOS.map((c) => cliente[c]), usuario.email, agora)
      .first();

    console.log(`[clientes] criado ${resultado.id} por ${usuario.email}`);
    return json({ cliente: resultado }, 201, cabecalhos);

  } catch (e) {
    const conhecido = erroDeBanco(e);
    if (conhecido) {
      // Devolve o existente para a tela poder oferecer abrir em vez de criar
      const existente = await db
        .prepare('SELECT id, nome, documento FROM clientes WHERE documento = ? AND ativo = 1')
        .bind(cliente.documento)
        .first();
      return json({ error: conhecido.mensagem, code: conhecido.codigo, existente }, 409, cabecalhos);
    }
    return json({ error: 'Falha ao salvar o cliente.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   PUT — atualiza / move o cartão / reativa
   ========================================================================== */

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos); }

  // --- Mover cartão na jornada ---
  //
  // Vem ANTES da checagem de id porque a operação afeta a coluna
  // inteira, não um cliente só. Uma chamada por soltar.
  if (searchParams.get('mover')) {
    const idMovido = Number(corpo.id);
    const etapaId = Number(corpo.etapa_id);
    const ordem = Array.isArray(corpo.ordem) ? corpo.ordem.map(Number).filter(Number.isInteger) : [];

    if (!idMovido || !etapaId) {
      return json({ error: 'Informe o cliente e a etapa de destino.' }, 400, cabecalhos);
    }
    if (ordem.length > 500) {
      return json({ error: 'Coluna grande demais para reordenar de uma vez.' }, 400, cabecalhos);
    }

    // A etapa de destino tem que ser da jornada. Sem esta conferência um
    // corpo forjado moveria o cliente para uma coluna do funil comercial
    // — o cartão sumiria dos dois quadros, porque nenhum dos dois busca
    // etapa do outro pipeline.
    const destino = await db
      .prepare('SELECT id FROM etapas WHERE id = ? AND ativo = 1 AND pipeline = ?')
      .bind(etapaId, PIPELINE)
      .first();
    if (!destino) {
      return json({ error: 'Etapa de destino inválida.', code: 'ETAPA_INVALIDA' }, 400, cabecalhos);
    }

    try {
      await db.batch(comandosDeMover(db, {
        tabela: 'clientes',
        id: idMovido,
        etapaId,
        ordem,
        usuario: usuario.email,
        agora: new Date().toISOString()
      }));

      console.log(`[clientes] movido ${idMovido} para etapa ${etapaId} por ${usuario.email}`);
      return json({ ok: true }, 200, cabecalhos);
    } catch (e) {
      return json({ error: 'Falha ao mover o cliente.', details: e.message }, 500, cabecalhos);
    }
  }

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID do cliente ausente.' }, 400, cabecalhos);

  // --- Reativar ---
  //
  // A contrapartida da exclusão lógica: sem isto, um cliente desligado
  // por engano só voltaria por consulta manual ao banco. O índice único
  // do CNPJ é parcial (só entre ativos), então a reativação pode
  // esbarrar num homônimo recadastrado — daí o tratamento do 409.
  if (searchParams.get('reativar')) {
    try {
      const reativado = await db
        .prepare(
          `UPDATE clientes SET ativo = 1, atualizado_por = ?, atualizado_em = ?
           WHERE id = ? AND ativo = 0
           RETURNING *`
        )
        .bind(usuario.email, new Date().toISOString(), id)
        .first();

      if (!reativado) {
        return json({ error: 'Cliente não encontrado entre os inativos.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
      }
      console.log(`[clientes] reativado ${id} por ${usuario.email}`);
      return json({ cliente: reativado }, 200, cabecalhos);
    } catch (e) {
      const conhecido = erroDeBanco(e);
      if (conhecido) {
        return json({
          error: 'Já existe um cliente ativo com este CNPJ. Não é possível reativar.',
          code: conhecido.codigo
        }, 409, cabecalhos);
      }
      return json({ error: 'Falha ao reativar o cliente.', details: e.message }, 500, cabecalhos);
    }
  }

  const cliente = normalizarCliente(corpo);

  const invalido = validarObrigatorios(cliente);
  if (invalido) return json(invalido, 400, cabecalhos);

  try {
    const atribuicoes = CAMPOS.map((c) => `${c} = ?`).join(', ');
    const resultado = await db
      .prepare(
        `UPDATE clientes SET ${atribuicoes}, atualizado_por = ?, atualizado_em = ?
         WHERE id = ? AND ativo = 1
         RETURNING *`
      )
      .bind(...CAMPOS.map((c) => cliente[c]), usuario.email, new Date().toISOString(), id)
      .first();

    if (!resultado) return json({ error: 'Cliente não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

    console.log(`[clientes] atualizado ${id} por ${usuario.email}`);
    return json({ cliente: resultado }, 200, cabecalhos);

  } catch (e) {
    const conhecido = erroDeBanco(e);
    if (conhecido) return json({ error: conhecido.mensagem, code: conhecido.codigo }, 409, cabecalhos);
    return json({ error: 'Falha ao atualizar o cliente.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   DELETE — desligamento (exclusão lógica)
   ========================================================================== */

export async function onRequestDelete(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID do cliente ausente.' }, 400, cabecalhos);

  try {
    const resultado = await db
      .prepare(
        `UPDATE clientes SET ativo = 0, atualizado_por = ?, atualizado_em = ?
         WHERE id = ? AND ativo = 1
         RETURNING id, nome`
      )
      .bind(usuario.email, new Date().toISOString(), id)
      .first();

    if (!resultado) return json({ error: 'Cliente não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

    console.log(`[clientes] inativado ${id} por ${usuario.email}`);
    return json({ ok: true, id: resultado.id }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao inativar o cliente.', details: e.message }, 500, cabecalhos);
  }
}
