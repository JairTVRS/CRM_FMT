-- ==========================================================
-- CRM Formatar — Migração 021
-- Iniciar e finalizar a reunião do lead (2.36.0).
--
-- Aplicar ANTES do deploy da 2.36.0:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-021-reuniao-iniciar-finalizar.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('agenda_lead') WHERE name IN ('iniciada_em', 'iniciada_por', 'finalizada_em', 'finalizada_por')"
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name = 'idx_agenda_uma_em_andamento'"
--
-- Seguro rodar duas vezes? NÃO: ALTER TABLE ... ADD COLUMN falha na
-- segunda vez ("duplicate column"). O índice é IF NOT EXISTS.
--
-- Aplicada no D1 remoto em 30/09/2026. O --file falhou com
-- "Authentication error [code: 10000]" (ele usa a rota /import, que o
-- login OAuth desta máquina não alcança); os mesmos comandos foram
-- mandados por --command="...", que usa a rota de consulta, e conferidos.
-- ==========================================================

-- ----------------------------------------------------------
-- Pedido de 30/09/2026: o CX INICIA e FINALIZA a reunião, e o CRM guarda
-- o dia e a hora reais de cada um. A hora marcada (`inicio`) continua a
-- ser a do agendamento; estas são as do que aconteceu.
--
-- Instantes em ISO UTC (como `gravacoes.iniciada_em`), não no texto de
-- Brasília da agenda: são carimbos de relógio, gravados pelo servidor, e
-- a tela os mostra na hora local.
--
-- Os estados que a tela desenha saem daqui, sem status novo:
--   iniciada_em nulo, status 'agendada'   → agendada (amarela ou, passada
--                                           a hora, vermelha: atrasada)
--   iniciada_em e finalizada_em nulo      → em andamento (verde)
--   finalizada_em                         → realizada
-- Um status 'em_andamento' obrigaria a mexer no cálculo do próximo
-- contato, na importação e em tudo que já lê 'agendada'.
-- ----------------------------------------------------------
ALTER TABLE agenda_lead ADD COLUMN iniciada_em    TEXT;
ALTER TABLE agenda_lead ADD COLUMN iniciada_por   TEXT;
ALTER TABLE agenda_lead ADD COLUMN finalizada_em  TEXT;
ALTER TABLE agenda_lead ADD COLUMN finalizada_por TEXT;

-- ----------------------------------------------------------
-- UMA REUNIÃO EM ANDAMENTO POR PESSOA. A API já confere antes de
-- iniciar; o índice garante no banco, também contra dois cliques ao
-- mesmo tempo em duas abas.
-- ----------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_uma_em_andamento
  ON agenda_lead (iniciada_por)
  WHERE iniciada_em IS NOT NULL AND finalizada_em IS NULL AND ativo = 1;
