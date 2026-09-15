/**
 * /api/dossie-cx — Geração e leitura do Dossiê de Experiência.
 *
 * Autenticação garantida pelo _middleware.js.
 *
 * GET  ?cliente_id=N                → última versão + histórico (não gera nada)
 * GET  ?cliente_id=N&html=true[&versao=N]  → o documento
 * POST ?cliente_id=N                → gera a próxima versão
 *
 * Duas diferenças de comportamento em relação ao /api/dossier, e as duas
 * vêm de o sujeito ser outro:
 *
 *   O POST SEMPRE gera. No Executivo, dossiê existente é devolvido em
 *   vez de refeito, porque os fatos externos de um prospect mudam pouco
 *   e duas gerações custariam dinheiro para dizer o mesmo. Aqui a conta
 *   muda toda semana — pessoa nova mapeada, etapa que avançou — e pedir
 *   o dossiê é pedir a leitura de HOJE. O botão da tela diz isso.
 *
 *   A chave é o CLIENTE, não o CNPJ. Um cliente convertido tem os dois
 *   documentos, e chavear ambos por CNPJ misturaria as duas contagens
 *   de versão.
 */

import { chamarIA, extrairJson, chaveConfigurada, PROVEDORES } from './_lib/ia.js';
import {
  FORMATO_ANALISE_CX, validarAnaliseCx, analiseCxUtilizavel, filtrarPorFontes,
  montarDossieCx, resumirMapa, mesesDesde,
  ROTULO_INFLUENCIA, ROTULO_POSTURA
} from './_lib/schema-dossie-cx.js';
import { renderizarDossieCx } from './_lib/dossie-cx-template.js';
import { criarVersionador } from './_lib/versionamento.js';
import { buscarContaDoHub, nucleosDoCliente, consultarHub } from './_lib/hub.js';

const MAX_TOKENS_DOSSIE_CX = 3000;

/**
 * O versionamento é o mesmo dos outros dois documentos e mora no
 * `_lib/versionamento.js` desde a 2.17.0. Aqui fica só o que é próprio
 * deste dossiê: a chave é o CLIENTE, não o CNPJ — um cliente convertido
 * terá os dois documentos, e chavear ambos por CNPJ misturaria as
 * contagens de versão.
 */
const dossiesCx = criarVersionador({
  tabela: 'dossies_cx',
  chave: 'cliente_id',
  rotulo: 'do dossiê de experiência',
  colunasResumo: ['cliente_nome', 'documento', 'provider']
});

/* ==========================================================================
   PROMPT
   ========================================================================== */

const SYSTEM_PROMPT = `Você é analista de Customer Experience da Formatar Consultoria.
Produz dossiês de experiência usados pela equipe de CX antes de reuniões com clientes ATIVOS.

REGRA ABSOLUTA — não invente fatos.
Tudo que você sabe sobre esta conta está no contexto abaixo, e veio do CRM. Não
complete com informação de memória, não suponha faturamento, porte, número de
funcionários, resultados obtidos, reuniões realizadas ou satisfação medida.

REGRA SOBRE PESSOAS — este documento fala de gente com nome.
Quem são elas, o cargo e o contato vêm do CADASTRO DO ERP; a Formatar não as
inventa nem as renomeia aqui. A influência e a postura, quando existem, foram
REGISTRADAS pela equipe de CX. Pessoa sem influência e sem postura é pessoa que
o ERP conhece e que a CX ainda não avaliou — o que é uma lacuna do trabalho da
CX, nunca um defeito da pessoa nem da conta.
Trabalhe com esses registros; não os redefina, não classifique
ninguém por conta própria e não emita juízo sobre caráter, competência,
personalidade ou vida pessoal de quem quer que seja. Onde estiver escrito "não
avaliada", trate como informação que falta — nunca como neutralidade.
Suas observações devem ser sobre a RELAÇÃO (quem participa de quê, onde a
Formatar não tem interlocutor, de quem a conta depende), não sobre a pessoa.

REGRA ABSOLUTA — não afirme o vazio que você não conferiu.
Cada bloco do contexto diz se a fonte foi CONSULTADA ou não. Onde estiver
escrito que não foi, é PROIBIDO concluir que a coisa não existe. "Não há
ninguém mapeado", "nenhum núcleo atendido", "a entrega é invisível" são
afirmações que só podem sair de uma consulta que ACONTECEU e voltou vazia.

Esta regra existe porque foi quebrada. Um dossiê real declarou uma conta
"uma relação sem rosto registrado" e mandou a equipe levantar em campo os
interlocutores e os núcleos — que estavam cadastrados no ERP o tempo todo.
O documento não tinha consultado. Afirmar o vazio é a frase mais cara
deste dossiê, porque manda gente procurar o que já está achado.

O QUE VOCÊ NÃO PODE AFIRMAR nesta versão do sistema: nada sobre o CONTEÚDO
das reuniões, das atas ou do plano de ação, e nada sobre indicadores, saúde
da carteira, NPS ou satisfação. Essas fontes ainda não chegam ao CRM.

Você PODE usar como fato, quando o contexto os trouxer: quais núcleos a
Formatar atende nesta conta, quantas reuniões houve em cada um e quando foi
a última. Isso é cadastro, foi lido do ERP e está conferido. O que não se
pode é dizer como as reuniões foram, o que se tratou nelas, se o cliente
ficou satisfeito ou se a conta está saudável. Contagem não é conteúdo.

Sobre EXPANSÃO: na Formatar, expansão é acréscimo de produto ou serviço à
entrega atual. Não gera contrato novo nem devolve o cliente ao funil comercial.
Suas oportunidades devem respeitar essa definição.

Sobre a quantidade de itens: produza de 2 a 5 riscos, oportunidades e perguntas,
conforme o material disponível. Conta com pouco registro merece dossiê curto —
nunca invente item para preencher cota.

Escreva em português do Brasil, tom profissional, direto, sem adjetivação vazia.
Responda ESTRITAMENTE com um objeto JSON no formato abaixo, sem markdown, sem
texto antes ou depois:

${FORMATO_ANALISE_CX}`;

/**
 * Monta o contexto factual. Tudo aqui saiu do banco — é a única coisa
 * que o modelo pode tratar como verdade.
 */
/**
 * A linha sobre o tempo na etapa — inclusive quando a resposta é "não sei".
 *
 * Dizer explicitamente que o dado não existe custa uma linha e evita o
 * defeito de 07/09/2026, quando o modelo somou `data_inicio` (2019) com
 * a etapa (posta em 2026) e afirmou 83 meses de estagnação. Omitir o
 * campo não bastaria: o vazio é justamente onde a inferência entra.
 */
function tempoDeEtapa(cliente, etapa) {
  if (!etapa) return 'Nesta etapa desde: — (não há etapa registrada)';

  if (!cliente.etapa_desde) {
    return 'Nesta etapa desde: O CRM NÃO SABE. O registro é anterior ao '
      + 'controle desta data, ou a etapa foi atribuída em massa na importação. '
      + 'É PROIBIDO afirmar ou estimar há quanto tempo o cliente está nesta '
      + 'etapa, e é proibido tratar a permanência nela como risco.';
  }

  const meses = mesesDesde(cliente.etapa_desde);
  return `Nesta etapa desde: ${cliente.etapa_desde}`
    + (meses != null ? ` (${meses} meses nesta etapa)` : '');
}

/*
 * `reunirConta` e `montarContexto` são exportadas para a prova
 * `dev/prova/dossie-conta.mjs`, e só por isso — nenhuma rota as importa.
 *
 * O motivo é a regra da casa: prova nunca importa cópia do código. As
 * duas são o caminho inteiro entre o ERP e o que o modelo lê, e é
 * justamente aí que mora a diferença entre "não há" e "não perguntei".
 * Reescrevê-las na suíte provaria que a minha cópia concorda com a
 * minha cópia.
 */
export function montarContexto({ cliente, etapa, nucleos, stakeholders, mapa, fontes }) {
  const partes = [];

  const meses = mesesDesde(cliente.data_inicio);

  const origemConta = fontes.conta.consultado
    ? 'lido AO VIVO do ERP no momento desta geração — FATO'
    : `o ERP NÃO respondeu (${fontes.conta.motivo}); abaixo vai a cópia guardada no CRM`;

  partes.push(`=== A CONTA (${origemConta}) ===
Razão social: ${cliente.nome || '—'}
Nome fantasia: ${cliente.nome_fantasia || '—'}
Cidade: ${cliente.cidade || '—'}
Etapa da jornada: ${etapa?.nome || '—'}
${tempoDeEtapa(cliente, etapa)}
Início da jornada: ${cliente.data_inicio || '—'}${meses != null ? ` (${meses} meses de relação)` : ''}
ATENÇÃO — as duas linhas acima são fatos SEPARADOS. O início da jornada é
o começo do CONTRATO; não diz nada sobre há quanto tempo o cliente está
na etapa atual. Não some, não subtraia e não conclua uma da outra.
Classificação no ERP (use o valor como está; NÃO o converta em nota,
escala, percentual nem juízo de valor): ${cliente.classificacao ?? (fontes.conta.consultado
    ? 'o ERP respondeu e esta conta NÃO tem classificação cadastrada'
    : 'não sei — o ERP não foi consultado. NÃO afirme que ela não existe lá.')}
Status no ERP: ${cliente.statusErp || '—'}
Vínculo com o ERP: ${cliente.erp_id ? `sim (ID ${cliente.erp_id})` : 'ainda não conferido — cadastro manual. Isto NÃO significa que o cliente esteja fora do ERP.'}`);

  /* ---------------------------------------------------------------
     NÚCLEOS — e a diferença entre "não tem" e "não perguntei"
     --------------------------------------------------------------- */

  if (fontes.nucleos.consultado) {
    partes.push(`
=== NÚCLEOS ATENDIDOS (lido do ERP — FATO) ===
Núcleo aqui é o TIME da Formatar. O tipo de reunião que o compõe vem
entre parênteses, porque é assim que ele aparece no Plano de Ação.
${nucleos.length
  ? nucleos.map((n) => {
    const tipos = (n.tiposDeReuniao || []).map((t) => t.nome).filter(Boolean).join(', ');
    const hist = n.reunioesRealizadas
      ? `${n.reunioesRealizadas} reunião(ões) realizada(s)${n.ultimaReuniao ? `, a última em ${String(n.ultimaReuniao).slice(0, 10)}` : ''}`
      : 'nenhuma reunião realizada ainda';
    const previstas = n.reunioesPrevistas ? `, ${n.reunioesPrevistas} agendada(s)` : '';
    return `  - ${n.nome || '(time sem nome no ERP)'}${tipos ? ` (${tipos})` : ''} — ${hist}${previstas}`;
  }).join('\n')
  : `  O ERP respondeu e este cliente NÃO tem nenhuma reunião registrada.
  Isso é um fato sobre o REGISTRO de reuniões, e não autoriza concluir
  que a Formatar não entrega nada a esta conta.`}

Você SABE quais núcleos são atendidos, QUANTAS reuniões houve e QUANDO
foi a última. Você NÃO SABE o que foi tratado em nenhuma delas — as atas
não chegam ao CRM nesta versão. Não caracterize o andamento, a qualidade
nem o resultado dos encontros.`);
  } else {
    partes.push(`
=== NÚCLEOS ATENDIDOS — NÃO CONSULTADOS ===
${fontes.nucleos.motivo || 'A consulta ao ERP falhou.'}

É PROIBIDO afirmar que este cliente não tem núcleo atendido, que a
entrega é invisível, que não há frente de trabalho mapeada, ou pedir que
alguém vá marcar núcleos. Nada disso foi verificado. Se a falta for
relevante, trate-a como limitação DESTA CONSULTA, não como característica
da conta.${fontes.nucleos.origem === 'crm' ? `

Existe uma marcação manual antiga na ficha do CRM (${nucleos.map((n) => n.nome).join(', ')}).
Ela não foi conferida contra o ERP e pode estar velha.` : ''}`);
  }

  if (cliente.observacoes) {
    partes.push(`
=== OBSERVAÇÕES ESCRITAS PELA CX NA FICHA (FATO) ===
${cliente.observacoes}`);
  }

  /* ---------------------------------------------------------------
     PESSOAS — a identidade é do ERP, a avaliação é da CX
     --------------------------------------------------------------- */

  const fp = fontes.pessoas;

  if (!fp.consultado) {
    partes.push(`
=== MAPA DE PESSOAS — NÃO CONSULTADO ===
${fp.motivo || 'A consulta ao ERP falhou.'}

As pessoas desta conta são cadastradas NO ERP, e o ERP não respondeu
agora. É PROIBIDO afirmar que não há pessoa mapeada, que a Formatar não
tem interlocutor, que a conta é uma relação sem rosto, ou recomendar que
alguém vá a campo levantar os interlocutores. Nada disso foi verificado.

Se precisar citar, cite como limitação DESTA CONSULTA.`);
  } else if (fp.formato === 'referencias') {
    partes.push(`
=== MAPA DE PESSOAS — EXISTEM, E NÃO SEI OS NOMES ===
O ERP registra ${fp.totalNoErp} pessoa(s) nesta conta, mas devolveu apenas
referências internas em vez dos dados. Ou seja: a conta TEM interlocutores
registrados; este documento é que não consegue nomeá-los nesta versão.

É PROIBIDO dizer que não há pessoas. Trate como limitação da leitura.`);
  } else if (!stakeholders.length) {
    partes.push(`
=== MAPA DE PESSOAS ===
O ERP foi consultado e NÃO há nenhuma pessoa cadastrada nesta conta.

Este é um fato verificado, e é uma lacuna real do cadastro — vale citar.
Mas é lacuna do REGISTRO, não prova de que a Formatar não tenha
interlocutor no cliente. Não conclua nada sobre a relação a partir disso.`);
  } else {
    const avaliadas = stakeholders.filter((p) => p.avaliada).length;

    partes.push(`
=== MAPA DE PESSOAS ===
Identidade, cargo e contato vêm do ERP (FATO). Influência, postura e
patrocínio são a leitura registrada pela CX no CRM — e só existem onde
alguém as registrou.

${stakeholders.map((p) => {
      const marcas = [
        p.origem === 'crm' ? 'SÓ NO CRM, não existe no cadastro do ERP' : null,
        p.principal === true ? 'CONTATO PRINCIPAL no ERP' : null,
        p.cargo ? `cargo: ${p.cargo}` : null,
        p.papel ? `papel: ${p.papel}` : null,
        `influência: ${ROTULO_INFLUENCIA[p.influencia]}`,
        `postura: ${ROTULO_POSTURA[p.postura]}`,
        p.patrocinador ? 'PATROCINADOR DA CONTA' : null,
        p.nucleos?.length
          ? `presente nas reuniões de: ${p.nucleos.join(', ')}`
          : null
      ].filter(Boolean).join(' · ');

      return `  - ${p.nome} — ${marcas}${p.observacoes ? `\n      observação da CX: ${p.observacoes}` : ''}`;
    }).join('\n')}

Resumo aritmético (já conferido, não recalcule):
  Pessoas na conta: ${mapa.total}${fp.soNoCrm ? ` (${fp.soNoCrm} delas só no CRM)` : ''}
  Avaliadas pela CX: ${avaliadas} de ${mapa.total}
  Patrocinadores: ${mapa.patrocinadores.join(', ') || 'nenhum indicado'}
  Influência alta: ${mapa.porInfluencia.alta} · média: ${mapa.porInfluencia.media} · baixa: ${mapa.porInfluencia.baixa} · não avaliada: ${mapa.porInfluencia.desconhecida}
  Postura promotor: ${mapa.porPostura.promotor} · neutro: ${mapa.porPostura.neutro} · resistente: ${mapa.porPostura.resistente} · não avaliada: ${mapa.porPostura.desconhecida}
${fp.temMarcacaoPrincipal ? '' : `  O ERP não marca contato principal nesta conta. Isso é "não há marcação",
  e NÃO é "não há contato principal" — não trate como lacuna do cliente.
`}${mapa.nucleosSemPessoa === null
  ? `  Cruzamento núcleo × pessoa: NÃO FOI POSSÍVEL FAZER. O ERP não registra
  quem do cliente participa das reuniões, então não dá para saber se
  algum núcleo está sem interlocutor. NÃO afirme que está nem que não
  está.`
  : `  Núcleos atendidos SEM ninguém presente nas reuniões: ${mapa.nucleosSemPessoa.join(', ') || 'nenhum'}`}`);
  }

  partes.push(`
=== TAREFA ===
Produza a análise no formato JSON especificado, baseando cada afirmação no
material acima. Onde faltar base, escreva pouco ou omita o item.`);

  return partes.join('\n');
}

/* ==========================================================================
   LEITURA DO BANCO
   ========================================================================== */

/**
 * Reúne tudo que compõe o documento. Uma função só, usada pela geração e
 * pela prévia da tela: as duas precisam enxergar exatamente o mesmo
 * conjunto, ou a tela prometeria um documento diferente do que sai.
 */
export async function reunirConta(db, clienteId, env) {
  const cliente = await db
    .prepare('SELECT * FROM clientes WHERE id = ?')
    .bind(clienteId)
    .first();

  if (!cliente) return null;

  let idsNucleos = [];
  try { idsNucleos = JSON.parse(cliente.nucleos || '[]'); } catch (e) { idsNucleos = []; }

  const [etapa, listaNucleos, pessoas, papeis] = await Promise.all([
    cliente.etapa_id
      ? db.prepare('SELECT id, nome, cor FROM etapas WHERE id = ?').bind(cliente.etapa_id).first()
      : Promise.resolve(null),

    db.prepare('SELECT id, nome, cor FROM nucleos').all(),

    db.prepare(
      `SELECT * FROM stakeholders
       WHERE cliente_id = ? AND ativo = 1
       ORDER BY patrocinador DESC,
                CASE influencia WHEN 'alta' THEN 1 WHEN 'media' THEN 2
                                WHEN 'baixa' THEN 3 ELSE 4 END,
                nome COLLATE NOCASE`
    ).bind(clienteId).all(),

    db.prepare('SELECT id, nome FROM papeis').all()
  ]);

  const porId = new Map((listaNucleos.results || []).map((n) => [n.id, n]));
  const nomePapel = new Map((papeis.results || []).map((p) => [p.id, p.nome]));

  // A camada de avaliação da CX, que é o que o CRM legitimamente tem de
  // seu: influência, postura, patrocinador e observações. A identidade
  // das pessoas vem do ERP, logo abaixo.
  const avaliacoes = (pessoas.results || []).map((s) => {
    let ids = [];
    try { ids = JSON.parse(s.nucleos || '[]'); } catch (e) { ids = []; }

    return {
      ...s,
      patrocinador: !!s.patrocinador,
      papel: s.papel_id ? (nomePapel.get(s.papel_id) || null) : null,
      nucleoIdsLocais: ids
    };
  });

  /* ------------------------------------------------------------------
     O ERP — dono da identidade, das pessoas e dos núcleos

     As duas consultas são independentes e nenhuma das duas derruba a
     geração: o dossiê sai mesmo com o hub mudo. O que ele não faz é
     afirmar o vazio que não conferiu.
     ------------------------------------------------------------------ */

  const [conta, nuc] = await Promise.all([
    consultarHub('a conta no ERP', () => buscarContaDoHub(env, {
      erpId: cliente.erp_id,
      documento: cliente.documento
    })),
    nucleosDoCliente(env, cliente.erp_id)
  ]);

  const doErp = conta.consultado ? conta.dado : null;
  const idErp = doErp ? doErp.cliente : null;
  const contatos = doErp ? doErp.contatos : null;

  // A identidade do ERP vence a cópia local, campo a campo. Onde o ERP
  // não respondeu, o cadastro do CRM segue valendo — é melhor que nada,
  // e a folha declara a origem.
  const clienteVivo = {
    ...cliente,
    nome: (idErp && idErp.nome) || cliente.nome,
    nome_fantasia: (idErp && idErp.nome_fantasia) || cliente.nome_fantasia,
    documento: (idErp && idErp.documento) || cliente.documento,
    telefone: (idErp && idErp.telefone) || cliente.telefone,
    email: (idErp && idErp.email) || cliente.email,
    classificacao: idErp && idErp.classificacao != null
      ? idErp.classificacao
      : cliente.classificacao,
    erp_id: cliente.erp_id || (idErp && idErp.erp_id) || null,
    statusErp: idErp ? idErp.status : null
  };

  /* ---- as pessoas ---- */

  // `ausente` fica de fora de propósito: o campo não ter voltado pode
  // ser "esta conta não tem ninguém" ou "este ERP não expõe isso", e não
  // dá para saber qual. Na dúvida, não consultamos.
  const FORMATOS_UTEIS = ['objetos', 'inesperado', 'vazio', 'referencias'];
  const pessoasConsultadas = !!contatos && FORMATOS_UTEIS.includes(contatos.formato);

  // Referência é gente que existe e que não sabemos nomear. Não vira
  // pessoa na tabela, mas prova que a conta TEM interlocutor — e é essa
  // prova que impede o documento de dizer que não tem.
  const nomeaveis = contatos && contatos.formato !== 'referencias'
    ? contatos.contatos.filter((c) => c.nome)
    : [];

  const chavesDe = (p) => [
    p.erp_id || null,
    p.email ? String(p.email).trim().toLowerCase() : null,
    p.nome ? `nome:${String(p.nome).trim().toLowerCase()}` : null
  ].filter(Boolean);

  // A avaliação da CX é casada por e-mail e, na falta dele, por nome.
  // É junção de LEITURA, sem migração: a amarra durável pelo id do
  // contato é a Fase 3, e depende de o ERP ter id estável.
  const avaliacaoPor = new Map();
  for (const a of avaliacoes) {
    for (const k of chavesDe(a)) if (!avaliacaoPor.has(k)) avaliacaoPor.set(k, a);
  }

  // De quais núcleos cada pessoa participa — apurado pela presença nas
  // reuniões, não declarado num cadastro.
  const nucleosPorPessoa = new Map();
  for (const n of nuc.nucleos) {
    for (const p of n.participantesCliente) {
      for (const k of chavesDe(p)) {
        if (!nucleosPorPessoa.has(k)) nucleosPorPessoa.set(k, new Set());
        nucleosPorPessoa.get(k).add(n.erp_id);
      }
    }
  }

  const nomeNucleo = new Map(nuc.nucleos.map((n) => [n.erp_id, n.nome]));
  const usadas = new Set();

  const stakeholders = nomeaveis.map((c) => {
    const chaves = chavesDe(c);
    const aval = chaves.map((k) => avaliacaoPor.get(k)).find(Boolean) || null;
    if (aval) usadas.add(aval.id);

    const ids = [...(chaves
      .map((k) => nucleosPorPessoa.get(k))
      .find(Boolean) || new Set())];

    return {
      nome: c.nome,
      cargo: c.cargo || (aval ? aval.cargo : null),
      email: c.email || (aval ? aval.email : null),
      telefone: c.telefone || (aval ? aval.telefone : null),
      erpContatoId: c.erp_id,
      principal: c.principal,

      // O juízo é do CRM, e só existe se alguém o registrou.
      papel: aval ? aval.papel : null,
      influencia: aval ? aval.influencia : 'desconhecida',
      postura: aval ? aval.postura : 'desconhecida',
      patrocinador: aval ? aval.patrocinador : false,
      observacoes: aval ? aval.observacoes : null,
      avaliada: !!aval,

      nucleoIds: ids,
      nucleos: ids.map((id) => nomeNucleo.get(id)).filter(Boolean),
      origem: 'erp'
    };
  });

  // Quem a CX registrou no CRM e o ERP não conhece. Não some da folha:
  // ou é gente que saiu do cliente, ou é cadastro que nunca existiu lá —
  // e as duas coisas a CX precisa ver para resolver.
  const soNoCrm = avaliacoes
    .filter((a) => !usadas.has(a.id))
    .map((a) => ({
      nome: a.nome,
      cargo: a.cargo,
      email: a.email,
      telefone: a.telefone,
      erpContatoId: null,
      principal: null,
      papel: a.papel,
      influencia: a.influencia,
      postura: a.postura,
      patrocinador: a.patrocinador,
      observacoes: a.observacoes,
      avaliada: true,
      nucleoIds: [],
      nucleos: [],
      origem: 'crm'
    }));

  const todasAsPessoas = [...stakeholders, ...soNoCrm];

  /* ---- os núcleos ---- */

  // Com o ERP mudo, a marcação manual da ficha é o que sobra. Vale mais
  // que nada e a folha diz de onde veio — mas `nucleosConsultados`
  // continua falso, porque a guarda não pode aceitar marcação manual
  // como prova de que o ERP não tem mais nada.
  const nucleosDaFicha = idsNucleos.map((id) => porId.get(id)).filter(Boolean);
  const nucleos = nuc.consultado ? nuc.nucleos : nucleosDaFicha;

  const fontes = {
    conta: {
      consultado: !!doErp,
      origem: doErp ? 'erp' : 'crm',
      via: doErp ? doErp.via : null,
      motivo: doErp ? null : (conta.erro ? conta.erro.mensagem
        : 'O cliente não tem vínculo com o ERP nem CNPJ para consultar.')
    },
    pessoas: {
      consultado: pessoasConsultadas,
      origem: pessoasConsultadas ? 'erp' : null,
      formato: contatos ? contatos.formato : null,
      // Quantas pessoas o ERP tem, mesmo quando não sabemos nomeá-las.
      totalNoErp: contatos ? contatos.contatos.length : null,
      temMarcacaoPrincipal: contatos ? contatos.temMarcacaoPrincipal : false,
      soNoCrm: soNoCrm.length,
      motivo: pessoasConsultadas ? null
        : (conta.erro ? conta.erro.mensagem
          : 'O ERP não devolveu a lista de pessoas desta conta.')
    },
    nucleos: {
      consultado: nuc.consultado,
      origem: nuc.consultado ? 'erp' : (nucleosDaFicha.length ? 'crm' : null),
      motivo: nuc.motivo,
      totalReunioesRealizadas: nuc.totalReunioesRealizadas,
      semTime: nuc.semTime
    },
    ligacaoNucleoPessoaConhecida: nuc.consultado && nuc.registraParticipantes
  };

  return {
    cliente: clienteVivo,
    etapa,
    nucleos,
    stakeholders: todasAsPessoas,
    fontes,
    mapa: resumirMapa(todasAsPessoas, nucleos, {
      ligacaoConhecida: fontes.ligacaoNucleoPessoaConhecida
    })
  };
}

/* ==========================================================================
   GET — leitura, nunca gera
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const { searchParams } = new URL(context.request.url);
  const db = context.env.DB;

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const clienteId = Number(searchParams.get('cliente_id'));
  if (!clienteId) return json({ error: 'Informe o cliente.', code: 'CLIENTE_OBRIGATORIO' }, 400, cabecalhos);

  try {
    // --- O documento ---
    if (searchParams.get('html')) {
      const versao = Number(searchParams.get('versao')) || null;
      const html = await dossiesCx.lerHtml(db, clienteId, versao);

      if (!html) {
        return json({ error: 'Dossiê não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
      }

      return new Response(html, {
        status: 200,
        headers: { ...cabecalhos, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // --- Metadados e histórico ---
    const versoes = await dossiesCx.listarVersoes(db, clienteId);
    return json({ existe: versoes.length > 0, ultima: versoes[0] || null, versoes }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao consultar o dossiê.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — gera a próxima versão
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const env = context.env;
  const db = env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const clienteId = Number(searchParams.get('cliente_id'));
  if (!clienteId) return json({ error: 'Informe o cliente.', code: 'CLIENTE_OBRIGATORIO' }, 400, cabecalhos);

  let corpo = {};
  try { corpo = await context.request.json(); } catch (e) { corpo = {}; }

  const provider = corpo.provider || 'deepseek';
  if (!PROVEDORES.includes(provider) || !chaveConfigurada(provider, env)) {
    return json({
      error: `Provedor "${provider}" não está configurado no servidor.`,
      code: 'PROVEDOR_INDISPONIVEL'
    }, 400, cabecalhos);
  }

  const conta = await reunirConta(db, clienteId, env);
  if (!conta) {
    return json({ error: 'Cliente não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
  }

  try {
    const bruto = await chamarIA({
      provider, env,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: montarContexto(conta),
      maxTokens: MAX_TOKENS_DOSSIE_CX,
      jsonMode: true
    });

    const resposta = extrairJson(bruto);
    if (!resposta) {
      await registrarErro(db, clienteId, conta, usuario, provider, 'Resposta da IA não é JSON válido.');
      return json({
        error: 'O modelo não devolveu um JSON válido. Tente outro provedor.',
        code: 'JSON_INVALIDO'
      }, 502, cabecalhos);
    }

    const bruta = validarAnaliseCx(resposta);
    const seccoesVazias = bruta.seccoesVazias;

    // A conferência das fontes vem ANTES do teste de suficiência: um
    // dossiê que só se sustenta em afirmações descartáveis não é um
    // dossiê fraco, é um dossiê que não deveria existir. Melhor recusar
    // e dizer por quê do que imprimir a sobra.
    //
    // `presentes` segue vazio: das quatro fontes, nenhuma chegou
    // INTEIRA ao CRM. As reuniões chegaram só como contagem e núcleo —
    // o conteúdo das atas, que é o que a pendência 'atas' guarda, é da
    // 2.25.0. No lote que trouxer as atas, 'atas' entra no conjunto e os
    // itens que falam delas passam a valer, sem tocar nesta função.
    //
    // As duas linhas novas são a guarda contra o defeito de 15/09/2026:
    // afirmar que não há pessoas ou núcleos exige tê-los procurado.
    const guarda = filtrarPorFontes(bruta.analise, {
      presentes: new Set(),
      sabeEtapaDesde: !!conta.cliente.etapa_desde,
      pessoasConsultadas: conta.fontes.pessoas.consultado,
      nucleosConsultados: conta.fontes.nucleos.consultado
    });

    const analise = guarda.analise;
    const avisos = [...bruta.avisos, ...guarda.avisos];

    if (guarda.descartados.length) {
      console.log(
        `[dossie-cx] cliente ${clienteId}: ${guarda.descartados.length} item(ns) `
        + `descartados por fonte inexistente — `
        + guarda.descartados.map((d) => `${d.onde}: ${d.motivo}`).join(' | ')
      );
    }

    if (!analiseCxUtilizavel(analise)) {
      await registrarErro(db, clienteId, conta, usuario, provider,
        `Análise insuficiente. Vazias: ${seccoesVazias.join(', ')}`);
      return json({
        error: 'A análise voltou incompleta demais para gerar o dossiê.',
        code: 'ANALISE_INSUFICIENTE',
        seccoesVazias
      }, 502, cabecalhos);
    }

    const geradoEm = new Date().toISOString();

    const montarDados = (versao) => montarDossieCx({
      ...conta,
      analise,
      meta: { geradoPor: usuario.email, provider, geradoEm, versao }
    });

    // O número da versão só é conhecido dentro da gravação, e a capa do
    // documento o exibe. Por isso o HTML é montado lá, com a versão em mão.
    const gravacao = await dossiesCx.salvar({
      db,
      valorChave: clienteId,
      usuario,
      dados: montarDados,
      montarHtml: (versao) => renderizarDossieCx(montarDados(versao)),
      extras: {
        // Cópia do nome e do CNPJ NA HORA da geração, de propósito: se o
        // cadastro for corrigido depois, o histórico continua dizendo sob
        // que nome o documento foi gerado.
        cliente_nome: conta.cliente.nome || null,
        documento: conta.cliente.documento || null,
        provider
      }
    });

    if (!gravacao.ok) {
      return json({ error: `Dossiê gerado, mas não foi possível salvar: ${gravacao.erro}` }, 500, cabecalhos);
    }

    console.log(`[dossie-cx] ${usuario.email} | cliente ${clienteId} v${gravacao.versao} | ${provider}`);

    return json({
      ok: true,
      versao: gravacao.versao,
      tamanhoBytes: gravacao.tamanhoBytes,
      avisos,
      seccoesVazias
    }, 201, cabecalhos);

  } catch (e) {
    await registrarErro(db, clienteId, conta, usuario, provider, e.message);
    return json({ error: 'Falha ao gerar o dossiê.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   GRAVAÇÃO

   Vivia aqui até a 2.17.0, como terceira cópia do mesmo padrão. Foi para
   o `_lib/versionamento.js`, que agora atende os três documentos — o
   versionador configurado está no topo deste arquivo.
   ========================================================================== */

/** Falha ao registrar falha é engolida de propósito. */
const registrarErro = (db, clienteId, conta, usuario, provider, mensagem) =>
  dossiesCx.registrarErro({
    db,
    valorChave: clienteId,
    usuario,
    mensagem,
    extras: { cliente_nome: conta?.cliente?.nome || null, provider }
  });

/* ========================================================================== */

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}
