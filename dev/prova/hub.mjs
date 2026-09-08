/**
 * Prova do caminho 2 — os clientes do ERP na Jornada.
 *
 * Ponta a ponta: sobe o dublê do hub de VERDADE num processo à parte e
 * chama os handlers reais contra ele. Um dublê de dublê provaria que o
 * meu falso concorda com o meu falso.
 */
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { onRequestGet as hubGet, onRequestPost as hubPost } from '../../functions/api/hub-clientes.js';
import { onRequestGet as convGet, onRequestPost as convPost } from '../../functions/api/conversao.js';

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
    /* O D1 aplica o batch em transacao: ou tudo entra, ou nada. */
    async batch(comandos) {
      db.exec('BEGIN');
      try {
        for (const c of comandos) await c.run();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
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

/* ---- o dublê de verdade, num processo separado ---- */
async function subirDuble(args = []) {
  const p = spawn(process.execPath, [`${RAIZ}/dev/hub-stub.mjs`, ...args], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/customers`);
      return p;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('o dublê não subiu');
}

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
const usuario = { email: 'jair@formatar.com.br' };

const env = (extra = {}) => ({ DB, HUB_API_KEY: 'chave-de-teste', HUB_BASE_URL: BASE, ...extra });

const ctx = (url, ambiente, corpo) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
    : {}),
  env: ambiente,
  data: { cabecalhos: { 'Content-Type': 'application/json' }, usuario }
});

const ler = async (r) => ({ status: r.status, corpo: await r.json() });

bd.exec(`
  CREATE TABLE etapas (id INTEGER PRIMARY KEY, nome TEXT, cor TEXT, ordem INTEGER,
                       encerra INTEGER DEFAULT 0, pipeline TEXT, ativo INTEGER DEFAULT 1);
  CREATE TABLE leads (id INTEGER PRIMARY KEY, nome TEXT, documento TEXT, telefone TEXT,
                      email TEXT, contato_nome TEXT, cidade TEXT, classificacao INTEGER,
                      etapa_id INTEGER, ativo INTEGER DEFAULT 1);
  CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, nome_fantasia TEXT,
                         documento TEXT, telefone TEXT, email TEXT, contato_nome TEXT,
                         cidade TEXT, etapa_id INTEGER, posicao INTEGER, nucleos TEXT,
                         classificacao INTEGER, data_inicio TEXT, observacoes TEXT,
                         erp_id TEXT, lead_id INTEGER, criado_por TEXT, criado_em TEXT,
                         atualizado_por TEXT, atualizado_em TEXT, ativo INTEGER DEFAULT 1);
  CREATE UNIQUE INDEX idx_clientes_documento ON clientes (documento) WHERE ativo = 1;

  INSERT INTO etapas (id, nome, ordem, encerra, pipeline) VALUES
    (5, 'Finalizado', 5, 1, 'comercial'),
    (10, 'Implantacao', 1, 0, 'jornada'),
    (11, 'Em operacao', 2, 0, 'jornada');

  INSERT INTO clientes (nome, documento, etapa_id, nucleos, data_inicio, criado_por, criado_em)
    VALUES ('Acme Indústria S.A.', '12345678000190', 11, '[1]', '2024-05-02', 'jair@formatar.com.br', '2026-09-05T10:00:00Z');

  INSERT INTO clientes (nome, documento, etapa_id, nucleos, data_inicio, criado_por, criado_em)
    VALUES ('Só No CRM LTDA', '99888777000166', 10, '[]', '2026-09-05', 'jair@formatar.com.br', '2026-09-05T10:00:00Z');

  INSERT INTO leads (id, nome, documento, telefone, classificacao, etapa_id) VALUES
    (1, 'Vale Verde', '19131243000197', '34999990001', 5, 5),
    (2, 'Empresa Fora do ERP', '11444777000161', NULL, NULL, 5);
`);

let duble = await subirDuble();

try {
  /* ====================================================================== */
  console.log('\n=== 1. Diagnóstico da chave ===');

  const semChave = await ler(await hubGet(ctx('/api/hub-clientes?diagnostico=1', { DB })));
  ok(semChave.corpo.ok === false && semChave.corpo.code === 'HUB_SEM_CHAVE',
    'sem chave, diz que falta a chave — e não "sem clientes"');
  ok(/HUB_API_KEY/.test(semChave.corpo.comoResolver || ''),
    'e diz onde cadastrá-la');

  const comChave = await ler(await hubGet(ctx('/api/hub-clientes?diagnostico=1', env())));
  ok(comChave.corpo.ok === true, 'com chave válida, confirma a permissão');
  ok(comChave.corpo.totalAtivos === 3, 'e diz quantos ativos o ERP tem', `n=${comChave.corpo.totalAtivos}`);
  ok(comChave.corpo.chave === 'HUB_API_KEY', 'informa QUAL variável foi usada, nunca a chave');

  /* ====================================================================== */
  console.log('\n=== 2. O ERP cruzado com o CRM ===');

  const lista = await ler(await hubGet(ctx('/api/hub-clientes', env())));
  ok(lista.status === 200, 'lista responde 200');

  const porNome = Object.fromEntries((lista.corpo.clientes || []).map((c) => [c.nome, c]));

  ok(lista.corpo.clientes.length === 4,
    'três ativos do ERP mais o que só existe no CRM', `n=${lista.corpo.clientes.length}`);
  ok(!porNome['Saiu Fora ME'], 'cliente inactive no ERP não aparece');

  const acme = porNome['Acme Indústria S.A.'];
  ok(acme?.origem === 'hub' && acme?.semJornada === false && !!acme?.id,
    'quem está nos dois lados vem com a jornada do CRM', `etapa_id=${acme?.etapa_id}`);
  ok(acme?.erp_id === '507f1f77bcf86cd799439011', 'e com o id do ERP');
  ok(acme?.nucleos === '[1]', 'os núcleos anotados no CRM sobrevivem ao cruzamento');

  const valeVerde = porNome['Comercial Vale Verde LTDA'];
  ok(valeVerde?.semJornada === true && valeVerde?.id === null,
    'quem só está no ERP vem como "sem jornada"');
  ok(valeVerde?.classificacao === 5, 'a classificação 1–6 vem do ERP', `c=${valeVerde?.classificacao}`);

  ok(porNome['Só No CRM LTDA']?.origem === 'crm', 'quem só está no CRM não some da lista');

  ok(lista.corpo.semJornada === 2 && lista.corpo.soNoCrm === 1,
    'os contadores batem', `semJornada=${lista.corpo.semJornada} soNoCrm=${lista.corpo.soNoCrm}`);

  const busca = await ler(await hubGet(ctx('/api/hub-clientes?busca=vale', env())));
  ok(busca.corpo.clientes.some((c) => (c.nome || '').includes('Vale Verde')),
    'a busca chega ao ERP');

  /* ====================================================================== */
  console.log('\n=== 3. Trazer para a jornada ===');

  const trazido = await ler(await hubPost(
    ctx('/api/hub-clientes?documento=19131243000197', env(), { etapa_id: 11 })));

  ok(trazido.status === 201 && trazido.corpo.ok, 'cria a linha do CRM', `status=${trazido.status}`);
  ok(trazido.corpo.cliente.erp_id === '507f1f77bcf86cd799439012',
    'o vínculo com o ERP é gravado — e veio do hub, não do corpo da requisição');
  ok(trazido.corpo.cliente.nome === 'Comercial Vale Verde LTDA', 'a razão social vem do ERP');
  ok(trazido.corpo.cliente.data_inicio === '2023-11-20',
    'o início da relação vem do contractedAt, não da data de hoje',
    trazido.corpo.cliente.data_inicio);

  const depois = await ler(await hubGet(ctx('/api/hub-clientes', env())));
  const vvDepois = depois.corpo.clientes.find((c) => c.nome === 'Comercial Vale Verde LTDA');
  ok(vvDepois?.semJornada === false, 'ele deixa de estar "sem jornada"');
  ok(depois.corpo.semJornada === 1, 'e o contador cai', `n=${depois.corpo.semJornada}`);

  const foraDoErp = await ler(await hubPost(
    ctx('/api/hub-clientes?documento=11444777000161', env(), {})));
  ok(foraDoErp.status === 404 && foraDoErp.corpo.code === 'NAO_ESTA_NO_ERP',
    'CNPJ que não existe no ERP não vira jornada');

  const vinculado = await ler(await hubPost(
    ctx('/api/hub-clientes?documento=12345678000190', env(), {})));
  ok(vinculado.status === 200 && vinculado.corpo.vinculado === true,
    'quem já tinha ficha só ganha o vínculo');
  const quantos = bd.prepare("SELECT COUNT(*) AS n FROM clientes WHERE documento = '12345678000190'").get();
  ok(quantos.n === 1, 'e não é duplicado', `n=${quantos.n}`);

  /* ====================================================================== */
  console.log('\n=== 3b. Trazer TODOS de uma vez ===');

  // Sobrou um ativo sem jornada (a Formatar). O lote tem que pega-lo.
  const antes = bd.prepare('SELECT COUNT(*) AS n FROM clientes').get().n;

  const todos = await ler(await hubPost(
    ctx('/api/hub-clientes?todos=1', env(), { etapa_id: 11 })));

  ok(todos.status === 201 && todos.corpo.criados === 1,
    'traz quem faltava', `criados=${todos.corpo.criados} jaTinham=${todos.corpo.jaTinham}`);
  ok(todos.corpo.falhas.length === 0, 'sem falhas de lote');

  const depoisLote = bd.prepare('SELECT COUNT(*) AS n FROM clientes').get().n;
  ok(depoisLote === antes + 1, 'criou exatamente um', `${antes} -> ${depoisLote}`);

  const formatar = bd.prepare("SELECT * FROM clientes WHERE documento = '07091149000172'").get();
  ok(formatar?.erp_id === '507f1f77bcf86cd799439013', 'com o vinculo do ERP');
  ok(formatar?.etapa_id === 11, 'na etapa escolhida', `etapa=${formatar?.etapa_id}`);
  ok(formatar?.data_inicio === '2005-01-10',
    'com o inicio vindo do contrato no ERP, nao da data de hoje', formatar?.data_inicio);

  // Rodar de novo nao pode duplicar ninguem.
  const denovoLote = await ler(await hubPost(ctx('/api/hub-clientes?todos=1', env(), {})));
  ok(denovoLote.corpo.criados === 0, 'rodar de novo nao cria nada');
  ok(/ja tem jornada|já têm jornada/.test(denovoLote.corpo.mensagem || ''), 'e diz que todos ja tem');
  ok(bd.prepare('SELECT COUNT(*) AS n FROM clientes').get().n === depoisLote, 'nenhum duplicado');

  // Etapa de outro pipeline e recusada e cai na primeira da jornada.
  bd.exec("DELETE FROM clientes WHERE documento = '07091149000172'");
  const etapaErrada = await ler(await hubPost(
    ctx('/api/hub-clientes?todos=1', env(), { etapa_id: 5 })));
  ok(etapaErrada.corpo.criados === 1, 'traz mesmo com etapa invalida');
  const naPrimeira = bd.prepare("SELECT etapa_id FROM clientes WHERE documento = '07091149000172'").get();
  ok(naPrimeira?.etapa_id === 10,
    'etapa do funil comercial e recusada e cai na primeira da jornada',
    `etapa=${naPrimeira?.etapa_id}`);

  // Quem a CX inativou nao pode ser ressuscitado pelo lote.
  bd.exec("UPDATE clientes SET ativo = 0 WHERE documento = '07091149000172'");
  const comInativo = await ler(await hubPost(ctx('/api/hub-clientes?todos=1', env(), {})));
  ok(comInativo.corpo.criados === 0,
    'cliente que a CX inativou NAO volta pelo lote', `criados=${comInativo.corpo.criados}`);

  /* ====================================================================== */
  console.log('\n=== 4. A trava do ERP na conversão ===');

  const semHub = await ler(await convGet(ctx('/api/conversao?lead_id=2', { DB })));
  ok(semHub.corpo.pode === true, 'sem chave do hub, a conversão continua possível');
  ok(semHub.corpo.erp?.consultado === false && !!semHub.corpo.erp?.aviso,
    'e a tela é avisada de que não deu para conferir');

  const barrado = await ler(await convGet(ctx('/api/conversao?lead_id=2', env())));
  ok(barrado.corpo.pode === false && barrado.corpo.impedimento?.code === 'NAO_ESTA_NO_ERP',
    'com chave, CNPJ fora do ERP é barrado — a regra do roadmap');

  const barradoPost = await ler(await convPost(ctx('/api/conversao?lead_id=2', env(), {})));
  ok(barradoPost.status === 409, 'e barrado também na gravação, não só na tela');

  bd.exec("DELETE FROM clientes WHERE documento = '19131243000197'");
  const convertido = await ler(await convPost(ctx('/api/conversao?lead_id=1', env(), { etapa_id: 10 })));
  ok(convertido.status === 201, 'CNPJ que existe no ERP converte', `status=${convertido.status}`);
  ok(convertido.corpo.cliente.erp_id === '507f1f77bcf86cd799439012',
    'e a conversão já grava o erp_id — a trava e o vínculo de uma vez');
  ok(convertido.corpo.cliente.lead_id === 1, 'sem perder o vínculo com o lead');

  /* ====================================================================== */
  console.log('\n=== 5. Chave sem hub:customers:read ===');

  duble.kill();
  await new Promise((r) => setTimeout(r, 400));
  duble = await subirDuble(['--sem-permissao']);

  const semPerm = await ler(await hubGet(ctx('/api/hub-clientes?diagnostico=1', env())));
  ok(semPerm.corpo.ok === false && semPerm.corpo.code === 'HUB_SEM_PERMISSAO',
    'o 403 do hub vira um código legível');
  ok(/hub:customers:read/.test(semPerm.corpo.mensagem || ''),
    'a mensagem nomeia a permissão que falta');
  ok(/HUB_CUSTOMERS_KEY/.test(semPerm.corpo.comoResolver || ''),
    'e diz a saída alternativa: uma segunda chave');

  const listaSemPerm = await ler(await hubGet(ctx('/api/hub-clientes', env())));
  // 503, e nao 403: falta de permissao no hub e problema de CONFIGURACAO
  // do servidor, nao de autorizacao do usuario. Enquanto foi 403, o front
  // derrubava a sessao de quem abrisse a tela (v2.23.0).
  ok(listaSemPerm.status === 503 && listaSemPerm.corpo.code === 'HUB_SEM_PERMISSAO',
    'a listagem também falha com código, para a tela poder explicar');

  const convSemPerm = await ler(await convGet(ctx('/api/conversao?lead_id=2', env())));
  ok(convSemPerm.corpo.pode === true,
    'sem permissão, a conversão segue permitida — o problema é nosso, não do usuário');
  ok(/permiss/i.test(convSemPerm.corpo.erp?.aviso || ''), 'mas o aviso diz o motivo');

} finally {
  duble.kill();
}

console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
