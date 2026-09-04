/**
 * quadro.js — monta um quadro kanban a partir de qualquer tabela que
 * tenha `etapa_id` e `posicao`.
 *
 * Nasceu dentro do leads.js no Lote C e saiu daqui no Lote H, quando a
 * jornada do cliente virou o segundo consumidor. A extração não é
 * cosmética: a regra "registro sem etapa cai na primeira coluna" e o
 * teto por coluna precisam valer igual nas duas trilhas, e duas cópias
 * divergiriam na primeira manutenção — exatamente como o filtro único
 * que o Lote C já obriga entre a tabela e o quadro.
 *
 * As duas consultas (totais e cartões) são propositalmente separadas: o
 * total do cabeçalho conta TUDO, enquanto os cartões saem cortados por
 * ROW_NUMBER() particionado pela etapa. É o corte no banco que impede
 * uma coluna de centenas de registros de trafegar inteira só para o
 * navegador jogar fora o excedente.
 */

const TETO_ABSOLUTO = 200;

/**
 * @param db            binding do D1
 * @param tabela        'leads' ou 'clientes' — vem de constante no
 *                      código chamador, nunca do usuário
 * @param pipeline      qual conjunto de etapas usar
 * @param onde/valores  o WHERE já montado pelo filtro da tela
 * @param somaColuna    coluna a somar no cabeçalho, ou null quando a
 *                      trilha não tem dinheiro para somar
 * @param porColuna     teto de cartões por coluna
 */
export async function montarQuadro(db, {
  tabela,
  pipeline = 'comercial',
  onde,
  valores = [],
  somaColuna = null,
  porColuna = 50
}) {
  const teto = Math.min(TETO_ABSOLUTO, Math.max(1, Number(porColuna) || 50));

  // COALESCE em vez de omitir a coluna: manter o mesmo formato de
  // resposta nas duas trilhas evita um `if` na tela para cada campo.
  const soma = somaColuna ? `COALESCE(SUM(${somaColuna}), 0)` : '0';

  const [etapas, totais, cartoes] = await Promise.all([
    db.prepare(
      `SELECT id, nome, cor, ordem, encerra FROM etapas
       WHERE ativo = 1 AND pipeline = ? ORDER BY ordem`
    ).bind(pipeline).all(),

    db.prepare(
      `SELECT etapa_id, COUNT(*) AS n, ${soma} AS soma
       FROM ${tabela} ${onde} GROUP BY etapa_id`
    ).bind(...valores).all(),

    db.prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY etapa_id ORDER BY posicao, id DESC
         ) AS rn
         FROM ${tabela} ${onde}
       ) WHERE rn <= ?`
    ).bind(...valores, teto).all()
  ]);

  const listaEtapas = etapas.results || [];
  const primeira = listaEtapas[0]?.id ?? null;

  // Registro sem etapa cai na primeira coluna. Não deveria existir — a
  // criação sempre atribui uma e a exclusão de etapa em uso é bloqueada
  // —, mas um cartão invisível seria pior que um cartão no lugar errado.
  const daEtapa = (v) => (v == null ? primeira : v);

  const resumo = new Map();
  for (const t of totais.results || []) {
    const chave = daEtapa(t.etapa_id);
    const atual = resumo.get(chave) || { total: 0, soma: 0 };
    resumo.set(chave, {
      total: atual.total + Number(t.n || 0),
      soma: atual.soma + Number(t.soma || 0)
    });
  }

  const porEtapa = new Map();
  for (const registro of cartoes.results || []) {
    const chave = daEtapa(registro.etapa_id);
    if (!porEtapa.has(chave)) porEtapa.set(chave, []);
    porEtapa.get(chave).push(registro);
  }

  return {
    pipeline,
    porColuna: teto,
    colunas: listaEtapas.map((etapa) => {
      const r = resumo.get(etapa.id) || { total: 0, soma: 0 };
      return {
        etapa,
        total: r.total,
        soma: r.soma,          // centavos; a tela é que formata
        registros: porEtapa.get(etapa.id) || []
      };
    })
  };
}

/**
 * Comandos para gravar a soltura de um cartão.
 *
 * Só a coluna de DESTINO é regravada. A de origem fica com um buraco na
 * sequência de `posicao` — inofensivo, já que a ordenação é relativa, e
 * regravar as duas dobraria a escrita para nada.
 *
 * Os cartões que a tela não carregou vão para 100000, o fim da coluna.
 * Sem isso a reordenação só valeria dentro do teto: os visíveis
 * receberiam 0..n-1 e os demais continuariam em 0, embaralhando-se com
 * eles na leitura seguinte. "O que não coube na tela vem depois do que
 * você arrumou" é previsível; embaralhar em silêncio não é.
 */
export function comandosDeMover(db, { tabela, id, etapaId, ordem, usuario, agora }) {
  return [
    db.prepare(
      `UPDATE ${tabela} SET etapa_id = ?, atualizado_por = ?, atualizado_em = ?
       WHERE id = ? AND ativo = 1`
    ).bind(etapaId, usuario, agora, id),

    db.prepare(
      `UPDATE ${tabela} SET posicao = 100000
       WHERE etapa_id = ? AND ativo = 1
         AND id NOT IN (SELECT value FROM json_each(?))`
    ).bind(etapaId, JSON.stringify(ordem)),

    ...ordem.map((idRegistro, i) =>
      db.prepare(`UPDATE ${tabela} SET posicao = ? WHERE id = ? AND ativo = 1`).bind(i, idRegistro)
    )
  ];
}
