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

export function limparTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (ALUCINACOES.some((r) => r.test(t))) return '';
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
 * @param dica    texto curto que ajuda o reconhecimento (nome do lead)
 * @returns { texto, transcritor }
 */
export async function transcrever(envIA, { audio, dica = null }) {
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
      ...(dica ? { initial_prompt: String(dica).slice(0, 200) } : {})
    });
    return { texto: limparTexto(r?.text), transcritor: qual };
  }

  const form = new FormData();
  form.append('file', new Blob([base64ParaBytes(audio)], { type: 'audio/wav' }), 'trecho.wav');
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  if (dica) form.append('prompt', String(dica).slice(0, 200));

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
  return { texto: limparTexto(d?.text), transcritor: qual };
}
