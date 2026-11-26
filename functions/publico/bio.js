/**
 * GET /publico/bio — o que a página pública /bio precisa saber (2.45.0).
 *
 * SEM LOGIN, de propósito: quem abre a página é qualquer pessoa. Por isso
 * fica fora de /api (onde o _middleware.js exige sessão) e só LÊ:
 *   - das vagas da lista fixa (_lib/bio.js), a versão da imagem e o link;
 *   - os últimos vídeos do canal do YouTube.
 * Nada de dado de lead, cliente ou usuário — nem quem trocou a imagem.
 *
 *   - as perguntas do questionário (2.46.0), que vivem em
 *     _lib/questionario-bio.js — a página não tem cópia delas.
 *
 * { vagas: { capa: { v: 3, link: null }, ... }, videos: [{ id, titulo, publicado }],
 *   questionario: [{ id, tipo, titulo, opcoes, ... }] }
 * Só aparecem as vagas que têm imagem ou link.
 */

import { VAGAS, buscarVideos } from '../api/_lib/bio.js';
import { perguntasParaPagina } from '../api/_lib/questionario-bio.js';

export async function onRequestGet(context) {
  const vagas = {};
  try {
    const r = await context.env.DB
      .prepare('SELECT vaga, imagem IS NOT NULL AS tem_imagem, link, versao FROM bio_vagas')
      .all();
    for (const l of r.results || []) {
      if (!VAGAS[l.vaga] || (!l.tem_imagem && !l.link)) continue;
      vagas[l.vaga] = { v: l.tem_imagem ? l.versao : 0, link: l.link || null };
    }
  } catch (e) {
    // Sem a migração 030 (ou sem banco): a página abre no padrão.
  }

  const videos = await buscarVideos();

  return new Response(JSON.stringify({ vagas, videos, questionario: perguntasParaPagina() }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Um minuto: a troca de imagem no CRM aparece logo para quem visita.
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
