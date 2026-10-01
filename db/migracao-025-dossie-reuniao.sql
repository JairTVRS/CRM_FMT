-- ==========================================================
-- CRM Formatar — Migração 025
-- Dossiê da Reunião (2.38.0).
--
-- Aplicar ANTES do deploy da 2.38.0 (pelo --command: o --file falha com
-- "Authentication error [code: 10000]" nesta máquina — ver a 021), um
-- comando por instrução abaixo, NA ORDEM.
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('roteiros') WHERE name = 'finalidade'"
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('dossies_reuniao', 'idx_roteiros_finalidade_versao', 'idx_roteiros_tipo_versao')"
--   (o último índice NÃO pode mais existir)
--
-- Aplicada no D1 remoto em 01/10/2026, pelo --command, e conferida.
--
-- Seguro rodar duas vezes? NÃO: o ALTER TABLE falha na segunda vez
-- ("duplicate column"). O resto é IF [NOT] EXISTS.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. A INSTRUÇÃO DO DOSSIÊ mora junto com os roteiros
--
-- Pedido de 01/10/2026: "o arquivo sobe nas configurações; se mudar,
-- somente mudamos o arquivo". É o mesmo jeito do roteiro — um .md por tipo
-- de reunião, com versões —, então a mesma tabela, com a FINALIDADE:
--   'roteiro'         o que perguntar na reunião (2.34.0)
--   'dossie_reuniao'  como a IA monta o Dossiê da Reunião (2.38.0)
--
-- A numeração de versão passa a ser por tipo E finalidade: o índice
-- antigo (tipo, versao) impediria a instrução v1 de um tipo que já tem
-- roteiro v1.
-- ----------------------------------------------------------
ALTER TABLE roteiros ADD COLUMN finalidade TEXT NOT NULL DEFAULT 'roteiro';
DROP INDEX IF EXISTS idx_roteiros_tipo_versao;
CREATE UNIQUE INDEX IF NOT EXISTS idx_roteiros_finalidade_versao
  ON roteiros (tipo_reuniao_erp_id, finalidade, versao);

-- ----------------------------------------------------------
-- 2. DOSSIES_REUNIAO — o documento, com versões
--
-- O mesmo formato dos outros documentos do CRM (_lib/versionamento.js):
-- gerar de novo NUNCA sobrescreve, cria a versão seguinte. Chave: a
-- reunião (agenda_lead.id). Só registra — não mexe no lead.
--
-- `instrucao_id`/`instrucao_versao`: qual instrução gerou esta versão.
-- `citacoes`/`citacoes_nao_encontradas`: as falas que a IA citou e
--   quantas não estavam na transcrição (o documento as marca).
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS dossies_reuniao (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  reuniao_id                INTEGER NOT NULL,
  lead_id                   INTEGER,
  lead_nome                 TEXT,
  versao                    INTEGER NOT NULL,
  gerado_por                TEXT    NOT NULL,
  gerado_em                 TEXT    NOT NULL,
  provider                  TEXT,
  instrucao_id              INTEGER,
  instrucao_versao          INTEGER,
  citacoes                  INTEGER,
  citacoes_nao_encontradas  INTEGER,
  html                      TEXT,
  tamanho_bytes             INTEGER,
  dados_json                TEXT,
  status                    TEXT    NOT NULL DEFAULT 'concluido',  -- concluido | erro
  erro_mensagem             TEXT,
  UNIQUE (reuniao_id, versao)
);

CREATE INDEX IF NOT EXISTS idx_dossies_reuniao_lead ON dossies_reuniao (lead_id, reuniao_id);
