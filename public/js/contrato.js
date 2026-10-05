/**
 * contrato.js — o contrato (Lote G, 2.40.0).
 *
 * Três lugares, a mesma informação:
 *
 *   1. A aba Contrato da ficha do lead: km, forma de preço, contratada e
 *      quem assina pelo cliente (salvos com o lead), o que falta para
 *      gerar, o botão e as versões. Gerar salva a ficha antes: o servidor
 *      monta o contrato com o que está no banco.
 *
 *   2. Os cartões "Formas de preço" e "Empresas contratadas" das
 *      Configurações. Todos veem; só admin altera (quem recusa de verdade
 *      é o servidor).
 *
 *   3. A linha "Contrato" em Documentos de contexto, na ficha do cliente:
 *      os contratos do lead que o originou.
 *
 * Carregar DEPOIS do proposta.js.
 */

const Contrato = (() => {
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const quando = (iso) => (iso
    ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '');
  const centavosParaTexto = (c) => (c == null || c === '')
    ? ''
    : (Number(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const soDigitos = (v) => String(v || '').replace(/\D/g, '');
  const cpfBr = (v) => {
    const d = soDigitos(v);
    return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (v || '');
  };
  const cnpjBr = (v) => {
    const d = soDigitos(v);
    return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (v || '');
  };
  const ehAdmin = () => !!(typeof Auth !== 'undefined' && Auth.usuario?.admin);

  const KM_PADRAO = '1,75';

  /** { formas, contratadas, marcadores, estadosCivis } — null até chegar. */
  let listas = null;
  let leadAtual = null;

  async function carregarListas() {
    try {
      const r = await fetch('/api/contrato-cadastros');
      if (!r.ok) return;
      listas = await r.json();
      montarSelects();
      sincronizarProposta();
      montarConfig();
    } catch (e) {
      // Sem as listas a aba ainda mostra os campos de texto; os selects
      // ficam com o valor do lead (ver lerCampos).
    }
  }

  const contratadaPadrao = () => listas?.contratadas.find((c) => c.padrao && c.ativa) || null;

  /* ==========================================================================
     1. A ABA CONTRATO DO LEAD
     ========================================================================== */

  function montarSelects() {
    if (!listas) return;
    const l = leadAtual || {};

    // Forma: as ativas, mais a do lead se estiver inativa (ela continua valendo).
    const formas = listas.formas.filter((f) => f.ativa || f.id === l.forma_preco_id);
    el('lead-input-forma-preco').innerHTML = '<option value="">Escolha a forma de preço…</option>'
      + formas.map((f) => `<option value="${f.id}">${esc(f.nome)}${f.ativa ? '' : ' (inativa)'}</option>`).join('');
    el('lead-input-forma-preco').value = l.forma_preco_id || '';

    // Contratada: vazio é "a padrão" — se o admin trocar a padrão, o lead acompanha.
    const padrao = contratadaPadrao();
    const contratadas = listas.contratadas.filter((c) => (c.ativa && !c.padrao) || (c.id === l.contratada_id && !c.padrao));
    el('lead-input-contratada').innerHTML = `<option value="">${padrao ? `Padrão: ${esc(padrao.razao_social)}` : 'Padrão (nenhuma cadastrada)'}</option>`
      + contratadas.map((c) => `<option value="${c.id}">${esc(c.razao_social)}${c.ativa ? '' : ' (inativa)'}</option>`).join('');
    el('lead-input-contratada').value = l.contratada_id && l.contratada_id !== padrao?.id ? l.contratada_id : '';

    const estados = listas.estadosCivis || [];
    const atual = l.rep_estado_civil || '';
    el('lead-input-rep-estado-civil').innerHTML = '<option value="">—</option>'
      + [...estados, ...(atual && !estados.includes(atual) ? [atual] : [])]
        .map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    el('lead-input-rep-estado-civil').value = atual;
  }

  /** Lead com CPF: a própria pessoa assina — nome e CPF de representante somem. */
  function atualizarPessoaFisica() {
    const pf = soDigitos(el('lead-input-doc')?.value).length === 11;
    el('contrato-pf-aviso')?.classList.toggle('hidden', !pf);
    el('contrato-rep-nome-grupo')?.classList.toggle('hidden', pf);
    el('contrato-rep-cpf-grupo')?.classList.toggle('hidden', pf);
  }

  /** O km e a forma na aba Proposta acompanham o que está aqui. */
  function sincronizarProposta() {
    const km = el('lead-input-km')?.value.trim() || KM_PADRAO;
    if (el('prop-km')) el('prop-km').value = km;

    const alvo = el('prop-forma');
    if (!alvo) return;
    const id = Number(el('lead-input-forma-preco')?.value) || null;
    const forma = id && listas?.formas.find((f) => f.id === id);
    alvo.textContent = forma
      ? `Forma de preço: ${forma.nome} — entra nesta proposta (troca na aba Contrato).`
      : 'Sem forma de preço (aba Contrato): a proposta sai sem o bloco "Forma de pagamento".';
  }

  function abrir(lead) {
    leadAtual = lead || null;
    const l = leadAtual || {};
    const p = (id, valor) => { const n = el(id); if (n) n.value = valor ?? ''; };

    p('lead-input-km', l.km_valor ? centavosParaTexto(l.km_valor) : KM_PADRAO);
    p('lead-input-rep-nome', l.rep_nome);
    p('lead-input-rep-cpf', cpfBr(l.rep_cpf));
    p('lead-input-rep-nacionalidade', l.rep_nacionalidade);
    p('lead-input-rep-profissao', l.rep_profissao);
    p('lead-input-rep-residencia', l.rep_residencia);

    if (listas) montarSelects();
    else carregarListas();
    atualizarPessoaFisica();
    sincronizarProposta();
    espelharEndereco();

    const status = el('contrato-status');
    if (status) { status.textContent = ''; status.className = 'prop-status'; }
    if (l.id) atualizarEstado();
    else {
      el('contrato-proposta').innerHTML = '<p class="prop-vazio">Salve o lead para gerar a proposta.</p>';
      el('contrato-pendencias').innerHTML = '<p class="prop-vazio">Salve o lead para ver o que falta.</p>';
      el('contrato-versoes').innerHTML = '<span class="prop-vazio">Nenhum contrato gerado ainda.</span>';
    }
  }

  /**
   * Os campos para o salvamento do lead (leads.js). Enquanto as listas não
   * chegaram, os selects estão vazios: devolve a escolha que o lead já
   * tinha, ou salvar apagaria a forma e a contratada.
   */
  function lerCampos() {
    const v = (id) => el(id)?.value?.trim() || null;
    const l = leadAtual || {};
    return {
      km_valor: v('lead-input-km'),
      forma_preco_id: listas ? v('lead-input-forma-preco') : (l.forma_preco_id ?? null),
      contratada_id: listas ? v('lead-input-contratada') : (l.contratada_id ?? null),
      rep_nome: v('lead-input-rep-nome'),
      rep_cpf: v('lead-input-rep-cpf'),
      rep_nacionalidade: v('lead-input-rep-nacionalidade'),
      rep_estado_civil: listas ? v('lead-input-rep-estado-civil') : (l.rep_estado_civil ?? null),
      rep_profissao: v('lead-input-rep-profissao'),
      rep_residencia: v('lead-input-rep-residencia')
    };
  }

  async function atualizarEstado() {
    const id = leadAtual?.id;
    if (!id) return;
    try {
      const d = await fetch(`/api/contrato?lead_id=${id}`).then((r) => r.json());
      if (leadAtual?.id !== id) return;                 // trocou de lead no meio
      desenharProposta(d.origem?.proposta || null);
      desenharPendencias(d.faltando || [], d.origem || {});
      desenharVersoes(d.versoes || []);
    } catch (e) {
      el('contrato-pendencias').innerHTML = '<p class="prop-vazio">Não foi possível conferir o contrato.</p>';
    }
  }

  /* ---------- 2.40.1: o endereço e a proposta sem sair da aba ---------- */

  /**
   * Os campos de endereço desta aba são espelhos dos da aba Contato &
   * Endereço: quem salva o lead lê os de lá (leads.js), então o que se
   * digita aqui é copiado para lá na hora.
   */
  const PARES_ENDERECO = [['contrato-cep', 'lead-input-cep'], ['contrato-cidade', 'lead-input-cidade'], ['contrato-endereco', 'lead-input-endereco']];

  function espelharEndereco() {
    for (const [aqui, la] of PARES_ENDERECO) {
      if (el(aqui) && el(la)) el(aqui).value = el(la).value;
    }
  }

  /** O CEP daqui usa a mesma busca do ViaCEP da ficha e traz o resultado de volta. */
  async function buscarCepAqui() {
    const valor = el('contrato-cep')?.value || '';
    if (el('lead-input-cep')) el('lead-input-cep').value = valor;
    if (typeof Leads === 'undefined' || !Leads.buscarCep) return;
    await Leads.buscarCep(valor);
    espelharEndereco();
    const aviso = el('cep-aviso');
    const alvo = el('contrato-cep-aviso');
    if (aviso && alvo) { alvo.textContent = aviso.textContent; alvo.className = aviso.className; }
  }

  const reais = (t) => (t ? `R$ ${t}` : null);

  /** O que a próxima proposta levaria — lido do formulário da aba Proposta. */
  function textoDoResumo() {
    const r = typeof Proposta !== 'undefined' && Proposta.resumo ? Proposta.resumo() : null;
    if (!r) return '';
    const valores = [
      r.diagnostico ? `diagnóstico ${reais(r.diagnostico)}` : null,
      r.mensal ? `consultoria ${reais(r.mensal)}/mês${r.meses ? ` por ${r.meses} meses` : ''}` : null,
      r.projeto ? `projeto ${reais(r.projeto)}${r.parcelas ? ` em ${r.parcelas} parcelas` : ''}` : null,
      r.hora ? `hora ${reais(r.hora)}` : null
    ].filter(Boolean);
    return `<ul class="contrato-resumo">
        <li><strong>Escopo:</strong> ${r.escopo.length ? esc(r.escopo.join(', ')) : '<span class="cc-alerta">nenhum serviço marcado</span>'}</li>
        <li><strong>Valores:</strong> ${valores.length ? esc(valores.join(' · ')) : '<span class="cc-alerta">nenhum valor preenchido</span>'}</li>
      </ul>`;
  }

  function desenharProposta(proposta) {
    const alvo = el('contrato-proposta');
    if (!alvo) return;
    const cabeca = proposta
      ? `<p>Última proposta: <strong>v${esc(proposta.versao)}</strong>, de ${esc(quando(proposta.gerado_em))}. O contrato usa o escopo e os valores dela.</p>
         <p class="campo-ajuda">Mudou algo? A próxima versão sairia assim:</p>`
      : '<p><strong>Nenhuma proposta gerada ainda.</strong> Ela sairia assim:</p>';
    alvo.innerHTML = `${cabeca}${textoDoResumo()}
      <div class="contrato-proposta-botoes">
        <button type="button" class="btn btn-sm btn-primary" data-proposta="gerar">${proposta ? 'Gerar nova versão da proposta' : 'Gerar proposta agora'}</button>
        <button type="button" class="btn btn-sm btn-secondary" data-proposta="ajustar">Ajustar na aba Proposta</button>
      </div>`;
  }

  function dizer(texto, classe) {
    const status = el('contrato-status');
    if (status) { status.textContent = texto; status.className = `prop-status${classe ? ` ${classe}` : ''}`; }
  }

  async function gerarPropostaAqui(botao) {
    if (typeof Proposta === 'undefined' || !Proposta.gerar) return;
    botao.disabled = true;
    botao.textContent = 'Gerando a proposta…';
    dizer('');
    const r = await Proposta.gerar();
    botao.disabled = false;
    if (r?.ok) dizer(`Proposta v${r.versao} gerada (abre numa aba nova).`, 'ok');
    else if (r?.erro) dizer(r.erro, 'erro');
    await atualizarEstado();
  }

  /** Salva a ficha e confere de novo o que falta, sem fechar. */
  async function salvarEConferir() {
    if (typeof Leads === 'undefined' || !Leads.emEdicao()) { alert('Salve o lead antes.'); return; }
    if (!(await Leads.salvar())) return;
    dizer('Salvo.', 'ok');
    await atualizarEstado();
  }

  function desenharPendencias(faltando, origem) {
    const alvo = el('contrato-pendencias');
    if (!alvo) return;
    if (!faltando.length) {
      alvo.innerHTML = `<p class="contrato-pronto">✓ Pronto para gerar: proposta v${esc(origem.proposta?.versao)}, forma "${esc(origem.forma?.nome)}", contratada ${esc(origem.contratada?.razao_social)}.</p>`;
      return;
    }
    alvo.innerHTML = `
      <p class="contrato-falta-titulo">Falta (conferido com o que está salvo):</p>
      <ul class="contrato-falta">${faltando.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`;
  }

  function desenharVersoes(versoes) {
    const caixa = el('contrato-versoes');
    if (!caixa) return;
    caixa.innerHTML = versoes.length
      ? versoes.map((x) => `
          <div class="prop-versao">
            <div>
              <strong>Versão ${x.versao}</strong>
              <span class="prop-meta">${esc(quando(x.gerado_em))} &middot; ${esc(x.gerado_por)} &middot; da proposta v${esc(x.proposta_versao)}</span>
              <code class="doc-contexto-arquivo">${esc(x.arquivo)}</code>
            </div>
            <button type="button" class="btn btn-sm btn-secondary" data-abrir-contrato="${x.versao}">Abrir</button>
          </div>`).join('')
      : '<span class="prop-vazio">Nenhum contrato gerado ainda.</span>';
  }

  /** Numa aba nova, como a proposta: de lá, "Salvar como PDF" e Clicksign. */
  function abrirVersao(versao) {
    const aba = window.open('', '_blank');
    fetch(`/api/contrato?lead_id=${leadAtual?.id}&html=1&versao=${versao}`)
      .then(async (r) => {
        if (r.ok) return r.text();
        const d = await r.json().catch(() => ({}));
        throw new Error(d.details || d.error || `HTTP ${r.status}`);
      })
      .then((html) => {
        if (!aba) { alert('Permita janelas pop-up para abrir o contrato.'); return; }
        aba.document.open();
        aba.document.write(html);
        aba.document.close();
      })
      .catch((e) => {
        aba?.close();
        alert(`Não foi possível abrir o contrato.\n\n${e.message}`);
      });
  }

  async function gerar() {
    if (!leadAtual?.id || typeof Leads === 'undefined' || !Leads.emEdicao()) {
      alert('Salve o lead antes de gerar o contrato.');
      return;
    }
    const botao = el('btn-gerar-contrato');
    const status = el('contrato-status');

    // O contrato sai do banco: o que está na tela precisa estar salvo.
    if (!(await Leads.salvar())) return;

    if (botao) { botao.disabled = true; botao.textContent = 'Gerando…'; }
    if (status) { status.textContent = ''; status.className = 'prop-status'; }
    try {
      const r = await fetch(`/api/contrato?lead_id=${leadAtual.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (d.faltando) desenharPendencias(d.faltando, {});
        if (status) {
          status.textContent = d.code === 'FALTANDO' ? 'Ainda falta o que está listado acima.' : `${d.error || 'Não foi possível gerar.'}${d.details ? ` (${d.details})` : ''}`;
          status.className = 'prop-status erro';
        }
        return;
      }
      if (status) { status.textContent = `Versão ${d.versao} gerada.`; status.className = 'prop-status ok'; }
      await atualizarEstado();
      abrirVersao(d.versao);
    } catch (e) {
      if (status) { status.textContent = `Falha de conexão ao gerar (${e.message}).`; status.className = 'prop-status erro'; }
    } finally {
      if (botao) { botao.disabled = false; botao.textContent = 'Gerar contrato'; }
    }
  }

  /* ==========================================================================
     2. AS CONFIGURAÇÕES
     ========================================================================== */

  let editando = { formas: null, contratadas: null };   // id em edição, 'nova', ou null

  function montarConfig() {
    const admin = ehAdmin();
    el('btn-forma-nova')?.classList.toggle('hidden', !admin || !!editando.formas);
    el('btn-contratada-nova')?.classList.toggle('hidden', !admin || !!editando.contratadas);
    if (!listas) return;
    desenharFormas(admin);
    desenharContratadas(admin);
  }

  function desenharFormas(admin) {
    const alvo = el('formas-lista');
    if (!alvo) return;
    alvo.innerHTML = listas.formas.length ? listas.formas.map((f) => `
      <details class="cc-linha${f.ativa ? '' : ' inativa'}" data-forma="${f.id}">
        <summary>
          <span class="cc-nome">${esc(f.nome)}</span>
          ${f.ativa ? '' : '<span class="cc-badge">inativa</span>'}
          <span class="cc-meta">${f.em_uso ? `em ${f.em_uso} lead(s)` : 'sem lead'}</span>
          ${admin ? `<span class="cc-botoes">
            <button type="button" class="btn btn-sm btn-secondary" data-acao="editar">Editar</button>
            <button type="button" class="btn btn-sm btn-secondary" data-acao="${f.ativa ? 'inativar' : 'reativar'}">${f.ativa ? 'Inativar' : 'Reativar'}</button>
            <button type="button" class="btn btn-sm btn-secondary" data-acao="excluir" title="${f.em_uso ? 'Em uso: só pode ser inativada' : 'Excluir'}">Excluir</button>
          </span>` : ''}
        </summary>
        <div class="cc-texto">${esc(f.texto)}</div>
      </details>`).join('') : '<div class="coluna-vazia">Nenhuma forma de preço cadastrada.</div>';
  }

  function desenharContratadas(admin) {
    const alvo = el('contratadas-lista');
    if (!alvo) return;
    alvo.innerHTML = listas.contratadas.length ? listas.contratadas.map((c) => {
      const reps = c.representantes.length
        ? c.representantes.map((r) => `${esc(r.nome)}${r.cargo ? ` (${esc(r.cargo)})` : ''}`).join(', ')
        : '<span class="cc-alerta">sem representante — o contrato não sai</span>';
      return `
        <details class="cc-linha${c.ativa ? '' : ' inativa'}" data-contratada="${c.id}">
          <summary>
            <span class="cc-nome">${esc(c.razao_social)}</span>
            ${c.padrao ? '<span class="cc-badge padrao">padrão</span>' : ''}
            ${c.ativa ? '' : '<span class="cc-badge">inativa</span>'}
            <span class="cc-meta">${esc(cnpjBr(c.cnpj))}</span>
            ${c.representantes.length ? '' : '<span class="cc-alerta cc-meta">sem quem assine</span>'}
            ${admin ? `<span class="cc-botoes">
              <button type="button" class="btn btn-sm btn-secondary" data-acao="editar">Editar</button>
              ${!c.padrao && c.ativa ? '<button type="button" class="btn btn-sm btn-secondary" data-acao="padrao">Tornar padrão</button>' : ''}
              ${!c.padrao ? `<button type="button" class="btn btn-sm btn-secondary" data-acao="${c.ativa ? 'inativar' : 'reativar'}">${c.ativa ? 'Inativar' : 'Reativar'}</button>` : ''}
              ${!c.padrao ? `<button type="button" class="btn btn-sm btn-secondary" data-acao="excluir">Excluir</button>` : ''}
            </span>` : ''}
          </summary>
          <div class="cc-texto">${esc([c.endereco, c.cidade, c.cep ? `CEP ${c.cep}` : null].filter(Boolean).join(' · ') || 'Sem endereço')}<br>Assina: ${reps}</div>
        </details>`;
    }).join('') : '<div class="coluna-vazia">Nenhuma empresa contratada cadastrada.</div>';
  }

  async function gravar(url, metodo, corpo) {
    try {
      const r = await fetch(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || 'Não foi possível salvar.'); return false; }
      return true;
    } catch (e) {
      alert('Falha de conexão ao salvar.');
      return false;
    }
  }

  /* ---------- editor da forma de preço ---------- */

  function abrirEditorForma(id) {
    const f = id === 'nova' ? { nome: '', texto: '' } : listas.formas.find((x) => x.id === id);
    if (!f) return;
    editando.formas = id;
    const ed = el('forma-editor');
    ed.innerHTML = `
      <div class="form-group">
        <label for="forma-ed-nome">Nome</label>
        <input type="text" id="forma-ed-nome" class="form-control" maxlength="80" value="${esc(f.nome)}">
      </div>
      <div class="form-group">
        <label for="forma-ed-texto">Texto da cláusula de preço</label>
        <textarea id="forma-ed-texto" class="form-control cc-textarea" rows="8" maxlength="4000">${esc(f.texto)}</textarea>
        <small class="campo-ajuda">Uma linha em branco separa os itens (A, B…). Clique num valor para inseri-lo onde está o cursor:</small>
        <div class="cc-marcadores">${listas.marcadores.map((m) =>
          `<button type="button" class="cc-marcador" data-marcador="${esc(m.chave)}" title="${esc(m.rotulo)}">{${esc(m.chave)}}</button>`).join('')}</div>
      </div>
      <div class="pessoa-form-acoes">
        <button type="button" class="btn btn-primary btn-sm" data-ed="salvar">Salvar</button>
        <button type="button" class="btn btn-secondary btn-sm" data-ed="cancelar">Cancelar</button>
      </div>`;
    ed.classList.remove('hidden');
    montarConfig();
    el('forma-ed-nome').focus();
  }

  async function salvarForma() {
    const corpo = { nome: el('forma-ed-nome').value, texto: el('forma-ed-texto').value };
    const id = editando.formas;
    const ok = id === 'nova'
      ? await gravar('/api/contrato-cadastros?tipo=formas', 'POST', corpo)
      : await gravar(`/api/contrato-cadastros?tipo=formas&id=${id}`, 'PUT', corpo);
    if (ok) fecharEditor('formas');
  }

  /* ---------- editor da contratada ---------- */

  const linhaRepresentante = (r = {}) => `
    <fieldset class="cc-rep">
      <div class="form-grid">
        <div class="form-group"><label>Nome</label><input type="text" class="form-control" data-rep="nome" maxlength="120" value="${esc(r.nome)}"></div>
        <div class="form-group"><label>CPF</label><input type="text" class="form-control" data-rep="cpf" maxlength="14" value="${esc(cpfBr(r.cpf))}"></div>
        <div class="form-group"><label>Nacionalidade</label><input type="text" class="form-control" data-rep="nacionalidade" maxlength="40" value="${esc(r.nacionalidade)}"></div>
        <div class="form-group"><label>Estado civil</label><select class="form-control" data-rep="estado_civil">
          <option value="">—</option>${(listas.estadosCivis || []).map((x) => `<option value="${esc(x)}"${x === r.estado_civil ? ' selected' : ''}>${esc(x)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>Cargo</label><input type="text" class="form-control" data-rep="cargo" maxlength="80" value="${esc(r.cargo)}" placeholder="Sócio Diretor"></div>
        <div class="form-group"><label>Reside em</label><input type="text" class="form-control" data-rep="residencia" maxlength="120" value="${esc(r.residencia)}" placeholder="Divinópolis/MG"></div>
      </div>
      <button type="button" class="btn btn-sm btn-secondary" data-ed="remover-rep">Remover representante</button>
    </fieldset>`;

  function abrirEditorContratada(id) {
    const c = id === 'nova' ? { razao_social: '', cnpj: '', representantes: [] } : listas.contratadas.find((x) => x.id === id);
    if (!c) return;
    editando.contratadas = id;
    const ed = el('contratada-editor');
    ed.innerHTML = `
      <div class="form-grid">
        <div class="form-group col-span-2"><label for="ctd-razao">Razão social</label>
          <input type="text" id="ctd-razao" class="form-control" maxlength="200" value="${esc(c.razao_social)}"></div>
        <div class="form-group"><label for="ctd-cnpj">CNPJ</label>
          <input type="text" id="ctd-cnpj" class="form-control" maxlength="18" value="${esc(cnpjBr(c.cnpj))}"></div>
        <div class="form-group"><label for="ctd-cep">CEP</label>
          <input type="text" id="ctd-cep" class="form-control" maxlength="9" value="${esc(c.cep)}"></div>
        <div class="form-group col-span-2"><label for="ctd-endereco">Endereço da sede</label>
          <input type="text" id="ctd-endereco" class="form-control" maxlength="300" value="${esc(c.endereco)}"></div>
        <div class="form-group"><label for="ctd-cidade">Cidade / UF</label>
          <input type="text" id="ctd-cidade" class="form-control" maxlength="120" value="${esc(c.cidade)}"></div>
      </div>
      <h4 class="cc-subtitulo">Quem assina pela empresa</h4>
      <div id="ctd-reps">${c.representantes.map(linhaRepresentante).join('')}</div>
      <button type="button" class="btn btn-sm btn-secondary" data-ed="mais-rep">+ Representante</button>
      <div class="pessoa-form-acoes">
        <button type="button" class="btn btn-primary btn-sm" data-ed="salvar">Salvar</button>
        <button type="button" class="btn btn-secondary btn-sm" data-ed="cancelar">Cancelar</button>
      </div>`;
    if (!c.representantes.length) el('ctd-reps').innerHTML = linhaRepresentante();
    ed.classList.remove('hidden');
    montarConfig();
    el('ctd-razao').focus();
  }

  async function salvarContratada() {
    const representantes = [...el('ctd-reps').querySelectorAll('.cc-rep')].map((f) => {
      const r = {};
      f.querySelectorAll('[data-rep]').forEach((c) => { r[c.dataset.rep] = c.value.trim(); });
      return r;
    }).filter((r) => Object.values(r).some(Boolean));
    const corpo = {
      razao_social: el('ctd-razao').value,
      cnpj: el('ctd-cnpj').value,
      cep: el('ctd-cep').value,
      endereco: el('ctd-endereco').value,
      cidade: el('ctd-cidade').value,
      representantes
    };
    const id = editando.contratadas;
    const ok = id === 'nova'
      ? await gravar('/api/contrato-cadastros?tipo=contratadas', 'POST', corpo)
      : await gravar(`/api/contrato-cadastros?tipo=contratadas&id=${id}`, 'PUT', corpo);
    if (ok) fecharEditor('contratadas');
  }

  async function fecharEditor(tipo) {
    editando[tipo] = null;
    const ed = el(tipo === 'formas' ? 'forma-editor' : 'contratada-editor');
    ed.classList.add('hidden');
    ed.innerHTML = '';
    await carregarListas();
    montarConfig();
  }

  /** Inativar, reativar, tornar padrão, excluir — os botões das linhas. */
  async function acaoNaLinha(tipo, id, acao) {
    const lista = tipo === 'formas' ? listas.formas : listas.contratadas;
    const item = lista.find((x) => x.id === id);
    if (!item) return;
    const nome = item.nome || item.razao_social;
    const url = `/api/contrato-cadastros?tipo=${tipo}&id=${id}`;

    if (acao === 'editar') {
      if (tipo === 'formas') abrirEditorForma(id); else abrirEditorContratada(id);
      return;
    }
    let ok = false;
    if (acao === 'inativar') {
      if (!confirm(`Inativar "${nome}"? Ela some das opções do lead; quem já a usa continua com ela.`)) return;
      ok = await gravar(url, 'PUT', { ativa: 0 });
    } else if (acao === 'reativar') {
      ok = await gravar(url, 'PUT', { ativa: 1 });
    } else if (acao === 'padrao') {
      if (!confirm(`Tornar "${nome}" a contratada padrão? Os leads sem contratada escolhida passam a usá-la.`)) return;
      ok = await gravar(url, 'PUT', { padrao: 1 });
    } else if (acao === 'excluir') {
      if (!confirm(`Excluir "${nome}"? Não dá para desfazer.`)) return;
      ok = await gravar(url, 'DELETE');
    }
    if (ok) { await carregarListas(); montarConfig(); }
  }

  function ligarConfig() {
    el('btn-forma-nova')?.addEventListener('click', () => abrirEditorForma('nova'));
    el('btn-contratada-nova')?.addEventListener('click', () => abrirEditorContratada('nova'));

    // Botão dentro do <summary>: sem o preventDefault, o clique também
    // abriria e fecharia a linha.
    el('formas-lista')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-acao]');
      if (!b) return;
      ev.preventDefault();
      acaoNaLinha('formas', Number(b.closest('[data-forma]').dataset.forma), b.dataset.acao);
    });
    el('contratadas-lista')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-acao]');
      if (!b) return;
      ev.preventDefault();
      acaoNaLinha('contratadas', Number(b.closest('[data-contratada]').dataset.contratada), b.dataset.acao);
    });

    el('forma-editor')?.addEventListener('click', (ev) => {
      const m = ev.target.closest('[data-marcador]');
      if (m) {
        const t = el('forma-ed-texto');
        const ins = `{${m.dataset.marcador}}`;
        const ini = t.selectionStart ?? t.value.length;
        t.value = t.value.slice(0, ini) + ins + t.value.slice(t.selectionEnd ?? ini);
        t.focus();
        t.selectionStart = t.selectionEnd = ini + ins.length;
        return;
      }
      const b = ev.target.closest('[data-ed]');
      if (b?.dataset.ed === 'salvar') salvarForma();
      if (b?.dataset.ed === 'cancelar') fecharEditor('formas');
    });
    el('contratada-editor')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-ed]');
      if (!b) return;
      if (b.dataset.ed === 'salvar') salvarContratada();
      if (b.dataset.ed === 'cancelar') fecharEditor('contratadas');
      if (b.dataset.ed === 'remover-rep') b.closest('.cc-rep')?.remove();
      if (b.dataset.ed === 'mais-rep') {
        const caixa = el('ctd-reps');
        if (caixa.querySelectorAll('.cc-rep').length >= 4) { alert('No máximo 4 representantes.'); return; }
        caixa.insertAdjacentHTML('beforeend', linhaRepresentante());
      }
    });
  }

  /* ==========================================================================
     3. NA FICHA DO CLIENTE
     ========================================================================== */

  const DICA = 'O contrato gerado na pré-venda, a partir do lead que deu origem ao cliente. Só leitura: para uma nova versão, abra o lead.';

  async function mostrarNoCliente(clienteId) {
    const alvo = el('cli-contrato-lista');
    if (!alvo) return;
    alvo.innerHTML = '';
    if (!clienteId) return;
    try {
      const d = await fetch(`/api/contrato?cliente_id=${clienteId}`).then((r) => r.json());
      if (!d.lead) return;                      // sem lead de origem, a Pré-venda já diz
      const v = d.versoes?.[0];
      if (!v) {
        alvo.innerHTML = `
          <div class="doc-linha doc-linha-vazia">
            <span class="doc-contexto-num">1</span>
            <div class="doc-linha-texto"><strong title="${esc(DICA)}">Contrato</strong>
              <span class="doc-linha-info">o lead de origem (${esc(d.lead.nome)}) não tem contrato gerado no CRM</span></div>
          </div>`;
        return;
      }
      const anteriores = d.versoes.length - 1;
      alvo.innerHTML = `
        <div class="doc-linha" title="Lead de origem: ${esc(d.lead.nome)} · da proposta v${esc(v.proposta_versao)}">
          <span class="doc-contexto-num">1</span>
          <div class="doc-linha-texto">
            <strong title="${esc(DICA)}">Contrato</strong>
            <span class="doc-linha-info">v${esc(v.versao)} · ${esc(quando(v.gerado_em))}${anteriores ? ` · +${anteriores} anterior(es)` : ''}</span>
            <code class="doc-contexto-arquivo">${esc(v.arquivo)}</code>
          </div>
          <div class="doc-linha-botoes">
            <button type="button" class="btn btn-sm btn-secondary" data-contrato-cli="abrir">Abrir</button>
            <button type="button" class="btn btn-sm btn-secondary" data-contrato-cli="baixar">Baixar</button>
          </div>
        </div>`;
      alvo.onclick = (ev) => {
        const b = ev.target.closest('[data-contrato-cli]');
        if (!b || typeof DossieReuniao === 'undefined') return;
        const url = (versao) => `/api/contrato?lead_id=${d.lead.id}&html=1&versao=${versao}`;
        if (b.dataset.contratoCli === 'baixar') DossieReuniao.baixarDocumento(url(v.versao), v.arquivo);
        else DossieReuniao.abrirDocumento({ titulo: `Contrato — ${d.lead.nome}`, versoes: d.versoes, url });
      };
    } catch (e) {
      alvo.innerHTML = '';
    }
  }

  /* ==========================================================================
     LIGAÇÃO
     ========================================================================== */

  function iniciar() {
    el('btn-gerar-contrato')?.addEventListener('click', gerar);
    el('contrato-versoes')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-abrir-contrato]');
      if (b) abrirVersao(Number(b.dataset.abrirContrato));
    });
    // Uma proposta gerada agora muda o que falta: confere de novo ao abrir a aba.
    document.querySelector('[data-tab="tab-contrato"]')?.addEventListener('click', () => {
      espelharEndereco();
      if (leadAtual?.id) atualizarEstado();
    });

    // 2.40.1: endereço espelhado; CEP com a busca do ViaCEP
    el('contrato-cidade')?.addEventListener('input', (ev) => { if (el('lead-input-cidade')) el('lead-input-cidade').value = ev.target.value; });
    el('contrato-endereco')?.addEventListener('input', (ev) => { if (el('lead-input-endereco')) el('lead-input-endereco').value = ev.target.value; });
    el('contrato-cep')?.addEventListener('input', (ev) => {
      if (el('lead-input-cep')) el('lead-input-cep').value = ev.target.value;
      if (soDigitos(ev.target.value).length === 8) buscarCepAqui();
    });
    el('contrato-cep')?.addEventListener('blur', buscarCepAqui);

    el('contrato-proposta')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-proposta]');
      if (!b) return;
      if (b.dataset.proposta === 'gerar') gerarPropostaAqui(b);
      else document.querySelector('[data-tab="tab-proposta"]')?.click();
    });
    el('btn-contrato-conferir')?.addEventListener('click', salvarEConferir);
    el('lead-input-km')?.addEventListener('input', sincronizarProposta);
    el('lead-input-forma-preco')?.addEventListener('change', sincronizarProposta);
    el('lead-input-doc')?.addEventListener('input', atualizarPessoaFisica);
    ligarConfig();

    document.addEventListener('crm:cliente-aba', (ev) => {
      if (ev.detail?.aba === 'cli-tab-documentos') mostrarNoCliente(ev.detail.clienteId);
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
  document.addEventListener('crm:autenticado', carregarListas, { once: true });

  return { abrir, lerCampos, montarConfig, carregarListas };
})();
