/**
 * gravacao.js — gravar e transcrever a reunião do lead (2.35.0).
 *
 * Abre pela reunião da agenda ("Gravar a reunião"). O fluxo:
 *
 *   1. PREPARAR: o CX confirma que o lead concordou (obrigatório) e
 *      escolhe o modo:
 *        - online (computador): o microfone dele E o áudio da aba da
 *          reunião (Meet, Teams…) — cada um vira uma "voz" na transcrição;
 *        - um microfone só: presencial, externo ou celular.
 *   2. GRAVAR: a cada ~20 s cada voz vira um WAV (audio-wav.js), que vai
 *      para /api/gravacoes e volta como texto. O áudio não fica em lugar
 *      nenhum. Pedaço silencioso nem sai do navegador.
 *   3. ENCERRAR: manda o que falta e encerra; a reunião vira "realizada".
 *
 * No celular, a tela é mantida acesa enquanto grava (Wake Lock) — no
 * iPhone, tela apagada para a gravação.
 *
 * Carregar DEPOIS do audio-wav.js e do agenda.js.
 */

const Gravacao = (() => {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const SEGUNDOS_POR_PEDACO = 20;
  const LIMIAR_SILENCIO = 0.004;
  const ROTULO_ORIGEM = { formatar: 'Formatar', lead: 'Lead', sala: '' };

  const temTelaCompartilhada = () => !!navigator.mediaDevices?.getDisplayMedia;
  const minSeg = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  /* ----------------------------------------------------------
     O gravador: uma "voz" por fonte de áudio
     ---------------------------------------------------------- */

  let contexto = null;
  let vozes = [];            // { origem, stream, fonte, processador, blocos, amostrasTotais, seq }
  let gravacao = null;       // o registro do servidor
  let reuniao = null;        // o item da agenda
  let pausado = false;
  let relogio = null;
  let segundos = 0;
  let travaTela = null;
  let fila = [];
  let enviando = false;
  let trechos = [];          // o que já voltou transcrito, para desenhar

  function criarVoz(stream, origem) {
    const fonte = contexto.createMediaStreamSource(stream);
    // ScriptProcessor: descontinuado no papel, mas presente em todos os
    // navegadores, e dispensa carregar um módulo separado de AudioWorklet.
    const processador = contexto.createScriptProcessor(4096, 1, 1);
    const voz = { origem, stream, fonte, processador, blocos: [], amostrasTotais: 0, seq: 0 };
    processador.onaudioprocess = (ev) => {
      if (pausado) return;
      voz.blocos.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
    };
    // Mudo: o processador precisa estar ligado a um destino para rodar,
    // mas o CX não pode ouvir o próprio microfone de volta.
    const mudo = contexto.createGain();
    mudo.gain.value = 0;
    fonte.connect(processador);
    processador.connect(mudo);
    mudo.connect(contexto.destination);
    return voz;
  }

  /** Fecha o pedaço de cada voz e o põe na fila de envio. */
  function fecharPedacos() {
    for (const voz of vozes) {
      if (!voz.blocos.length) continue;
      const bruto = AudioWav.juntar(voz.blocos);
      voz.blocos = [];
      const inicio = voz.amostrasTotais / contexto.sampleRate;
      voz.amostrasTotais += bruto.length;
      const fim = voz.amostrasTotais / contexto.sampleRate;

      const amostras = AudioWav.reamostrar(bruto, contexto.sampleRate);
      const seq = voz.seq++;
      if (AudioWav.rms(amostras) < LIMIAR_SILENCIO) continue;     // silêncio não sai daqui

      fila.push({
        origem: voz.origem, seq, inicio_s: Math.round(inicio * 10) / 10, fim_s: Math.round(fim * 10) / 10,
        audio: AudioWav.base64(AudioWav.paraWav(amostras)), tentativas: 0
      });
    }
    enviarFila();
  }

  async function enviarFila() {
    if (enviando || !gravacao) return;
    enviando = true;
    while (fila.length) {
      desenharEstado();
      const pedaco = fila[0];
      try {
        const r = await fetch(`/api/gravacoes?id=${gravacao.id}&trecho=1`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pedaco)
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.details || d.error || `HTTP ${r.status}`);
        fila.shift();
        if (d.texto) {
          trechos.push({ gravacao_id: gravacao.id, origem: pedaco.origem, inicio_s: pedaco.inicio_s, texto: d.texto });
          desenharTranscricao(trechos);
        }
      } catch (e) {
        pedaco.tentativas++;
        if (pedaco.tentativas >= 3) {
          fila.shift();
          avisar(`Um pedaço (${minSeg(pedaco.inicio_s)}) não foi transcrito: ${e.message}`);
        } else {
          await new Promise((ok) => setTimeout(ok, 2000 * pedaco.tentativas));
        }
      }
    }
    enviando = false;
    desenharEstado();
  }

  async function manterTelaAcesa() {
    try { travaTela = await navigator.wakeLock?.request('screen'); } catch (e) { travaTela = null; }
  }

  async function comecar() {
    if (!el('gravacao-consentimento').checked) {
      alert('Confirme que o lead foi avisado e concordou com a gravação.');
      return;
    }
    const modo = el('gravacao-modo-online').checked ? 'online' : 'presencial';
    const botao = el('btn-gravacao-comecar');
    botao.disabled = true;

    // Primeiro as permissões do navegador: se o CX desistir aqui, nada
    // foi criado no servidor.
    let microfone, aba;
    try {
      microfone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      if (modo === 'online') {
        aba = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (!aba.getAudioTracks().length) {
          aba.getTracks().forEach((t) => t.stop());
          microfone.getTracks().forEach((t) => t.stop());
          alert('A aba foi compartilhada sem o áudio. Escolha a ABA da reunião e marque "Compartilhar áudio da guia".');
          botao.disabled = false;
          return;
        }
      }
    } catch (e) {
      microfone?.getTracks().forEach((t) => t.stop());
      alert(`O navegador não liberou o áudio: ${e.message}`);
      botao.disabled = false;
      return;
    }

    try {
      const r = await fetch('/api/gravacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reuniao_id: reuniao.id, consentimento: true, modo })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Não foi possível começar.');
      gravacao = d.gravacao;
    } catch (e) {
      microfone.getTracks().forEach((t) => t.stop());
      aba?.getTracks().forEach((t) => t.stop());
      alert(e.message);
      botao.disabled = false;
      return;
    }

    contexto = new (window.AudioContext || window.webkitAudioContext)();
    vozes = [criarVoz(microfone, modo === 'online' ? 'formatar' : 'sala')];
    if (aba) {
      vozes.push(criarVoz(new MediaStream(aba.getAudioTracks()), 'lead'));
      // Se o CX parar de compartilhar pela barra do navegador, a voz do
      // lead acaba — avisa em vez de gravar só um lado sem ninguém saber.
      aba.getAudioTracks()[0].addEventListener('ended', () => avisar('O compartilhamento da aba terminou: o áudio do lead não está mais sendo gravado.'));
      vozes[1].extras = aba;
    }

    pausado = false;
    segundos = 0;
    trechos = [];
    fila = [];
    await manterTelaAcesa();
    relogio = setInterval(() => {
      if (!pausado) segundos++;
      if (!pausado && segundos % SEGUNDOS_POR_PEDACO === 0) fecharPedacos();
      desenharEstado();
    }, 1000);

    window.addEventListener('beforeunload', segurarSaida);
    mostrarPasso('gravando');
    desenharTranscricao([]);
    desenharEstado();
  }

  function segurarSaida(ev) {
    ev.preventDefault();
    ev.returnValue = '';
  }

  function alternarPausa() {
    if (!gravacao) return;
    if (!pausado) fecharPedacos();       // o que já foi dito vai antes da pausa
    pausado = !pausado;
    el('btn-gravacao-pausar').textContent = pausado ? 'Continuar' : 'Pausar';
    desenharEstado();
  }

  async function encerrar() {
    if (!gravacao) return;
    if (!confirm('Encerrar a gravação? A reunião será marcada como realizada.')) return;
    clearInterval(relogio);
    pausado = true;
    fecharPedacos();

    el('btn-gravacao-encerrar').disabled = true;
    el('btn-gravacao-pausar').disabled = true;
    // Espera a fila esvaziar: o último pedaço ainda está sendo transcrito.
    while (enviando || fila.length) await new Promise((ok) => setTimeout(ok, 500));

    for (const voz of vozes) {
      voz.stream.getTracks().forEach((t) => t.stop());
      voz.extras?.getTracks().forEach((t) => t.stop());
    }
    try { await contexto?.close(); } catch (e) { /* já fechado */ }
    try { await travaTela?.release(); } catch (e) { /* já solto */ }
    window.removeEventListener('beforeunload', segurarSaida);

    try {
      const r = await fetch(`/api/gravacoes?id=${gravacao.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encerrar: true, duracao_s: segundos })
      });
      const d = await r.json();
      el('gravacao-final').textContent = d.reuniaoRealizada
        ? 'Gravação encerrada. A reunião foi marcada como realizada.'
        : 'Gravação encerrada.';
    } catch (e) {
      el('gravacao-final').textContent = 'A gravação terminou, mas não foi possível avisar o servidor. A transcrição está salva.';
    }
    gravacao = null;
    vozes = [];
    el('btn-gravacao-encerrar').disabled = false;
    el('btn-gravacao-pausar').disabled = false;
    mostrarPasso('encerrada');
    if (typeof Agenda !== 'undefined') Agenda.carregar?.();
  }

  /* ----------------------------------------------------------
     A janela
     ---------------------------------------------------------- */

  function mostrarPasso(passo) {
    ['preparar', 'gravando', 'encerrada'].forEach((p) =>
      el(`gravacao-${p}`)?.classList.toggle('hidden', p !== passo));
  }

  function desenharEstado() {
    const estado = el('gravacao-estado');
    if (!estado) return;
    const transcrevendo = fila.length;
    estado.innerHTML = `
      <span class="gravacao-ponto${pausado ? ' pausado' : ''}"></span>
      ${pausado ? 'Pausado' : 'Gravando'} · ${minSeg(segundos)}
      ${transcrevendo ? ` · ${transcrevendo} pedaço(s) transcrevendo` : ''}`;
  }

  function avisar(texto) {
    const alvo = el('gravacao-avisos');
    if (!alvo) return;
    const p = document.createElement('p');
    p.textContent = texto;
    alvo.appendChild(p);
  }

  /** A conversa: as vozes intercaladas pelo segundo em que cada fala começou. */
  function desenharTranscricao(lista, alvoId = 'gravacao-transcricao') {
    const alvo = el(alvoId);
    if (!alvo) return;
    const ordenada = [...lista].sort((a, b) =>
      (a.gravacao_id - b.gravacao_id) || (a.inicio_s - b.inicio_s) || String(a.origem).localeCompare(String(b.origem)));
    alvo.innerHTML = ordenada.length
      ? ordenada.map((t) => `
          <p class="trecho origem-${esc(t.origem)}">
            <span class="trecho-quando">${minSeg(t.inicio_s)}</span>
            ${ROTULO_ORIGEM[t.origem] ? `<strong>${esc(ROTULO_ORIGEM[t.origem])}:</strong>` : ''}
            ${esc(t.texto)}
          </p>`).join('')
      : '<p class="campo-ajuda">A transcrição aparece aqui, a cada ~20 segundos de fala.</p>';
    alvo.scrollTop = alvo.scrollHeight;
  }

  async function abrir(item) {
    reuniao = item;
    el('gravacao-titulo').textContent = `Gravar a reunião — ${item.lead_nome || ''}`;
    el('gravacao-consentimento').checked = false;
    el('gravacao-avisos').innerHTML = '';
    el('btn-gravacao-comecar').disabled = false;

    // Reunião online no computador: as duas vozes. No celular, ou em
    // reunião presencial/externa, um microfone só.
    const podeOnline = temTelaCompartilhada();
    el('gravacao-modo-online').disabled = !podeOnline;
    const online = podeOnline && item.local_tipo === 'online';
    el('gravacao-modo-online').checked = online;
    el('gravacao-modo-sala').checked = !online;
    el('gravacao-nota-celular').classList.toggle('hidden', podeOnline);

    const disp = await fetch('/api/gravacoes?disponivel=1').then((r) => r.json()).catch(() => ({}));
    el('gravacao-sem-transcritor').classList.toggle('hidden', !!disp.transcritor);

    mostrarPasso('preparar');
    el('modal-gravacao').classList.remove('hidden');
  }

  function fechar() {
    if (gravacao) {
      alert('A gravação está em andamento. Encerre antes de fechar.');
      return;
    }
    el('modal-gravacao').classList.add('hidden');
  }

  /* ----------------------------------------------------------
     Na reunião da agenda: gravar, e a transcrição que já existe
     ---------------------------------------------------------- */

  async function mostrarNaReuniao(item) {
    const bloco = el('agenda-gravacao');
    if (!bloco) return;
    // Só reunião que já existe: gravar pede a reunião salva na agenda.
    const pode = item && item.tipo === 'reuniao' && item.status !== 'cancelada' && item.status !== 'remarcada';
    bloco.classList.toggle('hidden', !pode);
    if (!pode) return;
    bloco.dataset.item = JSON.stringify(item);
    el('agenda-transcricao').innerHTML = '';
    el('agenda-gravacao-estado').textContent = '';

    try {
      const r = await fetch(`/api/gravacoes?reuniao_id=${item.id}`);
      const d = await r.json();
      const encerradas = (d.gravacoes || []).filter((g) => g.status === 'encerrada');
      el('agenda-gravacao-estado').textContent = encerradas.length
        ? `${encerradas.length} gravação(ões) · ${(d.trechos || []).length} trecho(s) transcrito(s)`
        : 'Ainda não gravada.';
      if ((d.trechos || []).length) desenharTranscricao(d.trechos, 'agenda-transcricao');
    } catch (e) {
      el('agenda-gravacao-estado').textContent = 'Não foi possível consultar as gravações.';
    }
  }

  function iniciar() {
    el('btn-gravacao-comecar')?.addEventListener('click', comecar);
    el('btn-gravacao-pausar')?.addEventListener('click', alternarPausa);
    el('btn-gravacao-encerrar')?.addEventListener('click', encerrar);
    el('btn-gravacao-fechar')?.addEventListener('click', fechar);
    el('btn-gravacao-concluir')?.addEventListener('click', fechar);
    el('btn-agenda-gravar')?.addEventListener('click', () => {
      const bloco = el('agenda-gravacao');
      try { abrir(JSON.parse(bloco.dataset.item)); } catch (e) { /* sem reunião */ }
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
  return { abrir, mostrarNaReuniao };
})();
