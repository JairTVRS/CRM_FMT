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
    if (!dados.googleClientId) throw new Error('GOOGLE_CLIENT_ID não configurado no servidor.');
    return dados.googleClientId;
  }

  function aoReceberCredencial(resposta) {
    idToken = resposta.credential;
    const payload = decodificarPayload(idToken);
    expiraEm = payload && payload.exp ? payload.exp * 1000 : Date.now() + 3600 * 1000;
    renovando = false;
    verificarAcesso();
  }

  function iniciarGoogle() {
    if (!window.google || !window.google.accounts) {
      mostrarLogin('Não foi possível carregar o Login do Google. Verifique sua conexão.');
      return;
    }

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
    if (renovando || !window.google) return;
    renovando = true;
    google.accounts.id.prompt();
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
        const dados = await resposta.json();
        usuario = dados.usuario;
        mostrarApp();
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
    if (window.google) google.accounts.id.disableAutoSelect();
    mostrarLogin('Sessão encerrada.');
  }

  /* ----------------------------------------------------------------
     Interceptação global do fetch
     ---------------------------------------------------------------- */

  const fetchOriginal = window.fetch.bind(window);

  window.fetch = async function (recurso, opcoes = {}) {
    const url = typeof recurso === 'string' ? recurso : (recurso && recurso.url) || '';
    const ehApiInterna = url.startsWith('/api/') || url.includes('/api/');
    const ehRotaPublica = url.includes('/api/config');

    if (!ehApiInterna || ehRotaPublica) {
      return fetchOriginal(recurso, opcoes);
    }

    // Token perto de expirar: tenta renovar antes de seguir
    if (idToken && !tokenValido()) renovarToken();

    if (!idToken) {
      mostrarLogin('Faça login para continuar.');
      return new Response(
        JSON.stringify({ error: 'Sessão não iniciada.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cabecalhos = new Headers(opcoes.headers || {});
    cabecalhos.set('Authorization', `Bearer ${idToken}`);

    const resposta = await fetchOriginal(recurso, { ...opcoes, headers: cabecalhos });

    // Sessão caiu ou acesso revogado no meio do uso
    if (resposta.status === 401 || resposta.status === 403) {
      const copia = resposta.clone();
      const erro = await copia.json().catch(() => ({}));
      idToken = null;
      mostrarLogin(erro.error || 'Sua sessão expirou. Entre novamente.');
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

    if (window.google && window.google.accounts) {
      iniciarGoogle();
    } else {
      window.addEventListener('load', iniciarGoogle, { once: true });
    }
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return {
    get usuario() { return usuario; },
    get autenticado() { return !!idToken; },
    sair
  };
})();
