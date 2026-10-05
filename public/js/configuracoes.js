/**
 * CRM Formatar — Módulo de Configurações
 *
 * Desde a 2.34.0 a IA é configurada no SERVIDOR (/api/config-ia): o
 * provedor em uso vale para todos, e o admin pode cadastrar as chaves
 * aqui. Antes a escolha ficava no localStorage de cada navegador — e
 * começava em "ChatGPT", que não tinha chave —, e o dossiê nem a lia.
 */

document.addEventListener('DOMContentLoaded', () => {
  initConfiguracoes();
  ligarIA();
});

// Depois do login: o provedor em uso vai para `window.CONFIG_IA`, que o
// enriquecimento usa para dizer o nome na mensagem de espera.
document.addEventListener('crm:autenticado', () => carregarIA(), { once: true });

function initConfiguracoes() {
  carregarIA();

  // Motivos de perda e o aviso de quem é admin (2.31.0)
  if (typeof Perda !== 'undefined') Perda.montarConfig();

  // Formas de preço e empresas contratadas (2.40.0, Lote G)
  if (typeof Contrato !== 'undefined') Contrato.carregarListas();

  // Prospects do ERP (2.33.0)
  mostrarProspects();

  // Roteiros de reunião (2.34.0)
  if (typeof Roteiros !== 'undefined') Roteiros.montarConfig();
}

// A navegação chama isto ao abrir a tela de Configurações.
window.initConfiguracoes = initConfiguracoes;

/* ==========================================================================
   Inteligência artificial (2.34.0)
   ========================================================================== */

const ORDEM_PROVEDORES = ['deepseek', 'chatgpt', 'claude', 'gemini'];

function escConfig(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let configIA = null;

function guardarConfigIA(d) {
  configIA = d;
  const provedor = d.provedorAtivo;
  window.CONFIG_IA = { provider: provedor, nome: d.provedores?.[provedor]?.nome || provedor };
}

async function carregarIA() {
  try {
    const r = await fetch('/api/config-ia');
    if (!r.ok) return;
    guardarConfigIA(await r.json());
    desenharIA();
  } catch (e) {
    // Antes do login o fetch devolve 401; a tela se redesenha depois.
  }
}

function desenharIA() {
  const select = document.getElementById('select-active-provider');
  const caixa = document.getElementById('ia-chaves');
  if (!select || !caixa || !configIA) return;
  const admin = typeof Auth !== 'undefined' && Auth.usuario?.admin;
  const p = configIA.provedores || {};

  const escolhido = configIA.provedorEscolhido || configIA.provedorAtivo;
  select.innerHTML = ORDEM_PROVEDORES.map((id) =>
    `<option value="${id}">${escConfig(p[id]?.nome || id)}${p[id]?.configurado ? '' : ' (sem chave)'}</option>`).join('');
  select.value = escolhido;
  select.disabled = !admin;

  const nota = document.getElementById('ia-provedor-nota');
  if (nota) {
    const emUso = p[configIA.provedorAtivo]?.nome || configIA.provedorAtivo;
    nota.textContent = escolhido !== configIA.provedorAtivo
      ? `O escolhido está sem chave: em uso agora, ${emUso}.`
      : (admin ? 'Vale para todos os usuários.' : 'Só administradores mudam o provedor.');
  }

  caixa.innerHTML = ORDEM_PROVEDORES.map((id) => {
    const s = p[id] || {};
    const estado = s.origem === 'painel'
      ? '<span class="badge-status badge-success">● Painel da Cloudflare</span>'
      : (s.origem === 'crm'
        ? `<span class="badge-status badge-success">● Cadastrada no CRM ••••${escConfig(s.final)}</span>`
        : '<span class="badge-status badge-warning">○ Sem chave</span>');
    // A chave do painel vale primeiro: não há o que cadastrar por cima.
    const editavel = admin && s.origem !== 'painel' && configIA.podeGuardarChave;
    return `
      <div class="ia-linha" data-provedor="${id}">
        <div class="ia-linha-topo">
          <strong>${escConfig(s.nome || id)}</strong>
          ${estado}
        </div>
        ${editavel ? `
          <div class="ia-linha-form">
            <input type="password" class="form-control" autocomplete="off" data-lpignore="true"
                   placeholder="${s.origem === 'crm' ? 'Colar uma chave nova para trocar' : 'Colar a chave'}">
            <button type="button" class="btn btn-sm btn-primary" data-acao="salvar">Salvar</button>
            ${s.origem === 'crm' ? '<button type="button" class="btn btn-sm btn-secondary" data-acao="remover">Remover</button>' : ''}
          </div>` : ''}
      </div>`;
  }).join('') + (admin && !configIA.podeGuardarChave
    ? '<p class="campo-ajuda">O servidor está sem o segredo CHAVES_SECRET: cadastrar chave pela tela fica desligado.</p>'
    : '');

  const workers = document.getElementById('ia-workers');
  if (workers) {
    workers.textContent = configIA.workersAI
      ? 'Workers AI (transcrição grátis para os testes): ligado.'
      : 'Workers AI (transcrição grátis para os testes, 2.35.0): ainda não ligado no painel da Cloudflare.';
  }
}

async function gravarIA(corpo) {
  try {
    const r = await fetch('/api/config-ia', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
    });
    const d = await r.json();
    if (!r.ok) { alert(d.error || 'Não foi possível salvar.'); return false; }
    guardarConfigIA(d);
    desenharIA();
    return true;
  } catch (e) {
    alert('Falha de conexão ao salvar.');
    return false;
  }
}

/** Ligados uma vez só: initConfiguracoes roda a cada abertura da tela. */
function ligarIA() {
  document.getElementById('select-active-provider')?.addEventListener('change', (ev) => {
    gravarIA({ provedor_ativo: ev.target.value });
  });

  document.getElementById('ia-chaves')?.addEventListener('click', async (ev) => {
    const botao = ev.target.closest('[data-acao]');
    const linha = botao?.closest('[data-provedor]');
    if (!botao || !linha) return;
    const provedor = linha.dataset.provedor;
    const nome = configIA?.provedores?.[provedor]?.nome || provedor;

    if (botao.dataset.acao === 'remover') {
      if (confirm(`Remover a chave de ${nome} cadastrada no CRM?`)) gravarIA({ provedor, remover: true });
      return;
    }
    const campo = linha.querySelector('input');
    const chave = campo?.value.trim();
    if (!chave) { campo?.focus(); return; }
    // O redesenho troca a linha: a chave não fica na tela depois de salva.
    if (await gravarIA({ provedor, chave })) alert(`Chave de ${nome} salva.`);
  });
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
