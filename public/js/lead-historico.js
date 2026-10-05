/**
 * lead-historico.js — o relógio da ficha do lead (2.41.0).
 *
 * Pedido do Jair em 05/10/2026: no canto superior direito da ficha, o
 * registro das alterações e movimentações do cadastro — quem, data e
 * horário, como estava e como ficou.
 *
 * O servidor (/api/leads?eventos=ID) já devolve tudo em texto: nomes de
 * etapa, de usuário, valores em reais. Aqui só se desenha, no mesmo
 * painel lateral do histórico da agenda (2.36.5).
 *
 * Carregar DEPOIS do leads.js.
 */

const LeadHistorico = (() => {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const quando = (iso) => (iso
    ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
    : '');
  const vazio = '<em class="historico-vazio">vazio</em>';

  let leadId = null;

  /** "de → para" de cada campo; o de riscado, como no histórico da agenda. */
  function linhasDeMudancas(mudancas, { soPara = false } = {}) {
    return (mudancas || []).map((m) => {
      if (m.de === undefined && m.para === undefined) return `<strong>${esc(m.rotulo)}</strong>: alterado`;
      if (soPara) return `<strong>${esc(m.rotulo)}</strong>: ${m.para == null ? vazio : esc(m.para)}`;
      return `<strong>${esc(m.rotulo)}</strong>: <span class="agenda-evento-de">${m.de == null ? 'vazio' : esc(m.de)}</span> → ${m.para == null ? vazio : esc(m.para)}`;
    });
  }

  function descrever(e) {
    const d = e.detalhe || {};
    switch (e.evento) {
      case 'criado':
        return {
          icone: '＋', titulo: 'Lead cadastrado',
          linhas: e.sintetico ? [] : linhasDeMudancas(e.mudancas, { soPara: true })
        };
      case 'alterado':
        return { icone: '✎', titulo: `Cadastro alterado (${e.mudancas?.length || 0} campo${e.mudancas?.length === 1 ? '' : 's'})`, linhas: linhasDeMudancas(e.mudancas) };
      case 'movido':
        return {
          icone: '⇄', titulo: 'Mudou de etapa no funil',
          linhas: [`<span class="agenda-evento-de">${esc(e.de || '—')}</span> → <strong>${esc(e.para || '—')}</strong>`,
            ...(e.motivo ? [`Motivo da perda: ${esc(e.motivo)}`] : [])]
        };
      case 'proposta_gerada': return { icone: '📄', titulo: `Proposta gerada — versão ${esc(d.versao)}`, linhas: [] };
      case 'contrato_gerado': return { icone: '✍', titulo: `Contrato gerado — versão ${esc(d.versao)}`, linhas: d.proposta_versao ? [`a partir da proposta v${esc(d.proposta_versao)}`] : [] };
      case 'convertido': return { icone: '★', titulo: 'Convertido em cliente', linhas: [] };
      case 'excluido': return { icone: '🗑', titulo: 'Lead excluído', linhas: [] };
      default: return { icone: '•', titulo: esc(e.evento), linhas: [] };
    }
  }

  async function mostrar() {
    if (!leadId) return;
    const lista = el('lead-historico-lista');
    el('lead-historico').classList.remove('hidden');
    lista.innerHTML = '<p class="agenda-historico-nota">Carregando…</p>';
    const pedido = leadId;
    try {
      const r = await fetch(`/api/leads?eventos=${leadId}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (pedido !== leadId) return;
      const eventos = d.eventos || [];
      lista.innerHTML = eventos.map((e) => {
        const { icone, titulo, linhas } = descrever(e);
        return `
          <div class="agenda-evento">
            <span class="agenda-evento-icone" aria-hidden="true">${icone}</span>
            <div>
              <div class="agenda-evento-titulo">${titulo}</div>
              ${linhas.length ? `<ul>${linhas.map((l) => `<li>${l}</li>`).join('')}</ul>` : ''}
              <div class="agenda-evento-quando">em <strong>${esc(quando(e.em))}</strong> por <strong>${esc(e.por_nome || e.por || '—')}</strong></div>
            </div>
          </div>`;
      }).join('')
        + (eventos.some((e) => e.sintetico)
          ? '<p class="agenda-historico-nota">O histórico detalhado começou em 05/10/2026 (versão 2.41.0). Do que veio antes, só a criação.</p>' : '')
        + (d.aviso ? `<p class="agenda-historico-nota">${esc(d.aviso)}</p>` : '');
    } catch (e) {
      lista.innerHTML = `<p class="agenda-historico-nota">Não foi possível carregar o histórico. ${esc(e.message)}</p>`;
    }
  }

  function fechar() { el('lead-historico')?.classList.add('hidden'); }

  function paraLead(id) {
    leadId = id || null;
    el('btn-lead-historico')?.classList.toggle('hidden', !leadId);
    fechar();
  }

  function iniciar() {
    el('btn-lead-historico')?.addEventListener('click', () => {
      if (el('lead-historico').classList.contains('hidden')) mostrar(); else fechar();
    });
    el('btn-lead-historico-recarregar')?.addEventListener('click', mostrar);
    el('btn-lead-historico-fechar')?.addEventListener('click', fechar);

    document.addEventListener('crm:lead-ficha', (ev) => paraLead(ev.detail?.lead?.id));
    document.addEventListener('crm:lead-novo', () => paraLead(null));
    // Salvar sem fechar (Contrato: "Salvar e conferir", gerar proposta) muda
    // o histórico: se o painel estiver aberto, ele se atualiza.
    document.addEventListener('crm:lead-salvo', () => {
      if (leadId && !el('lead-historico').classList.contains('hidden')) mostrar();
    });
    // Esc fecha o painel antes de fechar a ficha.
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el('lead-historico')?.classList.contains('hidden')) {
        ev.stopImmediatePropagation();
        fechar();
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', iniciar);
  return { mostrar, fechar };
})();
