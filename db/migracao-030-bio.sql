-- ==========================================================
-- CRM Formatar — Migração 030
-- Página BIO (2.45.0): as imagens e links que o CRM troca.
--
-- A página pública /bio tem lugares de imagem (avatar, capa, as três
-- soluções e as seis postagens). Pelo lápis da tela BIO, qualquer usuário
-- do CRM troca a imagem e, onde couber, o link. Cada lugar é uma "vaga".
--
-- A IMAGEM FICA NO D1, como BLOB: o R2 segue descartado (exige cartão,
-- ver _lib/storage.js). O navegador reduz e comprime antes de enviar; a
-- API recusa acima de 900 KB, bem abaixo do limite de 2 MB por valor do D1.
--
-- `versao` sobe a cada troca: vai no endereço da imagem (?v=), e o
-- navegador de quem visita guarda a imagem em cache sem nunca mostrar a
-- antiga depois de uma troca.
--
-- Aplicar ANTES do deploy da 2.45.0:
--   npx wrangler d1 execute crm-formatar --remote --file=db/migracao-030-bio.sql
--
-- Conferir DEPOIS de aplicar:
--   npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name = 'bio_vagas'"
--
-- Seguro rodar duas vezes? SIM. Só CREATE ... IF NOT EXISTS.
-- ==========================================================

CREATE TABLE IF NOT EXISTS bio_vagas (
  vaga            TEXT    PRIMARY KEY,          -- 'capa', 'avatar', 'solucao-1', 'post-3'...
  imagem          BLOB,                         -- NULL = sem imagem (a página usa o padrão)
  imagem_tipo     TEXT,                         -- 'image/webp' | 'image/jpeg' | 'image/png'
  link            TEXT,                         -- só nas vagas que aceitam link
  versao          INTEGER NOT NULL DEFAULT 1,
  atualizado_por  TEXT    NOT NULL,
  atualizado_em   TEXT    NOT NULL
);
