/**
 * quadro.js — O funil em colunas.
 *
 * Construído genérico por pipeline desde o primeiro dia: a jornada do
 * cliente do CX é outro pipeline nas mesmas etapas e vai reaproveitar
 * este módulo inteiro, mudando só a constante.
 *
 * O arraste usa Pointer Events, não HTML5 Drag & Drop. O DnD nativo
 * simplesmente não dispara em toque, e um polyfill traria dependência
 * num projeto sem empacotador. Pointer Events cobre mouse, toque e
 * caneta com um caminho de código só.
 *
 * Carregar DEPOIS do leads.js (de onde vêm os filtros) e ANTES do app.js.
 */

const Quadro = (() => {
  const PIPELINE = 'comercial';
  const POR_COLUNA = 50;

  /* Abaixo disto o gesto é um toque, não um arraste. Sem a folga, um
     toque com o dedo trêmulo viraria um movimento de cartão. */
  const LIMIAR_ARRASTE = 5;

  const MARGEM_AUTOSCROLL = 70;
  const CHAVE_RECOLHIDAS = 'crm_colunas_recolhidas';

  let colunas = [];
  let carregando = false;
  let arraste = null;

  /* Escolhas explícitas do usuário sobre recolher/expandir. Ausente
     significa "usa o padrão", que é: terminal nasce recolhida. */
  let recolhidas = {};
  try { recolhidas = JSON.parse(localStorage.getItem(CHAVE_RECOLHIDAS) || '{}'); }
  catch (e) { recolhidas = {}; }

  /* ----------------------------------------------------------
     Utilidades
     ---------------------------------------------------------- */

  const el = (id) => document.getElementById(id);

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** Centavos para real. Sem centavos: o quadro é visão de resumo. */
  const moeda = (centavos) =>
    (Number(centavos || 0) / 100).toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL', maximumFractionDigits: 0
    });

  /**
   * Dias até a data, contados em fuso local.
   *
   * `new Date('2026-01-15')` seria interpretado como UTC e, a oeste de
   * Greenwich, cairia no dia 14 — o prazo apareceria vencido um dia antes.
   */
  function diasPara(dataIso) {
    if (!dataIso) return null;
    const [a, m, d] = String(dataIso).split('-').map(Number);
    if (!a || !m || !d) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.round((new Date(a, m - 1, d) - hoje) / 86400000);
  }

  function rotuloPrazo(dias) {
    if (dias === null) return null;
    if (dias < 0) return { texto: `${Math.abs(dias)}d atrasado`, classe: 'atrasado' };
    if (dias === 0) return { texto: 'hoje', classe: 'hoje' };
    return { texto: `em ${dias}d`, classe: '' };
  }

  const estaRecolhida = (etapa) =>
    Object.prototype.hasOwnProperty.call(recolhidas, etapa.id)
      ? !!recolhidas[etapa.id]
      : !!etapa.encerra;

  function gravarRecolhidas() {
    try { localStorage.setItem(CHAVE_RECOLHIDAS, JSON.stringify(recolhidas)); }
    catch (e) { /* modo anônimo: a preferência só não sobrevive à sessão */ }
  }

  /* ----------------------------------------------------------
     Carregamento
     ---------------------------------------------------------- */

  function parametrosDeFiltro() {
    const f = (typeof Leads !== 'undefined' && Leads.filtros) ? Leads.filtros() : {};
    const p = new URLSearchParams();
    if (f.busca) p.set('busca', f.busca);
    if (f.ramo) p.set('ramo', f.ramo);
    if (f.segmento) p.set('segmento', f.segmento);
    if (f.canal) p.set('canal', f.canal);
    if (f.classificacao) p.set('classificacao', f.classificacao);
    return p;
  }

  async function carregar() {
    const caixa = el('quadro-colunas');
    if (!caixa || carregando) return;
    carregando = true;

    caixa.innerHTML = '<div class="quadro-vazio">Carregando…</div>';

    const params = parametrosDeFiltro();
    params.set('quadro', '1');
    params.set('pipeline', PIPELINE);
    params.set('porColuna', POR_COLUNA);

    try {
      const r = await fetch(`/api/leads?${params}`);
      if (!r.ok) throw new Error('Falha ao carregar o quadro.');

      const d = await r.json();
      colunas = d.colunas || [];
      renderizar();

    } catch (e) {
      caixa.innerHTML = `<div class="quadro-erro">
        Não foi possível carregar o quadro. Recarregue a página.</div>`;
    } finally {
      carregando = false;
    }
  }

  /** Traz o próximo lote de UMA coluna, sem tocar nas demais. */
  async function carregarMais(etapaId) {
    const coluna = colunas.find((c) => c.etapa.id === etapaId);
    if (!coluna) return;

    const params = parametrosDeFiltro();
    params.set('etapa_id', etapaId);
    params.set('porPagina', POR_COLUNA);
    params.set('pagina', Math.floor(coluna.leads.length / POR_COLUNA) + 1);

    try {
      const r = await fetch(`/api/leads?${params}`);
      if (!r.ok) return;
      const d = await r.json();

      // Concatenar sem conferir duplicaria cartões se a coluna tivesse
      // mudado no servidor entre as duas leituras.
      const jaTem = new Set(coluna.leads.map((l) => l.id));
      coluna.leads.push(...(d.leads || []).filter((l) => !jaTem.has(l.id)));
      renderizar();
    } catch (e) {
      // Silêncio: o botão continua ali para nova tentativa.
    }
  }

  /* ----------------------------------------------------------
     Renderização
     ---------------------------------------------------------- */

  function renderizar() {
    const caixa = el('quadro-colunas');
    if (!caixa) return;

    if (colunas.length === 0) {
      caixa.innerHTML = `<div class="quadro-vazio">
        Nenhuma etapa cadastrada. Use “Gerenciar etapas” para criar a primeira.</div>`;
      return;
    }

    caixa.innerHTML = colunas.map(colunaHtml).join('');
  }

  function colunaHtml(coluna) {
    const { etapa, total, soma, leads } = coluna;
    const recolhida = estaRecolhida(etapa);
    const faltam = total - leads.length;

    const corpo = recolhida ? '' : `
      <div class="coluna-lista" data-lista="${etapa.id}">
        ${leads.length
          ? leads.map(cartaoHtml).join('')
          : '<div class="coluna-vazia">Nenhum lead nesta etapa.</div>'}
      </div>
      ${faltam > 0 ? `
        <div class="coluna-rodape">
          <button class="btn-carregar-mais" data-mais="${etapa.id}">
            Carregar mais ${faltam > POR_COLUNA ? POR_COLUNA : faltam} de ${faltam}
          </button>
        </div>` : ''}`;

    return `
      <section class="coluna${recolhida ? ' recolhida' : ''}"
               data-etapa="${etapa.id}"
               style="--cor-etapa: ${esc(etapa.cor || '#6e6e6e')}">
        <header class="coluna-cabecalho">
          <div class="coluna-titulo">
            <span class="coluna-nome" title="${esc(etapa.nome)}">${esc(etapa.nome)}</span>
            <span class="coluna-contador">${total}</span>
            <button class="btn-recolher" data-recolher="${etapa.id}"
                    title="${recolhida ? 'Expandir' : 'Recolher'} coluna"
                    aria-label="${recolhida ? 'Expandir' : 'Recolher'} coluna">
              ${recolhida ? '›' : '‹'}
            </button>
          </div>
          ${recolhida ? '' : `<span class="coluna-soma">${moeda(soma)}</span>`}
        </header>
        ${corpo}
      </section>`;
  }

  function cartaoHtml(lead) {
    const prazo = rotuloPrazo(diasPara(lead.data_proximo_contato));
    const linhaBaixo = [
      lead.cidade ? esc(lead.cidade) : null,
      lead.canal ? esc(lead.canal) : (lead.origem ? esc(lead.origem) : null)
    ].filter(Boolean).join(' · ');

    return `
      <article class="cartao" data-id="${lead.id}">
        <span class="cartao-alca" title="Arrastar" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
            <circle cx="6" cy="3" r="1.3"></circle><circle cx="10" cy="3" r="1.3"></circle>
            <circle cx="6" cy="8" r="1.3"></circle><circle cx="10" cy="8" r="1.3"></circle>
            <circle cx="6" cy="13" r="1.3"></circle><circle cx="10" cy="13" r="1.3"></circle>
          </svg>
        </span>
        <div class="cartao-corpo">
          <div class="cartao-nome">${esc(lead.nome)}</div>
          ${linhaBaixo ? `<div class="cartao-linha">${linhaBaixo}</div>` : ''}
          <div class="cartao-linha">
            ${lead.classificacao ? `<span class="badge-classificacao" title="Classificação">${lead.classificacao}</span>` : ''}
            ${lead.valor_proposta ? `<span class="cartao-valor">${moeda(lead.valor_proposta)}</span>` : ''}
            ${prazo ? `<span class="cartao-prazo ${prazo.classe}">${prazo.texto}</span>` : ''}
          </div>
        </div>
      </article>`;
  }

  function leadPorId(id) {
    for (const c of colunas) {
      const achado = c.leads.find((l) => String(l.id) === String(id));
      if (achado) return achado;
    }
    return null;
  }

  /* ----------------------------------------------------------
     Arraste — Pointer Events

     Um caminho de código para mouse, toque e caneta. A alça do cartão
     tem `touch-action: none`, sem o que o navegador trataria o gesto
     como rolagem e nunca entregaria os eventos de movimento.
     ---------------------------------------------------------- */

  function aoPressionar(ev) {
    if (ev.button > 0) return;                       // só o botão principal
    const alca = ev.target.closest('.cartao-alca');
    if (!alca) return;

    const cartao = alca.closest('.cartao');
    const coluna = cartao?.closest('.coluna');
    if (!cartao || !coluna) return;

    ev.preventDefault();

    arraste = {
      cartao,
      id: Number(cartao.dataset.id),
      origem: Number(coluna.dataset.etapa),
      x0: ev.clientX,
      y0: ev.clientY,
      ativo: false,
      alca,
      clone: null,
      marcador: null,
      colunaAlvo: null
    };

    alca.setPointerCapture(ev.pointerId);
    alca.addEventListener('pointermove', aoMover);
    alca.addEventListener('pointerup', aoSoltar);
    alca.addEventListener('pointercancel', aoSoltar);
  }

  function ativarArraste(ev) {
    const r = arraste.cartao.getBoundingClientRect();

    const clone = arraste.cartao.cloneNode(true);
    clone.classList.add('cartao-flutuante');
    clone.style.width = `${r.width}px`;
    document.body.appendChild(clone);

    arraste.clone = clone;
    arraste.deslocX = arraste.x0 - r.left;
    arraste.deslocY = arraste.y0 - r.top;

    arraste.marcador = document.createElement('div');
    arraste.marcador.className = 'marcador-solta';

    arraste.cartao.classList.add('arrastando');
    document.body.classList.add('arrastando-cartao');
    arraste.ativo = true;

    posicionarClone(ev);
  }

  function posicionarClone(ev) {
    arraste.clone.style.left = `${ev.clientX - arraste.deslocX}px`;
    arraste.clone.style.top = `${ev.clientY - arraste.deslocY}px`;
  }

  /** Índice de inserção pela metade de cada cartão já na lista. */
  function indiceNaLista(lista, y) {
    const cartoes = [...lista.querySelectorAll('.cartao:not(.arrastando)')];
    for (let i = 0; i < cartoes.length; i++) {
      const r = cartoes[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return cartoes.length;
  }

  /** Rola a faixa de colunas quando o ponteiro encosta nas bordas. */
  function autoScroll(ev) {
    const faixa = el('quadro-colunas');
    if (!faixa) return;
    const r = faixa.getBoundingClientRect();
    if (ev.clientX < r.left + MARGEM_AUTOSCROLL) faixa.scrollLeft -= 18;
    else if (ev.clientX > r.right - MARGEM_AUTOSCROLL) faixa.scrollLeft += 18;
  }

  function aoMover(ev) {
    if (!arraste) return;

    if (!arraste.ativo) {
      const dist = Math.hypot(ev.clientX - arraste.x0, ev.clientY - arraste.y0);
      if (dist < LIMIAR_ARRASTE) return;
      ativarArraste(ev);
    }

    posicionarClone(ev);
    autoScroll(ev);

    // O clone tem pointer-events:none, então o que está sob o ponteiro
    // é o quadro de verdade, e não ele mesmo.
    const sob = document.elementFromPoint(ev.clientX, ev.clientY);
    const coluna = sob?.closest('.coluna');

    if (arraste.colunaAlvo && arraste.colunaAlvo !== coluna) {
      arraste.colunaAlvo.classList.remove('alvo');
    }
    arraste.colunaAlvo = coluna || null;
    if (!coluna) { arraste.marcador.remove(); return; }

    coluna.classList.add('alvo');

    // Coluna recolhida aceita a soltura, mas não tem lista onde mostrar
    // o marcador — o destaque da própria coluna já indica o destino.
    const lista = coluna.querySelector('.coluna-lista');
    if (!lista) { arraste.marcador.remove(); return; }

    const vazia = lista.querySelector('.coluna-vazia');
    if (vazia) vazia.remove();

    const indice = indiceNaLista(lista, ev.clientY);
    const cartoes = [...lista.querySelectorAll('.cartao:not(.arrastando)')];
    lista.insertBefore(arraste.marcador, cartoes[indice] || null);
  }

  async function aoSoltar(ev) {
    if (!arraste) return;

    const { alca, cartao, id, origem, ativo, colunaAlvo, marcador } = arraste;

    alca.removeEventListener('pointermove', aoMover);
    alca.removeEventListener('pointerup', aoSoltar);
    alca.removeEventListener('pointercancel', aoSoltar);
    try { alca.releasePointerCapture(ev.pointerId); } catch (e) { /* já solto */ }

    if (!ativo) { arraste = null; return; }   // foi um toque, não um arraste

    let destino = null;
    let indice = 0;

    if (colunaAlvo) {
      destino = Number(colunaAlvo.dataset.etapa);
      const lista = colunaAlvo.querySelector('.coluna-lista');
      if (lista && marcador.parentNode === lista) {
        // O cartão arrastado continua no DOM (só oculto). Contá-lo aqui
        // deslocaria o índice em um quando ele estivesse antes do
        // marcador na mesma coluna — a mesma exclusão de indiceNaLista.
        indice = [...lista.children].filter(
          (n) => (n.classList.contains('cartao') && !n.classList.contains('arrastando'))
                 || n === marcador
        ).indexOf(marcador);
        if (indice < 0) indice = 0;
      }
    }

    arraste.clone.remove();
    marcador.remove();
    cartao.classList.remove('arrastando');
    colunaAlvo?.classList.remove('alvo');
    document.body.classList.remove('arrastando-cartao');
    arraste = null;

    if (!destino) return;                      // soltou fora do quadro

    const coluna = moverNoModelo(id, destino, indice);
    if (!coluna) return;
    renderizar();

    try {
      const r = await fetch('/api/leads?mover=1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          etapa_id: destino,
          ordem: coluna.leads.map((l) => l.id)
        })
      });
      if (!r.ok) throw new Error('recusado');
    } catch (e) {
      // O quadro já mostrava o cartão no lugar novo. Se a gravação
      // falhou, recarregar é o único jeito honesto de voltar à verdade.
      alert('Não foi possível mover o lead. O quadro será recarregado.');
      carregar();
    }
  }

  /** Move no estado local para a tela responder antes da rede. */
  function moverNoModelo(id, etapaDestino, indice) {
    let lead = null;

    for (const c of colunas) {
      const i = c.leads.findIndex((l) => l.id === id);
      if (i >= 0) {
        lead = c.leads.splice(i, 1)[0];
        c.total -= 1;
        c.soma -= Number(lead.valor_proposta || 0);
        break;
      }
    }
    if (!lead) return null;

    const destino = colunas.find((c) => c.etapa.id === etapaDestino);
    if (!destino) return null;

    lead.etapa_id = etapaDestino;
    destino.leads.splice(Math.min(indice, destino.leads.length), 0, lead);
    destino.total += 1;
    destino.soma += Number(lead.valor_proposta || 0);
    return destino;
  }

  /* ----------------------------------------------------------
     Gerenciar etapas
     ---------------------------------------------------------- */

  let etapasEmEdicao = [];

  async function abrirEtapas() {
    const modal = el('modal-etapas');
    if (!modal) return;
    modal.classList.remove('hidden');
    await recarregarEtapas();
  }

  async function recarregarEtapas() {
    const lista = el('etapas-lista');
    if (!lista) return;
    lista.innerHTML = '<div class="coluna-vazia">Carregando…</div>';

    try {
      const r = await fetch(`/api/cadastros?tipo=etapas&pipeline=${PIPELINE}`);
      const d = await r.json();
      etapasEmEdicao = d.etapas || [];
      renderizarEtapas();
    } catch (e) {
      lista.innerHTML = '<div class="coluna-vazia">Falha ao carregar as etapas.</div>';
    }
  }

  function renderizarEtapas() {
    const lista = el('etapas-lista');
    if (!lista) return;

    lista.innerHTML = etapasEmEdicao.map((e, i) => `
      <div class="etapa-linha" data-id="${e.id}">
        <input type="color" value="${esc(e.cor || '#6e6e6e')}" data-campo="cor"
               title="Cor da coluna">
        <input type="text" class="form-control etapa-nome" value="${esc(e.nome)}"
               data-campo="nome" maxlength="60">
        <label class="etapa-terminal">
          <input type="checkbox" data-campo="encerra" ${e.encerra ? 'checked' : ''}>
          terminal
        </label>
        <div class="etapa-acoes">
          <button class="btn-action" data-acao="subir" title="Subir"
                  ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn-action" data-acao="descer" title="Descer"
                  ${i === etapasEmEdicao.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn-action" data-acao="excluir" title="Excluir">🗑️</button>
        </div>
      </div>`).join('');
  }

  async function salvarEtapa(id, corpo) {
    try {
      const r = await fetch(`/api/cadastros?tipo=etapas&id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
      });
      if (!r.ok) {
        const d = await r.json();
        alert(d.error || 'Não foi possível salvar a etapa.');
        return false;
      }
      return true;
    } catch (e) {
      alert('Falha de conexão ao salvar a etapa.');
      return false;
    }
  }

  async function reordenarEtapas() {
    try {
      await fetch(`/api/cadastros?tipo=etapas&pipeline=${PIPELINE}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordem: etapasEmEdicao.map((e) => e.id) })
      });
    } catch (e) {
      alert('Falha ao reordenar as etapas.');
    }
  }

  async function criarEtapa() {
    const campo = el('etapa-nova-nome');
    const nome = campo?.value.trim();
    if (!nome) { campo?.focus(); return; }

    try {
      const r = await fetch(`/api/cadastros?tipo=etapas&pipeline=${PIPELINE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, cor: el('etapa-nova-cor')?.value })
      });
      if (!r.ok) {
        const d = await r.json();
        alert(d.error || 'Não foi possível criar a etapa.');
        return;
      }
      campo.value = '';
      await recarregarEtapas();
    } catch (e) {
      alert('Falha de conexão ao criar a etapa.');
    }
  }

  async function excluirEtapa(id, nome) {
    if (!confirm(`Excluir a etapa "${nome}"?`)) return;
    try {
      const r = await fetch(`/api/cadastros?tipo=etapas&id=${id}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) {
        // A trava de exclusão condicional informa quantos leads seguram a etapa
        alert(d.error || 'Não foi possível excluir.');
        return;
      }
      await recarregarEtapas();
    } catch (e) {
      alert('Falha de conexão ao excluir.');
    }
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    const caixa = el('quadro-colunas');
    if (caixa) {
      caixa.addEventListener('pointerdown', aoPressionar);

      caixa.addEventListener('click', (ev) => {
        const recolher = ev.target.closest('[data-recolher]');
        if (recolher) {
          const id = Number(recolher.dataset.recolher);
          const etapa = colunas.find((c) => c.etapa.id === id)?.etapa;
          if (etapa) { recolhidas[id] = !estaRecolhida(etapa); gravarRecolhidas(); renderizar(); }
          return;
        }

        const mais = ev.target.closest('[data-mais]');
        if (mais) { carregarMais(Number(mais.dataset.mais)); return; }

        // Clicar no cartão abre a ficha. A gaveta lateral é o Lote D;
        // até lá, o modal que já existe evita um cartão que não faz nada.
        const cartao = ev.target.closest('.cartao');
        if (cartao && !ev.target.closest('.cartao-alca')) {
          const lead = leadPorId(cartao.dataset.id);
          if (lead && typeof abrirModalComLead === 'function') abrirModalComLead(lead);
        }
      });
    }

    el('btn-gerenciar-etapas')?.addEventListener('click', abrirEtapas);
    el('btn-etapas-fechar')?.addEventListener('click', () => {
      el('modal-etapas')?.classList.add('hidden');
      carregar();     // cor, nome ou ordem podem ter mudado
    });

    el('btn-etapa-criar')?.addEventListener('click', criarEtapa);
    el('etapa-nova-nome')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') criarEtapa();
    });

    const lista = el('etapas-lista');
    if (lista) {
      lista.addEventListener('change', async (ev) => {
        const linha = ev.target.closest('.etapa-linha');
        const campo = ev.target.dataset.campo;
        if (!linha || !campo) return;

        const id = Number(linha.dataset.id);
        if (campo === 'cor') await salvarEtapa(id, { cor: ev.target.value });
        if (campo === 'encerra') await salvarEtapa(id, { encerra: ev.target.checked });
      });

      // Nome grava ao sair do campo: gravar por tecla seria uma
      // requisição por letra digitada.
      lista.addEventListener('blur', async (ev) => {
        if (ev.target.dataset.campo !== 'nome') return;
        const linha = ev.target.closest('.etapa-linha');
        const id = Number(linha.dataset.id);
        const nome = ev.target.value.trim();
        const anterior = etapasEmEdicao.find((e) => e.id === id);
        if (!nome || nome === anterior?.nome) return;
        if (await salvarEtapa(id, { nome })) anterior.nome = nome;
      }, true);

      lista.addEventListener('click', async (ev) => {
        const botao = ev.target.closest('[data-acao]');
        if (!botao) return;
        const linha = botao.closest('.etapa-linha');
        const id = Number(linha.dataset.id);
        const i = etapasEmEdicao.findIndex((e) => e.id === id);

        if (botao.dataset.acao === 'excluir') {
          excluirEtapa(id, etapasEmEdicao[i]?.nome || '');
          return;
        }

        const destino = botao.dataset.acao === 'subir' ? i - 1 : i + 1;
        if (destino < 0 || destino >= etapasEmEdicao.length) return;

        const [movida] = etapasEmEdicao.splice(i, 1);
        etapasEmEdicao.splice(destino, 0, movida);
        renderizarEtapas();
        await reordenarEtapas();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { carregar, leadPorId };
})();
