/**
 * Prova da agenda do lead (2.32.0).
 *
 * Handlers de verdade contra SQLite em memória, com o esquema das
 * migrações de verdade (004, 005, 016 e 017). O que importa:
 *
 *   - a 017 transforma os "Próximo contato" que existem em contatos
 *     agendados, sem duplicar se rodar de novo;
 *   - o próximo contato do lead é DERIVADO: a primeira data agendada,
 *     recalculada a cada criação, mudança, remarcação e exclusão;
 *   - realizada empurra o último contato para a frente, nunca para trás;
 *   - remarcar preserva o histórico (a antiga fica "remarcada");
 *   - a ficha do lead não sobrescreve mais o próximo contato;
 *   - os tipos de reunião são os do hub cujo Time é Vendas.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as agenda from '../../functions/api/agenda.js';
import * as leads from '../../functions/api/leads.js';
import { comandosDoImportado, normalizarInicio, tiposDeVendas } from '../../functions/api/_lib/agenda.js';
import { esquecerMemoria } from '../../functions/api/_lib/hub.js';

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
      // Como o D1: com RETURNING, a linha volta em `results`.
      async run() {
        if (/RETURNING/i.test(sql)) return { results: stmt.all(...args) };
        return stmt.run(...args);
      }
    };
    return api;
  };
  return {
    prepare: preparar,
    async batch(lista) {
      db.exec('BEGIN');
      try { const r = []; for (const s of lista) r.push(await s.run()); db.exec('COMMIT'); return r; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}

/* ==========================================================================
   ESQUEMA
   ========================================================================== */

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);

bd.exec(`
  CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, documento TEXT,
    telefone TEXT, origem TEXT, observacoes TEXT, email TEXT, contato_nome TEXT, cep TEXT,
    cidade TEXT, endereco TEXT, site TEXT, instagram TEXT, ramo TEXT, segmento TEXT, resumo_ia TEXT,
    criado_por TEXT NOT NULL, criado_em TEXT NOT NULL, atualizado_por TEXT, atualizado_em TEXT,
    ativo INTEGER NOT NULL DEFAULT 1);
`);
bd.exec(readFileSync(`${RAIZ}/db/migracao-004-funil.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-005-pipelines-classificacao.sql`, 'utf8'));

bd.exec(`
  INSERT INTO leads (id, nome, documento, criado_por, criado_em, etapa_id, data_proximo_contato) VALUES
    (1, 'Formatar Consultoria', '07091149000172', 'jair@formatar.com.br', '2026-08-01T10:00:00Z', 2, '2026-10-05'),
    (2, 'Lead Sem Data', '19131243000197', 'marina@formatar.com.br', '2026-08-02T10:00:00Z', 2, NULL);
`);
bd.exec(readFileSync(`${RAIZ}/db/migracao-016-funil-responsavel-perda.sql`, 'utf8'));

console.log('\n=== 1. A migração 017 ===');
const M017 = readFileSync(`${RAIZ}/db/migracao-017-agenda-lead.sql`, 'utf8');
bd.exec(M017);
const migrados = bd.prepare("SELECT * FROM agenda_lead WHERE criado_por = 'migracao-017'").all();
ok(migrados.length === 1 && migrados[0].lead_id === 1 && migrados[0].inicio === '2026-10-05T09:00'
  && migrados[0].tipo === 'contato' && migrados[0].status === 'agendada',
  'o "Próximo contato" existente vira contato agendado às 9h', JSON.stringify(migrados[0]));
ok(migrados[0].responsavel === 'jair@formatar.com.br', 'com o responsável do lead');
bd.exec(M017);
ok(bd.prepare('SELECT COUNT(*) n FROM agenda_lead').get().n === 1, 'rodar de novo não duplica');

/* ==========================================================================
   CONTEXTO
   ========================================================================== */

const JAIR = { email: 'jair@formatar.com.br', nome: 'Jair' };
const ctx = (metodo, url, corpo, usuario = JAIR) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : {
    method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
  }),
  env: { DB, HUB_API_KEY: 'teste' },
  data: { cabecalhos: { 'Content-Type': 'application/json' }, usuario }
});
const ler = async (r) => ({ status: r.status, corpo: await r.json() });
const POST = (corpo) => agenda.onRequestPost(ctx('POST', '/api/agenda', corpo)).then(ler);
const PUT = (id, corpo) => agenda.onRequestPut(ctx('PUT', `/api/agenda?id=${id}`, corpo)).then(ler);
const DEL = (id) => agenda.onRequestDelete(ctx('DELETE', `/api/agenda?id=${id}`)).then(ler);
const GET = (q) => agenda.onRequestGet(ctx('GET', `/api/agenda?${q}`)).then(ler);
const lead = (id) => bd.prepare('SELECT * FROM leads WHERE id = ?').get(id);

/* ==========================================================================
   2. CRIAR — o que é obrigatório
   ========================================================================== */

console.log('\n=== 2. Criar ===');

ok(normalizarInicio('2026-02-31T10:00') === null && normalizarInicio('2026-10-01T25:00') === null
  && normalizarInicio('2026-10-01 14:30') === '2026-10-01T14:30', 'data e hora conferidas (sem 31/02, sem 25h)');

const semLocal = await POST({ lead_id: 2, tipo: 'reuniao', inicio: '2026-10-10T14:00' });
ok(semLocal.status === 400 && semLocal.corpo.code === 'LOCAL_INVALIDO', 'reunião sem local é recusada');

const semCanal = await POST({ lead_id: 2, tipo: 'contato', inicio: '2026-10-10T14:00' });
ok(semCanal.status === 400 && semCanal.corpo.code === 'CANAL_INVALIDO', 'contato sem canal é recusado');

const semLead = await POST({ lead_id: 99, tipo: 'contato', canal: 'ligacao', inicio: '2026-10-10T14:00' });
ok(semLead.status === 400 && semLead.corpo.code === 'LEAD_OBRIGATORIO', 'lead que não existe é recusado');

const estranho = await POST({ lead_id: 2, tipo: 'contato', canal: 'ligacao', inicio: '2026-10-10T14:00', responsavel: 'fora@x.com' });
ok(estranho.status === 400 && estranho.corpo.code === 'RESPONSAVEL_INVALIDO', 'responsável fora do CRM é recusado');

const reuniao = await POST({
  lead_id: 2, tipo: 'reuniao', inicio: '2026-10-10T14:00', local_tipo: 'online',
  local_texto: 'https://meet.google.com/abc', tipo_reuniao_erp_id: 't1', tipo_reuniao_nome: 'Diagnóstico',
  duracao_min: 90, canal: 'whatsapp'
});
ok(reuniao.status === 201 && reuniao.corpo.item.lead_nome === 'Lead Sem Data', 'reunião criada, com o lead junto', reuniao.corpo.error);
ok(reuniao.corpo.item?.canal === null, 'reunião não guarda canal de contato');
ok(reuniao.corpo.item?.responsavel === 'marina@formatar.com.br', 'sem escolha, o responsável é o do lead');
ok(lead(2).data_proximo_contato === '2026-10-10', 'o próximo contato do lead passa a ser a reunião', lead(2).data_proximo_contato);
const R1 = reuniao.corpo.item.id;

const contato = await POST({ lead_id: 2, tipo: 'contato', canal: 'ligacao', inicio: '2026-10-03T10:00', duracao_min: 999 });
ok(contato.status === 201 && contato.corpo.item.duracao_min === null && contato.corpo.item.local_tipo === null,
  'contato não guarda duração nem local');
ok(lead(2).data_proximo_contato === '2026-10-03', 'um compromisso mais cedo vira o próximo contato');
const C1 = contato.corpo.item.id;

/* ==========================================================================
   3. O QUE ACONTECEU
   ========================================================================== */

console.log('\n=== 3. Realizar, remarcar, excluir ===');

await PUT(C1, { status: 'realizada' });
ok(lead(2).data_proximo_contato === '2026-10-10', 'realizado sai da conta: o próximo volta a ser a reunião');
ok(lead(2).data_ultimo_contato === '2026-10-03', 'e o último contato anda para a data dele');

bd.prepare("UPDATE leads SET data_ultimo_contato = '2026-12-01' WHERE id = 2").run();
await PUT(C1, { status: 'realizada', pauta: 'ligou e pediu proposta' });
ok(lead(2).data_ultimo_contato === '2026-12-01', 'o último contato nunca anda para trás');

await PUT(C1, { status: 'realizada' });
ok(bd.prepare('SELECT pauta FROM agenda_lead WHERE id = ?').get(C1).pauta === 'ligou e pediu proposta',
  'mudar só o status não apaga a pauta');

const remarca = await PUT(R1, { remarcar_para: '2026-10-17T15:00' });
ok(remarca.status === 200 && remarca.corpo.item.inicio === '2026-10-17T15:00' && remarca.corpo.item.status === 'agendada',
  'remarcar cria o compromisso na data nova', remarca.corpo.error);
const antiga = bd.prepare('SELECT * FROM agenda_lead WHERE id = ?').get(R1);
ok(antiga.status === 'remarcada' && antiga.remarcada_para_id === remarca.corpo.item.id,
  'a antiga fica como remarcada, apontando para a nova');
ok(remarca.corpo.item.tipo_reuniao_nome === 'Diagnóstico' && remarca.corpo.item.local_texto === 'https://meet.google.com/abc',
  'a remarcada leva tipo, local e link');
ok(lead(2).data_proximo_contato === '2026-10-17', 'e o próximo contato vai junto');

const denovo = await PUT(R1, { remarcar_para: '2026-10-20T15:00' });
ok(denovo.status === 409, 'o que já foi remarcado não se remarca de novo');

await DEL(remarca.corpo.item.id);
ok(lead(2).data_proximo_contato === null, 'excluído o único agendado, o lead fica sem próximo contato');

/* ==========================================================================
   4. A FICHA NÃO SOBRESCREVE MAIS O PRÓXIMO CONTATO
   ========================================================================== */

console.log('\n=== 4. A ficha ===');

await leads.onRequestPut(ctx('PUT', '/api/leads?id=1', {
  nome: 'Formatar Consultoria', documento: '07091149000172', etapa_id: 2,
  responsavel: 'jair@formatar.com.br', data_proximo_contato: '2030-01-01'
}));
ok(lead(1).data_proximo_contato === '2026-10-05', 'mandar outra data pela ficha não muda nada — vem da agenda', lead(1).data_proximo_contato);

/* ==========================================================================
   5. LEITURA
   ========================================================================== */

console.log('\n=== 5. Leitura ===');

await POST({ lead_id: 1, tipo: 'reuniao', inicio: '2026-10-11T23:30', local_tipo: 'presencial', responsavel: 'marina@formatar.com.br' });

const semana = await GET('de=2026-10-05&ate=2026-10-11');
const inicios = semana.corpo.itens.map((x) => x.inicio);
ok(inicios.includes('2026-10-05T09:00') && inicios.includes('2026-10-11T23:30'),
  'o período inclui o primeiro e o último dia inteiros', inicios.join(', '));
ok(!inicios.includes('2026-10-03T10:00'), 'e nada fora dele');

const daMarina = await GET('de=2026-10-01&ate=2026-10-31&responsavel=marina@formatar.com.br');
ok(daMarina.corpo.itens.every((x) => x.responsavel === 'marina@formatar.com.br') && daMarina.corpo.itens.length === 3,
  'filtro por responsável', String(daMarina.corpo.itens.length));

const busca = await GET('de=2026-10-01&ate=2026-10-31&busca=Formatar');
ok(busca.corpo.itens.every((x) => x.lead_id === 1), 'busca pelo nome do lead');

const doLead = await GET('lead_id=2');
ok(doLead.corpo.itens.length === 2 && doLead.corpo.itens[0].inicio > doLead.corpo.itens[1].inicio,
  'o histórico do lead, do mais recente ao mais antigo (o excluído some)');

const periodoRuim = await GET('de=2026-10-10&ate=2026-10-01');
ok(periodoRuim.status === 400, 'período invertido é recusado');

/* ==========================================================================
   6. IMPORTAÇÃO
   ========================================================================== */

console.log('\n=== 6. A planilha ===');

await DB.batch(comandosDoImportado(DB, { documento: '19131243000197', data: '2026-11-20', usuario: 'jair@formatar.com.br', agora: 'x' }));
ok(lead(2).data_proximo_contato === '2026-11-20', 'o próximo contato da planilha vira agenda e é recalculado');
await DB.batch(comandosDoImportado(DB, { documento: '19131243000197', data: '2026-11-20', usuario: 'jair@formatar.com.br', agora: 'x' }));
ok(bd.prepare("SELECT COUNT(*) n FROM agenda_lead WHERE lead_id = 2 AND inicio = '2026-11-20T09:00' AND ativo = 1").get().n === 1,
  'importar de novo a mesma data não duplica');

/* ==========================================================================
   7. OS TIPOS DO TIME VENDAS
   ========================================================================== */

console.log('\n=== 7. Tipos de reunião do hub ===');

let TIMES = [{ id: 'tv', title: 'VENDAS' }, { id: 'tg', title: 'Governança' }];
const TIPOS_HUB = [
  { id: 't1', title: 'Diagnóstico', teams: ['tv'], isActive: true },
  { id: 't2', title: 'Apresentação', teams: ['tv'], isActive: true },
  { id: 't3', title: 'Valuation', teams: ['tg'], isActive: true },
  { id: 't4', title: 'Antigo', teams: ['tv'], isActive: false }
];
globalThis.fetch = async (url) => {
  const u = String(url);
  const lista = u.includes('/teams') ? TIMES : (u.includes('/meeting-types') ? TIPOS_HUB : null);
  if (!lista) return new Response('{}', { status: 404 });
  const pagina = Number(new URL(u).searchParams.get('page') || 1);
  return new Response(JSON.stringify({ size: lista.length, data: pagina > 1 ? [] : lista }), { status: 200 });
};

esquecerMemoria();
const vendas = await tiposDeVendas({ HUB_API_KEY: 'x' });
ok(vendas.tipos.map((t) => t.nome).join(',') === 'Apresentação,Diagnóstico' && !vendas.aviso,
  'só os tipos ativos do Time Vendas (caixa não importa), em ordem', JSON.stringify(vendas));

esquecerMemoria();
TIMES = [{ id: 'tg', title: 'Governança' }];
const semTime = await tiposDeVendas({ HUB_API_KEY: 'x' });
ok(semTime.tipos.length === 0 && /não existe no hub/.test(semTime.aviso), 'sem o Time Vendas, a tela diz o que cadastrar');

esquecerMemoria();
const outroNome = await tiposDeVendas({ HUB_API_KEY: 'x', TIME_VENDAS: 'Governança' });
ok(outroNome.tipos.map((t) => t.nome).join(',') === 'Valuation', 'TIME_VENDAS no ambiente troca o Time');

esquecerMemoria();
globalThis.fetch = async () => new Response('{}', { status: 403 });
const semPermissao = await GET('tipos=1');
ok(semPermissao.status === 200 && semPermissao.corpo.tipos.length === 0 && /hub/.test(semPermissao.corpo.aviso),
  'hub recusando: a agenda segue, sem tipos, com aviso');

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
