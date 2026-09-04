/**
 * clientes.js — a jornada do cliente (trilha de CX).
 *
 * O irmão do leads.js do outro lado do produto. Captar cliente e cuidar
 * de cliente são processos diferentes, e as duas telas refletem isso:
 * mesma mecânica de tabela, quadro e filtro único, campos distintos.
 *
 * O quadro em si NÃO está aqui. Ele é uma instância de `Quadro.criar()`,
 * o mesmo componente do funil comercial — este módulo só entrega os
 * filtros e diz como desenhar o cartão.
 *
 * O que este módulo deliberadamente não faz é falar com o ERP. Enquanto
 * a chave do hub com escopo ampliado não chega, o cadastro é manual e
 * `erp_id` fica nulo. A trava "todo cliente de CX tem que existir no
 * ERP" é o Lote F; barrá-la agora, sem poder verificar, deixaria a
 * trilha inteira inutilizável.
 *
 * Carregar DEPOIS do cadastros.js e do quadro.js: a instância do quadro
 * da jornada é montada no fim deste arquivo e precisa da fábrica já
 * definida. As funções passadas na configuração são preguiçosas, então
 * o `Clientes` ainda incompleto no momento da chamada não é problema.
 */

const Clientes = (() => {
  const POR_PAGINA = 10;
  const PIPELINE = 'jornada';

  let estado = {
    pagina: 1,
    busca: '',
    nucleo: '',
    classificacao: '',
    inativos: false,
    total: 0,
    totalPaginas: 1,
    carregando: false
  };

  const CHAVE_MODO = 'crm_modo_clientes';
  const ESTREITO = window.matchMedia('(max-width: 900px)');
  let modo = localStorage.getItem(CHAVE_MODO) === 'quadro' ? 'quadro' : 'tabela';

  let naTela = [];
  let idEmEdicao = null;
  let debounce = null;
  let nucleosSelecionados = new Set();

  /* As etapas da jornada são de OUTRO pipeline: o Cadastros carrega as
     do funil comercial, e reaproveitar aquela lista aqui colocaria o
     cliente numa coluna que não existe no quadro dele. */
  let etapasJornada = [];

  /* ----------------------------------------------------------
     Utilidades
     ---------------------------------------------------------- */

  const el = (id) => document.getElementById(id);

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function formatarCnpj(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
    return v || '—';
  }

  /** O banco guarda ISO; o input[type=date] quer exatamente AAAA-MM-DD. */
  const soData = (v) => (v ? String(v).slice(0, 10) : '');

  /** Os IDs vêm como JSON de texto do D1 — ou já como array, se local. */
  function listaDeNucleos(cliente) {
    if (Array.isArray(cliente?.nucleos)) return cliente.nucleos;
    try { return JSON.parse(cliente?.nucleos || '[]'); }
    catch (e) { return []; }
  }

  const nomeDoNucleo = (id) =>
    (typeof Cadastros !== 'undefined' ? Cadastros.nucleoPorId(id)?.nome : null) || null;

  const etapaPorId = (id) => etapasJornada.find((e) => e.id === Number(id)) || null;

  /* ----------------------------------------------------------
     Carregamento
     ---------------------------------------------------------- */

  function parametros() {
    const p = new URLSearchParams();
    if (estado.busca) p.set('busca', estado.busca);
    if (estado.nucleo) p.set('nucleo', estado.nucleo);
    if (estado.classificacao) p.set('classificacao', estado.classificacao);
    if (estado.inativos) p.set('inativos', '1');
    return p;
  }

  async function carregarEtapas() {
    try {
      const r = await fetch(`/api/cadastros?tipo=etapas&pipeline=${PIPELINE}`);
      if (!r.ok) return;
      const d = await r.json();
      etapasJornada = d.etapas || [];
      montarSelectEtapas();
    } catch (e) {
      // Sem etapas o select fica vazio; o cadastro ainda grava, e a API
      // põe o cliente na primeira coluna da jornada.
    }
  }

  async function carregar() {
    if (estado.carregando) return;
    estado.carregando = true;

    const corpo = el('table-clientes-body');
    if (corpo) {
      corpo.innerHTML = `<tr><td colspan="7" class="leads-vazio">Carregando…</td></tr>`;
    }

    const params = parametros();
    params.set('pagina', estado.pagina);
    params.set('porPagina', POR_PAGINA);

    try {
      const r = await fetch(`/api/clientes?${params}`);
      if (!r.ok) throw new Error('Falha ao carregar.');

      const d = await r.json();
      naTela = d.clientes || [];
      estado.total = d.total || 0;
      estado.totalPaginas = d.totalPaginas || 1;
      renderizar();

    } catch (e) {
      if (corpo) {
        corpo.innerHTML = `<tr><td colspan="7" class="leads-vazio">
          Não foi possível carregar os clientes.</td></tr>`;
      }
    } finally {
      estado.carregando = false;
    }
  }

  /* ----------------------------------------------------------
     Tabela
     ---------------------------------------------------------- */

  function renderizar() {
    const corpo = el('table-clientes-body');
    if (!corpo) return;

    if (naTela.length === 0) {
      corpo.innerHTML = `<tr><td colspan="7" class="leads-vazio">${
        estado.inativos
          ? 'Nenhum cliente inativo.'
          : 'Nenhum cliente cadastrado ainda.'
      }</td></tr>`;
    } else {
      corpo.innerHTML = naTela.map(linhaHtml).join('');
    }

    const info = el('total-clientes');
    if (info) info.textContent = `Total de Registros: ${estado.total}`;

    const pag = el('info-pagina-clientes');
    if (pag) pag.textContent = `Página ${estado.pagina} de ${estado.totalPaginas}`;

    el('btn-cli-anterior')?.toggleAttribute('disabled', estado.pagina <= 1);
    el('btn-cli-proxima')?.toggleAttribute('disabled', estado.pagina >= estado.totalPaginas);
  }

  function linhaHtml(c) {
    const nucleos = listaDeNucleos(c).map(nomeDoNucleo).filter(Boolean);
    const etapa = etapaPorId(c.etapa_id);

    // Na aba de inativos a ação é reativar, não inativar de novo.
    const acoes = estado.inativos
      ? `<button class="btn-action btn-reativar" title="Reativar cliente">↩︎</button>`
      : `<button class="btn-action btn-edit" title="Abrir ficha">✏️</button>
         <button class="btn-action btn-delete" title="Inativar cliente">🗑️</button>`;

    return `
      <tr data-id="${c.id}">
        <td>
          ${esc(c.nome)}
          ${c.nome_fantasia ? `<div class="celula-secundaria">${esc(c.nome_fantasia)}</div>` : ''}
        </td>
        <td>${formatarCnpj(c.documento)}</td>
        <td>${esc(c.cidade) || '—'}</td>
        <td>${nucleos.length ? nucleos.map((n) => `<span class="chip-nucleo">${esc(n)}</span>`).join(' ') : '—'}</td>
        <td class="text-center">${c.classificacao || '—'}</td>
        <td>${etapa ? `<span class="pilula-etapa" style="--cor-etapa:${esc(etapa.cor)}">${esc(etapa.nome)}</span>` : '—'}</td>
        <td class="text-center">${acoes}</td>
      </tr>`;
  }

  /* ----------------------------------------------------------
     Ficha
     ---------------------------------------------------------- */

  function montarSelectEtapas(selecionada) {
    const select = el('cliente-input-etapa');
    if (!select) return;
    select.innerHTML = etapasJornada
      .map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`)
      .join('');
    if (selecionada) select.value = String(selecionada);
  }

  function montarNucleos() {
    const caixa = el('cliente-nucleos');
    if (!caixa) return;

    const lista = (typeof Cadastros !== 'undefined' ? Cadastros.nucleos() : []) || [];
    if (lista.length === 0) {
      caixa.innerHTML = '<span class="tags-vazio">Nenhum núcleo cadastrado.</span>';
      return;
    }

    // Reaproveita o chip das tags do lead — mesma interação (liga e
    // desliga no clique), mesma variável de cor. Uma classe nova só para
    // trocar o nome do conceito duplicaria CSS idêntico.
    caixa.innerHTML = lista.map((n) => `
      <button type="button" class="tag-chip${nucleosSelecionados.has(n.id) ? ' ligada' : ''}"
              data-nucleo="${n.id}" style="--cor-tag:${esc(n.cor || '#6e6e6e')}">
        ${esc(n.nome)}
      </button>`).join('');
  }

  function limparFicha() {
    const modal = el('modal-cliente');
    if (!modal) return;
    modal.querySelectorAll('input, textarea').forEach((campo) => { campo.value = ''; });
    modal.querySelectorAll('select').forEach((campo) => { campo.selectedIndex = 0; });
    nucleosSelecionados = new Set();
    montarNucleos();
  }

  function preencherFicha(c) {
    const set = (id, valor) => { const campo = el(id); if (campo) campo.value = valor ?? ''; };

    set('cliente-input-nome', c.nome);
    set('cliente-input-fantasia', c.nome_fantasia);
    set('cliente-input-cnpj', formatarCnpj(c.documento));
    set('cliente-input-telefone', c.telefone);
    set('cliente-input-email', c.email);
    set('cliente-input-contato', c.contato_nome);
    set('cliente-input-cidade', c.cidade);
    set('cliente-input-classificacao', c.classificacao || '');
    set('cliente-input-inicio', soData(c.data_inicio));
    set('cliente-input-observacoes', c.observacoes);

    montarSelectEtapas(c.etapa_id);

    nucleosSelecionados = new Set(listaDeNucleos(c).map(Number));
    montarNucleos();

    // O vínculo com o ERP é do Lote F. Enquanto ele não existe, a ficha
    // diz isso em vez de mostrar um campo vazio sem explicação — vazio
    // seria lido como "o cliente não está no ERP", que é outra coisa.
    const erp = el('cliente-erp');
    if (erp) {
      erp.textContent = c.erp_id
        ? `Vinculado ao ERP (ID ${c.erp_id})`
        : 'Ainda não vinculado ao ERP — cadastro manual.';
    }
  }

  function abrirFicha(cliente) {
    const modal = el('modal-cliente');
    if (!modal) return;

    limparFicha();

    if (cliente) {
      idEmEdicao = cliente.id;
      preencherFicha(cliente);
      el('modal-cliente-title').textContent = `Cliente: ${cliente.nome}`;
    } else {
      idEmEdicao = null;
      montarSelectEtapas();
      el('modal-cliente-title').textContent = 'Novo Cliente';
      const erp = el('cliente-erp');
      if (erp) erp.textContent = 'Ainda não vinculado ao ERP — cadastro manual.';
    }

    modal.classList.remove('hidden');
  }

  const fecharFicha = () => el('modal-cliente')?.classList.add('hidden');

  async function salvar() {
    const valor = (id) => el(id)?.value.trim() || '';

    const corpo = {
      nome: valor('cliente-input-nome'),
      nome_fantasia: valor('cliente-input-fantasia'),
      documento: valor('cliente-input-cnpj'),
      telefone: valor('cliente-input-telefone'),
      email: valor('cliente-input-email'),
      contato_nome: valor('cliente-input-contato'),
      cidade: valor('cliente-input-cidade'),
      etapa_id: valor('cliente-input-etapa') || null,
      classificacao: valor('cliente-input-classificacao') || null,
      data_inicio: valor('cliente-input-inicio') || null,
      observacoes: valor('cliente-input-observacoes'),
      nucleos: [...nucleosSelecionados]
    };

    const url = idEmEdicao ? `/api/clientes?id=${idEmEdicao}` : '/api/clientes';

    try {
      const r = await fetch(url, {
        method: idEmEdicao ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
      });
      const d = await r.json();

      if (!r.ok) {
        // Duplicado devolve o existente: oferecer abrir é mais útil que
        // repetir "já existe" e deixar o usuário procurar na lista.
        if (d.code === 'DUPLICADO' && d.existente) {
          if (confirm(`${d.error}\n\nAbrir a ficha de "${d.existente.nome}"?`)) {
            const alvo = await buscarPorId(d.existente.id);
            if (alvo) abrirFicha(alvo);
          }
          return false;
        }
        alert(d.error || 'Não foi possível salvar o cliente.');
        return false;
      }

      recarregarVisao();
      return true;

    } catch (e) {
      alert('Falha de conexão ao salvar o cliente.');
      return false;
    }
  }

  async function buscarPorId(id) {
    try {
      const r = await fetch(`/api/clientes?id=${id}`);
      if (!r.ok) return null;
      const d = await r.json();
      return d.cliente || null;
    } catch (e) {
      return null;
    }
  }

  async function inativar(id, nome) {
    if (!confirm(`Inativar o cliente "${nome}"?\n\nEle sai do quadro da jornada, mas segue consultável em "Ver inativos".`)) return;
    try {
      const r = await fetch(`/api/clientes?id=${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json();
        alert(d.error || 'Não foi possível inativar.');
        return;
      }
      recarregarVisao();
    } catch (e) {
      alert('Falha de conexão ao inativar.');
    }
  }

  async function reativar(id, nome) {
    if (!confirm(`Reativar o cliente "${nome}"?`)) return;
    try {
      const r = await fetch(`/api/clientes?id=${id}&reativar=1`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) {
        const d = await r.json();
        alert(d.error || 'Não foi possível reativar.');
        return;
      }
      recarregarVisao();
    } catch (e) {
      alert('Falha de conexão ao reativar.');
    }
  }

  /* ----------------------------------------------------------
     Tabela ou quadro
     ---------------------------------------------------------- */

  function recarregarVisao() {
    // O quadro mostra a jornada de quem está ativo. Ver inativos é uma
    // consulta, não uma etapa — por isso força a tabela.
    if (modo === 'quadro' && !estado.inativos && typeof QuadroJornada !== 'undefined') {
      QuadroJornada.carregar();
    } else {
      carregar();
    }
  }

  function aplicarModo(novo, { recarregar = true } = {}) {
    modo = (novo === 'quadro' && !ESTREITO.matches) ? 'quadro' : 'tabela';
    localStorage.setItem(CHAVE_MODO, novo);

    const emQuadro = modo === 'quadro' && !estado.inativos;
    el('view-clientes-tabela')?.classList.toggle('hidden', emQuadro);
    el('view-clientes-quadro')?.classList.toggle('hidden', !emQuadro);

    document.querySelectorAll('[data-modo-cliente]').forEach((b) => {
      b.classList.toggle('active', b.dataset.modoCliente === modo);
    });

    if (recarregar) recarregarVisao();
  }

  function filtrar(mudanca) {
    Object.assign(estado, mudanca, { pagina: 1 });
    recarregarVisao();
  }

  function irParaPagina(n) {
    if (n < 1 || n > estado.totalPaginas) return;
    estado.pagina = n;
    carregar();
  }

  /* ----------------------------------------------------------
     Núcleos e papéis

     Cadastro simplificado, a mesma mecânica de advisors e tags: digita
     o nome, vira opção para todos. O gerenciamento vive aqui e não no
     modal de etapas porque são coisas de naturezas diferentes — etapa
     é coluna do quadro, núcleo e papel são vocabulário.
     ---------------------------------------------------------- */

  function linhaCadastroHtml(item, tipo, temCor) {
    return `
      <div class="etapa-linha" data-id="${item.id}" data-tipo="${tipo}">
        ${temCor
          ? `<input type="color" value="${esc(item.cor || '#6e6e6e')}" data-campo="cor" title="Cor">`
          : ''}
        <input type="text" class="form-control etapa-nome" value="${esc(item.nome)}"
               data-campo="nome" maxlength="60">
        <div class="etapa-acoes">
          <button class="btn-action" data-acao="excluir" title="Excluir">🗑️</button>
        </div>
      </div>`;
  }

  function renderizarCx() {
    const nucleos = el('cx-nucleos-lista');
    const papeis = el('cx-papeis-lista');
    if (!nucleos || !papeis) return;

    const listaNucleos = Cadastros.nucleos();
    const listaPapeis = Cadastros.papeis();

    nucleos.innerHTML = listaNucleos.length
      ? listaNucleos.map((n) => linhaCadastroHtml(n, 'nucleos', true)).join('')
      : '<div class="coluna-vazia">Nenhum núcleo cadastrado.</div>';

    papeis.innerHTML = listaPapeis.length
      ? listaPapeis.map((p) => linhaCadastroHtml(p, 'papeis', false)).join('')
      : '<div class="coluna-vazia">Nenhum papel cadastrado ainda.</div>';
  }

  async function salvarCadastroCx(tipo, id, corpo) {
    try {
      const r = await fetch(`/api/cadastros?tipo=${tipo}&id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
      });
      if (!r.ok) {
        const d = await r.json();
        alert(d.error || 'Não foi possível salvar.');
        return false;
      }
      await Cadastros.recarregarLista(tipo);
      return true;
    } catch (e) {
      alert('Falha de conexão ao salvar.');
      return false;
    }
  }

  async function excluirCadastroCx(tipo, id, nome) {
    if (!confirm(`Excluir "${nome}"?`)) return;
    try {
      const r = await fetch(`/api/cadastros?tipo=${tipo}&id=${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json();
        // A trava de exclusão condicional diz quantos clientes seguram
        // o núcleo, em vez de só recusar.
        alert(d.error || 'Não foi possível excluir.');
        return;
      }
      await Cadastros.recarregarLista(tipo);
      renderizarCx();
      montarFiltroNucleos();
      montarNucleos();
    } catch (e) {
      alert('Falha de conexão ao excluir.');
    }
  }

  function iniciarCx() {
    el('btn-gerenciar-cx')?.addEventListener('click', () => {
      renderizarCx();
      el('modal-cx')?.classList.remove('hidden');
    });

    el('btn-cx-fechar')?.addEventListener('click', () => {
      el('modal-cx')?.classList.add('hidden');
      // Nome ou cor podem ter mudado: o filtro, os chips da ficha e os
      // cartões do quadro mostram esses nomes.
      montarFiltroNucleos();
      montarNucleos();
      recarregarVisao();
    });

    el('btn-cx-nucleo-criar')?.addEventListener('click', async () => {
      const campo = el('cx-nucleo-nome');
      const nome = campo?.value.trim();
      if (!nome) { campo?.focus(); return; }
      if (!await Cadastros.criarNucleo(nome, el('cx-nucleo-cor')?.value)) {
        alert('Não foi possível criar o núcleo.');
        return;
      }
      campo.value = '';
      renderizarCx();
    });

    el('btn-cx-papel-criar')?.addEventListener('click', async () => {
      const campo = el('cx-papel-nome');
      const nome = campo?.value.trim();
      if (!nome) { campo?.focus(); return; }
      if (!await Cadastros.criarPapel(nome)) {
        alert('Não foi possível criar o papel.');
        return;
      }
      campo.value = '';
      renderizarCx();
    });

    ['cx-nucleo-nome', 'cx-papel-nome'].forEach((id) => {
      el(id)?.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        el(id === 'cx-nucleo-nome' ? 'btn-cx-nucleo-criar' : 'btn-cx-papel-criar')?.click();
      });
    });

    const modal = el('modal-cx');
    if (!modal) return;

    modal.addEventListener('change', async (ev) => {
      const linha = ev.target.closest('.etapa-linha');
      if (!linha || ev.target.dataset.campo !== 'cor') return;
      await salvarCadastroCx(linha.dataset.tipo, Number(linha.dataset.id), { cor: ev.target.value });
    });

    // Nome grava ao sair do campo: por tecla seria uma requisição por letra.
    modal.addEventListener('blur', async (ev) => {
      if (ev.target.dataset.campo !== 'nome') return;
      const linha = ev.target.closest('.etapa-linha');
      const tipo = linha.dataset.tipo;
      const id = Number(linha.dataset.id);
      const nome = ev.target.value.trim();
      const anterior = (tipo === 'nucleos' ? Cadastros.nucleos() : Cadastros.papeis())
        .find((i) => i.id === id);
      if (!nome || nome === anterior?.nome) return;
      await salvarCadastroCx(tipo, id, { nome });
    }, true);

    modal.addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-acao="excluir"]');
      if (!botao) return;
      const linha = botao.closest('.etapa-linha');
      const tipo = linha.dataset.tipo;
      const id = Number(linha.dataset.id);
      const nome = linha.querySelector('[data-campo="nome"]')?.value || '';
      excluirCadastroCx(tipo, id, nome);
    });
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function montarFiltroNucleos() {
    const select = el('filter-nucleo');
    if (!select) return;
    const escolhido = select.value;
    const lista = (typeof Cadastros !== 'undefined' ? Cadastros.nucleos() : []) || [];
    select.innerHTML = '<option value="">Todos os Núcleos</option>'
      + lista.map((n) => `<option value="${n.id}">${esc(n.nome)}</option>`).join('');
    select.value = escolhido;
  }

  function iniciar() {
    el('input-search-cliente')?.addEventListener('input', (ev) => {
      clearTimeout(debounce);
      const v = ev.target.value.trim();
      debounce = setTimeout(() => filtrar({ busca: v }), 350);
    });

    el('filter-nucleo')?.addEventListener('change', (ev) => filtrar({ nucleo: ev.target.value }));
    el('filter-classificacao-cliente')?.addEventListener('change', (ev) => filtrar({ classificacao: ev.target.value }));

    el('chk-clientes-inativos')?.addEventListener('change', (ev) => {
      estado.inativos = ev.target.checked;
      estado.pagina = 1;
      aplicarModo(modo);          // inativos força a tabela
    });

    el('btn-incluir-cliente')?.addEventListener('click', () => abrirFicha(null));
    el('btn-cliente-close')?.addEventListener('click', fecharFicha);
    el('btn-cliente-cancel')?.addEventListener('click', fecharFicha);
    el('btn-cliente-save')?.addEventListener('click', async () => {
      if (await salvar()) fecharFicha();
    });

    el('modal-cliente')?.addEventListener('click', (ev) => {
      if (ev.target === el('modal-cliente')) fecharFicha();
    });

    el('cliente-nucleos')?.addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-nucleo]');
      if (!chip) return;
      const id = Number(chip.dataset.nucleo);
      if (nucleosSelecionados.has(id)) nucleosSelecionados.delete(id);
      else nucleosSelecionados.add(id);
      chip.classList.toggle('ligada');
    });

    // Ações da tabela
    el('table-clientes-body')?.addEventListener('click', async (ev) => {
      const tr = ev.target.closest('tr');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      const cliente = naTela.find((c) => c.id === id);
      if (!cliente) return;

      if (ev.target.classList.contains('btn-edit')) abrirFicha(cliente);
      if (ev.target.classList.contains('btn-delete')) inativar(id, cliente.nome);
      if (ev.target.classList.contains('btn-reativar')) reativar(id, cliente.nome);
    });

    el('btn-cli-anterior')?.addEventListener('click', () => irParaPagina(estado.pagina - 1));
    el('btn-cli-proxima')?.addEventListener('click', () => irParaPagina(estado.pagina + 1));

    document.querySelectorAll('[data-modo-cliente]').forEach((botao) => {
      botao.addEventListener('click', () => aplicarModo(botao.dataset.modoCliente));
    });

    ESTREITO.addEventListener('change', () => {
      if (ESTREITO.matches && modo === 'quadro') aplicarModo('tabela');
    });

    // As listas chegam depois da autenticação.
    document.addEventListener('crm:cadastros', () => {
      montarFiltroNucleos();
      montarNucleos();
    });

    iniciarCx();
    aplicarModo(modo, { recarregar: false });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  /**
   * A tela de clientes só carrega quando o usuário entra nela.
   *
   * Diferente do leads.js, que carrega no `crm:autenticado`: a jornada
   * não é a tela inicial, e puxá-la no login gastaria duas consultas ao
   * D1 por sessão para uma aba que talvez nem seja aberta.
   */
  let jaCarregou = false;
  function aoEntrarNaTela() {
    if (!jaCarregou) {
      jaCarregou = true;
      carregarEtapas();
    }
    recarregarVisao();
  }

  return {
    carregar, recarregarVisao, aoEntrarNaTela, abrirFicha,
    parametros, listaDeNucleos, nomeDoNucleo, etapaPorId
  };
})();

/* ==========================================================================
   O QUADRO DA JORNADA

   Segunda instância do mesmo componente do funil comercial. O que muda
   é a configuração — endpoint, filtros, cartão —, não o comportamento.
   ========================================================================== */

const QuadroJornada = Quadro.criar({
  pipeline: 'jornada',
  endpoint: '/api/clientes',
  chaveLista: 'clientes',
  container: 'jornada-colunas',
  btnEtapas: 'btn-gerenciar-etapas-jornada',

  // A jornada não soma dinheiro: o valor do contrato é do Lote G, e um
  // cabeçalho com R$ 0 em todas as colunas seria pior que sem soma.
  mostrarSoma: false,

  filtros: () => Clientes.parametros(),

  cartao: (c) => {
    const esc = Quadro.esc;
    const nucleos = Clientes.listaDeNucleos(c)
      .map(Clientes.nomeDoNucleo)
      .filter(Boolean);

    return `
      <article class="cartao" data-id="${c.id}">
        <span class="cartao-alca" title="Arrastar" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
            <circle cx="6" cy="3" r="1.3"></circle><circle cx="10" cy="3" r="1.3"></circle>
            <circle cx="6" cy="8" r="1.3"></circle><circle cx="10" cy="8" r="1.3"></circle>
            <circle cx="6" cy="13" r="1.3"></circle><circle cx="10" cy="13" r="1.3"></circle>
          </svg>
        </span>
        <div class="cartao-corpo">
          <div class="cartao-nome">${esc(c.nome_fantasia || c.nome)}</div>
          ${c.cidade ? `<div class="cartao-linha">${esc(c.cidade)}</div>` : ''}
          <div class="cartao-linha">
            ${c.classificacao ? `<span class="badge-classificacao" title="Classificação">${c.classificacao}</span>` : ''}
            ${nucleos.map((n) => `<span class="chip-nucleo">${esc(n)}</span>`).join('')}
          </div>
          ${c.erp_id ? '' : '<div class="cartao-aviso" title="Vínculo com o ERP é do Lote F">sem ERP</div>'}
        </div>
      </article>`;
  },

  aoAbrir: (c) => Clientes.abrirFicha(c)
});
