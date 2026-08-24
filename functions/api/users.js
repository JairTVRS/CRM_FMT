export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const email = searchParams.get("email");

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    // Substitua pela URL exata da sua API de usuários se for diferente:
    const baseUrl = "https://hub.formatar.com.br/api/users"; 
    const url = email ? `${baseUrl}?email=${encodeURIComponent(email)}` : baseUrl;

    const response = await fetch(url);
    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Erro ao conectar na API", details: err.message }), {
      status: 500,
      headers
    });
  }
}