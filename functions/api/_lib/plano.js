/**
 * _lib/plano.js — como a ata vira linha gravada do plano de ação.
 *
 * Desde a 2.25.0 o plano é GRAVADO no CRM (migração 012). A carga lê só
 * as reuniões novas desde a última vez, e cada ação lida é mesclada com
 * o que já está gravado. Tudo aqui é função pura: recebe o que está no
 * banco e o que veio do hub, devolve o que gravar e o que registrar no
 * log. Quem fala com o banco é o `plano-acao.js`.
 *
 * A REGRA DE QUEM VENCE
 *
 * Cada campo que vem da ata tem uma sombra (`descricao_ata`,
 * `status_ata`…) com o que a última ata dizia. Na ata seguinte:
 *
 *   - diz o mesmo que a sombra → a ata não mudou nada; vale o que está
 *     gravado, inclusive a edição da CX;
 *   - diz outra coisa → alguém mudou na reunião; a ata vence.
 *
 * Vence a alteração mais recente, de qualquer lado. Sem a sombra, a
 * carga da semana seguinte desfaria toda edição da CX.
 *
 * Uma exceção: ação que a CX fechou (concluída ou cancelada) e depois
 * SAIU da ata continua como a CX fechou. Sair da ata é o jeito de o
 * manual v2.3 dizer "encerrada", e a CX já disse como.
 */

import { lerAta, diasDesde } from './ata.js';

export const SAIU_DA_ATA = 'saiu_da_ata';

/** Os campos que nascem da ata. Editáveis desde a 2.25.0. */
export const CAMPOS_DA_ATA = ['descricao', 'responsavel', 'prazo', 'data_prevista', 'status'];

/** Os que só a CX escreve — a ata não os tem. */
export const CAMPOS_DA_CX = ['porque', 'onde', 'como', 'quanto', 'observacoes'];

export const CAMPOS_EDITAVEIS = [...CAMPOS_DA_ATA, ...CAMPOS_DA_CX];

/** O que a CX pode escolher. `saiu_da_ata` só a carga põe. */
export const STATUS_EDITAVEIS = [
  'nova', 'pendente', 'em_andamento', 'repactuado', 'concluida', 'cancelada'
];

export const STATUS_FECHADOS = ['concluida', 'cancelada', SAIU_DA_ATA];

/** As colunas que a carga escreve, na ordem dos INSERT/UPDATE. */
export const COLUNAS_DA_CARGA = [
  'cliente_nome', 'tipo_reuniao', 'tipo_reuniao_erp_id', 'time_nome', 'time_erp_id',
  'reuniao_erp_id', 'reuniao_nid', 'reuniao_em', 'primeira_ata_em',
  ...CAMPOS_DA_ATA, 'status_bruto', 'status_desde',
  ...CAMPOS_DA_ATA.map((c) => `${c}_ata`),
  'saiu_da_ata_em'
];

const nulo = (v) => (v === undefined || v === '' ? null : v);

export const chaveDaAcao = (carteira, numero) => `${carteira}::${numero}`;

/** O que a ata diz de uma ação, nos nomes das colunas. */
export function valoresDaAta(acao) {
  return {
    descricao: nulo(acao.descricao),
    responsavel: nulo(acao.responsavel),
    prazo: nulo(acao.prazoBruto),
    data_prevista: nulo(acao.prazo),
    status: nulo(acao.statusTipo) || 'desconhecido',
    status_bruto: nulo(acao.status?.bruto),
    status_desde: nulo(acao.statusDesde)
  };
}

/**
 * Mescla o que a ata diz com o que está gravado.
 *
 * @param atual  a linha do banco, ou null se a ação é nova
 * @param ata    `valoresDaAta(...)`, ou as sombras com status SAIU_DA_ATA
 * @returns { linha, mudancas, nova } — `linha` só com os CAMPOS_DA_ATA,
 *          as sombras e o status_bruto/desde; `mudancas` vai para o log.
 */
export function mesclar(atual, ata) {
  const linha = {};
  const mudancas = [];

  // Linha criada pela 010 (só a numeração) não tem sombra nenhuma: a CX
  // nunca pôde editar esses campos, então é como se fosse nova.
  const nova = !atual || CAMPOS_DA_ATA.every((c) => nulo(atual[`${c}_ata`]) == null);

  for (const c of CAMPOS_DA_ATA) {
    const daAta = nulo(ata[c]);
    linha[`${c}_ata`] = daAta;

    if (nova) { linha[c] = daAta; continue; }

    const sombra = nulo(atual[`${c}_ata`]);
    const gravado = nulo(atual[c]);

    // A ata não mudou este campo: vale o que está gravado.
    if (daAta === sombra) { linha[c] = gravado; continue; }

    if (c === 'status' && daAta === SAIU_DA_ATA
        && ['concluida', 'cancelada'].includes(gravado)) {
      linha[c] = gravado;
      continue;
    }

    linha[c] = daAta;
    if (gravado !== daAta) mudancas.push({ campo: c, de: gravado, para: daAta });
  }

  // O texto e a data do status acompanham o status que ficou valendo:
  // se a CX mudou o status e a ata não, o "desde" é o da CX.
  const statusDaAtaVale = linha.status === linha.status_ata;
  linha.status_bruto = statusDaAtaVale ? nulo(ata.status_bruto) : nulo(atual?.status_bruto);
  linha.status_desde = statusDaAtaVale ? nulo(ata.status_desde) : nulo(atual?.status_desde);

  if (nova) mudancas.push({ campo: 'criada', de: null, para: linha.descricao });

  return { linha, mudancas, nova };
}

/**
 * Aplica um lote de reuniões ao que está gravado.
 *
 * @param gravadas     todas as linhas de acoes_cx
 * @param aplicadas    Map carteira → { reuniao_em } da última reunião já aplicada
 * @param reunioes     do hub, com `ata`
 * @param contexto     { carteiraDe, nomeDoCliente, tiposDeReuniao, times }
 *
 * @returns {
 *   novas, alteradas  — linhas completas; alteradas levam `versao_lida`
 *   logs              — { carteira_erp_id, acao_numero, campo, de, para, reuniao_nid }
 *   carteiras         — { carteira_erp_id, reuniao_erp_id, reuniao_em }
 *   avisos, semCarteira
 * }
 */
export function aplicarReunioes(gravadas, aplicadas, reunioes, contexto) {
  const { carteiraDe, nomeDoCliente, tiposDeReuniao, times } = contexto;

  // O estado de trabalho: começa no banco e acumula as reuniões do lote,
  // da mais velha para a mais nova.
  const porChave = new Map();
  const originais = new Map();
  const proximo = new Map();

  for (const g of gravadas) {
    const k = chaveDaAcao(g.carteira_erp_id, g.acao_numero);
    porChave.set(k, { ...g });
    originais.set(k, g);
    proximo.set(g.cliente_erp_id, Math.max(proximo.get(g.cliente_erp_id) || 1, g.numero_cliente + 1));
  }

  const logs = [];
  const avisos = [];
  const carteirasAplicadas = new Map();
  let semCarteira = 0;

  /* ---- agrupa por carteira ---- */
  const grupos = new Map();
  for (const r of reunioes) {
    if (!r.ata) continue;
    const carteira = carteiraDe.get(`${r.clienteErpId}::${r.nucleoErpId}`);
    if (!carteira) { semCarteira++; continue; }
    if (!grupos.has(carteira.erp_id)) grupos.set(carteira.erp_id, []);
    grupos.get(carteira.erp_id).push(r);
  }

  for (const [carteiraId, lista] of grupos) {
    lista.sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));

    for (const r of lista) {
      // Ata mais velha que a última já aplicada: relê-la desfaria o que a
      // nova disse. Igual passa — é a mesma reunião, relida pela folga.
      const ja = carteirasAplicadas.get(carteiraId) || aplicadas.get(carteiraId);
      if (ja && String(r.inicio) < String(ja.reuniao_em)) continue;

      const lida = lerAta(r.ata);
      const cliente = nomeDoCliente.get(r.clienteErpId) || lida.cabecalho.cliente || null;
      const tipo = tiposDeReuniao.get(r.nucleoErpId);

      lida.avisos.forEach((a) => avisos.push({ reuniao: r.erp_nid, cliente, aviso: a }));

      const meta = {
        cliente_nome: cliente,
        tipo_reuniao: tipo?.nome || lida.cabecalho.nucleo || null,
        tipo_reuniao_erp_id: r.nucleoErpId || null,
        time_nome: times.get(tipo?.timeErpId)?.nome || null,
        time_erp_id: tipo?.timeErpId || null,
        reuniao_erp_id: r.erp_id,
        reuniao_nid: r.erp_nid ?? null,
        reuniao_em: r.inicio
      };

      const vistas = new Set();

      for (const acao of lida.acoes) {
        const k = chaveDaAcao(carteiraId, acao.id);
        vistas.add(k);

        const atual = porChave.get(k) || null;
        const { linha, mudancas } = mesclar(atual, valoresDaAta(acao));

        let numero = atual?.numero_cliente;
        if (numero == null) {
          numero = proximo.get(r.clienteErpId) || 1;
          proximo.set(r.clienteErpId, numero + 1);
        }

        porChave.set(k, {
          ...(atual || {}),
          cliente_erp_id: r.clienteErpId,
          carteira_erp_id: carteiraId,
          acao_numero: acao.id,
          numero_cliente: numero,
          ...meta,
          ...linha,
          primeira_ata_em: atual?.primeira_ata_em || r.inicio,
          saiu_da_ata_em: null
        });

        mudancas.forEach((m) => logs.push({
          carteira_erp_id: carteiraId, acao_numero: acao.id, reuniao_nid: r.erp_nid ?? null, ...m
        }));
      }

      // Ata sem nenhuma ação lida é mais provável ata fora do manual do
      // que um plano inteiro encerrado de uma vez. Não encerra nada.
      if (lida.acoes.length === 0) {
        avisos.push({ reuniao: r.erp_nid, cliente, aviso: 'Nenhuma ação lida nesta ata; as ações abertas da carteira foram mantidas.' });
      } else {
        // O que estava aberto nesta carteira e não veio na ata nova saiu
        // do plano — concluída ou cancelada, diz o manual v2.3.
        for (const [k, linhaAtual] of porChave) {
          if (linhaAtual.carteira_erp_id !== carteiraId || vistas.has(k)) continue;
          if (linhaAtual.saiu_da_ata_em) continue;
          if (nulo(linhaAtual.status_ata) == null) continue;   // nunca veio de ata

          const sombras = Object.fromEntries(CAMPOS_DA_ATA.map((c) => [c, linhaAtual[`${c}_ata`]]));
          const { linha, mudancas } = mesclar(linhaAtual, {
            ...sombras, status: SAIU_DA_ATA, status_bruto: null, status_desde: String(r.inicio).slice(0, 10)
          });

          porChave.set(k, { ...linhaAtual, ...linha, saiu_da_ata_em: r.inicio });
          mudancas.forEach((m) => logs.push({
            carteira_erp_id: carteiraId, acao_numero: linhaAtual.acao_numero, reuniao_nid: r.erp_nid ?? null, ...m
          }));
        }
      }

      carteirasAplicadas.set(carteiraId, { reuniao_erp_id: r.erp_id, reuniao_em: r.inicio });
    }
  }

  /* ---- o que mudou de fato ---- */
  const novas = [];
  const alteradas = [];

  for (const [k, linha] of porChave) {
    const original = originais.get(k);
    if (!original) { novas.push(linha); continue; }

    const mudou = COLUNAS_DA_CARGA.some((c) => nulo(original[c]) !== nulo(linha[c]));
    if (mudou) alteradas.push({ ...linha, versao_lida: original.versao ?? null });
  }

  return {
    novas,
    alteradas,
    logs,
    carteiras: [...carteirasAplicadas].map(([carteira_erp_id, v]) => ({ carteira_erp_id, ...v })),
    avisos,
    semCarteira
  };
}

/**
 * A linha do banco no formato da tela, com o que se calcula na leitura.
 *
 * O atraso é calculado AGORA, não gravado: gravado, ficaria velho no
 * dia seguinte sem nenhuma ata nova.
 */
export function linhaParaTela(l, hoje = new Date()) {
  const aberta = !STATUS_FECHADOS.includes(l.status);
  const atraso = aberta && l.data_prevista ? diasDesde(l.data_prevista, hoje) : null;

  return {
    id: l.id,
    carteiraErpId: l.carteira_erp_id,
    numero: l.acao_numero,
    numeroCliente: l.numero_cliente,
    clienteErpId: l.cliente_erp_id,
    cliente: l.cliente_nome,
    tipoReuniao: l.tipo_reuniao,
    nucleo: l.time_nome,

    descricao: l.descricao,
    responsavel: l.responsavel,
    prazo: l.prazo,
    dataPrevista: l.data_prevista,
    status: l.status,
    statusBruto: l.status_bruto,
    statusDesde: l.status_desde,

    porque: l.porque,
    onde: l.onde,
    como: l.como,
    quanto: l.quanto,
    observacoes: l.observacoes,

    reuniaoNid: l.reuniao_nid,
    reuniaoEm: l.reuniao_em,
    primeiraAtaEm: l.primeira_ata_em,
    saiuDaAtaEm: l.saiu_da_ata_em,

    versao: l.versao,
    atualizadoPor: l.atualizado_por,
    atualizadoEm: l.atualizado_em,

    aberta,
    diasDeAtraso: atraso != null && atraso > 0 ? atraso : null,
    atrasada: atraso != null && atraso > 0,
    diasEmAberto: aberta && l.status_desde ? diasDesde(l.status_desde, hoje) : null
  };
}

/**
 * Normaliza o valor que a CX digitou. Devolve { valor } ou { erro }.
 */
export function validarCampo(campo, valor) {
  if (!CAMPOS_EDITAVEIS.includes(campo)) return { erro: `O campo "${campo}" não se edita.` };

  if (valor == null) return { valor: null };
  const t = String(valor).trim();
  if (!t) return { valor: null };

  if (campo === 'status') {
    return STATUS_EDITAVEIS.includes(t) ? { valor: t } : { erro: `Status inválido: ${t}.` };
  }

  if (campo === 'data_prevista') {
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = m ? new Date(`${t}T00:00:00Z`) : null;
    if (!d || Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) {
      return { erro: 'Data prevista inválida.' };
    }
    return { valor: t };
  }

  const limite = campo === 'observacoes' ? 4000 : 2000;
  return { valor: t.slice(0, limite) };
}
