-- ==========================================================
-- CRM Formatar — Migração 004
-- Campos do funil comercial, cadastros de apoio e etapas.
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-004-funil.sql
--
-- Seguro rodar duas vezes? NÃO. O SQLite não tem
-- "ADD COLUMN IF NOT EXISTS"; a segunda execução retorna
-- "duplicate column name", o que é inofensivo — significa
-- apenas que já estava aplicada.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. ADVISORS — cadastro simplificado, criado ao digitar.
--    Exclusão bloqueada quando houver lead vinculado (regra
--    aplicada na API, não aqui, para poder devolver mensagem).
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS advisors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT    NOT NULL,
  criado_por TEXT    NOT NULL,
  criado_em  TEXT    NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1
);

-- Nome único entre os ativos, sem diferenciar maiúsculas
CREATE UNIQUE INDEX IF NOT EXISTS idx_advisors_nome
  ON advisors (nome COLLATE NOCASE)
  WHERE ativo = 1;

-- ----------------------------------------------------------
-- 2. TAGS — lista global compartilhada. Um lead pode ter
--    várias; os vínculos ficam num JSON na tabela leads,
--    guardando o ID (não o texto), para que renomear uma tag
--    não exija varrer todos os leads.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT    NOT NULL,
  cor        TEXT    NOT NULL DEFAULT '#6e6e6e',
  criado_por TEXT    NOT NULL,
  criado_em  TEXT    NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_nome
  ON tags (nome COLLATE NOCASE)
  WHERE ativo = 1;

-- ----------------------------------------------------------
-- 3. ETAPAS — colunas do funil, configuráveis pela engrenagem.
--    "encerra" marca as etapas terminais (Perdido, Finalizado),
--    que o quadro trata de forma diferente das demais.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS etapas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT    NOT NULL,
  cor       TEXT    NOT NULL DEFAULT '#6e6e6e',
  ordem     INTEGER NOT NULL,
  encerra   INTEGER NOT NULL DEFAULT 0,
  ativo     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_etapas_ordem
  ON etapas (ativo, ordem);

-- Etapas iniciais.
--
-- Uma instrução por etapa, e não um UNION ALL: o D1 limita o número
-- de termos em compound SELECT bem abaixo do SQLite padrão, e a
-- versão com seis UNION ALL foi recusada com
-- "too many terms in compound SELECT".
--
-- O WHERE NOT EXISTS por nome torna cada linha idempotente: rodar
-- de novo não duplica, e uma etapa que o usuário tenha excluído
-- não é recriada por engano (ela continua na tabela com ativo = 0).

INSERT INTO etapas (nome, cor, ordem, encerra)
SELECT 'Novo Lead', '#6b7280', 1, 0
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Novo Lead');

INSERT INTO etapas (nome, cor, ordem, encerra)
SELECT 'Qualificação', '#f2421a', 2, 0
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Qualificação');

INSERT INTO etapas (nome, cor, ordem, encerra)
SELECT 'Proposta', '#2563eb', 3, 0
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Proposta');

INSERT INTO etapas (nome, cor, ordem, encerra)
SELECT 'Negociação', '#c77700', 4, 0
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Negociação');

INSERT INTO etapas (nome, cor, ordem, encerra)
SELECT 'Finalizado', '#1f9d55', 5, 1
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Finalizado');

INSERT INTO etapas (nome, cor, ordem, encerra)
SELECT 'Perdido', '#d13438', 6, 1
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Perdido');


-- ----------------------------------------------------------
-- 4. LEADS — campos do funil e da planilha
-- ----------------------------------------------------------

-- Canal substitui "origem": mesma dimensão, nome da planilha.
-- A coluna origem permanece para não perder o que já foi
-- cadastrado; a API passa a ler e gravar em canal.
ALTER TABLE leads ADD COLUMN canal TEXT;

-- Quem atendeu: usuário do app (e-mail vindo do ID token)
ALTER TABLE leads ADD COLUMN atendente TEXT;

-- Advisor: referência ao cadastro
ALTER TABLE leads ADD COLUMN advisor_id INTEGER;

-- Datas do acompanhamento comercial (ISO 8601, só data)
ALTER TABLE leads ADD COLUMN data_cadastro TEXT;
ALTER TABLE leads ADD COLUMN data_ultimo_contato TEXT;
ALTER TABLE leads ADD COLUMN data_proximo_contato TEXT;
ALTER TABLE leads ADD COLUMN data_fechamento TEXT;

-- Valores em centavos: evita erro de arredondamento de ponto
-- flutuante em soma de coluna do kanban
ALTER TABLE leads ADD COLUMN valor_proposta INTEGER;
ALTER TABLE leads ADD COLUMN valor_diagnostico INTEGER;

-- Posição no funil
ALTER TABLE leads ADD COLUMN etapa_id INTEGER;
ALTER TABLE leads ADD COLUMN posicao INTEGER NOT NULL DEFAULT 0;

-- Tags: JSON com os IDs, ex.: [1,4,7]
ALTER TABLE leads ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';

-- Índices do quadro e dos filtros
CREATE INDEX IF NOT EXISTS idx_leads_etapa
  ON leads (ativo, etapa_id, posicao);

CREATE INDEX IF NOT EXISTS idx_leads_advisor
  ON leads (advisor_id);

CREATE INDEX IF NOT EXISTS idx_leads_proximo_contato
  ON leads (ativo, data_proximo_contato);

-- ----------------------------------------------------------
-- 5. Leads existentes entram no funil e herdam a origem
-- ----------------------------------------------------------
UPDATE leads
   SET etapa_id = (SELECT id FROM etapas WHERE ordem = 1 LIMIT 1)
 WHERE etapa_id IS NULL;

UPDATE leads
   SET canal = origem
 WHERE canal IS NULL AND origem IS NOT NULL;

UPDATE leads
   SET data_cadastro = substr(criado_em, 1, 10)
 WHERE data_cadastro IS NULL
