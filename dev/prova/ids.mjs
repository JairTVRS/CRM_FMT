/**
 * Confere que todo id procurado pelos módulos novos existe no index.html,
 * e que todo id/classe novo do HTML tem alguém que o use.
 */
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
const html = readFileSync(`${RAIZ}/public/index.html`, 'utf8');
const css = ['cx', 'dossie', 'main', 'gaveta', 'quadro', 'agenda']
  .map((f) => readFileSync(`${RAIZ}/public/assets/css/${f}.css`, 'utf8')).join('\n');

const idsNoHtml = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
let falhas = 0;

for (const arquivo of ['public/js/stakeholders.js', 'public/js/dossie-cx.js',
                       'public/js/clientes.js', 'public/js/conversao.js',
                       'public/js/plano-acao.js', 'public/js/perda.js', 'public/js/agenda.js',
                       'public/js/roteiros.js', 'public/js/novidades.js', 'public/js/gravacao.js']) {
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
  'plano-resumo', 'plano-numero', 'plano-carga', 'plano-avisos', 'filtros-linha',
  'p-rolagem', 'p-tabela', 'p-linha', 'p-texto', 'p-vazio', 'p-editor', 'p-atraso',
  'p-status', 'st-concluida', 'st-saiu_da_ata', 'p-log', 'p-rodape', 'p-log-acao',
  'p-log-lista', 'p-log-topo', 'p-log-vazio', 'p-origem',
  'c-acao', 'c-cliente', 'c-tipo', 'c-nucleo', 'c-descricao', 'c-resp', 'c-5w',
  'c-onde', 'c-tipoacao', 'c-data', 'c-status', 'c-log',
  'plano-painel', 'plano-dica', 'plano-topo-acoes', 'plano-carga-caixa', 'pn-bloco', 'pn-rosca',
  'pn-fatia', 'pn-legenda', 'pn-garg', 'pn-barra', 'pn-colunas', 'pn-col', 'pn-col-barra', 'p-ordenavel', 'p-seta',
  'btn-engrenagem', 'plano-config', 'plano-config-fundo', 'pc-topo', 'pc-corpo', 'pc-pagina', 'pc-titulo',
  'pc-restaurar', 'pc-lista', 'pc-item', 'pc-alca', 'pc-nome', 'pc-botao', 'pc-nota',
  'p-prazo-ata', 'p-tipo', 'tp-estrategica', 'c-stcliente', 'c-reuniao', 'p-stcliente', 'sc-inactive',
  'dossie-modal', 'dossie-selo-versao', 'anel-preenchimento', 'dossie-etapa-nota',
  'dossie-avisos', 'dossie-erro-codigo', 'espaco', 'hidden',
  // 2.31.0
  'config-acesso', 'motivos-lista', 'motivo-linha', 'etapa-resultado', 'perda-obs', 'celula-secundaria',
  // 2.32.0
  'agenda-barra', 'agenda-nav', 'agenda-periodo', 'agenda-aviso', 'agenda-grade', 'agenda-dia',
  'agenda-dia-topo', 'agenda-dia-lista', 'agenda-dia-vazio', 'agenda-mes-cabeca', 'agenda-item',
  'agenda-item-quando', 'agenda-item-cx', 'agenda-mais', 'agenda-lead-acoes', 'agenda-lead-lista',
  'agenda-linha', 'agenda-linha-quando', 'agenda-linha-status', 'agenda-tipo', 'so-reuniao', 'so-contato',
  'agenda-lead-nome', 'agenda-remarcar-campos', 'agenda-rodape', 'selo-sem-agenda', 'sem-agenda',
  'agenda-lead-escolha', 'agenda-lead-resultados', 'agenda-lead-opcao', 'agenda-lead-vazio',
  // 2.33.0
  'prospects-estado',
  // 2.34.0
  'ia-chaves', 'ia-linha', 'ia-linha-topo', 'ia-linha-form', 'ia-workers', 'roteiros-lista',
  'roteiro-linha', 'roteiro-linha-info', 'roteiro-linha-acoes', 'roteiro-topo', 'roteiro-meta',
  'roteiro-texto', 'agenda-roteiro',
  // 2.34.1
  'topo', 'topo-acoes', 'topo-botao', 'topo-usuario', 'topo-avatar', 'topo-menu',
  'topo-menu-quem', 'topo-menu-selo', 'topo-menu-versao', 'topo-menu-sair',
  // 2.34.2
  'versao-rodape', 'novidades-lista', 'novidade', 'novidade-topo', 'novidade-selo', 'novidade-titulo',
  // 2.35.0
  'agenda-gravacao', 'agenda-gravacao-topo', 'gravacao-opcao', 'gravacao-rotulo', 'gravacao-acoes',
  'gravacao-barra', 'gravacao-estado', 'gravacao-ponto', 'gravacao-avisos', 'gravacao-final',
  'transcricao', 'transcricao-curta', 'trecho', 'trecho-quando'
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
const ordem = ['js/cadastros.js', 'js/perda.js', 'js/agenda.js', 'js/audio-wav.js', 'js/gravacao.js', 'js/roteiros.js', 'js/leads.js', 'js/quadro.js', 'js/clientes.js', 'js/stakeholders.js',
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
  'perda.js', 'agenda.js', 'roteiros.js', 'novidades.js', 'audio-wav.js', 'gravacao.js', 'plano-acao.js', 'proposta.js', 'quadro.js', 'stakeholders.js'
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

/* ==========================================================================
   FUNCAO COM O NOME DE UM PARAMETRO DA FABRICA DO QUADRO

   Achado na 2.31.0: dentro de `Quadro.criar({ ..., aoMover })`, o arraste
   declarava `function aoMover(ev)`. A declaracao interna escondia o
   parametro, e o aviso "cartao movido" chamava o tratador do ponteiro,
   que saia no primeiro `if`. A oferta de conversao ao arrastar nunca
   disparou -- de novo sem erro nenhum, como a `registroPorId` da 2.19.0.
   ========================================================================== */

{
  const js = readFileSync(`${RAIZ}/public/js/quadro.js`, 'utf8');
  const cabeca = js.match(/function criar\(\{([\s\S]*?)\}\)\s*\{/);
  const params = cabeca
    ? [...cabeca[1].matchAll(/^\s*([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
    : [];
  const internas = new Set([...js.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]));
  const sombreados = params.filter((p) => internas.has(p));

  if (!params.length) {
    console.log(' FALHA  nao achei os parametros de Quadro.criar() para conferir');
    falhas++;
  } else if (sombreados.length) {
    console.log(` FALHA  quadro.js declara funcao com o nome de parametro da fabrica: ${sombreados.join(', ')}`);
    falhas++;
  } else {
    console.log(`  OK    nenhum dos ${params.length} parametros de Quadro.criar() e escondido por funcao interna`);
  }
}

/* ==========================================================================
   O QUE MUDOU (2.34.2)

   A lista que aparece ao clicar na versao tem que comecar pela versao do
   package.json -- senao nada aparece como "em uso", e a lista fica para
   tras sem ninguem notar.
   ========================================================================== */

{
  const pacote = JSON.parse(readFileSync(`${RAIZ}/package.json`, 'utf8'));
  const novidades = JSON.parse(readFileSync(`${RAIZ}/public/novidades.json`, 'utf8'));
  const primeira = novidades.versoes?.[0];
  const completas = (novidades.versoes || [])
    .every((v) => /^\d{2}\/\d{2}\/\d{4}$/.test(v.data) && v.titulo && v.itens?.length);
  if (primeira?.versao !== pacote.version) {
    console.log(` FALHA  novidades.json comeca em ${primeira?.versao}, mas o sistema e ${pacote.version}`);
    falhas++;
  } else if (!completas) {
    console.log(' FALHA  novidades.json tem entrada sem data dd/mm/aaaa, titulo ou itens');
    falhas++;
  } else {
    console.log(`  OK    novidades.json comeca na versao do sistema (${pacote.version})`);
  }
}

console.log(falhas === 0 ? '\nTUDO PASSOU\n' : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
