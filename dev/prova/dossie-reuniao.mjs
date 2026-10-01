/**
 * Prova do Dossiê da Reunião (2.38.0).
 *
 * Pedido de 01/10/2026. O que importa:
 *   - a instrução é um .md por tipo de reunião, nas Configurações, com
 *     versões próprias — separada do roteiro (migração 025, finalidade);
 *   - a gravação e os recortes nunca pegam a instrução como roteiro;
 *   - o HTML da IA é limpo (só as tags da lista, sem atributo nenhum);
 *   - cada citação <q> é procurada na transcrição: achou, ganha o minuto;
 *     não achou, fica marcada "não encontrada na transcrição";
 *   - gerar de novo cria a versão seguinte; só a reunião finalizada,
 *     com instrução e com conversa; resetar apaga.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as dossieApi from '../../functions/api/dossie-reuniao.js';
import * as roteirosApi from '../../functions/api/roteiros.js';
import * as recortesApi from '../../functions/api/recortes.js';
import * as agenda from '../../functions/api/agenda.js';
import { limparConteudo, conferirCitacoes, montarDocumento, montarPrompt } from '../../functions/api/_lib/dossie-reuniao.js';

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
   1. A MIGRAÇÃO 025
   ========================================================================== */

console.log('\n=== 1. A migração 025 ===');

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
bd.exec(`
  CREATE TABLE leads (id INTEGER PRIMARY KEY, nome TEXT, documento TEXT, etapa_id INTEGER, responsavel TEXT,
                      ativo INTEGER DEFAULT 1, data_proximo_contato TEXT, data_ultimo_contato TEXT);
  INSERT INTO leads (id, nome, responsavel) VALUES (1, 'Cedro Materiais', 'jair@formatar.com.br');
`);
bd.exec(`CREATE TABLE usuarios_crm (email TEXT PRIMARY KEY, nome TEXT);
         INSERT INTO usuarios_crm (email, nome) VALUES ('jair@formatar.com.br', 'Jair Tavares');`);
for (const m of ['017-agenda-lead', '019-ia-e-roteiros', '020-gravacao', '021-reuniao-iniciar-finalizar',
  '022-cancelamento-motivo', '023-agenda-eventos', '024-reuniao-analises']) {
  bd.exec(readFileSync(`${RAIZ}/db/migracao-${m}.sql`, 'utf8'));
}
// Um roteiro de antes da 025.
bd.exec(`INSERT INTO roteiros (tipo_reuniao_erp_id, tipo_reuniao_nome, versao, conteudo, tamanho, enviado_por, enviado_em)
         VALUES ('tipo-prospect', 'Prospect de Clientes', 1, '# Roteiro\n- Como controla custos', 30, 'x', 'x')`);
bd.exec(readFileSync(`${RAIZ}/db/migracao-025-dossie-reuniao.sql`, 'utf8'));

ok(bd.prepare("SELECT finalidade FROM roteiros WHERE id = 1").get().finalidade === 'roteiro', 'o roteiro que já existia vira finalidade "roteiro"');
ok(!bd.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_roteiros_tipo_versao'").get()
  && !!bd.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_roteiros_finalidade_versao'").get(), 'o índice antigo sai, o novo entra');
ok(!!bd.prepare("SELECT 1 FROM sqlite_master WHERE name = 'dossies_reuniao'").get(), 'e a tabela dos dossiês da reunião existe');

/* ==========================================================================
   2. A INSTRUÇÃO NAS CONFIGURAÇÕES
   ========================================================================== */

console.log('\n=== 2. A instrução nas Configurações ===');

const SOCIO = { email: 'socio@formatar.com.br', grupoId: '64e678a7d2042dae072ef102' };
const JAIR = { email: 'Jair@formatar.com.br' };
const cab = { 'Content-Type': 'application/json' };
const ctx = (metodo, url, corpo, usuario = JAIR, env = {}) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : { method: metodo, headers: cab, body: JSON.stringify(corpo) }),
  env: { DB, DEEPSEEK_API_KEY: 'teste', ...env },
  data: { cabecalhos: cab, usuario }
});
const ler = async (r) => {
  const tipo = r.headers.get('Content-Type') || '';
  return { status: r.status, corpo: tipo.includes('html') ? await r.text() : await r.json() };
};

const INSTRUCAO = '# INSTRUÇÃO — MAPA ESTRATÉGICO\nClassifique cada informação como FATO, PERCEPÇÃO, SINAL, HIPÓTESE ou LACUNA.';
const enviar = (finalidade, conteudo, u = SOCIO) => roteirosApi.onRequestPost(ctx('POST', '/api/roteiros', {
  tipo_reuniao_erp_id: 'tipo-prospect', tipo_reuniao_nome: 'Prospect de Clientes', finalidade, nome_arquivo: 'instrucao.md', conteudo
}, u)).then(ler);

ok((await enviar('dossie_reuniao', INSTRUCAO, JAIR)).status === 403, 'só admin envia');
ok((await enviar('qualquer', INSTRUCAO)).corpo.code === 'FINALIDADE_INVALIDA', 'finalidade que não existe é recusada');
const i1 = await enviar('dossie_reuniao', INSTRUCAO);
ok(i1.status === 201 && i1.corpo.versao === 1, 'a instrução nasce versão 1, mesmo o tipo já tendo roteiro v1');
const i2 = await enviar('dossie_reuniao', `${INSTRUCAO}\n- v2`);
ok(i2.corpo.versao === 2, 'enviar de novo cria a versão 2 da instrução');
const r2 = await enviar('roteiro', '# Roteiro v2');
ok(r2.corpo.versao === 2, 'e o roteiro segue a numeração dele');

const lista = (await roteirosApi.onRequestGet(ctx('GET', '/api/roteiros')).then(ler)).corpo.roteiros;
ok(lista.length === 2 && lista.some((x) => x.finalidade === 'roteiro' && x.versao === 2)
  && lista.some((x) => x.finalidade === 'dossie_reuniao' && x.versao === 2), 'a lista traz o em vigor de cada finalidade');
const daInstrucao = (await roteirosApi.onRequestGet(ctx('GET', '/api/roteiros?tipo=tipo-prospect&finalidade=dossie_reuniao')).then(ler)).corpo.roteiro;
ok(daInstrucao.versao === 2 && /- v2/.test(daInstrucao.conteudo), 'pede a instrução pela finalidade');
const doRoteiro = (await roteirosApi.onRequestGet(ctx('GET', '/api/roteiros?tipo=tipo-prospect')).then(ler)).corpo.roteiro;
ok(doRoteiro.conteudo === '# Roteiro v2', 'sem finalidade, vem o roteiro (como antes)');
const hist = (await roteirosApi.onRequestGet(ctx('GET', '/api/roteiros?tipo=tipo-prospect&finalidade=dossie_reuniao&historico=1')).then(ler)).corpo.versoes;
ok(hist.map((v) => v.versao).join() === '2,1', 'o histórico é só da instrução');

/* ==========================================================================
   3. LIMPEZA E CONFERÊNCIA, SEM BANCO
   ========================================================================== */

console.log('\n=== 3. Limpeza e conferência ===');

const sujo = '```html\n<h2 style="color:red">Dores</h2><script>alert(1)</script><p onclick="x()">Texto <a href="http://mal">link</a> <span>e</span> 3 < 5</p><table border=1><tr><td>a</td></tr></table>\n```';
const limpo = limparConteudo(sujo);
ok(limpo === '<h2>Dores</h2><p>Texto link e 3 &lt; 5</p><table><tr><td>a</td></tr></table>', 'tira cerca, script, atributos e tags fora da lista', limpo);

const trechos = [
  { gravacao_id: 1, origem: 'formatar', inicio_s: 0, texto: 'Como vocês controlam o custo hoje?' },
  { gravacao_id: 1, origem: 'lead', inicio_s: 65, texto: 'A gente separa o custo do cimento por obra, mas não por unidade.' },
  { gravacao_id: 1, origem: 'lead', inicio_s: 130, texto: 'Meu sócio tem receio de consultoria, já tivemos uma experiência ruim.' }
];
const conf = conferirCitacoes('<p>Dor: <q>separa o custo do cimento por obra</q>.</p><p><q>Queremos dobrar o faturamento</q></p><p><q>Meu sócio tem receio de <strong>consultoria</strong></q></p>', trechos);
ok(conf.citacoes === 3 && conf.naoEncontradas === 1, '3 citações, 1 não encontrada', JSON.stringify({ c: conf.citacoes, n: conf.naoEncontradas }));
ok(/<q class="confere">separa o custo do cimento por obra<\/q> <span class="cit-minuto">01:05<\/span>/.test(conf.html), 'a que confere ganha o minuto');
ok(/<q class="nao-confere">Queremos dobrar o faturamento<\/q> <span class="cit-selo">não encontrada na transcrição<\/span>/.test(conf.html),
  'a que não confere fica, com a marca "não encontrada na transcrição"');
ok(/<q class="confere">Meu sócio tem receio de <strong>consultoria<\/strong><\/q>/.test(conf.html), 'negrito dentro da citação não atrapalha');

const doc = montarDocumento({
  conteudo: conf.html,
  reuniao: { lead_nome: 'Cedro Materiais', tipo_reuniao_nome: 'Prospect de Clientes', data: '01/10/2026', horario: '09:37 às 10:01 (24 min)', condutor: 'Jair Tavares' },
  meta: { versao: 3, geradoEm: '2026-10-01T15:00:00.000Z', geradoPor: 'jair@formatar.com.br', instrucaoVersao: 2, provider: 'deepseek', citacoes: 3, naoEncontradas: 1, separacao: true }
});
ok(/<title>Dossie_Reuniao_Cedro-Materiais_2026_10<\/title>/.test(doc), 'o nome do arquivo segue o padrão dos documentos', doc.match(/<title>[^<]*/)?.[0]);
// 2.38.1: o ícone do CRM vai dentro do arquivo — baixado, ele não alcança o site.
const icone = doc.match(/<link rel="icon" type="image\/png" href="data:image\/png;base64,([^"]+)">/);
ok(!!icone && Buffer.from(icone[1], 'base64').slice(1, 4).toString() === 'PNG', 'o ícone do CRM vai embutido no documento');
ok(/Dossiê da Reunião/.test(doc) && /Cedro Materiais/.test(doc) && /versão 2/.test(doc) && /Versão: <strong>3/.test(doc), 'capa com o lead, a versão e a instrução');
ok(/Citações: 3, das quais 1 não encontrada/.test(doc) && /Salvar como PDF/.test(doc), 'o "como ler" com a contagem, e o botão de PDF');

const prompt = montarPrompt({ instrucao: INSTRUCAO, reuniao: { lead_nome: 'Cedro', condutor: 'Jair Tavares' }, separacao: false, trechos });
ok(/MAPA ESTRATÉGICO/.test(prompt) && /Condutor \(CX responsável\): Jair Tavares/.test(prompt) && /NÃO separa as vozes/.test(prompt)
  && /\[L2 01:05\] LEAD: A gente separa/.test(prompt), 'o prompt leva a instrução, os dados, o aviso das vozes e a conversa, com as linhas numeradas');

// 2.38.3: a citação ancorada na linha — o texto no documento é sempre o da transcrição.
const real = [
  { gravacao_id: 3, origem: 'formatar', inicio_s: 20.7, texto: 'Tudo bem, vamos começar.' },
  { gravacao_id: 3, origem: 'formatar', inicio_s: 35.7, texto: 'O PGR é o Programa de Gerenção de Riscos.' },
  { gravacao_id: 3, origem: 'lead', inicio_s: 50, texto: 'A gente tem a documentação do colaborador,' },
  { gravacao_id: 3, origem: 'lead', inicio_s: 58, texto: 'mas não tem registro de endereço de ninguém.' },
  { gravacao_id: 3, origem: 'formatar', inicio_s: 70, texto: 'Entendi, e quem cuida disso hoje?' }
];
const anc = conferirCitacoes([
  '<p><q>[2] O PGR é o Programa de Gernção de Riscos.</q></p>',          // o caso real de 01/10: uma letra trocada
  '<p><q>[1] O PGR é o Programa de Gerenção de Riscos</q></p>',          // errou a linha por uma
  '<p><q>[L3] documentação do colaborador, mas não tem registro de endereço</q></p>',  // frase cortada entre duas linhas
  '<p><q>[5] queremos dobrar o faturamento no ano que vem</q></p>',      // a linha apontada não diz isso
  '<p><q>[99] qualquer coisa dita na reunião aqui</q></p>',             // linha que não existe
  '<p><q>Entendi, e quem cuida disso hoje?</q></p>'                      // sem número: a conferência antiga
].join(''), real);
const qs = [...anc.html.matchAll(/<q class="([^"]+)">([\s\S]*?)<\/q>(?: <span class="([^"]+)">([^<]*)<\/span>)?/g)]
  .map((m) => ({ classe: m[1], texto: m[2], extra: m[4] }));
ok(qs[0].classe === 'confere' && qs[0].texto === 'O PGR é o Programa de Gerenção de Riscos.' && qs[0].extra === '00:35',
  'a letra trocada pela IA some: fica a fala real da linha, com o minuto', JSON.stringify(qs[0]));
ok(qs[1].classe === 'confere' && /Gerenção/.test(qs[1].texto), 'a linha errada por uma é achada na vizinha');
ok(qs[2].classe === 'confere' && /documentação do colaborador, mas não tem registro de endereço/.test(qs[2].texto) && qs[2].extra === '00:50',
  'a frase cortada entre duas linhas da mesma voz vem inteira', JSON.stringify(qs[2]));
ok(qs[3].classe === 'nao-confere' && qs[4].classe === 'nao-confere', 'linha que não diz aquilo, ou que não existe: "não encontrada"');
ok(qs[5].classe === 'confere', 'citação sem número continua conferida palavra por palavra');
ok(anc.citacoes === 6 && anc.naoEncontradas === 2, '6 citações, 2 não encontradas', `${anc.citacoes}/${anc.naoEncontradas}`);
ok(!/Gernção/.test(anc.html), 'o texto errado da IA não chega ao documento');
const comTag = conferirCitacoes('<q>[2] O PGR é o <b>Programa</b> &lt;script&gt;</q>', real).html;
ok(!/<script>|<b>/.test(comTag), 'o texto posto pelo CRM vai escapado, sem tag');

/* ==========================================================================
   4. A API
   ========================================================================== */

console.log('\n=== 4. A API ===');

bd.exec(`INSERT INTO agenda_lead (id, lead_id, tipo, inicio, duracao_min, local_tipo, tipo_reuniao_erp_id, tipo_reuniao_nome,
                                  participantes, status, responsavel, criado_por, criado_em)
         VALUES (10, 1, 'reuniao', '2026-10-01T09:00', 60, 'presencial', 'tipo-prospect', 'Prospect de Clientes',
                 'Cássia (sócia)', 'agendada', 'jair@formatar.com.br', 'x', 'x');
         INSERT INTO agenda_lead (id, lead_id, tipo, inicio, duracao_min, local_tipo, tipo_reuniao_erp_id, tipo_reuniao_nome, status, criado_por, criado_em)
         VALUES (20, 1, 'reuniao', '2026-10-02T09:00', 60, 'online', 'tipo-sem-instrucao', 'Diagnóstico', 'agendada', 'x', 'x');
         INSERT INTO gravacoes (id, reuniao_id, lead_id, modo, consentimento_por, consentimento_em, transcritor, status, iniciada_por, iniciada_em)
         VALUES (1, 10, 1, 'online', 'x', 'x', 'workers-ai', 'encerrada', 'jair@formatar.com.br', 'x');`);
const inserir = bd.prepare(`INSERT INTO transcricao_trechos (gravacao_id, origem, seq, inicio_s, texto, criado_em) VALUES (1, ?, ?, ?, ?, 'x')`);
trechos.forEach((t, i) => inserir.run(t.origem, i, t.inicio_s, t.texto));
for (let i = 0; i < 6; i++) inserir.run('formatar', 10 + i, 200 + i * 10, 'Uma fala longa da conversa para passar do mínimo de texto exigido pela análise.');

const ESTADO = (id) => dossieApi.onRequestGet(ctx('GET', `/api/dossie-reuniao?reuniao_id=${id}`)).then(ler);
const GERAR = (id) => dossieApi.onRequestPost(ctx('POST', '/api/dossie-reuniao', { reuniao_id: id })).then(ler);

let e = (await ESTADO(10)).corpo;
ok(!e.pode_gerar && /finalize/i.test(e.motivo) && e.instrucao?.versao === 2, 'antes de finalizar não gera, e já mostra a instrução v2');
ok((await GERAR(10)).corpo.code === 'NAO_REALIZADA', 'e a POST também recusa');

bd.exec("UPDATE agenda_lead SET status = 'realizada', iniciada_em = '2026-10-01T12:37:00.000Z', finalizada_em = '2026-10-01T13:01:00.000Z', iniciada_por = 'jair@formatar.com.br' WHERE id IN (10, 20)");
ok((await GERAR(20)).corpo.code === 'SEM_INSTRUCAO', 'tipo sem instrução: avisa onde enviar');
ok(/Configurações/.test((await ESTADO(20)).corpo.motivo || ''), 'e o estado diz o mesmo');

let corpoIA = '';
let respostaIA = '';
globalThis.fetch = async (url, opcoes) => {
  if (!String(url).includes('deepseek')) throw new Error(`fetch inesperado: ${url}`);
  corpoIA = JSON.parse(opcoes.body);
  return new Response(JSON.stringify({ choices: [{ message: { content: respostaIA } }] }), { status: 200 });
};

respostaIA = 'Não consigo.';
const curto = await GERAR(10);
ok(curto.status === 502 && curto.corpo.code === 'CONTEUDO_INSUFICIENTE', 'resposta curta demais não vira dossiê');
ok(bd.prepare("SELECT COUNT(*) n FROM dossies_reuniao WHERE status = 'erro'").get().n === 1, 'e a falha fica registrada');

respostaIA = `<h2>1. Regra central</h2><p>${'Análise da reunião. '.repeat(30)}</p>
<h2>4. Dores do cliente</h2><ul><li>Custo por unidade: <q>separa o custo do cimento por obra, mas não por unidade</q> (FATO)</li>
<li>Desconfiança: <q>meu sócio odeia consultores</q> (PERCEPÇÃO)</li></ul>`;
const g1 = await GERAR(10);
ok(g1.status === 201 && g1.corpo.citacoes === 2 && g1.corpo.citacoes_nao_encontradas === 1, 'gera, com 2 citações e 1 não encontrada', JSON.stringify(g1.corpo));
ok(corpoIA.max_tokens === 8000 && !corpoIA.response_format, 'pede até 8000 tokens, sem modo JSON (a saída é HTML)');
const userPrompt = corpoIA.messages[1].content;
ok(/- v2/.test(userPrompt) && /Cássia \(sócia\)/.test(userPrompt) && /Jair Tavares/.test(userPrompt) && /Local: Presencial/.test(userPrompt),
  'o prompt leva a instrução v2, os participantes, o condutor pelo nome e o local');

e = (await ESTADO(10)).corpo;
ok(e.versoes.length === 1 && e.versoes[0].instrucao_versao === 2 && e.versoes[0].citacoes_nao_encontradas === 1 && e.pode_gerar,
  'o estado lista a versão, com a instrução e as contagens');
const html = (await dossieApi.onRequestGet(ctx('GET', '/api/dossie-reuniao?reuniao_id=10&html=1')).then(ler)).corpo;
ok(/<!DOCTYPE html>/.test(html) && /não encontrada na transcrição/.test(html) && /Dossie_Reuniao_Cedro-Materiais/.test(html),
  'o documento sai pronto, com a marca nas citações');

const g2 = await GERAR(10);
ok(g2.corpo.versao === g1.corpo.versao + 1, 'gerar de novo cria a versão seguinte', `${g1.corpo.versao} → ${g2.corpo.versao}`);
const v1 = (await dossieApi.onRequestGet(ctx('GET', `/api/dossie-reuniao?reuniao_id=10&html=1&versao=${g1.corpo.versao}`)).then(ler));
ok(v1.status === 200 && /Versão: <strong>2/.test(v1.corpo), 'e a anterior continua consultável');

/* ==========================================================================
   5. O ROTEIRO NUNCA É A INSTRUÇÃO
   ========================================================================== */

console.log('\n=== 5. O roteiro nunca é a instrução ===');

bd.exec("DELETE FROM roteiros WHERE finalidade = 'roteiro'");
globalThis.fetch = async (url, opcoes) => {
  corpoIA = JSON.parse(opcoes.body);
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"recortes":[],"roteiro":[],"sugestoes":[]}' } }] }), { status: 200 });
};
const an = (await recortesApi.onRequestPost(ctx('POST', '/api/recortes', { reuniao_id: 10 })).then(ler)).corpo.analise;
ok(an && an.roteiro === null && !/MAPA ESTRATÉGICO/.test(corpoIA.messages[1].content),
  'sem roteiro, os recortes não usam a instrução do dossiê como roteiro');

/* ==========================================================================
   5b. VAI JUNTO QUANDO O LEAD VIRA CLIENTE (2.38.2)
   ========================================================================== */

console.log('\n=== 5b. A pré-venda do cliente ===');

bd.exec(`CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT, lead_id INTEGER, ativo INTEGER DEFAULT 1);
         INSERT INTO clientes (id, nome, lead_id) VALUES (7, 'Cedro Materiais LTDA', 1), (8, 'Veio do ERP', NULL), (9, 'Excluído', 1);
         UPDATE clientes SET ativo = 0 WHERE id = 9;`);
const PRE = (id) => dossieApi.onRequestGet(ctx('GET', `/api/dossie-reuniao?cliente_id=${id}`)).then(ler);

const pv = (await PRE(7)).corpo;
ok(pv.lead?.id === 1 && pv.lead.nome === 'Cedro Materiais', 'o cliente convertido acha o lead de origem');
ok(pv.reunioes.length === 1 && pv.reunioes[0].reuniao_id === 10 && pv.reunioes[0].tipo_reuniao_nome === 'Prospect de Clientes',
  'e a reunião dele com dossiê');
ok(pv.reunioes[0].versoes.map((v) => v.versao).join() === `${g2.corpo.versao},${g1.corpo.versao}`
  && pv.reunioes[0].versoes[0].citacoes === 2, 'com todas as versões concluídas, a mais nova primeiro (a de erro não entra)');
ok(new RegExp(`^Dossie_Reuniao_Cedro-Materiais_\\d{4}_\\d{2}_v${g2.corpo.versao}\\.html$`).test(pv.reunioes[0].versoes[0].arquivo),
  'cada versão traz o nome exato do arquivo, com a versão (2.39.1)', pv.reunioes[0].versoes[0].arquivo);
ok((await PRE(8)).corpo.lead === null, 'cliente que não veio de lead: sem pré-venda');
ok((await PRE(9)).corpo.lead === null, 'cliente excluído: nada');
const doc7 = (await dossieApi.onRequestGet(ctx('GET', `/api/dossie-reuniao?reuniao_id=10&html=1&versao=${g1.corpo.versao}`)).then(ler));
ok(doc7.status === 200 && /Dossiê da Reunião/.test(doc7.corpo), 'e o documento abre pela reunião, como na agenda');

/* ==========================================================================
   6. RESETAR APAGA
   ========================================================================== */

console.log('\n=== 6. Resetar ===');

const reset = await agenda.onRequestPut(ctx('PUT', '/api/agenda?id=10', { acao: 'resetar' })).then(ler);
ok(reset.status === 200 && bd.prepare('SELECT COUNT(*) n FROM dossies_reuniao WHERE reuniao_id = 10').get().n === 0,
  'resetar a reunião apaga os dossiês dela');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
