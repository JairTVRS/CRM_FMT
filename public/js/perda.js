/**
 * perda.js — o motivo da perda (2.31.0).
 *
 * Duas partes, as duas sobre a mesma lista:
 *
 *   1. `Perda.pedir()` abre o modal que pergunta o motivo quando um lead
 *      é ARRASTADO para uma etapa de perda. Na ficha a pergunta é feita
 *      pelos campos da aba Funil (leads.js); o quadro não tem onde
 *      perguntar, então pergunta aqui, ANTES de gravar o movimento.
 *
 *   2. O cartão "Motivos de perda" das Configurações. Todos veem a
 *      lista; só admin (grupo do hub) cria, renomeia e exclui. A tela
 *      esconde os controles de quem não é admin, mas quem recusa de
 *      verdade é o servidor (`exigirAdmin`).
 *
 * Carregar DEPOIS do cadastros.js.
 */

const Perda = (() => {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** As opções do select de motivo, com o "escolha" na frente. */
  function opcoesMotivos(selecionado) {
    const lista = Cadastros.motivos();
    return '<option value="">Escolha o motivo…</option>'
      + lista.map((m) => `<option value="${m.id}"${Number(selecionado) === m.id ? ' selected' : ''}>${esc(m.nome)}</option>`).join('');
  }

  /* ----------------------------------------------------------
     1. O modal do quadro
     ---------------------------------------------------------- */

  let resolver = null;

  /**
   * Pergunta o motivo. Resolve com { motivo_perda_id, motivo_perda_obs }
   * ou com `null` se a pessoa desistiu — e aí o cartão volta para onde
   * estava, porque o movimento nem chegou a ser gravado.
   */
  function pedir(nomeLead, nomeEtapa) {
    const modal = el('modal-motivo-perda');
    if (!modal) return Promise.resolve(null);

    el('motivo-perda-titulo').textContent = nomeLead
      ? `Por que "${nomeLead}" foi para ${nomeEtapa || 'perdido'}?`
      : 'Por que este lead foi perdido?';
    el('motivo-perda-select').innerHTML = opcoesMotivos(null);
    el('motivo-perda-obs').value = '';
    modal.classList.remove('hidden');
    el('motivo-perda-select').focus();

    return new Promise((r) => { resolver = r; });
  }

  function fecharModal(resposta) {
    el('modal-motivo-perda')?.classList.add('hidden');
    if (resolver) { resolver(resposta); resolver = null; }
  }

  function confirmar() {
    const id = Number(el('motivo-perda-select').value);
    if (!id) {
      alert('Escolha o motivo da perda.');
      el('motivo-perda-select').focus();
      return;
    }
    fecharModal({ motivo_perda_id: id, motivo_perda_obs: el('motivo-perda-obs').value.trim() || null });
  }

  /* ----------------------------------------------------------
     2. O cartão das Configurações
     ---------------------------------------------------------- */

  const ehAdmin = () => !!(typeof Auth !== 'undefined' && Auth.usuario?.admin);

  function montarAcesso() {
    const alvo = el('config-acesso');
    if (!alvo) return;
    const u = typeof Auth !== 'undefined' ? Auth.usuario : null;
    if (!u) { alvo.textContent = ''; return; }

    const grupo = u.grupo ? ` (grupo ${u.grupo} no hub)` : '';
    alvo.className = `config-acesso${u.admin ? ' admin' : ''}`;
    alvo.textContent = u.admin
      ? `Você é administrador do CRM${grupo}.`
      : `Você não é administrador do CRM${grupo}. As listas abaixo são só de leitura.${u.avisoAdmin ? ` ${u.avisoAdmin}` : ''}`;
  }

  function montarConfig() {
    montarAcesso();
    const lista = el('motivos-lista');
    if (!lista) return;

    const admin = ehAdmin();
    el('motivo-novo')?.classList.toggle('hidden', !admin);

    const motivos = Cadastros.motivos();
    if (!motivos.length) {
      lista.innerHTML = '<div class="coluna-vazia">Nenhum motivo cadastrado.</div>';
      return;
    }

    lista.innerHTML = motivos.map((m) => admin
      ? `<div class="motivo-linha" data-id="${m.id}">
           <input type="text" class="form-control" value="${esc(m.nome)}" maxlength="120"
                  data-campo="nome" aria-label="Nome do motivo">
           <button class="btn-action" data-acao="excluir" title="Excluir">🗑️</button>
         </div>`
      : `<div class="motivo-linha"><span>${esc(m.nome)}</span></div>`).join('');
  }

  async function gravar(url, metodo, corpo) {
    try {
      const r = await fetch(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || 'Não foi possível salvar.'); return false; }
      return true;
    } catch (e) {
      alert('Falha de conexão ao salvar.');
      return false;
    }
  }

  async function recarregarConfig() {
    await Cadastros.recarregarLista('motivos');
    montarConfig();
  }

  async function criarMotivo() {
    const campo = el('motivo-novo-nome');
    const nome = campo?.value.trim();
    if (!nome) { campo?.focus(); return; }
    if (await gravar('/api/cadastros?tipo=motivos', 'POST', { nome })) {
      campo.value = '';
      await recarregarConfig();
    }
  }

  function iniciar() {
    el('btn-motivo-perda-confirmar')?.addEventListener('click', confirmar);
    el('btn-motivo-perda-cancelar')?.addEventListener('click', () => fecharModal(null));
    el('btn-motivo-perda-fechar')?.addEventListener('click', () => fecharModal(null));

    el('btn-motivo-criar')?.addEventListener('click', criarMotivo);
    el('motivo-novo-nome')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') criarMotivo();
    });

    const lista = el('motivos-lista');
    // Renomear grava ao sair do campo, como os nomes das etapas.
    lista?.addEventListener('blur', async (ev) => {
      if (ev.target.dataset.campo !== 'nome') return;
      const id = Number(ev.target.closest('.motivo-linha')?.dataset.id);
      const nome = ev.target.value.trim();
      const antes = Cadastros.motivoPorId(id)?.nome;
      if (!id || !nome || nome === antes) return;
      if (await gravar(`/api/cadastros?tipo=motivos&id=${id}`, 'PUT', { nome })) await recarregarConfig();
      else ev.target.value = antes || '';
    }, true);

    lista?.addEventListener('click', async (ev) => {
      const botao = ev.target.closest('[data-acao="excluir"]');
      if (!botao) return;
      const id = Number(botao.closest('.motivo-linha')?.dataset.id);
      const nome = Cadastros.motivoPorId(id)?.nome || '';
      if (!id || !confirm(`Excluir o motivo "${nome}"?`)) return;
      if (await gravar(`/api/cadastros?tipo=motivos&id=${id}`, 'DELETE')) await recarregarConfig();
    });

    // As listas chegam depois do login; se as Configurações já estiverem
    // abertas, o cartão se redesenha com elas.
    document.addEventListener('crm:cadastros', montarConfig);
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { pedir, opcoesMotivos, montarConfig };
})();
