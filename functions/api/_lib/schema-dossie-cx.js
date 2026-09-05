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
export function resumirMapa(stakeholders, nucleos) {
  const pessoas = stakeholders || [];
  const atendidos = nucleos || [];

  const nomesPorNucleo = new Map(atendidos.map((n) => [n.id, []]));
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
    nucleosSemPessoa: atendidos
      .filter((n) => (nomesPorNucleo.get(n.id) || []).length === 0)
      .map((n) => n.nome),

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
    tema: 'Reuniões e atas',
    lote: 'I',
    texto: 'As reuniões e o plano de ação das atas ainda não chegam ao CRM. Nada neste documento se apoia no que foi tratado nos encontros.'
  },
  {
    tema: 'Indicadores empresariais',
    lote: 'K',
    texto: 'Os KPIs do ERP ainda não são lidos. Não há série histórica de resultado por trás das leituras abaixo.'
  },
  {
    tema: 'Saúde da carteira',
    lote: 'M',
    texto: 'Saúde e Aderência ainda não são calculadas. A ausência de alerta aqui não significa conta saudável.'
  },
  {
    tema: 'Percepção do cliente',
    lote: 'N',
    texto: 'Check-in, NPS e CSAT ainda não existem. A postura registrada é a leitura da CX, não a voz do cliente.'
  }
];

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
export function montarDossieCx({ cliente, etapa, nucleos, stakeholders, analise, meta }) {
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
    observacoes: p.observacoes || null
  }));

  const atendidos = nucleos || [];

  return {
    conta: {
      razaoSocial: cliente?.nome || null,
      nomeFantasia: cliente?.nome_fantasia || null,
      documento: cliente?.documento || null,
      cidade: cliente?.cidade || null,

      contatoNome: cliente?.contato_nome || null,
      telefone: cliente?.telefone || null,
      email: cliente?.email || null,

      etapa: etapa?.nome || null,
      etapaCor: etapa?.cor || null,
      dataInicio: cliente?.data_inicio || null,
      mesesDeJornada: mesesDesde(cliente?.data_inicio),
      classificacao: cliente?.classificacao ?? null,

      nucleos: atendidos.map((n) => ({ nome: n.nome, cor: n.cor || null })),

      // Nulo aqui é "cadastro manual ainda não conferido", NÃO é
      // "cliente fora do ERP" — a distinção está no roadmap e o
      // documento a repete para quem o lê sem esse contexto.
      erpId: cliente?.erp_id || null,

      observacoes: cliente?.observacoes || null
    },

    stakeholders: pessoas,
    mapa: resumirMapa(pessoas, atendidos),

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
