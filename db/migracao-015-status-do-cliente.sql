-- ==========================================================
-- CRM Formatar — Migração 015
-- O status do cliente no plano de ação, e uma releitura das atas
-- com as regras novas (2.30.0).
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-015-status-do-cliente.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('acoes_cx') WHERE name = 'cliente_status'"
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT carregado_ate, completa FROM plano_carga"
--   (a segunda deve mostrar carregado_ate NULL e completa 0)
--
-- Seguro rodar duas vezes? NÃO — ALTER TABLE ADD COLUMN falha com
-- "duplicate column name" na segunda. Se aparecer, já foi aplicada.
--
-- A Fase 3 da 2.24.0 passa a ser a migração 016.
-- ==========================================================

-- O status do cliente no ERP (active, inactive, prospect, ad_hoc). A
-- carga o atualiza em TODAS as ações a cada passo — cliente inativado
-- no ERP muda aqui mesmo sem reunião nova.
ALTER TABLE acoes_cx ADD COLUMN cliente_status TEXT;

-- A releitura. Duas regras novas dependem da reunião, que não está
-- gravada: o responsável vindo dos participantes e o status do cliente.
-- Voltar o cursor faz a próxima abertura da tela reler os seis meses,
-- em passos, uma vez. Nada se perde: a ata mais recente de cada carteira
-- é reaplicada pela regra da sombra — só muda o que a leitura nova lê
-- diferente, e cada mudança vai para o histórico como feita pela ata.
-- `plano_carteiras` impede que uma ata antiga passe por cima da nova.
UPDATE plano_carga SET carregado_ate = NULL, completa = 0 WHERE id = 1;
