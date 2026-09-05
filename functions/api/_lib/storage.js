/**
 * _lib/storage.js — Persistência do Dossiê Executivo.
 *
 * Desde a unificação (2.17.0) este arquivo não implementa mais nada: ele
 * configura o `_lib/versionamento.js` para a tabela `dossies` e traduz os
 * nomes que a `dossier.js` já usava.
 *
 * A camada fina continua existindo em vez de a `dossier.js` falar direto
 * com o versionador por uma razão só: `salvarDossie` recebe `fontes` e
 * `dados.empresa` e sabe como virar coluna — `fonte_cnpj`, `razao_social`.
 * Isso é conhecimento do Executivo, não de documento em geral, e empurrá-lo
 * para o módulo comum faria o comum saber de dossiê.
 *
 * Armazenamento inteiramente em D1: o HTML fica numa coluna de texto,
 * junto com o registro da versão. O R2 foi descartado por exigir ativação
 * com cartão de crédito — para documentos de ~30 KB o ganho não
 * justificava a dependência. A coluna `r2_key` sobrou daquela época e é
 * `NOT NULL`, por isso segue sendo gravada como string vazia.
 */

import { criarVersionador, LIMITE_HTML_BYTES } from './versionamento.js';

const dossies = criarVersionador({
  tabela: 'dossies',
  chave: 'cnpj',
  rotulo: 'do dossiê',
  colunasResumo: [
    'razao_social', 'nome_fantasia', 'provider',
    'fonte_cnpj', 'fonte_site', 'fonte_instagram'
  ]
});

/* ==========================================================================
   LEITURA — os mesmos nomes de antes, para não mexer na dossier.js
   ========================================================================== */

export const buscarUltimoDossie = (db, cnpj) => dossies.buscarUltima(db, cnpj);
export const listarVersoes = (db, cnpj) => dossies.listarVersoes(db, cnpj);
export const buscarVersao = (db, cnpj, versao) => dossies.buscarVersao(db, cnpj, versao);
export const lerHtml = (db, cnpj, versao = null) => dossies.lerHtml(db, cnpj, versao);
export const lerDados = (db, cnpj, versao = null) => dossies.lerDados(db, cnpj, versao);

/* ==========================================================================
   ESCRITA
   ========================================================================== */

/**
 * Grava uma nova versão do dossiê.
 *
 * Regra central inalterada: gerar de novo NUNCA sobrescreve. Cria a versão
 * seguinte e a anterior continua consultável.
 *
 * @returns {Promise<{ok: boolean, versao?: number, tamanhoBytes?: number, erro?: string}>}
 */
export async function salvarDossie({ db, cnpj, montarHtml, montarDados, usuario, provider, fontes }) {
  // As colunas de resumo saem da forma dos dados, que não depende da
  // versão — `montarDados(null)` basta para lê-las. O que vai para o
  // `dados_json` é a função, para que a versão gravada seja a certa.
  const base = montarDados?.(null) || null;

  return dossies.salvar({
    db,
    valorChave: cnpj,
    montarHtml,
    dados: montarDados,
    usuario,
    limiteBytes: LIMITE_HTML_BYTES,
    extras: {
      razao_social: base?.empresa?.razaoSocial || null,
      nome_fantasia: base?.empresa?.nomeFantasia || null,
      provider,

      // De onde veio cada pedaço do material. Ficam no registro porque
      // explicam a qualidade do documento meses depois: dossiê fraco com
      // `fonte_site: 'falha'` não é defeito da análise.
      fonte_cnpj: fontes?.cnpj || 'indisponivel',
      fonte_site: fontes?.site || 'falha',
      fonte_instagram: fontes?.instagram || 'ausente',

      // Sobra do tempo do R2. NOT NULL no esquema.
      r2_key: ''
    }
  });
}

/**
 * Registra uma tentativa que falhou, para não perder o rastro.
 * Falha ao registrar falha é ignorada de propósito.
 */
export async function registrarErro({ db, cnpj, usuario, provider, mensagem }) {
  return dossies.registrarErro({
    db,
    valorChave: cnpj,
    usuario,
    mensagem,
    extras: { provider, r2_key: '' }
  });
}
