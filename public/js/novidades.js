/**
 * novidades.js — o que mudou em cada versão (2.34.2).
 *
 * O número da versão fica no canto inferior esquerdo (o auth.js o
 * escreve a partir do /api/config). Clicar nele abre a lista de
 * `public/novidades.json`, da mais nova para a mais antiga, com a versão
 * em uso marcada.
 *
 * O arquivo é estático e não passa pela /api/: não precisa de login e
 * não gasta o banco. A prova ids.mjs confere que a primeira entrada é a
 * versão do package.json, para a lista nunca ficar para trás.
 */

const Novidades = (() => {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let lista = null;

  async function abrir() {
    const alvo = el('novidades-lista');
    el('modal-novidades').classList.remove('hidden');
    if (!lista) {
      alvo.innerHTML = '<div class="coluna-vazia">Carregando…</div>';
      try {
        const r = await fetch('/novidades.json', { cache: 'no-cache' });
        lista = (await r.json()).versoes || [];
      } catch (e) {
        alvo.innerHTML = '<div class="coluna-vazia">Não foi possível carregar o histórico.</div>';
        return;
      }
    }

    // A versão em uso é a do rodapé (vinda do servidor), sem o "v".
    const emUso = String(el('app-version')?.textContent || '').replace(/^v/, '').split(' ')[0];
    alvo.innerHTML = lista.map((v) => `
      <section class="novidade${v.versao === emUso ? ' atual' : ''}">
        <header class="novidade-topo">
          <strong>v${esc(v.versao)}</strong>
          <span>${esc(v.data)}</span>
          ${v.versao === emUso ? '<span class="novidade-selo">em uso</span>' : ''}
        </header>
        <div class="novidade-titulo">${esc(v.titulo)}</div>
        <ul>${(v.itens || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      </section>`).join('');
  }

  const fechar = () => el('modal-novidades')?.classList.add('hidden');

  function iniciar() {
    el('app-version')?.addEventListener('click', abrir);
    el('btn-novidades-fechar')?.addEventListener('click', fechar);
    el('modal-novidades')?.addEventListener('click', (ev) => { if (ev.target === el('modal-novidades')) fechar(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el('modal-novidades')?.classList.contains('hidden')) fechar();
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
  return { abrir };
})();
