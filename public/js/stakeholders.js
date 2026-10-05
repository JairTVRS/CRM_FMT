/**
 * stakeholders.js — as pessoas do lado do cliente (2.43.0, Fase 3 da 2.24.0).
 *
 * Vive na aba Stakeholders da ficha do cliente. Carregar DEPOIS do
 * clientes.js: pende dela e é acionado pelos eventos que ela dispara.
 *
 * Decidido com o Jair em 05/10/2026:
 *   - a lista É o cadastro do cliente no ERP — quem entra, sai ou muda de
 *     nome, muda lá; aqui não há "+ pessoa" nem excluir;
 *   - em cada pessoa a CX registra influência, postura, patrocinador e
 *     observações, e isso fica preso ao código da pessoa no ERP;
 *   - papel saiu (vale o cargo do ERP), e os núcleos de cada pessoa vêm
 *     das reuniões de que ela participa, não de marcação à mão.
 *
 * Carrega sob demanda, na primeira vez que a aba é aberta: a consulta vai
 * ao ERP (pessoas e reuniões), e quem abriu a ficha para outra coisa não
 * paga por ela.
 */

const Stakeholders = (() => {
  let clienteId = null;
  let pessoas = [];
  let carregadoDe = null;      // de qual cliente a lista em memória é

  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* Os mesmos rótulos do `_lib/schema-dossie-cx.js`. A duplicação é
     inevitável: aquele arquivo é módulo ES das Functions e este é script
     clássico do navegador. Se um rótulo mudar, mudam os dois. */
  const ROTULO_INFLUENCIA = { alta: 'Alta', media: 'Média', baixa: 'Baixa', desconhecida: 'Não avaliada' };
  const ROTULO_POSTURA = { promotor: 'Promotor', neutro: 'Neutro', resistente: 'Resistente', desconhecida: 'Não avaliada' };

  const opcoes = (rotulos, atual) => Object.entries(rotulos)
    .map(([v, r]) => `<option value="${v}"${v === atual ? ' selected' : ''}>${esc(r)}</option>`).join('');

  /* ----------------------------------------------------------
     Carga
     ---------------------------------------------------------- */

  function aplicarDisponibilidade() {
    const sem = !clienteId;
    el('pessoas-sem-cliente')?.classList.toggle('hidden', !sem);
    if (sem) {
      el('pessoas-estado').textContent = '';
      el('pessoas-lista').innerHTML = '';
    }
  }

  async function carregar(forcar = false) {
    if (!clienteId) { aplicarDisponibilidade(); return; }
    if (!forcar && carregadoDe === clienteId) return;
    const pedido = clienteId;
    el('pessoas-estado').textContent = 'Consultando as pessoas no ERP…';
    el('pessoas-lista').innerHTML = '';
    try {
      const r = await fetch(`/api/stakeholders?cliente_id=${pedido}`);
      const d = await r.json();
      if (pedido !== clienteId) return;                    // trocou de cliente no meio
      if (!r.ok) throw new Error(d.details || d.error || `HTTP ${r.status}`);
      pessoas = d.pessoas || [];
      carregadoDe = pedido;
      desenhar(d);
    } catch (e) {
      el('pessoas-estado').innerHTML = `<span class="cc-alerta">Não foi possível consultar as pessoas: ${esc(e.message)}</span>`;
    }
  }

  /* ----------------------------------------------------------
     Desenho
     ---------------------------------------------------------- */

  let ultimaLeitura = null;

  function desenhar(d) {
    ultimaLeitura = d;
    desenharEstado(d);
    desenharLista(d);
  }

  function desenharEstado(d) {
    const avaliadas = pessoas.filter((p) => p.avaliada).length;
    const estado = el('pessoas-estado');

    if (!d.consultado) {
      estado.innerHTML = `<span class="cc-alerta">O ERP não devolveu as pessoas deste cliente${d.motivo ? `: ${esc(d.motivo)}` : '.'}</span>`
        + (pessoas.length ? ' Abaixo, só as avaliações já guardadas no CRM (sem editar).' : '');
    } else if (!pessoas.length) {
      estado.textContent = d.totalNoErp
        ? `O ERP indica ${d.totalNoErp} pessoa(s), mas sem nome legível.`
        : 'Nenhuma pessoa no cadastro deste cliente no ERP. Cadastre os stakeholders lá (cadastros › clientes › stakeholders).';
    } else {
      estado.textContent = `${pessoas.length} pessoa(s) no cadastro do ERP · ${avaliadas} avaliada(s) pela CX`
        + (d.nucleosConsultados ? '' : ' · os núcleos de cada pessoa não puderam ser consultados agora');
    }
  }

  /**
   * 2.44.0, pedido do Jair: compacta — uma linha por pessoa. Cliente com
   * muitos contatos não pode virar uma rolagem sem fim. As observações
   * abrem só no "Obs." (com um ponto quando já há texto).
   */
  function desenharLista(d) {
    if (!pessoas.length) { el('pessoas-lista').innerHTML = ''; return; }
    const cabeca = `
      <div class="pessoa-linha pessoa-cabeca" aria-hidden="true">
        <span>Pessoa</span><span>Influência</span><span>Postura</span>
        <span title="Patrocinador da conta" class="centro">Patroc.</span><span></span><span></span>
      </div>`;
    el('pessoas-lista').innerHTML = cabeca + pessoas.map((p, i) => {
      const contato = [p.cargo, p.email, p.telefone].filter(Boolean).map(esc).join(' · ');
      const editavel = d.consultado && !!p.erpContatoId;
      const off = editavel ? '' : ' disabled';
      return `
        <div class="pessoa-linha${p.avaliada ? '' : ' nao-avaliada'}" data-i="${i}">
          <div class="pessoa-quem">
            <strong>${esc(p.nome)}</strong>${p.principal ? ' <span class="pessoa-marca" title="Contato principal no ERP">principal</span>' : ''}
            ${contato ? `<span class="pessoa-contato">${contato}</span>` : ''}
            ${p.nucleos.length ? `<span class="pessoa-nucleos" title="Núcleos de que participa nas reuniões">${p.nucleos.map(esc).join(' · ')}</span>` : ''}
          </div>
          <select class="form-control pessoa-sel" data-campo="influencia" title="Influência na decisão"${off}>${opcoes(ROTULO_INFLUENCIA, p.influencia)}</select>
          <select class="form-control pessoa-sel" data-campo="postura" title="Postura com a Formatar"${off}>${opcoes(ROTULO_POSTURA, p.postura)}</select>
          <input type="checkbox" class="pessoa-patroc" data-campo="patrocinador" title="Patrocinador da conta"${p.patrocinador ? ' checked' : ''}${off}>
          <button type="button" class="btn btn-sm btn-secondary pessoa-obs-btn${p.observacoes ? ' tem-obs' : ''}" data-acao="obs"
                  title="${p.observacoes ? esc(p.observacoes) : 'Observações da CX'}">Obs.</button>
          ${editavel ? '<button type="button" class="btn btn-sm btn-primary pessoa-salvar-btn" data-acao="salvar" disabled>Salvar</button>' : '<span></span>'}
          <textarea class="form-control pessoa-obs hidden" rows="2" maxlength="2000" data-campo="observacoes"
                    placeholder="Observações da CX sobre esta pessoa"${off}>${esc(p.observacoes || '')}</textarea>
        </div>`;
    }).join('');
  }

  /* ----------------------------------------------------------
     Gravação
     ---------------------------------------------------------- */

  function lerCartao(cartao) {
    const v = (c) => cartao.querySelector(`[data-campo="${c}"]`);
    return {
      influencia: v('influencia').value,
      postura: v('postura').value,
      patrocinador: v('patrocinador').checked,
      observacoes: v('observacoes').value.trim() || null
    };
  }

  async function salvar(cartao) {
    const p = pessoas[Number(cartao.dataset.i)];
    if (!p) return;
    const botao = cartao.querySelector('[data-acao="salvar"]');
    const aval = lerCartao(cartao);
    botao.disabled = true;
    botao.textContent = 'Salvando…';
    try {
      const r = await fetch(`/api/stakeholders?cliente_id=${clienteId}&erp_contato_id=${encodeURIComponent(p.erpContatoId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...aval, nome: p.nome, cargo: p.cargo, email: p.email, telefone: p.telefone })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      Object.assign(p, d.avaliacao, { avaliada: true });
      botao.textContent = 'Salvo ✓';
      cartao.classList.remove('nao-avaliada');
      const obs = cartao.querySelector('[data-acao="obs"]');
      obs?.classList.toggle('tem-obs', !!p.observacoes);
      if (obs) obs.title = p.observacoes || 'Observações da CX';
      if (ultimaLeitura) desenharEstado(ultimaLeitura);   // a contagem de avaliadas
    } catch (e) {
      botao.textContent = 'Salvar';
      botao.disabled = false;
      alert(`Não salvou a avaliação de ${p.nome}: ${e.message}`);
    }
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    const lista = el('pessoas-lista');
    // Qualquer mudança na avaliação libera o "Salvar" daquela pessoa.
    const marcarMudanca = (ev) => {
      const cartao = ev.target.closest('.pessoa-linha');
      if (!cartao || !ev.target.dataset.campo) return;
      const botao = cartao.querySelector('[data-acao="salvar"]');
      if (botao) { botao.disabled = false; botao.textContent = 'Salvar'; }
    };
    lista?.addEventListener('input', marcarMudanca);
    lista?.addEventListener('change', marcarMudanca);
    lista?.addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-acao]');
      if (!botao) return;
      const linha = botao.closest('.pessoa-linha');
      if (botao.dataset.acao === 'salvar') salvar(linha);
      if (botao.dataset.acao === 'obs') {
        const campo = linha.querySelector('[data-campo="observacoes"]');
        campo.classList.toggle('hidden');
        if (!campo.classList.contains('hidden')) campo.focus();
      }
    });

    // A ficha abriu: troca de cliente joga fora a lista do anterior.
    document.addEventListener('crm:cliente-ficha', (ev) => {
      clienteId = ev.detail?.id || null;
      pessoas = [];
      carregadoDe = null;
      aplicarDisponibilidade();
    });

    document.addEventListener('crm:cliente-aba', (ev) => {
      if (ev.detail?.aba === 'cli-tab-pessoas') carregar();
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { recarregar: () => carregar(true), ROTULO_INFLUENCIA, ROTULO_POSTURA };
})();
