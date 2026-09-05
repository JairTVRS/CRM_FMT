/**
 * /api/dossier — Geração e leitura do Dossiê Executivo.
 *
 * Autenticação garantida pelo _middleware.js: se chegou aqui, o usuário
 * tem ID token válido e cadastro ativo no hub.
 *
 * GET  ?cnpj=...                → metadados da última versão (não gera nada)
 * GET  ?cnpj=...&historico=true → lista de versões
 * GET  ?cnpj=...&html=true      → o documento (opcionalmente &versao=N)
 * POST                          → gera uma nova versão
 *
 * O GET nunca dispara IA. Clicar no botão abre o dossiê existente;
 * só o POST com `forcar` cria versão nova. É o que evita dois
 * consultores gerando documentos divergentes do mesmo lead.
 */

import { consultarCnpj, limparCnpj, cnpjValido } from './_lib/cnpj.js';
import { lerSite } from './_lib/site.js';
import { coletarInstagram } from './_lib/instagram.js';
import { chamarIA, extrairJson, chaveConfigurada, PROVEDORES } from './_lib/ia.js';
import {
  FORMATO_ANALISE, validarAnalise, analiseUtilizavel, montarDossie
} from './_lib/schema-dossie.js';
import {
  salvarDossie, registrarErro, buscarUltimoDossie, listarVersoes, lerHtml, buscarVersao
} from './_lib/storage.js';
import { renderizarDossie } from './_lib/dossie-template.js';

const MAX_TOKENS_DOSSIE = 4000;

/* ==========================================================================
   PROMPT
   ========================================================================== */

const SYSTEM_PROMPT = `Você é analista sênior de inteligência comercial B2B da Formatar Consultoria.
Produz dossiês executivos usados por consultores antes de reuniões com prospects.

REGRA ABSOLUTA — não invente fatos.
Os dados cadastrais, o conteúdo do site e o do Instagram já foram coletados de fontes
reais e estão no contexto. Sua função é INTERPRETAR esse material, não completá-lo
com informação de memória.

Especificamente, você NÃO deve afirmar: número de funcionários, faturamento, clientes,
prêmios, datas ou nomes de sócios que não estejam explicitamente no contexto fornecido.
Se um dado não foi fornecido, simplesmente não o mencione. Um dossiê curto e verdadeiro
é melhor que um extenso e inventado.

Tudo que for suposição sua deve estar em "hipotesesDores" ou nos itens do "radar",
que o documento apresenta como leitura analítica, nunca como fato.

Sobre a quantidade de itens: em "radar" e "sinaisTransformacao", produza de 2 a 5
itens por quadrante/lista, conforme o material disponível — não pare em 2 por padrão.
Se houver base para cinco forças, escreva cinco. Se houver base para duas, escreva
duas. Nunca invente item para preencher cota.

Escreva em português do Brasil, tom executivo, direto, sem adjetivação vazia.
Responda ESTRITAMENTE com um objeto JSON no formato abaixo, sem markdown, sem
texto antes ou depois:

${FORMATO_ANALISE}`;

function montarContexto({ nome, cnpjResultado, siteResultado, instagramResultado }) {
  const partes = [`EMPRESA ANALISADA: ${nome || '(nome não informado)'}`];

  if (cnpjResultado?.ok) {
    const d = cnpjResultado.dados;
    partes.push(`
=== DADOS CADASTRAIS (Receita Federal — FATO VERIFICADO) ===
Razão social: ${d.razaoSocial || '—'}
Nome fantasia: ${d.nomeFantasia || '—'}
CNPJ: ${d.cnpjFormatado || '—'}
Abertura: ${d.dataAbertura || '—'}${d.anosDeMercado != null ? ` (${d.anosDeMercado} anos de mercado)` : ''}
Situação cadastral: ${d.situacao || '—'}
Natureza jurídica: ${d.naturezaJuridica || '—'}
Porte: ${d.porte || '—'}
Capital social: ${d.capitalSocial != null ? `R$ ${d.capitalSocial.toLocaleString('pt-BR')}` : '—'}
CNAE principal: ${d.cnaePrincipal?.codigo || '—'} — ${d.cnaePrincipal?.descricao || '—'}
CNAEs secundários: ${d.cnaesSecundarios?.map((c) => c.descricao).join('; ') || '—'}
Município/UF: ${d.endereco?.municipio || '—'}/${d.endereco?.uf || '—'}
Quadro societário (${d.quantidadeSocios} sócio(s)):
${d.socios?.map((s) => `  - ${s.nome} — ${s.qualificacao || 'sócio'}${s.entrada ? `, desde ${s.entrada}` : ''}`).join('\n') || '  (não informado)'}`);
  } else {
    partes.push(`\n=== DADOS CADASTRAIS ===\nIndisponíveis: ${cnpjResultado?.erro || 'não consultado'}.
NÃO invente dados cadastrais. Trabalhe apenas com o que houver abaixo.`);
  }

  if (siteResultado?.ok) {
    partes.push(`
=== SITE INSTITUCIONAL (texto extraído — FATO) ===
Título: ${siteResultado.meta?.titulo || '—'}
Descrição: ${siteResultado.meta?.descricao || '—'}
Páginas lidas: ${siteResultado.paginas?.join(', ')}

${siteResultado.texto}`);
  } else {
    partes.push(`\n=== SITE ===\nNão foi possível ler: ${siteResultado?.erro || 'não informado'}.`);
  }

  if (instagramResultado?.ok) {
    const d = instagramResultado.dados;
    partes.push(`
=== INSTAGRAM (origem: ${instagramResultado.origem}) ===
Perfil: ${d.usuario ? `@${d.usuario}` : '—'}
${d.seguidores != null ? `Seguidores: ${d.seguidores}` : 'Seguidores: não disponível'}
${d.totalPosts != null ? `Publicações: ${d.totalPosts}` : ''}
Bio: ${d.bio || '—'}
Legendas recentes:
${d.legendas?.map((l, i) => `  [${i + 1}] ${l}`).join('\n') || '  (nenhuma)'}`);
  } else {
    partes.push(`
=== INSTAGRAM ===
NAO INFORMADO nesta análise (${instagramResultado?.erro || 'sem dados'}).

ATENÇÃO: isto significa apenas que o dado não foi coletado — NÃO significa
que a empresa não tenha presença no Instagram. Não afirme que a empresa
"não tem presença digital", "não atua em redes sociais" ou equivalente,
e não use essa ausência como ponto de atenção, risco ou oportunidade.
Simplesmente não trate do tema.`);
  }

  partes.push(`
=== TAREFA ===
Produza a análise no formato JSON especificado. Baseie cada afirmação no material acima.
Onde faltar base, deixe o campo curto ou omita o item — não preencha por preencher.`);

  return partes.join('\n');
}

/* ==========================================================================
   MENSAGENS AO USUÁRIO
   O consultor não deve precisar saber o que é um HTTP 530. Cada falha
   técnica vira uma frase que explica o que aconteceu e o que fazer.
   ========================================================================== */

function traduzirFalhaSite(erro) {
  if (!erro) return null;
  const e = String(erro);

  if (/HTTP 5\d\d/.test(e)) {
    return 'O site do lead está fora do ar no momento, então não pôde ser analisado.';
  }
  if (/HTTP 40[34]/.test(e)) {
    return 'O endereço do site não foi encontrado. Confira se está correto na ficha do lead.';
  }
  if (/HTTP 4\d\d/.test(e)) {
    return 'O site recusou a leitura automática, então não pôde ser analisado.';
  }
  if (/Tempo esgotado/i.test(e)) {
    return 'O site demorou demais para responder e a leitura foi interrompida.';
  }
  if (/JavaScript/i.test(e)) {
    return 'O site não expõe texto legível para leitura automática — o conteúdo é carregado pelo navegador.';
  }
  if (/não é HTML/i.test(e)) {
    return 'O endereço informado não aponta para uma página de site.';
  }
  if (/ausente|inválida/i.test(e)) {
    return 'Nenhum site foi informado na ficha do lead.';
  }
  return 'O site não pôde ser lido nesta análise.';
}

function traduzirFalhaCnpj(erro) {
  if (!erro) return null;
  const e = String(erro);

  if (/não encontrado/i.test(e)) {
    return 'CNPJ não localizado na base da Receita Federal.';
  }
  if (/inválido/i.test(e)) {
    return 'O CNPJ informado é inválido.';
  }
  return 'A consulta à Receita Federal falhou; os dados cadastrais não entraram nesta análise.';
}

/* ==========================================================================
   GET — leitura, nunca gera
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const { searchParams } = new URL(context.request.url);
  const db = context.env.DB;

  if (!db) {
    return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);
  }

  try {
    // ?existentes=cnpj1,cnpj2,... — quais destes já têm dossiê.
    // Uma consulta para a página inteira da tabela, em vez de uma por linha.
    const existentes = searchParams.get('existentes');
    if (existentes) {
      const lista = existentes.split(',').map(limparCnpj).filter(cnpjValido).slice(0, 100);
      if (lista.length === 0) return json({ comDossie: {} }, 200, cabecalhos);

      const marcadores = lista.map(() => '?').join(',');
      const { results } = await db
        .prepare(
          `SELECT cnpj, MAX(versao) AS versao
           FROM dossies
           WHERE status = 'concluido' AND cnpj IN (${marcadores})
           GROUP BY cnpj`
        )
        .bind(...lista)
        .all();

      const comDossie = {};
      (results || []).forEach((r) => { comDossie[r.cnpj] = r.versao; });
      return json({ comDossie }, 200, cabecalhos);
    }

    const cnpj = limparCnpj(searchParams.get('cnpj'));
    if (!cnpjValido(cnpj)) {
      return json({ error: 'CNPJ inválido ou ausente.', code: 'CNPJ_INVALIDO' }, 400, cabecalhos);
    }

    if (searchParams.get('historico') === 'true') {
      return json({ cnpj, versoes: await listarVersoes(db, cnpj) }, 200, cabecalhos);
    }

    if (searchParams.get('html') === 'true') {
      const versao = searchParams.get('versao') ? Number(searchParams.get('versao')) : null;
      const html = await lerHtml(db, cnpj, versao);
      if (!html) {
        return json({ error: 'Dossiê não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
      }
      return new Response(html, {
        status: 200,
        headers: { ...cabecalhos, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    const versaoPedida = searchParams.get('versao');
    const registro = versaoPedida
      ? await buscarVersao(db, cnpj, Number(versaoPedida))
      : await buscarUltimoDossie(db, cnpj);

    return json({ cnpj, existe: !!registro, dossie: registro || null }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao consultar o dossiê.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — gera uma nova versão
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const env = context.env;
  const db = env.DB;

  let corpo;
  try {
    corpo = await context.request.json();
  } catch (e) {
    return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos);
  }

  const {
    nome, documento, site, instagram = {}, provider = 'deepseek', forcar = false
  } = corpo;

  const cnpj = limparCnpj(documento);
  if (!cnpjValido(cnpj)) {
    return json({
      error: 'O dossiê exige um CNPJ válido. Preencha o campo CNPJ/CPF do lead.',
      code: 'CNPJ_INVALIDO'
    }, 400, cabecalhos);
  }

  if (!PROVEDORES.includes(provider) || !chaveConfigurada(provider, env)) {
    return json({
      error: `Provedor "${provider}" não está configurado no servidor.`,
      code: 'PROVEDOR_INDISPONIVEL'
    }, 400, cabecalhos);
  }

  if (!db) {
    return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);
  }

  // Já existe? Devolve em vez de gerar — a menos que o usuário peça nova versão.
  if (!forcar) {
    const existente = await buscarUltimoDossie(db, cnpj);
    if (existente) {
      return json({
        reaproveitado: true,
        mensagem: `Já existe dossiê para este CNPJ (versão ${existente.versao}, gerado por ${existente.gerado_por}).`,
        dossie: existente
      }, 200, cabecalhos);
    }
  }

  try {
    // ---- 1. Coleta factual, em paralelo -------------------------------
    const [cnpjResultado, siteResultado, instagramResultado] = await Promise.all([
      consultarCnpj(cnpj, { db }),
      site ? lerSite(site) : Promise.resolve({ ok: false, erro: 'Site não informado.' }),
      coletarInstagram(instagram, env)
    ]);

    // ---- 2. Interpretação -------------------------------------------
    const contexto = montarContexto({
      nome: nome || cnpjResultado?.dados?.razaoSocial,
      cnpjResultado, siteResultado, instagramResultado
    });

    const bruto = await chamarIA({
      provider, env,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: contexto,
      maxTokens: MAX_TOKENS_DOSSIE,
      jsonMode: true
    });

    const json_ = extrairJson(bruto);
    if (!json_) {
      await registrarErro({ db, cnpj, usuario, provider, mensagem: 'Resposta da IA não é JSON válido.' });
      return json({
        error: 'O modelo não devolveu um JSON válido. Tente outro provedor.',
        code: 'JSON_INVALIDO'
      }, 502, cabecalhos);
    }

    const { analise, avisos, seccoesVazias } = validarAnalise(json_);

    if (!analiseUtilizavel(analise)) {
      await registrarErro({ db, cnpj, usuario, provider, mensagem: `Análise insuficiente. Vazias: ${seccoesVazias.join(', ')}` });
      return json({
        error: 'A análise voltou incompleta demais para gerar o dossiê.',
        code: 'ANALISE_INSUFICIENTE',
        seccoesVazias
      }, 502, cabecalhos);
    }

    // ---- 3. Montagem e gravação -------------------------------------
    const fontes = {
      cnpj: cnpjResultado.ok ? cnpjResultado.fonte : 'indisponivel',
      site: siteResultado.ok ? 'ok' : (site ? 'falha' : 'sem_site'),
      instagram: instagramResultado.ok ? instagramResultado.origem : 'ausente'
    };

    // Só entra na lista o que o consultor precisa saber. A ausência de
    // Instagram quando nada foi informado é esperada, não é aviso.
    const informouInstagram = !!(instagram?.bio || instagram?.legendas);

    const avisosFonte = [
      !cnpjResultado.ok && traduzirFalhaCnpj(cnpjResultado.erro),
      !siteResultado.ok && traduzirFalhaSite(siteResultado.erro),
      !instagramResultado.ok && informouInstagram && 'O conteúdo de Instagram informado não pôde ser aproveitado.',
      instagramResultado.ok && instagramResultado.aviso
    ].filter(Boolean);

    const geradoEm = new Date().toISOString();

    const montarDados = (versao) => montarDossie({
      cnpjDados: cnpjResultado.ok ? cnpjResultado.dados : null,
      siteDados: siteResultado.ok ? siteResultado : null,
      instagramDados: instagramResultado.ok ? instagramResultado.dados : null,
      analise,
      meta: {
        cnpj, nomeInformado: nome, site,
        fonteCnpj: fontes.cnpj, fonteSite: fontes.site, fonteInstagram: fontes.instagram,
        avisosFonte, geradoPor: usuario.email, provider, geradoEm, versao
      }
    });

    // O número da versão só é conhecido dentro de salvarDossie, e o rodapé
    // do documento precisa dele. Por isso passamos funções, não o HTML
    // pronto — inclusive para os dados: até a 2.16.0 gravávamos
    // `montarDados(null)`, e o `dados_json` do Executivo ficava com
    // `versao: null`. Reprocessar o template a partir dele renderizaria
    // uma capa sem versão.
    const gravacao = await salvarDossie({
      db, cnpj, montarDados, usuario, provider, fontes,
      montarHtml: (versao) => renderizarDossie(montarDados(versao))
    });
    if (!gravacao.ok) {
      return json({ error: `Dossiê gerado, mas não foi possível salvar: ${gravacao.erro}` }, 500, cabecalhos);
    }

    console.log(`[dossier] ${usuario.email} | ${cnpj} v${gravacao.versao} | ${provider} | fontes: ${JSON.stringify(fontes)}`);

    return json({
      ok: true,
      versao: gravacao.versao,
      cnpj,
      tamanhoBytes: gravacao.tamanhoBytes,
      fontes,
      avisos: [...avisos, ...avisosFonte],
      seccoesVazias
    }, 201, cabecalhos);

  } catch (e) {
    await registrarErro({ db, cnpj, usuario, provider, mensagem: e.message });
    return json({ error: 'Falha ao gerar o dossiê.', details: e.message }, 500, cabecalhos);
  }
}

/* ========================================================================== */

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}
