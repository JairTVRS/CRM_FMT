/**
 * Prova do contrato (Lote G, 2.40.0).
 *
 * O que importa:
 *   - o valor por extenso está certo (o contrato escreve os dois);
 *   - as formas sugeridas da migração são as mesmas do código;
 *   - marcador que a proposta não preencheu IMPEDE a geração, com o nome
 *     do campo — o contrato nunca sai com "{valor_mensal}" ou em branco;
 *   - só admin altera os cadastros; inativa some das opções mas segue
 *     valendo para quem a usa; excluir com lead vinculado é recusado;
 *   - a contratada padrão não pode ser inativada nem excluída;
 *   - o contrato sai do lead + última proposta + forma + contratada, e
 *     gerar de novo cria a versão seguinte;
 *   - a proposta nova usa o km do lead e a forma de preço; a antiga fica.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { numeroPorExtenso, moedaPorExtenso, dataPorExtenso } from '../../functions/api/_lib/extenso.js';
import { FORMAS_SUGERIDAS, preencherForma, marcadoresDesconhecidos } from '../../functions/api/_lib/forma-preco.js';
import { prepararContrato } from '../../functions/api/_lib/contrato.js';
import * as cadastrosApi from '../../functions/api/contrato-cadastros.js';
import * as contratoApi from '../../functions/api/contrato.js';
import * as propostaApi from '../../functions/api/proposta.js';
import * as leadsApi from '../../functions/api/leads.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;
// O Intl põe um espaço não separável entre "R$" e o número; a prova compara com espaço comum.
const NBSP = new RegExp(String.fromCharCode(160), 'g');

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
   1. POR EXTENSO
   ========================================================================== */
console.log('\n=== 1. Por extenso ===');

const casos = [
  [880000, 'oito mil e oitocentos reais'],
  [360000, 'três mil e seiscentos reais'],
  [175, 'um real e setenta e cinco centavos'],
  [160, 'um real e sessenta centavos'],
  [2542400, 'vinte e cinco mil, quatrocentos e vinte e quatro reais'],
  [100, 'um real'],
  [5000000, 'cinquenta mil reais'],
  [100000000, 'um milhão de reais'],
  [120000000, 'um milhão e duzentos mil reais'],
  [10100, 'cento e um reais'],
  [1, 'um centavo']
];
for (const [c, esperado] of casos) {
  ok(moedaPorExtenso(c) === esperado, `${c} centavos`, moedaPorExtenso(c));
}
ok(numeroPorExtenso(24) === 'vinte e quatro', '24 meses');
ok(numeroPorExtenso(1015) === 'mil e quinze', '1015');
ok(numeroPorExtenso(21000) === 'vinte e um mil', '21000');
ok(dataPorExtenso('2026-10-05') === '5 de outubro de 2026', 'a data do contrato');

/* ==========================================================================
   2. A FORMA DE PREÇO
   ========================================================================== */
console.log('\n=== 2. A forma de preço ===');

const PROPOSTA = {
  escopo: ['comercial', 'diagnostico'],
  diagnostico: { valor: 880000, condicoes: '50% na assinatura do contrato e 50% após a apresentação', prazo: 'Entre 40 e 50 dias' },
  consultoria: { valor: 360000, meses: '24', inicio: 'Após a apresentação do diagnóstico', condicoes: 'Primeira parcela 30 dias após a apresentação do diagnóstico' },
  projeto: { valor: null, parcelas: null },
  hora: { valor: null },
  elaboradoEm: '2026-09-20'
};

const padrao = FORMAS_SUGERIDAS[0];
const cheio = preencherForma(padrao.texto, PROPOSTA);
cheio.paragrafos = cheio.paragrafos.map((p) => String(p).replace(NBSP, ' '));
ok(cheio.faltando.length === 0, 'a forma padrão, com a proposta completa, não pede nada');
ok(cheio.paragrafos.length === 2 && cheio.paragrafos[0].startsWith('A) Diagnóstico') && cheio.paragrafos[1].startsWith('B) Consultoria'),
  'uma linha em branco separa os itens', cheio.paragrafos.length);
ok(!/[{}]/.test(cheio.paragrafos.join(' ')), 'nenhum marcador sobra no texto');
ok(cheio.paragrafos[0].includes('R$ 8.800,00 (oito mil e oitocentos reais)'), 'o valor sai em número e por extenso', cheio.paragrafos[0]);
ok(cheio.paragrafos[1].includes('durante 24 (vinte e quatro) meses, com início após a apresentação'), 'meses por extenso; texto livre minúsculo no meio da frase', cheio.paragrafos[1]);

const semMensal = preencherForma(padrao.texto, { ...PROPOSTA, consultoria: { ...PROPOSTA.consultoria, valor: null } });
ok(semMensal.faltando.includes('Consultoria: valor mensal'), 'valor que falta aparece pelo nome do campo', semMensal.faltando.join(' | '));
const hora = preencherForma(FORMAS_SUGERIDAS.find((f) => f.nome === 'Valor por hora').texto, PROPOSTA);
ok(hora.faltando.length === 1 && hora.faltando[0] === 'Valor da hora', '"Valor por hora" sem o valor da hora é barrado');
ok(marcadoresDesconhecidos('{valor_mensal} e {valor_mensla}').join() === 'valor_mensla', 'marcador digitado errado é apontado');

/* ==========================================================================
   3. O BANCO E A MIGRAÇÃO 027
   ========================================================================== */
console.log('\n=== 3. A migração 027 ===');

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
bd.exec(`
  CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, documento TEXT,
    telefone TEXT, origem TEXT, observacoes TEXT, email TEXT, contato_nome TEXT, cep TEXT,
    cidade TEXT, endereco TEXT, site TEXT, instagram TEXT, ramo TEXT, segmento TEXT, resumo_ia TEXT,
    criado_por TEXT NOT NULL, criado_em TEXT NOT NULL, atualizado_por TEXT, atualizado_em TEXT,
    ativo INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, documento TEXT,
    lead_id INTEGER, etapa_id INTEGER, ativo INTEGER DEFAULT 1);
`);
for (const m of ['004-funil', '005-pipelines-classificacao', '016-funil-responsavel-perda', '006-propostas', '009-propostas-status', '027-contrato']) {
  bd.exec(readFileSync(`${RAIZ}/db/migracao-${m}.sql`, 'utf8'));
}

const doBanco = bd.prepare('SELECT nome, texto FROM formas_preco ORDER BY ordem').all();
ok(doBanco.length === FORMAS_SUGERIDAS.length, 'as 6 formas sugeridas entram', doBanco.length);
ok(doBanco.every((f, i) => f.nome === FORMAS_SUGERIDAS[i].nome && f.texto === FORMAS_SUGERIDAS[i].texto),
  'o texto da migração é o mesmo do código (forma-preco.js)',
  doBanco.filter((f, i) => f.texto !== FORMAS_SUGERIDAS[i]?.texto).map((f) => f.nome).join(', '));
const formatar = bd.prepare('SELECT * FROM contratadas').all();
ok(formatar.length === 1 && formatar[0].padrao === 1 && formatar[0].cnpj === '07091149000172',
  'a Formatar Consultoria Empresarial Ltda é a contratada padrão');

// Os INSERT OR IGNORE e CREATE IF NOT EXISTS não duplicam.
bd.exec(readFileSync(`${RAIZ}/db/migracao-027-contrato.sql`, 'utf8').split('\n').filter((l) => !/^ALTER TABLE/.test(l)).join('\n'));
ok(bd.prepare('SELECT COUNT(*) n FROM formas_preco').get().n === 6 && bd.prepare('SELECT COUNT(*) n FROM contratadas').get().n === 1,
  'reaplicar (sem os ALTER) não duplica');

/* ==========================================================================
   4. OS CADASTROS — só admin; inativar; excluir
   ========================================================================== */
console.log('\n=== 4. Os cadastros ===');

const JAIR = { email: 'jair@formatar.com.br' };
const SOCIO = { email: 'socio@formatar.com.br', grupoId: '64e678a7d2042dae072ef102' };
const cab = { 'Content-Type': 'application/json' };
const ctx = (metodo, url, corpo, usuario = SOCIO) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : { method: metodo, headers: cab, body: JSON.stringify(corpo) }),
  env: { DB },
  data: { cabecalhos: cab, usuario }
});
const ESP = (t) => String(t).replace(NBSP, ' ');
const ler = async (resposta) => {
  const r = await resposta;
  const tipo = r.headers.get('Content-Type') || '';
  return { status: r.status, corpo: tipo.includes('html') ? ESP(await r.text()) : await r.json() };
};
const CAD = (metodo, qs, corpo, usuario) => ler(cadastrosApi[`onRequest${metodo}`](ctx(metodo.toUpperCase(), `/api/contrato-cadastros?${qs}`, corpo, usuario)));

let r = await CAD('Post', 'tipo=formas', { nome: 'Teste', texto: 'A) {valor_mensal}' }, JAIR);
ok(r.status === 403 && r.corpo.code === 'SO_ADMIN', 'quem não é admin não cria forma de preço');
r = await CAD('Post', 'tipo=formas', { nome: 'Teste', texto: 'A) Mensal de {valor_mensla}' });
ok(r.status === 400 && /valor_mensla/.test(r.corpo.error), 'marcador que não existe é recusado, com o nome', r.corpo.error);
r = await CAD('Post', 'tipo=formas', { nome: 'Mensal simples', texto: 'A) Mensalidade de {valor_mensal}, por {meses} meses.' });
ok(r.status === 201 && r.corpo.registro.ativa === 1, 'admin cria a forma, ativa');
const SIMPLES = r.corpo.registro.id;
r = await CAD('Post', 'tipo=formas', { nome: 'mensal SIMPLES', texto: 'x' });
ok(r.status === 409, 'nome repetido (sem diferenciar maiúscula) é recusado');

r = await CAD('Get', 'tipo=todos');
ok(r.status === 200 && r.corpo.formas.length === 7 && r.corpo.marcadores.length === 10, 'a lista traz as formas e os 10 marcadores');

r = await CAD('Post', 'tipo=contratadas', { razao_social: 'Outra Ltda', cnpj: '11.222.333/0001-80' });
ok(r.status === 400 && /CNPJ/.test(r.corpo.error), 'CNPJ inválido é recusado');
r = await CAD('Post', 'tipo=contratadas', { razao_social: 'Outra Ltda', cnpj: '11.222.333/0001-81', representantes: [{ nome: 'Ana', cpf: '111.111.111-11' }] });
ok(r.status === 400 && /CPF/.test(r.corpo.error), 'CPF inválido de representante é recusado');
r = await CAD('Post', 'tipo=contratadas', { razao_social: 'Outra Ltda', cnpj: '11.222.333/0001-81', cidade: 'Belo Horizonte/MG', representantes: [{ nome: 'Ana Souza', cpf: '529.982.247-25', cargo: 'Sócia' }] });
ok(r.status === 201 && r.corpo.registro.representantes[0].cpf === '52998224725', 'outra contratada, com representante');
const OUTRA = r.corpo.registro.id;
const FORMATAR_ID = formatar[0].id;

r = await CAD('Put', `tipo=contratadas&id=${FORMATAR_ID}`, { ativa: 0 });
ok(r.status === 409 && r.corpo.code === 'PADRAO', 'a padrão não pode ser inativada');
r = await CAD('Delete', `tipo=contratadas&id=${FORMATAR_ID}`);
ok(r.status === 409 && r.corpo.code === 'PADRAO', 'nem excluída');
r = await CAD('Put', `tipo=contratadas&id=${OUTRA}`, { padrao: 1 });
ok(r.status === 200 && bd.prepare('SELECT id FROM contratadas WHERE padrao = 1').all().map((x) => x.id).join() === String(OUTRA), 'trocar a padrão deixa uma só');
await CAD('Put', `tipo=contratadas&id=${FORMATAR_ID}`, { padrao: 1 });

/* ==========================================================================
   5. O LEAD GUARDA O QUE O CONTRATO PEDE
   ========================================================================== */
console.log('\n=== 5. O lead ===');

const QUALIF = bd.prepare("SELECT id FROM etapas WHERE nome = 'Qualificação'").get().id;
bd.exec(`INSERT INTO leads (id, nome, documento, criado_por, criado_em, etapa_id, responsavel)
         VALUES (1, 'CEDRO MATERIAIS LTDA', '11222333000181', 'jair@formatar.com.br', '2026-09-01T10:00:00Z', ${QUALIF}, 'jair@formatar.com.br')`);
const LEADS = (metodo, qs, corpo) => ler(leadsApi[`onRequest${metodo}`](ctx(metodo.toUpperCase(), `/api/leads?${qs}`, corpo, JAIR)));
const fichaBase = {
  nome: 'CEDRO MATERIAIS LTDA', documento: '11.222.333/0001-81', etapa_id: QUALIF, responsavel: 'jair@formatar.com.br',
  endereco: 'Rua das Flores, 100 - Centro', cidade: 'Divinópolis/MG', cep: '35500-000'
};
r = await LEADS('Put', 'id=1', { ...fichaBase, rep_nome: 'Carlos Cedro', rep_cpf: '123.456.789-00' });
ok(r.status === 400 && r.corpo.code === 'REP_CPF_INVALIDO', 'CPF inválido de quem assina pelo cliente é recusado');
r = await LEADS('Put', 'id=1', {
  ...fichaBase, km_valor: '1,90', forma_preco_id: SIMPLES,
  rep_nome: 'Carlos Cedro', rep_cpf: '529.982.247-25', rep_nacionalidade: 'brasileiro', rep_estado_civil: 'casado(a)',
  rep_profissao: 'empresário', rep_residencia: 'Divinópolis/MG'
});
ok(r.status === 200 && r.corpo.lead.km_valor === 190 && r.corpo.lead.forma_preco_id === SIMPLES && r.corpo.lead.rep_cpf === '52998224725',
  'o lead guarda km, forma e quem assina', JSON.stringify({ km: r.corpo.lead.km_valor, forma: r.corpo.lead.forma_preco_id }));

r = await CAD('Delete', `tipo=formas&id=${SIMPLES}`);
ok(r.status === 409 && r.corpo.code === 'EM_USO' && /inative/i.test(r.corpo.error), 'forma vinculada a lead não se exclui; a mensagem manda inativar', r.corpo.error);
r = await CAD('Put', `tipo=formas&id=${SIMPLES}`, { ativa: 0 });
ok(r.status === 200, 'mas pode ser inativada');
r = await CAD('Get', 'tipo=todos');
const inativa = r.corpo.formas.find((f) => f.id === SIMPLES);
ok(inativa.ativa === 0 && inativa.em_uso === 1, 'inativa aparece como inativa, com o uso');
ok(bd.prepare('SELECT forma_preco_id FROM leads WHERE id = 1').get().forma_preco_id === SIMPLES, 'o lead continua com ela');
const livre = bd.prepare("SELECT id FROM formas_preco WHERE nome = 'Valor por hora'").get().id;
r = await CAD('Delete', `tipo=formas&id=${livre}`);
ok(r.status === 200 && !bd.prepare('SELECT id FROM formas_preco WHERE id = ?').get(livre), 'forma sem lead é excluída de verdade');

/* ==========================================================================
   6. A PROPOSTA NOVA: km do lead e a forma de preço
   ========================================================================== */
console.log('\n=== 6. A proposta ===');

const PROP = (corpo) => ler(propostaApi.onRequestPost(ctx('POST', '/api/proposta?lead_id=1', corpo, JAIR)));
const corpoProposta = {
  escopo: ['diagnostico', 'comercial'],
  diagnostico: { valor: '8.800,00', condicoes: '50% na assinatura e 50% na apresentação' },
  consultoria: { valor: '', meses: '24', inicio: 'Após o diagnóstico', condicoes: 'Boleto mensal' },
  km: '9,99'
};
r = await PROP(corpoProposta);
ok(r.status === 400 && r.corpo.code === 'FORMA_INCOMPLETA' && /valor mensal/.test(r.corpo.error), 'a forma usa o valor mensal e ele está vazio: barrado', r.corpo.error);
r = await PROP({ ...corpoProposta, consultoria: { ...corpoProposta.consultoria, valor: '3.600,00' } });
ok(r.status === 201 && r.corpo.versao === 1, 'com o valor, a proposta v1 sai');
const p1 = JSON.parse(bd.prepare('SELECT dados_json FROM propostas WHERE lead_id = 1 AND versao = 1').get().dados_json);
ok(p1.km === 190, 'o km da proposta é o do lead (R$ 1,90), não o que a tela mandou', p1.km);
ok(p1.forma?.nome === 'Mensal simples' && /R\$\s3\.600,00 \(três mil e seiscentos reais\)/.test(p1.forma.paragrafos[0]), 'a forma vai preenchida para a proposta');
const htmlP1 = ESP(bd.prepare('SELECT html FROM propostas WHERE lead_id = 1 AND versao = 1').get().html);
ok(htmlP1.includes('Forma de pagamento') && htmlP1.includes('R$ 1,90 por quilômetro'), 'o documento mostra a forma e o km do lead');
ok(htmlP1.includes('Av. Sete de Setembro, 1470, Apto 301, Centro — Divinópolis/MG — CEP 35500-011') && !htmlP1.includes('Rua Coronel João Notini'), 'o rodapé da proposta usa o endereço do cadastro da contratada (2.41.2)');
ok(htmlP1.includes('Formatar Consultoria Empresarial Ltda</div>'), 'e a assinatura, a razão social cadastrada');

/* ==========================================================================
   7. O CONTRATO
   ========================================================================== */
console.log('\n=== 7. O contrato ===');

const ESTADO = () => ler(contratoApi.onRequestGet(ctx('GET', '/api/contrato?lead_id=1', undefined, JAIR)));
const GERAR = () => ler(contratoApi.onRequestPost(ctx('POST', '/api/contrato?lead_id=1', {}, JAIR)));

let e = (await ESTADO()).corpo;
ok(e.faltando.length === 1 && /Formatar Consultoria Empresarial Ltda/.test(e.faltando[0]),
  'a única falta: quem assina pela contratada padrão', e.faltando.join(' | '));
r = await GERAR();
ok(r.status === 400 && r.corpo.code === 'FALTANDO', 'e a geração é recusada com a lista');

await CAD('Put', `tipo=contratadas&id=${FORMATAR_ID}`, {
  razao_social: 'Formatar Consultoria Empresarial Ltda', cnpj: '07091149000172',
  endereco: 'Av. Sete de Setembro, 1470, Apto 301, Centro', cidade: 'Divinópolis/MG', cep: '35500011',
  representantes: [{ nome: 'Sócio Um', cpf: '529.982.247-25', nacionalidade: 'brasileiro', estado_civil: 'casado(a)', cargo: 'Sócio Diretor', residencia: 'Divinópolis/MG' }]
});
e = (await ESTADO()).corpo;
ok(e.faltando.length === 0 && e.origem.proposta.versao === 1 && e.origem.forma.nome === 'Mensal simples', 'com o representante, nada falta', e.faltando.join(' | '));

r = await GERAR();
ok(r.status === 201 && r.corpo.versao === 1, 'contrato v1 gerado');
const html = (await ler(contratoApi.onRequestGet(ctx('GET', '/api/contrato?lead_id=1&html=1', undefined, JAIR)))).corpo;
ok(html.includes('<title>Contrato_Cedro-Materiais_'), 'o título é o nome do arquivo', html.match(/<title>([^<]*)/)?.[1]);
ok(html.includes('CEDRO MATERIAIS LTDA</strong>, sociedade com sede em Divinópolis/MG, à Rua das Flores, 100 - Centro, CEP 35500-000, inscrita no CNPJ sob o nº 11.222.333/0001-81'),
  'a contratante sai do lead');
ok(html.includes('neste ato representada por <strong>Carlos Cedro</strong>, brasileiro, casado(a), empresário, residente em Divinópolis/MG, CPF 529.982.247-25'),
  'quem assina pelo cliente, qualificado');
ok(html.includes('Formatar Consultoria Empresarial Ltda</strong>, sociedade com sede em Divinópolis/MG') && html.includes('07.091.149/0001-72'), 'a contratada sai do cadastro');
ok(html.indexOf('PARTE I – DIAGNÓSTICO DE GESTÃO') > 0 && html.indexOf('PARTE II – GESTÃO COMERCIAL') > html.indexOf('PARTE I –'),
  'o escopo é o da proposta, na ordem do catálogo');
ok(!html.includes('GESTÃO DE PESSOAS'), 'o que não foi proposto não entra');
ok(html.includes('A) Mensalidade de R$ 3.600,00 (três mil e seiscentos reais), por 24 (vinte e quatro) meses.'), 'a cláusula de preço é a forma preenchida');
ok(html.includes('R$ 1,90 (um real e noventa centavos) por quilômetro rodado'), 'o km do lead, por extenso');
ok(html.includes('pelo prazo de 24 (vinte e quatro) meses'), 'a vigência sai dos meses que a forma usa');
ok(html.includes('com 30 (trinta) dias de antecedência') && html.includes('o valor proporcional do mês em curso'), 'a rescisão de 2026');
ok(html.includes('a ser pago à CONTRATADA'), 'o reajuste corrigido (era "à CONTRATANTE")');
ok(html.includes('Av. Sete de Setembro, 1470, Apto 301, Centro — Divinópolis/MG — CEP 35500-011') && !html.includes('Rua Coronel João Notini'), 'o rodapé do contrato também (2.41.2)');
ok(!/[{}]/.test(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script[\s\S]*?<\/script>/g, '')), 'nenhum marcador no documento');

r = await GERAR();
ok(r.corpo.versao === 2, 'gerar de novo cria a v2');
e = (await ESTADO()).corpo;
ok(e.versoes.length === 2 && e.versoes[0].arquivo.endsWith('_v2.html') && e.versoes[0].proposta_versao === 1, 'as versões listam o arquivo e a proposta de origem', e.versoes[0].arquivo);

// Na ficha do cliente: o contrato do lead de origem.
bd.exec("INSERT INTO clientes (id, nome, lead_id) VALUES (9, 'CEDRO MATERIAIS LTDA', 1), (10, 'Sem lead', NULL)");
r = await ler(contratoApi.onRequestGet(ctx('GET', '/api/contrato?cliente_id=9', undefined, JAIR)));
ok(r.corpo.lead?.id === 1 && r.corpo.versoes.length === 2, 'o cliente vê os contratos do lead que o originou');
r = await ler(contratoApi.onRequestGet(ctx('GET', '/api/contrato?cliente_id=10', undefined, JAIR)));
ok(r.corpo.lead === null && r.corpo.versoes.length === 0, 'cliente sem lead: nada, sem erro');

// "Só diagnóstico": a vigência não pode virar 24 meses só porque a proposta nasce com "24".
const so = prepararContrato({
  lead: bd.prepare('SELECT * FROM leads WHERE id = 1').get(),
  proposta: { versao: 1, gerado_em: '2026-10-05', dados: PROPOSTA },
  forma: { id: 1, nome: 'Só diagnóstico', texto: FORMAS_SUGERIDAS[2].texto },
  contratada: { id: 1, razao_social: 'X', representantes: [{ nome: 'Y' }] },
  hoje: '2026-10-05'
});
ok(so.faltando.length === 0 && so.dados.vigenciaMeses === null, '"Só diagnóstico" vigora até concluir os trabalhos');

// Pessoa física: o próprio lead assina; nome e CPF do representante não são pedidos.
const pf = prepararContrato({
  lead: { nome: 'João da Silva', documento: '52998224725', endereco: 'Rua A, 1', cidade: 'Itaúna/MG' },
  proposta: { versao: 1, gerado_em: '2026-10-05', dados: PROPOSTA },
  forma: { id: 1, nome: 'Padrão', texto: FORMAS_SUGERIDAS[0].texto },
  contratada: { id: 1, razao_social: 'X', representantes: [{ nome: 'Y' }] },
  hoje: '2026-10-05'
});
ok(pf.faltando.length === 0 && pf.dados.contratante.pessoaFisica && pf.dados.contratante.representante.cpf === '52998224725', 'lead com CPF: a própria pessoa é a contratante');

// Sem proposta: o motivo diz onde gerar.
const semProposta = prepararContrato({ lead: { nome: 'A', documento: '11222333000181', endereco: 'x', cidade: 'y', rep_nome: 'b', rep_cpf: '52998224725' }, proposta: null, forma: null, contratada: null, hoje: '2026-10-05' });
ok(semProposta.faltando.some((f) => /Gerar proposta agora/.test(f)) && semProposta.faltando.some((f) => /forma de preço/.test(f)) && semProposta.faltando.some((f) => /contratada/.test(f)),
  'sem proposta, forma e contratada: as três faltas, cada uma com o caminho');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
