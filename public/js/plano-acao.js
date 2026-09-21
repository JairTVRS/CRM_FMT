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
  let porPagina = 200;         // preferência do usuário: 50, 100, 200 ou 500
  let limite = porPagina;
  let debounce = null;


  // `statusCliente` (2.30.0): o status do cliente no ERP. O padrão é só
  // os ativos — a escolha de cada um fica salva na preferência dele.
  const filtros = { busca: '', cliente: '', nucleo: '', situacao: 'abertas', statusCliente: 'active' };

  const ROTULO_STATUS_CLIENTE = {
    active: 'Ativo', inactive: 'Inativo', prospect: 'Prospect', ad_hoc: 'Avulso'
  };

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

  /** Tipo de ação (2.29.0): a CX classifica; a ata não tem. */
  const ROTULO_TIPO_ACAO = { operacional: 'Operacional', tatica: 'Tática', estrategica: 'Estratégica' };

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
    { chave: 'clienteStatus', rotulo: 'Status do cliente', classe: 'c-stcliente' },
    { chave: 'tipoReuniao', rotulo: 'Tipo de reunião', classe: 'c-tipo' },
    { chave: 'reuniaoEm', rotulo: 'Data da reunião', classe: 'c-reuniao' },
    { chave: 'nucleo', rotulo: 'Núcleo', classe: 'c-nucleo' },
    { chave: 'descricao', rotulo: 'Descrição', classe: 'c-descricao', campo: 'descricao', tipo: 'longo' },
    { chave: 'responsavel', rotulo: 'Responsável', classe: 'c-resp', campo: 'responsavel', tipo: 'texto' },
    { chave: 'porque', rotulo: 'Por quê', classe: 'c-5w', campo: 'porque', tipo: 'longo' },
    { chave: 'onde', rotulo: 'Onde', classe: 'c-onde', campo: 'onde', tipo: 'texto' },
    { chave: 'como', rotulo: 'Como', classe: 'c-5w', campo: 'como', tipo: 'longo' },
    { chave: 'dataPrevista', rotulo: 'Data prevista', classe: 'c-data', campo: 'data_prevista', tipo: 'data' },
    { chave: 'tipoAcao', rotulo: 'Tipo de ação', classe: 'c-tipoacao', campo: 'tipo_acao', tipo: 'tipoAcao' },
    { chave: 'status', rotulo: 'Status', classe: 'c-status', campo: 'status', tipo: 'status' }
  ];

  const colunaDoCampo = (campo) => COLUNAS.find((c) => c.campo === campo);

  /* ----------------------------------------------------------
     Configuração de colunas, por usuário (2.28.0)

     A engrenagem ao lado dos filtros abre um painel com todas as
     colunas: arrastar muda a ordem, o olho mostra ou esconde, as setas
     ordenam a tabela por ela. Fica gravado no servidor, por e-mail
     (/api/preferencias) — segue a pessoa em qualquer computador.
     ---------------------------------------------------------- */

  const CHAVE_PREFERENCIA = 'plano-colunas';
  const OPCOES_POR_PAGINA = [50, 100, 200, 500];
  const PADRAO_SEQUENCIA = COLUNAS.map((c) => c.chave);

  const layout = { sequencia: [...PADRAO_SEQUENCIA], ocultas: new Set(), semGraficos: false };
  let salvarDepois = null;

  const colunaPorChave = (k) => COLUNAS.find((c) => c.chave === k);

  function colunasVisiveis() {
    return layout.sequencia.map(colunaPorChave).filter((c) => c && !layout.ocultas.has(c.chave));
  }

  /**
   * Aplica o que veio do servidor, desconfiando de tudo: coluna que não
   * existe mais é ignorada, coluna nova (de uma versão futura) entra no
   * fim, visível. Esconder TODAS não é uma escolha — volta ao padrão.
   */
  function aplicarLayout(v) {
    if (!v || typeof v !== 'object') return;

    const conhecidas = Array.isArray(v.sequencia) ? v.sequencia.filter((k) => colunaPorChave(k)) : [];
    layout.sequencia = [...new Set([...conhecidas, ...PADRAO_SEQUENCIA])];
    layout.ocultas = new Set(Array.isArray(v.ocultas) ? v.ocultas.filter((k) => colunaPorChave(k)) : []);
    if (layout.ocultas.size >= COLUNAS.length) layout.ocultas.clear();

    layout.semGraficos = v.semGraficos === true;

    if (typeof v.statusCliente === 'string'
        && (v.statusCliente === '' || ROTULO_STATUS_CLIENTE[v.statusCliente])) {
      filtros.statusCliente = v.statusCliente;
    }

    if (OPCOES_POR_PAGINA.includes(Number(v.porPagina))) {
      porPagina = Number(v.porPagina);
      limite = porPagina;
    }

    if (v.ordem && colunaPorChave(v.ordem.chave) && [1, -1].includes(v.ordem.sentido)) {
      ordem.chave = v.ordem.chave;
      ordem.sentido = v.ordem.sentido;
    }
  }

  async function carregarLayout() {
    try {
      const r = await fetch(`/api/preferencias?chave=${CHAVE_PREFERENCIA}`);
      if (r.ok) aplicarLayout((await r.json()).valor);
    } catch (e) { /* sem preferência: fica o padrão */ }
  }

  /** Grava meio segundo depois da última mudança: arrastar cinco colunas é uma gravação. */
  function salvarLayout() {
    clearTimeout(salvarDepois);
    salvarDepois = setTimeout(async () => {
      const nota = el('plano-config-nota');
      try {
        const r = await fetch(`/api/preferencias?chave=${CHAVE_PREFERENCIA}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            valor: {
              sequencia: layout.sequencia,
              ocultas: [...layout.ocultas],
              porPagina,
              semGraficos: layout.semGraficos,
              statusCliente: filtros.statusCliente,
              ordem: ordem.chave ? { chave: ordem.chave, sentido: ordem.sentido } : null
            }
          })
        });
        if (nota) {
          const d = r.ok ? null : await r.json().catch(() => ({}));
          nota.textContent = r.ok
            ? 'Salvo para você — vale em qualquer computador.'
            : (d?.error || 'Não foi possível salvar; vale só até recarregar.');
        }
      } catch (e) {
        if (nota) nota.textContent = 'Sem conexão: a configuração vale só até recarregar.';
      }
    }, 500);
  }

  const ICONE_OLHO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICONE_OLHO_FECHADO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  function renderizarConfiguracao() {
    const lista = el('plano-config-colunas');
    if (!lista) return;

    const pagina = el('plano-por-pagina');
    if (pagina) pagina.value = String(porPagina);

    lista.innerHTML = layout.sequencia.map((k) => {
      const c = colunaPorChave(k);
      const visivel = !layout.ocultas.has(k);
      const ordenada = ordem.chave === k;
      const seta = ordenada ? (ordem.sentido === 1 ? '▲' : '▼') : '↕';
      return `
        <li class="pc-item${visivel ? '' : ' oculta'}" draggable="true" data-coluna="${k}">
          <span class="pc-alca" tabindex="0" role="button"
                aria-label="Mover ${c.rotulo}: setas para cima e para baixo" title="Arraste para mudar a ordem">☰</span>
          <span class="pc-nome">${c.rotulo}</span>
          <button type="button" class="pc-botao pc-ordem${ordenada ? ' ativo' : ''}" data-acao="ordenar"
                  title="${ordenada ? (ordem.sentido === 1 ? 'Ordenado A → Z; clique para Z → A' : 'Ordenado Z → A; clique para tirar') : 'Ordenar a tabela por esta coluna'}">${seta}</button>
          <button type="button" class="pc-botao pc-olho${visivel ? ' ativo' : ''}" data-acao="olho"
                  aria-pressed="${visivel}" title="${visivel ? 'Esconder a coluna' : 'Mostrar a coluna'}">${visivel ? ICONE_OLHO : ICONE_OLHO_FECHADO}</button>
        </li>`;
    }).join('');
  }

  function abrirConfiguracao() {
    renderizarConfiguracao();
    el('plano-config')?.classList.remove('hidden');
    el('plano-config-fundo')?.classList.remove('hidden');
    el('btn-plano-config-fechar')?.focus();
  }

  function fecharConfiguracao() {
    el('plano-config')?.classList.add('hidden');
    el('plano-config-fundo')?.classList.add('hidden');
    el('btn-plano-colunas')?.focus();
  }

  /** Uma mudança no painel: redesenha o painel e a tabela, e grava. */
  function mudouLayout() {
    renderizarConfiguracao();
    renderizar();
    salvarLayout();
  }

  function moverColuna(k, passo) {
    const i = layout.sequencia.indexOf(k);
    const j = i + passo;
    if (i < 0 || j < 0 || j >= layout.sequencia.length) return;
    [layout.sequencia[i], layout.sequencia[j]] = [layout.sequencia[j], layout.sequencia[i]];
    mudouLayout();
    el('plano-config-colunas')?.querySelector(`[data-coluna="${k}"] .pc-alca`)?.focus();
  }

  function ligarConfiguracao() {
    el('btn-plano-colunas')?.addEventListener('click', abrirConfiguracao);

    el('btn-plano-graficos')?.addEventListener('click', () => {
      layout.semGraficos = !layout.semGraficos;
      renderizar();
      salvarLayout();
    });
    el('btn-plano-config-fechar')?.addEventListener('click', fecharConfiguracao);
    el('plano-config-fundo')?.addEventListener('click', fecharConfiguracao);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el('plano-config')?.classList.contains('hidden')) fecharConfiguracao();
    });

    el('plano-por-pagina')?.addEventListener('change', (ev) => {
      porPagina = Number(ev.target.value) || 200;
      limite = porPagina;
      mudouLayout();
    });

    el('btn-plano-restaurar')?.addEventListener('click', () => {
      layout.sequencia = [...PADRAO_SEQUENCIA];
      layout.ocultas.clear();
      layout.semGraficos = false;
      ordem.chave = null;
      ordem.sentido = 1;
      mudouLayout();
    });

    const lista = el('plano-config-colunas');
    if (!lista) return;

    lista.addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-acao]');
      const k = ev.target.closest('[data-coluna]')?.dataset.coluna;
      if (!botao || !k) return;

      if (botao.dataset.acao === 'olho') {
        if (layout.ocultas.has(k)) layout.ocultas.delete(k);
        else if (layout.ocultas.size < COLUNAS.length - 1) layout.ocultas.add(k);
        else return;   // a última coluna visível não se esconde
      }

      if (botao.dataset.acao === 'ordenar') {
        if (ordem.chave !== k) { ordem.chave = k; ordem.sentido = 1; }
        else if (ordem.sentido === 1) ordem.sentido = -1;
        else ordem.chave = null;
      }

      mudouLayout();
    });

    // Teclado: a alça com foco move com as setas.
    lista.addEventListener('keydown', (ev) => {
      if (!ev.target.classList.contains('pc-alca')) return;
      const k = ev.target.closest('[data-coluna]')?.dataset.coluna;
      if (ev.key === 'ArrowUp') { ev.preventDefault(); moverColuna(k, -1); }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); moverColuna(k, 1); }
    });

    // Arrastar: a linha muda de lugar enquanto se arrasta; ao soltar, a
    // ordem da lista vira a ordem das colunas.
    let arrastada = null;

    lista.addEventListener('dragstart', (ev) => {
      arrastada = ev.target.closest('.pc-item');
      if (!arrastada) return;
      arrastada.classList.add('arrastando');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', arrastada.dataset.coluna);
    });

    lista.addEventListener('dragover', (ev) => {
      if (!arrastada) return;
      ev.preventDefault();
      const alvo = ev.target.closest('.pc-item');
      if (!alvo || alvo === arrastada) return;
      const r = alvo.getBoundingClientRect();
      const depois = ev.clientY > r.top + r.height / 2;
      alvo.parentNode.insertBefore(arrastada, depois ? alvo.nextSibling : alvo);
    });

    const soltar = () => {
      if (!arrastada) return;
      arrastada.classList.remove('arrastando');
      arrastada = null;
      const nova = [...lista.querySelectorAll('.pc-item')].map((li) => li.dataset.coluna);
      if (nova.join() !== layout.sequencia.join()) {
        layout.sequencia = nova;
        mudouLayout();
      }
    };
    lista.addEventListener('drop', (ev) => { ev.preventDefault(); soltar(); });
    lista.addEventListener('dragend', soltar);
  }


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

  async function carregar({ semDesenhar = false } = {}) {
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
      if (!semDesenhar) renderizar();
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
        if (d.passo.novas || d.passo.alteradas || d.passo.clientesAtualizados) mudou = true;
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
    const base = acoes.filter((a) => !filtros.statusCliente || !a.clienteStatus || a.clienteStatus === filtros.statusCliente);
    const nomes = [...new Set(base.map((a) => a[campo]).filter(Boolean))]
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
      // Sem status gravado ainda (antes da primeira carga da 2.30.0) a ação
      // aparece: esconder o que não se sabe seria afirmar que não é ativo.
      if (filtros.statusCliente && a.clienteStatus && a.clienteStatus !== filtros.statusCliente) return false;

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
              a.porque, a.onde, a.como, ROTULO_TIPO_ACAO[a.tipoAcao], identificador(a)]
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

    const botao = el('btn-plano-graficos');
    if (botao) {
      botao.setAttribute('aria-pressed', String(!layout.semGraficos));
      botao.title = layout.semGraficos ? 'Mostrar os gráficos' : 'Recolher os gráficos';
    }

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

    // Recolhido, os cartões do cabeçalho continuam: os números seguem à vista.
    painel.innerHTML = layout.semGraficos ? '' : rosca + barrasH + barrasV;
  }

  /* ----------------------------------------------------------
     Ordenação por coluna
     ---------------------------------------------------------- */

  const coletor = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

  function chaveDeOrdem(a, chave) {
    if (chave === 'acao') return a.numeroCliente != null ? a.numeroCliente * 10000 + a.numero : null;
    if (chave === 'status') return ROTULO_STATUS[a.status] || a.status || null;
    if (chave === 'tipoAcao') return ROTULO_TIPO_ACAO[a.tipoAcao] || null;
    if (chave === 'clienteStatus') return ROTULO_STATUS_CLIENTE[a.clienteStatus] || null;
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
        // "Quando" e "Data prevista" eram duas colunas com a mesma coisa.
        // Ficou a data; o que a ata escreveu aparece só quando não virou
        // data ("a definir", "próxima"), apagado, como dica.
        if (!d) {
          return a.prazo
            ? `<span class="p-prazo-ata" title="Prazo escrito na ata. Clique para definir a data.">${esc(a.prazo)}</span>`
            : vazio;
        }
        const naAta = a.prazo && a.prazo.trim() !== d ? ` title="Na ata: ${esc(a.prazo)}"` : '';
        return a.atrasada
          ? `<span class="p-atraso" title="${a.diasDeAtraso} dia(s) de atraso${a.prazo ? ` · na ata: ${esc(a.prazo)}` : ''}">${d}<small>${a.diasDeAtraso}d</small></span>`
          : `<span${naAta}>${d}</span>`;
      }

      case 'clienteStatus': {
        const r = ROTULO_STATUS_CLIENTE[a.clienteStatus];
        return r ? `<span class="p-stcliente sc-${esc(a.clienteStatus)}">${r}</span>` : vazio;
      }

      case 'reuniaoEm': {
        const d = dataBr(a.reuniaoEm);
        return d ? `<span title="Data da reunião no ERP${a.reuniaoNid != null ? ` · reunião ${a.reuniaoNid}` : ''}">${d}</span>` : vazio;
      }

      case 'tipoAcao': {
        const r = ROTULO_TIPO_ACAO[a.tipoAcao];
        return r ? `<span class="p-tipo tp-${esc(a.tipoAcao)}">${r}</span>` : vazio;
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
    if (col.tipo === 'tipoAcao') {
      return `<select class="p-editor"><option value="">— não classificada</option>${
        Object.entries(ROTULO_TIPO_ACAO).map(([k, r]) =>
          `<option value="${k}"${k === v ? ' selected' : ''}>${r}</option>`).join('')
      }</select>`;
    }
    if (col.tipo === 'data') return `<input type="date" class="p-editor" value="${esc(v)}">`;
    if (col.tipo === 'longo') return `<textarea class="p-editor" rows="4" maxlength="2000">${esc(v)}</textarea>`;
    return `<input type="text" class="p-editor" maxlength="2000" value="${esc(v)}">`;
  }

  function linhaHtml(a) {
    const classes = ['p-linha', a.atrasada ? 'atrasada' : '', a.aberta ? '' : 'fechada'].filter(Boolean).join(' ');

    const celulas = colunasVisiveis().map((col) => {
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
    const seletorStatus = el('plano-status-cliente');
    if (seletorStatus) seletorStatus.value = filtros.statusCliente;
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
          <thead><tr>${colunasVisiveis().map(cabecalhoHtml).join('')}<th class="c-log"></th></tr></thead>
          <tbody>${visiveis.map(linhaHtml).join('')}</tbody>
        </table>
      </div>
      <div class="p-rodape">
        ${lista.length} ação(ões)${lista.length > limite
          ? ` · mostrando ${limite} <button type="button" class="btn btn-secondary btn-sm" data-mais>Mostrar mais ${Math.min(porPagina, lista.length - limite)}</button>`
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
    onde: 'Onde', como: 'Como', quanto: 'Quanto', observacoes: 'Observações',
    tipo_acao: 'Tipo de ação'
  };

  const valorDoLog = (campo, v) => {
    if (v == null || v === '') return '<em>vazio</em>';
    if (campo === 'status') return esc(ROTULO_STATUS[v] || v);
    if (campo === 'data_prevista') return esc(dataBr(v) || v);
    if (campo === 'tipo_acao') return esc(ROTULO_TIPO_ACAO[v] || v);
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
    ligarConfiguracao();

    el('plano-busca')?.addEventListener('input', (ev) => {
      clearTimeout(debounce);
      const v = ev.target.value;
      debounce = setTimeout(() => { filtros.busca = v; limite = porPagina; renderizar(); }, 250);
    });

    el('plano-cliente')?.addEventListener('change', (ev) => {
      filtros.cliente = ev.target.value; limite = porPagina; renderizar();
    });

    el('plano-nucleo')?.addEventListener('change', (ev) => {
      filtros.nucleo = ev.target.value; limite = porPagina; renderizar();
    });

    el('plano-status-cliente')?.addEventListener('change', (ev) => {
      filtros.statusCliente = ev.target.value;
      limite = porPagina;
      renderizar();
      salvarLayout();
    });

    el('plano-situacao')?.addEventListener('change', (ev) => {
      filtros.situacao = ev.target.value; limite = porPagina; renderizar();
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
      limite = porPagina;
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
      if (ev.target.closest('[data-mais]')) { limite += porPagina; renderizar(); return; }

      // Cabeçalho: A → Z, Z → A, e de volta à ordem original.
      const th = ev.target.closest('th[data-ordem]');
      if (th) {
        const chave = th.dataset.ordem;
        if (ordem.chave !== chave) { ordem.chave = chave; ordem.sentido = 1; }
        else if (ordem.sentido === 1) ordem.sentido = -1;
        else ordem.chave = null;
        salvarLayout();
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
    // A preferência de colunas chega junto com o plano; a tabela só é
    // desenhada uma vez, já na ordem da pessoa.
    const [leu] = await Promise.all([carregar({ semDesenhar: true }), carregarLayout()]);
    renderizar();
    if (leu) sincronizar();
  }

  return { carregar, sincronizar, aoEntrarNaTela };
})();
