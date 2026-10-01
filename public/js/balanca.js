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
    if (!clienteId) { alvo.innerHTML = '<p class="campo-informativo">Salve o cliente primeiro.</p>'; return; }
    if (gerando?.id === clienteId) { desenharGerando(); return; }
    alvo.innerHTML = '<p class="campo-informativo">Carregando…</p>';
    try {
      const d = await fetch(`/api/balanca?cliente_id=${clienteId}`).then((r) => r.json());
      if (id !== clienteId) return;
      versoes = d.versoes || [];
      desenhar(d);
    } catch (e) {
      alvo.innerHTML = '<p class="campo-informativo">Não foi possível consultar a Balança.</p>';
    }
  }

  function desenhar(d) {
    const alvo = el('cli-balanca');
    const ultima = versoes[0];
    const instrucao = d.instrucao
      ? `Instrução: ${esc(d.instrucao.rotulo)}${d.instrucao.padrao ? ' (a do CRM; para trocar, envie outra em Configurações → Roteiros)' : ''}`
      : '';
    const periodo = d.periodo ? `Período que será lido: ${dataBr(d.periodo.de)} a ${dataBr(d.periodo.ate)}.` : '';
    alvo.innerHTML = `
      <div class="cli-prevenda-item cli-balanca-estado">
        <div>
          ${ultima
            ? `<strong>Versão ${esc(ultima.versao)}</strong> · ${esc(quando(ultima.gerado_em))}
               <div class="recortes-nota">${esc(dataBr(ultima.periodo_de))} a ${esc(dataBr(ultima.periodo_ate))} · ${esc(ultima.reunioes ?? 0)} reunião(ões), ${esc(ultima.acoes ?? 0)} ação(ões)
               · ${esc(ultima.citacoes ?? 0)} evidência(s), ${esc(ultima.citacoes_nao_encontradas ?? 0)} não encontrada(s)</div>`
            : '<strong>Nenhuma Balança gerada ainda.</strong>'}
          ${ultima?.arquivo ? `<code class="doc-contexto-arquivo">${esc(ultima.arquivo)}</code>` : ''}
          <div class="recortes-nota">${periodo} ${instrucao}</div>
          ${!d.pode_gerar && d.motivo ? `<div class="recortes-nota recortes-aviso">${esc(d.motivo)}</div>` : ''}
        </div>
        <div class="dossie-reuniao-botoes">
          ${ultima ? '<button type="button" class="btn btn-sm btn-secondary" data-balanca="abrir">Abrir</button>' : ''}
          ${ultima ? '<button type="button" class="btn btn-sm btn-secondary" data-balanca="baixar">Baixar</button>' : ''}
          ${d.pode_gerar ? `<button type="button" class="btn btn-sm btn-primary" data-balanca="gerar">${ultima ? 'Gerar nova versão' : 'Gerar a Balança'}</button>` : ''}
        </div>
      </div>`;
  }

  function desenharGerando() {
    const alvo = el('cli-balanca');
    if (!alvo || !gerando || gerando.id !== clienteId) return;
    const s = Math.round((Date.now() - gerando.inicio) / 1000);
    alvo.innerHTML = `
      <div class="cli-prevenda-item">
        <div><span class="gravacao-ponto"></span> A IA está pesando a relação… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}
          <div class="recortes-nota">Lendo as atas no ERP e o plano de ação. Leva de 1 a 2 minutos; pode fechar a ficha.</div></div>
      </div>`;
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
