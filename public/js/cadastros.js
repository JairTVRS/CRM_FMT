/**
 * cadastros.js — advisors, tags, etapas, núcleos e papéis na memória
 * da tela.
 *
 * Todos seguem a mecânica do Lote A: digita o nome, vira opção para
 * todos. Sem tela de administração, sem perfil de admin.
 *
 * Vive num módulo próprio porque a ficha do lead, o quadro do funil e a
 * jornada do cliente precisam das mesmas listas. Uma cópia por tela
 * divergiria no primeiro cadastro novo.
 *
 * Núcleos e papéis entraram no Lote H, com a trilha de CX. Núcleo é o
 * Tipo de Reunião; papel é a função da pessoa do cliente.
 *
 * Desde a 2.31.0, mais duas listas: os MOTIVOS de perda (só admin
 * altera, nas Configurações) e os USUÁRIOS do CRM, que são os
 * responsáveis possíveis de um lead.
 *
 * `etapas` aqui é sempre a do funil COMERCIAL. As etapas da jornada
 * pertencem ao outro pipeline e quem as carrega é o clientes.js — uma
 * lista só de etapas para duas trilhas devolveria a coluna errada em
 * uma das duas.
 *
 * Carregar ANTES do leads.js e do clientes.js.
 */

const Cadastros = (() => {
  let dados = { advisors: [], tags: [], etapas: [], nucleos: [], papeis: [], motivos: [], usuarios: [] };
  let carregado = false;

  /** Uma requisição só para todas — é o que a ficha precisa ao abrir. */
  async function carregar() {
    try {
      // Os usuários vêm de outra rota; buscar junto não atrasa nada.
      const [r, ru] = await Promise.all([
        fetch('/api/cadastros?tipo=todos&pipeline=comercial'),
        fetch('/api/usuarios').catch(() => null)
      ]);
      if (!r.ok) return false;
      const d = await r.json();
      const u = ru && ru.ok ? await ru.json() : { usuarios: [] };
      dados = {
        advisors: d.advisors || [],
        tags: d.tags || [],
        etapas: d.etapas || [],
        nucleos: d.nucleos || [],
        papeis: d.papeis || [],
        motivos: d.motivos || [],
        usuarios: u.usuarios || []
      };
      carregado = true;
      document.dispatchEvent(new CustomEvent('crm:cadastros'));
      return true;
    } catch (e) {
      return false;
    }
  }

  const advisors = () => dados.advisors;
  const tags = () => dados.tags;
  const etapas = () => dados.etapas;
  const nucleos = () => dados.nucleos;
  const papeis = () => dados.papeis;
  const motivos = () => dados.motivos;
  const usuarios = () => dados.usuarios;
  const pronto = () => carregado;

  const acharPorNome = (lista, nome) => {
    const alvo = String(nome || '').trim().toLowerCase();
    return lista.find((i) => i.nome.trim().toLowerCase() === alvo) || null;
  };

  const advisorPorNome = (nome) => acharPorNome(dados.advisors, nome);
  const tagPorId = (id) => dados.tags.find((t) => t.id === Number(id)) || null;
  const etapaPorId = (id) => dados.etapas.find((e) => e.id === Number(id)) || null;
  const nucleoPorId = (id) => dados.nucleos.find((n) => n.id === Number(id)) || null;
  const motivoPorId = (id) => dados.motivos.find((m) => m.id === Number(id)) || null;

  /** A etapa é de perda? Só o funil comercial tem `resultado`. */
  const etapaDePerda = (id) => etapaPorId(id)?.resultado === 'perdido';

  /**
   * Como mostrar um responsável: o nome de quem já entrou no CRM, ou o
   * e-mail quando o nome ainda não chegou (quem não abriu o CRM desde a
   * 2.31.0 só tem o e-mail registrado).
   */
  function nomeDoUsuario(email) {
    if (!email) return null;
    const u = dados.usuarios.find((x) => x.email === String(email).toLowerCase());
    return u?.nome || email;
  }

  /**
   * Recarrega só uma lista, sem refazer a chamada inteira.
   *
   * Serve à tela de gerenciar núcleos e papéis, onde excluir um item
   * precisa refletir nas listas sem derrubar advisors, tags e etapas
   * junto — e sem disparar o evento que faria a ficha do lead se
   * remontar por causa de uma edição que não é dela.
   */
  async function recarregarLista(tipo) {
    try {
      const r = await fetch(`/api/cadastros?tipo=${tipo}`);
      if (!r.ok) return false;
      const d = await r.json();
      dados[tipo] = d[tipo] || [];
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Cria — ou recupera, se já existir com esse nome.
   *
   * A API devolve o registro existente com `jaExistia` em vez de erro:
   * quem está digitando quer o item na lista, não uma mensagem.
   */
  async function criar(tipo, nome, extras = {}) {
    const limpo = String(nome || '').trim();
    if (!limpo) return null;

    const existente = acharPorNome(dados[tipo], limpo);
    if (existente) return existente;

    try {
      const r = await fetch(`/api/cadastros?tipo=${tipo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: limpo, ...extras })
      });
      if (!r.ok) return null;

      const { registro } = await r.json();
      if (registro && !acharPorNome(dados[tipo], registro.nome)) {
        dados[tipo].push(registro);
        dados[tipo].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      }
      return registro;
    } catch (e) {
      return null;
    }
  }

  const criarAdvisor = (nome) => criar('advisors', nome);
  const criarTag = (nome, cor) => criar('tags', nome, cor ? { cor } : {});
  const criarNucleo = (nome, cor) => criar('nucleos', nome, cor ? { cor } : {});
  const criarPapel = (nome) => criar('papeis', nome);

  // Depende de sessão válida: antes disso o fetch interceptado devolve
  // 401 sintético e as listas nasceriam vazias.
  document.addEventListener('crm:autenticado', () => carregar(), { once: true });

  return {
    carregar, pronto, recarregarLista,
    advisors, tags, etapas, nucleos, papeis, motivos, usuarios,
    advisorPorNome, tagPorId, etapaPorId, nucleoPorId, motivoPorId,
    etapaDePerda, nomeDoUsuario,
    criarAdvisor, criarTag, criarNucleo, criarPapel
  };
})();
