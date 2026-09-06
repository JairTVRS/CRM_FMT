/**
 * /api/hub-clientes — os clientes ativos do ERP, ao vivo.
 *
 * Autenticação garantida pelo _middleware.js.
 *
 * GET                     lista os ativos do hub, já cruzados com o CRM
 * GET ?diagnostico=1      só diz se a chave funciona e o que falta
 *
 * É o **caminho 2** para um cliente chegar à trilha de CX: quem já é
 * cliente no ERP aparece na Jornada sem ninguém cadastrar nada. O caminho
 * 1 — o lead finalizado que vira cliente — é o `/api/conversao`.
 *
 * A DECISÃO QUE ESTE ENDPOINT MATERIALIZA (roadmap, 05/09/2026): **o hub
 * é dono da lista de clientes ativos; o CRM anota por cima.** A linha de
 * `clientes` no CRM guarda só a camada de jornada — etapa, núcleos,
 * stakeholders, observações. Quem existe no hub e ainda não tem linha no
 * CRM aparece como "sem jornada definida", e não some da tela.
 *
 * O CRUZAMENTO É POR CNPJ, não por `erp_id`. Enquanto o vínculo não for
 * gravado, o CNPJ é a única coisa que os dois lados têm em comum — e é
 * por isso que a ficha do cliente exige CNPJ e recusa CPF.
 *
 * ONDE COLAR A CHAVE: veja o cabeçalho do `_lib/hub.js`.
 */

import {
  listarClientesDoHub, buscarClientePorCnpj, hubConfigurado, pedirAoHub,
  CAMPOS_CLIENTE, ErroHub
} from './_lib/hub.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

/**
 * O erro do hub vira resposta com código legível — nunca 500 genérico.
 *
 * A tela precisa poder dizer "falta a permissão hub:customers:read" em
 * vez de mostrar uma lista vazia. Lista vazia é indistinguível de "não há
 * clientes", que é uma afirmação diferente e falsa.
 */
function erroDoHub(e, cabecalhos) {
  if (e instanceof ErroHub) {
    const status = e.codigo === 'HUB_SEM_CHAVE' ? 503
      : e.codigo === 'HUB_SEM_PERMISSAO' ? 403
      : e.codigo === 'HUB_CREDENCIAL' ? 502
      : e.codigo === 'HUB_LIMITE' ? 429
      : 502;

    return json({ error: e.message, code: e.codigo, hubStatus: e.status }, status, cabecalhos);
  }
  return json({ error: 'Falha ao consultar os clientes no ERP.', details: e.message }, 500, cabecalhos);
}

/* ==========================================================================
   DIAGNÓSTICO

   Existe porque a pergunta "a chave já tem escopo de clientes?" não
   podia ser respondida sem colocar a chave para rodar. Uma requisição de
   uma página só responde, e a tela mostra o motivo exato.
   ========================================================================== */

async function diagnosticar(env, cabecalhos) {
  if (!hubConfigurado(env)) {
    return json({
      ok: false,
      code: 'HUB_SEM_CHAVE',
      mensagem: 'O servidor não tem a chave do hub configurada.',
      comoResolver: 'Cadastre o Secret HUB_API_KEY nas variáveis do projeto na Cloudflare (Settings → Variables and Secrets → tipo Secret) e refaça o deploy. Veja o cabeçalho de functions/api/_lib/hub.js.'
    }, 200, cabecalhos);
  }

  try {
    const corpo = await pedirAoHub(env, '/customers', {
      fields: CAMPOS_CLIENTE,
      status: 'active',
      page: 1
    });

    return json({
      ok: true,
      mensagem: 'A chave do hub tem permissão de leitura de clientes.',
      totalAtivos: Number(corpo?.size ?? 0),
      // Confirma que a chave usada é a dedicada ou a compartilhada, sem
      // jamais devolver a chave em si.
      chave: env.HUB_CUSTOMERS_KEY ? 'HUB_CUSTOMERS_KEY' : 'HUB_API_KEY'
    }, 200, cabecalhos);

  } catch (e) {
    if (e instanceof ErroHub) {
      return json({
        ok: false,
        code: e.codigo,
        mensagem: e.message,
        hubStatus: e.status,
        comoResolver: e.codigo === 'HUB_SEM_PERMISSAO'
          ? 'A chave existe e funciona, mas falta a permissão hub:customers:read. Peça a ampliação do escopo, ou cadastre uma segunda chave no Secret HUB_CUSTOMERS_KEY.'
          : 'Confira a chave cadastrada no Secret HUB_API_KEY.'
      }, 200, cabecalhos);
    }
    return json({ ok: false, code: 'ERRO', mensagem: e.message }, 200, cabecalhos);
  }
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const env = context.env;
  const db = env.DB;
  const { searchParams } = new URL(context.request.url);

  if (searchParams.get('diagnostico')) {
    return diagnosticar(env, cabecalhos);
  }

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    const { clientes: doHub, total, truncado } = await listarClientesDoHub(env, {
      status: searchParams.get('status') || 'active',
      busca: searchParams.get('busca') || null
    });

    // As linhas do CRM, todas de uma vez. São poucas — uma por cliente
    // que a CX já trouxe para a jornada — e cruzar em memória evita uma
    // consulta por cliente do hub.
    const { results } = await db
      .prepare('SELECT * FROM clientes WHERE ativo = 1')
      .all();

    const doCrm = results || [];
    const porDocumento = new Map(
      doCrm
        .filter((c) => c.documento)
        .map((c) => [String(c.documento).replace(/\D/g, ''), c])
    );

    const usados = new Set();

    // 1. Quem o ERP conhece. É a lista mandante.
    const juntos = doHub.map((h) => {
      const noCrm = h.documento ? porDocumento.get(h.documento) : null;
      if (noCrm) usados.add(noCrm.id);

      return {
        // O que o CRM anotou por cima, quando existe.
        id: noCrm?.id ?? null,
        etapa_id: noCrm?.etapa_id ?? null,
        nucleos: noCrm?.nucleos ?? '[]',
        observacoes: noCrm?.observacoes ?? null,
        data_inicio: noCrm?.data_inicio ?? null,
        contato_nome: noCrm?.contato_nome ?? null,
        cidade: noCrm?.cidade ?? null,
        lead_id: noCrm?.lead_id ?? null,

        // O que o ERP diz. Vence no que é identidade do cliente.
        nome: h.nome || noCrm?.nome || null,
        nome_fantasia: h.nome_fantasia || noCrm?.nome_fantasia || null,
        documento: h.documento,
        email: h.email || noCrm?.email || null,
        telefone: h.telefone || noCrm?.telefone || null,
        classificacao: h.classificacao ?? noCrm?.classificacao ?? null,

        erp_id: h.erp_id,
        erp_nid: h.erp_nid,
        erp_status: h.status,
        contratado_em: h.contratado_em,

        origem: 'hub',

        // O estado que a tela precisa distinguir: existe no ERP mas
        // ninguém definiu a jornada dele ainda.
        semJornada: !noCrm
      };
    });

    // 2. Quem o CRM tem e o ERP não devolveu. Duas causas possíveis, e a
    //    tela não pode confundi-las com "não é cliente": ou é conversão
    //    recém-feita que o ERP ainda não cadastrou, ou o cliente saiu do
    //    filtro de status (inativo no ERP, por exemplo).
    const soNoCrm = doCrm
      .filter((c) => !usados.has(c.id))
      .map((c) => ({ ...c, origem: 'crm', semJornada: false, erp_status: null }));

    return json({
      clientes: [...juntos, ...soNoCrm],
      totalHub: total,
      totalCrm: doCrm.length,
      semJornada: juntos.filter((c) => c.semJornada).length,
      soNoCrm: soNoCrm.length,

      // Se o hub tiver mais páginas do que o teto, a tela precisa dizer
      // que a lista está incompleta em vez de deixar sumir gente.
      truncado
    }, 200, cabecalhos);

  } catch (e) {
    return erroDoHub(e, cabecalhos);
  }
}

/* ==========================================================================
   POST — trazer um cliente do ERP para a jornada

   Cria a linha de `clientes` no CRM a partir do que o hub já sabe, e é
   aqui que o `erp_id` finalmente é preenchido.

   Endpoint separado do `/api/clientes` pelo mesmo motivo do
   `/api/conversao`: aquele é o cadastro manual, e ele exclui `erp_id` da
   lista de campos de propósito, para que nenhuma requisição carimbe um
   vínculo à mão. Aqui o vínculo não é digitado — vem da resposta do hub.
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const env = context.env;
  const db = env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const documento = String(searchParams.get('documento') || '').replace(/\D/g, '');
  if (documento.length !== 14) {
    return json({ error: 'Informe o CNPJ do cliente.', code: 'DOCUMENTO_OBRIGATORIO' }, 400, cabecalhos);
  }

  let corpo = {};
  try { corpo = await context.request.json(); } catch (e) { corpo = {}; }

  try {
    // A verdade vem do hub, não do corpo da requisição. Aceitar nome e
    // `erp_id` do cliente HTTP permitiria inventar um vínculo.
    const doHub = await buscarClientePorCnpj(env, documento);

    if (!doHub) {
      return json({
        error: 'Este CNPJ não foi encontrado no ERP.',
        code: 'NAO_ESTA_NO_ERP'
      }, 404, cabecalhos);
    }

    const jaExiste = await db
      .prepare('SELECT id, nome FROM clientes WHERE documento = ? AND ativo = 1')
      .bind(documento)
      .first();

    // Já tem linha no CRM: não cria outra, só grava o vínculo que faltava.
    if (jaExiste) {
      const atualizado = await db
        .prepare(
          `UPDATE clientes SET erp_id = ?, atualizado_por = ?, atualizado_em = ?
            WHERE id = ? RETURNING *`
        )
        .bind(doHub.erp_id, usuario.email, new Date().toISOString(), jaExiste.id)
        .first();

      return json({ ok: true, cliente: atualizado, vinculado: true }, 200, cabecalhos);
    }

    // Etapa da jornada: a escolhida, ou a primeira da trilha.
    let etapaId = corpo.etapa_id ? Number(corpo.etapa_id) : null;
    if (etapaId) {
      const valida = await db
        .prepare("SELECT id FROM etapas WHERE id = ? AND pipeline = 'jornada' AND ativo = 1")
        .bind(etapaId)
        .first();
      if (!valida) etapaId = null;
    }
    if (!etapaId) {
      const primeira = await db
        .prepare("SELECT id FROM etapas WHERE ativo = 1 AND pipeline = 'jornada' ORDER BY ordem LIMIT 1")
        .first();
      etapaId = primeira?.id || null;
    }

    const nucleos = Array.isArray(corpo.nucleos)
      ? JSON.stringify([...new Set(corpo.nucleos.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20))
      : '[]';

    // `contractedAt` do ERP é o começo da relação — melhor que a data de
    // hoje, que só diz quando alguém abriu esta tela.
    const inicio = String(doHub.contratado_em || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

    const agora = new Date().toISOString();

    const registro = await db
      .prepare(
        `INSERT INTO clientes
           (nome, nome_fantasia, documento, telefone, email, cidade,
            etapa_id, nucleos, classificacao, data_inicio, observacoes,
            erp_id, criado_por, criado_em, ativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         RETURNING *`
      )
      .bind(
        doHub.nome, doHub.nome_fantasia, documento,
        doHub.telefone, doHub.email, null,
        etapaId, nucleos, doHub.classificacao, inicio,
        corpo.observacoes ? String(corpo.observacoes).slice(0, 4000) : null,
        doHub.erp_id, usuario.email, agora
      )
      .first();

    console.log(`[hub-clientes] ${documento} trazido para a jornada como ${registro.id} por ${usuario.email}`);

    return json({ ok: true, cliente: registro, vinculado: false }, 201, cabecalhos);

  } catch (e) {
    if (/UNIQUE|constraint/i.test(e.message || '')) {
      return json({
        error: 'Já existe um cliente ativo com este CNPJ.',
        code: 'DUPLICADO'
      }, 409, cabecalhos);
    }
    return erroDoHub(e, cabecalhos);
  }
}
