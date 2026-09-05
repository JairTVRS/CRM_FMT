/**
 * /api/dossie-cx — Geração e leitura do Dossiê de Experiência.
 *
 * Autenticação garantida pelo _middleware.js.
 *
 * GET  ?cliente_id=N                → última versão + histórico (não gera nada)
 * GET  ?cliente_id=N&html=true[&versao=N]  → o documento
 * POST ?cliente_id=N                → gera a próxima versão
 *
 * Duas diferenças de comportamento em relação ao /api/dossier, e as duas
 * vêm de o sujeito ser outro:
 *
 *   O POST SEMPRE gera. No Executivo, dossiê existente é devolvido em
 *   vez de refeito, porque os fatos externos de um prospect mudam pouco
 *   e duas gerações custariam dinheiro para dizer o mesmo. Aqui a conta
 *   muda toda semana — pessoa nova mapeada, etapa que avançou — e pedir
 *   o dossiê é pedir a leitura de HOJE. O botão da tela diz isso.
 *
 *   A chave é o CLIENTE, não o CNPJ. Um cliente convertido tem os dois
 *   documentos, e chavear ambos por CNPJ misturaria as duas contagens
 *   de versão.
 */

import { chamarIA, extrairJson, chaveConfigurada, PROVEDORES } from './_lib/ia.js';
import {
  FORMATO_ANALISE_CX, validarAnaliseCx, analiseCxUtilizavel,
  montarDossieCx, resumirMapa, mesesDesde,
  ROTULO_INFLUENCIA, ROTULO_POSTURA
} from './_lib/schema-dossie-cx.js';
import { renderizarDossieCx } from './_lib/dossie-cx-template.js';

const MAX_TOKENS_DOSSIE_CX = 3000;
const LIMITE_HTML_BYTES = 700_000;

/* ==========================================================================
   PROMPT
   ========================================================================== */

const SYSTEM_PROMPT = `Você é analista de Customer Experience da Formatar Consultoria.
Produz dossiês de experiência usados pela equipe de CX antes de reuniões com clientes ATIVOS.

REGRA ABSOLUTA — não invente fatos.
Tudo que você sabe sobre esta conta está no contexto abaixo, e veio do CRM. Não
complete com informação de memória, não suponha faturamento, porte, número de
funcionários, resultados obtidos, reuniões realizadas ou satisfação medida.

REGRA SOBRE PESSOAS — este documento fala de gente com nome.
A influência e a postura de cada pessoa foram REGISTRADAS pela equipe de CX na
ficha do cliente. Trabalhe com esses registros; não os redefina, não classifique
ninguém por conta própria e não emita juízo sobre caráter, competência,
personalidade ou vida pessoal de quem quer que seja. Onde estiver escrito "não
avaliada", trate como informação que falta — nunca como neutralidade.
Suas observações devem ser sobre a RELAÇÃO (quem participa de quê, onde a
Formatar não tem interlocutor, de quem a conta depende), não sobre a pessoa.

O QUE VOCÊ NÃO PODE AFIRMAR nesta versão do sistema: nada sobre reuniões,
atas, planos de ação, indicadores, saúde da carteira, NPS ou satisfação. Essas
fontes ainda não chegam ao CRM. Não diga que estão bem nem que estão mal, e não
as use como fundamento. Se a falta delas for relevante, isso já está declarado
em uma seção própria do documento — não repita.

Sobre EXPANSÃO: na Formatar, expansão é acréscimo de produto ou serviço à
entrega atual. Não gera contrato novo nem devolve o cliente ao funil comercial.
Suas oportunidades devem respeitar essa definição.

Sobre a quantidade de itens: produza de 2 a 5 riscos, oportunidades e perguntas,
conforme o material disponível. Conta com pouco registro merece dossiê curto —
nunca invente item para preencher cota.

Escreva em português do Brasil, tom profissional, direto, sem adjetivação vazia.
Responda ESTRITAMENTE com um objeto JSON no formato abaixo, sem markdown, sem
texto antes ou depois:

${FORMATO_ANALISE_CX}`;

/**
 * Monta o contexto factual. Tudo aqui saiu do banco — é a única coisa
 * que o modelo pode tratar como verdade.
 */
function montarContexto({ cliente, etapa, nucleos, stakeholders, mapa }) {
  const partes = [];

  const meses = mesesDesde(cliente.data_inicio);

  partes.push(`=== A CONTA (registro do CRM — FATO) ===
Razão social: ${cliente.nome || '—'}
Nome fantasia: ${cliente.nome_fantasia || '—'}
Cidade: ${cliente.cidade || '—'}
Etapa da jornada: ${etapa?.nome || '—'}
Início da jornada: ${cliente.data_inicio || '—'}${meses != null ? ` (${meses} meses de relação)` : ''}
Classificação (escala 1–6 do ERP): ${cliente.classificacao ?? '—'}
Contato principal: ${cliente.contato_nome || '—'}
Vínculo com o ERP: ${cliente.erp_id ? `sim (ID ${cliente.erp_id})` : 'ainda não conferido — cadastro manual. Isto NÃO significa que o cliente esteja fora do ERP.'}
Núcleos atendidos (tipos de reunião): ${nucleos.map((n) => n.nome).join(', ') || 'nenhum marcado'}`);

  if (cliente.observacoes) {
    partes.push(`
=== OBSERVAÇÕES ESCRITAS PELA CX NA FICHA (FATO) ===
${cliente.observacoes}`);
  }

  if (stakeholders.length) {
    partes.push(`
=== MAPA DE PESSOAS (registrado pela CX — FATO) ===
${stakeholders.map((p) => {
      const marcas = [
        p.papel ? `papel: ${p.papel}` : null,
        p.cargo ? `cargo: ${p.cargo}` : null,
        `influência: ${ROTULO_INFLUENCIA[p.influencia]}`,
        `postura: ${ROTULO_POSTURA[p.postura]}`,
        p.patrocinador ? 'PATROCINADOR DA CONTA' : null,
        p.nucleos?.length ? `participa de: ${p.nucleos.join(', ')}` : 'não vinculada a nenhum núcleo'
      ].filter(Boolean).join(' · ');

      return `  - ${p.nome} — ${marcas}${p.observacoes ? `\n      observação da CX: ${p.observacoes}` : ''}`;
    }).join('\n')}

Resumo aritmético (já conferido, não recalcule):
  Pessoas mapeadas: ${mapa.total}
  Patrocinadores: ${mapa.patrocinadores.join(', ') || 'nenhum indicado'}
  Influência alta: ${mapa.porInfluencia.alta} · média: ${mapa.porInfluencia.media} · baixa: ${mapa.porInfluencia.baixa} · não avaliada: ${mapa.porInfluencia.desconhecida}
  Postura promotor: ${mapa.porPostura.promotor} · neutro: ${mapa.porPostura.neutro} · resistente: ${mapa.porPostura.resistente} · não avaliada: ${mapa.porPostura.desconhecida}
  Núcleos atendidos SEM ninguém mapeado: ${mapa.nucleosSemPessoa.join(', ') || 'nenhum'}`);
  } else {
    partes.push(`
=== MAPA DE PESSOAS ===
NENHUMA pessoa mapeada nesta conta.

Isto significa apenas que o mapa não foi preenchido — NÃO significa que a
Formatar não tenha interlocutores no cliente. Não afirme que a conta está
sem contato nem trate isso como risco do cliente. Se citar, cite como
lacuna do próprio registro, e apoie o resto da análise no cadastro.`);
  }

  partes.push(`
=== TAREFA ===
Produza a análise no formato JSON especificado, baseando cada afirmação no
material acima. Onde faltar base, escreva pouco ou omita o item.`);

  return partes.join('\n');
}

/* ==========================================================================
   LEITURA DO BANCO
   ========================================================================== */

/**
 * Reúne tudo que compõe o documento. Uma função só, usada pela geração e
 * pela prévia da tela: as duas precisam enxergar exatamente o mesmo
 * conjunto, ou a tela prometeria um documento diferente do que sai.
 */
async function reunirConta(db, clienteId) {
  const cliente = await db
    .prepare('SELECT * FROM clientes WHERE id = ?')
    .bind(clienteId)
    .first();

  if (!cliente) return null;

  let idsNucleos = [];
  try { idsNucleos = JSON.parse(cliente.nucleos || '[]'); } catch (e) { idsNucleos = []; }

  const [etapa, listaNucleos, pessoas, papeis] = await Promise.all([
    cliente.etapa_id
      ? db.prepare('SELECT id, nome, cor FROM etapas WHERE id = ?').bind(cliente.etapa_id).first()
      : Promise.resolve(null),

    db.prepare('SELECT id, nome, cor FROM nucleos').all(),

    db.prepare(
      `SELECT * FROM stakeholders
       WHERE cliente_id = ? AND ativo = 1
       ORDER BY patrocinador DESC,
                CASE influencia WHEN 'alta' THEN 1 WHEN 'media' THEN 2
                                WHEN 'baixa' THEN 3 ELSE 4 END,
                nome COLLATE NOCASE`
    ).bind(clienteId).all(),

    db.prepare('SELECT id, nome FROM papeis').all()
  ]);

  const porId = new Map((listaNucleos.results || []).map((n) => [n.id, n]));
  const nomePapel = new Map((papeis.results || []).map((p) => [p.id, p.nome]));

  // Só os núcleos que ainda existem: um núcleo excluído sai da lista
  // atendida em vez de virar uma linha em branco no documento.
  const nucleos = idsNucleos.map((id) => porId.get(id)).filter(Boolean);

  const stakeholders = (pessoas.results || []).map((s) => {
    let ids = [];
    try { ids = JSON.parse(s.nucleos || '[]'); } catch (e) { ids = []; }

    return {
      ...s,
      patrocinador: !!s.patrocinador,
      papel: s.papel_id ? (nomePapel.get(s.papel_id) || null) : null,
      nucleoIds: ids,
      nucleos: ids.map((id) => porId.get(id)?.nome).filter(Boolean)
    };
  });

  return {
    cliente, etapa, nucleos, stakeholders,
    mapa: resumirMapa(stakeholders, nucleos)
  };
}

/* ==========================================================================
   GET — leitura, nunca gera
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const { searchParams } = new URL(context.request.url);
  const db = context.env.DB;

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const clienteId = Number(searchParams.get('cliente_id'));
  if (!clienteId) return json({ error: 'Informe o cliente.', code: 'CLIENTE_OBRIGATORIO' }, 400, cabecalhos);

  try {
    // --- O documento ---
    if (searchParams.get('html')) {
      const versao = Number(searchParams.get('versao')) || null;

      const registro = versao
        ? await db.prepare(
            `SELECT html FROM dossies_cx
             WHERE cliente_id = ? AND versao = ? AND status = 'concluido'`
          ).bind(clienteId, versao).first()
        : await db.prepare(
            `SELECT html FROM dossies_cx
             WHERE cliente_id = ? AND status = 'concluido'
             ORDER BY versao DESC LIMIT 1`
          ).bind(clienteId).first();

      if (!registro?.html) {
        return json({ error: 'Dossiê não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
      }

      return new Response(registro.html, {
        status: 200,
        headers: { ...cabecalhos, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // --- Metadados e histórico ---
    const { results } = await db
      .prepare(
        `SELECT versao, gerado_por, gerado_em, provider, tamanho_bytes
         FROM dossies_cx
         WHERE cliente_id = ? AND status = 'concluido'
         ORDER BY versao DESC`
      )
      .bind(clienteId)
      .all();

    const versoes = results || [];
    return json({ existe: versoes.length > 0, ultima: versoes[0] || null, versoes }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao consultar o dossiê.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — gera a próxima versão
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const env = context.env;
  const db = env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const clienteId = Number(searchParams.get('cliente_id'));
  if (!clienteId) return json({ error: 'Informe o cliente.', code: 'CLIENTE_OBRIGATORIO' }, 400, cabecalhos);

  let corpo = {};
  try { corpo = await context.request.json(); } catch (e) { corpo = {}; }

  const provider = corpo.provider || 'deepseek';
  if (!PROVEDORES.includes(provider) || !chaveConfigurada(provider, env)) {
    return json({
      error: `Provedor "${provider}" não está configurado no servidor.`,
      code: 'PROVEDOR_INDISPONIVEL'
    }, 400, cabecalhos);
  }

  const conta = await reunirConta(db, clienteId);
  if (!conta) {
    return json({ error: 'Cliente não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
  }

  try {
    const bruto = await chamarIA({
      provider, env,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: montarContexto(conta),
      maxTokens: MAX_TOKENS_DOSSIE_CX,
      jsonMode: true
    });

    const resposta = extrairJson(bruto);
    if (!resposta) {
      await registrarErro(db, clienteId, conta, usuario, provider, 'Resposta da IA não é JSON válido.');
      return json({
        error: 'O modelo não devolveu um JSON válido. Tente outro provedor.',
        code: 'JSON_INVALIDO'
      }, 502, cabecalhos);
    }

    const { analise, avisos, seccoesVazias } = validarAnaliseCx(resposta);

    if (!analiseCxUtilizavel(analise)) {
      await registrarErro(db, clienteId, conta, usuario, provider,
        `Análise insuficiente. Vazias: ${seccoesVazias.join(', ')}`);
      return json({
        error: 'A análise voltou incompleta demais para gerar o dossiê.',
        code: 'ANALISE_INSUFICIENTE',
        seccoesVazias
      }, 502, cabecalhos);
    }

    const geradoEm = new Date().toISOString();

    const montarDados = (versao) => montarDossieCx({
      ...conta,
      analise,
      meta: { geradoPor: usuario.email, provider, geradoEm, versao }
    });

    // O número da versão só é conhecido dentro da gravação, e a capa do
    // documento o exibe. Por isso o HTML é montado lá, com a versão em mão.
    const gravacao = await gravar({
      db, clienteId, conta, usuario, provider,
      dados: montarDados(null),
      montarHtml: (versao) => renderizarDossieCx(montarDados(versao))
    });

    if (!gravacao.ok) {
      return json({ error: `Dossiê gerado, mas não foi possível salvar: ${gravacao.erro}` }, 500, cabecalhos);
    }

    console.log(`[dossie-cx] ${usuario.email} | cliente ${clienteId} v${gravacao.versao} | ${provider}`);

    return json({
      ok: true,
      versao: gravacao.versao,
      tamanhoBytes: gravacao.tamanhoBytes,
      avisos,
      seccoesVazias
    }, 201, cabecalhos);

  } catch (e) {
    await registrarErro(db, clienteId, conta, usuario, provider, e.message);
    return json({ error: 'Falha ao gerar o dossiê.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   GRAVAÇÃO

   Mesma mecânica do dossiê e da proposta: calcula a próxima versão,
   grava, e o UNIQUE (cliente_id, versao) é a defesa real contra dois
   consultores gerando ao mesmo tempo — na colisão, refaz com o número
   seguinte.

   São três implementações irmãs do mesmo padrão, e a terceira é esta.
   Unificá-las continua registrado como dívida no roadmap; fazê-lo dentro
   deste lote significaria mexer no caminho da proposta, que já quebrou
   em produção uma vez.
   ========================================================================== */

async function proximaVersao(db, clienteId) {
  const linha = await db
    .prepare('SELECT COALESCE(MAX(versao), 0) AS n FROM dossies_cx WHERE cliente_id = ?')
    .bind(clienteId)
    .first();

  return Number(linha?.n || 0) + 1;
}

async function gravar({ db, clienteId, conta, usuario, provider, dados, montarHtml }) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const versao = await proximaVersao(db, clienteId);

    const html = montarHtml(versao);
    const bytes = new TextEncoder().encode(html || '').length;

    if (bytes === 0) return { ok: false, erro: 'HTML do dossiê veio vazio.' };
    if (bytes > LIMITE_HTML_BYTES) {
      return { ok: false, erro: `Dossiê grande demais (${Math.round(bytes / 1024)} KB).` };
    }

    try {
      await db
        .prepare(
          `INSERT INTO dossies_cx
             (cliente_id, cliente_nome, documento, versao, gerado_por, gerado_em,
              provider, html, tamanho_bytes, dados_json, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'concluido')`
        )
        .bind(
          clienteId,
          conta.cliente.nome || null,
          conta.cliente.documento || null,
          versao,
          usuario.email,
          new Date().toISOString(),
          provider,
          html,
          bytes,
          JSON.stringify({ ...dados, gerado: { ...dados.gerado, versao } })
        )
        .run();

      return { ok: true, versao, tamanhoBytes: bytes };

    } catch (e) {
      const colisao = /UNIQUE|constraint/i.test(e.message || '');
      if (colisao && tentativa === 0) continue;
      return { ok: false, erro: e.message };
    }
  }

  return { ok: false, erro: 'Não foi possível determinar a versão do dossiê.' };
}

/** Falha ao registrar falha é ignorada de propósito. */
async function registrarErro(db, clienteId, conta, usuario, provider, mensagem) {
  try {
    const versao = await proximaVersao(db, clienteId);
    await db
      .prepare(
        `INSERT INTO dossies_cx
           (cliente_id, cliente_nome, versao, gerado_por, gerado_em, provider,
            status, erro_mensagem)
         VALUES (?, ?, ?, ?, ?, ?, 'erro', ?)`
      )
      .bind(
        clienteId, conta?.cliente?.nome || null, versao,
        usuario.email, new Date().toISOString(), provider, mensagem
      )
      .run();
  } catch (e) {
    // silencioso
  }
}

/* ========================================================================== */

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}
