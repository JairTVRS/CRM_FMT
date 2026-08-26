/**
 * Backend Cloudflare Pages Function: /api/enrich-lead
 * Gerencia múltiplos provedores de IA e checagem de status das chaves.
 */

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

// 1. CHECAGEM DE STATUS DAS CHAVES (GET)
export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  if (url.searchParams.get('checkStatus') === 'true') {
    const statusObj = {
      chatgpt: !!context.env.OPENAI_API_KEY,
      deepseek: !!context.env.DEEPSEEK_API_KEY,
      claude: !!context.env.ANTHROPIC_API_KEY,
      gemini: !!context.env.GEMINI_API_KEY
    };

    return new Response(JSON.stringify({ providers: statusObj }), {
      status: 200,
      headers: HEADERS
    });
  }

  return new Response(JSON.stringify({ error: "Parâmetro inválido." }), { status: 400, headers: HEADERS });
}

// 2. PROCESSAMENTO DO ENRIQUECIMENTO DE LEAD (POST)
export async function onRequestPost(context) {
  try {
    const { nome, doc, documento, phone, provider = 'deepseek' } = await context.request.json();
    const docFinal = doc || documento || 'N/A';

    if (!nome) {
      return new Response(JSON.stringify({ error: 'Nome do lead é obrigatório.' }), {
        status: 400,
        headers: HEADERS
      });
    }

    const SYSTEM_PROMPT = `Você é um especialista em Inteligência de Vendas B2B e enriquecimento de dados de CRM.
Analise o lead fornecido e retorne ESTRITAMENTE um JSON válido no seguinte formato (sem marcações markdown adicionais):
{
  "site": "https://...",
  "instagram": "https://...",
  "ramo": "SELECIONE_UM",
  "segmento": "SELECIONE_UM",
  "resumoHtml": "<p><strong>Visão Geral:</strong> ...</p><p><strong>Mercado & Atuação:</strong> ...</p><p><strong>Recomendação Comercial:</strong> ...</p>"
}

RAMOS PERMITIDOS: AGRONEGÓCIO, ALIMENTOS, AUTOMOBILÍSTICO, CONSTRUÇÃO CIVIL, ECOMMERCE, HIGIENE, IMPORTADORA, LAZER, LOGÍSTICA, METALÚRGICA, MODA E VESTUÁRIO, MÓVEIS E DECORAÇÕES, ONG, PUBLICIDADE, SAUDE E ESTÉTICA, SEGURANÇA, TECNOLOGIA.
SEGMENTOS PERMITIDOS: INDÚSTRIA, ONG, SERVIÇOS, VAREJO.`;

    const userPrompt = `Lead: ${nome} | Doc: ${docFinal} | Phone: ${phone || 'N/A'}`;
    let rawContent = '';

    // Roteamento conforme a escolha de IA nas Configurações
    switch (provider) {
      case 'chatgpt':
        rawContent = await callChatGPT(SYSTEM_PROMPT, userPrompt, context.env.OPENAI_API_KEY);
        break;
      case 'claude':
        rawContent = await callClaude(SYSTEM_PROMPT, userPrompt, context.env.ANTHROPIC_API_KEY);
        break;
      case 'gemini':
        rawContent = await callGemini(SYSTEM_PROMPT, userPrompt, context.env.GEMINI_API_KEY);
        break;
      case 'deepseek':
      default:
        rawContent = await callDeepSeek(SYSTEM_PROMPT, userPrompt, context.env.DEEPSEEK_API_KEY);
        break;
    }

    // Limpeza defensiva de blocos de código ```json ... ```
    const cleanJsonText = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
    const resultJson = JSON.parse(cleanJsonText);

    return new Response(JSON.stringify(resultJson), { status: 200, headers: HEADERS });

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Falha ao processar análise da IA.',
      details: error.message
    }), { status: 500, headers: HEADERS });
  }
}

// 3. REQUISIÇÕES PREFLIGHT CORS (OPTIONS)
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}

/* ==========================================================================
   FUNÇÕES INTEGRADORAS DE APIS EXTERNAS
   ========================================================================== */

async function callDeepSeek(systemPrompt, userPrompt, apiKey) {
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY não configurada no servidor.');

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Erro na API DeepSeek');
  return data.choices[0].message.content;
}

async function callChatGPT(systemPrompt, userPrompt, apiKey) {
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada no servidor.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Erro na API OpenAI');
  return data.choices[0].message.content;
}

async function callClaude(systemPrompt, userPrompt, apiKey) {
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
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Erro na API Claude');
  return data.content[0].text;
}

async function callGemini(systemPrompt, userPrompt, apiKey) {
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada no servidor.');

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }]
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Erro na API Gemini');
  return data.candidates[0].content.parts[0].text;
}