/**
 * /api/plano-acao — o plano de ação de todas as carteiras, em 5W2H.
 *
 * Autenticação garantida pelo _middleware.js.
 *
 * GET                      todas as ações abertas, de todas as carteiras
 * GET ?cliente_erp_id=...  só as de um cliente
 * GET ?desde=AAAA-MM-DD    janela de reuniões considerada
 * PUT ?carteira=...&acao=N grava o 5W2H que a CX preencheu
 *
 * COMO O PLANO É MONTADO
 *
 * A ata inteira vive no campo `notes` da reunião, no ERP. Este endpoint
 * lista as reuniões REALIZADAS, lê a ata de cada uma com o parser do
 * `_lib/ata.js` e devolve as ações.
 *
 * A ação vale enquanto está no plano. O manual v2.3 diz que ação
 * concluída ou cancelada **sai** do plano e fica registrada só no
 * contexto — então a ata mais recente de cada carteira é a verdade
 * corrente, e as anteriores servem para saber desde quando a ação vem
 * se arrastando.
 *
 * A NUMERAÇÃO POR CLIENTE
 *
 * Na ata, a sequência de ações é por tipo de reunião: o Comercial tem as
 * suas 1, 2, 3 e o Financeiro tem as dele, também a partir de 1. Num
 * cliente com três carteiras isso produz três "AÇÃO 1".
 *
 * O CRM dá um número por CLIENTE, corrido. O identificador fica `N.M`:
 * N é o número do cliente, M é o da ação no tipo de reunião.
 *
 * Ele é ATRIBUÍDO na primeira vez que a ação é vista e gravado — nunca
 * calculado na hora. Calculado, renumeraria sozinho quando uma ação
 * fechasse, e "Alphatex ação 2" mudaria de significado na semana
 * seguinte.
 *
 * **Consequência assumida: este GET escreve.** Abrir a tela pela
 * primeira vez atribui os números que faltam.
 *
 * A FRONTEIRA DO 5W2H
 *
 * A ata dá três dos sete campos: What (a descrição), Who (`Resp.:`) e
 * When (`Prazo:`). Why, Where, How e How much **não existem no texto** e
 * são preenchidos pela CX, guardados em `acoes_cx` e amarrados a
 * (carteira + número da ação).
 *
 * Não há IA nesta rota. Contar ações e ler estrutura de texto regular
 * tem resposta certa; pedir isso a um modelo seria trocar uma resposta
 * exata por uma provável, num plano que as pessoas cobram umas das
 * outras.
 *
 * O QUE NUNCA SAI DAQUI
 *
 * As notas privadas do consultor — as linhas finais em CAIXA ALTA — e o
 * `technicalNotes` da reunião. O parser separa as primeiras em campo
 * próprio e esta rota não as devolve; o segundo nem é pedido ao hub.
 */

import {
  listarCarteiras, listarReunioes, listarClientesDoHub,
  mapaDeTiposDeReuniao, mapaDeTimes, ErroHub
} from './_lib/hub.js';
import { lerAta } from './_lib/ata.js';

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

/**
 * Falta de permissao no hub NAO e 403.
 *
 * 403 quer dizer "voce nao pode". Aqui quem nao pode e a CHAVE DO
 * SERVIDOR, e o usuario nao tem nada com isso -- nem como resolver. O
 * front derrubava a sessao em todo 403, entao esta rota expulsava a
 * pessoa do CRM e mostrava o erro do hub na tela de login. O front foi
 * corrigido tambem, mas o codigo certo importa por si: 503 e o mesmo
 * que HUB_SEM_CHAVE ja usava, e pelo mesmo motivo -- o CRM esta sem
 * condicoes de atender, por configuracao, nao por autorizacao.
 */
function erroDoHub(e, cabecalhos) {
  if (e instanceof ErroHub) {
    const status = e.codigo === 'HUB_SEM_CHAVE' ? 503
      : e.codigo === 'HUB_SEM_PERMISSAO' ? 503
      : e.codigo === 'HUB_LIMITE' ? 429
      : 502;
    return json({ error: e.message, code: e.codigo, hubStatus: e.status }, status, cabecalhos);
  }
  return json({ error: 'Falha ao montar o plano de ação.', details: e.message }, 500, cabecalhos);
}

/* Na mesma ordem das consultas, para nomear qual falhou. */
const NOMES_DAS_FONTES = ['carteiras', 'reuniões', 'clientes', 'tipos de reunião', 'times'];

/**
 * Reúne TODAS as fontes que falharam numa resposta só.
 *
 * O caso que motiva isto: a chave do hub cobre clientes mas não carteiras.
 * Com `Promise.all`, a tela dizia só "falta hub:portfolios:read" — e só
 * depois de corrigida é que apareceria a próxima. Dizer as quatro juntas
 * transforma quatro idas ao painel da Cloudflare em uma.
 */
function erroDasFontes(falhas, cabecalhos) {
  const permissoes = [...new Set(
    falhas
      .filter((f) => f.erro instanceof ErroHub && f.erro.codigo === 'HUB_SEM_PERMISSAO')
      .map((f) => (String(f.erro.message).match(/hub:[a-z-]+:read/) || [])[0])
      .filter(Boolean)
  )];

  if (permissoes.length) {
    return json({
      error: permissoes.length === 1
        ? `A chave do hub não tem a permissão ${permissoes[0]}.`
        : `A chave do hub não tem estas permissões: ${permissoes.join(', ')}.`,
      code: 'HUB_SEM_PERMISSAO',
      permissoesFaltando: permissoes,
      fontes: falhas.map((f) => f.qual)
    }, 503, cabecalhos);
  }

  // Nenhuma falha foi de permissão: devolve a primeira, que é a que
  // explica o problema real.
  return erroDoHub(falhas[0].erro, cabecalhos);
}

/**
 * Quantos meses de reunião olhar para trás, por padrão.
 *
 * Seis meses cobre com folga a carteira mensal e a quinzenal. Ir mais
 * longe custaria páginas do hub para achar ações que, se ainda
 * estivessem abertas, teriam reaparecido numa ata recente — porque ação
 * aberta reaparece em toda ata da carteira até ser encerrada.
 */
const MESES_PADRAO = 6;

function inicioDaJanela(meses = MESES_PADRAO) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString();
}

/* ==========================================================================
   NUMERAÇÃO POR CLIENTE

   Atribui, para cada ação ainda sem número, o próximo livre do seu
   cliente. Nunca reaproveita: o `MAX + 1` conta inclusive as ações já
   encerradas, cujas linhas continuam aqui.
   ========================================================================== */

async function atribuirNumeros(db, linhas, usuario) {
  // Só quem tem carteira resolvida. Sem ela não há chave estável, e um
  // número amarrado a uma chave que muda se perderia junto com ela.
  const semNumero = linhas.filter((l) => l.carteiraErpId && l.numeroCliente == null);
  if (semNumero.length === 0) return;

  // Ordem determinística: duas pessoas abrindo a tela ao mesmo tempo
  // percorrem a mesma sequência, em vez de dependerem de qual página do
  // hub chegou antes.
  semNumero.sort((a, b) =>
    String(a.clienteErpId).localeCompare(String(b.clienteErpId))
    || String(a.carteiraErpId).localeCompare(String(b.carteiraErpId))
    || a.numero - b.numero
  );

  const agora = new Date().toISOString();

  // Duas tentativas: na colisão do UNIQUE (cliente, numero) — outra
  // pessoa atribuiu no intervalo — recalcula o próximo e refaz.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const pendentes = semNumero.filter((l) => l.numeroCliente == null);
    if (pendentes.length === 0) return;

    // O próximo número de cada cliente, uma consulta por cliente.
    const proximo = new Map();
    for (const clienteId of new Set(pendentes.map((l) => l.clienteErpId))) {
      const linha = await db
        .prepare('SELECT COALESCE(MAX(numero_cliente), 0) AS n FROM acoes_cx WHERE cliente_erp_id = ?')
        .bind(clienteId)
        .first();
      proximo.set(clienteId, Number(linha?.n || 0) + 1);
    }

    const comandos = [];
    const atribuidos = [];

    for (const l of pendentes) {
      const n = proximo.get(l.clienteErpId);
      proximo.set(l.clienteErpId, n + 1);
      atribuidos.push([l, n]);

      comandos.push(db
        .prepare(
          `INSERT INTO acoes_cx
             (cliente_erp_id, carteira_erp_id, acao_numero, numero_cliente, criado_por, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(l.clienteErpId, l.carteiraErpId, l.numero, n, usuario.email, agora));
    }

    try {
      await db.batch(comandos);
      atribuidos.forEach(([l, n]) => { l.numeroCliente = n; });
      return;

    } catch (e) {
      // O lote é transacional: ou entrou tudo, ou nada. Reler diz o que
      // já existe — inclusive o que outra pessoa acabou de criar.
      const { results } = await db
        .prepare('SELECT carteira_erp_id, acao_numero, numero_cliente FROM acoes_cx')
        .all();

      const porChave = new Map(
        (results || []).map((r) => [`${r.carteira_erp_id}::${r.acao_numero}`, r.numero_cliente])
      );

      for (const l of semNumero) {
        const achado = porChave.get(`${l.carteiraErpId}::${l.numero}`);
        if (achado != null) l.numeroCliente = achado;
      }

      if (tentativa === 1) {
        // Desistiu de numerar, mas não de mostrar: a ação aparece sem
        // identificador, o que é melhor que sumir da fila.
        return;
      }
    }
  }
}

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const env = context.env;
  const db = env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const clienteErpId = searchParams.get('cliente_erp_id') || null;
  const desde = searchParams.get('desde') || inicioDaJanela();

  try {
    // As cinco fontes do ERP, em paralelo.
    //
    // `allSettled`, não `all`: com `all` a primeira que falha derruba o
    // resto, e o usuário descobre UMA permissão faltante por vez — corrige
    // carteiras, recarrega, descobre reuniões, e assim por diante. Uma
    // viagem por permissão. Aqui todas são tentadas e o erro lista as que
    // faltam de uma vez.
    const fontes = await Promise.allSettled([
      listarCarteiras(env, { clienteErpId }),
      listarReunioes(env, { clienteErpId, desde }),
      listarClientesDoHub(env, { status: 'active' }),
      mapaDeTiposDeReuniao(env),
      mapaDeTimes(env)
    ]);

    const falhas = fontes
      .map((f, i) => (f.status === 'rejected' ? { erro: f.reason, qual: NOMES_DAS_FONTES[i] } : null))
      .filter(Boolean);

    if (falhas.length) return erroDasFontes(falhas, cabecalhos);

    const [{ carteiras }, { reunioes, truncado }, { clientes }, tiposDeReuniao, times] =
      fontes.map((f) => f.value);

    const { results } = await db.prepare('SELECT * FROM acoes_cx').all();
    const anotacoes = new Map(
      (results || []).map((a) => [`${a.carteira_erp_id}::${a.acao_numero}`, a])
    );

    const nomeDoCliente = new Map(clientes.map((c) => [c.erp_id, c.nome]));

    // A carteira de uma reunião é a que casa cliente E tipo de reunião —
    // é a definição de carteira, e é por isso que a chave da anotação é
    // a carteira e não o cliente: o mesmo cliente pode ter três, cada
    // uma com a sua numeração de ações.
    const carteiraDe = new Map(
      carteiras.map((c) => [`${c.clienteErpId}::${c.nucleoErpId}`, c])
    );

    /* ---- as reuniões, agrupadas por carteira, da mais nova para a mais
       velha (a ordenação padrão do hub já é essa) ---- */
    const porCarteira = new Map();

    for (const r of reunioes) {
      if (!r.ata) continue;   // reunião realizada sem ata escrita

      const chave = `${r.clienteErpId}::${r.nucleoErpId}`;
      if (!porCarteira.has(chave)) porCarteira.set(chave, []);
      porCarteira.get(chave).push(r);
    }

    const linhas = [];
    const avisos = [];

    for (const [chave, listaReunioes] of porCarteira) {
      const carteira = carteiraDe.get(chave) || null;

      // A ata mais recente manda: ação encerrada some do plano, então o
      // que está na última ata é o que continua aberto.
      const maisRecente = listaReunioes[0];
      const lida = lerAta(maisRecente.ata);

      lida.avisos.forEach((a) => avisos.push({
        reuniao: maisRecente.erp_nid,
        cliente: nomeDoCliente.get(maisRecente.clienteErpId) || lida.cabecalho.cliente,
        aviso: a
      }));

      // Desde quando cada ação aparece nas atas da carteira. O status da
      // ata já traz "desde", mas nem toda ação o tem — e a primeira
      // aparição é um piso confiável para "há quanto tempo se arrasta".
      const primeiraAparicao = new Map();
      for (const r of listaReunioes) {
        const anterior = lerAta(r.ata);
        for (const acao of anterior.acoes) {
          primeiraAparicao.set(acao.id, r.inicio);
        }
      }

      for (const acao of lida.acoes) {
        const carteiraId = carteira?.erp_id || null;
        const anotacao = carteiraId
          ? anotacoes.get(`${carteiraId}::${acao.id}`)
          : null;

        linhas.push({
          // --- Quem é ---
          carteiraErpId: carteiraId,
          carteiraNid: carteira?.erp_nid ?? null,
          clienteErpId: maisRecente.clienteErpId,
          cliente: nomeDoCliente.get(maisRecente.clienteErpId) || lida.cabecalho.cliente,

          // O núcleo vem do ERP; o cabeçalho da ata é a reserva. O ERP é
          // dono do nome — se o consultor escreveu "LOGISTICA" e o
          // cadastro diz "Logística", vale o cadastro.
          nucleo: tiposDeReuniao.get(maisRecente.nucleoErpId)?.nome
                  || lida.cabecalho.nucleo,
          nucleoErpId: maisRecente.nucleoErpId,

          timeErpId: tiposDeReuniao.get(maisRecente.nucleoErpId)?.timeErpId || null,
          time: times.get(
            tiposDeReuniao.get(maisRecente.nucleoErpId)?.timeErpId
          )?.nome || null,

          reuniaoErpId: maisRecente.erp_id,
          reuniaoNid: maisRecente.erp_nid,
          reuniaoEm: maisRecente.inicio,

          // --- O que a ata diz. Não se edita. ---
          // O M do identificador `N.M`: o número da ação no tipo de reunião.
          numero: acao.id,
          // O N. Nulo aqui significa "ainda não atribuído" — quem atribui
          // é o `atribuirNumeros`, logo depois de a lista estar montada.
          numeroCliente: anotacao?.numero_cliente ?? null,

          oQue: acao.descricao,
          quem: acao.responsavel,
          quando: acao.prazo,
          quandoBruto: acao.prazoBruto,

          status: acao.statusTipo,
          statusBruto: acao.status?.bruto || null,
          statusDesde: acao.statusDesde,
          diasEmAberto: acao.diasEmAberto,
          diasDeAtraso: acao.diasDeAtraso,
          atrasada: acao.atrasada,

          desdeAAta: primeiraAparicao.get(acao.id) || maisRecente.inicio,

          // --- O que a CX anota por cima. Editável. ---
          porque: anotacao?.porque || null,
          onde: anotacao?.onde || null,
          como: anotacao?.como || null,
          quanto: anotacao?.quanto || null,
          observacoes: anotacao?.observacoes || null,

          anotadoPor: anotacao?.atualizado_por || anotacao?.criado_por || null,
          anotadoEm: anotacao?.atualizado_em || anotacao?.criado_em || null,

          // A ata mudou de texto desde a anotação? A tela avisa, em vez
          // de mostrar um "Como" que responde a outra pergunta.
          descricaoMudou: !!(anotacao?.descricao_vista
            && anotacao.descricao_vista !== acao.descricao),

          // Quantos dos quatro campos a CX já preencheu.
          completude: ['porque', 'onde', 'como', 'quanto']
            .filter((c) => anotacao?.[c]).length
        });
      }
    }

    // Ação vista pela primeira vez ganha o seu número de cliente agora.
    // É a única escrita desta rota de leitura, e está documentada no
    // cabeçalho do arquivo.
    await atribuirNumeros(db, linhas, context.data.usuario);

    // Primeiro o que dói: atrasado, depois o que se arrasta há mais tempo.
    linhas.sort((a, b) =>
      (b.atrasada ? 1 : 0) - (a.atrasada ? 1 : 0)
      || (b.diasDeAtraso || 0) - (a.diasDeAtraso || 0)
      || (b.diasEmAberto || 0) - (a.diasEmAberto || 0)
      || String(a.cliente || '').localeCompare(String(b.cliente || ''), 'pt-BR')
    );

    return json({
      acoes: linhas,
      resumo: {
        total: linhas.length,
        atrasadas: linhas.filter((a) => a.atrasada).length,
        semResponsavel: linhas.filter((a) => !a.quem).length,
        semPrazo: linhas.filter((a) => !a.quando).length,
        semAnotacao: linhas.filter((a) => a.completude === 0).length,
        times: new Set(linhas.map((a) => a.time).filter(Boolean)).size,
        carteiras: porCarteira.size,
        clientes: new Set(linhas.map((a) => a.clienteErpId)).size
      },
      janelaDesde: desde,
      avisos,
      // Se a janela cortou páginas do hub, a tela precisa dizer que a
      // lista pode estar incompleta em vez de deixar sumir ação.
      truncado
    }, 200, cabecalhos);

  } catch (e) {
    return erroDoHub(e, cabecalhos);
  }
}

/* ==========================================================================
   PUT — a CX preenche os quatro campos que a ata não tem
   ========================================================================== */

const texto = (v, limite = 2000) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, limite) : null;
};

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);

  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const carteira = searchParams.get('carteira');
  const numero = Number(searchParams.get('acao'));

  if (!carteira || !Number.isInteger(numero) || numero <= 0) {
    return json({
      error: 'Informe a carteira e o número da ação.',
      code: 'CHAVE_OBRIGATORIA'
    }, 400, cabecalhos);
  }

  // A linha já existe: foi criada quando a ação recebeu o número do
  // cliente, na primeira leitura do plano. Se não existir, a ação nunca
  // foi vista — anotar antes disso gravaria um 5W2H órfão, sem número e
  // sem cliente.
  const existente = await db
    .prepare('SELECT id FROM acoes_cx WHERE carteira_erp_id = ? AND acao_numero = ?')
    .bind(carteira, numero)
    .first();

  if (!existente) {
    return json({
      error: 'Esta ação ainda não foi vista pelo CRM. Abra o Plano de Ação para que ela seja numerada antes de anotar.',
      code: 'ACAO_NAO_NUMERADA'
    }, 404, cabecalhos);
  }

  let corpo = {};
  try { corpo = await context.request.json(); }
  catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400, cabecalhos); }

  const dados = {
    porque: texto(corpo.porque),
    onde: texto(corpo.onde),
    como: texto(corpo.como),
    quanto: texto(corpo.quanto),
    observacoes: texto(corpo.observacoes, 4000),
    // Guardado para a tela perceber depois que a ata mudou de texto.
    descricao_vista: texto(corpo.descricao_vista, 1000)
  };

  const agora = new Date().toISOString();
  const campos = Object.keys(dados);

  try {
    // Uma anotação por ação da carteira: o UNIQUE garante, e o
    // ON CONFLICT transforma "criar ou atualizar" numa escrita só, sem a
    // corrida entre ler e gravar.
    // UPDATE e não upsert: a linha nasce na numeração, não aqui. O que
    // este endpoint escreve são só os campos que a CX preenche — o
    // `numero_cliente` nunca é tocado, sob pena de o identificador mudar
    // de significado.
    const registro = await db
      .prepare(
        `UPDATE acoes_cx
            SET ${campos.map((c) => `${c} = ?`).join(', ')},
                atualizado_por = ?, atualizado_em = ?
          WHERE carteira_erp_id = ? AND acao_numero = ?
      RETURNING *`
      )
      .bind(...campos.map((c) => dados[c]), usuario.email, agora, carteira, numero)
      .first();

    return json({ ok: true, anotacao: registro }, 200, cabecalhos);

  } catch (e) {
    return json({ error: 'Falha ao salvar a anotação.', details: e.message }, 500, cabecalhos);
  }
}
