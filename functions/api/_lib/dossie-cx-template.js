/**
 * _lib/dossie-cx-template.js — O Dossiê de Experiência.
 *
 * Documento de pós-venda: onde a conta está, quem são as pessoas dela e
 * o que a CX deveria fazer a seguir. O oposto do Dossiê Executivo, que é
 * de pré-venda e fala de quem ainda não comprou.
 *
 * Monta sobre o `documento-base.js`, a casca compartilhada com a proposta
 * — e não sobre o `dossie-template.js`, que é anterior a ela e tem estilo
 * próprio. Documento novo entra pela porta nova.
 *
 * Uma regra de layout percorre o arquivo inteiro: **seção sem conteúdo
 * não é impressa**. Um dossiê de conta nova tem pouco a dizer, e títulos
 * seguidos de "—" dariam a impressão de documento com defeito em vez de
 * conta jovem.
 */

import {
  documento, folha, esc, dataBr, documentoBr, FORMATAR, MARCA,
  nomeDeDocumento, TIPO_DOCUMENTO
} from './documento-base.js';

import { ROTULO_INFLUENCIA, ROTULO_POSTURA } from './schema-dossie-cx.js';

/* ==========================================================================
   PEÇAS MENORES
   ========================================================================== */

const linha = (rotulo, valor) => (valor || valor === 0
  ? `<tr><td class="rotulo">${esc(rotulo)}</td><td class="valor">${esc(valor)}</td></tr>`
  : '');

/** "3 meses", "1 ano e 2 meses" — a idade da relação em linguagem de gente. */
function tempoDeJornada(meses) {
  if (meses == null) return null;
  if (meses === 0) return 'menos de um mês';
  if (meses < 12) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;

  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const parteAnos = `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  return resto === 0 ? parteAnos : `${parteAnos} e ${resto} ${resto === 1 ? 'mês' : 'meses'}`;
}

/**
 * Selo de confiança das hipóteses. Mesma ideia do Executivo: o leitor
 * precisa distinguir o que é apoiado do que é palpite, e a distinção
 * tem que sobreviver à impressão em preto e branco — por isso o texto
 * "confiança baixa" aparece por extenso, e não só uma cor.
 */
const selo = (confianca) => `
  <span style="font-size:7.5pt;letter-spacing:.06em;text-transform:uppercase;
               color:${MARCA.cinza};font-weight:600">
    confiança ${esc(confianca)}
  </span>`;

/* ==========================================================================
   CAPA
   ========================================================================== */

function capa(d) {
  const c = d.conta || {};
  const g = d.gerado || {};

  return `
<section class="folha capa">
  <div>
    <div class="marca">${FORMATAR.marca}</div>
    <div class="marca-assinatura">${FORMATAR.assinatura}</div>
  </div>

  <div>
    <div class="kicker">Dossiê de Experiência</div>
    <h1 style="color:#fff;font-size:30pt">${esc(c.nomeFantasia || c.razaoSocial || 'Cliente')}</h1>
    <p style="color:${MARCA.cinza};text-align:left;font-size:10pt">
      ${esc(c.cidade || '')}${c.documento ? ` &middot; ${documentoBr(c.documento)}` : ''}
      ${c.etapa ? `<br>Jornada: ${esc(c.etapa)}` : ''}
    </p>
  </div>

  <div style="border-top:2px solid ${MARCA.laranja};padding-top:5mm">
    <p style="color:${MARCA.cinza};text-align:left;font-size:8.5pt;margin:0">
      Gerado em ${dataBr(String(g.em || '').slice(0, 10))}${g.por ? ` por ${esc(g.por)}` : ''}${g.versao ? ` &middot; versão ${g.versao}` : ''}
    </p>
    <p style="color:${MARCA.cinza};text-align:left;font-size:8.5pt;margin:2mm 0 0">
      <strong style="color:#fff">Documento interno.</strong>
      Contém a leitura da Formatar sobre pessoas nomeadas do cliente e
      não se destina a ser compartilhado com ele.
    </p>
  </div>
</section>`;
}

/* ==========================================================================
   FOLHA 1 — A conta hoje
   ========================================================================== */

/**
 * Os núcleos atendidos, em três estados — e não em dois.
 *
 * "Não há núcleo" e "não consegui perguntar" produziam a mesma frase
 * antes deste lote, e foi assim que um documento real mandou a CX ir
 * marcar núcleos que já estavam no ERP. A folha agora diz qual dos dois
 * aconteceu, sempre.
 */
function blocoNucleos(c, fontes) {
  const f = fontes.nucleos || {};
  const lista = c.nucleos || [];

  if (!f.consultado) {
    return `
      <div class="bloco">
        <p style="margin:0 0 6px">
          <strong>Não foi possível ler os núcleos no ERP.</strong>
          ${esc(f.motivo || '')}
        </p>
        <p style="margin:0">
          Isto <strong>não</strong> significa que a conta não tenha núcleo atendido.
          Significa que a verificação não pôde ser feita agora, e que nada neste
          documento afirma coisa alguma sobre as frentes de trabalho desta conta.
        </p>
        ${lista.length ? `
          <p style="margin:6px 0 0;font-size:8.5pt;color:${MARCA.cinza}">
            Há uma marcação manual antiga na ficha do CRM
            (${esc(lista.map((x) => x.nome).filter(Boolean).join(', '))}),
            não conferida contra o ERP.
          </p>` : ''}
      </div>`;
  }

  if (!lista.length) {
    return `
      <div class="bloco">
        <p style="margin:0">
          O ERP foi consultado e <strong>não há nenhuma reunião registrada</strong>
          para este cliente. É uma lacuna do registro de reuniões — não uma
          conclusão sobre o que a Formatar entrega a esta conta.
        </p>
      </div>`;
  }

  return `
    <table>
      <tr><th>Núcleo (Time)</th><th>Tipos de reunião</th><th>Reuniões</th></tr>
      ${lista.map((x) => {
        const hist = x.reunioesRealizadas
          ? `${x.reunioesRealizadas} realizada${x.reunioesRealizadas > 1 ? 's' : ''}`
            + (x.ultimaReuniao ? `<br><span style="color:${MARCA.cinza};font-size:8.5pt">última em ${dataBr(String(x.ultimaReuniao).slice(0, 10))}</span>` : '')
          : '<span class="ausente">nenhuma realizada ainda</span>';

        const prev = x.reunioesPrevistas
          ? `<br><span style="color:${MARCA.cinza};font-size:8.5pt">${x.reunioesPrevistas} agendada${x.reunioesPrevistas > 1 ? 's' : ''}</span>`
          : '';

        return `
          <tr>
            <td><strong>${esc(x.nome || '—')}</strong></td>
            <td>${esc((x.tiposDeReuniao || []).join(', ') || '—')}</td>
            <td>${hist}${prev}</td>
          </tr>`;
      }).join('')}
    </table>
    <p style="font-size:8.5pt;color:${MARCA.cinza}">
      Núcleo, nesta folha, é o <strong>Time</strong> da Formatar, lido ao vivo do
      ERP pelas reuniões da conta. O tipo de reunião aparece ao lado porque é
      por ele que o <strong>Plano de Ação</strong> organiza a fila — cliente mais
      tipo de reunião é o que forma a <strong>carteira</strong>.
    </p>`;
}

function folhaConta(d, n, total) {
  const c = d.conta || {};
  const a = d.analise || {};

  const tempo = tempoDeJornada(c.mesesDeJornada);

  return folha({
    titulo: 'A conta hoje',
    numero: n, total,
    conteudo: `
      <div class="kicker">Onde estamos</div>
      <h1>${esc(c.razaoSocial || 'Cliente')}</h1>

      <table>
        ${linha('Razão social', c.razaoSocial)}
        ${linha('Nome fantasia', c.nomeFantasia)}
        ${c.documento ? `<tr><td class="rotulo">CNPJ</td><td class="valor">${documentoBr(c.documento)}</td></tr>` : ''}
        ${linha('Cidade', c.cidade)}
        ${linha('Etapa da jornada', c.etapa)}
        ${c.etapa ? `<tr><td class="rotulo">Nesta etapa desde</td><td class="valor">${
          c.etapaDesde
            ? `${dataBr(c.etapaDesde)}${c.mesesNaEtapa != null ? ` (${c.mesesNaEtapa} meses)` : ''}`
            : '<span class="ausente">não registrado — o CRM só passou a guardar esta data depois</span>'
        }</td></tr>` : ''}
        ${c.dataInicio ? `<tr><td class="rotulo">Início da jornada</td><td class="valor">${dataBr(c.dataInicio)}${tempo ? ` (${esc(tempo)})` : ''}</td></tr>` : ''}
        <tr>
          <td class="rotulo">Classificação</td>
          <td class="valor">${c.classificacao != null
            ? esc(c.classificacao)
            : ((d.fontes || {}).conta || {}).consultado
              ? '<span class="ausente">o ERP não tem classificação nesta conta</span>'
              : '<span class="ausente">não verificado — o ERP não foi consultado</span>'}</td>
        </tr>
        ${c.contatoNome ? `<tr>
          <td class="rotulo">Contato principal</td>
          <td class="valor">${esc(c.contatoNome)}${c.contatoOrigem === 'crm'
            ? ` <span style="color:${MARCA.cinza};font-size:8.5pt">(anotado no CRM)</span>` : ''}</td>
        </tr>` : ''}
        ${linha('Telefone', c.telefone)}
        ${linha('E-mail', c.email)}
      </table>

      <p style="font-size:8.5pt;color:${MARCA.cinza}">
        ${((d.fontes || {}).conta || {}).consultado
          ? 'Identidade, contato e classificação lidos do ERP no momento desta geração. Etapa da jornada e observações são do CRM.'
          : 'O ERP não respondeu nesta geração: os dados acima são a cópia guardada no CRM e podem estar desatualizados.'}
      </p>

      <h2>Núcleos atendidos</h2>
      ${blocoNucleos(c, d.fontes || {})}

      ${c.erpId ? '' : `
        <div class="bloco">
          <p style="margin:0">
            <strong>Sem vínculo com o ERP.</strong> Este cadastro foi feito à mão e
            ainda não foi conferido contra o ERP — o que é diferente de dizer que o
            cliente não existe lá.
          </p>
        </div>`}

      ${a.panorama ? `<h2>Panorama</h2>${a.panorama}` : ''}

      ${c.observacoes ? `
        <h2>Observações da ficha</h2>
        <div class="bloco"><p style="margin:0">${esc(c.observacoes)}</p></div>` : ''}`
  });
}

/* ==========================================================================
   FOLHA 2 — Mapa de stakeholders
   ========================================================================== */

/**
 * A folha sem tabela de pessoas — em três estados.
 *
 * Esta é a frase que custou caro em 15/09/2026. O documento dizia
 * "Nenhuma pessoa mapeada" e a Recomendação mandava a CX levantar em
 * campo os interlocutores da conta. As pessoas estavam no ERP; o dossiê
 * é que lia a ficha do CRM e nunca tinha perguntado.
 *
 * Agora só existe uma situação em que se afirma que não há ninguém: o
 * ERP respondeu, e respondeu vazio.
 */
function blocoSemPessoas(fp) {
  if (!fp.consultado) {
    return `
      <div class="bloco">
        <p style="margin:0 0 6px">
          <strong>Não foi possível ler as pessoas desta conta no ERP.</strong>
          ${esc(fp.motivo || '')}
        </p>
        <p style="margin:0">
          As pessoas de um cliente são cadastradas no ERP, e a consulta não
          voltou agora. <strong>Não conclua que a conta está sem interlocutor</strong>
          — nada foi verificado, e este documento não afirma nada a respeito.
        </p>
      </div>`;
  }

  if (fp.formato === 'referencias') {
    return `
      <div class="bloco">
        <p style="margin:0 0 6px">
          <strong>O ERP registra ${fp.totalNoErp} pessoa(s) nesta conta</strong>, e
          devolveu apenas referências internas em vez dos dados.
        </p>
        <p style="margin:0">
          Ou seja: a conta <strong>tem</strong> interlocutores cadastrados. É este
          documento que ainda não consegue nomeá-los — limitação da leitura, não
          da relação.
        </p>
      </div>`;
  }

  return `
    <div class="bloco">
      <p style="margin:0">
        <strong>O ERP foi consultado e não há nenhuma pessoa cadastrada nesta
        conta.</strong> É uma lacuna real do cadastro, e vale resolver — mas é
        lacuna do registro, não prova de que a Formatar não tenha interlocutor
        no cliente.
      </p>
    </div>`;
}

function folhaMapa(d, n, total) {
  const pessoas = d.stakeholders || [];
  const m = d.mapa || {};
  const a = d.analise?.mapaPoder || {};

  const fp = (d.fontes || {}).pessoas || {};

  const tabela = pessoas.length ? `
    <table>
      <tr>
        <th>Pessoa</th><th>Cargo</th><th>Influência</th><th>Postura</th><th>Núcleos</th>
      </tr>
      ${pessoas.map((p) => `
        <tr>
          <td>
            <strong>${esc(p.nome)}</strong>${p.patrocinador ? ' &middot; patrocinador' : ''}
            ${p.principal === true ? `<br><span style="color:${MARCA.cinza};font-size:8.5pt">contato principal</span>` : ''}
            ${p.origem === 'crm' ? `<br><span class="ausente" style="font-size:8.5pt">só no CRM — não está no ERP</span>` : ''}
          </td>
          <td>${esc(p.cargo || p.papel || '—')}</td>
          <td>${p.avaliada === false
            ? '<span class="ausente">não avaliada</span>'
            : esc(ROTULO_INFLUENCIA[p.influencia] || '—')}</td>
          <td>${p.avaliada === false
            ? '<span class="ausente">não avaliada</span>'
            : esc(ROTULO_POSTURA[p.postura] || '—')}</td>
          <td>${esc((p.nucleos || []).join(', ') || '—')}</td>
        </tr>`).join('')}
    </table>
    <p style="font-size:8.5pt;color:${MARCA.cinza}">
      As pessoas e os cargos vêm do cadastro do ERP. Influência e postura são a
      leitura registrada pela equipe da Formatar — onde estiver
      <strong>não avaliada</strong>, é trabalho de CX que ainda não foi feito,
      não característica da pessoa.
    </p>` : blocoSemPessoas(fp);

  // Os números vêm da aritmética, não do modelo: contagem errada num
  // bloco factual desmoraliza o documento inteiro.
  const numeros = pessoas.length ? `
    <h2>O mapa em números</h2>
    <table>
      <tr><td class="rotulo">Pessoas mapeadas</td><td class="valor">${m.total}</td></tr>
      <tr>
        <td class="rotulo">Patrocinador da conta</td>
        <td class="valor">${m.patrocinadores?.length ? esc(m.patrocinadores.join(', ')) : 'nenhum indicado'}</td>
      </tr>
      <tr>
        <td class="rotulo">Influência alta</td>
        <td class="valor">${m.porInfluencia?.alta || 0}</td>
      </tr>
      <tr>
        <td class="rotulo">Promotores &middot; neutros &middot; resistentes</td>
        <td class="valor">${m.porPostura?.promotor || 0} &middot; ${m.porPostura?.neutro || 0} &middot; ${m.porPostura?.resistente || 0}</td>
      </tr>
      ${m.naoAvaliadas ? `
        <tr>
          <td class="rotulo">Ainda não avaliadas</td>
          <td class="valor">${m.naoAvaliadas}</td>
        </tr>` : ''}
    </table>

    ${m.nucleosSemPessoa === null ? `
      <p style="font-size:8.5pt;color:${MARCA.cinza}">
        Não foi possível cruzar núcleo com pessoa: o ERP não registra quem do
        cliente participou das reuniões desta conta. O documento por isso
        <strong>não afirma</strong> que algum núcleo esteja sem interlocutor —
        nem que todos tenham.
      </p>` : m.nucleosSemPessoa?.length ? `
      <div class="faixa-laranja">
        <strong>Núcleo atendido sem ninguém presente nas reuniões:</strong>
        ${esc(m.nucleosSemPessoa.join(', '))}.
      </div>` : ''}` : '';

  return folha({
    titulo: 'Mapa de stakeholders',
    numero: n, total,
    conteudo: `
      <div class="kicker">Quem decide, quem influencia</div>
      <h1>Mapa de stakeholders</h1>

      ${tabela}
      ${numeros}

      ${a.leitura ? `<h2>Leitura do mapa</h2>${a.leitura}` : ''}

      ${a.lacunas?.length ? `
        <h2>O que falta mapear</h2>
        <ul>${a.lacunas.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}

      <p style="font-size:8.5pt;color:${MARCA.cinza}">
        Influência e postura são a leitura registrada pela equipe da Formatar na
        ficha do cliente, não uma avaliação produzida por este documento.
      </p>`
  });
}

/* ==========================================================================
   FOLHA 3 — Riscos, oportunidades e perguntas
   ========================================================================== */

function folhaLeitura(d, n, total) {
  const a = d.analise || {};

  const riscos = a.riscos?.length ? `
    <h2>Riscos de relacionamento</h2>
    ${a.riscos.map((r) => `
      <div class="bloco">
        <h3 style="margin-top:0">${esc(r.risco)}</h3>
        ${r.fundamento ? `<p style="margin:0 0 1.5mm">${esc(r.fundamento)}</p>` : ''}
        ${selo(r.confianca)}
      </div>`).join('')}` : '';

  const oportunidades = a.oportunidades?.length ? `
    <h2>Oportunidades de expansão</h2>
    <p style="font-size:8.5pt;color:${MARCA.cinza}">
      Expansão é acréscimo de produto ou serviço à entrega atual. Não gera
      contrato novo nem devolve a conta ao funil comercial.
    </p>
    ${a.oportunidades.map((o) => `
      <h3>${esc(o.titulo)}${o.nucleo ? ` <span style="color:${MARCA.cinza};font-weight:400">— ${esc(o.nucleo)}</span>` : ''}</h3>
      ${o.descricao ? `<p>${esc(o.descricao)}</p>` : ''}`).join('')}` : '';

  const perguntas = a.perguntas?.length ? `
    <h2>Perguntas para o próximo contato</h2>
    <ul>${a.perguntas.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';

  const conteudo = riscos + oportunidades + perguntas;

  return folha({
    titulo: 'Leitura da relação',
    numero: n, total,
    conteudo: `
      <div class="kicker">Interpretação</div>
      <h1>Leitura da relação</h1>

      ${conteudo || `
        <div class="bloco">
          <p style="margin:0">
            A análise não produziu riscos, oportunidades ou perguntas a partir do
            material disponível. Conta recém-cadastrada costuma cair aqui: há pouco
            registro para ler.
          </p>
        </div>`}`
  });
}

/* ==========================================================================
   FOLHA 4 — Recomendação e limites
   ========================================================================== */

function folhaFechamento(d, n, total) {
  const a = d.analise || {};
  const g = d.gerado || {};
  const pendencias = d.pendencias || [];

  return folha({
    titulo: 'Recomendação',
    numero: n, total,
    conteudo: `
      <div class="kicker">O que fazer a seguir</div>
      <h1>Recomendação</h1>

      ${a.recomendacao || '<p>Sem recomendação produzida nesta versão.</p>'}

      ${pendencias.length ? `
        <h2>O que este dossiê ainda não vê</h2>
        <p style="font-size:9pt">
          As fontes abaixo ainda não chegam ao CRM. A ausência de alerta sobre
          elas não é sinal de que esteja tudo bem — é sinal de que ninguém olhou.
        </p>
        <table>
          ${pendencias.map((p) => `
            <tr>
              <td class="rotulo">${esc(p.tema)}</td>
              <td>${esc(p.texto)}</td>
            </tr>`).join('')}
        </table>` : ''}

      <div class="bloco-escuro">
        <div class="kicker">Como este documento foi produzido</div>
        <p style="margin:0;font-size:9pt">
          A parte factual — cadastro, jornada, núcleos e o mapa de pessoas — vem do
          CRM e não passa por modelo de IA. A leitura (panorama, mapa de poder,
          riscos, oportunidades, perguntas e recomendação) foi escrita
          por <strong>${esc(g.provider || 'modelo')}</strong> a partir desses
          fatos${g.em ? `, em ${dataBr(String(g.em).slice(0, 10))}` : ''}. É
          interpretação, e deve ser tratada como tal.
        </p>
      </div>

      <p style="text-align:center;font-size:8pt;color:${MARCA.cinza};margin-top:8mm">
        ${FORMATAR.endereco}<br>
        ${FORMATAR.telefone} &middot; ${FORMATAR.site} &middot; ${FORMATAR.email}
      </p>`
  });
}

/* ==========================================================================
   MONTAGEM
   ========================================================================== */

export function renderizarDossieCx(dados) {
  const d = dados || {};

  // A capa não entra na contagem, como na proposta.
  const internas = 4;
  const folhas = [
    capa(d),
    folhaConta(d, 1, internas),
    folhaMapa(d, 2, internas),
    folhaLeitura(d, 3, internas),
    folhaFechamento(d, 4, internas)
  ];

  return documento({
    // O título é o nome do arquivo, não uma frase: o "Imprimir / PDF" não
    // passa pelo nosso código e usa o título como nome sugerido.
    titulo: nomeDeDocumento(
      TIPO_DOCUMENTO.EXPERIENCIA,
      d.conta?.nomeFantasia || d.conta?.razaoSocial,
      d.gerado?.em
    ),
    folhas
  });
}
