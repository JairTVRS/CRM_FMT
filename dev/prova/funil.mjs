/**
 * Prova do funil arrumado (2.31.0).
 *
 * Chama os handlers de verdade contra SQLite em memória, com o esquema
 * montado pelas migrações de verdade (004, 005 e 016) — a 016 mexe em
 * dados que já existem, e é justamente isso que precisa ser visto.
 *
 * O que importa:
 *   - a migração renomeia Finalizado, separa ganho de perdido, dá
 *     responsável aos leads antigos e semeia os 5 motivos;
 *   - entrar em perda exige motivo pelas DUAS portas (ficha e arraste), e
 *     sair apaga o motivo; quem já estava perdido segue editável;
 *   - o responsável só pode ser quem usa o CRM;
 *   - admin é o grupo do hub, comparado sem acento nem caixa;
 *   - motivos só admin altera; lead perdido não converte.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as leads from '../../functions/api/leads.js';
import * as cadastros from '../../functions/api/cadastros.js';
import { onRequestGet as convGet } from '../../functions/api/conversao.js';
import { onRequestGet as meGet } from '../../functions/api/me.js';
import { onRequestGet as usuariosGet } from '../../functions/api/usuarios.js';
import { avaliarAdmin } from '../../functions/api/_lib/admin.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

function d1(db) {
  const preparar = (sql) => {
    const stmt = db.prepare(sql);
    let args = [];
    const api = {
      bind(...a) { args = a.map((v) => (v === undefined ? null : v)); return api; },
      async first() { return stmt.get(...args) ?? null; },
      async all() { return { results: stmt.all(...args) }; },
      async run() { return stmt.run(...args); }
    };
    return api;
  };
  return {
    prepare: preparar,
    // O batch do D1 é transacional; aqui basta rodar em ordem.
    async batch(lista) {
      db.exec('BEGIN');
      try { const r = []; for (const s of lista) r.push(await s.run()); db.exec('COMMIT'); return r; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}

/* ==========================================================================
   O HUB — nenhuma chamada

   Desde a 2.31.1 o admin sai do id do grupo, que chega com o usuário. A
   permissão de grupos do hub fica FECHADA (abre a árvore de acesso), e
   esta prova registra toda chamada de rede para garantir que nada aqui
   bate no hub.
   ========================================================================== */

const chamadas = [];
globalThis.fetch = async (url) => {
  chamadas.push(String(url));
  return new Response('{}', { status: 404 });
};
const ENV_HUB = { HUB_API_KEY: 'teste' };

// Os ids reais dos grupos no hub (copiados do endereço de edição).
const SOCIOS = '64e678a7d2042dae072ef102';
const PCP = '6699523a12251d23d507cb91';

/* ==========================================================================
   ESQUEMA — as migrações de verdade sobre um banco "de produção"
   ========================================================================== */

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);

bd.exec(`
  CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, documento TEXT,
    telefone TEXT, origem TEXT, observacoes TEXT, email TEXT, contato_nome TEXT, cep TEXT,
    cidade TEXT, endereco TEXT, site TEXT, instagram TEXT, ramo TEXT, segmento TEXT, resumo_ia TEXT,
    criado_por TEXT NOT NULL, criado_em TEXT NOT NULL, atualizado_por TEXT, atualizado_em TEXT,
    ativo INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, documento TEXT,
    lead_id INTEGER, etapa_id INTEGER, ativo INTEGER DEFAULT 1);
  -- Da 007, só para o "tipo=todos" dos cadastros responder.
  CREATE TABLE nucleos (id INTEGER PRIMARY KEY, nome TEXT, cor TEXT, ativo INTEGER DEFAULT 1);
  CREATE TABLE papeis (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER DEFAULT 1);
`);
bd.exec(readFileSync(`${RAIZ}/db/migracao-004-funil.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-005-pipelines-classificacao.sql`, 'utf8'));

// Uma etapa da jornada terminal: a 016 não pode tocá-la.
bd.exec(`INSERT INTO etapas (nome, cor, ordem, encerra, pipeline) VALUES ('Encerrado', '#999', 9, 1, 'jornada')`);

const etapa = (nome) => bd.prepare('SELECT * FROM etapas WHERE nome = ?').get(nome);
const QUALIF = etapa('Qualificação').id;
const PERDIDO = etapa('Perdido').id;
const FINALIZADO = etapa('Finalizado').id;

bd.exec(`
  INSERT INTO leads (id, nome, documento, criado_por, criado_em, etapa_id) VALUES
    (1, 'Formatar Consultoria', '07091149000172', 'Jair@Formatar.com.br', '2026-08-01T10:00:00Z', ${QUALIF}),
    (2, 'Perdido Antigo', '19131243000197', 'marina@formatar.com.br', '2026-08-02T10:00:00Z', ${PERDIDO}),
    (3, 'Contrato Antigo', '11222333000181', 'marina@formatar.com.br', '2026-08-03T10:00:00Z', ${FINALIZADO});
`);

console.log('\n=== 1. A migração 016 sobre dados que já existem ===');
bd.exec(readFileSync(`${RAIZ}/db/migracao-016-funil-responsavel-perda.sql`, 'utf8'));

const ganho = bd.prepare('SELECT * FROM etapas WHERE id = ?').get(FINALIZADO);
ok(ganho.nome === 'Contrato emitido' && ganho.resultado === 'ganho', 'Finalizado vira "Contrato emitido", ganho', JSON.stringify(ganho));
ok(bd.prepare('SELECT resultado FROM etapas WHERE id = ?').get(PERDIDO).resultado === 'perdido', 'Perdido fica perdido');
ok(bd.prepare('SELECT resultado FROM etapas WHERE id = ?').get(QUALIF).resultado === null, 'etapa em aberto fica sem resultado');
ok(etapa('Encerrado').resultado === null, 'a jornada do cliente não é tocada');

const l1 = bd.prepare('SELECT responsavel FROM leads WHERE id = 1').get();
ok(l1.responsavel === 'jair@formatar.com.br', 'lead antigo fica com quem cadastrou, em minúsculas', l1.responsavel);

const motivos = bd.prepare('SELECT nome FROM motivos_perda WHERE ativo = 1 ORDER BY ordem').all().map((m) => m.nome);
ok(motivos.length === 5 && motivos[0] === 'Preço acima do esperado', 'os 5 motivos modelo, na ordem', motivos.join(' | '));

const semeados = bd.prepare('SELECT email FROM usuarios_crm ORDER BY email').all().map((u) => u.email);
ok(semeados.join(',') === 'jair@formatar.com.br,marina@formatar.com.br', 'quem já cadastrou lead entra na lista de usuários', semeados.join(','));

// Os INSERT e CREATE da 016 são idempotentes — rodar de novo não duplica.
bd.exec(readFileSync(`${RAIZ}/db/migracao-016-funil-responsavel-perda.sql`, 'utf8')
  .split('\n').filter((l) => !/^ALTER TABLE/.test(l)).join('\n'));
ok(bd.prepare('SELECT COUNT(*) n FROM motivos_perda').get().n === 5, 'reaplicar não duplica os motivos');

/* ==========================================================================
   CONTEXTO
   ========================================================================== */

const JAIR = { email: 'jair@formatar.com.br', nome: 'Jair', id: 'u-jair', grupoId: SOCIOS };
const MARINA = { email: 'marina@formatar.com.br', nome: 'Marina', id: 'u-mar', grupoId: '65aaaaaaaaaaaaaaaaaaaaaa' };

const ctx = (metodo, url, corpo, usuario = JAIR, env = {}) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : {
    method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
  }),
  env: { DB, ...ENV_HUB, ...env },
  data: { cabecalhos: { 'Content-Type': 'application/json' }, usuario }
});
const ler = async (r) => ({ status: r.status, corpo: await r.json() });

const lead = (id) => bd.prepare('SELECT * FROM leads WHERE id = ?').get(id);
const MOTIVO_PRECO = bd.prepare("SELECT id FROM motivos_perda WHERE nome = 'Preço acima do esperado'").get().id;

/* ==========================================================================
   2. RESPONSÁVEL
   ========================================================================== */

console.log('\n=== 2. O responsável ===');

const criado = await ler(await leads.onRequestPost(ctx('POST', '/api/leads', {
  nome: 'Lead Novo', documento: '11.444.777/0001-61'
})));
ok(criado.status === 201 && criado.corpo.lead.responsavel === 'jair@formatar.com.br', 'nasce com quem cadastrou', criado.corpo.lead?.responsavel);
const NOVO = criado.corpo.lead?.id;

const estranho = await ler(await leads.onRequestPost(ctx('POST', '/api/leads', {
  nome: 'Outro', documento: '04.252.011/0001-10', responsavel: 'ninguem@formatar.com.br'
})));
ok(estranho.status === 400 && estranho.corpo.code === 'RESPONSAVEL_INVALIDO', 'responsável fora do CRM é recusado', estranho.corpo.code);

const trocou = await ler(await leads.onRequestPut(ctx('PUT', `/api/leads?id=${NOVO}`, {
  nome: 'Lead Novo', documento: '11444777000161', etapa_id: QUALIF, responsavel: 'MARINA@formatar.com.br'
})));
ok(trocou.status === 200 && trocou.corpo.lead.responsavel === 'marina@formatar.com.br', 'troca para outro usuário do CRM', trocou.corpo.lead?.responsavel);

// Lead cujo responsável NÃO está em usuarios_crm (nunca abriu o CRM
// depois da migração) continua editável sem trocar de responsável.
bd.prepare("UPDATE leads SET responsavel = 'antigo@formatar.com.br' WHERE id = 1").run();
const mantem = await ler(await leads.onRequestPut(ctx('PUT', '/api/leads?id=1', {
  nome: 'Formatar Consultoria', documento: '07091149000172', etapa_id: QUALIF, responsavel: 'antigo@formatar.com.br'
})));
ok(mantem.status === 200, 'responsável que ainda não abriu o CRM não trava a edição', mantem.corpo.error);

const lista = async (q) => (await ler(await leads.onRequestGet(ctx('GET', `/api/leads?${q}`)))).corpo.leads.map((l) => l.id);
ok((await lista('responsavel=marina@formatar.com.br')).includes(NOVO), 'filtro por responsável');
bd.prepare('UPDATE leads SET responsavel = NULL WHERE id = 3').run();
ok(JSON.stringify(await lista('responsavel=__sem__')) === '[3]', 'filtro "sem responsável"');

/* ==========================================================================
   3. MOTIVO DA PERDA — pela ficha
   ========================================================================== */

console.log('\n=== 3. Perda pela ficha ===');

const base = { nome: 'Lead Novo', documento: '11444777000161', responsavel: 'marina@formatar.com.br' };

const semMotivo = await ler(await leads.onRequestPut(ctx('PUT', `/api/leads?id=${NOVO}`, { ...base, etapa_id: PERDIDO })));
ok(semMotivo.status === 400 && semMotivo.corpo.code === 'MOTIVO_OBRIGATORIO', 'entrar em Perdido sem motivo é recusado');
ok(lead(NOVO).etapa_id === QUALIF, 'e o lead não sai do lugar');

const comMotivo = await ler(await leads.onRequestPut(ctx('PUT', `/api/leads?id=${NOVO}`, {
  ...base, etapa_id: PERDIDO, motivo_perda_id: MOTIVO_PRECO, motivo_perda_obs: 'achou caro'
})));
ok(comMotivo.status === 200 && lead(NOVO).motivo_perda_id === MOTIVO_PRECO, 'com motivo, grava');

const inexistente = await ler(await leads.onRequestPut(ctx('PUT', `/api/leads?id=${NOVO}`, {
  ...base, etapa_id: PERDIDO, motivo_perda_id: 999
})));
ok(inexistente.status === 400 && inexistente.corpo.code === 'MOTIVO_INVALIDO', 'motivo que não existe é recusado');

await leads.onRequestPut(ctx('PUT', `/api/leads?id=${NOVO}`, { ...base, etapa_id: QUALIF, motivo_perda_id: MOTIVO_PRECO }));
ok(lead(NOVO).motivo_perda_id === null && lead(NOVO).motivo_perda_obs === null, 'reaberto, o motivo sai junto');

const antigo = await ler(await leads.onRequestPut(ctx('PUT', '/api/leads?id=2', {
  nome: 'Perdido Antigo (editado)', documento: '19131243000197', etapa_id: PERDIDO, responsavel: 'marina@formatar.com.br'
})));
ok(antigo.status === 200, 'quem já estava perdido antes da regra segue editável sem motivo', antigo.corpo.error);

const criadoPerdido = await ler(await leads.onRequestPost(ctx('POST', '/api/leads', {
  nome: 'Já nasce perdido', documento: '04252011000110', etapa_id: PERDIDO
})));
ok(criadoPerdido.status === 400 && criadoPerdido.corpo.code === 'MOTIVO_OBRIGATORIO', 'nem cadastrar direto em Perdido sem motivo');

/* ==========================================================================
   4. MOTIVO DA PERDA — pelo arraste
   ========================================================================== */

console.log('\n=== 4. Perda pelo quadro ===');

const mover = (corpo) => leads.onRequestPut(ctx('PUT', '/api/leads?mover=1', corpo)).then(ler);

const arrasteSem = await mover({ id: NOVO, etapa_id: PERDIDO, ordem: [NOVO] });
ok(arrasteSem.status === 400 && arrasteSem.corpo.code === 'MOTIVO_OBRIGATORIO', 'arrastar para Perdido sem motivo é recusado');
ok(lead(NOVO).etapa_id === QUALIF, 'e o cartão não muda de coluna no banco');

const arrasteCom = await mover({ id: NOVO, etapa_id: PERDIDO, ordem: [2, NOVO], motivo_perda_id: MOTIVO_PRECO });
ok(arrasteCom.status === 200 && lead(NOVO).etapa_id === PERDIDO && lead(NOVO).motivo_perda_id === MOTIVO_PRECO,
  'com motivo, move e grava o motivo');

const reordena = await mover({ id: NOVO, etapa_id: PERDIDO, ordem: [NOVO, 2] });
ok(reordena.status === 200 && lead(NOVO).motivo_perda_id === MOTIVO_PRECO, 'reordenar dentro de Perdido não pede nem apaga motivo');

await mover({ id: NOVO, etapa_id: QUALIF, ordem: [NOVO] });
ok(lead(NOVO).etapa_id === QUALIF && lead(NOVO).motivo_perda_id === null, 'arrastar de volta apaga o motivo');

/* ==========================================================================
   5. ADMIN — o grupo do hub
   ========================================================================== */

console.log('\n=== 5. Quem é admin ===');

const socios = await avaliarAdmin(ENV_HUB, JAIR);
ok(socios.admin === true && socios.grupo === 'Sócios', 'Sócios é admin, e a tela sabe dizer o nome', JSON.stringify(socios));
const pcp = await avaliarAdmin(ENV_HUB, { ...JAIR, grupoId: PCP });
ok(pcp.admin === true && pcp.grupo === 'Planejamento e Controle de Produção', 'PCP é admin');
const outro = await avaliarAdmin(ENV_HUB, MARINA);
ok(outro.admin === false && outro.grupo === null && outro.aviso === null, 'outro grupo não é admin — e não é erro');
ok((await avaliarAdmin(ENV_HUB, { ...JAIR, grupoId: SOCIOS.toUpperCase() })).admin === true, 'o id vale sem diferenciar caixa');
ok((await avaliarAdmin({ ...ENV_HUB, ADMIN_GRUPOS: ` ${MARINA.grupoId} ` }, MARINA)).admin === true, 'ADMIN_GRUPOS no ambiente substitui a lista');
ok((await avaliarAdmin({ ...ENV_HUB, ADMIN_GRUPOS: MARINA.grupoId }, JAIR)).admin === false, '...e substitui mesmo: Sócios sai');
const semGrupo = await avaliarAdmin(ENV_HUB, { ...JAIR, grupoId: null });
ok(!semGrupo.admin && /grupo/.test(semGrupo.aviso), 'sem grupo, não é admin, e diz por quê');
ok(chamadas.length === 0, 'decidir quem é admin não chama o hub (a permissão de grupos fica fechada)', chamadas.join(', '));

/* ==========================================================================
   6. MOTIVOS NAS CONFIGURAÇÕES — só admin
   ========================================================================== */

console.log('\n=== 6. Motivos: só admin altera ===');

const lidos = await ler(await cadastros.onRequestGet(ctx('GET', '/api/cadastros?tipo=todos&pipeline=comercial', undefined, MARINA)));
ok(lidos.corpo.motivos?.length === 5, 'qualquer um lê os motivos');
ok(lidos.corpo.etapas.find((e) => e.id === PERDIDO)?.resultado === 'perdido', 'as etapas trazem o resultado');

const naoAdmin = await ler(await cadastros.onRequestPost(ctx('POST', '/api/cadastros?tipo=motivos', { nome: 'Sumiu' }, MARINA)));
ok(naoAdmin.status === 403 && naoAdmin.corpo.code === 'SO_ADMIN', 'quem não é admin não cria');

const admin = await ler(await cadastros.onRequestPost(ctx('POST', '/api/cadastros?tipo=motivos', { nome: 'Projeto adiado pelo cliente' })));
ok(admin.status === 201 && admin.corpo.registro.ordem === 6, 'admin cria, no fim da lista', JSON.stringify(admin.corpo.registro));

const renomeia = await ler(await cadastros.onRequestPut(ctx('PUT', `/api/cadastros?tipo=motivos&id=${admin.corpo.registro.id}`, { nome: 'Projeto adiado' })));
ok(renomeia.status === 200 && renomeia.corpo.registro.nome === 'Projeto adiado', 'admin renomeia');

bd.prepare('UPDATE leads SET motivo_perda_id = ? WHERE id = 2').run(MOTIVO_PRECO);
const emUso = await ler(await cadastros.onRequestDelete(ctx('DELETE', `/api/cadastros?tipo=motivos&id=${MOTIVO_PRECO}`)));
ok(emUso.status === 409 && emUso.corpo.code === 'EM_USO', 'motivo que explica perda não pode ser excluído');

const livre = await ler(await cadastros.onRequestDelete(ctx('DELETE', `/api/cadastros?tipo=motivos&id=${admin.corpo.registro.id}`)));
ok(livre.status === 200, 'motivo sem uso é excluído');

const vira = await ler(await cadastros.onRequestPut(ctx('PUT', `/api/cadastros?tipo=etapas&id=${QUALIF}`, { resultado: 'perdido' }, MARINA)));
ok(vira.status === 200 && vira.corpo.registro.encerra === 1, 'marcar uma etapa como perdida também a torna terminal');
await cadastros.onRequestPut(ctx('PUT', `/api/cadastros?tipo=etapas&id=${QUALIF}`, { resultado: null }));
ok(bd.prepare('SELECT encerra, resultado FROM etapas WHERE id = ?').get(QUALIF).encerra === 0, 'e voltar para "em aberto" desfaz');
const lixo = await ler(await cadastros.onRequestPut(ctx('PUT', `/api/cadastros?tipo=etapas&id=${QUALIF}`, { resultado: 'talvez' })));
ok(lixo.status === 400, 'resultado desconhecido é recusado');

/* ==========================================================================
   7. CONVERSÃO E /api/me
   ========================================================================== */

console.log('\n=== 7. Conversão e sessão ===');

const conv = await ler(await convGet(ctx('GET', '/api/conversao?lead_id=2')));
ok(conv.corpo.impedimento?.code === 'LEAD_PERDIDO', 'lead perdido não converte', conv.corpo.impedimento?.code);

const eu = await ler(await meGet(ctx('GET', '/api/me', undefined, { ...JAIR, nome: 'Jair Tavares' })));
ok(eu.corpo.usuario.admin === true && eu.corpo.usuario.grupo === 'Sócios', 'o /api/me diz se é admin e o grupo');
const ela = await ler(await meGet(ctx('GET', '/api/me', undefined, { ...MARINA, nome: 'Marina Alves' })));
ok(ela.corpo.usuario.admin === false && !ela.corpo.usuario.avisoAdmin, 'quem não é admin não recebe aviso de erro');
const marina = bd.prepare("SELECT nome, grupo FROM usuarios_crm WHERE email = 'marina@formatar.com.br'").get();
ok(marina.nome === 'Marina Alves' && marina.grupo === MARINA.grupoId, 'e registra o acesso com nome e o id do grupo');
ok(chamadas.length === 0, 'o /api/me também não chama o hub', chamadas.join(', '));

const usuarios = await ler(await usuariosGet(ctx('GET', '/api/usuarios')));
ok(usuarios.corpo.usuarios.map((u) => u.email).includes('marina@formatar.com.br'), 'a lista de responsáveis vem de quem usa o CRM');

const semTabela = await ler(await usuariosGet({ ...ctx('GET', '/api/usuarios'), env: { DB: d1(new DatabaseSync(':memory:')) } }));
ok(semTabela.status === 200 && semTabela.corpo.usuarios.length === 0 && /016/.test(semTabela.corpo.aviso), 'sem a migração, lista vazia com aviso — não quebra');

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
