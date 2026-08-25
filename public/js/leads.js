document.addEventListener('DOMContentLoaded', () => {
  console.log('Módulo de Leads carregado.');
});

// Define a URL base da API dinamicamente
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : '';

// Função acionada pelo botão "Pesquisar na Internet com IA"
async function executarBuscaIA(leadId) {
  // Captura o nome do lead na interface ou no modal
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

  // Localiza o botão na tela para feedback visual
  const btnBusca = document.querySelector('button[onclick*="executarBuscaIA"]') || document.getElementById('btn-buscar-ia');
  const textoOriginal = btnBusca ? btnBusca.innerHTML : '🔍 Pesquisar na Internet com IA';
  
  if (btnBusca) {
    btnBusca.disabled = true;
    btnBusca.innerHTML = '⏳ Pesquisando e Analisando na IA...';
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/enrich-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: leadId, nome, doc, phone })
    });

    const res = await response.json();

    if (res.success && res.data) {
      const { fontes, classificacao, resumo_descritivo } = res.data;

      // 1. Preenche links na Aba Resumo Descritivo
      const linkSite = document.getElementById('link-site');
      const linkInsta = document.getElementById('link-insta');

      if (linkSite) {
        if (fontes?.site_oficial) {
          linkSite.href = fontes.site_oficial;
          linkSite.textContent = fontes.site_oficial;
        } else {
          linkSite.href = '#';
          linkSite.textContent = 'Não identificado';
        }
      }

      if (linkInsta) {
        if (fontes?.instagram) {
          linkInsta.href = fontes.instagram;
          linkInsta.textContent = fontes.instagram;
        } else {
          linkInsta.href = '#';
          linkInsta.textContent = 'Não identificado';
        }
      }

      // 2. Preenche os 3 Parágrafos
      const resumoBox = document.getElementById('ai-resumo-texto');
      if (resumoBox && resumo_descritivo) {
        resumoBox.innerHTML = `
          <p style="margin-bottom: 12px; line-height: 1.5;">${resumo_descritivo.paragrafo_1}</p>
          <p style="margin-bottom: 12px; line-height: 1.5;">${resumo_descritivo.paragrafo_2}</p>
          <p style="line-height: 1.5;">${resumo_descritivo.paragrafo_3}</p>
        `;
      }

      // 3. Preenche Selects no Painel Executivo
      const selectRamo = document.getElementById('select-ramo');
      const selectSegmento = document.getElementById('select-segmento');

      if (selectRamo && classificacao?.ramo) {
        selectRamo.value = classificacao.ramo;
      }
      if (selectSegmento && classificacao?.segmento) {
        selectSegmento.value = classificacao.segmento;
      }

      alert('Enriquecimento de IA concluído!');
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