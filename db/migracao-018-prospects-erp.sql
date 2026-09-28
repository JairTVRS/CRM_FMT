-- ==========================================================
-- CRM Formatar — Migração 018
-- Prospects do ERP, 1× por dia (2.33.0).
--
-- Aplicar ANTES do deploy da 2.33.0:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-018-prospects-erp.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('prospects_erp', 'importacoes_erp')"
--
-- Seguro rodar duas vezes? NÃO por inteiro: o ALTER TABLE falha na
-- segunda vez com "duplicate column name" (inofensivo). O resto é
-- CREATE ... IF NOT EXISTS.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. O vínculo do lead com o prospect do ERP.
--
-- É o `id` do cliente no hub (ObjectId). Nulo = lead que nasceu no CRM
-- e não foi casado com ninguém no ERP.
-- ----------------------------------------------------------
ALTER TABLE leads ADD COLUMN erp_id TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_erp_id ON leads (erp_id);

-- ----------------------------------------------------------
-- 2. PROSPECTS_ERP — todo prospect do ERP que o CRM já viu, uma vez.
--
-- É a memória que impede um lead EXCLUÍDO no CRM de voltar na importação
-- do dia seguinte (decidido em 28/09/2026). Quem está aqui não é
-- importado de novo, qualquer que seja a situação:
--
--   criado           virou um lead novo
--   vinculado        já existia lead ativo com o mesmo CNPJ: ganhou o erp_id
--   excluido_no_crm  o CNPJ só existe em lead excluído: não é recriado
--
-- Depois de importado, o CRM é o dono do lead: mudar o prospect no ERP
-- não muda o lead.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospects_erp (
  erp_id        TEXT PRIMARY KEY,
  documento     TEXT,
  lead_id       INTEGER,
  situacao      TEXT NOT NULL,
  importado_em  TEXT NOT NULL,
  importacao_id INTEGER
);

-- ----------------------------------------------------------
-- 3. IMPORTACOES_ERP — cada rodada, para a tela dizer quando foi a
-- última e o que trouxe, e para a diária não rodar duas vezes no dia.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS importacoes_erp (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  origem        TEXT NOT NULL,              -- 'diaria' | 'manual'
  por           TEXT NOT NULL,
  dia           TEXT NOT NULL,              -- AAAA-MM-DD, horário de Brasília
  iniciado_em   TEXT NOT NULL,
  concluido_em  TEXT,
  total_hub     INTEGER,
  criados       INTEGER,
  vinculados    INTEGER,
  ignorados     INTEGER,
  aviso         TEXT,
  erro          TEXT
);

CREATE INDEX IF NOT EXISTS idx_importacoes_erp_dia ON importacoes_erp (origem, dia);
