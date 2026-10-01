/**
 * Prova dos recortes e do roteiro da reunião (2.37.0).
 *
 * O que importa:
 *   - a citação só vale se estiver na transcrição, palavra por palavra
 *     (sem acento, caixa e pontuação); o resto é descartado e contado;
 *   - com as vozes separadas (online), só a fala do LEAD vira recorte;
 *   - item do roteiro só é coberto com evidência na conversa;
 *   - sem trecho novo, não chama a IA de novo;
 *   - o roteiro é o da gravação; o dossiê entra no prompt;
 *   - resetar a reunião apaga as análises.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as recortesApi from '../../functions/api/recortes.js';
import * as agenda from '../../functions/api/agenda.js';
import {
  normalizar, localizar, conferirAnalise, separacaoDeVozes, transcricaoParaPrompt, resumoDoDossie, montarPrompt
} from '../../functions/api/_lib/recortes.js';

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
   1. A CONFERÊNCIA, SEM BANCO
   ========================================================================== */

console.log('\n=== 1. A conferência ===');

ok(normalizar('Ação, É preciso: ORÇAMENTO!') === 'acao e preciso orcamento', 'normaliza acento, caixa e pontuação');

const conversa = [
  { gravacao_id: 1, origem: 'formatar', inicio_s: 0, texto: 'Bom dia! Como vocês controlam o custo hoje?' },
  { gravacao_id: 1, origem: 'lead', inicio_s: 4, texto: 'Hoje a gente separa o custo do cimento por obra,' },
  { gravacao_id: 1, origem: 'lead', inicio_s: 9, texto: 'mas não por unidade, e isso atrapalha o preço. Nós precisamos fechar isso até março, com orçamento de 20 mil.' },
  { gravacao_id: 1, origem: 'formatar', inicio_s: 20, texto: 'Entendi. E quem aprova o projeto além de você?' },
  { gravacao_id: 1, origem: 'lead', inicio_s: 25, texto: 'O meu sócio decide comigo, ele tem receio de consultoria porque já teve uma experiência ruim.' }
];

ok(localizar('o custo do cimento por obra, mas não por unidade', conversa, ['lead'])?.inicio_s === 4,
  'acha a frase cortada entre dois trechos do mesmo lado, com o segundo do começo');
ok(localizar('custo do cimento por obra', conversa, ['formatar']) === null, 'na voz errada não acha');
ok(localizar('O custo do Cimento POR obra!!', conversa, ['lead'])?.inicio_s === 4, 'caixa e pontuação não importam');
ok(localizar('o custo da areia por obra', conversa, ['lead']) === null, 'uma palavra trocada não confere');
ok(localizar('o plano', conversa, null) === null, 'curta demais não vale');
ok(localizar('ano passado nós fechamos', [{ gravacao_id: 1, origem: 'lead', inicio_s: 0, texto: 'no plano passado nós fechamos tudo' }], null) === null,
  'só na borda de palavra: "ano" não acha dentro de "plano"');

const sep = separacaoDeVozes(conversa);
ok(sep.separacao && sep.origensDoLead.join() === 'lead', 'online com som do lead: as vozes são separáveis');
const sala = [{ gravacao_id: 1, origem: 'sala', inicio_s: 0, texto: 'x'.repeat(500) }];
ok(!separacaoDeVozes(sala).separacao && separacaoDeVozes(sala).origensDoLead === null, 'presencial (Sala): não separa, vale todo texto');
// O caso de 01/10/2026: 115 trechos no microfone e 3 soltos do computador.
const quaseTudoNoMicrofone = [
  ...Array.from({ length: 115 }, (_, i) => ({ gravacao_id: 1, origem: 'formatar', inicio_s: i * 12, texto: 'x'.repeat(150) })),
  ...Array.from({ length: 3 }, (_, i) => ({ gravacao_id: 1, origem: 'lead', inicio_s: i * 300, texto: 'y'.repeat(120) }))
];
ok(!separacaoDeVozes(quaseTudoNoMicrofone).separacao,
  '3 trechos soltos do computador entre 118 não separam as vozes (a análise vazia de 01/10)');

const conferido = conferirAnalise({
  recortes: [
    { tipo: 'dor', citacao: 'separa o custo do cimento por obra, mas não por unidade', por_que: 'Não sabe o custo por unidade.' },
    { tipo: 'decisao', citacao: 'Nós precisamos fechar isso até março, com orçamento de 20 mil', por_que: 'Prazo e verba.' },
    { tipo: 'objecao', citacao: 'ele tem receio de consultoria porque já teve uma experiência ruim', por_que: 'Sócio desconfiado.' },
    { tipo: 'expectativa', citacao: 'queremos dobrar o faturamento em um ano', por_que: 'Inventado.' },
    { tipo: 'dor', citacao: 'Como vocês controlam o custo hoje', por_que: 'É da Formatar.' },
    { tipo: 'humor', citacao: 'O meu sócio decide comigo', por_que: 'Tipo inválido.' },
    { tipo: 'dor', citacao: 'Separa o custo do cimento por obra, mas não por unidade!', por_que: 'Repetido.' }
  ],
  roteiro: [
    { item: 'Como controla custos', coberto: true, evidencia: 'Como vocês controlam o custo hoje' },
    { item: 'Quem decide', coberto: true, evidencia: 'quem aprova o projeto além de você' },
    { item: 'Faturamento anual', coberto: true, evidencia: 'faturamos dez milhões por ano' },
    { item: 'Número de obras', coberto: false, evidencia: '' }
  ],
  sugestoes: ['Quantas obras por ano?', 'O que deu errado na consultoria anterior?', 'Quem mais participa?', 'Quarta sugestão sobra']
}, conversa, { temRoteiro: true });

ok(conferido.recortes.map((r) => r.tipo).join(',') === 'dor,decisao,objecao', 'ficam só os 3 recortes reais do lead, na ordem da conversa',
  conferido.recortes.map((r) => `${r.tipo}@${r.inicio_s}`).join(' '));
ok(conferido.descartados === 3, 'inventado, fala da Formatar e tipo inválido: 3 descartados (o repetido só some)', String(conferido.descartados));
ok(conferido.recortes[1].inicio_s === 9 && conferido.recortes[2].inicio_s === 25, 'cada recorte com o segundo em que foi dito');
ok(conferido.roteiro.map((i) => i.coberto).join() === 'true,true,false,false',
  'roteiro: coberto só com evidência na conversa (a de "faturamento" é inventada)');
ok(conferido.sugestoes.length === 3, 'no máximo 3 sugestões');
ok(conferirAnalise({ roteiro: [{ item: 'x', coberto: true, evidencia: 'Como vocês controlam o custo hoje' }] }, conversa).roteiro.length === 0,
  'sem roteiro, a lista do roteiro fica vazia mesmo que a IA invente');

ok(/^\[00:04\] LEAD: Hoje a gente/m.test(transcricaoParaPrompt(conversa)), 'a transcrição vai ao prompt com tempo e voz');
const longa = Array.from({ length: 3000 }, (_, i) => ({ gravacao_id: 1, origem: 'sala', inicio_s: i, texto: `frase número ${i} da conversa` }));
const p = transcricaoParaPrompt(longa);
ok(p.length <= 60100 && p.startsWith('(início da conversa omitido)') && p.includes('frase número 2999'), 'conversa longa: corta o começo e guarda o fim');
ok(/Hipóteses de dor: Custo sem controle/.test(resumoDoDossie(JSON.stringify({ analise: {
  hipotesesDores: [{ dor: 'Custo sem controle' }], momento: { titulo: 'Expansão', descricao: '<p>Abrindo filial</p>' }, recomendacao: '<p>Falar de custos</p>'
} })) || ''), 'o resumo do dossiê leva as dores, o momento e a abordagem, sem HTML');
ok(/NÃO separa as vozes/.test(montarPrompt({ leadNome: 'Cedro', separacao: false, trechos: sala })), 'o prompt avisa quando as vozes não estão separadas');

/* ==========================================================================
   2. A API
   ========================================================================== */

console.log('\n=== 2. A API ===');

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
bd.exec(`
  CREATE TABLE leads (id INTEGER PRIMARY KEY, nome TEXT, documento TEXT, etapa_id INTEGER, responsavel TEXT,
                      ativo INTEGER DEFAULT 1, data_proximo_contato TEXT, data_ultimo_contato TEXT);
  INSERT INTO leads (id, nome, documento, responsavel) VALUES (1, 'Cedro', '12.345.678/0001-95', 'jair@formatar.com.br');
  CREATE TABLE dossies (id INTEGER PRIMARY KEY, cnpj TEXT, versao INTEGER, status TEXT, dados_json TEXT);
  INSERT INTO dossies (cnpj, versao, status, dados_json) VALUES
    ('12345678000195', 1, 'concluido', '{"analise":{"hipotesesDores":[{"dor":"Margem apertada"}]}}'),
    ('12345678000195', 2, 'concluido', '{"analise":{"hipotesesDores":[{"dor":"Custo por unidade desconhecido"}]}}');
`);
for (const m of ['017-agenda-lead', '019-ia-e-roteiros', '020-gravacao', '021-reuniao-iniciar-finalizar', '022-cancelamento-motivo', '023-agenda-eventos', '025-dossie-reuniao']) {
  bd.exec(readFileSync(`${RAIZ}/db/migracao-${m}.sql`, 'utf8'));
}
bd.exec(`INSERT INTO agenda_lead (id, lead_id, tipo, inicio, duracao_min, local_tipo, tipo_reuniao_erp_id, tipo_reuniao_nome, status, responsavel, criado_por, criado_em)
         VALUES (10, 1, 'reuniao', '2026-10-01T09:00', 60, 'online', 'tipo-prospect', 'Prospect de Clientes', 'agendada', 'jair@formatar.com.br', 'x', 'x');
         INSERT INTO agenda_lead (id, lead_id, tipo, inicio, canal, status, criado_por, criado_em)
         VALUES (11, 1, 'contato', '2026-10-02T09:00', 'ligacao', 'agendada', 'x', 'x');
         INSERT INTO roteiros (id, tipo_reuniao_erp_id, tipo_reuniao_nome, versao, conteudo, tamanho, enviado_por, enviado_em)
         VALUES (1, 'tipo-prospect', 'Prospect de Clientes', 1, '# Roteiro v1\n- Como controla custos\n- Quem decide', 40, 'x', 'x'),
                (2, 'tipo-prospect', 'Prospect de Clientes', 2, '# Roteiro v2\n- Outra coisa', 30, 'x', 'x');
         INSERT INTO gravacoes (id, reuniao_id, lead_id, modo, consentimento_por, consentimento_em, roteiro_id, roteiro_versao, transcritor, status, iniciada_por, iniciada_em)
         VALUES (1, 10, 1, 'online', 'x', 'x', 1, 1, 'workers-ai', 'encerrada', 'jair@formatar.com.br', 'x');`);
const inserirTrecho = bd.prepare(`INSERT INTO transcricao_trechos (gravacao_id, origem, seq, inicio_s, texto, criado_em) VALUES (1, ?, ?, ?, ?, 'x')`);
inserirTrecho.run('formatar', 0, 0, 'Bom dia!');

// O "DeepSeek": devolve o que a prova mandar, e guarda o que recebeu.
let respostaIA = {};
let chamadas = 0;
let ultimoPrompt = '';
globalThis.fetch = async (url, opcoes) => {
  if (!String(url).includes('deepseek')) throw new Error(`fetch inesperado: ${url}`);
  chamadas++;
  ultimoPrompt = JSON.parse(opcoes.body).messages[1].content;
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(respostaIA) } }] }), { status: 200 });
};

const JAIR = { email: 'Jair@formatar.com.br' };
const cab = { 'Content-Type': 'application/json' };
const ctx = (metodo, url, corpo, env = {}) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : { method: metodo, headers: cab, body: JSON.stringify(corpo) }),
  env: { DB, DEEPSEEK_API_KEY: 'teste', ...env },
  data: { cabecalhos: cab, usuario: JAIR }
});
const ler = async (r) => ({ status: r.status, corpo: await r.json() });
const ANALISAR = (corpo, env) => recortesApi.onRequestPost(ctx('POST', '/api/recortes', corpo, env)).then(ler);
const ULTIMA = (id) => recortesApi.onRequestGet(ctx('GET', `/api/recortes?reuniao_id=${id}`)).then(ler);

ok((await ANALISAR({ reuniao_id: 11 })).corpo.code === 'NAO_ENCONTRADA', 'contato não tem recortes');
ok((await ANALISAR({ reuniao_id: 10 })).corpo.code === 'POUCA_CONVERSA', 'com pouca conversa, não chama a IA');

conversa.forEach((t, i) => inserirTrecho.run(t.origem, i + 1, t.inicio_s + 1, t.texto));

const semMigracao = await ANALISAR({ reuniao_id: 10 });
ok(semMigracao.status === 500 && /024/.test(semMigracao.corpo.error), 'sem a migração 024, avisa');
ok((await ULTIMA(10)).corpo.aviso?.includes('024'), 'e a leitura também avisa, sem quebrar');
bd.exec(readFileSync(`${RAIZ}/db/migracao-024-reuniao-analises.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-024-reuniao-analises.sql`, 'utf8'));
ok(true, 'a 024 roda duas vezes sem erro');

ok((await ANALISAR({ reuniao_id: 10 }, { DEEPSEEK_API_KEY: '' })).corpo.code === 'SEM_IA', 'sem chave de IA, avisa');

respostaIA = {
  recortes: [
    { tipo: 'dor', citacao: 'separa o custo do cimento por obra, mas não por unidade', por_que: 'Não sabe o custo por unidade.' },
    { tipo: 'expectativa', citacao: 'queremos dobrar o faturamento em um ano', por_que: 'Inventado.' }
  ],
  roteiro: [{ item: 'Como controla custos', coberto: true, evidencia: 'Como vocês controlam o custo hoje' }, { item: 'Quem decide', coberto: false }],
  sugestoes: ['Quantas obras por ano?']
};
chamadas = 0;
const a1 = await ANALISAR({ reuniao_id: 10 });
const an = a1.corpo.analise;
ok(a1.status === 200 && chamadas === 1 && an.recortes.length === 1 && an.descartados === 1, 'analisa: 1 recorte confere, 1 descartado', JSON.stringify(a1.corpo).slice(0, 200));
ok(an.roteiro?.versao === 1 && an.roteiro.itens.map((i) => i.coberto).join() === 'true,false', 'usa o roteiro da gravação (versão 1, não a 2 em vigor)');
ok(an.separacao === true && an.com_dossie === true && an.gerado_por === 'jair@formatar.com.br' && an.provedor === 'deepseek', 'guarda separação, dossiê, quem e a IA');
ok(/Custo por unidade desconhecido/.test(ultimoPrompt) && !/Margem apertada/.test(ultimoPrompt), 'o prompt leva o dossiê mais novo');
ok(/Roteiro v1/.test(ultimoPrompt) && /\[00:05\] LEAD: Hoje a gente/.test(ultimoPrompt), 'e o roteiro e a conversa');

const igual = await ANALISAR({ reuniao_id: 10 });
ok(igual.corpo.sem_novidade === true && chamadas === 1 && igual.corpo.analise.id === an.id, 'sem trecho novo, não chama a IA de novo');
ok((await ANALISAR({ reuniao_id: 10, forcar: true })).status === 200 && chamadas === 2, '"forcar" analisa mesmo assim');

inserirTrecho.run('lead', 99, 40, 'E a gente queria ver isso funcionando antes do fim do ano.');
respostaIA = { recortes: [], roteiro: [], sugestoes: [] };
const a3 = await ANALISAR({ reuniao_id: 10 });
ok(chamadas === 3 && a3.corpo.analise.trechos === 7, 'com trecho novo, analisa de novo');
ok((await ULTIMA(10)).corpo.analise.id === a3.corpo.analise.id, 'a leitura devolve a última');

respostaIA = 'isto não é json';
globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'nada de json aqui' } }] }), { status: 200 });
ok((await ANALISAR({ reuniao_id: 10, forcar: true })).corpo.code === 'JSON_INVALIDO', 'resposta sem JSON: avisa, e não guarda');
globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Saldo insuficiente' } }), { status: 402 });
const caiu = await ANALISAR({ reuniao_id: 10, forcar: true });
ok(caiu.status === 502 && /Saldo insuficiente/.test(caiu.corpo.error), 'a IA recusou: a mensagem dela chega à tela');

/* ==========================================================================
   3. RESETAR APAGA AS ANÁLISES
   ========================================================================== */

console.log('\n=== 3. Resetar ===');

bd.exec("UPDATE agenda_lead SET status = 'realizada', iniciada_em = 'x', finalizada_em = 'x', iniciada_por = 'jair@formatar.com.br' WHERE id = 10");
const reset = await agenda.onRequestPut(ctx('PUT', '/api/agenda?id=10', { acao: 'resetar' })).then(ler);
ok(reset.status === 200 && bd.prepare('SELECT COUNT(*) n FROM reuniao_analises WHERE reuniao_id = 10').get().n === 0,
  'resetar a reunião apaga as análises dela');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
