/**
 * _lib/storage.js — Persistência do dossiê.
 *
 * Versão 2: armazenamento inteiramente em D1. O HTML fica numa
 * coluna de texto, junto com o registro da versão. O R2 foi
 * descartado por exigir ativação com cartão de crédito — para
 * documentos de ~30 KB o ganho não justificava a dependência.
 *
 * Consequência prática: `salvarDossie` virou uma única escrita
 * atômica. Não existe mais o risco de arquivo órfão que havia
 * quando o arquivo e o registro viviam em serviços separados.
 *
 * Regra central inalterada: gerar de novo NUNCA sobrescreve.
 * Cria a versão seguinte e mantém a anterior consultável.
 */

// Guarda contra documento anômalo. Um dossiê típico tem ~30 KB;
// o limite de linha do D1 é 1 MB e não queremos chegar perto.
const LIMITE_HTML_BYTES = 700_000;

/* ==========================================================================
   LEITURA
   ========================================================================== */

/**
 * Última versão concluída de um CNPJ. É o que a interface abre por padrão,
 * em vez de gerar um dossiê novo a cada clique.
 *
 * Não traz a coluna `html` de propósito: o metadado é consultado com
 * frequência (para decidir se abre ou gera) e não precisa carregar o
 * documento inteiro junto.
 */
export async function buscarUltimoDossie(db, cnpj) {
  if (!db) return null;

  return db
    .prepare(
      `SELECT id, cnpj, razao_social, nome_fantasia, versao, gerado_por, gerado_em,
              provider, fonte_cnpj, fonte_site, fonte_instagram, tamanho_bytes
       FROM dossies
       WHERE cnpj = ? AND status = 'concluido'
       ORDER BY versao DESC
       LIMIT 1`
    )
    .bind(cnpj)
    .first();
}

/**
 * Histórico completo — alimenta o seletor de versões no modal.
 */
export async function listarVersoes(db, cnpj) {
  if (!db) return [];

  const { results } = await db
    .prepare(
      `SELECT versao, gerado_por, gerado_em, provider,
              fonte_cnpj, fonte_site, fonte_instagram, tamanho_bytes
       FROM dossies
       WHERE cnpj = ? AND status = 'concluido'
       ORDER BY versao DESC`
    )
    .bind(cnpj)
    .all();

  return results || [];
}

/**
 * Metadados de uma versão específica, sem o HTML.
 */
export async function buscarVersao(db, cnpj, versao) {
  if (!db) return null;

  return db
    .prepare(
      `SELECT id, cnpj, razao_social, nome_fantasia, versao, gerado_por, gerado_em,
              provider, fonte_cnpj, fonte_site, fonte_instagram, tamanho_bytes, dados_json
       FROM dossies
       WHERE cnpj = ? AND versao = ? AND status = 'concluido'`
    )
    .bind(cnpj, versao)
    .first();
}

/**
 * O documento em si. Chamada separada porque é a única que
 * carrega o texto completo.
 *
 * @param {number|null} versao  omitido ou null devolve a mais recente
 */
export async function lerHtml(db, cnpj, versao = null) {
  if (!db) return null;

  const consulta = versao
    ? db
        .prepare(
          `SELECT html FROM dossies
           WHERE cnpj = ? AND versao = ? AND status = 'concluido'`
        )
        .bind(cnpj, versao)
    : db
        .prepare(
          `SELECT html FROM dossies
           WHERE cnpj = ? AND status = 'concluido'
           ORDER BY versao DESC LIMIT 1`
        )
        .bind(cnpj);

  const linha = await consulta.first();
  return linha?.html || null;
}

/**
 * O JSON estruturado que originou o HTML. Permite reprocessar o
 * template — mudar layout, corrigir cálculo — sem chamar a IA de novo.
 */
export async function lerDados(db, cnpj, versao = null) {
  const linha = versao
    ? await buscarVersao(db, cnpj, versao)
    : await db
        .prepare(
          `SELECT dados_json FROM dossies
           WHERE cnpj = ? AND status = 'concluido'
           ORDER BY versao DESC LIMIT 1`
        )
        .bind(cnpj)
        .first();

  if (!linha?.dados_json) return null;

  try {
    return JSON.parse(linha.dados_json);
  } catch (e) {
    return null;
  }
}

/* ==========================================================================
   ESCRITA
   ========================================================================== */

async function proximaVersao(db, cnpj) {
  const linha = await db
    .prepare('SELECT COALESCE(MAX(versao), 0) AS ultima FROM dossies WHERE cnpj = ?')
    .bind(cnpj)
    .first();

  return Number(linha?.ultima || 0) + 1;
}

/**
 * Grava uma nova versão do dossiê.
 *
 * Uma única escrita: HTML, JSON e metadados na mesma linha.
 *
 * O UNIQUE (cnpj, versao) do esquema é a defesa real contra
 * concorrência — se dois consultores gerarem ao mesmo tempo e
 * calcularem a mesma "próxima versão", o banco rejeita a segunda
 * e ela é reprocessada com o número seguinte.
 *
 * @returns {Promise<{ok: boolean, versao?: number, erro?: string}>}
 */
export async function salvarDossie({ db, cnpj, montarHtml, dados, usuario, provider, fontes }) {
  if (!db) {
    return { ok: false, erro: 'Binding DB (D1) não configurado no ambiente.' };
  }
  if (typeof montarHtml !== 'function') {
    return { ok: false, erro: 'montarHtml deve ser uma função que recebe o número da versão.' };
  }

  const gravar = async (versao, html, bytes) => {
    await db
      .prepare(
        `INSERT INTO dossies
          (cnpj, razao_social, nome_fantasia, versao, gerado_por, gerado_em, provider,
           fonte_cnpj, fonte_site, fonte_instagram, r2_key, tamanho_bytes,
           html, dados_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'concluido')`
      )
      .bind(
        cnpj,
        dados?.empresa?.razaoSocial || null,
        dados?.empresa?.nomeFantasia || null,
        versao,
        usuario.email,
        new Date().toISOString(),
        provider,
        fontes?.cnpj || 'indisponivel',
        fontes?.site || 'falha',
        fontes?.instagram || 'ausente',
        bytes,
        html,
        JSON.stringify(dados)
      )
      .run();
  };

  // O HTML é renderizado DEPOIS de saber o número da versão — é o que
  // permite ao rodapé do documento exibir "Versão N".
  // Uma retentativa cobre a corrida entre dois consultores simultâneos:
  // na colisão, o documento é re-renderizado com o número correto.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const versao = await proximaVersao(db, cnpj);

    const html = montarHtml(versao);
    const bytes = new TextEncoder().encode(html || '').length;

    if (bytes === 0) return { ok: false, erro: 'HTML do dossiê veio vazio.' };
    if (bytes > LIMITE_HTML_BYTES) {
      return { ok: false, erro: `Dossiê grande demais (${Math.round(bytes / 1024)} KB).` };
    }

    try {
      await gravar(versao, html, bytes);
      return { ok: true, versao, tamanhoBytes: bytes };
    } catch (e) {
      const colisao = /UNIQUE|constraint/i.test(e.message || '');
      if (colisao && tentativa === 0) continue;
      return { ok: false, erro: e.message };
    }
  }

  return { ok: false, erro: 'Não foi possível determinar a versão do dossiê.' };
}

/**
 * Registra uma tentativa que falhou, para não perder o rastro.
 * Falha ao registrar falha é ignorada de propósito.
 */
export async function registrarErro({ db, cnpj, usuario, provider, mensagem }) {
  if (!db) return;

  try {
    const versao = await proximaVersao(db, cnpj);
    await db
      .prepare(
        `INSERT INTO dossies
          (cnpj, versao, gerado_por, gerado_em, provider, r2_key, status, erro_mensagem)
         VALUES (?, ?, ?, ?, ?, '', 'erro', ?)`
      )
      .bind(cnpj, versao, usuario.email, new Date().toISOString(), provider, mensagem)
      .run();
  } catch (e) {
    // silencioso
  }
}
