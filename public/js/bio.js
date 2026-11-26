/**
 * Tela BIO (2.45.0) — a página pública de contato (/bio).
 *
 * Três coisas:
 *   1. O link pronto para copiar e abrir.
 *   2. A prévia: a própria página, aberta em modo edição (/bio?editar=1).
 *      Cada imagem ganha um lápis; o clique chega aqui por postMessage.
 *   3. A janela de troca: escolhe a imagem, que é reduzida e comprimida
 *      AQUI, no navegador (o D1 guarda a imagem, e cada uma tem de caber
 *      com folga em 900 KB); nas soluções e postagens, também o link.
 *
 * A gravação é pela /api/bio, com login. A página pública só lê.
 */
const Bio = (() => {
  const el = (id) => document.getElementById(id);
  const dataBr = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '');

  // O maior lado de cada imagem, em pixels. Acima disto não melhora nada
  // na tela do celular e só pesa.
  const MAIOR_LADO = { 'avatar': 480, 'capa': 1600, 'solucao-1': 1280 };
  const maiorLado = (vaga) => MAIOR_LADO[vaga] || (vaga.startsWith('post-') ? 1080 : 720);
  const LIMITE_BYTES = 880 * 1024;

  const DICAS = {
    'avatar': 'Formato quadrado. Aparece recortada em círculo.',
    'capa': 'Formato largo (paisagem). Aparece como faixa no topo, recortada nas laterais no celular.',
    'solucao-1': 'Formato paisagem. Aparece grande, acima do texto da solução.'
  };
  const dica = (vaga) => DICAS[vaga]
    || (vaga.startsWith('post-') ? 'Formato retrato, como no feed do Instagram. Cole no link o endereço da postagem.' : 'Aparece pequena, à esquerda do título da solução.');

  let carregada = false;
  let vagas = new Map();        // vaga → resumo vindo da /api/bio
  let vagaAberta = null;
  let imagemNova = null;        // dataURL já comprimido, ou null

  const endereco = () => `${window.location.origin}/bio`;
  const quadro = () => el('bio-previa-quadro');

  async function carregarVagas() {
    try {
      const r = await fetch('/api/bio');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao ler a BIO.');
      vagas = new Map((d.vagas || []).map((v) => [v.vaga, v]));
      el('bio-aviso').textContent = d.aviso || '';
    } catch (e) {
      el('bio-aviso').textContent = e.message || 'Não foi possível carregar as imagens da BIO.';
    }
  }

  function aoEntrarNaTela() {
    if (carregada) return;
    carregada = true;

    const link = endereco();
    el('bio-link').value = link;
    el('btn-bio-abrir').href = link;
    quadro().src = '/bio?editar=1';
    carregarVagas();
  }

  function recarregarPrevia() {
    try { quadro().contentWindow.location.reload(); }
    catch (e) { quadro().src = `/bio?editar=1&t=${Date.now()}`; }
  }

  async function copiar() {
    const campo = el('bio-link');
    const aviso = el('bio-copiado');
    try {
      await navigator.clipboard.writeText(campo.value);
      aviso.textContent = 'Link copiado.';
    } catch (e) {
      // Sem acesso à área de transferência: deixa o texto selecionado
      // para a pessoa copiar com Ctrl+C.
      campo.select();
      aviso.textContent = 'Selecione e copie com Ctrl+C.';
    }
    clearTimeout(copiar.limpa);
    copiar.limpa = setTimeout(() => { aviso.textContent = ''; }, 2500);
  }

  /* ----------------------------------------------------------
     A janela de troca
     ---------------------------------------------------------- */

  function mostrarPrevia(src, texto) {
    const caixa = el('bio-modal-previa');
    caixa.textContent = '';
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Prévia da imagem';
      caixa.appendChild(img);
    } else {
      const p = document.createElement('p');
      p.className = 'bio-dica';
      p.textContent = texto || 'Sem imagem: a página usa o fundo padrão.';
      caixa.appendChild(p);
    }
  }

  async function abrir(vaga) {
    await carregarVagas();
    const v = vagas.get(vaga);
    if (!v) return;

    vagaAberta = vaga;
    imagemNova = null;
    el('bio-modal-titulo').textContent = v.rotulo;
    mostrarPrevia(v.temImagem ? `/publico/bio-imagem?vaga=${encodeURIComponent(vaga)}&v=${v.versao}` : null);
    el('bio-modal-meta').textContent = v.atualizadoEm
      ? `Última troca: ${dataBr(v.atualizadoEm)}, por ${v.atualizadoPor}.`
      : '';
    el('bio-modal-arquivo').textContent = '';
    el('bio-modal-dica').textContent = dica(vaga);
    el('bio-modal-link-caixa').classList.toggle('hidden', !v.aceitaLink);
    el('bio-modal-link').value = v.link || '';
    el('btn-bio-remover').classList.toggle('hidden', !(v.temImagem || v.link));
    el('bio-modal-erro').textContent = '';
    el('btn-bio-salvar').disabled = false;
    el('modal-bio').classList.remove('hidden');
  }

  function fechar() {
    el('modal-bio').classList.add('hidden');
    vagaAberta = null;
    imagemNova = null;
  }

  /** Lê a imagem, reduz ao maior lado da vaga e comprime (WebP; JPEG se o navegador não fizer WebP). */
  async function comprimir(arquivo, vaga) {
    const url = URL.createObjectURL(arquivo);
    try {
      const img = await new Promise((ok, falha) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => falha(new Error('Não foi possível ler esta imagem.'));
        i.src = url;
      });
      const escala = Math.min(1, maiorLado(vaga) / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

      const gerar = (tipo, q) => new Promise((ok) => canvas.toBlob(ok, tipo, q));
      for (const q of [0.85, 0.75, 0.65, 0.5]) {
        let blob = await gerar('image/webp', q);
        if (!blob || blob.type !== 'image/webp') blob = await gerar('image/jpeg', q);
        if (blob && blob.size <= LIMITE_BYTES) {
          const dataUrl = await new Promise((ok) => {
            const leitor = new FileReader();
            leitor.onload = () => ok(leitor.result);
            leitor.readAsDataURL(blob);
          });
          return { dataUrl, bytes: blob.size, largura: canvas.width, altura: canvas.height };
        }
      }
      throw new Error('A imagem continua grande demais mesmo comprimida. Tente outra.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function aoEscolherArquivo(arquivo) {
    if (!arquivo || !vagaAberta) return;
    el('bio-modal-erro').textContent = '';
    if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) {
      el('bio-modal-erro').textContent = 'Use uma imagem JPG, PNG ou WebP.';
      return;
    }
    el('bio-modal-arquivo').textContent = 'Preparando a imagem…';
    try {
      const r = await comprimir(arquivo, vagaAberta);
      imagemNova = r.dataUrl;
      mostrarPrevia(r.dataUrl);
      el('bio-modal-arquivo').textContent =
        `${arquivo.name} · ${r.largura}×${r.altura} px · ${Math.round(r.bytes / 1024)} KB`;
    } catch (e) {
      imagemNova = null;
      el('bio-modal-arquivo').textContent = '';
      el('bio-modal-erro').textContent = e.message;
    }
  }

  async function salvar() {
    const vaga = vagaAberta;
    const v = vagas.get(vaga);
    if (!vaga || !v) return;

    const corpo = {};
    if (imagemNova) corpo.imagem = imagemNova;
    if (v.aceitaLink) {
      const link = el('bio-modal-link').value.trim();
      if (link !== (v.link || '')) corpo.link = link;
    }
    if (!Object.keys(corpo).length) { fechar(); return; }

    el('btn-bio-salvar').disabled = true;
    el('bio-modal-erro').textContent = '';
    try {
      const r = await fetch(`/api/bio?vaga=${encodeURIComponent(vaga)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível salvar.');
      fechar();
      recarregarPrevia();
      carregarVagas();
    } catch (e) {
      el('bio-modal-erro').textContent = e.message || 'Falha de conexão ao salvar.';
      el('btn-bio-salvar').disabled = false;
    }
  }

  async function voltarAoPadrao() {
    const vaga = vagaAberta;
    const v = vagas.get(vaga);
    if (!vaga || !v) return;
    if (!confirm(`Tirar a imagem${v.aceitaLink ? ' e o link' : ''} de "${v.rotulo}"? A página volta ao padrão.`)) return;
    try {
      const r = await fetch(`/api/bio?vaga=${encodeURIComponent(vaga)}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível remover.');
      fechar();
      recarregarPrevia();
      carregarVagas();
    } catch (e) {
      el('bio-modal-erro').textContent = e.message || 'Falha de conexão ao remover.';
    }
  }

  function iniciar() {
    el('btn-bio-copiar')?.addEventListener('click', copiar);

    // O lápis da prévia. Só vale mensagem do próprio quadro da prévia.
    window.addEventListener('message', (ev) => {
      if (ev.origin !== window.location.origin) return;
      if (!quadro() || ev.source !== quadro().contentWindow) return;
      if (ev.data?.tipo === 'bio:editar' && typeof ev.data.vaga === 'string') abrir(ev.data.vaga);
    });

    el('btn-bio-escolher')?.addEventListener('click', () => {
      const campo = el('bio-arquivo');
      campo.value = '';
      campo.click();
    });
    el('bio-arquivo')?.addEventListener('change', (ev) => aoEscolherArquivo(ev.target.files?.[0]));
    el('btn-bio-salvar')?.addEventListener('click', salvar);
    el('btn-bio-remover')?.addEventListener('click', voltarAoPadrao);
    el('btn-bio-cancelar')?.addEventListener('click', fechar);
    el('btn-bio-fechar')?.addEventListener('click', fechar);
    el('modal-bio')?.addEventListener('click', (ev) => { if (ev.target === el('modal-bio')) fechar(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el('modal-bio')?.classList.contains('hidden')) {
        ev.stopImmediatePropagation();
        fechar();
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { aoEntrarNaTela };
})();
