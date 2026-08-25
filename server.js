const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para CORS e Parsing de JSON
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos do frontend (raiz e public)
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// Caminhos dos arquivos de persistência JSON no servidor
const DB_LEADS = path.join(__dirname, 'leads.json');
const DB_RAMOS = path.join(__dirname, 'ramos.json');
const DB_SEGMENTOS = path.join(__dirname, 'segmentos.json');

// Auxiliares para leitura e escrita seguras em arquivos JSON
const readJson = (filePath, fallback) => {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : fallback;
  } catch (err) {
    console.error(`Erro ao ler o arquivo ${filePath}:`, err);
    return fallback;
  }
};

const writeJson = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Erro ao escrever no arquivo ${filePath}:`, err);
  }
};

// System Prompt Otimizado para IA
const SYSTEM_PROMPT = `Você é um especialista em Inteligência de Vendas B2B e enriquecimento de dados de CRM.
Análise o lead fornecido e retorne ESTRITAMENTE um JSON válido no seguinte formato:
{
  "fontes": { "site_oficial": "https://...", "instagram": "https://..." },
  "classificacao": { "ramo": "SELECIONE_UM", "segmento": "SELECIONE_UM" },
  "resumo_descritivo": { "paragrafo_1": "...", "paragrafo_2": "...", "paragrafo_3": "..." }
}
RAMOS PERMITIDOS: AGRONEGÓCIO, ALIMENTOS, AUTOMOBILÍSTICO, CONSTRUÇÃO CIVIL, ECOMMERCE, HIGIENE, IMPORTADORA, LAZER, LOGÍSTICA, METALÚRGICA, MODA E VESTUÁRIO, MÓVEIS E DECORAÇÕES, ONG, PUBLICIDADE, SAUDE E ESTÉTICA, SEGURANÇA, TECNOLOGIA.
SEGMENTOS PERMITIDOS: INDÚSTRIA, ONG, SERVIÇOS, VAREJO.`;

// Rota 0: Servir o index.html na raiz (Corrige o erro "Cannot GET /")
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. Rota de Configurações (Ramos e Segmentos)
app.get('/api/config', (req, res) => {
  const ramos = readJson(DB_RAMOS, ["Tecnologia", "Varejo", "Serviços", "Indústria", "Agronegócio", "Saúde"]);
  const segmentos = readJson(DB_SEGMENTOS, ["B2B", "B2C", "SaaS", "E-commerce", "Consultoria"]);
  res.json({ ramos, segmentos });
});

// 2. Rota de Listagem de Leads (GET)
app.get('/api/leads', (req, res) => {
  const leads = readJson(DB_LEADS, []);
  res.json(leads);
});

// 3. Rota de Cadastro de Lead (POST)
app.post('/api/leads', (req, res) => {
  const leads = readJson(DB_LEADS, []);
  const { nome, documento, whatsapp, origem, mensagemInicial, usarIA, dadosManuais } = req.body;

  // Validação de Duplicidade por CPF/CNPJ ou WhatsApp
  const duplicado = leads.find(l => (documento && l.documento === documento) || (whatsapp && l.whatsapp === whatsapp));
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
    criadoEm: new Date().toLocaleString('pt-BR')
  };

  leads.unshift(novoLead);
  writeJson(DB_LEADS, leads);

  res.status(201).json(novoLead);
});

// 4. Rota de Edição de Lead (PUT)
app.put('/api/leads/:id', (req, res) => {
  const leads = readJson(DB_LEADS, []);
  const leadId = Number(req.params.id);
  const index = leads.findIndex(l => l.id === leadId);

  if (index === -1) {
    return res.status(404).json({ mensagem: 'Lead não encontrado.' });
  }

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
    enriquecimentoIA: enriquecimentoIA || leads[index].enriquecimentoIA
  };

  writeJson(DB_LEADS, leads);
  res.json(leads[index]);
});

// 5. Rota de Exclusão de Lead (DELETE)
app.delete('/api/leads/:id', (req, res) => {
  let leads = readJson(DB_LEADS, []);
  const leadId = Number(req.params.id);

  leads = leads.filter(l => l.id !== leadId);
  writeJson(DB_LEADS, leads);

  res.json({ success: true, mensagem: 'Lead excluído com sucesso.' });
});

// 6. Rota de Enriquecimento por IA (POST)
app.post('/api/enrich-lead', async (req, res) => {
  const { id, nome, doc, phone } = req.body;

  if (!nome) {
    return res.status(400).json({ error: 'Nome do lead é obrigatório.' });
  }

  try {
    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
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

    // Se um ID de lead for passado, grava a resposta da IA no leads.json
    if (id) {
      const leads = readJson(DB_LEADS, []);
      const index = leads.findIndex(l => l.id === Number(id));
      if (index !== -1) {
        leads[index].enriquecimentoIA = resultJson;
        writeJson(DB_LEADS, leads);
      }
    }

    return res.json({ success: true, data: resultJson });
  } catch (error) {
    console.error('Erro no processamento da IA:', error);
    return res.status(500).json({ error: 'Falha ao processar análise da IA.' });
  }
});

// Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`[Formatar CRM] API & Frontend Ativos na porta: ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
  console.log(`================================================`);
});