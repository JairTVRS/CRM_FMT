/**
 * Apoio de migração, uso único: converte a planilha de propostas da
 * Formatar para o modelo de importação do CRM, com a coluna CNPJ vazia.
 *
 * Por que existe: a planilha de propostas não tem CNPJ em nenhuma das
 * 26 colunas, e o CRM exige o documento para não duplicar cadastro. Em
 * vez de redigitar 98 linhas, a equipe preenche 98 células.
 *
 * NÃO é parte do app. O modelo EM BRANCO que o usuário baixa é gerado
 * pelo próprio navegador, em `public/js/importar.js` — este script só
 * existe para a carga inicial, e some depois dela.
 *
 *   node dev/gera-planilha-cnpj.mjs
 *
 * Lê  docs/Gestão de Propostas Formatar.xlsx
 * Escreve  docs/Leads-Formatar-preencher-CNPJ.xlsx
 *
 * Usa a MESMA SheetJS que o navegador carrega, baixada do mesmo CDN e
 * guardada em node_modules/.cache — para que o que este script entende
 * por "célula" seja o que o importador vai entender depois.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Barras para frente, inclusive no Windows: a SheetJS recusa caminho
// com separadores misturados na hora de gravar.
const RAIZ = fileURLToPath(new URL('../', import.meta.url))
  .replace(/\\/g, '/')
  .replace(/\/$/, '');
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const CACHE = `${RAIZ}/node_modules/.cache/xlsx.full.min.js`;

const ENTRADA = `${RAIZ}/docs/Gestão de Propostas Formatar.xlsx`;
const SAIDA = `${RAIZ}/docs/Leads-Formatar-preencher-CNPJ.xlsx`;

/* ---- a biblioteca, a mesma do navegador ---- */

if (!existsSync(CACHE)) {
  console.log('Baixando a SheetJS (uma vez)…');
  const r = await fetch(CDN);
  if (!r.ok) throw new Error(`CDN devolveu ${r.status}`);
  mkdirSync(`${RAIZ}/node_modules/.cache`, { recursive: true });
  writeFileSync(CACHE, Buffer.from(await r.arrayBuffer()));
}

// O pacote do CDN é UMD, não módulo ES — `import` não o lê.
const XLSX = createRequire(import.meta.url)(CACHE);

/* ---- de -> para ----------------------------------------------------------

   A esquerda é a coluna da planilha de propostas; a direita, a coluna do
   modelo do CRM. CNPJ fica de fora de propósito: é o que a equipe vai
   preencher. Site e Instagram não existem na origem.                       */

const DE_PARA = [
  ['Data Cadastro', 'Data Cadastro'],
  ['Quem atendeu?', 'Quem atendeu?'],
  ['Nome do cliente', 'Nome do cliente'],
  [null, 'CNPJ da Empresa'],
  ['Segmento', 'Segmento'],
  ['Cidade', 'Cidade'],
  ['Telefone de Contato', 'Telefone de Contato'],
  ['Canal', 'Canal'],
  ['Advisor', 'Advisor'],
  ['Status2', 'Status2'],
  ['Data Ultimo Contato', 'Data Ultimo Contato'],
  ['Data próximo contato', 'Data próximo contato'],
  ['Data Fechamento2', 'Data Fechamento'],
  ['Valor Proposta\r\n(Contrato Ano)', 'Valor Proposta (Contrato Ano)'],
  ['Valor Diagnóstico', 'Valor Diagnóstico'],
  [null, 'Link Site da Empresa'],
  [null, 'Link Instagram da Empresa'],
  ['Observações', 'Observações']
];

// As colunas que são data de verdade. "Data Fechamento2" NÃO entra: ela
// tem formato de data mas guarda valores de dinheiro em 37 das 98
// linhas, e por isso passa pela peneira logo abaixo.
const ANO_MINIMO = 1990;
const ANO_MAXIMO = new Date().getFullYear() + 10;

/** Devolve o texto se ele for uma data plausível; senão, vazio. */
function somenteSeForData(texto) {
  const m = String(texto || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return '';

  const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return ano >= ANO_MINIMO && ano <= ANO_MAXIMO ? texto : '';
}

/* ---- leitura ---- */

if (!existsSync(ENTRADA)) {
  console.error(`Não encontrei ${ENTRADA}`);
  process.exit(1);
}

const pasta = XLSX.read(readFileSync(ENTRADA), { type: 'buffer', cellDates: true });
const aba = pasta.Sheets['Propostas'];
if (!aba) throw new Error('aba "Propostas" não encontrada');

const matriz = XLSX.utils.sheet_to_json(aba, {
  header: 1, defval: '', raw: false, blankrows: true
});

const cabecalho = matriz[0].map((c) => String(c ?? '').trim());
const indiceDe = (titulo) => (titulo === null ? -1 : cabecalho.indexOf(titulo));

const colunaNome = indiceDe('Nome do cliente');
const colunaFechamento = indiceDe('Data Fechamento2');

/* ---- conversão ---- */

const saida = [DE_PARA.map(([, destino]) => destino)];
let descartadas = 0;
let fechamentosMantidos = 0;

for (let i = 1; i < matriz.length; i++) {
  const linha = matriz[i] || [];

  // Mesma regra do importador: sem nome não é lead, é rastro de fórmula.
  if (!String(linha[colunaNome] ?? '').trim()) { descartadas++; continue; }

  saida.push(DE_PARA.map(([origem]) => {
    const j = indiceDe(origem);
    if (j < 0) return '';

    const valor = String(linha[j] ?? '').trim();

    if (j === colunaFechamento) {
      const data = somenteSeForData(valor);
      if (data) fechamentosMantidos++;
      return data;
    }
    return valor;
  }));
}

/* ---- gravação: uma aba só, como a importação exige ---- */

const folha = XLSX.utils.aoa_to_sheet(saida);
folha['!cols'] = saida[0].map((t) => ({ wch: Math.max(14, String(t).length + 2) }));

const nova = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(nova, folha, 'Leads');

// `writeFile` não serve: este é o pacote do NAVEGADOR, onde essa função
// dispara um download em vez de gravar em disco. Geramos o buffer e
// gravamos com o fs do node.
writeFileSync(SAIDA, XLSX.write(nova, { type: 'buffer', bookType: 'xlsx' }));

console.log(`\n${SAIDA.split('/').pop()}`);
console.log(`  ${saida.length - 1} leads`);
console.log(`  ${descartadas} linha(s) de rastro descartadas`);
console.log(`  ${fechamentosMantidos} datas de fechamento mantidas, o resto era dinheiro`);
console.log('  coluna CNPJ da Empresa: vazia, para preencher');
