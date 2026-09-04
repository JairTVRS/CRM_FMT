/**
 * Middleware de autenticação — protege TODAS as rotas sob /api/*
 *
 * Fluxo por requisição:
 *   1. CORS restrito às origens conhecidas (nada de "*").
 *   2. Valida o ID token do Google (assinatura RS256, aud, iss, exp, email).
 *   3. Consulta o hub da Formatar: o e-mail existe e está com isActive=true?
 *   4. Só então entrega a requisição ao endpoint, com o usuário em context.data.
 *
 * Rotas públicas (sem token): OPTIONS (preflight) e GET /api/config.
 *
 * Variáveis de ambiente necessárias (Cloudflare Pages > Settings > Environment variables):
 *   GOOGLE_CLIENT_ID  - ID do cliente OAuth (público, mas fica em env por conveniência)
 *   HUB_API_KEY       - Secret Key do hub com permissão hub:users:read  [SECRET]
 */

const ORIGENS_PERMITIDAS = [
  "https://crm-fmt.pages.dev",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

const HUB_USERS_URL = "https://hub.formatar.com.br/v1/users";

/**
 * De onde perguntar se o usuário está ativo.
 *
 * Sempre o hub de verdade, exceto quando `HUB_USERS_URL` estiver no
 * ambiente — o que só acontece no desenvolvimento local, via `.dev.vars`
 * (arquivo que não vai para o Git). Em produção a variável não existe e
 * o padrão vale, então o comportamento publicado é idêntico ao de antes.
 *
 * A razão da costura: a chave do hub é cadastrada como Secret na
 * Cloudflare e segredo lá é de mão única — não há como recuperá-la para
 * usar na máquina do desenvolvedor, e o hub não emite chave por
 * autoatendimento. Sem isto, nenhuma rota protegida sobe local.
 *
 * O QUE ISTO **NÃO** AFROUXA: o token do Google continua validado
 * integralmente — assinatura RS256 contra o JWKS, `aud`, `iss`, `exp` e
 * e-mail verificado. Só o "este e-mail está ativo no ERP?" muda de
 * endereço. Quem conseguisse escrever variável de ambiente em produção
 * já controlaria o deploy inteiro de qualquer forma.
 */
const enderecoDoHub = (env) => env.HUB_USERS_URL || HUB_USERS_URL;
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// Rotas liberadas sem autenticação
const ROTAS_PUBLICAS = ["/api/config"];

// Caches em memória do isolate. Não são compartilhados entre instâncias,
// mas cortam a esmagadora maioria das chamadas repetidas.
let jwksCache = { chaves: null, expiraEm: 0 };
const usuarioCache = new Map(); // email -> { usuario, expiraEm }

const TTL_JWKS_MS = 60 * 60 * 1000;      // 1 hora
const TTL_USUARIO_MS = 5 * 60 * 1000;    // 5 minutos

/* ==========================================================================
   CORS
   ========================================================================== */

function montarCabecalhos(request) {
  const origem = request.headers.get("Origin");
  const permitida = ORIGENS_PERMITIDAS.includes(origem) ? origem : ORIGENS_PERMITIDAS[0];

  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": permitida,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function erro(mensagem, status, cabecalhos, codigo) {
  return new Response(
    JSON.stringify({ error: mensagem, code: codigo || null }),
    { status, headers: cabecalhos }
  );
}

/* ==========================================================================
   VALIDAÇÃO DO ID TOKEN DO GOOGLE
   ========================================================================== */

function base64UrlParaBytes(texto) {
  const base64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  const preenchido = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(preenchido);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function base64UrlParaJson(texto) {
  return JSON.parse(new TextDecoder().decode(base64UrlParaBytes(texto)));
}

async function obterChavesGoogle() {
  const agora = Date.now();
  if (jwksCache.chaves && jwksCache.expiraEm > agora) return jwksCache.chaves;

  const resposta = await fetch(GOOGLE_JWKS_URL);
  if (!resposta.ok) throw new Error("Falha ao obter chaves públicas do Google.");

  const { keys } = await resposta.json();
  jwksCache = { chaves: keys, expiraEm: agora + TTL_JWKS_MS };
  return keys;
}

/**
 * Valida o ID token e devolve o payload. Lança erro se inválido.
 */
async function validarTokenGoogle(token, clientId) {
  const partes = token.split(".");
  if (partes.length !== 3) throw new Error("Token malformado.");

  const [cabecalhoB64, payloadB64, assinaturaB64] = partes;
  const cabecalho = base64UrlParaJson(cabecalhoB64);
  const payload = base64UrlParaJson(payloadB64);

  if (cabecalho.alg !== "RS256") throw new Error("Algoritmo de assinatura inesperado.");

  // --- Assinatura ---
  const chaves = await obterChavesGoogle();
  const jwk = chaves.find((k) => k.kid === cabecalho.kid);
  if (!jwk) throw new Error("Chave de assinatura não reconhecida.");

  const chaveCripto = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const assinaturaValida = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    chaveCripto,
    base64UrlParaBytes(assinaturaB64),
    new TextEncoder().encode(`${cabecalhoB64}.${payloadB64}`)
  );

  if (!assinaturaValida) throw new Error("Assinatura do token inválida.");

  // --- Claims ---
  const agoraSeg = Math.floor(Date.now() / 1000);

  if (!GOOGLE_ISSUERS.includes(payload.iss)) throw new Error("Emissor do token inválido.");
  if (payload.aud !== clientId) throw new Error("Token emitido para outra aplicação.");
  if (!payload.exp || payload.exp <= agoraSeg) throw new Error("Token expirado.");
  if (payload.nbf && payload.nbf > agoraSeg + 60) throw new Error("Token ainda não válido.");
  if (!payload.email) throw new Error("Token sem e-mail.");
  if (payload.email_verified === false) throw new Error("E-mail não verificado no Google.");

  return payload;
}

/* ==========================================================================
   AUTORIZAÇÃO NO HUB DA FORMATAR
   ========================================================================== */

/**
 * Verifica no hub se o e-mail existe e está ativo.
 * A API do hub é server-to-server: só pode ser chamada daqui, nunca do navegador.
 */
async function buscarUsuarioNoHub(email, apiKey, base = HUB_USERS_URL) {
  const agora = Date.now();
  const emCache = usuarioCache.get(email);
  if (emCache && emCache.expiraEm > agora) return emCache.usuario;

  const url = `${base}?fields=id,name,email,isActive&search=${encodeURIComponent(email)}`;

  const resposta = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json"
    }
  });

  if (resposta.status === 401 || resposta.status === 403) {
    throw new Error("HUB_CREDENCIAL");
  }
  if (resposta.status === 429) {
    throw new Error("HUB_LIMITE");
  }
  if (!resposta.ok) {
    throw new Error("HUB_INDISPONIVEL");
  }

  const corpo = await resposta.json();
  const lista = Array.isArray(corpo?.data) ? corpo.data : [];

  // "search" é busca textual: exigir correspondência exata do e-mail.
  const usuario = lista.find(
    (u) => (u.email || "").toLowerCase() === email.toLowerCase()
  ) || null;

  usuarioCache.set(email, { usuario, expiraEm: agora + TTL_USUARIO_MS });
  return usuario;
}

/* ==========================================================================
   MIDDLEWARE
   ========================================================================== */

export async function onRequest(context) {
  const { request, env, next } = context;
  const cabecalhos = montarCabecalhos(request);
  const caminho = new URL(request.url).pathname;

  // 1. Preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhos });
  }

  // 2. Rotas públicas
  if (ROTAS_PUBLICAS.includes(caminho)) {
    context.data.cabecalhos = cabecalhos;
    return next();
  }

  // 3. Configuração do servidor
  if (!env.GOOGLE_CLIENT_ID) {
    return erro("Servidor sem GOOGLE_CLIENT_ID configurado.", 500, cabecalhos, "CONFIG_AUSENTE");
  }
  if (!env.HUB_API_KEY) {
    return erro("Servidor sem HUB_API_KEY configurada.", 500, cabecalhos, "CONFIG_AUSENTE");
  }

  // 4. Token presente?
  const autorizacao = request.headers.get("Authorization") || "";
  if (!autorizacao.startsWith("Bearer ")) {
    return erro("Autenticação necessária.", 401, cabecalhos, "TOKEN_AUSENTE");
  }
  const token = autorizacao.slice(7).trim();

  // 5. Token válido?
  let payload;
  try {
    payload = await validarTokenGoogle(token, env.GOOGLE_CLIENT_ID);
  } catch (e) {
    return erro(`Sessão inválida: ${e.message}`, 401, cabecalhos, "TOKEN_INVALIDO");
  }

  // 6. Usuário cadastrado e ativo no hub?
  let usuario;
  try {
    usuario = await buscarUsuarioNoHub(payload.email, env.HUB_API_KEY, enderecoDoHub(env));
  } catch (e) {
    if (e.message === "HUB_CREDENCIAL") {
      return erro("Servidor sem credencial válida no hub.", 500, cabecalhos, "HUB_CREDENCIAL");
    }
    if (e.message === "HUB_LIMITE") {
      return erro("Muitas requisições. Tente novamente em instantes.", 429, cabecalhos, "HUB_LIMITE");
    }
    return erro("Não foi possível validar o acesso agora.", 503, cabecalhos, "HUB_INDISPONIVEL");
  }

  if (!usuario) {
    return erro(
      `O e-mail ${payload.email} não possui cadastro no CRM. Solicite acesso ao administrador.`,
      403, cabecalhos, "SEM_CADASTRO"
    );
  }
  if (usuario.isActive !== true) {
    return erro("Seu acesso está inativo. Procure o administrador.", 403, cabecalhos, "INATIVO");
  }

  // 7. Liberado — repassa o usuário adiante
  context.data.usuario = {
    id: usuario.id,
    nome: usuario.name || payload.name || payload.email,
    email: usuario.email,
    foto: payload.picture || null
  };
  context.data.cabecalhos = cabecalhos;

  return next();
}
