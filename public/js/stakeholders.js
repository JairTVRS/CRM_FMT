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

  function desenharLista(d) {

    el('pessoas-lista').innerHTML = pessoas.map((p, i) => {
      const contato = [p.cargo, p.email, p.telefone].filter(Boolean).map(esc).join(' · ');
      const editavel = d.consultado && !!p.erpContatoId;
      return `
        <div class="pessoa-cartao pessoa-erp${p.avaliada ? '' : ' nao-avaliada'}" data-i="${i}">
          <div class="pessoa-topo">
            <strong>${esc(p.nome)}</strong>
            ${p.principal ? '<span class="cc-badge padrao">principal</span>' : ''}
            ${p.patrocinador ? '<span class="cc-badge padrao">patrocinador</span>' : ''}
            ${p.avaliada ? '' : '<span class="cc-badge">não avaliada</span>'}
          </div>
          ${contato ? `<div class="pessoa-contato">${contato}</div>` : ''}
          ${p.nucleos.length ? `<div class="pessoa-nucleos">${p.nucleos.map((n) => `<span class="tag-chip ligada">${esc(n)}</span>`).join('')}</div>` : ''}
          <div class="pessoa-avaliacao">
            <label>Influência
              <select class="form-control" data-campo="influencia"${editavel ? '' : ' disabled'}>${opcoes(ROTULO_INFLUENCIA, p.influencia)}</select>
            </label>
            <label>Postura
              <select class="form-control" data-campo="postura"${editavel ? '' : ' disabled'}>${opcoes(ROTULO_POSTURA, p.postura)}</select>
            </label>
            <label class="pessoa-patrocinador">
              <input type="checkbox" data-campo="patrocinador"${p.patrocinador ? ' checked' : ''}${editavel ? '' : ' disabled'}>
              Patrocinador da conta
            </label>
            <textarea class="form-control" rows="2" maxlength="2000" data-campo="observacoes"
                      placeholder="Observações da CX sobre esta pessoa"${editavel ? '' : ' disabled'}>${esc(p.observacoes || '')}</textarea>
            ${editavel ? `<div class="pessoa-salvar">
              <button type="button" class="btn btn-sm btn-primary" data-acao="salvar" disabled>Salvar</button>
              <span class="prop-status" data-status></span>
            </div>` : ''}
          </div>
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
    const status = cartao.querySelector('[data-status]');
    const aval = lerCartao(cartao);
    botao.disabled = true;
    status.textContent = 'Salvando…';
    status.className = 'prop-status';
    try {
      const r = await fetch(`/api/stakeholders?cliente_id=${clienteId}&erp_contato_id=${encodeURIComponent(p.erpContatoId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...aval, nome: p.nome, cargo: p.cargo, email: p.email, telefone: p.telefone })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      Object.assign(p, d.avaliacao, { avaliada: true });
      status.textContent = 'Salvo.';
      status.className = 'prop-status ok';
      cartao.classList.remove('nao-avaliada');
      cartao.querySelector('.pessoa-topo .cc-badge:not(.padrao)')?.remove();
      if (ultimaLeitura) desenharEstado(ultimaLeitura);   // a contagem de avaliadas
    } catch (e) {
      status.textContent = `Não salvou: ${e.message}`;
      status.className = 'prop-status erro';
      botao.disabled = false;
    }
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    const lista = el('pessoas-lista');
    // Qualquer mudança na avaliação libera o "Salvar" daquela pessoa.
    const marcarMudanca = (ev) => {
      const cartao = ev.target.closest('.pessoa-cartao');
      if (!cartao || !ev.target.dataset.campo) return;
      const botao = cartao.querySelector('[data-acao="salvar"]');
      if (botao) botao.disabled = false;
      const status = cartao.querySelector('[data-status]');
      if (status) { status.textContent = ''; status.className = 'prop-status'; }
    };
    lista?.addEventListener('input', marcarMudanca);
    lista?.addEventListener('change', marcarMudanca);
    lista?.addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-acao="salvar"]');
      if (botao) salvar(botao.closest('.pessoa-cartao'));
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
