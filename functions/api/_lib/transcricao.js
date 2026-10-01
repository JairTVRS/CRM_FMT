/**
 * _lib/transcricao.js — áudio em texto (2.35.0).
 *
 * Dois caminhos, nesta ordem:
 *
 *   1. WORKERS AI (binding `AI` do projeto no painel da Cloudflare): o
 *      Whisper da própria Cloudflare. Sem chave, sem cartão, com uma cota
 *      diária grátis — o caminho dos testes, decidido em 28/09/2026.
 *   2. OPENAI (`whisper-1`), se houver chave — do painel ou cadastrada no
 *      CRM (2.34.0).
 *
 * O áudio chega do navegador como WAV 16 kHz mono, JÁ em base64: o
 * servidor só repassa. Codificar aqui gastaria CPU da Function à toa.
 *
 * Nada de áudio é guardado. Só o texto que volta daqui.
 */

export const MODELO_WORKERS_AI = '@cf/openai/whisper-large-v3-turbo';

/**
 * Qual transcritor está disponível, sem chamar nenhum.
 * @param envIA  o env já com as chaves do CRM (`ambienteDeIA`)
 */
export function transcritorDisponivel(envIA) {
  if (envIA?.AI && typeof envIA.AI.run === 'function') return 'workers-ai';
  if (envIA?.OPENAI_API_KEY) return 'openai';
  return null;
}

/**
 * O Whisper, sem áudio de fala, costuma "ouvir" frases prontas de fim de
 * vídeo. O navegador já descarta os pedaços silenciosos; isto pega o que
 * escapar, para não virar fala do lead na transcrição.
 */
const ALUCINACOES = [
  /^\s*(obrigad[oa]( por assistir)?|legendas? (pela|por) .*|inscreva-se.*|tchau\.?)\s*[.!]?\s*$/i
];

/**
 * Letras que o português não usa. Com áudio ruim, o Whisper "ouve"
 * islandês ("Ég er það"), cirílico, japonês… — visto no teste de
 * 30/09/2026. Pedaço assim é ruído, não fala do lead.
 */
const OUTRA_LINGUA = /[ðþæøåßłđħ\u0370-\u03ff\u0400-\u04ff\u0590-\u06ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/i;

const palavras = (t) => String(t || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * A frase que orienta o Whisper (2.36.1). Antes era só o nome do lead, e
 * com pouca fala ele devolvia o nome repetido ("Jair da Silva Jair da
 * Silva", 29/09/2026). Uma frase em português também segura a língua:
 * o `language: 'pt'` sozinho não impediu o islandês.
 */
export function dicaDaReuniao(lead) {
  const nome = String(lead || '').trim().slice(0, 120);
  return `Reunião comercial da Formatar${nome ? ` com ${nome}` : ''}, em português do Brasil.`;
}

/**
 * @param texto  o que o transcritor devolveu
 * @param dica   a frase passada a ele: texto feito só das palavras dela é
 *               eco, não fala
 */
export function limparTexto(texto, dica = null) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (ALUCINACOES.some((r) => r.test(t))) return '';
  if (OUTRA_LINGUA.test(t)) return '';
  // A mesma palavra repetida ("Obrigado. Obrigado. Obrigado.", 30/09/2026):
  // o Whisper preenchendo quase-silêncio, não alguém falando.
  const todas = palavras(t);
  if (todas.length >= 3 && new Set(todas).size === 1) return '';
  if (dica) {
    const daDica = new Set(palavras(dica));
    const ditas = palavras(t);
    if (ditas.length && ditas.every((p) => daDica.has(p))) return '';
  }
  return t;
}

function base64ParaBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * @param envIA   env com as chaves do CRM
 * @param audio   WAV em base64 (sem o prefixo data:)
 * @param lead    o nome do lead, que entra na frase que orienta o Whisper
 * @returns { texto, transcritor }
 */
export async function transcrever(envIA, { audio, lead = null }) {
  const dica = dicaDaReuniao(lead);
  const qual = transcritorDisponivel(envIA);
  if (!qual) {
    const e = new Error('Nenhum transcritor disponível: ligue o Workers AI no painel da Cloudflare, ou cadastre uma chave da OpenAI nas Configurações.');
    e.codigo = 'SEM_TRANSCRITOR';
    throw e;
  }

  if (qual === 'workers-ai') {
    const r = await envIA.AI.run(MODELO_WORKERS_AI, {
      audio,
      task: 'transcribe',
      language: 'pt',
      vad_filter: true,
      initial_prompt: dica
    });
    return { texto: limparTexto(r?.text, dica), transcritor: qual };
  }

  const form = new FormData();
  form.append('file', new Blob([base64ParaBytes(audio)], { type: 'audio/wav' }), 'trecho.wav');
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  form.append('prompt', dica);

  const resposta = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${envIA.OPENAI_API_KEY}` },
    body: form
  });
  if (!resposta.ok) {
    const detalhe = (await resposta.text().catch(() => '')).slice(0, 200);
    throw new Error(`A OpenAI recusou a transcrição (${resposta.status}). ${detalhe}`);
  }
  const d = await resposta.json();
  return { texto: limparTexto(d?.text, dica), transcritor: qual };
}
