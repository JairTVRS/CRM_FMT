/**
 * _lib/contrato.js — o que o contrato precisa, e de onde vem (Lote G, 2.40.0).
 *
 * Decidido com o Jair em 05/10/2026:
 *   - o modelo é padrão: o app monta o texto, não há arquivo de Word;
 *   - os dados do cliente vêm do LEAD (razão social, CNPJ, endereço e
 *     quem assina), e o km também — é negociado por lead;
 *   - o ESCOPO e os valores vêm da última PROPOSTA gerada;
 *   - a forma de preço é a escolhida no lead (cadastro do admin);
 *   - a contratada é a escolhida no lead, ou a padrão (Formatar
 *     Consultoria Empresarial Ltda).
 *
 * `prepararContrato` é pura: recebe o que o banco devolveu e diz o que
 * falta. A tela mostra a mesma lista ANTES de alguém clicar em Gerar.
 */

import { preencherForma, marcadoresUsados } from './forma-preco.js';
import { SERVICOS } from './proposta-template.js';

/** R$ 1,75 por km: o da proposta em uso desde 2026. Vale quando o lead não diz. */
export const KM_PADRAO = 175;

export const ESTADOS_CIVIS = ['solteiro(a)', 'casado(a)', 'divorciado(a)', 'viúvo(a)', 'separado(a)', 'em união estável'];

/** `representantes` é JSON no banco; quem usa recebe a lista. */
export function lerContratada(linha) {
  if (!linha) return null;
  let representantes = [];
  try { representantes = JSON.parse(linha.representantes || '[]'); } catch (e) { representantes = []; }
  return { ...linha, representantes: Array.isArray(representantes) ? representantes : [] };
}

/** A data de hoje em Brasília, AAAA-MM-DD. */
export function hojeEmBrasilia(agora = new Date()) {
  return new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

const inteiro = (v) => {
  const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {object} p
 * @param {object} p.lead        a linha de `leads`
 * @param {object} p.proposta    { versao, gerado_em, dados } da última proposta, ou null
 * @param {object} p.forma       a linha de `formas_preco`, ou null
 * @param {object} p.contratada  a contratada (já com `representantes` lido), ou null
 * @param {string} p.hoje        AAAA-MM-DD
 * @returns {{ dados: object|null, faltando: string[] }}
 */
export function prepararContrato({ lead, proposta, forma, contratada, hoje }) {
  const faltando = [];
  const l = lead || {};
  const doc = String(l.documento || '').replace(/\D/g, '');
  const pessoaFisica = doc.length === 11;

  // --- O cliente, do lead ---
  if (!l.nome) faltando.push('Nome / razão social do cliente (aba Dados Gerais).');
  if (!doc) faltando.push('CNPJ ou CPF do cliente (Dados do cliente, nesta aba).');
  if (!l.endereco) faltando.push('Logradouro / número do cliente (Dados do cliente, nesta aba).');
  if (!l.cidade) faltando.push('Cidade / UF do cliente (Dados do cliente, nesta aba).');
  if (!pessoaFisica) {
    if (!l.rep_nome) faltando.push('Quem assina pelo cliente: nome (nesta aba).');
    if (!l.rep_cpf) faltando.push('Quem assina pelo cliente: CPF (nesta aba).');
  }

  // --- A proposta: escopo e valores ---
  const p = proposta?.dados || null;
  if (!p) {
    faltando.push('Uma proposta gerada: o escopo e os valores do contrato saem dela (bloco Proposta, nesta aba: "Gerar proposta agora").');
  } else if (!Array.isArray(p.escopo) || !p.escopo.length) {
    faltando.push(`A proposta v${proposta.versao} não tem escopo: marque os serviços no bloco Proposta e gere de novo.`);
  }

  // --- A forma de preço ---
  let preco = null;
  if (!forma) {
    faltando.push('A forma de preço (nesta aba).');
  } else if (p) {
    preco = preencherForma(forma.texto, p);
    for (const f of preco.faltando) {
      faltando.push(`A forma "${forma.nome}" usa "${f}", que a proposta v${proposta.versao} não tem: preencha no bloco Proposta e gere uma nova versão.`);
    }
  }

  // --- A contratada ---
  if (!contratada) {
    faltando.push('A empresa contratada: cadastre uma nas Configurações.');
  } else if (!contratada.representantes?.length) {
    faltando.push(`Quem assina pela contratada (${contratada.razao_social}): cadastre em Configurações → Empresas contratadas.`);
  }

  if (faltando.length) return { dados: null, faltando };

  // Vigência: os meses da consultoria, ou as parcelas do projeto — o que
  // a forma de preço usa. Sem nenhum dos dois, até concluir os trabalhos.
  // Ler `meses` sempre seria errado: a proposta nasce com "24" e uma forma
  // "Só diagnóstico" sairia com vigência de 24 meses.
  const usados = marcadoresUsados(forma.texto);
  const vigencia = usados.includes('meses') ? inteiro(p.consultoria?.meses)
    : (usados.includes('parcelas') ? inteiro(p.projeto?.parcelas) : null);

  const ordem = Object.keys(SERVICOS);
  const dados = {
    data: hoje,
    contratante: {
      nome: l.nome,
      documento: doc,
      pessoaFisica,
      endereco: l.endereco,
      cidade: l.cidade,
      cep: String(l.cep || '').replace(/\D/g, '') || null,
      representante: {
        nome: pessoaFisica ? l.nome : l.rep_nome,
        cpf: pessoaFisica ? doc : String(l.rep_cpf || '').replace(/\D/g, ''),
        nacionalidade: l.rep_nacionalidade || null,
        estado_civil: l.rep_estado_civil || null,
        profissao: l.rep_profissao || null,
        residencia: l.rep_residencia || null
      }
    },
    contratada: {
      id: contratada.id,
      razao_social: contratada.razao_social,
      cnpj: contratada.cnpj,
      endereco: contratada.endereco,
      cidade: contratada.cidade,
      cep: contratada.cep,
      representantes: contratada.representantes
    },
    proposta: { versao: proposta.versao, gerado_em: proposta.gerado_em, elaboradoEm: p.elaboradoEm || null },
    escopo: [...p.escopo].filter((k) => SERVICOS[k]).sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b)),
    forma: { id: forma.id, nome: forma.nome, texto: forma.texto },
    preco: preco.paragrafos,
    km: Number(l.km_valor) > 0 ? Number(l.km_valor) : KM_PADRAO,
    vigenciaMeses: vigencia
  };
  return { dados, faltando: [] };
}
