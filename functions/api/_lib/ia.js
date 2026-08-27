/**
 * _lib/ia.js — Roteamento entre provedores de IA.
 *
 * Extraído do enrich-lead.js para ser reaproveitado pelo dossiê.
 * Todos os provedores recebem a mesma entrada e devolvem texto bruto;
 * quem chama decide o que fazer com ele.
 *
 * O dossiê pede respostas bem maiores que o enriquecimento, por isso
 * `maxTokens` é parâmetro e não constante.
 */

export const PROVEDORES = ['deepseek', 'chatgpt', 'claude', 'gemini'];

export function chaveConfigurada(provider, env) {
  switch (provider) {
    case 'chatgpt': return !!env.OPENAI_API_KEY;
    case 'claude': return !!env.ANTHROPIC_API_KEY;
    case 'gemini': return !!env.GEMINI_API_KEY;
    case 'deepseek': return !!env.DEEPSEEK_API_KEY;
    default: return false;
  }
}

export function statusProvedores(env) {
  return {
    chatgpt: !!env.OPENAI_API_KEY,
    deepseek: !!env.DEEPSEEK_API_KEY,
    claude: !!env.ANTHROPIC_API_KEY,
    gemini: !!env.GEMINI_API_KEY
  };
}

/**
 * Chama o provedor escolhido.
 *
 * @param {object} p  { provider, systemPrompt, userPrompt, env, maxTokens, jsonMode }
 * @returns {Promise<string>} texto bruto da resposta
 * @throws  se a chave não estiver configurada ou a API recusar
 */
export async function chamarIA({ provider, systemPrompt, userPrompt, env, maxTokens = 1000, jsonMode = true }) {
  const escolhido = PROVEDORES.includes(provider) ? provider : 'deepseek';

  switch (escolhido) {
    case 'chatgpt': return callChatGPT(systemPrompt, userPrompt, env.OPENAI_API_KEY, maxTokens, jsonMode);
    case 'claude': return callClaude(systemPrompt, userPrompt, env.ANTHROPIC_API_KEY, maxTokens);
    case 'gemini': return callGemini(systemPrompt, userPrompt, env.GEMINI_API_KEY, maxTokens, jsonMode);
    default: return callDeepSeek(systemPrompt, userPrompt, env.DEEPSEEK_API_KEY, maxTokens, jsonMode);
  }
}

/**
 * Extrai JSON de uma resposta que pode vir embrulhada em ```json ... ```
 * ou acompanhada de texto antes e depois.
 */
export function extrairJson(bruto) {
  if (typeof bruto !== 'string') return null;

  let t = bruto.replace(/```json/gi, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(t);
  } catch (e) {
    // Recorta do primeiro { até o último } — cobre preâmbulo do modelo
    const inicio = t.indexOf('{');
    const fim = t.lastIndexOf('}');
    if (inicio === -1 || fim <= inicio) return null;
    try {
      return JSON.parse(t.slice(inicio, fim + 1));
    } catch (e2) {
      return null;
    }
  }
}

/* ==========================================================================
   INTEGRAÇÕES
   ========================================================================== */

async function callDeepSeek(systemPrompt, userPrompt, apiKey, maxTokens, jsonMode) {
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY não configurada no servidor.');

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `DeepSeek: HTTP ${res.status}`);
  return data.choices[0].message.content;
}

async function callChatGPT(systemPrompt, userPrompt, apiKey, maxTokens, jsonMode) {
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada no servidor.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `OpenAI: HTTP ${res.status}`);
  return data.choices[0].message.content;
}

async function callClaude(systemPrompt, userPrompt, apiKey, maxTokens) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no servidor.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Claude: HTTP ${res.status}`);
  return data.content[0].text;
}

async function callGemini(systemPrompt, userPrompt, apiKey, maxTokens, jsonMode) {
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada no servidor.');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(jsonMode ? { responseMimeType: 'application/json' } : {})
        }
      })
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini: HTTP ${res.status}`);
  return data.candidates[0].content.parts[0].text;
}
