/**
 * _lib/lead-eventos.js — o histórico do lead (2.41.0).
 *
 * Pedido do Jair em 05/10/2026: um relógio na ficha do lead com as
 * alterações e as movimentações do cadastro — quem, data e horário, como
 * estava e como ficou.
 *
 * GRAVAR guarda o valor CRU do banco (id da etapa, centavos, e-mail).
 * LER traduz para o que a tela mostra, com os nomes de HOJE: uma etapa
 * renomeada aparece com o nome novo, mas o registro continua apontando
 * para a mesma etapa. Guardar o nome congelaria um rótulo; guardar o id
 * guarda o fato.
 *
 * O histórico NUNCA derruba a operação: se a gravação do evento falhar
 * (migração 028 ainda não aplicada, por exemplo), o lead é salvo e o erro
 * vai para o log.
 */

/** Como cada campo do lead aparece no histórico. Fora daqui, não entra. */
export const ROTULOS = {
  nome: 'Nome / razão social',
  documento: 'CNPJ / CPF',
  telefone: 'Telefone',
  observacoes: 'Observações internas',
  email: 'E-mail',
  contato_nome: 'Pessoa de contato',
  cep: 'CEP',
  cidade: 'Cidade / UF',
  endereco: 'Logradouro / número',
  site: 'Site',
  instagram: 'Instagram',
  ramo: 'Ramo',
  segmento: 'Segmento',
  resumo_ia: 'Resumo da IA',
  canal: 'Canal',
  classificacao: 'Classificação',
  atendente: 'Quem atendeu',
  advisor_id: 'Advisor',
  etapa_id: 'Etapa do funil',
  data_cadastro: 'Data de cadastro',
  data_ultimo_contato: 'Último contato',
  data_fechamento: 'Data de fechamento',
  valor_proposta: 'Valor da proposta',
  valor_diagnostico: 'Valor do diagnóstico',
  tags: 'Tags',
  responsavel: 'CX responsável',
  motivo_perda_id: 'Motivo da perda',
  motivo_perda_obs: 'Observação da perda',
  km_valor: 'Quilômetro rodado',
  forma_preco_id: 'Forma de preço',
  contratada_id: 'Empresa contratada',
  rep_nome: 'Quem assina: nome',
  rep_cpf: 'Quem assina: CPF',
  rep_nacionalidade: 'Quem assina: nacionalidade',
  rep_estado_civil: 'Quem assina: estado civil',
  rep_profissao: 'Quem assina: profissão',
  rep_residencia: 'Quem assina: reside em'
};

/** Texto longo demais para "de → para": só se registra que mudou. */
const SO_QUE_MUDOU = new Set(['resumo_ia']);

const vazio = (v) => v == null || v === '' || v === '[]';

/**
 * O resumo da IA volta da tela como `innerHTML`, que o navegador reescreve
 * (aspas, espaços, entidades): comparado como veio, todo salvamento
 * "mudaria" o resumo. Compara-se só o texto.
 */
const textoDoHtml = (h) => String(h)
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

function normal(campo, v) {
  if (vazio(v)) return null;
  if (campo === 'resumo_ia') return textoDoHtml(v) || null;
  if (campo === 'tags') {
    try { return JSON.stringify([...JSON.parse(v)].map(Number).sort((a, b) => a - b)); } catch (e) { return String(v); }
  }
  return String(v).trim();
}

/**
 * O que mudou entre a linha antes e os valores gravados.
 * @returns {Array<{campo, de, para}>}  `de`/`para` crus; sem eles em resumo_ia
 */
export function diferencas(anterior, novo, campos = Object.keys(ROTULOS)) {
  const mudancas = [];
  for (const campo of campos) {
    if (!ROTULOS[campo]) continue;
    const de = normal(campo, anterior?.[campo]);
    const para = normal(campo, novo?.[campo]);
    if (de === para) continue;
    mudancas.push(SO_QUE_MUDOU.has(campo) ? { campo } : { campo, de, para });
  }
  return mudancas;
}

/** Grava um evento. Devolve true/false; nunca lança. */
export async function registrarEventoLead(db, { leadId, evento, detalhe = null, por, em = new Date().toISOString() }) {
  try {
    await db.prepare('INSERT INTO lead_eventos (lead_id, evento, detalhe, por, em) VALUES (?, ?, ?, ?, ?)')
      .bind(leadId, evento, detalhe ? JSON.stringify(detalhe) : null, String(por || '').toLowerCase(), em)
      .run();
    return true;
  } catch (e) {
    console.error(`[lead-eventos] lead ${leadId} ${evento}: ${e.message}`);
    return false;
  }
}

/* ==========================================================================
   LEITURA — o histórico pronto para a tela
   ========================================================================== */

const NBSP = new RegExp(String.fromCharCode(160), 'g');   // o Intl separa "R$" com espaço não separável
const CENTAVOS = new Set(['valor_proposta', 'valor_diagnostico', 'km_valor']);
const DATAS = new Set(['data_cadastro', 'data_ultimo_contato', 'data_fechamento']);

const reais = (c) => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(NBSP, ' ');
const dataBr = (v) => { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v); };
function documentoBr(v) {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return String(v);
}

/** Os nomes de hoje, numa ida ao banco por tabela. Tabela que falta vira mapa vazio. */
async function carregarNomes(db) {
  const mapa = async (sql, chave = 'id', valor = 'nome') => {
    try {
      const { results } = await db.prepare(sql).all();
      return new Map((results || []).map((r) => [String(r[chave]).toLowerCase(), r[valor]]));
    } catch (e) { return new Map(); }
  };
  const [etapas, advisors, tags, motivos, formas, contratadas, usuarios] = await Promise.all([
    mapa('SELECT id, nome FROM etapas'),
    mapa('SELECT id, nome FROM advisors'),
    mapa('SELECT id, nome FROM tags'),
    mapa('SELECT id, nome FROM motivos_perda'),
    mapa('SELECT id, nome FROM formas_preco'),
    mapa('SELECT id, razao_social AS nome FROM contratadas'),
    mapa('SELECT email, nome FROM usuarios_crm', 'email')
  ]);
  return { etapas, advisors, tags, motivos, formas, contratadas, usuarios };
}

function formatar(campo, valor, n) {
  if (valor == null) return null;
  const nome = (m) => m.get(String(valor).toLowerCase()) || `#${valor}`;
  if (CENTAVOS.has(campo)) return reais(valor);
  if (DATAS.has(campo)) return dataBr(valor);
  if (campo === 'documento' || campo === 'rep_cpf') return documentoBr(valor);
  if (campo === 'etapa_id') return nome(n.etapas);
  if (campo === 'advisor_id') return nome(n.advisors);
  if (campo === 'motivo_perda_id') return nome(n.motivos);
  if (campo === 'forma_preco_id') return nome(n.formas);
  if (campo === 'contratada_id') return nome(n.contratadas);
  if (campo === 'responsavel') return n.usuarios.get(String(valor).toLowerCase()) || valor;
  if (campo === 'tags') {
    try { return JSON.parse(valor).map((id) => n.tags.get(String(id)) || `#${id}`).join(', ') || null; } catch (e) { return valor; }
  }
  return String(valor);
}

/**
 * O histórico do lead, do mais novo para o mais antigo, já em texto.
 *
 * Lead criado antes da 2.41.0 não tem o evento "criado": ele é montado
 * com o criado_em/criado_por do próprio lead (`sintetico: true`).
 */
export async function listarEventosLead(db, leadId) {
  const lead = await db.prepare('SELECT id, criado_por, criado_em FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return null;

  let linhas = [];
  let aviso = null;
  try {
    const { results } = await db.prepare(
      'SELECT id, evento, detalhe, por, em FROM lead_eventos WHERE lead_id = ? ORDER BY em DESC, id DESC'
    ).bind(leadId).all();
    linhas = results || [];
  } catch (e) {
    aviso = 'O histórico ainda não está ligado (falta a migração 028).';
  }

  const n = await carregarNomes(db);
  const quem = (email) => n.usuarios.get(String(email || '').toLowerCase()) || email;

  const eventos = linhas.map((l) => {
    let d = null;
    try { d = l.detalhe ? JSON.parse(l.detalhe) : null; } catch (e) { d = null; }
    const base = { evento: l.evento, por: l.por, por_nome: quem(l.por), em: l.em, detalhe: d };
    if (l.evento === 'alterado' || l.evento === 'criado') {
      base.mudancas = (d?.mudancas || []).map((m) => ({
        campo: m.campo,
        rotulo: ROTULOS[m.campo] || m.campo,
        de: 'de' in m ? formatar(m.campo, m.de, n) : undefined,
        para: 'para' in m ? formatar(m.campo, m.para, n) : undefined
      }));
    }
    if (l.evento === 'movido') {
      base.de = formatar('etapa_id', d?.de, n);
      base.para = formatar('etapa_id', d?.para, n);
      if (d?.motivo_perda_id) base.motivo = formatar('motivo_perda_id', d.motivo_perda_id, n);
    }
    return base;
  });

  if (!linhas.some((l) => l.evento === 'criado')) {
    eventos.push({ evento: 'criado', por: lead.criado_por, por_nome: quem(lead.criado_por), em: lead.criado_em, sintetico: true, mudancas: [] });
  }
  return { eventos, aviso };
}
