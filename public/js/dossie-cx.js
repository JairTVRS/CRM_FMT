/**
 * dossie-cx.js — Dossiê de Experiência (Lote L).
 *
 * O irmão de pós-venda do dossie.js, e as diferenças de comportamento
 * vêm todas de o sujeito ser outro:
 *
 * 1. Gerar SEMPRE gera. No Executivo, dossiê existente é aberto em vez de
 *    refeito, porque os fatos externos de um prospect mudam pouco. Aqui a
 *    conta muda toda semana — pessoa nova mapeada, etapa que avançou — e
 *    pedir o dossiê é pedir a leitura de hoje. Por isso "Abrir a última
 *    versão" e "Gerar dossiê" são dois botões distintos, e não um só que
 *    decide sozinho o que fazer.
 *
 * 2. Não há tela inicial no modal. Ela é a própria aba da ficha, que já
 *    mostra o que entra no documento antes de qualquer clique.
 *
 * 3. A chave é o CLIENTE, não o CNPJ: um cliente convertido terá os dois
 *    documentos, e chavear ambos por CNPJ misturaria as contagens.
 *
 * Carregar DEPOIS do clientes.js e do stakeholders.js.
 */

const DossieCx = (() => {
  let clienteId = null;
  let clienteNome = null;
  let versoes = [];
  let versaoAtual = null;
  let htmlAtual = null;
  let gerando = false;

  const ETAPAS = [
    { em: 0,   texto: 'Reunindo o cadastro, a jornada e o mapa de pessoas…' },
    { em: 6,   texto: 'Produzindo a leitura da relação…' },
    { em: 22,  texto: 'Escrevendo riscos, oportunidades e perguntas…' },
    { em: 45,  texto: 'Montando o documento…' },
    { em: 80,  texto: 'Ainda trabalhando. Pode deixar a janela aberta.' },
    { em: 130, texto: 'Está demorando mais que o normal, mas segue em andamento.' }
  ];

  /* Mesma curva do visualizador executivo, e pela mesma razão: não há
     percentual real: o anel avança com o tempo, desacelera e para em 93%.
     Os 7% finais só fecham quando a resposta chega. */
  const TAU_SEGUNDOS = 28;
  const TETO_PROGRESSO = 0.93;

  let timers = [];
  let cronometro = null;
  let inicioEm = 0;

  /* ----------------------------------------------------------
     Utilidades
     ---------------------------------------------------------- */

  const el = (id) => document.getElementById(id);

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function dataBr(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
  }

  /** Meses inteiros desde AAAA-MM-DD. Espelha o `mesesDesde` do servidor. */
  function mesesDesde(dataIso) {
    const m = String(dataIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;

    const hoje = new Date();
    const inicio = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(inicio.getTime()) || inicio > hoje) return null;

    let meses = (hoje.getFullYear() - inicio.getFullYear()) * 12
      + (hoje.getMonth() - inicio.getMonth());
    if (hoje.getDate() < inicio.getDate()) meses -= 1;

    return Math.max(0, meses);
  }

  function mostrar(qual) {
    ['dossie-cx-progresso', 'dossie-cx-visualizacao', 'dossie-cx-erro']
      .forEach((id) => { const n = el(id); if (n) n.style.display = id === qual ? '' : 'none'; });
  }

  function limparTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (cronometro) { clearInterval(cronometro); cronometro = null; }
  }

  function desenharAnel(fracao) {
    const circulo = el('dossie-cx-anel');
    if (!circulo) return;
    const perimetro = 2 * Math.PI * 34;   // r=34 no SVG
    circulo.style.strokeDasharray = `${perimetro}`;
    circulo.style.strokeDashoffset = `${perimetro * (1 - fracao)}`;
  }

  function formatarDuracao(segundos) {
    const m = Math.floor(segundos / 60);
    const s = Math.floor(segundos % 60);
    return m > 0 ? `${m}min ${String(s).padStart(2, '0')}s` : `${s}s`;
  }

  function iniciarCronometro() {
    inicioEm = Date.now();
    desenharAnel(0);

    cronometro = setInterval(() => {
      const decorrido = (Date.now() - inicioEm) / 1000;
      desenharAnel(Math.min(TETO_PROGRESSO, 1 - Math.exp(-decorrido / TAU_SEGUNDOS)));

      const tempo = el('dossie-cx-tempo');
      if (tempo) tempo.textContent = formatarDuracao(decorrido);
    }, 250);
  }

  function concluirCronometro() {
    if (cronometro) { clearInterval(cronometro); cronometro = null; }
    desenharAnel(1);
  }

  /* ==========================================================================
     A ABA DA FICHA
     ========================================================================== */

  /**
   * O resumo do que entra no documento.
   *
   * Sai da tela e da lista de pessoas já carregada — as mesmas fontes que
   * a API vai ler. Prometer aqui um conteúdo diferente do que o servidor
   * monta seria pior que não prometer nada.
   */
  async function montarResumo() {
    const caixa = el('dossie-cx-resumo');
    if (!caixa) return;

    const ficha = typeof Clientes !== 'undefined' ? Clientes.resumoDaFicha() : {};
    const nucleos = (typeof Clientes !== 'undefined' ? Clientes.nucleosDaFicha() : []) || [];

    let pessoas = [];
    try {
      pessoas = await Stakeholders.garantirCarregado(clienteId);
    } catch (e) {
      pessoas = [];
    }

    const meses = mesesDesde(ficha.inicio);
    const patrocinadores = pessoas.filter((p) => p.patrocinador).map((p) => p.nome);

    const comPessoa = new Set();
    pessoas.forEach((p) => (p.nucleoIds || []).forEach((id) => comPessoa.add(Number(id))));
    const semNinguem = nucleos.filter((n) => !comPessoa.has(n.id)).map((n) => n.nome);

    const naoAvaliadas = pessoas.filter(
      (p) => p.influencia === 'desconhecida' && p.postura === 'desconhecida'
    ).length;

    const item = (rotulo, valor, alerta) =>
      `<li${alerta ? ' class="resumo-alerta"' : ''}><strong>${rotulo}:</strong> ${valor}</li>`;

    const vazio = '<em>não informado</em>';

    caixa.innerHTML = [
      item('Etapa da jornada', ficha.etapa ? esc(ficha.etapa) : vazio),

      item('Tempo de relação', meses == null
        ? '<em>sem data de início na ficha</em>'
        : `${meses} ${meses === 1 ? 'mês' : 'meses'}`),

      item('Núcleos atendidos', nucleos.length
        ? nucleos.map((n) => esc(n.nome)).join(', ')
        : '<em>nenhum marcado na Ficha</em>'),

      item('Pessoas mapeadas', pessoas.length || '<em>nenhuma</em>'),

      item('Patrocinador da conta', patrocinadores.length
        ? patrocinadores.map(esc).join(', ')
        : '<em>nenhum indicado</em>'),

      // As duas lacunas que o documento vai apontar. Mostrá-las ANTES da
      // geração dá a chance de preencher em vez de descobrir no PDF.
      semNinguem.length
        ? item('Núcleos sem ninguém mapeado', semNinguem.map(esc).join(', '), true)
        : '',

      naoAvaliadas
        ? item('Pessoas ainda não avaliadas', `${naoAvaliadas} — influência e postura em branco`, true)
        : '',

      `<li class="resumo-nota">Reuniões, indicadores, saúde da carteira e NPS ainda não
        chegam ao CRM. O documento declara essa ausência em seção própria, para que
        o silêncio não seja lido como "está tudo bem".</li>`
    ].join('');
  }

  function renderizarVersoes() {
    const caixa = el('dossie-cx-versoes');
    if (!caixa) return;

    if (versoes.length === 0) {
      caixa.innerHTML = '<div class="coluna-vazia">Nenhuma versão gerada ainda.</div>';
    } else {
      caixa.innerHTML = versoes.map((v) => `
        <button type="button" class="dossie-cx-versao" data-versao="${v.versao}">
          <strong>Versão ${v.versao}</strong>
          <span>${dataBr(v.gerado_em)} · ${esc(v.gerado_por)} · ${esc(v.provider)}</span>
        </button>`).join('');
    }

    el('btn-dossie-cx-abrir')?.classList.toggle('hidden', versoes.length === 0);

    const gerar = el('btn-dossie-cx-gerar');
    if (gerar) gerar.textContent = versoes.length ? 'Gerar nova versão' : 'Gerar dossiê';
  }

  async function carregarVersoes() {
    try {
      const r = await fetch(`/api/dossie-cx?cliente_id=${clienteId}`);
      const d = await r.json();
      versoes = r.ok ? (d.versoes || []) : [];
    } catch (e) {
      versoes = [];
    }
    renderizarVersoes();
  }

  async function abrirAba() {
    const semCliente = !clienteId;

    el('dossie-cx-sem-cliente')?.classList.toggle('hidden', !semCliente);
    el('dossie-cx-painel')?.classList.toggle('hidden', semCliente);
    if (semCliente) return;

    await Promise.all([montarResumo(), carregarVersoes()]);
  }

  /* ==========================================================================
     O MODAL
     ========================================================================== */

  /**
   * O nome digitado na ficha vem primeiro: se a razão social foi
   * corrigida e ainda não salva, é ela que o usuário está vendo.
   */
  function nomeDoCliente() {
    const naTela = typeof Clientes !== 'undefined' ? Clientes.resumoDaFicha().nome : null;
    return naTela || clienteNome || null;
  }

  function abrirModal() {
    el('dossie-cx-modal')?.classList.add('aberto');
    document.body.style.overflow = 'hidden';

    const nome = nomeDoCliente();
    el('dossie-cx-titulo').textContent = nome
      ? `Dossiê de Experiência — ${nome}`
      : 'Dossiê de Experiência';
  }

  function fecharModal() {
    limparTimers();
    el('dossie-cx-modal')?.classList.remove('aberto');
    document.body.style.overflow = '';
    const frame = el('dossie-cx-frame');
    if (frame) frame.srcdoc = '';
  }

  function erro(titulo, mensagem, codigo) {
    mostrar('dossie-cx-erro');
    el('dossie-cx-erro-titulo').textContent = titulo;
    el('dossie-cx-erro-msg').textContent = mensagem;
    el('dossie-cx-erro-codigo').textContent = codigo ? `Código: ${codigo}` : '';
  }

  function exibir(html) {
    mostrar('dossie-cx-visualizacao');
    // srcdoc, não a URL: o endpoint exige token e navegação de iframe não
    // passa pelo auth.js. Isola também o CSS do documento do CSS do CRM.
    el('dossie-cx-frame').srcdoc = html;
    el('dossie-cx-selo').textContent = versaoAtual ? `Versão ${versaoAtual}` : '';
    montarHistorico();
  }

  function montarHistorico() {
    const select = el('dossie-cx-historico');
    if (!select) return;

    select.innerHTML = versoes.map((v) =>
      `<option value="${v.versao}"${v.versao === versaoAtual ? ' selected' : ''}>
        Versão ${v.versao} — ${dataBr(v.gerado_em)} — ${esc(v.gerado_por)}
      </option>`).join('');

    select.style.display = versoes.length > 1 ? '' : 'none';
  }

  async function carregarHtml(versao) {
    const params = new URLSearchParams({ cliente_id: clienteId, html: 'true' });
    if (versao) params.set('versao', versao);

    const r = await fetch(`/api/dossie-cx?${params}`);
    if (!r.ok) {
      let mensagem = 'Não foi possível carregar o documento.';
      try { mensagem = (await r.json()).error || mensagem; } catch (e) { /* não era JSON */ }
      throw new Error(mensagem);
    }
    return r.text();
  }

  /** Abre uma versão já gravada. Não gera nada. */
  async function abrirVersao(versao) {
    if (!clienteId) return;

    abrirModal();
    mostrar('dossie-cx-progresso');
    el('dossie-cx-etapa').textContent = 'Abrindo o documento…';

    try {
      if (versoes.length === 0) await carregarVersoes();
      versaoAtual = Number(versao) || versoes[0]?.versao || null;
      htmlAtual = await carregarHtml(versaoAtual);
      exibir(htmlAtual);
    } catch (e) {
      erro('Falha ao abrir', e.message);
    }
  }

  async function gerar() {
    if (gerando || !clienteId) return;
    gerando = true;
    limparTimers();

    abrirModal();
    mostrar('dossie-cx-progresso');
    el('dossie-cx-etapa').textContent = ETAPAS[0].texto;
    el('dossie-cx-avisos').style.display = 'none';
    iniciarCronometro();

    ETAPAS.slice(1).forEach((etapa) => {
      timers.push(setTimeout(() => {
        el('dossie-cx-etapa').textContent = etapa.texto;
      }, etapa.em * 1000));
    });

    const provider = (window.CONFIG_IA && window.CONFIG_IA.provider) || 'deepseek';

    try {
      const r = await fetch(`/api/dossie-cx?cliente_id=${clienteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider })
      });

      const d = await r.json();
      concluirCronometro();
      limparTimers();

      if (!r.ok) {
        // A causa real vai junto: `details` do servidor foi exatamente o
        // que o front descartava quando a proposta quebrou em produção.
        const detalhe = d.seccoesVazias?.length
          ? ` Seções vazias: ${d.seccoesVazias.join(', ')}.`
          : (d.details ? ` (${d.details})` : '');

        return erro('Não foi possível gerar', `${d.error || 'Erro desconhecido.'}${detalhe}`, d.code);
      }

      versaoAtual = d.versao;
      await carregarVersoes();
      htmlAtual = await carregarHtml(versaoAtual);
      exibir(htmlAtual);

      if (d.avisos?.length) {
        const avisos = el('dossie-cx-avisos');
        avisos.innerHTML = d.avisos.map((a) => `<li>${esc(a)}</li>`).join('');
        avisos.style.display = '';
      }

      // A aba atrás do modal fica desatualizada se não for redesenhada.
      renderizarVersoes();

    } catch (e) {
      limparTimers();
      erro('Falha na geração', e.message);
    } finally {
      gerando = false;
    }
  }

  /* ----------------------------------------------------------
     Baixar e imprimir
     ---------------------------------------------------------- */

  function montarNomeArquivo() {
    const base = String(nomeDoCliente() || 'Cliente')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')      // tira acentos
      .replace(/\b(LTDA|ME|EPP|EIRELI|S\/?A|SA)\b\.?/gi, '') // tipos societários
      .replace(/[^A-Za-z0-9\s-]/g, ' ')
      .trim().split(/\s+/).slice(0, 4).join('-') || 'Cliente';

    const d = new Date();
    const anoMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    return `Dossie-Experiencia_${base}_${anoMes}_v${versaoAtual || 1}.html`;
  }

  function baixar() {
    if (!htmlAtual) return;
    // Blob, não link para a URL: o endpoint exige token e um link direto
    // responderia 401.
    const blob = new Blob([htmlAtual], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = montarNomeArquivo();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function imprimir() {
    const frame = el('dossie-cx-frame');
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    el('btn-dossie-cx-gerar')?.addEventListener('click', () => {
      if (versoes.length && !confirm(
        'Gerar uma nova versão do dossiê?\n\nA versão atual continua consultável no histórico — gerar nunca sobrescreve.'
      )) return;
      gerar();
    });

    el('btn-dossie-cx-abrir')?.addEventListener('click', () => abrirVersao(versoes[0]?.versao));

    el('dossie-cx-versoes')?.addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-versao]');
      if (botao) abrirVersao(Number(botao.dataset.versao));
    });

    el('btn-dossie-cx-fechar')?.addEventListener('click', fecharModal);
    el('dossie-cx-fundo')?.addEventListener('click', fecharModal);
    el('btn-dossie-cx-voltar')?.addEventListener('click', fecharModal);
    el('btn-dossie-cx-baixar')?.addEventListener('click', baixar);
    el('btn-dossie-cx-imprimir')?.addEventListener('click', imprimir);

    el('btn-dossie-cx-nova')?.addEventListener('click', () => {
      if (confirm('Gerar uma nova versão? A atual continua disponível no histórico.')) gerar();
    });

    el('dossie-cx-historico')?.addEventListener('change', async (ev) => {
      try {
        versaoAtual = Number(ev.target.value);
        htmlAtual = await carregarHtml(versaoAtual);
        exibir(htmlAtual);
      } catch (e) {
        erro('Falha ao abrir', e.message);
      }
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && el('dossie-cx-modal')?.classList.contains('aberto')) fecharModal();
    });

    document.addEventListener('crm:cliente-ficha', (ev) => {
      clienteId = ev.detail?.id || null;
      clienteNome = ev.detail?.nome || null;
      versoes = [];
      versaoAtual = null;
      htmlAtual = null;
    });

    document.addEventListener('crm:cliente-aba', (ev) => {
      if (ev.detail?.aba === 'cli-tab-dossie') abrirAba();
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { abrirVersao, gerar };
})();
