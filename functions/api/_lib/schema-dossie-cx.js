/**
 * _lib/schema-dossie-cx.js — O contrato do Dossiê de Experiência.
 *
 * Irmão do schema-dossie.js e com a mesma fronteira, mas outro assunto:
 *
 *   `conta`  — o que o CRM registrou. Cadastro, jornada, núcleos e as
 *              pessoas mapeadas. A IA NUNCA escreve aqui.
 *   `analise`— a leitura da relação. É opinião, hipótese, sugestão.
 *
 * A diferença de fundo para o Executivo é o SUJEITO. Lá se hipotetiza
 * sobre um prospect que não sabe que existe um documento sobre ele; aqui
 * o documento fala de pessoas nomeadas de um cliente que já paga, e que
 * a CX vai reencontrar na próxima reunião.
 *
 * Isso muda duas coisas, e as duas estão codificadas neste arquivo:
 *
 *   1. Juízo sobre pessoa é DADO DE ENTRADA, não saída do modelo. Quem
 *      diz que alguém é resistente é a CX, na ficha. O modelo lê esse
 *      julgamento e trabalha com ele — não emite o seu próprio, e não
 *      opina sobre caráter, competência ou vida pessoal de ninguém.
 *
 *   2. O que o CRM ainda não vê fica DECLARADO no documento. Reuniões e
 *      atas (Lote I), indicadores (K), saúde (M) e NPS (N) não existem
 *      ainda; um dossiê que se cala sobre isso seria lido como "não há
 *      problema por aqui", que é uma afirmação que ninguém verificou.
 */

import { limparHtml, texto, lista } from './saneamento.js';

export const CONFIANCAS = ['alta', 'media', 'baixa'];

export const INFLUENCIAS = ['alta', 'media', 'baixa', 'desconhecida'];
export const POSTURAS = ['promotor', 'neutro', 'resistente', 'desconhecida'];

/** Rótulos de tela e de documento, num lugar só. */
export const ROTULO_INFLUENCIA = {
  alta: 'Alta', media: 'Média', baixa: 'Baixa', desconhecida: 'Não avaliada'
};

export const ROTULO_POSTURA = {
  promotor: 'Promotor', neutro: 'Neutro',
  resistente: 'Resistente', desconhecida: 'Não avaliada'
};

/* ==========================================================================
   INSTRUÇÃO DE FORMATO PARA O MODELO
   ========================================================================== */

export const FORMATO_ANALISE_CX = `{
  "panorama": "2 a 3 parágrafos em HTML simples (<p>) sobre onde esta conta está hoje: o que a etapa da jornada e o tempo de relação indicam, o que os núcleos atendidos dizem sobre a extensão do trabalho. Use APENAS os fatos fornecidos.",
  "mapaPoder": {
    "leitura": "1 a 2 parágrafos em HTML interpretando o mapa de pessoas FORNECIDO: concentração de decisão, cobertura dos núcleos, dependência de uma pessoa só. Trabalhe com a influência e a postura que a CX registrou — não redefina nenhuma delas.",
    "lacunas": ["o que falta no mapa para a CX conseguir conduzir a conta, ex.: núcleo atendido sem ninguém mapeado"]
  },
  "riscos": [
    { "risco": "risco de relacionamento", "fundamento": "em que fato fornecido se apoia", "confianca": "alta|media|baixa" }
  ],
  "oportunidades": [
    { "titulo": "título curto", "descricao": "acréscimo de produto ou serviço que faria sentido para esta conta", "nucleo": "núcleo a que se liga, ou vazio" }
  ],
  "perguntas": ["pergunta objetiva para a CX levar ao próximo contato"],
  "recomendacao": "1 parágrafo em HTML com os próximos passos sugeridos para a CX."
}`;

/* ==========================================================================
   VALIDAÇÃO
   ========================================================================== */

/**
 * Normaliza a resposta do modelo contra o contrato. Nunca lança.
 *
 * @returns {{analise: object, avisos: string[], seccoesVazias: string[]}}
 */
export function validarAnaliseCx(bruto) {
  const avisos = [];
  const vazias = [];

  if (!bruto || typeof bruto !== 'object') {
    return {
      analise: null,
      avisos: ['A resposta do modelo não é um objeto JSON válido.'],
      seccoesVazias: []
    };
  }

  const a = {
    panorama: limparHtml(bruto.panorama, 3000),

    mapaPoder: {
      leitura: limparHtml(bruto.mapaPoder?.leitura, 2500),
      lacunas: lista(bruto.mapaPoder?.lacunas, (l) => texto(l, 240), 8)
    },

    riscos: lista(
      bruto.riscos,
      (r) => {
        const risco = texto(r?.risco, 220);
        if (!risco) return null;
        const conf = String(r?.confianca || '').toLowerCase();
        return {
          risco,
          fundamento: texto(r?.fundamento, 400),
          confianca: CONFIANCAS.includes(conf) ? conf : 'baixa'
        };
      },
      8
    ),

    // Expansão é acréscimo de produto ou serviço à entrega — decisão do
    // roadmap. Não gera contrato novo nem devolve a conta ao funil, e o
    // prompt diz isso ao modelo com todas as letras.
    oportunidades: lista(
      bruto.oportunidades,
      (o) => {
        const titulo = texto(o?.titulo, 140);
        return titulo
          ? { titulo, descricao: texto(o?.descricao, 500), nucleo: texto(o?.nucleo, 80) }
          : null;
      },
      8
    ),

    perguntas: lista(bruto.perguntas, (p) => texto(p, 260), 10),

    recomendacao: limparHtml(bruto.recomendacao, 2500)
  };

  if (!a.panorama) vazias.push('panorama');
  if (!a.mapaPoder.leitura && a.mapaPoder.lacunas.length === 0) vazias.push('mapaPoder');
  if (a.riscos.length === 0) vazias.push('riscos');
  if (a.oportunidades.length === 0) vazias.push('oportunidades');
  if (a.perguntas.length === 0) vazias.push('perguntas');
  if (!a.recomendacao) vazias.push('recomendacao');

  if (vazias.length >= 4) {
    avisos.push('O modelo devolveu muito pouco conteúdo aproveitável.');
  }

  return { analise: a, avisos, seccoesVazias: vazias };
}

/**
 * O mínimo para o documento valer a impressão: uma leitura da conta e
 * ao menos uma coisa acionável — risco, oportunidade ou pergunta.
 *
 * O teto é mais baixo que o do Executivo de propósito. Lá, análise fraca
 * significa material externo ruim; aqui significa conta nova com pouco
 * registro, e nesse caso a parte factual do documento — o mapa de
 * pessoas — já se sustenta sozinha.
 */
export function analiseCxUtilizavel(analise) {
  if (!analise) return false;
  const temLeitura = !!(analise.panorama || analise.mapaPoder?.leitura);
  const temAcionavel = !!(
    analise.riscos?.length || analise.oportunidades?.length ||
    analise.perguntas?.length || analise.recomendacao
  );
  return temLeitura && temAcionavel;
}

/* ==========================================================================
   O MAPA, EM NÚMEROS

   Aritmética fica em código, não no modelo. Contar pessoas e cruzar
   núcleos é exato; pedir isso a uma IA é trocar uma resposta certa por
   uma provável — e o número errado num documento factual desmoraliza o
   resto dele.
   ========================================================================== */

/**
 * @param {Array}  stakeholders  já normalizados por `montarDossieCx`
 * @param {Array}  nucleos       os núcleos ATENDIDOS pelo cliente
 */
export function resumirMapa(stakeholders, nucleos, { ligacaoConhecida = true } = {}) {
  const pessoas = stakeholders || [];
  const atendidos = nucleos || [];

  // O núcleo pode vir do CRM (id local) ou do ERP (ObjectId do Time).
  // A mesma função serve aos dois porque o que ela precisa é uma chave
  // estável, não saber de onde ela veio.
  const chaveDe = (n) => n.erp_id || n.id;

  const nomesPorNucleo = new Map(atendidos.map((n) => [chaveDe(n), []]));
  pessoas.forEach((p) => {
    (p.nucleoIds || []).forEach((id) => {
      if (nomesPorNucleo.has(id)) nomesPorNucleo.get(id).push(p.nome);
    });
  });

  return {
    total: pessoas.length,
    patrocinadores: pessoas.filter((p) => p.patrocinador).map((p) => p.nome),

    porInfluencia: INFLUENCIAS.reduce((acc, i) => {
      acc[i] = pessoas.filter((p) => p.influencia === i).length;
      return acc;
    }, {}),

    porPostura: POSTURAS.reduce((acc, s) => {
      acc[s] = pessoas.filter((p) => p.postura === s).length;
      return acc;
    }, {}),

    // O buraco mais útil que o mapa revela: núcleo que a Formatar
    // atende e no qual a CX não conhece ninguém.
    //
    // `null` quando NÃO DÁ PARA SABER — é o caso em que as pessoas vêm
    // do ERP e a ligação delas com o núcleo não pôde ser derivada da
    // presença nas reuniões. Devolver a lista cheia ali acusaria todo
    // núcleo de estar órfão, que é o falso alarme mais caro possível:
    // manda a CX procurar interlocutor para frente que já tem um.
    nucleosSemPessoa: ligacaoConhecida
      ? atendidos
        .filter((n) => (nomesPorNucleo.get(chaveDe(n)) || []).length === 0)
        .map((n) => n.nome)
      : null,

    // Ninguém avaliado é diferente de ninguém cadastrado, e o documento
    // precisa saber distinguir os dois.
    naoAvaliadas: pessoas.filter(
      (p) => p.influencia === 'desconhecida' && p.postura === 'desconhecida'
    ).length
  };
}

/* ==========================================================================
   O QUE ESTE DOSSIÊ AINDA NÃO VÊ

   Vive aqui, e não numa string do template, porque é conteúdo do
   documento e some sozinho: cada lote que chegar apaga a sua linha.
   Um dossiê de pós-venda calado sobre reuniões e saúde seria lido como
   "está tudo bem" — afirmação que ninguém verificou.
   ========================================================================== */

export const PENDENCIAS = [
  {
    // A Fase 2 do lote "o cliente é do ERP" trouxe QUAIS núcleos são
    // atendidos, QUANTAS reuniões houve e QUANDO foi a última — tudo
    // lido ao vivo do hub. O que continua faltando é o CONTEÚDO: o que
    // foi tratado, o que ficou decidido, o plano de ação.
    //
    // Por isso os termos abaixo deixaram de pegar a palavra "reunião"
    // solta: contar reunião virou fato conferido, e descartar um item
    // por citá-lo seria jogar fora afirmação verdadeira. O que eles
    // pegam agora é o que o CRM ainda não tem como sustentar.
    chave: 'atas',
    tema: 'O que foi tratado nas reuniões',
    lote: 'I',
    texto: 'O CRM já sabe quais núcleos são atendidos e quantas reuniões houve, mas ainda não lê o conteúdo das atas. Nada neste documento se apoia no que foi tratado nos encontros, nem no plano de ação.',
    termos: /\b(atas?|plano de a[çc][ãa]o|foi tratado|pauta|delibera|encaminhament|ficou (decidido|acordado))/i
  },
  {
    chave: 'indicadores',
    tema: 'Indicadores empresariais',
    lote: 'K',
    texto: 'Os KPIs do ERP ainda não são lidos. Não há série histórica de resultado por trás das leituras abaixo.',
    termos: /\b(kpis?|indicador|indicadores|faturamento|margem|ebitda)\b/i
  },
  {
    chave: 'saude',
    tema: 'Saúde da carteira',
    lote: 'M',
    texto: 'Saúde e Aderência ainda não são calculadas. A ausência de alerta aqui não significa conta saudável.',
    termos: /\b(sa[úu]de da (carteira|conta)|ader[êe]ncia)\b/i
  },
  {
    chave: 'percepcao',
    tema: 'Percepção do cliente',
    lote: 'N',
    texto: 'Check-in, NPS e CSAT ainda não existem. A postura registrada é a leitura da CX, não a voz do cliente.',
    // "percep" entrou em 15/09/2026. O termo já era proibido no prompt e
    // vinha sendo barrado POR ACIDENTE, pelo regex largo de reuniões:
    // o texto reprovado ("percepção de baixa entrega") caía porque
    // mencionava reuniões junto, não porque falava de percepção.
    // Ao estreitar aquele regex — contar reunião virou fato — o buraco
    // apareceu. Aqui ele fica fechado pelo motivo certo.
    termos: /\b(nps|csat|check-?in|satisfa[çc][ãa]o|insatisfa[çc][ãa]o|percep[çc][ãa]o|percebid[ao]s?)\b/i
  }
];

/* ==========================================================================
   A GUARDA — o prompt pede, isto confere

   O prompt já proibia o modelo de falar de reuniões, atas, NPS e saúde.
   Na PRIMEIRA geração real ele desobedeceu nos dois pontos: escreveu
   "sem registro de pessoas ou reuniões" como risco e "percepção de baixa
   entrega da Formatar" como outro.

   A lição não é escrever um prompt melhor. Instrução em prompt é pedido,
   não garantia — e este documento nomeia pessoas de um cliente real e é
   lido como se fosse apurado. O que o modelo afirma precisa passar por
   uma conferência que não depende da boa vontade dele.

   Descarte, e não reescrita: um item que se apoia numa fonte inexistente
   não tem versão salvável. E o descarte é DECLARADO no documento — some
   em silêncio seria trocar um defeito por outro mais difícil de ver.
   ========================================================================== */

/** Um item citou fonte que o CRM ainda não tem? Devolve o rótulo dela. */
function fonteInexistente(texto, presentes) {
  const t = String(texto || '');
  for (const p of PENDENCIAS) {
    if (presentes.has(p.chave)) continue;
    if (p.termos.test(t)) return p.tema;
  }
  return null;
}

/** Fala em tempo de permanência na etapa sem o CRM saber desde quando. */
const RE_DURACAO = /\b(\d+\s*(meses|m[êe]s|anos?|dias)|h[áa]\s+\d+|desde\s+\d{4})/i;
const RE_ETAPA = /\b(etapa|estagna|estagnad|permanec|parad[ao])/i;

function tempoDeEtapaInventado(texto, sabeDesdeQuando) {
  if (sabeDesdeQuando) return null;
  const t = String(texto || '');
  return RE_DURACAO.test(t) && RE_ETAPA.test(t)
    ? 'tempo de permanência na etapa'
    : null;
}

/* --------------------------------------------------------------------------
   AFIRMAR O VAZIO SEM TER OLHADO

   O defeito de 15/09/2026, numa conta real: o dossiê escreveu "nenhuma
   pessoa mapeada", "nenhum núcleo marcado" e "a conta é uma relação sem
   rosto registrado" — e, na Recomendação, mandou a CX ir a campo
   levantar interlocutores e marcar núcleos. As pessoas e os núcleos
   estavam cadastrados no ERP o tempo todo. O documento não consultou.

   A partir da Fase 2 o ERP é consultado. Mas consultar pode falhar: 403,
   hub fora do ar, cliente sem vínculo. Nessas horas o modelo recebe
   "não consultei" — e não pode transformar isso em "não existe".

   O negativo é a afirmação mais cara deste documento, porque é a que
   gera trabalho: manda alguém procurar o que já está achado. Então é a
   que exige fonte. Sem fonte consultada, o item é descartado — e o
   descarte aparece no documento.
   -------------------------------------------------------------------------- */

const RE_NEGATIVA_PESSOAS = new RegExp(
  '(nenhum[ a]*(pessoa|contato|interlocutor|stakeholder)'
  + '|n[ãa]o h[áa] (nenhum[a]? )?(pessoa|contato|interlocutor|ningu[ée]m)'
  + '|sem (nenhum |registro de |ningu[ée]m )?(interlocutor|contato|pessoa|rosto)'
  + '|ningu[ée]m (mapeado|cadastrado|registrado|identificado)'
  + '|(pessoas?|contatos?|interlocutores?)[^.]{0,40}'
    + 'n[ãa]o (foi|foram|est[áa]|est[ãa]o)? ?(registrad|mapead|cadastrad|identificad)'
  + '|mapa (de (poder|pessoas) )?(n[ãa]o foi preenchido|est[áa] vazio|vazio))', 'i'
);

const RE_NEGATIVA_NUCLEOS = new RegExp(
  '(nenhum n[úu]cleo|sem n[úu]cleo|n[ãa]o h[áa] n[úu]cleo'
  + '|nenhuma frente|n[ãa]o h[áa] (indica[çc][ãa]o de )?frentes?'
  + '|entrega (atual )?(invis[íi]vel|desconhecida)'
  + '|n[úu]cleos?[^.]{0,40}n[ãa]o (foi|foram|est[áa]|est[ãa]o)? ?(registrad|marcad|mapead|identificad)'
  + '|aus[êe]ncia de (marca[çc][ãa]o|mapeamento) de n[úu]cleos?)', 'i'
);

/**
 * Afirma que não há pessoas (ou núcleos) sem que a fonte tenha sido
 * consultada? Devolve o rótulo do que foi afirmado no escuro.
 */
function negativaSemFonte(texto, { pessoasConsultadas, nucleosConsultados }) {
  const t = String(texto || '');

  if (!pessoasConsultadas && RE_NEGATIVA_PESSOAS.test(t)) {
    return 'ausência de pessoas que NÃO foi verificada no ERP';
  }
  if (!nucleosConsultados && RE_NEGATIVA_NUCLEOS.test(t)) {
    return 'ausência de núcleos que NÃO foi verificada no ERP';
  }
  return null;
}

/**
 * Filtra os itens da análise que se apoiam no que o CRM não tem.
 *
 * Só listas são descartadas — riscos, oportunidades, perguntas, lacunas.
 * São afirmações discretas: cada uma se sustenta ou não sozinha. Textos
 * corridos (panorama, leitura do mapa, recomendação) não são apagados
 * por uma palavra no meio; para eles fica o aviso, porque descartar o
 * panorama inteiro deixaria o documento sem começo.
 *
 * @param {Set<string>} presentes  chaves de PENDENCIAS que JÁ existem
 * @param {boolean} sabeEtapaDesde `etapa_desde` está preenchido?
 * @param {boolean} pessoasConsultadas  o ERP respondeu sobre as pessoas?
 * @param {boolean} nucleosConsultados  o ERP respondeu sobre os núcleos?
 */
export function filtrarPorFontes(analise, {
  presentes = new Set(),
  sabeEtapaDesde = false,
  // O padrão é `false` de propósito: quem não declara que consultou não
  // consultou. Errar para o lado de descartar um item verdadeiro custa
  // um dossiê mais curto; errar para o outro lado manda gente procurar
  // o que já está achado.
  pessoasConsultadas = false,
  nucleosConsultados = false
} = {}) {
  if (!analise) return { analise, descartados: [], avisos: [] };

  const descartados = [];
  const avisos = [];

  const passa = (texto, onde) => {
    const motivo = fonteInexistente(texto, presentes)
      || tempoDeEtapaInventado(texto, sabeEtapaDesde)
      || negativaSemFonte(texto, { pessoasConsultadas, nucleosConsultados });
    if (motivo) {
      descartados.push({ onde, motivo, trecho: String(texto).slice(0, 120) });
      return false;
    }
    return true;
  };

  const a = {
    ...analise,
    mapaPoder: {
      ...analise.mapaPoder,
      lacunas: (analise.mapaPoder?.lacunas || []).filter((l) => passa(l, 'lacuna'))
    },
    riscos: (analise.riscos || [])
      .filter((r) => passa(`${r.risco} ${r.fundamento || ''}`, 'risco')),
    oportunidades: (analise.oportunidades || [])
      .filter((o) => passa(`${o.titulo} ${o.descricao || ''}`, 'oportunidade')),
    perguntas: (analise.perguntas || []).filter((p) => passa(p, 'pergunta'))
  };

  for (const campo of ['panorama', 'recomendacao']) {
    const motivo = fonteInexistente(analise[campo], presentes)
      || tempoDeEtapaInventado(analise[campo], sabeEtapaDesde);
    if (motivo) avisos.push(`O texto de "${campo}" menciona ${motivo} — leia com reserva.`);
  }

  const leitura = analise.mapaPoder?.leitura;
  const motivoLeitura = fonteInexistente(leitura, presentes)
    || tempoDeEtapaInventado(leitura, sabeEtapaDesde);
  if (motivoLeitura) {
    avisos.push(`A leitura do mapa menciona ${motivoLeitura} — leia com reserva.`);
  }

  if (descartados.length) {
    const quais = [...new Set(descartados.map((d) => d.motivo))].join(', ');
    avisos.push(
      `${descartados.length} item(ns) da análise foram descartados por se `
      + `apoiarem em fonte que o CRM ainda não tem: ${quais}.`
    );
  }

  return { analise: a, descartados, avisos };
}

/* ==========================================================================
   MONTAGEM DO DOCUMENTO FINAL
   ========================================================================== */

/** Meses inteiros entre uma data AAAA-MM-DD e hoje. */
export function mesesDesde(dataIso, hoje = new Date()) {
  const m = String(dataIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;

  const inicio = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(inicio.getTime()) || inicio > hoje) return null;

  let meses = (hoje.getFullYear() - inicio.getFullYear()) * 12
    + (hoje.getMonth() - inicio.getMonth());
  if (hoje.getDate() < inicio.getDate()) meses -= 1;

  return Math.max(0, meses);
}

/**
 * Junta a camada factual com a interpretativa no formato que o template
 * consome — e que fica guardado em `dados_json`.
 *
 * `stakeholders` chega da API já com o papel e os núcleos resolvidos em
 * nome: o documento é lido por gente, e um `papel_id` no papel impresso
 * não diz nada a ninguém.
 */
export function montarDossieCx({ cliente, etapa, nucleos, stakeholders, analise, meta, fontes }) {
  // O estado de cada fonte, com o padrão pessimista: quem não declarou
  // que consultou, não consultou. O template imprime frase diferente
  // para "não tem" e para "não perguntei", e é daqui que ele sabe qual.
  const f = {
    pessoas: { consultado: false, origem: null, motivo: null, ...(fontes?.pessoas || {}) },
    nucleos: { consultado: false, origem: null, motivo: null, ...(fontes?.nucleos || {}) },
    conta: { consultado: false, origem: null, motivo: null, ...(fontes?.conta || {}) },
    ligacaoNucleoPessoaConhecida: !!fontes?.ligacaoNucleoPessoaConhecida
  };

  const pessoas = (stakeholders || []).map((p) => ({
    nome: p.nome,
    papel: p.papel || null,
    cargo: p.cargo || null,
    email: p.email || null,
    telefone: p.telefone || null,
    influencia: INFLUENCIAS.includes(p.influencia) ? p.influencia : 'desconhecida',
    postura: POSTURAS.includes(p.postura) ? p.postura : 'desconhecida',
    patrocinador: !!p.patrocinador,
    nucleos: p.nucleos || [],
    nucleoIds: p.nucleoIds || [],
    observacoes: p.observacoes || null,

    // De onde veio a pessoa e o que se sabe dela. `principal` é null
    // quando o ERP não marca ninguém — que não é o mesmo que "não é".
    erpContatoId: p.erpContatoId || null,
    principal: p.principal === undefined ? null : p.principal,
    origem: p.origem || 'crm',
    avaliada: p.avaliada !== false
  }));

  // O contato principal é o que o ERP marcou. Só na falta dele vale o
  // campo escrito à mão na ficha do CRM.
  const principalDoErp = pessoas.find((p) => p.principal === true) || null;

  const atendidos = nucleos || [];

  return {
    conta: {
      razaoSocial: cliente?.nome || null,
      nomeFantasia: cliente?.nome_fantasia || null,
      documento: cliente?.documento || null,
      cidade: cliente?.cidade || null,

      contatoNome: principalDoErp ? principalDoErp.nome : (cliente?.contato_nome || null),
      contatoOrigem: principalDoErp ? 'erp' : (cliente?.contato_nome ? 'crm' : null),
      telefone: cliente?.telefone || null,
      email: cliente?.email || null,

      etapa: etapa?.nome || null,
      etapaCor: etapa?.cor || null,
      dataInicio: cliente?.data_inicio || null,
      mesesDeJornada: mesesDesde(cliente?.data_inicio),

      // Nulo é "o CRM não sabe", e o documento diz isso com todas as
      // letras. O contrário — deixar em branco — foi o que permitiu ao
      // modelo somar o início da jornada com a etapa atual e inventar
      // 83 meses de estagnação numa conta real.
      etapaDesde: cliente?.etapa_desde || null,
      mesesNaEtapa: mesesDesde(cliente?.etapa_desde),
      classificacao: cliente?.classificacao ?? null,

      // Cada núcleo leva junto os tipos de reunião que o compõem e o
      // histórico de encontros. O nome sozinho não deixaria a CX
      // reconciliar esta folha com o Plano de Ação, onde "núcleo" é o
      // tipo de reunião e não o Time.
      nucleos: atendidos.map((n) => ({
        nome: n.nome,
        cor: n.cor || null,
        tiposDeReuniao: (n.tiposDeReuniao || []).map((t) => t.nome).filter(Boolean),
        reunioesRealizadas: n.reunioesRealizadas ?? null,
        reunioesPrevistas: n.reunioesPrevistas ?? null,
        ultimaReuniao: n.ultimaReuniao || null
      })),

      // Nulo aqui é "cadastro manual ainda não conferido", NÃO é
      // "cliente fora do ERP" — a distinção está no roadmap e o
      // documento a repete para quem o lê sem esse contexto.
      erpId: cliente?.erp_id || null,

      observacoes: cliente?.observacoes || null
    },

    stakeholders: pessoas,
    mapa: resumirMapa(pessoas, atendidos, {
      ligacaoConhecida: f.ligacaoNucleoPessoaConhecida
    }),

    // De onde veio cada bloco, e o que não deu para perguntar. É o que
    // permite ao template dizer "o ERP não respondeu" em vez de "não
    // há" — a diferença que custou um documento em 15/09/2026.
    fontes: f,

    analise,

    pendencias: PENDENCIAS,

    gerado: {
      em: meta?.geradoEm || new Date().toISOString(),
      por: meta?.geradoPor || null,
      provider: meta?.provider || null,
      versao: meta?.versao ?? null
    }
  };
}
