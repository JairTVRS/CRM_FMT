/**
 * _lib/questionario-bio.js — o questionário da página BIO (2.46.0).
 *
 * Pedido do Jair em 26/11/2026: os botões "Vamos conversar" e "Falar com
 * um especialista" da /bio abrem um questionário; quem responde entra no
 * funil de vendas.
 *
 * Decidido com ele:
 *   - as 5 perguntas da print (q01 a q05), mais nome e WhatsApp
 *     obrigatórios, CNPJ/CPF e e-mail opcionais;
 *   - o lead entra em "Novo Lead" (a 1ª etapa comercial), SEM responsável,
 *     canal "BIO (questionário)" — como os prospects do ERP;
 *   - depois de enviar, a página só agradece (não abre o WhatsApp);
 *   - o desafio escolhido na página vem junto, quando houver.
 *
 * As perguntas vivem SÓ aqui: a página as recebe de GET /publico/bio, e a
 * gravação (POST /publico/questionario) confere cada resposta contra esta
 * mesma lista. Resposta fora da lista não entra.
 */

import { documentoValido, soDigitos } from './documento.js';

export const CANAL_BIO = 'BIO (questionário)';
export const AUTOR_BIO = 'questionario-bio@crm';

const AUTONOMO = 'Profissional autônomo';
const SO_EU_PESSOAS = 'Apenas eu';
const SO_EU_DECISAO = 'Somente eu (exclusiva)';

/**
 * `rotulo` é como a resposta aparece nas observações e no histórico do lead.
 * `seAutonomo` (q02): não aparece para o autônomo e é preenchida sozinha.
 * `exclusiva` (q05): marcar esta desmarca as outras.
 */
export const PERGUNTAS = [
  {
    id: 'q01', tipo: 'unica', rotulo: 'Papel na empresa',
    titulo: 'Qual é o seu papel na empresa?',
    opcoes: ['Dono, sócio ou CEO', 'Diretor de área', 'Gerente ou coordenador',
      'Analista ou colaborador', AUTONOMO, 'Outro']
  },
  {
    id: 'q02', tipo: 'unica', rotulo: 'Pessoas na empresa',
    titulo: 'Quantas pessoas trabalham na empresa, contando você e os sócios?',
    seAutonomo: SO_EU_PESSOAS,
    opcoes: [SO_EU_PESSOAS, '2 a 5 pessoas', '6 a 10 pessoas', '11 a 20 pessoas',
      '21 a 50 pessoas', '51 a 100 pessoas', 'Mais de 100 pessoas']
  },
  {
    id: 'q03', tipo: 'unica', rotulo: 'Faturamento médio mensal',
    titulo: 'Qual é o faturamento médio mensal da empresa?',
    ajuda: 'Uma estimativa já ajuda. Cada faixa inclui o valor máximo. Você pode preferir não informar.',
    opcoes: ['Ainda não faturamos', 'Até R$ 30 mil', 'De R$ 30 a 100 mil', 'De R$ 100 a 300 mil',
      'De R$ 300 a 500 mil', 'De R$ 500 mil a 1 milhão', 'De R$ 1 a 3 milhões',
      'De R$ 3 a 10 milhões', 'Acima de R$ 10 milhões', 'Prefiro não informar']
  },
  {
    id: 'q04', tipo: 'unica', rotulo: 'Momento',
    titulo: 'Em que momento você está em relação a resolver os principais desafios da empresa?',
    opcoes: ['Estou apenas pesquisando', 'Quero entender as alternativas',
      'Já decidi resolver', 'Preciso agir com urgência']
  },
  {
    id: 'q05', tipo: 'multipla', rotulo: 'Quem participa da decisão',
    titulo: 'Quem participa da decisão de contratar uma solução para esses desafios?',
    exclusiva: SO_EU_DECISAO,
    opcoes: [SO_EU_DECISAO, 'Outros sócios', 'Diretoria', 'Conselho', 'Departamento financeiro',
      'Consultor ou contador externo', 'Outra pessoa ou área']
  }
];

/** As respostas da pergunta do desafio da página (BIO.desafio em public/bio.html). */
export const DESAFIOS = {
  'Gestão e resultados': 'Consultoria e Assessoria',
  'Família, sócios e sucessão': 'Famílias, sociedade e governança',
  'Avaliar ou expandir': 'Serviços técnicos e especializados',
  'Ainda não sei': 'Uma conversa com o nosso time'
};

/** Abaixo disso, quem preencheu foi um robô (ms entre abrir e enviar). */
export const TEMPO_MINIMO_MS = 3000;
/** Envios por aparelho (IP) numa hora. */
export const LIMITE_POR_HORA = 5;

const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** "(37) 99956-4071" a partir de 10 ou 11 dígitos (sem o 55). */
export function formatarTelefone(digitos) {
  const d = digitos;
  return d.length === 11
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

/**
 * Confere o envio inteiro. Não grava nada.
 *
 * @returns { erro, campo? } ou { dados: { nome, telefone, email, documento,
 *          respostas: [{ id, rotulo, valor: string[] }], desafio, frente } }
 */
export function validarQuestionario(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};

  const nome = texto(c.nome, 120);
  if (nome.length < 2) return { erro: 'Informe o seu nome.', campo: 'nome' };

  let tel = soDigitos(c.telefone);
  if (tel.length > 11 && tel.startsWith('55')) tel = tel.slice(2);
  if (tel.length !== 10 && tel.length !== 11) {
    return { erro: 'Informe o WhatsApp com DDD, por exemplo (37) 99999-9999.', campo: 'telefone' };
  }

  const email = texto(c.email, 160).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { erro: 'Confira o e-mail, ou deixe o campo em branco.', campo: 'email' };
  }

  const doc = soDigitos(c.documento);
  if (doc && !documentoValido(doc)) {
    return { erro: 'Confira o CNPJ ou CPF, ou deixe o campo em branco.', campo: 'documento' };
  }

  if (c.consentimento !== true) {
    return { erro: 'Para enviar, autorize a Formatar a usar estes dados para falar com você.', campo: 'consentimento' };
  }

  const r = c.respostas && typeof c.respostas === 'object' ? c.respostas : {};
  const autonomo = r.q01 === AUTONOMO;
  const respostas = [];

  for (const p of PERGUNTAS) {
    if (p.seAutonomo && autonomo) {
      respostas.push({ id: p.id, rotulo: p.rotulo, valor: [p.seAutonomo] });
      continue;
    }
    if (p.tipo === 'unica') {
      if (!p.opcoes.includes(r[p.id])) return { erro: `Responda: ${p.titulo}`, campo: p.id };
      respostas.push({ id: p.id, rotulo: p.rotulo, valor: [r[p.id]] });
    } else {
      const marcadas = Array.isArray(r[p.id]) ? [...new Set(r[p.id])] : [];
      if (!marcadas.length || marcadas.some((v) => !p.opcoes.includes(v))) {
        return { erro: `Responda: ${p.titulo}`, campo: p.id };
      }
      if (p.exclusiva && marcadas.includes(p.exclusiva) && marcadas.length > 1) {
        return { erro: `"${p.exclusiva}" não combina com as outras opções.`, campo: p.id };
      }
      // Na ordem da lista, não na ordem do clique.
      respostas.push({ id: p.id, rotulo: p.rotulo, valor: p.opcoes.filter((o) => marcadas.includes(o)) });
    }
  }

  const desafio = Object.prototype.hasOwnProperty.call(DESAFIOS, c.desafio) ? c.desafio : null;

  return {
    dados: {
      nome,
      telefone: formatarTelefone(tel),
      email: email || null,
      documento: doc || null,
      respostas,
      desafio,
      frente: desafio ? DESAFIOS[desafio] : null
    }
  };
}

/** As linhas "Rótulo: resposta" — para as observações e o histórico. */
export function linhasDasRespostas(dados) {
  const linhas = dados.respostas.map((r) => `${r.rotulo}: ${r.valor.join(', ')}`);
  if (dados.desafio) linhas.push(`Desafio escolhido na página: ${dados.desafio} (${dados.frente})`);
  return linhas;
}

/** O texto que vai para as observações do lead novo. */
export function observacoesDoLead(dados, quando) {
  return [`Questionário da BIO (${quando})`, ...linhasDasRespostas(dados)].join('\n');
}

/** As perguntas como a página precisa (sem nada interno). */
export function perguntasParaPagina() {
  return PERGUNTAS.map((p) => ({
    id: p.id, tipo: p.tipo, titulo: p.titulo, ajuda: p.ajuda || null, opcoes: p.opcoes,
    seAutonomo: p.seAutonomo ? { pergunta: 'q01', resposta: AUTONOMO, valor: p.seAutonomo } : null,
    exclusiva: p.exclusiva || null
  }));
}

/** SHA-256 do IP com sal: limita envios sem guardar o IP (LGPD). */
export async function hashDoIp(ip, sal) {
  const bytes = new TextEncoder().encode(`${sal}|${ip || 'sem-ip'}`);
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
