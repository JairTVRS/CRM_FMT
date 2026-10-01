/**
 * _lib/citacoes.js — a citação ancorada na linha da fonte (2.38.3).
 *
 * Nasceu no Dossiê da Reunião e virou módulo na 2.39.0, quando a Balança
 * Avaliativa passou a citar as atas do mesmo jeito.
 *
 * A REGRA: a fonte (transcrição, atas, ações) vai ao prompt com as linhas
 * numeradas, e a IA cita apontando a linha: <q>[37] trecho</q>. Aqui o
 * trecho é procurado DENTRO daquela linha (ou da vizinha, se a IA errou
 * por uma; ou da linha junto com a seguinte do mesmo grupo, quando a
 * frase foi cortada entre duas), e o documento recebe as palavras EXATAS
 * da fonte. O que fica entre aspas é sempre o que está lá: o erro de uma
 * letra da IA não chega ao papel.
 *
 * Cada consumidor diz o que é uma linha:
 *   { n, texto, grupo, ... }  — `n` a partir de 1, na ordem do prompt;
 *   `grupo` junta as linhas que podem continuar uma na outra (a mesma
 *   voz, a mesma ata).
 */

import { normalizar } from './recortes.js';

const semTags = (t) => String(t || '').replace(/<[^>]+>/g, ' ');
const desfazerEntidades = (t) => t
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
  let melhor = { nota: 0, inicio: 0, fim: 0, folga: Infinity };
  for (let tam = Math.max(1, alvo.length - 2); tam <= alvo.length + 2; tam++) {
    for (let i = 0; i + tam <= norm.length; i++) {
      const janela = norm.slice(i, i + tam).filter(Boolean);
      const nota = lcs(alvo, janela) / Math.max(alvo.length, janela.length || 1);
      // Empate na nota: vence o tamanho mais perto do que a IA citou. Sem
      // isso, "O sócio reclamou do atrazo" virava "O sócio reclamou do" —
      // a janela curta empata e a palavra certa ("atraso") ficava de fora.
      const folga = Math.abs(tam - alvo.length);
      if (nota > melhor.nota + 1e-9 || (Math.abs(nota - melhor.nota) <= 1e-9 && folga < melhor.folga)) {
        melhor = { nota, inicio: i, fim: i + tam, folga };
      }
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
 * N com a seguinte do mesmo grupo.
 * @returns { texto, linha } com as palavras exatas e a linha onde estão, ou null
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
    if (seguinte && seguinte.grupo === l.grupo) {
      candidatos.push({ l, palavras: `${l.texto} ${seguinte.texto}`.split(/\s+/) });
    }
  }
  let melhor = null;
  for (const c of candidatos) {
    const r = melhorJanela(c.palavras, alvo);
    // Na dúvida, fica a linha apontada (a primeira da lista).
    if (!melhor || r.nota > melhor.nota + 0.0001) melhor = { ...r, linha: c.l };
  }
  return melhor && melhor.nota >= ACERTO_MINIMO ? { texto: melhor.texto, linha: melhor.linha } : null;
}

/**
 * Cada <q> do conteúdo. Com o número da linha ("[37] trecho"): ancorada,
 * vira as palavras exatas da fonte, com o rótulo da linha ao lado. Sem
 * número: `semNumero(texto)` decide (a conferência palavra por palavra de
 * antes). O que não achar fica, com o selo "não encontrada na <fonte>".
 *
 * @param conteudo  o HTML já limpo
 * @param linhas    as linhas numeradas da fonte
 * @param opcoes.rotulo      (linha) → o que vai ao lado da citação: "03:12", "ata de 15/09/2026"
 * @param opcoes.semNumero   (texto) → { rotulo } ou null
 * @param opcoes.fonte       "transcrição", "fonte"… — para o selo
 */
export function conferirCitacoesAncoradas(conteudo, linhas, { rotulo, semNumero = () => null, fonte = 'fonte' }) {
  let citacoes = 0;
  let naoEncontradas = 0;
  const selo = `<span class="cit-selo">não encontrada na ${escHtml(fonte)}</span>`;
  const html = String(conteudo || '').replace(/<q>([\s\S]*?)<\/q>/g, (inteiro, dentro) => {
    const bruto = desfazerEntidades(semTags(dentro)).replace(/\s+/g, ' ').trim();
    if (!bruto) return '';
    citacoes++;
    const comNumero = bruto.match(/^\[\s*L?\s*(\d+)\s*\]\s*(.*)$/i);
    if (comNumero) {
      const achado = ancorar(Number(comNumero[1]), comNumero[2], linhas);
      if (achado) {
        return `<q class="confere">${escHtml(achado.texto)}</q> <span class="cit-minuto">${escHtml(rotulo(achado.linha))}</span>`;
      }
      naoEncontradas++;
      return `<q class="nao-confere">${escHtml(comNumero[2])}</q> ${selo}`;
    }
    const sem = semNumero(bruto);
    if (sem) return `<q class="confere">${dentro}</q> <span class="cit-minuto">${escHtml(sem.rotulo)}</span>`;
    naoEncontradas++;
    return `<q class="nao-confere">${dentro}</q> ${selo}`;
  });
  return { html, citacoes, naoEncontradas };
}
