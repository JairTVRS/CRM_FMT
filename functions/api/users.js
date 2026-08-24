export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const email = url.searchParams.get("email");

  // Altere para a URL real da sua API Formatar
  const API_URL = env.FORMATAR_API_URL || "https://api.formatar.com.br/v1/users";
  const SECRET_KEY = env.FORMATAR_SECRET_KEY || "SUA_SECRET_KEY_AQUI";

  if (!email) {
    return new Response(JSON.stringify({ error: "E-mail é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Chamada Server-to-Server para a sua API de Usuários
    const response = await fetch(`${API_URL}?fields=id,nid,name,email,isActive&search=${encodeURIComponent(email)}`, {
      headers: {
        "x-secret-key": SECRET_KEY,
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Erro de conexão com API Formatar" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}