-- ==========================================================
-- CRM Formatar — Migração 029
-- Stakeholders do ERP (2.43.0, Fase 3 da 2.24.0).
--
-- Decidido com o Jair em 05/10/2026: as pessoas do cliente são as do
-- cadastro do cliente no ERP (campo `contacts` do GET /customers/{id},
-- conferido na 2.42.0: todas com `_id`). O CRM não cadastra pessoa; só
-- guarda a avaliação da CX — influência, postura, patrocinador e
-- observações — presa ao código da pessoa no ERP.
--
-- Em produção, em 05/10/2026, `stakeholders` tinha 0 linhas: não há
-- avaliação antiga para converter.
--
-- ⚠️ NÃO É SEGURA PARA RODAR DUAS VEZES: o ALTER TABLE aborta com
-- "duplicate column name" na segunda. O resto é seguro.
--
-- CONFIRA ANTES:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('stakeholders') WHERE name = 'erp_contato_id'"
--
-- Aplicar pelo --command, um comando por instrução (ver a 021).
--
-- Aplicada no D1 remoto em 05/10/2026 e conferida: a coluna existe e só
-- o idx_stakeholders_erp ficou (stakeholders tinha 0 linhas).
--
-- CONFIRA DEPOIS:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('idx_stakeholders_erp', 'idx_stakeholders_nome')"
--   (deve aparecer só idx_stakeholders_erp)
-- ==========================================================

-- O código da pessoa no ERP (o `_id` do item de `contacts`).
ALTER TABLE stakeholders ADD COLUMN erp_contato_id TEXT;

-- O nome deixa de ser a identidade: quem identifica é o ERP, e o ERP
-- pode ter duas "Júlia" no mesmo cliente.
DROP INDEX IF EXISTS idx_stakeholders_nome;

-- Uma avaliação por pessoa do ERP, por cliente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stakeholders_erp
  ON stakeholders (cliente_id, erp_contato_id)
  WHERE ativo = 1 AND erp_contato_id IS NOT NULL;
