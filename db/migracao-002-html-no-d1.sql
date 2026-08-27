-- ==========================================================
-- CRM Formatar — Migração 002
-- Passa o armazenamento do dossiê do R2 para o próprio D1.
--
-- Motivo: o R2 exige ativação com cartão de crédito no painel.
-- Para documentos de ~30 KB, guardar em coluna de texto é
-- perfeitamente viável e dispensa o serviço.
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-002-html-no-d1.sql
--
-- Seguro de rodar mais de uma vez? NÃO — o SQLite não tem
-- "ADD COLUMN IF NOT EXISTS". Se rodar duas vezes, a segunda
-- retorna "duplicate column name", o que é inofensivo:
-- significa apenas que já estava aplicada.
-- ==========================================================

-- Conteúdo HTML do dossiê renderizado.
ALTER TABLE dossies ADD COLUMN html TEXT;

-- r2_key deixa de ser usada. Mantida por compatibilidade e
-- para não exigir recriar a tabela (o SQLite do D1 não
-- suporta DROP COLUMN em tabela com índice dependente).
