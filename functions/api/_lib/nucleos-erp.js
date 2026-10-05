/**
 * _lib/nucleos-erp.js — os núcleos de cada cliente, pelas carteiras do
 * ERP (2.44.0, última entrega da Fase 3 da 2.24.0).
 *
 * Decidido com o Jair em 05/10/2026: núcleo do cliente = CARTEIRA ATIVA
 * no ERP. A carteira é cliente + tipo de reunião; o tipo pertence a um
 * Time (Gestão Comercial, de Operações, Financeira, de Pessoas,
 * Governança), e é o Time que a tela chama de núcleo — o mesmo das
 * pessoas (aba Stakeholders) e do Dossiê de Experiência.
 *
 * Substitui o campo "Núcleos atendidos" marcado à mão na ficha, que sai
 * da tela (a coluna `clientes.nucleos` fica no banco, sem uso).
 *
 * Uma consulta para TODOS os clientes (as carteiras ativas, os tipos e os
 * times), guardada por 10 minutos: a lista da Jornada e o filtro por
 * núcleo leem daqui sem uma ida ao ERP por cliente.
 */

import { listarCarteiras, mapaDeTiposDeReuniao, mapaDeTimes, memorizar } from './hub.js';

const DEZ_MINUTOS = 10 * 60 * 1000;

/**
 * @returns {Promise<{consultado: boolean, motivo?: string,
 *   porCliente: Map<string, Array<{id: string, nome: string}>>,
 *   nucleos: Array<{id: string, nome: string}>, truncado?: boolean}>}
 *   `porCliente`: erp_id do cliente → os núcleos dele, por nome.
 */
export async function nucleosDasCarteiras(env) {
  try {
    return await memorizar('nucleos-das-carteiras', DEZ_MINUTOS, async () => {
      const [{ carteiras, truncado }, tipos, times] = await Promise.all([
        listarCarteiras(env, { ativas: true }),
        mapaDeTiposDeReuniao(env),
        mapaDeTimes(env)
      ]);

      const porCliente = new Map();
      const todos = new Map();
      for (const c of carteiras) {
        if (!c.ativa || !c.clienteErpId || !c.nucleoErpId) continue;
        const timeId = tipos.get(c.nucleoErpId)?.timeErpId;
        const nome = timeId ? times.get(timeId)?.nome : null;
        if (!nome) continue;                 // tipo sem time: não há núcleo para nomear
        const lista = porCliente.get(c.clienteErpId) || [];
        if (!lista.some((n) => n.id === timeId)) lista.push({ id: timeId, nome });
        porCliente.set(c.clienteErpId, lista);
        todos.set(timeId, nome);
      }
      const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
      for (const lista of porCliente.values()) lista.sort(porNome);

      return {
        consultado: true,
        porCliente,
        nucleos: [...todos].map(([id, nome]) => ({ id, nome })).sort(porNome),
        truncado: !!truncado
      };
    });
  } catch (e) {
    // Falha não fica memorizada (memorizar só guarda sucesso): a próxima
    // tela tenta de novo.
    return { consultado: false, motivo: e.message, porCliente: new Map(), nucleos: [] };
  }
}

/** Os erp_id dos clientes que têm o núcleo (Time) informado. */
export function clientesDoNucleo(resultado, nucleoId) {
  const ids = [];
  for (const [cliente, lista] of resultado.porCliente) {
    if (lista.some((n) => n.id === nucleoId)) ids.push(cliente);
  }
  return ids;
}
