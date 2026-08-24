const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Permite requisições vindas do seu frontend na Cloudflare Pages ou qualquer origem em dev
app.use(cors());
app.use(express.json());

// Caminhos dos arquivos de persistência JSON no seu servidor
const DB_LEADS = path.join(__dirname, 'leads.json');
const DB_RAMOS = path.join(__dirname, 'ramos.json');
const DB_SEGMENTOS = path.join(__dirname, 'segmentos.json');

// Auxiliares para leitura e escrita seguras
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
  const duplicado = leads.find(l => l.documento === documento || l.whatsapp === whatsapp);
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

  const { nome, documento, whatsapp, origem, mensagemInicial, usarIA, dadosManuais } = req.body;

  leads[index] = {
    ...leads[index],
    nome,
    documento,
    whatsapp,
    origem,
    mensagemInicial,
    usarIA,
    dadosQualificacao: usarIA ? null : dadosManuais
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

// Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`[Formatar CRM] API Ativa no Servidor Próprio`);
  console.log(`Rodando na porta: ${PORT}`);
  console.log(`================================================`);
});