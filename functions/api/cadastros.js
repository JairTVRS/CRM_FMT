/**
 * /api/cadastros — advisors, tags, etapas, núcleos e papéis.
 *
 * Todos seguem a mesma mecânica de cadastro simplificado: o usuário
 * digita um nome, ele vira opção para todos. Sem tela de administração
 * separada, sem perfil de admin — a equipe é pequena e o atrito de um
 * fluxo formal custaria mais que o risco.
 *
 * A proteção contra estrago é a exclusão condicional: nada que esteja
 * em uso pode ser removido.
 *
 * Núcleos e papéis são o vocabulário da trilha de CX (Lote H). Núcleo é
 * o Tipo de Reunião — o nível do meio entre Time (agrupamento interno) e
 * Carteira (cliente + núcleo). Papel é a função da pessoa do cliente, e
 * quem vai consumi-lo de verdade é o mapa de stakeholders do Lote L.
 *
 * GET    ?tipo=advisors|tags|etapas|nucleos|papeis   lista
 * POST   ?tipo=...                    cria
 * PUT    ?tipo=...&id=N               renomeia / altera cor / reordena
 * DELETE ?tipo=...&id=N               remove (bloqueado se estiver em uso)
 */

const TIPOS = ['advisors', 'tags', 'etapas', 'nucleos', 'papeis'];

/**
 * Quem tem coluna `cor`. Advisors e papéis são só nome — mandar `cor`
 * para eles montaria um UPDATE com coluna inexistente.
 */
const COM_COR = new Set(['tags', 'etapas', 'nucleos']);

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const texto = (v, limite) => {
  if (v == null) return null;
  const t = String(v).trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, limite) : null;
};

/** Aceita só cor hexadecimal — o valor vai direto para o CSS. */
const cor = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : null);

/**
 * As etapas são particionadas por pipeline desde a migração 005.
 * 'comercial' é o funil de captação; a jornada do cliente (Lote H) será
 * outro pipeline na mesma tabela, servida pelo mesmo quadro.
 */
const PIPELINES = ['comercial', 'jornada'];
const pipelineDe = (searchParams) => {
  const p = searchParams.get('pipeline');
  return PIPELINES.includes(p) ? p : 'comercial';
};

function validarTipo(searchParams, cabecalhos) {
  const tipo = searchParams.get('tipo');
  if (!TIPOS.includes(tipo)) {
    return { erro: json({ error: 'Tipo inválido.', code: 'TIPO_INVALIDO' }, 400, cabecalhos) };
  }
  return { tipo };
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const { searchParams } = new URL(context.request.url);
  const db = context.env.DB;

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  // ?tipo=todos devolve os três de uma vez — é o que a tela precisa
  // ao abrir, e evita três requisições em sequência.
  if (searchParams.get('tipo') === 'todos') {
    try {
      // As etapas saem filtradas pelo pipeline pedido; as demais listas
      // são globais e valem para as duas trilhas.
      const [advisors, tags, etapas, nucleos, papeis] = await Promise.all([
        db.prepare('SELECT id, nome FROM advisors WHERE ativo = 1 ORDER BY nome COLLATE NOCASE').all(),
        db.prepare('SELECT id, nome, cor FROM tags WHERE ativo = 1 ORDER BY nome COLLATE NOCASE').all(),
        db.prepare(
          `SELECT id, nome, cor, ordem, encerra, pipeline FROM etapas
           WHERE ativo = 1 AND pipeline = ? ORDER BY ordem`
        ).bind(pipelineDe(searchParams)).all(),
        db.prepare('SELECT id, nome, cor FROM nucleos WHERE ativo = 1 ORDER BY nome COLLATE NOCASE').all(),
        db.prepare('SELECT id, nome FROM papeis WHERE ativo = 1 ORDER BY nome COLLATE NOCASE').all()
      ]);
      return json({
        advisors: advisors.results || [],
        tags: tags.results || [],
        etapas: etapas.results || [],
        nucleos: nucleos.results || [],
        papeis: papeis.results || []
      }, 200, cabecalhos);
    } catch (e) {
      return json({ error: 'Falha ao carregar os cadastros.', details: e.message }, 500, cabecalhos);
    }
  }

  const { tipo, erro } = validarTipo(searchParams, cabecalhos);
  if (erro) return erro;

  try {
    // Etapas são as únicas particionadas por pipeline; advisors e tags
    // são listas globais.
    if (tipo === 'etapas') {
      const { results } = await db
        .prepare(
          `SELECT id, nome, cor, ordem, encerra, pipeline FROM etapas
           WHERE ativo = 1 AND pipeline = ? ORDER BY ordem`
        )
        .bind(pipelineDe(searchParams))
        .all();
      return json({ etapas: results || [] }, 200, cabecalhos);
    }

    const colunas = COM_COR.has(tipo) ? 'id, nome, cor' : 'id, nome';

    const { results } = await db
      .prepare(`SELECT ${colunas} FROM ${tipo} WHERE ativo = 1 ORDER BY nome COLLATE NOCASE`)
      .all();

    return json({ [tipo]: results || [] }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao consultar.', details: e.message }, 500, cabecalhos);
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

  const { tipo, erro } = validarTipo(searchParams, cabecalhos);
  if (erro) return erro;

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  const nome = texto(corpo.nome, 60);
  if (!nome) return json({ error: 'Informe um nome.', code: 'NOME_OBRIGATORIO' }, 400, cabecalhos);

  const agora = new Date().toISOString();

  try {
    let registro;

    if (tipo === 'etapas') {
      // Nova etapa entra no fim do próprio pipeline. A ordem é contada
      // dentro do pipeline: o funil comercial e a jornada do cliente têm
      // sequências independentes.
      const pipeline = pipelineDe(searchParams);
      const ultima = await db
        .prepare('SELECT COALESCE(MAX(ordem), 0) AS n FROM etapas WHERE ativo = 1 AND pipeline = ?')
        .bind(pipeline)
        .first();

      registro = await db
        .prepare(
          `INSERT INTO etapas (nome, cor, ordem, encerra, pipeline, ativo)
           VALUES (?, ?, ?, ?, ?, 1) RETURNING id, nome, cor, ordem, encerra, pipeline`
        )
        .bind(nome, cor(corpo.cor) || '#6e6e6e', Number(ultima?.n || 0) + 1, corpo.encerra ? 1 : 0, pipeline)
        .first();

    } else if (COM_COR.has(tipo)) {
      // tags e núcleos: mesma forma, mesma tabela em tudo que importa aqui
      registro = await db
        .prepare(
          `INSERT INTO ${tipo} (nome, cor, criado_por, criado_em, ativo)
           VALUES (?, ?, ?, ?, 1) RETURNING id, nome, cor`
        )
        .bind(nome, cor(corpo.cor) || '#6e6e6e', usuario.email, agora)
        .first();

    } else {
      // advisors e papéis: só nome
      registro = await db
        .prepare(
          `INSERT INTO ${tipo} (nome, criado_por, criado_em, ativo)
           VALUES (?, ?, ?, 1) RETURNING id, nome`
        )
        .bind(nome, usuario.email, agora)
        .first();
    }

    return json({ registro }, 201, cabecalhos);

  } catch (e) {
    if (/UNIQUE|constraint/i.test(e.message || '')) {
      // Já existe: devolve o existente em vez de erro. Quem está
      // digitando quer o item na lista, não uma mensagem.
      const existente = await db
        .prepare(`SELECT * FROM ${tipo} WHERE nome = ? COLLATE NOCASE AND ativo = 1`)
        .bind(nome)
        .first();
      return json({ registro: existente, jaExistia: true }, 200, cabecalhos);
    }
    return json({ error: 'Falha ao criar.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   PUT — renomeia, muda cor, reordena
   ========================================================================== */

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const { tipo, erro } = validarTipo(searchParams, cabecalhos);
  if (erro) return erro;

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  // Reordenação em lote das etapas (arrastar coluna).
  // Vem ANTES da checagem de id: reordenar afeta várias etapas
  // de uma vez e não recebe id na query.
  if (tipo === 'etapas' && Array.isArray(corpo.ordem)) {
    try {
      const comandos = corpo.ordem
        .map((idEtapa, i) => db.prepare('UPDATE etapas SET ordem = ? WHERE id = ?').bind(i + 1, Number(idEtapa)));
      await db.batch(comandos);
      return json({ ok: true }, 200, cabecalhos);
    } catch (e) {
      return json({ error: 'Falha ao reordenar.', details: e.message }, 500, cabecalhos);
    }
  }

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID ausente.' }, 400, cabecalhos);

  const nome = texto(corpo.nome, 60);
  const novaCor = cor(corpo.cor);
  // `undefined` distingue "não mandou o campo" de "mandou false".
  // Sem isso, desmarcar uma etapa terminal seria impossível.
  const mudaEncerra = tipo === 'etapas' && corpo.encerra !== undefined;

  const campos = [];
  const valores = [];
  if (nome) { campos.push('nome = ?'); valores.push(nome); }
  if (novaCor && COM_COR.has(tipo)) { campos.push('cor = ?'); valores.push(novaCor); }
  if (mudaEncerra) { campos.push('encerra = ?'); valores.push(corpo.encerra ? 1 : 0); }

  // A conferência é sobre o que SOBROU depois do filtro por tipo, não
  // sobre o que veio no corpo. Uma cor mandada para advisors ou papéis
  // é descartada acima, e o SET sairia vazio — SQL inválido.
  if (campos.length === 0) {
    return json({ error: 'Nada a alterar.' }, 400, cabecalhos);
  }

  try {
    const registro = await db
      .prepare(`UPDATE ${tipo} SET ${campos.join(', ')} WHERE id = ? AND ativo = 1 RETURNING *`)
      .bind(...valores, id)
      .first();

    if (!registro) return json({ error: 'Registro não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
    return json({ registro }, 200, cabecalhos);

  } catch (e) {
    if (/UNIQUE|constraint/i.test(e.message || '')) {
      return json({ error: 'Já existe um item com esse nome.', code: 'DUPLICADO' }, 409, cabecalhos);
    }
    return json({ error: 'Falha ao atualizar.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   DELETE — bloqueado quando estiver em uso
   ========================================================================== */

export async function onRequestDelete(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const { tipo, erro } = validarTipo(searchParams, cabecalhos);
  if (erro) return erro;

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID ausente.' }, 400, cabecalhos);

  try {
    // --- Está em uso? ---
    let emUso = 0;
    let mensagem = '';

    if (tipo === 'advisors') {
      const r = await db
        .prepare('SELECT COUNT(*) AS n FROM leads WHERE advisor_id = ? AND ativo = 1')
        .bind(id).first();
      emUso = Number(r?.n || 0);
      mensagem = `Este advisor está vinculado a ${emUso} lead(s). Troque o advisor deles antes de excluir.`;

    } else if (tipo === 'tags') {
      const r = await db
        .prepare(`SELECT COUNT(*) AS n FROM leads, json_each(leads.tags)
                  WHERE json_each.value = ? AND leads.ativo = 1`)
        .bind(id).first();
      emUso = Number(r?.n || 0);
      mensagem = `Esta tag está aplicada a ${emUso} lead(s). Remova a tag deles antes de excluir.`;

    } else if (tipo === 'nucleos') {
      const r = await db
        .prepare(`SELECT COUNT(*) AS n FROM clientes, json_each(clientes.nucleos)
                  WHERE json_each.value = ? AND clientes.ativo = 1`)
        .bind(id).first();
      emUso = Number(r?.n || 0);
      mensagem = `Este núcleo é atendido em ${emUso} cliente(s). Remova-o deles antes de excluir.`;

    } else if (tipo === 'papeis') {
      // Nada consome papéis ainda: o mapa de stakeholders é o Lote L.
      // Quando ele chegar, a contagem entra aqui — e é justamente por
      // isso que o ramo existe em vez de cair no `else`.
      emUso = 0;

    } else {
      // Etapas. A contagem tem que olhar as DUAS trilhas: uma etapa da
      // jornada segura clientes, não leads, e contar só leads devolveria
      // "vazia" para uma coluna cheia — apagá-la deixaria os cartões
      // órfãos, sem coluna para onde voltar.
      const [comLeads, comClientes] = await Promise.all([
        db.prepare('SELECT COUNT(*) AS n FROM leads WHERE etapa_id = ? AND ativo = 1').bind(id).first(),
        db.prepare('SELECT COUNT(*) AS n FROM clientes WHERE etapa_id = ? AND ativo = 1').bind(id).first()
      ]);
      const leads = Number(comLeads?.n || 0);
      const clientes = Number(comClientes?.n || 0);
      emUso = leads + clientes;

      const quem = clientes > 0 && leads === 0
        ? `${clientes} cliente(s)`
        : (leads > 0 && clientes === 0 ? `${leads} lead(s)` : `${leads} lead(s) e ${clientes} cliente(s)`);
      mensagem = `Esta etapa contém ${quem}. Mova-os para outra coluna antes de excluir.`;
    }

    if (emUso > 0) {
      return json({ error: mensagem, code: 'EM_USO', quantidade: emUso }, 409, cabecalhos);
    }

    // Nenhum pipeline pode ficar sem etapa. A contagem é dentro do
    // pipeline da própria etapa: esvaziar o funil comercial não fica
    // liberado só porque a jornada do cliente tem colunas.
    if (tipo === 'etapas') {
      const alvo = await db.prepare('SELECT pipeline FROM etapas WHERE id = ?').bind(id).first();
      const total = await db
        .prepare('SELECT COUNT(*) AS n FROM etapas WHERE ativo = 1 AND pipeline = ?')
        .bind(alvo?.pipeline || 'comercial')
        .first();
      if (Number(total?.n || 0) <= 1) {
        return json({ error: 'O funil precisa de ao menos uma etapa.', code: 'ULTIMA_ETAPA' }, 409, cabecalhos);
      }
    }

    const removido = await db
      .prepare(`UPDATE ${tipo} SET ativo = 0 WHERE id = ? AND ativo = 1 RETURNING id`)
      .bind(id).first();

    if (!removido) return json({ error: 'Registro não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
    return json({ ok: true, id }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao excluir.', details: e.message }, 500, cabecalhos);
  }
}
