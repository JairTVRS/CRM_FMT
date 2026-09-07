-- ===========================================================================
-- Migração 011 — desde quando o registro está na etapa em que está
--
-- POR QUE ISTO EXISTE
--
-- O Dossiê de Experiência da ALPHATEX afirmou, com "CONFIANÇA ALTA", que
-- a conta estava "estagnada na etapa de Diagnóstico há mais de 83 meses".
-- O CRM não sabia disso. Ele sabia duas coisas separadas:
--
--   data_inicio = 2019-09-11   (início do contrato, vindo do ERP)
--   etapa_id    = Diagnóstico  (atribuída na importação em massa de 2026)
--
-- O modelo somou as duas como se fossem a mesma, e o documento saiu com
-- uma afirmação grave sobre um cliente real de sete anos. A etapa tinha
-- sido posta um dia antes, para testar o fluxo.
--
-- Nenhum prompt conserta isso: o dado que faltava não existia. Passa a
-- existir aqui.
--
--
-- NULO É RESPOSTA
--
-- Toda linha existente nasce com `etapa_desde` NULO, e é o correto: o
-- CRM realmente não sabe desde quando elas estão onde estão. Nulo quer
-- dizer "não sei" e o dossiê é proibido de falar em tempo de etapa
-- enquanto for nulo — o oposto de preencher com a data de hoje, que
-- transformaria ignorância em fato.
--
--
-- POR QUE GATILHO, E NÃO CÓDIGO
--
-- Existem SEIS caminhos de escrita que põem um registro numa etapa:
-- criação de cliente, conversão de lead, importação de planilha, os dois
-- caminhos do hub e o arraste do cartão. Espalhar a regra por seis
-- lugares é convidar o sétimo a esquecer dela — e esquecer aqui não dá
-- erro, dá silêncio, que foi exatamente como o defeito original passou.
--
-- O gatilho vale para todo caminho, inclusive os que ainda não existem.
-- A contrapartida é honesta: é lógica invisível para quem lê só o JS.
-- Por isso está documentada aqui e apontada no código.
--
-- Reordenar cartão dentro da MESMA coluna não mexe na data: o gatilho
-- compara com `IS NOT`, que trata NULO corretamente. Sem isso, arrastar
-- um cartão dois centímetros zeraria o tempo de etapa.
--
--
-- NÃO É SEGURA PARA RODAR DUAS VEZES — usa ALTER TABLE, e o SQLite não
-- tem ADD COLUMN IF NOT EXISTS. Confira antes e depois de aplicar.
-- ===========================================================================

ALTER TABLE clientes ADD COLUMN etapa_desde TEXT;
ALTER TABLE leads    ADD COLUMN etapa_desde TEXT;

-- --- clientes ---------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS clientes_etapa_desde_ins
AFTER INSERT ON clientes
WHEN NEW.etapa_id IS NOT NULL AND NEW.etapa_desde IS NULL
BEGIN
  UPDATE clientes SET etapa_desde = date('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS clientes_etapa_desde_upd
AFTER UPDATE OF etapa_id ON clientes
WHEN NEW.etapa_id IS NOT OLD.etapa_id
BEGIN
  UPDATE clientes SET etapa_desde = date('now') WHERE id = NEW.id;
END;

-- --- leads ------------------------------------------------------------
--
-- O funil ganha o mesmo campo. Não é escopo do dossiê, mas "há quanto
-- tempo este lead está parado nesta etapa" é a mesma pergunta, e deixar
-- só metade das tabelas com a coluna criaria a assimetria que o
-- `comandosDeMover` — genérico para as duas — teria de contornar.

CREATE TRIGGER IF NOT EXISTS leads_etapa_desde_ins
AFTER INSERT ON leads
WHEN NEW.etapa_id IS NOT NULL AND NEW.etapa_desde IS NULL
BEGIN
  UPDATE leads SET etapa_desde = date('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS leads_etapa_desde_upd
AFTER UPDATE OF etapa_id ON leads
WHEN NEW.etapa_id IS NOT OLD.etapa_id
BEGIN
  UPDATE leads SET etapa_desde = date('now') WHERE id = NEW.id;
END;
