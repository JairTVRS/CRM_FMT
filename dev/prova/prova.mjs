/**
 * Prova real do Lote L: migração 008 num SQLite em memória, as consultas
 * que a API faz de verdade, e o render do template com dados que saíram
 * desse banco.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  validarAnaliseCx, analiseCxUtilizavel, montarDossieCx,
  resumirMapa, mesesDesde
} from '../../functions/api/_lib/schema-dossie-cx.js';
import { renderizarDossieCx } from '../../functions/api/_lib/dossie-cx-template.js';

import { fileURLToPath } from 'node:url';
const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

/* ==========================================================================
   1. A MIGRAÇÃO 008 APLICA?
   ========================================================================== */
console.log('\n=== 1. Migração 008 em SQLite ===');

const db = new DatabaseSync(':memory:');

// As tabelas de que a 008 depende, no mínimo que as consultas exigem.
db.exec(`
  CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT, nome_fantasia TEXT,
    documento TEXT, cidade TEXT, telefone TEXT, email TEXT, contato_nome TEXT,
    etapa_id INTEGER, classificacao INTEGER, data_inicio TEXT, observacoes TEXT,
    nucleos TEXT DEFAULT '[]', erp_id INTEGER, ativo INTEGER DEFAULT 1);
  CREATE TABLE nucleos (id INTEGER PRIMARY KEY, nome TEXT, cor TEXT);
  CREATE TABLE papeis (id INTEGER PRIMARY KEY, nome TEXT);
  CREATE TABLE etapas (id INTEGER PRIMARY KEY, nome TEXT, cor TEXT, pipeline TEXT);
`);

const sql = readFileSync(`${RAIZ}/db/migracao-008-stakeholders-dossie-cx.sql`, 'utf8');
db.exec(sql);
ok(true, 'a 008 aplica sem erro');

// A convenção nasceu do incidente da 006: conferir DEPOIS de aplicar.
const tabelas = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('stakeholders','dossies_cx')`
).all().map((r) => r.name).sort();
ok(tabelas.length === 2, 'as duas tabelas existem', tabelas.join(', '));

// A promessa escrita no cabeçalho do arquivo: seguro rodar duas vezes.
db.exec(sql);
ok(true, 'reaplicar a 008 não quebra (só CREATE ... IF NOT EXISTS)');

/* ==========================================================================
   2. AS CONSULTAS QUE A API FAZ
   ========================================================================== */
console.log('\n=== 2. Consultas da API ===');

db.exec(`
  INSERT INTO etapas (id, nome, cor, pipeline) VALUES (7, 'Em operação', '#F2421A', 'jornada');
  INSERT INTO nucleos (id, nome, cor) VALUES (1,'Logística','#F2421A'), (2,'Estoque','#16a34a'), (3,'Conselho Gestor','#2563eb');
  INSERT INTO papeis (id, nome) VALUES (1,'Decisor'), (2,'Usuário-chave');
  INSERT INTO clientes (id, nome, nome_fantasia, documento, cidade, contato_nome,
                        etapa_id, classificacao, data_inicio, observacoes, nucleos, erp_id, ativo)
  VALUES (10, 'Comercial Vale Verde LTDA', 'Vale Verde', '12345678000199', 'Uberlândia',
          'Marina Alves', 7, 3, '2025-03-10', 'Conta puxada pelo dono; filho assumiu o estoque.',
          '[1,2,3]', NULL, 1);
`);

const inserir = db.prepare(`
  INSERT INTO stakeholders (cliente_id, nome, papel_id, cargo, email, telefone,
    influencia, postura, patrocinador, nucleos, observacoes, criado_por, criado_em, ativo)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);

const agora = new Date().toISOString();
inserir.run(10, 'Roberto Nunes', 1, 'Diretor', 'roberto@valeverde.com.br', '(34) 99999-0001',
  'alta', 'promotor', 1, '[1,3]', 'Decide sozinho; responde rápido no WhatsApp.', 'cx@formatar.com.br', agora);
inserir.run(10, 'Marina Alves', 2, 'Coordenadora de Logística', 'marina@valeverde.com.br', null,
  'media', 'neutro', 0, '[1]', null, 'cx@formatar.com.br', agora);
inserir.run(10, 'Tiago Nunes', null, 'Estoque', null, null,
  'desconhecida', 'desconhecida', 0, '[]', null, 'cx@formatar.com.br', agora);

// O ORDER BY que a API usa: patrocinador primeiro, depois influência.
const pessoas = db.prepare(
  `SELECT * FROM stakeholders WHERE cliente_id = ? AND ativo = 1
   ORDER BY patrocinador DESC,
            CASE influencia WHEN 'alta' THEN 1 WHEN 'media' THEN 2
                            WHEN 'baixa' THEN 3 ELSE 4 END,
            nome COLLATE NOCASE`
).all(10);

ok(pessoas.map((p) => p.nome).join(' | ') === 'Roberto Nunes | Marina Alves | Tiago Nunes',
  'a ordem da tabela é a ordem em que se pensa a conta',
  pessoas.map((p) => p.nome).join(' | '));

// O índice único parcial: repetido entre ATIVOS é barrado...
let barrou = false;
try {
  inserir.run(10, 'roberto nunes', null, null, null, null, 'desconhecida', 'desconhecida', 0, '[]', null, 'x', agora);
} catch (e) { barrou = /UNIQUE/i.test(e.message); }
ok(barrou, 'nome repetido no mesmo cliente é barrado (COLLATE NOCASE)');

// ...mas quem saiu da empresa não impede o recadastro.
db.exec(`UPDATE stakeholders SET ativo = 0 WHERE nome = 'Tiago Nunes'`);
let recadastrou = true;
try {
  inserir.run(10, 'Tiago Nunes', null, 'Gerente de Estoque', null, null, 'baixa', 'neutro', 0, '[2]', null, 'x', agora);
} catch (e) { recadastrou = false; }
ok(recadastrou, 'quem saiu e voltou pode ser recadastrado (índice parcial em ativo = 1)');

// Alguém cadastrado mas ainda não avaliado, e sem núcleo: é o caso que o
// documento precisa saber distinguir de "neutra".
inserir.run(10, 'Cláudia Reis', null, 'Financeiro', null, null,
  'desconhecida', 'desconhecida', 0, '[]', null, 'cx@formatar.com.br', agora);

// A trava de exclusão de núcleo do cadastros.js — as DUAS amarras.
const emClientes = db.prepare(
  `SELECT COUNT(*) AS n FROM clientes, json_each(clientes.nucleos)
   WHERE json_each.value = ? AND clientes.ativo = 1`).get(1);
const emPessoas = db.prepare(
  `SELECT COUNT(*) AS n FROM stakeholders, json_each(stakeholders.nucleos)
   WHERE json_each.value = ? AND stakeholders.ativo = 1`).get(1);
ok(emClientes.n === 1 && emPessoas.n === 2,
  'a trava do núcleo conta clientes E pessoas',
  `clientes=${emClientes.n} pessoas=${emPessoas.n}`);

// A trava de exclusão de papel, o ramo que estava vazio desde a 007.
const emPapel = db.prepare(
  'SELECT COUNT(*) AS n FROM stakeholders WHERE papel_id = ? AND ativo = 1').get(1);
ok(emPapel.n === 1, 'a trava do papel conta as pessoas que o usam', `n=${emPapel.n}`);

// O UNIQUE (cliente_id, versao) que protege duas gerações simultâneas.
db.exec(`INSERT INTO dossies_cx (cliente_id, versao, gerado_por, gerado_em, provider, status)
         VALUES (10, 1, 'cx@formatar.com.br', '${agora}', 'deepseek', 'concluido')`);
let colidiu = false;
try {
  db.exec(`INSERT INTO dossies_cx (cliente_id, versao, gerado_por, gerado_em, provider, status)
           VALUES (10, 1, 'outro@formatar.com.br', '${agora}', 'deepseek', 'concluido')`);
} catch (e) { colidiu = /UNIQUE/i.test(e.message); }
ok(colidiu, 'duas gerações não podem gravar a mesma versão');

/* ==========================================================================
   3. A ARITMÉTICA DO MAPA
   ========================================================================== */
console.log('\n=== 3. Aritmética do mapa ===');

const nomePapel = new Map(db.prepare('SELECT id, nome FROM papeis').all().map((p) => [p.id, p.nome]));
const porId = new Map(db.prepare('SELECT id, nome, cor FROM nucleos').all().map((n) => [n.id, n]));

const cliente = db.prepare('SELECT * FROM clientes WHERE id = 10').get();
const etapa = db.prepare('SELECT id, nome, cor FROM etapas WHERE id = ?').get(cliente.etapa_id);
const nucleosAtendidos = JSON.parse(cliente.nucleos).map((id) => porId.get(id)).filter(Boolean);

const stakeholders = db.prepare(
  `SELECT * FROM stakeholders WHERE cliente_id = ? AND ativo = 1
   ORDER BY patrocinador DESC, nome COLLATE NOCASE`).all(10).map((s) => {
  const ids = JSON.parse(s.nucleos || '[]');
  return {
    ...s,
    patrocinador: !!s.patrocinador,
    papel: s.papel_id ? nomePapel.get(s.papel_id) || null : null,
    nucleoIds: ids,
    nucleos: ids.map((id) => porId.get(id)?.nome).filter(Boolean)
  };
});

const mapa = resumirMapa(stakeholders, nucleosAtendidos);

ok(mapa.total === 4, 'conta as pessoas ativas', `total=${mapa.total}`);
ok(mapa.patrocinadores.join(',') === 'Roberto Nunes', 'acha o patrocinador');
ok(mapa.porInfluencia.alta === 1 && mapa.porInfluencia.media === 1
  && mapa.porInfluencia.baixa === 1 && mapa.porInfluencia.desconhecida === 1,
  'distribui a influência');
ok(mapa.naoAvaliadas === 1, 'conta quem ainda não foi avaliado', `n=${mapa.naoAvaliadas}`);
ok(mapa.nucleosSemPessoa.length === 0, 'nenhum núcleo órfão neste cenário',
  `sem pessoa: [${mapa.nucleosSemPessoa.join(', ')}]`);

// O buraco mais útil que o mapa revela: núcleo atendido sem ninguém.
const mapaComOrfao = resumirMapa(
  stakeholders.filter((p) => p.nome !== 'Roberto Nunes'), nucleosAtendidos);
ok(mapaComOrfao.nucleosSemPessoa.join(',') === 'Conselho Gestor',
  'aponta núcleo atendido sem ninguém mapeado',
  `[${mapaComOrfao.nucleosSemPessoa.join(', ')}]`);

// Ninguém avaliado é diferente de ninguém cadastrado.
ok(resumirMapa([{ influencia: 'desconhecida', postura: 'desconhecida', nucleoIds: [] }], []).naoAvaliadas === 1,
  'distingue não avaliada de neutra');

const m = mesesDesde('2025-03-10', new Date(2026, 8, 5));
ok(m === 17, 'mesesDesde conta meses inteiros', `${m} meses`);
ok(mesesDesde('2027-01-01') === null, 'data futura não vira tempo de relação negativo');
ok(mesesDesde(null) === null && mesesDesde('sei lá') === null, 'data ausente ou inválida devolve null');

/* ==========================================================================
   4. VALIDAÇÃO DA RESPOSTA DA IA
   ========================================================================== */
console.log('\n=== 4. Validação da análise ===');

const respostaSuja = {
  panorama: '<p>Conta em operação há mais de um ano.</p><script>alert(1)</script><p onclick="x()">Segue estável.</p>',
  mapaPoder: {
    leitura: '<p>Decisão concentrada no diretor.</p>',
    lacunas: ['Ninguém mapeado no Conselho Gestor', '   ', null]
  },
  riscos: [
    { risco: 'Dependência de uma pessoa só', fundamento: 'O patrocinador é o único de influência alta.', confianca: 'alta' },
    { risco: '', fundamento: 'sem risco', confianca: 'alta' },
    { risco: 'Sucessão em curso', fundamento: 'O filho assumiu o estoque.', confianca: 'inventada' }
  ],
  oportunidades: [{ titulo: 'Núcleo de Compras', descricao: 'Acréscimo ao escopo atual.', nucleo: 'Estoque' }],
  perguntas: ['Quem decide na ausência do diretor?'],
  recomendacao: '<p>Mapear alguém do Conselho Gestor.</p>'
};

const { analise, avisos, seccoesVazias } = validarAnaliseCx(respostaSuja);

ok(!/<script/i.test(analise.panorama), 'o <script> foi removido do HTML da IA');
ok(!/onclick/i.test(analise.panorama), 'o manipulador inline foi removido');
ok(analise.mapaPoder.lacunas.length === 1, 'lacunas vazias são descartadas');
ok(analise.riscos.length === 2, 'risco sem texto é descartado', `n=${analise.riscos.length}`);
ok(analise.riscos[1].confianca === 'baixa', 'confiança fora da lista cai para baixa');
ok(seccoesVazias.length === 0, 'nada faltou nesta resposta', `[${seccoesVazias.join(', ')}]`);
ok(analiseCxUtilizavel(analise), 'a análise é aproveitável');
ok(!analiseCxUtilizavel(null) && !analiseCxUtilizavel({}), 'análise vazia não passa');
ok(validarAnaliseCx(null).analise === null, 'resposta não-objeto não derruba o validador');

/* ==========================================================================
   5. O DOCUMENTO
   ========================================================================== */
console.log('\n=== 5. Render do documento ===');

const dados = montarDossieCx({
  cliente, etapa, nucleos: nucleosAtendidos, stakeholders, analise,
  meta: { geradoPor: 'cx@formatar.com.br', provider: 'deepseek', geradoEm: agora, versao: 2 }
});

const html = renderizarDossieCx(dados);
const bytes = Buffer.byteLength(html, 'utf8');
writeFileSync('amostra-dossie-cx.html', html); // AMOSTRA para olhar no navegador

ok(html.startsWith('<!DOCTYPE') || html.startsWith('<!doctype'), 'saiu um documento HTML');
ok(bytes > 8000 && bytes < 700_000, 'tamanho dentro do limite do endpoint', `${Math.round(bytes / 1024)} KB`);

for (const [rotulo, agulha] of [
  ['a razão social', 'Comercial Vale Verde'],
  ['o patrocinador', 'Roberto Nunes'],
  ['o papel resolvido em nome', 'Usuário-chave'],
  ['o tempo de relação por extenso', 'ano'],
  ['o rótulo "Não avaliada"', 'Não avaliada'],
  ['o aviso de documento interno', 'Documento interno'],
  ['o aviso de cadastro sem ERP', 'Sem vínculo com o ERP'],
  ['a versão na capa', 'versão 2'],
  ['as pendências dos lotes futuros', 'Saúde da carteira'],
  ['a definição de expansão', 'acréscimo de produto ou serviço']
]) {
  ok(html.includes(agulha), `o documento traz ${rotulo}`);
}

ok(!html.includes('papel_id') && !/\[object Object\]/.test(html),
  'nenhum vazamento de identificador ou objeto cru no documento');
ok(!/undefined|null,|>null</.test(html.replace(/nullable/g, '')),
  'nenhum "undefined"/"null" impresso');

// Conta sem ninguém mapeado: o documento não pode dizer que não há
// interlocutor — só que o registro está vazio.
const htmlVazio = renderizarDossieCx(montarDossieCx({
  cliente, etapa, nucleos: nucleosAtendidos, stakeholders: [], analise,
  meta: { geradoPor: 'x', provider: 'deepseek', geradoEm: agora, versao: 1 }
}));
ok(htmlVazio.includes('Nenhuma pessoa mapeada'), 'conta sem mapa gera documento mesmo assim');

// Análise minguada: seção sem conteúdo não é impressa.
const htmlSeco = renderizarDossieCx(montarDossieCx({
  cliente, etapa, nucleos: [], stakeholders,
  analise: validarAnaliseCx({ panorama: '<p>Pouco a dizer.</p>' }).analise,
  meta: { geradoPor: 'x', provider: 'deepseek', geradoEm: agora, versao: 1 }
}));
ok(!htmlSeco.includes('Riscos de relacionamento'), 'seção sem conteúdo não é impressa');
ok(htmlSeco.includes('Nenhum núcleo marcado'), 'ficha sem núcleo é dita, não omitida');

/* ========================================================================== */
console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
