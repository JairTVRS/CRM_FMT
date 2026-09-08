/**
 * Confere que todo id procurado pelos módulos novos existe no index.html,
 * e que todo id/classe novo do HTML tem alguém que o use.
 */
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
const html = readFileSync(`${RAIZ}/public/index.html`, 'utf8');
const css = ['cx', 'dossie', 'main', 'gaveta', 'quadro']
  .map((f) => readFileSync(`${RAIZ}/public/assets/css/${f}.css`, 'utf8')).join('\n');

const idsNoHtml = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
let falhas = 0;

for (const arquivo of ['public/js/stakeholders.js', 'public/js/dossie-cx.js',
                       'public/js/clientes.js', 'public/js/conversao.js',
                       'public/js/plano-acao.js']) {
  const js = readFileSync(`${RAIZ}/${arquivo}`, 'utf8');
  const procurados = new Set([...js.matchAll(/\bel\('([^']+)'\)/g)].map((m) => m[1]));

  const faltando = [...procurados].filter((id) => !idsNoHtml.has(id));
  if (faltando.length) {
    console.log(` FALHA  ${arquivo} procura ids que não existem: ${faltando.join(', ')}`);
    falhas++;
  } else {
    console.log(`  OK    ${arquivo} — ${procurados.size} ids, todos presentes no HTML`);
  }
}

// As classes novas que o JS gera ou o HTML usa precisam ter estilo.
// `cli-tab-content` fica de fora de propósito: como a `.tab-content` do
// modal de lead, é só gancho de JS — quem a esconde é a `.hidden`.
const classes = [
  'cli-tab-btn', 'pessoas-lista', 'pessoa-cartao', 'pessoa-topo',
  'pessoa-nome', 'pessoa-selo', 'pessoa-linha', 'pessoa-contato', 'pessoa-obs',
  'pessoa-marcas', 'pessoa-marca', 'pessoa-form', 'pessoa-form-acoes',
  'campo-com-botao', 'dossie-cx-resumo', 'dossie-cx-versoes', 'dossie-cx-versao',
  'resumo-alerta', 'resumo-nota', 'coluna-vazia', 'tags-vazio', 'tag-chip',
  'chip-nucleo', 'campo-informativo', 'ajuda-campo', 'secao-cadastro',
  'marca-influencia-alta', 'marca-postura-resistente', 'marca-postura-desconhecida',
  'plano-resumo', 'plano-numero', 'plano-cartao', 'plano-oque', 'plano-marca',
  'plano-5w2h', 'w-campo', 'w-rotulo', 'w-valor', 'plano-form', 'plano-mudou',
  'plano-avisos', 'filtros-linha', 'plano-lista', 'marca-atraso', 'marca-falta',
  'plano-time',
  'dossie-modal', 'dossie-selo-versao', 'anel-preenchimento', 'dossie-etapa-nota',
  'dossie-avisos', 'dossie-erro-codigo', 'espaco', 'hidden'
];

const semEstilo = classes.filter((c) => !new RegExp(`\\.${c}\\b`).test(css));
if (semEstilo.length) {
  console.log(` FALHA  classes sem estilo: ${semEstilo.join(', ')}`);
  falhas++;
} else {
  console.log(`  OK    as ${classes.length} classes usadas têm estilo definido`);
}

// Os scripts novos estão no index.html, na ordem certa?
// O conversao.js precisa vir depois do quadro.js e do clientes.js: é
// acionado pelo quadro do funil e recarrega a Jornada ao converter.
const ordem = ['js/quadro.js', 'js/clientes.js', 'js/stakeholders.js',
               'js/dossie-cx.js', 'js/conversao.js',
               'js/plano-acao.js'].map((s) => html.indexOf(s));

if (ordem.some((i) => i < 0) || ordem.some((v, i) => i > 0 && ordem[i - 1] > v)) {
  console.log(` FALHA  ordem dos <script>: ${JSON.stringify(ordem)}`);
  falhas++;
} else {
  console.log('  OK    a ordem de carga dos scripts respeita as dependências');
}

// O modal de conversão existe e tem os elementos que o JS procura?
for (const id of ['modal-conversao', 'conversao-impedimento', 'conversao-formulario',
                  'lead-conversao', 'btn-converter-cliente', 'btn-abrir-cliente']) {
  if (!idsNoHtml.has(id)) {
    console.log(` FALHA  o index.html não tem #${id}`);
    falhas++;
  }
}
console.log('  OK    o modal de conversão e o bloco da ficha estão no HTML');

/* ==========================================================================
   FUNCAO DECLARADA DUAS VEZES NO MESMO ARQUIVO

   Em JavaScript a ultima declaracao vence, silenciosamente. Foi assim que
   a v2.19.0 quebrou o clique no cartao do quadro: uma segunda
   `registroPorId` foi declarada mais abaixo, com comparacao estrita entre
   numero e string, e substituiu a que funcionava. Nada avisou -- nem
   sintaxe, nem teste, nem o navegador.
   ========================================================================== */

const ARQUIVOS_JS = [
  'app.js', 'auth.js', 'cadastros.js', 'clientes.js', 'configuracoes.js',
  'conversao.js', 'dossie.js', 'dossie-cx.js', 'importar.js', 'leads.js',
  'plano-acao.js', 'proposta.js', 'quadro.js', 'stakeholders.js'
];

/* Duplicatas LEGITIMAS: mesmo nome, escopos diferentes.
   No quadro.js, `renderizar` e `iniciar` existem uma vez dentro da IIFE
   `Etapas` e outra dentro da fabrica `criar()` -- sao dois modulos
   distintos no mesmo arquivo, e nao se enxergam. Estao aqui para que
   qualquer duplicata NOVA falhe em vez de se esconder no meio delas. */
const CONHECIDAS = {
  'quadro.js': ['renderizar', 'iniciar']
};

let duplicadas = 0;
for (const arquivo of ARQUIVOS_JS) {
  const js = readFileSync(`${RAIZ}/public/js/${arquivo}`, 'utf8');
  const nomes = [...js.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);

  const contagem = new Map();
  nomes.forEach((n) => contagem.set(n, (contagem.get(n) || 0) + 1));
  const repetidas = [...contagem]
    .filter(([, n]) => n > 1)
    .map(([nome]) => nome)
    .filter((nome) => !(CONHECIDAS[arquivo] || []).includes(nome));

  if (repetidas.length) {
    console.log(` FALHA  ${arquivo} declara duas vezes: ${repetidas.join(', ')}`);
    duplicadas++;
    falhas++;
  }
}
if (duplicadas === 0) {
  console.log(`  OK    nenhum dos ${ARQUIVOS_JS.length} arquivos declara a mesma funcao duas vezes`);
}

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
