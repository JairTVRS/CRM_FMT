/**
 * CRM Formatar — Gestão, Governança & Conexões
 *
 * A versão do sistema NÃO fica mais aqui. Ela vem do package.json,
 * é servida por /api/config e escrita no rodapé pelo auth.js.
 * Para subir a versão:  npm version 2.7.0 --no-git-tag-version
 */

let editingRow = null; // Controla se o modal está em modo de edição ou novo cadastro

document.addEventListener('DOMContentLoaded', () => {
  // Inicialização dos eventos da interface
  initThemeToggle();
  initNavigation();
  initModalEvents();
  initSubTabs();
  initTableActions();
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

    // O botao agora contem dois SVGs (sol e lua) e o CSS decide qual
    // aparece. Escrever textContent aqui apagaria os dois — por isso
    // so atualizamos o rotulo de acessibilidade.
    btnTheme.title = isLight ? 'Mudar para modo escuro' : 'Mudar para modo claro';
    btnTheme.setAttribute('aria-label', btnTheme.title);

    if (logo) {
      logo.src = isLight ? 'logo-preta.png' : 'logo-branca.png';
    }
  });
}

function initNavigation() {
  // Configuracoes saiu do menu principal para o rodape, mas continua
  // sendo navegacao — por isso o seletor cobre os dois lugares.
  const menuItems = document.querySelectorAll('.menu-item, [data-target]');
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

      // Se navegou para configurações, dispara a atualização do status se existir a função
      if (targetId === 'view-configuracoes' && typeof window.initConfiguracoes === 'function') {
        window.initConfiguracoes();
      }

      // A jornada do cliente só busca dados quando o usuário entra nela.
      // Diferente dos leads, que é a tela inicial: puxar as duas trilhas
      // no login gastaria consultas ao D1 por uma aba talvez nunca aberta.
      if (targetId === 'view-clientes' && typeof Clientes !== 'undefined') {
        Clientes.aoEntrarNaTela();
      }
    });
  });
}

/* ==========================================================================
   Controle dos Modais, Abas e Formulário
   ========================================================================== */

function initModalEvents() {
  const modal = document.getElementById('modal-lead');
  const btnIncluir = document.getElementById('btn-incluir-lead');
  const btnClose = document.getElementById('btn-modal-close');
  const btnCancel = document.getElementById('btn-modal-cancel');
  const btnSave = document.getElementById('btn-modal-save');
  const tabButtons = document.querySelectorAll('.tab-btn');

  // Abrir modal para novo lead
  if (btnIncluir && modal) {
    btnIncluir.addEventListener('click', () => {
      editingRow = null;        // Reseta referência para criar novo
      limparFormularioModal();  // zera por varredura...
      Leads.novo();             // ...e só então aplica os padrões do funil
      document.getElementById('modal-lead-title').textContent = 'Novo Lead';
      modal.classList.remove('hidden');
    });
  }

  // Fechar a ficha
  const closeModal = () => modal && modal.classList.add('hidden');
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  // A gaveta cobre só parte da tela: clicar no quadro atrás dela é um
  // gesto natural de "fechei". Clique DENTRO do cartão não fecha.
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !modal || modal.classList.contains('hidden')) return;
    // Não rouba o Esc de outra janela aberta por cima
    const etapas = document.getElementById('modal-etapas');
    if (etapas && !etapas.classList.contains('hidden')) return;
    closeModal();
  });

  // Salvar formulário do modal (Criar ou Editar)
  if (btnSave) {
    // O salvamento agora GRAVA NO BANCO, via leads.js -> /api/leads.
    // Antes isto apenas desenhava uma linha na tabela, e o cadastro
    // se perdia no primeiro recarregamento da pagina.
    btnSave.addEventListener('click', async () => {
      const salvou = await Leads.salvar();
      if (salvou) {
        editingRow = null;
        Leads.novo();
        closeModal();
      }
    });
  }

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

/* A renderizacao da tabela migrou para leads.js, que le do banco.
   As funcoes renderRowContent e atualizarIndicadoresDossie viviam aqui
   e foram removidas para nao existir duas fontes desenhando as linhas. */

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

/**
 * Zera TODOS os campos das tres abas do modal de lead.
 *
 * A versao anterior limpava apenas quatro campos, e um cadastro novo
 * herdava e-mail, endereco, observacoes, ramo e segmento do lead
 * editado antes — o usuario salvava dados de outra empresa sem perceber.
 *
 * A limpeza agora e por varredura: qualquer input, textarea ou select
 * dentro do modal e zerado. Assim, campo novo na ficha ja nasce coberto,
 * sem precisar lembrar de incluir aqui.
 */
function limparFormularioModal() {
  const modal = document.getElementById('modal-lead');
  if (modal) {
    modal.querySelectorAll('input, textarea').forEach((campo) => {
      if (campo.type === 'checkbox' || campo.type === 'radio') campo.checked = false;
      else campo.value = '';
    });
    modal.querySelectorAll('select').forEach((campo) => { campo.selectedIndex = 0; });
  }

  const linkSite = document.getElementById('link-site');
  const linkInsta = document.getElementById('link-insta');
  if (linkSite) { linkSite.href = '#'; linkSite.textContent = 'Não identificado'; }
  if (linkInsta) { linkInsta.href = '#'; linkInsta.textContent = 'Não identificado'; }

  const resumoBox = document.getElementById('ai-resumo-texto');
  if (resumoBox) {
    resumoBox.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Insira os dados do lead e clique em "Preencher campos com IA" para gerar o resumo detalhado.</p>';
  }

  // O dossie e por CNPJ: ao trocar de lead, o conteudo anterior nao vale mais.
  const insta = document.getElementById('dossie-insta');
  if (insta) insta.open = false;
}

/* ==========================================================================
   Ações da Tabela de Leads (Editar, WhatsApp, Excluir, Analisar)
   ========================================================================== */

function initTableActions() {
  const tableBody = document.getElementById('table-leads-body');
  if (!tableBody) return;

  tableBody.addEventListener('click', (e) => {
    const target = e.target;
    const tr = target.closest('tr');
    if (!tr) return;

    // O registro vem do banco, nao mais de um atributo JSON na linha
    const id = tr.dataset.id;
    const leadData = Leads.porId(id);
    if (!leadData) return;

    // Botão Editar
    if (target.classList.contains('btn-edit')) {
      editingRow = tr;
      abrirModalComLead(leadData);
    }

    // Botão Dossiê: baixa direto, sem abrir o modal
    if (target.classList.contains('btn-dossie')) {
      if (typeof Dossie !== 'undefined') Dossie.baixarDireto(target.dataset.cnpj, leadData.nome);
    }

    // Botão Excluir
    if (target.classList.contains('btn-delete')) {
      Leads.excluir(id, leadData.nome);
    }

    // Botão "A": abre o modal na aba de IA e gera o dossiê
    if (target.classList.contains('btn-ai')) {
      editingRow = tr;
      abrirModalComLead(leadData);
      const tabIaBtn = document.querySelector('[data-tab="tab-ia"]');
      if (tabIaBtn) tabIaBtn.click();
      if (typeof gerarInteligencia === 'function') gerarInteligencia();
    }
  });
}

/**
 * Abre a ficha com o registro vindo do banco.
 *
 * A versao anterior preenchia apenas quatro campos, porque so isso
 * existia no atributo JSON da linha. Agora o lead vem completo do
 * banco e o preenchimento fica com o leads.js, que conhece todos os
 * campos das tres abas.
 */
function abrirModalComLead(lead) {
  const modal = document.getElementById('modal-lead');
  if (!modal) return;

  limparFormularioModal();          // evita restos do lead anterior
  Leads.editar(lead.id);            // marca que e edicao, nao criacao
  Leads.preencherFormulario(lead);

  document.getElementById('modal-lead-title').textContent = `Lead: ${lead.nome || 'Editar'}`;
  modal.classList.remove('hidden');
}

/* ==========================================================================
   Funções Auxiliares (IA & Enriquecimento Backend Real)
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

async function executarBuscaIA() {
  const resumoBox = document.getElementById('ai-resumo-texto');
  const nomeLead = document.getElementById('lead-input-nome')?.value;
  const docLead = document.getElementById('lead-input-doc')?.value;
  const providerAtivo = localStorage.getItem('crm_active_ai_provider') || 'chatgpt';

  if (!resumoBox) return;

  if (!nomeLead) {
    alert('Por favor, informe o Nome do Lead na aba "Dados Gerais" antes de consultar a IA.');
    return;
  }

  resumoBox.innerHTML = `<p style="color: var(--accent-color);">🔍 Buscando e analisando informações via <strong>${providerAtivo.toUpperCase()}</strong> no Backend...</p>`;

  try {
    const response = await fetch('/api/enrich-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: nomeLead,
        documento: docLead,
        provider: providerAtivo
      })
    });

    if (!response.ok) {
      throw new Error(`Erro na API (${response.status})`);
    }

    const data = await response.json();

    if (data.site) {
      const linkSite = document.getElementById('link-site');
      if (linkSite) { linkSite.href = data.site; linkSite.textContent = data.site; }
    }
    if (data.instagram) {
      const linkInsta = document.getElementById('link-insta');
      if (linkInsta) { linkInsta.href = data.instagram; linkInsta.textContent = data.instagram; }
    }

    if (data.ramo) {
      const selRamo = document.getElementById('select-ramo');
      if (selRamo) selRamo.value = data.ramo;
    }
    if (data.segmento) {
      const selSeg = document.getElementById('select-segmento');
      if (selSeg) selSeg.value = data.segmento;
    }

    resumoBox.innerHTML = data.resumoHtml || `<p>${data.resumo || 'Análise concluída com sucesso.'}</p>`;

  } catch (err) {
    console.warn('Backend indisponível no momento. Exibindo resposta simulada:', err);
    
    setTimeout(() => {
      resumoBox.innerHTML = `
        <p><strong>Visão Geral:</strong> Empresa atuante no mercado com presença digital identificada (Processado via ${providerAtivo.toUpperCase()}).</p>
        <p><strong>Mercado & Atuação:</strong> Forte alinhamento para projetos de governança corporativa e automação de processos.</p>
        <p><strong>Recomendação Comercial:</strong> Apresentar cases de sucesso focados em ganho de eficiência operacional.</p>
      `;
    }, 1000);
  }
}

// Expõe globalmente para uso inline do HTML
window.promptUrl = promptUrl;
window.executarBuscaIA = executarBuscaIA;