/**
 * Prova do plano de ação em 5W2H — ponta a ponta.
 *
 * Sobe o dublê do hub de verdade, com duas reuniões da MESMA carteira, e
 * chama os handlers reais. O caso que mais importa é o da ação encerrada:
 * a AÇÃO 1 está na ata de agosto e sumiu da de setembro, e o plano tem de
 * refletir a ata mais recente.
 */
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { onRequestGet as planoGet, onRequestPut as planoPut } from '../../functions/api/plano-acao.js';
import { nomeDeDocumento, TIPO_DOCUMENTO } from '../../functions/api/_lib/documento-base.js';

import { fileURLToPath } from 'node:url';
const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
const BASE = 'http://127.0.0.1:8787/v1';
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

function d1(db) {
  return {
    async batch(cs) { for (const c of cs) await c.run(); },
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return stmt.get(...args) ?? null; },
        async all() { return { results: stmt.all(...args) }; },
        async run() { return stmt.run(...args); }
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
const usuario = { email: 'jair@formatar.com.br' };

const env = () => ({ DB, HUB_API_KEY: 'chave-de-teste', HUB_BASE_URL: BASE });

const ctx = (url, ambiente, corpo, metodo = 'PUT') => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo
    ? { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
    : {}),
  env: ambiente,
  data: { cabecalhos: { 'Content-Type': 'application/json' }, usuario }
});

const ler = async (r) => ({ status: r.status, corpo: await r.json() });

/* A migração 010 de verdade. */
bd.exec(readFileSync(`${RAIZ}/db/migracao-010-acoes-5w2h.sql`, 'utf8'));

const duble = await subirDuble();

try {
  console.log('\n=== 1. A migração 010 ===');
  const tabelas = bd.prepare(
    "SELECT name FROM sqlite_master WHERE name LIKE '%acoes%' ORDER BY name"
  ).all().map((r) => r.name);
  ok(tabelas.includes('acoes_cx'), 'a tabela existe', tabelas.join(', '));
  ok(tabelas.includes('idx_acoes_cx_carteira'), 'e o índice também');

  bd.exec(readFileSync(`${RAIZ}/db/migracao-010-acoes-5w2h.sql`, 'utf8'));
  ok(true, 'reaplicar a 010 não quebra — só CREATE ... IF NOT EXISTS');

  console.log('\n=== 2. O plano montado a partir das atas ===');
  const p = await ler(await planoGet(ctx('/api/plano-acao', env())));
  ok(p.status === 200, 'responde 200', `status=${p.status}`);

  const porNumero = Object.fromEntries((p.corpo.acoes || []).map((a) => [a.numero, a]));

  // O CASO QUE MAIS IMPORTA: a AÇÃO 1 está na ata de agosto e sumiu da de
  // setembro. Ação encerrada sai do plano — então ela NÃO pode aparecer.
  ok(!porNumero[1],
    'a AÇÃO 1, encerrada na ata mais recente, NÃO aparece no plano');
  ok(!!porNumero[2] && !!porNumero[3],
    'as AÇÕES 2 e 3, que seguem na última ata, aparecem',
    Object.keys(porNumero).join(','));
  ok(p.corpo.acoes.length === 2, 'duas ações no plano', `n=${p.corpo.acoes.length}`);

  const a2 = porNumero[2];
  ok(a2.oQue === 'Revisar politica de estoque minimo', 'What vem da ata', a2.oQue);
  ok(a2.quem === 'Marina Alves', 'Who vem de Resp.:');
  ok(a2.quando === '2026-08-15', 'When vem de Prazo:');
  ok(a2.status === 'pendente' && a2.statusDesde === '2026-06-08', 'status e "desde"');
  ok(a2.atrasada === true, 'e o atraso é calculado');

  // A carteira é cliente + tipo de reunião, e é ela que dá a chave da
  // anotação — não o cliente, que pode ter três carteiras.
  ok(a2.carteiraErpId === '607f1f77bcf86cd799439101',
    'a carteira é resolvida por cliente + tipo de reunião', a2.carteiraErpId);
  ok(a2.cliente === 'Comercial Vale Verde LTDA',
    'o nome do cliente vem do ERP, não da ata', a2.cliente);
  // O nucleo agora vem do ERP, nao do cabecalho da ata. Na ata esta
  // escrito "LOGISTICA", sem acento; no cadastro do ERP e "Logistica"
  // com acento. Vence o cadastro.
  ok(a2.nucleo === 'Logística',
    'o núcleo vem do ERP, não do cabeçalho da ata', a2.nucleo);
  ok(a2.nucleoErpId === '707f1f77bcf86cd799439201',
    'e o ObjectId do tipo de reunião acompanha');
  ok(a2.timeErpId === '807f1f77bcf86cd799439501',
    'o ObjectId do Time acompanha', a2.timeErpId);

  // Os TRES niveis chegam a tela, e nao se confundem: Time e o
  // agrupamento interno da Formatar; nucleo e o tipo de reuniao no
  // cliente; carteira e cliente + nucleo.
  ok(a2.time === 'Operações',
    'e o NOME do Time vem resolvido do ERP', a2.time);
  ok(a2.time !== a2.nucleo,
    'Time e núcleo são níveis distintos', `${a2.time} / ${a2.nucleo}`);
  ok(p.corpo.resumo.times === 1, 'o resumo conta os times', String(p.corpo.resumo.times));

  // "Desde quando se arrasta": a AÇÃO 2 já estava na ata de agosto.
  ok(String(a2.desdeAAta).startsWith('2026-08-20'),
    'a primeira aparição nas atas da carteira é registrada', a2.desdeAAta);

  console.log('\n=== 2b. A numeracao por cliente ===');

  // O identificador e N.M: N e a sequencia do CLIENTE, M e o numero da
  // acao no tipo de reuniao. As duas acoes vem da mesma carteira, entao
  // recebem numeros de cliente diferentes e M diferentes.
  ok(a2.numeroCliente != null, 'a acao recebeu numero do cliente', String(a2.numeroCliente));
  const a3 = porNumero[3];
  ok(a3.numeroCliente != null && a3.numeroCliente !== a2.numeroCliente,
    'duas acoes do mesmo cliente NAO compartilham numero',
    `${a2.numeroCliente} e ${a3.numeroCliente}`);

  const gravadas = bd.prepare('SELECT cliente_erp_id, carteira_erp_id, acao_numero, numero_cliente FROM acoes_cx ORDER BY numero_cliente').all();
  ok(gravadas.length === 2, 'a numeracao foi GRAVADA, nao calculada na hora', `n=${gravadas.length}`);
  ok(gravadas[0].numero_cliente === 1 && gravadas[1].numero_cliente === 2,
    'e comeca em 1',
    gravadas.map((g) => g.numero_cliente).join(','));
  ok(gravadas.every((g) => g.cliente_erp_id === '507f1f77bcf86cd799439012'),
    'presa ao cliente, nao a carteira');

  // Reler nao pode renumerar: e o defeito que a gravacao existe para evitar.
  const relido = await ler(await planoGet(ctx('/api/plano-acao', env())));
  const r2 = relido.corpo.acoes.find((x) => x.numero === 2);
  ok(r2.numeroCliente === a2.numeroCliente,
    'reler NAO renumera',
    `${a2.numeroCliente} -> ${r2.numeroCliente}`);
  ok(bd.prepare('SELECT COUNT(*) AS n FROM acoes_cx').get().n === 2,
    'e nao cria linha nova a cada leitura');

  // O numero NUNCA e reaproveitado: mesmo apagando a acao do plano, o
  // proximo a chegar pega o seguinte, nao o vago.
  const proximo = bd.prepare(
    "SELECT COALESCE(MAX(numero_cliente),0)+1 AS n FROM acoes_cx WHERE cliente_erp_id = '507f1f77bcf86cd799439012'"
  ).get();
  ok(proximo.n === 3, 'o proximo numero do cliente e 3', String(proximo.n));

  console.log('\n=== 3. O que NUNCA pode sair daqui ===');
  const bruto = JSON.stringify(p.corpo);
  ok(!/DESCONFORTO/.test(bruto),
    'a nota privada em CAIXA ALTA não aparece em lugar nenhum da resposta');
  ok(!/NOTA TECNICA/.test(bruto),
    'nem o technicalNotes — que sequer é pedido ao hub');
  ok(!/Revisao do plano anterior/.test(bruto),
    'o contexto da ata também não vaza: a rota devolve o plano, não a ata');

  console.log('\n=== 4. Reunião cancelada e sem ata ===');
  ok(!p.corpo.acoes.some((a) => a.reuniaoNid === 86),
    'reunião cancelada não produz ação');

  console.log('\n=== 5. O 5W2H que a CX preenche ===');
  ok(a2.porque === null && a2.onde === null && a2.como === null && a2.quanto === null,
    'os quatro campos nascem vazios — a ata não os tem');
  ok(a2.completude === 0, 'e a completude é zero');
  ok(p.corpo.resumo.semAnotacao === 2, 'o resumo conta quantas faltam anotar');

  const gravou = await ler(await planoPut(ctx(
    '/api/plano-acao?carteira=607f1f77bcf86cd799439101&acao=2', env(),
    {
      porque: 'Ruptura recorrente no CD',
      onde: 'CD Divinópolis',
      como: 'Revisar curva ABC e recalcular o ponto de pedido',
      quanto: 'R$ 0 — usa time interno',
      descricao_vista: 'Revisar politica de estoque minimo'
    })));

  ok(gravou.status === 200 && gravou.corpo.ok, 'grava a anotação', `status=${gravou.status}`);

  const p2 = await ler(await planoGet(ctx('/api/plano-acao', env())));
  const a2b = p2.corpo.acoes.find((a) => a.numero === 2);
  ok(a2b.porque === 'Ruptura recorrente no CD', 'Why volta na leitura');
  ok(a2b.como === 'Revisar curva ABC e recalcular o ponto de pedido', 'How volta');
  ok(a2b.completude === 4, 'completude passa a 4', `${a2b.completude}`);
  ok(a2b.anotadoPor === 'jair@formatar.com.br', 'e quem anotou fica registrado');
  ok(a2b.descricaoMudou === false, 'a descrição não mudou desde a anotação');
  ok(p2.corpo.resumo.semAnotacao === 1, 'o resumo cai para uma sem anotação');

  // Gravar de novo ATUALIZA, não duplica: o UNIQUE mais o ON CONFLICT.
  const regravou = await ler(await planoPut(ctx(
    '/api/plano-acao?carteira=607f1f77bcf86cd799439101&acao=2', env(),
    { porque: 'Corrigido: ruptura no CD e no estoque avançado' })));
  ok(regravou.status === 200, 'regravar responde 200');

  const linhas = bd.prepare(
    "SELECT COUNT(*) AS n FROM acoes_cx WHERE carteira_erp_id = '607f1f77bcf86cd799439101' AND acao_numero = 2"
  ).get();
  ok(linhas.n === 1, 'e não duplica a linha', `n=${linhas.n}`);

  const p3 = await ler(await planoGet(ctx('/api/plano-acao', env())));
  const a2c = p3.corpo.acoes.find((a) => a.numero === 2);
  ok(a2c.porque === 'Corrigido: ruptura no CD e no estoque avançado', 'o texto novo vale');
  ok(a2c.como === null,
    'e os campos não enviados foram limpos — a gravação substitui a anotação inteira');

  console.log('\n=== 6. A ata mudou de texto depois da anotação ===');
  bd.exec(`UPDATE acoes_cx SET descricao_vista = 'Texto antigo e diferente'
           WHERE carteira_erp_id = '607f1f77bcf86cd799439101' AND acao_numero = 2`);
  const p4 = await ler(await planoGet(ctx('/api/plano-acao', env())));
  ok(p4.corpo.acoes.find((a) => a.numero === 2).descricaoMudou === true,
    'a tela é avisada de que a ação mudou desde a anotação');

  console.log('\n=== 7. Chave e parâmetros ===');
  const semChave = await ler(await planoGet(ctx('/api/plano-acao', { DB })));
  ok(semChave.status === 503 && semChave.corpo.code === 'HUB_SEM_CHAVE',
    'sem chave, diz que falta a chave');

  const semCarteira = await ler(await planoPut(ctx('/api/plano-acao?acao=2', env(), { porque: 'x' })));
  ok(semCarteira.status === 400 && semCarteira.corpo.code === 'CHAVE_OBRIGATORIA',
    'PUT sem carteira é recusado');

  const acaoInvalida = await ler(await planoPut(
    ctx('/api/plano-acao?carteira=abc&acao=0', env(), { porque: 'x' })));
  ok(acaoInvalida.status === 400, 'número de ação zero é recusado');

  // Anotar uma ação que o CRM nunca viu gravaria um 5W2H órfão, sem
  // número e sem cliente.
  const naoNumerada = await ler(await planoPut(
    ctx('/api/plano-acao?carteira=607f1f77bcf86cd799439999&acao=1', env(), { porque: 'x' })));
  ok(naoNumerada.status === 404 && naoNumerada.corpo.code === 'ACAO_NAO_NUMERADA',
    'anotar ação nunca vista é recusado, dizendo o que fazer',
    naoNumerada.corpo.error);

  console.log('\n=== 8. Resumo e ordenação ===');
  ok(p.corpo.resumo.carteiras === 1, 'uma carteira com ata', `n=${p.corpo.resumo.carteiras}`);
  ok(p.corpo.resumo.atrasadas === 1, 'uma ação atrasada');
  ok(p.corpo.acoes[0].atrasada === true,
    'a atrasada vem primeiro — a fila começa pelo que dói');
  ok(Array.isArray(p.corpo.avisos), 'os avisos do parser chegam à tela');
  ok(p.corpo.avisos.some((a) => /participante do cliente/i.test(a.aviso)),
    'inclusive o de participante do cliente ausente',
    p.corpo.avisos.map((a) => a.aviso).join(' | '));

  console.log('\n=== 9. Permissoes faltantes, TODAS de uma vez ===');

  // Com Promise.all a primeira falha derrubava o resto e o usuario
  // descobria uma permissao por vez. Aqui as cinco fontes sao tentadas.
  duble.kill();
  await new Promise((r) => setTimeout(r, 400));
  const semPerm = await subirDuble(['--sem-permissao']);

  const bloqueado = await ler(await planoGet(ctx('/api/plano-acao', env())));
  // 503 desde a v2.23.0: com 403, o front entendia "acesso revogado" e
  // expulsava o usuario do CRM ao abrir esta tela.
  ok(bloqueado.status === 503 && bloqueado.corpo.code === 'HUB_SEM_PERMISSAO',
    'responde 503 com codigo legivel, e nao 403', `status=${bloqueado.status}`);
  ok(Array.isArray(bloqueado.corpo.permissoesFaltando),
    'e lista as permissoes que faltam');
  ok(bloqueado.corpo.permissoesFaltando.length >= 3,
    'TODAS de uma vez, nao so a primeira',
    bloqueado.corpo.permissoesFaltando.join(', '));
  for (const p of ['hub:portfolios:read', 'hub:meetings:read', 'hub:meeting-types:read', 'hub:teams:read']) {
    ok(bloqueado.corpo.permissoesFaltando.includes(p), `inclui ${p}`);
  }
  ok(Array.isArray(bloqueado.corpo.fontes) && bloqueado.corpo.fontes.length >= 3,
    'e diz quais fontes falharam', (bloqueado.corpo.fontes || []).join(', '));
  semPerm.kill();

  console.log('\n=== 10. Nome dos documentos ===');

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
