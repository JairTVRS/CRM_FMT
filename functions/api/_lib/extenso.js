/**
 * _lib/extenso.js — número e dinheiro por extenso (2.40.0).
 *
 * O contrato escreve o valor duas vezes, "R$ 8.800,00 (oito mil e
 * oitocentos reais)", como o modelo em uso. Escrever à mão era onde o
 * contrato de 2017 errava: o extenso ficava do modelo e o número mudava.
 */

const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
const ESCALAS = [null, ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];

/** 1 a 999. */
function ate999(n) {
  if (n === 100) return 'cem';
  const partes = [];
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 20) partes.push(UNIDADES[r]);
    else {
      const u = r % 10;
      partes.push(u ? `${DEZENAS[Math.floor(r / 10)]} e ${UNIDADES[u]}` : DEZENAS[Math.floor(r / 10)]);
    }
  }
  return partes.join(' e ');
}

/**
 * 0 a 999.999.999.999, inteiro.
 *
 * O "e" entre os grupos segue o uso: entra antes do último grupo quando
 * ele é redondo ou menor que cem ("mil e oitocentos", "dois mil e
 * quinze"); nos demais casos, vírgula ("vinte e cinco mil, quatrocentos
 * e vinte e quatro").
 */
export function numeroPorExtenso(numero) {
  let n = Math.floor(Math.abs(Number(numero) || 0));
  if (n === 0) return 'zero';

  const grupos = [];
  while (n > 0) { grupos.push(n % 1000); n = Math.floor(n / 1000); }

  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const v = grupos[i];
    if (!v) continue;
    let t;
    if (i === 1 && v === 1) t = 'mil';
    else {
      t = ate999(v);
      if (i > 0) t += ` ${v === 1 ? ESCALAS[i][0] : ESCALAS[i][1]}`;
    }
    partes.push({ t, v, i });
  }

  return partes.map((p, k) => {
    if (k === 0) return p.t;
    const ultimo = k === partes.length - 1;
    const comE = ultimo && (p.v < 100 || p.v % 100 === 0);
    return `${comE ? ' e ' : ', '}${p.t}`;
  }).join('');
}

/** 880000 (centavos) → "oito mil e oitocentos reais". */
export function moedaPorExtenso(centavos) {
  const total = Math.round(Math.abs(Number(centavos) || 0));
  const reais = Math.floor(total / 100);
  const cent = total % 100;

  const partes = [];
  if (reais > 0) {
    // "um milhão DE reais": a escala sem nada depois pede o "de".
    const de = reais >= 1_000_000 && reais % 1_000_000 === 0 ? ' de' : '';
    partes.push(`${numeroPorExtenso(reais)}${de} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cent > 0) partes.push(`${numeroPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partes.length ? partes.join(' e ') : 'zero real';
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-10-05" → "5 de outubro de 2026". Sem Date: evita o fuso. */
export function dataPorExtenso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}
