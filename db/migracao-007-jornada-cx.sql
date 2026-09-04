-- ==========================================================
-- CRM Formatar — Migração 007
-- Jornada do cliente (trilha de CX): etapas, clientes,
-- núcleos de atendimento e papéis.
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-007-jornada-cx.sql
--
-- Seguro rodar duas vezes? SIM — ao contrário da 004 e da 005.
-- Esta migração não tem nenhum ALTER TABLE: só cria tabelas e
-- índices com IF NOT EXISTS e insere com WHERE NOT EXISTS.
-- Rodar de novo não duplica nada nem devolve erro.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. ETAPAS DA JORNADA — pipeline 'jornada'
--
-- Entram na MESMA tabela `etapas` do funil comercial, separadas
-- pela coluna `pipeline` criada na migração 005. É o que permite
-- ao quadro do Lote C servir as duas trilhas sem reescrita.
--
-- Uma instrução por etapa, e não um UNION ALL: o D1 limita o
-- número de termos em compound SELECT bem abaixo do SQLite
-- padrão, e a 004 já apanhou disso com seis etapas.
--
-- O WHERE NOT EXISTS é escopado POR PIPELINE. Sem o escopo, uma
-- etapa comercial de mesmo nome bloquearia a criação da etapa de
-- jornada — e "Encerrado" tem parentesco óbvio com "Finalizado".
--
-- Estes nomes são um ponto de partida, não um contrato: a tela
-- "Gerenciar etapas" renomeia, reordena, troca a cor e marca
-- terminal. Ajustar a jornada NÃO exige migração nova.
--
-- Expansão não é etapa. Pela decisão registrada no roadmap, ela é
-- acréscimo de produto ou serviço à entrega — não move o cartão.
-- ----------------------------------------------------------

INSERT INTO etapas (nome, cor, ordem, encerra, pipeline)
SELECT 'Contrato assinado', '#6b7280', 1, 0, 'jornada'
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Contrato assinado' AND pipeline = 'jornada');

INSERT INTO etapas (nome, cor, ordem, encerra, pipeline)
SELECT 'Boas-vindas', '#7c3aed', 2, 0, 'jornada'
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Boas-vindas' AND pipeline = 'jornada');

INSERT INTO etapas (nome, cor, ordem, encerra, pipeline)
SELECT 'Diagnóstico', '#2563eb', 3, 0, 'jornada'
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Diagnóstico' AND pipeline = 'jornada');

INSERT INTO etapas (nome, cor, ordem, encerra, pipeline)
SELECT 'Plano de ação', '#0891b2', 4, 0, 'jornada'
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Plano de ação' AND pipeline = 'jornada');

INSERT INTO etapas (nome, cor, ordem, encerra, pipeline)
SELECT 'Implantação', '#f2421a', 5, 0, 'jornada'
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Implantação' AND pipeline = 'jornada');

INSERT INTO etapas (nome, cor, ordem, encerra, pipeline)
SELECT 'Acompanhamento', '#c77700', 6, 0, 'jornada'
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Acompanhamento' AND pipeline = 'jornada');

INSERT INTO etapas (nome, cor, ordem, encerra, pipeline)
SELECT 'Estabilização', '#0d9488', 7, 0, 'jornada'
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Estabilização' AND pipeline = 'jornada');

INSERT INTO etapas (nome, cor, ordem, encerra, pipeline)
SELECT 'Governança', '#1f9d55', 8, 0, 'jornada'
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Governança' AND pipeline = 'jornada');

INSERT INTO etapas (nome, cor, ordem, encerra, pipeline)
SELECT 'Encerrado', '#d13438', 9, 1, 'jornada'
WHERE NOT EXISTS (SELECT 1 FROM etapas WHERE nome = 'Encerrado' AND pipeline = 'jornada');


-- ----------------------------------------------------------
-- 2. NÚCLEOS de atendimento
--
-- O núcleo é o Tipo de Reunião — o segundo dos três níveis que o
-- roadmap manda não confundir: Time é agrupamento interno,
-- Núcleo é o tipo de atendimento, e Carteira é cliente + núcleo.
--
-- A carteira em si não nasce aqui: ela depende das reuniões do
-- hub (Lote I). O que existe agora é o vocabulário.
--
-- Mesma mecânica de cadastro simplificado de advisors e tags:
-- nome único entre os ativos, exclusão lógica, e a trava de
-- exclusão condicional aplicada na API para poder explicar por quê.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS nucleos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT    NOT NULL,
  cor        TEXT    NOT NULL DEFAULT '#6e6e6e',
  criado_por TEXT    NOT NULL,
  criado_em  TEXT    NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nucleos_nome
  ON nucleos (nome COLLATE NOCASE)
  WHERE ativo = 1;

INSERT INTO nucleos (nome, cor, criado_por, criado_em)
SELECT 'Gestão Comercial', '#f2421a', 'migracao-007', '2026-09-04'
WHERE NOT EXISTS (SELECT 1 FROM nucleos WHERE nome = 'Gestão Comercial');

INSERT INTO nucleos (nome, cor, criado_por, criado_em)
SELECT 'Gestão de Pessoas', '#7c3aed', 'migracao-007', '2026-09-04'
WHERE NOT EXISTS (SELECT 1 FROM nucleos WHERE nome = 'Gestão de Pessoas');

INSERT INTO nucleos (nome, cor, criado_por, criado_em)
SELECT 'Gestão de Operações', '#2563eb', 'migracao-007', '2026-09-04'
WHERE NOT EXISTS (SELECT 1 FROM nucleos WHERE nome = 'Gestão de Operações');

INSERT INTO nucleos (nome, cor, criado_por, criado_em)
SELECT 'Gestão Financeira', '#1f9d55', 'migracao-007', '2026-09-04'
WHERE NOT EXISTS (SELECT 1 FROM nucleos WHERE nome = 'Gestão Financeira');

INSERT INTO nucleos (nome, cor, criado_por, criado_em)
SELECT 'Governança', '#c77700', 'migracao-007', '2026-09-04'
WHERE NOT EXISTS (SELECT 1 FROM nucleos WHERE nome = 'Governança');


-- ----------------------------------------------------------
-- 3. PAPÉIS das pessoas do cliente
--
-- Nasce VAZIA de propósito. Semear papéis inventados encheria a
-- lista de opções que ninguém escolheu, e o cadastro simplificado
-- (digitou, virou opção) resolve isso sem palpite meu.
--
-- Quem usa os papéis de verdade é o mapa de stakeholders do
-- Dossiê de Experiência (Lote L). Aqui fica só o vocabulário,
-- para que ele chegue e encontre a lista pronta.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS papeis (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT    NOT NULL,
  criado_por TEXT    NOT NULL,
  criado_em  TEXT    NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_papeis_nome
  ON papeis (nome COLLATE NOCASE)
  WHERE ativo = 1;


-- ----------------------------------------------------------
-- 4. CLIENTES — a trilha de CX
--
-- Tabela separada de `leads`, não uma coluna "virou cliente".
-- Captar cliente e cuidar de cliente são processos diferentes,
-- com campos, etapas e ciclo de vida próprios; espremer os dois
-- na mesma tabela deixaria metade das colunas nulas em cada linha.
--
-- Campos que o Lote F preenche e que aqui nascem nulos:
--
--   erp_id   — o ID do cliente no ERP da Formatar. Nulo significa
--              "cadastrado à mão, ainda não conferido no ERP". A
--              regra "todo cliente de CX tem que existir no ERP"
--              vira trava quando a chave do hub com escopo
--              ampliado chegar; até lá ela não tem como ser
--              verificada, e barrar o cadastro sem poder checar
--              deixaria a trilha inteira inutilizável.
--
--   lead_id  — de qual lead este cliente veio. Nulo é legítimo e
--              permanente: cliente que já existia antes do CRM
--              nunca passou pelo funil.
--
-- `classificacao` é a MESMA escala 1–6 do lead (migração 005),
-- porque é a escala que o ERP usa. Na conversão do Lote F ela é
-- herdada, não redigitada.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Identificação
  nome           TEXT    NOT NULL,          -- razão social
  nome_fantasia  TEXT,
  documento      TEXT    NOT NULL,          -- CNPJ, só dígitos

  -- Contato
  telefone       TEXT,
  email          TEXT,
  contato_nome   TEXT,
  cidade         TEXT,

  -- Posição na jornada (etapas do pipeline 'jornada')
  etapa_id       INTEGER,
  posicao        INTEGER NOT NULL DEFAULT 0,

  -- Núcleos atendidos: JSON com os IDs, ex.: [1,4]
  -- Guarda o ID e não o texto, como as tags do lead: renomear um
  -- núcleo não pode exigir varrer todos os clientes.
  nucleos        TEXT    NOT NULL DEFAULT '[]',

  classificacao  INTEGER,                   -- 1 a 6, mesma escala do lead
  data_inicio    TEXT,                      -- AAAA-MM-DD, entrada na jornada
  observacoes    TEXT,

  -- Preenchidos pelo Lote F
  erp_id         TEXT,
  lead_id        INTEGER,

  -- Auditoria e exclusão lógica, como em leads
  criado_por     TEXT    NOT NULL,
  criado_em      TEXT    NOT NULL,
  atualizado_por TEXT,
  atualizado_em  TEXT,
  ativo          INTEGER NOT NULL DEFAULT 1
);

-- O quadro lê por etapa e posição; é a consulta mais quente da tela.
CREATE INDEX IF NOT EXISTS idx_clientes_etapa
  ON clientes (ativo, etapa_id, posicao);

-- CNPJ único entre os ATIVOS. Parcial de propósito: um cliente
-- inativado precisa poder voltar com o mesmo CNPJ, e um índice
-- total impediria justamente isso.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_documento
  ON clientes (documento)
  WHERE ativo = 1;

CREATE INDEX IF NOT EXISTS idx_clientes_erp
  ON clientes (erp_id);

CREATE INDEX IF NOT EXISTS idx_clientes_lead
  ON clientes (lead_id);
