/**
 * _lib/diagnostico-pessoas.js — as pessoas dos clientes no ERP: o que
 * vem, e com que forma (2.42.0, primeira entrega da Fase 3 da 2.24.0).
 *
 * POR QUE EXISTE
 * A Fase 3 amarra a avaliação da CX (influência, postura…) ao contato do
 * ERP, e isso só funciona se cada contato tiver um código próprio e
 * fixo. Até 05/10/2026 isso nunca foi visto: a chave do hub só existe em
 * produção, a documentação descreve `contacts` como "objeto livre", e os
 * três Dossiês de Experiência gerados saíram sem pessoas — embora o ERP
 * mostre stakeholders no cadastro do cliente (print do Jair, 05/10).
 *
 * O QUE FAZ
 * Para cada cliente da amostra, pede ao ERP o campo `contacts`, o campo
 * `stakeholders` e a rota `/customers/{id}/stakeholders`, e DESCREVE o que
 * voltou: se existe, quantas pessoas, quais chaves cada pessoa traz e
 * quantas têm código. NUNCA devolve valores — nome, e-mail e telefone de
 * gente do cliente não saem daqui, só os NOMES dos campos.
 */

import { pedirAoHub, CAMPOS_CLIENTE, lerContatos, ErroHub } from './hub.js';

const tipoDe = (v) => (v === null ? 'nulo'
  : Array.isArray(v) ? 'lista'
  : typeof v === 'object' ? 'objeto'
  : typeof v === 'string' ? 'texto'
  : typeof v);

const temValor = (v) => !(v == null || v === '' || (Array.isArray(v) && v.length === 0));

/**
 * A forma de um valor, sem o valor. Para lista de objetos: as chaves de
 * cada item com quantos itens as preenchem, quantos têm `id`/`_id`, e as
 * subchaves dos campos que são objeto (ex.: `role: { id, name }`).
 */
export function descreverForma(valor) {
  if (valor === undefined) return { presente: false };
  const tipo = tipoDe(valor);
  if (tipo !== 'lista') {
    return { presente: true, tipo, ...(tipo === 'objeto' ? { chaves: Object.keys(valor).sort() } : {}) };
  }

  const itens = valor;
  const tiposDosItens = [...new Set(itens.map(tipoDe))];
  const chaves = {};
  const subchaves = {};
  let comId = 0;
  for (const item of itens) {
    if (tipoDe(item) !== 'objeto') continue;
    if (temValor(item.id) || temValor(item._id)) comId++;
    for (const [k, v] of Object.entries(item)) {
      chaves[k] = (chaves[k] || 0) + (temValor(v) ? 1 : 0);
      const t = tipoDe(v);
      if (t === 'objeto') subchaves[k] = [...new Set([...(subchaves[k] || []), ...Object.keys(v)])].sort();
      if (t === 'lista' && v.length && tipoDe(v[0]) === 'objeto') subchaves[k] = [...new Set([...(subchaves[k] || []), ...Object.keys(v[0])])].sort();
    }
  }
  return {
    presente: true,
    tipo: 'lista',
    quantidade: itens.length,
    tiposDosItens,
    comId,
    // chave → em quantos itens ela vem preenchida
    chaves,
    ...(Object.keys(subchaves).length ? { subchaves } : {})
  };
}

/** Uma tentativa no hub: ok com o corpo, ou o status e a mensagem do erro. */
async function tentar(env, caminho, parametros) {
  try {
    return { ok: true, corpo: await pedirAoHub(env, caminho, parametros) };
  } catch (e) {
    return {
      ok: false,
      status: e instanceof ErroHub ? e.status : null,
      codigo: e instanceof ErroHub ? e.codigo : null,
      mensagem: String(e.message || e).slice(0, 240)
    };
  }
}

const objetoDe = (corpo) => (Array.isArray(corpo?.data) ? corpo.data[0] : (corpo?.data || corpo)) || null;

/** As três perguntas sobre UM cliente. */
export async function diagnosticarCliente(env, erpId) {
  const viaCampo = async (campo) => {
    const r = await tentar(env, `/customers/${encodeURIComponent(erpId)}`, { fields: `${CAMPOS_CLIENTE},${campo}` });
    if (!r.ok) return { ok: false, status: r.status, codigo: r.codigo, mensagem: r.mensagem };
    const obj = objetoDe(r.corpo);
    const forma = descreverForma(obj?.[campo]);
    // O que o CRM ENTENDE hoje do que veio (o mesmo leitor do dossiê).
    const leitura = lerContatos({ contacts: obj?.[campo] });
    return {
      ok: true,
      clienteEncontrado: !!(obj && (obj.id || obj._id)),
      forma,
      oQueOCrmEntende: {
        formato: leitura.formato,
        pessoasComNome: leitura.contatos.filter((c) => c.nome).length,
        todasComCodigo: leitura.temIdEstavel,
        camposReconhecidos: leitura.chavesVistas
      }
    };
  };

  const [contacts, stakeholders] = await Promise.all([viaCampo('contacts'), viaCampo('stakeholders')]);
  const rota = await tentar(env, `/customers/${encodeURIComponent(erpId)}/stakeholders`, {});
  return {
    erpId,
    contacts,
    stakeholders,
    rotaStakeholders: rota.ok
      ? { ok: true, forma: descreverForma(Array.isArray(rota.corpo?.data) ? rota.corpo.data : rota.corpo) }
      : { ok: false, status: rota.status, codigo: rota.codigo, mensagem: rota.mensagem }
  };
}

/** O resumo da amostra: por caminho, quantos responderam, com quantas pessoas, com código. */
export function resumir(resultados) {
  const caminhos = ['contacts', 'stakeholders', 'rotaStakeholders'];
  const resumo = {};
  for (const c of caminhos) {
    const r = resultados.map((x) => x[c]);
    const ok = r.filter((x) => x?.ok);
    const comPessoas = ok.filter((x) => (x.forma?.quantidade || 0) > 0);
    const chaves = {};
    for (const x of ok) for (const [k, n] of Object.entries(x.forma?.chaves || {})) chaves[k] = (chaves[k] || 0) + n;
    resumo[c] = {
      responderam: ok.length,
      recusaram: r.length - ok.length,
      motivoDaRecusa: r.find((x) => x && !x.ok)?.mensagem || null,
      clientesComPessoas: comPessoas.length,
      pessoas: comPessoas.reduce((s, x) => s + x.forma.quantidade, 0),
      pessoasComCodigo: comPessoas.reduce((s, x) => s + (x.forma.comId || 0), 0),
      chaves
    };
  }
  return resumo;
}
