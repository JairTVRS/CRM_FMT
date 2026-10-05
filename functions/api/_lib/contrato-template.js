/**
 * _lib/contrato-template.js — o contrato de prestação de serviços (Lote G, 2.40.0).
 *
 * O modelo é o contrato em uso (docs/Contrato Completo com Pagamentos e
 * Descrições.pdf), com o que mudou em 2026 (contrato da Trinta Dezessete,
 * 14/04/2026):
 *   - km negociado por lead (era R$ 1,60 fixo; a proposta usa R$ 1,75);
 *   - rescisão com 30 dias de aviso, sem multa, pagando o já executado e
 *     o proporcional do mês (eram 60 dias);
 *   - Cláusula VI: "a ser pago À CONTRATADA" (o modelo dizia "à
 *     CONTRATANTE", troca evidente das partes).
 *
 * O que varia vem pronto de `prepararContrato` (_lib/contrato.js): as
 * partes, o escopo da proposta, a cláusula de preço da forma escolhida,
 * o km e a vigência. O resto é o texto padrão, transcrito — alterá-lo é
 * decisão do jurídico, não técnica.
 */

import { documento, esc, documentoBr, moeda, FORMATAR, MARCA, nomeDeDocumento, TIPO_DOCUMENTO } from './documento-base.js';
import { moedaPorExtenso, numeroPorExtenso, dataPorExtenso } from './extenso.js';
import { SERVICOS } from './proposta-template.js';

const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Parágrafos próprios do contrato para o diagnóstico (transcritos do modelo). */
const DIAGNOSTICO_CONTRATO = [
  'Caso não existam dados que nos permitam construir um histórico conclusivo, trabalharemos a partir de projeções com os dados que forem possíveis de serem levantados. Posteriormente será emitido o relatório de diagnóstico e apresentado a todos os interessados da empresa, indicando as prioridades e as áreas em que atuaremos inicialmente.',
  'Após o diagnóstico poderá surgir a necessidade de outros trabalhos não contemplados neste instrumento. Caso isto ocorra, esses trabalhos serão negociados com a CONTRATANTE.'
];

const cepBr = (c) => {
  const d = String(c || '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (c || '');
};

/** "brasileiro, casado(a), empresário, residente em Divinópolis/MG, CPF 000.000.000-00" */
function qualificacao(r, { semCpf = false, papel = 'profissao' } = {}) {
  return [
    r.nacionalidade,
    r.estado_civil,
    r[papel] || r.profissao || r.cargo,
    r.residencia ? `residente em ${r.residencia}` : null,
    !semCpf && r.cpf ? `CPF ${documentoBr(r.cpf)}` : null
  ].filter(Boolean).map(esc).join(', ');
}

function sede(x) {
  return `sociedade com sede em ${esc(x.cidade || '')}, à ${esc(x.endereco || '')}${x.cep ? `, CEP ${cepBr(x.cep)}` : ''}`;
}

function preambulo(d) {
  const c = d.contratante;
  const r = c.representante;
  const contratante = c.pessoaFisica
    ? `<strong>${esc(c.nome)}</strong>${qualificacao(r, { semCpf: true }) ? `, ${qualificacao(r, { semCpf: true })}` : ''}, inscrito(a) no CPF sob o nº ${documentoBr(c.documento)}, residente e domiciliado(a) à ${esc(c.endereco)}, ${esc(c.cidade)}${c.cep ? `, CEP ${cepBr(c.cep)}` : ''}, denominado(a) <strong>CONTRATANTE</strong>`
    : `<strong>${esc(c.nome)}</strong>, ${sede(c)}, inscrita no CNPJ sob o nº ${documentoBr(c.documento)}, neste ato representada por <strong>${esc(r.nome)}</strong>${qualificacao(r) ? `, ${qualificacao(r)}` : ''}, denominada <strong>CONTRATANTE</strong>`;

  const k = d.contratada;
  const reps = k.representantes
    .map((x) => `<strong>${esc(x.nome)}</strong>${qualificacao(x, { papel: 'cargo' }) ? `, ${qualificacao(x, { papel: 'cargo' })}` : ''}`)
    .join(' e/ou ');
  const contratada = `<strong>${esc(k.razao_social)}</strong>, ${sede(k)}, inscrita no CNPJ sob o nº ${documentoBr(k.cnpj)}, neste ato representada por ${reps}, denominada <strong>CONTRATADA</strong>`;

  return `<p>Pelo presente instrumento, de um lado, ${contratante}, e de outro ${contratada}, têm entre si justo e contratado a prestação de serviços de consultoria pela CONTRATADA, mediante as seguintes cláusulas:</p>`;
}

function clausulaEscopo(d) {
  const partes = d.escopo.map((chave, i) => {
    const s = SERVICOS[chave];
    const extras = chave === 'diagnostico' ? DIAGNOSTICO_CONTRATO.map((t) => `<p>${esc(t)}</p>`).join('') : '';
    return `
      <h3>PARTE ${ROMANOS[i]} – ${esc(s.titulo.toUpperCase())}</h3>
      <p><strong>1.${i + 2}.</strong> ${esc(s.resumo)}${s.sigla ? ` Programa ${esc(s.sigla)}.` : ''}</p>
      <ul>${s.eixos.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      ${extras}`;
  }).join('');

  const quando = d.proposta.elaboradoEm || String(d.proposta.gerado_em || '').slice(0, 10);
  return `
    <h2>Cláusula I – Dos trabalhos a serem executados</h2>
    <p><strong>1.1.</strong> A CONTRATADA, por força das disposições do presente instrumento, prestará à CONTRATANTE, em caráter não exclusivo, serviço de consultoria empresarial, conforme a proposta aceita pela CONTRATANTE (versão ${esc(d.proposta.versao)}${quando ? `, de ${dataPorExtenso(quando)}` : ''}), que faz parte integrante do presente termo, nos assuntos abaixo indicados:</p>
    ${partes}`;
}

function clausulaPreco(d) {
  return `
    <h2>Cláusula II – Do preço e das condições de pagamento</h2>
    <p><strong>2.1.</strong> Para a realização do trabalho proposto neste instrumento, a CONTRATADA receberá da CONTRATANTE a contraprestação dos valores abaixo indicados:</p>
    <div class="preco">${d.preco.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    <p><strong>2.2.</strong> Despesas de viagem (caso venham a ocorrer): ${moeda(d.km)} (${moedaPorExtenso(d.km)}) por quilômetro rodado, pagos diretamente ao consultor a cada visita à CONTRATANTE. Em caso de aumento do custo do combustível autorizado pelo Governo Federal, o valor deverá ser aumentado na mesma proporção.</p>`;
}

function clausulaPrazo(d) {
  const m = d.vigenciaMeses;
  return `
    <h2>Cláusula III – Do prazo</h2>
    <p><strong>3.1.</strong> ${m
      ? `O presente instrumento terá início a partir desta data e vigorará pelo prazo de ${m} (${numeroPorExtenso(m)}) meses, podendo ser renovado mediante negociação entre as partes.`
      : 'O presente instrumento terá início a partir desta data e vigorará até a conclusão dos trabalhos descritos na Cláusula I, podendo ser renovado mediante negociação entre as partes.'}</p>`;
}

/** As cláusulas IV a XII: texto padrão. */
function clausulasPadrao(d) {
  const foro = String(d.contratada.cidade || 'Divinópolis/MG');
  return `
    <h2>Cláusula IV – Das horas de trabalho e da forma de prestação do serviço</h2>
    <p><strong>4.1.</strong> Em caso de necessidade de reagendamento de data e/ou horário por parte da CONTRATANTE, este deverá ocorrer com antecedência mínima de 48 (quarenta e oito) horas (tempo hábil para remanejamento da agenda dos consultores). Em caso de este prazo não poder ser respeitado e não for possível o reagendamento, as horas serão computadas normalmente.</p>

    <h2>Cláusula V – Das particularidades</h2>
    <p><strong>5.1.</strong> O presente instrumento possui as particularidades abaixo, que devem ser observadas pela CONTRATANTE:</p>
    <ol type="a">
      <li>Não estão incluídas no presente contrato as subcontratações de serviços que porventura venham a ser necessárias, tais como pesquisas e empresas de comunicação, dentre outras;</li>
      <li>Não estão incluídos no presente contrato os cursos e palestras. Tais serviços, caso necessários, deverão ser consultados à parte;</li>
      <li>Considera-se hora trabalhada todo e qualquer tempo dos consultores da CONTRATADA dispensado em favor da CONTRATANTE;</li>
      <li>A partir da assinatura deste termo, a CONTRATANTE será incluída na relação de clientes da CONTRATADA para fins de referência e divulgação em seu site, no item "portfólio de clientes", gratuitamente e sem que exista nenhuma forma de indenização ou qualquer outra a título de imagem/publicidade, pelo que a CONTRATANTE aprova tal divulgação de forma gratuita e sem objeção.</li>
    </ol>

    <h2>Cláusula VI – Do reajuste</h2>
    <p><strong>6.1.</strong> O valor dos serviços a ser pago à CONTRATADA será reajustado anualmente, no decorrer do contrato, segundo o IPCA, havendo para isso prévia comunicação e negociação com a CONTRATANTE.</p>

    <h2>Cláusula VII – Da rescisão contratual</h2>
    <p><strong>7.1.</strong> O presente instrumento não contempla multa de rescisão contratual, podendo qualquer das partes rescindi-lo a qualquer momento mediante simples comunicado, por escrito, com 30 (trinta) dias de antecedência.</p>
    <p><strong>7.2.</strong> Na rescisão, a CONTRATANTE pagará os serviços já executados e o valor proporcional do mês em curso.</p>

    <h2>Cláusula VIII – Dos encargos sociais da CONTRATADA</h2>
    <p><strong>8.1.</strong> Fica a cargo da CONTRATADA o pagamento da mão de obra e dos encargos sociais vigentes ou que venham a ser criados com relação a seus funcionários, consultores e/ou prepostos, não respondendo a CONTRATANTE perante o fisco e os órgãos arrecadadores dos encargos sociais, nem assumindo qualquer responsabilidade por multas, salários ou contribuições sociais.</p>

    <h2>Cláusula IX – Da boa-fé contratual</h2>
    <p><strong>9.1.</strong> Esta parceria comercial se norteia pelos princípios da boa-fé e da probidade das partes e tem o intuito de garantir que ambas tenham condições de pactuar comercialmente, zelando uma pela outra na execução e conclusão do presente contrato, devendo ambas as partes cumprir fielmente o que estão pactuando, sob pena das penalidades previstas no Código Civil Brasileiro.</p>
    <p><strong>Parágrafo único.</strong> A natureza dos serviços prestados pela CONTRATADA envolverá, dentre outras questões técnicas, a análise de custos e lucratividade da CONTRATANTE. A CONTRATADA não tem nenhum objetivo de induzir ou incentivar a CONTRATANTE a alterar qualquer tipo de contratação de outros prestadores de serviços porventura contratados, mas apenas o de cumprir fielmente o objeto deste instrumento.</p>

    <h2>Cláusula X – Da propriedade, sigilo, confidencialidade e compromisso</h2>
    <p><strong>10.1.</strong> Todos os direitos de propriedade intelectual referentes à prestação de serviço de consultoria e/ou quaisquer outros prestados pela CONTRATADA e objeto do presente termo são e permanecerão de propriedade exclusiva da mesma.</p>
    <p><strong>10.2.</strong> As partes guardarão sigilo sobre todos os dados, materiais e outras informações referentes à operação, negócios, projeções, metas de mercado, atividades financeiras, produtos, clientes e direitos de propriedade intelectual da outra parte a que venham a ter acesso ou que lhes sejam confiados em razão deste contrato, e se comprometem a não divulgar, revelar, reproduzir, utilizar, distribuir ou dar conhecimento a terceiros de informações oriundas deste contrato, durante sua vigência e por 02 (dois) anos após seu término, sob as penas da legislação civil e penal.</p>
    <p><strong>10.3.</strong> A CONTRATADA poderá divulgar o nome e a marca da CONTRATANTE em campanhas publicitárias e no seu material de divulgação, sem qualquer tipo de remuneração.</p>
    <p><strong>10.4.</strong> A CONTRATANTE não poderá copiar, reproduzir, traduzir, adaptar, modificar, alienar, vender, locar, sublocar, ceder, transferir, decompilar ou fazer engenharia reversa, no todo ou em parte, ou ainda usar para qualquer propósito diverso do que lhe foi especificamente autorizado, o material da CONTRATADA, tampouco permitir que qualquer terceiro o faça.</p>
    <p><strong>10.5.</strong> A CONTRATANTE se compromete a não contratar funcionários ou prestadores de serviços da CONTRATADA durante a vigência do presente termo e por um período de 12 (doze) meses após o seu término. Caso a CONTRATANTE desrespeite a presente cláusula, pagará multa no valor de R$ 50.000,00 (cinquenta mil reais) em favor da CONTRATADA.</p>

    <h2>Cláusula XI – Dos casos omissos</h2>
    <p><strong>11.1.</strong> Os casos omissos neste instrumento serão resolvidos com observância dos preceitos do Código Civil (Lei nº 10.406/2002) e de outros dispositivos legais aplicáveis.</p>

    <h2>Cláusula XII – Do foro</h2>
    <p><strong>12.1.</strong> As partes elegem o foro da comarca de ${esc(foro)} como o competente para dirimir quaisquer dúvidas ou demandas oriundas do presente instrumento, com renúncia expressa de qualquer outro, por mais privilegiado que seja.</p>`;
}

function fechamento(d) {
  const k = d.contratada;
  const c = d.contratante;
  return `
    <p>E por estarem justos e contratados, cientes das obrigações contraídas neste contrato e das consequências de sua inobservância, as partes assinam o presente instrumento, na presença das testemunhas abaixo.</p>
    <p class="local-data">${esc(k.cidade || 'Divinópolis/MG')}, ${dataPorExtenso(d.data)}.</p>

    <div class="assinaturas">
      <div class="assinatura">
        <div class="linha"></div>
        <div class="nome">${esc(k.razao_social)}</div>
        <div class="cargo">CONTRATADA · ${k.representantes.map((r) => esc(r.nome)).join(' e/ou ')}</div>
      </div>
      <div class="assinatura">
        <div class="linha"></div>
        <div class="nome">${esc(c.nome)}</div>
        <div class="cargo">CONTRATANTE${c.pessoaFisica ? '' : ` · ${esc(c.representante.nome)}`}</div>
      </div>
    </div>

    <p class="testemunhas-titulo">Testemunhas</p>
    <div class="assinaturas testemunhas">
      <div class="assinatura"><div class="linha"></div><div class="cargo">Nome:<br>CPF:</div></div>
      <div class="assinatura"><div class="linha"></div><div class="cargo">Nome:<br>CPF:</div></div>
    </div>

    <p class="rodape-contrato">
      ${FORMATAR.endereco}<br>
      ${FORMATAR.telefone} &middot; ${FORMATAR.site} &middot; ${FORMATAR.email}
    </p>`;
}

/**
 * Texto corrido: o contrato quebra página sozinho na impressão. As folhas
 * de altura fixa da proposta cortariam a cláusula no meio da página.
 */
const ESTILO = `
.folha.contrato{min-height:auto;padding:16mm 20mm 18mm}
.contrato .titulo-contrato{font-size:12.5pt;text-align:center;text-transform:uppercase;letter-spacing:.02em;margin:2mm 0 6mm;text-decoration:underline}
.contrato h2{font-size:10.5pt;margin:5mm 0 2mm;break-after:avoid;page-break-after:avoid}
.contrato h3{font-size:9.5pt;margin:3.5mm 0 1mm;break-after:avoid;page-break-after:avoid}
.contrato p{font-size:10pt;line-height:1.5}
.contrato li{font-size:9.5pt}
.contrato ol{margin-left:8mm}
.contrato ol li{padding-left:1mm;margin-bottom:1.2mm}
.contrato .preco{margin-left:6mm}
.contrato .local-data{margin-top:6mm}
.contrato .assinaturas{break-inside:avoid;page-break-inside:avoid}
.contrato .testemunhas-titulo{margin-top:8mm;font-weight:600}
.contrato .testemunhas{margin-top:8mm}
.contrato .testemunhas .cargo{text-align:left;line-height:1.7}
.contrato .rodape-contrato{text-align:center;font-size:7.5pt;color:${MARCA.cinza};margin-top:12mm}
@media print{
  @page{size:A4;margin:14mm 0 16mm}
  .folha.contrato{padding:0 20mm}
}`;

export function renderizarContrato(dados, versao) {
  const d = dados;
  const titulo = nomeDeDocumento(TIPO_DOCUMENTO.CONTRATO, d.contratante.nome, d.gerado?.em || d.data);
  const folha = `
<section class="folha contrato">
  <div class="folha-topo">
    <div>
      <div class="marca">${FORMATAR.marca}</div>
      <div class="marca-assinatura">${FORMATAR.assinatura}</div>
    </div>
    <div class="folha-titulo">Contrato${versao ? ` · versão ${esc(versao)}` : ''}</div>
  </div>
  <h1 class="titulo-contrato">Contrato de prestação de serviços de consultoria empresarial</h1>
  ${preambulo(d)}
  ${clausulaEscopo(d)}
  ${clausulaPreco(d)}
  ${clausulaPrazo(d)}
  ${clausulasPadrao(d)}
  ${fechamento(d)}
</section>`;

  return documento({ titulo, folhas: [folha], estilo: ESTILO });
}
