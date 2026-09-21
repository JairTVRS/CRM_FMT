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
 * Memória curta, por isolate do Worker, para listas que mudam pouco.
 *
 * A carga do plano de ação anda em passos, e cada passo precisava das
 * mesmas carteiras, clientes, tipos e times — 20+ páginas repetidas a
 * cada mês lido, o que levou o hub a recusar por excesso de requisições.
 * Só guarda sucesso: falha nunca fica memorizada.
 */
const MEMORIA = new Map();

export async function memorizar(chave, ms, executar) {
  const guardado = MEMORIA.get(chave);
  if (guardado && guardado.expira > Date.now()) return guardado.valor;
  const valor = await executar();
  MEMORIA.set(chave, { valor, expira: Date.now() + ms });
  return valor;
}

export function esquecerMemoria() { MEMORIA.clear(); }

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

  // 429 é o hub pedindo uma pausa, não recusando. Espera o que ele pedir
  // (Retry-After, no máximo 5 s) e tenta de novo, até duas vezes. Sem
  // isso, a carga do plano de ação — dezenas de páginas seguidas —
  // parava no meio a cada rajada (visto em produção em 21/09/2026).
  let resposta;
  for (let tentativa = 0; ; tentativa++) {
    try {
      resposta = await fetch(url, {
        headers: { Authorization: `Bearer ${chave}`, Accept: 'application/json' }
      });
    } catch (e) {
      throw new ErroHub('HUB_INALCANCAVEL', `Não foi possível falar com o hub: ${e.message}`);
    }
    if (resposta.status !== 429 || tentativa === 2) break;

    const pedido = Number(resposta.headers.get('Retry-After'));
    const espera = Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido * 1000, 5000) : 1500 * (tentativa + 1);
    await new Promise((r) => setTimeout(r, espera));
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
   USUÁRIOS DA FORMATAR (2.30.0)

   Os `participants` de uma reunião são funcionários da Formatar, e cada um
   aponta para um usuário. O plano de ação usa isso para o responsável da
   ação que a ata deixou sem `Resp.:`.

   Usa `hub:users:read`, a mesma permissão com que o middleware confere o
   login — nenhuma permissão nova.
   ========================================================================== */

/** Id → nome, de todos os usuários do hub. */
export async function mapaDeUsuarios(env, { maxPaginas = 20 } = {}) {
  const mapa = new Map();
  let total = null;

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const corpo = await pedirAoHub(env, '/users', { fields: 'id,name,email', page: pagina });
    const lote = Array.isArray(corpo?.data) ? corpo.data : [];
    if (total == null) total = Number(corpo?.size ?? lote.length);

    for (const u of lote) {
      if (u?.id != null) mapa.set(String(u.id), u.name || u.email || null);
    }
    if (lote.length === 0 || mapa.size >= total) break;
  }
  return mapa;
}

/**
 * Os nomes dos participantes da Formatar numa reunião.
 *
 * O formato exato de `participants` não foi confirmado com uma resposta
 * real — a doc não traz exemplo. O tradutor aceita as variantes
 * plausíveis: `{ user: 'id' }`, `{ user: { id, name } }`, `'id'` solto,
 * `{ name }`. Entrada sem usuário (uma sala) é ignorada.
 */
export function nomesDosParticipantes(participantes, usuarios = new Map()) {
  const nomes = [];
  for (const p of Array.isArray(participantes) ? participantes : []) {
    const u = p && typeof p === 'object' && 'user' in p ? p.user : p;
    let nome = null;
    if (u && typeof u === 'object') nome = u.name || usuarios.get(String(u.id ?? u._id)) || null;
    else if (u != null && u !== '') nome = usuarios.get(String(u)) || null;
    if (!nome && p && typeof p === 'object' && !('user' in p)) nome = p.name || null;
    if (nome && !nomes.includes(nome)) nomes.push(nome);
  }
  return nomes;
}

/* ==========================================================================
   CLIENTES
   ========================================================================== */

/**
 * Os campos da LISTAGEM. `fields` é OBRIGATÓRIO no endpoint — sem ele o
 * hub responde 400.
 *
 * `contacts` e `addresses` ficam de fora DAQUI, e só daqui: a Jornada
 * lista a carteira inteira, e carregar as pessoas de cada conta para
 * imprimir uma linha por cliente multiplicaria a resposta por nada.
 *
 * O comentário que estava aqui dizia outra coisa — que trazer `contacts`
 * não valia porque "a ficha do CRM tem os seus próprios". A PREMISSA
 * ESTAVA ERRADA, e foi corrigida em 15/09/2026: para cliente, o dono das
 * pessoas é o ERP, como já valia para a lista de clientes e para as
 * atas. O princípio "o CRM não replica o ERP" estava aplicado em todo
 * lugar menos aqui, e o preço apareceu num documento real: o Dossiê de
 * Experiência afirmou "nenhuma pessoa mapeada" sobre uma conta cujas
 * pessoas estavam cadastradas no ERP o tempo todo.
 *
 * Quem precisa das pessoas é o detalhe de UMA conta. Para isso existe o
 * `CAMPOS_CLIENTE_DETALHE`, logo abaixo.
 */
export const CAMPOS_CLIENTE = [
  'id', 'nid', 'status', 'tradingName', 'companyName',
  'document', 'email', 'phone1', 'classification', 'contractedAt'
].join(',');

/**
 * Os campos do DETALHE de uma conta — tudo da listagem, mais as pessoas
 * e os endereços.
 *
 * Só é pedido quando o assunto é UM cliente: a ficha, o Dossiê de
 * Experiência, o mapa de stakeholders. É a mesma API, com o custo
 * proporcional ao que a tela realmente mostra.
 */
export const CAMPOS_CLIENTE_DETALHE = [
  CAMPOS_CLIENTE, 'contacts', 'addresses'
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

    // A classificação do ERP vem COMO ELA É, sem conversão.
    //
    // Estava escrito aqui que era "a escala 1–6, a mesma do lead e da
    // ficha do cliente". A documentação do `GET /customers/{id}`,
    // conferida em 15/09/2026, mostra `"classification": "A"` — uma
    // STRING. A premissa estava errada, e o custo dela era exatamente o
    // defeito que este lote conserta: `Number.isInteger("A")` é falso,
    // a classificação real virava `null`, e o dossiê continuava
    // afirmando que o ERP não tem classificação nesta conta.
    //
    // Não convertemos "A" em número nem número em letra: são escalas de
    // sistemas diferentes, e inventar a correspondência seria trocar um
    // dado certo por um palpite. O documento imprime o que o ERP diz.
    classificacao: (() => {
      const v = c?.classification;
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'string') return v.trim() || null;
      return v;
    })(),

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
export async function buscarClientePorCnpj(env, cnpj, { campos = CAMPOS_CLIENTE } = {}) {
  const bruto = await acharClienteBrutoPorCnpj(env, cnpj, campos);
  return bruto ? traduzirCliente(bruto) : null;
}

/**
 * O mesmo caminho, devolvendo o objeto CRU do hub.
 *
 * Existe porque `contacts` e `addresses` não passam pelo
 * `traduzirCliente` — são listas de outra natureza, com leitor próprio
 * (`lerContatos`). Quem precisa delas precisa do bruto.
 */
async function acharClienteBrutoPorCnpj(env, cnpj, campos = CAMPOS_CLIENTE) {
  const limpo = String(cnpj || '').replace(/\D/g, '');
  if (limpo.length !== 14) return null;

  const corpo = await pedirAoHub(env, '/customers', {
    fields: campos,
    document: limpo
  });

  const lista = Array.isArray(corpo?.data) ? corpo.data : [];

  // `document` é exato na doc, mas conferimos assim mesmo: um filtro que
  // silenciosamente virasse textual casaria o CNPJ errado, e o vínculo
  // com o ERP é justamente o que não pode estar errado.
  return lista.find(
    (c) => String(c?.document || '').replace(/\D/g, '') === limpo
  ) || null;
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

/* ==========================================================================
   CONSULTA COM ESTADO DECLARADO

   Tudo daqui para baixo devolve TRÊS estados, nunca dois:

     consultado: true,  dado cheio   → a fonte respondeu e tem conteúdo
     consultado: true,  dado vazio   → a fonte respondeu e não tem nada
     consultado: false               → a fonte NÃO respondeu

   A distinção não é preciosismo. Em 15/09/2026 um Dossiê de Experiência
   afirmou "nenhuma pessoa mapeada" e "nenhum núcleo marcado" sobre uma
   conta real — e mandou a CX ir a campo levantar o que já estava
   cadastrado no ERP. O documento não tinha como saber a diferença entre
   "não existe" e "não perguntei", porque o código não a carregava.

   Quem consome decide o que dizer; o que não pode é a informação se
   perder no caminho. Uma lista vazia é indistinguível de um 403 — e é
   por isso que nenhuma função abaixo devolve lista pelada.
   ========================================================================== */

/**
 * Executa uma consulta ao hub e devolve o resultado COM o estado, em vez
 * de lançar. Erro de permissão e hub fora do ar viram dado, não exceção:
 * um dossiê tem que sair mesmo com o ERP mudo — só não pode mentir.
 *
 * @param {string}   rotulo    como a fonte se chama na tela, em português
 * @param {Function} executar  a consulta em si
 */
export async function consultarHub(rotulo, executar) {
  try {
    return { rotulo, consultado: true, dado: await executar(), erro: null };
  } catch (e) {
    const erro = e instanceof ErroHub ? e : new ErroHub('HUB_FALHA', e?.message || String(e));
    return {
      rotulo,
      consultado: false,
      dado: null,
      erro: { codigo: erro.codigo, mensagem: erro.message, status: erro.status ?? null }
    };
  }
}

/* ==========================================================================
   AS PESSOAS DA CONTA (`contacts`)

   O dono das pessoas de um cliente é o ERP. O CRM não cria e não
   renomeia ninguém — ele anota POR CIMA: influência, postura,
   patrocinador, e as observações da CX.

   O FORMATO DO `contacts` NÃO ESTÁ NA DOCUMENTAÇÃO que temos, e não dá
   para descobri-lo daqui: a chave do hub é Secret na Cloudflare e local
   só existe o dublê. Então o tradutor abaixo não ADIVINHA um formato —
   ele aceita os plausíveis, registra QUAL encontrou e deixa nulo o que
   não achar. Nulo é "não sei", e quem imprime o documento sabe dizer
   isso com todas as letras.

   Quando a primeira conta real passar por aqui, `lerContatos` informa a
   forma verdadeira e este mapa deixa de ser hipótese.
   ========================================================================== */

/**
 * Os nomes que cada campo pode ter, em ordem de preferência.
 *
 * A API do hub é camelCase em inglês (`tradingName`, `phone1`,
 * `isActive`), então as hipóteses seguem essa gramática.
 */
export const CHAVES_CONTATO = {
  erp_id:    ['id', '_id'],
  nome:      ['name', 'fullName', 'contactName'],
  email:     ['email', 'mail'],
  telefone:  ['phone', 'phone1', 'mobile', 'cellphone', 'telephone'],
  cargo:     ['role', 'jobTitle', 'position', 'occupation', 'office'],
  principal: ['isMain', 'isPrimary', 'isDefault', 'main', 'primary']
};

/** O primeiro nome de campo que existe no objeto, e o valor dele. */
function primeiroPresente(obj, chaves) {
  for (const chave of chaves) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, chave)
        && obj[chave] !== null && obj[chave] !== '') {
      return { chave, valor: obj[chave] };
    }
  }
  return { chave: null, valor: null };
}

/**
 * Um contato do ERP no vocabulário do CRM.
 *
 * `principal` merece atenção: fica `null` quando NENHUMA das chaves
 * candidatas existe. Devolver `false` aí diria "esta pessoa não é a
 * principal", quando a verdade é "este ERP não marca principal" — e a
 * diferença vira uma frase errada no dossiê.
 */
export function traduzirContato(bruto) {
  // `contacts` pode ser uma lista de ObjectId em vez de objetos: nesse
  // caso a pessoa mora noutra coleção e o que temos é uma referência.
  // Declarar isso é melhor que devolver um contato sem nome.
  if (typeof bruto === 'string') {
    return {
      erp_id: bruto, nome: null, email: null, telefone: null, cargo: null,
      principal: null, referencia: true, chavesVistas: []
    };
  }

  if (!bruto || typeof bruto !== 'object') return null;

  const campos = {};
  const chavesVistas = [];

  for (const [nosso, candidatas] of Object.entries(CHAVES_CONTATO)) {
    const { chave, valor } = primeiroPresente(bruto, candidatas);
    campos[nosso] = valor;
    if (chave) chavesVistas.push(nosso + '=' + chave);
  }

  const marcado = campos.principal;

  return {
    erp_id: campos.erp_id ? String(campos.erp_id) : null,
    nome: campos.nome ? String(campos.nome) : null,
    email: campos.email ? String(campos.email) : null,
    telefone: campos.telefone ? String(campos.telefone) : null,
    cargo: campos.cargo ? String(campos.cargo) : null,

    // Só vira booleano se houve marcação; senão continua "não sei".
    principal: marcado === null
      ? null
      : (marcado === true || marcado === 'true' || marcado === 1),

    referencia: false,
    chavesVistas
  };
}

/**
 * Lê o `contacts` de um cliente bruto do hub e diz o que encontrou.
 *
 * O `formato` é o que transforma este leitor em diagnóstico: é ele que
 * responde, na primeira conta real que passar, se as pessoas vêm
 * embutidas, se vêm por referência, ou se o campo nem veio.
 */
export function lerContatos(brutoDoHub) {
  const cru = brutoDoHub?.contacts;

  if (cru === undefined || cru === null) {
    return { contatos: [], formato: 'ausente', chavesVistas: [],
             temIdEstavel: false, temMarcacaoPrincipal: false };
  }

  if (!Array.isArray(cru)) {
    // Um objeto só, ou algo inesperado: tratamos como lista de um para
    // não perder a pessoa, e o formato denuncia a surpresa.
    const um = traduzirContato(cru);
    return { contatos: um ? [um] : [], formato: 'inesperado',
             chavesVistas: um?.chavesVistas || [],
             temIdEstavel: !!um?.erp_id,
             temMarcacaoPrincipal: !!um && um.principal !== null };
  }

  if (cru.length === 0) {
    return { contatos: [], formato: 'vazio', chavesVistas: [],
             temIdEstavel: false, temMarcacaoPrincipal: false };
  }

  const contatos = cru.map(traduzirContato).filter(Boolean);
  const porReferencia = contatos.length > 0 && contatos.every((c) => c.referencia);

  return {
    contatos,
    formato: porReferencia ? 'referencias' : 'objetos',

    // A união do que foi visto em todos: contato incompleto não pode
    // esconder um campo que existe nos outros.
    chavesVistas: [...new Set(contatos.flatMap((c) => c.chavesVistas))].sort(),

    // As duas perguntas que decidem a modelagem da Fase 3: dá para
    // amarrar a avaliação da CX a um id, ou vai ter que ser pelo e-mail?
    temIdEstavel: contatos.length > 0 && contatos.every((c) => !!c.erp_id),
    temMarcacaoPrincipal: contatos.some((c) => c.principal !== null)
  };
}

/* ==========================================================================
   A CONTA INTEIRA — identidade, pessoas e endereço de UM cliente

   `GET /customers/{id}` EXISTE — confirmado na documentação do hub em
   15/09/2026, com `hub:customers:read` e `fields` obrigatório, os mesmos
   da listagem. É o caminho principal.

   O fallback pela listagem filtrada por `document` continua aqui de
   propósito, e não é desperdício: é o caminho para o cliente que tem
   CNPJ no CRM mas ainda não tem `erp_id` gravado, e é a rede de
   segurança se a rota de detalhe mudar. `document` é correspondência
   exata documentada e já roda em produção na trava da conversão.

   O caminho usado vem no `via`, para que a escolha apareça em vez de
   ficar escondida num catch.

   CAMPOS DISPONÍVEIS, conforme a doc: id, nid, status, tradingName,
   companyName, document, email, phone1, segment, branch, category,
   classification, contacts, addresses, contractedAt, createdAt,
   updatedAt. `segment`, `branch` e `category` são ObjectId de outras
   coleções — ficam de fora até alguma tela precisar deles.
   ========================================================================== */

/**
 * Uma conta do hub, com as pessoas junto.
 *
 * @param {object} env
 * @param {{erpId?: string, documento?: string}} chaves
 */
export async function buscarContaDoHub(env, { erpId = null, documento = null } = {}) {
  let bruto = null;
  let via = null;

  if (erpId) {
    try {
      const corpo = await pedirAoHub(env, '/customers/' + encodeURIComponent(erpId), {
        fields: CAMPOS_CLIENTE_DETALHE
      });

      // A rota de detalhe pode devolver o objeto direto, ou embrulhado
      // em `data` como a listagem. Aceitamos as duas formas.
      const candidato = Array.isArray(corpo?.data) ? corpo.data[0] : (corpo?.data || corpo);
      if (candidato && (candidato.id || candidato._id)) {
        bruto = candidato;
        via = 'detalhe';
      }
    } catch (e) {
      // 404 é "esta rota não existe" e 400 é "não gostei destes
      // parâmetros": os dois significam tentar o outro caminho. 401, 403
      // e hub fora do ar são outra conversa e sobem — quem chama precisa
      // saber que NÃO PERGUNTOU, em vez de receber null como se fosse
      // "perguntei e não achei".
      const tentarOutro = e instanceof ErroHub && (e.status === 404 || e.status === 400);
      if (!tentarOutro) throw e;
    }
  }

  if (!bruto && documento) {
    bruto = await acharClienteBrutoPorCnpj(env, documento, CAMPOS_CLIENTE_DETALHE);
    if (bruto) via = 'listagem-por-documento';
  }

  if (!bruto) return null;

  return {
    cliente: traduzirCliente(bruto),
    contatos: lerContatos(bruto),
    bruto,
    via
  };
}

/* ==========================================================================
   OS NÚCLEOS ATENDIDOS

   Decidido com o usuário em 15/09/2026: no Dossiê de Experiência,
   núcleo é o TIME — o agrupamento interno da Formatar (Governança,
   Operações).

   ATENÇÃO, e o manual deste lote precisa repetir isto: no Plano de Ação,
   na carteira e na numeração das ações, "núcleo" continua sendo o TIPO
   DE REUNIÃO (Logística, Estoque, Conselho Gestor). São dois níveis
   diferentes com o mesmo apelido em telas diferentes. Por isso cada
   núcleo devolvido aqui carrega, junto, os tipos de reunião que o
   compõem: é o que permite reconciliar as duas telas sem adivinhação.

   O CAMINHO É PELAS REUNIÕES, não pelas carteiras. A carteira seria a
   fonte canônica — ela é cliente + tipo de reunião, e existe mesmo antes
   da primeira reunião acontecer —, mas hub:portfolios:read é justamente
   a única permissão que ainda falta na chave. Reunião, tipo de reunião e
   time já estão concedidos, então este caminho funciona HOJE. Quando a
   carteira destravar, ela entra como acréscimo.
   ========================================================================== */

/**
 * Os núcleos (Times) que a Formatar atende num cliente.
 *
 * Nunca devolve lista pelada: o `consultado` diz se dá para afirmar
 * alguma coisa, e `fontes` diz qual das três consultas falhou quando não
 * dá. Lista vazia com `consultado: true` é "este cliente não tem reunião
 * nenhuma" — resposta legítima, e diferente de "não sei".
 */
export async function nucleosDoCliente(env, clienteErpId, { maxPaginas = 10 } = {}) {
  const naoConsultado = (motivo, fontes = {}) => ({
    consultado: false, motivo, nucleos: [], semTime: [],
    totalReunioesRealizadas: null, registraParticipantes: false,
    fontes, truncado: false
  });

  if (!clienteErpId) {
    return naoConsultado('O cliente não tem vínculo com o ERP (sem erp_id).');
  }

  // As três em paralelo: uma falha não impede as outras de responderem,
  // e é o conjunto que diz onde exatamente o caminho quebrou.
  const [reunioes, tipos, times] = await Promise.all([
    consultarHub('reuniões', () => listarReunioes(env, {
      clienteErpId, status: null, maxPaginas
    })),
    consultarHub('tipos de reunião', () => mapaDeTiposDeReuniao(env)),
    consultarHub('times', () => mapaDeTimes(env))
  ]);

  const fontes = { reunioes, tiposDeReuniao: tipos, times };

  // Nomear um Time exige as três. Sem qualquer uma delas, a resposta
  // honesta é "não consultei" — e NÃO uma lista parcial, que na tela
  // seria lida como a lista inteira.
  if (!reunioes.consultado || !tipos.consultado || !times.consultado) {
    const quem = [reunioes, tipos, times].filter((f) => !f.consultado);
    const lista = quem.map((f) => f.rotulo).join(', ');
    return naoConsultado('Não foi possível ler ' + lista + ' no ERP.', fontes);
  }

  const todas = reunioes.dado.reunioes;
  const naoCanceladas = todas.filter((r) => !STATUS_CANCELADA.includes(r.status));

  const porTime = new Map();
  const semTime = new Map();

  for (const r of naoCanceladas) {
    const tipo = r.nucleoErpId ? tipos.dado.get(r.nucleoErpId) : null;

    // Tipo de reunião que saiu do cadastro do ERP, mas cujas reuniões
    // continuam existindo. Fica declarado em vez de sumir.
    if (!tipo || !tipo.timeErpId) {
      const chave = r.nucleoErpId || 'sem-tipo';
      if (!semTime.has(chave)) {
        semTime.set(chave, {
          erp_id: r.nucleoErpId || null, nome: tipo ? tipo.nome : null, reunioes: 0
        });
      }
      semTime.get(chave).reunioes++;
      continue;
    }

    const time = times.dado.get(tipo.timeErpId);
    const chave = tipo.timeErpId;

    if (!porTime.has(chave)) {
      porTime.set(chave, {
        erp_id: chave,
        nome: time ? time.nome : null,
        ativo: time ? time.ativo !== false : null,
        tiposDeReuniao: new Map(),
        participantesCliente: new Map(),
        reunioesRealizadas: 0,
        reunioesPrevistas: 0,
        ultimaReuniao: null
      });
    }

    const n = porTime.get(chave);
    if (!n.tiposDeReuniao.has(tipo.erp_id)) {
      n.tiposDeReuniao.set(tipo.erp_id, { erp_id: tipo.erp_id, nome: tipo.nome });
    }

    // Quem do lado do CLIENTE esteve nas reuniões deste núcleo.
    //
    // É daqui que sai a ligação pessoa × núcleo, e ela não existe em
    // lugar nenhum do cadastro: o ERP não pergunta "de qual frente esta
    // pessoa participa", mas registra quem sentou em cada reunião — que
    // é a mesma informação, só que apurada em vez de declarada.
    //
    // `customerParticipants` tem forma desconhecida, como o `contacts`.
    // Reusamos o mesmo tradutor tolerante em vez de inventar um segundo.
    for (const bruto of r.participantesCliente) {
      const pessoa = traduzirContato(bruto);
      if (!pessoa) continue;
      const id = pessoa.erp_id || pessoa.email || pessoa.nome;
      if (id && !n.participantesCliente.has(id)) n.participantesCliente.set(id, pessoa);
    }

    if (r.status === STATUS_REALIZADA) {
      n.reunioesRealizadas++;
      // A listagem já vem em startDate descendente, mas não dependemos
      // disso: comparar é barato e sobrevive a uma mudança no hub.
      if (!n.ultimaReuniao || String(r.inicio) > String(n.ultimaReuniao)) {
        n.ultimaReuniao = r.inicio;
      }
    } else {
      n.reunioesPrevistas++;
    }
  }

  const nucleos = [...porTime.values()]
    .map((n) => ({
      ...n,
      tiposDeReuniao: [...n.tiposDeReuniao.values()],
      participantesCliente: [...n.participantesCliente.values()]
    }))
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

  // O ERP REGISTRA participante de cliente, ou simplesmente não usa esse
  // campo? A diferença decide se "núcleo sem ninguém" é uma conclusão ou
  // um palpite: onde ninguém aparece em lugar nenhum, o vazio é do
  // registro, não da relação. Uma ocorrência em qualquer núcleo já
  // prova que o campo é usado — e aí o núcleo vazio passa a significar
  // alguma coisa.
  const registraParticipantes = nucleos.some((n) => n.participantesCliente.length > 0);

  return {
    consultado: true,
    motivo: null,
    nucleos,
    semTime: [...semTime.values()],

    // Um cliente pode ter carteira aberta e nenhuma reunião ainda. Quem
    // imprime precisa distinguir isso de "não atendemos ninguém aqui".
    totalReunioesRealizadas: todas.filter((r) => r.status === STATUS_REALIZADA).length,
    registraParticipantes,
    fontes,
    truncado: !!reunioes.dado.truncado
  };
}
