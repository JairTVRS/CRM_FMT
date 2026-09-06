/**
 * ############################################################
 * #  FERRAMENTA DE DESENVOLVIMENTO — NUNCA VAI PARA O AR.    #
 * ############################################################
 *
 * Dublê do endpoint /v1/users do hub da Formatar, para uso local.
 *
 * POR QUE EXISTE
 * --------------
 * O middleware pergunta ao hub, a cada requisição, se o e-mail que
 * acabou de fazer login está ativo no ERP. Essa chamada exige a
 * `HUB_API_KEY`, que é cadastrada como Secret na Cloudflare — e segredo
 * lá é de mão única: grava e nunca devolve. O hub também não emite chave
 * por autoatendimento. Resultado: sem este dublê, nenhuma rota protegida
 * sobe na máquina do desenvolvedor.
 *
 * O QUE ELE **NÃO** FAZ
 * ---------------------
 * Não desliga autenticação. O `_middleware.js` continua validando o ID
 * token do Google por inteiro — assinatura RS256 contra o JWKS do
 * Google, `aud`, `iss`, `exp` e e-mail verificado. Você precisa fazer
 * login de verdade com a sua conta Google. O que este arquivo responde é
 * só a pergunta seguinte: "este e-mail consta como ativo no ERP?".
 *
 * POR QUE É SEGURO ESTAR NO REPOSITÓRIO
 * -------------------------------------
 * O Cloudflare Pages publica `public/` e executa `functions/`. A pasta
 * `dev/` não é nem uma nem outra: não é servida, não é empacotada, não
 * roda em produção. E o middleware só olha para cá se a variável
 * `HUB_USERS_URL` existir no ambiente — coisa que só o `.dev.vars`
 * local faz, e o `.dev.vars` não vai para o Git.
 *
 * Só escuta em 127.0.0.1, não em 0.0.0.0: nada fora da sua máquina
 * alcança este processo.
 *
 * COMO USAR
 * ---------
 *   1. Num terminal:   npm run dev:hub
 *   2. Noutro:         npm run dev
 *
 * Para simular um usuário barrado — e conferir se a tela trata bem —
 * rode com a conta que quiser negar:
 *   node dev/hub-stub.mjs --inativo
 *   node dev/hub-stub.mjs --sem-cadastro
 */

import { createServer } from 'node:http';

const PORTA = 8787;

/**
 * Quem este dublê considera cadastrado.
 *
 * A busca do middleware é textual e ele exige correspondência EXATA de
 * e-mail depois — então responder uma lista com um único usuário imita
 * fielmente o comportamento do hub.
 */
const USUARIOS = [
  { id: 1, name: 'Jair Tavares', email: 'jairdasilvatj@gmail.com', isActive: true }
];

/**
 * Clientes do dublê, no formato do `GET /customers` do hub real —
 * inclusive `size` e `data`, e os nomes em inglês que a API usa.
 *
 * Servem para exercitar os três estados que a Jornada distingue:
 *   - um que também existe no CRM (jornada definida)
 *   - dois que só existem no ERP (sem jornada)
 *   - um `inactive`, que o filtro padrão `status=active` deve esconder
 */
const CLIENTES = [
  { id: '507f1f77bcf86cd799439011', nid: 100, status: 'active',
    tradingName: 'Acme Indústria', companyName: 'Acme Indústria S.A.',
    document: '12345678000190', email: 'contato@acme.com.br', phone1: '31988888888',
    classification: 3, contractedAt: '2024-05-02T00:00:00.000Z' },

  { id: '507f1f77bcf86cd799439012', nid: 101, status: 'active',
    tradingName: 'Vale Verde', companyName: 'Comercial Vale Verde LTDA',
    document: '19131243000197', email: 'contato@valeverde.com.br', phone1: '34999990001',
    classification: 5, contractedAt: '2023-11-20T00:00:00.000Z' },

  { id: '507f1f77bcf86cd799439013', nid: 102, status: 'active',
    tradingName: 'Formatar', companyName: 'FORMATAR CONSULTORIA EMPRESARIAL LTDA',
    document: '07091149000172', email: 'jair@formatar.com.br', phone1: '37991752215',
    classification: 4, contractedAt: '2005-01-10T00:00:00.000Z' },

  { id: '507f1f77bcf86cd799439014', nid: 103, status: 'inactive',
    tradingName: 'Saiu Fora', companyName: 'Saiu Fora ME',
    document: '11222333000181', email: null, phone1: null,
    classification: 1, contractedAt: '2022-02-02T00:00:00.000Z' }
];


/**
 * Carteiras e reunioes do duble.
 *
 * Duas reunioes da MESMA carteira, para exercitar o que mais importa: a
 * ata mais recente manda, porque acao encerrada sai do plano.
 */
const CARTEIRAS = [
  { id: '607f1f77bcf86cd799439101', nid: 10,
    customer: '507f1f77bcf86cd799439012', meetingType: '707f1f77bcf86cd799439201',
    frequency: 'monthly', externalConsultant: '807f1f77bcf86cd799439301',
    internalConsultants: [], startDate: '2023-11-20T00:00:00.000Z', isActive: true },

  { id: '607f1f77bcf86cd799439102', nid: 11,
    customer: '507f1f77bcf86cd799439011', meetingType: '707f1f77bcf86cd799439202',
    frequency: 'biweekly', externalConsultant: null,
    internalConsultants: [], startDate: '2024-05-02T00:00:00.000Z', isActive: true }
];

/* A ata de agosto: a ACAO 1 ainda esta no plano. */
const ATA_ANTIGA = `Atas Comercial Vale Verde - LOGISTICA
20/08/26 - 09:00 - 10:30
Formatar: Jair Tavares, Marina Alves
Cliente: Roberto Nunes

1. Revisao do plano anterior.

Plano de acao:

ACAO 1: Implantar contagem ciclica semanal no CD
Resp.: Tiago Nunes
Prazo: 30/09/26
Status: Nova

ACAO 2: Revisar politica de estoque minimo
Resp.: Marina Alves
Prazo: 15/08/26
Status: Pendente desde 08/06/26`;

/* A de setembro: a ACAO 1 foi encerrada e SAIU do plano; entrou a 3.
   No fim, uma nota privada que nao pode vazar. */
const ATA_RECENTE = `Atas Comercial Vale Verde - LOGISTICA
03/09/26 - 09:00 - 10:00
Formatar: Jair Tavares
[PARTICIPANTES CLIENTE A CONFIRMAR].

1. A ACAO 1 foi concluida e sai do plano.

Plano de acao:

ACAO 2: Revisar politica de estoque minimo
Resp.: Marina Alves
Prazo: 15/08/26
Status: Pendente desde 08/06/26

ACAO 3: Contratar operador para o turno da noite
Resp.: Roberto Nunes
Prazo: 10/10/26
Status: Repactuado em 20/08/26

CLIENTE DEMONSTROU DESCONFORTO COM O CUSTO`;

const REUNIOES = [
  { id: '907f1f77bcf86cd799439401', nid: 88, title: 'Reuniao mensal Vale Verde',
    status: 'finished', customer: '507f1f77bcf86cd799439012',
    meetingType: '707f1f77bcf86cd799439201',
    startDate: '2026-09-03T12:00:00.000Z', endDate: '2026-09-03T13:00:00.000Z',
    durationInMinutes: 60, isDelayed: false, rescheduled: false,
    participants: [{ user: 'u1' }], customerParticipants: [],
    notes: ATA_RECENTE, technicalNotes: 'NOTA TECNICA QUE NAO PODE VAZAR' },

  { id: '907f1f77bcf86cd799439402', nid: 87, title: 'Reuniao mensal Vale Verde',
    status: 'finished', customer: '507f1f77bcf86cd799439012',
    meetingType: '707f1f77bcf86cd799439201',
    startDate: '2026-08-20T12:00:00.000Z', endDate: '2026-08-20T13:30:00.000Z',
    durationInMinutes: 90, isDelayed: false, rescheduled: false,
    participants: [{ user: 'u1' }, { user: 'u2' }],
    customerParticipants: [{ name: 'Roberto Nunes' }],
    notes: ATA_ANTIGA, technicalNotes: null },

  // Cancelada: nao tem ata e nao pode produzir acao.
  { id: '907f1f77bcf86cd799439403', nid: 86, title: 'Reuniao cancelada',
    status: 'canceled_by_customer', customer: '507f1f77bcf86cd799439012',
    meetingType: '707f1f77bcf86cd799439201',
    startDate: '2026-07-10T12:00:00.000Z', endDate: null,
    durationInMinutes: null, isDelayed: false, rescheduled: false,
    participants: [], customerParticipants: [], notes: null, technicalNotes: null }
];

/** Tipos de reuniao — os nucleos. `teams` e array de ObjectId. */
const TIPOS_REUNIAO = [
  { id: '707f1f77bcf86cd799439201', nid: 2, title: 'Logística',
    teams: ['807f1f77bcf86cd799439501'], isActive: true },
  { id: '707f1f77bcf86cd799439202', nid: 3, title: 'Estoque',
    teams: ['807f1f77bcf86cd799439501'], isActive: true },
  { id: '707f1f77bcf86cd799439203', nid: 4, title: 'Conselho Gestor',
    teams: ['807f1f77bcf86cd799439502'], isActive: true }
];

/** Times — o agrupamento interno da Formatar. */
const TIMES = [
  { id: '807f1f77bcf86cd799439501', nid: 3, title: 'Operações',
    responsible: '907f1f77bcf86cd799439601', isActive: true },
  { id: '807f1f77bcf86cd799439502', nid: 4, title: 'Governança',
    responsible: '907f1f77bcf86cd799439602', isActive: true }
];

const inativo = process.argv.includes('--inativo');
const semCadastro = process.argv.includes('--sem-cadastro');

/** `--sem-permissao` imita a chave sem `hub:customers:read`. */
const semPermissao = process.argv.includes('--sem-permissao');

const servidor = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORTA}`);

  const responder = (status, corpo) => {
    const texto = JSON.stringify(corpo);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(texto);
    console.log(`  ${status}  ${req.method} ${url.pathname}${url.search}  ->  ${texto.slice(0, 120)}`);
  };

  const ROTAS = ['/v1/users', '/v1/customers', '/v1/meetings',
                 '/v1/portfolios', '/v1/meeting-types', '/v1/teams'];
  if (!ROTAS.includes(url.pathname)) {
    return responder(404, { error: 'Rota não coberta pelo dublê.' });
  }

  // O hub real recusa sem Bearer. Manter a exigência aqui garante que um
  // erro de configuração do `.dev.vars` apareça como 401, e não como um
  // "funcionou" enganoso.
  if (!(req.headers.authorization || '').startsWith('Bearer ')) {
    return responder(401, { error: 'Sem credencial.' });
  }

  /* ---------------- Clientes ---------------- */
  if (url.pathname === '/v1/customers') {
    // O caso mais provável em produção hoje: a chave existe e funciona,
    // mas não tem escopo de clientes. Poder simulá-lo é o que permite
    // conferir se a tela explica o motivo em vez de ficar vazia.
    if (semPermissao) {
      return responder(403, { error: 'Sem permissão para esta operação.' });
    }

    // `fields` é obrigatório no hub real, e omiti-lo devolve 400. O dublê
    // exige o mesmo: um esquecimento tem que doer aqui, não em produção.
    if (!url.searchParams.get('fields')) {
      return responder(400, { error: 'API_FIELDS_VALIDATION: o parâmetro fields é obrigatório.' });
    }

    const documento = (url.searchParams.get('document') || '').replace(/\D/g, '');
    const status = (url.searchParams.get('status') || '').split(',').filter(Boolean);
    const busca = (url.searchParams.get('search') || '').toLowerCase();

    let lista = CLIENTES;
    if (documento) lista = lista.filter((c) => c.document === documento);
    if (status.length) lista = lista.filter((c) => status.includes(c.status));
    if (busca) {
      lista = lista.filter((c) =>
        `${c.companyName} ${c.tradingName} ${c.document} ${c.email || ''}`
          .toLowerCase().includes(busca));
    }

    // O dublê devolve tudo na página 1; a página 2 vem vazia, que é o
    // sinal de fim que o `listarClientesDoHub` usa para parar.
    const pagina = Number(url.searchParams.get('page') || 1);
    return responder(200, { size: lista.length, data: pagina > 1 ? [] : lista });
  }

  /* ---------------- Tipos de reunião e times ---------------- */
  if (url.pathname === '/v1/meeting-types' || url.pathname === '/v1/teams') {
    if (semPermissao) return responder(403, { error: 'Sem permissão para esta operação.' });
    if (!url.searchParams.get('fields')) {
      return responder(400, { error: 'API_FIELDS_VALIDATION: o parâmetro fields é obrigatório.' });
    }
    const lista = url.pathname === '/v1/teams' ? TIMES : TIPOS_REUNIAO;
    const pagina = Number(url.searchParams.get('page') || 1);
    return responder(200, { size: lista.length, data: pagina > 1 ? [] : lista });
  }

  /* ---------------- Carteiras e reuniões ---------------- */
  if (url.pathname === '/v1/portfolios' || url.pathname === '/v1/meetings') {
    if (semPermissao) {
      return responder(403, { error: 'Sem permissão para esta operação.' });
    }
    if (!url.searchParams.get('fields')) {
      return responder(400, { error: 'API_FIELDS_VALIDATION: o parâmetro fields é obrigatório.' });
    }

    const pagina = Number(url.searchParams.get('page') || 1);
    const cliente = url.searchParams.get('customer');
    const tipo = url.searchParams.get('meetingType');
    const status = (url.searchParams.get('status') || '').split(',').filter(Boolean);

    let lista = url.pathname === '/v1/portfolios' ? CARTEIRAS : REUNIOES;
    if (cliente) lista = lista.filter((x) => x.customer === cliente);
    if (tipo) lista = lista.filter((x) => x.meetingType === tipo);
    if (status.length) lista = lista.filter((x) => status.includes(x.status));

    // A ordenação padrão de reuniões é startDate DESCENDENTE.
    if (url.pathname === '/v1/meetings') {
      lista = [...lista].sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
    }

    return responder(200, { size: lista.length, data: pagina > 1 ? [] : lista });
  }

  /* ---------------- Usuários ---------------- */
  if (semCadastro) return responder(200, { data: [] });

  const busca = (url.searchParams.get('search') || '').toLowerCase();
  const achados = USUARIOS
    .filter((u) => u.email.toLowerCase().includes(busca))
    .map((u) => ({ ...u, isActive: inativo ? false : u.isActive }));

  responder(200, { data: achados });
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log('┌───────────────────────────────────────────────────────────');
  console.log('│  DUBLÊ DO HUB — só desenvolvimento local');
  console.log(`│  http://127.0.0.1:${PORTA}/v1/users`);
  console.log(`│  http://127.0.0.1:${PORTA}/v1/customers`);
  console.log(`│  http://127.0.0.1:${PORTA}/v1/meetings`);
  console.log(`│  http://127.0.0.1:${PORTA}/v1/portfolios`);
  console.log(`│  http://127.0.0.1:${PORTA}/v1/meeting-types`);
  console.log(`│  http://127.0.0.1:${PORTA}/v1/teams`);
  console.log('│');
  console.log(`│  Cadastrado: ${USUARIOS.map((u) => u.email).join(', ')}`);
  if (inativo) console.log('│  MODO: --inativo (responde isActive=false)');
  if (semCadastro) console.log('│  MODO: --sem-cadastro (responde lista vazia)');
  if (semPermissao) console.log('│  MODO: --sem-permissao (clientes respondem 403)');
  console.log(`│  Clientes no dublê: ${CLIENTES.length} (${CLIENTES.filter((c) => c.status === 'active').length} ativos)`);
  console.log('│');
  console.log('│  O login do Google continua sendo validado de verdade.');
  console.log('└───────────────────────────────────────────────────────────');
});
