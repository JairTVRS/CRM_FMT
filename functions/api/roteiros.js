/**
 * /api/roteiros — o roteiro de cada tipo de reunião (2.34.0).
 *
 * GET                      o roteiro em vigor de cada tipo (sem o texto)
 * GET ?tipo=ID             o em vigor daquele tipo, com o texto
 * GET ?tipo=ID&versao=N    uma versão antiga
 * GET ?tipo=ID&historico=1 as versões daquele tipo (sem o texto)
 * POST                     só admin: envia um .md — cria a versão seguinte
 *
 * `finalidade` (2.38.0, na consulta ou no corpo): 'roteiro' (o padrão) ou
 * 'dossie_reuniao' — a instrução que a IA segue para montar o Dossiê da
 * Reunião. Os dois são um .md por tipo, com versões, e moram na mesma
 * tabela; a numeração é por tipo E finalidade. A lista sem `tipo` traz
 * o em vigor de cada tipo e finalidade.
 *
 * O roteiro é um arquivo .md feito pela equipe, com os objetivos e as
 * perguntas da reunião. Nas próximas entregas a IA o lê durante a
 * reunião para sugerir o que ainda falta perguntar (2.36.0). Aqui ele só
 * é guardado, versionado e mostrado.
 *
 * Enviar de novo nunca sobrescreve: a reunião registra a versão que usou.
 */

import { exigirAdmin } from './_lib/admin.js';

/** ~200 mil caracteres: um roteiro de reunião cabe com muita folga. */
export const LIMITE_ROTEIRO = 200_000;

export const FINALIDADES = ['roteiro', 'dossie_reuniao'];
const NOME_FINALIDADE = { roteiro: 'roteiro', dossie_reuniao: 'instrução do dossiê da reunião' };
/** A finalidade pedida; `null` se veio uma que não existe. */
const finalidadeDe = (valor) => {
  const f = String(valor || 'roteiro').trim();
  return FINALIDADES.includes(f) ? f : null;
};

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const RESUMO = 'id, tipo_reuniao_erp_id, tipo_reuniao_nome, finalidade, versao, nome_arquivo, tamanho, enviado_por, enviado_em';

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    const tipo = String(searchParams.get('tipo') || '').trim();

    if (!tipo) {
      // O em vigor de cada tipo e finalidade: a maior versão ativa.
      const { results } = await db.prepare(
        `SELECT ${RESUMO} FROM roteiros r
          WHERE ativo = 1 AND versao = (SELECT MAX(versao) FROM roteiros x
                                         WHERE x.tipo_reuniao_erp_id = r.tipo_reuniao_erp_id
                                           AND x.finalidade = r.finalidade AND x.ativo = 1)
          ORDER BY tipo_reuniao_nome COLLATE NOCASE`
      ).all();
      return json({ roteiros: results || [] }, 200, cabecalhos);
    }

    const finalidade = finalidadeDe(searchParams.get('finalidade'));
    if (!finalidade) return json({ error: 'Finalidade inválida.', code: 'FINALIDADE_INVALIDA' }, 400, cabecalhos);

    if (searchParams.get('historico')) {
      const { results } = await db.prepare(
        `SELECT ${RESUMO} FROM roteiros WHERE tipo_reuniao_erp_id = ? AND finalidade = ? AND ativo = 1 ORDER BY versao DESC`
      ).bind(tipo, finalidade).all();
      return json({ versoes: results || [] }, 200, cabecalhos);
    }

    const versao = Number(searchParams.get('versao')) || null;
    const roteiro = await db.prepare(
      versao
        ? `SELECT * FROM roteiros WHERE tipo_reuniao_erp_id = ? AND finalidade = ? AND versao = ? AND ativo = 1`
        : `SELECT * FROM roteiros WHERE tipo_reuniao_erp_id = ? AND finalidade = ? AND ativo = 1 ORDER BY versao DESC LIMIT 1`
    ).bind(...(versao ? [tipo, finalidade, versao] : [tipo, finalidade])).first();

    if (!roteiro) {
      return json({ error: `Este tipo de reunião ainda não tem ${NOME_FINALIDADE[finalidade]}.`, code: 'SEM_ROTEIRO' }, 404, cabecalhos);
    }
    return json({ roteiro }, 200, cabecalhos);

  } catch (e) {
    const semTabela = /no such table/i.test(e.message || '');
    return json({
      roteiros: [],
      aviso: semTabela ? 'Falta aplicar a migração 019.' : 'Falha ao consultar os roteiros.',
      details: e.message
    }, semTabela ? 200 : 500, cabecalhos);
  }
}

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const recusa = await exigirAdmin(context);
  if (recusa) return recusa;

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  const tipo = String(corpo.tipo_reuniao_erp_id || '').trim().slice(0, 64);
  if (!tipo) return json({ error: 'Escolha o tipo de reunião.', code: 'TIPO_OBRIGATORIO' }, 400, cabecalhos);
  const finalidade = finalidadeDe(corpo.finalidade);
  if (!finalidade) return json({ error: 'Finalidade inválida.', code: 'FINALIDADE_INVALIDA' }, 400, cabecalhos);

  const nomeArquivo = String(corpo.nome_arquivo || '').trim().slice(0, 200) || null;
  if (nomeArquivo && !/\.(md|markdown|txt)$/i.test(nomeArquivo)) {
    return json({ error: 'Envie o arquivo como .md (ou .txt).', code: 'FORMATO_INVALIDO' }, 400, cabecalhos);
  }

  // Normaliza quebras de linha do Windows; guarda o texto como veio.
  const conteudo = String(corpo.conteudo ?? '').replace(/\r\n/g, '\n');
  if (!conteudo.trim()) return json({ error: 'O arquivo está vazio.', code: 'VAZIO' }, 400, cabecalhos);
  if (conteudo.length > LIMITE_ROTEIRO) {
    return json({ error: 'O arquivo passa de 200 mil caracteres. Divida ou resuma.', code: 'GRANDE_DEMAIS' }, 400, cabecalhos);
  }

  try {
    const ultima = await db.prepare(
      'SELECT COALESCE(MAX(versao), 0) AS n FROM roteiros WHERE tipo_reuniao_erp_id = ? AND finalidade = ?'
    ).bind(tipo, finalidade).first();
    const versao = Number(ultima?.n || 0) + 1;

    await db.prepare(
      `INSERT INTO roteiros (tipo_reuniao_erp_id, tipo_reuniao_nome, finalidade, versao, nome_arquivo, conteudo,
                             tamanho, enviado_por, enviado_em, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(tipo, String(corpo.tipo_reuniao_nome || '').slice(0, 120) || null, finalidade, versao, nomeArquivo,
      conteudo, conteudo.length, usuario.email, new Date().toISOString()).run();

    console.log(`[roteiros] ${usuario.email} enviou v${versao} (${finalidade}) do tipo ${tipo}`);
    return json({ ok: true, versao }, 201, cabecalhos);
  } catch (e) {
    const semColuna = /no such column|has no column/i.test(e.message || '');
    return json({ error: semColuna ? 'Falta aplicar a migração 025.' : 'Falha ao guardar o arquivo.', details: e.message }, 500, cabecalhos);
  }
}
