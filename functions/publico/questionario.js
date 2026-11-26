/**
 * POST /publico/questionario — o envio do questionário da página BIO (2.46.0).
 *
 * SEM LOGIN, como a /bio: quem responde é qualquer pessoa. É a ÚNICA rota
 * pública que grava, e grava só isto: um lead novo em "Novo Lead" (ou um
 * registro no lead que já existe) e a linha em `bio_respostas`.
 *
 * Contra robôs, sem cadastro em serviço de fora:
 *   - campo-isca `site`, invisível para gente: veio preenchido, é robô;
 *   - tempo mínimo entre abrir e enviar (TEMPO_MINIMO_MS);
 *   - no máximo LIMITE_POR_HORA envios por aparelho (IP com hash e sal);
 *   - só do próprio site (Origin) e corpo pequeno.
 * Robô recebe "ok" — não aprende o que o barrou.
 *
 * Não duplica lead: mesmo CNPJ/CPF ou mesmo telefone de um lead ativo →
 * o envio é anexado a ele (aparece no relógio da ficha).
 */

import {
  validarQuestionario, observacoesDoLead, linhasDasRespostas, hashDoIp,
  CANAL_BIO, AUTOR_BIO, TEMPO_MINIMO_MS, LIMITE_POR_HORA
} from '../api/_lib/questionario-bio.js';
import { registrarEventoLead } from '../api/_lib/lead-eventos.js';

const MAX_CORPO = 8 * 1024;

function resposta(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

/** "26/11/2026 14:32", no horário de Brasília. */
function quandoBr(agora) {
  return agora.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).replace(',', '');
}

/** AAAA-MM-DD em Brasília (UTC−3). */
const hojeBr = (agora) => new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const agora = context.agora || new Date();

  // Só do próprio site. Sem Origin (alguns navegadores antigos), passa.
  const origem = request.headers.get('Origin');
  if (origem && origem !== new URL(request.url).origin) {
    return resposta({ error: 'Origem não permitida.' }, 403);
  }

  const bruto = await request.text();
  if (bruto.length > MAX_CORPO) return resposta({ error: 'Envio grande demais.' }, 413);
  let corpo;
  try { corpo = JSON.parse(bruto); } catch (e) { return resposta({ error: 'Envio inválido.' }, 400); }

  // Robô: responde ok e não grava nada.
  if (corpo?.site || !(Number(corpo?.t) >= TEMPO_MINIMO_MS)) return resposta({ ok: true });

  const v = validarQuestionario(corpo);
  if (v.erro) return resposta({ error: v.erro, campo: v.campo || null }, 400);
  const d = v.dados;

  if (!db) return resposta({ error: 'Não foi possível receber agora.', code: 'SEM_BANCO' }, 503);

  const ipHash = await hashDoIp(request.headers.get('CF-Connecting-IP'), env.SESSAO_SECRET || 'crm-fmt-bio');
  const umaHoraAtras = new Date(agora.getTime() - 3600 * 1000).toISOString();
  try {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM bio_respostas WHERE ip_hash = ? AND criado_em > ?')
      .bind(ipHash, umaHoraAtras).first();
    if ((n?.n || 0) >= LIMITE_POR_HORA) {
      return resposta({ error: 'Recebemos vários envios deste aparelho. Tente de novo mais tarde ou fale pelo WhatsApp.', code: 'LIMITE' }, 429);
    }
  } catch (e) {
    // Sem a migração 031: a página oferece o WhatsApp.
    return resposta({ error: 'O questionário ainda não está disponível.', code: 'SEM_MIGRACAO' }, 503);
  }

  const agoraIso = agora.toISOString();
  const linhas = linhasDasRespostas(d);

  // Já é lead? Pelo documento; sem ele, pelo telefone.
  let existente = null;
  if (d.documento) {
    existente = await db.prepare('SELECT id FROM leads WHERE ativo = 1 AND documento = ? LIMIT 1').bind(d.documento).first();
  }
  if (!existente) {
    existente = await db.prepare('SELECT id FROM leads WHERE ativo = 1 AND telefone = ? ORDER BY id DESC LIMIT 1').bind(d.telefone).first();
  }

  let leadId = existente?.id || null;
  let situacao = 'anexado';

  if (!leadId) {
    const etapa = await db.prepare(
      "SELECT id FROM etapas WHERE ativo = 1 AND pipeline = 'comercial' ORDER BY ordem LIMIT 1"
    ).first();
    try {
      const novo = await db.prepare(
        `INSERT INTO leads (nome, documento, telefone, email, contato_nome, canal, etapa_id, posicao, tags,
                            observacoes, data_cadastro, responsavel, criado_por, criado_em, ativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, '[]', ?, ?, NULL, ?, ?, 1) RETURNING id`
      ).bind(
        d.nome, d.documento, d.telefone, d.email, d.nome, CANAL_BIO, etapa?.id || null,
        observacoesDoLead(d, quandoBr(agora)), hojeBr(agora), AUTOR_BIO, agoraIso
      ).first();
      leadId = novo?.id || null;
      situacao = 'criado';
    } catch (e) {
      // Outro envio com o mesmo documento entrou no meio: anexa a ele.
      const ja = d.documento
        ? await db.prepare('SELECT id FROM leads WHERE ativo = 1 AND documento = ? LIMIT 1').bind(d.documento).first()
        : null;
      if (!ja) {
        console.error(`[questionario-bio] lead não criado: ${e.message}`);
        return resposta({ error: 'Não foi possível receber agora. Tente de novo ou fale pelo WhatsApp.' }, 500);
      }
      leadId = ja.id;
    }
  }

  await db.prepare(
    `INSERT INTO bio_respostas (lead_id, situacao, nome, telefone, email, documento, respostas, desafio, ip_hash, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(leadId, situacao, d.nome, d.telefone, d.email, d.documento,
    JSON.stringify(d.respostas), d.desafio, ipHash, agoraIso).run();

  await registrarEventoLead(db, {
    leadId, evento: 'questionario_bio', por: AUTOR_BIO, em: agoraIso,
    detalhe: { novo: situacao === 'criado', nome: d.nome, telefone: d.telefone, linhas }
  });

  return resposta({ ok: true });
}
