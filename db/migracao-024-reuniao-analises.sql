-- ==========================================================
-- CRM Formatar — Migração 024
-- Recortes e roteiro durante a reunião (2.37.0).
--
-- Aplicar ANTES do deploy da 2.37.0 (pelo --command: o --file falha com
-- "Authentication error [code: 10000]" nesta máquina — ver a 021), um
-- comando por instrução abaixo.
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('reuniao_analises', 'idx_reuniao_analises')"
--
-- Aplicada no D1 remoto em 01/10/2026, pelo --command, e conferida.
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS.
-- ==========================================================

-- ----------------------------------------------------------
-- Cada análise da conversa de uma reunião: os recortes do lead
-- (conferidos contra a transcrição), o roteiro coberto e o que falta, e
-- as perguntas sugeridas. Uma linha por análise; a tela mostra a última.
-- O laudo da 2.38.0 lê daqui.
--
-- `resultado`: JSON já CONFERIDO — o que a IA citou e não está na
--   transcrição não chega aqui (conta em `descartados`).
-- `trechos`: quantos trechos da transcrição a análise leu. Se não
--   chegou nenhum trecho novo, a próxima não chama a IA de novo.
--
-- Resetar a reunião apaga as análises dela, junto com a transcrição.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS reuniao_analises (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reuniao_id   INTEGER NOT NULL,          -- agenda_lead.id
  lead_id      INTEGER NOT NULL,
  trechos      INTEGER NOT NULL,
  provedor     TEXT,
  resultado    TEXT    NOT NULL,
  descartados  INTEGER NOT NULL DEFAULT 0,
  gerado_por   TEXT    NOT NULL,
  gerado_em    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reuniao_analises ON reuniao_analises (reuniao_id, gerado_em);
