/**
 * Prova da Fase 2 do lote "o cliente é do ERP" — o dossiê deixa de ler
 * só a si mesmo.
 *
 * Caminho inteiro, sem cópia: SQLite em memória com o esquema real, o
 * dublê do hub num processo à parte, e a `reunirConta` / `montarContexto`
 * importadas do `functions/api/dossie-cx.js` que roda em produção.
 *
 * O QUE ESTA SUÍTE GUARDA é a frase que custou caro em 15/09/2026. O
 * Dossiê de Experiência da ZANNA SOUND afirmou "nenhum núcleo marcado" e
 * "nenhuma pessoa mapeada", e a folha de Recomendação mandou a CX ir a
 * campo levantar interlocutores e marcar núcleos — que estavam
 * cadastrados no ERP o tempo todo. O documento lia a ficha do CRM e
 * nunca tinha perguntado ao ERP.
 *
 * Por isso quase toda conferência aqui é sobre a diferença entre "não
 * existe" e "não perguntei".
 */
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { reunirConta, montarContexto } from '../../functions/api/dossie-cx.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
const BASE = 'http://127.0.0.1:8787/v1';

const ACME = '507f1f77bcf86cd799439011';
const VALE_VERDE = '507f1f77bcf86cd799439012';

let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

/* ---- o shim do D1 sobre o node:sqlite ---- */
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
  throw new Error('o dublê do hub não subiu');
}

const derrubar = (p) => new Promise((r) => { p.once('exit', r); p.kill(); });

/* ==========================================================================
   O BANCO — o que o CRM legitimamente tem de seu
   ========================================================================== */

const bd = new DatabaseSync(':memory:');
bd.exec(`
  CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT, nome_fantasia TEXT,
    documento TEXT, cidade TEXT, telefone TEXT, email TEXT, contato_nome TEXT,
    etapa_id INTEGER, classificacao INTEGER, data_inicio TEXT, etapa_desde TEXT,
    observacoes TEXT, nucleos TEXT DEFAULT '[]', erp_id TEXT, ativo INTEGER DEFAULT 1);
  CREATE TABLE nucleos (id INTEGER PRIMARY KEY, nome TEXT, cor TEXT);
  CREATE TABLE papeis (id INTEGER PRIMARY KEY, nome TEXT);
  CREATE TABLE etapas (id INTEGER PRIMARY KEY, nome TEXT, cor TEXT, pipeline TEXT);
  CREATE TABLE stakeholders (id INTEGER PRIMARY KEY, cliente_id INTEGER, nome TEXT,
    papel_id INTEGER, cargo TEXT, email TEXT, telefone TEXT,
    influencia TEXT DEFAULT 'desconhecida', postura TEXT DEFAULT 'desconhecida',
    patrocinador INTEGER DEFAULT 0, nucleos TEXT DEFAULT '[]', observacoes TEXT,
    ativo INTEGER DEFAULT 1);

  INSERT INTO etapas (id, nome, cor, pipeline) VALUES (7, 'Boas-vindas', '#F2421A', 'jornada');
  INSERT INTO nucleos (id, nome, cor) VALUES (1, 'Marcado à mão', '#999999');
  INSERT INTO papeis (id, nome) VALUES (1, 'Decisor');

  -- 1: cliente ligado ao ERP, com a ficha VAZIA de núcleos e sem
  --    ninguém no mapa. É a ZANNA SOUND: o CRM não sabe nada, o ERP sabe.
  INSERT INTO clientes (id, nome, nome_fantasia, documento, etapa_id,
                        classificacao, data_inicio, nucleos, erp_id, ativo)
  VALUES (1, 'Acme Indústria S.A.', 'Acme', '12345678000190', 7,
          NULL, '2026-01-28', '[]', '${ACME}', 1);

  -- 2: cliente do ERP cuja avaliação da CX existe no CRM, para provar a
  --    junção por e-mail.
  INSERT INTO clientes (id, nome, documento, etapa_id, data_inicio, nucleos, erp_id, ativo)
  VALUES (2, 'Comercial Vale Verde LTDA', '19131243000197', 7, '2023-11-20', '[]',
          '${VALE_VERDE}', 1);

  INSERT INTO stakeholders (cliente_id, nome, papel_id, cargo, email, influencia,
                            postura, patrocinador, nucleos, observacoes, ativo)
  VALUES (2, 'Roberto Nunes', 1, NULL, 'roberto@valeverde.com.br', 'alta',
          'promotor', 1, '[]', 'Decide sozinho.', 1);

  -- Alguém que a CX registrou e que o ERP não conhece.
  INSERT INTO stakeholders (cliente_id, nome, cargo, email, influencia, postura,
                            patrocinador, nucleos, ativo)
  VALUES (2, 'Fantasma do CRM', 'Consultor externo', 'fantasma@outro.com',
          'baixa', 'neutro', 0, '[]', 1);

  -- 3: cadastro manual, SEM vínculo com o ERP, com núcleo marcado à mão.
  INSERT INTO clientes (id, nome, documento, etapa_id, data_inicio, nucleos, erp_id, ativo)
  VALUES (3, 'Cadastro Manual ME', '99999999000199', 7, '2026-02-01', '[1]', NULL, 1);
`);

const DB = d1(bd);
const env = (extra = {}) => ({ HUB_API_KEY: 'chave-de-teste', HUB_BASE_URL: BASE, ...extra });

/* ==========================================================================
   1. O CASO ZANNA — ficha vazia, ERP cheio
   ========================================================================== */
const duble = await subirDuble();

console.log('\n-- a conta cuja ficha do CRM está vazia --');

{
  const conta = await reunirConta(DB, 1, env());

  ok(conta.fontes.conta.consultado === true, 'o ERP foi consultado');
  ok(conta.fontes.pessoas.consultado === true, 'as pessoas foram consultadas');
  ok(conta.fontes.nucleos.consultado === true, 'os núcleos foram consultados');

  ok(conta.stakeholders.length === 2,
     'a conta tem 2 pessoas, vindas do ERP — a ficha do CRM não tinha nenhuma',
     'é exatamente o que o dossiê da ZANNA chamou de "relação sem rosto"');

  const tati = conta.stakeholders.find((p) => p.nome === 'Tatiana Moraes');
  ok(!!tati, 'a pessoa veio com nome');
  ok(tati.cargo === 'Diretora de Operações', 'e com o cargo do ERP');
  ok(tati.principal === true, 'e marcada como contato principal');
  ok(tati.origem === 'erp', 'com a origem declarada');
  ok(tati.avaliada === false,
     'sem avaliação da CX — que é lacuna do trabalho, não da pessoa');
  ok(tati.influencia === 'desconhecida', 'e influência "desconhecida", nunca inventada');

  ok(conta.nucleos.length === 1 && conta.nucleos[0].nome === 'Operações',
     'o núcleo atendido é o Time, lido das reuniões do ERP');

  ok(conta.cliente.classificacao === 'A',
     'a classificação vem do ERP, e vem COMO ELA É — uma letra',
     'o dossiê da ZANNA disse "não há registro de classificação no ERP" lendo o CRM');

  ok(conta.cliente.nome_fantasia === 'Acme Indústria',
     'a identidade do ERP vence a cópia local');
}

console.log('\n-- e o que chega ao modelo --');

{
  const conta = await reunirConta(DB, 1, env());
  const ctx = montarContexto(conta);

  ok(/lido AO VIVO do ERP/.test(ctx), 'o contexto declara que o ERP foi lido');
  ok(/Tatiana Moraes/.test(ctx), 'as pessoas do ERP chegam ao modelo');
  ok(/CONTATO PRINCIPAL no ERP/.test(ctx), 'com o principal marcado');
  ok(/Operações/.test(ctx), 'e o núcleo também');
  ok(!/nenhuma pessoa mapeada/i.test(ctx),
     'e em lugar nenhum se diz que não há pessoas');
  ok(/Contagem não é conteúdo/.test(ctx) === false,
     'a regra sobre conteúdo mora no prompt, não no contexto');
  ok(/NÃO SABE o que foi tratado/.test(ctx),
     'o contexto proíbe falar do conteúdo das reuniões, que segue faltando');
}

/* ==========================================================================
   2. A JUNÇÃO — identidade do ERP, avaliação do CRM
   ========================================================================== */
console.log('\n-- a avaliação da CX cola na pessoa do ERP --');

{
  const conta = await reunirConta(DB, 2, env());

  const roberto = conta.stakeholders.find((p) => p.nome === 'Roberto Nunes');
  ok(!!roberto, 'Roberto veio do ERP');
  ok(roberto.influencia === 'alta' && roberto.patrocinador === true,
     'e trouxe junto a avaliação que a CX registrou no CRM',
     'casadas por e-mail, sem migração — a amarra durável é a Fase 3');
  ok(roberto.cargo === 'Sócio',
     'o cargo é o do ERP, não o do CRM (que estava vazio)');
  ok(roberto.avaliada === true, 'marcada como avaliada');
  ok(roberto.observacoes === 'Decide sozinho.', 'com a observação da CX preservada');

  const fantasma = conta.stakeholders.find((p) => p.nome === 'Fantasma do CRM');
  ok(!!fantasma, 'quem só existe no CRM NÃO some da folha');
  ok(fantasma.origem === 'crm', 'e vai marcado como tal',
     'ou é gente que saiu do cliente, ou cadastro que nunca existiu no ERP');

  ok(conta.fontes.pessoas.soNoCrm === 1, 'e a folha sabe quantos são');
}

console.log('\n-- o cruzamento núcleo × pessoa sai da presença nas reuniões --');

{
  const conta = await reunirConta(DB, 2, env());

  ok(conta.fontes.ligacaoNucleoPessoaConhecida === true,
     'o ERP registra participante de cliente nesta conta');

  const roberto = conta.stakeholders.find((p) => p.nome === 'Roberto Nunes');
  ok(roberto.nucleos.includes('Operações'),
     'e é por ter sentado na reunião que Roberto se liga ao núcleo',
     'apurado, não declarado num cadastro');

  ok(Array.isArray(conta.mapa.nucleosSemPessoa),
     'com a ligação conhecida, o cruzamento é feito');
}

/* ==========================================================================
   3. SEM VÍNCULO COM O ERP
   ========================================================================== */
console.log('\n-- cadastro manual, sem erp_id --');

{
  const conta = await reunirConta(DB, 3, env());

  ok(conta.fontes.nucleos.consultado === false,
     'sem erp_id, os núcleos NÃO foram consultados');
  ok(/erp_id/.test(conta.fontes.nucleos.motivo || ''), 'e o motivo diz por quê');
  ok(conta.fontes.nucleos.origem === 'crm',
     'a marcação manual da ficha é usada como reserva');
  ok(conta.nucleos.length === 1 && conta.nucleos[0].nome === 'Marcado à mão',
     'e aparece — vale mais que nada');

  const ctx = montarContexto(conta);
  ok(/NÃO CONSULTADOS/.test(ctx), 'o contexto avisa o modelo');
  ok(/PROIBIDO afirmar que este cliente não tem núcleo/.test(ctx),
     'e proíbe explicitamente a conclusão que gerou o retrabalho');
  ok(/não foi conferida contra o ERP/.test(ctx),
     'declarando que a marcação manual pode estar velha');
}

/* ==========================================================================
   4. O HUB CALADO — o teste que mais importa
   ========================================================================== */
await derrubar(duble);
const duble403 = await subirDuble(['--sem-permissao']);

console.log('\n-- o ERP responde 403 --');

{
  const conta = await reunirConta(DB, 1, env());

  ok(conta.fontes.conta.consultado === false, 'a conta não foi consultada');
  ok(conta.fontes.pessoas.consultado === false, 'as pessoas não foram consultadas');
  ok(conta.fontes.nucleos.consultado === false, 'os núcleos não foram consultados');

  ok(conta.stakeholders.length === 0, 'e a lista de pessoas vem vazia');

  const ctx = montarContexto(conta);
  ok(/MAPA DE PESSOAS — NÃO CONSULTADO/.test(ctx),
     'MAS o contexto diz "não consultado", não "não há"',
     'é a diferença inteira entre este lote e o defeito que ele conserta');
  ok(/PROIBIDO afirmar que não há pessoa mapeada/.test(ctx),
     'e proíbe a frase que mandou a CX a campo');
  ok(/permiss/i.test(ctx), 'com o motivo real do 403 no texto');
  ok(!/NÃO há nenhuma pessoa cadastrada/.test(ctx),
     'em nenhum lugar afirma o vazio');
}

await derrubar(duble403);

console.log('\n-- o ERP fora do ar --');

{
  const conta = await reunirConta(DB, 1, env());

  ok(conta.fontes.pessoas.consultado === false, 'nada foi consultado');
  ok(conta.cliente.nome === 'Acme Indústria S.A.',
     'a cópia do CRM segura o documento de pé');

  const ctx = montarContexto(conta);
  ok(/o ERP NÃO respondeu/.test(ctx), 'e o contexto diz que a cópia é cópia');
  ok(/NÃO CONSULTADO/.test(ctx), 'sem afirmar vazio nenhum');
}

console.log('\n-- sem chave do hub configurada --');

{
  const conta = await reunirConta(DB, 1, { DB });
  ok(conta.fontes.pessoas.consultado === false,
     'servidor sem HUB_API_KEY também é "não consultei"');
  ok(!/nenhuma pessoa/i.test(montarContexto(conta)),
     'e continua sem afirmar o vazio');
}

console.log(`\n${falhas ? `${falhas} FALHA(S)` : 'tudo certo'}`);
process.exit(falhas ? 1 : 0);
