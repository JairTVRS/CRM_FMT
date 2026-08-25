export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    const { id, nome, doc, phone } = await context.request.json();

    if (!nome) {
      return new Response(JSON.stringify({ error: 'Nome do lead é obrigatório.' }), {
        status: 400,
        headers
      });
    }

    const SYSTEM_PROMPT = `Você é um especialista em Inteligência de Vendas B2B e enriquecimento de dados de CRM.
Análise o lead fornecido e retorne ESTRITAMENTE um JSON válido no seguinte formato:
{
  "fontes": { "site_oficial": "https://...", "instagram": "https://..." },
  "classificacao": { "ramo": "SELECIONE_UM", "segmento": "SELECIONE_UM" },
  "resumo_descritivo": { "paragrafo_1": "...", "paragrafo_2": "...", "paragrafo_3": "..." }
}
RAMOS PERMITIDOS: AGRONEGÓCIO, ALIMENTOS, AUTOMOBILÍSTICO, CONSTRUÇÃO CIVIL, ECOMMERCE, HIGIENE, IMPORTADORA, LAZER, LOGÍSTICA, METALÚRGICA, MODA E VESTUÁRIO, MÓVEIS E DECORAÇÕES, ONG, PUBLICIDADE, SAUDE E ESTÉTICA, SEGURANÇA, TECNOLOGIA.
SEGMENTOS PERMITIDOS: INDÚSTRIA, ONG, SERVIÇOS, VAREJO.`;

    const openAiApiKey = context.env.OPENAI_API_KEY;

    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Lead: ${nome} | Doc: ${doc || 'N/A'} | Phone: ${phone || 'N/A'}` }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const aiDataRaw = await openAiResponse.json();
    const resultJson = JSON.parse(aiDataRaw.choices[0].message.content);

    return new Response(JSON.stringify({ success: true, data: resultJson }), {
      status: 200,
      headers
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Falha ao processar análise da IA.', details: error.message }), {
      status: 500,
      headers
    });
  }
}

// Trata requisições Preflight CORS (OPTIONS)
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}