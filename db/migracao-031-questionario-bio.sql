-- ==========================================================
-- CRM Formatar — Migração 031
-- Questionário da página BIO (2.46.0): quem responde entra no funil.
--
-- Cada envio do questionário fica aqui, ligado ao lead que criou
-- (situacao = 'criado') ou ao lead que já existia com o mesmo CNPJ/CPF
-- ou telefone (situacao = 'anexado' — o lead não é duplicado).
--
-- ip_hash: SHA-256 do IP com sal, só para limitar envios por aparelho.
-- O IP em si NÃO é guardado.
--
-- Aplicar ANTES do deploy da 2.46.0 (no remoto, pelo --command: o --file
-- falha com "Authentication error 10000"):
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-031-questionario-bio.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name = 'bio_respostas'"
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS.
-- ==========================================================

CREATE TABLE IF NOT EXISTS bio_respostas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER,
  situacao    TEXT    NOT NULL,             -- 'criado' | 'anexado'
  nome        TEXT    NOT NULL,
  telefone    TEXT    NOT NULL,
  email       TEXT,
  documento   TEXT,
  respostas   TEXT    NOT NULL,             -- JSON: [{ id, rotulo, valor: [] }]
  desafio     TEXT,
  ip_hash     TEXT,
  criado_em   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bio_respostas_ip ON bio_respostas (ip_hash, criado_em);
CREATE INDEX IF NOT EXISTS idx_bio_respostas_lead ON bio_respostas (lead_id);
