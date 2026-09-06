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

  if (url.pathname !== '/v1/users' && url.pathname !== '/v1/customers') {
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
