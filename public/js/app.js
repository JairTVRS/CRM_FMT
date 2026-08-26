/**
 * CRM Formatar — Gestão, Governança & Conexões
 * Versão do Sistema: v2.5.21
 */

const APP_VERSION = 'v2.5.21';
let editingRow = null; // Controla se o modal está em modo de edição ou novo cadastro

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

      // Se navegou para configurações, dispara a atualização do status se existir a função
      if (targetId === 'view-configuracoes' && typeof window.initConfiguracoes === 'function') {
        window.initConfiguracoes();
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
      editingRow = null; // Reseta referência para criar novo
      limparFormularioModal();
      document.getElementById('modal-lead-title').textContent = 'Novo Lead';
      modal.classList.remove('hidden');
    });
  }

  // Fechar modal
  const closeModal = () => modal && modal.classList.add('hidden');
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  // Salvar formulário do modal (Criar ou Editar)
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      const nome = document.getElementById('lead-input-nome')?.value;
      const doc = document.getElementById('lead-input-doc')?.value || '-';
      const phone = document.getElementById('lead-input-phone')?.value || '-';
      const origem = document.getElementById('lead-input-origem')?.value || 'Direto';

      if (!nome) {
        alert('Por favor, preencha ao menos o nome do lead.');
        return;
      }

      const cleanPhone = phone.replace(/\D/g, '');
      const waLink = cleanPhone ? `https://wa.me/55${cleanPhone}` : '#';
      const leadObj = { nome, doc, phone, origem };

      if (editingRow) {
        // MODO EDIÇÃO: Atualiza a linha existente
        editingRow.setAttribute('data-lead', JSON.stringify(leadObj));
        editingRow.innerHTML = renderRowContent(nome, doc, phone, origem, waLink);
      } else {
        // MODO CRIAÇÃO: Adiciona uma nova linha
        const tableBody = document.getElementById('table-leads-body');
        if (tableBody) {
          const tr = document.createElement('tr');
          tr.setAttribute('data-lead', JSON.stringify(leadObj));
          tr.innerHTML = renderRowContent(nome, doc, phone, origem, waLink);
          tableBody.appendChild(tr);
          if (typeof atualizarContadorTabela === 'function') {
            atualizarContadorTabela();
          }
        }
      }

      editingRow = null;
      closeModal();
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

function renderRowContent(nome, doc, phone, origem, waLink) {
  return `
    <td><strong>${nome}</strong></td>
    <td>${doc}</td>
    <td>${phone}</td>
    <td><span class="badge">${origem}</span></td>
    <td>-</td>
    <td>-</td>
    <td style="text-align: left;">
      <button class="btn-action btn-edit" title="Editar">✏️</button>
      <a href="${waLink}" target="_blank" class="btn-action btn-wa" title="WhatsApp" style="text-decoration: none; display: inline-block;">💬</a>
      <button class="btn-action btn-ai" title="Analisar com IA">A</button>
      <button class="btn-action btn-delete" title="Excluir">🗑️</button>
    </td>
  `;
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

function limparFormularioModal() {
  document.getElementById('lead-input-nome').value = '';
  document.getElementById('lead-input-doc').value = '';
  document.getElementById('lead-input-phone').value = '';
  document.getElementById('lead-input-origem').value = '';
  
  const linkSite = document.getElementById('link-site');
  const linkInsta = document.getElementById('link-insta');
  if (linkSite) { linkSite.href = '#'; linkSite.textContent = 'Não identificado'; }
  if (linkInsta) { linkInsta.href = '#'; linkInsta.textContent = 'Não identificado'; }
  
  const resumoBox = document.getElementById('ai-resumo-texto');
  if (resumoBox) {
    resumoBox.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Insira os dados do lead e clique em "Pesquisar na Internet com IA" para gerar o resumo detalhado.</p>';
  }
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

    const leadDataRaw = tr.getAttribute('data-lead');
    const leadData = leadDataRaw ? JSON.parse(leadDataRaw) : {};

    // Botão Editar
    if (target.classList.contains('btn-edit')) {
      editingRow = tr;
      abrirModalComLead(leadData);
    }

    // Botão Excluir
    if (target.classList.contains('btn-delete')) {
      if (confirm(`Deseja realmente excluir o lead "${leadData.nome || 'selecionado'}"?`)) {
        tr.remove();
        atualizarContadorTabela();
      }
    }

    // Botão Analisar com IA (A)
    if (target.classList.contains('btn-ai')) {
      editingRow = tr;
      abrirModalComLead(leadData);
      const tabIaBtn = document.querySelector('[data-tab="tab-ia"]');
      if (tabIaBtn) tabIaBtn.click();
      executarBuscaIA();
    }
  });
}

function abrirModalComLead(lead) {
  const modal = document.getElementById('modal-lead');
  if (!modal) return;

  document.getElementById('modal-lead-title').textContent = `Lead: ${lead.nome || 'Editar'}`;
  document.getElementById('lead-input-nome').value = lead.nome || '';
  document.getElementById('lead-input-doc').value = lead.doc || '';
  document.getElementById('lead-input-phone').value = lead.phone || '';
  document.getElementById('lead-input-origem').value = lead.origem || '';

  modal.classList.remove('hidden');
}

function atualizarContadorTabela() {
  const total = document.querySelectorAll('#table-leads-body tr').length;
  const countEl = document.getElementById('total-registros');
  if (countEl) {
    countEl.textContent = `Total de Registros: ${total}`;
  }
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