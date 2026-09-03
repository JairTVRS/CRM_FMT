/**
 * leads.js — Gestão de leads contra o banco.
 *
 * Reescrito do zero. A versão anterior era código morto: procurava IDs
 * que não existiam no HTML (`tabela-leads-body` em vez de
 * `table-leads-body`), então nunca renderizava nada. Na prática quem
 * desenhava a tabela era o app.js, manipulando o DOM direto e sem
 * gravar em lugar nenhum — por isso os cadastros sumiam a cada reload.
 *
 * Agora tudo passa por /api/leads, que persiste em D1.
 *
 * Carregar DEPOIS do auth.js (que injeta o token) e ANTES do app.js.
 */

const Leads = (() => {
  const POR_PAGINA = 10;

  let estado = {
    pagina: 1,
    busca: '',
    ramo: '',
    segmento: '',
    canal: '',
    classificacao: '',
    total: 0,
    totalPaginas: 1,
    carregando: false
  };

  /* Tabela ou quadro. O leads.js é dono dos filtros, então também é dele
     a decisão de qual visão recarregar quando um filtro muda — as duas
     precisam mostrar sempre o mesmo conjunto. */
  const CHAVE_MODO = 'crm_modo_leads';
  const ESTREITO = window.matchMedia('(max-width: 900px)');
  let modo = localStorage.getItem(CHAVE_MODO) === 'quadro' ? 'quadro' : 'tabela';

  let leadsNaTela = [];
  let idEmEdicao = null;
  let debounce = null;

  /* ----------------------------------------------------------
     Utilidades
     ---------------------------------------------------------- */

  const el = (id) => document.getElementById(id);

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function formatarDocumento(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
    if (d.length === 11) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
    return v || '—';
  }

  function linkWhatsApp(telefone) {
    const d = String(telefone || '').replace(/\D/g, '');
    if (d.length < 10) return null;
    return `https://wa.me/55${d}`;
  }

  /* ----------------------------------------------------------
     Carregamento
     ---------------------------------------------------------- */

  async function carregar() {
    if (estado.carregando) return;
    estado.carregando = true;

    const corpo = el('table-leads-body');
    if (corpo) {
      corpo.innerHTML = `<tr><td colspan="8" class="leads-vazio">Carregando…</td></tr>`;
    }

    const params = new URLSearchParams({
      pagina: estado.pagina,
      porPagina: POR_PAGINA
    });
    if (estado.busca) params.set('busca', estado.busca);
    if (estado.ramo) params.set('ramo', estado.ramo);
    if (estado.segmento) params.set('segmento', estado.segmento);
    if (estado.canal) params.set('canal', estado.canal);
    if (estado.classificacao) params.set('classificacao', estado.classificacao);

    try {
      const r = await fetch(`/api/leads?${params}`);
      if (!r.ok) throw new Error('Falha ao carregar.');

      const d = await r.json();
      leadsNaTela = d.leads || [];
      estado.total = d.total;
      estado.totalPaginas = d.totalPaginas;

      renderizar();
      await marcarDossies();

    } catch (e) {
      if (corpo) {
        corpo.innerHTML = `<tr><td colspan="8" class="leads-vazio">
          Não foi possível carregar os leads. Recarregue a página.</td></tr>`;
      }
    } finally {
      estado.carregando = false;
    }
  }

  /* ----------------------------------------------------------
     Renderização
     ---------------------------------------------------------- */

  function renderizar() {
    const corpo = el('table-leads-body');
    if (!corpo) return;

    if (leadsNaTela.length === 0) {
      const filtrando = estado.busca || estado.ramo || estado.segmento
                     || estado.canal || estado.classificacao;
      corpo.innerHTML = `<tr><td colspan="8" class="leads-vazio">${
        filtrando
          ? 'Nenhum lead encontrado com esses filtros.'
          : 'Nenhum lead cadastrado ainda. Clique em “+ Incluir Lead” para começar.'
      }</td></tr>`;
    } else {
      corpo.innerHTML = leadsNaTela.map(linha).join('');
    }

    const contador = el('total-registros');
    if (contador) contador.textContent = `Total de Registros: ${estado.total}`;

    const info = el('info-pagina');
    if (info) info.textContent = `Página ${estado.pagina} de ${estado.totalPaginas}`;

    const anterior = el('btn-pag-anterior');
    const proxima = el('btn-pag-proxima');
    if (anterior) anterior.disabled = estado.pagina <= 1;
    if (proxima) proxima.disabled = estado.pagina >= estado.totalPaginas;
  }

  function linha(lead) {
    const wa = linkWhatsApp(lead.telefone);
    const cnpj = String(lead.documento || '').replace(/\D/g, '');

    // `origem` é o nome antigo da coluna; leads gravados antes do Lote A
    // ainda a usam, e a leitura precisa cobrir os dois.
    const canal = lead.canal || lead.origem;

    return `
    <tr data-id="${lead.id}">
      <td><strong>${esc(lead.nome)}</strong></td>
      <td>${esc(formatarDocumento(lead.documento))}</td>
      <td>${esc(lead.telefone || '—')}</td>
      <td>${canal ? `<span class="badge">${esc(canal)}</span>` : '—'}</td>
      <td class="text-center">${lead.classificacao
        ? `<span class="badge-classificacao">${lead.classificacao}</span>` : '—'}</td>
      <td>${esc(lead.ramo || '—')}</td>
      <td>${esc(lead.segmento || '—')}</td>
      <td style="text-align: left;">
        <button class="btn-action btn-edit" title="Editar">✏️</button>
        ${wa
          ? `<a href="${wa}" target="_blank" rel="noopener" class="btn-action btn-wa" title="WhatsApp" style="text-decoration:none;display:inline-block;">💬</a>`
          : ''}
        <button class="btn-action btn-ai" title="Gerar Inteligência">A</button>
        <button class="btn-action btn-dossie" data-cnpj="${cnpj}" title="Baixar dossiê" style="display:none">📎</button>
        <button class="btn-action btn-delete" title="Excluir">🗑️</button>
      </td>
    </tr>`;
  }

  /**
   * Marca com clipe as linhas cujo CNPJ já tem dossiê.
   * Uma consulta para a página inteira, não uma por linha.
   */
  async function marcarDossies() {
    const botoes = Array.from(document.querySelectorAll('.btn-dossie'));
    const cnpjs = [...new Set(botoes.map((b) => b.dataset.cnpj).filter((c) => c?.length === 14))];
    if (cnpjs.length === 0) return;

    try {
      const r = await fetch(`/api/dossier?existentes=${cnpjs.join(',')}`);
      if (!r.ok) return;
      const { comDossie } = await r.json();

      botoes.forEach((b) => {
        const versao = comDossie[b.dataset.cnpj];
        if (versao) {
          b.style.display = '';
          b.title = `Baixar dossiê (versão ${versao})`;
        }
      });
    } catch (e) {
      // Sem indicador é melhor que indicador errado.
    }
  }

  /* ----------------------------------------------------------
     Formulário
     ---------------------------------------------------------- */

  function lerFormulario() {
    const v = (id) => el(id)?.value?.trim() || null;
    const linkTexto = (id) => {
      const n = el(id);
      const t = n?.textContent?.trim();
      return t && t !== 'Não identificado' ? t : null;
    };

    return {
      nome: v('lead-input-nome'),
      documento: v('lead-input-doc'),
      telefone: v('lead-input-phone'),
      // O campo virou "canal" no Lote A. A tela continuava mandando
      // "origem", que a API não lê — o valor escolhido na ficha era
      // descartado em silêncio e a coluna aparecia vazia.
      canal: v('lead-input-canal'),
      classificacao: v('lead-input-classificacao'),
      observacoes: v('lead-input-obs'),
      email: v('lead-input-email'),
      contato_nome: v('lead-input-contato-nome'),
      cep: v('lead-input-cep'),
      cidade: v('lead-input-cidade'),
      endereco: v('lead-input-endereco'),
      site: linkTexto('link-site'),
      instagram: linkTexto('link-insta'),
      ramo: v('select-ramo'),
      segmento: v('select-segmento'),
      resumo_ia: el('ai-resumo-texto')?.innerHTML || null
    };
  }

  function preencherFormulario(lead) {
    const p = (id, valor) => { const n = el(id); if (n) n.value = valor ?? ''; };

    p('lead-input-nome', lead.nome);
    p('lead-input-doc', formatarDocumento(lead.documento));
    p('lead-input-phone', lead.telefone);
    // Leads anteriores ao Lote A guardaram o valor em `origem`
    p('lead-input-canal', lead.canal ?? lead.origem);
    p('lead-input-classificacao', lead.classificacao);
    p('lead-input-obs', lead.observacoes);
    p('lead-input-email', lead.email);
    p('lead-input-contato-nome', lead.contato_nome);
    p('lead-input-cep', lead.cep);
    p('lead-input-cidade', lead.cidade);
    p('lead-input-endereco', lead.endereco);
    p('select-ramo', lead.ramo);
    p('select-segmento', lead.segmento);

    const site = el('link-site');
    if (site) {
      site.href = lead.site || '#';
      site.textContent = lead.site || 'Não identificado';
    }
    const insta = el('link-insta');
    if (insta) {
      insta.href = lead.instagram || '#';
      insta.textContent = lead.instagram || 'Não identificado';
    }

    const resumo = el('ai-resumo-texto');
    if (resumo && lead.resumo_ia) resumo.innerHTML = lead.resumo_ia;
  }

  /* ----------------------------------------------------------
     Ações
     ---------------------------------------------------------- */

  async function salvar() {
    const dados = lerFormulario();

    if (!dados.nome) {
      alert('Informe o nome ou razão social do lead.');
      el('lead-input-nome')?.focus();
      return false;
    }

    const botao = el('btn-modal-save');
    if (botao) { botao.disabled = true; botao.textContent = 'Salvando…'; }

    try {
      const url = idEmEdicao ? `/api/leads?id=${idEmEdicao}` : '/api/leads';
      const r = await fetch(url, {
        method: idEmEdicao ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });

      const d = await r.json();

      if (!r.ok) {
        if (d.code === 'DUPLICADO' && d.existente) {
          alert(`${d.error}\n\nLead existente: ${d.existente.nome}`);
        } else {
          alert(d.error || 'Não foi possível salvar o lead.');
        }
        return false;
      }

      await recarregarVisao();
      return true;

    } catch (e) {
      alert('Falha de conexão ao salvar. Tente novamente.');
      return false;
    } finally {
      if (botao) { botao.disabled = false; botao.textContent = 'Salvar Lead'; }
    }
  }

  async function excluir(id, nome) {
    if (!confirm(`Excluir o lead "${nome}"?`)) return;

    try {
      const r = await fetch(`/api/leads?id=${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json();
        alert(d.error || 'Não foi possível excluir.');
        return;
      }
      // Se era o último da página, volta uma
      if (leadsNaTela.length === 1 && estado.pagina > 1) estado.pagina--;
      await recarregarVisao();
    } catch (e) {
      alert('Falha de conexão ao excluir.');
    }
  }

  function porId(id) {
    return leadsNaTela.find((l) => String(l.id) === String(id)) || null;
  }

  /* ----------------------------------------------------------
     API do módulo
     ---------------------------------------------------------- */

  function novo() { idEmEdicao = null; }
  function editar(id) { idEmEdicao = Number(id); }
  function emEdicao() { return idEmEdicao; }

  function irParaPagina(n) {
    const alvo = Math.min(Math.max(1, n), estado.totalPaginas);
    if (alvo === estado.pagina) return;
    estado.pagina = alvo;
    carregar();
  }

  function filtrar({ busca, ramo, segmento, canal, classificacao }) {
    if (busca !== undefined) estado.busca = busca;
    if (ramo !== undefined) estado.ramo = ramo;
    if (segmento !== undefined) estado.segmento = segmento;
    if (canal !== undefined) estado.canal = canal;
    if (classificacao !== undefined) estado.classificacao = classificacao;
    estado.pagina = 1;      // filtro novo sempre volta ao início
    recarregarVisao();
  }

  /** Os filtros em vigor. O quadro lê daqui para não ter cópia própria. */
  function filtros() {
    return {
      busca: estado.busca,
      ramo: estado.ramo,
      segmento: estado.segmento,
      canal: estado.canal,
      classificacao: estado.classificacao
    };
  }

  /**
   * Preenche o filtro de canais com o que existe na base.
   *
   * Só depois da autenticação: antes disso o fetch interceptado devolve
   * 401 sintético e o filtro nasceria vazio — o mesmo tropeço que a
   * v2.8.3 corrigiu na tabela.
   */
  async function carregarCanais() {
    const select = el('filter-canal');
    if (!select) return;

    try {
      const r = await fetch('/api/leads?canais=1');
      if (!r.ok) return;
      const { canais } = await r.json();

      const escolhido = estado.canal;
      select.innerHTML = '<option value="">Todos os Canais</option>'
        + (canais || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      select.value = escolhido;
    } catch (e) {
      // Sem opções o filtro fica só com "Todos" — degrada sem quebrar.
    }
  }

  /* ----------------------------------------------------------
     Tabela ou quadro
     ---------------------------------------------------------- */

  function recarregarVisao() {
    if (modo === 'quadro' && typeof Quadro !== 'undefined') Quadro.carregar();
    else carregar();
  }

  function aplicarModo(novo, { recarregar = true } = {}) {
    // Um quadro de seis colunas não é usável em tela estreita, com ou
    // sem toque. Abaixo do limiar a tabela é a única visão.
    modo = (novo === 'quadro' && !ESTREITO.matches) ? 'quadro' : 'tabela';
    localStorage.setItem(CHAVE_MODO, novo);

    el('view-tabela')?.classList.toggle('hidden', modo !== 'tabela');
    el('view-quadro')?.classList.toggle('hidden', modo !== 'quadro');

    document.querySelectorAll('[data-modo]').forEach((b) => {
      b.classList.toggle('active', b.dataset.modo === modo);
    });

    if (recarregar) recarregarVisao();
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  /**
   * Liga os controles da tela. Nao carrega dados ainda: no
   * DOMContentLoaded o login do Google ainda nao terminou, e qualquer
   * requisicao a /api sai sem token.
   */
  function iniciar() {
    el('input-search-lead')?.addEventListener('input', (ev) => {
      clearTimeout(debounce);
      const valor = ev.target.value.trim();
      // Espera a digitação parar: sem isso seria uma consulta por tecla
      debounce = setTimeout(() => filtrar({ busca: valor }), 350);
    });

    el('filter-ramo')?.addEventListener('change', (ev) => filtrar({ ramo: ev.target.value }));
    el('filter-segmento')?.addEventListener('change', (ev) => filtrar({ segmento: ev.target.value }));
    el('filter-canal')?.addEventListener('change', (ev) => filtrar({ canal: ev.target.value }));
    el('filter-classificacao')?.addEventListener('change', (ev) => filtrar({ classificacao: ev.target.value }));

    el('btn-pag-anterior')?.addEventListener('click', () => irParaPagina(estado.pagina - 1));
    el('btn-pag-proxima')?.addEventListener('click', () => irParaPagina(estado.pagina + 1));

    document.querySelectorAll('[data-modo]').forEach((botao) => {
      botao.addEventListener('click', () => aplicarModo(botao.dataset.modo));
    });

    // Estreitou a janela com o quadro aberto: cai para a tabela sozinho,
    // senão a tela ficaria em branco (o CSS esconde o quadro).
    ESTREITO.addEventListener('change', () => {
      if (ESTREITO.matches && modo === 'quadro') aplicarModo('tabela');
    });

    aplicarModo(modo, { recarregar: false });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  // Os dados so carregam depois que o auth.js confirma a sessao.
  document.addEventListener('crm:autenticado', () => {
    carregarCanais();
    recarregarVisao();
  }, { once: true });

  return {
    carregar, salvar, excluir, porId,
    novo, editar, emEdicao,
    preencherFormulario, irParaPagina, filtrar, filtros,
    recarregarVisao
  };
})();
