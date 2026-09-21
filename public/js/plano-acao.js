/**
 * plano-acao.js — a fila de ações de todas as carteiras, em tabela.
 *
 * O CX trabalha o dia por aqui: abre a tela e vê o que está aberto em
 * todos os clientes, ordenado pelo que dói primeiro. Não é aba da ficha
 * do cliente de propósito — ver a fila obrigaria abrir cliente por
 * cliente.
 *
 * DESDE A 2.25.0
 *
 *   - O plano é GRAVADO no CRM. Abrir a tela lê o banco — instantâneo — e
 *     em seguida pede ao servidor só as reuniões novas desde a última
 *     carga. A primeira carga (seis meses) anda em passos de um mês.
 *
 *   - Uma linha por ação, e cada célula se edita com um clique: Enter
 *     grava, Esc desiste. Cliente, tipo de reunião e núcleo não se
 *     editam: são a carteira, a chave da ação.
 *
 *   - Cada alteração fica no histórico da ação (o relógio no fim da
 *     linha): quem, quando, o campo, de que para que, e se foi à mão ou
 *     pela ata.
 */

const Plano = (() => {
  let acoes = [];
  let carga = null;
  let avisos = [];
  let avisoHub = null;
  let carregando = false;
  let sincronizando = false;
  let editando = null;          // { id, campo }
  let recarregarDepois = false; // a carga trouxe novidade durante uma edição
  let limite = 200;
  let debounce = null;

  const POR_PAGINA = 200;

  const filtros = { busca: '', cliente: '', nucleo: '', situacao: 'abertas' };

  /** Coluna e sentido da ordenação. Sem coluna, vale a ordem do servidor: atrasadas primeiro. */
  const ordem = { chave: null, sentido: 1 };

  /** "Vence em breve" é até sete dias. */
  const DIAS_VENCENDO = 7;

  const el = (id) => document.getElementById(id);

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const dataBr = (iso) => {
    if (!iso) return null;
    const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00Z` : iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  };

  const dataHoraBr = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const ROTULO_STATUS = {
    nova: 'Nova',
    pendente: 'Pendente',
    em_andamento: 'Em andamento',
    repactuado: 'Repactuado',
    concluida: 'Concluída',
    cancelada: 'Cancelada',
    saiu_da_ata: 'Saiu da ata',
    desconhecido: 'Não reconhecido'
  };

  /** O que a pessoa pode escolher. "Saiu da ata" só a carga põe. */
  const STATUS_ESCOLHA = ['nova', 'pendente', 'em_andamento', 'repactuado', 'concluida', 'cancelada'];

  /**
   * As colunas, na ordem da tela.
   *
   * `campo` é o nome no servidor; sem `campo`, a coluna não se edita.
   * `tipo` escolhe o editor: texto de uma linha, texto longo, data ou
   * lista.
   */
  const COLUNAS = [
    { chave: 'acao', rotulo: 'Ação', classe: 'c-acao' },
    { chave: 'cliente', rotulo: 'Cliente', classe: 'c-cliente' },
    { chave: 'tipoReuniao', rotulo: 'Tipo de reunião', classe: 'c-tipo' },
    { chave: 'nucleo', rotulo: 'Núcleo', classe: 'c-nucleo' },
    { chave: 'descricao', rotulo: 'Descrição', classe: 'c-descricao', campo: 'descricao', tipo: 'longo' },
    { chave: 'responsavel', rotulo: 'Responsável', classe: 'c-resp', campo: 'responsavel', tipo: 'texto' },
    { chave: 'porque', rotulo: 'Por quê', classe: 'c-5w', campo: 'porque', tipo: 'longo' },
    { chave: 'onde', rotulo: 'Onde', classe: 'c-onde', campo: 'onde', tipo: 'texto' },
    { chave: 'como', rotulo: 'Como', classe: 'c-5w', campo: 'como', tipo: 'longo' },
    { chave: 'prazo', rotulo: 'Quando', classe: 'c-quando', campo: 'prazo', tipo: 'texto' },
    { chave: 'dataPrevista', rotulo: 'Data prevista', classe: 'c-data', campo: 'data_prevista', tipo: 'data' },
    { chave: 'status', rotulo: 'Status', classe: 'c-status', campo: 'status', tipo: 'status' }
  ];

  const colunaDoCampo = (campo) => COLUNAS.find((c) => c.campo === campo);

  /**
   * O identificador da ação: `N.M`. N é a sequência do CLIENTE, dada pelo
   * CRM; M é o número da ação no tipo de reunião, que é como a ata a chama.
   */
  const identificador = (a) =>
    a.numeroCliente != null ? `${a.numeroCliente}.${a.numero}` : `AÇÃO ${a.numero}`;

  const tem5w = (a) => !!(a.porque || a.onde || a.como);

  /* ----------------------------------------------------------
     Leitura do banco
     ---------------------------------------------------------- */

  async function carregar() {
    if (carregando) return;
    carregando = true;

    const lista = el('plano-lista');
    if (lista && acoes.length === 0) lista.innerHTML = '<div class="coluna-vazia">Lendo o plano…</div>';

    try {
      const r = await fetch('/api/plano-acao');
      const d = await r.json();

      if (!r.ok) {
        avisoHub = d.error || 'Não foi possível ler o plano de ação.';
        acoes = [];
        renderizar();
        return false;
      }

      acoes = d.acoes || [];
      carga = d.carga || null;
      renderizar();
      return true;

    } catch (e) {
      avisoHub = `Falha de conexão: ${e.message}`;
      renderizar();
      return false;
    } finally {
      carregando = false;
    }
  }

  /* ----------------------------------------------------------
     Carga: as reuniões novas desde a última vez
     ---------------------------------------------------------- */

  /**
   * Encadeia passos até a carga chegar a hoje. A primeira vez são uns
   * oito (seis meses, um por mês); depois, quase sempre um só.
   */
  async function sincronizar() {
    if (sincronizando) return;
    sincronizando = true;
    avisoHub = null;
    avisos = [];

    const botao = el('btn-plano-carga');
    if (botao) botao.disabled = true;

    let mudou = false;
    let pausas = 0;

    try {
      for (let passo = 0; passo < 15; passo++) {
        mostrarCarga(carga?.completa
          ? 'Buscando reuniões novas no ERP…'
          : `Carregando as atas do ERP${carga?.carregadoAte ? ` — já lidas até ${dataBr(carga.carregadoAte)}` : ''}…`);

        const r = await fetch('/api/plano-acao?carga=1', { method: 'POST' });
        const d = await r.json();

        if (!r.ok) {
          // O ERP pediu uma pausa mesmo depois das tentativas do servidor.
          // O que já veio está gravado: espera e retoma de onde parou.
          if (d.code === 'HUB_LIMITE' && pausas < 4) {
            pausas++;
            for (let seg = 15 * pausas; seg > 0; seg--) {
              mostrarCarga(`O ERP pediu uma pausa — retomando em ${seg}s…`);
              await new Promise((ok) => setTimeout(ok, 1000));
            }
            passo--;
            continue;
          }
          if (d.code === 'CARGA_EM_ANDAMENTO') {
            // Outra pessoa está carregando: o que ela trouxer aparece na
            // próxima leitura. Não é erro.
            carga = d.carga || carga;
            break;
          }
          // A causa vem no corpo, com código próprio: a tela precisa dizer
          // "falta a permissão X" em vez de ficar calada. O que já está
          // gravado continua na tela.
          avisoHub = d.permissoesFaltando?.length
            ? `${d.error} A chave está cadastrada e funciona — o que falta é essa `
              + `permissão ser concedida a ela NO HUB, por quem administra as chaves `
              + `de acesso. O plano abaixo é o da última carga.`
            : `${d.error || 'A carga falhou.'} O plano abaixo é o da última carga.`;
          break;
        }

        carga = d.carga;
        avisos.push(...(d.avisos || []));
        if (d.passo.novas || d.passo.alteradas) mudou = true;
        if (d.passo.truncado) {
          avisoHub = 'Um dia de reuniões passou do teto de páginas do ERP; alguma ata desse dia pode ter ficado de fora.';
        }

        if (carga.completa) break;
      }
    } catch (e) {
      avisoHub = `Falha de conexão durante a carga: ${e.message}`;
    } finally {
      sincronizando = false;
      if (botao) botao.disabled = false;
    }

    if (mudou) {
      if (editando) recarregarDepois = true;
      else await carregar();
    }

    mostrarCarga();
    mostrarAviso();
    renderizarAvisos();
  }

  function mostrarCarga(emCurso) {
    const caixa = el('plano-carga');
    if (!caixa) return;

    if (emCurso) { caixa.textContent = emCurso; return; }
    if (!carga?.ultimaCargaEm) { caixa.textContent = 'Nenhuma carga feita ainda.'; return; }

    caixa.textContent = `Atas lidas até ${dataHoraBr(carga.carregadoAte)}`
      + (carga.completa ? '' : ' (carga incompleta)');
  }

  /* ----------------------------------------------------------
     Filtros
     ---------------------------------------------------------- */

  function montarSelect(id, campo, rotuloTodos) {
    const select = el(id);
    if (!select) return;

    const escolhido = select.value;
    const nomes = [...new Set(acoes.map((a) => a[campo]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    select.innerHTML = `<option value="">${rotuloTodos}</option>`
      + nomes.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');

    select.value = nomes.includes(escolhido) ? escolhido : '';
  }

  /**
   * Em que faixa de prazo a ação aberta está. Fechada devolve null.
   * É a mesma conta do gráfico de rosca e do filtro de situação.
   */
  function faixaDePrazo(a) {
    if (!a.aberta) return null;
    if (!a.dataPrevista) return 'sem-data';
    if (a.atrasada) return 'atrasadas';
    const hoje = new Date();
    const base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const faltam = Math.round((new Date(`${a.dataPrevista}T00:00:00Z`).getTime() - base) / 86400000);
    return faltam <= DIAS_VENCENDO ? 'vencendo' : 'no-prazo';
  }

  /**
   * `comSituacao = false` devolve o recorte de cliente, núcleo e busca,
   * sem o filtro de situação. É sobre ele que o painel conta: escolher
   * "Atrasadas" não pode fazer a rosca virar 100% atrasada.
   */
  function filtrar(comSituacao = true) {
    const busca = filtros.busca.trim().toLowerCase();

    return acoes.filter((a) => {
      if (filtros.cliente && a.cliente !== filtros.cliente) return false;
      if (filtros.nucleo && a.nucleo !== filtros.nucleo) return false;

      switch (comSituacao ? filtros.situacao : '') {
        case 'abertas': if (!a.aberta) return false; break;
        case 'atrasadas': if (!a.atrasada) return false; break;
        case 'vencendo': if (faixaDePrazo(a) !== 'vencendo') return false; break;
        case 'no-prazo': if (faixaDePrazo(a) !== 'no-prazo') return false; break;
        case 'sem-responsavel': if (!a.aberta || a.responsavel) return false; break;
        case 'sem-data': if (!a.aberta || a.dataPrevista) return false; break;
        case 'sem-5w': if (!a.aberta || tem5w(a)) return false; break;
        case 'fechadas': if (a.aberta) return false; break;
        default: break;
      }

      if (!busca) return true;

      return [a.cliente, a.tipoReuniao, a.nucleo, a.descricao, a.responsavel,
              a.porque, a.onde, a.como, identificador(a)]
        .filter(Boolean).join(' ').toLowerCase().includes(busca);
    });
  }

  /* ----------------------------------------------------------
     Desenho
     ---------------------------------------------------------- */

  /* ----------------------------------------------------------
     Painel: cartões no cabeçalho e três gráficos

     Tudo é contado sobre o recorte de cliente, núcleo e busca — com um
     cliente escolhido, os números são dele — mas NÃO sobre a situação:
     o painel é o mapa, a situação é o que se escolhe nele. Cada cartão,
     fatia, gargalo e coluna filtra a tabela com um clique.
     ---------------------------------------------------------- */

  /**
   * A faixa de prazo tem cor de STATUS, não de série: é estado. Cada uma
   * leva também um ícone, para a cor nunca carregar o sentido sozinha.
   */
  const FAIXAS = [
    { chave: 'atrasadas', rotulo: 'Atrasadas', cor: 'var(--st-critico)', icone: '●' },
    { chave: 'vencendo', rotulo: `Vencem em até ${DIAS_VENCENDO} dias`, cor: 'var(--st-alerta)', icone: '▲' },
    { chave: 'no-prazo', rotulo: 'No prazo', cor: 'var(--st-bom)', icone: '✓' },
    { chave: 'sem-data', rotulo: 'Sem data prevista', cor: 'var(--st-neutro)', icone: '○' }
  ];

  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

  function renderizarPainel(base) {
    const cartoes = el('plano-resumo');
    const painel = el('plano-painel');
    if (!cartoes || !painel) return;

    if (!acoes.length) { cartoes.innerHTML = ''; painel.innerHTML = ''; return; }

    const abertas = base.filter((a) => a.aberta);
    const total = abertas.length;
    const conta = (f) => abertas.filter(f).length;

    /* ---- os cartões do cabeçalho ---- */
    const cartao = (valor, rotulo, situacao, alerta) => `
      <button type="button" class="plano-numero${alerta && valor > 0 ? ' alerta' : ''}${filtros.situacao === situacao ? ' ativo' : ''}"
              data-situacao="${situacao}" title="Filtrar: ${rotulo}">
        <strong>${valor}</strong><span>${rotulo}</span>
      </button>`;

    cartoes.innerHTML = [
      cartao(total, 'em aberto', 'abertas'),
      cartao(conta((a) => a.atrasada), 'atrasadas', 'atrasadas', true),
      cartao(base.length - total, 'fechadas', 'fechadas'),
      cartao(base.length, 'no total', '')
    ].join('');

    /* ---- 1. a rosca: as abertas por faixa de prazo ---- */
    const porFaixa = FAIXAS.map((f) => ({ ...f, n: conta((a) => faixaDePrazo(a) === f.chave) }));

    const R = 54;
    const C = 2 * Math.PI * R;
    // 2px de superfície entre fatias, só quando há mais de uma.
    const VAO = porFaixa.filter((f) => f.n).length > 1 ? 2 : 0;
    let andado = 0;
    const fatias = porFaixa.filter((f) => f.n > 0).map((f) => {
      const comp = (f.n / total) * C;
      const traco = Math.max(comp - VAO, 0.5);
      const arco = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${f.cor}" stroke-width="18"
          stroke-dasharray="${traco} ${C - traco}" stroke-dashoffset="${-andado}"
          class="pn-fatia" data-situacao="${f.chave}"
          data-dica="${esc(f.rotulo)}: ${f.n} (${pct(f.n, total)}%)"></circle>`;
      andado += comp;
      return arco;
    }).join('');

    const rosca = `
      <section class="pn-bloco">
        <h3>Ações em aberto por prazo</h3>
        <div class="pn-rosca">
          <svg viewBox="0 0 140 140" role="img" aria-label="${esc(porFaixa.map((f) => `${f.rotulo}: ${f.n}`).join(', '))}">
            <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--border-color)" stroke-width="18"></circle>
            <g transform="rotate(-90 70 70)">${fatias}</g>
            <text x="70" y="70" text-anchor="middle" class="pn-total">${total}</text>
            <text x="70" y="88" text-anchor="middle" class="pn-total-rotulo">em aberto</text>
          </svg>
          <ul class="pn-legenda">
            ${porFaixa.map((f) => `
              <li><button type="button" data-situacao="${f.chave}" class="${filtros.situacao === f.chave ? 'ativo' : ''}">
                <span class="pn-marca" style="color:${f.cor}">${f.icone}</span>
                <span class="pn-leg-rotulo">${f.rotulo}</span>
                <strong>${f.n}</strong><small>${pct(f.n, total)}%</small>
              </button></li>`).join('')}
          </ul>
        </div>
      </section>`;

    /* ---- 2. gargalos de cadastro: uma série só, sobre as abertas ---- */
    const gargalos = [
      { rotulo: 'Sem responsável', situacao: 'sem-responsavel', n: conta((a) => !a.responsavel) },
      { rotulo: 'Sem data prevista', situacao: 'sem-data', n: conta((a) => !a.dataPrevista) },
      { rotulo: 'Sem 5W2H', situacao: 'sem-5w', n: conta((a) => !tem5w(a)) }
    ];

    const barrasH = `
      <section class="pn-bloco">
        <h3>Gargalos de cadastro <small>das ${total} em aberto</small></h3>
        <div class="pn-gargalos">
          ${gargalos.map((g) => `
            <button type="button" class="pn-garg${filtros.situacao === g.situacao ? ' ativo' : ''}" data-situacao="${g.situacao}"
                    data-dica="${g.rotulo}: ${g.n} de ${total} (${pct(g.n, total)}%)">
              <span class="pn-garg-rotulo">${g.rotulo}</span>
              <span class="pn-trilho"><span class="pn-barra" style="width:${pct(g.n, total)}%"></span></span>
              <span class="pn-garg-valor"><strong>${g.n}</strong> <small>${pct(g.n, total)}%</small></span>
            </button>`).join('')}
        </div>
      </section>`;

    /* ---- 3. abertas por núcleo: maior primeiro, no máximo oito ---- */
    const porNucleo = new Map();
    abertas.forEach((a) => {
      const k = a.nucleo || 'Sem núcleo';
      porNucleo.set(k, (porNucleo.get(k) || 0) + 1);
    });
    let nucleos = [...porNucleo].sort((x, y) => y[1] - x[1]);
    if (nucleos.length > 8) {
      const resto = nucleos.slice(7).reduce((soma, [, n]) => soma + n, 0);
      nucleos = [...nucleos.slice(0, 7), ['Outros', resto]];
    }
    const maior = Math.max(1, ...nucleos.map(([, n]) => n));

    const barrasV = `
      <section class="pn-bloco">
        <h3>Ações em aberto por núcleo</h3>
        ${nucleos.length === 0 ? '<p class="pn-vazio">Nenhuma ação em aberto.</p>' : `
        <div class="pn-colunas">
          ${nucleos.map(([nome, n]) => {
            const filtravel = nome !== 'Outros' && nome !== 'Sem núcleo';
            return `
            <button type="button" class="pn-col${filtros.nucleo === nome ? ' ativo' : ''}"
                    ${filtravel ? `data-nucleo="${esc(nome)}"` : ''}
                    data-dica="${esc(nome)}: ${n} (${pct(n, total)}%)">
              <span class="pn-col-valor">${n}</span>
              <span class="pn-col-area"><span class="pn-col-barra" style="height:${Math.max(2, (n / maior) * 100)}%"></span></span>
              <span class="pn-col-rotulo">${esc(nome)}</span>
            </button>`;
          }).join('')}
        </div>`}
      </section>`;

    painel.innerHTML = rosca + barrasH + barrasV;
  }

  /* ----------------------------------------------------------
     Ordenação por coluna
     ---------------------------------------------------------- */

  const coletor = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

  function chaveDeOrdem(a, chave) {
    if (chave === 'acao') return a.numeroCliente != null ? a.numeroCliente * 10000 + a.numero : null;
    if (chave === 'status') return ROTULO_STATUS[a.status] || a.status || null;
    const v = a[chave];
    return v == null || v === '' ? null : v;
  }

  /** Vazio vai sempre para o fim, nos dois sentidos: "—" no topo não informa nada. */
  function ordenar(lista) {
    if (!ordem.chave) return lista;
    return [...lista].sort((x, y) => {
      const a = chaveDeOrdem(x, ordem.chave);
      const b = chaveDeOrdem(y, ordem.chave);
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      const c = typeof a === 'number' && typeof b === 'number' ? a - b : coletor.compare(String(a), String(b));
      return c * ordem.sentido;
    });
  }

  function cabecalhoHtml(c) {
    const ativa = ordem.chave === c.chave;
    const seta = ativa ? (ordem.sentido === 1 ? '▲' : '▼') : '↕';
    const proximo = ativa && ordem.sentido === 1 ? 'Z → A' : (ativa ? 'ordem original' : 'A → Z');
    return `<th class="${c.classe} p-ordenavel${ativa ? ' ordenada' : ''}" data-ordem="${c.chave}"
                aria-sort="${ativa ? (ordem.sentido === 1 ? 'ascending' : 'descending') : 'none'}"
                title="Ordenar: ${proximo}">${c.rotulo}<span class="p-seta">${seta}</span></th>`;
  }

  function valorCelula(a, col) {
    const vazio = '<span class="p-vazio">—</span>';

    switch (col.chave) {
      case 'acao':
        return `<span title="${a.numeroCliente != null
          ? `Ação ${a.numeroCliente} deste cliente · AÇÃO ${a.numero} em ${esc(a.tipoReuniao || '')}`
          : 'Sem número do cliente'}">${esc(identificador(a))}</span>`;

      case 'dataPrevista': {
        const d = dataBr(a.dataPrevista);
        if (!d) return vazio;
        return a.atrasada
          ? `<span class="p-atraso" title="${a.diasDeAtraso} dia(s) de atraso">${d}<small>${a.diasDeAtraso}d</small></span>`
          : d;
      }

      case 'status': {
        const titulo = [
          a.statusBruto ? `Na ata: ${a.statusBruto}` : '',
          a.statusDesde ? `Desde ${dataBr(a.statusDesde)}` : '',
          a.saiuDaAtaEm ? `Saiu da ata em ${dataBr(a.saiuDaAtaEm)}` : ''
        ].filter(Boolean).join(' · ');
        return `<span class="p-status st-${esc(a.status)}" title="${esc(titulo)}">${ROTULO_STATUS[a.status] || esc(a.status)}</span>`;
      }

      default: {
        const v = a[col.chave];
        return v ? `<div class="p-texto">${esc(v)}</div>` : vazio;
      }
    }
  }

  function editorHtml(a, col) {
    const v = col.chave === 'status' ? a.status : (a[col.chave] ?? '');

    if (col.tipo === 'status') {
      const opcoes = STATUS_ESCOLHA.includes(v) ? STATUS_ESCOLHA : [v, ...STATUS_ESCOLHA];
      return `<select class="p-editor">${opcoes.map((s) =>
        `<option value="${esc(s)}"${s === v ? ' selected' : ''}${STATUS_ESCOLHA.includes(s) ? '' : ' disabled'}>${ROTULO_STATUS[s] || esc(s)}</option>`
      ).join('')}</select>`;
    }
    if (col.tipo === 'data') return `<input type="date" class="p-editor" value="${esc(v)}">`;
    if (col.tipo === 'longo') return `<textarea class="p-editor" rows="4" maxlength="2000">${esc(v)}</textarea>`;
    return `<input type="text" class="p-editor" maxlength="2000" value="${esc(v)}">`;
  }

  function linhaHtml(a) {
    const classes = ['p-linha', a.atrasada ? 'atrasada' : '', a.aberta ? '' : 'fechada'].filter(Boolean).join(' ');

    const celulas = COLUNAS.map((col) => {
      const emEdicao = editando && editando.id === a.id && editando.campo === col.campo;
      const editavel = !!col.campo;
      return `<td class="${col.classe}${editavel ? ' editavel' : ''}${emEdicao ? ' editando' : ''}"
                  ${editavel ? `data-campo="${col.campo}" title="Clique para editar"` : ''}>${
        emEdicao ? editorHtml(a, col) : valorCelula(a, col)
      }</td>`;
    }).join('');

    return `<tr class="${classes}" data-id="${a.id}">${celulas}
      <td class="c-log"><button type="button" class="p-log" data-log="${a.id}"
          title="Histórico de alterações">🕘</button></td></tr>`;
  }

  function renderizar() {
    mostrarAviso();
    mostrarCarga();
    montarSelect('plano-cliente', 'cliente', 'Todos os clientes');
    montarSelect('plano-nucleo', 'nucleo', 'Todos os núcleos');

    const caixa = el('plano-lista');
    if (!caixa) return;

    const lista = ordenar(filtrar());
    renderizarPainel(filtrar(false));

    if (lista.length === 0) {
      caixa.innerHTML = `<div class="coluna-vazia">${
        acoes.length === 0
          ? (carga?.ultimaCargaEm ? 'Nenhuma ação nas atas carregadas.' : 'Nenhuma ação carregada ainda.')
          : 'Nenhuma ação com esses filtros.'
      }</div>`;
      return;
    }

    const visiveis = lista.slice(0, limite);

    caixa.innerHTML = `
      <div class="p-rolagem">
        <table class="p-tabela">
          <thead><tr>${COLUNAS.map(cabecalhoHtml).join('')}<th class="c-log"></th></tr></thead>
          <tbody>${visiveis.map(linhaHtml).join('')}</tbody>
        </table>
      </div>
      <div class="p-rodape">
        ${lista.length} ação(ões)${lista.length > limite
          ? ` · mostrando ${limite} <button type="button" class="btn btn-secondary btn-sm" data-mais>Mostrar mais ${Math.min(POR_PAGINA, lista.length - limite)}</button>`
          : ''}
      </div>`;

    focarEditor();
  }

  /** Troca só uma linha: gravar uma célula não pode rolar a tabela. */
  function redesenharLinha(id) {
    const tr = el('plano-lista')?.querySelector(`tr[data-id="${id}"]`);
    const a = acoes.find((x) => x.id === id);
    if (!tr || !a) { renderizar(); return; }
    tr.outerHTML = linhaHtml(a);
    renderizarPainel(filtrar(false));
    focarEditor();
  }

  function focarEditor() {
    const campo = el('plano-lista')?.querySelector('.p-editor');
    if (!campo) return;
    campo.focus();
    if (campo.tagName !== 'SELECT' && campo.type !== 'date') {
      const n = campo.value.length;
      campo.setSelectionRange?.(n, n);
    }
  }

  function mostrarAviso() {
    const faixa = el('plano-aviso');
    if (!faixa) return;
    faixa.classList.toggle('hidden', !avisoHub);
    faixa.textContent = avisoHub || '';
  }

  /** Ata fora do manual não é erro do CRM, mas quem a escreveu precisa saber. */
  function renderizarAvisos() {
    const caixa = el('plano-avisos-caixa');
    if (!caixa) return;

    caixa.classList.toggle('hidden', avisos.length === 0);
    if (avisos.length === 0) return;

    el('plano-avisos-total').textContent = `${avisos.length} aviso(s) na leitura das atas desta carga`;
    el('plano-avisos').innerHTML = avisos.map((a) => `
      <li><strong>${esc(a.cliente || '—')}</strong>
        ${a.reuniao ? `(reunião ${a.reuniao})` : ''} — ${esc(a.aviso)}</li>`).join('');
  }

  /* ----------------------------------------------------------
     Edição de uma célula
     ---------------------------------------------------------- */

  function abrirEditor(id, campo) {
    if (editando && editando.id === id && editando.campo === campo) return;
    const anterior = editando;
    editando = { id, campo };
    if (anterior && anterior.id !== id) redesenharLinha(anterior.id);
    redesenharLinha(id);
  }

  function fecharEditor() {
    const id = editando?.id;
    editando = null;
    if (recarregarDepois) { recarregarDepois = false; carregar(); return; }
    if (id != null) redesenharLinha(id);
  }

  /**
   * Grava a célula aberta.
   *
   * Clicar noutra célula dispara esta gravação E abre o editor novo. Por
   * isso, ao terminar, só fecha o editor se ele ainda for o desta célula:
   * senão fecharia o que a pessoa acabou de abrir.
   */
  async function gravarEditor() {
    if (!editando || editando.gravando) return;

    const alvo = editando;
    const { id, campo } = alvo;
    const a = acoes.find((x) => x.id === id);
    const col = colunaDoCampo(campo);
    const entrada = el('plano-lista')?.querySelector('.p-editor');
    if (!a || !col || !entrada) { fecharEditor(); return; }

    const antes = a[col.chave] ?? null;
    const depois = entrada.value.trim() || null;

    if ((antes ?? '') === (depois ?? '')) { fecharEditor(); return; }

    alvo.gravando = true;
    entrada.disabled = true;

    const aindaAberto = () => editando === alvo;

    try {
      const r = await fetch(`/api/plano-acao?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // `de` é o que a pessoa estava vendo. Se alguém mudou antes, o
        // servidor recusa em vez de apagar a mudança do outro.
        body: JSON.stringify({ campo, de: antes, para: depois })
      });
      const d = await r.json();

      if (d.acao) Object.assign(a, d.acao);
      if (!r.ok) alert(d.error || 'Não foi possível salvar.');

      if (aindaAberto()) fecharEditor();
      else redesenharLinha(id);

    } catch (e) {
      alert('Falha de conexão ao salvar. A alteração não foi gravada.');
      alvo.gravando = false;
      if (aindaAberto()) { entrada.disabled = false; entrada.focus(); }
    }
  }

  /* ----------------------------------------------------------
     Histórico de uma ação
     ---------------------------------------------------------- */

  const ROTULO_CAMPO = {
    descricao: 'Descrição', responsavel: 'Responsável', prazo: 'Quando',
    data_prevista: 'Data prevista', status: 'Status', porque: 'Por quê',
    onde: 'Onde', como: 'Como', quanto: 'Quanto', observacoes: 'Observações'
  };

  const valorDoLog = (campo, v) => {
    if (v == null || v === '') return '<em>vazio</em>';
    if (campo === 'status') return esc(ROTULO_STATUS[v] || v);
    if (campo === 'data_prevista') return esc(dataBr(v) || v);
    return esc(v);
  };

  async function abrirHistorico(id) {
    const a = acoes.find((x) => x.id === id);
    const modal = el('modal-plano-log');
    if (!modal || !a) return;

    el('plano-log-titulo').textContent = `Histórico · ${a.cliente || ''} · ${identificador(a)}`;
    el('plano-log-acao').textContent = a.descricao || '';
    el('plano-log-lista').innerHTML = '<li class="p-log-vazio">Carregando…</li>';
    modal.classList.remove('hidden');

    try {
      const r = await fetch(`/api/plano-acao?log=${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'falha');

      el('plano-log-lista').innerHTML = (d.log || []).length === 0
        ? '<li class="p-log-vazio">Nenhuma alteração registrada.</li>'
        : d.log.map((l) => {
            const quem = esc(l.por_nome && l.por_nome !== l.por ? `${l.por_nome} (${l.por})` : l.por);
            const origem = l.origem === 'ata'
              ? `<span class="p-origem ata">ata${l.reuniao_nid != null ? ` · reunião ${l.reuniao_nid}` : ''}</span>`
              : '<span class="p-origem crm">à mão</span>';

            const oque = l.campo === 'criada'
              ? 'Ação carregada da ata'
              : `<strong>${esc(ROTULO_CAMPO[l.campo] || l.campo)}</strong>: ${valorDoLog(l.campo, l.de)} → ${valorDoLog(l.campo, l.para)}`;

            return `<li>
              <div class="p-log-topo">${dataHoraBr(l.em)} · ${quem} ${origem}</div>
              <div>${oque}</div>
            </li>`;
          }).join('');
    } catch (e) {
      el('plano-log-lista').innerHTML = `<li class="p-log-vazio">Não foi possível ler o histórico: ${esc(e.message)}</li>`;
    }
  }

  function fecharHistorico() {
    el('modal-plano-log')?.classList.add('hidden');
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    el('btn-plano-carga')?.addEventListener('click', sincronizar);

    el('plano-busca')?.addEventListener('input', (ev) => {
      clearTimeout(debounce);
      const v = ev.target.value;
      debounce = setTimeout(() => { filtros.busca = v; limite = POR_PAGINA; renderizar(); }, 250);
    });

    el('plano-cliente')?.addEventListener('change', (ev) => {
      filtros.cliente = ev.target.value; limite = POR_PAGINA; renderizar();
    });

    el('plano-nucleo')?.addEventListener('change', (ev) => {
      filtros.nucleo = ev.target.value; limite = POR_PAGINA; renderizar();
    });

    el('plano-situacao')?.addEventListener('change', (ev) => {
      filtros.situacao = ev.target.value; limite = POR_PAGINA; renderizar();
    });

    // Cartões, fatias, gargalos e colunas do painel filtram a tabela.
    // Clicar de novo no filtro ativo volta para "Em aberto".
    const aoClicarNoPainel = (ev) => {
      const porSituacao = ev.target.closest('[data-situacao]');
      const porNucleo = ev.target.closest('[data-nucleo]');
      if (porNucleo) {
        filtros.nucleo = filtros.nucleo === porNucleo.dataset.nucleo ? '' : porNucleo.dataset.nucleo;
        const n = el('plano-nucleo');
        if (n) n.value = filtros.nucleo;
      } else if (porSituacao) {
        const escolhida = porSituacao.dataset.situacao;
        filtros.situacao = filtros.situacao === escolhida && escolhida !== 'abertas' ? 'abertas' : escolhida;
        const sel = el('plano-situacao');
        if (sel) sel.value = filtros.situacao;
      } else return;
      limite = POR_PAGINA;
      renderizar();
    };
    el('plano-resumo')?.addEventListener('click', aoClicarNoPainel);
    el('plano-painel')?.addEventListener('click', aoClicarNoPainel);

    // A dica que acompanha o mouse nas marcas dos gráficos.
    const dica = el('plano-dica');
    el('plano-painel')?.addEventListener('mousemove', (ev) => {
      if (!dica) return;
      const alvo = ev.target.closest('[data-dica]');
      if (!alvo) { dica.classList.add('hidden'); return; }
      dica.textContent = alvo.dataset.dica;
      dica.classList.remove('hidden');
      dica.style.left = `${ev.clientX + 14}px`;
      dica.style.top = `${ev.clientY + 14}px`;
    });
    el('plano-painel')?.addEventListener('mouseleave', () => dica?.classList.add('hidden'));

    const lista = el('plano-lista');

    lista?.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-mais]')) { limite += POR_PAGINA; renderizar(); return; }

      // Cabeçalho: A → Z, Z → A, e de volta à ordem original.
      const th = ev.target.closest('th[data-ordem]');
      if (th) {
        const chave = th.dataset.ordem;
        if (ordem.chave !== chave) { ordem.chave = chave; ordem.sentido = 1; }
        else if (ordem.sentido === 1) ordem.sentido = -1;
        else ordem.chave = null;
        renderizar();
        return;
      }

      const log = ev.target.closest('[data-log]');
      if (log) { abrirHistorico(Number(log.dataset.log)); return; }

      if (ev.target.closest('.p-editor')) return;

      const td = ev.target.closest('td.editavel');
      if (!td) return;

      const id = Number(td.closest('tr')?.dataset.id);
      if (!id) return;
      abrirEditor(id, td.dataset.campo);
    });

    lista?.addEventListener('keydown', (ev) => {
      if (!ev.target.classList?.contains('p-editor')) return;

      if (ev.key === 'Escape') { ev.preventDefault(); fecharEditor(); return; }

      // No texto longo, Enter quebra a linha só com Shift.
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); gravarEditor(); }
    });

    // A lista grava assim que se escolhe: não há o que confirmar.
    lista?.addEventListener('change', (ev) => {
      if (ev.target.tagName === 'SELECT' && ev.target.classList.contains('p-editor')) gravarEditor();
    });

    // Sair da célula grava, como numa planilha.
    lista?.addEventListener('focusout', (ev) => {
      if (!ev.target.classList?.contains('p-editor')) return;
      setTimeout(() => {
        if (editando && !document.activeElement?.classList?.contains('p-editor')) gravarEditor();
      }, 0);
    });

    el('btn-plano-log-fechar')?.addEventListener('click', fecharHistorico);
    el('modal-plano-log')?.addEventListener('click', (ev) => {
      if (ev.target.id === 'modal-plano-log') fecharHistorico();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el('modal-plano-log')?.classList.contains('hidden')) fecharHistorico();
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  /**
   * Ao entrar na tela: primeiro o que está gravado (instantâneo), depois
   * as reuniões novas desde a última carga.
   */
  let jaCarregou = false;
  async function aoEntrarNaTela() {
    if (jaCarregou) return;
    jaCarregou = true;
    const leu = await carregar();
    if (leu) sincronizar();
  }

  return { carregar, sincronizar, aoEntrarNaTela };
})();
