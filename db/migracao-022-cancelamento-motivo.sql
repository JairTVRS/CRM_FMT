-- ==========================================================
-- CRM Formatar — Migração 022
-- Cancelar com motivo e observação (2.36.2).
--
-- Aplicar ANTES do deploy da 2.36.2 (pelo --command: o --file falha com
-- "Authentication error [code: 10000]" nesta máquina — ver a 021):
--   npx wrangler d1 execute crm-formatar --remote --command="ALTER TABLE agenda_lead ADD COLUMN cancelamento_motivo TEXT"
--   (e o mesmo para as outras três colunas)
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('agenda_lead') WHERE name LIKE 'cancela%'"
--
-- Aplicada no D1 remoto em 01/10/2026, pelo --command, e conferida.
--
-- Seguro rodar duas vezes? NÃO: ALTER TABLE ... ADD COLUMN falha na
-- segunda vez ("duplicate column").
-- ==========================================================

-- ----------------------------------------------------------
-- Pedido de 01/10/2026: cancelar pede um MOTIVO (os quatro do Painel de
-- Operações do ERP) e uma observação, e a agenda pinta o cancelado de
-- roxo, como o ERP.
--
-- `cancelamento_motivo`: cliente | consultor | agendamento | proposta
--   (os rótulos moram em _lib/agenda.js, MOTIVOS_CANCELAMENTO).
-- Os quatro campos só valem com status 'cancelada': a API os apaga se a
-- situação voltar a ser outra.
-- ----------------------------------------------------------
ALTER TABLE agenda_lead ADD COLUMN cancelamento_motivo TEXT;
ALTER TABLE agenda_lead ADD COLUMN cancelamento_obs    TEXT;
ALTER TABLE agenda_lead ADD COLUMN cancelada_em        TEXT;
ALTER TABLE agenda_lead ADD COLUMN cancelada_por       TEXT;
