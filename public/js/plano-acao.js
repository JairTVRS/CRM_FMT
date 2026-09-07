/**
 * plano-acao.js — a fila de ações de todas as carteiras.
 *
 * O CX trabalha o dia por aqui: abre a tela e vê o que está aberto em
 * todos os clientes, ordenado pelo que dói primeiro. Não é aba da ficha
 * do cliente de propósito — ver a fila obrigaria abrir cliente por
 * cliente.
 *
 * A TELA MOSTRA DUAS METADES, e a fronteira é visível:
 *
 *   O que a ata diz     What (a descrição), Who (Resp.), When (Prazo),
 *                       status, atraso. Vem do ERP, ao vivo, NÃO se edita.
 *
 *   O que a CX anota    Why, Where, How e How much. Não existem na ata.
 *                       Ficam no CRM, amarrados a (carteira + ação).
 *
 * Misturar as duas na tela faria parecer que dá para corrigir a ata por
 * aqui — e não dá: quem é dono dela é o ERP.
 */

const Plano = (() => {
  let acoes = [];
  let resumo = null;
  let avisos = [];
  let avisoHub = null;
  let carregando = false;
  let editando = null;      // `${carteira}::${numero}`
  let debounce = null;

  const filtros = { busca: '', cliente: '', time: '', situacao: '' };

  const el = (id) => document.getElementById(id);

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const dataBr = (iso) => {
    if (!iso) return null;
    const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00Z` : iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  };

  const ROTULO_STATUS = {
    nova: 'Nova',
    pendente: 'Pendente',
    em_andamento: 'Em andamento',
    repactuado: 'Repactuado',
    desconhecido: 'Status não reconhecido'
  };

  const chaveDe = (a) => `${a.carteiraErpId}::${a.numero}`;

  /**
   * O identificador da ação: `N.M`.
   *
   * N é a sequência do CLIENTE, dada pelo CRM; M é o número da ação no
   * tipo de reunião, que é como a ata a chama. Um cliente com três
   * carteiras tem três "AÇÃO 1" no ERP — o N é o que as separa.
   *
   * Sem N, mostra só `AÇÃO M`: é o caso da ação cuja carteira o ERP não
   * devolveu, que não tem onde guardar número com segurança.
   */
  const identificador = (a) =>
    a.numeroCliente != null ? `${a.numeroCliente}.${a.numero}` : `AÇÃO ${a.numero}`;

  /* ----------------------------------------------------------
     Carregamento
     ---------------------------------------------------------- */

  async function carregar() {
    if (carregando) return;
    carregando = true;

    const lista = el('plano-lista');
    if (lista) lista.innerHTML = '<div class="coluna-vazia">Lendo as atas no ERP…</div>';

    try {
      const r = await fetch('/api/plano-acao');
      const d = await r.json();

      if (!r.ok) {
        // A causa vem no corpo, com código próprio: a tela precisa poder
        // dizer "falta a permissão hub:meetings:read" em vez de mostrar
        // uma lista vazia, que seria lida como "não há ações".
        // O servidor lista TODAS as permissões que faltam, não só a
        // primeira: quatro idas ao painel da Cloudflare viram uma.
        avisoHub = d.permissoesFaltando?.length
          ? `${d.error} Cadastre o escopo no Secret HUB_API_KEY e refaça o deploy.`
          : (d.error || 'Não foi possível montar o plano de ação.');
        acoes = [];
        resumo = null;
        avisos = [];
        renderizar();
        return;
      }

      avisoHub = d.truncado
        ? 'A janela de reuniões é maior que o teto de páginas do ERP; a lista pode estar incompleta.'
        : null;

      acoes = d.acoes || [];
      resumo = d.resumo || null;
      avisos = d.avisos || [];

      renderizar();

    } catch (e) {
      avisoHub = `Falha de conexão: ${e.message}`;
      renderizar();
    } finally {
      carregando = false;
    }
  }

  /* ----------------------------------------------------------
     Filtros
     ---------------------------------------------------------- */

  /**
   * O select sempre tem ao menos a opção "todos".
   *
   * Antes ele só era montado no caminho de sucesso: quando a carga
   * falhava, ficava completamente vazio na tela — nem o rótulo aparecia,
   * e parecia defeito de layout em vez de consequência do erro.
   */
  function montarSelect(id, campo, rotuloTodos) {
    const select = el(id);
    if (!select) return;

    const escolhido = select.value;
    const nomes = [...new Set(acoes.map((a) => a[campo]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    select.innerHTML = `<option value="">${rotuloTodos}</option>`
      + nomes.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');

    // Se o filtro escolhido sumiu da lista, volta para "todos" em vez de
    // ficar com um valor que não filtra nada.
    select.value = nomes.includes(escolhido) ? escolhido : '';
  }

  function montarFiltroClientes() {
    montarSelect('plano-cliente', 'cliente', 'Todos os clientes');
    // Time é o agrupamento interno da Formatar; núcleo é o tipo de
    // reunião no cliente. Filtrar por Time é ler a fila por frente.
    montarSelect('plano-time', 'time', 'Todos os times');
  }

  function filtrar() {
    const busca = filtros.busca.trim().toLowerCase();

    return acoes.filter((a) => {
      if (filtros.cliente && a.cliente !== filtros.cliente) return false;
      if (filtros.time && a.time !== filtros.time) return false;

      if (filtros.situacao === 'atrasadas' && !a.atrasada) return false;
      if (filtros.situacao === 'sem-anotacao' && a.completude > 0) return false;
      if (filtros.situacao === 'sem-responsavel' && a.quem) return false;
      if (filtros.situacao === 'sem-prazo' && a.quando) return false;

      if (!busca) return true;

      return [a.cliente, a.nucleo, a.time, a.oQue, a.quem, identificador(a)]
        .filter(Boolean).join(' ').toLowerCase().includes(busca);
    });
  }

  /* ----------------------------------------------------------
     Desenho
     ---------------------------------------------------------- */

  function renderizarResumo() {
    const caixa = el('plano-resumo');
    if (!caixa) return;

    if (!resumo) { caixa.innerHTML = ''; return; }

    const bloco = (valor, rotulo, alerta) => `
      <div class="plano-numero${alerta && valor > 0 ? ' alerta' : ''}">
        <strong>${valor}</strong><span>${rotulo}</span>
      </div>`;

    caixa.innerHTML = [
      bloco(resumo.total, 'ações abertas'),
      bloco(resumo.atrasadas, 'atrasadas', true),
      bloco(resumo.semResponsavel, 'sem responsável', true),
      bloco(resumo.semPrazo, 'sem prazo', true),
      bloco(resumo.semAnotacao, 'sem 5W2H'),
      bloco(resumo.times, 'times'),
      bloco(resumo.carteiras, 'carteiras'),
      bloco(resumo.clientes, 'clientes')
    ].join('');
  }

  /** Os quatro campos que a CX preenche, em modo leitura. */
  function anotacaoHtml(a) {
    const campo = (rotulo, valor) => `
      <div class="w-campo${valor ? '' : ' vazio'}">
        <span class="w-rotulo">${rotulo}</span>
        <span class="w-valor">${valor ? esc(valor) : '—'}</span>
      </div>`;

    return `
      <div class="plano-5w2h">
        ${campo('Por quê', a.porque)}
        ${campo('Onde', a.onde)}
        ${campo('Como', a.como)}
        ${campo('Quanto', a.quanto)}
        ${a.observacoes ? `<div class="w-campo w-obs"><span class="w-rotulo">Observações</span><span class="w-valor">${esc(a.observacoes)}</span></div>` : ''}
      </div>`;
  }

  /** O formulário dos quatro campos. */
  function formularioHtml(a) {
    const linha = (id, rotulo, valor, dica) => `
      <div class="form-group col-span-2">
        <label for="w-${id}">${rotulo}</label>
        <textarea id="w-${id}" class="form-control" rows="2" maxlength="2000"
                  placeholder="${dica}">${esc(valor || '')}</textarea>
      </div>`;

    return `
      <div class="plano-form">
        <p class="ajuda-campo">
          O quê, quem e quando vêm da ata e não se editam aqui — quem é dono
          delas é o ERP. Estes quatro completam o 5W2H.
        </p>
        <div class="form-grid">
          ${linha('porque', 'Por quê — a razão de a ação existir', a.porque, 'Que problema ela resolve?')}
          ${linha('onde', 'Onde — o lugar ou processo afetado', a.onde, 'Setor, unidade, sistema…')}
          ${linha('como', 'Como — o caminho combinado', a.como, 'Que passos foram acordados?')}
          ${linha('quanto', 'Quanto — custo, esforço ou meta', a.quanto, 'R$, horas, percentual…')}
          ${linha('obs', 'Observações', a.observacoes, 'O que não coube acima')}
        </div>
        <div class="pessoa-form-acoes">
          <button class="btn btn-secondary btn-sm" data-acao="cancelar">Cancelar</button>
          <button class="btn btn-primary btn-sm" data-acao="salvar">Salvar</button>
        </div>
      </div>`;
  }

  function cartaoHtml(a) {
    const chave = chaveDe(a);
    const emEdicao = editando === chave;

    const prazo = dataBr(a.quando);
    const marcas = [
      `<span class="plano-marca marca-${esc(a.status)}">${ROTULO_STATUS[a.status] || a.status}</span>`,

      a.atrasada
        ? `<span class="plano-marca marca-atraso">${a.diasDeAtraso} dia(s) de atraso</span>`
        : (prazo ? `<span class="plano-marca">Prazo ${prazo}</span>`
                 : '<span class="plano-marca marca-falta">sem prazo</span>'),

      a.diasEmAberto != null
        ? `<span class="plano-marca" title="Desde a data do status">${a.diasEmAberto} dia(s) em aberto</span>`
        : '',

      a.quem
        ? `<span class="plano-marca">${esc(a.quem)}</span>`
        : '<span class="plano-marca marca-falta">sem responsável</span>'
    ].filter(Boolean).join('');

    // Sem carteira resolvida não há chave estável para a anotação — e
    // gravar numa chave que muda perderia o texto na semana seguinte.
    const podeAnotar = !!a.carteiraErpId;

    return `
      <article class="plano-cartao${a.atrasada ? ' atrasada' : ''}" data-chave="${esc(chave)}">
        <div class="plano-topo">
          <span class="plano-cliente">${esc(a.cliente || 'Cliente não identificado')}</span>
          ${a.nucleo ? `<span class="chip-nucleo">${esc(a.nucleo)}</span>` : ''}
          ${a.time ? `<span class="plano-time" title="Time responsável na Formatar">${esc(a.time)}</span>` : ''}
          <span class="plano-numero-acao"
                title="${a.numeroCliente != null
                  ? `Ação ${a.numeroCliente} deste cliente · AÇÃO ${a.numero} no núcleo ${esc(a.nucleo || '')}`
                  : 'Sem número: a carteira desta ação não foi encontrada no ERP'}">${esc(identificador(a))}</span>
          <span class="espaco"></span>
          ${podeAnotar
            ? `<button class="btn-action" data-acao="${emEdicao ? 'cancelar' : 'editar'}"
                       title="${emEdicao ? 'Cancelar' : 'Completar o 5W2H'}">${emEdicao ? '×' : '✏️'}</button>`
            : ''}
        </div>

        <div class="plano-oque">${esc(a.oQue)}</div>
        <div class="plano-marcas">${marcas}</div>

        ${a.descricaoMudou ? `
          <div class="plano-mudou">
            O texto desta ação mudou na ata depois que o 5W2H foi preenchido.
            Confira se o que está escrito abaixo ainda responde à ação certa.
          </div>` : ''}

        ${!podeAnotar ? `
          <div class="plano-mudou">
            A carteira desta ação não foi encontrada no ERP, então não há
            onde guardar o 5W2H com segurança.
          </div>` : ''}

        ${emEdicao ? formularioHtml(a) : anotacaoHtml(a)}
      </article>`;
  }

  function renderizar() {
    mostrarAviso();
    montarFiltroClientes();
    renderizarResumo();
    renderizarAvisos();

    const caixa = el('plano-lista');
    if (!caixa) return;

    const lista = filtrar();

    if (lista.length === 0) {
      caixa.innerHTML = `<div class="coluna-vazia">${
        avisoHub
          ? 'O plano não pôde ser lido no ERP.'
          : (acoes.length === 0
              ? 'Nenhuma ação aberta nas atas do período.'
              : 'Nenhuma ação com esses filtros.')
      }</div>`;
      return;
    }

    caixa.innerHTML = lista.map(cartaoHtml).join('');
  }

  function mostrarAviso() {
    const faixa = el('plano-aviso');
    if (!faixa) return;
    faixa.classList.toggle('hidden', !avisoHub);
    faixa.textContent = avisoHub || '';
  }

  /**
   * Ata fora do manual não é erro do CRM, mas quem a escreveu precisa
   * saber. Ficam recolhidos: são muitos e não competem com a fila.
   */
  function renderizarAvisos() {
    const caixa = el('plano-avisos-caixa');
    if (!caixa) return;

    caixa.classList.toggle('hidden', avisos.length === 0);
    if (avisos.length === 0) return;

    el('plano-avisos-total').textContent =
      `${avisos.length} aviso(s) na leitura das atas`;

    el('plano-avisos').innerHTML = avisos.map((a) => `
      <li><strong>${esc(a.cliente || '—')}</strong>
        ${a.reuniao ? `(reunião ${a.reuniao})` : ''} — ${esc(a.aviso)}</li>`).join('');
  }

  /* ----------------------------------------------------------
     Gravação
     ---------------------------------------------------------- */

  async function salvar(chave) {
    const a = acoes.find((x) => chaveDe(x) === chave);
    if (!a) return;

    const v = (id) => el(`w-${id}`)?.value.trim() || null;

    const corpo = {
      porque: v('porque'),
      onde: v('onde'),
      como: v('como'),
      quanto: v('quanto'),
      observacoes: v('obs'),
      // Guardado para a tela perceber depois que a ata mudou de texto.
      descricao_vista: a.oQue
    };

    try {
      const r = await fetch(
        `/api/plano-acao?carteira=${encodeURIComponent(a.carteiraErpId)}&acao=${a.numero}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
      );

      const d = await r.json();
      if (!r.ok) {
        alert(d.error || d.details || 'Não foi possível salvar.');
        return;
      }

      // Atualiza em memória em vez de recarregar tudo: reler o plano
      // significa reler as atas do ERP inteiras.
      Object.assign(a, {
        porque: corpo.porque, onde: corpo.onde, como: corpo.como,
        quanto: corpo.quanto, observacoes: corpo.observacoes,
        descricaoMudou: false,
        completude: ['porque', 'onde', 'como', 'quanto'].filter((c) => corpo[c]).length
      });

      if (resumo) {
        resumo.semAnotacao = acoes.filter((x) => x.completude === 0).length;
      }

      editando = null;
      renderizar();

    } catch (e) {
      alert('Falha de conexão ao salvar.');
    }
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    el('btn-plano-recarregar')?.addEventListener('click', carregar);

    el('plano-busca')?.addEventListener('input', (ev) => {
      clearTimeout(debounce);
      const v = ev.target.value;
      debounce = setTimeout(() => { filtros.busca = v; renderizar(); }, 250);
    });

    el('plano-cliente')?.addEventListener('change', (ev) => {
      filtros.cliente = ev.target.value; renderizar();
    });

    el('plano-time')?.addEventListener('change', (ev) => {
      filtros.time = ev.target.value; renderizar();
    });

    el('plano-situacao')?.addEventListener('change', (ev) => {
      filtros.situacao = ev.target.value; renderizar();
    });

    el('plano-lista')?.addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-acao]');
      if (!botao) return;

      const chave = botao.closest('.plano-cartao')?.dataset.chave;
      if (!chave) return;

      if (botao.dataset.acao === 'editar') { editando = chave; renderizar(); }
      if (botao.dataset.acao === 'cancelar') { editando = null; renderizar(); }
      if (botao.dataset.acao === 'salvar') salvar(chave);
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  /**
   * Só carrega quando o usuário entra na tela.
   *
   * Montar o plano significa ler as atas de meses de reuniões no ERP —
   * caro demais para uma tela que talvez nem seja aberta na sessão.
   */
  let jaCarregou = false;
  function aoEntrarNaTela() {
    if (jaCarregou) return;
    jaCarregou = true;
    carregar();
  }

  return { carregar, aoEntrarNaTela };
})();
