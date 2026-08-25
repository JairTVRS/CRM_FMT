/**
 * CRM Formatar — Módulo de Configurações
 * Gerenciamento de Provedores e Preferências do Backend
 */

document.addEventListener('DOMContentLoaded', () => {
  initConfiguracoes();
});

function initConfiguracoes() {
  const selectProvider = document.getElementById('select-active-provider');
  const btnSave = document.getElementById('btn-save-config');

  // Carregar preferência salva do provedor ativo
  const savedProvider = localStorage.getItem('crm_active_ai_provider') || 'chatgpt';
  if (selectProvider) {
    selectProvider.value = savedProvider;
  }

  // Evento para salvar preferências
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      if (!selectProvider) return;
      const selectedValue = selectProvider.value;
      localStorage.setItem('crm_active_ai_provider', selectedValue);

      mostrarNotificacao(`Preferências salvas com sucesso! Provedor ativo: ${selectedValue.toUpperCase()}`, 'sucesso');
    });
  }

  // Verificar status de conexão com as APIs do backend
  verificarStatusBackend();
}

/**
 * Consulta o endpoint de saúde/status das APIs no backend
 * e atualiza visualmente os badges do HTML.
 */
async function verificarStatusBackend() {
  try {
    const response = await fetch('/api/enrich-lead?checkStatus=true');
    if (!response.ok) return;

    const data = await response.json();
    
    // Atualiza os badges dinamicamente conforme retorno do servidor
    if (data && data.providers) {
      Object.keys(data.providers).forEach(provider => {
        const el = document.getElementById(`status-${provider}`);
        if (el) {
          const isConfigured = data.providers[provider];
          
          // Correção das classes CSS para bater exatamente com a folha de estilos do index.html
          el.className = isConfigured ? 'badge-status badge-success' : 'badge-status badge-warning';
          el.textContent = isConfigured ? '● Servidor Ativo' : '○ Não Configurado';
        }
      });
    }
  } catch (err) {
    console.log('Backend executando com variáveis de ambiente padrão ou offline.');
  }
}

/**
 * Utilitário de notificação na tela
 */
function mostrarNotificacao(mensagem, tipo = 'sucesso') {
  alert(mensagem); // Pode ser substituído por um toast customizado
}

// Tornar a inicialização acessível globalmente caso a troca de telas seja feita por rotas JS
window.initConfiguracoes = initConfiguracoes;