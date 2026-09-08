/**
 * Prova do parser de atas (manual v2.3).
 *
 * `hoje` é fixo em todas as contagens: prova que muda de resultado
 * conforme o dia em que roda não prova nada.
 */
import { lerAta, lerStatus, dataDaAta, diasDesde, ehNotaPrivada, resumirPlano, STATUS_ACAO } from '../../functions/api/_lib/ata.js';

const HOJE = new Date('2026-09-06T12:00:00Z');
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

/* ==========================================================================
   1. DATAS
   ========================================================================== */
console.log('\n=== 1. Datas ===');

ok(dataDaAta('06/09/26') === '2026-09-06', 'dd/mm/aa vira ISO');
ok(dataDaAta('6/9/26') === '2026-09-06', 'sem zero à esquerda também');
ok(dataDaAta('06/09/2026') === '2026-09-06', 'ano de quatro dígitos');
ok(dataDaAta('31/02/26') === null, '31 de fevereiro é recusado, não rolado para março');
ok(dataDaAta('') === null && dataDaAta(null) === null && dataDaAta('ontem') === null,
  'lixo devolve null');

ok(diasDesde('2026-06-08', HOJE) === 90, 'diasDesde conta certo', `${diasDesde('2026-06-08', HOJE)}`);
ok(diasDesde('2026-09-06', HOJE) === 0, 'hoje é zero dia');
ok(diasDesde('2026-09-20', HOJE) === -14, 'data futura é negativa');
ok(diasDesde(null) === null, 'sem data, sem contagem');

/* ==========================================================================
   2. NOTA PRIVADA — a regra que não pode falhar
   ========================================================================== */
console.log('\n=== 2. Nota privada ===');

ok(ehNotaPrivada('CLIENTE RECLAMOU DO PRAZO NA CONVERSA PARALELA'), 'caixa alta é nota privada');
ok(!ehNotaPrivada('O cliente reclamou do prazo'), 'texto normal não é');
ok(!ehNotaPrivada('1.2'), 'número não é nota privada');
ok(!ehNotaPrivada('OK'), 'sigla de duas letras não basta');
ok(ehNotaPrivada('ATENÇÃO: REVISAR'), 'acento em caixa alta continua sendo nota');
ok(!ehNotaPrivada(''), 'linha vazia não é nota');

/* ==========================================================================
   3. STATUS
   ========================================================================== */
console.log('\n=== 3. Status ===');

const s1 = lerStatus('Nova');
ok(s1.tipo === STATUS_ACAO.NOVA && s1.desde === null, 'Nova não tem data');

const s2 = lerStatus('Pendente desde 08/06/26');
ok(s2.tipo === STATUS_ACAO.PENDENTE && s2.desde === '2026-06-08', 'Pendente desde dd/mm/aa');

const s3 = lerStatus('Em andamento desde 01/09/26');
ok(s3.tipo === STATUS_ACAO.EM_ANDAMENTO && s3.desde === '2026-09-01', 'Em andamento desde');

const s4 = lerStatus('Repactuado em 20/08/26');
ok(s4.tipo === STATUS_ACAO.REPACTUADO && s4.desde === '2026-08-20', 'Repactuado em');

ok(lerStatus('EM ANDAMENTO desde 01/09/26').tipo === STATUS_ACAO.EM_ANDAMENTO,
  'caixa alta no status ainda é reconhecida');
ok(lerStatus('Concluída').tipo === STATUS_ACAO.DESCONHECIDO,
  'status fora do manual vira desconhecido em vez de chute');
ok(lerStatus('Pendente').desde === null,
  'Pendente sem data: tipo reconhecido, data nula — e quem consome sabe a diferença');

/* ==========================================================================
   4. UMA ATA COMPLETA
   ========================================================================== */
console.log('\n=== 4. Ata completa ===');

const ATA = [
  'Atas Comercial Vale Verde - LOGÍSTICA',
  '06/09/26 – 09:00 – 10:30',
  'Formatar: Jair Tavares, Marina Alves',
  'Cliente: Roberto Nunes, Tiago Nunes e Cláudia Reis',
  '',
  '1 Abertura',
  '1.1 Revisão do plano anterior',
  '1.1.1 A AÇÃO 3 foi concluída e sai do plano',
  '2 Estoque',
  '2.1 Ruptura caiu de 8% para 5%',
  '',
  'AÇÃO 1: Implantar contagem cíclica semanal no CD',
  'Resp.: Tiago Nunes',
  'Prazo: 30/09/26',
  'Status: Nova',
  '',
  'AÇÃO 2: Revisar política de estoque mínimo',
  'Resp.: Marina Alves',
  'Prazo: 15/08/26',
  'Status: Pendente desde 08/06/26',
  '',
  'AÇÃO 4: Contratar operador para o turno da noite',
  'Resp.: Roberto Nunes',
  'Prazo: 10/10/26',
  'Status: Repactuado em 20/08/26',
  '',
  'CLIENTE DEMONSTROU DESCONFORTO COM O CUSTO DA CONSULTORIA',
  'AVALIAR ABORDAGEM NA PRÓXIMA REUNIÃO'
].join('\n');

const a = lerAta(ATA, { hoje: HOJE });

ok(a.cabecalho.cliente === 'Comercial Vale Verde', 'lê o cliente', a.cabecalho.cliente);
ok(a.cabecalho.nucleo === 'LOGÍSTICA', 'lê o núcleo — é ele que forma a carteira', a.cabecalho.nucleo);
ok(a.cabecalho.data === '2026-09-06', 'lê a data');
ok(a.cabecalho.inicio === '09:00' && a.cabecalho.fim === '10:30', 'lê os horários');
ok(a.cabecalho.duracaoMinutos === 90, 'calcula a duração', `${a.cabecalho.duracaoMinutos} min`);
ok(a.cabecalho.participantesFormatar.length === 2, 'participantes da Formatar',
  a.cabecalho.participantesFormatar.join(' | '));
ok(a.cabecalho.participantesCliente.length === 3,
  'participantes do cliente, inclusive separados por " e "',
  a.cabecalho.participantesCliente.join(' | '));

// A regra que não pode falhar.
ok(a.notasPrivadas.length === 2, 'as duas notas privadas foram separadas', `n=${a.notasPrivadas.length}`);
ok(!a.contexto.some((c) => /DESCONFORTO/.test(c.texto)),
  'e NÃO vazaram para o contexto');
ok(!a.acoes.some((x) => /DESCONFORTO/.test(x.descricao)),
  'nem para o plano de ação');

ok(a.contexto.length === 5, 'os tópicos do contexto', `n=${a.contexto.length}`);
ok(a.contexto[1].numero === '1.1' && a.contexto[1].nivel === 2, 'a hierarquia é lida');
ok(a.contexto[2].nivel === 3, 'até o terceiro nível');

ok(a.acoes.length === 3, 'três ações no plano', `n=${a.acoes.length}`);
ok(a.acoes.map((x) => x.id).join(',') === '1,2,4',
  'os IDs não são renumerados — nascem e morrem com a ação', a.acoes.map((x) => x.id).join(','));

const acao2 = a.acoes.find((x) => x.id === 2);
ok(acao2.responsavel === 'Marina Alves', 'lê o responsável');
ok(acao2.prazo === '2026-08-15', 'lê o prazo');
ok(acao2.statusTipo === STATUS_ACAO.PENDENTE, 'lê o status');
ok(acao2.diasEmAberto === 90, 'conta há quanto tempo se arrasta', `${acao2.diasEmAberto} dias`);
ok(acao2.atrasada === true && acao2.diasDeAtraso === 22, 'e o atraso do prazo', `${acao2.diasDeAtraso} dias`);

const acao1 = a.acoes.find((x) => x.id === 1);
ok(acao1.diasEmAberto === null, 'ação Nova não tem "desde", então não tem idade');
ok(acao1.atrasada === false && acao1.diasDeAtraso === null,
  'prazo no futuro não vira atraso negativo');

ok(a.avisos.length === 0, 'ata no formato não gera aviso', a.avisos.join(' | '));

/* ==========================================================================
   5. OS NÚMEROS QUE O HEALTH SCORE VAI CONSUMIR
   ========================================================================== */
console.log('\n=== 5. Resumo do plano ===');

const r = a.resumo;
ok(r.total === 3, 'total de ações abertas');
ok(r.porStatus.nova === 1 && r.porStatus.pendente === 1 && r.porStatus.repactuado === 1,
  'distribuição por status');
ok(r.atrasadas === 1, 'quantas passaram do prazo', `n=${r.atrasadas}`);
ok(r.maisAntigaEmDias === 90,
  'a mais velha em aberto — média esconderia uma de dois anos entre dez novas',
  `${r.maisAntigaEmDias} dias`);
ok(r.repactuadas === 1, 'repactuações contadas');
ok(r.semPrazo === 0 && r.semResponsavel === 0, 'nada sem prazo nem sem responsável');

/* ==========================================================================
   6. ATAS QUE FOGEM DO MANUAL
   ========================================================================== */
console.log('\n=== 6. Ata malformada ===');

ok(lerAta('').avisos.length > 0, 'ata vazia avisa em vez de quebrar');
ok(lerAta(null).acoes.length === 0, 'null não derruba o parser');

const semNucleo = lerAta('Atas Acme Indústria\n06/09/26 – 09:00 – 10:00\nFormatar: Jair\nCliente: Ana',
  { hoje: HOJE });
ok(semNucleo.cabecalho.cliente === 'Acme Indústria', 'sem hífen, ainda lê o cliente');
ok(semNucleo.cabecalho.nucleo === null, 'e admite que o núcleo falta');
ok(semNucleo.avisos.some((x) => /núcleo/i.test(x)), 'avisando que a carteira fica incompleta');

const semStatus = lerAta([
  'Atas Acme - ESTOQUE',
  '06/09/26 – 09:00 – 10:00',
  'Formatar: Jair',
  'Cliente: Ana',
  '',
  'AÇÃO 1: Fazer alguma coisa',
  'Resp.: Ana'
].join('\n'), { hoje: HOJE });

ok(semStatus.acoes.length === 1, 'ação sem status ainda é lida');
ok(semStatus.avisos.some((x) => /AÇÃO 1.*Status/i.test(x)), 'mas com aviso', semStatus.avisos.join(' | '));
ok(semStatus.resumo.semPrazo === 1, 'e entra na contagem de "sem prazo"');

const repetida = lerAta([
  'Atas Acme - ESTOQUE',
  '06/09/26 – 09:00 – 10:00',
  'Formatar: Jair',
  'Cliente: Ana',
  '',
  'AÇÃO 1: Primeira',
  'Status: Nova',
  'AÇÃO 1: Segunda, com o mesmo ID',
  'Status: Nova'
].join('\n'), { hoje: HOJE });

ok(repetida.avisos.some((x) => /mais de uma vez/i.test(x)),
  'ID repetido é denunciado — o Health Score contaria a mesma ação duas vezes');

// Descrição que transborda a linha: o manual não prevê, texto de gente sim.
const transborda = lerAta([
  'Atas Acme - ESTOQUE',
  '06/09/26 – 09:00 – 10:00',
  'Formatar: Jair',
  'Cliente: Ana',
  '',
  'AÇÃO 1: Implantar o processo de contagem',
  'cíclica em todos os depósitos',
  'Resp.: Ana',
  'Status: Nova'
].join('\n'), { hoje: HOJE });

ok(/cíclica em todos os depósitos/.test(transborda.acoes[0].descricao),
  'descrição que transborda a linha é costurada',
  transborda.acoes[0].descricao);

// Word entrega \r\n. Um \r grudado quebraria toda comparação depois.
const comCrLf = lerAta('Atas Acme - ESTOQUE\r\n06/09/26 – 09:00 – 10:00\r\nFormatar: Jair\r\nCliente: Ana',
  { hoje: HOJE });
ok(comCrLf.cabecalho.nucleo === 'ESTOQUE', 'CRLF do Word não deixa resto', `[${comCrLf.cabecalho.nucleo}]`);

// Ata só com notas privadas: nada pode vazar.
const soNotas = lerAta('TUDO ISTO É NOTA PRIVADA\nE ISTO TAMBÉM', { hoje: HOJE });
ok(soNotas.contexto.length === 0 && soNotas.acoes.length === 0,
  'ata só de notas privadas não produz contexto nem plano');
ok(soNotas.notasPrivadas.length === 2, 'e as guarda no campo certo');

/* ==========================================================================
   7. RESUMO DE PLANO VAZIO
   ========================================================================== */
console.log('\n=== 7. Plano vazio ===');

const vazio = resumirPlano([]);
ok(vazio.total === 0 && vazio.maisAntigaEmDias === null,
  'plano vazio não inventa número', JSON.stringify(vazio.maisAntigaEmDias));
ok(vazio.atrasadas === 0, 'nem atraso');

console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
