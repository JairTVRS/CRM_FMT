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

  /**
   * Centavos para o texto do campo.
   *
   * O caminho de volta não precisa de função: a API já aceita
   * "R$ 25.424,00" e converte — o mesmo conversor que a importação usa.
   */
  const centavosParaTexto = (c) =>
    (c == null || c === '')
      ? ''
      : (Number(c) / 100).toLocaleString('pt-BR', {
          minimumFractionDigits: 2, maximumFractionDigits: 2
        });

  /** O banco guarda ISO; o input[type=date] quer exatamente AAAA-MM-DD. */
  const soData = (v) => (v ? String(v).slice(0, 10) : '');

  /**
   * Dias até a data, em fuso local.
   *
   * `new Date('2026-01-15')` seria lido como UTC e, a oeste de Greenwich,
   * cairia no dia 14 — o prazo apareceria vencido um dia antes.
   */
  function diasPara(dataIso) {
    if (!dataIso) return null;
    const [a, m, d] = String(dataIso).split('-').map(Number);
    if (!a || !m || !d) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.round((new Date(a, m - 1, d) - hoje) / 86400000);
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
      // --- Funil (aba nova do Lote D) ---
      etapa_id: v('lead-input-etapa'),
      atendente: v('lead-input-atendente'),
      data_cadastro: v('lead-input-data-cadastro'),
      data_ultimo_contato: v('lead-input-ultimo-contato'),
      data_proximo_contato: v('lead-input-proximo-contato'),
      data_fechamento: v('lead-input-fechamento'),
      valor_proposta: v('lead-input-valor-proposta'),
      valor_diagnostico: v('lead-input-valor-diagnostico'),
      tags: [...tagsSelecionadas],

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
    p('lead-input-cep', formatarCep(lead.cep));
    p('lead-input-cidade', lead.cidade);
    p('lead-input-endereco', lead.endereco);

    // Outro lead, outra busca: sem isto, abrir uma ficha cujo CEP é o
    // mesmo da anterior faria a consulta ser pulada pela guarda.
    cepEmBusca = null;
    const avisoCep = el('cep-aviso');
    if (avisoCep) { avisoCep.textContent = ''; avisoCep.className = 'cep-aviso'; }
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

    preencherFunil(lead);
    if (typeof Proposta !== 'undefined') Proposta.abrir(lead);
  }

  /**
   * A parte da ficha que depende dos cadastros (etapas, advisors, tags).
   *
   * Fica separada porque pode precisar rodar duas vezes: se a ficha for
   * aberta antes de as listas chegarem do servidor, os selects nascem
   * vazios e a etapa e o advisor do lead se perderiam. O evento
   * `crm:cadastros` reexecuta isto com o mesmo lead.
   */
  function preencherFunil(lead) {
    if (!lead) return;
    leadNaFicha = lead;

    const p = (id, valor) => { const n = el(id); if (n) n.value = valor ?? ''; };

    montarEtapas(lead.etapa_id);
    montarAdvisors();

    p('lead-input-atendente', lead.atendente);
    p('lead-input-data-cadastro', soData(lead.data_cadastro));
    p('lead-input-ultimo-contato', soData(lead.data_ultimo_contato));
    p('lead-input-proximo-contato', soData(lead.data_proximo_contato));
    p('lead-input-fechamento', soData(lead.data_fechamento));
    p('lead-input-valor-proposta', centavosParaTexto(lead.valor_proposta));
    p('lead-input-valor-diagnostico', centavosParaTexto(lead.valor_diagnostico));

    const advisor = Cadastros.advisors().find((a) => a.id === lead.advisor_id);
    p('lead-input-advisor', advisor?.nome);

    // `tags` vem como texto JSON do banco: "[1,4,7]"
    let ids = [];
    try { ids = Array.isArray(lead.tags) ? lead.tags : JSON.parse(lead.tags || '[]'); }
    catch (e) { ids = []; }
    tagsSelecionadas = new Set(ids.map(Number));

    montarTags();
    atualizarDiasContato();
  }

  /* ----------------------------------------------------------
     Aba do funil — etapas, advisors e tags

     Os campos existiam no banco e na API desde o Lote A. O manual
     daquele lote deixou explícito que entrariam na tela junto com o
     quadro, para não haver duas rodadas de mudança na mesma ficha.
     ---------------------------------------------------------- */

  let tagsSelecionadas = new Set();

  /* O lead aberto na ficha. Guardado para reconstruir a aba do funil se
     os cadastros chegarem depois de a ficha já estar na tela. */
  let leadNaFicha = null;

  function montarEtapas(selecionada) {
    const select = el('lead-input-etapa');
    if (!select) return;

    const etapas = Cadastros.etapas();
    select.innerHTML = etapas.length
      ? etapas.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join('')
      : '<option value="">—</option>';

    // Sem etapa informada, a primeira coluna — a mesma regra da API
    select.value = selecionada || etapas[0]?.id || '';
  }

  function montarAdvisors() {
    const lista = el('lista-advisors');
    if (!lista) return;
    lista.innerHTML = Cadastros.advisors()
      .map((a) => `<option value="${esc(a.nome)}"></option>`).join('');
  }

  function montarTags() {
    const caixa = el('lead-tags');
    if (!caixa) return;

    const tags = Cadastros.tags();
    if (tags.length === 0) {
      caixa.innerHTML = '<span class="tags-vazio">Nenhuma tag cadastrada ainda.</span>';
      return;
    }

    caixa.innerHTML = tags.map((t) => `
      <button type="button" class="tag-chip${tagsSelecionadas.has(t.id) ? ' ligada' : ''}"
              data-tag="${t.id}" style="--cor-tag: ${esc(t.cor || '#6e6e6e')}">
        ${esc(t.nome)}
      </button>`).join('');
  }

  /**
   * "Dias para próximo contato" não é armazenado: guardado, nasceria
   * desatualizado no dia seguinte. Calculado na exibição, está sempre
   * certo — a mesma decisão do Lote A.
   */
  function atualizarDiasContato() {
    const alvo = el('dias-proximo-contato');
    if (!alvo) return;

    const dias = diasPara(el('lead-input-proximo-contato')?.value);
    if (dias === null) { alvo.textContent = ''; alvo.className = 'dias-contato'; return; }

    if (dias < 0) {
      alvo.textContent = `${Math.abs(dias)} dia(s) em atraso`;
      alvo.className = 'dias-contato atrasado';
    } else if (dias === 0) {
      alvo.textContent = 'é hoje';
      alvo.className = 'dias-contato hoje';
    } else {
      alvo.textContent = `em ${dias} dia(s)`;
      alvo.className = 'dias-contato futuro';
    }
  }

  /**
   * Resolve o advisor digitado em um id, criando o cadastro se o nome
   * for novo — a mecânica do Lote A: digita o nome, vira opção para
   * todos. É assíncrono, por isso fica fora do lerFormulario.
   */
  async function resolverAdvisor() {
    const nome = el('lead-input-advisor')?.value?.trim();
    if (!nome) return null;

    const existente = Cadastros.advisorPorNome(nome);
    if (existente) return existente.id;

    const criado = await Cadastros.criarAdvisor(nome);
    if (criado) montarAdvisors();
    return criado?.id ?? null;
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
      // Advisor digitado que ainda não existe é cadastrado agora, antes
      // de gravar o lead — senão o vínculo se perderia.
      dados.advisor_id = await resolverAdvisor();
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

  /**
   * Prepara a ficha para um cadastro novo.
   *
   * Roda DEPOIS do limparFormularioModal — que zera o formulário por
   * varredura —, senão os padrões abaixo seriam apagados em seguida.
   */
  function novo() {
    idEmEdicao = null;
    tagsSelecionadas = new Set();
    leadNaFicha = null;   // cadastro novo não tem lead para remontar

    montarEtapas(null);
    montarAdvisors();
    montarTags();

    const hoje = new Date();
    const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

    const p = (id, valor) => { const n = el(id); if (n) n.value = valor ?? ''; };
    p('lead-input-data-cadastro', iso);
    p('lead-input-atendente', Auth?.usuario?.email);

    atualizarDiasContato();

    // Lead sem id ainda não pode gerar proposta; a aba nasce nos padrões.
    if (typeof Proposta !== 'undefined') Proposta.limpar();
  }
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
    // QuadroLeads é a instância do funil comercial, montada no fim do
    // quadro.js. O módulo virou fábrica no Lote H para servir também a
    // jornada do cliente.
    if (modo === 'quadro' && typeof QuadroLeads !== 'undefined') QuadroLeads.carregar();
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
     CEP — busca no ViaCEP

     Chamado direto do navegador, e não por uma Function nossa. O
     `auth.js` intercepta o `fetch` e injeta o token só em URLs que
     contenham `/api/` — a do ViaCEP não contém, então passa limpa e o
     token não vaza. O serviço é público, tem CORS liberado e não pede
     chave; um endpoint próprio só acrescentaria um salto.

     **O CEP manda no endereço** (decisão de 05/09/2026). Quando o CNPJ
     e o CEP discordam, vence o CEP: ele é a intenção mais recente e
     mais específica de quem está digitando. A Receita segue preenchendo
     o que o ViaCEP não devolve — o número, que não existe na base de
     CEP.
     ---------------------------------------------------------- */

  const soDigitosCep = (v) => String(v || '').replace(/\D/g, '');

  const formatarCep = (v) => {
    const d = soDigitosCep(v);
    return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (v || '');
  };

  /**
   * Junta o que o ViaCEP devolveu com o que já estava no campo.
   *
   * O ViaCEP não tem número — a base é de logradouro, não de imóvel. Se
   * o usuário já digitou "Rua X, 123 - Centro", sobrescrever cru
   * apagaria o 123, que é justamente a parte que só ele sabe.
   */
  function mesclarEndereco(anterior, dados) {
    const logradouro = (dados.logradouro || '').trim();
    const bairro = (dados.bairro || '').trim();
    if (!logradouro && !bairro) return anterior || '';

    // O primeiro número solto do valor anterior é o número da casa.
    // CEP e cidade moram em outros campos, então não há o que confundir.
    const numero = (String(anterior || '').match(/\b(\d{1,6})\b/) || [])[1] || null;

    const rua = [logradouro, numero].filter(Boolean).join(', ');
    return [rua, bairro].filter(Boolean).join(' - ');
  }

  let cepEmBusca = null;

  async function buscarCep(bruto) {
    const cep = soDigitosCep(bruto);
    const campo = el('lead-input-cep');
    const aviso = el('cep-aviso');

    const dizer = (texto, classe) => {
      if (!aviso) return;
      aviso.textContent = texto || '';
      aviso.className = `cep-aviso${classe ? ` ${classe}` : ''}`;
    };

    if (cep.length === 0) { dizer(''); return; }

    if (cep.length !== 8) {
      dizer('CEP incompleto — precisa de 8 dígitos.', 'cep-erro');
      return;
    }

    // Já consultado e nada mudou: não repete a chamada a cada saída do
    // campo.
    if (cepEmBusca === cep) return;
    cepEmBusca = cep;

    if (campo) campo.value = formatarCep(cep);
    dizer('Buscando…');

    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!r.ok) throw new Error(`ViaCEP respondeu ${r.status}.`);

      const d = await r.json();

      // O ViaCEP devolve 200 com `{ erro: true }` para CEP inexistente.
      // Tratar isso como sucesso preencheria a ficha com nada.
      if (d.erro) {
        cepEmBusca = null;
        dizer('CEP não encontrado. Preencha o endereço à mão.', 'cep-erro');
        return;
      }

      const cidade = el('lead-input-cidade');
      const endereco = el('lead-input-endereco');

      if (cidade && d.localidade) {
        cidade.value = d.uf ? `${d.localidade} / ${d.uf}` : d.localidade;
      }
      if (endereco) {
        endereco.value = mesclarEndereco(endereco.value, d);
      }

      dizer(`${d.localidade || ''}${d.uf ? ` / ${d.uf}` : ''} — endereço preenchido.`, 'cep-ok');

    } catch (e) {
      cepEmBusca = null;
      // A causa vai para a tela. Engolir o motivo foi o que fez o bug da
      // proposta durar um dia inteiro.
      dizer(`Não foi possível consultar o CEP: ${e.message}`, 'cep-erro');
    }
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
    // CEP: busca ao sair do campo e assim que os 8 dígitos aparecem —
    // colar um CEP não deveria exigir sair do campo para funcionar.
    el('lead-input-cep')?.addEventListener('blur', (ev) => buscarCep(ev.target.value));
    el('lead-input-cep')?.addEventListener('input', (ev) => {
      if (soDigitosCep(ev.target.value).length === 8) buscarCep(ev.target.value);
    });

    el('input-search-lead')?.addEventListener('input', (ev) => {
      clearTimeout(debounce);
      const valor = ev.target.value.trim();
      // Espera a digitação parar: sem isso seria uma consulta por tecla
      debounce = setTimeout(() => filtrar({ busca: valor }), 350);
    });

    el('filter-ramo')?.addEventListener('change', (ev) => filtrar({ ramo: ev.target.value }));
    el('filter-segmento')?.addEventListener('change', (ev) => filtrar({ segmento: ev.target.value }));
    // --- Aba do funil ---
    el('lead-input-proximo-contato')?.addEventListener('change', atualizarDiasContato);

    el('lead-tags')?.addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-tag]');
      if (!chip) return;
      const id = Number(chip.dataset.tag);
      if (tagsSelecionadas.has(id)) tagsSelecionadas.delete(id);
      else tagsSelecionadas.add(id);
      chip.classList.toggle('ligada');
    });

    const criarTag = async () => {
      const campo = el('tag-nova-nome');
      const nome = campo?.value.trim();
      if (!nome) { campo?.focus(); return; }

      const tag = await Cadastros.criarTag(nome);
      if (!tag) { alert('Não foi possível criar a tag.'); return; }

      campo.value = '';
      tagsSelecionadas.add(tag.id);   // quem acabou de criar quer usar
      montarTags();
    };

    el('btn-tag-criar')?.addEventListener('click', criarTag);
    el('tag-nova-nome')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); criarTag(); }
    });

    // As listas chegam depois da autenticação. Se a ficha já estiver
    // aberta, remonta a aba com o mesmo lead — sem isto, a etapa e o
    // advisor de quem abriu rápido demais ficariam em branco.
    document.addEventListener('crm:cadastros', () => {
      if (leadNaFicha) preencherFunil(leadNaFicha);
      else { montarEtapas(null); montarAdvisors(); montarTags(); }
    });

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
