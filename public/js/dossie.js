/**
 * dossie.js — Modal do Dossiê Executivo ("Gerar Inteligência").
 *
 * Carregar DEPOIS do auth.js (que intercepta o fetch e injeta o token).
 *
 * Três coisas que definem o desenho:
 *
 * 1. O documento NUNCA é aberto por URL. O endpoint exige token, e
 *    navegação de aba não passa pelo auth.js. Buscamos o HTML por
 *    fetch autenticado e injetamos num iframe via srcdoc.
 *
 * 2. Clicar não gera necessariamente. Se já existe dossiê para o CNPJ,
 *    abrimos o existente — evita dois consultores produzindo versões
 *    divergentes do mesmo lead, e evita esperar um minuto à toa.
 *
 * 3. A geração leva de 30 a 60 segundos. Sem progresso visível o
 *    usuário conclui que travou, então há etapas nomeadas.
 */

const Dossie = (() => {
  let leadAtual = null;
  let cnpjAtual = null;
  let htmlAtual = null;
  let versaoAtual = null;
  let gerando = false;

  const ETAPAS = [
    { em: 0,   texto: 'Consultando dados cadastrais na Receita…' },
    { em: 8,   texto: 'Lendo o site institucional…' },
    { em: 16,  texto: 'Analisando presença digital…' },
    { em: 24,  texto: 'Produzindo a análise executiva…' },
    { em: 50,  texto: 'Escrevendo o painel executivo…' },
    { em: 75,  texto: 'Documentos mais completos levam um pouco mais…' },
    { em: 100, texto: 'Ainda trabalhando. Pode deixar a janela aberta.' },
    { em: 140, texto: 'Está demorando mais que o normal, mas segue em andamento.' }
  ];

  // Constante de tempo do anel de progresso. Com 28s, o anel chega a
  // ~66% em 30 segundos e ~88% em 60 — que é a faixa típica.
  const TAU_SEGUNDOS = 28;
  const TETO_PROGRESSO = 0.93;

  let timers = [];
  let cronometro = null;
  let inicioEm = 0;

  /* ----------------------------------------------------------
     Utilidades
     ---------------------------------------------------------- */

  const soDigitos = (v) => String(v || '').replace(/\D/g, '');

  function el(id) { return document.getElementById(id); }

  function mostrar(seletor) {
    ['dossie-inicio', 'dossie-progresso', 'dossie-visualizacao', 'dossie-erro']
      .forEach((id) => { const n = el(id); if (n) n.style.display = id === seletor ? '' : 'none'; });
  }

  function dataBr(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
  }

  function limparTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (cronometro) { clearInterval(cronometro); cronometro = null; }
  }

  /**
   * Desenha o anel de progresso.
   *
   * Não existe percentual real: não há como saber onde o modelo está.
   * O anel avança em função do tempo decorrido, rápido no início e
   * desacelerando — e para em 93%. Os 7% finais só fecham quando a
   * resposta chega de verdade. Barra que finge 100% antes da hora é
   * pior que barra nenhuma.
   */
  function desenharAnel(fracao) {
    const circulo = el('dossie-anel-progresso');
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

      // Curva assintótica: sobe rápido, desacelera, nunca fecha sozinha
      const fracao = Math.min(TETO_PROGRESSO, 1 - Math.exp(-decorrido / TAU_SEGUNDOS));
      desenharAnel(fracao);

      const tempo = el('dossie-tempo');
      if (tempo) tempo.textContent = formatarDuracao(decorrido);
    }, 250);
  }

  /** Fecha o anel ao receber a resposta — aí sim é 100% real. */
  function concluirCronometro() {
    if (cronometro) { clearInterval(cronometro); cronometro = null; }
    desenharAnel(1);
  }

  /* ----------------------------------------------------------
     Abertura
     ---------------------------------------------------------- */

  /**
   * Chamado pelo botão. Recebe os dados do lead em edição.
   */
  async function abrir(lead) {
    leadAtual = lead || {};
    cnpjAtual = soDigitos(leadAtual.documento);
    htmlAtual = null;
    versaoAtual = null;

    el('dossie-modal').classList.add('aberto');
    document.body.style.overflow = 'hidden';

    if (cnpjAtual.length !== 14) {
      return erro(
        'CNPJ obrigatório',
        'O dossiê usa os dados cadastrais da Receita Federal, então precisa de um CNPJ válido. ' +
        'Preencha o campo CNPJ/CPF na aba Dados Gerais e salve o lead antes de gerar.'
      );
    }

    mostrar('dossie-inicio');
    el('dossie-titulo').textContent = leadAtual.nome || 'Dossiê Executivo';

    // Já existe?
    try {
      const r = await fetch(`/api/dossier?cnpj=${cnpjAtual}`);
      const d = await r.json();

      if (r.ok && d.existe) {
        await carregarExistente(d.dossie);
        return;
      }
    } catch (e) {
      // Sem dossiê ou consulta falhou: segue para a tela de geração.
    }

    prepararTelaInicial(false);
  }

  function fechar() {
    limparTimers();
    el('dossie-modal').classList.remove('aberto');
    document.body.style.overflow = '';
    const frame = el('dossie-frame');
    if (frame) frame.srcdoc = '';
  }

  /* ----------------------------------------------------------
     Tela inicial
     ---------------------------------------------------------- */

  function prepararTelaInicial(temExistente) {
    mostrar('dossie-inicio');

    el('dossie-resumo-fontes').innerHTML = `
      <li><strong>CNPJ:</strong> ${leadAtual.documento || '—'}</li>
      <li><strong>Site:</strong> ${leadAtual.site || '<em>não informado</em>'}</li>
      <li><strong>Instagram:</strong> ${leadAtual.instagram || '<em>não informado</em>'}</li>`;

    el('btn-dossie-gerar').textContent = temExistente ? 'Gerar nova versão' : 'Gerar Inteligência';
  }

  /* ----------------------------------------------------------
     Dossiê existente
     ---------------------------------------------------------- */

  async function carregarExistente(registro) {
    versaoAtual = registro.versao;
    mostrar('dossie-progresso');
    el('dossie-etapa').textContent = 'Abrindo dossiê existente…';

    try {
      const r = await fetch(`/api/dossier?cnpj=${cnpjAtual}&html=true&versao=${registro.versao}`);
      if (!r.ok) throw new Error('Não foi possível carregar o documento.');

      htmlAtual = await r.text();
      exibir(htmlAtual);
      await carregarHistorico();

      el('dossie-aviso-existente').innerHTML =
        `Versão ${registro.versao}, gerada por <strong>${registro.gerado_por}</strong> em ${dataBr(registro.gerado_em)}.`;
      el('dossie-aviso-existente').style.display = '';

    } catch (e) {
      erro('Falha ao abrir', e.message);
    }
  }

  /* ----------------------------------------------------------
     Geração
     ---------------------------------------------------------- */

  async function gerar(forcar) {
    if (gerando) return;
    gerando = true;
    limparTimers();

    mostrar('dossie-progresso');
    el('dossie-etapa').textContent = ETAPAS[0].texto;
    iniciarCronometro();

    // Progresso por tempo decorrido. Não é barra de carregamento real —
    // seria mentira, já que não há como saber onde o modelo está.
    ETAPAS.slice(1).forEach((etapa) => {
      timers.push(setTimeout(() => {
        el('dossie-etapa').textContent = etapa.texto;
      }, etapa.em * 1000));
    });

    const corpo = {
      nome: leadAtual.nome,
      documento: cnpjAtual,
      site: leadAtual.site || null,
      provider: (window.CONFIG_IA && window.CONFIG_IA.provider) || 'deepseek',
      forcar: !!forcar,
      instagram: {
        perfil: leadAtual.instagram || null,
        bio: el('dossie-insta-bio').value.trim() || null,
        legendas: el('dossie-insta-legendas').value.trim() || null
      }
    };

    try {
      const r = await fetch('/api/dossier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
      });

      const d = await r.json();
      concluirCronometro();
      limparTimers();

      if (!r.ok) {
        return erro('Não foi possível gerar', d.error || 'Erro desconhecido.', d.code);
      }

      if (d.reaproveitado) {
        await carregarExistente(d.dossie);
        return;
      }

      versaoAtual = d.versao;

      const rh = await fetch(`/api/dossier?cnpj=${cnpjAtual}&html=true`);
      htmlAtual = await rh.text();
      exibir(htmlAtual);
      await carregarHistorico();

      if (d.avisos?.length) {
        el('dossie-avisos').innerHTML = d.avisos.map((a) => `<li>${a}</li>`).join('');
        el('dossie-avisos').style.display = '';
      }

    } catch (e) {
      limparTimers();
      erro('Falha na geração', e.message);
    } finally {
      gerando = false;
    }
  }

  /* ----------------------------------------------------------
     Exibição
     ---------------------------------------------------------- */

  function exibir(html) {
    mostrar('dossie-visualizacao');
    // srcdoc isola o CSS do dossiê do CSS do CRM — os dois têm
    // variáveis com nomes parecidos e conflitariam.
    el('dossie-frame').srcdoc = html;
    el('dossie-versao-atual').textContent = versaoAtual ? `Versão ${versaoAtual}` : '';
  }

  async function carregarHistorico() {
    try {
      const r = await fetch(`/api/dossier?cnpj=${cnpjAtual}&historico=true`);
      const d = await r.json();
      const select = el('dossie-historico');

      if (!d.versoes?.length) { select.style.display = 'none'; return; }

      select.innerHTML = d.versoes.map((v) =>
        `<option value="${v.versao}" ${v.versao === versaoAtual ? 'selected' : ''}>
          Versão ${v.versao} — ${dataBr(v.gerado_em)} — ${v.gerado_por}
        </option>`).join('');

      select.style.display = d.versoes.length > 1 ? '' : 'none';

    } catch (e) {
      // histórico é acessório
    }
  }

  async function trocarVersao(versao) {
    try {
      const r = await fetch(`/api/dossier?cnpj=${cnpjAtual}&html=true&versao=${versao}`);
      if (!r.ok) return;
      htmlAtual = await r.text();
      versaoAtual = Number(versao);
      exibir(htmlAtual);
    } catch (e) { /* silencioso */ }
  }

  /* ----------------------------------------------------------
     Ações
     ---------------------------------------------------------- */

  /**
   * Nome legivel: Dossie_Feheros-Shop_2026-08_v1.html
   *
   * A versao entra no fim porque baixar duas versoes no mesmo mes
   * geraria "(1)" no nome, e ai nao se sabe qual e qual.
   */
  function montarNomeArquivo(nomeEmpresa) {
    const base = String(nomeEmpresa || 'Empresa')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acentos
      .replace(/\b(LTDA|ME|EPP|EIRELI|S\/?A|SA)\b\.?/gi, '')  // tipos societarios
      .replace(/[^A-Za-z0-9\s-]/g, ' ')
      .trim().split(/\s+/).slice(0, 4).join('-') || 'Empresa';

    const d = new Date();
    const anoMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    return `Dossie_${base}_${anoMes}_v${versaoAtual || 1}.html`;
  }

  function baixar(nomeEmpresa) {
    if (!htmlAtual) return;
    // Blob, não link para a URL: o endpoint exige token e um link
    // direto responderia 401.
    const blob = new Blob([htmlAtual], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = montarNomeArquivo(nomeEmpresa || leadAtual?.nome);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Baixa o dossie de um lead sem abrir o modal — usado pelo clipe da tabela.
   */
  async function baixarDireto(cnpj, nomeEmpresa) {
    const limpo = soDigitos(cnpj);
    if (limpo.length !== 14) return;

    try {
      const meta = await fetch(`/api/dossier?cnpj=${limpo}`);
      const d = await meta.json();
      if (!d.existe) return;

      const r = await fetch(`/api/dossier?cnpj=${limpo}&html=true`);
      if (!r.ok) throw new Error('Falha ao baixar.');

      cnpjAtual = limpo;
      versaoAtual = d.dossie.versao;
      htmlAtual = await r.text();
      baixar(nomeEmpresa || d.dossie.razao_social);

    } catch (e) {
      alert('Não foi possível baixar o dossiê agora.');
    }
  }

  function imprimir() {
    const frame = el('dossie-frame');
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }

  function erro(titulo, mensagem, codigo) {
    mostrar('dossie-erro');
    el('dossie-erro-titulo').textContent = titulo;
    el('dossie-erro-msg').textContent = mensagem;
    el('dossie-erro-codigo').textContent = codigo ? `Código: ${codigo}` : '';
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    el('btn-dossie-fechar')?.addEventListener('click', fechar);
    el('dossie-fundo')?.addEventListener('click', fechar);
    el('btn-dossie-gerar')?.addEventListener('click', () => gerar(false));
    el('btn-dossie-nova-versao')?.addEventListener('click', () => {
      if (confirm('Gerar uma nova versão? A atual continua disponível no histórico.')) gerar(true);
    });
    el('btn-dossie-baixar')?.addEventListener('click', () => baixar());
    el('btn-dossie-imprimir')?.addEventListener('click', imprimir);
    el('btn-dossie-tentar')?.addEventListener('click', () => prepararTelaInicial(false));
    el('dossie-historico')?.addEventListener('change', (ev) => trocarVersao(ev.target.value));

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && el('dossie-modal')?.classList.contains('aberto')) fechar();
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { abrir, fechar, baixarDireto };
})();

/**
 * Chamado pelo botão "Gerar Inteligência" na aba de IA do modal de lead.
 * Os IDs abaixo são os do index.html atual — se a ficha do lead mudar,
 * este é o único ponto a ajustar.
 */
function gerarInteligencia() {
  const texto = (id) => {
    const n = document.getElementById(id);
    if (!n) return null;
    const v = (n.value ?? n.textContent ?? '').trim();
    return v && v !== 'Não identificado' && v !== '#' ? v : null;
  };

  Dossie.abrir({
    nome: texto('lead-input-nome'),
    documento: texto('lead-input-doc'),
    site: texto('link-site'),
    instagram: texto('link-insta')
  });
}
