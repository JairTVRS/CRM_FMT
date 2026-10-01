/**
 * _lib/recortes.js — os recortes e o roteiro da reunião (2.37.0).
 *
 * A REGRA DO LOTE: a IA lê a transcrição e aponta as falas do lead que
 * revelam expectativa, dor, objeção ou como ele decide. Mas o que ela
 * CITA é conferido aqui, por código: a citação só vale se existir
 * literalmente na transcrição — sem acento, caixa e pontuação, que o
 * transcritor e o modelo escrevem cada um do seu jeito, mas com as mesmas
 * palavras na mesma ordem. O que não confere é descartado e contado.
 *
 * O mesmo vale para o roteiro: um item só conta como coberto se a
 * evidência que a IA apontou estiver na conversa.
 *
 * Funções puras, sem banco — a prova as chama direto.
 */

export const TIPOS_RECORTE = ['expectativa', 'dor', 'objecao', 'decisao'];

/** Até onde a conversa vai no prompt (o fim é o que importa ao vivo). */
export const LIMITE_TRANSCRICAO = 60000;
/** Menos que isto de conversa não vale a análise. */
export const CONVERSA_MINIMA = 200;
/**
 * O lado do lead só é separável se a voz dele tiver ao menos isto de
 * texto E esta parte da conversa. 2.38.0: no teste presencial de
 * 01/10/2026, 3 trechos soltos de "som do computador" (de 118) passaram
 * dos 200 caracteres, a análise olhou só para eles e voltou vazia.
 */
const TEXTO_MINIMO_DO_LEAD = 200;
const PARTE_MINIMA_DO_LEAD = 0.15;

/** Minúsculas, sem acento, só letras e números separados por um espaço. */
export function normalizar(t) {
  return String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const palavras = (t) => (normalizar(t) ? normalizar(t).split(' ').length : 0);
const curto = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Dá para dizer o que é fala do lead? Só na reunião online com o som do
 * computador chegando: aí a voz 'lead' é dele. Na presencial (Sala), ou
 * sem o som do computador, todo mundo está no mesmo microfone.
 *
 * @returns { separacao, origensDoLead: string[] | null }  null = todas
 */
export function separacaoDeVozes(trechos) {
  const tamanho = (lista) => lista.reduce((n, t) => n + String(t.texto || '').length, 0);
  const doLead = tamanho(trechos.filter((t) => t.origem === 'lead'));
  const total = tamanho(trechos);
  return doLead >= TEXTO_MINIMO_DO_LEAD && doLead >= total * PARTE_MINIMA_DO_LEAD
    ? { separacao: true, origensDoLead: ['lead'] }
    : { separacao: false, origensDoLead: null };
}

/**
 * Um texto contínuo por origem (a frase do lead pode ter sido cortada
 * entre dois trechos), já normalizado, com onde começa cada trecho.
 * `origens` null: tudo junto, na ordem da conversa.
 */
function textoCorrido(trechos, origens) {
  const ordenados = trechos
    .filter((t) => !origens || origens.includes(t.origem))
    .sort((a, b) => (a.gravacao_id - b.gravacao_id) || (a.inicio_s - b.inicio_s));
  const grupos = new Map();
  for (const t of ordenados) {
    const chave = origens ? t.origem : '*';
    if (!grupos.has(chave)) grupos.set(chave, { texto: '', marcas: [] });
    const g = grupos.get(chave);
    const n = normalizar(t.texto);
    if (!n) continue;
    if (g.texto) g.texto += ' ';
    g.marcas.push({ pos: g.texto.length, inicio_s: t.inicio_s, origem: t.origem });
    g.texto += n;
  }
  return [...grupos.values()];
}

/**
 * Onde a citação está na transcrição.
 * @returns { inicio_s, origem } ou null se não está (ou é curta demais)
 */
export function localizar(citacao, trechos, origens = null, { minimoPalavras = 4 } = {}) {
  const alvo = normalizar(citacao);
  if (!alvo || palavras(alvo) < minimoPalavras) return null;
  for (const g of textoCorrido(trechos, origens)) {
    // Na borda de palavra: "ano" não pode achar "plano".
    const pos = (` ${g.texto} `).indexOf(` ${alvo} `);
    if (pos < 0) continue;
    let marca = g.marcas[0];
    for (const m of g.marcas) { if (m.pos <= pos) marca = m; else break; }
    return { inicio_s: marca.inicio_s, origem: marca.origem };
  }
  return null;
}

/**
 * A resposta da IA, conferida. Recorte sem a citação na fala do lead sai;
 * item do roteiro sem evidência na conversa volta a "não coberto".
 */
export function conferirAnalise(bruto, trechos, { temRoteiro = false } = {}) {
  const { separacao, origensDoLead } = separacaoDeVozes(trechos);
  let descartados = 0;
  const vistos = new Set();

  const recortes = [];
  for (const r of Array.isArray(bruto?.recortes) ? bruto.recortes : []) {
    const tipo = TIPOS_RECORTE.includes(r?.tipo) ? r.tipo : null;
    const citacao = curto(r?.citacao, 400);
    const onde = tipo && citacao ? localizar(citacao, trechos, origensDoLead) : null;
    if (!onde) { descartados++; continue; }
    const chave = normalizar(citacao);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    recortes.push({ tipo, citacao, por_que: curto(r?.por_que, 300), inicio_s: onde.inicio_s });
    if (recortes.length >= 12) break;
  }
  recortes.sort((a, b) => a.inicio_s - b.inicio_s);

  const roteiro = [];
  if (temRoteiro) {
    for (const i of (Array.isArray(bruto?.roteiro) ? bruto.roteiro : []).slice(0, 20)) {
      const item = curto(i?.item, 200);
      if (!item) continue;
      const evidencia = curto(i?.evidencia, 400);
      // A pergunta pode ter sido feita pela Formatar e respondida pelo
      // lead: a evidência vale de qualquer voz.
      const onde = i?.coberto && evidencia ? localizar(evidencia, trechos, null, { minimoPalavras: 3 }) : null;
      roteiro.push(onde
        ? { item, coberto: true, evidencia, inicio_s: onde.inicio_s }
        : { item, coberto: false });
    }
  }

  const sugestoes = (Array.isArray(bruto?.sugestoes) ? bruto.sugestoes : [])
    .map((s) => curto(s, 240)).filter(Boolean).slice(0, 3);

  return { recortes, roteiro, sugestoes, separacao, descartados };
}

const minSeg = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const NOME_VOZ = { lead: 'LEAD', formatar: 'FORMATAR', sala: 'SALA' };

/** A transcrição para o prompt: "[03:12] LEAD: ...", cortada pelo começo se for longa. */
export function transcricaoParaPrompt(trechos) {
  const linhas = [...trechos]
    .sort((a, b) => (a.gravacao_id - b.gravacao_id) || (a.inicio_s - b.inicio_s))
    .map((t) => `[${minSeg(t.inicio_s)}] ${NOME_VOZ[t.origem] || 'VOZ'}: ${String(t.texto || '').trim()}`);
  let texto = linhas.join('\n');
  if (texto.length > LIMITE_TRANSCRICAO) {
    texto = `(início da conversa omitido)\n${texto.slice(-LIMITE_TRANSCRICAO)}`;
  }
  return texto;
}

/** O que o dossiê do lead diz de útil para a conversa, em poucas linhas. */
export function resumoDoDossie(dadosJson) {
  let d;
  try { d = typeof dadosJson === 'string' ? JSON.parse(dadosJson) : dadosJson; } catch (e) { return null; }
  const a = d?.analise || d;
  if (!a || typeof a !== 'object') return null;
  const semHtml = (t) => curto(String(t || '').replace(/<[^>]+>/g, ' '), 600);
  const partes = [];
  if (a.momento?.titulo) partes.push(`Momento: ${semHtml(a.momento.titulo)} — ${semHtml(a.momento.descricao)}`);
  const dores = (a.hipotesesDores || []).map((x) => x?.dor).filter(Boolean).slice(0, 5);
  if (dores.length) partes.push(`Hipóteses de dor: ${dores.map((x) => semHtml(x)).join('; ')}`);
  if (a.recomendacao) partes.push(`Abordagem sugerida: ${semHtml(a.recomendacao)}`);
  return partes.length ? partes.join('\n').slice(0, 3000) : null;
}

export const SYSTEM_PROMPT = `Você acompanha, em tempo real, uma reunião de vendas da Formatar (consultoria de gestão e governança) com um lead. Lê a transcrição automática — que tem erros de reconhecimento — e devolve SOMENTE um JSON:

{
  "recortes": [{ "tipo": "expectativa|dor|objecao|decisao", "citacao": "...", "por_que": "..." }],
  "roteiro":  [{ "item": "...", "coberto": true, "evidencia": "..." }],
  "sugestoes": ["..."]
}

REGRAS
1. recortes — até 10 falas do LEAD que revelam:
   - expectativa: o que ele espera ganhar ou resolver com a Formatar;
   - dor: o que hoje dá errado, custa caro ou preocupa;
   - objecao: o que o faz hesitar (preço, tempo, experiência ruim, desconfiança);
   - decisao: como decide — orçamento, prazo, quem mais precisa aprovar.
   "citacao" é COPIADA LETRA POR LETRA de UMA linha da transcrição (as linhas indicadas na instrução sobre as vozes), com 5 a 40 palavras seguidas: sem juntar linhas, sem corrigir erros do reconhecimento, sem resumir, sem reticências. Uma citação que não estiver na transcrição exatamente assim é descartada.
   "por_que": uma frase curta, sua, dizendo o que aquilo revela para a venda.
   Não recorte cumprimentos, conversa social, nem a fala da Formatar.
2. roteiro — se houver ROTEIRO, liste as perguntas ou temas dele na ordem (no máximo 15). "coberto": true somente se a conversa já tratou daquilo, e então "evidencia" é um trecho COPIADO LETRA POR LETRA da transcrição (3 a 30 palavras). Senão "coberto": false e "evidencia": "". Sem roteiro: "roteiro": [].
3. sugestoes — até 3 perguntas curtas para a Formatar fazer a seguir, puxando o que ficou em aberto: itens do roteiro não cobertos e dores do dossiê que a conversa ainda não tocou.

Nunca invente fatos sobre o lead. Se a conversa ainda não revelou nada, devolva listas vazias.`;

/** O texto do usuário: o lead, a instrução das vozes, o dossiê, o roteiro e a conversa. */
export function montarPrompt({ leadNome, separacao, dossie, roteiro, trechos }) {
  const vozes = separacao
    ? 'As falas do lead são as linhas marcadas LEAD. FORMATAR é a consultoria.'
    : 'Esta gravação NÃO separa as vozes (reunião presencial, ou sem o som do computador): as linhas misturam o lead e a Formatar. Recorte só o que, pelo conteúdo, é claramente fala do lead.';
  return [
    `LEAD: ${leadNome || '(sem nome)'}`,
    `VOZES: ${vozes}`,
    `DOSSIÊ DO LEAD:\n${dossie || '(sem dossiê)'}`,
    `ROTEIRO DA REUNIÃO:\n${roteiro ? String(roteiro).slice(0, 8000) : '(sem roteiro)'}`,
    `TRANSCRIÇÃO:\n${transcricaoParaPrompt(trechos)}`
  ].join('\n\n');
}
