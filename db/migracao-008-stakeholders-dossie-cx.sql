-- ==========================================================
-- CRM Formatar — Migração 008
-- Mapa de stakeholders e Dossiê de Experiência (Lote L).
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-008-stakeholders-dossie-cx.sql
--
-- Conferir DEPOIS de aplicar (a segunda metade da convenção, que a 006
-- não teve e custou um dia de proposta quebrada no ar):
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('stakeholders','dossies_cx')"
--
-- Seguro rodar duas vezes? SIM. Como a 007, não tem nenhum ALTER TABLE:
-- só CREATE ... IF NOT EXISTS. Rodar de novo não duplica nada.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. STAKEHOLDERS — as pessoas do lado do cliente
--
-- É o consumidor de verdade dos `papeis` criados na 007, que
-- nasceram vazios justamente esperando por aqui.
--
-- Por que uma tabela e não um JSON dentro de `clientes`:
-- stakeholder tem ciclo de vida próprio (entra, muda de papel,
-- sai da empresa), e o Lote N vai querer perguntar "quem
-- respondeu o NPS" apontando para uma linha. Núcleos cabem num
-- JSON porque são vocabulário; pessoas não são.
--
-- `influencia` e `postura` nascem DESCONHECIDAS, não numa média.
-- Cadastrar alguém não é ter avaliado a pessoa, e um "média" por
-- omissão viraria juízo que ninguém emitiu — exatamente o erro
-- que este dossiê não pode cometer, porque fala de gente com nome.
--
-- `patrocinador` é quem responde pela conta do lado do cliente.
-- Não há trava de "só um": empresa familiar costuma ter dois, e
-- inventar uma regra que a realidade contraria só geraria
-- contorno na tela.
--
-- Sem FOREIGN KEY, como no resto do esquema: o D1 não liga as
-- checagens por padrão, e uma restrição que não é verificada
-- documenta sem proteger. As faxinas são feitas na API.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS stakeholders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  cliente_id     INTEGER NOT NULL,

  -- Identificação
  nome           TEXT    NOT NULL,
  papel_id       INTEGER,                   -- papeis.id — a função no negócio
  cargo          TEXT,                      -- o título que a própria pessoa usa

  -- Contato
  email          TEXT,
  telefone       TEXT,

  -- Juízo da CX. Sempre explícito, nunca inferido.
  influencia     TEXT    NOT NULL DEFAULT 'desconhecida',  -- alta|media|baixa|desconhecida
  postura        TEXT    NOT NULL DEFAULT 'desconhecida',  -- promotor|neutro|resistente|desconhecida
  patrocinador   INTEGER NOT NULL DEFAULT 0,

  -- De quais núcleos esta pessoa participa: JSON com os IDs, ex.: [1,4].
  -- Guarda o ID e não o texto, como as tags do lead e os núcleos do
  -- cliente: renomear um núcleo não pode exigir varrer as pessoas.
  --
  -- É o que permite ao dossiê apontar núcleo atendido sem ninguém
  -- mapeado — o buraco mais útil que o mapa revela.
  nucleos        TEXT    NOT NULL DEFAULT '[]',

  observacoes    TEXT,

  -- Auditoria e exclusão lógica, como em leads e clientes
  criado_por     TEXT    NOT NULL,
  criado_em      TEXT    NOT NULL,
  atualizado_por TEXT,
  atualizado_em  TEXT,
  ativo          INTEGER NOT NULL DEFAULT 1
);

-- A consulta quente é "as pessoas deste cliente".
CREATE INDEX IF NOT EXISTS idx_stakeholders_cliente
  ON stakeholders (cliente_id, ativo);

-- A trava de exclusão de papel pergunta "quantas pessoas usam este?".
CREATE INDEX IF NOT EXISTS idx_stakeholders_papel
  ON stakeholders (papel_id);

-- Nome único por cliente entre os ATIVOS: dois "João Silva" na mesma
-- empresa quase sempre é cadastro repetido. Parcial de propósito —
-- quem saiu da empresa e voltou precisa poder ser recadastrado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stakeholders_nome
  ON stakeholders (cliente_id, nome COLLATE NOCASE)
  WHERE ativo = 1;


-- ----------------------------------------------------------
-- 2. DOSSIES_CX — o Dossiê de Experiência
--
-- Tabela separada de `dossies`, e chaveada por CLIENTE, não por
-- CNPJ. Duas razões, ambas concretas:
--
--   1. O Executivo é pré-venda e o de Experiência é pós-venda —
--      propósitos opostos, decisão registrada no roadmap. Um
--      cliente convertido tem os dois, e chavear os dois por CNPJ
--      faria as versões de um contarem por cima das do outro:
--      "versão 3" seria a terceira geração de qualquer um deles.
--
--   2. O de Experiência fala da CONTA como ela existe no CRM —
--      jornada, núcleos, pessoas mapeadas. O sujeito é a linha de
--      `clientes`, não o CNPJ na Receita.
--
-- Mantém a regra central herdada do dossiê e da proposta: gerar de
-- novo NUNCA sobrescreve. Cria a versão seguinte e a anterior
-- continua consultável, porque documento que foi lido numa reunião
-- precisa ser reproduzível como foi lido.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS dossies_cx (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  cliente_id     INTEGER NOT NULL,

  -- Cópia do nome e do CNPJ NA HORA da geração. Redundante de
  -- propósito: se o cadastro for corrigido depois, o histórico
  -- continua dizendo sob que nome o documento foi gerado.
  cliente_nome   TEXT,
  documento      TEXT,

  versao         INTEGER NOT NULL,          -- 1, 2, 3... por cliente

  gerado_por     TEXT    NOT NULL,          -- e-mail vindo do ID token
  gerado_em      TEXT    NOT NULL,          -- ISO 8601 UTC
  provider       TEXT    NOT NULL,          -- deepseek | chatgpt | claude | gemini

  html           TEXT,
  tamanho_bytes  INTEGER,

  -- O JSON que originou o HTML: permite reprocessar o template
  -- (mudar layout, corrigir cálculo) sem chamar a IA de novo.
  dados_json     TEXT,

  status         TEXT    NOT NULL DEFAULT 'concluido',  -- concluido | erro
  erro_mensagem  TEXT,

  UNIQUE (cliente_id, versao)
);

CREATE INDEX IF NOT EXISTS idx_dossies_cx_cliente
  ON dossies_cx (cliente_id, versao DESC);
