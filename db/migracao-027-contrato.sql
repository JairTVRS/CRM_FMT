-- ==========================================================
-- CRM Formatar — Migração 027
-- Contrato (Lote G, 2.40.0): o km e a forma de preço do lead, quem
-- assina pelo cliente, os cadastros de formas de preço e de empresas
-- contratadas, e os contratos gerados.
--
-- ⚠️ NÃO É SEGURA PARA RODAR DUAS VEZES: os `ALTER TABLE ADD COLUMN`
-- abortam com "duplicate column name" na segunda vez. As tabelas e os
-- INSERT OR IGNORE são seguros.
--
-- CONFIRA ANTES:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('leads') WHERE name = 'km_valor'"
-- Se aparecer `km_valor`, os ALTER já foram — aplique só o resto.
--
-- Aplicar pelo --command, um comando por instrução (o --file falha com
-- "Authentication error [code: 10000]" nesta máquina — ver a 021).
--
-- CONFIRA DEPOIS:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('leads') WHERE name LIKE 'rep_%' OR name IN ('km_valor','forma_preco_id','contratada_id')"
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT id, nome, ativa FROM formas_preco ORDER BY ordem"
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT id, razao_social, cnpj, padrao FROM contratadas"
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('contratos', 'idx_contratos_lead')"
--
-- Aplicada no D1 remoto em 05/10/2026, pelo --command (20 instruções), e
-- conferida: 9 colunas, 3 tabelas e o índice; as 6 formas com o texto
-- idêntico ao do código (acentos e quebras de linha intactos).
-- ==========================================================

-- ----------------------------------------------------------
-- LEADS — o que o contrato pede e só o lead sabe
--
-- Decidido com o Jair em 05/10/2026: o km é negociado por lead (não é
-- política do sistema); os dados do cliente vêm do lead.
--
-- km_valor         centavos por quilômetro rodado (175 = R$ 1,75).
--                  Nulo: o contrato e a proposta usam R$ 1,75.
-- forma_preco_id   formas_preco.id — como o preço é cobrado.
-- contratada_id    contratadas.id. Nulo: a contratada padrão.
-- rep_*            quem assina pelo cliente: nome, CPF (só dígitos),
--                  nacionalidade, estado civil, profissão e a cidade
--                  onde reside. Em lead com CPF (pessoa física), servem
--                  de qualificação da própria pessoa.
-- ----------------------------------------------------------
ALTER TABLE leads ADD COLUMN km_valor INTEGER;
ALTER TABLE leads ADD COLUMN forma_preco_id INTEGER;
ALTER TABLE leads ADD COLUMN contratada_id INTEGER;
ALTER TABLE leads ADD COLUMN rep_nome TEXT;
ALTER TABLE leads ADD COLUMN rep_cpf TEXT;
ALTER TABLE leads ADD COLUMN rep_nacionalidade TEXT;
ALTER TABLE leads ADD COLUMN rep_estado_civil TEXT;
ALTER TABLE leads ADD COLUMN rep_profissao TEXT;
ALTER TABLE leads ADD COLUMN rep_residencia TEXT;

-- ----------------------------------------------------------
-- FORMAS_PRECO — como o preço é cobrado (só admin altera)
--
-- `texto` é a cláusula de preço, com marcadores ({valor_mensal},
-- {meses}…) que saem preenchidos da proposta — a lista está em
-- functions/api/_lib/forma-preco.js. Uma linha em branco separa itens.
--
-- `ativa` = 0 é a forma INATIVA: some das opções do lead, mas quem já
-- a usa continua com ela. Excluir apaga a linha de verdade, e só é
-- permitido sem lead vinculado (decisão do Jair, 05/10/2026).
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS formas_preco (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  texto           TEXT    NOT NULL,
  ordem           INTEGER NOT NULL DEFAULT 0,
  ativa           INTEGER NOT NULL DEFAULT 1,
  criado_por      TEXT    NOT NULL,
  criado_em       TEXT    NOT NULL,
  atualizado_por  TEXT,
  atualizado_em   TEXT
);

-- ----------------------------------------------------------
-- CONTRATADAS — quem presta o serviço (só admin altera)
--
-- A Formatar Consultoria Empresarial Ltda é a padrão; outros CNPJs
-- podem ser cadastrados. `representantes`: JSON com quem assina pela
-- contratada — [{nome, cpf, nacionalidade, estado_civil, cargo,
-- residencia}]. Nasce vazio: os representantes são cadastrados nas
-- Configurações antes do primeiro contrato.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS contratadas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  razao_social    TEXT    NOT NULL,
  cnpj            TEXT    NOT NULL UNIQUE,
  endereco        TEXT,
  cidade          TEXT,
  cep             TEXT,
  representantes  TEXT    NOT NULL DEFAULT '[]',
  padrao          INTEGER NOT NULL DEFAULT 0,
  ativa           INTEGER NOT NULL DEFAULT 1,
  criado_por      TEXT    NOT NULL,
  criado_em       TEXT    NOT NULL,
  atualizado_por  TEXT,
  atualizado_em   TEXT
);

-- ----------------------------------------------------------
-- CONTRATOS — um por versão, como os outros documentos
-- (_lib/versionamento.js). Chave: o lead. `proposta_versao`: de qual
-- versão da proposta saíram o escopo e os valores.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS contratos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id          INTEGER NOT NULL,
  cliente_nome     TEXT,
  documento        TEXT,
  contratada_id    INTEGER,
  proposta_versao  INTEGER,
  versao           INTEGER NOT NULL,
  gerado_por       TEXT    NOT NULL,
  gerado_em        TEXT    NOT NULL,
  html             TEXT,
  tamanho_bytes    INTEGER,
  dados_json       TEXT,
  status           TEXT    NOT NULL DEFAULT 'concluido',  -- concluido | erro
  erro_mensagem    TEXT,
  UNIQUE (lead_id, versao)
);

CREATE INDEX IF NOT EXISTS idx_contratos_lead ON contratos (lead_id, status, versao DESC);

-- ----------------------------------------------------------
-- As formas sugeridas (05/10/2026). Os textos são os mesmos de
-- FORMAS_SUGERIDAS em functions/api/_lib/forma-preco.js — a prova
-- contrato.mjs confere. char(10) é a quebra de linha.
-- ----------------------------------------------------------
INSERT OR IGNORE INTO formas_preco (nome, texto, ordem, criado_por, criado_em) VALUES ('Diagnóstico + consultoria mensal', 'A) Diagnóstico – O investimento para a realização do diagnóstico é de {valor_diagnostico}, pago da seguinte forma: {condicoes_diagnostico}, por meio de notas fiscais e boletos bancários de emissão da CONTRATADA;' || char(10) || char(10) || 'B) Consultoria – O investimento mensal para a realização do trabalho previsto é de {valor_mensal}, a ser pago durante {meses} meses, com início {inicio_consultoria} ({condicoes_consultoria}), por meio de boletos bancários de emissão da CONTRATADA.', 1, 'migracao-027', '2026-10-05T00:00:00.000Z');
INSERT OR IGNORE INTO formas_preco (nome, texto, ordem, criado_por, criado_em) VALUES ('Diagnóstico isento + consultoria mensal', 'A) Diagnóstico – Isento de cobrança.' || char(10) || char(10) || 'B) Consultoria – O investimento mensal para a realização do trabalho previsto é de {valor_mensal}, a ser pago durante {meses} meses, com início {inicio_consultoria} ({condicoes_consultoria}), por meio de boletos bancários de emissão da CONTRATADA.', 2, 'migracao-027', '2026-10-05T00:00:00.000Z');
INSERT OR IGNORE INTO formas_preco (nome, texto, ordem, criado_por, criado_em) VALUES ('Só diagnóstico', 'A) Diagnóstico – O investimento para a realização do diagnóstico é de {valor_diagnostico}, pago da seguinte forma: {condicoes_diagnostico}, por meio de notas fiscais e boletos bancários de emissão da CONTRATADA.', 3, 'migracao-027', '2026-10-05T00:00:00.000Z');
INSERT OR IGNORE INTO formas_preco (nome, texto, ordem, criado_por, criado_em) VALUES ('Só consultoria mensal', 'A) Consultoria – O investimento mensal para a realização do trabalho previsto é de {valor_mensal}, a ser pago durante {meses} meses, com início {inicio_consultoria} ({condicoes_consultoria}), por meio de boletos bancários de emissão da CONTRATADA.', 4, 'migracao-027', '2026-10-05T00:00:00.000Z');
INSERT OR IGNORE INTO formas_preco (nome, texto, ordem, criado_por, criado_em) VALUES ('Projeto em parcelas', 'A) Projeto – O investimento para a realização dos trabalhos descritos na Cláusula I é de {valor_projeto}, pago em {parcelas} parcelas mensais e sucessivas, por meio de notas fiscais e boletos bancários de emissão da CONTRATADA.', 5, 'migracao-027', '2026-10-05T00:00:00.000Z');
INSERT OR IGNORE INTO formas_preco (nome, texto, ordem, criado_por, criado_em) VALUES ('Valor por hora', 'A) Horas – Os trabalhos serão remunerados a {valor_hora} por hora trabalhada, assim considerado o tempo definido na Cláusula V, alínea c, apurados mensalmente e pagos por meio de notas fiscais e boletos bancários de emissão da CONTRATADA.', 6, 'migracao-027', '2026-10-05T00:00:00.000Z');

-- A contratada padrão, do cartão CNPJ (docs/Cartão CNPJ Formatar.pdf,
-- emitido em 27/08/2026). Sem representantes: cadastrar nas
-- Configurações.
INSERT OR IGNORE INTO contratadas (razao_social, cnpj, endereco, cidade, cep, padrao, criado_por, criado_em) VALUES ('Formatar Consultoria Empresarial Ltda', '07091149000172', 'Av. Sete de Setembro, 1470, Apto 301, Centro', 'Divinópolis/MG', '35500011', 1, 'migracao-027', '2026-10-05T00:00:00.000Z');
