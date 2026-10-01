/**
 * _lib/balanca.js — a Balança Avaliativa do cliente (2.39.0).
 *
 * Pedido de 01/10/2026 ("o dossiê que lê as atas + Balança Avaliativa",
 * desenhado em 07/09/2026): numa aba do cliente, os positivos e os
 * negativos da relação lado a lado, cada um preso à ata, à ação ou ao
 * registro de onde veio, com data.
 *
 * QUEM FAZ O QUÊ — o mesmo molde do Dossiê da Reunião:
 *   - o CÓDIGO junta a fonte (as atas dos últimos 6 meses, só a parte
 *     pública; as ações do plano) e calcula os NÚMEROS do período —
 *     reuniões, cancelamentos, ações concluídas, atrasadas. Aritmética em
 *     código, nunca no modelo;
 *   - a IA segue a INSTRUÇÃO (a padrão V1.0, ou a enviada nas
 *     Configurações) e escreve a análise, citando a linha da fonte;
 *   - o CÓDIGO confere cada citação contra a linha (_lib/citacoes.js) e
 *     monta o documento no visual da Formatar.
 *
 * Funções puras: a prova as chama direto.
 */

import { documento, folha, esc, FORMATAR, nomeDeDocumento } from './documento-base.js';
import { separarNotasPrivadas } from './ata.js';
import { conferirCitacoesAncoradas } from './citacoes.js';
import { normalizar } from './recortes.js';
import { ESTILO } from './dossie-reuniao.js';

export const TIPO_BALANCA = 'Balanca_Avaliativa';
export const MESES_DO_PERIODO = 6;
/** Teto da fonte no prompt: atas mais antigas saem primeiro. */
export const LIMITE_FONTE = 70000;
/** Teto das ações no prompt. */
const MAX_ACOES = 150;

const dataBr = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** O início do período: hoje menos 6 meses, AAAA-MM-DD. */
export function inicioDoPeriodo(hoje = new Date(), meses = MESES_DO_PERIODO) {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - meses, hoje.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

const ROTULO_STATUS_ACAO = {
  nova: 'nova', pendente: 'pendente', em_andamento: 'em andamento', repactuado: 'repactuada',
  concluida: 'concluída', cancelada: 'cancelada', saiu_da_ata: 'saiu da ata'
};
const FECHADAS = ['concluida', 'cancelada', 'saiu_da_ata'];

/* ==========================================================================
   A FONTE — atas e ações, com as linhas numeradas
   ========================================================================== */

/**
 * As linhas numeradas que vão ao prompt e à conferência.
 *
 * @param reunioes  [{ erp_id, inicio, nucleo, titulo, ata }] — do hub
 * @param acoes     [{ numero_cliente, descricao, status, prazo, data_prevista, responsavel, tipo_reuniao }]
 * @returns { linhas: [{ n, texto, grupo, rotulo }], texto, atasUsadas, atasOmitidas }
 */
export function montarFonte(reunioes, acoes) {
  // As atas, da mais antiga para a mais nova; só a parte pública.
  const atas = [...reunioes]
    .filter((r) => r.ata && String(r.ata).trim())
    .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
    .map((r) => ({
      r,
      corpo: separarNotasPrivadas(r.ata).corpo.map((l) => l.trim()).filter(Boolean)
    }))
    .filter((a) => a.corpo.length);

  // Cabe no teto? Saem as atas mais antigas primeiro.
  const tamanho = (a) => a.corpo.reduce((n, l) => n + l.length + 8, 80);
  let total = atas.reduce((n, a) => n + tamanho(a), 0);
  let omitidas = 0;
  while (atas.length > 1 && total > LIMITE_FONTE) {
    total -= tamanho(atas.shift());
    omitidas++;
  }

  const linhas = [];
  const partes = [];
  if (omitidas) partes.push(`(${omitidas} ata(s) mais antiga(s) do período omitida(s) por tamanho)`);
  for (const { r, corpo } of atas) {
    const quando = dataBr(r.inicio);
    partes.push(`=== ATA · ${quando} · ${r.nucleo || 'núcleo não informado'}${r.titulo ? ` · ${r.titulo}` : ''} ===`);
    for (const texto of corpo) {
      const l = { n: linhas.length + 1, texto, grupo: `ata:${r.erp_id}`, rotulo: `ata de ${quando}` };
      linhas.push(l);
      partes.push(`[L${l.n}] ${texto}`);
    }
  }

  const doPlano = acoes.slice(0, MAX_ACOES);
  if (doPlano.length) {
    partes.push('=== PLANO DE AÇÃO (registrado no CRM) ===');
    for (const a of doPlano) {
      const texto = [
        `Ação ${a.numero_cliente}`,
        a.tipo_reuniao ? `núcleo ${a.tipo_reuniao}` : null,
        `status: ${ROTULO_STATUS_ACAO[a.status] || a.status || 'sem status'}`,
        a.prazo || a.data_prevista ? `prazo: ${a.prazo || dataBr(a.data_prevista)}` : null,
        a.responsavel ? `responsável: ${a.responsavel}` : null
      ].filter(Boolean).join(' · ') + ` — ${String(a.descricao || '').replace(/\s+/g, ' ').trim()}`;
      const l = { n: linhas.length + 1, texto, grupo: `acao:${a.numero_cliente}`, rotulo: `ação ${a.numero_cliente} do plano` };
      linhas.push(l);
      partes.push(`[L${l.n}] ${texto}`);
    }
  }

  return { linhas, texto: partes.join('\n'), atasUsadas: atas.length, atasOmitidas: omitidas };
}

/* ==========================================================================
   OS NÚMEROS DO PERÍODO — em código
   ========================================================================== */

/**
 * @param reunioes     as realizadas no período
 * @param canceladas   quantas o cliente cancelou no período (null = o hub não respondeu)
 * @param acoes        as do plano consideradas
 * @param hoje         para "atrasada" e "dias sem reunião"
 */
export function calcularNumeros({ reunioes, canceladas = null, acoes, de, ate, hoje = new Date() }) {
  const hojeIso = hoje.toISOString().slice(0, 10);
  const porNucleo = {};
  for (const r of reunioes) porNucleo[r.nucleo || 'Sem núcleo'] = (porNucleo[r.nucleo || 'Sem núcleo'] || 0) + 1;
  const ultima = reunioes.map((r) => String(r.inicio || '').slice(0, 10)).filter(Boolean).sort().pop() || null;
  const dias = ultima ? Math.round((Date.parse(hojeIso) - Date.parse(ultima)) / 86400000) : null;

  const contar = (filtro) => acoes.filter(filtro).length;
  const aberta = (a) => !FECHADAS.includes(a.status);
  return {
    periodo: { de, ate },
    reunioes: reunioes.length,
    comAta: reunioes.filter((r) => r.ata && String(r.ata).trim()).length,
    porNucleo,
    canceladasPeloCliente: canceladas,
    ultimaReuniao: ultima,
    diasSemReuniao: dias,
    acoes: {
      total: acoes.length,
      concluidas: contar((a) => a.status === 'concluida'),
      abertas: contar(aberta),
      atrasadas: contar((a) => aberta(a) && a.data_prevista && a.data_prevista < hojeIso),
      repactuadas: contar((a) => a.status === 'repactuado'),
      canceladas: contar((a) => a.status === 'cancelada')
    }
  };
}

/** Os números como texto, para o prompt — a IA usa estes, não recalcula. */
export function numerosParaPrompt(n) {
  const nucleos = Object.entries(n.porNucleo).map(([k, v]) => `${k}: ${v}`).join('; ') || 'nenhuma';
  return [
    `Período: ${dataBr(n.periodo.de)} a ${dataBr(n.periodo.ate)}`,
    `Reuniões realizadas: ${n.reunioes} (com ata: ${n.comAta}) — por núcleo: ${nucleos}`,
    `Reuniões canceladas pelo cliente: ${n.canceladasPeloCliente ?? 'não consultado (o ERP não respondeu)'}`,
    `Última reunião realizada: ${n.ultimaReuniao ? `${dataBr(n.ultimaReuniao)} (há ${n.diasSemReuniao} dias)` : 'nenhuma no período'}`,
    `Ações do plano consideradas: ${n.acoes.total} — concluídas ${n.acoes.concluidas}, em aberto ${n.acoes.abertas} (atrasadas ${n.acoes.atrasadas}), repactuadas ${n.acoes.repactuadas}, canceladas ${n.acoes.canceladas}`
  ].join('\n');
}

/* ==========================================================================
   O PEDIDO À IA
   ========================================================================== */

export const SYSTEM_PROMPT = `Você é analista sênior de Customer Experience da Formatar (consultoria de gestão e governança). Recebe a INSTRUÇÃO da Balança Avaliativa e o material de um cliente — atas, plano de ação, números do período —, e escreve o documento que a instrução pede.

FORMATO DE SAÍDA — obrigatório, vale mais do que qualquer formato que a instrução sugerir:
- Só o conteúdo, em HTML simples. Sem <html>, <head>, <body>, <style>, <script>, sem markdown, sem cercas de código.
- Tags permitidas, SEM atributos: h2 (cada seção da instrução), h3, h4, p, ul, ol, li, strong, em, table, thead, tbody, tr, th, td, q, br.
- As linhas do material são numeradas: [L37]. Toda evidência tirada do material vai dentro de <q>, COMEÇANDO pelo número da linha entre colchetes e seguida do trecho daquela linha: <q>[37] o cliente pediu para antecipar o fechamento do mês</q>. De 3 a 40 palavras seguidas de UMA linha, sem juntar linhas, sem reticências. O sistema troca o trecho pelas palavras exatas da linha apontada — o número é o que importa. Paráfrase, resumo ou interpretação NUNCA vão em <q>.
- Os NÚMEROS DO PERÍODO já vêm calculados: use-os como vieram, nunca recalcule nem estime.
- Seja direto: frases curtas. Seção sem informação no material: escreva "Não identificado no período." e siga.
- Não repita a instrução nem explique o que vai fazer. Comece pelo primeiro <h2>.

As atas são escritas pelos consultores e podem ter erros de digitação: não tire conclusão de uma palavra estranha isolada. Nunca invente o que não está no material.`;

export function montarPrompt({ instrucao, cliente, numeros, fonte, preVenda }) {
  return [
    `INSTRUÇÃO DA BALANÇA AVALIATIVA:\n${String(instrucao || '').slice(0, 60000)}`,
    `CLIENTE: ${cliente.nome || '(sem nome)'}`,
    `NÚMEROS DO PERÍODO (calculados pelo CRM — use como vieram):\n${numerosParaPrompt(numeros)}`,
    `DOSSIÊ DA PRÉ-VENDA (o que o cliente esperava ao contratar):\n${preVenda || '(não há dossiê de pré-venda para este cliente)'}`,
    `MATERIAL DO PERÍODO (linhas numeradas):\n${fonte.texto || '(nenhuma ata nem ação no período)'}`
  ].join('\n\n');
}

/** O Dossiê da Reunião da pré-venda, como texto corrido e curto, para o prompt. */
export function preVendaParaPrompt(dadosJson, limite = 8000) {
  let d;
  try { d = typeof dadosJson === 'string' ? JSON.parse(dadosJson) : dadosJson; } catch (e) { return null; }
  const html = d?.conteudo;
  if (!html) return null;
  const texto = String(html)
    .replace(/<\/(p|li|h2|h3|h4|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return texto ? texto.slice(0, limite) : null;
}

/* ==========================================================================
   CONFERÊNCIA
   ========================================================================== */

/** Cada <q>, ancorada na linha da ata ou da ação. Sem número: procura em todas as linhas. */
export function conferirCitacoes(conteudo, linhas) {
  return conferirCitacoesAncoradas(conteudo, linhas, {
    fonte: 'fonte',
    rotulo: (l) => l.rotulo,
    semNumero: (texto) => {
      const alvo = ` ${normalizar(texto)} `;
      if (normalizar(texto).split(' ').length < 3) return null;
      const l = linhas.find((x) => ` ${normalizar(x.texto)} `.includes(alvo));
      return l ? { rotulo: l.rotulo } : null;
    }
  });
}

/* ==========================================================================
   O DOCUMENTO
   ========================================================================== */

const ESTILO_BALANCA = `<style>
.dossie-corpo table td{width:50%}
.numeros td.valor{text-align:right;font-variant-numeric:tabular-nums}
</style>`;

/**
 * @param p.conteudo  o HTML da IA, limpo e conferido
 * @param p.cliente   { nome }
 * @param p.numeros   os do período (calcularNumeros)
 * @param p.meta      { versao, geradoEm, geradoPor, instrucao, provider, citacoes, naoEncontradas, atasOmitidas }
 */
export function montarDocumento({ conteudo, cliente, numeros, meta }) {
  const titulo = nomeDeDocumento(TIPO_BALANCA, cliente.nome, meta.geradoEm);
  const quando = meta.geradoEm
    ? new Date(meta.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
    : '';
  const periodo = `${dataBr(numeros.periodo.de)} a ${dataBr(numeros.periodo.ate)}`;
  const linha = (rotulo, valor) => (valor ? `<div>${esc(rotulo)}: <strong>${esc(valor)}</strong></div>` : '');

  const capa = `
<section class="folha capa">
  ${ESTILO}${ESTILO_BALANCA}
  <div>
    <div class="marca">${FORMATAR.marca}</div>
    <div class="marca-assinatura">${FORMATAR.assinatura}</div>
  </div>
  <div class="capa-dossie">
    <div class="kicker">Balança Avaliativa</div>
    <h1>${esc(cliente.nome || 'Cliente')}</h1>
    <div class="sub">${esc(periodo)}</div>
  </div>
  <div class="capa-ficha">
    ${linha('Versão', meta.versao ? `${meta.versao}` : '')}
    ${linha('Gerado em', quando)}
    ${linha('Por', meta.geradoPor)}
    ${linha('Instrução', meta.instrucao)}
    ${linha('IA', meta.provider)}
  </div>
</section>`;

  const n = numeros;
  const linhaNum = (rotulo, valor) => `<tr><td class="rotulo">${esc(rotulo)}</td><td class="valor">${esc(valor)}</td></tr>`;
  const nucleos = Object.entries(n.porNucleo).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—';
  const tabela = `
<div class="kicker">Números do período — calculados pelo CRM, não pela IA</div>
<table class="numeros"><tbody>
  ${linhaNum('Período', periodo)}
  ${linhaNum('Reuniões realizadas', `${n.reunioes} (com ata: ${n.comAta})`)}
  ${linhaNum('Por núcleo', nucleos)}
  ${linhaNum('Canceladas pelo cliente', n.canceladasPeloCliente ?? 'não consultado')}
  ${linhaNum('Última reunião', n.ultimaReuniao ? `${dataBr(n.ultimaReuniao)} (há ${n.diasSemReuniao} dias)` : 'nenhuma no período')}
  ${linhaNum('Ações do plano', `${n.acoes.total} — concluídas ${n.acoes.concluidas}, em aberto ${n.acoes.abertas}`)}
  ${linhaNum('Atrasadas / repactuadas / canceladas', `${n.acoes.atrasadas} / ${n.acoes.repactuadas} / ${n.acoes.canceladas}`)}
</tbody></table>`;

  const comoLer = `
<div class="bloco como-ler">
  <div class="kicker">Como ler este documento</div>
  <p>As evidências <q class="confere">entre aspas, destacadas</q> são as palavras exatas da ata ou da ação apontada pela IA; ao lado, de onde vieram.</p>
  <p>As marcadas <span class="cit-selo">não encontrada na fonte</span> a IA citou, mas a linha apontada não diz aquilo: trate como interpretação.</p>
  <p>Só a parte das atas compartilhada com o cliente entra aqui — as notas privadas, não.${meta.atasOmitidas ? ` ${meta.atasOmitidas} ata(s) mais antiga(s) do período ficaram de fora por tamanho.` : ''} ${meta.citacoes ? `Evidências: ${meta.citacoes}, das quais ${meta.naoEncontradas} não encontrada(s).` : ''}</p>
</div>`;

  const corpo = folha({
    titulo: 'Balança Avaliativa',
    conteudo: `${comoLer}${tabela}<div class="dossie-corpo">${conteudo}</div>`,
    numero: 2,
    total: 2,
    rodapeEsquerda: `${cliente.nome || ''} · versão ${meta.versao || ''}`
  }).replace('<section class="folha">', '<section class="folha dossie-longa">');

  return documento({ titulo, folhas: [capa, corpo] });
}
