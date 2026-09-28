/**
 * _lib/chaves-ia.js — as chaves de IA cadastradas no CRM (2.34.0).
 *
 * Decidido em 28/09/2026: a chave de IA pode ser acrescentada no próprio
 * CRM, pelo admin, sem ir ao painel da Cloudflare. Três regras:
 *
 *   1. A chave do PAINEL (variável de ambiente) vale primeiro. A do CRM
 *      só preenche o que o painel não tem.
 *   2. No banco a chave fica CIFRADA (AES-GCM, com o segredo
 *      CHAVES_SECRET do ambiente). Sem esse segredo, o CRM não aceita
 *      guardar chave — guardar em claro seria pior que não guardar.
 *   3. A chave NUNCA volta ao navegador. A tela sabe só se existe, de onde
 *      vem e os 4 últimos caracteres.
 *
 * `ambienteDeIA(env)` devolve o `env` com as chaves do banco preenchidas
 * onde faltam — é o que os geradores (dossiê, dossiê de experiência,
 * enriquecimento) passam a usar, sem mudar o jeito de chamar a IA.
 */

import { PROVEDORES, chaveConfigurada } from './ia.js';

/** A variável de ambiente de cada provedor, como o `_lib/ia.js` já lê. */
export const VARIAVEL = {
  chatgpt: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY'
};

export const NOME_PROVEDOR = {
  chatgpt: 'OpenAI (ChatGPT)',
  deepseek: 'DeepSeek',
  claude: 'Anthropic (Claude)',
  gemini: 'Google (Gemini)'
};

/* ==========================================================================
   CIFRA
   ========================================================================== */

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const deB64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

async function chaveDeCifra(segredo) {
  const resumo = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(segredo)));
  return crypto.subtle.importKey('raw', resumo, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Texto → 'iv.cifra' em base64. Um IV novo a cada vez. */
export async function cifrar(texto, segredo) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifra = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await chaveDeCifra(segredo), new TextEncoder().encode(texto)
  );
  return `${b64(iv)}.${b64(new Uint8Array(cifra))}`;
}

/** O inverso. Segredo errado ou texto adulterado: lança (o GCM confere). */
export async function decifrar(guardado, segredo) {
  const [iv, cifra] = String(guardado).split('.');
  const claro = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: deB64(iv) }, await chaveDeCifra(segredo), deB64(cifra)
  );
  return new TextDecoder().decode(claro);
}

/* ==========================================================================
   LEITURA
   ========================================================================== */

async function lerLinhas(db) {
  try {
    const { results } = await db.prepare('SELECT provedor, cifrada, final FROM chaves_ia').all();
    return results || [];
  } catch (e) {
    return [];                    // sem a migração 019: só as do painel
  }
}

/**
 * O `env` com as chaves do CRM onde o painel não tem. Uma chave que não
 * decifra (o CHAVES_SECRET mudou) é ignorada — o provedor aparece como
 * não configurado, que é a verdade.
 */
export async function ambienteDeIA(env) {
  if (!env?.DB || !env.CHAVES_SECRET) return env;
  const linhas = await lerLinhas(env.DB);
  const completo = { ...env };
  for (const l of linhas) {
    const variavel = VARIAVEL[l.provedor];
    if (!variavel || env[variavel]) continue;
    try {
      completo[variavel] = await decifrar(l.cifrada, env.CHAVES_SECRET);
    } catch (e) {
      console.log(`[chaves-ia] a chave de ${l.provedor} não decifra: o CHAVES_SECRET mudou?`);
    }
  }
  return completo;
}

/**
 * O que a tela pode saber de cada provedor — nunca a chave.
 * `origem`: 'painel' | 'crm' | null.
 */
export async function situacaoDasChaves(env) {
  const linhas = env?.DB ? await lerLinhas(env.DB) : [];
  const doCrm = new Map(linhas.map((l) => [l.provedor, l]));
  const situacao = {};
  for (const p of PROVEDORES) {
    const noPainel = !!env?.[VARIAVEL[p]];
    const noCrm = doCrm.get(p);
    situacao[p] = {
      nome: NOME_PROVEDOR[p],
      configurado: noPainel || !!noCrm,
      origem: noPainel ? 'painel' : (noCrm ? 'crm' : null),
      final: !noPainel && noCrm ? noCrm.final : null,
      // Tem chave no CRM, mas a do painel é que vale.
      sombreada: noPainel && !!noCrm
    };
  }
  return situacao;
}

/**
 * O provedor que os geradores usam: o escolhido nas Configurações, se ele
 * tiver chave; senão o primeiro que tiver. Antes, cada navegador guardava
 * a sua escolha e o dossiê nem a lia — usava sempre DeepSeek.
 */
export async function provedorAtivo(envIA) {
  let escolhido = null;
  try {
    const r = await envIA?.DB?.prepare("SELECT valor FROM config_geral WHERE chave = 'provedor_ativo'").first();
    escolhido = r?.valor || null;
  } catch (e) { /* sem a 019 */ }

  if (escolhido && chaveConfigurada(escolhido, envIA)) return escolhido;
  return PROVEDORES.find((p) => chaveConfigurada(p, envIA)) || 'deepseek';
}

/** A escolha gravada, mesmo que hoje sem chave — para a tela mostrar. */
export async function provedorEscolhido(db) {
  try {
    const r = await db.prepare("SELECT valor FROM config_geral WHERE chave = 'provedor_ativo'").first();
    return r?.valor || null;
  } catch (e) {
    return null;
  }
}
