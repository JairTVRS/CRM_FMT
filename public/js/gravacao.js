/**
 * gravacao.js — iniciar, gravar e finalizar a reunião do lead
 * (gravação 2.35.0; iniciar e finalizar 2.36.0).
 *
 * Tudo acontece a partir da reunião da agenda, no bloco "Andamento da
 * reunião":
 *
 *   1. INICIAR: o CX marca que o lead concordou com a gravação, escolhe
 *      de onde vem o áudio e clica em "Iniciar reunião". O CRM guarda a
 *      hora de início e JÁ COMEÇA A TRANSCREVER. Sem a marca do
 *      consentimento, a reunião começa sem gravar.
 *        - online (computador): o microfone dele E o áudio da aba da
 *          reunião (Meet, Teams…) — cada um vira uma "voz" na transcrição;
 *        - um microfone só: presencial, externo ou celular.
 *   2. GRAVAR: a cada ~20 s cada voz vira um WAV (audio-wav.js), que vai
 *      para /api/gravacoes e volta como texto. O áudio não fica em lugar
 *      nenhum. Pedaço silencioso nem sai do navegador.
 *   3. FINALIZAR: manda o que falta, guarda a hora de fim e a reunião
 *      vira "realizada".
 *
 * Uma reunião em andamento por pessoa: o servidor recusa a segunda e diz
 * qual está aberta. Se o navegador fechar no meio, a reunião continua em
 * andamento (verde na agenda) e o aviso no canto leva a ela: dali, dá
 * para retomar a gravação ou finalizar.
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
  const eu = () => String((typeof Auth !== 'undefined' && Auth.usuario?.email) || '').toLowerCase();
  const souAdmin = () => !!(typeof Auth !== 'undefined' && Auth.usuario?.admin);

  /* ----------------------------------------------------------
     Horas reais (instantes ISO do servidor, mostrados na hora local)
     ---------------------------------------------------------- */

  const horaDe = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dataDe = (iso) => new Date(iso).toLocaleDateString('pt-BR');
  function duracao(deIso, ateIso) {
    const min = Math.max(0, Math.round((Date.parse(ateIso) - Date.parse(deIso)) / 60000));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
  }
  /** "30/09/2026, das 14:05 às 15:12 (1 h 07 min)" */
  const periodoReal = (item) =>
    `${dataDe(item.iniciada_em)}, das ${horaDe(item.iniciada_em)} às ${horaDe(item.finalizada_em)} (${duracao(item.iniciada_em, item.finalizada_em)})`;

  const nomeDe = (email) => (typeof Cadastros !== 'undefined' && Cadastros.nomeDoUsuario(email)) || email;

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

  const pararAudio = (audio) => {
    audio?.microfone?.getTracks().forEach((t) => t.stop());
    audio?.aba?.getTracks().forEach((t) => t.stop());
  };

  /**
   * As permissões do navegador, ANTES de o servidor saber de qualquer
   * coisa: se o CX desistir aqui, a reunião não é iniciada.
   * @returns {{microfone, aba}|null}
   */
  async function pedirAudio(modo) {
    let microfone, aba;
    try {
      microfone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      if (modo === 'online') {
        aba = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (!aba.getAudioTracks().length) {
          pararAudio({ microfone, aba });
          alert('A aba foi compartilhada sem o áudio. Escolha a ABA da reunião e marque "Compartilhar áudio da guia".');
          return null;
        }
      }
      return { microfone, aba };
    } catch (e) {
      pararAudio({ microfone, aba });
      alert(`O navegador não liberou o áudio: ${e.message}`);
      return null;
    }
  }

  /** Cria a gravação no servidor e começa a captar. Falhou: false. */
  async function comecarGravacao(item, modo, audio) {
    try {
      const r = await fetch('/api/gravacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reuniao_id: item.id, consentimento: true, modo })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Não foi possível começar a gravação.');
      gravacao = d.gravacao;
    } catch (e) {
      pararAudio(audio);
      alert(`A reunião está em andamento, mas a gravação não começou: ${e.message}\n\nDá para tentar de novo em "Retomar a gravação", ou seguir sem gravar e finalizar no fim.`);
      return false;
    }

    reuniao = item;
    contexto = new (window.AudioContext || window.webkitAudioContext)();
    vozes = [criarVoz(audio.microfone, modo === 'online' ? 'formatar' : 'sala')];
    if (audio.aba) {
      vozes.push(criarVoz(new MediaStream(audio.aba.getAudioTracks()), 'lead'));
      // Se o CX parar de compartilhar pela barra do navegador, a voz do
      // lead acaba — avisa em vez de gravar só um lado sem ninguém saber.
      audio.aba.getAudioTracks()[0].addEventListener('ended', () => avisar('O compartilhamento da aba terminou: o áudio do lead não está mais sendo gravado.'));
      vozes[1].extras = audio.aba;
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
    el('gravacao-titulo').textContent = `Reunião em andamento — ${item.lead_nome || ''}`;
    el('gravacao-avisos').innerHTML = '';
    el('btn-gravacao-pausar').textContent = 'Pausar';
    mostrarPasso('gravando');
    desenharTranscricao([]);
    desenharEstado();
    el('modal-gravacao').classList.remove('hidden');
    return true;
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

  /** Para de captar, manda o que falta e encerra a gravação no servidor. */
  async function pararGravacao() {
    clearInterval(relogio);
    pausado = true;
    fecharPedacos();
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
      await fetch(`/api/gravacoes?id=${gravacao.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encerrar: true, duracao_s: segundos })
      });
    } catch (e) { /* "Finalizar" fecha a gravação que ficar aberta */ }
    gravacao = null;
    vozes = [];
  }

  /* ----------------------------------------------------------
     Iniciar, retomar e finalizar (2.36.0)
     ---------------------------------------------------------- */

  async function acaoNaReuniao(item, acao) {
    const r = await fetch(`/api/agenda?id=${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao })
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, ...d };
  }

  /** Redesenha a agenda, a ficha, a janela da reunião e o aviso do canto. */
  async function depoisDeMudar(item) {
    atualizarAviso();
    if (typeof Agenda === 'undefined') return;
    Agenda.atualizar?.(item.lead_id);
    if (!el('modal-agenda')?.classList.contains('hidden')) await Agenda.abrirJanela({ item });
  }

  function lerPreparo() {
    return {
      consentimento: el('gravacao-consentimento').checked,
      modo: el('gravacao-modo-online').checked ? 'online' : 'presencial'
    };
  }

  function travarBotoes(travar) {
    ['btn-agenda-iniciar', 'btn-agenda-retomar', 'btn-agenda-finalizar'].forEach((id) => { if (el(id)) el(id).disabled = travar; });
  }

  async function iniciarReuniao() {
    const item = itemDaJanela();
    if (!item) return;
    if (gravacao) { alert('Já há uma reunião sendo gravada neste navegador.'); return; }

    const hoje = new Date();
    const hojeTxt = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const dia = String(item.inicio).slice(0, 10);
    if (dia !== hojeTxt) {
      const [a, m, d] = dia.split('-');
      if (!confirm(`Esta reunião está marcada para ${d}/${m}/${a} às ${String(item.inicio).slice(11, 16)}. Iniciar agora mesmo assim?`)) return;
    }

    const { consentimento, modo } = lerPreparo();
    let audio = null;
    if (!consentimento && !confirm('A caixa "O lead concordou com a gravação" não está marcada.\n\nIniciar a reunião SEM gravar?')) return;

    travarBotoes(true);
    try {
      if (consentimento) {
        audio = await pedirAudio(modo);
        if (!audio) return;
      }

      const d = await acaoNaReuniao(item, 'iniciar');
      if (!d.ok) {
        pararAudio(audio);
        if (d.code === 'OUTRA_EM_ANDAMENTO' && d.emAndamento) {
          if (confirm(`${d.error}\n\nAbrir aquela reunião agora?`)) await Agenda.abrirJanela({ item: d.emAndamento });
        } else {
          alert(d.error || 'Não foi possível iniciar a reunião.');
        }
        return;
      }

      await depoisDeMudar(d.item);
      if (audio) await comecarGravacao(d.item, modo, audio);
    } catch (e) {
      pararAudio(audio);
      alert(`Falha de conexão ao iniciar a reunião: ${e.message}`);
    } finally {
      travarBotoes(false);
    }
  }

  /** A reunião está em andamento, mas nada grava neste navegador. */
  async function retomar() {
    const item = itemDaJanela();
    if (!item || gravacao) return;
    const { consentimento, modo } = lerPreparo();
    if (!consentimento) { alert('Marque que o lead concordou com a gravação.'); return; }
    travarBotoes(true);
    try {
      const audio = await pedirAudio(modo);
      if (audio) await comecarGravacao(item, modo, audio);
    } finally {
      travarBotoes(false);
    }
  }

  /** Finalizar pela janela da reunião: quando nada grava neste navegador. */
  async function finalizarDaJanela() {
    const item = itemDaJanela();
    if (!item) return;
    if (!confirm('Finalizar a reunião? Ela fica registrada como realizada, terminando agora.')) return;
    travarBotoes(true);
    try {
      const d = await acaoNaReuniao(item, 'finalizar');
      if (!d.ok) { alert(d.error || 'Não foi possível finalizar a reunião.'); return; }
      await depoisDeMudar(d.item);
    } catch (e) {
      alert(`Falha de conexão ao finalizar a reunião: ${e.message}`);
    } finally {
      travarBotoes(false);
    }
  }

  /** "Finalizar reunião" da janela de gravação. */
  async function finalizarGravando() {
    if (!gravacao) return;
    if (!confirm('Finalizar a reunião? A gravação termina e a reunião fica registrada como realizada, terminando agora.')) return;
    el('btn-gravacao-encerrar').disabled = true;
    el('btn-gravacao-pausar').disabled = true;

    const item = reuniao;
    await pararGravacao();
    let final;
    try {
      const d = await acaoNaReuniao(item, 'finalizar');
      if (!d.ok) throw new Error(d.error || 'erro');
      final = `Reunião finalizada: ${periodoReal(d.item)}. A transcrição ficou na reunião.`;
      await depoisDeMudar(d.item);
    } catch (e) {
      final = `A gravação terminou, mas a reunião não foi finalizada (${e.message}). Abra a reunião e clique em "Finalizar reunião".`;
      atualizarAviso();
    }
    el('gravacao-final').textContent = final;
    el('btn-gravacao-encerrar').disabled = false;
    el('btn-gravacao-pausar').disabled = false;
    mostrarPasso('encerrada');
  }

  /* ----------------------------------------------------------
     A janela de gravação
     ---------------------------------------------------------- */

  function mostrarPasso(passo) {
    ['gravando', 'encerrada'].forEach((p) =>
      el(`gravacao-${p}`)?.classList.toggle('hidden', p !== passo));
  }

  function desenharEstado() {
    const estado = el('gravacao-estado');
    if (!estado) return;
    const transcrevendo = fila.length;
    const desde = reuniao?.iniciada_em ? ` · iniciada às ${horaDe(reuniao.iniciada_em)}` : '';
    estado.innerHTML = `
      <span class="gravacao-ponto${pausado ? ' pausado' : ''}"></span>
      ${pausado ? 'Pausado' : 'Gravando'} · ${minSeg(segundos)}${esc(desde)}
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
      : (alvoId === 'gravacao-transcricao' ? '<p class="campo-ajuda">A transcrição aparece aqui, a cada ~20 segundos de fala.</p>' : '');
    alvo.scrollTop = alvo.scrollHeight;
  }

  function fechar() {
    if (gravacao) {
      alert('A reunião está sendo gravada. Use "Pausar" ou "Finalizar reunião".');
      return;
    }
    el('modal-gravacao').classList.add('hidden');
  }

  /* ----------------------------------------------------------
     Na janela da reunião: o andamento e a transcrição
     ---------------------------------------------------------- */

  const itemDaJanela = () => { try { return JSON.parse(el('agenda-gravacao').dataset.item); } catch (e) { return null; } };

  async function mostrarNaReuniao(item) {
    const bloco = el('agenda-gravacao');
    if (!bloco) return;
    // Só reunião que já existe: iniciar pede a reunião salva na agenda.
    const pode = item && item.tipo === 'reuniao' && item.status !== 'cancelada' && item.status !== 'remarcada';
    bloco.classList.toggle('hidden', !pode);
    if (!pode) return;
    bloco.dataset.item = JSON.stringify(item);
    el('agenda-transcricao').innerHTML = '';

    const andando = !!item.iniciada_em && !item.finalizada_em;
    const minha = andando && item.iniciada_por === eu();
    const podeIniciar = item.status === 'agendada' && !item.iniciada_em;

    const estado = el('agenda-gravacao-estado');
    estado.className = 'agenda-andamento';
    if (andando) {
      estado.classList.add('em-andamento');
      estado.textContent = `Em andamento desde ${horaDe(item.iniciada_em)} de ${dataDe(item.iniciada_em)}`
        + (minha ? '.' : `, iniciada por ${nomeDe(item.iniciada_por)}.`);
    } else if (item.finalizada_em) {
      estado.textContent = `Realizada em ${periodoReal(item)}.`;
    } else if (item.status === 'realizada') {
      estado.textContent = 'Realizada.';
    } else if (item.status === 'nao_compareceu') {
      estado.textContent = 'O lead não compareceu.';
    } else {
      estado.textContent = 'Ainda não iniciada.';
    }

    // Preparar (consentimento e áudio): para iniciar, ou para retomar a
    // gravação da reunião que eu iniciei.
    el('agenda-preparar').classList.toggle('hidden', !(podeIniciar || minha));
    el('btn-agenda-iniciar').classList.toggle('hidden', !podeIniciar);
    el('btn-agenda-retomar').classList.toggle('hidden', !minha);
    el('btn-agenda-finalizar').classList.toggle('hidden', !(andando && (minha || souAdmin())));
    el('gravacao-consentimento').checked = false;

    // Reunião online no computador: as duas vozes. No celular, ou em
    // reunião presencial/externa, um microfone só.
    const podeOnline = temTelaCompartilhada();
    el('gravacao-modo-online').disabled = !podeOnline;
    const online = podeOnline && item.local_tipo === 'online';
    el('gravacao-modo-online').checked = online;
    el('gravacao-modo-sala').checked = !online;
    el('gravacao-nota-celular').classList.toggle('hidden', podeOnline);

    if (podeIniciar || minha) {
      fetch('/api/gravacoes?disponivel=1').then((r) => r.json())
        .then((disp) => el('gravacao-sem-transcritor').classList.toggle('hidden', !!disp.transcritor))
        .catch(() => {});
    }

    try {
      const r = await fetch(`/api/gravacoes?reuniao_id=${item.id}`);
      const d = await r.json();
      const lista = d.trechos || [];
      if (lista.length) {
        estado.textContent += ` ${lista.length} trecho(s) transcrito(s).`;
        desenharTranscricao(lista, 'agenda-transcricao');
      }
    } catch (e) { /* a transcrição aparece ao reabrir */ }
  }

  /* ----------------------------------------------------------
     O aviso do canto: a reunião que eu iniciei e não finalizei
     ---------------------------------------------------------- */

  let emAndamento = null;

  async function atualizarAviso() {
    const aviso = el('aviso-em-andamento');
    if (!aviso) return;
    try {
      const d = await fetch('/api/agenda?em_andamento=1').then((r) => r.json());
      emAndamento = d.item || null;
    } catch (e) { return; }
    aviso.classList.toggle('hidden', !emAndamento);
    if (emAndamento) {
      aviso.innerHTML = `<span class="gravacao-ponto"></span><span>Reunião em andamento: <strong>${esc(emAndamento.lead_nome)}</strong>, desde ${esc(horaDe(emAndamento.iniciada_em))}</span>`;
      aviso.title = 'Abrir a reunião para finalizar';
    }
  }

  function iniciar() {
    el('btn-gravacao-pausar')?.addEventListener('click', alternarPausa);
    el('btn-gravacao-encerrar')?.addEventListener('click', finalizarGravando);
    el('btn-gravacao-fechar')?.addEventListener('click', fechar);
    el('btn-gravacao-concluir')?.addEventListener('click', fechar);
    el('btn-agenda-iniciar')?.addEventListener('click', iniciarReuniao);
    el('btn-agenda-retomar')?.addEventListener('click', retomar);
    el('btn-agenda-finalizar')?.addEventListener('click', finalizarDaJanela);
    el('aviso-em-andamento')?.addEventListener('click', () => {
      if (emAndamento && typeof Agenda !== 'undefined') Agenda.abrirJanela({ item: emAndamento });
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
  document.addEventListener('crm:autenticado', () => atualizarAviso(), { once: true });
  return { mostrarNaReuniao, atualizarAviso };
})();
