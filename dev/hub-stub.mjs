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

const inativo = process.argv.includes('--inativo');
const semCadastro = process.argv.includes('--sem-cadastro');

const servidor = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORTA}`);

  const responder = (status, corpo) => {
    const texto = JSON.stringify(corpo);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(texto);
    console.log(`  ${status}  ${req.method} ${url.pathname}${url.search}  ->  ${texto.slice(0, 120)}`);
  };

  if (url.pathname !== '/v1/users') {
    return responder(404, { error: 'Rota não coberta pelo dublê.' });
  }

  // O hub real recusa sem Bearer. Manter a exigência aqui garante que um
  // erro de configuração do `.dev.vars` apareça como 401, e não como um
  // "funcionou" enganoso.
  if (!(req.headers.authorization || '').startsWith('Bearer ')) {
    return responder(401, { error: 'Sem credencial.' });
  }

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
  console.log('│');
  console.log(`│  Cadastrado: ${USUARIOS.map((u) => u.email).join(', ')}`);
  if (inativo) console.log('│  MODO: --inativo (responde isActive=false)');
  if (semCadastro) console.log('│  MODO: --sem-cadastro (responde lista vazia)');
  console.log('│');
  console.log('│  O login do Google continua sendo validado de verdade.');
  console.log('└───────────────────────────────────────────────────────────');
});
