/**
 * Prova da gravação e transcrição da reunião (2.35.0).
 *
 * O que importa:
 *   - cada pedaço é um WAV 16 kHz mono completo (o transcritor aceita);
 *   - sem consentimento não se grava; contato não se grava;
 *   - sem transcritor, recusa ANTES de começar, dizendo o que ligar;
 *   - só o texto é guardado; frase fantasma do Whisper não vira fala;
 *   - o reenvio de um pedaço substitui, não duplica;
 *   - encerrar a gravação NÃO finaliza a reunião — desde a 2.36.0 isso é
 *     o "Finalizar" da agenda (prova reuniao.mjs);
 *   - só se grava a reunião iniciada (2.36.0);
 *   - a gravação fica presa à versão do roteiro em vigor ao começar.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import * as rota from '../../functions/api/gravacoes.js';
import { limparTexto, transcritorDisponivel, dicaDaReuniao } from '../../functions/api/_lib/transcricao.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
const require = createRequire(import.meta.url);
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

/* ==========================================================================
   1. O WAV
   ========================================================================== */

console.log('\n=== 1. O pedaço de áudio ===');

const AudioWav = require(`${RAIZ}/public/js/audio-wav.js`);

const taxa = 48000;
const umSegundo = new Float32Array(taxa).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / taxa));
const reamostrado = AudioWav.reamostrar(umSegundo, taxa);
ok(reamostrado.length === 16000, '48 kHz vira 16 kHz (1 s = 16.000 amostras)', String(reamostrado.length));

const wav = AudioWav.paraWav(reamostrado);
const v = new DataView(wav.buffer);
const texto = (p, n) => String.fromCharCode(...wav.slice(p, p + n));
ok(texto(0, 4) === 'RIFF' && texto(8, 4) === 'WAVE' && texto(36, 4) === 'data', 'cabeçalho RIFF/WAVE/data');
ok(v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === 16000 && v.getUint16(34, true) === 16,
  'PCM, mono, 16 kHz, 16 bits');
ok(v.getUint32(40, true) === 32000 && wav.length === 44 + 32000, 'tamanho dos dados certo (1 s = 32.000 bytes)');
ok(v.getInt16(44 + 2 * 4, true) !== 0, 'as amostras chegam ao arquivo');

const juntos = AudioWav.juntar([new Float32Array([1, 2]), new Float32Array([3])]);
ok(juntos.length === 3 && juntos[2] === 3, 'junta os blocos na ordem');

ok(AudioWav.rms(new Float32Array(1000)) === 0 && AudioWav.rms(reamostrado) > 0.3, 'silêncio tem volume zero; a fala, não');

const b64 = AudioWav.base64(wav);
ok(Buffer.from(b64, 'base64').equals(Buffer.from(wav)), 'base64 volta idêntico (em fatias, sem estourar a pilha)');
const grande = AudioWav.base64(AudioWav.paraWav(new Float32Array(16000 * 20)));
ok(grande.length > 800000, '20 s de áudio viram ~850 KB de base64, sem erro', String(grande.length));

/* ==========================================================================
   2. O ESQUEMA
   ========================================================================== */

function d1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a.map((x) => (x === undefined ? null : x)); return api; },
        async first() { return stmt.get(...args) ?? null; },
        async all() { return { results: stmt.all(...args) }; },
        async run() { return stmt.run(...args); }
      };
      return api;
    },
    async batch(lista) { const r = []; for (const s of lista) r.push(await s.run()); return r; }
  };
}

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
bd.exec(`
  CREATE TABLE leads (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER DEFAULT 1, responsavel TEXT,
                      data_proximo_contato TEXT, data_ultimo_contato TEXT);
  INSERT INTO leads (id, nome, data_ultimo_contato) VALUES (1, 'Acme Prospect', '2026-01-01');
`);
bd.exec(readFileSync(`${RAIZ}/db/migracao-017-agenda-lead.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-019-ia-e-roteiros.sql`, 'utf8'));
const M020 = readFileSync(`${RAIZ}/db/migracao-020-gravacao.sql`, 'utf8');
bd.exec(M020);
bd.exec(M020);
ok(true, 'a 020 roda duas vezes sem erro');
bd.exec(readFileSync(`${RAIZ}/db/migracao-021-reuniao-iniciar-finalizar.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-022-cancelamento-motivo.sql`, 'utf8'));

bd.exec(`
  INSERT INTO agenda_lead (id, lead_id, tipo, inicio, local_tipo, tipo_reuniao_erp_id, status, criado_por, criado_em)
    VALUES (10, 1, 'reuniao', '2026-10-02T14:00', 'online', 't-diag', 'agendada', 'x', 'x'),
           (11, 1, 'contato', '2026-10-03T09:00', NULL, NULL, 'agendada', 'x', 'x');
  UPDATE leads SET data_proximo_contato = '2026-10-02' WHERE id = 1;
  INSERT INTO roteiros (tipo_reuniao_erp_id, versao, conteudo, tamanho, enviado_por, enviado_em)
    VALUES ('t-diag', 1, '# v1', 4, 'x', 'x'), ('t-diag', 2, '# v2', 4, 'x', 'x');
`);

/* ==========================================================================
   3. A API
   ========================================================================== */

console.log('\n=== 2. Começar ===');

const chamadasIA = [];
let respostaIA = { text: '  Bom dia, quero entender o processo.  ' };
const AI = { run: async (modelo, entrada) => { chamadasIA.push({ modelo, entrada }); return respostaIA; } };

const cab = { 'Content-Type': 'application/json' };
const USUARIO = { email: 'jair@formatar.com.br' };
const ctx = (metodo, url, corpo, env = { AI }) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : {
    method: metodo, headers: cab, body: JSON.stringify(corpo)
  }),
  env: { DB, ...env },
  data: { cabecalhos: cab, usuario: USUARIO }
});
const ler = async (r) => ({ status: r.status, corpo: await r.json() });
const POST = (url, corpo, env) => rota.onRequestPost(ctx('POST', url, corpo, env)).then(ler);

ok((await POST('/api/gravacoes', { reuniao_id: 10, modo: 'online' })).corpo.code === 'SEM_CONSENTIMENTO',
  'sem consentimento não se grava');
ok((await POST('/api/gravacoes', { reuniao_id: 11, consentimento: true, modo: 'presencial' })).corpo.code === 'NAO_E_REUNIAO',
  'contato não se grava');
ok((await POST('/api/gravacoes', { reuniao_id: 10, consentimento: true, modo: 'celular' })).corpo.code === 'MODO_INVALIDO',
  'modo desconhecido é recusado');

ok((await POST('/api/gravacoes', { reuniao_id: 10, consentimento: true, modo: 'online' })).corpo.code === 'NAO_INICIADA',
  'reunião que não foi iniciada não se grava (2.36.0)');
bd.prepare("UPDATE agenda_lead SET iniciada_em = ?, iniciada_por = 'jair@formatar.com.br' WHERE id = 10").run(new Date().toISOString());

const semNada = await POST('/api/gravacoes', { reuniao_id: 10, consentimento: true, modo: 'online' }, {});
ok(semNada.status === 503 && semNada.corpo.code === 'SEM_TRANSCRITOR' && /Workers AI/.test(semNada.corpo.error),
  'sem transcritor recusa ANTES de gravar, dizendo o que ligar');

const inicio = await POST('/api/gravacoes', { reuniao_id: 10, consentimento: true, modo: 'online' });
const G = inicio.corpo.gravacao;
ok(inicio.status === 201 && G.consentimento_por === USUARIO.email && G.consentimento_em && G.transcritor === 'workers-ai',
  'começa, com o consentimento registrado (quem e quando)', JSON.stringify({ por: G?.consentimento_por, t: G?.transcritor }));
ok(G.roteiro_versao === 2, 'a gravação fica presa ao roteiro em vigor (versão 2)');

console.log('\n=== 3. Os pedaços ===');

const AUDIO = AudioWav.base64(AudioWav.paraWav(reamostrado));
const trecho = (corpo) => POST(`/api/gravacoes?id=${G.id}&trecho=1`, { audio: AUDIO, ...corpo });

const t1 = await trecho({ origem: 'lead', seq: 0, inicio_s: 0, fim_s: 20 });
ok(t1.status === 200 && t1.corpo.texto === 'Bom dia, quero entender o processo.', 'o pedaço volta como texto, limpo');
ok(chamadasIA[0].modelo.includes('whisper') && chamadasIA[0].entrada.language === 'pt'
  && chamadasIA[0].entrada.audio === AUDIO && chamadasIA[0].entrada.initial_prompt === 'Reunião comercial da Formatar com Acme Prospect, em português do Brasil.',
  'vai ao Whisper em português, com o nome do lead de dica');

respostaIA = { text: 'Obrigado por assistir.' };
const fantasma = await trecho({ origem: 'lead', seq: 1, inicio_s: 20 });
ok(fantasma.corpo.texto === '' , 'frase fantasma do Whisper não vira fala');

respostaIA = { text: 'Nós fazemos o diagnóstico em duas semanas.' };
await trecho({ origem: 'formatar', seq: 0, inicio_s: 5 });
respostaIA = { text: 'Nós fazemos o diagnóstico em DUAS semanas.' };
await trecho({ origem: 'formatar', seq: 0, inicio_s: 5 });
const guardados = bd.prepare('SELECT * FROM transcricao_trechos WHERE gravacao_id = ? ORDER BY inicio_s').all(G.id);
ok(guardados.length === 2 && guardados[1].texto.includes('DUAS'), 'reenviar o mesmo pedaço substitui, não duplica');

ok(!JSON.stringify(bd.prepare('SELECT * FROM gravacoes').all()).includes(AUDIO.slice(0, 50))
  && !JSON.stringify(guardados).includes(AUDIO.slice(0, 50)), 'o áudio não fica em lugar nenhum do banco');

ok((await trecho({ origem: 'plateia', seq: 0, inicio_s: 0 })).status === 400, 'origem desconhecida é recusada');
ok((await POST(`/api/gravacoes?id=${G.id}&trecho=1`, { origem: 'lead', seq: 9, inicio_s: 0, audio: 'x'.repeat(3_000_001) })).status === 400,
  'pedaço grande demais é recusado');

const lista = await ler(await rota.onRequestGet(ctx('GET', '/api/gravacoes?reuniao_id=10')));
ok(lista.corpo.trechos.map((t) => t.origem).join(',') === 'lead,formatar', 'a conversa sai ordenada pelo segundo em que cada fala começou');

console.log('\n=== 4. Encerrar ===');

const fim = await ler(await rota.onRequestPut(ctx('PUT', `/api/gravacoes?id=${G.id}`, { encerrar: true, duracao_s: 1234 })));
ok(fim.corpo.gravacao.status === 'encerrada' && fim.corpo.gravacao.duracao_s === 1234,
  'encerra com a duração');
const reuniao = bd.prepare('SELECT status, finalizada_em FROM agenda_lead WHERE id = 10').get();
const lead = bd.prepare('SELECT * FROM leads WHERE id = 1').get();
ok(reuniao.status === 'agendada' && !reuniao.finalizada_em && lead.data_ultimo_contato === '2026-01-01',
  'e a reunião segue em andamento: quem a finaliza é o "Finalizar" (2.36.0)', JSON.stringify(reuniao));

respostaIA = { text: 'Chegou atrasado.' };
ok((await trecho({ origem: 'lead', seq: 5, inicio_s: 100 })).status === 200, 'pedaço que chega logo depois de encerrar ainda conta');
bd.prepare("UPDATE gravacoes SET encerrada_em = '2026-01-01T00:00:00Z' WHERE id = ?").run(G.id);
ok((await trecho({ origem: 'lead', seq: 6, inicio_s: 120 })).status === 409, 'muito depois, a gravação encerrada não aceita mais');

console.log('\n=== 5. OpenAI, quando não há Workers AI ===');

const pedidos = [];
globalThis.fetch = async (url, op) => {
  pedidos.push({ url: String(url), op });
  return new Response(JSON.stringify({ text: 'Transcrito pela OpenAI.' }), { status: 200 });
};
ok(transcritorDisponivel({ OPENAI_API_KEY: 'sk-x' }) === 'openai' && transcritorDisponivel({ AI, OPENAI_API_KEY: 'sk-x' }) === 'workers-ai',
  'Workers AI primeiro; OpenAI se não houver');
const G2 = (await POST('/api/gravacoes', { reuniao_id: 10, consentimento: true, modo: 'presencial' }, { OPENAI_API_KEY: 'sk-teste-000000000000000' })).corpo.gravacao;
const pelaOpenai = await POST(`/api/gravacoes?id=${G2.id}&trecho=1`, { origem: 'sala', seq: 0, inicio_s: 0, audio: AUDIO }, { OPENAI_API_KEY: 'sk-teste-000000000000000' });
const form = pedidos[0]?.op?.body;
ok(pelaOpenai.corpo.texto === 'Transcrito pela OpenAI.' && pedidos[0].url.includes('/audio/transcriptions')
  && form.get('model') === 'whisper-1' && form.get('language') === 'pt' && form.get('file').size === wav.length,
  'manda o WAV inteiro para o whisper-1 em português');

ok(limparTexto('  tchau.  ') === '' && limparTexto('Tchau, então nos falamos amanhã.') !== '',
  'o filtro pega a frase fantasma sozinha, não a fala que contém a palavra');

console.log('\n=== 6. Qualidade (2.36.1) ===');

// Os casos reais do teste de 30/09/2026 e de 29/09/2026.
ok(limparTexto('Nú, Kjálsha, ég er enn hóð. Þá var hlutum deytreið.') === ''
  && limparTexto('Ouvirar að rússum að rússum að gera') === '',
  'texto em islandês (letras que o português não usa) é descartado');
ok(limparTexto('Привет, как дела') === '' && limparTexto('ありがとう') === '', 'cirílico e japonês também');
ok(limparTexto('O CNPJ começa com 12 e o quilômetro é R$ 1,60.') !== '', 'português com acento, número e símbolo passa');
const dica = dicaDaReuniao('Jair da Silva');
ok(dica === 'Reunião comercial da Formatar com Jair da Silva, em português do Brasil.', 'a dica é uma frase em português');
ok(limparTexto('Jair da Silva Jair da Silva', dica) === '' && limparTexto('Reunião comercial da Formatar.', dica) === '',
  'texto feito só das palavras da dica é eco, não fala');
ok(limparTexto('O Jair da Silva pediu a proposta.', dica) !== '', 'mas a fala que cita o nome passa');
ok(limparTexto('Obrigado. Obrigado. Obrigado. Obrigado.') === '', 'a mesma palavra repetida é descartada');
ok(limparTexto('Não, só isso. Não, só isso.') !== '', 'mas uma frase repetida de verdade, com várias palavras, passa');

// A frase em curso (provisório): transcreve e devolve, sem salvar.
respostaIA = { text: 'O custo do cimento por unidade' };
const antesProv = bd.prepare('SELECT COUNT(*) n FROM transcricao_trechos').get().n;
const G3 = (await POST('/api/gravacoes', { reuniao_id: 10, consentimento: true, modo: 'presencial' })).corpo.gravacao;
const prov = await POST(`/api/gravacoes?id=${G3.id}&trecho=1`, { provisorio: true, origem: 'sala', seq: 0, inicio_s: 0, audio: AUDIO });
ok(prov.status === 200 && prov.corpo.provisorio === true && prov.corpo.texto === 'O custo do cimento por unidade'
  && bd.prepare('SELECT COUNT(*) n FROM transcricao_trechos').get().n === antesProv,
  'a frase em curso volta como texto provisório e NÃO é salva');

console.log('\n=== 7. Onde cortar o pedaço (2.36.1) ===');
ok(!AudioWav.deveFechar({ segundos: 4, pausa: 2 }), 'antes de 6 s não corta, nem na pausa');
ok(AudioWav.deveFechar({ segundos: 7, pausa: 0.7 }), 'depois de 6 s, corta na pausa de 0,6 s');
ok(!AudioWav.deveFechar({ segundos: 12, pausa: 0.3 }), 'pausa curta (entre palavras) não corta');
ok(AudioWav.deveFechar({ segundos: 15, pausa: 0 }), 'aos 15 s corta mesmo sem pausa (teto)');

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
