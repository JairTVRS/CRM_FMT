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

  // Motivos de perda e o aviso de quem é admin (2.31.0)
  if (typeof Perda !== 'undefined') Perda.montarConfig();

  // Prospects do ERP (2.33.0)
  mostrarProspects();
}

/* ==========================================================================
   Prospects do ERP (2.33.0)

   Mostra a última importação e, para admin, o botão "Importar agora".
   O botão é ligado uma vez só: initConfiguracoes roda a cada abertura
   da tela, e um ouvinte por abertura importaria N vezes num clique.
   ========================================================================== */

function dataHoraBr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function descreverImportacao(r) {
  const quem = r.origem === 'diaria' ? 'diária' : `manual, por ${r.por}`;
  if (r.erro) return `${dataHoraBr(r.iniciado_em)} (${quem}): falhou — ${r.erro}`;
  if (!r.concluido_em) return `${dataHoraBr(r.iniciado_em)} (${quem}): em andamento ou interrompida`;
  return `${dataHoraBr(r.concluido_em)} (${quem}): ${r.total_hub} prospect(s) no ERP · `
    + `${r.criados} novo(s) lead(s) · ${r.vinculados} vinculado(s) a lead existente · `
    + `${r.ignorados} excluído(s) no CRM, não recriado(s)${r.aviso ? ` · ${r.aviso}` : ''}`;
}

async function mostrarProspects() {
  const alvo = document.getElementById('prospects-estado');
  const botao = document.getElementById('btn-prospects-importar');
  if (!alvo) return;

  const admin = typeof Auth !== 'undefined' && Auth.usuario?.admin;
  botao?.classList.toggle('hidden', !admin);
  if (botao && !botao.dataset.ligado) {
    botao.dataset.ligado = '1';
    botao.addEventListener('click', importarProspectsAgora);
  }

  try {
    const r = await fetch('/api/prospects');
    const d = await r.json();
    const lista = d.importacoes || [];
    alvo.innerHTML = '';
    const linhas = lista.length
      ? lista.map((x) => descreverImportacao(x))
      : [d.aviso || 'Nenhuma importação ainda. A primeira roda amanhã às 06:00, ou agora, pelo botão.'];
    if (d.semResponsavel) {
      linhas.unshift(`${d.semResponsavel} lead(s) vindos do ERP ainda sem responsável — filtre por "Sem responsável" na tela de Leads.`);
    }
    linhas.forEach((t) => {
      const p = document.createElement('p');
      p.textContent = t;
      alvo.appendChild(p);
    });
  } catch (e) {
    alvo.textContent = 'Não foi possível consultar as importações.';
  }
}

async function importarProspectsAgora() {
  const botao = document.getElementById('btn-prospects-importar');
  if (!confirm('Trazer agora os prospects do ERP que o CRM ainda não conhece?')) return;
  botao.disabled = true;
  botao.textContent = 'Importando…';
  try {
    const r = await fetch('/api/prospects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json();
    if (!r.ok) {
      alert(`${d.error || 'A importação falhou.'}${d.details ? `\n\n${d.details}` : ''}`);
    } else {
      alert(`Importação concluída.\n\n${descreverImportacao({ ...d.importacao, concluido_em: new Date().toISOString(), origem: 'manual', por: 'você' })}`);
      if (typeof Leads !== 'undefined') Leads.recarregarVisao();
    }
  } catch (e) {
    alert('Falha de conexão durante a importação.');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Importar agora';
    mostrarProspects();
  }
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