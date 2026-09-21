-- ==========================================================
-- CRM Formatar — Migração 012
-- O plano de ação passa a ser GRAVADO no CRM, editável campo a
-- campo, com registro de cada alteração.
--
-- Aplicar com:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-012-plano-gravado.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('acoes_cx') WHERE name IN ('status','data_prevista','versao')"
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('acoes_cx_log','plano_carga','plano_carteiras')"
--
-- Seguro rodar duas vezes? NÃO. O ALTER TABLE ADD COLUMN falha na
-- segunda vez com "duplicate column name" — como na 009. Se isso
-- aparecer, a migração já foi aplicada; confira com as consultas acima.
-- ==========================================================

-- ----------------------------------------------------------
-- O QUE MUDA E POR QUÊ
--
-- Até a 2.24.0 o CRM não guardava a ação: a cada abertura da tela
-- relia seis meses de atas no ERP e as montava de novo. Duas
-- consequências, as duas apontadas pelo usuário em 21/09/2026:
--
--   1. Lento, e a janela estourava o teto de páginas do hub — a tela
--      avisava que a lista "pode estar incompleta".
--   2. Nada da ata se editava. A CX não podia marcar uma ação como
--      concluída nem corrigir o responsável.
--
-- Decisão de 21/09/2026: o CRM carrega as ações UMA vez e, dali em
-- diante, só busca as reuniões novas desde a última carga. O que a
-- ata disse fica gravado aqui, e a CX pode alterar qualquer campo.
--
-- Isto REVERTE a regra de 06/09 ("What/Who/When/Status vêm do ERP ao
-- vivo e não se editam"). Foi pedido explícito.
--
-- A REGRA DE QUEM VENCE, quando a ata e a CX discordam:
--
--   Cada campo que vem da ata tem uma SOMBRA (`*_ata`): o que a última
--   ata dizia. Na carga seguinte, se a ata NOVA diz o mesmo que a
--   sombra, a ata não mudou nada — e vale o que a CX escreveu. Se a
--   ata diz outra coisa, alguém mudou na reunião, e a ata vence.
--
--   Ou seja: vence a alteração mais recente, de qualquer lado. Sem a
--   sombra, a carga seguinte apagaria a edição da CX toda semana.
-- ----------------------------------------------------------

ALTER TABLE acoes_cx ADD COLUMN cliente_nome      TEXT;
-- O tipo de reunião (Logística, Inteligência Operacional…)
ALTER TABLE acoes_cx ADD COLUMN tipo_reuniao      TEXT;
ALTER TABLE acoes_cx ADD COLUMN tipo_reuniao_erp_id TEXT;
-- O Time da Formatar — nesta tela, a coluna "Núcleo"
ALTER TABLE acoes_cx ADD COLUMN time_nome         TEXT;
ALTER TABLE acoes_cx ADD COLUMN time_erp_id       TEXT;

-- A última reunião em que a ação foi vista, e a primeira.
ALTER TABLE acoes_cx ADD COLUMN reuniao_erp_id    TEXT;
ALTER TABLE acoes_cx ADD COLUMN reuniao_nid       INTEGER;
ALTER TABLE acoes_cx ADD COLUMN reuniao_em        TEXT;
ALTER TABLE acoes_cx ADD COLUMN primeira_ata_em   TEXT;

-- Os campos da ata, agora editáveis.
ALTER TABLE acoes_cx ADD COLUMN descricao         TEXT;
ALTER TABLE acoes_cx ADD COLUMN responsavel       TEXT;
ALTER TABLE acoes_cx ADD COLUMN prazo             TEXT;   -- "Quando", como escrito: "out/26", "A definir"
ALTER TABLE acoes_cx ADD COLUMN data_prevista     TEXT;   -- AAAA-MM-DD
ALTER TABLE acoes_cx ADD COLUMN status            TEXT;
ALTER TABLE acoes_cx ADD COLUMN status_bruto      TEXT;   -- o texto do status na ata
ALTER TABLE acoes_cx ADD COLUMN status_desde      TEXT;

-- As sombras: o que a última ata dizia de cada um.
ALTER TABLE acoes_cx ADD COLUMN descricao_ata     TEXT;
ALTER TABLE acoes_cx ADD COLUMN responsavel_ata   TEXT;
ALTER TABLE acoes_cx ADD COLUMN prazo_ata         TEXT;
ALTER TABLE acoes_cx ADD COLUMN data_prevista_ata TEXT;
ALTER TABLE acoes_cx ADD COLUMN status_ata        TEXT;

-- O manual v2.3: ação concluída ou cancelada SAI do plano. Quando a
-- ata mais recente da carteira não traz mais a ação, ela não é
-- apagada daqui — ganha esta data e deixa a fila "Em aberto".
ALTER TABLE acoes_cx ADD COLUMN saiu_da_ata_em    TEXT;

-- Trava otimista. Muda a cada escrita, da CX ou da carga. Quem grava
-- confere que a versão é a que leu: sem isso, a carga que roda
-- enquanto alguém edita apagaria a edição sem deixar rastro.
ALTER TABLE acoes_cx ADD COLUMN versao            TEXT;

CREATE INDEX IF NOT EXISTS idx_acoes_cx_status ON acoes_cx (status);

-- ----------------------------------------------------------
-- ACOES_CX_LOG — quem mudou o quê, quando, de que para que
--
-- Uma linha por campo alterado. `origem` separa a mão da CX da carga
-- da ata: "a ata mudou o responsável" e "a Olivia mudou o
-- responsável" são coisas diferentes para quem cobra a ação.
--
-- Nunca se apaga nem se edita. Sem FOREIGN KEY, como no resto do
-- esquema; `acao_id` aponta para acoes_cx.id.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS acoes_cx_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  acao_id      INTEGER NOT NULL,
  campo        TEXT    NOT NULL,   -- 'status', 'responsavel'… ou 'criada'
  de           TEXT,
  para         TEXT,
  origem       TEXT    NOT NULL,   -- 'crm' ou 'ata'
  reuniao_nid  INTEGER,            -- quando a origem é a ata
  por          TEXT    NOT NULL,   -- e-mail de quem editou, ou de quem rodou a carga
  por_nome     TEXT,
  em           TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acoes_cx_log_acao ON acoes_cx_log (acao_id, em);

-- ----------------------------------------------------------
-- PLANO_CARGA — até onde as atas já foram lidas
--
-- Uma linha só (id = 1). `carregado_ate` é o cursor: a próxima carga
-- pede ao hub só as reuniões a partir dele (menos uma folga de catorze
-- dias, para a ata escrita depois da reunião).
--
-- `completa` diz se a primeira carga — seis meses, em janelas de um
-- mês — já chegou até hoje. A folga só se aplica depois disso: durante
-- a primeira carga as janelas podem encolher, e voltar catorze dias a
-- cada passo faria o cursor andar para trás.
--
-- `travado_em` impede duas cargas ao mesmo tempo — duas pessoas
-- abrindo a tela juntas numerariam as mesmas ações duas vezes.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS plano_carga (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  carregado_ate   TEXT,
  completa        INTEGER NOT NULL DEFAULT 0,
  ultima_carga_em TEXT,
  ultima_carga_por TEXT,
  travado_em      TEXT,
  travado_por     TEXT
);

INSERT OR IGNORE INTO plano_carga (id) VALUES (1);

-- ----------------------------------------------------------
-- PLANO_CARTEIRAS — a ata mais recente já aplicada de cada carteira
--
-- A folga de sete dias relê reuniões já vistas, e a carga anda em
-- janelas. Sem isto, uma ata ANTIGA relida depois de uma nova
-- desfaria o que a nova disse.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS plano_carteiras (
  carteira_erp_id  TEXT PRIMARY KEY,
  reuniao_erp_id   TEXT,
  reuniao_em       TEXT NOT NULL
);
