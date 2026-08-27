-- ==========================================================
-- CRM Formatar — Esquema do banco de dossiês (Cloudflare D1)
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/schema.sql
--
-- O dossiê é chaveado por CNPJ, não por lead. Isso é proposital:
-- os leads ainda não persistem em produção, e o CNPJ é o
-- identificador estável da empresa analisada.
-- ==========================================================

-- ----------------------------------------------------------
-- dossies — uma linha por VERSÃO gerada.
-- Nunca sobrescreve: gerar de novo cria versão nova e a
-- anterior permanece consultável.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS dossies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Identificação da empresa analisada
  cnpj            TEXT    NOT NULL,          -- só dígitos, 14 caracteres
  razao_social    TEXT,
  nome_fantasia   TEXT,

  -- Versionamento
  versao          INTEGER NOT NULL,          -- 1, 2, 3... por CNPJ

  -- Log de geração
  gerado_por      TEXT    NOT NULL,          -- e-mail vindo do ID token
  gerado_em       TEXT    NOT NULL,          -- ISO 8601 UTC
  provider        TEXT    NOT NULL,          -- deepseek | chatgpt | claude | gemini

  -- Rastreabilidade das fontes usadas nesta versão
  fonte_cnpj      TEXT,                      -- brasilapi | opencnpj | indisponivel
  fonte_site      TEXT,                      -- ok | sem_site | falha
  fonte_instagram TEXT,                      -- manual | graph_api | ausente

  -- Onde está o arquivo no R2
  r2_key          TEXT    NOT NULL,          -- dossies/<cnpj>/v<versao>.html
  tamanho_bytes   INTEGER,

  -- Cópia do JSON estruturado que originou o HTML.
  -- Permite reprocessar o template sem chamar a IA de novo.
  dados_json      TEXT,

  status          TEXT    NOT NULL DEFAULT 'concluido',  -- concluido | erro
  erro_mensagem   TEXT,

  UNIQUE (cnpj, versao)
);

CREATE INDEX IF NOT EXISTS idx_dossies_cnpj
  ON dossies (cnpj, versao DESC);

CREATE INDEX IF NOT EXISTS idx_dossies_gerado_em
  ON dossies (gerado_em DESC);

-- ----------------------------------------------------------
-- cache_cnpj — respostas da BrasilAPI/OpenCNPJ.
-- Dado cadastral muda pouco; evita repetir consulta externa
-- a cada nova versão de dossiê do mesmo lead.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS cache_cnpj (
  cnpj         TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fonte        TEXT NOT NULL,
  buscado_em   TEXT NOT NULL,     -- ISO 8601 UTC
  expira_em    TEXT NOT NULL      -- ISO 8601 UTC (padrão: +30 dias)
);

-- ----------------------------------------------------------
-- Views auxiliares
-- ----------------------------------------------------------

-- Última versão de cada CNPJ — é o que a interface abre por padrão.
CREATE VIEW IF NOT EXISTS dossies_atuais AS
SELECT d.*
FROM dossies d
JOIN (
  SELECT cnpj, MAX(versao) AS versao
  FROM dossies
  WHERE status = 'concluido'
  GROUP BY cnpj
) ult ON ult.cnpj = d.cnpj AND ult.versao = d.versao;
