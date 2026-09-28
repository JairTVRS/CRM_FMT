/**
 * _lib/prospects.js — os prospects do ERP entram como leads (2.33.0).
 *
 * Decidido em 28/09/2026: os prospects que estão no ERP ficavam "soltos",
 * sem o CRM para a gestão. Uma vez por dia, cada prospect que o CRM ainda
 * não viu entra no funil:
 *
 *   - em "Novo Lead" (a primeira etapa), canal "ERP (prospect)",
 *     SEM responsável — os CX fazem o vínculo;
 *   - quem já existe no CRM com o mesmo CNPJ NÃO é duplicado: só ganha o
 *     `erp_id`;
 *   - o CNPJ que só existe em lead EXCLUÍDO não volta — alguém tirou esse
 *     lead do funil de propósito;
 *   - depois de importado, o CRM é o dono: mudar o prospect no ERP não
 *     muda o lead.
 *
 * A memória de "já vi" é a tabela `prospects_erp`, pelo id do ERP. Não é
 * o CNPJ: há prospect sem CNPJ, e o id é o que o ERP garante único.
 */

import { listarClientesDoHub } from './hub.js';
import { documentoValido, soDigitos } from './documento.js';

export const CANAL_ERP = 'ERP (prospect)';

/** Quantos prospects por batch (até dois comandos cada): folga para o D1. */
const POR_LOTE = 20;

/** A data de hoje no horário de Brasília (UTC−3, sem horário de verão). */
export function hojeEmBrasilia(agora = new Date()) {
  return new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Decide o que fazer com cada prospect, sem gravar nada. Separada da
 * gravação para a regra poder ser conferida sozinha.
 *
 * @param prospects   os do hub, já traduzidos (`traduzirCliente`)
 * @param conhecidos  Set de erp_id que o CRM já viu
 * @param leads       [{ id, documento, ativo }] — os leads com documento
 * @returns [{ acao: 'criar'|'vincular'|'excluido', prospect, documento, leadId? }]
 */
export function planejar(prospects, conhecidos, leads) {
  const ativos = new Map();
  const excluidos = new Set();
  for (const l of leads) {
    const doc = soDigitos(l.documento);
    if (!doc) continue;
    if (l.ativo) ativos.set(doc, l.id);
    else excluidos.add(doc);
  }

  const plano = [];
  const vistosAgora = new Set();     // o mesmo CNPJ duas vezes no ERP

  for (const p of prospects) {
    if (!p?.erp_id || conhecidos.has(String(p.erp_id))) continue;
    const doc = p.documento && documentoValido(p.documento) ? soDigitos(p.documento) : null;

    if (doc && ativos.has(doc)) {
      plano.push({ acao: 'vincular', prospect: p, documento: doc, leadId: ativos.get(doc) });
    } else if (doc && vistosAgora.has(doc)) {
      // Segundo prospect com o mesmo CNPJ nesta rodada: o primeiro já
      // vai virar lead. Vincula a ele, pelo CNPJ, na gravação.
      plano.push({ acao: 'vincular', prospect: p, documento: doc, leadId: null });
    } else if (doc && excluidos.has(doc)) {
      plano.push({ acao: 'excluido', prospect: p, documento: doc });
    } else {
      plano.push({ acao: 'criar', prospect: p, documento: doc });
    }
    if (doc) vistosAgora.add(doc);
  }
  return plano;
}

/** Os comandos de cada prospect, agrupados: um grupo nunca se divide. */
function comandos(db, plano, { etapaId, usuario, agora, dia, importacaoId }) {
  const grupos = [];
  let lista;
  const lembrar = (p, doc, situacao, leadSql, leadArgs = []) => lista.push(
    db.prepare(
      `INSERT OR IGNORE INTO prospects_erp (erp_id, documento, lead_id, situacao, importado_em, importacao_id)
       VALUES (?, ?, ${leadSql}, ?, ?, ?)`
    ).bind(String(p.erp_id), doc, ...leadArgs, situacao, agora, importacaoId)
  );

  for (const item of plano) {
    const p = item.prospect;
    lista = [];
    grupos.push(lista);

    if (item.acao === 'criar') {
      lista.push(db.prepare(
        `INSERT INTO leads (nome, documento, telefone, email, canal, etapa_id, posicao, tags,
                            data_cadastro, responsavel, erp_id, criado_por, criado_em, ativo)
         VALUES (?, ?, ?, ?, ?, ?, 0, '[]', ?, NULL, ?, ?, ?, 1)`
      ).bind(
        String(p.nome || p.nome_fantasia || 'Prospect sem nome').slice(0, 200),
        item.documento, p.telefone ? String(p.telefone).slice(0, 30) : null,
        p.email ? String(p.email).slice(0, 160) : null,
        CANAL_ERP, etapaId, dia, String(p.erp_id), usuario, agora
      ));
      lembrar(p, item.documento, 'criado',
        '(SELECT id FROM leads WHERE erp_id = ? AND ativo = 1 ORDER BY id DESC LIMIT 1)', [String(p.erp_id)]);

    } else if (item.acao === 'vincular') {
      // O lead existente ganha o erp_id — só se ainda não tiver um.
      const alvo = item.leadId
        ? ['id = ?', item.leadId]
        : ['documento = ? AND ativo = 1', item.documento];
      lista.push(db.prepare(
        `UPDATE leads SET erp_id = COALESCE(erp_id, ?) WHERE ${alvo[0]}`
      ).bind(String(p.erp_id), alvo[1]));
      lembrar(p, item.documento, 'vinculado',
        '(SELECT id FROM leads WHERE documento = ? AND ativo = 1 LIMIT 1)', [item.documento]);

    } else {
      lembrar(p, item.documento, 'excluido_no_crm', 'NULL');
    }
  }
  return grupos;
}

/**
 * Uma rodada inteira: lê o ERP, planeja, grava, registra.
 *
 * @param origem  'diaria' (o Worker) ou 'manual' (o admin)
 * @returns o registro da rodada, com os números
 */
export async function importarProspects(env, db, { usuario, origem, agora = new Date() }) {
  const agoraIso = agora.toISOString();
  const dia = hojeEmBrasilia(agora);

  // A diária roda uma vez por dia. Uma segunda chamada no mesmo dia
  // (o Cron que tentou de novo) responde a primeira em vez de refazer.
  if (origem === 'diaria') {
    const feita = await db.prepare(
      `SELECT * FROM importacoes_erp WHERE origem = 'diaria' AND dia = ? AND erro IS NULL
        AND concluido_em IS NOT NULL ORDER BY id DESC LIMIT 1`
    ).bind(dia).first();
    if (feita) return { ...feita, jaFeita: true };
  }

  const aberta = await db.prepare(
    `INSERT INTO importacoes_erp (origem, por, dia, iniciado_em) VALUES (?, ?, ?, ?) RETURNING id`
  ).bind(origem, usuario, dia, agoraIso).first();
  const importacaoId = aberta?.id;

  const concluir = (campos) => db.prepare(
    `UPDATE importacoes_erp SET concluido_em = ?, total_hub = ?, criados = ?, vinculados = ?,
            ignorados = ?, aviso = ?, erro = ? WHERE id = ?`
  ).bind(new Date().toISOString(), campos.total_hub ?? null, campos.criados ?? 0,
    campos.vinculados ?? 0, campos.ignorados ?? 0, campos.aviso ?? null, campos.erro ?? null, importacaoId).run();

  try {
    const { clientes, truncado } = await listarClientesDoHub(env, { status: 'prospect', maxPaginas: 50 });

    const [vistos, leads, etapa] = await Promise.all([
      db.prepare('SELECT erp_id FROM prospects_erp').all(),
      db.prepare("SELECT id, documento, ativo FROM leads WHERE documento IS NOT NULL AND documento <> ''").all(),
      db.prepare("SELECT id FROM etapas WHERE ativo = 1 AND pipeline = 'comercial' ORDER BY ordem LIMIT 1").first()
    ]);

    const conhecidos = new Set((vistos.results || []).map((r) => String(r.erp_id)));
    const plano = planejar(clientes, conhecidos, leads.results || []);
    const grupos = comandos(db, plano, { etapaId: etapa?.id || null, usuario, agora: agoraIso, dia, importacaoId });

    // Em lotes de prospects inteiros. Cada batch é transacional, e os
    // comandos de um prospect (o lead e a memória de "já vi") vão sempre
    // no mesmo: nunca fica um lead criado sem a memória, que o recriaria
    // amanhã.
    for (let i = 0; i < grupos.length; i += POR_LOTE) {
      await db.batch(grupos.slice(i, i + POR_LOTE).flat());
    }

    const conta = (acao) => plano.filter((x) => x.acao === acao).length;
    const numeros = {
      total_hub: clientes.length,
      criados: conta('criar'),
      vinculados: conta('vincular'),
      ignorados: conta('excluido'),
      aviso: truncado ? 'O ERP tem mais prospects do que a leitura alcança numa rodada; o restante entra nas próximas.' : null
    };
    await concluir(numeros);
    return { id: importacaoId, origem, dia, ...numeros };

  } catch (e) {
    await concluir({ erro: String(e.message || e).slice(0, 500) });
    throw e;
  }
}
