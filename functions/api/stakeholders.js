/**
 * /api/stakeholders — as pessoas do lado do cliente.
 *
 * Autenticação garantida pelo _middleware.js: se chegou aqui, o usuário
 * tem ID token válido e cadastro ativo no hub.
 *
 * GET    ?cliente_id=123   lista as pessoas de um cliente
 * POST   ?cliente_id=123   cria
 * PUT    ?id=45            atualiza
 * DELETE ?id=45            remove (exclusão lógica, como em toda parte)
 *
 * Sempre no escopo de um cliente. Não existe listagem geral de
 * stakeholders de propósito: uma tela com todas as pessoas de todos os
 * clientes seria uma agenda de contatos, e agenda de contatos é o ERP.
 * O que existe aqui é o mapa de UMA conta.
 *
 * A listagem devolve o papel e os núcleos já resolvidos em NOME, além
 * dos IDs. Quem consome — a ficha e o Dossiê de Experiência — quer
 * mostrar texto, e fazer os dois repetirem o cruzamento seria duas
 * cópias da mesma junção.
 */

import { INFLUENCIAS, POSTURAS } from './_lib/schema-dossie-cx.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const texto = (v, limite = 500) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, limite) : null;
};

/**
 * Influência e postura caem em 'desconhecida' quando vêm fora da lista.
 *
 * Não é tolerância preguiçosa: é a única resposta honesta. Cadastrar uma
 * pessoa não é ter avaliado a pessoa, e qualquer outro padrão — "média",
 * "neutro" — carimbaria no mapa um juízo que ninguém emitiu. O documento
 * conta separadamente quantas ainda não foram avaliadas.
 */
const umDe = (valor, permitidos) => {
  const v = String(valor || '').toLowerCase();
  return permitidos.includes(v) ? v : 'desconhecida';
};

/** Núcleos chegam como lista de IDs; guardamos JSON com números. */
function normalizarNucleos(valor) {
  if (!Array.isArray(valor)) return '[]';
  const ids = [...new Set(
    valor.map(Number).filter((n) => Number.isInteger(n) && n > 0)
  )].slice(0, 20);
  return JSON.stringify(ids);
}

function normalizar(corpo) {
  return {
    nome: texto(corpo.nome, 120),
    papel_id: corpo.papel_id ? Number(corpo.papel_id) : null,
    cargo: texto(corpo.cargo, 120),
    email: texto(corpo.email, 160),
    telefone: texto(corpo.telefone, 30),
    influencia: umDe(corpo.influencia, INFLUENCIAS),
    postura: umDe(corpo.postura, POSTURAS),
    patrocinador: corpo.patrocinador ? 1 : 0,
    nucleos: normalizarNucleos(corpo.nucleos),
    observacoes: texto(corpo.observacoes, 2000)
  };
}

const CAMPOS = [
  'nome', 'papel_id', 'cargo', 'email', 'telefone',
  'influencia', 'postura', 'patrocinador', 'nucleos', 'observacoes'
];

function erroDeBanco(e) {
  if (/UNIQUE|idx_stakeholders_nome/i.test(String(e?.message || ''))) {
    return {
      codigo: 'DUPLICADO',
      mensagem: 'Já existe uma pessoa com este nome neste cliente.'
    };
  }
  return null;
}

/**
 * Resolve papel e núcleos em nome, e devolve também os IDs.
 *
 * Uma consulta para cada vocabulário, não uma por pessoa: as duas listas
 * são pequenas e o cruzamento sai em memória.
 */
async function comNomes(db, linhas) {
  if (!linhas || linhas.length === 0) return [];

  const [papeis, nucleos] = await Promise.all([
    db.prepare('SELECT id, nome FROM papeis').all(),
    db.prepare('SELECT id, nome, cor FROM nucleos').all()
  ]);

  const nomePapel = new Map((papeis.results || []).map((p) => [p.id, p.nome]));
  const dadosNucleo = new Map((nucleos.results || []).map((n) => [n.id, n]));

  return linhas.map((s) => {
    let ids = [];
    try { ids = JSON.parse(s.nucleos || '[]'); } catch (e) { ids = []; }

    return {
      ...s,
      patrocinador: !!s.patrocinador,
      papel: s.papel_id ? (nomePapel.get(s.papel_id) || null) : null,
      nucleoIds: ids,
      nucleos: ids.map((id) => dadosNucleo.get(id)?.nome).filter(Boolean)
    };
  });
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const { searchParams } = new URL(context.request.url);
  const db = context.env.DB;

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const clienteId = Number(searchParams.get('cliente_id'));
  if (!clienteId) {
    return json({ error: 'Informe o cliente.', code: 'CLIENTE_OBRIGATORIO' }, 400, cabecalhos);
  }

  try {
    // O patrocinador primeiro, depois a influência do maior para o menor:
    // a ordem da tabela é a ordem em que se pensa a conta.
    const { results } = await db
      .prepare(
        `SELECT * FROM stakeholders
         WHERE cliente_id = ? AND ativo = 1
         ORDER BY patrocinador DESC,
                  CASE influencia WHEN 'alta' THEN 1 WHEN 'media' THEN 2
                                  WHEN 'baixa' THEN 3 ELSE 4 END,
                  nome COLLATE NOCASE`
      )
      .bind(clienteId)
      .all();

    return json({ stakeholders: await comNomes(db, results || []) }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao carregar as pessoas do cliente.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — cria
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const clienteId = Number(searchParams.get('cliente_id'));
  if (!clienteId) {
    return json({ error: 'Informe o cliente.', code: 'CLIENTE_OBRIGATORIO' }, 400, cabecalhos);
  }

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos); }

  const pessoa = normalizar(corpo);
  if (!pessoa.nome) {
    return json({ error: 'Informe o nome da pessoa.', code: 'NOME_OBRIGATORIO' }, 400, cabecalhos);
  }

  // Sem FOREIGN KEY no esquema — o D1 não as verifica por padrão —, a
  // checagem é aqui. Pessoa pendurada num cliente que não existe é lixo
  // que ninguém encontra para limpar depois.
  const cliente = await db
    .prepare('SELECT id FROM clientes WHERE id = ? AND ativo = 1')
    .bind(clienteId)
    .first();

  if (!cliente) {
    return json({ error: 'Cliente não encontrado.', code: 'CLIENTE_NAO_ENCONTRADO' }, 404, cabecalhos);
  }

  const agora = new Date().toISOString();

  try {
    const registro = await db
      .prepare(
        `INSERT INTO stakeholders
           (cliente_id, ${CAMPOS.join(', ')}, criado_por, criado_em, ativo)
         VALUES (?, ${CAMPOS.map(() => '?').join(', ')}, ?, ?, 1)
         RETURNING *`
      )
      .bind(clienteId, ...CAMPOS.map((c) => pessoa[c]), usuario.email, agora)
      .first();

    const [comNome] = await comNomes(db, [registro]);
    return json({ stakeholder: comNome }, 201, cabecalhos);

  } catch (e) {
    const conhecido = erroDeBanco(e);
    if (conhecido) {
      return json({ error: conhecido.mensagem, code: conhecido.codigo }, 409, cabecalhos);
    }
    return json({ error: 'Falha ao salvar a pessoa.', details: e.message }, 500, cabecalhos);
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

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID ausente.' }, 400, cabecalhos);

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos); }

  const pessoa = normalizar(corpo);
  if (!pessoa.nome) {
    return json({ error: 'Informe o nome da pessoa.', code: 'NOME_OBRIGATORIO' }, 400, cabecalhos);
  }

  try {
    const registro = await db
      .prepare(
        `UPDATE stakeholders
            SET ${CAMPOS.map((c) => `${c} = ?`).join(', ')},
                atualizado_por = ?, atualizado_em = ?
          WHERE id = ? AND ativo = 1
      RETURNING *`
      )
      .bind(...CAMPOS.map((c) => pessoa[c]), usuario.email, new Date().toISOString(), id)
      .first();

    if (!registro) {
      return json({ error: 'Pessoa não encontrada.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
    }

    const [comNome] = await comNomes(db, [registro]);
    return json({ stakeholder: comNome }, 200, cabecalhos);

  } catch (e) {
    const conhecido = erroDeBanco(e);
    if (conhecido) {
      return json({ error: conhecido.mensagem, code: conhecido.codigo }, 409, cabecalhos);
    }
    return json({ error: 'Falha ao atualizar a pessoa.', details: e.message }, 500, cabecalhos);
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
  if (!id) return json({ error: 'ID ausente.' }, 400, cabecalhos);

  try {
    // Lógica, como em leads e clientes: o dossiê de uma versão anterior
    // cita esta pessoa pelo nome, e apagar a linha faria o histórico
    // referenciar alguém que o banco jura nunca ter existido.
    const removido = await db
      .prepare(
        `UPDATE stakeholders SET ativo = 0, atualizado_por = ?, atualizado_em = ?
          WHERE id = ? AND ativo = 1 RETURNING id`
      )
      .bind(usuario.email, new Date().toISOString(), id)
      .first();

    if (!removido) {
      return json({ error: 'Pessoa não encontrada.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
    }

    return json({ ok: true, id }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao remover a pessoa.', details: e.message }, 500, cabecalhos);
  }
}
