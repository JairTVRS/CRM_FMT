/**
 * /api/plano-acao — o plano de ação de todas as carteiras, em 5W2H.
 *
 * Autenticação garantida pelo _middleware.js.
 *
 * GET                  as ações GRAVADAS no CRM, e até onde a carga chegou
 * GET ?log=ID          o histórico de alterações de uma ação
 * POST ?carga=1        um passo da carga: lê no ERP as reuniões novas
 * PATCH ?id=ID         altera UM campo de uma ação, com registro no log
 *
 * O PLANO É GRAVADO (2.25.0, migração 012)
 *
 * Até a 2.24.0 cada abertura da tela relia seis meses de atas no ERP.
 * Era lento, estourava o teto de páginas do hub e não deixava editar
 * nada. Agora a primeira carga lê os seis meses em janelas de um mês, e
 * as seguintes pedem ao hub só as reuniões desde a última carga. O GET
 * nunca fala com o hub: lê o banco.
 *
 * A ata inteira vive no campo `notes` da reunião. A carga lê as atas
 * das reuniões REALIZADAS com o parser do `_lib/ata.js` e mescla cada
 * ação com o que está gravado — a regra de quem vence está no cabeçalho
 * do `_lib/plano.js`.
 *
 * A NUMERAÇÃO POR CLIENTE
 *
 * Na ata a sequência de ações é por tipo de reunião; o CRM dá um número
 * corrido por CLIENTE, atribuído na primeira vez que a ação é vista e
 * nunca reaproveitado. O identificador fica `N.M`.
 *
 * TUDO SE EDITA, E TUDO FICA REGISTRADO
 *
 * Os campos da ata (descrição, responsável, quando, data prevista,
 * status) e os que a CX preenche (por quê, onde, como, quanto,
 * observações). Cada alteração grava uma linha em `acoes_cx_log`: quem,
 * quando, o campo, de que valor para que valor, e se foi a CX ou a ata.
 *
 * Não há IA nesta rota. Contar ações e ler estrutura de texto regular
 * tem resposta certa.
 *
 * O QUE NUNCA SAI DAQUI
 *
 * As notas privadas do consultor — as linhas finais em CAIXA ALTA — e o
 * `technicalNotes` da reunião. O parser separa as primeiras e nada da
 * ata além das ações é gravado; o segundo nem é pedido ao hub.
 */

import {
  listarCarteiras, listarReunioes, listarClientesDoHub,
  mapaDeTiposDeReuniao, mapaDeTimes, ErroHub, memorizar
} from './_lib/hub.js';
import {
  aplicarReunioes, linhaParaTela, validarCampo, COLUNAS_DA_CARGA
} from './_lib/plano.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

/**
 * Falta de permissao no hub NAO e 403.
 *
 * 403 quer dizer "voce nao pode". Aqui quem nao pode e a CHAVE DO
 * SERVIDOR, e o usuario nao tem nada com isso -- nem como resolver. O
 * front derrubava a sessao em todo 403, entao esta rota expulsava a
 * pessoa do CRM e mostrava o erro do hub na tela de login. O front foi
 * corrigido tambem, mas o codigo certo importa por si: 503 e o mesmo
 * que HUB_SEM_CHAVE ja usava, e pelo mesmo motivo -- o CRM esta sem
 * condicoes de atender, por configuracao, nao por autorizacao.
 */
function erroDoHub(e, cabecalhos) {
  if (e instanceof ErroHub) {
    const status = e.codigo === 'HUB_SEM_CHAVE' ? 503
      : e.codigo === 'HUB_SEM_PERMISSAO' ? 503
      : e.codigo === 'HUB_LIMITE' ? 429
      : 502;
    return json({ error: e.message, code: e.codigo, hubStatus: e.status }, status, cabecalhos);
  }
  return json({ error: 'Falha ao montar o plano de ação.', details: e.message }, 500, cabecalhos);
}

/* Na mesma ordem das consultas, para nomear qual falhou. */
const NOMES_DAS_FONTES = ['carteiras', 'reuniões', 'clientes', 'tipos de reunião', 'times'];

/**
 * Reúne TODAS as fontes que falharam numa resposta só.
 *
 * O caso que motiva isto: a chave do hub cobre clientes mas não carteiras.
 * Com `Promise.all`, a tela dizia só "falta hub:portfolios:read" — e só
 * depois de corrigida é que apareceria a próxima. Dizer as quatro juntas
 * transforma quatro idas ao painel da Cloudflare em uma.
 */
function erroDasFontes(falhas, cabecalhos) {
  const permissoes = [...new Set(
    falhas
      .filter((f) => f.erro instanceof ErroHub && f.erro.codigo === 'HUB_SEM_PERMISSAO')
      .map((f) => (String(f.erro.message).match(/hub:[a-z-]+:read/) || [])[0])
      .filter(Boolean)
  )];

  if (permissoes.length) {
    return json({
      error: permissoes.length === 1
        ? `A chave do hub não tem a permissão ${permissoes[0]}.`
        : `A chave do hub não tem estas permissões: ${permissoes.join(', ')}.`,
      code: 'HUB_SEM_PERMISSAO',
      permissoesFaltando: permissoes,
      fontes: falhas.map((f) => f.qual)
    }, 503, cabecalhos);
  }

  // Nenhuma falha foi de permissão: devolve a primeira, que é a que
  // explica o problema real.
  return erroDoHub(falhas[0].erro, cabecalhos);
}

/* ==========================================================================
   A CARGA — constantes
   ========================================================================== */

const DIA = 86400000;

/**
 * A primeira carga olha seis meses para trás. Cobre com folga a carteira
 * mensal e a quinzenal: ação aberta reaparece em toda ata da carteira até
 * ser encerrada, então o que está aberto está numa ata recente.
 */
const MESES_PRIMEIRA_CARGA = 6;

/** Cada passo da carga pede ao hub no máximo um mês de reuniões. */
const JANELA_DIAS = 31;

/**
 * Depois da primeira carga, cada passo recua catorze dias antes do
 * cursor. A ata é escrita DEPOIS da reunião — às vezes dias depois —, e o
 * hub filtra pela data da reunião. Sem a folga, a reunião de ontem cuja
 * ata saiu hoje nunca seria lida. Reler é inofensivo: a mescla é
 * idempotente e `plano_carteiras` impede a ata velha de passar por cima
 * da nova.
 */
const FOLGA_DIAS = 14;

/** Quanto as listas de referência do hub ficam na memória. */
const REFERENCIA_MS = 10 * 60 * 1000;

/** Carga travada há mais que isso morreu no meio; a trava expira. */
const TRAVA_MS = 3 * 60 * 1000;

/**
 * Linhas por comando. Cada comando manda as linhas como UM parâmetro
 * JSON, lido no SQL com `json_each`. O D1 limita a 100 parâmetros por
 * comando: um INSERT de vinte colunas com parâmetro por coluna caberia
 * cinco linhas, e 1900 ações virariam centenas de comandos — foi assim
 * que a numeração da 2.21.0 falhou calada em produção, com as ações
 * aparecendo como "AÇÃO 8" em vez de "N.8".
 */
const LINHAS_POR_COMANDO = 150;

const alterou = (r) => Number(r?.meta?.changes ?? r?.changes ?? 0);

const emLotes = (lista, n = LINHAS_POR_COMANDO) => {
  const lotes = [];
  for (let i = 0; i < lista.length; i += n) lotes.push(lista.slice(i, i + n));
  return lotes;
};

const travaViva = (carga, agora = Date.now()) =>
  !!carga?.travado_em && new Date(carga.travado_em).getTime() > agora - TRAVA_MS;

function estadoDaCarga(carga) {
  return {
    carregadoAte: carga?.carregado_ate || null,
    completa: !!carga?.completa,
    ultimaCargaEm: carga?.ultima_carga_em || null,
    ultimaCargaPor: carga?.ultima_carga_por || null,
    emAndamento: travaViva(carga),
    emAndamentoPor: travaViva(carga) ? carga.travado_por : null
  };
}

/** A tabela ou a coluna não existe: a migração 012 não foi aplicada. */
function faltaMigracao(e, cabecalhos) {
  if (/no such (table|column)/i.test(String(e?.message))) {
    return json({
      error: 'O banco ainda não tem a migração 012 (plano de ação gravado). Aplique db/migracao-012-plano-gravado.sql.',
      code: 'SEM_MIGRACAO_012'
    }, 503, cabecalhos);
  }
  return null;
}

/* ==========================================================================
   GET — lê o banco. Nunca fala com o hub.
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    /* ---- o histórico de uma ação ---- */
    if (searchParams.has('log')) {
      const id = Number(searchParams.get('log'));
      if (!Number.isInteger(id) || id <= 0) {
        return json({ error: 'Informe a ação.', code: 'ID_OBRIGATORIO' }, 400, cabecalhos);
      }
      const { results } = await db
        .prepare(
          `SELECT campo, de, para, origem, reuniao_nid, por, por_nome, em
             FROM acoes_cx_log WHERE acao_id = ? ORDER BY em DESC, id DESC`
        )
        .bind(id)
        .all();
      return json({ log: results || [] }, 200, cabecalhos);
    }

    /* ---- o plano ---- */
    // `status IS NULL` é linha da 010 que nenhuma carga ainda completou:
    // só tem a numeração. A primeira carga a preenche.
    const { results } = await db.prepare('SELECT * FROM acoes_cx WHERE status IS NOT NULL').all();
    const carga = await db.prepare('SELECT * FROM plano_carga WHERE id = 1').first();

    const hoje = new Date();
    const acoes = (results || []).map((l) => linhaParaTela(l, hoje));

    // Primeiro o que dói: atrasado, depois o que se arrasta há mais tempo.
    acoes.sort((a, b) =>
      (b.aberta ? 1 : 0) - (a.aberta ? 1 : 0)
      || (b.atrasada ? 1 : 0) - (a.atrasada ? 1 : 0)
      || (b.diasDeAtraso || 0) - (a.diasDeAtraso || 0)
      || (b.diasEmAberto || 0) - (a.diasEmAberto || 0)
      || String(a.cliente || '').localeCompare(String(b.cliente || ''), 'pt-BR')
      || (a.numeroCliente || 0) - (b.numeroCliente || 0)
    );

    return json({ acoes, carga: estadoDaCarga(carga) }, 200, cabecalhos);

  } catch (e) {
    return faltaMigracao(e, cabecalhos)
      || json({ error: 'Falha ao ler o plano de ação.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST ?carga=1 — um passo da carga

   Um passo lê UMA janela de até um mês. A primeira carga (seis meses)
   são uns oito passos; a tela os encadeia até `carga.completa`. Passos
   curtos cabem no tempo de uma requisição e não estouram o teto de
   páginas do hub — o que a leitura de seis meses de uma vez fazia.
   ========================================================================== */

/**
 * As reuniões da janela. Se a janela estourar o teto de páginas do hub,
 * encolhe pela metade e tenta de novo: o hub devolve da mais nova para a
 * mais velha, e o que ele corta são justamente as mais velhas.
 */
async function reunioesDaJanela(env, desde, ate) {
  let fim = ate;
  for (let tentativa = 0; ; tentativa++) {
    const r = await listarReunioes(env, { desde: desde.toISOString(), ate: fim.toISOString() });
    if (!r.truncado || fim - desde <= DIA || tentativa === 4) return { ...r, ate: fim };
    fim = new Date(desde.getTime() + Math.floor((fim - desde) / 2));
  }
}

async function passoDaCarga(env, db, usuario, cabecalhos, agora) {
  const carga = await db.prepare('SELECT * FROM plano_carga WHERE id = 1').first();

  let desde;
  if (!carga?.carregado_ate) {
    desde = new Date(agora);
    desde.setUTCMonth(desde.getUTCMonth() - MESES_PRIMEIRA_CARGA);
  } else {
    desde = new Date(new Date(carga.carregado_ate).getTime() - (carga.completa ? FOLGA_DIAS * DIA : 0));
  }
  const ate = new Date(Math.min(desde.getTime() + JANELA_DIAS * DIA, agora.getTime()));

  const fontes = await Promise.allSettled([
    // As quatro listas de referência mudam pouco e se repetem em todo
    // passo: ficam na memória por dez minutos. Só as reuniões são sempre
    // pedidas de novo.
    memorizar('plano:carteiras', REFERENCIA_MS, () => listarCarteiras(env)),
    reunioesDaJanela(env, desde, ate),
    memorizar('plano:clientes', REFERENCIA_MS, () => listarClientesDoHub(env, { status: 'active' })),
    memorizar('plano:tipos', REFERENCIA_MS, () => mapaDeTiposDeReuniao(env)),
    memorizar('plano:times', REFERENCIA_MS, () => mapaDeTimes(env))
  ]);

  const falhas = fontes
    .map((f, i) => (f.status === 'rejected' ? { erro: f.reason, qual: NOMES_DAS_FONTES[i] } : null))
    .filter(Boolean);
  if (falhas.length) return erroDasFontes(falhas, cabecalhos);

  const [{ carteiras }, janela, { clientes }, tiposDeReuniao, times] = fontes.map((f) => f.value);

  const { results: gravadas } = await db.prepare('SELECT * FROM acoes_cx').all();
  const { results: jaAplicadas } = await db.prepare('SELECT * FROM plano_carteiras').all();

  const r = aplicarReunioes(
    gravadas || [],
    new Map((jaAplicadas || []).map((a) => [a.carteira_erp_id, a])),
    janela.reunioes,
    {
      carteiraDe: new Map(carteiras.map((c) => [`${c.clienteErpId}::${c.nucleoErpId}`, c])),
      nomeDoCliente: new Map(clientes.map((c) => [c.erp_id, c.nome])),
      tiposDeReuniao,
      times
    }
  );

  /* ---- a gravação, num lote só: ou entra tudo, ou nada ---- */
  const agoraIso = agora.toISOString();
  // Uma versão para tudo o que ESTA carga escreveu. É por ela que o log
  // encontra as linhas — inclusive as novas, cujo id só existe depois do
  // INSERT — e deixa de fora a linha que a CX editou no meio da carga.
  const versao = crypto.randomUUID();
  const comandos = [];

  const colunasNovas = [
    'cliente_erp_id', 'carteira_erp_id', 'acao_numero', 'numero_cliente',
    ...COLUNAS_DA_CARGA, 'versao', 'criado_por', 'criado_em'
  ];
  const ext = (c, alias = 'value') => `json_extract(${alias}, '$.${c}')`;

  for (const lote of emLotes(r.novas)) {
    comandos.push(db
      .prepare(
        `INSERT INTO acoes_cx (${colunasNovas.join(', ')})
         SELECT ${colunasNovas.map((c) => ext(c)).join(', ')} FROM json_each(?)`
      )
      .bind(JSON.stringify(lote.map((l) => ({ ...l, versao, criado_por: usuario.email, criado_em: agoraIso })))));
  }

  // UPDATE só se a linha ainda está como a carga a leu. Se a CX editou
  // no meio, a edição dela fica, e a ata é reaplicada na próxima vez que
  // mudar.
  const colunasAlteradas = [...COLUNAS_DA_CARGA, 'versao'];
  for (const lote of emLotes(r.alteradas)) {
    comandos.push(db
      .prepare(
        `UPDATE acoes_cx
            SET ${colunasAlteradas.map((c) => `${c} = ${ext(c, 'j.value')}`).join(', ')}
           FROM json_each(?) AS j
          WHERE acoes_cx.id = ${ext('id', 'j.value')}
            AND acoes_cx.versao IS ${ext('versao_lida', 'j.value')}`
      )
      .bind(JSON.stringify(lote.map((l) => ({ ...l, versao })))));
  }

  for (const lote of emLotes(r.logs)) {
    comandos.push(db
      .prepare(
        `INSERT INTO acoes_cx_log (acao_id, campo, de, para, origem, reuniao_nid, por, por_nome, em)
         SELECT a.id, ${['campo', 'de', 'para'].map((c) => ext(c, 'j.value')).join(', ')},
                'ata', ${ext('reuniao_nid', 'j.value')}, ?, ?, ?
           FROM json_each(?) AS j
           JOIN acoes_cx AS a
             ON a.carteira_erp_id = ${ext('carteira_erp_id', 'j.value')}
            AND a.acao_numero = ${ext('acao_numero', 'j.value')}
          WHERE a.versao = ?`
      )
      .bind(usuario.email, usuario.nome || null, agoraIso, JSON.stringify(lote), versao));
  }

  for (const lote of emLotes(r.carteiras)) {
    comandos.push(db
      .prepare(
        `INSERT INTO plano_carteiras (carteira_erp_id, reuniao_erp_id, reuniao_em)
         SELECT ${['carteira_erp_id', 'reuniao_erp_id', 'reuniao_em'].map((c) => ext(c)).join(', ')}
           FROM json_each(?) WHERE true
         ON CONFLICT (carteira_erp_id) DO UPDATE
            SET reuniao_erp_id = excluded.reuniao_erp_id, reuniao_em = excluded.reuniao_em
          WHERE excluded.reuniao_em >= plano_carteiras.reuniao_em`
      )
      .bind(JSON.stringify(lote)));
  }

  const completa = janela.ate.getTime() >= agora.getTime();
  comandos.push(db
    .prepare(
      `UPDATE plano_carga
          SET carregado_ate = ?, completa = ?, ultima_carga_em = ?, ultima_carga_por = ?
        WHERE id = 1`
    )
    .bind(janela.ate.toISOString(), completa ? 1 : 0, agoraIso, usuario.email));

  await db.batch(comandos);

  const depois = await db.prepare('SELECT * FROM plano_carga WHERE id = 1').first();

  return json({
    carga: { ...estadoDaCarga(depois), emAndamento: false, emAndamentoPor: null },
    passo: {
      desde: desde.toISOString(),
      ate: janela.ate.toISOString(),
      reunioes: janela.reunioes.length,
      novas: r.novas.length,
      alteradas: r.alteradas.length,
      registros: r.logs.length,
      semCarteira: r.semCarteira,
      // Mesmo encolhida a um dia, a janela estourou o teto de páginas.
      truncado: !!janela.truncado
    },
    avisos: r.avisos
  }, 200, cabecalhos);
}

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const env = context.env;
  const db = env.DB;
  const usuario = context.data.usuario;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);
  if (!searchParams.has('carga')) {
    return json({ error: 'Operação desconhecida.', code: 'OPERACAO_DESCONHECIDA' }, 400, cabecalhos);
  }

  const agora = new Date();

  try {
    // A trava: só uma carga por vez. Duas pessoas abrindo a tela juntas
    // numerariam as mesmas ações duas vezes.
    const trava = await db
      .prepare(
        `UPDATE plano_carga SET travado_em = ?, travado_por = ?
          WHERE id = 1 AND (travado_em IS NULL OR travado_em < ?)`
      )
      .bind(agora.toISOString(), usuario.email, new Date(agora.getTime() - TRAVA_MS).toISOString())
      .run();

    if (!alterou(trava)) {
      const carga = await db.prepare('SELECT * FROM plano_carga WHERE id = 1').first();
      return json({
        error: `Já há uma carga em andamento${carga?.travado_por ? ` (${carga.travado_por})` : ''}. Tente em instantes.`,
        code: 'CARGA_EM_ANDAMENTO',
        carga: estadoDaCarga(carga)
      }, 409, cabecalhos);
    }
  } catch (e) {
    return faltaMigracao(e, cabecalhos)
      || json({ error: 'Falha ao iniciar a carga.', details: e.message }, 500, cabecalhos);
  }

  try {
    return await passoDaCarga(env, db, usuario, cabecalhos, agora);
  } catch (e) {
    return erroDoHub(e, cabecalhos);
  } finally {
    try {
      await db
        .prepare('UPDATE plano_carga SET travado_em = NULL, travado_por = NULL WHERE id = 1 AND travado_em = ?')
        .bind(agora.toISOString())
        .run();
    } catch (e) { /* a trava expira sozinha em três minutos */ }
  }
}

/* ==========================================================================
   PATCH ?id=N — altera UM campo, e registra

   Corpo: { campo, de, para }. `de` é o valor que a pessoa estava vendo.
   Se no banco já é outro, alguém mudou antes: a gravação é recusada com
   o valor atual, em vez de apagar a mudança do outro sem ninguém saber.
   ========================================================================== */

export async function onRequestPatch(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const id = Number(searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: 'Informe a ação.', code: 'ID_OBRIGATORIO' }, 400, cabecalhos);
  }

  let corpo = {};
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos); }

  const campo = String(corpo.campo || '');
  const validado = validarCampo(campo, corpo.para);
  if (validado.erro) return json({ error: validado.erro, code: 'CAMPO_INVALIDO' }, 400, cabecalhos);

  try {
    const carga = await db.prepare('SELECT * FROM plano_carga WHERE id = 1').first();
    if (travaViva(carga)) {
      return json({
        error: 'Uma carga de atas está gravando agora. Tente de novo em alguns segundos.',
        code: 'CARGA_EM_ANDAMENTO'
      }, 423, cabecalhos);
    }

    const atual = await db.prepare('SELECT * FROM acoes_cx WHERE id = ?').bind(id).first();
    if (!atual) return json({ error: 'Ação não encontrada.', code: 'NAO_ENCONTRADA' }, 404, cabecalhos);

    const antes = atual[campo] ?? null;
    const visto = corpo.de === undefined || corpo.de === '' ? null : corpo.de;

    if (String(antes ?? '') !== String(visto ?? '')) {
      return json({
        error: `Este campo foi alterado por ${atual.atualizado_por || 'outra pessoa'} enquanto você editava. O valor atual foi recarregado.`,
        code: 'CONFLITO',
        acao: linhaParaTela(atual)
      }, 409, cabecalhos);
    }

    if (validado.valor === antes) {
      return json({ ok: true, semMudanca: true, acao: linhaParaTela(atual) }, 200, cabecalhos);
    }

    const agora = new Date().toISOString();
    const versao = crypto.randomUUID();

    // Mudar o status à mão reinicia o "desde": "Em andamento desde hoje".
    // O texto bruto da ata deixa de valer para ele.
    const extras = campo === 'status' ? ', status_bruto = NULL, status_desde = ?' : '';
    const valoresExtras = campo === 'status' ? [agora.slice(0, 10)] : [];

    await db.batch([
      db.prepare(
        `UPDATE acoes_cx
            SET ${campo} = ?${extras}, atualizado_por = ?, atualizado_em = ?, versao = ?
          WHERE id = ? AND versao IS ?`
      ).bind(validado.valor, ...valoresExtras, usuario.email, agora, versao, id, atual.versao ?? null),

      // O log só entra se o UPDATE entrou: a versão nova é a prova.
      db.prepare(
        `INSERT INTO acoes_cx_log (acao_id, campo, de, para, origem, reuniao_nid, por, por_nome, em)
         SELECT ?, ?, ?, ?, 'crm', NULL, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM acoes_cx WHERE id = ? AND versao = ?)`
      ).bind(id, campo, antes, validado.valor, usuario.email, usuario.nome || null, agora, id, versao)
    ]);

    const depois = await db.prepare('SELECT * FROM acoes_cx WHERE id = ?').bind(id).first();

    if (depois?.versao !== versao) {
      return json({
        error: 'A ação foi alterada por outra pessoa no mesmo instante. O valor atual foi recarregado.',
        code: 'CONFLITO',
        acao: linhaParaTela(depois)
      }, 409, cabecalhos);
    }

    return json({ ok: true, acao: linhaParaTela(depois) }, 200, cabecalhos);

  } catch (e) {
    return faltaMigracao(e, cabecalhos)
      || json({ error: 'Falha ao salvar a alteração.', details: e.message }, 500, cabecalhos);
  }
}
