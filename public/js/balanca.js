/**
 * balanca.js — a Balança Avaliativa, na ficha do cliente (2.39.0).
 *
 * Aba "Balança": gerar, ver as versões e abrir no mesmo visualizador do
 * Dossiê da Reunião (DossieReuniao.abrirDocumento), com Baixar e PDF.
 * Carrega sob demanda, como as outras abas da ficha: só quando é aberta.
 *
 * Carregar DEPOIS do dossie-reuniao.js.
 */

const Balanca = (() => {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const dataBr = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '');

  let clienteId = null;
  let clienteNome = '';
  let versoes = [];
  let gerando = null;          // { id, inicio, relogio }

  async function mostrar(id, nome) {
    clienteId = id || null;
    if (nome) clienteNome = nome;
    const alvo = el('cli-balanca');
    if (!alvo) return;
    if (!clienteId) { alvo.innerHTML = linha('<span class="doc-linha-info">salve o cliente primeiro</span>'); return; }
    if (gerando?.id === clienteId) { desenharGerando(); return; }
    alvo.innerHTML = linha('<span class="doc-linha-info">carregando…</span>');
    try {
      const d = await fetch(`/api/balanca?cliente_id=${clienteId}`).then((r) => r.json());
      if (id !== clienteId) return;
      versoes = d.versoes || [];
      desenhar(d);
    } catch (e) {
      alvo.innerHTML = linha('<span class="doc-linha-info">não foi possível consultar</span>');
    }
  }

  /**
   * 2.39.2: uma linha — o nome, a versão com o arquivo exato, e os botões.
   * O período, a fonte e a instrução ficam na dica (passar o mouse).
   */
  const DICA = 'O que está funcionando e o que preocupa nos últimos 6 meses, com a evidência das atas e do plano. Os números são calculados pelo CRM.';
  const linha = (info, botoes = '', dica = '') => `
    <div class="doc-linha"${dica ? ` title="${esc(dica)}"` : ''}>
      <span class="doc-contexto-num">3</span>
      <div class="doc-linha-texto"><strong title="${esc(DICA)}">Balança Avaliativa</strong>${info}</div>
      <div class="doc-linha-botoes">${botoes}</div>
    </div>`;

  function desenhar(d) {
    const alvo = el('cli-balanca');
    const v = versoes[0];
    const anteriores = versoes.length - 1;
    const instrucao = d.instrucao ? `Instrução: ${d.instrucao.rotulo}${d.instrucao.padrao ? ' (a do CRM; para trocar, envie outra em Configurações → Roteiros)' : ''}` : '';
    const dica = v
      ? `${dataBr(v.periodo_de)} a ${dataBr(v.periodo_ate)} · ${v.reunioes ?? 0} reunião(ões), ${v.acoes ?? 0} ação(ões) · ${v.citacoes ?? 0} evidência(s), ${v.citacoes_nao_encontradas ?? 0} não encontrada(s). ${instrucao}`
      : `${d.periodo ? `Vai ler de ${dataBr(d.periodo.de)} a ${dataBr(d.periodo.ate)}. ` : ''}${instrucao}`;
    const info = v
      ? `<span class="doc-linha-info">v${esc(v.versao)} · ${esc(quando(v.gerado_em))}${anteriores ? ` · +${anteriores} anterior(es)` : ''}</span>
         ${v.arquivo ? `<code class="doc-contexto-arquivo">${esc(v.arquivo)}</code>` : ''}`
      : '<span class="doc-linha-info">nenhuma versão ainda</span>';
    const aviso = !d.pode_gerar && d.motivo ? `<span class="doc-linha-info recortes-aviso">${esc(d.motivo)}</span>` : '';
    const botoes = [
      v ? '<button type="button" class="btn btn-sm btn-secondary" data-balanca="abrir">Abrir</button>' : '',
      v ? '<button type="button" class="btn btn-sm btn-secondary" data-balanca="baixar">Baixar</button>' : '',
      d.pode_gerar ? `<button type="button" class="btn btn-sm btn-primary" data-balanca="gerar">${v ? 'Nova versão' : 'Gerar'}</button>` : ''
    ].join('');
    alvo.innerHTML = linha(info + aviso, botoes, dica);
  }

  function desenharGerando() {
    const alvo = el('cli-balanca');
    if (!alvo || !gerando || gerando.id !== clienteId) return;
    const s = Math.round((Date.now() - gerando.inicio) / 1000);
    alvo.innerHTML = linha(
      `<span class="doc-linha-info"><span class="gravacao-ponto"></span> gerando… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} (1 a 2 min; pode fechar a ficha)</span>`);
  }

  async function gerar() {
    if (!clienteId || gerando) return;
    const id = clienteId;
    gerando = { id, inicio: Date.now(), relogio: setInterval(desenharGerando, 1000) };
    desenharGerando();
    let erro = null;
    let feito = null;
    try {
      const r = await fetch('/api/balanca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: id })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) erro = d.error || 'Não foi possível gerar a Balança.';
      else feito = d;
    } catch (e) {
      erro = 'Falha de conexão ao gerar a Balança.';
    }
    clearInterval(gerando.relogio);
    gerando = null;
    if (erro) alert(erro);
    if (clienteId === id) {
      await mostrar(id);
      if (feito) abrir(feito.versao);
    } else if (feito) {
      alert(`A Balança ficou pronta (versão ${feito.versao}). Abra o cliente para ver.`);
    }
  }

  function abrir(versao = null) {
    if (!clienteId || typeof DossieReuniao === 'undefined') return;
    const id = clienteId;
    DossieReuniao.abrirDocumento({
      titulo: `Balança Avaliativa — ${clienteNome || ''}`,
      versoes,
      url: (v) => `/api/balanca?cliente_id=${id}&html=1&versao=${v}`
    }, versao);
  }

  function iniciar() {
    el('cli-balanca')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-balanca]');
      if (!b) return;
      if (b.dataset.balanca === 'gerar') gerar();
      if (b.dataset.balanca === 'abrir') abrir();
      if (b.dataset.balanca === 'baixar' && versoes[0] && typeof DossieReuniao !== 'undefined') {
        DossieReuniao.baixarDocumento(`/api/balanca?cliente_id=${clienteId}&html=1&versao=${versoes[0].versao}`, versoes[0].arquivo);
      }
    });
    // A ficha avisa qual cliente abriu; a aba carrega quando é aberta.
    document.addEventListener('crm:cliente-ficha', (ev) => {
      clienteId = ev.detail?.id || null;
      clienteNome = ev.detail?.nome || '';
    });
    document.addEventListener('crm:cliente-aba', (ev) => {
      // 2.39.1: a Balança mora na aba "Documentos de contexto".
      if (ev.detail?.aba === 'cli-tab-documentos') mostrar(ev.detail.clienteId);
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { mostrar };
})();
