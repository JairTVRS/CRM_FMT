-- ==========================================================
-- CRM Formatar — Migração 020
-- Gravação e transcrição da reunião do lead (2.35.0).
--
-- Aplicar ANTES do deploy da 2.35.0:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-020-gravacao.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('gravacoes', 'transcricao_trechos')"
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. GRAVACOES — cada vez que o CX grava uma reunião da agenda.
--
-- SÓ O TEXTO É GUARDADO (decidido em 28/09/2026). O áudio vai do
-- navegador para a transcrição em pedaços de ~20 s e é descartado; não
-- há coluna de áudio, de propósito.
--
-- O CONSENTIMENTO é obrigatório e fica registrado: quem confirmou que o
-- lead concordou em ser gravado, e quando (LGPD). Sem ele não há
-- gravação — a API recusa.
--
-- `modo`:
--   online      computador: o microfone (Formatar) e o áudio da aba da
--               reunião (o lead) em separado — a transcrição sabe quem falou
--   presencial  um microfone só (presencial, externo, celular): quem falou
--               não é separado
--
-- `roteiro_id`/`roteiro_versao`: o roteiro em vigor do tipo da reunião
-- quando a gravação começou. Trocar o roteiro depois não reescreve a
-- reunião que já aconteceu (e os insights da 2.36.0 leem este).
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS gravacoes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  reuniao_id         INTEGER NOT NULL,          -- agenda_lead.id
  lead_id            INTEGER NOT NULL,
  modo               TEXT    NOT NULL,          -- 'online' | 'presencial'
  consentimento_por  TEXT    NOT NULL,
  consentimento_em   TEXT    NOT NULL,
  roteiro_id         INTEGER,
  roteiro_versao     INTEGER,
  transcritor        TEXT,                      -- 'workers-ai' | 'openai'
  status             TEXT    NOT NULL DEFAULT 'gravando',   -- 'gravando' | 'encerrada'
  iniciada_por       TEXT    NOT NULL,
  iniciada_em        TEXT    NOT NULL,
  encerrada_em       TEXT,
  duracao_s          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_gravacoes_reuniao ON gravacoes (reuniao_id);

-- ----------------------------------------------------------
-- 2. TRANSCRICAO_TRECHOS — o texto de cada pedaço.
--
-- `origem`: 'formatar' (o microfone do CX), 'lead' (o áudio da aba) ou
-- 'sala' (microfone único). `inicio_s` é o segundo da gravação em que o
-- pedaço começou: ordena a conversa intercalando as duas vozes.
--
-- (gravação, origem, seq) é único: o navegador reenvia um pedaço que
-- falhou, e o reenvio substitui em vez de duplicar.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcricao_trechos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  gravacao_id  INTEGER NOT NULL,
  origem       TEXT    NOT NULL,
  seq          INTEGER NOT NULL,
  inicio_s     REAL    NOT NULL,
  fim_s        REAL,
  texto        TEXT    NOT NULL,
  criado_em    TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trechos_unico
  ON transcricao_trechos (gravacao_id, origem, seq);
