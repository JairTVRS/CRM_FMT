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
 * A PERMISSÃO NECESSÁRIA é `hub:customers:read`, conforme a documentação
 * do endpoint. A chave que hoje valida usuários tem apenas
 * `hub:users:read` — com ela, o hub responde **403** e o CRM mostra
 * exatamente isso na tela, em vez de uma lista vazia sem explicação.
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

function traduzirStatus(status, corpoTexto) {
  if (status === 401) {
    return new ErroHub('HUB_CREDENCIAL',
      'A chave do hub está ausente, inválida ou inativa.', status);
  }
  if (status === 403) {
    // O caso mais provável hoje, e o mais importante de nomear: a chave
    // existe e funciona, mas não tem `hub:customers:read`.
    return new ErroHub('HUB_SEM_PERMISSAO',
      'A chave do hub não tem a permissão hub:customers:read (ou o IP de origem está bloqueado).', status);
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
    throw traduzirStatus(resposta.status, detalhe);
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
