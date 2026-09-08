/**
 * Prova do módulo comum de versionamento, contra as TRÊS formas de
 * tabela de verdade — `dossies`, `propostas` (depois da 009) e
 * `dossies_cx` —, em SQLite em memória.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { criarVersionador } from '../../functions/api/_lib/versionamento.js';

import { fileURLToPath } from 'node:url';
const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

/**
 * Adaptador D1 sobre o node:sqlite. O módulo usa a API do D1
 * (`prepare().bind().first()/.all()/.run()`), e é ela que precisa ser
 * exercitada — testar contra outra interface provaria outra coisa.
 */
function d1(db) {
  return {
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

const usuario = { email: 'cx@formatar.com.br' };
const bd = new DatabaseSync(':memory:');
const DB = d1(bd);

/* ==========================================================================
   1. AS TRÊS TABELAS, COMO SÃO EM PRODUÇÃO
   ========================================================================== */
console.log('\n=== 1. Esquemas reais ===');

bd.exec(`
  CREATE TABLE dossies (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cnpj TEXT NOT NULL,
    razao_social TEXT, nome_fantasia TEXT, versao INTEGER NOT NULL,
    gerado_por TEXT NOT NULL, gerado_em TEXT NOT NULL, provider TEXT,
    fonte_cnpj TEXT, fonte_site TEXT, fonte_instagram TEXT,
    r2_key TEXT NOT NULL, tamanho_bytes INTEGER, dados_json TEXT,
    status TEXT NOT NULL DEFAULT 'concluido', erro_mensagem TEXT, html TEXT,
    UNIQUE (cnpj, versao));

  CREATE TABLE propostas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL,
    documento TEXT, cliente_nome TEXT, versao INTEGER NOT NULL,
    gerado_por TEXT NOT NULL, gerado_em TEXT NOT NULL,
    html TEXT, tamanho_bytes INTEGER, dados_json TEXT,
    UNIQUE (lead_id, versao));

  CREATE TABLE dossies_cx (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER NOT NULL,
    cliente_nome TEXT, documento TEXT, versao INTEGER NOT NULL,
    gerado_por TEXT NOT NULL, gerado_em TEXT NOT NULL, provider TEXT NOT NULL,
    html TEXT, tamanho_bytes INTEGER, dados_json TEXT,
    status TEXT NOT NULL DEFAULT 'concluido', erro_mensagem TEXT,
    UNIQUE (cliente_id, versao));
`);

// Uma proposta ANTERIOR à 009: é ela que não pode sumir da tela quando a
// leitura passar a filtrar status='concluido'.
bd.exec(`INSERT INTO propostas (lead_id, cliente_nome, versao, gerado_por, gerado_em, html, tamanho_bytes, dados_json)
         VALUES (5, 'Cliente Antigo', 1, 'jair@formatar.com.br', '2026-08-01T10:00:00Z', '<html>velha</html>', 18, '{"v":"antiga"}')`);

ok(true, 'as três tabelas criadas com o esquema de produção');

console.log('\n--- a migração 009 ---');
const sql009 = readFileSync(`${RAIZ}/db/migracao-009-propostas-status.sql`, 'utf8');
bd.exec(sql009);

const colunas = bd.prepare(`SELECT name FROM pragma_table_info('propostas')`).all().map((r) => r.name);
ok(colunas.includes('status') && colunas.includes('erro_mensagem'),
  'a 009 acrescenta status e erro_mensagem', colunas.join(', '));

const antiga = bd.prepare('SELECT status FROM propostas WHERE lead_id = 5').get();
ok(antiga.status === 'concluido',
  'a proposta que já existia nasce concluida e NÃO some da tela', `status=${antiga.status}`);

// A 009 usa ALTER TABLE e o SQLite não tem ADD COLUMN IF NOT EXISTS. O
// cabeçalho do arquivo avisa; aqui fica provado que o aviso é verdadeiro.
let reaplicouQuebrou = false;
try { bd.exec(sql009); } catch (e) { reaplicouQuebrou = /duplicate column/i.test(e.message); }
ok(reaplicouQuebrou, 'reaplicar a 009 QUEBRA — como o cabeçalho do arquivo avisa');

/* ==========================================================================
   2. OS TRÊS VERSIONADORES
   ========================================================================== */

const dossies = criarVersionador({
  tabela: 'dossies', chave: 'cnpj', rotulo: 'do dossiê',
  colunasResumo: ['razao_social', 'nome_fantasia', 'provider', 'fonte_cnpj', 'fonte_site', 'fonte_instagram']
});

const propostas = criarVersionador({
  tabela: 'propostas', chave: 'lead_id', rotulo: 'da proposta',
  colunasResumo: ['cliente_nome', 'documento']
});

const dossiesCx = criarVersionador({
  tabela: 'dossies_cx', chave: 'cliente_id', rotulo: 'do dossiê de experiência',
  colunasResumo: ['cliente_nome', 'documento', 'provider']
});

console.log('\n=== 2. Gravação nos três ===');

const g1 = await dossies.salvar({
  db: DB, valorChave: '07091149000172', usuario,
  dados: (v) => ({ empresa: { razaoSocial: 'Formatar' }, gerado: { versao: v } }),
  montarHtml: (v) => `<html>dossie v${v}</html>`,
  extras: { razao_social: 'Formatar', nome_fantasia: null, provider: 'deepseek',
            fonte_cnpj: 'ok', fonte_site: 'falha', fonte_instagram: 'ausente', r2_key: '' }
});
ok(g1.ok && g1.versao === 1, 'dossies: primeira versão é 1', JSON.stringify(g1));

const g2 = await propostas.salvar({
  db: DB, valorChave: 5, usuario,
  dados: { cliente: { nome: 'Cliente Antigo' } },
  montarHtml: () => '<html>proposta nova</html>',
  extras: { documento: '12345678000199', cliente_nome: 'Cliente Antigo' }
});
ok(g2.ok && g2.versao === 2, 'propostas: continua a numeração de quem já existia', JSON.stringify(g2));

const g3 = await dossiesCx.salvar({
  db: DB, valorChave: 10, usuario,
  dados: (v) => ({ conta: {}, gerado: { versao: v } }),
  montarHtml: (v) => `<html>cx v${v}</html>`,
  extras: { cliente_nome: 'Vale Verde', documento: null, provider: 'deepseek' }
});
ok(g3.ok && g3.versao === 1, 'dossies_cx: primeira versão é 1');

/* --- gerar de novo NUNCA sobrescreve --- */
const g4 = await dossiesCx.salvar({
  db: DB, valorChave: 10, usuario,
  dados: (v) => ({ gerado: { versao: v } }),
  montarHtml: (v) => `<html>cx v${v}</html>`,
  extras: { cliente_nome: 'Vale Verde', documento: null, provider: 'chatgpt' }
});
ok(g4.versao === 2, 'gerar de novo cria a versão seguinte');
ok(await dossiesCx.lerHtml(DB, 10, 1) === '<html>cx v1</html>',
  'a versão anterior continua consultável — nunca foi sobrescrita');

/* --- o dados_json guarda a versão CERTA (o furo do Executivo) --- */
const dadosV2 = await dossiesCx.lerDados(DB, 10, 2);
ok(dadosV2?.gerado?.versao === 2,
  'o dados_json guarda o número da versão, não null',
  `versao=${dadosV2?.gerado?.versao}`);

const dadosDossie = await dossies.lerDados(DB, '07091149000172', 1);
ok(dadosDossie?.gerado?.versao === 1,
  'o mesmo vale para o Executivo, que gravava null até a 2.16.0',
  `versao=${dadosDossie?.gerado?.versao}`);

/* ==========================================================================
   3. AS GUARDAS
   ========================================================================== */
console.log('\n=== 3. Guardas ===');

const vazio = await dossiesCx.salvar({
  db: DB, valorChave: 99, usuario, dados: {}, montarHtml: () => '',
  extras: { cliente_nome: null, documento: null, provider: 'deepseek' }
});
ok(!vazio.ok && /veio vazio/.test(vazio.erro), 'HTML vazio é recusado', vazio.erro);

const gigante = await dossiesCx.salvar({
  db: DB, valorChave: 98, usuario, dados: {},
  montarHtml: () => 'x'.repeat(800_000),
  extras: { cliente_nome: null, documento: null, provider: 'deepseek' }
});
ok(!gigante.ok && /grande demais/.test(gigante.erro), 'documento gigante é recusado', gigante.erro);

const semFuncao = await dossiesCx.salvar({
  db: DB, valorChave: 97, usuario, dados: {}, montarHtml: null,
  extras: { cliente_nome: null, documento: null, provider: 'deepseek' }
});
ok(!semFuncao.ok, 'montarHtml que não é função é recusado');

const semDb = await dossiesCx.salvar({ db: null, valorChave: 96, usuario, dados: {}, montarHtml: () => 'x' });
ok(!semDb.ok && /DB/.test(semDb.erro), 'sem binding do D1, recusa com a causa');

// Nada disso pode ter deixado linha para trás.
const lixo = bd.prepare('SELECT COUNT(*) AS n FROM dossies_cx WHERE cliente_id IN (96,97,98,99)').get();
ok(lixo.n === 0, 'nenhuma tentativa recusada deixou linha no banco', `n=${lixo.n}`);

/* --- identificador --- */
let recusou = false;
try { criarVersionador({ tabela: 'dossies; DROP TABLE leads', chave: 'cnpj' }); }
catch (e) { recusou = true; }
ok(recusou, 'nome de tabela fora do padrão é recusado na criação');

/* ==========================================================================
   4. COLISÃO ENTRE DOIS CONSULTORES
   ========================================================================== */
console.log('\n=== 4. Colisão do UNIQUE ===');

// Simula a corrida: alguém grava a versão 3 no intervalo entre o cálculo
// e o INSERT. A retentativa tem que refazer com o número seguinte.
let intercalou = false;
const comCorrida = await dossiesCx.salvar({
  db: DB, valorChave: 10, usuario,
  dados: (v) => ({ gerado: { versao: v } }),
  montarHtml: (v) => {
    if (!intercalou) {
      intercalou = true;
      bd.exec(`INSERT INTO dossies_cx (cliente_id, versao, gerado_por, gerado_em, provider, html, tamanho_bytes, status)
               VALUES (10, ${v}, 'outro@formatar.com.br', '2026-09-05T12:00:00Z', 'deepseek', '<html>outro</html>', 20, 'concluido')`);
    }
    return `<html>cx v${v}</html>`;
  },
  extras: { cliente_nome: 'Vale Verde', documento: null, provider: 'deepseek' }
});

ok(comCorrida.ok, 'a gravação sobrevive à colisão', JSON.stringify(comCorrida));
ok(comCorrida.versao === 4, 'refaz com o número seguinte', `versao=${comCorrida.versao}`);

// E o documento gravado tem que trazer o número CERTO, não o da tentativa
// que colidiu — é para isso que o HTML é montado dentro do laço.
ok(await dossiesCx.lerHtml(DB, 10, 4) === '<html>cx v4</html>',
  'o documento estampa a versão com que foi realmente gravado');

/* ==========================================================================
   5. REGISTRO DE FALHA
   ========================================================================== */
console.log('\n=== 5. Registro de falha ===');

await propostas.registrarErro({
  db: DB, valorChave: 5, usuario,
  mensagem: 'no such table: propostas',
  extras: { cliente_nome: 'Cliente Antigo' }
});

const erro = bd.prepare(`SELECT versao, status, erro_mensagem FROM propostas WHERE lead_id = 5 AND status = 'erro'`).get();
ok(!!erro, 'a proposta agora deixa rastro quando falha — era a única sem isso');
ok(erro?.erro_mensagem === 'no such table: propostas',
  'a mensagem guardada é a causa real', erro?.erro_mensagem);

// A linha de erro não pode aparecer como se fosse documento.
const versoesProposta = await propostas.listarVersoes(DB, 5);
ok(versoesProposta.every((v) => v.versao !== erro.versao),
  'a linha de erro não aparece no histórico',
  `versões: ${versoesProposta.map((v) => v.versao).join(', ')}`);
ok(versoesProposta.length === 2, 'o histórico traz as duas propostas boas',
  `n=${versoesProposta.length}`);

// E não pode ser aberta como documento.
ok(await propostas.lerHtml(DB, 5, erro.versao) === null,
  'a versão que falhou não abre como documento');

// A última versão BOA continua sendo devolvida por padrão.
ok(await propostas.lerHtml(DB, 5) === '<html>proposta nova</html>',
  'o padrão continua sendo a última versão concluída');

/* ==========================================================================
   6. LEITURAS
   ========================================================================== */
console.log('\n=== 6. Leituras ===');

const ultima = await dossies.buscarUltima(DB, '07091149000172');
ok(ultima?.razao_social === 'Formatar' && ultima?.fonte_site === 'falha',
  'buscarUltima traz as colunas próprias do Executivo');
ok(ultima?.html === undefined,
  'buscarUltima NÃO carrega o HTML — é consultada com frequência');

ok(await dossies.lerHtml(DB, 'nao-existe') === null, 'chave inexistente devolve null');
ok(await dossies.lerDados(DB, 'nao-existe') === null, 'lerDados de chave inexistente devolve null');
ok((await dossies.listarVersoes(DB, 'nao-existe')).length === 0, 'histórico vazio é lista vazia');

// JSON corrompido não pode derrubar a leitura.
bd.exec(`UPDATE dossies SET dados_json = '{quebrado' WHERE cnpj = '07091149000172'`);
ok(await dossies.lerDados(DB, '07091149000172') === null,
  'dados_json corrompido devolve null em vez de lançar');

/* ==========================================================================
   7. OS ENDPOINTS NÃO GRAVAM MAIS POR CONTA PRÓPRIA
   ========================================================================== */
console.log('\n=== 7. Sem cópias soltas ===');

for (const arquivo of ['dossier.js', 'proposta.js', 'dossie-cx.js']) {
  const fonte = readFileSync(`${RAIZ}/functions/api/${arquivo}`, 'utf8');
  ok(!/INSERT\s+INTO/i.test(fonte), `${arquivo} não tem INSERT próprio`);
  ok(!/COALESCE\(MAX\(versao\)/i.test(fonte), `${arquivo} não calcula versão por conta própria`);
}

const modulo = readFileSync(`${RAIZ}/functions/api/_lib/versionamento.js`, 'utf8');
ok((modulo.match(/INSERT\s+INTO/gi) || []).length === 2,
  'o módulo comum tem os dois INSERT (documento e erro), e mais nenhum');

console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
