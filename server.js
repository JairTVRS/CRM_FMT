/**
 * Servidor local de desenvolvimento — CRM Formatar
 *
 * Reescrito para espelhar o comportamento do Cloudflare Pages:
 *   - mesma autenticação (ID token do Google + cadastro ativo no hub);
 *   - mesmo roteamento entre provedores de IA (antes ignorava a escolha
 *     e chamava sempre a OpenAI);
 *   - mesmo formato de resposta do enriquecimento (antes devolvia
 *     { success, data } aninhado, incompatível com o frontend);
 *   - caminhos de ramos.json/segmentos.json corrigidos para ./data.
 *
 * Requer Node 18+ (usa fetch e webcrypto nativos). Testado no Node 22.
 *
 * .env necessário: GOOGLE_CLIENT_ID, HUB_API_KEY e ao menos uma chave de IA.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const ORIGENS_PERMITIDAS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`
];

app.use(cors({ origin: ORIGENS_PERMITIDAS }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ==========================================================================
   PERSISTÊNCIA EM ARQUIVO
   ========================================================================== */

const DB_LEADS = path.join(__dirname, 'leads.json');
const DB_RAMOS = path.join(__dirname, 'data', 'ramos.json');
const DB_SEGMENTOS = path.join(__dirname, 'data', 'segmentos.json');

const readJson = (filePath, fallback) => {
  try {
    return fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''))
      : fallback;
  } catch (err) {
    console.error(`Erro ao ler o arquivo ${filePath}:`, err.message);
    return fallback;
  }
};

const writeJson = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Erro ao escrever no arquivo ${filePath}:`, err.message);
  }
};

/* ==========================================================================
   AUTENTICAÇÃO — espelha functions/api/_middleware.js
   ========================================================================== */

const HUB_USERS_URL = 'https://hub.formatar.com.br/v1/users';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

let jwksCache = { chaves: null, expiraEm: 0 };
const usuarioCache = new Map();

const TTL_JWKS_MS = 60 * 60 * 1000;
const TTL_USUARIO_MS = 5 * 60 * 1000;

function base64UrlParaBytes(texto) {
  return Buffer.from(texto.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function base64UrlParaJson(texto) {
  return JSON.parse(base64UrlParaBytes(texto).toString('utf-8'));
}

async function obterChavesGoogle() {
  const agora = Date.now();
  if (jwksCache.chaves && jwksCache.expiraEm > agora) return jwksCache.chaves;

  const resposta = await fetch(GOOGLE_JWKS_URL);
  if (!resposta.ok) throw new Error('Falha ao obter chaves públicas do Google.');

  const { keys } = await resposta.json();
  jwksCache = { chaves: keys, expiraEm: agora + TTL_JWKS_MS };
  return keys;
}

async function validarTokenGoogle(token, clientId) {
  const partes = token.split('.');
  if (partes.length !== 3) throw new Error('Token malformado.');

  const [cabecalhoB64, payloadB64, assinaturaB64] = partes;
  const cabecalho = base64UrlParaJson(cabecalhoB64);
  const payload = base64UrlParaJson(payloadB64);

  if (cabecalho.alg !== 'RS256') throw new Error('Algoritmo de assinatura inesperado.');

  const chaves = await obterChavesGoogle();
  const jwk = chaves.find((k) => k.kid === cabecalho.kid);
  if (!jwk) throw new Error('Chave de assinatura não reconhecida.');

  const chaveCripto = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );

  const valida = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    chaveCripto,
    base64UrlParaBytes(assinaturaB64),
    Buffer.from(`${cabecalhoB64}.${payloadB64}`, 'utf-8')
  );

  if (!valida) throw new Error('Assinatura do token inválida.');

  const agoraSeg = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.includes(payload.iss)) throw new Error('Emissor do token inválido.');
  if (payload.aud !== clientId) throw new Error('Token emitido para outra aplicação.');
  if (!payload.exp || payload.exp <= agoraSeg) throw new Error('Token expirado.');
  if (!payload.email) throw new Error('Token sem e-mail.');
  if (payload.email_verified === false) throw new Error('E-mail não verificado no Google.');

  return payload;
}

async function buscarUsuarioNoHub(email, apiKey) {
  const agora = Date.now();
  const emCache = usuarioCache.get(email);
  if (emCache && emCache.expiraEm > agora) return emCache.usuario;

  const url = `${HUB_USERS_URL}?fields=id,name,email,isActive&search=${encodeURIComponent(email)}`;
  const resposta = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  });

  if (resposta.status === 401 || resposta.status === 403) throw new Error('HUB_CREDENCIAL');
  if (resposta.status === 429) throw new Error('HUB_LIMITE');
  if (!resposta.ok) throw new Error('HUB_INDISPONIVEL');

  const corpo = await resposta.json();
  const lista = Array.isArray(corpo?.data) ? corpo.data : [];
  const usuario = lista.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;

  usuarioCache.set(email, { usuario, expiraEm: agora + TTL_USUARIO_MS });
  return usuario;
}

async function exigirAutenticacao(req, res, next) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Servidor sem GOOGLE_CLIENT_ID configurado.', code: 'CONFIG_AUSENTE' });
  }
  if (!process.env.HUB_API_KEY) {
    return res.status(500).json({ error: 'Servidor sem HUB_API_KEY configurada.', code: 'CONFIG_AUSENTE' });
  }

  const autorizacao = req.headers.authorization || '';
  if (!autorizacao.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Autenticação necessária.', code: 'TOKEN_AUSENTE' });
  }

  let payload;
  try {
    payload = await validarTokenGoogle(autorizacao.slice(7).trim(), process.env.GOOGLE_CLIENT_ID);
  } catch (e) {
    return res.status(401).json({ error: `Sessão inválida: ${e.message}`, code: 'TOKEN_INVALIDO' });
  }

  let usuario;
  try {
    usuario = await buscarUsuarioNoHub(payload.email, process.env.HUB_API_KEY);
  } catch (e) {
    if (e.message === 'HUB_CREDENCIAL') {
      return res.status(500).json({ error: 'Servidor sem credencial válida no hub.', code: 'HUB_CREDENCIAL' });
    }
    if (e.message === 'HUB_LIMITE') {
      return res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.', code: 'HUB_LIMITE' });
    }
    return res.status(503).json({ error: 'Não foi possível validar o acesso agora.', code: 'HUB_INDISPONIVEL' });
  }

  if (!usuario) {
    return res.status(403).json({
      error: `O e-mail ${payload.email} não possui cadastro no CRM. Solicite acesso ao administrador.`,
      code: 'SEM_CADASTRO'
    });
  }
  if (usuario.isActive !== true) {
    return res.status(403).json({ error: 'Seu acesso está inativo. Procure o administrador.', code: 'INATIVO' });
  }

  req.usuario = {
    id: usuario.id,
    nome: usuario.name || payload.name || payload.email,
    email: usuario.email,
    foto: payload.picture || null
  };
  next();
}

/* ==========================================================================
   PROMPT DA IA — idêntico ao da Cloudflare Function
   ========================================================================== */

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

/* ==========================================================================
   ROTAS PÚBLICAS
   ========================================================================== */

// Configuração inicial do frontend. Devolve também ramos/segmentos por
// compatibilidade com a versão anterior desta rota.
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    ramos: readJson(DB_RAMOS, []),
    segmentos: readJson(DB_SEGMENTOS, [])
  });
});

/* ==========================================================================
   ROTAS PROTEGIDAS
   ========================================================================== */

app.get('/api/me', exigirAutenticacao, (req, res) => {
  res.json({ usuario: req.usuario });
});

// --- Leads (persistência em leads.json) ---

app.get('/api/leads', exigirAutenticacao, (req, res) => {
  res.json(readJson(DB_LEADS, []));
});

app.post('/api/leads', exigirAutenticacao, (req, res) => {
  const leads = readJson(DB_LEADS, []);
  const { nome, documento, whatsapp, origem, mensagemInicial, usarIA, dadosManuais } = req.body;

  const duplicado = leads.find(
    (l) => (documento && l.documento === documento) || (whatsapp && l.whatsapp === whatsapp)
  );
  if (duplicado) {
    return res.status(409).json({
      duplicado: true,
      mensagem: 'Já existe um lead cadastrado com este documento ou WhatsApp.',
      leadExistente: duplicado
    });
  }

  const novoLead = {
    id: Date.now(),
    nome,
    documento,
    whatsapp,
    origem,
    mensagemInicial,
    usarIA,
    statusWhatsApp: usarIA ? 'ENVIADO_AUTOMATICO' : 'PENDENTE',
    dadosQualificacao: usarIA ? null : dadosManuais,
    criadoPor: req.usuario.email,
    criadoEm: new Date().toLocaleString('pt-BR')
  };

  leads.unshift(novoLead);
  writeJson(DB_LEADS, leads);
  res.status(201).json(novoLead);
});

app.put('/api/leads/:id', exigirAutenticacao, (req, res) => {
  const leads = readJson(DB_LEADS, []);
  const index = leads.findIndex((l) => l.id === Number(req.params.id));
  if (index === -1) return res.status(404).json({ mensagem: 'Lead não encontrado.' });

  const { nome, documento, whatsapp, origem, mensagemInicial, usarIA, dadosManuais, enriquecimentoIA } = req.body;

  leads[index] = {
    ...leads[index],
    nome,
    documento,
    whatsapp,
    origem,
    mensagemInicial,
    usarIA,
    dadosQualificacao: usarIA ? null : dadosManuais,
    enriquecimentoIA: enriquecimentoIA || leads[index].enriquecimentoIA,
    atualizadoPor: req.usuario.email
  };

  writeJson(DB_LEADS, leads);
  res.json(leads[index]);
});

app.delete('/api/leads/:id', exigirAutenticacao, (req, res) => {
  const leads = readJson(DB_LEADS, []).filter((l) => l.id !== Number(req.params.id));
  writeJson(DB_LEADS, leads);
  res.json({ success: true, mensagem: 'Lead excluído com sucesso.' });
});

// --- Enriquecimento por IA ---

app.get('/api/enrich-lead', exigirAutenticacao, (req, res) => {
  if (req.query.checkStatus !== 'true') {
    return res.status(400).json({ error: 'Parâmetro inválido.' });
  }
  res.json({
    providers: {
      chatgpt: !!process.env.OPENAI_API_KEY,
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      claude: !!process.env.ANTHROPIC_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY
    }
  });
});

app.post('/api/enrich-lead', exigirAutenticacao, async (req, res) => {
  const { id, nome, doc, documento, phone, provider = 'deepseek' } = req.body;
  const docFinal = doc || documento || 'N/A';

  if (!nome) return res.status(400).json({ error: 'Nome do lead é obrigatório.' });

  console.log(`[enrich-lead] ${req.usuario.email} | provider=${provider} | lead=${nome}`);

  const userPrompt = `Lead: ${nome} | Doc: ${docFinal} | Phone: ${phone || 'N/A'}`;

  try {
    let rawContent = '';
    switch (provider) {
      case 'chatgpt':
        rawContent = await callChatGPT(SYSTEM_PROMPT, userPrompt, process.env.OPENAI_API_KEY);
        break;
      case 'claude':
        rawContent = await callClaude(SYSTEM_PROMPT, userPrompt, process.env.ANTHROPIC_API_KEY);
        break;
      case 'gemini':
        rawContent = await callGemini(SYSTEM_PROMPT, userPrompt, process.env.GEMINI_API_KEY);
        break;
      case 'deepseek':
      default:
        rawContent = await callDeepSeek(SYSTEM_PROMPT, userPrompt, process.env.DEEPSEEK_API_KEY);
        break;
    }

    const limpo = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
    const resultJson = JSON.parse(limpo);

    if (id) {
      const leads = readJson(DB_LEADS, []);
      const index = leads.findIndex((l) => l.id === Number(id));
      if (index !== -1) {
        leads[index].enriquecimentoIA = resultJson;
        writeJson(DB_LEADS, leads);
      }
    }

    // Formato plano, igual ao da Cloudflare Function.
    res.json(resultJson);
  } catch (error) {
    console.error('Erro no processamento da IA:', error.message);
    res.status(500).json({ error: 'Falha ao processar análise da IA.', details: error.message });
  }
});

/* ==========================================================================
   INTEGRAÇÕES COM PROVEDORES DE IA
   ========================================================================== */

async function callDeepSeek(systemPrompt, userPrompt, apiKey) {
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY não configurada no servidor.');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }] })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Erro na API Gemini');
  return data.candidates[0].content.parts[0].text;
}

/* ==========================================================================
   INICIALIZAÇÃO
   ========================================================================== */

app.listen(PORT, () => {
  const faltando = [];
  if (!process.env.GOOGLE_CLIENT_ID) faltando.push('GOOGLE_CLIENT_ID');
  if (!process.env.HUB_API_KEY) faltando.push('HUB_API_KEY');

  console.log('================================================');
  console.log(`[Formatar CRM] API & Frontend ativos na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
  if (faltando.length) {
    console.log(`ATENCAO: variaveis ausentes no .env -> ${faltando.join(', ')}`);
    console.log('O login vai falhar ate que sejam configuradas.');
  }
  console.log('================================================');
});
