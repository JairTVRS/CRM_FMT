/**
 * roteiros.js — o roteiro de cada tipo de reunião (2.34.0).
 *
 * Três lugares:
 *   1. O cartão "Roteiros de reunião" das Configurações: cada tipo de
 *      reunião do Time Vendas, a versão em vigor, "Ver" e — para admin —
 *      "Enviar .md". Desde a 2.38.0, dois arquivos por tipo: o ROTEIRO e
 *      a INSTRUÇÃO DO DOSSIÊ DA REUNIÃO (finalidade 'dossie_reuniao').
 *   2. A janela de leitura, com o seletor de versões.
 *   3. Dentro da reunião da agenda: "Roteiro: v2 — Ver", para o CX
 *      estudar junto com o dossiê.
 *
 * Carregar DEPOIS do agenda.js.
 */

const Roteiros = (() => {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const dataBr = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');

  let emVigor = new Map();     // 'tipo|finalidade' → resumo da versão em vigor
  const chave = (tipo, finalidade = 'roteiro') => `${tipo}|${finalidade}`;
  const NOME = { roteiro: 'Roteiro', dossie_reuniao: 'Instrução do dossiê da reunião' };
  let tiposVendas = [];

  async function carregar() {
    try {
      const [rr, rt] = await Promise.all([fetch('/api/roteiros'), fetch('/api/agenda?tipos=1')]);
      const dr = await rr.json();
      const dt = await rt.json();
      emVigor = new Map((dr.roteiros || []).map((x) => [chave(x.tipo_reuniao_erp_id, x.finalidade || 'roteiro'), x]));
      tiposVendas = dt.tipos || [];
      return { aviso: dr.aviso || dt.aviso || null };
    } catch (e) {
      return { aviso: 'Não foi possível carregar os roteiros.' };
    }
  }

  /* ----------------------------------------------------------
     1. Configurações
     ---------------------------------------------------------- */

  let tipoDoEnvio = null;

  async function montarConfig() {
    const lista = el('roteiros-lista');
    if (!lista) return;
    const { aviso } = await carregar();
    const admin = typeof Auth !== 'undefined' && Auth.usuario?.admin;

    // Os tipos do hub, mais algum que tenha roteiro e saiu do Time Vendas.
    const tipos = [...tiposVendas];
    for (const r of emVigor.values()) {
      const id = r.tipo_reuniao_erp_id;
      if (!tipos.some((t) => t.erp_id === id)) tipos.push({ erp_id: id, nome: `${r.tipo_reuniao_nome || id} (fora do Time Vendas)` });
    }

    if (!tipos.length) {
      lista.innerHTML = `<p class="campo-ajuda">${esc(aviso || 'Nenhum tipo de reunião no Time Vendas do hub.')}</p>`;
      return;
    }

    // Por tipo, os dois arquivos: o roteiro e a instrução do dossiê (2.38.0).
    const arquivo = (t, finalidade) => {
      const r = emVigor.get(chave(t.erp_id, finalidade));
      return `
        <div class="roteiro-linha" data-tipo="${esc(t.erp_id)}" data-nome="${esc(t.nome)}" data-finalidade="${finalidade}">
          <div class="roteiro-linha-info">
            <span class="roteiro-finalidade">${esc(NOME[finalidade])}</span>
            <span>${r ? `versão ${r.versao} · ${dataBr(r.enviado_em)} · ${esc(r.enviado_por)}${r.nome_arquivo ? ` · ${esc(r.nome_arquivo)}` : ''}` : 'não enviado'}</span>
          </div>
          <div class="roteiro-linha-acoes">
            ${r ? '<button type="button" class="btn btn-sm btn-secondary" data-acao="ver">Ver</button>' : ''}
            ${admin ? `<button type="button" class="btn btn-sm btn-primary" data-acao="enviar">${r ? 'Enviar nova versão' : 'Enviar .md'}</button>` : ''}
          </div>
        </div>`;
    };
    lista.innerHTML = tipos.map((t) => `
      <div class="roteiro-tipo">
        <strong>${esc(t.nome)}</strong>
        ${arquivo(t, 'roteiro')}
        ${arquivo(t, 'dossie_reuniao')}
      </div>`).join('') + (aviso ? `<p class="campo-ajuda">${esc(aviso)}</p>` : '');
  }

  async function enviarArquivo(arquivo) {
    if (!arquivo || !tipoDoEnvio) return;
    if (!/\.(md|markdown|txt)$/i.test(arquivo.name)) { alert('Envie o arquivo como .md.'); return; }
    if (arquivo.size > 400_000) { alert('O arquivo é grande demais.'); return; }

    const conteudo = await arquivo.text();
    try {
      const r = await fetch('/api/roteiros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo_reuniao_erp_id: tipoDoEnvio.id,
          tipo_reuniao_nome: tipoDoEnvio.nome,
          finalidade: tipoDoEnvio.finalidade,
          nome_arquivo: arquivo.name,
          conteudo
        })
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Não foi possível enviar o arquivo.'); return; }
      alert(`${NOME[tipoDoEnvio.finalidade]} de "${tipoDoEnvio.nome}" salvo como versão ${d.versao}.`);
      await montarConfig();
    } catch (e) {
      alert('Falha de conexão ao enviar o arquivo.');
    }
  }

  /* ----------------------------------------------------------
     2. A janela de leitura
     ---------------------------------------------------------- */

  let tipoNaJanela = null;

  async function abrir(tipoId, tipoNome, versao = null, finalidade = 'roteiro') {
    tipoNaJanela = { id: tipoId, nome: tipoNome, finalidade };
    el('roteiro-titulo').textContent = `${NOME[finalidade]} — ${tipoNome || 'reunião'}`;
    el('roteiro-texto').textContent = 'Carregando…';
    el('roteiro-meta').textContent = '';
    el('modal-roteiro').classList.remove('hidden');

    try {
      const q = new URLSearchParams({ tipo: tipoId, finalidade });
      if (versao) q.set('versao', versao);
      const [r, h] = await Promise.all([
        fetch(`/api/roteiros?${q}`).then((x) => x.json()),
        fetch(`/api/roteiros?tipo=${encodeURIComponent(tipoId)}&finalidade=${finalidade}&historico=1`).then((x) => x.json())
      ]);
      if (!r.roteiro) { el('roteiro-texto').textContent = r.error || 'Sem arquivo.'; return; }

      const versoes = h.versoes || [];
      el('roteiro-versao').innerHTML = versoes.map((v, i) =>
        `<option value="${v.versao}">Versão ${v.versao}${i === 0 ? ' (em vigor)' : ''}</option>`).join('');
      el('roteiro-versao').value = String(r.roteiro.versao);
      el('roteiro-meta').textContent = `enviada em ${dataBr(r.roteiro.enviado_em)} por ${r.roteiro.enviado_por}`
        + (r.roteiro.nome_arquivo ? ` · ${r.roteiro.nome_arquivo}` : '');
      el('roteiro-texto').textContent = r.roteiro.conteudo;
    } catch (e) {
      el('roteiro-texto').textContent = 'Não foi possível carregar o arquivo.';
    }
  }

  function fechar() { el('modal-roteiro')?.classList.add('hidden'); }

  /* ----------------------------------------------------------
     3. Dentro da reunião
     ---------------------------------------------------------- */

  /** Chamado pela janela da agenda quando o tipo de reunião muda. */
  function mostrarNaReuniao(tipoId, tipoNome) {
    const alvo = el('agenda-roteiro');
    if (!alvo) return;
    if (!tipoId) { alvo.textContent = ''; alvo.classList.add('hidden'); return; }
    alvo.classList.remove('hidden');
    const r = emVigor.get(chave(tipoId));
    alvo.innerHTML = r
      ? `Roteiro: versão ${r.versao}, de ${dataBr(r.enviado_em)}. <button type="button" class="btn btn-sm btn-secondary" data-roteiro-ver>Ver o roteiro</button>`
      : '<span class="campo-ajuda">Este tipo de reunião ainda não tem roteiro (Configurações → Roteiros).</span>';
    alvo.dataset.tipo = tipoId;
    alvo.dataset.nome = tipoNome || r?.tipo_reuniao_nome || '';
  }

  function iniciar() {
    el('roteiros-lista')?.addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-acao]');
      const linha = botao?.closest('[data-tipo]');
      if (!botao || !linha) return;
      const finalidade = linha.dataset.finalidade || 'roteiro';
      if (botao.dataset.acao === 'ver') abrir(linha.dataset.tipo, linha.dataset.nome, null, finalidade);
      if (botao.dataset.acao === 'enviar') {
        tipoDoEnvio = { id: linha.dataset.tipo, nome: linha.dataset.nome.replace(/ \(fora do Time Vendas\)$/, ''), finalidade };
        const campo = el('roteiro-arquivo');
        campo.value = '';
        campo.click();
      }
    });
    el('roteiro-arquivo')?.addEventListener('change', (ev) => enviarArquivo(ev.target.files?.[0]));

    el('roteiro-versao')?.addEventListener('change', (ev) => {
      if (tipoNaJanela) abrir(tipoNaJanela.id, tipoNaJanela.nome, ev.target.value, tipoNaJanela.finalidade);
    });
    el('btn-roteiro-fechar')?.addEventListener('click', fechar);
    el('modal-roteiro')?.addEventListener('click', (ev) => { if (ev.target === el('modal-roteiro')) fechar(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el('modal-roteiro')?.classList.contains('hidden')) {
        ev.stopImmediatePropagation();
        fechar();
      }
    }, true);

    el('agenda-roteiro')?.addEventListener('click', (ev) => {
      if (!ev.target.closest('[data-roteiro-ver]')) return;
      const alvo = el('agenda-roteiro');
      abrir(alvo.dataset.tipo, alvo.dataset.nome);
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
  document.addEventListener('crm:autenticado', () => carregar(), { once: true });

  return { montarConfig, mostrarNaReuniao, abrir };
})();
