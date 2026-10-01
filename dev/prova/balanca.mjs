/**
 * Prova da Balança Avaliativa (2.39.0).
 *
 * O que importa:
 *   - a instrução padrão no código é a MESMA do Manual;
 *   - as notas privadas das atas nunca vão à IA;
 *   - os números do período são do código, não do modelo;
 *   - cada evidência é ancorada na linha da ata ou da ação, com a origem;
 *   - a instrução enviada nas Configurações vale no lugar da padrão;
 *   - cliente sem ERP, ERP mudo, período sem material: avisos claros.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as balancaApi from '../../functions/api/balanca.js';
import * as roteirosApi from '../../functions/api/roteiros.js';
import { INSTRUCAO_PADRAO } from '../../functions/api/_lib/instrucao-balanca.js';
import {
  montarFonte, calcularNumeros, conferirCitacoes, montarDocumento, inicioDoPeriodo, preVendaParaPrompt, LIMITE_FONTE
} from '../../functions/api/_lib/balanca.js';
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
   1. A INSTRUÇÃO E A FONTE, SEM BANCO
   ========================================================================== */

console.log('\n=== 1. Instrução e fonte ===');

const manual = readFileSync(`${RAIZ}/Manuais/Instrucao-Balanca-Avaliativa-V1.0.md`, 'utf8').replace(/\r\n/g, '\n');
ok(INSTRUCAO_PADRAO === manual, 'a instrução padrão do código é a mesma do Manual');

const ATA_SET = [
  'Atas Cedro Materiais - Financeiro',
  '15/09/2026 das 09:00 às 10:00',
  'Participantes: Amanda, Pedro',
  'O cliente elogiou o novo fluxo de caixa semanal.',
  'O sócio reclamou do atraso na conciliação bancária.',
  '',
  'CLIENTE PENSA EM CANCELAR SE NÃO MELHORAR',
  'NÃO COMENTAR COM O SÓCIO'
].join('\n');
const ATA_AGO = 'Atas Cedro Materiais - Pessoas\n10/08/2026\nA gerente de RH confirmou a contratação do analista.';
const reunioes = [
  { erp_id: 'r2', inicio: '2026-09-15T12:00:00.000Z', nucleo: 'Financeiro', titulo: 'Reunião mensal', ata: ATA_SET },
  { erp_id: 'r1', inicio: '2026-08-10T12:00:00.000Z', nucleo: 'Pessoas', titulo: null, ata: ATA_AGO },
  { erp_id: 'r0', inicio: '2026-07-01T12:00:00.000Z', nucleo: 'Pessoas', titulo: null, ata: '' }
];
const acoes = [
  { numero_cliente: 7, descricao: 'Implantar a conciliação bancária diária', status: 'repactuado', prazo: 'out/26', data_prevista: '2026-09-01', responsavel: 'Amanda', tipo_reuniao: 'Financeiro' },
  { numero_cliente: 8, descricao: 'Treinar a equipe no fluxo de caixa', status: 'concluida', prazo: null, data_prevista: '2026-08-20', responsavel: 'Pedro', tipo_reuniao: 'Financeiro' }
];

const fonte = montarFonte(reunioes, acoes);
ok(!/PENSA EM CANCELAR|NÃO COMENTAR/.test(fonte.texto), 'as notas privadas (caixa alta no fim) não vão à IA');
ok(/O sócio reclamou do atraso/.test(fonte.texto), 'e o resto da ata vai');
ok(fonte.texto.indexOf('ATA · 10/08/2026') < fonte.texto.indexOf('ATA · 15/09/2026'), 'as atas vão da mais antiga para a mais nova');
ok(fonte.atasUsadas === 2, 'ata vazia não entra', String(fonte.atasUsadas));
const ultimaLinha = fonte.linhas[fonte.linhas.length - 1];
ok(/^Ação 8 · núcleo Financeiro · status: concluída/.test(ultimaLinha.texto) && ultimaLinha.rotulo === 'ação 8 do plano', 'as ações entram como linhas, com o número do plano');
ok(fonte.linhas.every((l, i) => l.n === i + 1) && new RegExp(`\\[L${ultimaLinha.n}\\] Ação 8`).test(fonte.texto), 'numeradas de 1 em diante, como no prompt');

const grande = Array.from({ length: 40 }, (_, i) => ({
  erp_id: `g${i}`, inicio: `2026-0${(i % 6) + 4}-${String((i % 27) + 1).padStart(2, '0')}T12:00:00.000Z`, nucleo: 'X', titulo: null,
  ata: `Atas X - X\n01/01/2026\n${'Uma linha longa da ata para encher o tamanho. '.repeat(60)}`
}));
const cortada = montarFonte(grande, []);
ok(cortada.texto.length <= LIMITE_FONTE + 2000 && cortada.atasOmitidas > 0 && /mais antiga\(s\) do período omitida/.test(cortada.texto),
  'fonte grande: saem as atas mais antigas, e o texto avisa', `${cortada.atasOmitidas} omitida(s)`);

const numeros = calcularNumeros({ reunioes, canceladas: 2, acoes, de: '2026-04-01', ate: '2026-10-01', hoje: new Date('2026-10-01T12:00:00Z') });
ok(numeros.reunioes === 3 && numeros.comAta === 2 && numeros.porNucleo.Pessoas === 2 && numeros.canceladasPeloCliente === 2,
  'os números das reuniões, por núcleo e cancelamentos', JSON.stringify(numeros.porNucleo));
ok(numeros.ultimaReuniao === '2026-09-15' && numeros.diasSemReuniao === 16, 'a última reunião e os dias desde ela');
ok(numeros.acoes.total === 2 && numeros.acoes.concluidas === 1 && numeros.acoes.abertas === 1 && numeros.acoes.atrasadas === 1 && numeros.acoes.repactuadas === 1,
  'as ações: concluída, aberta, atrasada (prazo passou), repactuada', JSON.stringify(numeros.acoes));
ok(inicioDoPeriodo(new Date('2026-10-01T12:00:00Z')) === '2026-04-01', 'o período começa 6 meses antes');

const nSocio = fonte.linhas.find((l) => /sócio reclamou/.test(l.texto)).n;
const nAcao7 = fonte.linhas.find((l) => /^Ação 7/.test(l.texto)).n;
const conf = conferirCitacoes([
  `<li>Atraso: <q>[${nSocio}] o socio reclamou do atrazo na conciliação bancaria</q></li>`,
  `<li>Plano: <q>[${nAcao7}] Implantar a conciliação bancária diária</q></li>`,
  `<li><q>[${nSocio}] o cliente vai cancelar o contrato no mês que vem</q></li>`,
  '<li><q>A gerente de RH confirmou a contratação</q></li>'
].join(''), fonte.linhas);
ok(/<q class="confere">O sócio reclamou do atraso na conciliação bancária\.<\/q> <span class="cit-minuto">ata de 15\/09\/2026<\/span>/.test(conf.html),
  'a evidência sai com as palavras exatas da ata e a data dela', conf.html.slice(0, 160));
ok(/<q class="confere">Implantar a conciliação bancária diária<\/q> <span class="cit-minuto">ação 7 do plano<\/span>/.test(conf.html), 'e a da ação, com o número do plano');
ok(conf.citacoes === 4 && conf.naoEncontradas === 1 && /não encontrada na fonte/.test(conf.html), 'a que a linha não sustenta fica marcada');
ok(/ata de 10\/08\/2026/.test(conf.html), 'sem número, ainda confere palavra por palavra');

const doc = montarDocumento({
  conteudo: conf.html, cliente: { nome: 'Cedro Materiais' }, numeros,
  meta: { versao: 2, geradoEm: '2026-10-01T15:00:00.000Z', geradoPor: 'jair@formatar.com.br', instrucao: 'padrão 1.0', provider: 'deepseek', citacoes: 4, naoEncontradas: 1, atasOmitidas: 0 }
});
ok(/<title>Balanca_Avaliativa_Cedro-Materiais_2026_10<\/title>/.test(doc), 'o nome do arquivo segue o padrão', doc.match(/<title>[^<]*/)?.[0]);
ok(/calculados pelo CRM, não pela IA/.test(doc) && /Canceladas pelo cliente/.test(doc) && /1 \/ 1 \/ 0/.test(doc), 'os números vão numa tabela feita pelo código');
ok(/rel="icon"/.test(doc) && /notas privadas, não/.test(doc) && /padrão 1\.0/.test(doc), 'com o ícone, o aviso das notas privadas e a instrução usada');

ok(/Custo por unidade/.test(preVendaParaPrompt(JSON.stringify({ conteudo: '<h2>Dores</h2><ul><li>Custo por unidade <q class="confere">não sabemos</q></li></ul>' })) || ''),
  'o dossiê da pré-venda vai como texto corrido');

/* ==========================================================================
   2. A API
   ========================================================================== */

console.log('\n=== 2. A API ===');

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
bd.exec(`
  CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT, nome_fantasia TEXT, documento TEXT, erp_id TEXT, lead_id INTEGER, ativo INTEGER DEFAULT 1);
  INSERT INTO clientes (id, nome, nome_fantasia, erp_id, lead_id) VALUES
    (1, 'CEDRO MATERIAIS LTDA', 'Cedro Materiais', 'erp-cedro', 5),
    (2, 'Sem ERP Ltda', NULL, NULL, NULL);
  CREATE TABLE acoes_cx (id INTEGER PRIMARY KEY, cliente_erp_id TEXT, numero_cliente INTEGER, descricao TEXT, status TEXT,
                         prazo TEXT, data_prevista TEXT, responsavel TEXT, tipo_reuniao TEXT, reuniao_em TEXT);
  INSERT INTO acoes_cx (cliente_erp_id, numero_cliente, descricao, status, prazo, data_prevista, responsavel, tipo_reuniao, reuniao_em) VALUES
    ('erp-cedro', 7, 'Implantar a conciliação bancária diária', 'repactuado', 'out/26', '2026-09-01', 'Amanda', 'Financeiro', '2026-09-15'),
    ('erp-cedro', 3, 'Ação antiga já concluída', 'concluida', NULL, '2025-01-10', 'Pedro', 'Financeiro', '2025-01-10'),
    ('outro', 1, 'De outro cliente', 'nova', NULL, NULL, NULL, NULL, '2026-09-01');
`);
for (const m of ['019-ia-e-roteiros', '020-gravacao', '025-dossie-reuniao']) {
  bd.exec(readFileSync(`${RAIZ}/db/migracao-${m}.sql`, 'utf8'));
}
bd.exec(`INSERT INTO dossies_reuniao (reuniao_id, lead_id, versao, gerado_por, gerado_em, status, dados_json)
         VALUES (80, 5, 1, 'x', '2026-03-01T00:00:00Z', 'concluido', '${JSON.stringify({ conteudo: '<p>Expectativa: controlar o custo por unidade</p>' }).replace(/'/g, "''")}')`);

// O ERP e a IA, simulados.
let hubFora = false;
let respostaIA = '';
let pedidoIA = null;
const chamadasHub = [];
globalThis.fetch = async (url, opcoes) => {
  const u = new URL(String(url));
  if (u.host === 'hub.teste') {
    chamadasHub.push(`${u.pathname}?status=${u.searchParams.get('status') || ''}`);
    if (hubFora) return new Response('fora', { status: 503 });
    if (u.pathname.endsWith('/meeting-types')) {
      return new Response(JSON.stringify({ size: 1, data: [{ id: 'nucleo-fin', title: 'Financeiro', teams: [], isActive: true }] }), { status: 200 });
    }
    if (u.pathname.endsWith('/meetings')) {
      if (u.searchParams.get('status') === 'canceled_by_customer') {
        return new Response(JSON.stringify({ size: 1, data: [{ id: 'c1', status: 'canceled_by_customer', startDate: '2026-08-01T12:00:00Z' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ size: 1, data: [{ id: 'r2', title: 'Reunião mensal', status: 'finished', customer: 'erp-cedro',
        meetingType: 'nucleo-fin', startDate: '2026-09-15T12:00:00Z', notes: ATA_SET }] }), { status: 200 });
    }
  }
  if (u.host === 'api.deepseek.com') {
    pedidoIA = JSON.parse(opcoes.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: respostaIA } }] }), { status: 200 });
  }
  throw new Error(`fetch inesperado: ${url}`);
};

const JAIR = { email: 'Jair@formatar.com.br' };
const SOCIO = { email: 'socio@formatar.com.br', grupoId: '64e678a7d2042dae072ef102' };
const cab = { 'Content-Type': 'application/json' };
const ctx = (metodo, url, corpo, usuario = JAIR, env = {}) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : { method: metodo, headers: cab, body: JSON.stringify(corpo) }),
  env: { DB, DEEPSEEK_API_KEY: 'teste', HUB_API_KEY: 'chave', HUB_BASE_URL: 'http://hub.teste', ...env },
  data: { cabecalhos: cab, usuario }
});
const ler = async (r) => {
  const tipo = r.headers.get('Content-Type') || '';
  return { status: r.status, corpo: tipo.includes('html') ? await r.text() : await r.json() };
};
const ESTADO = (id) => balancaApi.onRequestGet(ctx('GET', `/api/balanca?cliente_id=${id}`)).then(ler);
const GERAR = (id, env) => balancaApi.onRequestPost(ctx('POST', '/api/balanca', { cliente_id: id }, JAIR, env)).then(ler);

const semTabela = await ESTADO(1);
ok(semTabela.status === 200 && /026/.test(semTabela.corpo.motivo || ''), 'sem a migração 026, o estado avisa');
bd.exec(readFileSync(`${RAIZ}/db/migracao-026-balanca.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-026-balanca.sql`, 'utf8'));
ok(true, 'a 026 roda duas vezes sem erro');

let e = (await ESTADO(2)).corpo;
ok(!e.pode_gerar && /não está vinculado ao ERP/.test(e.motivo), 'cliente sem ERP: o estado diz por quê');
ok((await GERAR(2)).corpo.code === 'SEM_ERP', 'e a POST recusa');
e = (await ESTADO(1)).corpo;
ok(e.pode_gerar && e.instrucao.padrao && e.instrucao.rotulo === 'padrão 1.0' && e.versoes.length === 0, 'cliente com ERP: pode gerar, com a instrução padrão');

hubFora = true;
esquecerMemoria();
const fora = await GERAR(1);
ok(fora.status === 502 && fora.corpo.code === 'HUB_FALHOU', 'ERP mudo: avisa, sem gerar', fora.corpo.error);
hubFora = false;

respostaIA = '<h2>2. Síntese</h2><p>' + 'A relação está equilibrada no período. '.repeat(15) + '</p>'
  + '<h2>3. A Balança</h2><table><tr><th>Positivos</th><th>Negativos</th></tr><tr><td><ul><li>Fluxo de caixa: <q>[4] O cliente elogiou o novo fluxo de caixa</q> (PERCEPÇÃO)</li></ul></td>'
  + '<td><ul><li>Conciliação: <q>[5] O sócio reclamou do atrazo</q> (FATO)</li><li><q>[5] o cliente pensa em cancelar</q></li></ul></td></tr></table>';
const g1 = await GERAR(1);
ok(g1.status === 201 && g1.corpo.versao === 1 && g1.corpo.citacoes === 3 && g1.corpo.citacoes_nao_encontradas === 1,
  'gera: 3 evidências, 1 não sustentada pela linha', JSON.stringify(g1.corpo));
ok(g1.corpo.reunioes === 1 && g1.corpo.acoes === 1, 'a fonte: 1 reunião e só a ação do período ou aberta deste cliente');
const prompt = pedidoIA.messages[1].content;
ok(prompt.includes('INSTRUÇÃO — BALANÇA AVALIATIVA DO CLIENTE') && !/PENSA EM CANCELAR/.test(prompt), 'o prompt leva a instrução padrão, e nada das notas privadas');
ok(/Reuniões canceladas pelo cliente: 1/.test(prompt) && /ATA · 15\/09\/2026 · Financeiro/.test(prompt) && /controlar o custo por unidade/.test(prompt),
  'e os números, o núcleo pelo nome e a pré-venda');
ok(pedidoIA.max_tokens === 8000 && !pedidoIA.response_format, 'até 8000 tokens, saída em HTML');
ok(chamadasHub.some((c) => c.includes('status=finished')) && chamadasHub.some((c) => c.includes('canceled_by_customer')), 'lê do ERP as realizadas e as canceladas pelo cliente');

const html = (await balancaApi.onRequestGet(ctx('GET', '/api/balanca?cliente_id=1&html=1')).then(ler)).corpo;
// A IA citou só o começo da linha, com erro ("atrazo"): sai o começo, nas palavras da ata.
ok(/Balanca_Avaliativa_Cedro-Materiais/.test(html) && /<q class="confere">O sócio reclamou do atraso<\/q>/.test(html)
  && !/atrazo/.test(html) && /não encontrada na fonte/.test(html),
  'o documento sai com a evidência exata (o erro da IA não passa) e a marca na não sustentada');
e = (await ESTADO(1)).corpo;
ok(e.versoes.length === 1 && e.versoes[0].instrucao === 'padrão 1.0' && e.versoes[0].reunioes === 1, 'o estado lista a versão com a instrução e a fonte');

// A instrução enviada nas Configurações vale no lugar da padrão.
const env1 = await roteirosApi.onRequestPost(ctx('POST', '/api/roteiros', {
  tipo_reuniao_erp_id: 'qualquer', finalidade: 'balanca', nome_arquivo: 'balanca.md', conteudo: '# MINHA BALANÇA v2\nPese a relação.'
}, SOCIO)).then(ler);
ok(env1.status === 201 && bd.prepare("SELECT tipo_reuniao_erp_id t FROM roteiros WHERE finalidade = 'balanca'").get().t === '__geral__',
  'a instrução da Balança é guardada no tipo geral, venha o que vier');
const g2 = await GERAR(1);
ok(g2.corpo.versao === 2 && pedidoIA.messages[1].content.includes('# MINHA BALANÇA v2') && !pedidoIA.messages[1].content.includes('BALANÇA AVALIATIVA DO CLIENTE'),
  'com a instrução enviada, ela vale no lugar da padrão');
ok((await ESTADO(1)).corpo.instrucao.rotulo === 'v1', 'e o estado mostra qual');

bd.exec("DELETE FROM acoes_cx");
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.pathname.endsWith('/meeting-types')) return new Response(JSON.stringify({ size: 0, data: [] }), { status: 200 });
  return new Response(JSON.stringify({ size: 0, data: [] }), { status: 200 });
};
esquecerMemoria();
ok((await GERAR(1)).corpo.code === 'SEM_MATERIAL', 'sem ata nem ação no período: avisa, sem chamar a IA');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
