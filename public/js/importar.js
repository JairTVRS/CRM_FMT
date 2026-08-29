/**
 * importar.js — Importação de planilhas de leads.
 *
 * O arquivo é lido AQUI, no navegador. Só o JSON estruturado sobe.
 * Isso permite mostrar os problemas antes de gravar qualquer coisa,
 * e evita trafegar a planilha comercial inteira até o servidor.
 *
 * Formatos: .xlsx, .csv e .txt. O .xls binário de 1997 ficou de fora
 * por decisão conjunta — exige o pacote completo da SheetJS, que
 * pesaria no carregamento de todos os dias por causa de uns poucos
 * arquivos antigos. Salvar como .xlsx no Excel resolve.
 *
 * Carregar DEPOIS do auth.js.
 */

const Importar = (() => {
  const CDN_SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  let linhas = [];
  let nomeArquivo = '';
  let sheetjsCarregado = false;

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

  function normalizarCabecalho(texto) {
    return String(texto || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
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

  /** Descobre o separador contando ocorrências na primeira linha. */
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

  async function lerTexto(arquivo) {
    const conteudo = await arquivo.text();
    const linhasBrutas = conteudo.split(/\r?\n/).filter((l) => l.trim());
    if (linhasBrutas.length < 2) throw new Error('O arquivo não tem dados além do cabeçalho.');

    const sep = detectarSeparador(linhasBrutas[0]);
    const cabecalho = dividirLinhaCsv(linhasBrutas[0], sep);

    return linhasBrutas.slice(1).map((linha, i) => {
      const valores = dividirLinhaCsv(linha, sep);
      const obj = {};
      cabecalho.forEach((h, j) => { obj[h] = valores[j] ?? ''; });
      obj.__linha = i + 2;   // +2: linha 1 é o cabeçalho, e planilha conta do 1
      return obj;
    });
  }

  async function lerExcel(arquivo) {
    await carregarSheetJs();
    const buffer = await arquivo.arrayBuffer();
    const pasta = XLSX.read(buffer, { type: 'array', cellDates: true });
    const aba = pasta.Sheets[pasta.SheetNames[0]];

    const dados = XLSX.utils.sheet_to_json(aba, { defval: '', raw: false });
    return dados.map((d, i) => ({ ...d, __linha: i + 2 }));
  }

  /* ----------------------------------------------------------
     Conversão para o formato da API
     ---------------------------------------------------------- */

  function mapear(brutas) {
    const naoReconhecidas = new Set();

    const convertidas = brutas.map((bruta) => {
      const saida = { _linha: bruta.__linha };

      Object.entries(bruta).forEach(([chave, valor]) => {
        if (chave === '__linha') return;
        const norm = normalizarCabecalho(chave);
        if (IGNORADAS.includes(norm)) return;

        const campo = COLUNAS[norm];
        if (campo) {
          // Duas colunas podem apontar para o mesmo campo; a primeira
          // preenchida vence, para não sobrescrever com vazio
          if (!saida[campo]) saida[campo] = valor;
        } else if (String(valor || '').trim()) {
          naoReconhecidas.add(chave);
        }
      });

      return saida;
    });

    return { convertidas, naoReconhecidas: [...naoReconhecidas] };
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

  function erro(titulo, mensagem, detalhes) {
    mostrar('imp-erro');
    el('imp-erro-titulo').textContent = titulo;
    el('imp-erro-msg').textContent = mensagem;

    const lista = el('imp-erro-detalhes');
    if (!lista) return;
    if (detalhes?.length) {
      lista.innerHTML = detalhes.map((d) => `<li>${d}</li>`).join('');
      lista.style.display = '';
    } else {
      lista.style.display = 'none';
    }
  }

  /* ----------------------------------------------------------
     Fluxo
     ---------------------------------------------------------- */

  async function aoEscolherArquivo(ev) {
    const arquivo = ev.target.files?.[0];
    if (!arquivo) return;

    nomeArquivo = arquivo.name;
    const ext = arquivo.name.split('.').pop().toLowerCase();

    if (ext === 'xls') {
      return erro(
        'Formato não suportado',
        'O .xls antigo (Excel 97-2003) não é lido aqui. Abra o arquivo no Excel e salve como .xlsx — leva alguns segundos e o resultado é o mesmo.'
      );
    }
    if (!['xlsx', 'csv', 'txt'].includes(ext)) {
      return erro('Formato não suportado', 'Use .xlsx, .csv ou .txt.');
    }

    mostrar('imp-analise');
    el('imp-analise-msg').textContent = `Lendo ${arquivo.name}…`;

    try {
      const brutas = ext === 'xlsx' ? await lerExcel(arquivo) : await lerTexto(arquivo);

      if (brutas.length === 0) {
        return erro('Planilha vazia', 'Não há linhas de dados no arquivo.');
      }

      const { convertidas, naoReconhecidas } = mapear(brutas);

      if (!convertidas.some((l) => l.nome)) {
        return erro(
          'Cabeçalho não reconhecido',
          'Nenhuma coluna com o nome do cliente foi encontrada. Confira se a primeira linha da planilha contém os títulos das colunas.',
          naoReconhecidas.map((c) => `Coluna não reconhecida: ${c}`)
        );
      }

      linhas = convertidas;
      await pedirPrevia(naoReconhecidas);

    } catch (e) {
      erro('Falha ao ler o arquivo', e.message);
    }
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
                `<li>Linha ${e.linha}: ${e.nomeNoSistema}</li>`).join('')}</ul>`
            : '');
        aviso.style.display = '';
      } else {
        aviso.style.display = 'none';
      }

      const ignoradas = el('imp-previa-ignoradas');
      if (naoReconhecidas?.length) {
        ignoradas.innerHTML = `Colunas não reconhecidas, que serão ignoradas:
          ${naoReconhecidas.map((c) => `<code>${c}</code>`).join(', ')}`;
        ignoradas.style.display = '';
      } else {
        ignoradas.style.display = 'none';
      }

    } catch (e) {
      erro('Falha de conexão', e.message);
    }
  }

  function mostrarProblemas(d) {
    const p = d.problemas || {};
    const detalhes = [];

    if (p.semDocumento?.length) {
      detalhes.push(`Sem CNPJ/CPF nas linhas: ${p.semDocumento.join(', ')}`);
    }
    if (p.documentoInvalido?.length) {
      p.documentoInvalido.slice(0, 15).forEach((x) =>
        detalhes.push(`Linha ${x.linha}: documento inválido (${x.documento})`));
      if (p.documentoInvalido.length > 15) {
        detalhes.push(`…e mais ${p.documentoInvalido.length - 15} linha(s).`);
      }
    }
    if (p.semNome?.length) {
      detalhes.push(`Sem nome do cliente nas linhas: ${p.semNome.join(', ')}`);
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
        body: JSON.stringify({ linhas, confirmar: true })
      });
      const d = await r.json();

      if (!r.ok) return mostrarProblemas(d);

      mostrar('imp-sucesso');
      el('imp-sucesso-msg').innerHTML =
        `<strong>${d.novos}</strong> lead(s) criados e <strong>${d.atualizados}</strong> atualizados.` +
        (d.advisorsCriados?.length
          ? `<br>Advisors cadastrados automaticamente: ${d.advisorsCriados.join(', ')}.`
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

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && el('importar-modal')?.classList.contains('aberto')) fechar();
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);

  return { abrir, fechar };
})();
