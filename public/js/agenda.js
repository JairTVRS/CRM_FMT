/**
 * agenda.js — a agenda do lead (2.32.0).
 *
 * Três lugares, uma janela só:
 *
 *   1. A visão AGENDA da tela de Leads, ao lado de Tabela e Quadro:
 *      semana ou mês, com o filtro de responsável e a busca da barra.
 *   2. A aba AGENDA da ficha do lead: o histórico de reuniões e contatos
 *      dele, e os botões para agendar.
 *   3. A janela do compromisso, que os dois abrem — reunião (tipo do hub,
 *      local, duração, dossiê) ou contato (canal).
 *
 * Horários são 'AAAA-MM-DDTHH:MM' no horário de Brasília, sem fuso — o
 * mesmo texto do banco. Nada aqui converte para UTC: `toISOString()`
 * mudaria o dia de um compromisso às 22h.
 *
 * Carregar DEPOIS do cadastros.js e ANTES do leads.js.
 */

const Agenda = (() => {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const ROTULO_STATUS = {
    agendada: 'Agendada', realizada: 'Realizada', remarcada: 'Remarcada',
    cancelada: 'Cancelada', nao_compareceu: 'Não compareceu'
  };
  const ROTULO_CANAL = { ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', outro: 'Contato' };
  const ROTULO_LOCAL = { online: 'Online', presencial: 'Presencial', externo: 'Externo' };
  const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
                 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  /* ----------------------------------------------------------
     Datas, sem fuso
     ---------------------------------------------------------- */

  const doisDigitos = (n) => String(n).padStart(2, '0');
  const diaIso = (d) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
  const hojeIso = () => diaIso(new Date());
  const somarDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  /** Segunda-feira da semana de `d`. */
  const inicioDaSemana = (d) => somarDias(d, -((d.getDay() + 6) % 7));
  const dataBr = (iso) => { const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
  const hora = (inicio) => String(inicio || '').slice(11, 16);

  /* ----------------------------------------------------------
     1. A visão Agenda
     ---------------------------------------------------------- */

  let escala = 'semana';
  try { if (localStorage.getItem('crm_agenda_escala') === 'mes') escala = 'mes'; } catch (e) { /* sem storage */ }
  let referencia = new Date();
  let itensNaTela = [];

  function periodo() {
    if (escala === 'semana') {
      const de = inicioDaSemana(referencia);
      return { de, ate: somarDias(de, 6) };
    }
    const primeiro = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
    const de = inicioDaSemana(primeiro);
    return { de, ate: somarDias(de, 41) };           // seis semanas cheias
  }

  function tituloDoPeriodo() {
    if (escala === 'mes') {
      const mes = MESES[referencia.getMonth()];
      return `${mes[0].toUpperCase()}${mes.slice(1)} de ${referencia.getFullYear()}`;
    }
    const { de, ate } = periodo();
    return `${dataBr(diaIso(de)).slice(0, 5)} a ${dataBr(diaIso(ate))}`;
  }

  async function carregar() {
    const grade = el('agenda-grade');
    if (!grade) return;
    el('agenda-periodo').textContent = tituloDoPeriodo();
    document.querySelectorAll('[data-escala]').forEach((b) => b.classList.toggle('active', b.dataset.escala === escala));
    grade.innerHTML = '<div class="coluna-vazia">Carregando…</div>';

    const { de, ate } = periodo();
    const p = new URLSearchParams({ de: diaIso(de), ate: diaIso(ate) });
    const f = (typeof Leads !== 'undefined' && Leads.filtros) ? Leads.filtros() : {};
    if (f.responsavel) p.set('responsavel', f.responsavel);
    if (f.busca) p.set('busca', f.busca);

    try {
      const r = await fetch(`/api/agenda?${p}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao carregar a agenda.');
      itensNaTela = d.itens || [];
      desenhar();
    } catch (e) {
      grade.innerHTML = `<div class="quadro-erro">Não foi possível carregar a agenda. ${esc(e.message)}</div>`;
    }
  }

  /** Uma linha curta: "09:00 Reunião · Diagnóstico". */
  function resumo(item) {
    const oQue = item.tipo === 'reuniao'
      ? `Reunião${item.tipo_reuniao_nome ? ` · ${item.tipo_reuniao_nome}` : ''}`
      : (ROTULO_CANAL[item.canal] || 'Contato');
    return `${hora(item.inicio)} ${oQue}`;
  }

  function cartaoDoItem(item, compacto) {
    const cx = item.responsavel && typeof Cadastros !== 'undefined' ? Cadastros.nomeDoUsuario(item.responsavel) : null;
    return `
      <button type="button" class="agenda-item st-${esc(item.status)} tp-${esc(item.tipo)}" data-item="${item.id}"
              title="${esc(`${resumo(item)} — ${item.lead_nome} (${ROTULO_STATUS[item.status] || item.status})`)}">
        <span class="agenda-item-quando">${esc(resumo(item))}</span>
        <span class="agenda-item-lead">${esc(item.lead_nome)}</span>
        ${compacto || !cx ? '' : `<span class="agenda-item-cx">CX: ${esc(cx)}</span>`}
      </button>`;
  }

  function desenhar() {
    const grade = el('agenda-grade');
    const { de, ate } = periodo();
    const hoje = hojeIso();

    const porDia = new Map();
    for (const item of itensNaTela) {
      const dia = item.inicio.slice(0, 10);
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push(item);
    }

    const dias = [];
    for (let d = new Date(de); d <= ate; d = somarDias(d, 1)) dias.push(new Date(d));

    if (escala === 'semana') {
      grade.className = 'agenda-grade semana';
      grade.innerHTML = dias.map((d, i) => {
        const iso = diaIso(d);
        const itens = porDia.get(iso) || [];
        return `
          <section class="agenda-dia${iso === hoje ? ' hoje' : ''}" data-dia="${iso}">
            <header class="agenda-dia-topo">${DIAS[i]} <strong>${dataBr(iso).slice(0, 5)}</strong></header>
            <div class="agenda-dia-lista">
              ${itens.length ? itens.map((x) => cartaoDoItem(x, false)).join('') : '<span class="agenda-dia-vazio">—</span>'}
            </div>
          </section>`;
      }).join('');
      return;
    }

    // Mês: seis semanas, até 3 compromissos por dia e "+N" no resto.
    grade.className = 'agenda-grade mes';
    const mesAtual = referencia.getMonth();
    grade.innerHTML = DIAS.map((n) => `<div class="agenda-mes-cabeca">${n}</div>`).join('')
      + dias.map((d) => {
        const iso = diaIso(d);
        const itens = porDia.get(iso) || [];
        const fora = d.getMonth() !== mesAtual;
        return `
          <section class="agenda-dia${iso === hoje ? ' hoje' : ''}${fora ? ' fora' : ''}" data-dia="${iso}">
            <header class="agenda-dia-topo">${d.getDate()}</header>
            <div class="agenda-dia-lista">
              ${itens.slice(0, 3).map((x) => cartaoDoItem(x, true)).join('')}
              ${itens.length > 3 ? `<button type="button" class="agenda-mais" data-ver-semana="${iso}">+${itens.length - 3}</button>` : ''}
            </div>
          </section>`;
      }).join('');
  }

  function mover(passo) {
    referencia = escala === 'semana'
      ? somarDias(referencia, 7 * passo)
      : new Date(referencia.getFullYear(), referencia.getMonth() + passo, 1);
    carregar();
  }

  /* ----------------------------------------------------------
     Tipos de reunião (hub, Time Vendas) — uma vez por sessão
     ---------------------------------------------------------- */

  let tipos = null;
  let avisoTipos = null;

  async function carregarTipos() {
    if (tipos) return tipos;
    try {
      const r = await fetch('/api/agenda?tipos=1');
      const d = await r.json();
      tipos = d.tipos || [];
      avisoTipos = d.aviso || null;
    } catch (e) {
      tipos = [];
      avisoTipos = 'Não foi possível ler os tipos de reunião no hub.';
    }
    const aviso = el('agenda-aviso');
    if (aviso) {
      aviso.textContent = avisoTipos || '';
      aviso.classList.toggle('hidden', !avisoTipos);
    }
    return tipos;
  }

  /* ----------------------------------------------------------
     3. A janela do compromisso
     ---------------------------------------------------------- */

  let emEdicao = null;       // o compromisso aberto (null = novo)
  let leadDaJanela = null;   // { id, nome, documento, responsavel }
  let tipoDaJanela = 'reuniao';
  let leadFixo = false;      // veio da ficha ou é edição: não se troca
  let resultados = [];       // a última busca de leads, na ordem da lista

  function aplicarTipo(tipo) {
    tipoDaJanela = tipo;
    const cartao = el('modal-agenda')?.querySelector('.modal-card');
    cartao?.classList.toggle('modo-reuniao', tipo === 'reuniao');
    cartao?.classList.toggle('modo-contato', tipo === 'contato');
    document.querySelectorAll('[data-agenda-tipo]').forEach((b) => b.classList.toggle('active', b.dataset.agendaTipo === tipo));
    if (tipo === 'reuniao') mostrarDossie();
  }

  function rotuloDoLocal() {
    const r = el('agenda-local-rotulo');
    const local = el('agenda-local-tipo').value;
    r.textContent = local === 'online' ? 'Link da sala' : (local === 'presencial' ? 'Sala / observação' : 'Onde');
  }

  function montarResponsaveis(atual) {
    const select = el('agenda-responsavel');
    const lista = typeof Cadastros !== 'undefined' ? Cadastros.usuarios() : [];
    const valor = String(atual || '').toLowerCase();
    let html = valor ? '' : '<option value="">Sem responsável</option>';
    if (valor && !lista.some((u) => u.email === valor)) html += `<option value="${esc(valor)}">${esc(valor)}</option>`;
    html += lista.map((u) => `<option value="${esc(u.email)}">${esc(u.nome || u.email)}</option>`).join('');
    select.innerHTML = html;
    select.value = valor;
  }

  function montarTipos(atualId, atualNome) {
    const select = el('agenda-tipo-reuniao');
    let html = '<option value="">—</option>';
    // Tipo que não está mais no Time Vendas continua aparecendo pelo nome
    // da época — trocar sozinho seria reescrever o histórico.
    if (atualId && !(tipos || []).some((t) => t.erp_id === atualId)) {
      html += `<option value="${esc(atualId)}">${esc(atualNome || 'tipo antigo')}</option>`;
    }
    html += (tipos || []).map((t) => `<option value="${esc(t.erp_id)}">${esc(t.nome)}</option>`).join('');
    select.innerHTML = html;
    select.value = atualId || '';
  }

  /** O roteiro do tipo escolhido (2.34.0), para estudar junto com o dossiê. */
  function mostrarRoteiro() {
    if (typeof Roteiros === 'undefined') return;
    const select = el('agenda-tipo-reuniao');
    Roteiros.mostrarNaReuniao(select.value || null, select.selectedOptions[0]?.textContent || null);
  }

  function mostrarLead() {
    const temLead = !!leadDaJanela;
    el('agenda-lead-bloco').classList.toggle('hidden', temLead);
    el('agenda-lead-nome').classList.toggle('hidden', !temLead);
    el('agenda-lead-escolhido').textContent = temLead ? `Lead: ${leadDaJanela.nome}` : '';
    el('btn-agenda-lead-trocar').classList.toggle('hidden', leadFixo);
    el('agenda-lead-resultados').classList.add('hidden');
  }

  function escolherLead(lead) {
    leadDaJanela = lead;
    // O responsável acompanha o lead escolhido, se ninguém mexeu nele.
    if (lead?.responsavel && !emEdicao) montarResponsaveis(lead.responsavel);
    mostrarLead();
    if (tipoDaJanela === 'reuniao') mostrarDossie();
  }

  async function mostrarDossie() {
    const estado = el('agenda-dossie-estado');
    const botao = el('btn-agenda-dossie');
    if (!estado || !botao) return;
    botao.classList.add('hidden');

    const doc = String(leadDaJanela?.documento || '').replace(/\D/g, '');
    if (!leadDaJanela) { estado.textContent = 'Escolha o lead para ver o dossiê.'; return; }
    if (doc.length !== 14) { estado.textContent = 'Pessoa física — o dossiê exige CNPJ.'; return; }

    estado.textContent = 'Consultando…';
    try {
      const r = await fetch(`/api/dossier?cnpj=${doc}`);
      const d = await r.json();
      if (d.existe) {
        const quando = d.dossie?.gerado_em ? `, gerado em ${dataBr(d.dossie.gerado_em)}` : '';
        estado.textContent = `Versão ${d.dossie?.versao}${quando}. Estude antes da reunião.`;
        botao.textContent = 'Abrir o dossiê';
      } else {
        estado.textContent = 'Este lead ainda não tem dossiê.';
        botao.textContent = 'Gerar o dossiê';
      }
      botao.classList.remove('hidden');
    } catch (e) {
      estado.textContent = 'Não foi possível consultar o dossiê.';
    }
  }

  async function abrirJanela({ item = null, lead = null, tipo = 'reuniao', dia = null } = {}) {
    await carregarTipos();
    emEdicao = item;
    leadDaJanela = item
      ? { id: item.lead_id, nome: item.lead_nome, documento: item.lead_documento, responsavel: item.lead_responsavel }
      : lead;
    leadFixo = !!leadDaJanela;
    resultados = [];
    el('agenda-lead-resultados').innerHTML = '';

    const eu = (typeof Auth !== 'undefined' && Auth.usuario?.email) || '';
    const base = item || {
      tipo, inicio: `${dia || hojeIso()}T09:00`, duracao_min: 60, local_tipo: 'online',
      canal: 'ligacao', status: 'agendada', responsavel: leadDaJanela?.responsavel || eu.toLowerCase()
    };

    el('agenda-titulo').textContent = item
      ? `${item.tipo === 'reuniao' ? 'Reunião' : 'Contato'} — ${ROTULO_STATUS[item.status] || item.status}`
      : 'Agendar';
    el('agenda-lead-busca').value = '';
    el('agenda-data').value = base.inicio.slice(0, 10);
    el('agenda-hora').value = hora(base.inicio);
    el('agenda-duracao').value = String(base.duracao_min || 60);
    el('agenda-local-tipo').value = base.local_tipo || 'online';
    el('agenda-local-texto').value = base.local_texto || '';
    el('agenda-canal').value = base.canal || 'ligacao';
    el('agenda-status').value = base.status || 'agendada';
    el('agenda-participantes').value = base.participantes || '';
    el('agenda-pauta').value = base.pauta || '';
    montarResponsaveis(base.responsavel);
    montarTipos(base.tipo_reuniao_erp_id, base.tipo_reuniao_nome);
    mostrarRoteiro();
    rotuloDoLocal();

    // Na criação o status é sempre "agendada"; muda depois, ao acontecer.
    el('agenda-status-bloco').classList.toggle('hidden', !item);
    el('btn-agenda-excluir').classList.toggle('hidden', !item);
    el('btn-agenda-remarcar').classList.toggle('hidden', !item || item.status !== 'agendada');
    el('agenda-remarcar').classList.add('hidden');
    // O tipo não muda depois de criado: uma reunião que virou ligação é
    // outro compromisso.
    document.querySelectorAll('[data-agenda-tipo]').forEach((b) => { b.disabled = !!item; });

    mostrarLead();
    aplicarTipo(base.tipo);
    // Gravar e a transcrição (2.35.0): só na reunião que já existe.
    if (typeof Gravacao !== 'undefined') Gravacao.mostrarNaReuniao(item);
    el('modal-agenda').classList.remove('hidden');
  }

  function fecharJanela() {
    el('modal-agenda')?.classList.add('hidden');
    emEdicao = null;
  }

  function lerJanela() {
    const tipoId = el('agenda-tipo-reuniao').value || null;
    const tipoNome = tipoId ? el('agenda-tipo-reuniao').selectedOptions[0]?.textContent : null;
    return {
      tipo: tipoDaJanela,
      inicio: `${el('agenda-data').value}T${el('agenda-hora').value}`,
      duracao_min: Number(el('agenda-duracao').value),
      tipo_reuniao_erp_id: tipoId,
      tipo_reuniao_nome: tipoNome,
      local_tipo: el('agenda-local-tipo').value,
      local_texto: el('agenda-local-texto').value.trim() || null,
      canal: el('agenda-canal').value,
      responsavel: el('agenda-responsavel').value || null,
      status: emEdicao ? el('agenda-status').value : 'agendada',
      participantes: el('agenda-participantes').value.trim() || null,
      pauta: el('agenda-pauta').value.trim() || null
    };
  }

  /** Grava e redesenha tudo que mostra a agenda ou o próximo contato. */
  async function enviar(url, metodo, corpo) {
    try {
      const r = await fetch(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || 'Não foi possível salvar na agenda.'); return null; }
      const leadId = d.item?.lead_id || emEdicao?.lead_id || leadDaJanela?.id;
      fecharJanela();
      await depoisDeMudar(leadId);
      return d;
    } catch (e) {
      alert('Falha de conexão ao salvar na agenda.');
      return null;
    }
  }

  async function salvar() {
    if (!leadDaJanela) {
      // Digitou o nome exato de um resultado sem clicar: vale como escolha.
      const digitado = el('agenda-lead-busca').value.trim().toLowerCase();
      const exato = resultados.filter((l) => String(l.nome).trim().toLowerCase() === digitado);
      if (exato.length === 1) escolherLead(exato[0]);
    }
    if (!leadDaJanela) {
      alert('Escolha o lead: digite parte do nome e clique nele na lista.');
      el('agenda-lead-busca').focus();
      return;
    }
    const corpo = lerJanela();
    if (!el('agenda-data').value || !el('agenda-hora').value) { alert('Informe a data e a hora.'); return; }

    if (emEdicao) await enviar(`/api/agenda?id=${emEdicao.id}`, 'PUT', corpo);
    else await enviar('/api/agenda', 'POST', { ...corpo, lead_id: leadDaJanela.id });
  }

  async function remarcar() {
    const data = el('agenda-remarcar-data').value;
    const h = el('agenda-remarcar-hora').value;
    if (!data || !h) { alert('Informe a nova data e a hora.'); return; }
    await enviar(`/api/agenda?id=${emEdicao.id}`, 'PUT', { ...lerJanela(), status: 'agendada', remarcar_para: `${data}T${h}` });
  }

  async function excluir() {
    if (!emEdicao) return;
    if (!confirm('Excluir este compromisso? Use só para o que foi lançado por engano — o que não aconteceu é "Cancelada".')) return;
    await enviar(`/api/agenda?id=${emEdicao.id}`, 'DELETE');
  }

  /**
   * Depois de gravar: a visão Agenda, a aba da ficha e o "Próximo
   * contato" da ficha (que o servidor acabou de recalcular).
   */
  async function depoisDeMudar(leadId) {
    if (!el('view-agenda')?.classList.contains('hidden')) carregar();
    else if (typeof Leads !== 'undefined') Leads.recarregarVisao();

    if (!leadId || Number(leadNaFicha?.id) !== Number(leadId)) return;
    await carregarDoLead(leadId);
    try {
      const r = await fetch(`/api/leads?id=${leadId}`);
      const d = await r.json();
      const campo = el('lead-input-proximo-contato');
      if (r.ok && campo) {
        campo.value = String(d.lead?.data_proximo_contato || '').slice(0, 10);
        campo.dispatchEvent(new Event('change'));
      }
    } catch (e) { /* a ficha se corrige ao reabrir */ }
  }

  /**
   * A busca de lead, na janela aberta pela visão Agenda.
   *
   * Busca por nome, documento ou telefone (o mesmo da barra de Leads) e
   * mostra os resultados numa lista logo abaixo do campo; o lead é
   * escolhido clicando. Campo vazio mostra os mais recentes.
   */
  let esperaBusca = null;
  let buscaAtual = 0;
  function buscarLeads(termo) {
    clearTimeout(esperaBusca);
    const caixa = el('agenda-lead-resultados');
    esperaBusca = setTimeout(async () => {
      const minha = ++buscaAtual;
      const t = termo.trim();
      const p = new URLSearchParams({ porPagina: '10' });
      if (t) p.set('busca', t);
      try {
        const r = await fetch(`/api/leads?${p}`);
        const d = await r.json();
        if (minha !== buscaAtual) return;         // chegou uma busca mais nova
        resultados = d.leads || [];
        caixa.innerHTML = resultados.length
          ? resultados.map((l, i) => `
              <button type="button" class="agenda-lead-opcao" data-indice="${i}" role="option">
                <span>${esc(l.nome)}</span>
                <small>${esc(String(l.documento || '').replace(/\D/g, '') || l.telefone || '')}</small>
              </button>`).join('')
          : `<div class="agenda-lead-vazio">Nenhum lead encontrado${t ? ` para "${esc(t)}"` : ''}.</div>`;
        caixa.classList.remove('hidden');
      } catch (e) {
        caixa.innerHTML = '<div class="agenda-lead-vazio">Não foi possível buscar os leads.</div>';
        caixa.classList.remove('hidden');
      }
    }, 250);
  }

  /* ----------------------------------------------------------
     2. A aba Agenda da ficha
     ---------------------------------------------------------- */

  let leadNaFicha = null;

  async function carregarDoLead(leadId) {
    const lista = el('lead-agenda-lista');
    if (!lista) return;
    if (!leadId) {
      lista.innerHTML = '<div class="coluna-vazia">Salve o lead para agendar reuniões e contatos.</div>';
      return;
    }
    lista.innerHTML = '<div class="coluna-vazia">Carregando…</div>';
    try {
      const r = await fetch(`/api/agenda?lead_id=${leadId}`);
      const d = await r.json();
      const itens = d.itens || [];
      itensDaFicha = itens;
      lista.innerHTML = itens.length
        ? itens.map((x) => `
            <button type="button" class="agenda-linha st-${esc(x.status)}" data-item-ficha="${x.id}">
              <span class="agenda-linha-quando">${dataBr(x.inicio)} ${esc(hora(x.inicio))}</span>
              <span class="agenda-linha-oque">${esc(resumo(x).slice(6))}${x.tipo === 'reuniao' && x.local_tipo ? ` · ${esc(ROTULO_LOCAL[x.local_tipo])}` : ''}</span>
              <span class="agenda-linha-status">${esc(ROTULO_STATUS[x.status] || x.status)}</span>
            </button>`).join('')
        : '<div class="coluna-vazia">Nada agendado ainda.</div>';
    } catch (e) {
      lista.innerHTML = '<div class="coluna-vazia">Não foi possível carregar a agenda do lead.</div>';
    }
  }
  let itensDaFicha = [];

  function agendarDaFicha(tipo) {
    if (!leadNaFicha?.id) { alert('Salve o lead antes de agendar.'); return; }
    abrirJanela({ lead: leadNaFicha, tipo });
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    el('btn-agenda-anterior')?.addEventListener('click', () => mover(-1));
    el('btn-agenda-proximo')?.addEventListener('click', () => mover(1));
    el('btn-agenda-hoje')?.addEventListener('click', () => { referencia = new Date(); carregar(); });
    document.querySelectorAll('[data-escala]').forEach((b) => b.addEventListener('click', () => {
      escala = b.dataset.escala;
      try { localStorage.setItem('crm_agenda_escala', escala); } catch (e) { /* sem storage */ }
      carregar();
    }));
    el('btn-agenda-novo')?.addEventListener('click', () => abrirJanela({}));

    el('agenda-grade')?.addEventListener('click', (ev) => {
      const item = ev.target.closest('[data-item]');
      if (item) {
        const achado = itensNaTela.find((x) => String(x.id) === item.dataset.item);
        if (achado) abrirJanela({ item: achado });
        return;
      }
      const mais = ev.target.closest('[data-ver-semana]');
      if (mais) {
        const [a, m, d] = mais.dataset.verSemana.split('-').map(Number);
        referencia = new Date(a, m - 1, d);
        escala = 'semana';
        carregar();
        return;
      }
      // Clique no espaço vazio de um dia: agenda naquele dia.
      const dia = ev.target.closest('[data-dia]');
      if (dia && !ev.target.closest('button')) abrirJanela({ dia: dia.dataset.dia });
    });

    document.querySelectorAll('[data-agenda-tipo]').forEach((b) =>
      b.addEventListener('click', () => aplicarTipo(b.dataset.agendaTipo)));
    el('agenda-local-tipo')?.addEventListener('change', rotuloDoLocal);
    el('agenda-tipo-reuniao')?.addEventListener('change', mostrarRoteiro);
    const campoLead = el('agenda-lead-busca');
    campoLead?.addEventListener('input', (ev) => buscarLeads(ev.target.value));
    // Entrar no campo já mostra a lista (vazio: os mais recentes).
    campoLead?.addEventListener('focus', (ev) => buscarLeads(ev.target.value));
    // Enter escolhe o primeiro da lista; Esc fecha só a lista.
    campoLead?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && resultados.length) { ev.preventDefault(); escolherLead(resultados[0]); }
      if (ev.key === 'Escape' && !el('agenda-lead-resultados').classList.contains('hidden')) {
        ev.stopPropagation();
        el('agenda-lead-resultados').classList.add('hidden');
      }
    });
    // `mousedown`, não `click`: o clique chega depois de o campo perder o
    // foco, e a lista não pode sumir antes de o clique contar.
    el('agenda-lead-resultados')?.addEventListener('mousedown', (ev) => {
      const opcao = ev.target.closest('[data-indice]');
      if (!opcao) return;
      ev.preventDefault();
      escolherLead(resultados[Number(opcao.dataset.indice)]);
    });
    el('btn-agenda-lead-trocar')?.addEventListener('click', () => {
      leadDaJanela = null;
      mostrarLead();
      el('agenda-lead-busca').value = '';
      el('agenda-lead-busca').focus();
    });

    el('btn-agenda-salvar')?.addEventListener('click', salvar);
    el('btn-agenda-cancelar')?.addEventListener('click', fecharJanela);
    el('btn-agenda-fechar')?.addEventListener('click', fecharJanela);
    el('btn-agenda-excluir')?.addEventListener('click', excluir);
    el('btn-agenda-remarcar')?.addEventListener('click', () => {
      el('agenda-remarcar').classList.remove('hidden');
      el('agenda-remarcar-data').value = el('agenda-data').value;
      el('agenda-remarcar-hora').value = el('agenda-hora').value;
      el('agenda-remarcar-data').focus();
    });
    el('btn-agenda-remarcar-confirmar')?.addEventListener('click', remarcar);
    el('btn-agenda-dossie')?.addEventListener('click', () => {
      if (typeof Dossie !== 'undefined' && leadDaJanela) Dossie.abrir(leadDaJanela);
    });

    document.addEventListener('keydown', (ev) => {
      // Esc fecha a reunião só se nada estiver aberto por cima dela.
      const porCima = document.querySelector('.dossie-modal.aberto, #dossie-modal.aberto')
        || !el('modal-gravacao')?.classList.contains('hidden')
        || !el('modal-roteiro')?.classList.contains('hidden');
      if (ev.key === 'Escape' && !el('modal-agenda')?.classList.contains('hidden') && !porCima) fecharJanela();
    });

    // A ficha do lead: a aba Agenda acompanha o lead aberto.
    el('btn-lead-agendar-reuniao')?.addEventListener('click', () => agendarDaFicha('reuniao'));
    el('btn-lead-agendar-contato')?.addEventListener('click', () => agendarDaFicha('contato'));
    el('lead-agenda-lista')?.addEventListener('click', (ev) => {
      const linha = ev.target.closest('[data-item-ficha]');
      const achado = linha && itensDaFicha.find((x) => String(x.id) === linha.dataset.itemFicha);
      if (achado) abrirJanela({ item: achado });
    });
    document.addEventListener('crm:lead-ficha', (ev) => {
      leadNaFicha = ev.detail?.lead || null;
      carregarDoLead(leadNaFicha?.id);
    });
    el('btn-incluir-lead')?.addEventListener('click', () => { leadNaFicha = null; carregarDoLead(null); });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
  // Os tipos vêm do hub: só depois do login, e uma vez.
  document.addEventListener('crm:autenticado', () => carregarTipos(), { once: true });

  return { carregar, abrirJanela };
})();
