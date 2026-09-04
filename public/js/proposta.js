/**
 * proposta.js — A aba de proposta da ficha do lead.
 *
 * Monta o formulário, dispara a geração e lista as versões. O documento
 * em si é montado no servidor e guardado inteiro: reabrir a versão 1
 * depois de o template mudar tem que devolver o que o cliente recebeu,
 * não uma reimpressão com o layout de hoje.
 *
 * Carregar DEPOIS do leads.js.
 */

const Proposta = (() => {
  /**
   * Padrões da proposta em uso hoje. São sugestões editáveis, não
   * política do sistema: os valores comerciais variam por negociação e
   * ficou combinado que quem gera preenche na hora.
   */
  const PADROES = {
    objeto: 'Diagnóstico e consultoria para implantação da metodologia de Gestão Integrada de Negócios, envolvendo as áreas: Comercial, Finanças, Operações, RH, Planejamento e Governança/Conselho.',
    diagPrazo: 'Entre 40 e 50 dias a partir da assinatura do contrato',
    diagCondicoes: '50% na assinatura do contrato e 50% após a apresentação',
    consMeses: '24',
    consInicio: 'Após a apresentação do diagnóstico',
    consCondicoes: 'Primeira parcela 30 dias após a apresentação do diagnóstico',
    rescisao: 'Mediante aviso prévio, sem multa rescisória',
    km: '1,75'
  };

  let leadId = null;

  const el = (id) => document.getElementById(id);
  const v = (id) => el(id)?.value?.trim() || null;
  const p = (id, valor) => { const n = el(id); if (n) n.value = valor ?? ''; };

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const centavosParaTexto = (c) =>
    (c == null || c === '')
      ? ''
      : (Number(c) / 100).toLocaleString('pt-BR', {
          minimumFractionDigits: 2, maximumFractionDigits: 2
        });

  function dataBr(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR');
  }

  /* ----------------------------------------------------------
     Preenchimento
     ---------------------------------------------------------- */

  /**
   * Abre a aba para um lead.
   *
   * Se já houve proposta, reabre com os dados da última versão — repropor
   * costuma ser mudar um valor, não redigitar tudo. Senão, cai nos
   * padrões, com o que já se sabe do lead.
   */
  async function abrir(lead) {
    leadId = lead?.id || null;
    limpar();
    if (!leadId) return;

    // O que já se sabe do lead entra antes da rede responder
    p('prop-contato-nome', lead.contato_nome);
    p('prop-contato-telefone', lead.telefone);
    p('prop-contato-email', lead.email);
    p('prop-cons-valor', centavosParaTexto(lead.valor_proposta));
    p('prop-diag-valor', centavosParaTexto(lead.valor_diagnostico));

    try {
      const r = await fetch(`/api/proposta?lead_id=${leadId}`);
      if (!r.ok) return;
      const { versoes, dados } = await r.json();

      if (dados) preencherComDados(dados);
      renderizarVersoes(versoes || []);
    } catch (e) {
      // Sem histórico o formulário ainda funciona; só não vem preenchido.
    }
  }

  function limpar() {
    [
      'prop-contato-nome', 'prop-contato-cargo', 'prop-contato-telefone', 'prop-contato-email',
      'prop-diag-valor', 'prop-cons-valor', 'prop-validade', 'prop-resp-nome', 'prop-resp-cargo'
    ].forEach((id) => p(id, ''));

    p('prop-objeto', PADROES.objeto);
    p('prop-diag-prazo', PADROES.diagPrazo);
    p('prop-diag-condicoes', PADROES.diagCondicoes);
    p('prop-cons-meses', PADROES.consMeses);
    p('prop-cons-inicio', PADROES.consInicio);
    p('prop-cons-condicoes', PADROES.consCondicoes);
    p('prop-rescisao', PADROES.rescisao);
    p('prop-km', PADROES.km);

    marcarEscopo(['diagnostico']);
    p('prop-resp-nome', Auth?.usuario?.nome);

    // Validade sugerida: 30 dias. Proposta sem prazo envelhece na gaveta
    // do cliente e volta meses depois com o preço de antes.
    const d = new Date();
    d.setDate(d.getDate() + 30);
    p('prop-validade', d.toISOString().slice(0, 10));

    const status = el('prop-status');
    if (status) { status.textContent = ''; status.className = 'prop-status'; }
    const versoes = el('prop-versoes');
    if (versoes) versoes.innerHTML = '<span class="prop-vazio">Nenhuma proposta gerada ainda.</span>';
  }

  /**
   * Mostra a falha COM a causa.
   *
   * A API já mandava o motivo real em `details` — foi assim que a
   * ausência da tabela `propostas` em produção apareceu. O front lia só
   * `error` e jogava `details` fora, então a tela dizia "Falha ao gerar a
   * proposta" e ponto: quem estava usando não tinha como saber se era
   * banco, permissão, campo inválido ou rede. Diagnosticar exigia abrir
   * o DevTools.
   *
   * Numa ferramenta interna com um punhado de usuários, esconder a causa
   * técnica não protege ninguém — só transfere o trabalho de descobrir
   * para quem tem menos meios de fazê-lo.
   */
  function mostrarErro(status, resposta, padrao) {
    if (!status) return;
    const principal = resposta?.error || padrao;
    const causa = resposta?.details ? ` (${resposta.details})` : '';
    status.textContent = principal + causa;
    status.className = 'prop-status erro';
  }

  function preencherComDados(d) {
    p('prop-contato-nome', d.contato?.nome);
    p('prop-contato-cargo', d.contato?.cargo);
    p('prop-contato-telefone', d.contato?.telefone);
    p('prop-contato-email', d.contato?.email);
    p('prop-objeto', d.objeto);

    p('prop-diag-valor', centavosParaTexto(d.diagnostico?.valor));
    p('prop-diag-prazo', d.diagnostico?.prazo);
    p('prop-diag-condicoes', d.diagnostico?.condicoes);

    p('prop-cons-valor', centavosParaTexto(d.consultoria?.valor));
    p('prop-cons-meses', d.consultoria?.meses);
    p('prop-cons-inicio', d.consultoria?.inicio);
    p('prop-cons-condicoes', d.consultoria?.condicoes);
    p('prop-rescisao', d.rescisao);

    p('prop-km', centavosParaTexto(d.km));
    p('prop-resp-nome', d.responsavel?.nome);
    p('prop-resp-cargo', d.responsavel?.cargo);

    // A validade da versão anterior já pode ter passado; o campo é
    // reproposto em branco para forçar uma decisão consciente.
    marcarEscopo(d.escopo || []);
  }

  function marcarEscopo(chaves) {
    const set = new Set(chaves);
    document.querySelectorAll('#prop-escopo input[type="checkbox"]').forEach((c) => {
      c.checked = set.has(c.value);
    });
  }

  function lerEscopo() {
    return [...document.querySelectorAll('#prop-escopo input:checked')].map((c) => c.value);
  }

  /* ----------------------------------------------------------
     Versões
     ---------------------------------------------------------- */

  function renderizarVersoes(versoes) {
    const caixa = el('prop-versoes');
    if (!caixa) return;

    if (versoes.length === 0) {
      caixa.innerHTML = '<span class="prop-vazio">Nenhuma proposta gerada ainda.</span>';
      return;
    }

    caixa.innerHTML = versoes.map((x) => `
      <div class="prop-versao">
        <div>
          <strong>Versão ${x.versao}</strong>
          <span class="prop-meta">${esc(dataBr(x.gerado_em))} &middot; ${esc(x.gerado_por)}</span>
        </div>
        <button type="button" class="btn btn-sm btn-secondary" data-abrir="${x.versao}">Abrir</button>
      </div>`).join('');
  }

  /**
   * Abre numa aba nova, onde o usuário salva como PDF.
   *
   * A aba é aberta ANTES do fetch: navegador bloqueia window.open que
   * não venha direto de um clique. Por isso ela nasce e só depois recebe
   * o endereço.
   */
  function abrirVersao(versao) {
    const aba = window.open('', '_blank');
    const url = `/api/proposta?lead_id=${leadId}&html=true${versao ? `&versao=${versao}` : ''}`;

    fetch(url)
      .then(async (r) => {
        if (r.ok) return r.text();
        // Mesma razão do `mostrarErro`: a causa vem na resposta e não
        // pode ser descartada. Aqui o corpo do erro é JSON, não HTML.
        const d = await r.json().catch(() => ({}));
        throw new Error(d.details || d.error || `HTTP ${r.status}`);
      })
      .then((html) => {
        if (!aba) { alert('Permita janelas pop-up para abrir a proposta.'); return; }
        aba.document.open();
        aba.document.write(html);
        aba.document.close();
      })
      .catch((e) => {
        aba?.close();
        alert(`Não foi possível abrir a proposta.\n\n${e.message}`);
      });
  }

  /* ----------------------------------------------------------
     Geração
     ---------------------------------------------------------- */

  async function gerar() {
    if (!leadId) {
      alert('Salve o lead antes de gerar a proposta.');
      return;
    }

    const escopo = lerEscopo();
    if (escopo.length === 0) {
      alert('Selecione ao menos um serviço para compor o escopo da proposta.');
      return;
    }

    const botao = el('btn-gerar-proposta');
    const status = el('prop-status');
    if (botao) { botao.disabled = true; botao.textContent = 'Gerando…'; }
    if (status) { status.textContent = ''; status.className = 'prop-status'; }

    const corpo = {
      contato: {
        nome: v('prop-contato-nome'),
        cargo: v('prop-contato-cargo'),
        telefone: v('prop-contato-telefone'),
        email: v('prop-contato-email')
      },
      objeto: v('prop-objeto'),
      escopo,
      diagnostico: {
        valor: v('prop-diag-valor'),
        condicoes: v('prop-diag-condicoes'),
        prazo: v('prop-diag-prazo')
      },
      consultoria: {
        valor: v('prop-cons-valor'),
        meses: v('prop-cons-meses'),
        inicio: v('prop-cons-inicio'),
        condicoes: v('prop-cons-condicoes')
      },
      km: v('prop-km'),
      rescisao: v('prop-rescisao'),
      validade: v('prop-validade'),
      responsavel: { nome: v('prop-resp-nome'), cargo: v('prop-resp-cargo') }
    };

    try {
      const r = await fetch(`/api/proposta?lead_id=${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
      });
      const d = await r.json();

      if (!r.ok) {
        mostrarErro(status, d, 'Não foi possível gerar.');
        return;
      }

      if (status) { status.textContent = `Versão ${d.versao} gerada.`; status.className = 'prop-status ok'; }

      // Recarrega o histórico e já abre o que acabou de sair
      const lista = await fetch(`/api/proposta?lead_id=${leadId}`).then((x) => x.json());
      renderizarVersoes(lista.versoes || []);
      abrirVersao(d.versao);

    } catch (e) {
      // Aqui a requisição nem completou, então não há `details` do
      // servidor — mas a mensagem do próprio erro ainda diz mais que
      // "falha de conexão" sozinho.
      mostrarErro(status, { error: 'Falha de conexão ao gerar.', details: e.message }, null);
    } finally {
      if (botao) { botao.disabled = false; botao.textContent = 'Gerar proposta'; }
    }
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    el('btn-gerar-proposta')?.addEventListener('click', gerar);

    el('prop-versoes')?.addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-abrir]');
      if (botao) abrirVersao(Number(botao.dataset.abrir));
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { abrir, limpar };
})();
