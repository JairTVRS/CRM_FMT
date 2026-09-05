/**
 * _lib/versionamento.js — Documento versionado, num lugar só.
 *
 * Os três geradores do CRM — Dossiê Executivo, Proposta Comercial e
 * Dossiê de Experiência — guardam documento do mesmo jeito: calcula a
 * próxima versão, renderiza o HTML COM o número em mão, grava, e na
 * colisão do `UNIQUE` refaz com o número seguinte. Estava escrito três
 * vezes, com as mesmas armadilhas em cada cópia.
 *
 * Com um consumidor, extrair era abstração prematura — está registrado
 * assim no roadmap desde o Lote E. Com três, e um quarto (o contrato, no
 * Lote G) a caminho, deixou de ser.
 *
 * O QUE VARIA entre os três, e por isso é parâmetro:
 *
 *   tabela  `dossies` | `propostas` | `dossies_cx`
 *   chave   `cnpj`    | `lead_id`   | `cliente_id`
 *
 * O Executivo é chaveado por CNPJ porque fala de um prospect que talvez
 * nem esteja no CRM; a proposta, por lead; o de Experiência, por cliente.
 * São sujeitos diferentes, e é por isso que as três tabelas existem em
 * vez de uma com um campo "tipo".
 *
 * O QUE NÃO VARIA, e por isso mora aqui:
 *
 *   versao, gerado_por, gerado_em, html, tamanho_bytes, dados_json, status
 *
 * Colunas próprias de cada documento — `razao_social` e as `fonte_*` do
 * Executivo, o `provider` de quem usa IA — entram por `extras`, um mapa
 * de coluna para valor.
 *
 * REGRA CENTRAL, herdada e inalterada: gerar de novo NUNCA sobrescreve.
 * Cria a versão seguinte e a anterior continua consultável, porque
 * documento lido numa reunião precisa ser reproduzível como foi lido.
 */

/* Guarda contra documento anômalo. Um dossiê típico tem ~30 KB; o limite
   de linha do D1 é 1 MB e não queremos chegar perto. */
export const LIMITE_HTML_BYTES = 700_000;

/**
 * Nomes de tabela e coluna entram em SQL por interpolação — não há como
 * parametrizar identificador em SQLite. Todos vêm de constantes do nosso
 * próprio código, nunca de requisição, mas a checagem fica registrada:
 * é o tipo de porta que se fecha antes de alguém pensar em abri-la.
 */
const IDENTIFICADOR = /^[A-Za-z_][A-Za-z0-9_]*$/;

function identificador(nome, papel) {
  if (!IDENTIFICADOR.test(String(nome || ''))) {
    throw new Error(`Nome inválido para ${papel}: ${nome}`);
  }
  return nome;
}

/**
 * Cria o versionador de um tipo de documento.
 *
 * @param {object}   config
 * @param {string}   config.tabela          nome da tabela
 * @param {string}   config.chave           coluna que identifica o sujeito
 * @param {string}   config.rotulo          como o documento se chama nas mensagens de erro,
 *                                          já flexionado: "do dossiê", "da proposta"
 * @param {string[]} config.colunasResumo   colunas do histórico, além das comuns
 */
export function criarVersionador({ tabela, chave, rotulo = 'documento', colunasResumo = [] }) {
  const T = identificador(tabela, 'tabela');
  const K = identificador(chave, 'coluna-chave');
  const RESUMO = colunasResumo.map((c) => identificador(c, 'coluna do resumo'));

  const COMUNS = ['versao', 'gerado_por', 'gerado_em', 'tamanho_bytes'];
  const listaResumo = [...COMUNS, ...RESUMO].join(', ');

  /* ------------------------------------------------------------------
     LEITURA
     ------------------------------------------------------------------ */

  /**
   * Metadados da última versão concluída.
   *
   * Não traz `html` de propósito: é consultado com frequência — para
   * decidir se abre ou gera — e não precisa carregar o documento inteiro.
   */
  async function buscarUltima(db, valorChave) {
    if (!db) return null;

    return db
      .prepare(
        `SELECT id, ${K}, ${listaResumo}
           FROM ${T}
          WHERE ${K} = ? AND status = 'concluido'
          ORDER BY versao DESC
          LIMIT 1`
      )
      .bind(valorChave)
      .first();
  }

  /** Histórico completo — alimenta o seletor de versões. */
  async function listarVersoes(db, valorChave) {
    if (!db) return [];

    const { results } = await db
      .prepare(
        `SELECT ${listaResumo}
           FROM ${T}
          WHERE ${K} = ? AND status = 'concluido'
          ORDER BY versao DESC`
      )
      .bind(valorChave)
      .all();

    return results || [];
  }

  /** Metadados de uma versão específica, sem o HTML. */
  async function buscarVersao(db, valorChave, versao) {
    if (!db) return null;

    return db
      .prepare(
        `SELECT id, ${K}, ${listaResumo}, dados_json
           FROM ${T}
          WHERE ${K} = ? AND versao = ? AND status = 'concluido'`
      )
      .bind(valorChave, versao)
      .first();
  }

  /**
   * O documento em si. Chamada separada porque é a única que carrega o
   * texto completo.
   *
   * @param {number|null} versao  omitido ou null devolve a mais recente
   */
  async function lerHtml(db, valorChave, versao = null) {
    if (!db) return null;

    const consulta = versao
      ? db.prepare(
          `SELECT html FROM ${T}
            WHERE ${K} = ? AND versao = ? AND status = 'concluido'`
        ).bind(valorChave, versao)
      : db.prepare(
          `SELECT html FROM ${T}
            WHERE ${K} = ? AND status = 'concluido'
            ORDER BY versao DESC LIMIT 1`
        ).bind(valorChave);

    const linha = await consulta.first();
    return linha?.html || null;
  }

  /**
   * O JSON que originou o HTML. Permite reprocessar o template — mudar
   * layout, corrigir cálculo — sem chamar a IA de novo.
   */
  async function lerDados(db, valorChave, versao = null) {
    if (!db) return null;

    const linha = versao
      ? await buscarVersao(db, valorChave, versao)
      : await db
          .prepare(
            `SELECT dados_json FROM ${T}
              WHERE ${K} = ? AND status = 'concluido'
              ORDER BY versao DESC LIMIT 1`
          )
          .bind(valorChave)
          .first();

    if (!linha?.dados_json) return null;

    try {
      return JSON.parse(linha.dados_json);
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------------
     ESCRITA
     ------------------------------------------------------------------ */

  async function proximaVersao(db, valorChave) {
    const linha = await db
      .prepare(`SELECT COALESCE(MAX(versao), 0) AS ultima FROM ${T} WHERE ${K} = ?`)
      .bind(valorChave)
      .first();

    return Number(linha?.ultima || 0) + 1;
  }

  /**
   * Grava uma versão nova. Uma única escrita: HTML, JSON e metadados na
   * mesma linha — não existe arquivo órfão.
   *
   * `montarHtml` recebe o número da versão em vez de o HTML vir pronto.
   * É o que permite ao documento estampar "Versão N" na própria capa: o
   * número só é conhecido aqui dentro, e na colisão o documento é
   * re-renderizado com o número certo.
   *
   * O `UNIQUE (chave, versao)` do esquema é a defesa real contra dois
   * consultores gerando ao mesmo tempo. Uma retentativa basta: a segunda
   * colisão seguida seria sinal de outro problema, não de corrida.
   *
   * @returns {Promise<{ok: boolean, versao?: number, tamanhoBytes?: number, erro?: string}>}
   */
  async function salvar({ db, valorChave, montarHtml, dados, usuario, extras = {}, limiteBytes = LIMITE_HTML_BYTES }) {
    // `dados` aceita objeto ou função da versão — ver o comentário na
    // gravação, logo abaixo.
    if (!db) {
      return { ok: false, erro: 'Binding DB (D1) não configurado no ambiente.' };
    }
    if (typeof montarHtml !== 'function') {
      return { ok: false, erro: 'montarHtml deve ser uma função que recebe o número da versão.' };
    }

    const colunasExtras = Object.keys(extras).map((c) => identificador(c, 'coluna extra'));
    const valoresExtras = colunasExtras.map((c) => extras[c]);

    const colunas = [K, ...colunasExtras, 'versao', 'gerado_por', 'gerado_em',
                     'html', 'tamanho_bytes', 'dados_json', 'status'];

    const sql = `INSERT INTO ${T} (${colunas.join(', ')})
                 VALUES (${colunas.map(() => '?').join(', ')})`;

    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const versao = await proximaVersao(db, valorChave);

      const html = montarHtml(versao);
      const bytes = new TextEncoder().encode(html || '').length;

      // Documento vazio é falha silenciosa do template. Gravar produziria
      // uma versão que abre em branco e ninguém sabe por quê.
      if (bytes === 0) return { ok: false, erro: `O HTML ${rotulo} veio vazio.` };
      if (bytes > limiteBytes) {
        return { ok: false, erro: `Documento ${rotulo} grande demais (${Math.round(bytes / 1024)} KB).` };
      }

      // `dados` também pode ser função da versão, e é o que faz o
      // `dados_json` guardar o número certo. Reprocessar o template a
      // partir de um JSON com `versao: null` renderizaria uma capa sem
      // versão — o Executivo tinha exatamente esse furo antes da
      // unificação.
      const conteudo = typeof dados === 'function' ? dados(versao) : dados;

      try {
        await db
          .prepare(sql)
          .bind(
            valorChave, ...valoresExtras, versao,
            usuario.email, new Date().toISOString(),
            html, bytes, JSON.stringify(conteudo), 'concluido'
          )
          .run();

        return { ok: true, versao, tamanhoBytes: bytes };

      } catch (e) {
        const colisao = /UNIQUE|constraint/i.test(e.message || '');
        if (colisao && tentativa === 0) continue;
        return { ok: false, erro: e.message };
      }
    }

    return { ok: false, erro: 'Não foi possível determinar a versão do documento.' };
  }

  /**
   * Registra uma tentativa que falhou, para não perder o rastro.
   *
   * Falha ao registrar falha é engolida de propósito: o erro que importa
   * é o original, e deixar este por cima dele esconderia a causa.
   */
  async function registrarErro({ db, valorChave, usuario, mensagem, extras = {} }) {
    if (!db) return;

    try {
      const colunasExtras = Object.keys(extras).map((c) => identificador(c, 'coluna extra'));
      const colunas = [K, ...colunasExtras, 'versao', 'gerado_por', 'gerado_em',
                       'status', 'erro_mensagem'];

      await db
        .prepare(
          `INSERT INTO ${T} (${colunas.join(', ')})
           VALUES (${colunas.map(() => '?').join(', ')})`
        )
        .bind(
          valorChave, ...colunasExtras.map((c) => extras[c]),
          await proximaVersao(db, valorChave),
          usuario?.email || null, new Date().toISOString(),
          'erro', mensagem
        )
        .run();
    } catch (e) {
      // silencioso
    }
  }

  return {
    buscarUltima, listarVersoes, buscarVersao, lerHtml, lerDados,
    proximaVersao, salvar, registrarErro
  };
}
