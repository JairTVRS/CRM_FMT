/**
 * _lib/hub.js — cliente do hub da Formatar (o ERP).
 *
 * ==========================================================================
 *  ONDE COLAR A CHAVE DE AUTORIZAÇÃO
 * ==========================================================================
 *
 * A chave NÃO vai neste arquivo, nem em nenhum arquivo do repositório.
 * Ela é um Secret do ambiente, e o código a lê de `env`.
 *
 * EM PRODUÇÃO (Cloudflare Pages):
 *
 *   Painel da Cloudflare
 *     → Workers & Pages → o projeto do CRM
 *     → Settings → Variables and Secrets
 *     → Add variable, com o tipo **Secret** (não "Plaintext")
 *
 *   Nome:  HUB_API_KEY
 *   Valor: a Secret Key do hub
 *
 *   Depois de salvar é preciso **refazer o deploy** — variável nova só
 *   entra em vigor no build seguinte.
 *
 *   Se a chave de clientes for OUTRA, diferente da que já valida usuários,
 *   crie um segundo Secret chamado `HUB_CUSTOMERS_KEY`. Quando ele existe,
 *   tem prioridade; quando não, usa-se a `HUB_API_KEY`.
 *
 * EM DESENVOLVIMENTO (na sua máquina):
 *
 *   No arquivo `.dev.vars` na raiz do projeto — ele está no `.gitignore`
 *   e nunca vai para o Git:
 *
 *     HUB_API_KEY="cole-a-chave-aqui"
 *
 * AS PERMISSÕES NECESSÁRIAS, uma por grupo de endpoint:
 *
 *   hub:users:read       validar o usuário no login  (já em uso)
 *   hub:customers:read   os clientes na Jornada      (confirmada em 06/09)
 *   hub:meetings:read    as reuniões e as atas
 *   hub:portfolios:read  as carteiras
 *   hub:meeting-types:read  os tipos de reunião (os núcleos)
 *   hub:teams:read       os times
 *
 * Faltando qualquer uma, o hub responde **403** e o CRM diz na tela qual
 * permissão falta — em vez de uma lista vazia sem explicação, que seria
 * indistinguível de "não há nada aqui".
 *
 * `GET /api/hub-clientes?diagnostico=1` confere todas de uma vez.
 *
 * ==========================================================================
 *
 * A API do hub é server-to-server: só pode ser chamada daqui, das
 * Functions, nunca do navegador. Um `fetch` do front exporia a chave a
 * qualquer pessoa com o inspetor aberto.
 */

const HUB_BASE = 'https://hub.formatar.com.br/v1';

/** O dublê local sobrescreve a base; ver `dev/hub-stub.mjs`. */
const base = (env) => env?.HUB_BASE_URL || HUB_BASE;

/**
 * `HUB_CUSTOMERS_KEY` tem prioridade para o caso de a permissão de
 * clientes vir numa chave separada. Sem ela, usa a que já existe.
 */
export const chaveDoHub = (env) => env?.HUB_CUSTOMERS_KEY || env?.HUB_API_KEY || null;

export const hubConfigurado = (env) => !!chaveDoHub(env);

/**
 * Erro com código legível, para a tela poder dizer o que fazer em vez de
 * "falha ao carregar".
 */
export class ErroHub extends Error {
  constructor(codigo, mensagem, status) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status || null;
  }
}

/**
 * Qual permissão o hub exigiria para este caminho.
 *
 * Serve à mensagem do 403: dizer "falta uma permissão" não ajuda ninguém;
 * dizer QUAL falta é o que permite pedir a ampliação certa.
 */
function permissaoDe(caminho) {
  if (caminho.startsWith('/customers')) return 'hub:customers:read';
  if (caminho.startsWith('/meetings')) return 'hub:meetings:read';
  if (caminho.startsWith('/portfolios')) return 'hub:portfolios:read';
  if (caminho.startsWith('/meeting-types')) return 'hub:meeting-types:read';
  if (caminho.startsWith('/teams')) return 'hub:teams:read';
  if (caminho.startsWith('/users')) return 'hub:users:read';
  return null;
}

function traduzirStatus(status, corpoTexto, permissao) {
  if (status === 401) {
    return new ErroHub('HUB_CREDENCIAL',
      'A chave do hub está ausente, inválida ou inativa.', status);
  }
  if (status === 403) {
    // O caso mais comum, e o mais importante de nomear: a chave existe e
    // funciona, mas o escopo dela não cobre este grupo de endpoint.
    return new ErroHub('HUB_SEM_PERMISSAO',
      `A chave do hub não tem a permissão ${permissao || 'necessária'} (ou o IP de origem está bloqueado).`,
      status);
  }
  if (status === 429) {
    return new ErroHub('HUB_LIMITE',
      'O hub recusou por excesso de requisições. Tente de novo em alguns instantes.', status);
  }
  if (status === 400) {
    return new ErroHub('HUB_PARAMETRO',
      `O hub recusou os parâmetros da consulta. ${corpoTexto || ''}`.trim(), status);
  }
  return new ErroHub('HUB_INDISPONIVEL',
    `O hub respondeu ${status}.`, status);
}

/**
 * Uma requisição ao hub. Devolve o corpo já em JSON.
 *
 * @param {object} env      o ambiente da Function
 * @param {string} caminho  ex.: '/customers'
 * @param {URLSearchParams|object} parametros
 */
export async function pedirAoHub(env, caminho, parametros = {}) {
  const chave = chaveDoHub(env);
  if (!chave) {
    throw new ErroHub('HUB_SEM_CHAVE',
      'O servidor não tem a chave do hub configurada. Cadastre o Secret HUB_API_KEY na Cloudflare.');
  }

  const p = parametros instanceof URLSearchParams
    ? parametros
    : new URLSearchParams(Object.entries(parametros).filter(([, v]) => v != null && v !== ''));

  const url = `${base(env)}${caminho}${p.toString() ? `?${p}` : ''}`;

  let resposta;
  try {
    resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${chave}`, Accept: 'application/json' }
    });
  } catch (e) {
    throw new ErroHub('HUB_INALCANCAVEL', `Não foi possível falar com o hub: ${e.message}`);
  }

  if (!resposta.ok) {
    // O corpo do 400 traz qual campo foi recusado (API_FIELDS_VALIDATION).
    // Perder isso transformaria um erro de parâmetro em mistério.
    let detalhe = '';
    try { detalhe = (await resposta.text()).slice(0, 300); } catch (e) { /* sem corpo */ }
    throw traduzirStatus(resposta.status, detalhe, permissaoDe(caminho));
  }

  return resposta.json();
}

/* ==========================================================================
   CLIENTES
   ========================================================================== */

/**
 * Os campos que pedimos. `fields` é OBRIGATÓRIO no endpoint — sem ele o
 * hub responde 400.
 *
 * Pedimos só o que a Jornada mostra. Trazer `contacts` e `addresses`
 * multiplicaria o tamanho da resposta por nada: a ficha do CRM tem os
 * seus próprios, e o que ela precisa saber do ERP é quem é o cliente.
 */
export const CAMPOS_CLIENTE = [
  'id', 'nid', 'status', 'tradingName', 'companyName',
  'document', 'email', 'phone1', 'classification', 'contractedAt'
].join(',');

/** Os status que o hub reconhece, conforme a documentação. */
export const STATUS_HUB = ['prospect', 'ad_hoc', 'active', 'inactive'];

/**
 * Traduz o cliente do hub para o vocabulário do CRM.
 *
 * O CRM fala português e chama as coisas pelo nome que a tela usa. Deixar
 * `companyName` e `tradingName` vazarem para o front faria a tela ter
 * dois vocabulários — e obrigaria a mexer no front se o hub renomear um
 * campo.
 */
export function traduzirCliente(c) {
  const documento = String(c?.document || '').replace(/\D/g, '');

  return {
    erp_id: c?.id || null,
    erp_nid: c?.nid ?? null,
    status: c?.status || null,

    nome: c?.companyName || c?.tradingName || null,
    nome_fantasia: c?.tradingName || null,
    documento: documento || null,

    email: c?.email || null,
    telefone: c?.phone1 || null,

    // A escala 1–6 do ERP é a mesma do lead e da ficha do cliente.
    classificacao: Number.isInteger(c?.classification) ? c.classification : null,

    contratado_em: c?.contractedAt || null
  };
}

/**
 * Lista clientes do hub, seguindo a paginação até o fim.
 *
 * A documentação expõe `page` mas não um tamanho de página: quem decide
 * quantos vêm por vez é o servidor. Por isso o laço para quando uma
 * página volta vazia ou quando já reunimos o `size` que o hub declarou —
 * e nunca ultrapassa `maxPaginas`, para que uma mudança de comportamento
 * do hub não vire laço infinito dentro de um Worker.
 *
 * @returns {Promise<{clientes: Array, total: number, paginas: number, truncado: boolean}>}
 */
export async function listarClientesDoHub(env, {
  status = 'active',
  busca = null,
  documento = null,
  maxPaginas = 20
} = {}) {
  const clientes = [];
  let total = null;
  let pagina = 1;
  let truncado = false;

  for (; pagina <= maxPaginas; pagina++) {
    const corpo = await pedirAoHub(env, '/customers', {
      fields: CAMPOS_CLIENTE,
      status,
      search: busca,
      document: documento,
      sort: 'companyName',
      page: pagina
    });

    const lote = Array.isArray(corpo?.data) ? corpo.data : [];
    if (total == null) total = Number(corpo?.size ?? lote.length);

    clientes.push(...lote.map(traduzirCliente));

    if (lote.length === 0) break;              // acabou
    if (clientes.length >= total) break;       // reunimos tudo que o hub declarou

    if (pagina === maxPaginas) truncado = true;
  }

  return {
    clientes,
    total: total ?? clientes.length,
    paginas: pagina,
    truncado
  };
}

/**
 * Um cliente pelo CNPJ. `document` é correspondência exata na doc, e é o
 * que a trava da conversão precisa.
 *
 * Sem filtro de status de propósito: para a trava, o que importa é se o
 * CNPJ existe no ERP. Cliente `inactive` existe — e barrar a conversão
 * dizendo "não existe" seria mentira.
 */
export async function buscarClientePorCnpj(env, cnpj) {
  const limpo = String(cnpj || '').replace(/\D/g, '');
  if (limpo.length !== 14) return null;

  const corpo = await pedirAoHub(env, '/customers', {
    fields: CAMPOS_CLIENTE,
    document: limpo
  });

  const lista = Array.isArray(corpo?.data) ? corpo.data : [];

  // `document` é exato na doc, mas conferimos assim mesmo: um filtro que
  // silenciosamente virasse textual casaria o CNPJ errado, e o vínculo
  // com o ERP é justamente o que não pode estar errado.
  const achado = lista.find(
    (c) => String(c?.document || '').replace(/\D/g, '') === limpo
  );

  return achado ? traduzirCliente(achado) : null;
}

/* ==========================================================================
   TIPOS DE REUNIÃO (os núcleos)

   `meetingType` volta como ObjectId cru nas reuniões e nas carteiras. A
   lista inteira é pequena — nove no ERP hoje — então uma chamada só
   resolve todos os nomes, em vez de uma por linha.

   O NÚCLEO PASSA A VIR DO ERP, não do cabeçalho da ata. O cabeçalho
   continua sendo lido e serve de reserva: se o tipo de reunião não
   estiver na lista, o nome que o consultor escreveu é melhor que nada.

   `teams` é ARRAY DE ObjectId, não de nome. Um tipo de reunião pertence
   a exatamente um Time, mas a API o entrega como lista — guardamos o
   primeiro para usar e a lista inteira para o dia em que deixar de ser
   1:1. O nome do Time vem do `mapaDeTimes`, logo abaixo.

   SÃO TRÊS NÍVEIS que não se confundem, e é por isso que existem três
   consultas: **Time** é o agrupamento interno da Formatar (Governança,
   Operações); **Tipo de Reunião** é o núcleo de atendimento no cliente
   (Logística, Estoque, Conselho Gestor); **Carteira** é cliente + tipo
   de reunião, e é nela que tudo do CX se pendura.
   ========================================================================== */

export const CAMPOS_TIPO_REUNIAO = [
  'id', 'nid', 'title', 'teams', 'isActive'
].join(',');

export function traduzirTipoReuniao(t) {
  const times = Array.isArray(t?.teams) ? t.teams : [];

  return {
    erp_id: t?.id || null,
    erp_nid: t?.nid ?? null,
    nome: t?.title || null,
    // 1:1 na prática, array na API. Guardamos os dois: o primeiro para
    // usar, a lista para o dia em que deixar de ser 1:1.
    timeErpId: times[0] || null,
    timesErpIds: times,
    ativo: t?.isActive !== false
  };
}

/**
 * Todos os tipos de reunião, como um mapa de ObjectId para o núcleo.
 *
 * Sem filtro de `isActive`: um núcleo desativado no ERP continua tendo
 * atas antigas, e não poder nomeá-lo transformaria o histórico em
 * ObjectId na tela.
 */
export async function mapaDeTiposDeReuniao(env, { maxPaginas = 5 } = {}) {
  const mapa = new Map();
  let total = null;

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const corpo = await pedirAoHub(env, '/meeting-types', {
      fields: CAMPOS_TIPO_REUNIAO,
      page: pagina
    });

    const lote = Array.isArray(corpo?.data) ? corpo.data : [];
    if (total == null) total = Number(corpo?.size ?? lote.length);

    lote.map(traduzirTipoReuniao).forEach((t) => {
      if (t.erp_id) mapa.set(t.erp_id, t);
    });

    if (lote.length === 0 || mapa.size >= total) break;
  }

  return mapa;
}

/* ==========================================================================
   TIMES

   O agrupamento interno da Formatar — Governança, Operações. Um tipo de
   reunião pertence a um Time, e é assim que a fila de ações pode ser
   lida por quem responde por cada frente.

   Cinco no ERP hoje: uma chamada resolve todos, como nos tipos.
   ========================================================================== */

export const CAMPOS_TIME = ['id', 'nid', 'title', 'responsible', 'isActive'].join(',');

export function traduzirTime(t) {
  return {
    erp_id: t?.id || null,
    erp_nid: t?.nid ?? null,
    nome: t?.title || null,
    responsavelErpId: t?.responsible || null,
    ativo: t?.isActive !== false
  };
}

/**
 * Todos os times, como um mapa de ObjectId para o time.
 *
 * Sem filtro de `isActive`, pelo mesmo motivo dos tipos de reunião: time
 * desativado continua tendo histórico, e não poder nomeá-lo
 * transformaria a tela em ObjectId.
 */
export async function mapaDeTimes(env, { maxPaginas = 5 } = {}) {
  const mapa = new Map();
  let total = null;

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const corpo = await pedirAoHub(env, '/teams', {
      fields: CAMPOS_TIME,
      page: pagina
    });

    const lote = Array.isArray(corpo?.data) ? corpo.data : [];
    if (total == null) total = Number(corpo?.size ?? lote.length);

    lote.map(traduzirTime).forEach((t) => {
      if (t.erp_id) mapa.set(t.erp_id, t);
    });

    if (lote.length === 0 || mapa.size >= total) break;
  }

  return mapa;
}

/* ==========================================================================
   CARTEIRAS

   Carteira é cliente + tipo de reunião. A documentação a define como
   "agendamento recorrente de reuniões por cliente e tipo", o que confirma
   o modelo que já estava registrado no roadmap.

   É o eixo do CX: saúde, aderência, notas, reuniões e atas penduram todas
   nela, não no cliente. Um cliente com três carteiras pode estar verde
   numa e vermelho noutra.
   ========================================================================== */

export const CAMPOS_CARTEIRA = [
  'id', 'nid', 'customer', 'meetingType', 'frequency',
  'externalConsultant', 'internalConsultants', 'startDate', 'isActive'
].join(',');

export function traduzirCarteira(c) {
  return {
    erp_id: c?.id || null,
    erp_nid: c?.nid ?? null,
    clienteErpId: c?.customer || null,
    nucleoErpId: c?.meetingType || null,
    frequencia: c?.frequency || null,
    consultorExterno: c?.externalConsultant || null,
    consultoresInternos: Array.isArray(c?.internalConsultants) ? c.internalConsultants : [],
    inicio: c?.startDate || null,
    ativa: c?.isActive !== false
  };
}

/** As carteiras ativas, seguindo a paginação até o fim. */
export async function listarCarteiras(env, { clienteErpId = null, ativas = true, maxPaginas = 20 } = {}) {
  const carteiras = [];
  let total = null;
  let truncado = false;
  let pagina = 1;

  for (; pagina <= maxPaginas; pagina++) {
    const corpo = await pedirAoHub(env, '/portfolios', {
      fields: CAMPOS_CARTEIRA,
      customer: clienteErpId,
      isActive: ativas ? 'true' : null,
      page: pagina
    });

    const lote = Array.isArray(corpo?.data) ? corpo.data : [];
    if (total == null) total = Number(corpo?.size ?? lote.length);

    carteiras.push(...lote.map(traduzirCarteira));

    if (lote.length === 0) break;
    if (carteiras.length >= total) break;
    if (pagina === maxPaginas) truncado = true;
  }

  return { carteiras, total: total ?? carteiras.length, truncado };
}

/* ==========================================================================
   REUNIÕES

   A ata inteira vive em `notes`. `technicalNotes` é campo à parte e
   **também é interno** — nenhum dos dois pode chegar ao cliente.
   ========================================================================== */

/**
 * Só as reuniões que já aconteceram têm ata.
 *
 * Os demais status do hub — `unscheduled`, `sent`, `scheduled`,
 * `started` — são reunião que ainda não terminou; os `canceled_by_*` são
 * reunião que não houve. Nenhum deles produz plano de ação.
 *
 * Os cancelamentos, porém, são sinal de CX por si sós: `canceled_by_customer`
 * repetido é desengajamento. Quem vai ler isso é o Lote M.
 */
export const STATUS_REALIZADA = 'finished';

export const STATUS_CANCELADA = [
  'canceled_by_customer',
  'canceled_by_consultant',
  'canceled_by_scheduling',
  'canceled_by_customer_proposal'
];

/**
 * Campos pedidos na LISTAGEM.
 *
 * `notes` entra aqui de propósito, embora seja o campo mais pesado: sem
 * ele seria uma chamada de detalhe por reunião só para ler a ata, e o
 * plano de ação precisa de todas elas.
 */
export const CAMPOS_REUNIAO = [
  'id', 'nid', 'title', 'status', 'customer', 'meetingType',
  'startDate', 'endDate', 'durationInMinutes', 'isDelayed', 'rescheduled',
  'participants', 'customerParticipants', 'notes'
].join(',');

export function traduzirReuniao(r) {
  return {
    erp_id: r?.id || null,
    erp_nid: r?.nid ?? null,
    titulo: r?.title || null,
    status: r?.status || null,

    clienteErpId: r?.customer || null,
    nucleoErpId: r?.meetingType || null,

    inicio: r?.startDate || null,
    fim: r?.endDate || null,
    duracaoMinutos: r?.durationInMinutes ?? null,
    atrasada: r?.isDelayed === true,
    remarcada: r?.rescheduled === true,

    // O mapeamento, CONFIRMADO em 06/09/2026: `participants` são os
    // funcionários da Formatar (têm Usuário e Sala na tela do ERP) e
    // `customerParticipants` são os do cliente ("adicionar avulso").
    //
    // Importa porque a presença do CLIENTE nas reuniões é insumo do
    // Health Score — trocado, mediria a presença da Formatar achando que
    // era a do cliente.
    participantesFormatar: Array.isArray(r?.participants) ? r.participants : [],
    participantesCliente: Array.isArray(r?.customerParticipants) ? r.customerParticipants : [],

    // A ata. Nunca sai do servidor sem passar pelo parser, que separa as
    // notas privadas.
    ata: typeof r?.notes === 'string' ? r.notes : null
  };
}

/**
 * Reuniões de um período, com a ata junto.
 *
 * A ordenação padrão do hub já é `startDate` descendente — a mais recente
 * primeiro —, que é a ordem em que se lê um histórico.
 */
export async function listarReunioes(env, {
  clienteErpId = null,
  nucleoErpId = null,
  status = STATUS_REALIZADA,
  desde = null,
  ate = null,
  maxPaginas = 10
} = {}) {
  const reunioes = [];
  let total = null;
  let truncado = false;
  let pagina = 1;

  for (; pagina <= maxPaginas; pagina++) {
    const corpo = await pedirAoHub(env, '/meetings', {
      fields: CAMPOS_REUNIAO,
      customer: clienteErpId,
      meetingType: nucleoErpId,
      status,
      'startDate[$gte]': desde,
      'startDate[$lte]': ate,
      page: pagina
    });

    const lote = Array.isArray(corpo?.data) ? corpo.data : [];
    if (total == null) total = Number(corpo?.size ?? lote.length);

    reunioes.push(...lote.map(traduzirReuniao));

    if (lote.length === 0) break;
    if (reunioes.length >= total) break;
    if (pagina === maxPaginas) truncado = true;
  }

  return { reunioes, total: total ?? reunioes.length, truncado };
}
