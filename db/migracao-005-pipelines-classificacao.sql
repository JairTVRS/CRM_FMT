-- ==========================================================
-- CRM Formatar — Migração 005
-- Pipeline nas etapas e classificação do lead.
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-005-pipelines-classificacao.sql
--
-- Seguro rodar duas vezes? NÃO — mesma razão da 004: o SQLite não tem
-- "ADD COLUMN IF NOT EXISTS", e a segunda execução devolve
-- "duplicate column name". O erro é inofensivo: significa apenas que a
-- migração já estava aplicada.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. PIPELINE nas etapas
--
-- O quadro nasce genérico de propósito. A jornada do cliente — as nove
-- etapas do CX — é outro pipeline na mesma tabela, e vai reaproveitar o
-- mesmo componente de quadro sem reescrita. Construir o quadro duas
-- vezes seria o desperdício mais caro do projeto.
--
-- As seis etapas que já existem caem em 'comercial' pelo DEFAULT, sem
-- precisar de UPDATE.
-- ----------------------------------------------------------
ALTER TABLE etapas ADD COLUMN pipeline TEXT NOT NULL DEFAULT 'comercial';

CREATE INDEX IF NOT EXISTS idx_etapas_pipeline
  ON etapas (pipeline, ativo, ordem);

-- ----------------------------------------------------------
-- 2. CLASSIFICAÇÃO do lead — escala 1 a 6
--
-- Critério interno de avaliação da complexidade do projeto. Nasce no
-- lead, durante a fase comercial, e é herdada pelo cliente no momento
-- da conversão (Lote F) — o ERP usa a mesma escala.
--
-- Inteiro, não texto e sem tabela de apoio: a escala é fixa, e inteiro
-- permite filtrar por faixa e ordenar.
-- ----------------------------------------------------------
ALTER TABLE leads ADD COLUMN classificacao INTEGER;

CREATE INDEX IF NOT EXISTS idx_leads_classificacao
  ON leads (ativo, classificacao);
