/**
 * _lib/forma-preco.js — a forma de preço (Lote G, 2.40.0).
 *
 * Decidido com o Jair em 05/10/2026: a forma de preço é um cadastro (só
 * admin altera), escolhida no lead, e vale para o contrato E para as
 * propostas geradas daqui em diante — as já geradas ficam como foram.
 *
 * Cada forma é um texto — a cláusula de preço — com MARCADORES entre
 * chaves. Os valores saem da proposta: quem negocia preenche uma vez, na
 * proposta, e o contrato repete o que foi proposto. Uma linha em branco
 * separa os itens (A, B…).
 *
 * Marcador que a forma usa e a proposta não preencheu IMPEDE a geração,
 * com o nome do campo que falta. Um contrato com "{valor_mensal}"
 * impresso, ou com o valor em branco, não pode sair.
 */

import { moeda } from './documento-base.js';
import { moedaPorExtenso, numeroPorExtenso } from './extenso.js';

/**
 * Os marcadores que um texto pode usar. `de` lê o valor nos dados da
 * proposta (o mesmo formato de `normalizar` em proposta.js).
 */
export const MARCADORES = {
  valor_diagnostico:     { rotulo: 'Diagnóstico: valor',                  tipo: 'moeda',  de: (p) => p.diagnostico?.valor },
  condicoes_diagnostico: { rotulo: 'Diagnóstico: condições de pagamento', tipo: 'texto',  de: (p) => p.diagnostico?.condicoes },
  prazo_diagnostico:     { rotulo: 'Diagnóstico: prazo',                  tipo: 'texto',  de: (p) => p.diagnostico?.prazo },
  valor_mensal:          { rotulo: 'Consultoria: valor mensal',           tipo: 'moeda',  de: (p) => p.consultoria?.valor },
  meses:                 { rotulo: 'Consultoria: período (meses)',        tipo: 'numero', de: (p) => p.consultoria?.meses },
  inicio_consultoria:    { rotulo: 'Consultoria: início',                 tipo: 'texto',  de: (p) => p.consultoria?.inicio },
  condicoes_consultoria: { rotulo: 'Consultoria: condições de pagamento', tipo: 'texto',  de: (p) => p.consultoria?.condicoes },
  valor_projeto:         { rotulo: 'Projeto: valor total',                tipo: 'moeda',  de: (p) => p.projeto?.valor },
  parcelas:              { rotulo: 'Projeto: número de parcelas',         tipo: 'numero', de: (p) => p.projeto?.parcelas },
  valor_hora:            { rotulo: 'Valor da hora',                       tipo: 'moeda',  de: (p) => p.hora?.valor }
};

/**
 * As formas sugeridas em 05/10/2026. São as mesmas que a migração 027
 * grava — a prova contrato.mjs confere que não divergem.
 */
const CONSULTORIA = 'O investimento mensal para a realização do trabalho previsto é de {valor_mensal}, a ser pago durante {meses} meses, com início {inicio_consultoria} ({condicoes_consultoria}), por meio de boletos bancários de emissão da CONTRATADA.';
const DIAGNOSTICO = 'O investimento para a realização do diagnóstico é de {valor_diagnostico}, pago da seguinte forma: {condicoes_diagnostico}, por meio de notas fiscais e boletos bancários de emissão da CONTRATADA';

export const FORMAS_SUGERIDAS = [
  { nome: 'Diagnóstico + consultoria mensal', texto: `A) Diagnóstico – ${DIAGNOSTICO};\n\nB) Consultoria – ${CONSULTORIA}` },
  { nome: 'Diagnóstico isento + consultoria mensal', texto: `A) Diagnóstico – Isento de cobrança.\n\nB) Consultoria – ${CONSULTORIA}` },
  { nome: 'Só diagnóstico', texto: `A) Diagnóstico – ${DIAGNOSTICO}.` },
  { nome: 'Só consultoria mensal', texto: `A) Consultoria – ${CONSULTORIA}` },
  { nome: 'Projeto em parcelas', texto: 'A) Projeto – O investimento para a realização dos trabalhos descritos na Cláusula I é de {valor_projeto}, pago em {parcelas} parcelas mensais e sucessivas, por meio de notas fiscais e boletos bancários de emissão da CONTRATADA.' },
  { nome: 'Valor por hora', texto: 'A) Horas – Os trabalhos serão remunerados a {valor_hora} por hora trabalhada, assim considerado o tempo definido na Cláusula V, alínea c, apurados mensalmente e pagos por meio de notas fiscais e boletos bancários de emissão da CONTRATADA.' }
];

const PADRAO_MARCADOR = /\{([a-z_]+)\}/g;

/** As chaves entre chaves que o texto usa, sem repetição. */
export function marcadoresUsados(texto) {
  return [...new Set([...String(texto || '').matchAll(PADRAO_MARCADOR)].map((m) => m[1]))];
}

/** As que não existem — o cadastro recusa: sairiam impressas no contrato. */
export function marcadoresDesconhecidos(texto) {
  return marcadoresUsados(texto).filter((k) => !Object.hasOwn(MARCADORES, k));
}

/** "24" → 24; aceita "24 meses". Zero ou lixo → null. */
function inteiro(v) {
  const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Texto livre no meio da frase: "Após a apresentação" vira "após a
 * apresentação". Sigla ("PIX na assinatura") fica como está. O ponto
 * final sai — quem fecha a frase é a cláusula.
 */
function noMeioDaFrase(t) {
  const s = String(t).trim().replace(/[.;]+$/, '');
  return /^[A-ZÀ-Ú][a-zà-ú]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/** O valor de um marcador como sai no documento, ou null se falta. */
export function valorDoMarcador(chave, proposta) {
  const m = MARCADORES[chave];
  if (!m) return null;
  const bruto = m.de(proposta || {});
  if (bruto == null || bruto === '') return null;

  if (m.tipo === 'moeda') {
    const c = Number(bruto);
    return c > 0 ? `${moeda(c)} (${moedaPorExtenso(c)})` : null;
  }
  if (m.tipo === 'numero') {
    const n = inteiro(bruto);
    return n ? `${n} (${numeroPorExtenso(n)})` : null;
  }
  return noMeioDaFrase(bruto) || null;
}

/**
 * Preenche o texto da forma com os valores da proposta.
 *
 * @returns {{ paragrafos: string[], faltando: string[] }}
 *   `paragrafos`: texto puro, um por item (a linha em branco separa);
 *   quem escapa é o template. `faltando`: os rótulos dos campos da
 *   proposta que a forma usa e estão vazios.
 */
export function preencherForma(texto, proposta) {
  const faltando = [];
  for (const k of marcadoresUsados(texto)) {
    if (!MARCADORES[k]) faltando.push(`marcador desconhecido {${k}}`);
    else if (valorDoMarcador(k, proposta) == null) faltando.push(MARCADORES[k].rotulo);
  }

  const preenchido = String(texto || '').replace(PADRAO_MARCADOR, (todo, k) => valorDoMarcador(k, proposta) ?? todo);
  const paragrafos = preenchido.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return { paragrafos, faltando };
}

/** Para a tela das Configurações: a lista de marcadores com o que é cada um. */
export function listaDeMarcadores() {
  return Object.entries(MARCADORES).map(([chave, m]) => ({ chave, rotulo: m.rotulo }));
}
