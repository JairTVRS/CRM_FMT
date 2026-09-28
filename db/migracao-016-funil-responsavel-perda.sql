-- ==========================================================
-- CRM Formatar — Migração 016
-- Funil arrumado (2.31.0): responsável do lead, motivos de perda,
-- encerramento em ganho/perdido e os usuários do CRM.
--
-- Aplicar ANTES do deploy da 2.31.0:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-016-funil-responsavel-perda.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT id, nome, encerra, resultado FROM etapas WHERE pipeline = 'comercial' AND ativo = 1 ORDER BY ordem"
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT COUNT(*) AS motivos FROM motivos_perda WHERE ativo = 1"
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT COUNT(*) AS sem_responsavel FROM leads WHERE ativo = 1 AND responsavel IS NULL"
--
-- Seguro rodar duas vezes? NÃO por inteiro. Os ALTER TABLE ADD COLUMN
-- falham na segunda vez com "duplicate column name" — inofensivo, quer
-- dizer que já estava aplicada. Os CREATE e os INSERT são idempotentes.
--
-- A Fase 3 da 2.24.0 (aposentar núcleos da ficha e o cadastro de Papéis)
-- estava reservada como 016 no ROADMAP; passa a ser a próxima livre.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. ETAPAS: o encerramento passa a dizer COMO encerra.
--
-- `encerra` sozinho não distinguia "Contrato emitido" de "Perdido", e
-- a conversão em cliente era oferecida nos dois. `resultado` só tem
-- sentido no funil comercial: 'ganho', 'perdido' ou nulo (em aberto).
-- A jornada do cliente continua usando só `encerra`.
-- ----------------------------------------------------------
ALTER TABLE etapas ADD COLUMN resultado TEXT;

-- O nome decide o lado em que a etapa terminal cai: o que fala em
-- perda é perdido, o resto é ganho. LIKE no SQLite ignora maiúsculas.
UPDATE etapas SET resultado = 'perdido'
 WHERE pipeline = 'comercial' AND encerra = 1 AND resultado IS NULL
   AND (nome LIKE '%perd%' OR nome LIKE '%cancel%');

UPDATE etapas SET resultado = 'ganho'
 WHERE pipeline = 'comercial' AND encerra = 1 AND resultado IS NULL;

-- "Finalizado" é o fim feliz do funil: o contrato emitido.
UPDATE etapas SET nome = 'Contrato emitido'
 WHERE pipeline = 'comercial' AND nome = 'Finalizado' AND ativo = 1;

-- ----------------------------------------------------------
-- 2. LEADS: responsável e motivo da perda.
--
-- `responsavel` é o E-MAIL de um usuário do CRM — o login é por e-mail,
-- e é o que sobrevive à troca de nome. Nulo = sem responsável (os
-- prospects que vierem do ERP entram assim).
--
-- "Quem atendeu" (`atendente`) continua como estava: texto livre,
-- histórico da planilha. Não é a mesma coisa.
-- ----------------------------------------------------------
ALTER TABLE leads ADD COLUMN responsavel TEXT;
ALTER TABLE leads ADD COLUMN motivo_perda_id INTEGER;
ALTER TABLE leads ADD COLUMN motivo_perda_obs TEXT;

-- Os leads que já existem ficam com quem os cadastrou.
UPDATE leads SET responsavel = LOWER(criado_por)
 WHERE responsavel IS NULL AND criado_por LIKE '%@%';

CREATE INDEX IF NOT EXISTS idx_leads_responsavel ON leads (responsavel, ativo);

-- ----------------------------------------------------------
-- 3. MOTIVOS_PERDA — cadastro nas Configurações, só admin edita.
--
-- Os leads que já estavam em Perdido ficam com motivo nulo, que a tela
-- mostra como "não informado". Inventar um motivo para eles seria pior.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS motivos_perda (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT    NOT NULL,
  ordem      INTEGER NOT NULL DEFAULT 0,
  criado_por TEXT    NOT NULL,
  criado_em  TEXT    NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_motivos_perda_nome
  ON motivos_perda (nome COLLATE NOCASE)
  WHERE ativo = 1;

-- Os cinco modelos iniciais. Uma instrução por linha: o D1 recusa
-- UNION ALL comprido (ver a migração 004).
INSERT INTO motivos_perda (nome, ordem, criado_por, criado_em)
SELECT 'Preço acima do esperado', 1, 'migracao-016', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM motivos_perda WHERE nome = 'Preço acima do esperado');

INSERT INTO motivos_perda (nome, ordem, criado_por, criado_em)
SELECT 'Sem prioridade no momento', 2, 'migracao-016', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM motivos_perda WHERE nome = 'Sem prioridade no momento');

INSERT INTO motivos_perda (nome, ordem, criado_por, criado_em)
SELECT 'Fechou com concorrente', 3, 'migracao-016', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM motivos_perda WHERE nome = 'Fechou com concorrente');

INSERT INTO motivos_perda (nome, ordem, criado_por, criado_em)
SELECT 'Sem retorno do lead', 4, 'migracao-016', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM motivos_perda WHERE nome = 'Sem retorno do lead');

INSERT INTO motivos_perda (nome, ordem, criado_por, criado_em)
SELECT 'Fora do perfil atendido', 5, 'migracao-016', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM motivos_perda WHERE nome = 'Fora do perfil atendido');

-- ----------------------------------------------------------
-- 4. USUARIOS_CRM — quem já entrou no CRM.
--
-- O hub tem todos os operadores da Formatar; a lista de responsáveis
-- mostra só quem usa o CRM. Cada abertura do app (GET /api/me) grava
-- ou atualiza a linha de quem entrou.
--
-- Semeada com quem já cadastrou lead: essas pessoas entraram no CRM,
-- só não havia onde isso ficasse registrado. O nome chega no próximo
-- acesso delas; até lá, a tela mostra o e-mail.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios_crm (
  email            TEXT PRIMARY KEY,
  nome             TEXT,
  hub_id           TEXT,
  grupo            TEXT,
  primeiro_acesso  TEXT NOT NULL,
  ultimo_acesso    TEXT NOT NULL
);

INSERT OR IGNORE INTO usuarios_crm (email, nome, primeiro_acesso, ultimo_acesso)
SELECT LOWER(criado_por), NULL, MIN(criado_em), MAX(criado_em)
  FROM leads
 WHERE criado_por LIKE '%@%'
 GROUP BY LOWER(criado_por);
