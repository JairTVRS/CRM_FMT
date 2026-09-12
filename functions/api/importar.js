/**
 * /api/importar — criação de leads em lote.
 *
 * O arquivo é lido NO NAVEGADOR e chega aqui como JSON já estruturado.
 * A planilha inteira nunca sobe para o servidor: o consultor vê os
 * problemas antes de qualquer coisa ser gravada, e nenhum dado
 * comercial trafega além do necessário.
 *
 * Autenticação garantida pelo _middleware.js.
 *
 * POST { linhas: [...], confirmar: false }  → só valida e devolve o resumo
 * POST { linhas: [...], confirmar: true }   → grava
 *
 * Regras acordadas:
 *   - Documento ausente ou inválido BARRA a importação inteira.
 *   - Documento já cadastrado ATUALIZA o lead, não duplica.
 *   - Célula vazia NÃO sobrescreve o que já está preenchido.
 */

import { soDigitos, documentoValido } from './_lib/documento.js';

const MAX_LINHAS = 2000;

/* ==========================================================================
   CONVERSORES
   Espelham os do /api/leads. Ficam aqui também porque a importação
   precisa reportar o que converteu ANTES de gravar.
   ========================================================================== */

const texto = (v, limite = 500) => {
  if (v == null) return null;
  const t = String(v).trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, limite) : null;
};

function paraCentavos(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return Math.round(valor * 100);
  const limpo = String(valor).replace(/[R$\s]/g, '');
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Faixa de sanidade das datas que chegam da planilha.
 *
 * Existe por um caso concreto: na planilha de propostas a coluna
 * "Data Fechamento2" tem FORMATO de data aplicado, mas 37 das 98 linhas
 * guardam valores de dinheiro (9900, 6300). O Excel e o leitor de
 * planilhas obedecem ao formato e entregam "07/02/1927" — uma data
 * perfeitamente válida, perfeitamente errada, que entraria sem reclamar.
 *
 * Data fora da faixa vira nulo: campo vazio é recuperável, data falsa
 * gravada no histórico comercial não é.
 */
const ANO_MINIMO = 1990;
const ANOS_A_FRENTE = 10;

function dentroDaFaixa(iso) {
  const ano = Number(iso.slice(0, 4));
  return ano >= ANO_MINIMO && ano <= new Date().getFullYear() + ANOS_A_FRENTE;
}

function paraDataIso(valor) {
  if (!valor) return null;
  const t = String(valor).trim();

  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (br) {
    const [, d, m, a] = br;
    const ano = a.length === 2 ? `20${a}` : a;
    const iso = `${ano}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return dentroDaFaixa(iso) ? iso : null;
  }

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso && dentroDaFaixa(iso[0]) ? iso[0] : null;
}

function normalizarSegmento(valor) {
  const t = texto(valor, 60);
  if (!t) return null;
  const mapa = {
    'SERVICO': 'SERVIÇOS', 'SERVIÇO': 'SERVIÇOS', 'SERVICOS': 'SERVIÇOS',
    'INDUSTRIA': 'INDÚSTRIA', 'INDÚSTRIA': 'INDÚSTRIA',
    'VAREJO': 'VAREJO', 'ONG': 'ONG'
  };
  return mapa[t.toUpperCase()] || t.toUpperCase();
}

/** URL só é aceita se for http(s); o valor vira link na interface. */
function normalizarUrl(valor) {
  const t = texto(valor, 300);
  if (!t) return null;
  const comProtocolo = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(comProtocolo);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch (e) {
    return null;
  }
}

/* ==========================================================================
   VALIDAÇÃO
   ========================================================================== */

function normalizarLinha(bruta) {
  return {
    nome: texto(bruta.nome, 200),
    documento: bruta.documento ? soDigitos(bruta.documento) : null,
    telefone: texto(bruta.telefone, 30),
    cidade: texto(bruta.cidade, 120),
    segmento: normalizarSegmento(bruta.segmento),
    canal: texto(bruta.canal, 60),
    atendente: texto(bruta.atendente, 160),
    advisor: texto(bruta.advisor, 60),
    etapa: texto(bruta.etapa, 60),
    observacoes: texto(bruta.observacoes, 4000),
    site: normalizarUrl(bruta.site),
    instagram: normalizarUrl(bruta.instagram),
    data_cadastro: paraDataIso(bruta.data_cadastro),
    data_ultimo_contato: paraDataIso(bruta.data_ultimo_contato),
    data_proximo_contato: paraDataIso(bruta.data_proximo_contato),
    data_fechamento: paraDataIso(bruta.data_fechamento),
    valor_proposta: paraCentavos(bruta.valor_proposta),
    valor_diagnostico: paraCentavos(bruta.valor_diagnostico),
    _linha: Number(bruta._linha) || 0
  };
}

/**
 * Confere a planilha inteira antes de gravar qualquer coisa.
 *
 * Documento ausente ou inválido é bloqueante: sem ele o lead não tem
 * identidade e o dossiê não tem contexto para a IA. A importação
 * inteira para, com a lista das linhas a corrigir.
 */
function validar(linhas) {
  const semDocumento = [];
  const documentoInvalido = [];
  const semNome = [];
  const duplicadasNoArquivo = [];
  const vistos = new Map();

  linhas.forEach((l) => {
    if (!l.nome) semNome.push(l._linha);

    if (!l.documento) {
      semDocumento.push(l._linha);
    } else if (!documentoValido(l.documento)) {
      documentoInvalido.push({ linha: l._linha, documento: l.documento });
    } else if (vistos.has(l.documento)) {
      duplicadasNoArquivo.push({ linha: l._linha, primeira: vistos.get(l.documento) });
    } else {
      vistos.set(l.documento, l._linha);
    }
  });

  return { semDocumento, documentoInvalido, semNome, duplicadasNoArquivo };
}

/* ==========================================================================
   CADASTROS DE APOIO
   Advisor e etapa chegam como texto da planilha e precisam virar ID.

   Leitura e escrita ficam separadas de propósito: a PRÉVIA precisa dizer
   o que será criado sem criar nada. Até a v2.23 os advisors nasciam em
   silêncio no momento da gravação, e o usuário só descobria depois, na
   tela de sucesso.
   ========================================================================== */

/**
 * Só as etapas do funil COMERCIAL. A planilha traz o nome da etapa em
 * texto, e sem o filtro por pipeline um "Encerrado" da jornada do
 * cliente entraria no mapa — a importação de leads jogaria registros na
 * trilha de CX. A etapa padrão tem o mesmo risco: a jornada também
 * começa em ordem 1.
 */
async function lerApoio(db) {
  const { results: etapas } = await db
    .prepare(`SELECT id, nome FROM etapas
              WHERE ativo = 1 AND pipeline = 'comercial' ORDER BY ordem`).all();
  const { results: advisors } = await db
    .prepare('SELECT id, nome FROM advisors WHERE ativo = 1').all();

  return {
    etapas: etapas || [],
    mapaEtapa: new Map((etapas || []).map((e) => [e.nome.toUpperCase(), e.id])),
    mapaAdvisor: new Map((advisors || []).map((a) => [a.nome.toUpperCase(), a.id])),
    etapaPadrao: etapas?.[0] || null
  };
}

/** Os nomes distintos que a planilha trouxe para um campo, com a contagem. */
function distintos(linhas, campo) {
  const contagem = new Map();
  for (const l of linhas) {
    const valor = l[campo];
    if (!valor) continue;
    contagem.set(valor, (contagem.get(valor) || 0) + 1);
  }
  return [...contagem].map(([nome, linhas]) => ({ nome, linhas }));
}

/**
 * O que a planilha pede que ainda não existe no CRM.
 *
 * Não escreve nada. É o que a prévia mostra para o usuário decidir.
 */
function examinarApoio(linhas, apoio) {
  const etapas = distintos(linhas, 'etapa');
  const advisors = distintos(linhas, 'advisor');

  return {
    etapasNovas: etapas.filter((e) => !apoio.mapaEtapa.has(e.nome.toUpperCase())),
    etapasExistentes: etapas.filter((e) => apoio.mapaEtapa.has(e.nome.toUpperCase())),
    advisorsNovos: advisors.filter((a) => !apoio.mapaAdvisor.has(a.nome.toUpperCase())),
    etapasDisponiveis: apoio.etapas.map((e) => ({ id: e.id, nome: e.nome })),
    etapaPadrao: apoio.etapaPadrao
  };
}

/**
 * Cria a etapa, ou devolve a que já existe com esse nome.
 *
 * A tabela `etapas` NÃO tem índice único no nome — diferente de
 * `advisors` e `tags`. Nada no banco impede duas "Proposta", então a
 * checagem tem que estar aqui. `pipeline` é obrigatório: sem ele a
 * etapa nasceria no DEFAULT e poderia aparecer no quadro errado.
 */
async function criarEtapa(db, nome) {
  const existente = await db
    .prepare(`SELECT id FROM etapas
              WHERE nome = ? COLLATE NOCASE AND ativo = 1 AND pipeline = 'comercial'`)
    .bind(nome).first();
  if (existente) return existente.id;

  const { n } = await db
    .prepare(`SELECT COALESCE(MAX(ordem), 0) AS n FROM etapas
              WHERE ativo = 1 AND pipeline = 'comercial'`).first();

  // Entra no fim do quadro e como etapa não-terminal. Reposicionar e
  // marcar "encerra" é trabalho de um clique em Gerenciar etapas —
  // adivinhar aqui erraria em silêncio.
  const criada = await db
    .prepare(`INSERT INTO etapas (nome, cor, ordem, encerra, pipeline, ativo)
              VALUES (?, '#6e6e6e', ?, 0, 'comercial', 1) RETURNING id`)
    .bind(nome, Number(n) + 1)
    .first();

  return criada?.id || null;
}

async function criarAdvisor(db, nome, usuario) {
  try {
    const criado = await db
      .prepare(`INSERT INTO advisors (nome, criado_por, criado_em, ativo)
                VALUES (?, ?, ?, 1) RETURNING id`)
      .bind(nome, usuario.email, new Date().toISOString())
      .first();
    return criado?.id || null;
  } catch (e) {
    // Corrida com outro import: busca o que já existe
    const existente = await db
      .prepare('SELECT id FROM advisors WHERE nome = ? COLLATE NOCASE AND ativo = 1')
      .bind(nome).first();
    return existente?.id || null;
  }
}

/**
 * Aplica o que o usuário decidiu na prévia.
 *
 * `decisoesEtapa` é { "Captação": "criar" | "<id de etapa existente>" }.
 * Decisão AUSENTE não cria nada: a etapa cai na padrão, que era o
 * comportamento antes deste lote. Criar por omissão seria escrever no
 * banco sem ninguém ter pedido.
 */
async function aplicarApoio(db, linhas, usuario, apoio, decisoesEtapa) {
  const exame = examinarApoio(linhas, apoio);
  const etapasCriadas = [];

  for (const { nome } of exame.etapasNovas) {
    const decisao = decisoesEtapa?.[nome];
    if (!decisao) continue;

    if (decisao === 'criar') {
      const id = await criarEtapa(db, nome);
      if (id) { apoio.mapaEtapa.set(nome.toUpperCase(), id); etapasCriadas.push(nome); }
      continue;
    }

    // Apontar para uma etapa que já existe. Só vale id do funil
    // comercial — o que veio na prévia.
    const escolhida = exame.etapasDisponiveis.find((e) => String(e.id) === String(decisao));
    if (escolhida) apoio.mapaEtapa.set(nome.toUpperCase(), escolhida.id);
  }

  const advisorsCriados = [];
  for (const { nome } of exame.advisorsNovos) {
    const id = await criarAdvisor(db, nome, usuario);
    if (id) { apoio.mapaAdvisor.set(nome.toUpperCase(), id); advisorsCriados.push(nome); }
  }

  return { etapasCriadas, advisorsCriados };
}

/* ==========================================================================
   POST
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;

  if (!db) {
    return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);
  }

  let corpo;
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos); }

  if (!Array.isArray(corpo.linhas) || corpo.linhas.length === 0) {
    return json({ error: 'Nenhuma linha para importar.', code: 'VAZIO' }, 400, cabecalhos);
  }
  if (corpo.linhas.length > MAX_LINHAS) {
    return json({
      error: `A planilha tem ${corpo.linhas.length} linhas. O limite por importação é ${MAX_LINHAS}.`,
      code: 'MUITAS_LINHAS'
    }, 400, cabecalhos);
  }

  const linhas = corpo.linhas.map(normalizarLinha);
  const problemas = validar(linhas);

  // --- Trava do documento ---
  if (problemas.semDocumento.length > 0 || problemas.documentoInvalido.length > 0) {
    return json({
      error: 'Acrescente os CNPJs para a importação da tabela. A IA usa esta informação de contexto para inteligência comercial.',
      code: 'DOCUMENTO_OBRIGATORIO',
      problemas
    }, 422, cabecalhos);
  }

  if (problemas.semNome.length > 0) {
    return json({
      error: 'Há linhas sem o nome do cliente.',
      code: 'NOME_OBRIGATORIO',
      problemas
    }, 422, cabecalhos);
  }

  if (problemas.duplicadasNoArquivo.length > 0) {
    return json({
      error: 'A planilha tem documentos repetidos entre si. Cada CNPJ/CPF deve aparecer uma vez.',
      code: 'DUPLICADO_NO_ARQUIVO',
      problemas
    }, 422, cabecalhos);
  }

  try {
    // --- Quais já existem? ---
    const documentos = linhas.map((l) => l.documento);
    const existentes = new Map();

    // Em blocos: a cláusula IN tem limite de parâmetros
    for (let i = 0; i < documentos.length; i += 100) {
      const bloco = documentos.slice(i, i + 100);
      const { results } = await db
        .prepare(`SELECT id, documento, nome FROM leads
                  WHERE ativo = 1 AND documento IN (${bloco.map(() => '?').join(',')})`)
        .bind(...bloco)
        .all();
      (results || []).forEach((r) => existentes.set(r.documento, r));
    }

    const novos = linhas.filter((l) => !existentes.has(l.documento));
    const atualizados = linhas.filter((l) => existentes.has(l.documento));

    const apoio = await lerApoio(db);

    // --- Prévia: nada é gravado ---
    if (!corpo.confirmar) {
      return json({
        previa: true,
        total: linhas.length,
        novos: novos.length,
        atualizados: atualizados.length,
        exemplosAtualizacao: atualizados.slice(0, 5).map((l) => ({
          linha: l._linha,
          documento: l.documento,
          nomeNoArquivo: l.nome,
          nomeNoSistema: existentes.get(l.documento).nome
        })),
        apoio: examinarApoio(linhas, apoio)
      }, 200, cabecalhos);
    }

    // --- Gravação ---
    const { etapasCriadas, advisorsCriados } =
      await aplicarApoio(db, linhas, usuario, apoio, corpo.decisoesEtapa);

    const { mapaEtapa, mapaAdvisor } = apoio;
    const etapaPadrao = apoio.etapaPadrao?.id || null;

    const agora = new Date().toISOString();
    const comandos = [];

    for (const l of linhas) {
      const advisorId = l.advisor ? mapaAdvisor.get(l.advisor.toUpperCase()) ?? null : null;
      const etapaId = l.etapa ? mapaEtapa.get(l.etapa.toUpperCase()) ?? etapaPadrao : etapaPadrao;
      const existente = existentes.get(l.documento);

      if (existente) {
        // COALESCE(?, coluna): célula vazia não apaga o que já está lá
        comandos.push(
          db.prepare(
            `UPDATE leads SET
               nome = COALESCE(?, nome),
               telefone = COALESCE(?, telefone),
               cidade = COALESCE(?, cidade),
               segmento = COALESCE(?, segmento),
               canal = COALESCE(?, canal),
               atendente = COALESCE(?, atendente),
               advisor_id = COALESCE(?, advisor_id),
               etapa_id = COALESCE(?, etapa_id),
               observacoes = COALESCE(?, observacoes),
               site = COALESCE(?, site),
               instagram = COALESCE(?, instagram),
               data_cadastro = COALESCE(?, data_cadastro),
               data_ultimo_contato = COALESCE(?, data_ultimo_contato),
               data_proximo_contato = COALESCE(?, data_proximo_contato),
               data_fechamento = COALESCE(?, data_fechamento),
               valor_proposta = COALESCE(?, valor_proposta),
               valor_diagnostico = COALESCE(?, valor_diagnostico),
               atualizado_por = ?, atualizado_em = ?
             WHERE id = ?`
          ).bind(
            l.nome, l.telefone, l.cidade, l.segmento, l.canal, l.atendente,
            advisorId, l.etapa ? etapaId : null, l.observacoes, l.site, l.instagram,
            l.data_cadastro, l.data_ultimo_contato, l.data_proximo_contato, l.data_fechamento,
            l.valor_proposta, l.valor_diagnostico,
            usuario.email, agora, existente.id
          )
        );
      } else {
        comandos.push(
          db.prepare(
            `INSERT INTO leads
              (nome, documento, telefone, cidade, segmento, canal, atendente, advisor_id,
               etapa_id, observacoes, site, instagram, data_cadastro, data_ultimo_contato,
               data_proximo_contato, data_fechamento, valor_proposta, valor_diagnostico,
               tags, criado_por, criado_em, ativo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 1)`
          ).bind(
            l.nome, l.documento, l.telefone, l.cidade, l.segmento, l.canal,
            l.atendente || usuario.email, advisorId, etapaId, l.observacoes,
            l.site, l.instagram, l.data_cadastro || agora.slice(0, 10),
            l.data_ultimo_contato, l.data_proximo_contato, l.data_fechamento,
            l.valor_proposta, l.valor_diagnostico, usuario.email, agora
          )
        );
      }
    }

    // batch é transacional no D1: ou tudo entra, ou nada entra.
    // Meia importação seria pior que nenhuma.
    await db.batch(comandos);

    console.log(`[importar] ${usuario.email} | ${novos.length} novos, ${atualizados.length} atualizados`);

    return json({
      ok: true,
      total: linhas.length,
      novos: novos.length,
      atualizados: atualizados.length,
      advisorsCriados,
      etapasCriadas
    }, 201, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao importar.', details: e.message }, 500, cabecalhos);
  }
}

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}
