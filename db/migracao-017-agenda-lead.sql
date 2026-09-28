-- ==========================================================
-- CRM Formatar — Migração 017
-- Agenda do lead (2.32.0): reuniões e contatos.
--
-- Aplicar ANTES do deploy da 2.32.0:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-017-agenda-lead.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name = 'agenda_lead'"
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT COUNT(*) AS contatos_migrados FROM agenda_lead WHERE criado_por = 'migracao-017'"
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS, e a cópia
-- dos próximos contatos confere se já foi feita.
-- ==========================================================

-- ----------------------------------------------------------
-- AGENDA_LEAD
--
-- Um compromisso com um lead: REUNIÃO (tem tipo do hub, local, duração,
-- e é onde a gravação e o laudo vão se pendurar nos próximos lotes) ou
-- CONTATO (ligação, WhatsApp, e-mail — só data e canal).
--
-- `inicio` é 'AAAA-MM-DDTHH:MM' no horário de Brasília, SEM fuso. Todo
-- mundo que usa o CRM está no mesmo fuso, e guardar em UTC obrigaria cada
-- tela a converter — a agenda mostraria 12:00 como 09:00 no primeiro
-- descuido. Comparar texto nesse formato ordena certo.
--
-- O tipo de reunião é do hub (Time "Vendas"): guarda o id e o NOME da
-- época, para o histórico continuar legível se o tipo for renomeado ou
-- desativado lá.
--
-- `status`: agendada | realizada | remarcada | cancelada | nao_compareceu.
-- Remarcar não edita a data: encerra esta como 'remarcada' e cria outra.
-- O histórico mostra que o lead remarcou, o que é informação.
--
-- `leads.data_proximo_contato` passa a ser DERIVADO daqui: a primeira
-- data com status 'agendada'. Quem grava é o servidor, a cada mudança.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS agenda_lead (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id              INTEGER NOT NULL,
  tipo                 TEXT    NOT NULL,          -- 'reuniao' | 'contato'
  inicio               TEXT    NOT NULL,          -- 'AAAA-MM-DDTHH:MM', Brasília
  duracao_min          INTEGER,                   -- só reunião
  tipo_reuniao_erp_id  TEXT,                      -- só reunião
  tipo_reuniao_nome    TEXT,
  local_tipo           TEXT,                      -- 'online' | 'presencial' | 'externo'
  local_texto          TEXT,                      -- link da sala, ou onde
  canal                TEXT,                      -- só contato: ligacao | whatsapp | email | outro
  responsavel          TEXT,                      -- e-mail de um usuário do CRM
  participantes        TEXT,                      -- quem vem do lado do lead
  pauta                TEXT,
  status               TEXT    NOT NULL DEFAULT 'agendada',
  remarcada_para_id    INTEGER,                   -- a que substituiu esta
  criado_por           TEXT    NOT NULL,
  criado_em            TEXT    NOT NULL,
  atualizado_por       TEXT,
  atualizado_em        TEXT,
  ativo                INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_agenda_lead_lead   ON agenda_lead (lead_id, ativo);
CREATE INDEX IF NOT EXISTS idx_agenda_lead_inicio ON agenda_lead (ativo, inicio);

-- ----------------------------------------------------------
-- Os "Próximo contato" que já existem viram contatos agendados, às 9h,
-- com o responsável do lead. Decidido em 28/09/2026: "próximo contato
-- vem da agenda". Sem esta cópia, a data sumiria da ficha na primeira
-- mudança de agenda do lead.
-- ----------------------------------------------------------
INSERT INTO agenda_lead (lead_id, tipo, inicio, responsavel, status, criado_por, criado_em)
SELECT l.id, 'contato', substr(l.data_proximo_contato, 1, 10) || 'T09:00', l.responsavel,
       'agendada', 'migracao-017', datetime('now')
  FROM leads l
 WHERE l.ativo = 1
   AND l.data_proximo_contato IS NOT NULL
   AND TRIM(l.data_proximo_contato) <> ''
   AND NOT EXISTS (SELECT 1 FROM agenda_lead a WHERE a.lead_id = l.id AND a.criado_por = 'migracao-017');
