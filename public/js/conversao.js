/**
 * conversao.js — o lead vira cliente.
 *
 * É o primeiro dos DOIS caminhos que levam um cliente à trilha de CX. O
 * outro — os ativos que já existem no ERP aparecerem sozinhos na Jornada
 * — depende da chave do hub com escopo ampliado e ainda não existe.
 *
 * Carregar DEPOIS do quadro.js e do clientes.js: é acionado pelo quadro
 * do funil e recarrega a Jornada ao converter.
 *
 * DOIS GATILHOS, e os dois são necessários:
 *
 *   1. Arrastar o cartão para uma etapa de encerramento. Até a v2.17.0
 *      isso não produzia aviso nenhum — o comportamento estava certo,
 *      mas era mudo.
 *
 *   2. Um botão na aba Funil da ficha. Sem ele, um lead que já estava
 *      parado em "Finalizado" desde antes de a conversão existir nunca
 *      teria como ser convertido, porque ninguém o arrastaria de novo.
 *      Era exatamente o caso na estreia.
 *
 * A conversão NÃO acontece sozinha, por decisão registrada no roadmap:
 * ela pede o que o funil não tem — etapa da jornada, núcleos de
 * atendimento e data de início da relação.
 */

const Conversao = (() => {
  let leadId = null;
  let etapasJornada = [];
  let nucleosSelecionados = new Set();

  const el = (id) => document.getElementById(id);

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function formatarCnpj(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length !== 14) return v || '';
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  }

  /* ----------------------------------------------------------
     Consulta
     ---------------------------------------------------------- */

  async function examinar(id) {
    const r = await fetch(`/api/conversao?lead_id=${id}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.details || d.error || 'Falha ao consultar a conversão.');
    return d;
  }

  /* As etapas da jornada são de OUTRO pipeline: as do Cadastros são as do
     funil comercial, e reaproveitá-las colocaria o cliente numa coluna
     que não existe no quadro dele. */
  async function carregarEtapas() {
    if (etapasJornada.length) return etapasJornada;
    try {
      const r = await fetch('/api/cadastros?tipo=etapas&pipeline=jornada');
      if (r.ok) etapasJornada = (await r.json()).etapas || [];
    } catch (e) {
      etapasJornada = [];
    }
    return etapasJornada;
  }

  /* ----------------------------------------------------------
     A ficha do lead: estado da trilha de CX
     ---------------------------------------------------------- */

  async function avaliarNaFicha(lead) {
    const caixa = el('lead-conversao');
    const estado = el('lead-conversao-estado');
    const btnConverter = el('btn-converter-cliente');
    const btnAbrir = el('btn-abrir-cliente');
    if (!caixa || !estado) return;

    const esconderBotoes = () => {
      btnConverter?.classList.add('hidden');
      btnAbrir?.classList.add('hidden');
    };

    // Lead ainda não salvo não tem o que converter.
    if (!lead?.id) {
      caixa.classList.add('hidden');
      return;
    }

    caixa.classList.remove('hidden');
    esconderBotoes();
    estado.textContent = 'Verificando…';

    let dados;
    try {
      dados = await examinar(lead.id);
    } catch (e) {
      estado.textContent = e.message;
      return;
    }

    const imp = dados.impedimento;

    if (imp?.code === 'JA_CONVERTIDO' || imp?.code === 'CNPJ_JA_E_CLIENTE') {
      estado.textContent = imp.mensagem;
      if (imp.cliente?.id && btnAbrir) {
        btnAbrir.dataset.clienteId = imp.cliente.id;
        btnAbrir.classList.remove('hidden');
      }
      return;
    }

    if (imp) {
      // SEM_DOCUMENTO e DOCUMENTO_NAO_E_CNPJ: dá para resolver na própria
      // ficha, então a mensagem diz o que fazer em vez de só recusar.
      estado.textContent = imp.mensagem;
      return;
    }

    const encerra = dados.etapaAtual?.encerra;
    estado.textContent = encerra
      ? `Este lead está em "${dados.etapaAtual.nome}" e pode virar cliente.`
      : 'Ainda não está numa etapa de encerramento — a conversão fica disponível, mas o normal é converter ao finalizar.';

    btnConverter?.classList.remove('hidden');
  }

  /* ----------------------------------------------------------
     Oferta ao arrastar o cartão
     ---------------------------------------------------------- */

  /**
   * Chamado pelo quadro do funil depois de o movimento ser GRAVADO.
   *
   * Já convertido não vira aviso: o usuário arrastou um cartão dentro da
   * coluna, ou de volta para ela, e não pediu nada. Os demais
   * impedimentos avisam, porque a pessoa acabou de finalizar o lead e
   * merece saber que a conversão não vai acontecer.
   */
  async function oferecer(id, nomeEtapa) {
    let dados;
    try {
      dados = await examinar(id);
    } catch (e) {
      return;   // acessório: não atrapalha o arraste
    }

    if (dados.impedimento?.code === 'JA_CONVERTIDO') return;

    if (dados.impedimento) {
      alert(`Lead movido para "${nomeEtapa}".\n\nNão dá para convertê-lo em cliente ainda:\n${dados.impedimento.mensagem}`);
      return;
    }

    abrir(id, dados);
  }

  /* ----------------------------------------------------------
     O modal
     ---------------------------------------------------------- */

  function montarEtapas() {
    const select = el('conversao-etapa');
    if (!select) return;

    select.innerHTML = etapasJornada.length
      ? etapasJornada.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join('')
      : '<option value="">— nenhuma etapa cadastrada —</option>';
  }

  function montarNucleos() {
    const caixa = el('conversao-nucleos');
    if (!caixa) return;

    const lista = (typeof Cadastros !== 'undefined' ? Cadastros.nucleos() : []) || [];

    if (lista.length === 0) {
      caixa.innerHTML = '<span class="tags-vazio">Nenhum núcleo cadastrado ainda.</span>';
      return;
    }

    caixa.innerHTML = lista.map((n) => `
      <button type="button" class="tag-chip${nucleosSelecionados.has(n.id) ? ' ligada' : ''}"
              data-nucleo="${n.id}" style="--cor-tag:${esc(n.cor || '#6e6e6e')}">
        ${esc(n.nome)}
      </button>`).join('');
  }

  async function abrir(id, dados) {
    leadId = id;
    nucleosSelecionados = new Set();

    const s = dados?.sugestao || {};

    el('conversao-nome').value = s.nome || '';
    el('conversao-fantasia').value = '';
    el('conversao-cnpj').value = formatarCnpj(s.documento);
    el('conversao-observacoes').value = '';
    el('conversao-inicio').value = new Date().toISOString().slice(0, 10);

    const impedimento = el('conversao-impedimento');
    const formulario = el('conversao-formulario');

    if (dados?.impedimento) {
      impedimento.textContent = dados.impedimento.mensagem;
      impedimento.classList.remove('hidden');
      formulario.classList.add('hidden');
      el('btn-conversao-salvar').classList.add('hidden');
    } else {
      impedimento.classList.add('hidden');
      formulario.classList.remove('hidden');
      el('btn-conversao-salvar').classList.remove('hidden');
    }

    await carregarEtapas();
    montarEtapas();
    montarNucleos();

    el('modal-conversao')?.classList.remove('hidden');
    el('conversao-nome')?.focus();
  }

  const fechar = () => el('modal-conversao')?.classList.add('hidden');

  async function converter() {
    const botao = el('btn-conversao-salvar');
    const nome = el('conversao-nome')?.value.trim();

    if (!nome) {
      alert('A razão social é obrigatória.');
      el('conversao-nome')?.focus();
      return;
    }

    const corpo = {
      nome,
      nome_fantasia: el('conversao-fantasia')?.value.trim() || null,
      etapa_id: el('conversao-etapa')?.value || null,
      data_inicio: el('conversao-inicio')?.value || null,
      nucleos: [...nucleosSelecionados],
      observacoes: el('conversao-observacoes')?.value.trim() || null
    };

    if (botao) botao.disabled = true;

    try {
      const r = await fetch(`/api/conversao?lead_id=${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
      });

      const d = await r.json();

      if (!r.ok) {
        // A causa vem no corpo. Engoli-la foi o que fez o bug da proposta
        // durar um dia inteiro.
        alert(d.error || d.details || 'Não foi possível converter.');
        return;
      }

      fechar();

      // A Jornada estava vazia; agora tem alguém. Se a tela estiver
      // aberta, precisa refletir isso sem F5.
      if (typeof Clientes !== 'undefined') Clientes.recarregarVisao();

      // E a ficha do lead, se ainda estiver aberta, passa a dizer que ele
      // já é cliente.
      avaliarNaFicha({ id: leadId });

      alert(`"${d.cliente.nome}" agora é cliente da trilha de CX.\n\nEle aparece na Jornada, na etapa escolhida. O mapa de stakeholders e o Dossiê de Experiência ficam na ficha dele.`);

    } catch (e) {
      alert('Falha de conexão ao converter.');
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    el('btn-conversao-close')?.addEventListener('click', fechar);
    el('btn-conversao-cancel')?.addEventListener('click', fechar);
    el('btn-conversao-salvar')?.addEventListener('click', converter);

    el('modal-conversao')?.addEventListener('click', (ev) => {
      if (ev.target === el('modal-conversao')) fechar();
    });

    el('conversao-nucleos')?.addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-nucleo]');
      if (!chip) return;
      const id = Number(chip.dataset.nucleo);
      if (nucleosSelecionados.has(id)) nucleosSelecionados.delete(id);
      else nucleosSelecionados.add(id);
      chip.classList.toggle('ligada');
    });

    el('btn-converter-cliente')?.addEventListener('click', async () => {
      const id = (typeof Leads !== 'undefined' && Leads.emEdicao) ? Leads.emEdicao() : null;
      if (!id) return;
      try {
        abrir(id, await examinar(id));
      } catch (e) {
        alert(e.message);
      }
    });

    el('btn-abrir-cliente')?.addEventListener('click', async (ev) => {
      const id = Number(ev.currentTarget.dataset.clienteId);
      if (!id) return;

      try {
        const r = await fetch(`/api/clientes?id=${id}`);
        const d = await r.json();
        if (!r.ok || !d.cliente) throw new Error(d.error || 'Cliente não encontrado.');

        // Fecha a ficha do lead antes: dois modais abertos ao mesmo tempo
        // deixariam o de trás capturando cliques.
        el('modal-lead')?.classList.add('hidden');
        if (typeof Clientes !== 'undefined') Clientes.abrirFicha(d.cliente);

      } catch (e) {
        alert(e.message);
      }
    });

    document.addEventListener('crm:lead-ficha', (ev) => avaliarNaFicha(ev.detail?.lead));
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { oferecer, avaliarNaFicha };
})();
