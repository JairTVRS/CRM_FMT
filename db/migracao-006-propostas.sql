-- ==========================================================
-- CRM Formatar — Migração 006
-- Propostas comerciais geradas pelo sistema.
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-006-propostas.sql
--
-- Seguro rodar duas vezes? SIM. Só cria tabela e índices, tudo com
-- IF NOT EXISTS.
-- ==========================================================

-- ----------------------------------------------------------
-- propostas — uma linha por VERSÃO gerada.
--
-- Mesma regra do dossiê: gerar de novo NUNCA sobrescreve. Cria a versão
-- seguinte e mantém a anterior consultável.
--
-- Aqui a regra vale ainda mais: a proposta é o documento que foi para a
-- mão do cliente. Se o template mudar depois — e vai mudar —, é preciso
-- conseguir mostrar exatamente o que foi enviado naquela data, não uma
-- reimpressão com o layout de hoje. Por isso o HTML renderizado fica
-- guardado, e não apenas os dados que o originaram.
--
-- O HTML mora numa coluna do D1, não no R2, pela mesma razão do dossiê:
-- o R2 exige ativação com cartão e o ganho não justifica a dependência.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS propostas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  -- A quem pertence
  lead_id        INTEGER NOT NULL,
  documento      TEXT,               -- CNPJ/CPF no momento da geração
  cliente_nome   TEXT,               -- razão social no momento da geração

  -- Versionamento
  versao         INTEGER NOT NULL,   -- 1, 2, 3... por lead

  -- Log de geração
  gerado_por     TEXT    NOT NULL,   -- e-mail vindo do ID token
  gerado_em      TEXT    NOT NULL,   -- ISO 8601 UTC

  -- O documento como foi entregue
  html           TEXT    NOT NULL,
  tamanho_bytes  INTEGER,

  -- Os campos que originaram o documento. Permitem repropor uma versão
  -- nova já preenchida, sem redigitar tudo.
  dados_json     TEXT,

  UNIQUE (lead_id, versao)
);

CREATE INDEX IF NOT EXISTS idx_propostas_lead
  ON propostas (lead_id, versao DESC);

CREATE INDEX IF NOT EXISTS idx_propostas_gerado_em
  ON propostas (gerado_em DESC);
