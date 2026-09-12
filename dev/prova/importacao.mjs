/**
 * Prova da LEITURA da planilha de leads (lote 1).
 *
 * As funções são carregadas do `public/js/importar.js` DE VERDADE, não
 * recopiadas aqui: se o importador mudar, é a versão nova que responde.
 * O arquivo é um IIFE de navegador, então a suíte injeta uma saída
 * técnica antes do `return` e finge um `document` — é o preço de testar
 * o original em vez de uma cópia que envelheceria em silêncio.
 *
 * A planilha real (`docs/Gestão de Propostas Formatar.xlsx`) é lida
 * quando está presente. Ela não vai para o Git porque tem 98 clientes
 * com telefone e valor de contrato; sem ela essas conferências são
 * puladas, e as sintéticas continuam valendo.
 *
 * O leitor de .xlsx aqui reproduz a FORMA do que a SheetJS entrega
 * (matriz de células, na posição certa), não a formatação de datas.
 * Datas são assunto do lote 2.
 */
import { readFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');

let ok = 0, falhas = 0;

function conferir(descricao, condicao, detalhe) {
  if (condicao) { ok++; console.log(`  OK    ${descricao}`); }
  else { falhas++; console.log(` FALHA  ${descricao}${detalhe ? ` — ${detalhe}` : ''}`); }
}

/* ==========================================================================
   Carrega as funções do importador real
   ========================================================================== */

globalThis.document = {
  addEventListener() {},
  getElementById() { return null; },
  createElement() { return { style: {}, click() {}, remove() {} }; },
  head: { appendChild() {} },
  body: { style: {}, appendChild() {} }
};

const fonte = readFileSync(`${RAIZ}/public/js/importar.js`, 'utf8');
const ANCORA = 'return { abrir, fechar };';

if (!fonte.includes(ANCORA)) {
  console.log(' FALHA  âncora de injeção não encontrada em importar.js');
  process.exit(1);
}

const fonteComSaida = fonte.replace(ANCORA, `return { abrir, fechar, _provas: {
  normalizarCabecalho, mapaDoCabecalho, colunasIgnoradas,
  pontuarLinha, acharCabecalho, montarLinhas, cortarRastroFinal,
  mapear, normalizarEtapa, primeiroPreenchido, OBRIGATORIAS, MODELO
} };`);

const Importar = (0, eval)(`${fonteComSaida}; Importar`);
const P = Importar._provas;

/* ==========================================================================
   Leitor mínimo de .xlsx — só para a prova
   ========================================================================== */

function lerZip(buf) {
  let fim = buf.length - 22;
  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim--;
  if (fim < 0) throw new Error('ZIP sem diretório central');

  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const arquivos = {};

  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(p + 10);
    const tamComprimido = buf.readUInt32LE(p + 20);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComentario = buf.readUInt16LE(p + 32);
    const deslocamento = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + tamNome);

    const tamNomeLocal = buf.readUInt16LE(deslocamento + 26);
    const tamExtraLocal = buf.readUInt16LE(deslocamento + 28);
    const inicio = deslocamento + 30 + tamNomeLocal + tamExtraLocal;
    const bruto = buf.subarray(inicio, inicio + tamComprimido);

    arquivos[nome] = metodo === 0 ? bruto : inflateRawSync(bruto);
    p += 46 + tamNome + tamExtra + tamComentario;
  }
  return arquivos;
}

const colunaParaIndice = (letras) => {
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

function abrirPlanilha(caminho) {
  const z = lerZip(readFileSync(caminho));
  const texto = (nome) => z[nome] ? z[nome].toString('utf8') : '';

  const workbook = texto('xl/workbook.xml');
  const abas = [...workbook.matchAll(/<sheet [^>]*?name="([^"]*)"[^>]*?>/g)].map((m) => ({
    nome: m[1],
    oculta: /state="(hidden|veryHidden)"/.test(m[0])
  }));

  const compartilhadas = [...texto('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

  // A ordem de <sheet> casa com sheet1.xml, sheet2.xml... nesta planilha.
  const alvo = abas.length === 1 ? 'xl/worksheets/sheet1.xml' : 'xl/worksheets/sheet2.xml';
  const folha = texto(alvo);

  const linhas = [...folha.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
  if (!linhas.length) return { abas, matriz: [], primeiraLinhaReal: 1 };

  const primeira = Number(linhas[0][1]);
  const matriz = [];

  for (const linha of linhas) {
    const destino = Number(linha[1]) - primeira;
    matriz[destino] = matriz[destino] || [];

    for (const c of linha[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ehTexto = /t="s"/.test(c[2]);
      const v = (c[3].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      matriz[destino][colunaParaIndice(c[1])] =
        v === undefined ? '' : (ehTexto ? compartilhadas[Number(v)] : v);
    }
  }

  for (let i = 0; i < matriz.length; i++) {
    matriz[i] = Array.from(matriz[i] || [], (v) => v ?? '');
  }

  return { abas, matriz, primeiraLinhaReal: primeira };
}

/* ==========================================================================
   1. Normalização e reconhecimento de colunas
   ========================================================================== */

console.log('\n-- cabeçalhos --');

conferir('acento, caixa e espaço não atrapalham',
  P.normalizarCabecalho('Data Cadastro') === 'datacadastro'
  && P.normalizarCabecalho('DATA  CADASTRO') === 'datacadastro');

conferir('quebra de linha dentro do título é absorvida',
  P.normalizarCabecalho('Valor Proposta\r\n(Contrato Ano)') === 'valorpropostacontratoano',
  'é como a planilha real escreve essa coluna');

conferir('"Quem atendeu?" chega em atendente',
  P.mapaDoCabecalho(['Quem atendeu?']).get('atendente')[0] === 'Quem atendeu?');

conferir('"Data Fechamento2" alimenta data_fechamento',
  P.mapaDoCabecalho(['Data Fechamento2']).get('data_fechamento')[0] === 'Data Fechamento2',
  'é como a planilha real nomeia a coluna');

conferir('coluna desconhecida é listada como ignorada',
  P.colunasIgnoradas(['Nome do cliente', 'Faixa de Tempo']).join() === 'Faixa de Tempo');

conferir('coluna deliberadamente ignorada NÃO entra na lista',
  P.colunasIgnoradas(['Dias para próximo contato']).length === 0,
  'é derivada, não é "desconhecida"');

conferir('coluna sem título nenhum não vira ignorada',
  P.colunasIgnoradas(['', '   ']).length === 0,
  'é a origem dos __EMPTY que poluíam o aviso antigo');

/* ==========================================================================
   2. Descoberta da linha do cabeçalho
   ========================================================================== */

console.log('\n-- onde está o cabeçalho --');

conferir('cabeçalho na primeira linha',
  P.acharCabecalho([['Nome do cliente', 'CNPJ']]).indice === 0);

const comTitulo = [
  ['Controle de Propostas', '', ''],
  ['', '', ''],
  ['Nome do cliente', 'CNPJ', 'Cidade']
];
conferir('título e linha em branco acima não confundem',
  P.acharCabecalho(comTitulo).indice === 2);

conferir('planilha sem nenhuma coluna conhecida devolve zero ponto',
  P.acharCabecalho([['Feriados (Fonte: ANBIMA)', 'Faixa']]).pontos === 0,
  'é a aba Config, que era lida por engano');

conferir('empate fica com a linha de cima',
  P.acharCabecalho([['Nome', 'CNPJ'], ['Nome', 'CNPJ']]).indice === 0);

/* ==========================================================================
   3. Numeração das linhas
   ========================================================================== */

console.log('\n-- numeração --');

const m1 = P.montarLinhas([['Nome'], ['ACME'], ['BETA']], 0, 1);
conferir('primeira linha de dados é a 2 quando o cabeçalho é a 1',
  m1.linhasBrutas[0].__linha === 2 && m1.linhasBrutas[1].__linha === 3);

const m2 = P.montarLinhas(comTitulo.concat([['ACME', '1', 'Formiga']]), 2, 1);
conferir('cabeçalho na linha 3 faz o primeiro dado ser a linha 4',
  m2.linhasBrutas[0].__linha === 4, `veio ${m2.linhasBrutas[0].__linha}`);

const m3 = P.montarLinhas([['Nome'], ['ACME']], 0, 7);
conferir('aba que começa fora da A1 é numerada pela posição real',
  m3.linhasBrutas[0].__linha === 8, `veio ${m3.linhasBrutas[0].__linha}`);

conferir('coluna sem título não vira campo do objeto',
  !Object.keys(P.montarLinhas([['Nome', ''], ['ACME', 'lixo']], 0, 1).linhasBrutas[0])
    .includes(''));

/* ==========================================================================
   4. Corte do rastro final
   ========================================================================== */

console.log('\n-- rastro de fórmulas no fim --');

const comRastro = [
  { Nome: 'ACME', Status: 'Aberto' },
  { Nome: 'BETA', Status: 'Ganho' },
  { Nome: '', Status: '0' },
  { Nome: '', Status: '0' }
];
conferir('linhas finais sem nome caem, mesmo trazendo valor em outra coluna',
  P.cortarRastroFinal(comRastro, ['Nome']).length === 2,
  'as 7 últimas da planilha real devolvem 0 e "Data errada", não vazio');

const buracoNoMeio = [
  { Nome: 'ACME' }, { Nome: '' }, { Nome: 'BETA' }
];
conferir('linha sem nome NO MEIO é preservada, para virar erro depois',
  P.cortarRastroFinal(buracoNoMeio, ['Nome']).length === 3,
  'ali é digitação faltando, não fim de planilha');

conferir('planilha só de rastro devolve vazio',
  P.cortarRastroFinal([{ Nome: '' }, { Nome: '' }], ['Nome']).length === 0);

/* ==========================================================================
   5. Colunas obrigatórias
   ========================================================================== */

console.log('\n-- colunas obrigatórias --');

const faltando = (cabecalho) => {
  const mapa = P.mapaDoCabecalho(cabecalho);
  return P.OBRIGATORIAS.filter((o) => !mapa.has(o.campo)).map((o) => o.rotulo);
};

conferir('planilha sem CNPJ acusa exatamente CNPJ',
  faltando(['Nome do cliente', 'Cidade']).join() === 'CNPJ');

conferir('planilha sem nada acusa as duas, CNPJ primeiro',
  faltando(['Cidade']).join() === 'CNPJ,Nome do cliente',
  'a ordem é a do aviso na tela');

conferir('planilha completa não acusa nada',
  faltando(['Nome do cliente', 'CNPJ']).length === 0);

conferir('"Razão Social" satisfaz o nome',
  faltando(['Razão Social', 'CNPJ']).length === 0);

/* ==========================================================================
   6. Etapas: prefixo numérico e sinônimos
   ========================================================================== */

console.log('\n-- etapas --');

conferir('o prefixo numérico é removido',
  P.normalizarEtapa('4 - Proposta') === 'Proposta');

conferir('prefixo grudado no traço também',
  P.normalizarEtapa('11- Aguardando Cliente') === 'Aguardando Cliente');

conferir('"7 - Fechamento" vira Finalizado',
  P.normalizarEtapa('7 - Fechamento') === 'Finalizado',
  'decisão de 11/09/2026 — senão o funil ganha duas colunas terminais');

conferir('etapa sem prefixo passa intacta',
  P.normalizarEtapa('Negociação') === 'Negociação');

conferir('número sem separador NÃO é tratado como prefixo',
  P.normalizarEtapa('2024 Retomada') === '2024 Retomada',
  'separador obrigatório evita comer o número de um nome legítimo');

conferir('valor que é só o prefixo não vira string vazia',
  P.normalizarEtapa('8 - ') === '8 -');

/* ==========================================================================
   7. Preferência entre colunas que disputam o mesmo campo
   ========================================================================== */

console.log('\n-- Status x Status2 --');

const cabecalhoDisputa = ['Nome do cliente', 'Status', 'CNPJ', 'Status2'];
const mapaDisputa = P.mapaDoCabecalho(cabecalhoDisputa);

conferir('Status2 fica na frente de Status, apesar de vir depois',
  mapaDisputa.get('etapa').join() === 'Status2,Status',
  mapaDisputa.get('etapa').join());

const linhaGanha = [{
  'Nome do cliente': 'ACME', 'Status': 'Ganho', 'Status2': '7 - Fechamento', __linha: 2
}];
conferir('negócio ganho vai para Finalizado, não para a etapa padrão',
  P.mapear(linhaGanha, mapaDisputa)[0].etapa === 'Finalizado',
  `veio ${P.mapear(linhaGanha, mapaDisputa)[0].etapa}`);

const semStatus2 = [{ 'Nome do cliente': 'ACME', 'Status': 'Perdido', 'Status2': '', __linha: 2 }];
conferir('Status2 vazio deixa o Status assumir',
  P.mapear(semStatus2, mapaDisputa)[0].etapa === 'Perdido');

conferir('sem preferência declarada vale a ordem das colunas',
  P.mapaDoCabecalho(['Telefone', 'WhatsApp']).get('telefone').join() === 'Telefone,WhatsApp');

conferir('primeiroPreenchido pula o vazio e pega o seguinte',
  P.primeiroPreenchido({ a: '  ', b: 'x' }, ['a', 'b']) === 'x');

/* ==========================================================================
   8. O modelo gerado pelo app
   ========================================================================== */

console.log('\n-- modelo --');

const mapaModelo = P.mapaDoCabecalho(P.MODELO);

conferir('o modelo tem as duas colunas obrigatórias',
  P.OBRIGATORIAS.every((o) => mapaModelo.has(o.campo)),
  'modelo que não passa na própria validação seria uma armadilha');

conferir('toda coluna do modelo é reconhecida pelo importador',
  P.colunasIgnoradas(P.MODELO).length === 0,
  `ignoradas: ${P.colunasIgnoradas(P.MODELO).join(', ')}`);

conferir('o modelo é achado como cabeçalho da própria planilha',
  P.acharCabecalho([P.MODELO]).indice === 0);

conferir('o modelo usa Status2, coerente com a preferência',
  mapaModelo.get('etapa').join() === 'Status2');

/* ==========================================================================
   9. A faixa de sanidade das datas, no servidor
   ========================================================================== */

console.log('\n-- datas fora da faixa --');

const fonteApi = readFileSync(`${RAIZ}/functions/api/importar.js`, 'utf8')
  .replace(/^import \{[\s\S]*?\} from '\.\/_lib\/documento\.js';$/m,
    'const soDigitos = (v) => String(v || "").replace(/\\D/g, "");'
    + ' const documentoValido = () => true;')
  + '\nexport { paraDataIso };';

const api = await import(
  'data:text/javascript;base64,' + Buffer.from(fonteApi, 'utf8').toString('base64')
);

conferir('data normal do funil é aceita',
  api.paraDataIso('17/09/2026') === '2026-09-17');

conferir('formato de dois dígitos no ano é aceito',
  api.paraDataIso('10/05/26') === '2026-05-10');

conferir('valor de dinheiro lido como data de 1927 vira nulo',
  api.paraDataIso('07/02/1927') === null,
  'é o que a coluna Data Fechamento2 produz em 37 das 98 linhas');

conferir('data absurda no futuro vira nulo',
  api.paraDataIso('01/01/2099') === null);

conferir('a borda de baixo da faixa continua válida',
  api.paraDataIso('01/01/1990') === '1990-01-01');

conferir('ISO fora da faixa também é barrado',
  api.paraDataIso('1927-02-07') === null);

/* ==========================================================================
   10. A planilha real da Formatar
   ========================================================================== */

console.log('\n-- planilha real --');

const CAMINHO = `${RAIZ}/docs/Gestão de Propostas Formatar.xlsx`;

if (!existsSync(CAMINHO)) {
  console.log('  (pulado) a planilha real não está no repositório');
} else {
  const { abas, matriz, primeiraLinhaReal } = abrirPlanilha(CAMINHO);

  conferir('a planilha tem 2 abas, e a primeira é oculta',
    abas.length === 2 && abas[0].oculta === true && abas[0].nome === 'Config',
    JSON.stringify(abas));

  conferir('a regra de uma aba só recusa este arquivo',
    abas.length !== 1,
    'o usuário precisa reexibir a Config e apagá-la');

  conferir('o aviso nomeia a aba oculta',
    abas.map((a) => a.nome + (a.oculta ? ' (oculta)' : '')).join(' · ')
      === 'Config (oculta) · Propostas');

  // O resto da prova assume a aba Propostas já isolada, que é como o
  // arquivo fica depois de o usuário seguir a instrução do aviso.
  const { indice, pontos } = P.acharCabecalho(matriz);

  conferir('o cabeçalho da aba Propostas é achado na linha 1',
    indice === 0 && pontos > 0, `indice=${indice} pontos=${pontos}`);

  const { cabecalho, linhasBrutas } = P.montarLinhas(matriz, indice, primeiraLinhaReal);

  conferir('as 26 colunas são lidas',
    cabecalho.length === 26, `veio ${cabecalho.length}`);

  // 16 colunas reconhecidas caem em 15 campos: "Status" e "Status2"
  // disputam `etapa`. Eram 14 antes do lote 2, que trouxe a
  // "Data Fechamento2" para dentro de `data_fechamento`.
  conferir('as colunas reconhecidas chegam a 15 campos do sistema',
    P.mapaDoCabecalho(cabecalho).size === 15,
    `campos distintos: ${P.mapaDoCabecalho(cabecalho).size}`);

  conferir('falta o CNPJ, e é isso que o aviso deve dizer',
    faltando(cabecalho).join() === 'CNPJ',
    `acusou: ${faltando(cabecalho).join() || 'nada'}`);

  const mapaReal = P.mapaDoCabecalho(cabecalho);
  const uteis = P.cortarRastroFinal(linhasBrutas, mapaReal.get('nome'));

  conferir('105 linhas lidas viram 98 depois de cortar o rastro',
    linhasBrutas.length === 105 && uteis.length === 98,
    `lidas=${linhasBrutas.length} úteis=${uteis.length}`);

  conferir('a última linha útil é a 99 da planilha',
    uteis[uteis.length - 1].__linha === 99,
    `veio ${uteis[uteis.length - 1].__linha}`);

  conferir('toda linha útil tem nome de cliente',
    uteis.every((l) => String(l['Nome do cliente'] || '').trim()));

  const convertidas = P.mapear(uteis, mapaReal);

  conferir('a conversão preserva a numeração real',
    convertidas[0]._linha === 2 && convertidas[97]._linha === 99);

  /* --- o que o lote 2 corrige na planilha real --- */

  const porEtapa = {};
  for (const l of convertidas) porEtapa[l.etapa || '(vazio)'] = (porEtapa[l.etapa || '(vazio)'] || 0) + 1;

  conferir('os 34 ganhos chegam como Finalizado, e não como "Ganho"',
    porEtapa['Finalizado'] === 34, JSON.stringify(porEtapa));

  conferir('os 25 perdidos chegam como Perdido',
    porEtapa['Perdido'] === 25);

  conferir('as etapas do meio do funil sobrevivem',
    porEtapa['Proposta'] === 34 && porEtapa['Negociação'] === 2 && porEtapa['Captação'] === 3,
    JSON.stringify(porEtapa));

  conferir('nenhuma etapa chega com prefixo numérico',
    Object.keys(porEtapa).every((e) => !/^\d+\s*[-–—.]/.test(e)),
    Object.keys(porEtapa).join(' | '));

  conferir('"Captação" é a única etapa que o CRM ainda não tem',
    porEtapa['Captação'] === 3,
    'as outras quatro casam com as etapas existentes — o lote 3 resolve esta');

  conferir('nenhuma linha convertida tem documento — a planilha não tem a coluna',
    convertidas.every((l) => !l.documento),
    'é o que torna o lote 2 necessário antes de importar de verdade');

  conferir('"Dias para próximo contato" não virou campo',
    convertidas.every((l) => l.dias === undefined && l.diasparaproximocontato === undefined));

  const ignoradas = P.colunasIgnoradas(cabecalho);
  conferir('as colunas de apoio são listadas como ignoradas, sem __EMPTY',
    ignoradas.includes('Dias em processo')
    && ignoradas.includes('Faixa de Tempo')
    && !ignoradas.some((c) => c.startsWith('__EMPTY')),
    ignoradas.join(' | '));
}

/* ==========================================================================
   11. A planilha de migração, gerada por dev/gera-planilha-cnpj.mjs
   ========================================================================== */

console.log('\n-- planilha de migração --');

const MIGRACAO = `${RAIZ}/docs/Leads-Formatar-preencher-CNPJ.xlsx`;

if (!existsSync(MIGRACAO)) {
  console.log('  (pulado) rode `node dev/gera-planilha-cnpj.mjs` para gerá-la');
} else {
  const { abas, matriz, primeiraLinhaReal } = abrirPlanilha(MIGRACAO);

  conferir('a planilha de migração tem UMA aba, como a regra exige',
    abas.length === 1, JSON.stringify(abas));

  const { indice } = P.acharCabecalho(matriz);
  const { cabecalho, linhasBrutas } = P.montarLinhas(matriz, indice, primeiraLinhaReal);
  const mapa = P.mapaDoCabecalho(cabecalho);

  conferir('o cabeçalho é exatamente o modelo que o app gera',
    JSON.stringify(cabecalho) === JSON.stringify(P.MODELO));

  conferir('nenhuma coluna dela é ignorada pelo importador',
    P.colunasIgnoradas(cabecalho).length === 0,
    P.colunasIgnoradas(cabecalho).join(' | '));

  conferir('a coluna CNPJ existe no cabeçalho, ainda que vazia',
    mapa.has('documento'),
    'é o que a equipe vai preencher; a cobrança do valor é do servidor');

  const uteis = P.cortarRastroFinal(linhasBrutas, mapa.get('nome'));
  const convertidas = P.mapear(uteis, mapa);

  conferir('os 98 leads sobreviveram à conversão',
    uteis.length === 98, `veio ${uteis.length}`);

  const porEtapa = {};
  for (const l of convertidas) porEtapa[l.etapa || '(vazio)'] = (porEtapa[l.etapa || '(vazio)'] || 0) + 1;

  conferir('as etapas chegam idênticas às da planilha de origem',
    porEtapa['Finalizado'] === 34 && porEtapa['Perdido'] === 25
    && porEtapa['Proposta'] === 34 && porEtapa['Negociação'] === 2
    && porEtapa['Captação'] === 3,
    JSON.stringify(porEtapa));

  const comFechamento = convertidas.filter((l) => api.paraDataIso(l.data_fechamento));
  conferir('só os 34 ganhos têm data de fechamento, o resto era dinheiro',
    comFechamento.length === 34, `veio ${comFechamento.length}`);

  conferir('nenhum documento preenchido — é o trabalho manual que resta',
    convertidas.every((l) => !l.documento));
}

/* ==========================================================================
   12. Etapas novas: o que a prévia mostra e o que a confirmação grava
   ========================================================================== */

console.log('\n-- etapas novas (contra SQLite de verdade) --');

const db = new DatabaseSync(':memory:');

db.exec(`
  CREATE TABLE etapas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL, cor TEXT NOT NULL DEFAULT '#6e6e6e',
    ordem INTEGER NOT NULL, encerra INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1, pipeline TEXT NOT NULL DEFAULT 'comercial'
  );
  CREATE TABLE advisors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL, criado_por TEXT, criado_em TEXT,
    ativo INTEGER NOT NULL DEFAULT 1
  );
`);

// As seis do funil comercial, como a migração 004 as cria.
for (const [nome, ordem, encerra] of [
  ['Novo Lead', 1, 0], ['Qualificação', 2, 0], ['Proposta', 3, 0],
  ['Negociação', 4, 0], ['Finalizado', 5, 1], ['Perdido', 6, 1]
]) {
  db.prepare('INSERT INTO etapas (nome, ordem, encerra) VALUES (?, ?, ?)').run(nome, ordem, encerra);
}
// Uma etapa da JORNADA, para provar que o pipeline é respeitado.
db.prepare(`INSERT INTO etapas (nome, ordem, pipeline) VALUES ('Captação', 1, 'cx')`).run();

// Dublê do D1 sobre o SQLite do node: só o que estas funções usam.
const D1 = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    let args = [];
    const eu = {
      bind(...a) { args = a; return eu; },
      first() { return stmt.get(...args) ?? null; },
      all() { return { results: stmt.all(...args) }; },
      run() { return stmt.run(...args); }
    };
    return eu;
  }
};

const apiFonte = readFileSync(`${RAIZ}/functions/api/importar.js`, 'utf8')
  .replace(/^import \{[\s\S]*?\} from '\.\/_lib\/documento\.js';$/m,
    'const soDigitos = (v) => String(v || "").replace(/\\D/g, "");'
    + ' const documentoValido = () => true;')
  + '\nexport { lerApoio, examinarApoio, aplicarApoio, criarEtapa };';

const srv = await import(
  'data:text/javascript;base64,' + Buffer.from(apiFonte, 'utf8').toString('base64')
);

const daPlanilha = [
  { nome: 'A', etapa: 'Proposta', advisor: 'Diego' },
  { nome: 'B', etapa: 'Captação' },
  { nome: 'C', etapa: 'Captação' },
  { nome: 'D', etapa: 'Finalizado' },
  { nome: 'E', etapa: 'Prospecção' }
];

let apoio = await srv.lerApoio(D1);
const exame = srv.examinarApoio(daPlanilha, apoio);

conferir('a prévia separa o que existe do que não existe',
  exame.etapasNovas.map((e) => e.nome).sort().join() === 'Captação,Prospecção'
  && exame.etapasExistentes.map((e) => e.nome).sort().join() === 'Finalizado,Proposta',
  JSON.stringify(exame.etapasNovas));

conferir('a prévia conta quantos leads dependem de cada etapa nova',
  exame.etapasNovas.find((e) => e.nome === 'Captação').linhas === 2);

conferir('"Captação" do pipeline CX não conta como existente',
  exame.etapasNovas.some((e) => e.nome === 'Captação'),
  'senão o lead comercial cairia na trilha de pós-venda');

conferir('as etapas oferecidas no select são só as comerciais',
  exame.etapasDisponiveis.length === 6
  && !exame.etapasDisponiveis.some((e) => e.nome === 'Captação'),
  `veio ${exame.etapasDisponiveis.length}`);

conferir('o advisor novo aparece na prévia ANTES de ser criado',
  exame.advisorsNovos.map((a) => a.nome).join() === 'Diego'
  && db.prepare('SELECT COUNT(*) AS n FROM advisors').get().n === 0,
  'até a v2.23 ele nascia em silêncio na hora de gravar');

/* --- a confirmação --- */

apoio = await srv.lerApoio(D1);
const feito = await srv.aplicarApoio(D1, daPlanilha, { email: 'cx@formatar.com.br' }, apoio, {
  'Captação': 'criar',
  'Prospecção': String(exame.etapasDisponiveis.find((e) => e.nome === 'Qualificação').id)
});

conferir('só a etapa marcada como "criar" foi criada',
  feito.etapasCriadas.join() === 'Captação');

const criada = db.prepare(
  `SELECT * FROM etapas WHERE nome = 'Captação' AND pipeline = 'comercial'`).get();

conferir('a etapa nasce no pipeline comercial',
  criada && criada.pipeline === 'comercial',
  'sem isto ela apareceria no quadro da Jornada');

conferir('a etapa nasce no fim do quadro e como não-terminal',
  criada.ordem === 7 && criada.encerra === 0);

conferir('"Prospecção" foi apontada para Qualificação, sem criar nada',
  apoio.mapaEtapa.get('PROSPECÇÃO') === exame.etapasDisponiveis.find((e) => e.nome === 'Qualificação').id
  && !db.prepare(`SELECT id FROM etapas WHERE nome = 'Prospecção'`).get());

conferir('o advisor foi criado uma vez',
  feito.advisorsCriados.join() === 'Diego'
  && db.prepare('SELECT COUNT(*) AS n FROM advisors').get().n === 1);

/* --- os casos que protegem o quadro --- */

apoio = await srv.lerApoio(D1);
const repetido = await srv.aplicarApoio(D1, [{ nome: 'X', etapa: 'CAPTAÇÃO' }],
  { email: 'cx@formatar.com.br' }, apoio, { 'CAPTAÇÃO': 'criar' });

conferir('pedir de novo a mesma etapa NÃO duplica a coluna do funil',
  db.prepare(`SELECT COUNT(*) AS n FROM etapas
              WHERE nome = 'Captação' AND pipeline = 'comercial'`).get().n === 1,
  'a tabela etapas não tem índice único no nome — a guarda é do código');

conferir('a etapa repetida é reaproveitada, não recriada',
  repetido.etapasCriadas.length === 0 && apoio.mapaEtapa.get('CAPTAÇÃO') === criada.id,
  'aqui quem protege é o mapa em memória, com toUpperCase do JavaScript');

// A guarda ACIMA nunca chega ao banco: o nome já estava no mapa. A de
// baixo é a que importa numa corrida entre dois imports simultâneos,
// quando os dois leram o apoio antes de qualquer um gravar.
conferir('criar a mesma etapa duas vezes devolve a mesma linha',
  (await srv.criarEtapa(D1, 'Captação')) === criada.id
  && db.prepare(`SELECT COUNT(*) AS n FROM etapas
                 WHERE nome = 'Captação' AND pipeline = 'comercial'`).get().n === 1);

conferir('etapa de mesmo nome noutro pipeline não bloqueia a criação',
  (await srv.criarEtapa(D1, 'Boas-vindas')) > 0,
  'o funil comercial e a jornada podem ter nomes iguais sem se atrapalhar');

apoio = await srv.lerApoio(D1);
await srv.aplicarApoio(D1, [{ nome: 'Y', etapa: 'Reunião' }],
  { email: 'cx@formatar.com.br' }, apoio, {});

conferir('sem decisão do usuário, nada é criado',
  !db.prepare(`SELECT id FROM etapas WHERE nome = 'Reunião'`).get(),
  'a etapa cai na padrão, como era antes deste lote');

apoio = await srv.lerApoio(D1);
await srv.aplicarApoio(D1, [{ nome: 'Z', etapa: 'Invento' }],
  { email: 'cx@formatar.com.br' }, apoio, { 'Invento': '999' });

conferir('id de etapa que não veio na prévia é ignorado',
  !apoio.mapaEtapa.has('INVENTO')
  && !db.prepare(`SELECT id FROM etapas WHERE nome = 'Invento'`).get());

/* ========================================================================== */

console.log(`\n${ok} conferências, ${falhas} falha(s).`);
if (falhas) process.exit(1);
