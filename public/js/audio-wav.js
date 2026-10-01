/**
 * audio-wav.js — o áudio da gravação vira WAV 16 kHz mono (2.35.0).
 *
 * Por que WAV feito à mão, e não o MediaRecorder: o MediaRecorder entrega
 * WebM/Opus, e cortar um WebM em pedaços de 20 s deixa só o primeiro com
 * cabeçalho — os outros não se decodificam sozinhos. Aqui cada pedaço é
 * um WAV completo, que qualquer transcritor aceita, e o corte é exato
 * (sem buracos entre um pedaço e o seguinte).
 *
 * 16 kHz mono é o que o Whisper usa por dentro: mandar mais seria só
 * mais bytes pela rede.
 *
 * Funções puras, sem DOM — testadas na prova gravacao.mjs.
 */

const AudioWav = (() => {
  const TAXA_ALVO = 16000;

  /** Junta os blocos Float32 que o áudio entrega em um só. */
  function juntar(blocos) {
    const total = blocos.reduce((n, b) => n + b.length, 0);
    const saida = new Float32Array(total);
    let pos = 0;
    for (const b of blocos) { saida.set(b, pos); pos += b.length; }
    return saida;
  }

  /**
   * Reamostra para 16 kHz pela média de cada janela: simples, e a média
   * já filtra o que ficaria acima da nova frequência de Nyquist.
   */
  function reamostrar(amostras, taxaOrigem, taxaAlvo = TAXA_ALVO) {
    if (taxaOrigem === taxaAlvo) return amostras;
    const razao = taxaOrigem / taxaAlvo;
    const tamanho = Math.floor(amostras.length / razao);
    const saida = new Float32Array(tamanho);
    for (let i = 0; i < tamanho; i++) {
      const ini = Math.floor(i * razao);
      const fim = Math.min(amostras.length, Math.floor((i + 1) * razao));
      let soma = 0;
      for (let j = ini; j < fim; j++) soma += amostras[j];
      saida[i] = fim > ini ? soma / (fim - ini) : 0;
    }
    return saida;
  }

  /** O "volume" médio do pedaço: abaixo de um limiar, é silêncio. */
  function rms(amostras) {
    if (!amostras.length) return 0;
    let soma = 0;
    for (let i = 0; i < amostras.length; i++) soma += amostras[i] * amostras[i];
    return Math.sqrt(soma / amostras.length);
  }

  /** Float32 [-1, 1] → WAV PCM 16 bits mono, com cabeçalho de 44 bytes. */
  function paraWav(amostras, taxa = TAXA_ALVO) {
    const dados = amostras.length * 2;
    const buffer = new ArrayBuffer(44 + dados);
    const v = new DataView(buffer);
    const texto = (pos, t) => { for (let i = 0; i < t.length; i++) v.setUint8(pos + i, t.charCodeAt(i)); };

    texto(0, 'RIFF'); v.setUint32(4, 36 + dados, true); texto(8, 'WAVE');
    texto(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);   // PCM
    v.setUint16(22, 1, true);                                                  // mono
    v.setUint32(24, taxa, true); v.setUint32(28, taxa * 2, true);              // taxa, bytes/s
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);                       // bloco, bits
    texto(36, 'data'); v.setUint32(40, dados, true);

    let pos = 44;
    for (let i = 0; i < amostras.length; i++, pos += 2) {
      const s = Math.max(-1, Math.min(1, amostras[i]));
      v.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buffer);
  }

  /**
   * ONDE CORTAR O PEDAÇO (2.36.1). Antes era a cada 20 s fixos, e o corte
   * partia palavras ao meio — o Whisper erra a borda de cada pedaço.
   * Agora o pedaço fecha na primeira PAUSA da fala depois de um mínimo,
   * ou no teto, se a pessoa não parar de falar.
   *
   * @param estado  { segundos: duração do pedaço, pausa: segundos seguidos
   *                  de silêncio no fim dele }
   * 2.36.6 (teste presencial de 01/10/2026): com fala contínua quase todo
   * pedaço batia no teto de 15 s, e a frase firme chegava 10–28 s depois
   * de dita. Pedaços menores: fecham na pausa a partir de 3 s, numa
   * respiração (0,25 s) a partir de 5 s, e no máximo aos 8 s.
   *
   * @returns true se é hora de fechar
   */
  const CORTE = { minimo: 3, teto: 8, pausa: 0.6, meio: 5, respiro: 0.25, limiar: 0.008 };
  function deveFechar({ segundos, pausa }, regra = CORTE) {
    return segundos >= regra.teto
      || (segundos >= regra.minimo && pausa >= regra.pausa)
      || (segundos >= regra.meio && pausa >= regra.respiro);
  }

  /** Bytes → base64, em fatias: um `apply` com 800 mil argumentos estoura a pilha. */
  function base64(bytes) {
    let bin = '';
    const FATIA = 0x8000;
    for (let i = 0; i < bytes.length; i += FATIA) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + FATIA));
    }
    return btoa(bin);
  }

  return { TAXA_ALVO, CORTE, juntar, reamostrar, rms, paraWav, base64, deveFechar };
})();

// Para a prova em Node (o navegador ignora).
if (typeof module !== 'undefined') module.exports = AudioWav;
