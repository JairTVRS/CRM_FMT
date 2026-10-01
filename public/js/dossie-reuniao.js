/**
 * dossie-reuniao.js — o Dossiê da Reunião (2.38.0).
 *
 * Na janela da reunião realizada, coluna da direita: "Gerar o dossiê da
 * reunião" e as versões já geradas. A IA segue a instrução enviada nas
 * Configurações para o tipo da reunião; o documento abre num visualizador
 * isolado e se baixa como .html (com "Salvar como PDF" dentro dele).
 *
 * Carregar DEPOIS do agenda.js.
 */

const DossieReuniao = (() => {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const quando = (iso) => (iso
    ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '');

  let reuniao = null;          // o item da agenda aberto na janela
  let versoes = [];
  let htmlAtual = null;
  let gerando = null;          // { id, relogio, inicio } enquanto a IA escreve

  /* ----------------------------------------------------------
     O bloco na janela da reunião
     ---------------------------------------------------------- */

  async function mostrarNaReuniao(item) {
    const alvo = el('agenda-dossie-reuniao');
    if (!alvo) return;
    reuniao = item;
    const mostra = item && item.tipo === 'reuniao' && item.finalizada_em;
    alvo.classList.toggle('hidden', !mostra);
    if (!mostra) return;
    if (gerando?.id === item.id) { desenharGerando(); return; }
    alvo.innerHTML = '<p class="recortes-nota">Carregando o dossiê da reunião…</p>';
    try {
      const d = await fetch(`/api/dossie-reuniao?reuniao_id=${item.id}`).then((r) => r.json());
      if (reuniao?.id !== item.id) return;               // trocou de reunião no meio
      versoes = d.versoes || [];
      desenhar(d);
    } catch (e) {
      alvo.innerHTML = '<p class="recortes-nota recortes-aviso">Não foi possível consultar o dossiê da reunião.</p>';
    }
  }

  function desenhar(d) {
    const alvo = el('agenda-dossie-reuniao');
    const ultima = versoes[0];
    const resumo = ultima
      ? `<p class="dossie-reuniao-resumo">Versão ${esc(ultima.versao)} · ${esc(quando(ultima.gerado_em))}
           ${ultima.citacoes != null ? `<br>${esc(ultima.citacoes)} citação(ões), ${esc(ultima.citacoes_nao_encontradas || 0)} não encontrada(s) na transcrição` : ''}</p>`
      : '<p class="recortes-nota">A IA lê a transcrição inteira e monta o mapa da reunião seguindo a instrução enviada nas Configurações.</p>';
    const motivo = !d.pode_gerar && d.motivo ? `<p class="recortes-nota recortes-aviso">${esc(d.motivo)}</p>` : '';
    alvo.innerHTML = `
      <div class="recortes-topo"><strong>Dossiê da reunião</strong>
        ${d.instrucao ? `<span class="recortes-nota">instrução v${esc(d.instrucao.versao)}</span>` : ''}</div>
      ${resumo}${motivo}
      <div class="dossie-reuniao-botoes">
        ${ultima ? '<button type="button" class="btn btn-sm btn-secondary" data-dossie-reuniao="abrir">Abrir</button>' : ''}
        ${d.pode_gerar ? `<button type="button" class="btn btn-sm btn-primary" data-dossie-reuniao="gerar">${ultima ? 'Gerar nova versão' : 'Gerar o dossiê da reunião'}</button>` : ''}
      </div>`;
  }

  function desenharGerando() {
    const alvo = el('agenda-dossie-reuniao');
    if (!alvo || !gerando || reuniao?.id !== gerando.id) return;
    const s = Math.round((Date.now() - gerando.inicio) / 1000);
    alvo.innerHTML = `
      <div class="recortes-topo"><strong>Dossiê da reunião</strong></div>
      <p class="dossie-reuniao-resumo"><span class="gravacao-ponto"></span> A IA está escrevendo o dossiê… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</p>
      <p class="recortes-nota">Leva de 1 a 2 minutos. Pode fechar esta janela: o dossiê aparece aqui quando ficar pronto.</p>`;
  }

  async function gerar() {
    if (!reuniao || gerando) return;
    const id = reuniao.id;
    gerando = { id, inicio: Date.now(), relogio: setInterval(desenharGerando, 1000) };
    desenharGerando();
    let erro = null;
    let feito = null;
    try {
      const r = await fetch('/api/dossie-reuniao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reuniao_id: id })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) erro = d.error || 'Não foi possível gerar o dossiê.';
      else feito = d;
    } catch (e) {
      erro = 'Falha de conexão ao gerar o dossiê.';
    }
    clearInterval(gerando.relogio);
    gerando = null;
    if (erro) { alert(erro); }
    if (reuniao?.id === id) {
      await mostrarNaReuniao(reuniao);
      if (feito) abrir(feito.versao);
    } else if (feito) {
      alert(`O dossiê da reunião ficou pronto (versão ${feito.versao}). Abra a reunião para ver.`);
    }
  }

  /* ----------------------------------------------------------
     O visualizador
     ---------------------------------------------------------- */

  async function abrir(versao = null) {
    if (!reuniao) return;
    const v = versao || versoes[0]?.versao;
    el('dossie-reuniao-titulo').textContent = `Dossiê da Reunião — ${reuniao.lead_nome || ''}`;
    el('dossie-reuniao-versao').innerHTML = versoes.map((x, i) =>
      `<option value="${x.versao}">Versão ${x.versao}${i === 0 ? ' (mais nova)' : ''} · ${esc(quando(x.gerado_em))}</option>`).join('');
    el('dossie-reuniao-versao').value = String(v);
    el('dossie-reuniao-frame').srcdoc = '<p style="font-family:sans-serif;padding:2rem">Carregando…</p>';
    el('modal-dossie-reuniao').classList.remove('hidden');
    try {
      const r = await fetch(`/api/dossie-reuniao?reuniao_id=${reuniao.id}&html=1&versao=${v}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      htmlAtual = await r.text();
      // srcdoc, não a URL: o endpoint exige login, e a navegação do iframe não leva.
      el('dossie-reuniao-frame').srcdoc = htmlAtual;
    } catch (e) {
      htmlAtual = null;
      el('dossie-reuniao-frame').srcdoc = `<p style="font-family:sans-serif;padding:2rem">Não foi possível abrir o dossiê: ${esc(e.message)}</p>`;
    }
  }

  function fechar() {
    el('modal-dossie-reuniao')?.classList.add('hidden');
    el('dossie-reuniao-frame').srcdoc = '';
    htmlAtual = null;
  }

  /** O nome do arquivo é o título do documento: Dossie_Reuniao_Cliente_2026_10.html */
  function baixar() {
    if (!htmlAtual) return;
    const titulo = (htmlAtual.match(/<title>([^<]*)<\/title>/i)?.[1] || 'Dossie_Reuniao').trim();
    const blob = new Blob([htmlAtual], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${titulo}_v${el('dossie-reuniao-versao').value}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function iniciar() {
    el('agenda-dossie-reuniao')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-dossie-reuniao]');
      if (!b) return;
      if (b.dataset.dossieReuniao === 'gerar') gerar();
      if (b.dataset.dossieReuniao === 'abrir') abrir();
    });
    el('dossie-reuniao-versao')?.addEventListener('change', (ev) => abrir(Number(ev.target.value)));
    el('btn-dossie-reuniao-baixar')?.addEventListener('click', baixar);
    el('btn-dossie-reuniao-fechar')?.addEventListener('click', fechar);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el('modal-dossie-reuniao')?.classList.contains('hidden')) {
        ev.stopImmediatePropagation();
        fechar();
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { mostrarNaReuniao, abrir };
})();
