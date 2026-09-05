/**
 * _lib/saneamento.js — O filtro do que a IA escreve.
 *
 * Extraído do schema-dossie.js quando o Dossiê de Experiência (Lote L)
 * virou o segundo consumidor. Enquanto havia um só, morar lá dentro era
 * o certo; com dois, a terceira cópia destes quatro filtros seria só
 * dívida esperando divergir.
 *
 * O princípio, que vale para os dois dossiês: nada que veio de um modelo
 * chega ao documento sem passar por aqui. O conteúdo é renderizado dentro
 * de um iframe com sandbox, mas defesa em profundidade custa uma função.
 *
 * Todas as funções são tolerantes por desenho: devolvem `null` ou lista
 * vazia em vez de lançar. Um dossiê com quatro seções verdadeiras vale
 * mais que uma falha porque o modelo esqueceu um campo.
 */

const TAGS_PERMITIDAS = /<\/?(p|strong|em|b|i|ul|ol|li|br)\s*\/?>/gi;

/**
 * HTML do modelo, reduzido à lista branca de tags.
 * Fora da lista, a tag some e o texto interno permanece.
 */
export function limparHtml(valor, limite = 4000) {
  if (typeof valor !== 'string') return null;

  let t = valor
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/ on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');

  t = t.replace(/<[^>]+>/g, (tag) => {
    TAGS_PERMITIDAS.lastIndex = 0;
    return TAGS_PERMITIDAS.test(tag) ? tag : '';
  });

  t = t.trim();
  if (!t) return null;
  return t.length > limite ? `${t.slice(0, limite)}…` : t;
}

/** Texto puro: toda marcação some, inclusive a permitida. */
export function texto(valor, limite = 400) {
  if (typeof valor !== 'string') return null;
  const t = valor.replace(/<[^>]+>/g, '').trim();
  if (!t) return null;
  return t.length > limite ? `${t.slice(0, limite)}…` : t;
}

/** Só http e https. Qualquer outro protocolo vira null. */
export function url(valor) {
  if (typeof valor !== 'string') return null;
  try {
    const u = new URL(valor.trim());
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch (e) {
    return null;
  }
}

/**
 * Mapeia uma lista descartando o que o mapeador rejeitou, e aplica teto.
 * O teto não é enfeite: é o que impede um modelo prolixo de transformar
 * um resumo executivo em inventário.
 */
export function lista(valor, mapear, maximo) {
  if (!Array.isArray(valor)) return [];
  return valor.map(mapear).filter(Boolean).slice(0, maximo);
}
