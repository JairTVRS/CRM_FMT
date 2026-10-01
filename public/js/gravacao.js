/**
 * gravacao.js — iniciar, gravar e finalizar a reunião do lead
 * (gravação 2.35.0; iniciar e finalizar 2.36.0).
 *
 * Tudo acontece a partir da reunião da agenda, no bloco "Andamento da
 * reunião":
 *
 *   1. INICIAR: o consentimento vem marcado (2.36.1, pedido do Jair) e o
 *      CX clica em "Iniciar reunião". O CRM guarda a hora de início e JÁ
 *      COMEÇA A TRANSCREVER. Desmarcado, a reunião começa sem gravar.
 *      O áudio não se escolhe mais (2.36.1): no computador, grava o
 *      microfone (Formatar) e pede a aba da reunião (o lead), cada um uma
 *      "voz"; se não houver aba — presencial, ou Cancelar —, segue só com
 *      o microfone. No celular, só o microfone.
 *   2. GRAVAR: cada voz é captada por um AudioWorklet, que roda no
 *      processo de áudio do navegador e não perde som com a aba em
 *      segundo plano (2.36.1 — o ScriptProcessor de antes perdia ~35%, e
 *      o Whisper "inventava" o que faltava). O pedaço fecha na PAUSA da
 *      fala, entre 6 e 15 s (AudioWav.deveFechar), vira um WAV e vai para
 *      /api/gravacoes, que devolve o texto. O áudio não fica em lugar
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

  const LIMIAR_SILENCIO = 0.004;
  /**
   * Pedaço com menos que isto de VOZ não vai ao transcritor: com quase
   * nada para ouvir, o Whisper inventa ("Obrigado. Obrigado. Obrigado.").
   */
  const FALA_MINIMA_S = 0.8;
  /** De quanto em quanto tempo a frase em curso é mostrada, crescendo. */
  const PROVISORIO_A_CADA_S = 3;
  /** Sem som nenhum por tanto tempo, a voz da aba ganha um aviso. */
  const SEGUNDOS_SEM_SOM = 20;
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
  let vozes = [];            // ver criarVoz
  let gravacao = null;       // o registro do servidor
  let reuniao = null;        // o item da agenda
  let pausado = false;
  let relogio = null;        // só redesenha a janela; o corte vem do áudio
  let travaTela = null;
  let fila = [];
  let enviando = false;
  let trechos = [];          // o que já voltou transcrito, para desenhar
  // Texto provisório da frase que acabou de fechar e ainda está na fila:
  // continua na tela, em cinza, até o definitivo chegar (2.36.1).
  const pendentes = new Map();

  /**
   * O coletor roda no processo de áudio e manda blocos de ~85 ms para a
   * página. Mensagem não se perde nem é atrasada como um setInterval de
   * aba em segundo plano — por isso o corte dos pedaços é decidido aqui,
   * pelo áudio que chega, e não por relógio.
   */
  const CODIGO_COLETOR = `
    class ColetorCrm extends AudioWorkletProcessor {
      constructor() { super(); this.bloco = new Float32Array(4096); this.n = 0; }
      process(entradas) {
        const canal = entradas[0] && entradas[0][0];
        if (canal) {
          for (let i = 0; i < canal.length; i++) {
            this.bloco[this.n++] = canal[i];
            if (this.n === this.bloco.length) {
              this.port.postMessage(this.bloco);
              this.bloco = new Float32Array(4096);
              this.n = 0;
            }
          }
        }
        return true;
      }
    }
    registerProcessor('coletor-crm', ColetorCrm);`;

  async function prepararContexto() {
    contexto = new (window.AudioContext || window.webkitAudioContext)();
    // Criado depois de várias esperas (permissões, servidor): o navegador
    // pode deixá-lo suspenso até alguém mandar seguir.
    try { await contexto.resume(); } catch (e) { /* segue */ }
    if (contexto.audioWorklet) {
      const url = URL.createObjectURL(new Blob([CODIGO_COLETOR], { type: 'application/javascript' }));
      try { await contexto.audioWorklet.addModule(url); return true; }
      catch (e) { return false; }
      finally { URL.revokeObjectURL(url); }
    }
    return false;
  }

  /**
   * Uma voz por fonte de áudio. `blocos` é o pedaço em curso;
   * `nivel` (0–1) alimenta o medidor da janela.
   */
  function criarVoz(stream, origem, comColetor) {
    const fonte = contexto.createMediaStreamSource(stream);
    const voz = {
      origem, stream, fonte, blocos: [], amostrasPedaco: 0, amostrasTotais: 0, seq: 0,
      pausa: 0, fala: 0, nivel: 0, ultimoSom: Date.now(), avisouMudo: false,
      provisorio: null, provisorioEm: 0, pedindo: false
    };
    const receber = (bloco) => {
      if (pausado || !gravacao) return;
      voz.blocos.push(bloco);
      voz.amostrasPedaco += bloco.length;
      const volume = AudioWav.rms(bloco);
      voz.nivel = Math.max(volume, voz.nivel * 0.8);
      if (volume >= LIMIAR_SILENCIO) voz.ultimoSom = Date.now();
      const dur = bloco.length / contexto.sampleRate;
      voz.pausa = volume < AudioWav.CORTE.limiar ? voz.pausa + dur : 0;
      if (volume >= AudioWav.CORTE.limiar) voz.fala += dur;
      if (AudioWav.deveFechar({ segundos: voz.amostrasPedaco / contexto.sampleRate, pausa: voz.pausa })) {
        fecharPedaco(voz);
        enviarFila();
      }
    };

    let no;
    if (comColetor) {
      no = new AudioWorkletNode(contexto, 'coletor-crm');
      no.port.onmessage = (ev) => receber(ev.data);
    } else {
      // Navegador sem AudioWorklet: o caminho antigo, que pode perder som.
      no = contexto.createScriptProcessor(4096, 1, 1);
      no.onaudioprocess = (ev) => receber(new Float32Array(ev.inputBuffer.getChannelData(0)));
    }
    // Mudo: o nó precisa estar ligado a um destino para rodar, mas o CX
    // não pode ouvir o próprio microfone de volta.
    const mudo = contexto.createGain();
    mudo.gain.value = 0;
    fonte.connect(no);
    no.connect(mudo);
    mudo.connect(contexto.destination);
    voz.no = no;
    return voz;
  }

  /** Fecha o pedaço em curso de uma voz e o põe na fila de envio. */
  function fecharPedaco(voz) {
    if (!voz.blocos.length) return;
    const bruto = AudioWav.juntar(voz.blocos);
    const fala = voz.fala;
    const provisorio = voz.provisorio;
    voz.blocos = [];
    voz.amostrasPedaco = 0;
    voz.pausa = 0;
    voz.fala = 0;
    voz.provisorio = null;
    voz.provisorioEm = 0;
    const inicio = voz.amostrasTotais / contexto.sampleRate;
    voz.amostrasTotais += bruto.length;
    const fim = voz.amostrasTotais / contexto.sampleRate;

    const amostras = AudioWav.reamostrar(bruto, contexto.sampleRate);
    const seq = voz.seq++;
    // Silêncio, ou quase nenhuma voz: não sai daqui.
    if (fala < FALA_MINIMA_S || AudioWav.rms(amostras) < LIMIAR_SILENCIO) { desenharAoVivo(); return; }

    const chave = `${voz.origem}:${seq}`;
    if (provisorio) pendentes.set(chave, provisorio);
    fila.push({
      chave, origem: voz.origem, seq, inicio_s: Math.round(inicio * 10) / 10, fim_s: Math.round(fim * 10) / 10,
      audio: AudioWav.base64(AudioWav.paraWav(amostras)), tentativas: 0
    });
  }

  /**
   * A frase em curso, para a tela (2.36.1): a cada ~3 s de áudio novo, o
   * pedaço inteiro até ali vai ao transcritor como PROVISÓRIO (não é
   * salvo) e aparece em cinza, crescendo. Quando a frase fecha na pausa,
   * o texto definitivo toma o lugar. Com a aba do CRM escondida (o CX na
   * aba do Meet), não pede — ninguém está olhando, e economiza.
   */
  function pedirProvisorios() {
    if (pausado || !gravacao || document.hidden) return;
    for (const voz of vozes) {
      const taxa = contexto.sampleRate;
      if (voz.pedindo || voz.fala < 1) continue;
      if ((voz.amostrasPedaco - voz.provisorioEm) / taxa < PROVISORIO_A_CADA_S) continue;
      voz.provisorioEm = voz.amostrasPedaco;
      voz.pedindo = true;
      const seq = voz.seq;
      const inicio = Math.round((voz.amostrasTotais / taxa) * 10) / 10;
      const amostras = AudioWav.reamostrar(AudioWav.juntar(voz.blocos), taxa);
      fetch(`/api/gravacoes?id=${gravacao.id}&trecho=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provisorio: true, origem: voz.origem, seq, inicio_s: inicio,
          audio: AudioWav.base64(AudioWav.paraWav(amostras)) })
      }).then((r) => r.json()).then((d) => {
        // A frase pode ter fechado enquanto isto voltava: aí não vale mais.
        if (voz.seq === seq && d.texto) {
          voz.provisorio = { origem: voz.origem, inicio_s: inicio, texto: d.texto, provisorio: true };
          desenharAoVivo();
        }
      }).catch(() => { /* provisório: o definitivo vem de qualquer jeito */ })
        .finally(() => { voz.pedindo = false; });
    }
  }

  /** A conversa ao vivo: o definitivo, o que está na fila e a frase em curso. */
  function desenharAoVivo() {
    desenharTranscricao([
      ...trechos,
      ...pendentes.values(),
      ...vozes.map((v) => v.provisorio).filter(Boolean)
    ]);
  }

  /** Fecha o pedaço de todas as vozes (pausa, fim). */
  function fecharPedacos() {
    vozes.forEach(fecharPedaco);
    enviarFila();
  }

  /** Segundos gravados (sem as pausas), contados pelo áudio do microfone. */
  const segundosGravados = () => {
    const v = vozes[0];
    return v && contexto ? (v.amostrasTotais + v.amostrasPedaco) / contexto.sampleRate : 0;
  };

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
        pendentes.delete(pedaco.chave);
        if (d.texto) trechos.push({ gravacao_id: gravacao.id, origem: pedaco.origem, inicio_s: pedaco.inicio_s, texto: d.texto });
        desenharAoVivo();
      } catch (e) {
        pedaco.tentativas++;
        if (pedaco.tentativas >= 3) {
          fila.shift();
          pendentes.delete(pedaco.chave);
          desenharAoVivo();
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
   * coisa: sem o microfone, a reunião não é iniciada.
   *
   * O CX não escolhe mais de onde vem o áudio (2.36.1): no computador
   * grava o microfone E pede a TELA INTEIRA com o áudio do sistema. O
   * navegador não deixa um site pegar o som do computador sem perguntar
   * — a janelinha é inevitável —, então ela já vem pedindo a tela e
   * oferecendo o áudio do sistema. Cancelou, ou compartilhou sem áudio:
   * segue só com o microfone, avisando, em vez de travar.
   * @returns {{microfone, aba, modo, aviso}|null}
   */
  async function pedirAudio() {
    let microfone;
    try {
      microfone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      alert(`O navegador não liberou o microfone: ${e.message}`);
      return null;
    }
    if (!temTelaCompartilhada()) return { microfone, aba: null, modo: 'presencial', aviso: null };

    let aba = null;
    let aviso = null;
    try {
      // TELA INTEIRA com o áudio do sistema (pedido de 30/09/2026): entra o
      // som de qualquer aba ou programa — Meet no navegador, Teams ou Zoom
      // instalados — sem depender de o CX acertar a aba. O vídeo não é
      // usado: 1 quadro por segundo, pequeno, para não pesar.
      aba = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor', frameRate: 1, width: 320 },
        audio: { suppressLocalAudioPlayback: false },
        systemAudio: 'include',                   // oferece "Compartilhar áudio do sistema"
        monitorTypeSurfaces: 'include',
        selfBrowserSurface: 'include',
        surfaceSwitching: 'include'
      });
      if (!aba.getAudioTracks().length) {
        aba.getTracks().forEach((t) => t.stop());
        aba = null;
        aviso = 'A tela foi compartilhada sem o áudio do sistema: gravando só o seu microfone. Na próxima, ative "Compartilhar áudio do sistema" na janela do navegador.';
      }
    } catch (e) {
      aba = null;
      aviso = 'Nada foi compartilhado: gravando só o microfone (o lead entra se estiver na mesma sala).';
    }
    return { microfone, aba, modo: aba ? 'online' : 'presencial', aviso };
  }

  /** Cria a gravação no servidor e começa a captar. Falhou: false. */
  async function comecarGravacao(item, audio) {
    const modo = audio.modo;
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
    pausado = false;
    trechos = [];
    fila = [];
    pendentes.clear();
    const comColetor = await prepararContexto();
    vozes = [criarVoz(audio.microfone, modo === 'online' ? 'formatar' : 'sala', comColetor)];
    if (audio.aba) {
      vozes.push(criarVoz(new MediaStream(audio.aba.getAudioTracks()), 'lead', comColetor));
      // Se o CX parar de compartilhar pela barra do navegador, a voz do
      // lead acaba — avisa em vez de gravar só um lado sem ninguém saber.
      audio.aba.getAudioTracks()[0].addEventListener('ended', () => avisar('O compartilhamento da aba terminou: o áudio do lead não está mais sendo gravado.'));
      vozes[1].extras = audio.aba;
    }

    await manterTelaAcesa();
    // Só a janela: o medidor e o relógio. O corte dos pedaços vem do áudio.
    relogio = setInterval(() => {
      for (const voz of vozes) voz.nivel *= 0.85;
      vigiarAba();
      pedirProvisorios();
      desenharEstado();
    }, 300);

    window.addEventListener('beforeunload', segurarSaida);
    el('gravacao-titulo').textContent = `Reunião em andamento — ${item.lead_nome || ''}`;
    el('gravacao-avisos').innerHTML = '';
    el('btn-gravacao-pausar').textContent = 'Pausar';
    mostrarPasso('gravando');
    desenharTranscricao([]);
    desenharEstado();
    if (audio.aviso) avisar(audio.aviso);
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

  /**
   * A aba compartilhada sem som nenhum por um tempo: quase sempre é a
   * janela errada, ou o "Compartilhar áudio" desmarcado. Avisa uma vez,
   * enquanto ainda dá para arrumar — e não no fim, com a transcrição só
   * de um lado.
   */
  function vigiarAba() {
    const aba = vozes.find((v) => v.origem === 'lead');
    if (!aba || pausado || aba.avisouMudo) return;
    if (Date.now() - aba.ultimoSom > SEGUNDOS_SEM_SOM * 1000) {
      aba.avisouMudo = true;
      avisar(`O som do computador está mudo há ${SEGUNDOS_SEM_SOM} s: o lado do lead não está chegando. Confira se a reunião está tocando neste computador e se "Compartilhar áudio do sistema" foi ativado ao iniciar.`);
    }
  }

  /** Para de captar, manda o que falta e encerra a gravação no servidor. */
  async function pararGravacao() {
    clearInterval(relogio);
    const segundos = segundosGravados();
    fecharPedacos();
    pausado = true;
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
    return { consentimento: el('gravacao-consentimento').checked };
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

    const { consentimento } = lerPreparo();
    let audio = null;
    if (!consentimento && !confirm('A caixa "O lead concordou com a gravação" não está marcada.\n\nIniciar a reunião SEM gravar?')) return;

    travarBotoes(true);
    try {
      if (consentimento) {
        audio = await pedirAudio();
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
      if (audio) await comecarGravacao(d.item, audio);
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
    const { consentimento } = lerPreparo();
    if (!consentimento) { alert('Marque que o lead concordou com a gravação.'); return; }
    travarBotoes(true);
    try {
      const audio = await pedirAudio();
      if (audio) await comecarGravacao(item, audio);
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

  const ROTULO_MEDIDOR = { formatar: 'Seu microfone', sala: 'Microfone', lead: 'Som do computador (lead)' };

  function desenharEstado() {
    const estado = el('gravacao-estado');
    if (!estado) return;
    const transcrevendo = fila.length;
    const desde = reuniao?.iniciada_em ? ` · iniciada às ${horaDe(reuniao.iniciada_em)}` : '';
    estado.innerHTML = `
      <span class="gravacao-ponto${pausado ? ' pausado' : ''}"></span>
      ${pausado ? 'Pausado' : 'Gravando'} · ${minSeg(segundosGravados())}${esc(desde)}
      ${transcrevendo ? ` · ${transcrevendo} pedaço(s) transcrevendo` : ''}`;

    // Um medidor por voz: se a barra da aba não mexe, o lead não está
    // sendo gravado — dá para ver na hora, em vez de descobrir no fim.
    const medidores = el('gravacao-medidores');
    if (medidores) {
      medidores.innerHTML = vozes.map((v) => {
        const pct = Math.min(100, Math.round(Math.sqrt(v.nivel / 0.15) * 100));
        return `<div class="medidor"><span>${esc(ROTULO_MEDIDOR[v.origem] || v.origem)}</span>
          <span class="medidor-barra"><span style="width:${pausado ? 0 : pct}%"></span></span></div>`;
      }).join('');
    }
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
          <p class="trecho origem-${esc(t.origem)}${t.provisorio ? ' provisorio' : ''}">
            <span class="trecho-quando">${minSeg(t.inicio_s)}</span>
            ${ROTULO_ORIGEM[t.origem] ? `<strong>${esc(ROTULO_ORIGEM[t.origem])}:</strong>` : ''}
            ${esc(t.texto)}
          </p>`).join('')
      : (alvoId === 'gravacao-transcricao' ? '<p class="campo-ajuda">A conversa aparece aqui enquanto vocês falam: em cinza enquanto a frase está em curso, firme quando ela termina.</p>' : '');
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
    // Na reunião nova, o bloco aparece só para dizer isso (2.36.1) — sem
    // ele, quem procura "Iniciar" na janela de agendar não acha nada.
    if (!item) {
      bloco.classList.remove('hidden');
      delete bloco.dataset.item;
      el('agenda-gravacao-estado').className = 'agenda-andamento';
      el('agenda-gravacao-estado').textContent = 'Salve a reunião e abra-a de novo na agenda: "Iniciar reunião" aparece aqui.';
      ['agenda-preparar', 'btn-agenda-iniciar', 'btn-agenda-retomar', 'btn-agenda-finalizar'].forEach((id) => el(id).classList.add('hidden'));
      el('agenda-transcricao').innerHTML = '';
      return;
    }
    const pode = item.tipo === 'reuniao' && item.status !== 'cancelada' && item.status !== 'remarcada';
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
    // Já marcado (2.36.1, pedido do Jair): desmarcar é que é a exceção.
    el('gravacao-consentimento').checked = true;

    // No celular não há aba para compartilhar: só o microfone.
    const computador = temTelaCompartilhada();
    el('gravacao-nota-audio').classList.toggle('hidden', !computador);
    el('gravacao-nota-celular').classList.toggle('hidden', computador);

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
