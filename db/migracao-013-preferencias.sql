-- ==========================================================
-- CRM Formatar — Migração 013
-- Preferências de tela, por usuário (2.28.0).
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-013-preferencias.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name = 'preferencias_usuario'"
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS.
--
-- A Fase 3 da 2.24.0 (aposentar núcleos da ficha e o cadastro de Papéis)
-- era a 012, virou 013 quando a 2.25.0 tomou o número, e agora passa a
-- 014.
-- ==========================================================

-- ----------------------------------------------------------
-- PREFERENCIAS_USUARIO
--
-- O que cada pessoa escolheu para as SUAS telas: quais colunas ver, em
-- que ordem, quantas linhas por página. Pedido de 21/09/2026: "salvando
-- por usuário". No navegador (localStorage) a escolha ficaria presa ao
-- computador; aqui ela segue a pessoa.
--
-- Uma linha por (e-mail, chave). `chave` nomeia a tela — hoje só
-- 'plano-colunas'. `valor` é JSON, e o formato é da tela que o grava:
-- o servidor só guarda e devolve.
--
-- Não é dado de negócio. Apagar uma linha só volta a tela ao padrão.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS preferencias_usuario (
  email          TEXT NOT NULL,
  chave          TEXT NOT NULL,
  valor          TEXT NOT NULL,
  atualizado_em  TEXT NOT NULL,
  PRIMARY KEY (email, chave)
);
