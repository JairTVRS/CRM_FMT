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
  documento, folha, esc, dataBr, documentoBr, FORMATAR, MARCA
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

function folhaConta(d, n, total) {
  const c = d.conta || {};
  const a = d.analise || {};

  const nucleos = (c.nucleos || []).map((x) => x.nome).filter(Boolean);
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
        ${c.dataInicio ? `<tr><td class="rotulo">Início da jornada</td><td class="valor">${dataBr(c.dataInicio)}${tempo ? ` (${esc(tempo)})` : ''}</td></tr>` : ''}
        ${linha('Classificação', c.classificacao)}
        ${linha('Contato principal', c.contatoNome)}
        ${linha('Telefone', c.telefone)}
        ${linha('E-mail', c.email)}
      </table>

      ${nucleos.length ? `
        <h2>Núcleos atendidos</h2>
        <ul>${nucleos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <p style="font-size:8.5pt;color:${MARCA.cinza}">
          Núcleo é o tipo de reunião. Cliente mais núcleo é o que forma a
          <strong>carteira</strong>, que chega com as reuniões do hub.
        </p>` : `
        <h2>Núcleos atendidos</h2>
        <div class="bloco">
          <p style="margin:0">Nenhum núcleo marcado na ficha deste cliente.</p>
        </div>`}

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

function folhaMapa(d, n, total) {
  const pessoas = d.stakeholders || [];
  const m = d.mapa || {};
  const a = d.analise?.mapaPoder || {};

  const tabela = pessoas.length ? `
    <table>
      <tr>
        <th>Pessoa</th><th>Papel</th><th>Influência</th><th>Postura</th><th>Núcleos</th>
      </tr>
      ${pessoas.map((p) => `
        <tr>
          <td>
            <strong>${esc(p.nome)}</strong>${p.patrocinador ? ' &middot; patrocinador' : ''}
            ${p.cargo ? `<br><span style="color:${MARCA.cinza};font-size:8.5pt">${esc(p.cargo)}</span>` : ''}
          </td>
          <td>${esc(p.papel || '—')}</td>
          <td>${esc(ROTULO_INFLUENCIA[p.influencia] || '—')}</td>
          <td>${esc(ROTULO_POSTURA[p.postura] || '—')}</td>
          <td>${esc((p.nucleos || []).join(', ') || '—')}</td>
        </tr>`).join('')}
    </table>` : `
    <div class="bloco">
      <p style="margin:0">
        <strong>Nenhuma pessoa mapeada.</strong> Sem o mapa, a conta depende da
        memória de quem a atende — e a leitura abaixo se apoia só no cadastro.
      </p>
    </div>`;

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

    ${m.nucleosSemPessoa?.length ? `
      <div class="faixa-laranja">
        <strong>Núcleo atendido sem ninguém mapeado:</strong>
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
    titulo: `Dossiê de Experiência — ${d.conta?.nomeFantasia || d.conta?.razaoSocial || 'Cliente'}`,
    folhas
  });
}
