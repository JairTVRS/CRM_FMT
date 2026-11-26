/**
 * Prova do questionário da página BIO (2.46.0).
 *
 * O que importa:
 *   - só entra resposta da lista; nome e WhatsApp obrigatórios; CNPJ/CPF
 *     e e-mail opcionais, mas válidos quando vêm; sem autorização, não entra;
 *   - o autônomo não responde "quantas pessoas" (vira "Apenas eu");
 *     "Somente eu" não combina com outras opções;
 *   - vira lead em "Novo Lead", sem responsável, canal "BIO (questionário)",
 *     com as respostas nas observações e no relógio da ficha;
 *   - não duplica: mesmo CNPJ/CPF ou telefone de lead ativo → anexa;
 *   - robô (campo-isca, rápido demais) recebe ok e nada é gravado;
 *     outro site é barrado; mais de 5 envios por aparelho na hora, 429;
 *   - o IP não é guardado; sem a migração 031, nada é gravado.
 * Nada aqui sai para a rede.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { onRequestPost } from '../../functions/publico/questionario.js';
import * as rotaQuestionario from '../../functions/publico/questionario.js';
import { onRequestGet as publicoGet } from '../../functions/publico/bio.js';
import {
  validarQuestionario, PERGUNTAS, DESAFIOS, CANAL_BIO, AUTOR_BIO, LIMITE_POR_HORA
} from '../../functions/api/_lib/questionario-bio.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;
function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

globalThis.fetch = async () => new Response('', { status: 500 });   // YouTube fora: a prova não sai para a rede

function d1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { return stmt.get(...args) ?? null; },
        async run() { return stmt.run(...args); },
        async all() { return { results: stmt.all(...args) }; }
      };
      return api;
    }
  };
}

// O pedaço do banco que a rota usa (colunas com os nomes das migrações 003/004/016/028).
function bancoNovo({ comMigracao = true } = {}) {
  const bd = new DatabaseSync(':memory:');
  bd.exec(`
    CREATE TABLE etapas (id INTEGER PRIMARY KEY, nome TEXT, pipeline TEXT, ordem INTEGER, ativo INTEGER);
    INSERT INTO etapas VALUES (7, 'Qualificação', 'comercial', 2, 1), (3, 'Novo Lead', 'comercial', 1, 1),
                              (1, 'Onboarding', 'cx', 0, 1), (9, 'Velha', 'comercial', 0, 0);
    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, documento TEXT, telefone TEXT, email TEXT,
      contato_nome TEXT, canal TEXT, etapa_id INTEGER, posicao INTEGER, tags TEXT, observacoes TEXT,
      data_cadastro TEXT, responsavel TEXT, criado_por TEXT, criado_em TEXT, ativo INTEGER DEFAULT 1);
    CREATE UNIQUE INDEX idx_leads_documento_unico ON leads (documento)
      WHERE ativo = 1 AND documento IS NOT NULL AND documento <> '';
    CREATE TABLE lead_eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, evento TEXT, detalhe TEXT, por TEXT, em TEXT);
  `);
  if (comMigracao) {
    const m = readFileSync(`${RAIZ}/db/migracao-031-questionario-bio.sql`, 'utf8');
    bd.exec(m);
    bd.exec(m);
  }
  return bd;
}

const RESPOSTAS = {
  q01: 'Dono, sócio ou CEO', q02: '6 a 10 pessoas', q03: 'De R$ 100 a 300 mil',
  q04: 'Já decidi resolver', q05: ['Diretoria', 'Outros sócios']
};
const envio = (extra = {}) => ({
  nome: '  Maria   Souza ', telefone: '(37) 99956-4071', email: '', documento: '',
  consentimento: true, respostas: { ...RESPOSTAS }, desafio: 'Gestão e resultados',
  site: '', t: 12000, ...extra
});
const AGORA = new Date('2026-11-26T17:32:00Z');

let bd = bancoNovo();
const enviar = async (corpo, { ip = '200.1.2.3', origem = 'https://crm-fmt.pages.dev', banco = bd, bruto } = {}) => {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (origem) headers.Origin = origem;
  const r = await onRequestPost({
    request: new Request('https://crm-fmt.pages.dev/publico/questionario', {
      method: 'POST', headers, body: bruto ?? JSON.stringify(corpo)
    }),
    env: { DB: d1(banco), SESSAO_SECRET: 'sal-de-teste' },
    agora: AGORA
  });
  return { status: r.status, corpo: await r.json() };
};
const conta = (sql, banco = bd) => banco.prepare(sql).get().n;

console.log('\n=== 1. Validação ===');
const v1 = validarQuestionario(envio());
ok(!v1.erro, 'envio completo passa', v1.erro);
ok(v1.dados?.nome === 'Maria Souza' && v1.dados.telefone === '(37) 99956-4071', 'nome sem espaços sobrando; telefone formatado');
ok(JSON.stringify(v1.dados?.respostas.find((r) => r.id === 'q05').valor) === '["Outros sócios","Diretoria"]',
  'marcadas na ordem da lista, não na do clique');
ok(v1.dados?.frente === 'Consultoria e Assessoria', 'o desafio traz a frente');
ok(validarQuestionario(envio({ telefone: '+55 37 3213-0005' })).dados?.telefone === '(37) 3213-0005', 'fixo com +55 aceito');
const recusa = (extra, campo, titulo) => {
  const v = validarQuestionario(envio(extra));
  ok(v.erro && v.campo === campo, titulo, v.erro);
};
recusa({ nome: ' ' }, 'nome', 'sem nome: recusa');
recusa({ telefone: '9999-1234' }, 'telefone', 'telefone sem DDD: recusa');
recusa({ documento: '11.222.333/0001-80' }, 'documento', 'CNPJ com dígito errado: recusa');
recusa({ email: 'maria@' }, 'email', 'e-mail quebrado: recusa');
recusa({ consentimento: 'sim' }, 'consentimento', 'sem a autorização (true de verdade): recusa');
recusa({ respostas: { ...RESPOSTAS, q03: 'Uns 50 mil' } }, 'q03', 'resposta fora da lista: recusa');
recusa({ respostas: { ...RESPOSTAS, q04: undefined } }, 'q04', 'pergunta sem resposta: recusa');
recusa({ respostas: { ...RESPOSTAS, q05: [] } }, 'q05', 'múltipla vazia: recusa');
recusa({ respostas: { ...RESPOSTAS, q05: ['Somente eu (exclusiva)', 'Diretoria'] } }, 'q05', '"Somente eu" com outra opção: recusa');
ok(validarQuestionario(envio({ documento: '11.222.333/0001-81' })).dados?.documento === '11222333000181', 'CNPJ válido entra só com dígitos');
ok(validarQuestionario(envio({ documento: '529.982.247-25' })).dados?.documento === '52998224725', 'CPF válido entra');
const aut = validarQuestionario(envio({ respostas: { ...RESPOSTAS, q01: 'Profissional autônomo', q02: 'Mais de 100 pessoas' } }));
ok(aut.dados?.respostas.find((r) => r.id === 'q02').valor[0] === 'Apenas eu', 'autônomo: "quantas pessoas" vira "Apenas eu", seja o que vier');
const aut2 = validarQuestionario(envio({ respostas: { ...RESPOSTAS, q01: 'Profissional autônomo', q02: undefined } }));
ok(!aut2.erro, 'autônomo não precisa responder a q02');
ok(validarQuestionario(envio({ desafio: 'Inventado' })).dados?.desafio === null, 'desafio fora da lista é ignorado');

console.log('\n=== 2. Vira lead no funil ===');
const e1 = await enviar(envio());
ok(e1.status === 200 && e1.corpo.ok, 'responde ok', JSON.stringify(e1.corpo));
const lead = bd.prepare('SELECT * FROM leads').get();
ok(conta('SELECT COUNT(*) n FROM leads') === 1, 'um lead criado');
ok(lead.etapa_id === 3, 'na 1ª etapa ATIVA do funil comercial ("Novo Lead")', `etapa ${lead.etapa_id}`);
ok(lead.canal === CANAL_BIO && lead.responsavel === null && lead.criado_por === AUTOR_BIO, 'canal BIO, sem responsável, criado pelo questionário');
ok(lead.nome === 'Maria Souza' && lead.contato_nome === 'Maria Souza' && lead.telefone === '(37) 99956-4071', 'nome, pessoa de contato e telefone');
ok(lead.documento === null && lead.email === null, 'sem documento e sem e-mail: ficam vazios');
ok(lead.data_cadastro === '2026-11-26' && lead.tags === '[]' && lead.ativo === 1, 'data de cadastro em Brasília, sem tags, ativo');
ok(lead.observacoes.startsWith('Questionário da BIO (26/11/2026 14:32)'), 'observações com data e hora de Brasília', lead.observacoes.split('\n')[0]);
ok(lead.observacoes.includes('Faturamento médio mensal: De R$ 100 a 300 mil')
  && lead.observacoes.includes('Quem participa da decisão: Outros sócios, Diretoria')
  && lead.observacoes.includes('Desafio escolhido na página: Gestão e resultados (Consultoria e Assessoria)'),
  'as respostas e o desafio nas observações');
const resp = bd.prepare('SELECT * FROM bio_respostas').get();
ok(resp.lead_id === lead.id && resp.situacao === 'criado' && JSON.parse(resp.respostas).length === PERGUNTAS.length,
  'o envio fica em bio_respostas, ligado ao lead');
ok(resp.ip_hash && resp.ip_hash.length === 64 && !resp.ip_hash.includes('200.1.2.3') && !JSON.stringify(resp).includes('200.1.2.3'),
  'o IP não é guardado, só o hash');
const ev = bd.prepare('SELECT * FROM lead_eventos').get();
const evd = JSON.parse(ev.detalhe);
ok(ev.evento === 'questionario_bio' && ev.lead_id === lead.id && evd.novo === true && evd.linhas.length === 6,
  'o relógio da ficha registra o questionário');

console.log('\n=== 3. Não duplica ===');
await enviar(envio({ nome: 'Maria S.', respostas: { ...RESPOSTAS, q04: 'Preciso agir com urgência' } }), { ip: '200.9.9.9' });
ok(conta('SELECT COUNT(*) n FROM leads') === 1, 'mesmo telefone: não cria outro lead');
const anexo = bd.prepare("SELECT * FROM bio_respostas WHERE situacao = 'anexado'").get();
ok(anexo?.lead_id === lead.id, 'o novo envio é anexado ao lead que já existe');
const ev2 = bd.prepare('SELECT detalhe FROM lead_eventos ORDER BY id DESC').get();
ok(JSON.parse(ev2.detalhe).novo === false && JSON.parse(ev2.detalhe).linhas.includes('Momento: Preciso agir com urgência'),
  'e aparece no relógio como nova resposta');
ok(bd.prepare('SELECT observacoes FROM leads WHERE id = ?').get(lead.id).observacoes.includes('Momento: Já decidi resolver'),
  'as observações do lead existente não são reescritas');

bd.prepare("INSERT INTO leads (nome, documento, telefone, canal, ativo) VALUES ('Alfa Ltda', '11222333000181', '(31) 3333-0000', 'Indicação', 1)").run();
await enviar(envio({ telefone: '(37) 98888-7777', documento: '11.222.333/0001-81' }), { ip: '200.9.9.10' });
const alfa = bd.prepare("SELECT id FROM leads WHERE nome = 'Alfa Ltda'").get().id;
ok(conta('SELECT COUNT(*) n FROM leads') === 2 && bd.prepare('SELECT lead_id FROM bio_respostas ORDER BY id DESC').get().lead_id === alfa,
  'mesmo CNPJ de lead ativo: anexa a ele (telefone diferente)');

bd.prepare("UPDATE leads SET ativo = 0 WHERE id = ?").run(alfa);
await enviar(envio({ telefone: '(37) 97777-6666', documento: '11.222.333/0001-81' }), { ip: '200.9.9.11' });
ok(conta("SELECT COUNT(*) n FROM leads WHERE documento = '11222333000181' AND ativo = 1") === 1,
  'CNPJ só em lead EXCLUÍDO: a pessoa pediu contato, vira lead novo');

console.log('\n=== 4. Robôs e abusos ===');
const antes = () => conta('SELECT COUNT(*) n FROM bio_respostas');
let n0 = antes();
const isca = await enviar(envio({ telefone: '(11) 91111-1111', site: 'http://spam.example' }), { ip: '10.0.0.1' });
ok(isca.status === 200 && isca.corpo.ok && antes() === n0, 'campo-isca preenchido: responde ok e não grava');
const rapido = await enviar(envio({ telefone: '(11) 91111-1112', t: 800 }), { ip: '10.0.0.1' });
ok(rapido.status === 200 && antes() === n0, 'enviado rápido demais (robô): responde ok e não grava');
const semT = await enviar(envio({ telefone: '(11) 91111-1113', t: undefined }), { ip: '10.0.0.1' });
ok(semT.status === 200 && antes() === n0, 'sem o tempo: tratado como robô');
const fora = await enviar(envio({ telefone: '(11) 91111-1114' }), { ip: '10.0.0.1', origem: 'https://golpe.example' });
ok(fora.status === 403 && antes() === n0, 'outro site: 403');
const grande = await enviar(null, { ip: '10.0.0.1', bruto: JSON.stringify(envio({ nome: 'x'.repeat(9000) })) });
ok(grande.status === 413, 'corpo grande demais: 413');
const quebrado = await enviar(null, { ip: '10.0.0.1', bruto: '{nao é json' });
ok(quebrado.status === 400, 'corpo quebrado: 400');
const invalido = await enviar(envio({ telefone: '123' }), { ip: '10.0.0.1' });
ok(invalido.status === 400 && invalido.corpo.campo === 'telefone', 'erro de preenchimento volta com o campo', invalido.corpo.error);

for (let i = 0; i < LIMITE_POR_HORA; i++) {
  await enviar(envio({ telefone: `(21) 9000${i}-0000` }), { ip: '10.0.0.2' });
}
n0 = antes();
const sexto = await enviar(envio({ telefone: '(21) 90009-9999' }), { ip: '10.0.0.2' });
ok(sexto.status === 429 && antes() === n0, `o ${LIMITE_POR_HORA + 1}º envio do mesmo aparelho na hora: 429`);
const outroIp = await enviar(envio({ telefone: '(21) 90009-9999' }), { ip: '10.0.0.3' });
ok(outroIp.status === 200 && antes() === n0 + 1, 'outro aparelho segue enviando');

console.log('\n=== 5. Sem a migração 031 ===');
const semMig = bancoNovo({ comMigracao: false });
const sm = await enviar(envio(), { banco: semMig });
ok(sm.status === 503 && sm.corpo.code === 'SEM_MIGRACAO', 'responde 503 (a página oferece o WhatsApp)');
ok(conta('SELECT COUNT(*) n FROM leads', semMig) === 0, 'e não cria lead sem onde registrar o envio');

console.log('\n=== 6. A página e a ficha ===');
const pub = await (await publicoGet({ env: { DB: d1(bancoNovo()) } })).json();
ok(Array.isArray(pub.questionario) && pub.questionario.length === 5 && pub.questionario.every((p) => !('rotulo' in p)),
  '/publico/bio entrega as 5 perguntas, sem os rótulos internos');
ok(pub.questionario[1].seAutonomo?.resposta === 'Profissional autônomo' && pub.questionario[4].exclusiva === 'Somente eu (exclusiva)',
  'com a regra do autônomo e a opção exclusiva');
ok(Object.keys(rotaQuestionario).join() === 'onRequestPost', 'a rota do questionário só aceita POST');

const html = readFileSync(`${RAIZ}/public/bio.html`, 'utf8');
const faltam = Object.entries(DESAFIOS).filter(([t, f]) => !html.includes(`texto: '${t}'`) || !html.includes(`frente: '${f}'`));
ok(faltam.length === 0, 'os desafios do servidor são os mesmos da página', faltam.map((x) => x[0]).join(', '));
ok(html.includes("fetch('/publico/questionario'") && html.includes('botaoConversa(BIO.botaoPrincipal')
  && html.includes("botaoConversa('Falar com um especialista'"), 'os dois botões abrem o questionário');
ok(/if \(editando\) return mostrarErro\('Prévia/.test(html), 'na prévia do CRM o envio fica desligado');
ok(!/innerHTML\s*=/.test(html.slice(html.indexOf('function criarQuestionario'), html.indexOf('function montar('))),
  'o questionário não usa innerHTML (texto sempre por textContent)');
const hist = readFileSync(`${RAIZ}/public/js/lead-historico.js`, 'utf8');
ok(hist.includes("case 'questionario_bio'"), 'o relógio da ficha sabe mostrar o questionário');
const leadsJs = readFileSync(`${RAIZ}/public/js/leads.js`, 'utf8');
ok(/selCanal\.add\(new Option\(canal, canal\)\)/.test(leadsJs), 'a ficha não apaga canal fora da lista (BIO, ERP)');

// A coluna "Criado em" na lista de leads: o cabeçalho e as células batem.
const indexHtml = readFileSync(`${RAIZ}/public/index.html`, 'utf8');
const cabecalho = indexHtml.slice(indexHtml.indexOf('<div id="view-tabela">'), indexHtml.indexOf('id="table-leads-body"'));
const colunas = (cabecalho.match(/<th\b/g) || []).length;
const celulas = (leadsJs.slice(leadsJs.indexOf('function linha(lead)'), leadsJs.indexOf('</tr>`;', leadsJs.indexOf('function linha(lead)'))).match(/<td\b/g) || []).length;
ok(cabecalho.includes('<th>Criado em</th>') && colunas === celulas, 'lista de leads com a coluna "Criado em"; cabeçalho e linha com o mesmo número de colunas', `${colunas} × ${celulas}`);
const tabelaLeads = indexHtml.slice(indexHtml.indexOf('<div id="view-tabela">'), indexHtml.indexOf('</table>', indexHtml.indexOf('<div id="view-tabela">')));
ok(!/colspan="(?!10")\d+" class="leads-vazio"/.test(leadsJs + tabelaLeads) && colunas === 10, 'as mensagens de lista vazia ocupam as 10 colunas');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO PASSOU');
process.exit(falhas ? 1 : 0);
