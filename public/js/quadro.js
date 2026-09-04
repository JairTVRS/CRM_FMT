/**
 * quadro.js — o kanban, servindo as duas trilhas.
 *
 * Construído genérico por pipeline desde o Lote C; no Lote H a promessa
 * foi cobrada e o módulo virou FÁBRICA. Antes era um singleton com o
 * pipeline numa constante e os IDs do DOM embutidos — dava para uma
 * trilha só. Agora `Quadro.criar()` devolve uma instância, e o funil
 * comercial e a jornada do cliente são duas instâncias do mesmo código.
 *
 * O que muda entre elas é configuração, não comportamento: qual API
 * chamar, quais filtros mandar, como desenhar o cartão e se o cabeçalho
 * soma dinheiro. Arraste, teto por coluna, colunas recolhidas e
 * gerenciamento de etapas são idênticos e existem uma vez só.
 *
 * O arraste usa Pointer Events, não HTML5 Drag & Drop. O DnD nativo
 * simplesmente não dispara em toque, e um polyfill traria dependência
 * num projeto sem empacotador. Pointer Events cobre mouse, toque e
 * caneta com um caminho de código só.
 *
 * Carregar DEPOIS de leads.js e clientes.js (de onde vêm os filtros) e
 * ANTES do app.js.
 */

const Quadro = (() => {
  /* Abaixo disto o gesto é um toque, não um arraste. Sem a folga, um
     toque com o dedo trêmulo viraria um movimento de cartão. */
  const LIMIAR_ARRASTE = 5;

  const MARGEM_AUTOSCROLL = 70;
  const CHAVE_RECOLHIDAS = 'crm_colunas_recolhidas';

  /* ----------------------------------------------------------
     Utilidades compartilhadas
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

  /* ----------------------------------------------------------
     Colunas recolhidas — estado único das duas trilhas.

     Um mapa só porque o ID da etapa é único na tabela `etapas`,
     independentemente do pipeline: não há como uma coluna da jornada
     colidir com uma do funil. Dois mapas seriam duas chaves de
     localStorage guardando a mesma coisa.
     ---------------------------------------------------------- */

  let recolhidas = {};
  try { recolhidas = JSON.parse(localStorage.getItem(CHAVE_RECOLHIDAS) || '{}'); }
  catch (e) { recolhidas = {}; }

  const estaRecolhida = (etapa) =>
    Object.prototype.hasOwnProperty.call(recolhidas, etapa.id)
      ? !!recolhidas[etapa.id]
      : !!etapa.encerra;

  function gravarRecolhidas() {
    try { localStorage.setItem(CHAVE_RECOLHIDAS, JSON.stringify(recolhidas)); }
    catch (e) { /* modo anônimo: a preferência só não sobrevive à sessão */ }
  }

  /* ==========================================================
     GERENCIADOR DE ETAPAS

     Um só para as duas trilhas, porque há um só modal no HTML.
     Quem abre informa o pipeline; o modal não sabe nada além disso.
     Duplicar o modal por trilha significaria duplicar também os
     ouvintes — e dois ouvintes no mesmo `#etapas-lista` gravariam a
     mesma edição duas vezes, cada um no seu pipeline.
     ========================================================== */

  const Etapas = (() => {
    let pipeline = 'comercial';
    let aoFechar = null;
    let emEdicao = [];

    async function abrir(pipelineDoQuadro, callbackFechar) {
      const modal = el('modal-etapas');
      if (!modal) return;
      pipeline = pipelineDoQuadro;
      aoFechar = callbackFechar;

      const titulo = el('modal-etapas-titulo');
      if (titulo) {
        titulo.textContent = pipeline === 'jornada'
          ? 'Etapas da jornada do cliente'
          : 'Etapas do funil comercial';
      }

      modal.classList.remove('hidden');
      await recarregar();
    }

    async function recarregar() {
      const lista = el('etapas-lista');
      if (!lista) return;
      lista.innerHTML = '<div class="coluna-vazia">Carregando…</div>';

      try {
        const r = await fetch(`/api/cadastros?tipo=etapas&pipeline=${pipeline}`);
        const d = await r.json();
        emEdicao = d.etapas || [];
        renderizar();
      } catch (e) {
        lista.innerHTML = '<div class="coluna-vazia">Falha ao carregar as etapas.</div>';
      }
    }

    function renderizar() {
      const lista = el('etapas-lista');
      if (!lista) return;

      lista.innerHTML = emEdicao.map((e, i) => `
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
                    ${i === emEdicao.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn-action" data-acao="excluir" title="Excluir">🗑️</button>
          </div>
        </div>`).join('');
    }

    async function salvar(id, corpo) {
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

    async function reordenar() {
      try {
        await fetch(`/api/cadastros?tipo=etapas&pipeline=${pipeline}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ordem: emEdicao.map((e) => e.id) })
        });
      } catch (e) {
        alert('Falha ao reordenar as etapas.');
      }
    }

    async function criar() {
      const campo = el('etapa-nova-nome');
      const nome = campo?.value.trim();
      if (!nome) { campo?.focus(); return; }

      try {
        const r = await fetch(`/api/cadastros?tipo=etapas&pipeline=${pipeline}`, {
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
        await recarregar();
      } catch (e) {
        alert('Falha de conexão ao criar a etapa.');
      }
    }

    async function excluir(id, nome) {
      if (!confirm(`Excluir a etapa "${nome}"?`)) return;
      try {
        const r = await fetch(`/api/cadastros?tipo=etapas&id=${id}`, { method: 'DELETE' });
        const d = await r.json();
        if (!r.ok) {
          // A trava de exclusão condicional informa quantos registros
          // seguram a etapa — leads no funil, clientes na jornada.
          alert(d.error || 'Não foi possível excluir.');
          return;
        }
        await recarregar();
      } catch (e) {
        alert('Falha de conexão ao excluir.');
      }
    }

    function iniciar() {
      el('btn-etapas-fechar')?.addEventListener('click', () => {
        el('modal-etapas')?.classList.add('hidden');
        // Cor, nome ou ordem podem ter mudado — só o quadro que abriu
        // precisa se redesenhar.
        if (typeof aoFechar === 'function') aoFechar();
      });

      el('btn-etapa-criar')?.addEventListener('click', criar);
      el('etapa-nova-nome')?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') criar();
      });

      const lista = el('etapas-lista');
      if (!lista) return;

      lista.addEventListener('change', async (ev) => {
        const linha = ev.target.closest('.etapa-linha');
        const campo = ev.target.dataset.campo;
        if (!linha || !campo) return;

        const id = Number(linha.dataset.id);
        if (campo === 'cor') await salvar(id, { cor: ev.target.value });
        if (campo === 'encerra') await salvar(id, { encerra: ev.target.checked });
      });

      // Nome grava ao sair do campo: gravar por tecla seria uma
      // requisição por letra digitada.
      lista.addEventListener('blur', async (ev) => {
        if (ev.target.dataset.campo !== 'nome') return;
        const linha = ev.target.closest('.etapa-linha');
        const id = Number(linha.dataset.id);
        const nome = ev.target.value.trim();
        const anterior = emEdicao.find((e) => e.id === id);
        if (!nome || nome === anterior?.nome) return;
        if (await salvar(id, { nome })) anterior.nome = nome;
      }, true);

      lista.addEventListener('click', async (ev) => {
        const botao = ev.target.closest('[data-acao]');
        if (!botao) return;
        const linha = botao.closest('.etapa-linha');
        const id = Number(linha.dataset.id);
        const i = emEdicao.findIndex((e) => e.id === id);

        if (botao.dataset.acao === 'excluir') {
          excluir(id, emEdicao[i]?.nome || '');
          return;
        }

        const destino = botao.dataset.acao === 'subir' ? i - 1 : i + 1;
        if (destino < 0 || destino >= emEdicao.length) return;

        const [movida] = emEdicao.splice(i, 1);
        emEdicao.splice(destino, 0, movida);
        renderizar();
        await reordenar();
      });
    }

    return { abrir, iniciar };
  })();

  /* ==========================================================
     A FÁBRICA

     Cada chamada devolve um quadro independente, com seu próprio
     estado de colunas e seu próprio arraste.
     ========================================================== */

  /**
   * @param pipeline     'comercial' | 'jornada'
   * @param endpoint     '/api/leads' | '/api/clientes'
   * @param chaveLista   nome do array na resposta paginada, usado pelo
   *                     "carregar mais" ('leads' | 'clientes')
   * @param container    id da div que recebe as colunas
   * @param btnEtapas    id do botão "Gerenciar etapas" deste quadro
   * @param mostrarSoma  cabeçalho soma dinheiro? A jornada não tem o
   *                     que somar até o contrato chegar (Lote G)
   * @param filtros      função que devolve os filtros da tela
   * @param cartao       função que desenha um cartão
   * @param aoAbrir      o que fazer quando o cartão é clicado
   * @param porColuna    teto de cartões por coluna
   */
  function criar({
    pipeline,
    endpoint,
    chaveLista,
    container,
    btnEtapas,
    mostrarSoma = true,
    filtros = () => new URLSearchParams(),
    cartao,
    aoAbrir = () => {},
    porColuna = 50
  }) {
    let colunas = [];
    let carregando = false;
    let arraste = null;

    const caixa = () => el(container);

    function parametros() {
      const p = filtros();
      return p instanceof URLSearchParams ? p : new URLSearchParams(p);
    }

    /* ---------------- Carregamento ---------------- */

    async function carregar() {
      const div = caixa();
      if (!div || carregando) return;
      carregando = true;

      div.innerHTML = '<div class="quadro-vazio">Carregando…</div>';

      const params = parametros();
      params.set('quadro', '1');
      params.set('porColuna', porColuna);

      try {
        const r = await fetch(`${endpoint}?${params}`);
        if (!r.ok) throw new Error('Falha ao carregar o quadro.');

        const d = await r.json();
        colunas = d.colunas || [];
        renderizar();

      } catch (e) {
        div.innerHTML = `<div class="quadro-erro">
          Não foi possível carregar o quadro. Recarregue a página.</div>`;
      } finally {
        carregando = false;
      }
    }

    /** Traz o próximo lote de UMA coluna, sem tocar nas demais. */
    async function carregarMais(etapaId) {
      const coluna = colunas.find((c) => c.etapa.id === etapaId);
      if (!coluna) return;

      const params = parametros();
      params.set('etapa_id', etapaId);
      params.set('porPagina', porColuna);
      params.set('pagina', Math.floor(coluna.registros.length / porColuna) + 1);

      try {
        const r = await fetch(`${endpoint}?${params}`);
        if (!r.ok) return;
        const d = await r.json();

        // Concatenar sem conferir duplicaria cartões se a coluna tivesse
        // mudado no servidor entre as duas leituras.
        const jaTem = new Set(coluna.registros.map((x) => x.id));
        coluna.registros.push(...(d[chaveLista] || []).filter((x) => !jaTem.has(x.id)));
        renderizar();
      } catch (e) {
        // Silêncio: o botão continua ali para nova tentativa.
      }
    }

    /* ---------------- Renderização ---------------- */

    function renderizar() {
      const div = caixa();
      if (!div) return;

      if (colunas.length === 0) {
        div.innerHTML = `<div class="quadro-vazio">
          Nenhuma etapa cadastrada. Use “Gerenciar etapas” para criar a primeira.</div>`;
        return;
      }

      div.innerHTML = colunas.map(colunaHtml).join('');
    }

    function colunaHtml(coluna) {
      const { etapa, total, soma, registros } = coluna;
      const recolhida = estaRecolhida(etapa);
      const faltam = total - registros.length;

      const corpo = recolhida ? '' : `
        <div class="coluna-lista" data-lista="${etapa.id}">
          ${registros.length
            ? registros.map(cartao).join('')
            : '<div class="coluna-vazia">Nenhum registro nesta etapa.</div>'}
        </div>
        ${faltam > 0 ? `
          <div class="coluna-rodape">
            <button class="btn-carregar-mais" data-mais="${etapa.id}">
              Carregar mais ${faltam > porColuna ? porColuna : faltam} de ${faltam}
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
            ${(recolhida || !mostrarSoma) ? '' : `<span class="coluna-soma">${moeda(soma)}</span>`}
          </header>
          ${corpo}
        </section>`;
    }

    function registroPorId(id) {
      for (const c of colunas) {
        const achado = c.registros.find((x) => String(x.id) === String(id));
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

      const cartaoEl = alca.closest('.cartao');
      const coluna = cartaoEl?.closest('.coluna');
      if (!cartaoEl || !coluna) return;

      ev.preventDefault();

      arraste = {
        cartao: cartaoEl,
        id: Number(cartaoEl.dataset.id),
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
      const faixa = caixa();
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

      // `closest('.coluna')` sozinho aceitaria uma coluna do OUTRO
      // quadro se os dois estivessem visíveis. Restringir ao container
      // desta instância mantém cada arraste dentro da sua trilha.
      const candidata = sob?.closest('.coluna');
      const coluna = (candidata && caixa()?.contains(candidata)) ? candidata : null;

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

      const { alca, cartao: cartaoEl, id, ativo, colunaAlvo, marcador } = arraste;

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
      cartaoEl.classList.remove('arrastando');
      colunaAlvo?.classList.remove('alvo');
      document.body.classList.remove('arrastando-cartao');
      arraste = null;

      if (!destino) return;                      // soltou fora do quadro

      const coluna = moverNoModelo(id, destino, indice);
      if (!coluna) return;
      renderizar();

      try {
        const r = await fetch(`${endpoint}?mover=1`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            etapa_id: destino,
            ordem: coluna.registros.map((x) => x.id)
          })
        });
        if (!r.ok) throw new Error('recusado');
      } catch (e) {
        // O quadro já mostrava o cartão no lugar novo. Se a gravação
        // falhou, recarregar é o único jeito honesto de voltar à verdade.
        alert('Não foi possível mover o cartão. O quadro será recarregado.');
        carregar();
      }
    }

    /** Move no estado local para a tela responder antes da rede. */
    function moverNoModelo(id, etapaDestino, indice) {
      let registro = null;

      for (const c of colunas) {
        const i = c.registros.findIndex((x) => x.id === id);
        if (i >= 0) {
          registro = c.registros.splice(i, 1)[0];
          c.total -= 1;
          c.soma -= Number(registro.valor_proposta || 0);
          break;
        }
      }
      if (!registro) return null;

      const destino = colunas.find((c) => c.etapa.id === etapaDestino);
      if (!destino) return null;

      registro.etapa_id = etapaDestino;
      destino.registros.splice(Math.min(indice, destino.registros.length), 0, registro);
      destino.total += 1;
      destino.soma += Number(registro.valor_proposta || 0);
      return destino;
    }

    /* ---------------- Ligação com a interface ---------------- */

    function iniciar() {
      const div = caixa();
      if (div) {
        div.addEventListener('pointerdown', aoPressionar);

        div.addEventListener('click', (ev) => {
          const recolher = ev.target.closest('[data-recolher]');
          if (recolher) {
            const id = Number(recolher.dataset.recolher);
            const etapa = colunas.find((c) => c.etapa.id === id)?.etapa;
            if (etapa) { recolhidas[id] = !estaRecolhida(etapa); gravarRecolhidas(); renderizar(); }
            return;
          }

          const mais = ev.target.closest('[data-mais]');
          if (mais) { carregarMais(Number(mais.dataset.mais)); return; }

          const cartaoEl = ev.target.closest('.cartao');
          if (cartaoEl && !ev.target.closest('.cartao-alca')) {
            const registro = registroPorId(cartaoEl.dataset.id);
            if (registro) aoAbrir(registro);
          }
        });
      }

      el(btnEtapas)?.addEventListener('click', () => Etapas.abrir(pipeline, carregar));
    }

    document.addEventListener('DOMContentLoaded', iniciar);

    return { carregar, registroPorId, pipeline };
  }

  document.addEventListener('DOMContentLoaded', Etapas.iniciar);

  return { criar, esc, moeda, diasPara, rotuloPrazo };
})();

/* ==========================================================================
   O QUADRO DO FUNIL COMERCIAL

   Fica aqui, e não em leads.js, porque é a configuração de um quadro —
   não a lógica dos leads. `Quadro.carregar()` segue existindo com a
   mesma assinatura de antes, que é o que leads.js chama.
   ========================================================================== */

const QuadroLeads = Quadro.criar({
  pipeline: 'comercial',
  endpoint: '/api/leads',
  chaveLista: 'leads',
  container: 'quadro-colunas',
  btnEtapas: 'btn-gerenciar-etapas',
  mostrarSoma: true,

  filtros: () => {
    const f = (typeof Leads !== 'undefined' && Leads.filtros) ? Leads.filtros() : {};
    const p = new URLSearchParams();
    if (f.busca) p.set('busca', f.busca);
    if (f.ramo) p.set('ramo', f.ramo);
    if (f.segmento) p.set('segmento', f.segmento);
    if (f.canal) p.set('canal', f.canal);
    if (f.classificacao) p.set('classificacao', f.classificacao);
    return p;
  },

  cartao: (lead) => {
    const esc = Quadro.esc;
    const prazo = Quadro.rotuloPrazo(Quadro.diasPara(lead.data_proximo_contato));
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
            ${lead.valor_proposta ? `<span class="cartao-valor">${Quadro.moeda(lead.valor_proposta)}</span>` : ''}
            ${prazo ? `<span class="cartao-prazo ${prazo.classe}">${prazo.texto}</span>` : ''}
          </div>
        </div>
      </article>`;
  },

  aoAbrir: (lead) => {
    if (typeof abrirModalComLead === 'function') abrirModalComLead(lead);
  }
});
