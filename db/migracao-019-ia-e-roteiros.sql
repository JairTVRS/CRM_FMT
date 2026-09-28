-- ==========================================================
-- CRM Formatar — Migração 019
-- Chaves de IA no CRM e roteiros por tipo de reunião (2.34.0).
--
-- Aplicar ANTES do deploy da 2.34.0:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-019-ia-e-roteiros.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('chaves_ia', 'config_geral', 'roteiros')"
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. CHAVES_IA — a chave de cada provedor, cadastrada pelo admin na
-- tela, para não depender do painel da Cloudflare.
--
-- `cifrada` é AES-GCM com o segredo CHAVES_SECRET do ambiente: quem lê o
-- banco não lê a chave. `final` são os 4 últimos caracteres, que é tudo o
-- que a tela mostra ("••••1a2b") — a chave NUNCA volta ao navegador.
--
-- A chave do painel da Cloudflare, quando existe, vale primeiro.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS chaves_ia (
  provedor        TEXT PRIMARY KEY,         -- chatgpt | deepseek | claude | gemini
  cifrada         TEXT NOT NULL,
  final           TEXT NOT NULL,
  atualizado_por  TEXT NOT NULL,
  atualizado_em   TEXT NOT NULL
);

-- ----------------------------------------------------------
-- 2. CONFIG_GERAL — escolhas do sistema, uma por chave. Hoje só
-- 'provedor_ativo'. Antes a escolha do provedor ficava no navegador de
-- cada um (localStorage), e o dossiê nem a lia.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_geral (
  chave           TEXT PRIMARY KEY,
  valor           TEXT,
  atualizado_por  TEXT NOT NULL,
  atualizado_em   TEXT NOT NULL
);

-- ----------------------------------------------------------
-- 3. ROTEIROS — o roteiro de cada tipo de reunião (tipos do hub, Time
-- Vendas), enviado como arquivo .md nas Configurações. Decidido em
-- 28/09/2026: "o roteiro será um arquivo que será feito upload na config,
-- pois pode mudar muito; a IA lê, interpreta e segue".
--
-- Enviar de novo NÃO sobrescreve: cria a versão seguinte. A reunião vai
-- registrar qual versão usou (2.35.0), então mudar o roteiro não reescreve
-- o que já aconteceu.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS roteiros (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_reuniao_erp_id   TEXT    NOT NULL,
  tipo_reuniao_nome     TEXT,
  versao                INTEGER NOT NULL,
  nome_arquivo          TEXT,
  conteudo              TEXT    NOT NULL,
  tamanho               INTEGER NOT NULL,
  enviado_por           TEXT    NOT NULL,
  enviado_em            TEXT    NOT NULL,
  ativo                 INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roteiros_tipo_versao
  ON roteiros (tipo_reuniao_erp_id, versao);
