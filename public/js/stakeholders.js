/**
 * stakeholders.js — o mapa de pessoas do lado do cliente (Lote L).
 *
 * Vive dentro da ficha do cliente, na segunda aba. Carregar DEPOIS do
 * clientes.js: pende dela e é acionado pelos eventos que ela dispara.
 *
 * Três coisas definem o desenho:
 *
 * 1. Pessoa pende de um cliente que JÁ EXISTE. Antes do primeiro
 *    salvamento não há a que pendurar, e a aba diz isso em vez de
 *    oferecer um formulário que falharia ao gravar.
 *
 * 2. Carrega sob demanda, na primeira vez que a aba é aberta. Quem abre
 *    a ficha para corrigir um telefone não paga a consulta.
 *
 * 3. Os núcleos oferecidos são os do CLIENTE, não todos os cadastrados.
 *    Vincular alguém a um núcleo em que a conta não é atendida criaria
 *    dado que nenhuma tela mostra — e o dossiê conta "núcleo atendido sem
 *    ninguém mapeado" justamente cruzando essas duas listas.
 */

const Stakeholders = (() => {
  let clienteId = null;
  let lista = [];
  let carregadoDe = null;      // de qual cliente a lista em memória é
  let editandoId = null;

  /* ----------------------------------------------------------
     Utilidades
     ---------------------------------------------------------- */

  const el = (id) => document.getElementById(id);

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* Os mesmos rótulos do `_lib/schema-dossie-cx.js`. A duplicação é
     inevitável: aquele arquivo é módulo ES das Functions e este é script
     clássico do navegador. Se um rótulo mudar, mudam os dois. */
  const ROTULO_INFLUENCIA = {
    alta: 'Alta', media: 'Média', baixa: 'Baixa', desconhecida: 'Não avaliada'
  };

  const ROTULO_POSTURA = {
    promotor: 'Promotor', neutro: 'Neutro',
    resistente: 'Resistente', desconhecida: 'Não avaliada'
  };

  /* ----------------------------------------------------------
     Carregamento
     ---------------------------------------------------------- */

  async function buscar(id) {
    const r = await fetch(`/api/stakeholders?cliente_id=${id}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Falha ao carregar as pessoas.');
    return d.stakeholders || [];
  }

  /**
   * Devolve a lista do cliente, buscando só na primeira vez.
   *
   * Exposta porque a aba do Dossiê de Experiência precisa exatamente da
   * mesma lista para montar o resumo do que entra no documento, e uma
   * segunda consulta poderia mostrar um número diferente do que a aba ao
   * lado está exibindo.
   */
  async function garantirCarregado(id) {
    const alvo = Number(id || clienteId) || null;
    if (!alvo) return [];
    if (carregadoDe === alvo) return lista;

    lista = await buscar(alvo);
    carregadoDe = alvo;
    return lista;
  }

  async function recarregar() {
    carregadoDe = null;
    await garantirCarregado(clienteId);
    renderizarLista();
  }

  /* ----------------------------------------------------------
     Lista
     ---------------------------------------------------------- */

  function marcaHtml(tipo, valor, rotulo) {
    // "Não avaliada" recebe classe própria e fica apagada: é falta de
    // informação, não uma posição intermediária. Pintá-la como as outras
    // faria parecer que alguém emitiu o juízo.
    return `<span class="pessoa-marca marca-${tipo}-${esc(valor)}">${rotulo}</span>`;
  }

  function cartaoHtml(p) {
    const identificacao = [p.papel, p.cargo].filter(Boolean).map(esc).join(' · ');

    const contato = [
      p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : null,
      p.telefone ? esc(p.telefone) : null
    ].filter(Boolean).join(' · ');

    const nucleos = (p.nucleos || [])
      .map((n) => `<span class="chip-nucleo">${esc(n)}</span>`).join(' ');

    return `
      <article class="pessoa-cartao" data-id="${p.id}">
        <div class="pessoa-topo">
          <span class="pessoa-nome">${esc(p.nome)}</span>
          ${p.patrocinador ? '<span class="pessoa-selo" title="Responde pela conta do lado do cliente">Patrocinador</span>' : ''}
          <span class="espaco"></span>
          <button class="btn-action" data-acao="editar" title="Editar">✏️</button>
          <button class="btn-action" data-acao="remover" title="Remover do mapa">🗑️</button>
        </div>

        ${identificacao ? `<div class="pessoa-linha">${identificacao}</div>` : ''}

        <div class="pessoa-marcas">
          ${marcaHtml('influencia', p.influencia, `Influência: ${ROTULO_INFLUENCIA[p.influencia] || '—'}`)}
          ${marcaHtml('postura', p.postura, ROTULO_POSTURA[p.postura] || '—')}
        </div>

        ${nucleos ? `<div class="pessoa-linha">${nucleos}</div>` : ''}
        ${contato ? `<div class="pessoa-linha pessoa-contato">${contato}</div>` : ''}
        ${p.observacoes ? `<div class="pessoa-obs">${esc(p.observacoes)}</div>` : ''}
      </article>`;
  }

  function renderizarLista() {
    const caixa = el('pessoas-lista');
    if (!caixa) return;

    if (lista.length === 0) {
      caixa.innerHTML = `<div class="coluna-vazia">
        Ninguém mapeado ainda. O dossiê declara essa ausência como lacuna do
        registro — não como falta de interlocutor no cliente.</div>`;
      return;
    }

    caixa.innerHTML = lista.map(cartaoHtml).join('');
  }

  /** Estado da aba conforme haja ou não um cliente salvo. */
  function aplicarDisponibilidade() {
    const semCliente = !clienteId;

    el('pessoas-sem-cliente')?.classList.toggle('hidden', !semCliente);
    el('pessoas-lista')?.classList.toggle('hidden', semCliente);
    el('pessoas-acoes')?.classList.toggle('hidden', semCliente);
    if (semCliente) fecharForm();
  }

  async function abrirAba() {
    aplicarDisponibilidade();
    if (!clienteId) return;

    const caixa = el('pessoas-lista');
    if (caixa && carregadoDe !== clienteId) {
      caixa.innerHTML = '<div class="coluna-vazia">Carregando…</div>';
    }

    try {
      await garantirCarregado(clienteId);
      renderizarLista();
    } catch (e) {
      if (caixa) {
        caixa.innerHTML = `<div class="coluna-vazia">${esc(e.message)}</div>`;
      }
    }
  }

  /* ----------------------------------------------------------
     Formulário
     ---------------------------------------------------------- */

  function montarSelectPapeis(selecionado) {
    const select = el('pessoa-input-papel');
    if (!select) return;

    const papeis = (typeof Cadastros !== 'undefined' ? Cadastros.papeis() : []) || [];

    select.innerHTML = '<option value="">— sem papel definido —</option>'
      + papeis.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');

    select.value = selecionado ? String(selecionado) : '';
  }

  function montarNucleosDaPessoa(selecionados) {
    const caixa = el('pessoa-nucleos');
    if (!caixa) return;

    const doCliente = (typeof Clientes !== 'undefined' ? Clientes.nucleosDaFicha() : []) || [];

    if (doCliente.length === 0) {
      caixa.innerHTML = `<span class="tags-vazio">
        Este cliente não tem núcleo marcado na aba Ficha. Marque lá os núcleos
        em que ele é atendido para poder vincular pessoas a eles.</span>`;
      return;
    }

    const ligados = new Set((selecionados || []).map(Number));

    // Mesmo chip das tags do lead e dos núcleos da ficha: mesma interação,
    // mesma variável de cor.
    caixa.innerHTML = doCliente.map((n) => `
      <button type="button" class="tag-chip${ligados.has(n.id) ? ' ligada' : ''}"
              data-nucleo="${n.id}" style="--cor-tag:${esc(n.cor || '#6e6e6e')}">
        ${esc(n.nome)}
      </button>`).join('');
  }

  function abrirForm(pessoa) {
    editandoId = pessoa?.id || null;

    const set = (id, valor) => { const c = el(id); if (c) c.value = valor ?? ''; };

    set('pessoa-input-nome', pessoa?.nome);
    set('pessoa-input-cargo', pessoa?.cargo);
    set('pessoa-input-email', pessoa?.email);
    set('pessoa-input-telefone', pessoa?.telefone);
    set('pessoa-input-observacoes', pessoa?.observacoes);

    el('pessoa-input-influencia').value = pessoa?.influencia || 'desconhecida';
    el('pessoa-input-postura').value = pessoa?.postura || 'desconhecida';
    el('pessoa-input-patrocinador').checked = !!pessoa?.patrocinador;

    montarSelectPapeis(pessoa?.papel_id);
    montarNucleosDaPessoa(pessoa?.nucleoIds);

    el('pessoa-form')?.classList.remove('hidden');
    el('pessoas-acoes')?.classList.add('hidden');
    el('pessoa-input-nome')?.focus();
  }

  function fecharForm() {
    editandoId = null;
    el('pessoa-form')?.classList.add('hidden');
    el('pessoas-acoes')?.classList.toggle('hidden', !clienteId);
  }

  function nucleosMarcados() {
    return [...document.querySelectorAll('#pessoa-nucleos .tag-chip.ligada')]
      .map((chip) => Number(chip.dataset.nucleo));
  }

  async function salvar() {
    const valor = (id) => el(id)?.value.trim() || '';

    const nome = valor('pessoa-input-nome');
    if (!nome) {
      alert('Informe o nome da pessoa.');
      el('pessoa-input-nome')?.focus();
      return;
    }

    const corpo = {
      nome,
      papel_id: valor('pessoa-input-papel') || null,
      cargo: valor('pessoa-input-cargo'),
      email: valor('pessoa-input-email'),
      telefone: valor('pessoa-input-telefone'),
      influencia: valor('pessoa-input-influencia'),
      postura: valor('pessoa-input-postura'),
      patrocinador: !!el('pessoa-input-patrocinador')?.checked,
      nucleos: nucleosMarcados(),
      observacoes: valor('pessoa-input-observacoes')
    };

    const url = editandoId
      ? `/api/stakeholders?id=${editandoId}`
      : `/api/stakeholders?cliente_id=${clienteId}`;

    const botao = el('btn-pessoa-salvar');
    if (botao) botao.disabled = true;

    try {
      const r = await fetch(url, {
        method: editandoId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
      });

      const d = await r.json();

      if (!r.ok) {
        // A causa vem no corpo; engoli-la foi o que fez o bug da proposta
        // durar um dia inteiro.
        alert(d.error || d.details || 'Não foi possível salvar a pessoa.');
        return;
      }

      // A API devolve a linha com papel e núcleos já resolvidos em nome:
      // dá para atualizar a lista sem uma segunda consulta.
      if (editandoId) {
        const i = lista.findIndex((p) => p.id === editandoId);
        if (i >= 0) lista[i] = d.stakeholder;
      } else {
        lista.push(d.stakeholder);
      }

      ordenar();
      renderizarLista();
      fecharForm();

    } catch (e) {
      alert('Falha de conexão ao salvar a pessoa.');
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  /**
   * A mesma ordem do `ORDER BY` da API: patrocinador primeiro, depois
   * influência da maior para a menor. Reordenar aqui evita que a pessoa
   * recém-salva apareça fora de lugar até a próxima abertura da aba.
   */
  function ordenar() {
    const peso = { alta: 1, media: 2, baixa: 3, desconhecida: 4 };
    lista.sort((a, b) =>
      (b.patrocinador ? 1 : 0) - (a.patrocinador ? 1 : 0)
      || (peso[a.influencia] || 4) - (peso[b.influencia] || 4)
      || String(a.nome).localeCompare(String(b.nome), 'pt-BR')
    );
  }

  async function remover(id, nome) {
    if (!confirm(`Remover "${nome}" do mapa de stakeholders?\n\nOs dossiês já gerados continuam citando esta pessoa — eles registram a conta como ela era na data.`)) return;

    try {
      const r = await fetch(`/api/stakeholders?id=${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json();
        alert(d.error || 'Não foi possível remover.');
        return;
      }

      lista = lista.filter((p) => p.id !== id);
      renderizarLista();

    } catch (e) {
      alert('Falha de conexão ao remover.');
    }
  }

  /* ----------------------------------------------------------
     Papel novo sem sair da ficha

     Mesma mecânica de advisors e tags desde o Lote A: digita o nome,
     vira opção para todos. Sem isso, mapear uma pessoa cujo papel ainda
     não existe exigiria fechar a ficha, abrir "Gerenciar CX" e voltar.
     ---------------------------------------------------------- */

  async function criarPapel() {
    const nome = prompt('Nome do novo papel (ex.: Decisor, Usuário-chave, Financeiro):');
    if (!nome?.trim()) return;

    const registro = typeof Cadastros !== 'undefined'
      ? await Cadastros.criarPapel(nome)
      : null;

    if (!registro) {
      alert('Não foi possível criar o papel.');
      return;
    }

    montarSelectPapeis(registro.id);
  }

  /* ----------------------------------------------------------
     Ligação com a interface
     ---------------------------------------------------------- */

  function iniciar() {
    el('btn-pessoa-nova')?.addEventListener('click', () => abrirForm(null));
    el('btn-pessoa-cancelar')?.addEventListener('click', fecharForm);
    el('btn-pessoa-salvar')?.addEventListener('click', salvar);
    el('btn-papel-novo')?.addEventListener('click', criarPapel);

    el('pessoa-nucleos')?.addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-nucleo]');
      if (chip) chip.classList.toggle('ligada');
    });

    el('pessoas-lista')?.addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-acao]');
      if (!botao) return;

      const id = Number(botao.closest('.pessoa-cartao')?.dataset.id);
      const pessoa = lista.find((p) => p.id === id);
      if (!pessoa) return;

      if (botao.dataset.acao === 'editar') abrirForm(pessoa);
      if (botao.dataset.acao === 'remover') remover(id, pessoa.nome);
    });

    // A ficha abriu: troca de cliente joga fora a lista do anterior.
    document.addEventListener('crm:cliente-ficha', (ev) => {
      clienteId = ev.detail?.id || null;
      lista = [];
      carregadoDe = null;
      fecharForm();
      aplicarDisponibilidade();
    });

    document.addEventListener('crm:cliente-aba', (ev) => {
      if (ev.detail?.aba === 'cli-tab-pessoas') abrirAba();
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { garantirCarregado, recarregar, ROTULO_INFLUENCIA, ROTULO_POSTURA };
})();
