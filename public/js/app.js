/**
 * CRM Formatar — Gestão, Governança & Conexões
 * Versão do Sistema: v2.5.20
 */

const APP_VERSION = 'v2.5.20';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Atualiza a versão dinamicamente no rodapé
  const versionEl = document.getElementById('app-version');
  if (versionEl) {
    versionEl.textContent = APP_VERSION;
  }

  // 2. Inicialização dos eventos da interface
  initThemeToggle();
  initNavigation();
  initModalEvents();
  initSubTabs();
});

/* ==========================================================================
   Navegação e Alternância de Temas
   ========================================================================== */

function initThemeToggle() {
  const btnTheme = document.getElementById('btn-theme');
  const logo = document.getElementById('brand-logo');

  if (!btnTheme) return;

  btnTheme.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    document.documentElement.classList.toggle('light-theme');

    const isLight = document.body.classList.contains('light-theme');
    btnTheme.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';

    if (logo) {
      logo.src = isLight ? 'logo-preta.png' : 'logo-branca.png';
    }
  });
}

function initNavigation() {
  const menuItems = document.querySelectorAll('.menu-item');
  const sections = document.querySelectorAll('.content-body');

  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = item.getAttribute('data-target');

      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      sections.forEach(sec => {
        if (sec.id === targetId) {
          sec.classList.remove('hidden');
        } else {
          sec.classList.add('hidden');
        }
      });
    });
  });
}

/* ==========================================================================
   Controle dos Modais e Abas
   ========================================================================== */

function initModalEvents() {
  const modal = document.getElementById('modal-lead');
  const btnIncluir = document.getElementById('btn-incluir-lead');
  const btnClose = document.getElementById('btn-modal-close');
  const btnCancel = document.getElementById('btn-modal-cancel');
  const tabButtons = document.querySelectorAll('.tab-btn');

  // Abrir modal
  if (btnIncluir && modal) {
    btnIncluir.addEventListener('click', () => {
      document.getElementById('modal-lead-title').textContent = 'Novo Lead';
      modal.classList.remove('hidden');
    });
  }

  // Fechar modal
  const closeModal = () => modal && modal.classList.add('hidden');
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  // Troca de Abas Principais (Dados Gerais / IA)
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-content').forEach(content => {
        if (content.id === targetTab) {
          content.classList.remove('hidden');
        } else {
          content.classList.add('hidden');
        }
      });
    });
  });
}

function initSubTabs() {
  const subTabButtons = document.querySelectorAll('.subtab-btn');

  subTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetSubtab = btn.getAttribute('data-subtab');

      subTabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.subtab-content').forEach(content => {
        if (content.id === targetSubtab) {
          content.classList.remove('hidden');
        } else {
          content.classList.add('hidden');
        }
      });
    });
  });
}

/* ==========================================================================
   Funções Auxiliares (IA & Enriquecimento)
   ========================================================================== */

function promptUrl(tipo) {
  const novaUrl = prompt(`Informe a nova URL para ${tipo}:`);
  if (novaUrl) {
    const el = document.getElementById(tipo === 'site' ? 'link-site' : 'link-insta');
    if (el) {
      el.href = novaUrl;
      el.textContent = novaUrl;
    }
  }
}

function executarBuscaIA() {
  const resumoBox = document.getElementById('ai-resumo-texto');
  if (resumoBox) {
    resumoBox.innerHTML = '<p style="color: var(--accent-color);">Buscando e analisando informações com IA...</p>';
    
    // Simulação/Placeholder da chamada à API
    setTimeout(() => {
      resumoBox.innerHTML = `
        <p><strong>Visão Geral:</strong> Empresa atuante no mercado com presença digital estabelecida.</p>
        <p><strong>Mercado & Atuação:</strong> Identificada forte aderência aos serviços de gestão e governança corporativa.</p>
        <p><strong>Recomendação:</strong> Abordagem comercial focada em otimização de processos e estruturação interna.</p>
      `;
    }, 1500);
  }
}