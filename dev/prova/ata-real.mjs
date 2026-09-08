/**
 * Prova do parser contra a ata REAL, transcrita da captura do ERP.
 *
 * A suíte `ata.mjs` cobre o manual v2.3 como ele está escrito. Esta cobre
 * o que a realidade acrescentou — e os quatro defeitos que só apareceram
 * quando uma ata de verdade passou pelo parser.
 */
import { lerAta } from '../../functions/api/_lib/ata.js';

const HOJE = new Date('2026-09-06T12:00:00Z');
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

const ATA = [
  'Atas Formatar - Comercial',
  '03/09/26 – 10:44 – 13:55',
  'Aline, Amanda, Ana Luiza, Jair, Leopoldo, Lorena, Lucas, Pedro, Raylannder.',
  '[PARTICIPANTES CLIENTE A CONFIRMAR].',
  '',
  '1. Revisamos a carteira comercial de forma geral. Combinamos que todos revisarão seus clientes.',
  '',
  '2. O painel da cerimônia está com divergência de valores — o número exibido não bate com o relatório.',
  '',
  '3. Discutimos o cliente Túlio. Ele está apresentando resultados expressivos.',
  '',
  'Plano de ação:',
  '',
  'AÇÃO 1: Verificar com a Juliana a divergência de valores no painel da cerimônia',
  'Resp.: Pedro',
  'Prazo: 10/09/26',
  'Status: Nova'
].join('\n');

const a = lerAta(ATA, { hoje: HOJE });

console.log('\n=== O que já funcionava ===');
ok(a.cabecalho.cliente === 'Formatar', 'cliente', a.cabecalho.cliente);
ok(a.cabecalho.nucleo === 'Comercial', 'núcleo — forma a carteira', a.cabecalho.nucleo);
ok(a.cabecalho.data === '2026-09-03', 'data');
ok(a.cabecalho.duracaoMinutos === 191, 'duração', `${a.cabecalho.duracaoMinutos} min`);
ok(a.acoes.length === 1 && a.acoes[0].responsavel === 'Pedro' && a.acoes[0].prazo === '2026-09-10',
  'o plano de ação sai inteiro');

console.log('\n=== Os quatro defeitos que a ata real revelou ===');

// 1. A ata usa "1." com ponto; o manual escreve "1 " com espaço. Exigir
//    uma das formas jogava fora a hierarquia inteira da outra.
ok(a.contexto.length === 3, 'os três tópicos foram reconhecidos', `n=${a.contexto.length}`);
ok(a.contexto.every((c) => c.numero !== null),
  'com numeração — "1." com ponto agora conta',
  a.contexto.map((c) => c.numero).join(','));
ok(a.contexto.every((c) => c.nivel === 1),
  'e o ponto final não vira um nível a mais',
  a.contexto.map((c) => c.nivel).join(','));

// 2. O pior dos quatro: reportava 1 participante do cliente onde há 0, e
//    a presença do cliente é sinal do Health Score.
ok(a.cabecalho.participantesCliente.length === 0,
  '"[PARTICIPANTES CLIENTE A CONFIRMAR]" NÃO vira um participante falso',
  JSON.stringify(a.cabecalho.participantesCliente));
ok(a.avisos.some((x) => /participante do cliente/i.test(x)),
  'e a ausência é avisada, não escondida');

// 3. O ponto que fecha a frase ficava grudado no último nome.
ok(a.cabecalho.participantesFormatar.length === 9, 'nove participantes da Formatar');
ok(a.cabecalho.participantesFormatar[8] === 'Raylannder',
  'sem o ponto final grudado', `[${a.cabecalho.participantesFormatar[8]}]`);

// 4. "Plano de ação:" é linha estrutural, não conteúdo.
ok(!a.contexto.some((c) => /plano de a[çc][ãa]o/i.test(c.texto)),
  '"Plano de ação:" não vira tópico do contexto');

console.log('\n=== Variantes de escrita que a realidade produz ===');

// Cedilha e til se perdem em cópia entre editores. Recusar a ação por
// causa de um acento perderia o plano inteiro.
for (const variante of ['AÇÃO', 'ACAO', 'ACÃO', 'AÇAO', 'ação']) {
  const t = lerAta([
    'Atas Acme - ESTOQUE', '06/09/26 – 09:00 – 10:00', 'Jair', 'Ana', '',
    `${variante} 7: Fazer a coisa`, 'Status: Nova'
  ].join('\n'), { hoje: HOJE });
  ok(t.acoes.length === 1 && t.acoes[0].id === 7, `"${variante}" é reconhecido`);
}

// Rótulo com dois-pontos é removido; dois-pontos no meio de um nome não.
const comRotulo = lerAta([
  'Atas Acme - ESTOQUE', '06/09/26 – 09:00 – 10:00',
  'Formatar: Jair, Marina', 'Cliente: Ana'
].join('\n'), { hoje: HOJE });
ok(comRotulo.cabecalho.participantesFormatar.join(',') === 'Jair,Marina',
  'o rótulo "Formatar:" é removido', comRotulo.cabecalho.participantesFormatar.join(','));

// Subtópicos com ponto: "2.1." é nível 2, não 3.
const sub = lerAta([
  'Atas Acme - ESTOQUE', '06/09/26 – 09:00 – 10:00', 'Jair', 'Ana', '',
  '2.1. Ruptura caiu de 8% para 5%'
].join('\n'), { hoje: HOJE });
ok(sub.contexto[0].numero === '2.1' && sub.contexto[0].nivel === 2,
  '"2.1." é nível 2', `${sub.contexto[0].numero} / n${sub.contexto[0].nivel}`);

// A ata desta reunião é INTERNA (Formatar - Comercial). O parser não
// distingue, e não deve: quem sabe se a carteira é interna é o ERP.
ok(a.cabecalho.cliente === 'Formatar',
  'ata de carteira interna é lida como qualquer outra — quem classifica é o ERP');

console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
