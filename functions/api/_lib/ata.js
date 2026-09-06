/**
 * _lib/ata.js — o parser das atas da Formatar (manual v2.3, jun/26).
 *
 * A ata inteira vive no campo `notes` da reunião, no ERP. O formato do
 * manual é rígido o bastante para ser lido por expressão regular, e é
 * isso que este arquivo faz.
 *
 * POR QUE NÃO USAR IA AQUI
 *
 * O plano de ação é matéria-prima do Health Score: quantas ações estão
 * abertas, há quanto tempo, quantas foram repactuadas. Isso é contagem,
 * e contagem tem resposta certa. Pedir a um modelo seria trocar uma
 * resposta exata por uma provável — e número errado num indicador de
 * saúde desmoraliza o indicador inteiro.
 *
 * A IA continua tendo lugar na trilha de CX: ela interpreta a relação no
 * Dossiê de Experiência. Ler estrutura de texto regular não é
 * interpretação.
 *
 * A REGRA MAIS IMPORTANTE DESTE ARQUIVO
 *
 * As linhas finais em CAIXA ALTA são **notas privadas do consultor** e
 * NUNCA podem chegar ao cliente. O parser as separa em campo próprio, e
 * quem consumir o resultado precisa tratá-las como o que são. Misturá-las
 * ao contexto seria o tipo de vazamento que não tem desfazer.
 *
 * O QUE O PARSER NÃO FAZ
 *
 * Não corrige ata malformada nem adivinha o que faltou. Onde o texto foge
 * do manual, ele registra um aviso e segue — a ata continua sendo o que o
 * consultor escreveu, e o CRM não é dono dela.
 */

/* ==========================================================================
   ESTADOS DA AÇÃO (manual v2.3)

   Concluída e cancelada NÃO aparecem no plano: saem dele e ficam
   registradas só no contexto. Por isso não há status para elas aqui —
   uma ação que sumiu do plano foi encerrada, e é assim que se sabe.
   ========================================================================== */

export const STATUS_ACAO = {
  NOVA: 'nova',
  PENDENTE: 'pendente',
  EM_ANDAMENTO: 'em_andamento',
  REPACTUADO: 'repactuado',
  DESCONHECIDO: 'desconhecido'
};

export const ROTULO_STATUS = {
  nova: 'Nova',
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  repactuado: 'Repactuado',
  desconhecido: 'Não reconhecido'
};

/* ==========================================================================
   UTILIDADES
   ========================================================================== */

/**
 * `dd/mm/aa` ou `dd/mm/aaaa` para ISO.
 *
 * O ano de dois dígitos vira 20xx. A ata é documento de trabalho do
 * presente; interpretar "24" como 1924 seria absurdo, e o manual usa
 * dois dígitos em toda parte.
 */
export function dataDaAta(valor) {
  const m = String(valor || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;

  const [, d, mes, a] = m;
  const ano = a.length === 2 ? `20${a}` : a;
  const iso = `${ano}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;

  // Rejeita 31/02: o construtor de Date aceitaria e rolaria para março.
  const teste = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(teste.getTime())) return null;
  if (teste.getUTCDate() !== Number(d) || teste.getUTCMonth() + 1 !== Number(mes)) return null;

  return iso;
}

/** Dias inteiros entre uma data ISO e hoje. Negativo se for futuro. */
export function diasDesde(iso, hoje = new Date()) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;

  const base = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  return Math.round((base - d.getTime()) / 86400000);
}

/**
 * Uma linha é nota privada quando é toda em CAIXA ALTA.
 *
 * "Toda em caixa alta" precisa de cuidado: uma linha só com números,
 * pontuação ou siglas (`1.2`, `CNPJ`, `OK`) não é prova de nada. Exigimos
 * ao menos três letras e que nenhuma delas seja minúscula.
 */
export function ehNotaPrivada(linha) {
  const t = String(linha || '').trim();
  if (!t) return false;

  const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letras.length < 3) return false;

  return letras === letras.toUpperCase();
}

/* ==========================================================================
   CABEÇALHO — as quatro primeiras linhas
   ========================================================================== */

/**
 * `Atas <Cliente> - <NÚCLEO>`
 *
 * O núcleo é o que vem depois do hífen, e é ele que forma a **carteira**
 * junto com o cliente. O separador aceita hífen simples e travessão
 * porque editor de texto troca um pelo outro sozinho.
 */
function lerTitulo(linha) {
  const t = String(linha || '').trim();
  const m = t.match(/^atas?\s+(.+?)\s+[-–—]\s+(.+)$/i);

  if (!m) {
    // Sem o hífen ainda dá para aproveitar o cliente. Carteira sem núcleo
    // é carteira incompleta, não ata inválida.
    const semNucleo = t.match(/^atas?\s+(.+)$/i);
    return semNucleo
      ? { cliente: semNucleo[1].trim(), nucleo: null }
      : { cliente: null, nucleo: null };
  }

  return { cliente: m[1].trim(), nucleo: m[2].trim() };
}

/** `dd/mm/aa – HH:MM – HH:MM` */
function lerDataHora(linha) {
  const t = String(linha || '').trim();
  const m = t.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–—]\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);

  if (!m) {
    const soData = t.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    return { data: soData ? dataDaAta(soData[1]) : null, inicio: null, fim: null };
  }

  return { data: dataDaAta(m[1]), inicio: m[2], fim: m[3] };
}

/**
 * Marcações de que a lista ainda não foi preenchida.
 *
 * A ata real traz `[PARTICIPANTES CLIENTE A CONFIRMAR].` na linha dos
 * participantes do cliente. Tratar isso como um nome produziria "1
 * participante" onde há zero — e a presença do cliente nas reuniões é
 * sinal do Health Score, então o número falso contaminaria o indicador.
 */
const RE_A_CONFIRMAR = /\b(a\s+confirmar|a\s+definir|n[aã]o\s+informad|pendente)\b/i;

/** Nomes separados por vírgula, ponto-e-vírgula ou " e ". */
function lerParticipantes(linha) {
  // Só tira o rótulo quando ele é curto ("Formatar:", "Cliente:"). Um
  // dois-pontos no meio de um nome não pode decapitar a lista.
  let t = String(linha || '').trim().replace(/^[^:]{0,20}:\s*/, '');
  if (!t) return [];

  // `[PARTICIPANTES A CONFIRMAR]` e parentes: lista vazia, não nome falso.
  const semColchetes = t.replace(/^\[|\]\.?$/g, '').trim();
  if (RE_A_CONFIRMAR.test(semColchetes)) return [];

  return t
    .split(/[,;]|\s+e\s+/i)
    // O ponto que fecha a frase fica grudado no último nome.
    .map((n) => n.trim().replace(/[.;]+$/, '').trim())
    .filter((n) => n.length > 1);
}

/** Minutos entre HH:MM e HH:MM. Reunião que cruza a meia-noite não existe. */
function duracaoEmMinutos(inicio, fim) {
  const p = (h) => {
    const m = String(h || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

  const a = p(inicio);
  const b = p(fim);
  if (a == null || b == null || b < a) return null;
  return b - a;
}

/* ==========================================================================
   PLANO DE AÇÃO
   ========================================================================== */

/* `AÇÃO`, `ACAO`, `ACÃO`, `AÇAO`: o texto passa por editores e cópias, e
   a cedilha e o til se perdem pelo caminho. Recusar a ação por causa de
   um acento seria perder o plano inteiro por um detalhe de digitação. */
const RE_ACAO = /^\s*A[ÇC][ÃA]O\s+(\d+)\s*:\s*(.*)$/i;

/* A linha que anuncia o plano. O parser não precisa dela para achar as
   ações, mas precisa não confundi-la com um tópico do contexto. */
const RE_ABRE_PLANO = /^\s*plano\s+de\s+a[çc][ãa]o\s*:?\s*$/i;
const RE_RESP = /^\s*resp\.?\s*:\s*(.*)$/i;
const RE_PRAZO = /^\s*prazo\s*:\s*(.*)$/i;
const RE_STATUS = /^\s*status\s*:\s*(.*)$/i;

/**
 * Interpreta o texto do status.
 *
 * O manual define quatro formas, três delas com data:
 *   Nova
 *   Pendente desde dd/mm/aa
 *   Em andamento desde dd/mm/aa
 *   Repactuado em dd/mm/aa
 *
 * A data é o que permite medir há quanto tempo a ação se arrasta — o
 * sinal mais útil que a ata dá ao Health Score. Sem ela, o tipo é
 * reconhecido mas `desde` fica nulo, e quem consome precisa saber a
 * diferença entre "há 90 dias" e "não dá para saber".
 */
export function lerStatus(texto) {
  const t = String(texto || '').trim();
  if (!t) return { tipo: STATUS_ACAO.DESCONHECIDO, desde: null, bruto: t };

  const semAcento = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dataNoTexto = t.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const desde = dataNoTexto ? dataDaAta(dataNoTexto[1]) : null;

  if (/^nova\b/.test(semAcento)) return { tipo: STATUS_ACAO.NOVA, desde: null, bruto: t };
  if (/^pendente\b/.test(semAcento)) return { tipo: STATUS_ACAO.PENDENTE, desde, bruto: t };
  if (/^em\s+andamento\b/.test(semAcento)) return { tipo: STATUS_ACAO.EM_ANDAMENTO, desde, bruto: t };
  if (/^repactuad/.test(semAcento)) return { tipo: STATUS_ACAO.REPACTUADO, desde, bruto: t };

  return { tipo: STATUS_ACAO.DESCONHECIDO, desde: null, bruto: t };
}

/* ==========================================================================
   O PARSER
   ========================================================================== */

/**
 * Lê uma ata inteira.
 *
 * @param {string} texto  o conteúdo do campo `notes` da reunião
 * @param {object} opcoes `hoje` permite prova determinística
 *
 * @returns {{
 *   cabecalho: object, contexto: Array, acoes: Array,
 *   notasPrivadas: string[], avisos: string[], resumo: object
 * }}
 */
export function lerAta(texto, { hoje = new Date() } = {}) {
  const avisos = [];

  const bruto = String(texto || '');
  if (!bruto.trim()) {
    return vazio(['A ata está vazia.']);
  }

  // \r\n do Word, \n do resto. Normalizar aqui evita um `\r` grudado no
  // fim de cada campo, que quebraria toda comparação depois.
  const linhas = bruto.replace(/\r\n?/g, '\n').split('\n');

  /* ---------------- Notas privadas ----------------
     Vêm no FIM do documento, então varremos de trás para frente e
     paramos na primeira linha que não é nota. Procurar em qualquer lugar
     transformaria um título em caixa alta no meio do texto em "nota
     privada" e o esconderia do cliente sem ninguém pedir. */
  const notasPrivadas = [];
  let ultima = linhas.length - 1;

  while (ultima >= 0) {
    const l = linhas[ultima].trim();
    if (!l) { ultima--; continue; }
    if (!ehNotaPrivada(l)) break;
    notasPrivadas.unshift(l);
    ultima--;
  }

  const corpo = linhas.slice(0, ultima + 1);

  /* ---------------- Cabeçalho ---------------- */
  const naoVazias = corpo.map((l, i) => ({ l: l.trim(), i })).filter((x) => x.l);

  // As notas já encontradas vão junto: elas foram lidas antes desta
  // saída, e descartá-las perderia o que o consultor escreveu.
  if (naoVazias.length === 0) {
    return vazio(['A ata não tem conteúdo além das notas privadas.'], notasPrivadas);
  }

  const titulo = lerTitulo(naoVazias[0]?.l);
  const dataHora = lerDataHora(naoVazias[1]?.l);

  if (!titulo.cliente) avisos.push('Não foi possível ler o cliente na primeira linha.');
  if (!titulo.nucleo) avisos.push('A primeira linha não traz o núcleo depois do hífen — a carteira fica incompleta.');
  if (!dataHora.data) avisos.push('Não foi possível ler a data da reunião na segunda linha.');

  const participantesFormatar = lerParticipantes(naoVazias[2]?.l);
  const participantesCliente = lerParticipantes(naoVazias[3]?.l);

  if (participantesCliente.length === 0) {
    avisos.push('Nenhum participante do cliente identificado na quarta linha.');
  }

  // Onde o cabeçalho acaba, no índice do texto original.
  const fimCabecalho = naoVazias[3] ? naoVazias[3].i : (naoVazias[naoVazias.length - 1]?.i ?? 0);

  /* ---------------- Contexto e plano ---------------- */
  const contexto = [];
  const acoes = [];
  let atual = null;

  const fecharAcao = () => {
    if (!atual) return;
    if (!atual.status) {
      avisos.push(`A AÇÃO ${atual.id} não tem Status.`);
    }
    acoes.push(atual);
    atual = null;
  };

  for (let i = fimCabecalho + 1; i < corpo.length; i++) {
    const linha = corpo[i];
    const t = linha.trim();
    if (!t) continue;

    const acao = t.match(RE_ACAO);
    if (acao) {
      fecharAcao();
      atual = {
        id: Number(acao[1]),
        descricao: acao[2].trim(),
        responsavel: null,
        prazo: null,
        prazoBruto: null,
        status: null
      };
      continue;
    }

    if (atual) {
      const resp = t.match(RE_RESP);
      if (resp) { atual.responsavel = resp[1].trim() || null; continue; }

      const prazo = t.match(RE_PRAZO);
      if (prazo) {
        atual.prazoBruto = prazo[1].trim() || null;
        atual.prazo = dataDaAta(atual.prazoBruto);
        continue;
      }

      const status = t.match(RE_STATUS);
      if (status) { atual.status = lerStatus(status[1]); continue; }

      // Linha solta depois de uma ação: continuação da descrição. O
      // manual não prevê, mas texto de gente transborda a linha.
      atual.descricao = `${atual.descricao} ${t}`.trim();
      continue;
    }

    // Linha estrutural que só anuncia o plano. Não é conteúdo, e deixá-la
    // no contexto poria um "Plano de ação:" solto no meio dos tópicos.
    if (RE_ABRE_PLANO.test(t)) continue;

    // Tópico numerado hierárquico. Aceita `1`, `1.`, `1.1` e `1.1.` — a
    // ata real usa ponto depois do número, e o manual escreve sem. Exigir
    // uma das duas formas jogaria fora a hierarquia inteira da outra.
    const topico = t.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)$/);
    if (topico) {
      // O ponto final de "1." não conta como nível: "1." é nível 1, não 2.
      const numero = topico[1].replace(/\.$/, '');
      contexto.push({
        numero,
        nivel: numero.split('.').length,
        texto: topico[2].trim()
      });
      continue;
    }

    // Texto sem numeração no corpo: guardado como nível 0, para não
    // sumir. Descartar seria perder conteúdo que o consultor escreveu.
    contexto.push({ numero: null, nivel: 0, texto: t });
  }

  fecharAcao();

  /* ---------------- IDs repetidos ----------------
     O manual diz que IDs nascem e morrem com a ação e nunca são
     reciclados. Repetição na mesma ata é erro de escrita, e o Health
     Score contaria a mesma ação duas vezes. */
  const vistos = new Set();
  for (const a of acoes) {
    if (vistos.has(a.id)) avisos.push(`A AÇÃO ${a.id} aparece mais de uma vez.`);
    vistos.add(a.id);
  }

  const cabecalho = {
    cliente: titulo.cliente,
    nucleo: titulo.nucleo,
    data: dataHora.data,
    inicio: dataHora.inicio,
    fim: dataHora.fim,
    duracaoMinutos: duracaoEmMinutos(dataHora.inicio, dataHora.fim),
    participantesFormatar,
    participantesCliente
  };

  return {
    cabecalho,
    contexto,
    acoes: acoes.map((a) => enriquecerAcao(a, hoje)),
    notasPrivadas,
    avisos,
    resumo: resumirPlano(acoes, hoje)
  };
}

/**
 * Acrescenta o que se calcula, não o que se lê.
 *
 * `diasEmAberto` conta desde a data do status, não desde o prazo: o que
 * interessa ao Health Score é há quanto tempo a ação se arrasta, e uma
 * ação repactuada ontem não está velha, por mais antigo que fosse o
 * prazo original.
 */
function enriquecerAcao(a, hoje) {
  const dias = a.status?.desde ? diasDesde(a.status.desde, hoje) : null;
  const diasDeAtraso = a.prazo ? diasDesde(a.prazo, hoje) : null;

  return {
    ...a,
    statusTipo: a.status?.tipo || STATUS_ACAO.DESCONHECIDO,
    statusDesde: a.status?.desde || null,
    diasEmAberto: dias,
    // Só é atraso quando o prazo já passou. Prazo futuro devolve nulo em
    // vez de número negativo: "atraso de -5 dias" não quer dizer nada.
    diasDeAtraso: diasDeAtraso != null && diasDeAtraso > 0 ? diasDeAtraso : null,
    atrasada: diasDeAtraso != null && diasDeAtraso > 0
  };
}

/**
 * Os números do plano. Aritmética em código, nunca no modelo.
 *
 * Estes são os sinais que o Lote M vai consumir para a Saúde da carteira.
 */
export function resumirPlano(acoes, hoje = new Date()) {
  const lista = (acoes || []).map((a) => (a.statusTipo ? a : enriquecerAcao(a, hoje)));

  const porStatus = Object.values(STATUS_ACAO).reduce((acc, s) => {
    acc[s] = lista.filter((a) => a.statusTipo === s).length;
    return acc;
  }, {});

  const abertasComData = lista.filter((a) => a.diasEmAberto != null);

  return {
    total: lista.length,
    porStatus,

    atrasadas: lista.filter((a) => a.atrasada).length,
    semPrazo: lista.filter((a) => !a.prazo).length,
    semResponsavel: lista.filter((a) => !a.responsavel).length,

    // O sinal mais direto de conta arrastando: a ação mais velha em
    // aberto. Média esconderia uma ação de dois anos no meio de dez novas.
    maisAntigaEmDias: abertasComData.length
      ? Math.max(...abertasComData.map((a) => a.diasEmAberto))
      : null,

    // Repactuação é reprogramação combinada, não abandono — mas repetida
    // vira sinal. Quem interpreta é o Lote M; aqui só se conta.
    repactuadas: porStatus[STATUS_ACAO.REPACTUADO] || 0
  };
}

function vazio(avisos, notasPrivadas = []) {
  return {
    cabecalho: {
      cliente: null, nucleo: null, data: null, inicio: null, fim: null,
      duracaoMinutos: null, participantesFormatar: [], participantesCliente: []
    },
    contexto: [],
    acoes: [],
    notasPrivadas,
    avisos,
    resumo: resumirPlano([])
  };
}
