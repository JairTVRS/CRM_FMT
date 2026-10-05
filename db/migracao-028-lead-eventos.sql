-- ==========================================================
-- CRM Formatar — Migração 028
-- Histórico do lead (2.41.0): quem, quando e o que mudou no cadastro.
--
-- Pedido do Jair em 05/10/2026: um relógio no canto superior direito da
-- ficha do lead, com as alterações e as movimentações do cadastro —
-- quem, data e horário, como estava e como ficou.
--
-- Aplicar pelo --command, um comando por instrução (o --file falha com
-- "Authentication error [code: 10000]" nesta máquina — ver a 021).
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS.
--
-- CONFIRA DEPOIS:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('lead_eventos', 'idx_lead_eventos_lead')"
-- ==========================================================

-- ----------------------------------------------------------
-- LEAD_EVENTOS — um registro por coisa que aconteceu no lead
--
-- evento: criado | alterado | movido | proposta_gerada | contrato_gerado |
--         convertido | excluido
-- detalhe: JSON. Em `alterado`, { mudancas: [{ campo, de, para }] } com os
--   valores CRUS do banco (ids, centavos); quem lê traduz para nomes na
--   hora de mostrar (_lib/lead-eventos.js). Em `movido`, { de, para } com
--   os ids das etapas.
--
-- O mesmo formato do `agenda_eventos` (migração 023). Lead que existia
-- antes desta migração mostra a criação (criado_em/criado_por do próprio
-- lead) e daí em diante o que for registrado.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_eventos (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id  INTEGER NOT NULL,
  evento   TEXT    NOT NULL,
  detalhe  TEXT,
  por      TEXT    NOT NULL,          -- e-mail, em minúsculas
  em       TEXT    NOT NULL           -- ISO UTC
);

CREATE INDEX IF NOT EXISTS idx_lead_eventos_lead ON lead_eventos (lead_id, em DESC);
