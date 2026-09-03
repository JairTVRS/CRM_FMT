/**
 * _lib/proposta-template.js — A proposta comercial.
 *
 * Só a parte comercial, por decisão de escopo: capa, cliente, objeto,
 * escopo contratado, condições, particularidades e assinaturas. O
 * material institucional (sobre a Formatar, missão, clientes, núcleos)
 * segue como deck fixo anexado à parte.
 *
 * Os textos dos serviços e as particularidades foram transcritos da
 * proposta e do contrato em uso — não são redação nova. Alterá-los é
 * decisão comercial, não técnica.
 */

import {
  documento, folha, esc, dataBr, moeda, documentoBr, FORMATAR, MARCA
} from './documento-base.js';

/* ==========================================================================
   CATÁLOGO DE SERVIÇOS

   As sete Partes do contrato. A proposta monta apenas as contratadas —
   mandar as sete para quem comprou duas é ruído, e ruído em proposta
   comercial custa caro.
   ========================================================================== */

export const SERVICOS = {
  diagnostico: {
    titulo: 'Diagnóstico de Gestão',
    resumo: 'Levantamento da situação atual da empresa por análise de dados existentes e entrevistas com funcionários e proprietários, seguido do relatório de diagnóstico apresentado a todos os interessados, indicando prioridades e áreas de atuação inicial.',
    eixos: [
      'Finanças: organização da informação, perfil da equipe gestora, DRE, DFC e Balanço Gerencial, orçamento empresarial',
      'RH: organização da informação, políticas administrativas, perfil da equipe gestora, RH estratégico e clima',
      'Comercial e Marketing: canais de venda, produtos e clientes, pesquisa e participação de mercado',
      'Operações: processos de gestão de estoque, compras, logística e prestação de serviços',
      'Governança e Estratégia: relações societárias e familiares, regras e acordos, planejamento sucessório, conselho de administração',
      'Gestão: rotinas de acompanhamento, modelo de negócio, modelo de gestão e integração da gestão'
    ]
  },

  comercial: {
    titulo: 'Gestão Comercial',
    sigla: 'ABS — Advanced Business Strategies',
    resumo: 'Implantação e organização da área comercial, munindo o gestor de dados confiáveis para decisões rápidas e construção de estratégias.',
    eixos: [
      'Planejamento estratégico comercial: identidade, propósito, alinhamento da equipe e canais, modelo de gestão, estrutura, metas e planos de ação',
      'Formação da equipe: análise e enquadramento das pessoas no perfil de conhecimentos, habilidades e atitudes',
      'Organização da informação: segmentação, perfil, geração de dados, cadastro e inadimplência',
      'Gestão comercial: indicadores de performance, rotinas de gestão, incentivo e cobrança, gestão de canais e orçamentária'
    ]
  },

  pessoas: {
    titulo: 'Gestão de Pessoas',
    sigla: 'PSM — People Strategic Management',
    resumo: 'Implantação de políticas de gestão de pessoas e organização dos processos de RH, alinhando as pessoas à estratégia do negócio.',
    eixos: [
      'Formação da equipe gestora: análise e enquadramento do gestor no perfil desejado para a função',
      'Políticas administrativas: registros, ponto, contratos, fichas, ambiente físico, CBO, rescisões e convenções coletivas',
      'Alinhamento: programa de socialização, manuais, formulários, descrições de cargos e comunicação',
      'Estratégico: grupos de trabalho, avaliações de desempenho, treinamento e desenvolvimento, política de cargos e salarial'
    ]
  },

  operacoes: {
    titulo: 'Gestão de Operações',
    sigla: 'IMO — Integrated Management Operations',
    resumo: 'Melhoria das operações por otimização de recursos, processos confiáveis, gestão por indicadores e equipe capacitada.',
    eixos: [
      'Gestão sistemática de indicadores: levantamento dos dados operacionais e implantação dos indicadores de desempenho',
      'Logística: organização das logísticas de compra, estoque e entrega, com critérios técnicos, regras e processos',
      'Produção: análise do fluxo produtivo, dimensionamento de capacidade e Planejamento e Controle de Produção (PCP)',
      'Formação da equipe: análise e enquadramento das pessoas no perfil de conhecimentos, habilidades e atitudes'
    ]
  },

  financeira: {
    titulo: 'Gestão Financeira',
    sigla: 'ACF — Advanced Corporate Finance',
    resumo: 'Implantação e organização da área financeira, dando ao gestor conhecimento pleno da realidade financeira da empresa.',
    eixos: [
      'Planejamento financeiro: previsões de curto prazo com fluxo de caixa projetado, orçamento empresarial e DRE hipotética',
      'Organização da informação: classificação de contas, conciliação bancária, DRE e Balanço Patrimonial',
      'Formação da equipe: análise e enquadramento das pessoas no perfil de conhecimentos, habilidades e atitudes',
      'Gestão sistemática de indicadores: implantação dos indicadores de desempenho e das reuniões de acompanhamento'
    ]
  },

  familiares: {
    titulo: 'Profissionalização de Empresas Familiares',
    sigla: 'FBP — Family Business Professionalization',
    resumo: 'Profissionalização da gestão para garantir a perpetuidade do negócio, tendo como parâmetro os direcionamentos do IBGC — Instituto Brasileiro de Governança Corporativa.',
    eixos: [
      'Família empresária: alinhamento dos desejos e anseios da família em relação aos negócios',
      'Sucessão: preparação da família e do negócio para a sucessão e formação dos sucessores',
      'Patrimônio: organização e desenvolvimento do patrimônio, alinhado à gestão integrada do negócio',
      'Governança: criação dos conselhos de família, de patrimônio e de administração'
    ]
  },

  estrategico: {
    titulo: 'Planejamento e Gestão Estratégica',
    resumo: 'Construção do planejamento estratégico com o objetivo de definir os rumos da organização e construir ações de longo prazo.',
    eixos: [
      'Alinhamento empresarial e definição de Visão, Valores, Políticas, Missão e Negócio',
      'Determinação dos fatores críticos de sucesso e análise dos cenários',
      'Identificação de oportunidades e construção do posicionamento de mercado',
      'Construção da arquitetura estratégica e do modelo de gestão',
      'Definição e acompanhamento do plano de ação'
    ]
  }
};

/* ==========================================================================
   PARTICULARIDADES
   Transcritas da proposta em uso. Texto comercial, não técnico.
   ========================================================================== */

const PARTICULARIDADES = [
  'Não estão incluídas as subcontratações de serviços que porventura venham a ser necessárias, tais como pesquisas de mercado e empresas de comunicação.',
  'Não estão incluídos cursos e palestras não relacionados nesta proposta. Tais serviços, caso necessários, deverão ser consultados à parte.',
  'Para economia de tempo e deslocamento, todo trabalho que não depender da presença dos consultores na empresa será realizado no escritório da Formatar.',
  'Cancelamentos de agenda devem ocorrer com antecedência mínima de 2 dias para a reprogramação. Sem esse prazo, não garantimos o reagendamento imediato do consultor no mês em questão.',
  'Agendamentos marcados em que o cliente não compareça serão tratados como prestados.',
  'A partir da assinatura do contrato, o cliente passa a compor nossa lista de clientes para fins de referência e divulgação no site, no item "portfólio de clientes".',
  'O valor dos serviços será reajustado anualmente, com prévia comunicação ao cliente.',
  'Em paralisação temporária superior a 2 meses, havendo retomada, não há necessidade de novo contrato — mas o valor da hora deverá ser consultado novamente, em função de possível reajuste de tabela.',
  'É vedado ao contratante o assédio ou qualquer manifestação de interesse na contratação direta de nossos consultores e funcionários.'
];

/* ==========================================================================
   FOLHAS
   ========================================================================== */

function capa(d) {
  return `
<section class="folha capa">
  <div>
    <div class="marca">${FORMATAR.marca}</div>
    <div class="marca-assinatura">${FORMATAR.assinatura}</div>
  </div>

  <div>
    <div class="kicker">Proposta de prestação de serviços</div>
    <h1 style="color:#fff;font-size:30pt">${esc(d.cliente?.nome || 'Cliente')}</h1>
    <p style="color:${MARCA.cinza};text-align:left;font-size:10pt">
      ${esc(d.cliente?.cidade || '')}${d.cliente?.documento ? ` &middot; ${documentoBr(d.cliente.documento)}` : ''}
    </p>
  </div>

  <div style="border-top:2px solid ${MARCA.laranja};padding-top:5mm">
    <p style="color:${MARCA.cinza};text-align:left;font-size:8.5pt;margin:0">
      Elaborada em ${dataBr(d.elaboradoEm)}${d.validade ? ` &middot; válida até ${dataBr(d.validade)}` : ''}
    </p>
  </div>
</section>`;
}

function folhaCliente(d, n, total) {
  const c = d.contato || {};
  const linha = (rotulo, valor) => valor
    ? `<tr><td class="rotulo">${esc(rotulo)}</td><td class="valor">${esc(valor)}</td></tr>`
    : '';

  return folha({
    titulo: 'Dados e objeto',
    numero: n, total,
    conteudo: `
      <div class="kicker">A quem se destina</div>
      <h1>${esc(d.cliente?.nome || 'Cliente')}</h1>

      <table>
        ${linha('Empresa', d.cliente?.nome)}
        ${d.cliente?.documento ? `<tr><td class="rotulo">CNPJ / CPF</td><td class="valor">${documentoBr(d.cliente.documento)}</td></tr>` : ''}
        ${linha('Cidade', d.cliente?.cidade)}
        ${linha('Contato', c.nome)}
        ${linha('Cargo / área', c.cargo)}
        ${linha('Telefone', c.telefone)}
        ${linha('E-mail', c.email)}
      </table>

      <h2>Objeto</h2>
      <div class="bloco">
        <p style="margin:0">${esc(d.objeto || '')}</p>
      </div>

      <h2>Como trabalhamos</h2>
      <ul>
        <li>Serviços de mineração de dados e informações.</li>
        <li>Implantação de planilhas e tecnologia para gestão.</li>
        <li>Adequação e implantação do sistema gerencial.</li>
        <li>Reuniões para análise de dados e direcionamento de ações.</li>
        <li>Grupo de WhatsApp com os sócios e a equipe da Formatar.</li>
      </ul>
      <p style="font-size:9pt;color:${MARCA.cinza}">
        Reuniões híbridas, na sede da Formatar, na empresa contratante ou on-line,
        com agendamentos conforme a implantação das etapas.
      </p>`
  });
}

function folhaEscopo(d, n, total) {
  const escolhidos = (d.escopo || [])
    .map((chave) => SERVICOS[chave])
    .filter(Boolean);

  const corpo = escolhidos.length
    ? escolhidos.map((s) => `
        <h2>${esc(s.titulo)}</h2>
        ${s.sigla ? `<div class="kicker" style="margin-top:-2mm">${esc(s.sigla)}</div>` : ''}
        <p>${esc(s.resumo)}</p>
        <ul>${s.eixos.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`).join('')
    : '<p>Escopo a definir.</p>';

  return folha({
    titulo: 'Escopo contratado',
    numero: n, total,
    conteudo: `
      <div class="kicker">O que está contratado</div>
      <h1>Escopo dos trabalhos</h1>
      ${corpo}`
  });
}

function folhaCondicoes(d, n, total) {
  const dg = d.diagnostico || {};
  const co = d.consultoria || {};

  const blocoDiagnostico = dg.valor ? `
    <h2>Diagnóstico</h2>
    <table>
      <tr><td class="rotulo">Valor do diagnóstico</td><td class="valor">${moeda(dg.valor)}</td></tr>
      ${dg.condicoes ? `<tr><td class="rotulo">Condições</td><td>${esc(dg.condicoes)}</td></tr>` : ''}
      ${dg.prazo ? `<tr><td class="rotulo">Prazo</td><td>${esc(dg.prazo)}</td></tr>` : ''}
    </table>` : '';

  const blocoConsultoria = co.valor ? `
    <h2>Consultoria</h2>
    <table>
      <tr><td class="rotulo">Valor mensal</td><td class="valor">${moeda(co.valor)}</td></tr>
      ${co.meses ? `<tr><td class="rotulo">Período de implantação</td><td>${esc(co.meses)} meses</td></tr>` : ''}
      ${co.inicio ? `<tr><td class="rotulo">Início</td><td>${esc(co.inicio)}</td></tr>` : ''}
      ${co.condicoes ? `<tr><td class="rotulo">Condições</td><td>${esc(co.condicoes)}</td></tr>` : ''}
      ${d.rescisao ? `<tr><td class="rotulo">Pedido de rescisão</td><td>${esc(d.rescisao)}</td></tr>` : ''}
    </table>` : '';

  return folha({
    titulo: 'Condições comerciais',
    numero: n, total,
    conteudo: `
      <div class="kicker">Investimento</div>
      <h1>Condições comerciais</h1>
      ${blocoDiagnostico}
      ${blocoConsultoria}

      ${d.km ? `
        <h2>Despesas de viagem</h2>
        <div class="bloco">
          <p style="margin:0">
            Deslocamentos são cobrados a <strong>${moeda(d.km)} por quilômetro rodado</strong>,
            tendo como base o município de Divinópolis/MG até o cliente, e pagos diretamente
            ao consultor que realizou a viagem. Em viagens que exijam deslocamento aéreo,
            acrescem-se passagens, hospedagem e alimentação. Havendo necessidade de
            hospedagem, as despesas correm por conta do contratante.
          </p>
        </div>` : ''}

      ${d.validade ? `
        <div class="faixa-laranja">
          <strong>Esta proposta é válida até ${dataBr(d.validade)}.</strong>
        </div>` : ''}`
  });
}

function folhaParticularidades(d, n, total) {
  const resp = d.responsavel || {};

  return folha({
    titulo: 'Particularidades',
    numero: n, total,
    conteudo: `
      <div class="kicker">O que você precisa saber</div>
      <h1>Particularidades</h1>
      <ul>${PARTICULARIDADES.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>

      <div class="assinaturas">
        <div class="assinatura">
          <div class="linha"></div>
          <div class="nome">${esc(resp.nome || '')}</div>
          <div class="cargo">${esc(resp.cargo || 'Formatar Consultoria')}</div>
        </div>
        <div class="assinatura">
          <div class="linha"></div>
          <div class="nome">${esc(d.cliente?.nome || '')}</div>
          <div class="cargo">Contratante</div>
        </div>
      </div>

      <p style="text-align:center;font-size:8pt;color:${MARCA.cinza};margin-top:10mm">
        ${FORMATAR.endereco}<br>
        ${FORMATAR.telefone} &middot; ${FORMATAR.site} &middot; ${FORMATAR.email}
      </p>`
  });
}

/* ==========================================================================
   MONTAGEM
   ========================================================================== */

export function renderizarProposta(dados) {
  const d = dados || {};

  // A capa não entra na contagem: numerar a capa como "1 de 5" é ruído
  // num documento comercial.
  const internas = 4;
  const folhas = [
    capa(d),
    folhaCliente(d, 1, internas),
    folhaEscopo(d, 2, internas),
    folhaCondicoes(d, 3, internas),
    folhaParticularidades(d, 4, internas)
  ];

  return documento({
    titulo: `Proposta — ${d.cliente?.nome || 'Cliente'}`,
    folhas
  });
}
