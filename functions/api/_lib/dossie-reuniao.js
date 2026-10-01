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
 * AS CITAÇÕES — ANCORADAS NA LINHA (2.38.3)
 *   A transcrição vai ao prompt com as linhas numeradas, e a IA cita
 *   apontando a linha: <q>[37] o PGR é o programa…</q>. O CRM procura o
 *   trecho DENTRO daquela linha (ou das vizinhas, se ela errou por uma) e
 *   põe no documento as palavras EXATAS da transcrição, com o minuto. O
 *   que fica entre aspas é sempre a fala real: o erro de uma letra da IA
 *   ("Gernção" por "Gerenção", na v2 de 01/10/2026) não chega ao papel.
 *   "Não encontrada na transcrição" só quando a linha apontada não tem
 *   nada parecido — ou quando a IA cita sem número e o texto não existe
 *   (aí vale a conferência antiga, palavra por palavra).
 *   A regra central da instrução — separar o que foi dito do que é
 *   interpretação — passa a ser garantida por código, não confiada.
 *
 * Funções puras: a prova as chama direto.
 */

import { documento, folha, esc, FORMATAR, nomeDeDocumento } from './documento-base.js';
import { localizar, normalizar, LIMITE_TRANSCRICAO } from './recortes.js';

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
- As linhas da transcrição são numeradas: [L37]. Toda fala tirada da transcrição vai dentro de <q>, COMEÇANDO pelo número da linha entre colchetes e seguida do trecho daquela linha: <q>[37] o PGR é o programa de gerência de riscos</q>. De 3 a 40 palavras seguidas de UMA linha, sem juntar linhas, sem reticências. O sistema troca o trecho pelas palavras exatas da linha apontada — o número é o que importa. Paráfrase, resumo ou interpretação NUNCA vão em <q>.
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
    `TRANSCRIÇÃO (linhas numeradas):\n${transcricaoNumerada(trechos)}`
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

const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NOME_VOZ = { lead: 'LEAD', formatar: 'FORMATAR', sala: 'SALA' };

/**
 * As linhas da transcrição, na ordem da conversa, numeradas a partir de 1.
 * A MESMA numeração vai ao prompt e à conferência — é ela que liga a
 * citação da IA à fala real.
 */
export function linhasDaTranscricao(trechos) {
  return [...trechos]
    .sort((a, b) => (a.gravacao_id - b.gravacao_id) || (a.inicio_s - b.inicio_s))
    .map((t, i) => ({ n: i + 1, origem: t.origem, inicio_s: t.inicio_s, texto: String(t.texto || '').trim() }));
}

/** "[L37 03:12] LEAD: ..." — cortada pelo começo se for longa (o fim é o que se cita mais). */
export function transcricaoNumerada(trechos) {
  let texto = linhasDaTranscricao(trechos)
    .map((l) => `[L${l.n} ${minSeg(l.inicio_s || 0)}] ${NOME_VOZ[l.origem] || 'VOZ'}: ${l.texto}`)
    .join('\n');
  if (texto.length > LIMITE_TRANSCRICAO) texto = `(início da conversa omitido)\n${texto.slice(-LIMITE_TRANSCRICAO)}`;
  return texto;
}

/** Maior subsequência comum entre duas listas de palavras normalizadas. */
function lcs(a, b) {
  const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = a[i - 1] === b[j - 1] ? m[i - 1][j - 1] + 1 : Math.max(m[i - 1][j], m[i][j - 1]);
    }
  }
  return m[a.length][b.length];
}

/** Quanto do trecho precisa bater com a linha apontada para valer. */
const ACERTO_MINIMO = 0.6;

/**
 * O trecho citado, dentro das palavras de uma linha (ou de duas, juntas).
 * Devolve as palavras ORIGINAIS da janela que mais se parece com o trecho,
 * e quanto ela se parece (0–1).
 */
function melhorJanela(palavrasOriginais, alvo) {
  const norm = palavrasOriginais.map((p) => normalizar(p));
  let melhor = { nota: 0, inicio: 0, fim: 0 };
  for (let tam = Math.max(1, alvo.length - 2); tam <= alvo.length + 2; tam++) {
    for (let i = 0; i + tam <= norm.length; i++) {
      const janela = norm.slice(i, i + tam).filter(Boolean);
      const nota = lcs(alvo, janela) / Math.max(alvo.length, janela.length || 1);
      if (nota > melhor.nota) melhor = { nota, inicio: i, fim: i + tam };
    }
  }
  // A linha inteira é menor que o trecho: compara com ela toda.
  if (norm.length < alvo.length - 2) {
    const nota = lcs(alvo, norm.filter(Boolean)) / Math.max(alvo.length, norm.length || 1);
    if (nota > melhor.nota) melhor = { nota, inicio: 0, fim: norm.length };
  }
  return { nota: melhor.nota, texto: palavrasOriginais.slice(melhor.inicio, melhor.fim).join(' ') };
}

/**
 * A citação ancorada: o trecho dentro da linha N — ou de N−1, N+1, ou de
 * N com a seguinte da mesma voz (frase cortada entre dois trechos).
 * @returns { texto, inicio_s } com as palavras exatas, ou null
 */
export function ancorar(numero, trecho, linhas) {
  const alvo = normalizar(trecho).split(' ').filter(Boolean);
  if (alvo.length < 2) return null;
  const linha = (n) => linhas[n - 1];
  const candidatos = [];
  for (const n of [numero, numero - 1, numero + 1]) {
    const l = linha(n);
    if (!l) continue;
    candidatos.push({ l, palavras: l.texto.split(/\s+/) });
    const seguinte = linha(n + 1);
    if (seguinte && seguinte.origem === l.origem) {
      candidatos.push({ l, palavras: `${l.texto} ${seguinte.texto}`.split(/\s+/) });
    }
  }
  let melhor = null;
  for (const c of candidatos) {
    const r = melhorJanela(c.palavras, alvo);
    // Na dúvida, fica a linha apontada (a primeira da lista).
    if (!melhor || r.nota > melhor.nota + 0.0001) melhor = { ...r, inicio_s: c.l.inicio_s };
  }
  return melhor && melhor.nota >= ACERTO_MINIMO ? { texto: melhor.texto, inicio_s: melhor.inicio_s } : null;
}

/**
 * Cada <q> do conteúdo. Com o número da linha ("[37] trecho"), ancorada:
 * vira as palavras exatas da transcrição, com o minuto. Sem número, a
 * conferência antiga: palavra por palavra em qualquer linha. O que não
 * achar fica, marcado "não encontrada na transcrição".
 */
export function conferirCitacoes(conteudo, trechos) {
  const linhas = linhasDaTranscricao(trechos);
  let citacoes = 0;
  let naoEncontradas = 0;
  const html = String(conteudo || '').replace(/<q>([\s\S]*?)<\/q>/g, (inteiro, dentro) => {
    const bruto = desfazerEntidades(semTags(dentro)).replace(/\s+/g, ' ').trim();
    if (!bruto) return '';
    citacoes++;
    const comNumero = bruto.match(/^\[\s*L?\s*(\d+)\s*\]\s*(.*)$/i);
    if (comNumero) {
      const achado = ancorar(Number(comNumero[1]), comNumero[2], linhas);
      if (achado) {
        return `<q class="confere">${escHtml(achado.texto)}</q> <span class="cit-minuto">${minSeg(achado.inicio_s || 0)}</span>`;
      }
      naoEncontradas++;
      return `<q class="nao-confere">${escHtml(comNumero[2])}</q> <span class="cit-selo">não encontrada na transcrição</span>`;
    }
    const onde = localizar(bruto, trechos, null, { minimoPalavras: 3 });
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
