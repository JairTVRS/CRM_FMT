document.addEventListener('DOMContentLoaded', () => {
  console.log('Módulo de Leads carregado.');
  carregarRamosESegmentosFiltro();
  renderizarTabela();
  configurarEventosModal();
});

// Define a URL base da API dinamicamente
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : '';

// Estado da Aplicação para Paginação e Filtros
let paginaAtual = 1;
const itensPorPagina = 10;
let leadIdEmEdicao = null;

// --- GESTÃO DE LOCALSTORAGE E TABELA ---

function obterLeadsDoStorage() {
  const dados = localStorage.getItem('crm_leads_data');
  if (!dados) {
    const leadsIniciais = [
      {
        id: 1,
        nome: 'Empresa Exemplo LTDA',
        doc: '12.345.678/0001-90',
        phone: '(11) 99999-9999',
        origem: 'Indicação',
        ramo: 'TECNOLOGIA',
        segmento: 'SERVIÇOS',
        obs: 'Lead cadastrado para testes iniciais.',
        aiData: null
      }
    ];
    localStorage.setItem('crm_leads_data', JSON.stringify(leadsIniciais));
    return leadsIniciais;
  }
  return JSON.parse(dados);
}

function salvarLeadsNoStorage(leads) {
  localStorage.setItem('crm_leads_data', JSON.stringify(leads));
}

function renderizarTabela() {
  const tbody = document.getElementById('tabela-leads-body');
  const countEl = document.getElementById('total-registros');
  const paginaInfo = document.getElementById('pagina-info');
  const btnAnt = document.getElementById('btn-pag-anterior');
  const btnProx = document.getElementById('btn-pag-proxima');

  if (!tbody) return;

  let leads = obterLeadsDoStorage();

  // Filtros de busca
  const termo = document.getElementById('search-input')?.value.toLowerCase() || '';
  const ramoFiltro = document.getElementById('filter-ramo')?.value || '';
  const segmentoFiltro = document.getElementById('filter-segmento')?.value || '';

  leads = leads.filter(l => {
    const matchTermo = (l.nome || '').toLowerCase().includes(termo) ||
                       (l.doc || '').toLowerCase().includes(termo) ||
                       (l.phone || '').toLowerCase().includes(termo);
    const matchRamo = !ramoFiltro || l.ramo === ramoFiltro;
    const matchSegmento = !segmentoFiltro || l.segmento === segmentoFiltro;
    return matchTermo && matchRamo && matchSegmento;
  });

  if (countEl) countEl.textContent = `Total de Registros: ${leads.length}`;

  // Paginação
  const totalPaginas = Math.ceil(leads.length / itensPorPagina) || 1;
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  if (paginaAtual < 1) paginaAtual = 1;

  if (paginaInfo) paginaInfo.textContent = `Página ${paginaAtual} de ${totalPaginas}`;
  if (btnAnt) btnAnt.disabled = paginaAtual === 1;
  if (btnProx) btnProx.disabled = paginaAtual === totalPaginas;

  const inicio = (paginaAtual - 1) * itensPorPagina;
  const leadsPagina = leads.slice(inicio, inicio + itensPorPagina);

  tbody.innerHTML = '';

  if (leadsPagina.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 2rem;">Nenhum lead encontrado.</td></tr>`;
    return;
  }

  leadsPagina.forEach(lead => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${lead.nome || '-'}</strong></td>
      <td>${lead.doc || '-'}</td>
      <td>${lead.phone || '-'}</td>
      <td><span class="badge-origem">${lead.origem || 'Não especificada'}</span></td>
      <td>${lead.ramo || '-'}</td>
      <td>${lead.segmento || '-'}</td>
      <td>
        <button class="btn-action" title="Ficha / Editar Lead" onclick="abrirModalLead(${lead.id})">✏️</button>
        <button class="btn-action" title="Excluir Lead" onclick="excluirLead(${lead.id})">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function mudarPagina(delta) {
  paginaAtual += delta;
  renderizarTabela();
}

// --- MODAL & OPERAÇÕES DE LEAD ---

function abrirModalLead(id = null) {
  leadIdEmEdicao = id;
  const modal = document.getElementById('modal-lead');
  const titulo = document.getElementById('modal-titulo') || document.querySelector('#modal-lead h2');
  
  limparFormularioModal();
  trocarAbaModal('tab-dados');

  if (id) {
    const leads = obterLeadsDoStorage();
    const lead = leads.find(l => l.id === id);
    if (lead) {
      if (titulo) titulo.textContent = `Ficha do Lead: ${lead.nome}`;
      document.getElementById('lead-input-nome').value = lead.nome || '';
      document.getElementById('lead-input-doc').value = lead.doc || '';
      document.getElementById('lead-input-phone').value = lead.phone || '';
      document.getElementById('lead-input-origem').value = lead.origem || '';
      document.getElementById('lead-input-obs').value = lead.obs || '';
      
      const selectRamo = document.getElementById('select-ramo');
      const selectSegmento = document.getElementById('select-segmento');
      if (selectRamo) selectRamo.value = lead.ramo || '';
      if (selectSegmento) selectSegmento.value = lead.segmento || '';

      if (lead.aiData) {
        preencherDadosIA(lead.aiData);
      }
    }
  } else {
    if (titulo) titulo.textContent = 'Novo Lead';
  }

  if (modal) modal.classList.remove('hidden');
}

function fecharModal() {
  const modal = document.getElementById('modal-lead');
  if (modal) modal.classList.add('hidden');
  leadIdEmEdicao = null;
}

function limparFormularioModal() {
  const ids = ['lead-input-nome', 'lead-input-doc', 'lead-input-phone', 'lead-input-origem', 'lead-input-obs', 'select-ramo', 'select-segmento'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const linkSite = document.getElementById('link-site');
  const linkInsta = document.getElementById('link-insta');
  const resumoBox = document.getElementById('ai-resumo-texto');

  if (linkSite) { linkSite.href = '#'; linkSite.textContent = 'Não identificado'; }
  if (linkInsta) { linkInsta.href = '#'; linkInsta.textContent = 'Não identificado'; }
  if (resumoBox) { resumoBox.innerHTML = '<p class="text-muted">Nenhuma informação de IA gerada ainda. Clique em "Pesquisar na Internet com IA" para iniciar.</p>'; }
}

function salvarLead(event) {
  if (event) event.preventDefault();

  const nome = document.getElementById('lead-input-nome')?.value.trim();
  if (!nome) {
    alert('Por favor, informe ao menos o Nome / Razão Social.');
    return;
  }

  const doc = document.getElementById('lead-input-doc')?.value.trim() || '';
  const phone = document.getElementById('lead-input-phone')?.value.trim() || '';
  const origem = document.getElementById('lead-input-origem')?.value || '';
  const obs = document.getElementById('lead-input-obs')?.value.trim() || '';
  const ramo = document.getElementById('select-ramo')?.value || '';
  const segmento = document.getElementById('select-segmento')?.value || '';

  let leads = obterLeadsDoStorage();

  if (leadIdEmEdicao) {
    const index = leads.findIndex(l => l.id === leadIdEmEdicao);
    if (index !== -1) {
      leads[index] = {
        ...leads[index],
        nome, doc, phone, origem, obs, ramo, segmento
      };
    }
  } else {
    const novoLead = {
      id: Date.now(),
      nome, doc, phone, origem, obs, ramo, segmento,
      aiData: null
    };
    leads.unshift(novoLead);
  }

  salvarLeadsNoStorage(leads);
  alert(`Lead "${nome}" salvo com sucesso!`);
  fecharModal();
  renderizarTabela();
}

function excluirLead(id) {
  if (!confirm('Deseja realmente excluir este lead?')) return;
  let leads = obterLeadsDoStorage();
  leads = leads.filter(l => l.id !== id);
  salvarLeadsNoStorage(leads);
  renderizarTabela();
}

// --- CONTROLE DE ABAS DO MODAL ---

function configurarEventosModal() {
  const tabs = document.querySelectorAll('.modal-tabs .tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetId = e.target.getAttribute('data-tab');
      if (targetId) trocarAbaModal(targetId);
    });
  });
}

function trocarAbaModal(abaId) {
  const tabs = document.querySelectorAll('.modal-tabs .tab-btn');
  const contents = document.querySelectorAll('.modal-body .tab-content');

  tabs.forEach(t => {
    if (t.getAttribute('data-tab') === abaId) t.classList.add('active');
    else t.classList.remove('active');
  });

  contents.forEach(c => {
    if (c.id === abaId) c.classList.remove('hidden');
    else c.classList.add('hidden');
  });
}

// --- INTEGRAÇÃO COM IA (ENRICH LEAD) ---

async function executarBuscaIA(leadId) {
  const inputNome = document.getElementById('lead-input-nome');
  const modalTitulo = document.querySelector('.modal h2, #modal-titulo');
  
  let nome = inputNome?.value;
  if (!nome && modalTitulo) {
    nome = modalTitulo.textContent.replace('Ficha do Lead: ', '').trim();
  }

  const doc = document.getElementById('lead-input-doc')?.value || '';
  const phone = document.getElementById('lead-input-phone')?.value || '';

  if (!nome || nome === 'Novo Lead') {
    alert('Preencha ao menos o nome do lead para pesquisar.');
    return;
  }

  // Tenta recuperar o provedor selecionado nas configurações da aplicação
  const providerConfig = localStorage.getItem('crm_ai_provider') || 'deepseek';

  const btnBusca = document.querySelector('button[onclick*="executarBuscaIA"]') || document.getElementById('btn-buscar-ia');
  const textoOriginal = btnBusca ? btnBusca.innerHTML : 'Pesquisar na Internet com IA';
  
  if (btnBusca) {
    btnBusca.disabled = true;
    btnBusca.innerHTML = '⏳ Pesquisando e Analisando na IA...';
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/enrich-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: leadId || leadIdEmEdicao,
        nome,
        doc,
        phone,
        provider: providerConfig
      })
    });

    const res = await response.json();

    if (response.ok && res) {
      preencherDadosIA(res);

      if (leadIdEmEdicao) {
        let leads = obterLeadsDoStorage();
        const idx = leads.findIndex(l => l.id === leadIdEmEdicao);
        if (idx !== -1) {
          leads[idx].aiData = res;
          if (res.ramo) leads[idx].ramo = res.ramo;
          if (res.segmento) leads[idx].segmento = res.segmento;
          salvarLeadsNoStorage(leads);
          renderizarTabela();
        }
      }

      alert('Enriquecimento de IA concluído com sucesso!');
    } else {
      alert(res.error || 'Não foi possível processar a resposta da IA.');
    }
  } catch (err) {
    console.error('Erro ao executar busca da IA:', err);
    alert('Erro de conexão com o servidor backend.');
  } finally {
    if (btnBusca) {
      btnBusca.disabled = false;
      btnBusca.innerHTML = textoOriginal;
    }
  }
}

function preencherDadosIA(data) {
  if (!data) return;

  const site = data.site || data.fontes?.site_oficial;
  const instagram = data.instagram || data.fontes?.instagram;
  const ramo = data.ramo || data.classificacao?.ramo;
  const segmento = data.segmento || data.classificacao?.segmento;
  const resumoHtml = data.resumoHtml || data.resumo_descritivo;

  // 1. Preenche links
  const linkSite = document.getElementById('link-site');
  const linkInsta = document.getElementById('link-insta');

  if (linkSite) {
    if (site && site !== 'N/A') {
      linkSite.href = site.startsWith('http') ? site : `https://${site}`;
      linkSite.textContent = site;
    } else {
      linkSite.href = '#';
      linkSite.textContent = 'Não identificado';
    }
  }

  if (linkInsta) {
    if (instagram && instagram !== 'N/A') {
      linkInsta.href = instagram.startsWith('http') ? instagram : `https://${instagram}`;
      linkInsta.textContent = instagram;
    } else {
      linkInsta.href = '#';
      linkInsta.textContent = 'Não identificado';
    }
  }

  // 2. Preenche o Resumo
  const resumoBox = document.getElementById('ai-resumo-texto');
  if (resumoBox && resumoHtml) {
    if (typeof resumoHtml === 'string') {
      resumoBox.innerHTML = resumoHtml;
    } else if (typeof resumoHtml === 'object') {
      resumoBox.innerHTML = `
        <p style="margin-bottom: 12px; line-height: 1.5;">${resumoHtml.paragrafo_1 || ''}</p>
        <p style="margin-bottom: 12px; line-height: 1.5;">${resumoHtml.paragrafo_2 || ''}</p>
        <p style="line-height: 1.5;">${resumoHtml.paragrafo_3 || ''}</p>
      `;
    }
  }

  // 3. Preenche Selects
  const selectRamo = document.getElementById('select-ramo');
  const selectSegmento = document.getElementById('select-segmento');

  if (selectRamo && ramo) {
    selectRamo.value = ramo;
  }
  if (selectSegmento && segmento) {
    selectSegmento.value = segmento;
  }
}

function carregarRamosESegmentosFiltro() {
  const filterRamo = document.getElementById('filter-ramo');
  const filterSeg = document.getElementById('filter-segmento');
  if (filterRamo) filterRamo.addEventListener('change', renderizarTabela);
  if (filterSeg) filterSeg.addEventListener('change', renderizarTabela);
}