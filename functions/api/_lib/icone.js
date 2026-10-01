/**
 * _lib/icone.js — o ícone do CRM, dentro dos documentos (2.38.1).
 *
 * Pedido de 01/10/2026: o documento baixado abria com o globo genérico na
 * aba. Um .html salvo no computador não alcança /Icone-Aba.png do site,
 * então o ícone vai DENTRO do arquivo, como data URI: o mesmo símbolo da
 * marca, reduzido a 64 px (cerca de 2 KB) para não pesar no documento.
 *
 * Gerado a partir de public/Icone-Aba.png. Se a marca mudar, gerar de novo.
 */

const ICONE_PNG_BASE64 =
  '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';

/** A tag do ícone, para o <head> de todo documento. */
export const LINK_ICONE = `<link rel="icon" type="image/png" href="data:image/png;base64,${ICONE_PNG_BASE64}">`;
