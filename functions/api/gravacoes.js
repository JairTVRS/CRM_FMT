/**
 * /api/gravacoes — gravar e transcrever a reunião do lead (2.35.0).
 *
 * GET  ?disponivel=1            há transcritor? (Workers AI ou OpenAI)
 * GET  ?reuniao_id=N            as gravações da reunião e a transcrição
 * POST                          começa: { reuniao_id, consentimento, modo } —
 *                               só com a reunião INICIADA por quem grava (2.36.0)
 * POST ?id=N&trecho=1           um pedaço (uma frase, até 15 s): { origem, seq,
 *                               inicio_s, fim_s, audio (WAV base64) } → o texto
 *                               { ..., provisorio: true }: a frase ainda em curso
 *                               (2.36.1) — transcreve e devolve, SEM salvar; a
 *                               tela a mostra crescendo até a frase fechar
 * PUT  ?id=N                    encerra: { encerrar: true, duracao_s }
 *
 * Só o texto é guardado — o áudio passa pela transcrição e é descartado.
 * Sem consentimento registrado não há gravação.
 *
 * Desde a 2.36.0 a gravação acompanha a reunião: começa com "Iniciar
 * reunião" e quem torna a reunião realizada é "Finalizar" (/api/agenda),
 * não o fim da gravação. Uma reunião pode ter mais de uma gravação — a
 * de antes de o navegador fechar e a retomada.
 */

import { ambienteDeIA } from './_lib/chaves-ia.js';
import { transcritorDisponivel, transcrever } from './_lib/transcricao.js';

const MODOS = ['online', 'presencial'];
const ORIGENS = ['formatar', 'lead', 'sala'];
/** ~2 MB de base64: 20 s de WAV 16 kHz mono dá ~850 KB. Folga de sobra. */
const LIMITE_AUDIO = 3_000_000;
/** Pedaços que chegam logo depois de "Encerrar" ainda contam. */
const TOLERANCIA_MS = 10 * 60 * 1000;

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

async function reuniaoDoLead(db, id) {
  return db.prepare(
    `SELECT a.id, a.lead_id, a.tipo, a.status, a.inicio, a.tipo_reuniao_erp_id,
            a.iniciada_em, a.iniciada_por, a.finalizada_em, l.nome AS lead_nome
       FROM agenda_lead a JOIN leads l ON l.id = a.lead_id
      WHERE a.id = ? AND a.ativo = 1`
  ).bind(Number(id)).first();
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (searchParams.get('disponivel')) {
    const envIA = await ambienteDeIA(context.env);
    return json({ transcritor: transcritorDisponivel(envIA) }, 200, cabecalhos);
  }

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);
  const reuniaoId = Number(searchParams.get('reuniao_id'));
  if (!reuniaoId) return json({ error: 'Informe a reunião.' }, 400, cabecalhos);

  try {
    const { results: gravacoes } = await db.prepare(
      'SELECT * FROM gravacoes WHERE reuniao_id = ? ORDER BY id'
    ).bind(reuniaoId).all();
    const { results: trechos } = await db.prepare(
      `SELECT t.gravacao_id, t.origem, t.seq, t.inicio_s, t.fim_s, t.texto
         FROM transcricao_trechos t JOIN gravacoes g ON g.id = t.gravacao_id
        WHERE g.reuniao_id = ?
        ORDER BY t.gravacao_id, t.inicio_s, t.origem`
    ).bind(reuniaoId).all();
    return json({ gravacoes: gravacoes || [], trechos: trechos || [] }, 200, cabecalhos);
  } catch (e) {
    const semTabela = /no such table/i.test(e.message || '');
    return json({ gravacoes: [], trechos: [], aviso: semTabela ? 'Falta aplicar a migração 020.' : e.message }, 200, cabecalhos);
  }
}

/* ==========================================================================
   POST — começar, ou mandar um pedaço
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  const envIA = await ambienteDeIA(context.env);

  // --- Um pedaço de áudio ---
  if (searchParams.get('trecho')) {
    const id = Number(searchParams.get('id'));
    const g = id ? await db.prepare('SELECT * FROM gravacoes WHERE id = ?').bind(id).first() : null;
    if (!g) return json({ error: 'Gravação não encontrada.', code: 'NAO_ENCONTRADA' }, 404, cabecalhos);

    const recente = g.encerrada_em && (Date.now() - Date.parse(g.encerrada_em)) < TOLERANCIA_MS;
    if (g.status !== 'gravando' && !recente) {
      return json({ error: 'Esta gravação já foi encerrada.', code: 'ENCERRADA' }, 409, cabecalhos);
    }

    const origem = corpo.origem;
    const seq = Number(corpo.seq);
    const inicio = Number(corpo.inicio_s);
    if (!ORIGENS.includes(origem) || !Number.isInteger(seq) || seq < 0 || !Number.isFinite(inicio) || inicio < 0) {
      return json({ error: 'Pedaço de áudio inválido.', code: 'TRECHO_INVALIDO' }, 400, cabecalhos);
    }
    const audio = String(corpo.audio || '');
    if (!audio || audio.length > LIMITE_AUDIO || !/^[A-Za-z0-9+/=]+$/.test(audio.slice(0, 200))) {
      return json({ error: 'Áudio ausente ou grande demais.', code: 'AUDIO_INVALIDO' }, 400, cabecalhos);
    }

    const reuniao = await reuniaoDoLead(db, g.reuniao_id);
    try {
      const { texto } = await transcrever(envIA, { audio, lead: reuniao?.lead_nome });
      // Provisório: a frase em curso, só para a tela. O que vale é o texto
      // da frase fechada, que chega depois e é o único que fica no banco.
      if (corpo.provisorio === true) return json({ ok: true, texto, provisorio: true }, 200, cabecalhos);
      if (texto) {
        await db.prepare(
          `INSERT OR REPLACE INTO transcricao_trechos (gravacao_id, origem, seq, inicio_s, fim_s, texto, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, origem, seq, inicio, Number.isFinite(Number(corpo.fim_s)) ? Number(corpo.fim_s) : null,
          texto, new Date().toISOString()).run();
      }
      return json({ ok: true, texto }, 200, cabecalhos);
    } catch (e) {
      // O navegador tenta de novo; o erro diz o que houve.
      return json({ error: 'A transcrição deste pedaço falhou.', details: e.message, code: e.codigo || 'TRANSCRICAO' },
        e.codigo === 'SEM_TRANSCRITOR' ? 503 : 502, cabecalhos);
    }
  }

  // --- Começar ---
  const reuniao = await reuniaoDoLead(db, corpo.reuniao_id);
  if (!reuniao) return json({ error: 'Reunião não encontrada.', code: 'NAO_ENCONTRADA' }, 404, cabecalhos);
  if (reuniao.tipo !== 'reuniao') {
    return json({ error: 'Só reunião se grava — contato não.', code: 'NAO_E_REUNIAO' }, 400, cabecalhos);
  }
  if (corpo.consentimento !== true) {
    return json({ error: 'Confirme que o lead foi avisado e concordou com a gravação.', code: 'SEM_CONSENTIMENTO' }, 400, cabecalhos);
  }
  if (!MODOS.includes(corpo.modo)) {
    return json({ error: 'Modo de gravação inválido.', code: 'MODO_INVALIDO' }, 400, cabecalhos);
  }
  // A gravação é da reunião em andamento, e de quem a iniciou.
  const eu = String(usuario.email || '').toLowerCase();
  if (!reuniao.iniciada_em || reuniao.finalizada_em) {
    return json({ error: 'Inicie a reunião para gravar.', code: 'NAO_INICIADA' }, 409, cabecalhos);
  }
  if (reuniao.iniciada_por !== eu) {
    return json({ error: `Quem grava é quem iniciou a reunião (${reuniao.iniciada_por}).`, code: 'DE_OUTRA_PESSOA' }, 403, cabecalhos);
  }

  const transcritor = transcritorDisponivel(envIA);
  if (!transcritor) {
    return json({
      error: 'Não há como transcrever: ligue o Workers AI no painel da Cloudflare (binding AI) ou cadastre uma chave da OpenAI nas Configurações.',
      code: 'SEM_TRANSCRITOR'
    }, 503, cabecalhos);
  }

  // O roteiro em vigor do tipo, agora — a reunião fica presa a esta versão.
  let roteiro = null;
  if (reuniao.tipo_reuniao_erp_id) {
    try {
      roteiro = await db.prepare(
        `SELECT id, versao FROM roteiros WHERE tipo_reuniao_erp_id = ? AND ativo = 1 ORDER BY versao DESC LIMIT 1`
      ).bind(reuniao.tipo_reuniao_erp_id).first();
    } catch (e) { /* sem a 019: sem roteiro */ }
  }

  try {
    const agora = new Date().toISOString();
    // Retomar depois de o navegador fechar: a gravação que ficou aberta
    // termina aqui, e a nova segue na mesma reunião.
    await db.prepare(`UPDATE gravacoes SET status = 'encerrada', encerrada_em = ? WHERE reuniao_id = ? AND status = 'gravando'`)
      .bind(agora, reuniao.id).run();
    const g = await db.prepare(
      `INSERT INTO gravacoes (reuniao_id, lead_id, modo, consentimento_por, consentimento_em, roteiro_id,
                              roteiro_versao, transcritor, status, iniciada_por, iniciada_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'gravando', ?, ?) RETURNING *`
    ).bind(reuniao.id, reuniao.lead_id, corpo.modo, usuario.email, agora,
      roteiro?.id ?? null, roteiro?.versao ?? null, transcritor, usuario.email, agora).first();

    console.log(`[gravacoes] ${usuario.email} começou a gravar a reunião ${reuniao.id} (${corpo.modo}, ${transcritor})`);
    return json({ gravacao: g }, 201, cabecalhos);
  } catch (e) {
    const semTabela = /no such table/i.test(e.message || '');
    return json({ error: semTabela ? 'Falta aplicar a migração 020.' : 'Falha ao começar a gravação.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   PUT — encerrar
   ========================================================================== */

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const id = Number(searchParams.get('id'));
  const g = id ? await db.prepare('SELECT * FROM gravacoes WHERE id = ?').bind(id).first() : null;
  if (!g) return json({ error: 'Gravação não encontrada.', code: 'NAO_ENCONTRADA' }, 404, cabecalhos);

  let corpo = {};
  try { corpo = await context.request.json(); } catch (e) { corpo = {}; }
  if (!corpo.encerrar) return json({ error: 'Nada a alterar.' }, 400, cabecalhos);
  if (g.status === 'encerrada') return json({ gravacao: g }, 200, cabecalhos);

  const agora = new Date().toISOString();
  const duracao = Number.isFinite(Number(corpo.duracao_s)) ? Math.max(0, Math.round(Number(corpo.duracao_s))) : null;

  // Só a gravação termina. A reunião vira realizada em "Finalizar"
  // (/api/agenda), que guarda a hora de fim — desde a 2.36.0.
  await db.prepare(`UPDATE gravacoes SET status = 'encerrada', encerrada_em = ?, duracao_s = ? WHERE id = ?`)
    .bind(agora, duracao, id).run();

  const atual = await db.prepare('SELECT * FROM gravacoes WHERE id = ?').bind(id).first();
  return json({ gravacao: atual }, 200, cabecalhos);
}
