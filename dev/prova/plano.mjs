/**
 * Prova do plano de ação — ponta a ponta, com o plano GRAVADO (2.25.0).
 *
 * Sobe o dublê do hub de verdade e chama os handlers reais contra SQLite
 * em memória com as migrações 010 e 012 de verdade. O que importa provar:
 *
 *   - a primeira carga lê seis meses em passos, e a seguinte só o novo;
 *   - a ação que sai da ata não some: fica gravada como "saiu da ata";
 *   - todo campo se edita, e toda alteração vai para o log com
 *     quem, quando, de e para;
 *   - a edição da CX sobrevive à carga seguinte, a menos que a ata mude
 *     aquele mesmo campo.
 */
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  onRequestGet as planoGet, onRequestPost as planoPost, onRequestPatch as planoPatch
} from '../../functions/api/plano-acao.js';
import { mesclar, SAIU_DA_ATA, dataPrevistaDoPrazo } from '../../functions/api/_lib/plano.js';
import { esquecerMemoria } from '../../functions/api/_lib/hub.js';
import { nomeDeDocumento, TIPO_DOCUMENTO } from '../../functions/api/_lib/documento-base.js';

import { fileURLToPath } from 'node:url';
const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
const BASE = 'http://127.0.0.1:8787/v1';
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

/* O D1 de mentira: o lote é transacional, como no D1 de verdade. */
function d1(db) {
  return {
    async batch(cs) {
      db.exec('BEGIN');
      try { for (const c of cs) await c.run(); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return stmt.get(...args) ?? null; },
        async all() { return { results: stmt.all(...args) }; },
        async run() { const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } }; }
      };
      return api;
    }
  };
}

async function subirDuble(args = []) {
  const p = spawn(process.execPath, [`${RAIZ}/dev/hub-stub.mjs`, ...args], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${BASE}/customers`); return p; }
    catch (e) { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('o dublê não subiu');
}

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
const jair = { email: 'jair@formatar.com.br', nome: 'Jair Tavares' };
const olivia = { email: 'olivia@formatar.com.br', nome: 'Olivia' };

const env = () => ({ DB, HUB_API_KEY: 'chave-de-teste', HUB_BASE_URL: BASE });

const ctx = (url, { metodo = 'GET', corpo = null, usuario = jair, ambiente = env() } = {}) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo
    ? { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
    : { method: metodo }),
  env: ambiente,
  data: { cabecalhos: { 'Content-Type': 'application/json' }, usuario }
});

const ler = async (r) => ({ status: r.status, corpo: await r.json() });
const plano = async () => (await ler(await planoGet(ctx('/api/plano-acao')))).corpo;
const carga = async (o) => ler(await planoPost(ctx('/api/plano-acao?carga=1', { metodo: 'POST', ...o })));
const editar = async (id, corpo, usuario = jair) =>
  ler(await planoPatch(ctx(`/api/plano-acao?id=${id}`, { metodo: 'PATCH', corpo, usuario })));
const historico = async (id) => (await ler(await planoGet(ctx(`/api/plano-acao?log=${id}`)))).corpo.log;

/** Carrega até o fim, como a tela faz. Devolve os passos. */
async function cargaCompleta() {
  const passos = [];
  for (let i = 0; i < 20; i++) {
    const r = await carga();
    passos.push(r);
    if (r.status !== 200 || r.corpo.carga.completa) break;
  }
  return passos;
}

/* Uma banco SEM a 012, para provar o aviso de migração faltando. */
const bdVelho = new DatabaseSync(':memory:');
bdVelho.exec(readFileSync(`${RAIZ}/db/migracao-010-acoes-5w2h.sql`, 'utf8'));

bd.exec(readFileSync(`${RAIZ}/db/migracao-010-acoes-5w2h.sql`, 'utf8'));

// Uma linha que a 010 já tinha criado em produção: só a numeração e um
// Por quê preenchido. A primeira carga tem de completá-la, não duplicá-la.
bd.exec(`INSERT INTO acoes_cx (cliente_erp_id, carteira_erp_id, acao_numero, numero_cliente, porque, criado_por, criado_em)
         VALUES ('507f1f77bcf86cd799439012', '607f1f77bcf86cd799439101', 2, 1, 'Ruptura no CD', 'x@formatar.com.br', '2026-09-10T00:00:00Z')`);

bd.exec(readFileSync(`${RAIZ}/db/migracao-012-plano-gravado.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-014-tipo-de-acao.sql`, 'utf8'));
bd.exec(readFileSync(`${RAIZ}/db/migracao-015-status-do-cliente.sql`, 'utf8'));

let duble = await subirDuble();

try {
  console.log('\n=== 1. As migrações ===');
  const nomes = bd.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['acoes_cx', 'acoes_cx_log', 'plano_carga', 'plano_carteiras']) {
    ok(nomes.includes(t), `a tabela ${t} existe`);
  }
  const colunas = bd.prepare("SELECT name FROM pragma_table_info('acoes_cx')").all().map((r) => r.name);
  ok(['status', 'status_ata', 'data_prevista', 'versao', 'saiu_da_ata_em'].every((c) => colunas.includes(c)),
    'a acoes_cx ganhou as colunas da ata e as sombras');

  const semMig = await ler(await planoGet(ctx('/api/plano-acao', { ambiente: { DB: d1(bdVelho) } })));
  ok(semMig.status === 503 && semMig.corpo.code === 'SEM_MIGRACAO_012',
    'sem a 012, a tela diz qual migração falta', semMig.corpo.error);

  console.log('\n=== 2. Antes da primeira carga ===');
  const vazio = await plano();
  ok(Array.isArray(vazio.acoes) && vazio.acoes.length === 0,
    'o GET lê o banco — e a linha só com numeração (010) não aparece incompleta');
  ok(vazio.carga.carregadoAte === null && vazio.carga.completa === false, 'e diz que nunca houve carga');

  console.log('\n=== 3. A primeira carga, em passos ===');
  const passos = await cargaCompleta();
  ok(passos.every((p) => p.status === 200), 'todos os passos respondem 200',
    passos.map((p) => p.status).join(','));
  ok(passos.length >= 5 && passos.length <= 8,
    'seis meses viram passos de um mês, não uma leitura só', `${passos.length} passos`);
  ok(passos.at(-1).corpo.carga.completa === true, 'e a carga termina completa');
  ok(passos.every((p, i) => i === 0 || p.corpo.passo.desde === passos[i - 1].corpo.passo.ate),
    'cada passo começa onde o anterior parou — sem folga durante a primeira carga');
  ok(passos.reduce((s, p) => s + p.corpo.passo.reunioes, 0) === 2,
    'as duas reuniões realizadas foram lidas uma vez cada — a cancelada e a agendada não');
  ok(bd.prepare('SELECT travado_em FROM plano_carga').get().travado_em === null,
    'a trava é solta ao fim de cada passo');

  const p = await plano();
  const porNumero = Object.fromEntries(p.acoes.map((a) => [a.numero, a]));
  ok(p.acoes.length === 3, 'três ações gravadas: a 1 encerrada, a 2 e a 3 abertas', `n=${p.acoes.length}`);

  console.log('\n=== 4. A ação que saiu da ata fica, e diz que saiu ===');
  const a1 = porNumero[1];
  ok(a1.status === SAIU_DA_ATA && a1.aberta === false, 'a AÇÃO 1 é "saiu da ata", fechada', a1.status);
  ok(String(a1.saiuDaAtaEm).startsWith('2026-09-03'), 'na data da ata que não a trouxe', a1.saiuDaAtaEm);
  ok(a1.atrasada === false, 'ação fechada não conta como atrasada');
  ok(p.acoes.at(-1).numero === 1, 'e vai para o fim da fila');

  console.log('\n=== 5. O que a ata diz, gravado ===');
  const a2 = porNumero[2];
  ok(a2.descricao === 'Revisar politica de estoque minimo', 'descrição', a2.descricao);
  ok(a2.responsavel === 'Marina Alves', 'responsável');
  ok(a2.prazo === '15/08/26', 'Quando, como escrito na ata', a2.prazo);
  ok(a2.dataPrevista === '2026-08-15', 'data prevista, como data', a2.dataPrevista);
  ok(a2.status === 'pendente' && a2.statusDesde === '2026-06-08', 'status e "desde"');
  ok(a2.atrasada === true && a2.diasDeAtraso > 0, 'o atraso é calculado na leitura', String(a2.diasDeAtraso));
  ok(a2.cliente === 'Comercial Vale Verde LTDA', 'o nome do cliente vem do ERP');
  ok(a2.tipoReuniao === 'Logística', 'tipo de reunião vem do ERP, com acento', a2.tipoReuniao);
  ok(a2.nucleo === 'Operações', 'núcleo é o Time', a2.nucleo);
  ok(String(a2.primeiraAtaEm).startsWith('2026-08-20'), 'a primeira aparição fica registrada', a2.primeiraAtaEm);
  ok(a2.porque === 'Ruptura no CD', 'o Por quê que a 010 já guardava sobreviveu');

  console.log('\n=== 6. A numeração por cliente ===');
  ok(a2.numeroCliente === 1, 'a linha da 010 manteve o seu número', String(a2.numeroCliente));
  const nums = p.acoes.map((a) => a.numeroCliente).sort();
  ok(new Set(nums).size === 3 && nums.join(',') === '1,2,3', 'três números distintos, começando em 1', nums.join(','));
  ok(bd.prepare('SELECT COUNT(*) AS n FROM acoes_cx').get().n === 3, 'e nenhuma linha duplicada');

  console.log('\n=== 7. O que NUNCA pode sair daqui ===');
  const bruto = JSON.stringify(p) + JSON.stringify(bd.prepare('SELECT * FROM acoes_cx').all());
  ok(!/DESCONFORTO/.test(bruto), 'a nota privada em CAIXA ALTA não está na resposta nem no banco');
  ok(!/NOTA TECNICA/.test(bruto), 'nem o technicalNotes');
  ok(!/Revisao do plano anterior/.test(bruto), 'nem o contexto da ata');

  console.log('\n=== 8. O log da carga ===');
  const log1 = await historico(a1.id);
  ok(log1.some((l) => l.campo === 'criada' && l.origem === 'ata'), 'a criação da AÇÃO 1 foi registrada');
  const saida = log1.find((l) => l.campo === 'status');
  ok(saida && saida.de === 'nova' && saida.para === SAIU_DA_ATA && saida.reuniao_nid === 88,
    'e a saída da ata: de "nova" para "saiu da ata", pela reunião 88', JSON.stringify(saida));

  console.log('\n=== 9. Editar um campo — e o registro ===');
  const concluir = await editar(a2.id, { campo: 'status', de: 'pendente', para: 'concluida' }, olivia);
  ok(concluir.status === 200 && concluir.corpo.acao.status === 'concluida',
    'Pendente → Concluída', `status=${concluir.status}`);
  ok(concluir.corpo.acao.aberta === false && concluir.corpo.acao.atrasada === false,
    'e deixa de contar como aberta e atrasada');

  const log2 = await historico(a2.id);
  const mudanca = log2[0];
  ok(mudanca.campo === 'status' && mudanca.de === 'pendente' && mudanca.para === 'concluida',
    'o log diz o campo, de e para', `${mudanca.de} → ${mudanca.para}`);
  ok(mudanca.por === 'olivia@formatar.com.br' && mudanca.por_nome === 'Olivia', 'quem mudou');
  ok(mudanca.origem === 'crm' && !!mudanca.em, 'quando, e que foi à mão');

  const porque = await editar(porNumero[3].id, { campo: 'porque', de: null, para: '  Falta gente à noite  ' });
  ok(porque.status === 200 && porque.corpo.acao.porque === 'Falta gente à noite', 'o Por quê se edita, aparado');

  const resp = await editar(porNumero[3].id, { campo: 'responsavel', de: 'Roberto Nunes', para: 'Beto (CX)' });
  ok(resp.status === 200, 'o responsável também');

  const data = await editar(porNumero[3].id, { campo: 'data_prevista', de: '2026-10-10', para: '2026-11-30' });
  ok(data.status === 200 && data.corpo.acao.dataPrevista === '2026-11-30', 'e a data prevista');

  const mesmo = await editar(porNumero[3].id, { campo: 'data_prevista', de: '2026-11-30', para: '2026-11-30' });
  ok(mesmo.corpo.semMudanca === true, 'gravar o mesmo valor não gera registro');
  ok((await historico(porNumero[3].id)).filter((l) => l.origem === 'crm').length === 3,
    'três edições, três registros');

  console.log('\n=== 10. Conflito e validação ===');
  const conflito = await editar(a2.id, { campo: 'status', de: 'pendente', para: 'em_andamento' });
  ok(conflito.status === 409 && conflito.corpo.code === 'CONFLITO',
    'quem editava um valor velho é avisado, em vez de apagar a mudança do outro');
  ok(conflito.corpo.acao.status === 'concluida', 'e recebe o valor atual');

  ok((await editar(a2.id, { campo: 'cliente_nome', de: null, para: 'X' })).status === 400,
    'cliente, tipo de reunião e núcleo não se editam — são a chave da carteira');
  ok((await editar(a2.id, { campo: 'status', de: 'concluida', para: SAIU_DA_ATA })).status === 400,
    '"saiu da ata" só a carga põe');
  ok((await editar(a2.id, { campo: 'data_prevista', de: null, para: '2026-02-31' })).status === 400,
    '31 de fevereiro é recusado');
  ok((await editar(999, { campo: 'porque', de: null, para: 'x' })).status === 404, 'ação inexistente: 404');

  console.log('\n=== 11. A carga seguinte traz só o novo ===');
  const nada = await carga();
  const cursor = bd.prepare('SELECT carregado_ate FROM plano_carga').get().carregado_ate;
  ok(nada.status === 200 && nada.corpo.passo.novas === 0 && nada.corpo.passo.alteradas === 0,
    'sem reunião nova, nada muda', JSON.stringify(nada.corpo.passo));
  const folga = (new Date(passos.at(-1).corpo.passo.ate) - new Date(nada.corpo.passo.desde)) / 86400000;
  ok(Math.round(folga) === 14, 'a janela recua 14 dias do cursor, para a ata escrita depois', `${folga.toFixed(1)} dias`);
  ok((await plano()).acoes.find((a) => a.numero === 2).status === 'concluida',
    'a edição da CX sobreviveu à carga');

  // Uma reunião nova, de três dias atrás. A ata:
  //  - traz a AÇÃO 2 igual à anterior (a ata não mudou nada nela);
  //  - muda o responsável da AÇÃO 3;
  //  - acrescenta a AÇÃO 4.
  const tresDias = new Date(Date.now() - 3 * 86400000).toISOString();
  await fetch('http://127.0.0.1:8787/__reuniao', {
    method: 'POST',
    body: JSON.stringify({
      id: '907f1f77bcf86cd799439499', nid: 90, title: 'Reuniao mensal Vale Verde',
      status: 'finished', customer: '507f1f77bcf86cd799439012',
      meetingType: '707f1f77bcf86cd799439201', startDate: tresDias,
      participants: [], customerParticipants: [{ name: 'Roberto Nunes' }],
      notes: `Atas Comercial Vale Verde - LOGISTICA
18/09/26 - 09:00 - 10:00
Formatar: Jair Tavares
Cliente: Roberto Nunes

1. Seguimento.

Plano de acao:

ACAO 2: Revisar politica de estoque minimo
Resp.: Marina Alves
Prazo: 15/08/26
Status: Pendente desde 08/06/26

ACAO 3: Contratar operador para o turno da noite
Resp.: Carla Souza
Prazo: 10/10/26
Status: Repactuado em 20/08/26

ACAO 4: Treinar a equipe no novo WMS
Resp.: Tiago Nunes
Prazo: 30/10/26
Status: Nova`
    })
  });

  const nova = await carga();
  ok(nova.corpo.passo.reunioes === 1, 'a carga leu só a reunião nova', String(nova.corpo.passo.reunioes));
  ok(nova.corpo.passo.novas === 1, 'e criou uma ação — a 4');

  const p2 = await plano();
  const n2 = Object.fromEntries(p2.acoes.map((a) => [a.numero, a]));
  ok(n2[4] && n2[4].numeroCliente === 4, 'a AÇÃO 4 ganhou o número seguinte do cliente', String(n2[4]?.numeroCliente));
  ok(n2[2].status === 'concluida',
    'a AÇÃO 2 continua Concluída: a ata repetiu o mesmo status, não o mudou');
  ok(n2[3].responsavel === 'Carla Souza',
    'a AÇÃO 3 mudou de responsável NA ATA — a ata vence a edição anterior da CX');
  ok(n2[3].porque === 'Falta gente à noite' && n2[3].dataPrevista === '2026-11-30',
    'e o que a ata não mudou continua como a CX deixou');

  const log3 = await historico(n2[3].id);
  const pelaAta = log3.find((l) => l.campo === 'responsavel' && l.origem === 'ata');
  ok(pelaAta && pelaAta.de === 'Beto (CX)' && pelaAta.para === 'Carla Souza' && pelaAta.reuniao_nid === 90,
    'o log registra a troca pela ata, de "Beto (CX)" para "Carla Souza", reunião 90', JSON.stringify(pelaAta));
  ok(!log3.some((l) => l.campo === 'data_prevista' && l.origem === 'ata'),
    'e não registra mudança onde a ata não mudou nada');

  console.log('\n=== 12. Ata velha não passa por cima da nova ===');
  // Volta o cursor dois meses: as reuniões 87 e 88 são relidas.
  bd.exec("UPDATE plano_carga SET carregado_ate = '2026-08-01T00:00:00.000Z', completa = 0");
  const antesLog = bd.prepare('SELECT COUNT(*) AS n FROM acoes_cx_log').get().n;
  let releitura;
  for (let i = 0; i < 5; i++) { releitura = await carga(); if (releitura.corpo.carga.completa) break; }
  ok(bd.prepare('SELECT COUNT(*) AS n FROM acoes_cx_log').get().n === antesLog,
    'reler atas antigas não gera nenhuma alteração');
  ok((await plano()).acoes.find((a) => a.numero === 3).responsavel === 'Carla Souza',
    'e o responsável continua o da ata mais nova');

  console.log('\n=== 13. Uma carga por vez ===');
  bd.exec(`UPDATE plano_carga SET travado_em = '${new Date().toISOString()}', travado_por = 'outra@formatar.com.br'`);
  const travada = await carga();
  ok(travada.status === 409 && travada.corpo.code === 'CARGA_EM_ANDAMENTO',
    'a segunda carga simultânea é recusada', travada.corpo.error);
  const editaTravada = await editar(n2[4].id, { campo: 'porque', de: null, para: 'x' });
  ok(editaTravada.status === 423, 'e a edição espera a carga terminar');

  bd.exec(`UPDATE plano_carga SET travado_em = '${new Date(Date.now() - 10 * 60000).toISOString()}'`);
  ok((await carga()).status === 200, 'trava de mais de 3 minutos é de carga que morreu, e expira');

  console.log('\n=== 14. A regra de quem vence, isolada ===');
  const base = {
    descricao: 'A', responsavel: 'CX', prazo: null, data_prevista: null, status: 'concluida',
    descricao_ata: 'A', responsavel_ata: 'Ata', prazo_ata: null, data_prevista_ata: null, status_ata: 'pendente'
  };
  const m1 = mesclar(base, { descricao: 'A', responsavel: 'Ata', status: 'pendente' });
  ok(m1.linha.responsavel === 'CX' && m1.linha.status === 'concluida' && m1.mudancas.length === 0,
    'ata igual à sombra: a CX vence');
  const m2 = mesclar(base, { descricao: 'A', responsavel: 'Ata', status: SAIU_DA_ATA });
  ok(m2.linha.status === 'concluida', 'ação concluída pela CX que sai da ata continua concluída');
  const m3 = mesclar(base, { descricao: 'A', responsavel: 'Outro', status: 'pendente' });
  ok(m3.linha.responsavel === 'Outro' && m3.mudancas[0].de === 'CX', 'ata diferente da sombra: a ata vence');

  console.log('\n=== 14b. Datas lidas do texto da ata (2.29.0) ===');
  const R = '2026-09-18T12:00:00Z';
  const casos = [
    ['08/10/26.', '2026-10-08', 'ponto no fim não impede mais'],
    ['dez/26.', '2026-12-31', 'mês e ano: o último dia do mês'],
    ['5–9/10/26', '2026-10-09', 'intervalo: vale o fim'],
    ['PARA SEMANA 5 A 9/10', '2026-10-09', 'dia e mês sem ano: o ano da reunião'],
    ['Outubro de 2026', '2026-10-31', 'mês por extenso'],
    ['31/07/2026', '2026-07-31', 'ano com quatro dígitos'],
    ['a definir.', null, '"a definir" continua sem data'],
    ['próxima', null, '"próxima" continua sem data'],
    ['31/02/26', null, '31 de fevereiro não vira 3 de março']
  ];
  for (const [texto, esperado, titulo] of casos) {
    const obtido = dataPrevistaDoPrazo(texto, R);
    ok(obtido === esperado, `${titulo}: "${texto}"`, String(obtido));
  }

  // As ações gravadas antes da 2.29.0 não terão a ata relida: a carga as
  // corrige uma vez, pelo texto que já estava gravado. A AÇÃO 1 serve: a
  // reunião dela (03/09) está fora da folga de 14 dias e não é relida.
  const idA = porNumero[1].id;

  // Primeiro: a CX já tinha posto uma data. Ela fica; só a sombra aprende.
  bd.exec(`UPDATE acoes_cx SET prazo_ata = 'set/26.', data_prevista = '2026-11-30', data_prevista_ata = NULL WHERE id = ${idA}`);
  await carga();
  const comCx = bd.prepare(`SELECT data_prevista, data_prevista_ata FROM acoes_cx WHERE id = ${idA}`).get();
  ok(comCx.data_prevista === '2026-11-30' && comCx.data_prevista_ata === '2026-09-30',
    'onde a CX já pôs data, ela fica — a leitura nova só vai para a sombra', JSON.stringify(comCx));

  // Depois: sem data nenhuma, o texto "dez/26." vira 31/12/2026.
  bd.exec(`UPDATE acoes_cx SET prazo = 'dez/26.', prazo_ata = 'dez/26.', data_prevista = NULL, data_prevista_ata = NULL WHERE id = ${idA}`);
  await carga();
  const depoisA = bd.prepare(`SELECT data_prevista, data_prevista_ata FROM acoes_cx WHERE id = ${idA}`).get();
  ok(depoisA.data_prevista === '2026-12-31' && depoisA.data_prevista_ata === '2026-12-31',
    'a ação gravada com "dez/26." ganha 31/12/2026 na carga seguinte', JSON.stringify(depoisA));
  ok((await historico(idA)).some((l) => l.campo === 'data_prevista' && l.para === '2026-12-31' && l.origem === 'ata'),
    'e a correção fica no histórico, como feita pela ata');
  const logsAntes = bd.prepare('SELECT COUNT(*) AS n FROM acoes_cx_log').get().n;
  await carga();
  ok(bd.prepare('SELECT COUNT(*) AS n FROM acoes_cx_log').get().n === logsAntes,
    'a correção acontece uma vez só: a carga seguinte não repete');
  const idB = n2[3].id;

  console.log('\n=== 14c. Tipo de ação (2.29.0) ===');
  const tipo = await editar(idA, { campo: 'tipo_acao', de: null, para: 'estrategica' });
  ok(tipo.status === 200 && tipo.corpo.acao.tipoAcao === 'estrategica', 'a CX classifica a ação como Estratégica');
  ok((await historico(idA)).some((l) => l.campo === 'tipo_acao' && l.de === null && l.para === 'estrategica' && l.origem === 'crm'),
    'e a classificação vai para o histórico');
  ok((await editar(idA, { campo: 'tipo_acao', de: 'estrategica', para: 'urgente' })).status === 400,
    'fora de Operacional, Tática e Estratégica: 400');
  const limpa = await editar(idA, { campo: 'tipo_acao', de: 'estrategica', para: '' });
  ok(limpa.status === 200 && limpa.corpo.acao.tipoAcao === null, 'e pode voltar a "não classificada"');
  await carga();
  ok((await plano()).acoes.find((a) => a.id === idB).tipoAcao === null,
    'a carga nunca classifica: tipo de ação é só da CX');

  console.log('\n=== 14d. Cabeçalho do ERP, responsável da reunião, status do cliente (2.30.0) ===');
  const doisDias = new Date(Date.now() - 2 * 86400000).toISOString();
  await fetch('http://127.0.0.1:8787/__reuniao', {
    method: 'POST',
    body: JSON.stringify({
      id: '907f1f77bcf86cd799439498', nid: 91, title: 'Reuniao mensal Vale Verde',
      status: 'finished', customer: '507f1f77bcf86cd799439012',
      meetingType: '707f1f77bcf86cd799439201', startDate: doisDias,
      participants: [{ user: 'u2' }, { room: 'sala-1' }],
      customerParticipants: [{ name: 'Roberto Nunes' }],
      // Cabeçalho torto de propósito, nas quatro linhas que o manual
      // reserva: sem hífen, sem data, sem participantes do cliente.
      notes: `Ata Vale Verde
reuniao de setembro
Formatar: Jair Tavares
[A CONFIRMAR]

Plano de acao:

ACAO 2: Revisar politica de estoque minimo
Resp.: Marina Alves
Prazo: 15/08/26
Status: Pendente desde 08/06/26

ACAO 3: Contratar operador para o turno da noite
Resp.: Carla Souza
Prazo: 10/10/26
Status: Repactuado em 20/08/26

ACAO 4: Treinar a equipe no novo WMS
Resp.: Tiago Nunes
Prazo: 30/10/26
Status: Nova

ACAO 5: Mapear os fornecedores de embalagem
Prazo: 30/11/26
Status: Nova`
    })
  });
  const r91 = await carga();
  const avisos91 = (r91.corpo.avisos || []).filter((a) => a.reuniao === 91).map((a) => a.aviso);
  ok(!avisos91.some((a) => /data da reunião|núcleo depois do hífen|cliente na primeira linha|participante do cliente/i.test(a)),
    'cliente, núcleo, data e participantes vêm do ERP: o cabeçalho torto da ata não gera aviso', avisos91.join(' | ') || 'nenhum');

  const a5 = (await plano()).acoes.find((a) => a.numero === 5);
  ok(a5 && a5.responsavel === 'Paulo Reis',
    'ação sem "Resp.:" fica com quem conduziu a reunião (participants.user)', a5?.responsavel);
  ok((await historico(a5.id)).some((l) => l.campo === 'criada'), 'e nasce no histórico como qualquer outra');
  ok((await plano()).acoes.find((a) => a.numero === 3).responsavel === 'Carla Souza',
    'quem a ata nomeia continua valendo — o participante é só a reserva');

  ok(a5.clienteStatus === 'active', 'o status do cliente vem do ERP e fica gravado', a5.clienteStatus);
  bd.exec("UPDATE acoes_cx SET cliente_status = 'inactive' WHERE cliente_erp_id = '507f1f77bcf86cd799439012'");
  const reStatus = await carga();
  ok(reStatus.corpo.passo.clientesAtualizados > 0 && (await plano()).acoes.every((a) => a.clienteStatus === 'active'),
    'e é conferido a cada carga, em todas as ações — sem precisar de reunião nova',
    `atualizados=${reStatus.corpo.passo.clientesAtualizados}`);

  console.log('\n=== 15. Permissões faltantes, TODAS de uma vez ===');
  duble.kill();
  await new Promise((r) => setTimeout(r, 400));
  duble = await subirDuble(['--sem-permissao']);
  // As listas de referência ficaram na memória do passo anterior: sem
  // esquecer, só as reuniões seriam pedidas e a prova mediria a memória.
  esquecerMemoria();

  const bloqueado = await carga();
  ok(bloqueado.status === 503 && bloqueado.corpo.code === 'HUB_SEM_PERMISSAO',
    'responde 503 com código legível, e não 403', `status=${bloqueado.status}`);
  for (const perm of ['hub:portfolios:read', 'hub:meetings:read', 'hub:meeting-types:read', 'hub:teams:read']) {
    ok((bloqueado.corpo.permissoesFaltando || []).includes(perm), `inclui ${perm}`);
  }
  ok(bd.prepare('SELECT travado_em FROM plano_carga').get().travado_em === null,
    'a trava é solta mesmo quando o hub falha');
  ok((await plano()).acoes.length === 5, 'e o plano gravado continua legível com o hub fora');

  console.log('\n=== 16. O hub pede pausa (429) ===');
  duble.kill();
  await new Promise((r) => setTimeout(r, 400));
  duble = await subirDuble(['--limite']);
  esquecerMemoria();

  const comPausa = await carga();
  ok(comPausa.status === 200,
    'a carga espera o Retry-After e tenta de novo, em vez de parar no meio', `status=${comPausa.status}`);

  const t1 = Date.now();
  await carga();
  ok(Date.now() - t1 < 900,
    'o passo seguinte usa as listas de referência da memória: não repete as páginas', `${Date.now() - t1} ms`);

  console.log('\n=== 17. Nome dos documentos ===');

  // Desde a v2.23.0 a CAIXA ALTA do ERP vira capitalizada: `ALPHATEX`
  // grita num nome de arquivo. Siglas de ate 3 letras ficam intactas.
  const nomeP = nomeDeDocumento(TIPO_DOCUMENTO.PROSPECCAO, 'ALPHATEX COMERCIO LTDA', '2026-09-07T10:00:00Z');
  ok(nomeP === 'Dossie_Prospeccao_Alphatex-Comercio_2026_09',
    'o padrao decidido: tipo, cliente, ano, mes', nomeP);
  ok(!/[À-ÿ]/.test(nomeDeDocumento(TIPO_DOCUMENTO.EXPERIENCIA, 'Ação & Cia Ltda')),
    'sem acento nem cedilha',
    nomeDeDocumento(TIPO_DOCUMENTO.EXPERIENCIA, 'Ação & Cia Ltda'));
  ok(!/_v\d/.test(nomeP), 'sem sufixo de versao, como decidido');
  ok(nomeDeDocumento(TIPO_DOCUMENTO.PROPOSTA, null).startsWith('Proposta_Cliente_'),
    'sem nome de cliente, nao quebra',
    nomeDeDocumento(TIPO_DOCUMENTO.PROPOSTA, null));
  ok(nomeDeDocumento(TIPO_DOCUMENTO.PROSPECCAO, 'X', 'data-invalida').includes('_20'),
    'data invalida cai para hoje em vez de NaN');

} finally {
  duble.kill();
}

console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
