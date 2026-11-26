/**
 * /api/bio — as imagens e links da página pública /bio (2.45.0).
 *
 * Autenticação garantida pelo _middleware.js: qualquer usuário ativo do
 * CRM edita (decidido com o Jair em 23/11/2026: autonomia para trocar as
 * imagens sem depender de desenvolvimento). Quem trocou fica gravado.
 *
 * GET                 { vagas: [{ vaga, rotulo, aceitaLink, temImagem, link, versao, atualizadoPor, atualizadoEm }] }
 * PUT    ?vaga=capa   corpo { imagem?: "data:image/...;base64,...", link?: "https://..." }
 *                     `imagem` ausente mantém a atual; `link` ausente mantém o atual.
 * DELETE ?vaga=capa   tira a imagem e o link: a página volta ao padrão.
 */

import { VAGAS, vagaValida, tipoDaImagem, bytesDoDataUrl, normalizarLink, LIMITE_IMAGEM_BYTES } from './_lib/bio.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const semTabela = (e) => /no such table/i.test(String(e?.message));
const AVISO_SEM_MIGRACAO = 'O banco ainda não tem a migração 030 (BIO).';

function lerVaga(context) {
  const vaga = new URL(context.request.url).searchParams.get('vaga');
  return vagaValida(vaga) ? vaga : null;
}

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  let linhas = [];
  let aviso = null;
  try {
    const r = await db
      .prepare(`SELECT vaga, imagem IS NOT NULL AS tem_imagem, link, versao, atualizado_por, atualizado_em
                  FROM bio_vagas`)
      .all();
    linhas = r.results || [];
  } catch (e) {
    if (!semTabela(e)) return json({ error: 'Falha ao ler a BIO.', details: e.message }, 500, cabecalhos);
    aviso = AVISO_SEM_MIGRACAO;
  }

  const porVaga = new Map(linhas.map((l) => [l.vaga, l]));
  const vagas = Object.entries(VAGAS).map(([vaga, def]) => {
    const l = porVaga.get(vaga);
    return {
      vaga,
      rotulo: def.rotulo,
      aceitaLink: def.link,
      temImagem: Boolean(l?.tem_imagem),
      link: l?.link || null,
      versao: l?.versao || 0,
      atualizadoPor: l?.atualizado_por || null,
      atualizadoEm: l?.atualizado_em || null
    };
  });

  return json({ vagas, aviso }, 200, cabecalhos);
}

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const vaga = lerVaga(context);
  if (!vaga) return json({ error: 'Lugar de imagem desconhecido.', code: 'VAGA_INVALIDA' }, 400, cabecalhos);

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos); }
  corpo = corpo || {};

  const mudaImagem = corpo.imagem !== undefined;
  const mudaLink = corpo.link !== undefined;
  if (!mudaImagem && !mudaLink) {
    return json({ error: 'Envie a imagem ou o link.', code: 'NADA_A_GRAVAR' }, 400, cabecalhos);
  }

  let bytes = null;
  let tipo = null;
  if (mudaImagem) {
    bytes = bytesDoDataUrl(corpo.imagem);
    if (!bytes) return json({ error: 'A imagem chegou corrompida.', code: 'IMAGEM_INVALIDA' }, 400, cabecalhos);
    if (bytes.length > LIMITE_IMAGEM_BYTES) {
      return json({ error: 'A imagem é grande demais, mesmo comprimida. Use uma foto menor.', code: 'GRANDE_DEMAIS' }, 413, cabecalhos);
    }
    tipo = tipoDaImagem(bytes);
    if (!tipo) return json({ error: 'Use uma imagem JPG, PNG ou WebP.', code: 'TIPO_INVALIDO' }, 415, cabecalhos);
  }

  let link = null;
  if (mudaLink) {
    if (!VAGAS[vaga].link && corpo.link) {
      return json({ error: 'Este lugar não aceita link.', code: 'SEM_LINK' }, 400, cabecalhos);
    }
    const n = normalizarLink(corpo.link);
    if (n.erro) return json({ error: n.erro, code: 'LINK_INVALIDO' }, 400, cabecalhos);
    link = n.link;
  }

  const agora = new Date().toISOString();
  const quem = context.data.usuario.email;

  try {
    // Uma instrução só: cria a vaga ou atualiza só o que veio.
    await db
      .prepare(
        `INSERT INTO bio_vagas (vaga, imagem, imagem_tipo, link, versao, atualizado_por, atualizado_em)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)
         ON CONFLICT (vaga) DO UPDATE SET
           imagem         = CASE WHEN ?7 THEN excluded.imagem      ELSE bio_vagas.imagem      END,
           imagem_tipo    = CASE WHEN ?7 THEN excluded.imagem_tipo ELSE bio_vagas.imagem_tipo END,
           link           = CASE WHEN ?8 THEN excluded.link        ELSE bio_vagas.link        END,
           versao         = bio_vagas.versao + 1,
           atualizado_por = excluded.atualizado_por,
           atualizado_em  = excluded.atualizado_em`
      )
      // D1 grava ArrayBuffer como BLOB.
      .bind(vaga, bytes ? bytes.buffer : null, tipo, link, quem, agora, mudaImagem ? 1 : 0, mudaLink ? 1 : 0)
      .run();

    const linha = await db.prepare('SELECT versao FROM bio_vagas WHERE vaga = ?').bind(vaga).first();
    return json({ ok: true, vaga, versao: linha?.versao || 1, atualizadoEm: agora }, 200, cabecalhos);

  } catch (e) {
    if (semTabela(e)) return json({ error: AVISO_SEM_MIGRACAO, code: 'SEM_MIGRACAO_030' }, 503, cabecalhos);
    return json({ error: 'Falha ao salvar.', details: e.message }, 500, cabecalhos);
  }
}

export async function onRequestDelete(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const vaga = lerVaga(context);
  if (!vaga) return json({ error: 'Lugar de imagem desconhecido.', code: 'VAGA_INVALIDA' }, 400, cabecalhos);

  try {
    // Não apaga a linha: a versão tem que continuar subindo. Se voltasse a
    // 1, o endereço ?v=1 de uma imagem antiga — guardado em cache por um
    // ano no navegador de quem visitou — voltaria a valer.
    await db
      .prepare(`UPDATE bio_vagas
                   SET imagem = NULL, imagem_tipo = NULL, link = NULL, versao = versao + 1,
                       atualizado_por = ?, atualizado_em = ?
                 WHERE vaga = ?`)
      .bind(context.data.usuario.email, new Date().toISOString(), vaga)
      .run();
    return json({ ok: true, vaga }, 200, cabecalhos);
  } catch (e) {
    if (semTabela(e)) return json({ error: AVISO_SEM_MIGRACAO, code: 'SEM_MIGRACAO_030' }, 503, cabecalhos);
    return json({ error: 'Falha ao remover.', details: e.message }, 500, cabecalhos);
  }
}
