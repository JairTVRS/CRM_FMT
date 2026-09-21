/**
 * auth.js — Login com Google (Google Identity Services) e guarda de sessão.
 *
 * Carregue ANTES de configuracoes.js, leads.js e app.js.
 *
 * Como funciona:
 *   1. Busca o Client ID em /api/config (rota pública).
 *   2. Mostra a tela de login e bloqueia o app até autenticar.
 *   3. Guarda o ID token e injeta "Authorization: Bearer <token>" em toda
 *      chamada para /api/* — por isso nenhum outro arquivo precisou mudar.
 *   4. O token do Google dura ~1h; renova sozinho antes de expirar.
 *   5. Desde a 2.27.0, o /api/me devolve também um cookie de sessão de 7
 *      dias (HttpOnly, assinado pelo servidor). Ao recarregar a página, o
 *      primeiro passo é perguntar ao /api/me SEM token: se o cookie vale,
 *      o app abre direto, sem passar pelo Google. Sem cookie — ou com o
 *      servidor sem SESSAO_SECRET — tudo segue como antes.
 *
 * IMPORTANTE: esconder a tela é só conforto visual. Quem realmente barra o
 * acesso é o _middleware.js no servidor, que revalida o token e o cadastro
 * a cada requisição.
 */

const Auth = (() => {
  let idToken = null;
  let expiraEm = 0;          // epoch em ms
  let usuario = null;
  let clientId = null;
  let renovando = false;
  let sessaoAte = 0;         // epoch em ms; 0 = sem sessão de cookie
  let googleIniciado = false;

  const MARGEM_RENOVACAO_MS = 5 * 60 * 1000; // renova 5 min antes de expirar

  /* ----------------------------------------------------------------
     Utilidades
     ---------------------------------------------------------------- */

  function decodificarPayload(token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(
        atob(base64).split('').map(c =>
          '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join('')
      ));
    } catch (e) {
      return null;
    }
  }

  function tokenValido() {
    return idToken && Date.now() < expiraEm - MARGEM_RENOVACAO_MS;
  }

  /** O cookie de 7 dias está valendo? A página não lê o cookie (HttpOnly):
   *  sabe da validade pelo que o /api/me respondeu. */
  function sessaoPorCookie() {
    return sessaoAte > Date.now();
  }

  /* ----------------------------------------------------------------
     Tela de login
     ---------------------------------------------------------------- */

  function mostrarLogin(mensagem) {
    const overlay = document.getElementById('auth-overlay');
    const app = document.querySelector('.app-layout');
    const aviso = document.getElementById('auth-mensagem');

    if (overlay) overlay.style.display = 'flex';
    if (app) app.style.display = 'none';

    if (aviso) {
      aviso.textContent = mensagem || '';
      aviso.style.display = mensagem ? 'block' : 'none';
    }
  }

  function mostrarApp() {
    const overlay = document.getElementById('auth-overlay');
    const app = document.querySelector('.app-layout');

    if (overlay) overlay.style.display = 'none';
    if (app) app.style.display = '';

    const alvo = document.getElementById('auth-usuario');
    if (alvo && usuario) {
      alvo.innerHTML = `
        ${usuario.foto ? `<img src="${usuario.foto}" alt="" class="auth-avatar">` : ''}
        <span class="auth-nome">${usuario.nome}</span>
        <button id="btn-logout" class="btn-logout" title="Sair">Sair</button>
      `;
      const btn = document.getElementById('btn-logout');
      if (btn) btn.addEventListener('click', sair);
    }
  }

  /* ----------------------------------------------------------------
     Fluxo do Google Identity Services
     ---------------------------------------------------------------- */

  async function carregarClientId() {
    const resposta = await fetch('/api/config');
    if (!resposta.ok) throw new Error('Não foi possível obter a configuração do servidor.');
    const dados = await resposta.json();

    // A configuração do servidor é a fonte única da versão. Publicamos
    // aqui porque o /api/config já é buscado no arranque — evita uma
    // segunda requisição só para exibir o rodapé.
    window.CRM_CONFIG = dados;
    aplicarVersao(dados);

    if (!dados.googleClientId) throw new Error('GOOGLE_CLIENT_ID não configurado no servidor.');
    return dados.googleClientId;
  }

  /**
   * Escreve a versão no rodapé. Em preview, mostra também o commit,
   * para não haver dúvida sobre qual build está no ar.
   */
  function aplicarVersao(config) {
    const alvo = document.getElementById('app-version');
    if (!alvo || !config.versao) return;

    const ehProducao = !config.ambiente || config.ambiente === 'main';
    alvo.textContent = ehProducao || !config.commit
      ? config.versao
      : `${config.versao} · ${config.ambiente}@${config.commit}`;

    if (config.commit) alvo.title = `commit ${config.commit}`;
  }

  /** Mostra a tela de login E garante o botão do Google nela. */
  function pedirLogin(mensagem) {
    mostrarLogin(mensagem);
    garantirGoogle();
  }

  function garantirGoogle() {
    if (googleIniciado || !clientId) return;
    if (window.google && window.google.accounts) iniciarGoogle();
    else window.addEventListener('load', iniciarGoogle, { once: true });
  }

  /** A resposta do /api/me vira sessão aberta, venha do Google ou do cookie. */
  function aceitarSessao(dados) {
    usuario = dados.usuario;
    const ate = dados.sessao && dados.sessao.ate ? Date.parse(dados.sessao.ate) : 0;
    sessaoAte = Number.isFinite(ate) ? ate : 0;
    mostrarApp();

    // Avisa o resto do app que a sessao esta valida.
    // Sem isto, modulos que carregam dados no DOMContentLoaded
    // disparam suas requisicoes ANTES de existir token, recebem
    // 401 e ficam presos numa mensagem de erro para sempre.
    document.dispatchEvent(new CustomEvent('crm:autenticado', {
      detail: { usuario }
    }));
  }

  function aoReceberCredencial(resposta) {
    idToken = resposta.credential;
    const payload = decodificarPayload(idToken);
    expiraEm = payload && payload.exp ? payload.exp * 1000 : Date.now() + 3600 * 1000;
    renovando = false;
    verificarAcesso();
  }

  function iniciarGoogle() {
    if (googleIniciado) return;
    if (!window.google || !window.google.accounts) {
      mostrarLogin('Não foi possível carregar o Login do Google. Verifique sua conexão.');
      return;
    }

    googleIniciado = true;
    google.accounts.id.initialize({
      client_id: clientId,
      callback: aoReceberCredencial,
      auto_select: true,
      cancel_on_tap_outside: false
    });

    const botao = document.getElementById('google-signin-button');
    if (botao) {
      google.accounts.id.renderButton(botao, {
        theme: 'filled_blue',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        locale: 'pt-BR'
      });
    }

    // One Tap: reaproveita a sessão do Google se já houver
    google.accounts.id.prompt();
  }

  function renovarToken() {
    if (renovando || !window.google || !googleIniciado) return;
    renovando = true;
    // Se o One Tap não aparecer (cooldown do Google, janela fechada), o
    // `renovando` ficava `true` para sempre e nunca mais se tentava.
    google.accounts.id.prompt((aviso) => {
      if (aviso.isNotDisplayed() || aviso.isSkippedMoment() || aviso.isDismissedMoment()) {
        renovando = false;
      }
    });
  }

  /* ----------------------------------------------------------------
     Verificação de acesso contra o servidor
     ---------------------------------------------------------------- */

  async function verificarAcesso() {
    try {
      const resposta = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });

      if (resposta.ok) {
        aceitarSessao(await resposta.json());
        return true;
      }

      const erro = await resposta.json().catch(() => ({}));

      // 403 = autenticou no Google, mas não tem cadastro ativo no hub.
      // Não adianta tentar de novo: derruba a sessão e explica.
      if (resposta.status === 403) {
        idToken = null;
        mostrarLogin(erro.error || 'Seu acesso ao CRM não está liberado.');
        if (window.google) google.accounts.id.disableAutoSelect();
        return false;
      }

      idToken = null;
      mostrarLogin(erro.error || 'Não foi possível validar sua sessão.');
      return false;

    } catch (e) {
      mostrarLogin('Servidor indisponível no momento. Tente novamente.');
      return false;
    }
  }

  function sair() {
    idToken = null;
    usuario = null;
    expiraEm = 0;
    sessaoAte = 0;
    // O cookie é HttpOnly: só o servidor consegue apagá-lo.
    fetchOriginal('/api/sair', { method: 'POST' }).catch(() => {});
    if (window.google) google.accounts.id.disableAutoSelect();
    pedirLogin('Sessão encerrada.');
  }

  /* ----------------------------------------------------------------
     Interceptação global do fetch
     ---------------------------------------------------------------- */

  /**
   * Os codigos que significam "esta SESSAO nao vale mais".
   *
   * Sao os quatro do _middleware.js, e so eles. Ate a v2.22.0 QUALQUER
   * 401 ou 403 derrubava a sessao, e isso confundia duas coisas
   * diferentes:
   *
   *   - "voce nao tem acesso"      -> problema do usuario, expulsar e certo
   *   - "a CHAVE do hub nao tem"   -> problema de configuracao do servidor
   *
   * O segundo caso derrubava o usuario de verdade: abrir o Plano de Acao
   * sem `hub:portfolios:read` mostrava o erro do HUB na tela de LOGIN,
   * como se o acesso da pessoa tivesse sido revogado. Ela reentrava,
   * abria a tela de novo e caia de novo -- e nada no CRM explicava por
   * que. Foi o que aconteceu em 07/09/2026.
   */
  const CODIGOS_DE_SESSAO = new Set([
    'TOKEN_AUSENTE', 'TOKEN_INVALIDO', 'SEM_CADASTRO', 'INATIVO'
  ]);

  const fetchOriginal = window.fetch.bind(window);

  window.fetch = async function (recurso, opcoes = {}) {
    const url = typeof recurso === 'string' ? recurso : (recurso && recurso.url) || '';
    const ehApiInterna = url.startsWith('/api/') || url.includes('/api/');
    const ehRotaPublica = url.includes('/api/config') || url.includes('/api/sair');

    if (!ehApiInterna || ehRotaPublica) {
      return fetchOriginal(recurso, opcoes);
    }

    // Token perto de expirar: tenta renovar antes de seguir. Com o cookie
    // de 7 dias valendo, não há o que renovar — ele cobre a requisição.
    if (idToken && !tokenValido() && !sessaoPorCookie()) renovarToken();

    const usarToken = idToken && Date.now() < expiraEm;

    if (!usarToken && !sessaoPorCookie()) {
      pedirLogin('Faça login para continuar.');
      return new Response(
        JSON.stringify({ error: 'Sessão não iniciada.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Sem token, a requisição segue sem Authorization e o cookie (mesma
    // origem, Path=/api) leva a sessão.
    const cabecalhos = new Headers(opcoes.headers || {});
    if (usarToken) cabecalhos.set('Authorization', `Bearer ${idToken}`);

    const resposta = await fetchOriginal(recurso, { ...opcoes, headers: cabecalhos });

    // Sessão caiu ou acesso revogado no meio do uso
    if (resposta.status === 401 || resposta.status === 403) {
      const copia = resposta.clone();
      const erro = await copia.json().catch(() => ({}));

      // Um 401 SEM codigo ainda e sessao: e o que o servidor responde
      // quando o token nem chega a ser lido. Um 403 sem codigo, nao --
      // na duvida, manter a pessoa dentro do app e o erro barato. A
      // requisicao falhou de qualquer jeito, e a tela que a pediu ja
      // sabe mostrar o aviso; expulsar por engano custa o trabalho dela.
      const ehSessao = CODIGOS_DE_SESSAO.has(erro.code)
        || (resposta.status === 401 && !erro.code);

      if (ehSessao) {
        idToken = null;
        sessaoAte = 0;
        pedirLogin(erro.error || 'Sua sessão expirou. Entre novamente.');
      }
    }

    return resposta;
  };

  /* ----------------------------------------------------------------
     Inicialização
     ---------------------------------------------------------------- */

  async function iniciar() {
    mostrarLogin('');
    try {
      clientId = await carregarClientId();
    } catch (e) {
      mostrarLogin(e.message);
      return;
    }

    // Primeiro, a sessão de 7 dias: o /api/me sem token, só com o cookie.
    // Se valer, o app abre sem passar pelo Google — é o que faz o F5 não
    // derrubar mais ninguém.
    try {
      const resposta = await fetchOriginal('/api/me');
      if (resposta.ok) {
        aceitarSessao(await resposta.json());
        return;
      }
    } catch (e) { /* sem rede: cai no login, que explica */ }

    garantirGoogle();
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return {
    get usuario() { return usuario; },
    get autenticado() { return !!idToken || sessaoPorCookie(); },
    sair
  };
})();
