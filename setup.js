const fs = require('fs');
const path = require('path');

const files = {
  // 1. BACKEND (server.js com rota GET / corrigida)
  'server.js': `import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve arquivos estaticos da raiz e da pasta public
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// Rota Principal para servir o index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const SYSTEM_PROMPT = \`Você é um especialista em Inteligência de Vendas B2B e enriquecimento de dados de CRM.
Análise o lead fornecido e retorne ESTRITAMENTE um JSON válido no seguinte formato:
{
  "fontes": { "site_oficial": "https://...", "instagram": "https://..." },
  "classificacao": { "ramo": "SELECIONE_UM", "segmento": "SELECIONE_UM" },
  "resumo_descritivo": { "paragrafo_1": "...", "paragrafo_2": "...", "paragrafo_3": "..." }
}
RAMOS PERMITIDOS: AGRONEGÓCIO, ALIMENTOS, AUTOMOBILÍSTICO, CONSTRUÇÃO CIVIL, ECOMMERCE, HIGIENE, IMPORTADORA, LAZER, LOGÍSTICA, METALÚRGICA, MODA E VESTUÁRIO, MÓVEIS E DECORAÇÕES, ONG, PUBLICIDADE, SAUDE E ESTÉTICA, SEGURANÇA, TECNOLOGIA.
SEGMENTOS PERMITIDOS: INDÚSTRIA, ONG, SERVIÇOS, VAREJO.\`;

app.post('/api/enrich-lead', async (req, res) => {
  const { id, nome, doc, phone } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome do lead é obrigatório.' });

  try {
    const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${process.env.OPENAI_API_KEY}\`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: \`Lead: \${nome} | Doc: \${doc || 'N/A'} | Phone: \${phone || 'N/A'}\` }
        ],
        response_format: { type: "json_object" }
      })
    });

    const aiDataRaw = await openAiResponse.json();
    const resultJson = JSON.parse(aiDataRaw.choices[0].message.content);

    if (id && supabase) {
      await supabase.from('leads').update({
        site_url: resultJson.fontes?.site_oficial,
        instagram_url: resultJson.fontes?.instagram,
        ramo: resultJson.classificacao?.ramo,
        segmento: resultJson.classificacao?.segmento,
        resumo_ia: JSON.stringify(resultJson.resumo_descritivo),
        updated_at: new Date()
      }).eq('id', id);
    }

    return res.json({ success: true, data: resultJson });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao processar análise da IA.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`🚀 [Formatar CRM] API e Frontend Ativos na porta \${PORT}\`));
`
};

Object.entries(files).forEach(([filepath, content]) => {
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`Atualizado: ${filepath}`);
});

console.log('\n✅ server.js atualizado com sucesso!');