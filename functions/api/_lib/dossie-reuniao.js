/**
 * _lib/dossie-reuniao.js — o Dossiê da Reunião (2.38.0).
 *
 * Pedido de 01/10/2026: depois da reunião, a IA lê a transcrição inteira
 * e segue a INSTRUÇÃO enviada nas Configurações (um .md por tipo de
 * reunião, com versões — "se mudar, somente mudamos o arquivo") para
 * montar o mapa de inteligência comercial da reunião.
 *
 * QUEM FAZ O QUÊ
 *   A IA escreve o CONTEÚDO, em HTML simples (títulos, parágrafos,
 *   listas, tabelas). O CRM limpa esse HTML, confere as citações e põe
 *   tudo na casca dos documentos da Formatar (_lib/documento-base.js) —
 *   o visual é sempre o mesmo, qualquer que seja a instrução.
 *
 * AS CITAÇÕES
 *   Toda fala que a IA cita vai dentro de <q>. Cada uma é procurada na
 *   transcrição, palavra por palavra (_lib/recortes.js → localizar): a
 *   que existe ganha o minuto em que foi dita; a que não existe fica no
 *   documento com a marca "não encontrada na transcrição". A regra
 *   central da instrução — separar o que foi dito do que é
 *   interpretação — passa a ser conferida por código, não confiada.
 *
 * Funções puras: a prova as chama direto.
 */

import { documento, folha, esc, FORMATAR, nomeDeDocumento } from './documento-base.js';
import { localizar, transcricaoParaPrompt } from './recortes.js';

/** O que a IA pode escrever no documento. Qualquer outra tag some (o texto fica). */
const TAGS = new Set(['h2', 'h3', 'h4', 'p', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'br',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'q', 'blockquote']);

export const TIPO_DOSSIE_REUNIAO = 'Dossie_Reuniao';
/** O teto de saída da DeepSeek é 8192 tokens. */
export const MAX_TOKENS_DOSSIE_REUNIAO = 8000;

/* ==========================================================================
   O PEDIDO À IA
   ========================================================================== */

export const SYSTEM_PROMPT = `Você é analista comercial sênior da Formatar (consultoria de gestão e governança). Recebe a INSTRUÇÃO de análise da reunião e a TRANSCRIÇÃO automática da reunião, e escreve o documento que a instrução pede.

FORMATO DE SAÍDA — obrigatório, vale mais do que qualquer formato que a instrução sugerir:
- Só o conteúdo, em HTML simples. Sem <html>, <head>, <body>, <style>, <script>, sem markdown, sem cercas de código.
- Tags permitidas, SEM atributos: h2 (cada seção da instrução), h3, h4, p, ul, ol, li, strong, em, table, thead, tbody, tr, th, td, q, br.
- Toda fala tirada da transcrição vai dentro de <q>...</q>, COPIADA LETRA POR LETRA de UMA linha da transcrição: de 3 a 40 palavras seguidas, sem juntar linhas, sem corrigir erros do reconhecimento, sem reticências. O sistema procura cada <q> na transcrição e marca as que não encontrar. Paráfrase, resumo ou interpretação NUNCA vão em <q>.
- Seja direto: frases curtas. Seção sem informação na transcrição: escreva "Não identificado na reunião." e siga.
- Não repita a instrução nem explique o que vai fazer. Comece pelo primeiro <h2>.

A transcrição é automática e tem erros de reconhecimento: não tire conclusão de uma palavra estranha isolada. Nunca invente o que não está na transcrição.`;

/**
 * O texto do usuário: a instrução, os dados da reunião, como ler as vozes
 * e a conversa.
 */
export function montarPrompt({ instrucao, reuniao, separacao, trechos }) {
  const vozes = separacao
    ? 'As falas do cliente são as linhas LEAD; FORMATAR é o condutor/consultor da Formatar.'
    : 'Esta gravação NÃO separa as vozes (reunião presencial, ou sem o som do computador): as linhas misturam cliente e condutor. Atribua quem falou pelo conteúdo e, quando não der para saber, diga isso.';
  const dados = [
    `Cliente/lead: ${reuniao.lead_nome || '(sem nome)'}`,
    reuniao.tipo_reuniao_nome ? `Tipo de reunião: ${reuniao.tipo_reuniao_nome}` : null,
    reuniao.data ? `Data: ${reuniao.data}` : null,
    reuniao.horario ? `Horário real: ${reuniao.horario}` : null,
    reuniao.condutor ? `Condutor (CX responsável): ${reuniao.condutor}` : null,
    reuniao.participantes ? `Participantes informados do lado do cliente: ${reuniao.participantes}` : null,
    reuniao.local ? `Local: ${reuniao.local}` : null
  ].filter(Boolean).join('\n');
  return [
    `INSTRUÇÃO DE ANÁLISE:\n${String(instrucao || '').slice(0, 60000)}`,
    `DADOS DA REUNIÃO (do CRM):\n${dados}`,
    `VOZES: ${vozes}`,
    `TRANSCRIÇÃO:\n${transcricaoParaPrompt(trechos)}`
  ].join('\n\n');
}

/* ==========================================================================
   LIMPEZA E CONFERÊNCIA
   ========================================================================== */

/** O HTML que a IA devolveu, só com as tags da lista e sem atributo nenhum. */
export function limparConteudo(bruto) {
  let t = String(bruto || '')
    .replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '')
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  // Tag é "<" colado num nome que começa com letra: "3 < 5" é texto.
  t = t.replace(/<(\/?)([a-z][a-z0-9]*)\b[^<>]*>/gi, (tag, barra, nome) => {
    const n = nome.toLowerCase();
    return TAGS.has(n) ? `<${barra}${n}>` : '';
  });
  // Um "<" solto que não virou tag não pode abrir uma no navegador.
  t = t.replace(/<(?!\/?(?:h2|h3|h4|p|strong|em|b|i|ul|ol|li|br|table|thead|tbody|tr|th|td|q|blockquote)>)/gi, '&lt;');
  return t.trim();
}

const semTags = (t) => String(t || '').replace(/<[^>]+>/g, ' ');
const desfazerEntidades = (t) => t
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const minSeg = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Cada <q> do conteúdo, procurado na transcrição. Achou: ganha o minuto.
 * Não achou: fica, marcado "não encontrada na transcrição".
 */
export function conferirCitacoes(conteudo, trechos) {
  let citacoes = 0;
  let naoEncontradas = 0;
  const html = String(conteudo || '').replace(/<q>([\s\S]*?)<\/q>/g, (inteiro, dentro) => {
    const texto = desfazerEntidades(semTags(dentro)).replace(/\s+/g, ' ').trim();
    if (!texto) return '';
    citacoes++;
    const onde = localizar(texto, trechos, null, { minimoPalavras: 3 });
    if (onde) return `<q class="confere">${dentro}</q> <span class="cit-minuto">${minSeg(onde.inicio_s || 0)}</span>`;
    naoEncontradas++;
    return `<q class="nao-confere">${dentro}</q> <span class="cit-selo">não encontrada na transcrição</span>`;
  });
  return { html, citacoes, naoEncontradas };
}

/* ==========================================================================
   O DOCUMENTO
   ========================================================================== */

const ESTILO = `<style>
.capa-dossie{display:flex;flex-direction:column;gap:4mm}
.capa-dossie .kicker{font-size:9pt}
.capa-dossie h1{font-size:28pt;color:#fff;margin:0}
.capa-dossie .sub{font-size:11pt;color:#d9d5cc}
.capa-ficha{font-size:8.5pt;color:#bdb8ad;line-height:1.7}
.capa-ficha strong{color:#fff;font-weight:600}
.como-ler{font-size:8.5pt;line-height:1.5}
.como-ler p{margin:0 0 1.5mm;text-align:left}
.dossie-corpo h2{border-left:3px solid var(--laranja);padding-left:3mm;margin-top:8mm}
.dossie-corpo h3{color:var(--tinta-suave)}
.dossie-corpo h4{font-size:9.5pt;margin:3mm 0 1mm;color:var(--cinza);text-transform:uppercase;letter-spacing:.06em}
.dossie-corpo td,.dossie-corpo th{font-size:8.5pt}
.dossie-corpo table{page-break-inside:auto}
.dossie-corpo tr{page-break-inside:avoid}
.dossie-corpo blockquote{border-left:2px solid #d9d4c9;padding-left:3mm;margin:2mm 0;color:var(--tinta-suave)}
q{font-style:italic}
q.confere{background:#fff4ef;padding:0 .6mm;border-radius:.6mm}
q.nao-confere{text-decoration:underline wavy #c0392b;text-underline-offset:2px}
.cit-minuto{font-size:7pt;color:var(--cinza);font-variant-numeric:tabular-nums;white-space:nowrap}
.cit-selo{display:inline-block;font-size:6.5pt;font-weight:600;color:#fff;background:#c0392b;
  padding:.3mm 1.6mm;border-radius:1mm;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;vertical-align:1px}
.folha.dossie-longa{min-height:297mm}
@media print{.folha.dossie-longa .folha-rodape{position:static;margin-top:8mm}}
</style>`;

/**
 * O documento completo.
 *
 * @param p.conteudo   o HTML já limpo e conferido
 * @param p.reuniao    { lead_nome, tipo_reuniao_nome, data, horario, condutor, participantes, local }
 * @param p.meta       { versao, geradoEm, geradoPor, instrucaoVersao, provider, citacoes, naoEncontradas, separacao }
 */
export function montarDocumento({ conteudo, reuniao, meta }) {
  const titulo = `${nomeDeDocumento(TIPO_DOSSIE_REUNIAO, reuniao.lead_nome, meta.geradoEm)}`;
  const quando = meta.geradoEm
    ? new Date(meta.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
    : '';
  const linha = (rotulo, valor) => (valor ? `<div>${esc(rotulo)}: <strong>${esc(valor)}</strong></div>` : '');

  const capa = `
<section class="folha capa">
  ${ESTILO}
  <div>
    <div class="marca">${FORMATAR.marca}</div>
    <div class="marca-assinatura">${FORMATAR.assinatura}</div>
  </div>
  <div class="capa-dossie">
    <div class="kicker">Dossiê da Reunião</div>
    <h1>${esc(reuniao.lead_nome || 'Reunião')}</h1>
    <div class="sub">${esc([reuniao.tipo_reuniao_nome, reuniao.data, reuniao.horario].filter(Boolean).join(' · '))}</div>
  </div>
  <div class="capa-ficha">
    ${linha('Condutor', reuniao.condutor)}
    ${linha('Participantes do cliente', reuniao.participantes)}
    ${linha('Local', reuniao.local)}
    ${linha('Versão', meta.versao ? `${meta.versao}` : '')}
    ${linha('Gerado em', quando)}
    ${linha('Por', meta.geradoPor)}
    ${linha('Instrução', meta.instrucaoVersao ? `versão ${meta.instrucaoVersao}` : '')}
    ${linha('IA', meta.provider)}
  </div>
</section>`;

  const vozes = meta.separacao
    ? 'As vozes da gravação estão separadas: o cliente e a Formatar.'
    : 'Esta gravação não separa as vozes (presencial ou sem o som do computador): quem falou cada coisa foi deduzido pelo conteúdo.';
  const comoLer = `
<div class="bloco como-ler">
  <div class="kicker">Como ler este documento</div>
  <p>As falas <q class="confere">entre aspas, destacadas</q> foram conferidas, palavra por palavra, contra a transcrição; o minuto ao lado diz onde estão.</p>
  <p>As marcadas <span class="cit-selo">não encontrada na transcrição</span> a IA citou, mas não estão lá: trate como interpretação, não como fala.</p>
  <p>${esc(vozes)} ${meta.citacoes ? `Citações: ${meta.citacoes}, das quais ${meta.naoEncontradas} não encontrada(s).` : ''}</p>
  <p>A transcrição é automática e pode ter erros de reconhecimento.</p>
</div>`;

  const corpo = folha({
    titulo: 'Dossiê da Reunião',
    conteudo: `${comoLer}<div class="dossie-corpo">${conteudo}</div>`,
    numero: 2,
    total: 2,
    rodapeEsquerda: `${reuniao.lead_nome || ''} · versão ${meta.versao || ''}`
  }).replace('<section class="folha">', '<section class="folha dossie-longa">');

  return documento({ titulo, folhas: [capa, corpo] });
}
