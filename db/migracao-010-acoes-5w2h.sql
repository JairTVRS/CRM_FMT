-- ==========================================================
-- CRM Formatar — Migração 010
-- O registro das ações do CRM: numeração por cliente e o 5W2H
-- que a ata não tem (Lote I).
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-010-acoes-5w2h.sql
--
-- Conferir DEPOIS de aplicar (a segunda metade da convenção, a que
-- faltou na 006 e custou um dia de proposta quebrada no ar):
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name LIKE '%acoes%'"
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS, sem
-- nenhum ALTER TABLE — ao contrário da 009.
-- ==========================================================

-- ----------------------------------------------------------
-- ACOES_CX — duas coisas que o ERP não tem
--
-- 1. A NUMERAÇÃO POR CLIENTE
--
-- Na ata, a sequência de ações é por TIPO DE REUNIÃO: o Comercial
-- tem as suas 1, 2, 3 e o Financeiro tem as dele, começando de 1
-- também. Num cliente com três carteiras isso produz três "AÇÃO 1",
-- e numa tela que lista o cliente inteiro elas colidem — não dá
-- para dizer "a ação 2 da Alphatex" sem ambiguidade.
--
-- O CRM passa a dar um número por CLIENTE, corrido e independente
-- da sequência do tipo de reunião. O identificador na tela fica
-- `N.M`: N é o número do cliente, M é o número da ação no tipo de
-- reunião. Alphatex 1.1, 2.1, 3.2...
--
-- POR QUE ELE PRECISA SER GRAVADO, e não calculado na hora:
-- calculado, ele RENUMERARIA sozinho. Quando a ação 1 fosse
-- concluída e saísse do plano, a ação 2 viraria 1, e "Alphatex
-- ação 2" passaria a significar outra coisa na semana seguinte.
-- É o mesmo defeito que o manual v2.3 evita ao dizer que o ID
-- nasce e morre com a ação e nunca é reciclado.
--
-- Consequência assumida: a LEITURA do plano ESCREVE aqui. Abrir a
-- tela pela primeira vez atribui os números que faltam.
--
-- 2. OS QUATRO CAMPOS DO 5W2H QUE A ATA NÃO TEM
--
-- A ata dá três dos sete: What (a descrição da AÇÃO), Who
-- (`Resp.:`) e When (`Prazo:`). Why, Where, How e How much não
-- existem no texto, e a decisão de 06/09/2026 foi que a CX os
-- preenche — não que uma IA os invente. Este é um plano que as
-- pessoas cobram umas das outras; sugestão não confirmada vira
-- verdade com o tempo.
--
-- O QUE ESTA TABELA **NÃO** GUARDA: a ata, a descrição da ação, o
-- responsável, o prazo e o status. Tudo isso continua vindo do ERP
-- a cada leitura. O CRM não replica o ERP — guarda o que anota por
-- cima, e é só isso que está aqui.
--
-- A CHAVE DA LINHA É (carteira, número da ação no ERP).
--
-- O manual v2.3 diz que o ID da ação nasce e morre com ela e que a
-- sequência é POR CARTEIRA. A mesma AÇÃO 7 reaparece nas atas
-- seguintes até ser encerrada — chavear por reunião faria a
-- anotação se perder na semana seguinte, que é justamente quando
-- ela passa a valer.
--
-- IDs do hub são ObjectId de 24 caracteres: TEXT, não INTEGER.
--
-- Sem FOREIGN KEY, como no resto do esquema: cliente e carteira
-- vivem no ERP, não aqui. Não há a que apontar.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS acoes_cx (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Quem é, do lado do ERP
  cliente_erp_id  TEXT    NOT NULL,   -- ObjectId do cliente
  carteira_erp_id TEXT    NOT NULL,   -- ObjectId da carteira
  acao_numero     INTEGER NOT NULL,   -- o M de "AÇÃO M:" na ata

  -- A numeração do CRM. Atribuída na primeira vez que a ação é
  -- vista e NUNCA reaproveitada, nem depois de a ação fechar.
  numero_cliente  INTEGER NOT NULL,

  -- Cópia do que a ata dizia QUANDO a anotação foi feita.
  -- Redundante de propósito, e não é replicação: serve para a tela
  -- perceber que a ação mudou de texto desde então e avisar, em vez
  -- de mostrar um "Como" que responde a outra pergunta.
  descricao_vista TEXT,

  -- Os quatro que faltam no 5W2H. O que a CX escreve.
  porque          TEXT,               -- Why
  onde            TEXT,               -- Where
  como            TEXT,               -- How
  quanto          TEXT,               -- How much

  observacoes     TEXT,

  criado_por      TEXT    NOT NULL,
  criado_em       TEXT    NOT NULL,
  atualizado_por  TEXT,
  atualizado_em   TEXT,

  -- Uma linha por ação da carteira. Duas seriam duas respostas
  -- para a mesma pergunta.
  UNIQUE (carteira_erp_id, acao_numero),

  -- E dois números iguais no mesmo cliente destruiriam a razão de
  -- a numeração existir. É esta trava que resolve a corrida entre
  -- duas pessoas abrindo a tela ao mesmo tempo: a segunda colide,
  -- recalcula e pega o número seguinte.
  UNIQUE (cliente_erp_id, numero_cliente)
);

-- A consulta quente é "as ações desta carteira", para cruzar com o
-- que veio da ata.
CREATE INDEX IF NOT EXISTS idx_acoes_cx_carteira
  ON acoes_cx (carteira_erp_id);

-- E "qual o próximo número deste cliente", na atribuição.
CREATE INDEX IF NOT EXISTS idx_acoes_cx_cliente
  ON acoes_cx (cliente_erp_id, numero_cliente);
