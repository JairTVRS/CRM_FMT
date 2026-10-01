-- ==========================================================
-- CRM Formatar — Migração 023
-- Histórico de cada compromisso da agenda (2.36.5).
--
-- Aplicar ANTES do deploy da 2.36.5 (pelo --command: o --file falha com
-- "Authentication error [code: 10000]" nesta máquina — ver a 021), um
-- comando por instrução abaixo.
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('agenda_eventos', 'idx_agenda_eventos')"
--
-- Aplicada no D1 remoto em 01/10/2026, pelo --command, e conferida.
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS.
-- ==========================================================

-- ----------------------------------------------------------
-- Pedido de 01/10/2026: um relógio na janela do compromisso abre o
-- histórico — quem, quando e o que mudou —, como o "Histórico de
-- alterações" do ERP.
--
-- `evento`: criada | alterada | remarcada | iniciada | finalizada |
--           cancelada | resetada | excluida
-- `detalhe`: JSON, conforme o evento —
--   alterada   { mudancas: [{ campo, de, para }] }   (valores crus; a tela
--              traduz: e-mail vira nome, 'online' vira Online)
--   criada     { remarcada_de: id, de_inicio }        quando nasceu de remarcar
--   remarcada  { para }                              o novo dia e hora
--   cancelada  { motivo, observacao }
--   resetada   { estava, gravacoes }                 situação e gravações apagadas
--
-- Só se acrescenta: nada aqui é editado nem apagado. O que aconteceu
-- antes desta tabela existir não tem linha — a tela mostra a criação a
-- partir de `agenda_lead.criado_em`.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS agenda_eventos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agenda_id  INTEGER NOT NULL,          -- agenda_lead.id
  lead_id    INTEGER NOT NULL,
  evento     TEXT    NOT NULL,
  detalhe    TEXT,
  por        TEXT    NOT NULL,          -- e-mail, em minúsculas
  em         TEXT    NOT NULL           -- ISO UTC
);

CREATE INDEX IF NOT EXISTS idx_agenda_eventos ON agenda_eventos (agenda_id, em);
