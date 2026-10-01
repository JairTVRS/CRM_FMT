-- ==========================================================
-- CRM Formatar — Migração 026
-- Balança Avaliativa do cliente (2.39.0).
--
-- Aplicar ANTES do deploy da 2.39.0 (pelo --command: o --file falha com
-- "Authentication error [code: 10000]" nesta máquina — ver a 021), um
-- comando por instrução abaixo.
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('balancas', 'idx_balancas_cliente')"
--
-- Aplicada no D1 remoto em 01/10/2026, pelo --command, e conferida.
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS.
-- ==========================================================

-- ----------------------------------------------------------
-- BALANCAS — a Balança Avaliativa de cada cliente, com versões
--
-- O mesmo formato dos outros documentos do CRM (_lib/versionamento.js):
-- gerar de novo NUNCA sobrescreve. Chave: o cliente (clientes.id).
--
-- `instrucao`: qual instrução gerou — 'padrão 1.0' (a do código, cópia de
--   Manuais/Instrucao-Balanca-Avaliativa-V1.0.md) ou 'v2', 'v3'… (a
--   enviada nas Configurações, finalidade 'balanca').
-- `periodo_de`/`periodo_ate`: AAAA-MM-DD, os 6 meses lidos.
-- `reunioes`/`acoes`: quantas entraram como fonte.
-- `citacoes`/`citacoes_nao_encontradas`: as evidências que a IA citou e
--   quantas a linha apontada não sustentava.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS balancas (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id                INTEGER NOT NULL,
  cliente_nome              TEXT,
  versao                    INTEGER NOT NULL,
  gerado_por                TEXT    NOT NULL,
  gerado_em                 TEXT    NOT NULL,
  provider                  TEXT,
  instrucao                 TEXT,
  periodo_de                TEXT,
  periodo_ate               TEXT,
  reunioes                  INTEGER,
  acoes                     INTEGER,
  citacoes                  INTEGER,
  citacoes_nao_encontradas  INTEGER,
  html                      TEXT,
  tamanho_bytes             INTEGER,
  dados_json                TEXT,
  status                    TEXT    NOT NULL DEFAULT 'concluido',  -- concluido | erro
  erro_mensagem             TEXT,
  UNIQUE (cliente_id, versao)
);

CREATE INDEX IF NOT EXISTS idx_balancas_cliente ON balancas (cliente_id, versao DESC);
