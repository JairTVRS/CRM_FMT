/**
 * Prova da v2.23.0 — a sessão, o nome do arquivo e a guarda das fontes.
 *
 * O que esta suíte protege, em uma frase cada:
 *
 *  1. Erro de PERMISSÃO DO HUB não pode derrubar a sessão do usuário.
 *  2. Erro de AUTENTICAÇÃO tem que continuar derrubando.
 *  3. O nome do arquivo sai do fantasia, curto e sem gritar.
 *  4. Item da IA que se apoia em fonte inexistente é descartado.
 *  5. "83 meses estagnado" não passa quando o CRM não sabe desde quando.
 */
import { readFileSync } from 'node:fs';
import { filtrarPorFontes } from '../../functions/api/_lib/schema-dossie-cx.js';
import { nomeDeDocumento, TIPO_DOCUMENTO } from '../../functions/api/_lib/documento-base.js';

import { fileURLToPath } from 'node:url';
const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let ok = 0, falhas = 0;

function conferir(descricao, condicao, detalhe) {
  if (condicao) { ok++; console.log(`  OK    ${descricao}`); }
  else { falhas++; console.log(` FALHA  ${descricao}${detalhe ? ` — ${detalhe}` : ''}`); }
}

/* ==========================================================================
   1. A SESSÃO

   O auth.js é script clássico dentro de uma IIFE: não dá para importar.
   A prova roda o trecho de decisão isolado, copiado do arquivo, e
   confere que o ARQUIVO ainda contém aquele trecho — se alguém mudar a
   regra lá, esta prova para de valer e diz isso.
   ========================================================================== */

const authJs = readFileSync(`${RAIZ}/public/js/auth.js`, 'utf8');

conferir(
  'auth.js declara CODIGOS_DE_SESSAO com os quatro códigos do middleware',
  ['TOKEN_AUSENTE', 'TOKEN_INVALIDO', 'SEM_CADASTRO', 'INATIVO']
    .every((c) => new RegExp(`CODIGOS_DE_SESSAO[\\s\\S]{0,200}${c}`).test(authJs))
);

conferir(
  'auth.js não derruba mais a sessão em todo 401/403',
  /const ehSessao = CODIGOS_DE_SESSAO\.has\(erro\.code\)/.test(authJs)
);

conferir(
  'o middleware ainda emite os quatro códigos que o front espera',
  ['TOKEN_AUSENTE', 'TOKEN_INVALIDO', 'SEM_CADASTRO', 'INATIVO'].every(
    (c) => readFileSync(`${RAIZ}/functions/api/_middleware.js`, 'utf8').includes(`"${c}"`)
  )
);

// A regra, reproduzida. Se o arquivo mudar, as conferências acima falham.
const CODIGOS_DE_SESSAO = new Set(['TOKEN_AUSENTE', 'TOKEN_INVALIDO', 'SEM_CADASTRO', 'INATIVO']);
const derruba = (status, code) =>
  CODIGOS_DE_SESSAO.has(code) || (status === 401 && !code);

conferir('403 HUB_SEM_PERMISSAO NÃO derruba a sessão — o bug de 07/09',
  derruba(403, 'HUB_SEM_PERMISSAO') === false);
conferir('503 HUB_SEM_PERMISSAO NÃO derruba a sessão',
  derruba(503, 'HUB_SEM_PERMISSAO') === false);
conferir('403 SEM_CADASTRO derruba', derruba(403, 'SEM_CADASTRO') === true);
conferir('403 INATIVO derruba', derruba(403, 'INATIVO') === true);
conferir('401 TOKEN_INVALIDO derruba', derruba(401, 'TOKEN_INVALIDO') === true);
conferir('401 sem código derruba — token nem chegou a ser lido',
  derruba(401, undefined) === true);
conferir('403 sem código NÃO derruba — na dúvida, o usuário fica dentro',
  derruba(403, undefined) === false);

/* ==========================================================================
   2. O SERVIDOR PAROU DE USAR 403 PARA PROBLEMA DE CHAVE
   ========================================================================== */

for (const rota of ['hub-clientes', 'plano-acao']) {
  const js = readFileSync(`${RAIZ}/functions/api/${rota}.js`, 'utf8');
  conferir(`${rota}.js: HUB_SEM_PERMISSAO responde 503, não 403`,
    /HUB_SEM_PERMISSAO' \? 503/.test(js) && !/HUB_SEM_PERMISSAO' \? 403/.test(js));
}

conferir('plano-acao.js: a resposta com várias permissões também é 503',
  !/}, 403, cabecalhos\)/.test(readFileSync(`${RAIZ}/functions/api/plano-acao.js`, 'utf8')));

/* ==========================================================================
   3. O NOME DO ARQUIVO
   ========================================================================== */

const RAZAO = 'ALPHATEX COMERCIO IMPORTAÇÃO E EXPORTAÇÃO DE TECIDOS EIRELI';

conferir('o defeito relatado: razão social longa produzia nome ilegível',
  nomeDeDocumento(TIPO_DOCUMENTO.EXPERIENCIA, RAZAO, '2026-09-07')
    !== 'Dossie_Experiencia_ALPHATEX-COMERCIO-IMPORTACAO-E_2026_09');

conferir('fantasia produz exatamente o padrão pedido',
  nomeDeDocumento(TIPO_DOCUMENTO.EXPERIENCIA, 'ALPHATEX', '2026-09-07')
    === 'Dossie_Experiencia_Alphatex_2026_09',
  nomeDeDocumento(TIPO_DOCUMENTO.EXPERIENCIA, 'ALPHATEX', '2026-09-07'));

conferir('razão social como reserva: sem conectivos, três palavras',
  nomeDeDocumento(TIPO_DOCUMENTO.EXPERIENCIA, RAZAO, '2026-09-07')
    === 'Dossie_Experiencia_Alphatex-Comercio-Importacao_2026_09',
  nomeDeDocumento(TIPO_DOCUMENTO.EXPERIENCIA, RAZAO, '2026-09-07'));

conferir('sigla curta em caixa alta é preservada — JBS não vira Jbs',
  nomeDeDocumento(TIPO_DOCUMENTO.PROPOSTA, 'JBS', '2026-09-07')
    === 'Proposta_JBS_2026_09',
  nomeDeDocumento(TIPO_DOCUMENTO.PROPOSTA, 'JBS', '2026-09-07'));

conferir('nome já capitalizado não é mexido',
  nomeDeDocumento(TIPO_DOCUMENTO.PROSPECCAO, 'Casa do Pão', '2026-09-07')
    === 'Dossie_Prospeccao_Casa-Pao_2026_09',
  nomeDeDocumento(TIPO_DOCUMENTO.PROSPECCAO, 'Casa do Pão', '2026-09-07'));

conferir('cliente sem nome não gera arquivo sem nome',
  nomeDeDocumento(TIPO_DOCUMENTO.PROPOSTA, '', '2026-09-07') === 'Proposta_Cliente_2026_09');

conferir('acento e cedilha continuam fora',
  !/[çãéíó]/i.test(nomeDeDocumento(TIPO_DOCUMENTO.EXPERIENCIA, 'AÇÚCAR UNIÃO', '2026-09-07')));

// Os três chamadores passam o fantasia na frente
for (const [arq, padrao] of [
  ['functions/api/_lib/dossie-cx-template.js', /nomeFantasia \|\| d\.conta\?\.razaoSocial/],
  ['functions/api/_lib/dossie-template.js', /e\.nomeFantasia \|\| e\.razaoSocial,/]
]) {
  conferir(`${arq.split('/').pop()} passa o fantasia primeiro`,
    padrao.test(readFileSync(`${RAIZ}/${arq}`, 'utf8')));
}

// As duas cópias do front não podem divergir da regra do servidor
for (const arq of ['public/js/dossie.js', 'public/js/dossie-cx.js']) {
  const js = readFileSync(`${RAIZ}/${arq}`, 'utf8');
  conferir(`${arq.split('/').pop()} tem a mesma regra (conectivos, 3 palavras, comoNome)`,
    js.includes('CONECTIVOS') && js.includes('slice(0, 3)') && js.includes('comoNome'));
}

conferir('dossie-cx.js usa o fantasia para o arquivo, não a razão social',
  /nomeParaArquivo\(\) \|\| 'Cliente'/.test(readFileSync(`${RAIZ}/public/js/dossie-cx.js`, 'utf8')));

conferir('clientes.js expõe o fantasia no resumo da ficha',
  /fantasia: el\('cliente-input-fantasia'\)/.test(readFileSync(`${RAIZ}/public/js/clientes.js`, 'utf8')));

/* ==========================================================================
   3b. A INSTRUCAO QUE A TELA DA

   A mensagem anterior mandava "cadastrar o escopo no Secret HUB_API_KEY
   e refazer o deploy". Errada, e custou uma ida em falso: a chave ja
   esta cadastrada e funciona -- e a mesma que lista os clientes. O que
   falta e a permissao concedida a ela no HUB.
   ========================================================================== */

const planoJs = readFileSync(`${RAIZ}/public/js/plano-acao.js`, 'utf8');

conferir('a tela nao manda mais mexer no Secret nem republicar',
  !/Cadastre o escopo no Secret/.test(planoJs) && !/refa[cç]a o deploy/i.test(planoJs));

conferir('a tela diz que a permissao e concedida NO HUB',
  /concedida a ela NO HUB/.test(planoJs));

conferir('a tela diz que a chave ja funciona, para nao parecer erro de cadastro',
  /A chave está cadastrada e funciona/.test(planoJs));

/* ==========================================================================
   4. A GUARDA — o caso real da ALPHATEX

   Os itens abaixo são TRANSCRITOS do PDF que o sistema gerou em
   07/09/2026. Não são inventados para a prova: é o texto que saiu.
   ========================================================================== */

const analiseReal = {
  panorama: 'A ALPHATEX está na etapa de Diagnóstico desde o início da jornada em setembro de 2019 (83 meses de relação).',
  mapaPoder: {
    leitura: 'O mapa de poder da ALPHATEX está vazio — nenhuma pessoa foi registrada.',
    lacunas: [
      'Nenhum contato mapeado para a ALPHATEX, o que impede a CX de identificar interlocutores-chave.',
      'Núcleos atendidos não registrados: sem informação sobre quais áreas são atendidas.'
    ]
  },
  riscos: [
    {
      risco: 'Estagnação na etapa de Diagnóstico por mais de 83 meses sem avanço registrado',
      fundamento: 'A conta está em Diagnóstico desde 2019-09-11, sem núcleos ou pessoas mapeadas.',
      confianca: 'alta'
    },
    {
      risco: 'Dependência de um único canal de contato não documentado',
      fundamento: 'Sem registro de pessoas ou reuniões, a relação pode residir em um contato não formalizado.',
      confianca: 'media'
    },
    {
      risco: 'Percepção de baixa entrega da Formatar pela ALPHATEX, dado pouco registro de interações',
      fundamento: 'A ausência de núcleos e reuniões pode indicar baixa frequência de contato.',
      confianca: 'media'
    }
  ],
  oportunidades: [
    { titulo: 'Retomar diagnóstico e ampliar escopo', descricao: 'Propor uma revisão do diagnóstico inicial.', nucleo: null }
  ],
  perguntas: [
    'Qual é o atual estágio da parceria, do ponto de vista do cliente?',
    'Quem são os principais interlocutores na ALPHATEX?'
  ],
  recomendacao: 'Mapear as pessoas envolvidas e registrar os núcleos atendidos.'
};

const guardada = filtrarPorFontes(analiseReal, {
  presentes: new Set(),
  sabeEtapaDesde: false
});

conferir('o risco dos "83 meses estagnado" é DESCARTADO',
  !guardada.analise.riscos.some((r) => /83 meses/.test(r.risco)),
  JSON.stringify(guardada.analise.riscos.map((r) => r.risco)));

conferir('o risco que cita "reuniões" é DESCARTADO — a fonte não existe',
  !guardada.analise.riscos.some((r) => /reuni/i.test(`${r.risco} ${r.fundamento}`)));

conferir('o risco de "percepção de baixa entrega" é DESCARTADO',
  !guardada.analise.riscos.some((r) => /percep/i.test(r.risco)));

conferir('os três riscos do PDF real caíram; nenhum sobrou',
  guardada.analise.riscos.length === 0, `sobraram ${guardada.analise.riscos.length}`);

conferir('a oportunidade legítima SOBREVIVE — a guarda não é uma tesoura cega',
  guardada.analise.oportunidades.length === 1);

conferir('as perguntas legítimas sobrevivem',
  guardada.analise.perguntas.length === 2);

conferir('as lacunas do mapa sobrevivem — falam do cadastro, não de fonte ausente',
  guardada.analise.mapaPoder.lacunas.length === 2);

conferir('o descarte é DECLARADO, nunca silencioso',
  guardada.avisos.some((a) => /descartados/.test(a)), JSON.stringify(guardada.avisos));

conferir('o panorama com "83 meses" vira aviso, não some',
  guardada.analise.panorama === analiseReal.panorama
    && guardada.avisos.some((a) => /panorama/.test(a)));

conferir('cada descarte diz onde estava e por quê',
  guardada.descartados.length === 3
    && guardada.descartados.every((d) => d.onde && d.motivo && d.trecho));

/* --- A guarda solta o item quando a fonte PASSA a existir -------------- */

const comAtas = filtrarPorFontes(analiseReal, {
  presentes: new Set(['reunioes']),
  sabeEtapaDesde: true
});

conferir('com as atas no CRM, o risco que cita reuniões PASSA',
  comAtas.analise.riscos.some((r) => /reuni/i.test(r.fundamento)));

conferir('sabendo o etapa_desde, o risco dos 83 meses PASSA',
  comAtas.analise.riscos.some((r) => /83 meses/.test(r.risco)));

conferir('com as duas fontes, nada é descartado',
  comAtas.descartados.length === 0);

/* --- Não descarta o que não deve --------------------------------------- */

const inocente = filtrarPorFontes({
  panorama: 'Conta na etapa de Diagnóstico, com contato principal registrado.',
  mapaPoder: { leitura: 'Duas pessoas mapeadas, uma delas patrocinadora.', lacunas: [] },
  riscos: [{ risco: 'Núcleo Financeiro sem ninguém mapeado', fundamento: 'O núcleo consta na ficha e não há pessoa vinculada a ele.', confianca: 'alta' }],
  oportunidades: [], perguntas: ['Quem responde pelo Financeiro?'], recomendacao: 'Mapear o Financeiro.'
}, { presentes: new Set(), sabeEtapaDesde: false });

conferir('análise sem fonte inexistente atravessa intacta',
  inocente.descartados.length === 0 && inocente.avisos.length === 0
    && inocente.riscos !== null && inocente.analise.riscos.length === 1);

conferir('mencionar a etapa SEM falar de tempo não é descartado',
  inocente.analise.panorama.includes('Diagnóstico'));

conferir('filtrarPorFontes aguenta análise nula',
  filtrarPorFontes(null).analise === null);

/* ==========================================================================
   5. A MIGRAÇÃO 011 E O CONTEXTO
   ========================================================================== */

const sql = readFileSync(`${RAIZ}/db/migracao-011-etapa-desde.sql`, 'utf8');

conferir('011 adiciona etapa_desde nas duas tabelas',
  /ALTER TABLE clientes ADD COLUMN etapa_desde/.test(sql)
    && /ALTER TABLE leads\s+ADD COLUMN etapa_desde/.test(sql));

conferir('011 cria os quatro gatilhos',
  (sql.match(/CREATE TRIGGER/g) || []).length === 4);

conferir('o gatilho de UPDATE compara com IS NOT — reordenar não zera a data',
  /WHEN NEW\.etapa_id IS NOT OLD\.etapa_id/.test(sql));

conferir('o gatilho de INSERT não sobrescreve valor já informado',
  /NEW\.etapa_desde IS NULL/.test(sql));

const rota = readFileSync(`${RAIZ}/functions/api/dossie-cx.js`, 'utf8');

conferir('o contexto da IA diz explicitamente quando o CRM NÃO SABE',
  /O CRM NÃO SABE/.test(rota));

conferir('o contexto proíbe somar início da jornada com etapa atual',
  /fatos SEPARADOS/.test(rota) && /Não some, não subtraia/.test(rota));

conferir('a guarda roda ANTES do teste de suficiência',
  rota.indexOf('filtrarPorFontes(') < rota.indexOf('analiseCxUtilizavel(analise)'));

conferir('o documento mostra "Nesta etapa desde", inclusive quando não sabe',
  /Nesta etapa desde/.test(readFileSync(`${RAIZ}/functions/api/_lib/dossie-cx-template.js`, 'utf8')));

conferir('a classe .ausente tem estilo — senão o "não sei" pareceria valor',
  /td\.valor \.ausente/.test(readFileSync(`${RAIZ}/functions/api/_lib/documento-base.js`, 'utf8')));

/* ---------------------------------------------------------------------- */

console.log(`\n${ok} conferências passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
