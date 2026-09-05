-- ==========================================================
-- CRM Formatar — Migração 009
-- A tabela `propostas` ganha registro de falha.
--
-- ⚠️ ATENÇÃO — ESTA MIGRAÇÃO **NÃO** É SEGURA PARA RODAR DUAS VEZES.
--
-- As 007 e 008 eram, porque só tinham `CREATE ... IF NOT EXISTS`. Esta
-- tem `ALTER TABLE ADD COLUMN`, e o SQLite não oferece
-- `ADD COLUMN IF NOT EXISTS`. Rodar de novo devolve
-- "duplicate column name" e ABORTA no meio.
--
-- CONFIRA ANTES de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('propostas')"
--
-- Se `status` já aparecer na lista, NÃO aplique — já foi.
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-009-propostas-status.sql
--
-- CONFIRA DEPOIS de aplicar (a segunda metade da convenção, a que
-- faltou na 006 e custou um dia de proposta quebrada no ar):
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('propostas')"
--
-- Devem aparecer `status` e `erro_mensagem`.
-- ==========================================================

-- ----------------------------------------------------------
-- Por que estas duas colunas
--
-- Das três tabelas de documento, `propostas` era a única sem
-- registro de falha. `dossies` e `dossies_cx` gravam uma linha
-- com status='erro' e a mensagem quando a geração quebra;
-- a proposta não deixava rastro nenhum.
--
-- A ironia é que foi justamente a proposta que quebrou em
-- produção, na v2.13.0, e ficou um dia inteiro falhando sem
-- que o banco guardasse uma linha sequer sobre isso.
--
-- Com as colunas, o `_lib/versionamento.js` trata as três do
-- mesmo jeito — e a leitura passa a filtrar status='concluido'
-- em todas, sem caso especial.
--
-- NÃO entra coluna `provider` aqui. As outras duas têm porque
-- o documento é escrito por IA; a proposta sai de um formulário
-- preenchido por gente. Uma coluna que seria sempre nula
-- documentaria uma semelhança que não existe.
-- ----------------------------------------------------------

-- DEFAULT 'concluido' é o que faz as propostas JÁ EXISTENTES
-- continuarem visíveis: sem ele nasceriam com status nulo e
-- sumiriam da tela, porque a leitura filtra por 'concluido'.
ALTER TABLE propostas ADD COLUMN status TEXT NOT NULL DEFAULT 'concluido';

ALTER TABLE propostas ADD COLUMN erro_mensagem TEXT;

-- A consulta quente é "as versões desta proposta, as que deram certo".
CREATE INDEX IF NOT EXISTS idx_propostas_lead_status
  ON propostas (lead_id, status, versao DESC);
