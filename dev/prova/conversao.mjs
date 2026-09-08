/**
 * Prova da conversão de lead em cliente.
 *
 * Chama os handlers de verdade — `onRequestGet` e `onRequestPost` do
 * `functions/api/conversao.js` — com um contexto falso e um D1 falso
 * sobre SQLite em memória. Testar as auxiliares provaria menos.
 */
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet, onRequestPost } from '../../functions/api/conversao.js';

let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

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

const bd = new DatabaseSync(':memory:');
const DB = d1(bd);
const usuario = { email: 'jair@formatar.com.br' };

const contexto = (url, corpo) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
    : {}),
  env: { DB },
  data: { cabecalhos: { 'Content-Type': 'application/json' }, usuario }
});

const GET = async (url) => {
  const r = await onRequestGet(contexto(url));
  return { status: r.status, corpo: await r.json() };
};

const POST = async (url, corpo = {}) => {
  const r = await onRequestPost(contexto(url, corpo));
  return { status: r.status, corpo: await r.json() };
};

/* ==========================================================================
   ESQUEMA
   ========================================================================== */

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
                         erp_id INTEGER, lead_id INTEGER, criado_por TEXT, criado_em TEXT,
                         atualizado_por TEXT, atualizado_em TEXT, ativo INTEGER DEFAULT 1);
  CREATE UNIQUE INDEX idx_clientes_documento ON clientes (documento) WHERE ativo = 1;

  INSERT INTO etapas (id, nome, ordem, encerra, pipeline) VALUES
    (1, 'Qualificação', 1, 0, 'comercial'),
    (5, 'Finalizado', 5, 1, 'comercial'),
    (10, 'Implantação', 1, 0, 'jornada'),
    (11, 'Em operação', 2, 0, 'jornada');

  INSERT INTO leads (id, nome, documento, telefone, email, contato_nome, cidade, classificacao, etapa_id) VALUES
    (1, 'Formatar Consultoria', '07091149000172', '37991752215', 'jair@formatar.com.br', 'Jair Tavares', 'Divinópolis', 4, 5),
    (2, 'Lead Sem Documento', NULL, NULL, NULL, NULL, NULL, NULL, 5),
    (3, 'Pessoa Física', '11459150600', NULL, NULL, NULL, NULL, NULL, 5),
    (4, 'Ainda Qualificando', '19131243000197', NULL, NULL, NULL, NULL, 2, 1),
    (5, 'Mesmo CNPJ da Formatar', '07091149000172', NULL, NULL, NULL, NULL, NULL, 5);
`);

/* ==========================================================================
   1. O GET — o que a tela precisa saber
   ========================================================================== */
console.log('\n=== 1. Consulta antes de oferecer ===');

const inexistente = await GET('/api/conversao?lead_id=999');
ok(inexistente.status === 404, 'lead inexistente devolve 404', `status=${inexistente.status}`);

const semParam = await GET('/api/conversao');
ok(semParam.status === 400 && semParam.corpo.code === 'LEAD_OBRIGATORIO',
  'sem lead_id, recusa dizendo qual parâmetro falta');

const pronto = await GET('/api/conversao?lead_id=1');
ok(pronto.corpo.pode === true, 'lead finalizado com CNPJ pode converter');
ok(pronto.corpo.etapaAtual?.encerra === true, 'a tela sabe que a etapa é de encerramento');
ok(pronto.corpo.sugestao?.nome === 'Formatar Consultoria'
  && pronto.corpo.sugestao?.classificacao === 4
  && pronto.corpo.sugestao?.contato_nome === 'Jair Tavares',
  'a sugestão herda o que o funil já sabia — não se redigita',
  JSON.stringify(pronto.corpo.sugestao));

const semDoc = await GET('/api/conversao?lead_id=2');
ok(semDoc.corpo.pode === false && semDoc.corpo.impedimento.code === 'SEM_DOCUMENTO',
  'lead sem CNPJ não converte, e a mensagem diz o que fazer',
  semDoc.corpo.impedimento?.mensagem);

// CPF cai aqui de propósito: cliente de CX é a empresa contratante, e um
// cliente com CPF nunca seria encontrado no ERP.
const cpf = await GET('/api/conversao?lead_id=3');
ok(cpf.corpo.impedimento?.code === 'DOCUMENTO_NAO_E_CNPJ',
  'CPF é recusado — cliente de CX é empresa contratante');

// Converter fora de "Finalizado" é permitido: a tela apenas avisa que o
// normal é converter ao finalizar. Barrar impediria corrigir um lead que
// foi finalizado e voltou.
const foraDoFim = await GET('/api/conversao?lead_id=4');
ok(foraDoFim.corpo.pode === true && foraDoFim.corpo.etapaAtual?.encerra === false,
  'lead fora da etapa de encerramento pode converter, mas a tela sabe avisar');

/* ==========================================================================
   2. O POST — a conversão
   ========================================================================== */
console.log('\n=== 2. Conversão ===');

const feita = await POST('/api/conversao?lead_id=1', {
  nome_fantasia: 'Formatar',
  etapa_id: 11,
  nucleos: [3, 3, 7, 0, -1],
  data_inicio: '2025-03-10',
  observacoes: 'Convertido na estreia da tela.'
});

ok(feita.status === 201 && feita.corpo.ok, 'converte', `status=${feita.status}`);

const c = feita.corpo.cliente;
ok(c.lead_id === 1, 'o vínculo com o lead é gravado', `lead_id=${c.lead_id}`);
ok(c.erp_id === null, 'erp_id nasce NULO — a trava do ERP depende da chave do hub');
ok(c.documento === '07091149000172', 'o CNPJ vem do lead, já limpo');
ok(c.nome === 'Formatar Consultoria', 'a razão social é herdada quando não vem no corpo');
ok(c.nome_fantasia === 'Formatar', 'o nome fantasia veio da tela');
ok(c.classificacao === 4, 'a classificação 1–6 é herdada, não redigitada');
ok(c.telefone === '37991752215' && c.contato_nome === 'Jair Tavares',
  'contato e telefone são herdados');
ok(c.etapa_id === 11, 'entra na etapa da jornada escolhida', `etapa_id=${c.etapa_id}`);
ok(c.data_inicio === '2025-03-10', 'a data de início é a informada');
ok(c.nucleos === '[3,7]', 'núcleos: repetidos e inválidos são descartados', c.nucleos);

/* --- não converte duas vezes --- */
console.log('\n--- travas ---');

const denovo = await POST('/api/conversao?lead_id=1', {});
ok(denovo.status === 409 && denovo.corpo.code === 'JA_CONVERTIDO',
  'o mesmo lead não vira dois clientes', denovo.corpo.error);
ok(denovo.corpo.cliente?.id === c.id, 'e a resposta diz qual cliente ele já é');

const depois = await GET('/api/conversao?lead_id=1');
ok(depois.corpo.impedimento?.code === 'JA_CONVERTIDO',
  'a ficha do lead passa a mostrar que ele já é cliente');

// Outro lead, mesmo CNPJ: o índice único é a defesa real.
const mesmoCnpj = await GET('/api/conversao?lead_id=5');
ok(mesmoCnpj.corpo.impedimento?.code === 'CNPJ_JA_E_CLIENTE',
  'outro lead com o mesmo CNPJ é barrado antes de tentar');

const mesmoCnpjPost = await POST('/api/conversao?lead_id=5', {});
ok(mesmoCnpjPost.status === 409, 'e barrado também na gravação, não só na tela');

const total = bd.prepare('SELECT COUNT(*) AS n FROM clientes').get();
ok(total.n === 1, 'nenhuma tentativa recusada criou cliente', `n=${total.n}`);

/* --- etapa de outro pipeline --- */
console.log('\n--- etapa de outro pipeline ---');

const comEtapaErrada = await POST('/api/conversao?lead_id=4', { etapa_id: 5 });
ok(comEtapaErrada.status === 201, 'converte mesmo com etapa inválida');
ok(comEtapaErrada.corpo.cliente.etapa_id === 10,
  'etapa do funil COMERCIAL é recusada e cai na primeira da jornada',
  `etapa_id=${comEtapaErrada.corpo.cliente.etapa_id}`);
ok(comEtapaErrada.corpo.cliente.data_inicio === new Date().toISOString().slice(0, 10),
  'sem data informada, a relação começa hoje');
ok(comEtapaErrada.corpo.cliente.nucleos === '[]', 'sem núcleos marcados, fica lista vazia');

/* --- lead inativo --- */
bd.exec('UPDATE leads SET ativo = 0 WHERE id = 2');
const inativo = await GET('/api/conversao?lead_id=2');
ok(inativo.status === 404, 'lead inativo não é convertível', `status=${inativo.status}`);

/* ==========================================================================
   3. O QUE A JORNADA PASSA A MOSTRAR
   ========================================================================== */
console.log('\n=== 3. A Jornada deixa de estar vazia ===');

const naJornada = bd.prepare(
  `SELECT c.nome, c.erp_id, e.nome AS etapa
     FROM clientes c LEFT JOIN etapas e ON e.id = c.etapa_id
    WHERE c.ativo = 1 ORDER BY c.id`
).all();

ok(naJornada.length === 2, 'os dois convertidos aparecem', `n=${naJornada.length}`);
ok(naJornada.every((x) => x.erp_id === null),
  'os dois nascem sem ERP — cadastro não conferido, que é diferente de fora do ERP');
ok(naJornada[0].etapa === 'Em operação' && naJornada[1].etapa === 'Implantação',
  'cada um na etapa da jornada certa',
  naJornada.map((x) => `${x.nome}: ${x.etapa}`).join(' | '));

console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
