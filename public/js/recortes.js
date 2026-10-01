/**
 * recortes.js — os recortes e o roteiro da reunião (2.37.0).
 *
 * Dois lugares, o mesmo desenho:
 *   1. a janela da GRAVAÇÃO, ao lado da conversa: analisa sozinha a cada
 *      ~2 min (o servidor não chama a IA se não chegou trecho novo), e
 *      pelo botão "Analisar agora";
 *   2. a janela da REUNIÃO, na coluna da direita: a última análise, e o
 *      botão para analisar de novo.
 *
 * Tudo que aparece como citação já foi conferido pelo servidor contra a
 * transcrição. As perguntas sugeridas não são conferíveis — a tela diz.
 *
 * Carregar DEPOIS do gravacao.js.
 */

const Recortes = (() => {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const minSeg = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const ROTULO = { expectativa: 'Expectativa', dor: 'Dor', objecao: 'Objeção', decisao: 'Decisão' };
  /** De quanto em quanto tempo a gravação pede uma análise nova. */
  const A_CADA_MS = 2 * 60 * 1000;

  let acompanhando = null;           // { reuniaoId, alvoId, relogio }
  const ocupado = new Set();          // reuniões com análise em curso

  function desenhar(alvoId, reuniaoId, { analise = null, mensagem = null, carregando = false } = {}) {
    const alvo = el(alvoId);
    if (!alvo) return;
    const quando = analise?.gerado_em ? `atualizado às ${hora(analise.gerado_em)}` : '';
    const topo = `
      <div class="recortes-topo">
        <strong>Recortes da conversa</strong>
        <button type="button" class="btn btn-sm btn-secondary" data-recortes-analisar="${reuniaoId}" data-recortes-alvo="${alvoId}"
                ${carregando ? 'disabled' : ''}>${carregando ? 'Analisando…' : 'Analisar agora'}</button>
      </div>
      ${quando ? `<p class="recortes-nota">${esc(quando)}</p>` : ''}
      ${mensagem ? `<p class="recortes-nota recortes-aviso">${esc(mensagem)}</p>` : ''}`;

    if (!analise) {
      alvo.innerHTML = `${topo}<p class="recortes-nota">As falas do lead que mostram expectativa, dor, objeção ou como ele decide aparecem aqui — conferidas, palavra por palavra, contra a transcrição. Atualiza a cada ~2 minutos de conversa.</p>`;
      return;
    }

    const recortes = analise.recortes || [];
    const listaRecortes = recortes.length
      ? `<ul class="recortes-lista">${recortes.map((r) => `
          <li class="recorte tipo-${esc(r.tipo)}">
            <span class="recorte-tipo">${esc(ROTULO[r.tipo] || r.tipo)}</span>
            <span class="recorte-quando">${minSeg(r.inicio_s || 0)}</span>
            <q>${esc(r.citacao)}</q>
            ${r.por_que ? `<span class="recorte-porque">${esc(r.por_que)}</span>` : ''}
          </li>`).join('')}</ul>`
      : '<p class="recortes-nota">Nenhuma fala do lead marcante até agora.</p>';

    const notas = [];
    if (analise.descartados) notas.push(`${analise.descartados} citação(ões) da IA descartada(s): não estavam na transcrição.`);
    if (analise.separacao === false) notas.push('Vozes não separadas (presencial ou sem o som do computador): confira se a fala é do lead.');

    let roteiro;
    if (analise.roteiro) {
      const itens = analise.roteiro.itens || [];
      const cobertos = itens.filter((i) => i.coberto).length;
      roteiro = `
        <h4>Roteiro ${analise.roteiro.versao ? `(versão ${esc(analise.roteiro.versao)})` : ''} — ${cobertos} de ${itens.length} coberto(s)</h4>
        <ul class="roteiro-lista">${itens.map((i) => `
          <li class="${i.coberto ? 'coberto' : 'falta'}" ${i.coberto && i.evidencia ? `title="${esc(`“${i.evidencia}” (${minSeg(i.inicio_s || 0)})`)}"` : ''}>
            <span aria-hidden="true">${i.coberto ? '✓' : '○'}</span> ${esc(i.item)}
          </li>`).join('')}</ul>`;
    } else {
      roteiro = '<h4>Roteiro</h4><p class="recortes-nota">Este tipo de reunião não tem roteiro: envie o arquivo em Configurações → Roteiros para ver o que já foi coberto e o que falta.</p>';
    }

    const sugestoes = (analise.sugestoes || []).length
      ? `<h4>Perguntas sugeridas <small>(sugestão da IA, não conferida)</small></h4>
         <ul class="sugestoes-lista">${analise.sugestoes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
      : '';

    alvo.innerHTML = `${topo}${listaRecortes}
      ${notas.map((n) => `<p class="recortes-nota">${esc(n)}</p>`).join('')}
      ${roteiro}${sugestoes}`;
  }

  /** A última análise, sem chamar a IA. */
  async function carregar(reuniaoId, alvoId) {
    try {
      const d = await fetch(`/api/recortes?reuniao_id=${reuniaoId}`).then((r) => r.json());
      guardar(alvoId, d.analise);
      desenhar(alvoId, reuniaoId, { analise: d.analise || null, mensagem: d.aviso || null });
    } catch (e) {
      desenhar(alvoId, reuniaoId, { mensagem: 'Não foi possível carregar os recortes.' });
    }
  }

  /**
   * Analisa agora. `silencioso`: a análise automática — "pouca conversa"
   * e "nada novo" não viram aviso.
   */
  async function analisar(reuniaoId, alvoId, { forcar = false, silencioso = false } = {}) {
    if (ocupado.has(reuniaoId)) return;
    ocupado.add(reuniaoId);
    const antes = el(alvoId)?.dataset.analise ? JSON.parse(el(alvoId).dataset.analise) : null;
    if (!silencioso) desenhar(alvoId, reuniaoId, { analise: antes, carregando: true });
    try {
      const r = await fetch('/api/recortes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reuniao_id: reuniaoId, forcar })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        guardar(alvoId, d.analise);
        desenhar(alvoId, reuniaoId, { analise: d.analise, mensagem: d.sem_novidade && !silencioso ? 'Nada novo na conversa desde a última análise.' : null });
      } else if (!(silencioso && d.code === 'POUCA_CONVERSA')) {
        desenhar(alvoId, reuniaoId, { analise: antes, mensagem: d.error || 'Não foi possível analisar.' });
      }
    } catch (e) {
      if (!silencioso) desenhar(alvoId, reuniaoId, { analise: antes, mensagem: 'Falha de conexão ao analisar.' });
    } finally {
      ocupado.delete(reuniaoId);
    }
  }

  /** O que está na tela, para o "Analisando…" não apagar a análise anterior. */
  function guardar(alvoId, analise) {
    const alvo = el(alvoId);
    if (alvo && analise) alvo.dataset.analise = JSON.stringify(analise);
  }

  /** A gravação começou: mostra a última e analisa a cada ~2 min. */
  function acompanhar(reuniaoId, alvoId = 'gravacao-recortes') {
    parar();
    const alvo = el(alvoId);
    if (alvo) delete alvo.dataset.analise;
    carregar(reuniaoId, alvoId);
    acompanhando = {
      reuniaoId, alvoId,
      relogio: setInterval(() => analisar(reuniaoId, alvoId, { silencioso: true }), A_CADA_MS)
    };
  }

  function parar() {
    if (acompanhando) clearInterval(acompanhando.relogio);
    acompanhando = null;
  }

  /** Na janela da reunião: só a que já começou (ou já tem análise). */
  function mostrarNaReuniao(item) {
    const alvo = el('agenda-recortes');
    if (!alvo) return;
    delete alvo.dataset.analise;
    const mostra = item && item.tipo === 'reuniao' && item.iniciada_em;
    alvo.classList.toggle('hidden', !mostra);
    if (mostra) carregar(item.id, 'agenda-recortes');
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-recortes-analisar]');
    // Sem conversa nova, o servidor devolve a mesma análise e não chama a IA.
    if (b) analisar(Number(b.dataset.recortesAnalisar), b.dataset.recortesAlvo);
  });

  return { acompanhar, parar, analisar, mostrarNaReuniao };
})();
