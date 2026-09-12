/**
 * importar.js — Importação de planilhas de leads.
 *
 * O arquivo é lido AQUI, no navegador. Só o JSON estruturado sobe.
 * Isso permite mostrar os problemas antes de gravar qualquer coisa,
 * e evita trafegar a planilha comercial inteira até o servidor.
 *
 * Formatos: .xlsx, .xlsb, .xls, .csv e .txt.
 *
 * O .xls e o .xlsb ficaram de fora até a v2.23, com a justificativa de
 * que exigiriam "o pacote completo da SheetJS". A justificativa estava
 * errada: o CDN carregado aqui SEMPRE foi o `xlsx.full.min.js`, que traz
 * os dois parsers. A restrição não economizava nada — só obrigava quem
 * tinha um arquivo antigo a reabrir e salvar de novo antes de importar.
 *
 * A PLANILHA PRECISA TER UMA ABA SÓ. A regra é do usuário, e a razão
 * dela apareceu na primeira importação de verdade: a planilha de
 * propostas trazia uma segunda aba OCULTA ("Config", com feriados e
 * listas de validação), e o importador lia justamente essa — porque
 * pegava SheetNames[0] sem perguntar. O erro reclamava de colunas que
 * ninguém achava no arquivo, porque estavam numa aba invisível.
 *
 * As ocultas entram na conta de propósito: aceitar em silêncio o que a
 * pessoa não vê é como o problema nasceu. O que mudou foi o aviso, que
 * agora nomeia as abas encontradas e ensina a reexibir.
 *
 * Carregar DEPOIS do auth.js.
 */

const Importar = (() => {
  const CDN_SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  // Até onde procurar a linha do cabeçalho. Planilhas de trabalho
  // costumam ter título, logo ou linha em branco antes dos títulos das
  // colunas; assumir a linha 1 quebra em todas elas.
  const LIMITE_BUSCA_CABECALHO = 20;

  // Sem estas duas o lead não existe: o nome é como ele aparece na tela,
  // e o documento é a identidade que evita duplicata e dá contexto ao
  // dossiê. A ordem aqui é a ordem em que aparecem no aviso.
  const OBRIGATORIAS = [
    { campo: 'documento', rotulo: 'CNPJ' },
    { campo: 'nome', rotulo: 'Nome do cliente' }
  ];

  /**
   * O modelo que o botão "Baixar modelo" gera.
   *
   * É gerado na hora, no navegador, e não guardado como arquivo no
   * servidor: assim ele nunca fica defasado em relação ao dicionário de
   * colunas que o importador usa para ler. Modelo desatualizado é pior
   * que modelo nenhum — ensina o formato errado com ar de oficial.
   *
   * Uma aba só, pela mesma regra que a importação cobra de quem envia.
   */
  const MODELO = [
    'Data Cadastro', 'Quem atendeu?', 'Nome do cliente', 'CNPJ da Empresa',
    'Segmento', 'Cidade', 'Telefone de Contato', 'Canal', 'Advisor', 'Status2',
    'Data Ultimo Contato', 'Data próximo contato', 'Data Fechamento',
    'Valor Proposta (Contrato Ano)', 'Valor Diagnóstico',
    'Link Site da Empresa', 'Link Instagram da Empresa', 'Observações'
  ];

  let linhas = [];
  let nomeArquivo = '';
  let sheetjsCarregado = false;
  let ultimoLog = '';
  let etapasDisponiveis = [];
  let etapasNovas = [];

  // Os títulos das colunas vêm de um arquivo de terceiro e são escritos
  // na tela. Sem escapar, uma planilha com "<img onerror=...>" no
  // cabeçalho executaria script na sessão de quem importou.
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ----------------------------------------------------------
     Mapeamento dos cabeçalhos da planilha
     ---------------------------------------------------------- */

  // Aceita variações de acento, caixa e espaçamento. A chave é o
  // cabeçalho normalizado; o valor, o campo do sistema.
  const COLUNAS = {
    'datacadastro': 'data_cadastro',
    'quematendeu': 'atendente',
    'nomedocliente': 'nome',
    'nome': 'nome',
    'razaosocial': 'nome',
    'segmento': 'segmento',
    'cidade': 'cidade',
    'telefonedecontato': 'telefone',
    'telefone': 'telefone',
    'whatsapp': 'telefone',
    'canal': 'canal',
    'origem': 'canal',
    'advisor': 'advisor',
    'status2': 'etapa',
    'status': 'etapa',
    'etapa': 'etapa',
    'dataultimocontato': 'data_ultimo_contato',
    'dataproximocontato': 'data_proximo_contato',
    'datafechamento': 'data_fechamento',
    // A planilha de propostas chama a coluna de "Data Fechamento2".
    // Sem esta linha a data de fechamento dos 34 ganhos se perdia.
    'datafechamento2': 'data_fechamento',
    'valorpropostacontratoano': 'valor_proposta',
    'valorproposta': 'valor_proposta',
    'valordiagnostico': 'valor_diagnostico',
    'observacoes': 'observacoes',
    'observacao': 'observacoes',
    'cnpj': 'documento',
    'cnpjdaempresa': 'documento',
    'cpf': 'documento',
    'cnpjcpf': 'documento',
    'documento': 'documento',
    'linkinstagramdaempresa': 'instagram',
    'instagram': 'instagram',
    'linksitedaempresa': 'site',
    'site': 'site',
    'website': 'site'
  };

  // "Dias para próximo contato" é deliberadamente ignorado: é a
  // diferença entre hoje e a data do próximo contato, e guardado
  // nasceria desatualizado no dia seguinte.
  const IGNORADAS = ['diasparaproximocontato', 'diasproximocontato'];

  /**
   * Quando duas colunas disputam o mesmo campo, quem manda é esta lista
   * — e não a ordem em que aparecem na planilha.
   *
   * O caso que obrigou a regra: a planilha de propostas tem "Status"
   * (Aberto/Ganho/Perdido) na coluna F e "Status2" ("4 - Proposta",
   * "7 - Fechamento") na coluna R. A etapa de verdade do funil é a
   * segunda; a primeira é um resumo de três valores. Como F vem antes,
   * ela vencia por chegar primeiro — e 34 negócios GANHOS entravam como
   * "Novo Lead", porque "Ganho" não é nome de etapa nenhuma no CRM.
   */
  const PREFERENCIA = {
    etapa: ['status2', 'etapa', 'status']
  };

  /**
   * Etapas que a planilha chama de um jeito e o CRM de outro.
   *
   * Decidido com o usuário em 11/09/2026: "Fechamento" e "Finalizado"
   * são a mesma etapa terminal com nomes diferentes. Sem este de-para o
   * funil terminaria com duas colunas equivalentes, os 34 ganhos na
   * nova e a "Finalizado" vazia para sempre.
   */
  const SINONIMOS_ETAPA = {
    fechamento: 'Finalizado'
  };

  /**
   * "7 - Fechamento" -> "Finalizado";  "4 - Proposta" -> "Proposta".
   *
   * O prefixo numérico é a ordem do funil na planilha, não parte do
   * nome. Sem removê-lo, NENHUMA etapa casaria com o CRM — nem as
   * quatro que já existem com o mesmo nome.
   *
   * O separador é obrigatório no padrão: sem ele, uma etapa que comece
   * por número perderia o número por engano.
   */
  function normalizarEtapa(valor) {
    const semPrefixo = String(valor ?? '').replace(/^\s*\d+\s*[-–—.]\s*/, '').trim();
    if (!semPrefixo) return String(valor ?? '').trim();

    return SINONIMOS_ETAPA[normalizarCabecalho(semPrefixo)] || semPrefixo;
  }

  function normalizarCabecalho(texto) {
    return String(texto || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Campo do sistema -> títulos que o alimentam, o melhor primeiro.
   *
   * É lista, e não título único, porque a mesma planilha pode trazer
   * duas colunas para o mesmo campo (Telefone e WhatsApp, Status e
   * Status2). A ordem aqui é a ordem em que serão tentadas na leitura.
   */
  function mapaDoCabecalho(cabecalho) {
    const candidatos = new Map();

    cabecalho.forEach((titulo) => {
      const norm = normalizarCabecalho(titulo);
      if (!norm || IGNORADAS.includes(norm)) return;

      const campo = COLUNAS[norm];
      if (!campo) return;

      if (!candidatos.has(campo)) candidatos.set(campo, []);
      candidatos.get(campo).push({ titulo, norm });
    });

    const mapa = new Map();

    for (const [campo, lista] of candidatos) {
      const ordem = PREFERENCIA[campo];
      if (ordem) {
        // `sort` é estável: sem preferência declarada, vale a ordem
        // das colunas na planilha, que era o comportamento anterior.
        const rank = (c) => (ordem.indexOf(c.norm) < 0 ? ordem.length : ordem.indexOf(c.norm));
        lista.sort((a, b) => rank(a) - rank(b));
      }
      mapa.set(campo, lista.map((c) => c.titulo));
    }

    return mapa;
  }

  /** O primeiro valor preenchido entre as colunas candidatas. */
  function primeiroPreenchido(linha, titulos) {
    for (const titulo of titulos || []) {
      const valor = linha[titulo];
      if (String(valor ?? '').trim()) return valor;
    }
    return '';
  }

  /** Colunas que existem na planilha e o sistema não usa. */
  function colunasIgnoradas(cabecalho) {
    return cabecalho.filter((titulo) => {
      const norm = normalizarCabecalho(titulo);
      return norm && !COLUNAS[norm] && !IGNORADAS.includes(norm);
    });
  }

  /* ----------------------------------------------------------
     Descoberta do cabeçalho
     ---------------------------------------------------------- */

  /** Quantas células desta linha são títulos que o sistema conhece. */
  function pontuarLinha(celulas) {
    let pontos = 0;
    (celulas || []).forEach((celula) => {
      const norm = normalizarCabecalho(celula);
      if (norm && (COLUNAS[norm] || IGNORADAS.includes(norm))) pontos++;
    });
    return pontos;
  }

  /**
   * O cabeçalho é a linha que mais PARECE um cabeçalho, não a primeira.
   *
   * Empate fica com a de cima: numa planilha que repete os títulos, a
   * primeira ocorrência é a que tem os dados logo abaixo.
   */
  function acharCabecalho(matriz) {
    let melhor = { indice: -1, pontos: 0 };
    const limite = Math.min(matriz.length, LIMITE_BUSCA_CABECALHO);

    for (let i = 0; i < limite; i++) {
      const pontos = pontuarLinha(matriz[i]);
      if (pontos > melhor.pontos) melhor = { indice: i, pontos };
    }
    return melhor;
  }

  /**
   * Transforma a matriz em objetos, guardando a linha REAL da planilha.
   *
   * `primeiraLinhaReal` é o número da linha que a matriz começa: a aba
   * pode não começar em A1, e sem isto o relatório de erros mandaria
   * conferir uma linha que não é a do problema.
   */
  function montarLinhas(matriz, indiceCabecalho, primeiraLinhaReal) {
    const cabecalho = (matriz[indiceCabecalho] || []).map((c) => String(c ?? '').trim());
    const linhasBrutas = [];

    for (let i = indiceCabecalho + 1; i < matriz.length; i++) {
      const valores = matriz[i] || [];
      const obj = {};

      cabecalho.forEach((titulo, coluna) => {
        if (titulo) obj[titulo] = valores[coluna] ?? '';
      });

      obj.__linha = primeiraLinhaReal + i;
      linhasBrutas.push(obj);
    }

    return { cabecalho, linhasBrutas };
  }

  /**
   * Corta o rastro de fórmulas do fim da planilha.
   *
   * Não serve cortar na primeira linha vazia: na planilha de propostas
   * da Formatar as sete últimas linhas devolvem `0`, `1900/01` e
   * "Data errada" em vez de vazio, porque as fórmulas se estendem
   * alguns registros além dos dados. O que elas não têm é nome.
   *
   * Só o rastro do FIM é descartado. Linha sem nome no meio dos dados
   * continua sendo erro e é reportada como tal — ali é digitação
   * faltando, não fim de planilha.
   */
  function cortarRastroFinal(linhasBrutas, titulosDoNome) {
    if (!titulosDoNome?.length) return linhasBrutas;

    let fim = linhasBrutas.length;
    while (fim > 0 && !primeiroPreenchido(linhasBrutas[fim - 1], titulosDoNome)) fim--;
    return linhasBrutas.slice(0, fim);
  }

  /* ----------------------------------------------------------
     Leitura dos formatos
     ---------------------------------------------------------- */

  function carregarSheetJs() {
    if (sheetjsCarregado) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CDN_SHEETJS;
      s.onload = () => { sheetjsCarregado = true; resolve(); };
      s.onerror = () => reject(new Error('Não foi possível carregar o leitor de planilhas.'));
      document.head.appendChild(s);
    });
  }

  /** Descobre o separador contando ocorrências na primeira linha útil. */
  function detectarSeparador(primeiraLinha) {
    const candidatos = ['\t', ';', ','];
    let melhor = ';';
    let maior = 0;
    candidatos.forEach((sep) => {
      const n = primeiraLinha.split(sep).length;
      if (n > maior) { maior = n; melhor = sep; }
    });
    return melhor;
  }

  /** CSV com aspas: campo entre aspas pode conter o separador. */
  function dividirLinhaCsv(linha, sep) {
    const campos = [];
    let atual = '';
    let dentroDeAspas = false;

    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === '"') {
        if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
        else dentroDeAspas = !dentroDeAspas;
      } else if (c === sep && !dentroDeAspas) {
        campos.push(atual); atual = '';
      } else {
        atual += c;
      }
    }
    campos.push(atual);
    return campos.map((c) => c.trim());
  }

  /**
   * Texto (.csv, .txt) -> matriz de células.
   *
   * As linhas em branco do MEIO são preservadas: descartá-las faria a
   * numeração do relatório divergir da planilha aberta no Excel, e o
   * usuário procuraria o erro na linha errada. Só as do fim caem.
   */
  async function lerTexto(arquivo) {
    const conteudo = (await arquivo.text()).replace(/^\uFEFF/, '');
    const linhasBrutas = conteudo.split(/\r?\n/);

    while (linhasBrutas.length && !linhasBrutas[linhasBrutas.length - 1].trim()) {
      linhasBrutas.pop();
    }
    if (linhasBrutas.length < 2) {
      throw new Error('O arquivo não tem dados além do cabeçalho.');
    }

    const referencia = linhasBrutas.find((l) => l.trim()) || linhasBrutas[0];
    const sep = detectarSeparador(referencia);

    return {
      abas: null,
      matriz: linhasBrutas.map((l) => dividirLinhaCsv(l, sep)),
      primeiraLinhaReal: 1
    };
  }

  /**
   * Planilha (.xlsx) -> abas + matriz de células.
   *
   * Devolve as abas mesmo quando são muitas: quem chama precisa da
   * lista para conseguir NOMEAR o que encontrou no aviso de erro.
   */
  async function lerExcel(arquivo) {
    await carregarSheetJs();
    const buffer = await arquivo.arrayBuffer();
    const pasta = XLSX.read(buffer, { type: 'array', cellDates: true });

    // `Hidden` é 0 visível, 1 oculta, 2 muito oculta. Em arquivo sem o
    // bloco de metadados o campo não existe — trata como visível, que é
    // o comportamento do Excel.
    const abas = pasta.SheetNames.map((nome, i) => ({
      nome,
      oculta: (pasta.Workbook?.Sheets?.[i]?.Hidden ?? 0) !== 0
    }));

    if (abas.length !== 1) return { abas, matriz: null, primeiraLinhaReal: 1 };

    const aba = pasta.Sheets[pasta.SheetNames[0]];
    const matriz = XLSX.utils.sheet_to_json(aba, {
      header: 1, defval: '', raw: false, blankrows: true
    });

    // A aba pode não começar em A1 — a matriz começa onde o conteúdo
    // começa, e a numeração das linhas precisa acompanhar.
    const inicio = aba['!ref'] ? XLSX.utils.decode_range(aba['!ref']).s.r : 0;

    return { abas, matriz, primeiraLinhaReal: inicio + 1 };
  }

  /* ----------------------------------------------------------
     Conversão para o formato da API
     ---------------------------------------------------------- */

  /**
   * Percorre os CAMPOS, não as colunas.
   *
   * A versão anterior varria as colunas da planilha na ordem em que
   * apareciam e ficava com a primeira preenchida. Isso deixava a ordem
   * das colunas decidir qual dado vencia uma disputa — e foi assim que
   * "Status" derrotou "Status2". Agora quem decide é o `PREFERENCIA`.
   */
  function mapear(linhasBrutas, mapa) {
    return linhasBrutas.map((bruta) => {
      const saida = { _linha: bruta.__linha };

      for (const [campo, titulos] of mapa) {
        const valor = primeiroPreenchido(bruta, titulos);
        if (valor !== '') saida[campo] = valor;
      }

      // A etapa é a única que chega com vocabulário próprio da planilha.
      if (saida.etapa) saida.etapa = normalizarEtapa(saida.etapa);

      return saida;
    });
  }

  /* ----------------------------------------------------------
     Interface
     ---------------------------------------------------------- */

  const el = (id) => document.getElementById(id);

  function mostrar(secao) {
    ['imp-inicio', 'imp-analise', 'imp-previa', 'imp-erro', 'imp-sucesso']
      .forEach((id) => { const n = el(id); if (n) n.style.display = id === secao ? '' : 'none'; });
  }

  function abrir() {
    linhas = [];
    nomeArquivo = '';
    ultimoLog = '';
    etapasDisponiveis = [];
    etapasNovas = [];
    el('importar-modal').classList.add('aberto');
    document.body.style.overflow = 'hidden';
    mostrar('imp-inicio');
    const campo = el('imp-arquivo');
    if (campo) campo.value = '';
  }

  function fechar() {
    el('importar-modal').classList.remove('aberto');
    document.body.style.overflow = '';
  }

  /**
   * Mostra o problema e guarda o mesmo conteúdo como log.
   *
   * O log existe para a planilha que não é de quem importa: a CX recebe
   * o arquivo pronto de outra pessoa e precisa devolver o que corrigir
   * sem depender de print de tela.
   */
  function erro(titulo, mensagem, detalhes) {
    mostrar('imp-erro');
    el('imp-erro-titulo').textContent = titulo;
    el('imp-erro-msg').textContent = mensagem;

    ultimoLog = [
      'Log de importação — CRM Formatar',
      `Arquivo: ${nomeArquivo || '(não informado)'}`,
      `Data: ${new Date().toLocaleString('pt-BR')}`,
      '',
      titulo,
      mensagem,
      ...(detalhes?.length ? ['', ...detalhes.map((d) => `- ${d}`)] : [])
    ].join('\n');

    const botaoLog = el('btn-imp-log');
    if (botaoLog) botaoLog.style.display = '';

    const lista = el('imp-erro-detalhes');
    if (!lista) return;

    if (detalhes?.length) {
      lista.innerHTML = detalhes.map((d) => `<li>${esc(d)}</li>`).join('');
      lista.style.display = '';
    } else {
      lista.style.display = 'none';
    }
  }

  /**
   * Gera e baixa o modelo em branco, no navegador.
   *
   * Sem linha de exemplo de propósito: exemplo esquecido na planilha
   * entra como lead de mentira. O formato de data e valor é o que o
   * conversor já aceita em qualquer forma usual.
   */
  async function baixarModelo() {
    const botoes = [el('btn-imp-modelo'), el('btn-imp-modelo-erro')].filter(Boolean);
    botoes.forEach((b) => { b.disabled = true; });

    try {
      await carregarSheetJs();

      const aba = XLSX.utils.aoa_to_sheet([MODELO]);
      aba['!cols'] = MODELO.map((t) => ({ wch: Math.max(14, t.length + 2) }));

      const pasta = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(pasta, aba, 'Leads');

      // Gera o conteúdo e baixa pelo mesmo caminho do log, em vez de
      // `XLSX.writeFile`: um mecanismo de download só no arquivo todo.
      baixar(
        new Blob([XLSX.write(pasta, { type: 'array', bookType: 'xlsx' })],
          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        'Modelo-Importacao-Leads.xlsx'
      );

    } catch (e) {
      erro('Falha ao gerar o modelo', e.message);
    } finally {
      botoes.forEach((b) => { b.disabled = false; });
    }
  }

  /** Entrega um arquivo ao usuário. Único lugar que faz download. */
  function baixar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function baixarLog() {
    if (!ultimoLog) return;

    baixar(
      new Blob([ultimoLog], { type: 'text/plain;charset=utf-8' }),
      `log-importacao-${new Date().toISOString().slice(0, 10)}.txt`
    );
  }

  /* ----------------------------------------------------------
     Fluxo
     ---------------------------------------------------------- */

  /** "Config (oculta) · Propostas" */
  function descreverAbas(abas) {
    return abas.map((a) => a.nome + (a.oculta ? ' (oculta)' : '')).join(' · ');
  }

  async function aoEscolherArquivo(ev) {
    const arquivo = ev.target.files?.[0];
    if (!arquivo) return;

    nomeArquivo = arquivo.name;
    const ext = arquivo.name.split('.').pop().toLowerCase();

    if (!['xlsx', 'xlsb', 'xls', 'csv', 'txt'].includes(ext)) {
      return erro('Formato não suportado', 'Use .xlsx, .xlsb, .xls, .csv ou .txt.');
    }

    mostrar('imp-analise');
    el('imp-analise-msg').textContent = `Lendo ${arquivo.name}…`;

    try {
      const leitura = ['csv', 'txt'].includes(ext)
        ? await lerTexto(arquivo)
        : await lerExcel(arquivo);

      /* ---- 1. uma aba só ---- */
      if (leitura.abas && leitura.abas.length !== 1) {
        return erro(
          'O arquivo tem mais de uma aba',
          'A importação aceita apenas uma. Deixe somente a aba com os dados dos leads e reimporte.',
          [
            `Abas encontradas: ${descreverAbas(leitura.abas)}`,
            'Para remover uma aba oculta: clique com o botão direito em qualquer etiqueta na parte de baixo do Excel, escolha "Reexibir", selecione a aba e apague.'
          ]
        );
      }

      const matriz = leitura.matriz || [];
      if (matriz.length === 0) {
        return erro('Planilha vazia', 'Não há linhas no arquivo.');
      }

      /* ---- 2. onde está o cabeçalho ---- */
      const { indice, pontos } = acharCabecalho(matriz);

      if (indice < 0 || pontos === 0) {
        return erro(
          'Cabeçalho não reconhecido',
          'Nenhuma coluna conhecida foi encontrada nas primeiras linhas. Confira se a planilha tem uma linha com os títulos das colunas.',
          [`Colunas obrigatórias: ${OBRIGATORIAS.map((o) => o.rotulo).join(', ')}`]
        );
      }

      const { cabecalho, linhasBrutas } =
        montarLinhas(matriz, indice, leitura.primeiraLinhaReal);

      /* ---- 3. as colunas obrigatórias existem? ---- */
      const mapa = mapaDoCabecalho(cabecalho);
      const faltando = OBRIGATORIAS.filter((o) => !mapa.has(o.campo));
      const ignoradas = colunasIgnoradas(cabecalho);

      if (faltando.length) {
        return erro(
          `Falta a coluna obrigatória: ${faltando.map((f) => f.rotulo).join(', ')}`,
          'Este é o modelo padrão para importação dos cadastros de leads. Baixe o modelo da planilha, preencha as colunas e reimporte os dados.',
          [
            `Linha do cabeçalho: ${leitura.primeiraLinhaReal + indice}`,
            `Colunas reconhecidas: ${[...mapa.values()].join(', ') || 'nenhuma'}`,
            ...ignoradas.map((c) => `Coluna ignorada: ${c}`)
          ]
        );
      }

      /* ---- 4. o rastro de fórmulas do fim não é dado ---- */
      const uteis = cortarRastroFinal(linhasBrutas, mapa.get('nome'));

      if (uteis.length === 0) {
        return erro(
          'Planilha sem dados',
          'A planilha tem cabeçalho, mas nenhuma linha com nome de cliente abaixo dele.'
        );
      }

      linhas = mapear(uteis, mapa);
      await pedirPrevia(ignoradas);

    } catch (e) {
      erro('Falha ao ler o arquivo', e.message);
    }
  }

  /**
   * O bloco da prévia que trata dos cadastros de apoio.
   *
   * Uma etapa que a planilha traz e o CRM não tem é uma decisão, não um
   * detalhe: criá-la em silêncio faz o quadro ganhar colunas que ninguém
   * pediu, e mandá-la para a etapa padrão joga fora a posição no funil.
   * Por isso a pergunta aparece ANTES de qualquer gravação, com as duas
   * saídas — criar, ou apontar para uma etapa que já existe.
   *
   * O padrão é "criar": é o que preserva o dado da planilha. Quem quiser
   * unificar com uma etapa existente muda no select.
   */
  function desenharApoio(apoio) {
    const caixa = el('imp-previa-apoio');
    if (!caixa) return;

    etapasDisponiveis = apoio?.etapasDisponiveis || [];
    etapasNovas = apoio?.etapasNovas || [];

    const advisors = apoio?.advisorsNovos || [];

    if (!etapasNovas.length && !advisors.length) {
      caixa.style.display = 'none';
      caixa.innerHTML = '';
      return;
    }

    const opcoes = (nome) => [
      `<option value="criar">Criar a etapa "${esc(nome)}"</option>`,
      ...etapasDisponiveis.map((e) =>
        `<option value="${esc(e.id)}">Usar a etapa existente: ${esc(e.nome)}</option>`)
    ].join('');

    const blocoEtapas = etapasNovas.length ? `
      <strong>${etapasNovas.length} etapa(s) da planilha não existem no funil.</strong>
      <ul class="imp-apoio-lista">
        ${etapasNovas.map((e) => `
          <li>
            <span class="imp-apoio-nome">${esc(e.nome)}</span>
            <span class="imp-apoio-qtd">${e.linhas} lead(s)</span>
            <select class="imp-apoio-select" data-etapa="${esc(e.nome)}">${opcoes(e.nome)}</select>
          </li>`).join('')}
      </ul>` : '';

    const blocoAdvisors = advisors.length
      ? `<p class="imp-apoio-advisors">Advisors que serão cadastrados:
         ${advisors.map((a) => `<code>${esc(a.nome)}</code>`).join(', ')}.</p>`
      : '';

    caixa.innerHTML = blocoEtapas + blocoAdvisors;
    caixa.style.display = '';
  }

  /** O que os selects da prévia dizem, no formato que a API espera. */
  function decisoesEtapa() {
    const decisoes = {};
    document.querySelectorAll('#imp-previa-apoio .imp-apoio-select')
      .forEach((s) => { decisoes[s.dataset.etapa] = s.value; });
    return decisoes;
  }

  async function pedirPrevia(naoReconhecidas) {
    el('imp-analise-msg').textContent = 'Conferindo os dados…';

    try {
      const r = await fetch('/api/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linhas, confirmar: false })
      });
      const d = await r.json();

      if (!r.ok) return mostrarProblemas(d);

      mostrar('imp-previa');
      el('imp-previa-arquivo').textContent = nomeArquivo;
      el('imp-previa-total').textContent = d.total;
      el('imp-previa-novos').textContent = d.novos;
      el('imp-previa-atualizados').textContent = d.atualizados;

      const aviso = el('imp-previa-atualizacoes');
      if (d.atualizados > 0) {
        aviso.innerHTML = `<strong>${d.atualizados} lead(s) já cadastrados serão atualizados.</strong>
          Campos em branco na planilha não apagam o que já está preenchido.` +
          (d.exemplosAtualizacao?.length
            ? `<ul>${d.exemplosAtualizacao.map((e) =>
                `<li>Linha ${esc(e.linha)}: ${esc(e.nomeNoSistema)}</li>`).join('')}</ul>`
            : '');
        aviso.style.display = '';
      } else {
        aviso.style.display = 'none';
      }

      desenharApoio(d.apoio);

      const ignoradas = el('imp-previa-ignoradas');
      if (naoReconhecidas?.length) {
        ignoradas.innerHTML = `Colunas não reconhecidas, que serão ignoradas:
          ${naoReconhecidas.map((c) => `<code>${esc(c)}</code>`).join(', ')}`;
        ignoradas.style.display = '';
      } else {
        ignoradas.style.display = 'none';
      }

    } catch (e) {
      erro('Falha de conexão', e.message);
    }
  }

  /**
   * "Sem CNPJ/CPF: todas as 98 linhas" em vez de 98 números seguidos.
   *
   * O caso comum não é uma linha esquecida: é a planilha inteira sem a
   * coluna preenchida, logo depois de baixar o modelo. Despejar a
   * numeração toda esconde o recado em vez de entregá-lo.
   */
  function resumirLinhas(rotulo, numeros) {
    if (numeros.length === linhas.length) {
      return `${rotulo}: todas as ${numeros.length} linhas`;
    }
    if (numeros.length <= 20) {
      return `${rotulo} nas linhas: ${numeros.join(', ')}`;
    }
    return `${rotulo} em ${numeros.length} linhas, entre elas: `
      + `${numeros.slice(0, 20).join(', ')}…`;
  }

  function mostrarProblemas(d) {
    const p = d.problemas || {};
    const detalhes = [];

    if (p.semDocumento?.length) {
      detalhes.push(resumirLinhas('Sem CNPJ/CPF', p.semDocumento));
    }
    if (p.documentoInvalido?.length) {
      p.documentoInvalido.slice(0, 15).forEach((x) =>
        detalhes.push(`Linha ${x.linha}: documento inválido (${x.documento})`));
      if (p.documentoInvalido.length > 15) {
        detalhes.push(`…e mais ${p.documentoInvalido.length - 15} linha(s).`);
      }
    }
    if (p.semNome?.length) {
      detalhes.push(resumirLinhas('Sem nome do cliente', p.semNome));
    }
    if (p.duplicadasNoArquivo?.length) {
      p.duplicadasNoArquivo.slice(0, 10).forEach((x) =>
        detalhes.push(`Linha ${x.linha}: documento repetido (já aparece na linha ${x.primeira})`));
    }

    erro('Não foi possível importar', d.error || 'Corrija a planilha e tente novamente.', detalhes);
  }

  async function confirmar() {
    const botao = el('btn-imp-confirmar');
    if (botao) { botao.disabled = true; botao.textContent = 'Importando…'; }

    try {
      const r = await fetch('/api/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linhas, confirmar: true, decisoesEtapa: decisoesEtapa() })
      });
      const d = await r.json();

      if (!r.ok) return mostrarProblemas(d);

      mostrar('imp-sucesso');
      el('imp-sucesso-msg').innerHTML =
        `<strong>${d.novos}</strong> lead(s) criados e <strong>${d.atualizados}</strong> atualizados.` +
        (d.etapasCriadas?.length
          ? `<br>Etapas criadas no funil: ${d.etapasCriadas.map(esc).join(', ')}.`
          : '') +
        (d.advisorsCriados?.length
          ? `<br>Advisors cadastrados automaticamente: ${d.advisorsCriados.map(esc).join(', ')}.`
          : '');

      if (typeof Leads !== 'undefined') Leads.carregar();

    } catch (e) {
      erro('Falha ao importar', e.message);
    } finally {
      if (botao) { botao.disabled = false; botao.textContent = 'Confirmar importação'; }
    }
  }

  /* ----------------------------------------------------------
     Ligação
     ---------------------------------------------------------- */

  function iniciar() {
    el('btn-importar')?.addEventListener('click', abrir);
    el('btn-imp-fechar')?.addEventListener('click', fechar);
    el('imp-fundo')?.addEventListener('click', fechar);
    el('imp-arquivo')?.addEventListener('change', aoEscolherArquivo);
    el('btn-imp-confirmar')?.addEventListener('click', confirmar);
    el('btn-imp-cancelar')?.addEventListener('click', fechar);
    el('btn-imp-voltar')?.addEventListener('click', () => mostrar('imp-inicio'));
    el('btn-imp-concluir')?.addEventListener('click', fechar);
    el('btn-imp-log')?.addEventListener('click', baixarLog);
    el('btn-imp-modelo')?.addEventListener('click', baixarModelo);
    el('btn-imp-modelo-erro')?.addEventListener('click', baixarModelo);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && el('importar-modal')?.classList.contains('aberto')) fechar();
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { abrir, fechar };
})();
