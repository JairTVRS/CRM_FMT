-- ==========================================================
-- CRM Formatar — Migração 003
-- Persistência dos leads.
--
-- Até aqui os leads viviam apenas no DOM: o app.js montava as
-- linhas da tabela e não gravava em lugar nenhum. Qualquer
-- recarregamento da página apagava tudo.
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-003-leads.sql
-- ==========================================================

CREATE TABLE IF NOT EXISTS leads (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Dados Gerais
  nome           TEXT    NOT NULL,
  documento      TEXT,                      -- só dígitos; CNPJ ou CPF
  telefone       TEXT,
  origem         TEXT,
  observacoes    TEXT,

  -- Contato & Endereço
  email          TEXT,
  contato_nome   TEXT,
  cep            TEXT,
  cidade         TEXT,
  endereco       TEXT,

  -- Inteligência Artificial
  site           TEXT,
  instagram      TEXT,
  ramo           TEXT,
  segmento       TEXT,
  resumo_ia      TEXT,                      -- HTML do enriquecimento

  -- Auditoria
  criado_por     TEXT    NOT NULL,
  criado_em      TEXT    NOT NULL,          -- ISO 8601 UTC
  atualizado_por TEXT,
  atualizado_em  TEXT,

  -- Exclusão lógica: histórico comercial não se apaga sem rastro
  ativo          INTEGER NOT NULL DEFAULT 1
);

-- Busca textual por nome e documento é a operação mais frequente
CREATE INDEX IF NOT EXISTS idx_leads_nome
  ON leads (nome);

CREATE INDEX IF NOT EXISTS idx_leads_documento
  ON leads (documento);

-- A listagem sempre filtra por ativo e ordena por criação
CREATE INDEX IF NOT EXISTS idx_leads_ativo_criado
  ON leads (ativo, criado_em DESC);

-- Filtros da tela
CREATE INDEX IF NOT EXISTS idx_leads_ramo
  ON leads (ramo);

CREATE INDEX IF NOT EXISTS idx_leads_segmento
  ON leads (segmento);

-- Impede dois cadastros com o mesmo documento entre os ativos.
-- Índice parcial: leads excluídos não bloqueiam recadastro, e
-- documento em branco não conflita com outro em branco.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_documento_unico
  ON leads (documento)
  WHERE ativo = 1 AND documento IS NOT NULL AND documento <> ''
