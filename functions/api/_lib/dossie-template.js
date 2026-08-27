/**
 * _lib/dossie-template.js — JSON → HTML.
 *
 * Gera um documento autocontido: CSS embutido, sem dependência externa,
 * sem fonte remota. Abre offline, imprime em PDF e sobrevive a ser
 * enviado por e-mail como anexo.
 *
 * Princípio de renderização: seção sem dado NÃO é renderizada.
 * Melhor um dossiê com quatro blocos verdadeiros do que doze com
 * metade vazia — foi a decisão tomada junto com o cliente.
 */

/* ==========================================================================
   ESCAPE
   ========================================================================== */

function esc(valor) {
  if (valor == null) return '';
  return String(valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Conteúdo já saneado pelo validador (lista branca de tags). */
function html(valor) {
  return valor == null ? '' : String(valor);
}

function dataBr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? esc(iso)
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function moeda(valor) {
  if (valor == null) return null;
  return `R$ ${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

const ROTULO_FONTE = {
  brasilapi: 'Receita Federal', opencnpj: 'Receita Federal',
  'brasilapi (cache)': 'Receita Federal', 'opencnpj (cache)': 'Receita Federal',
  indisponivel: 'indisponível', ok: 'site institucional', falha: 'falha na leitura',
  sem_site: 'não informado', manual: 'informado pelo consultor',
  graph_api: 'Instagram (API oficial)', ausente: 'não disponível'
};

const ROTULO_CONFIANCA = { alta: 'Confiança alta', media: 'Confiança média', baixa: 'Confiança baixa' };

/* ==========================================================================
   BLOCOS
   ========================================================================== */

function blocoSecao(titulo, conteudo, numero) {
  if (!conteudo) return '';
  return `
  <section class="secao">
    <h2 class="secao-titulo">${numero ? `<span class="secao-num">${esc(numero)}</span>` : ''}${esc(titulo)}</h2>
    <div class="secao-corpo">${conteudo}</div>
  </section>`;
}

function fichaCadastral(e) {
  const linhas = [
    ['CNPJ', e.cnpjFormatado],
    ['Razão social', e.razaoSocial],
    ['Nome fantasia', e.nomeFantasia],
    ['Abertura', e.dataAbertura ? `${dataBr(e.dataAbertura)}${e.anosDeMercado != null ? ` · ${e.anosDeMercado} anos` : ''}` : null],
    ['Situação', e.situacao],
    ['Natureza jurídica', e.naturezaJuridica],
    ['Porte', e.porte],
    ['Capital social', moeda(e.capitalSocial)],
    ['Atividade principal', e.cnaePrincipal?.descricao],
    ['Localização', e.endereco?.municipio ? `${e.endereco.municipio}/${e.endereco.uf || ''}` : null]
  ].filter(([, v]) => v);

  if (!linhas.length) return '';

  return `<table class="ficha">
    ${linhas.map(([r, v]) => `<tr><th>${esc(r)}</th><td>${esc(v)}</td></tr>`).join('')}
  </table>`;
}

function quadroSocietario(socios) {
  if (!socios?.length) return '';
  return `<table class="tabela">
    <thead><tr><th>Sócio</th><th>Qualificação</th><th>Desde</th></tr></thead>
    <tbody>${socios.map((s) => `
      <tr><td>${esc(s.nome)}</td><td>${esc(s.qualificacao || '—')}</td><td>${s.entrada ? dataBr(s.entrada) : '—'}</td></tr>`).join('')}
    </tbody></table>`;
}

function listaItens(itens) {
  if (!itens?.length) return '';
  return `<ul class="itens">${itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function canais(lista) {
  if (!lista?.length) return '';
  return `<div class="canais">${lista.map((c) => `
    <div class="canal">
      <span class="canal-nome">${esc(c.nome)}</span>
      ${c.url ? `<a class="canal-url" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a>` : ''}
      ${c.observacao ? `<p class="canal-obs">${esc(c.observacao)}</p>` : ''}
    </div>`).join('')}</div>`;
}

function sinais(lista) {
  if (!lista?.length) return '';
  return `<div class="sinais">${lista.map((s) => `
    <div class="sinal">
      <h4>${esc(s.titulo)}</h4>
      ${s.descricao ? `<p>${esc(s.descricao)}</p>` : ''}
      ${s.evidencia ? `<p class="evidencia">Evidência: ${esc(s.evidencia)}</p>` : ''}
    </div>`).join('')}</div>`;
}

function dores(lista) {
  if (!lista?.length) return '';
  return `
  <p class="ressalva">As hipóteses abaixo são leitura analítica a partir do material coletado, não fatos apurados.</p>
  <div class="dores">${lista.map((h) => `
    <div class="dor">
      <div class="dor-topo">
        <h4>${esc(h.dor)}</h4>
        <span class="selo selo-${esc(h.confianca)}">${esc(ROTULO_CONFIANCA[h.confianca] || h.confianca)}</span>
      </div>
      ${h.fundamento ? `<p>${esc(h.fundamento)}</p>` : ''}
    </div>`).join('')}</div>`;
}

function kpis(lista) {
  if (!lista?.length) return '';
  return `<div class="kpis">${lista.map((k) => `
    <div class="kpi">
      <span class="kpi-valor">${esc(k.valor)}</span>
      <span class="kpi-rotulo">${esc(k.rotulo)}</span>
      ${k.observacao ? `<span class="kpi-obs">${esc(k.observacao)}</span>` : ''}
    </div>`).join('')}</div>`;
}

function radar(r) {
  const quadrantes = [
    ['forcas', 'Forças', 'q-forca'],
    ['atencao', 'Pontos de atenção', 'q-atencao'],
    ['oportunidades', 'Oportunidades', 'q-oportunidade'],
    ['riscos', 'Riscos', 'q-risco']
  ].filter(([chave]) => r?.[chave]?.length);

  if (!quadrantes.length) return '';

  return `<div class="radar">${quadrantes.map(([chave, titulo, classe]) => `
    <div class="quadrante ${classe}">
      <h4>${esc(titulo)}</h4>
      <ul>${r[chave].map((i) => `
        <li><strong>${esc(i.titulo)}</strong>${i.descricao ? `<span>${esc(i.descricao)}</span>` : ''}</li>`).join('')}
      </ul>
    </div>`).join('')}</div>`;
}

function rodapeFontes(f, g) {
  const itens = [
    `Dados cadastrais: ${ROTULO_FONTE[f.cnpj] || f.cnpj}`,
    `Site: ${ROTULO_FONTE[f.site] || f.site}`,
    `Instagram: ${ROTULO_FONTE[f.instagram] || f.instagram}`
  ];

  return `
  <footer class="rodape">
    <div class="rodape-fontes">
      <strong>Origem das informações</strong>
      <ul>${itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      ${f.avisos?.length ? `<ul class="avisos">${f.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    </div>
    <div class="rodape-geracao">
      Versão ${esc(g.versao ?? '—')} · gerado por ${esc(g.por || '—')} em ${dataBr(g.em)}
      ${g.provider ? `· análise por ${esc(g.provider)}` : ''}
      <p class="disclaimer">Documento interno da Formatar Consultoria. As seções analíticas
      são interpretação assistida por IA e devem ser conferidas antes de uso externo.</p>
    </div>
  </footer>`;
}

/* ==========================================================================
   DOCUMENTO
   ========================================================================== */

export function renderizarDossie(dados) {
  const e = dados.empresa || {};
  const a = dados.analise || {};
  const titulo = e.nomeFantasia || e.razaoSocial || 'Dossiê Executivo';

  const aba1 = [
    blocoSecao('Identificação', fichaCadastral(e), '01'),
    blocoSecao('Histórico', html(a.historico), '02'),
    blocoSecao('Estrutura societária',
      [html(a.estruturaSocietaria), quadroSocietario(e.socios)].filter(Boolean).join(''), '03'),
    blocoSecao('Portfólio',
      [html(a.portfolio?.descricao), listaItens(a.portfolio?.itens)].filter(Boolean).join(''), '04'),
    blocoSecao('Presença digital',
      [html(a.presencaDigital?.descricao), canais(a.presencaDigital?.canais)].filter(Boolean).join(''), '05'),
    blocoSecao('Sinais de transformação', sinais(a.sinaisTransformacao), '06'),
    blocoSecao('Hipóteses de dores', dores(a.hipotesesDores), '07')
  ].filter(Boolean).join('');

  const aba2 = [
    kpis(a.kpis),
    a.momento ? `
      <section class="momento">
        <span class="momento-eyebrow">Momento atual</span>
        <h2>${esc(a.momento.titulo || '')}</h2>
        ${html(a.momento.descricao)}
      </section>` : '',
    radar(a.radar) ? `<section class="secao"><h2 class="secao-titulo">Radar executivo</h2>${radar(a.radar)}</section>` : '',
    a.recomendacao ? blocoSecao('Recomendação comercial', html(a.recomendacao)) : ''
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} — Inteligência Comercial | Formatar</title>
<style>
:root{
  --laranja:#F2421A; --tinta:#1a1d24; --grafite:#4a5160; --cinza:#7b8494;
  --linha:#e4e7ec; --fundo:#f6f7f9; --papel:#ffffff;
  --verde:#1f9d55; --ambar:#c77700; --azul:#2563c9; --vermelho:#d13438;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
  background:var(--fundo); color:var(--tinta); line-height:1.6; font-size:15px;
  -webkit-font-smoothing:antialiased;
}
.folha{max-width:920px;margin:0 auto;background:var(--papel);min-height:100vh;
  box-shadow:0 0 60px rgba(0,0,0,.06)}

/* Cabeçalho */
.hero{padding:44px 52px 32px;border-bottom:3px solid var(--laranja)}
.hero-marca{font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--laranja);font-weight:700;margin-bottom:14px}
.hero h1{font-size:31px;line-height:1.2;font-weight:700;letter-spacing:-.02em}
.hero-sub{margin-top:8px;color:var(--cinza);font-size:14px}
.hero-tags{margin-top:18px;display:flex;flex-wrap:wrap;gap:8px}
.tag{font-size:11.5px;padding:4px 11px;border-radius:20px;background:var(--fundo);
  color:var(--grafite);border:1px solid var(--linha)}

/* Abas */
.abas{display:flex;gap:2px;padding:0 52px;background:var(--papel);
  border-bottom:1px solid var(--linha);position:sticky;top:0;z-index:5}
.aba{padding:15px 22px;border:none;background:none;cursor:pointer;font-size:13.5px;
  font-weight:600;color:var(--cinza);border-bottom:2px solid transparent;
  font-family:inherit;transition:color .15s,border-color .15s}
.aba:hover{color:var(--grafite)}
.aba.ativa{color:var(--laranja);border-bottom-color:var(--laranja)}
.painel{display:none;padding:36px 52px 52px}
.painel.ativo{display:block}

/* Seções */
.secao{margin-bottom:34px}
.secao-titulo{font-size:16px;font-weight:700;letter-spacing:-.01em;
  padding-bottom:9px;margin-bottom:16px;border-bottom:1px solid var(--linha);
  display:flex;align-items:center;gap:10px}
.secao-num{font-size:11px;font-weight:700;color:var(--laranja);
  background:rgba(242,66,26,.09);padding:3px 8px;border-radius:4px;letter-spacing:.05em}
.secao-corpo p{margin-bottom:12px;color:var(--grafite)}
.secao-corpo p:last-child{margin-bottom:0}

/* Ficha e tabelas */
.ficha,.tabela{width:100%;border-collapse:collapse;font-size:14px}
.ficha th{text-align:left;padding:9px 16px 9px 0;color:var(--cinza);
  font-weight:600;width:190px;vertical-align:top;border-bottom:1px solid var(--linha)}
.ficha td{padding:9px 0;border-bottom:1px solid var(--linha);color:var(--tinta)}
.ficha tr:last-child th,.ficha tr:last-child td{border-bottom:none}
.tabela{margin-top:16px}
.tabela th{text-align:left;padding:9px 12px;background:var(--fundo);
  font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--cinza)}
.tabela td{padding:10px 12px;border-bottom:1px solid var(--linha)}

.itens{list-style:none;margin-top:14px;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
.itens li{padding:9px 13px;background:var(--fundo);border-radius:6px;
  font-size:13.5px;border-left:3px solid var(--laranja)}

/* Canais */
.canais{margin-top:16px;display:grid;gap:12px}
.canal{padding:13px 16px;border:1px solid var(--linha);border-radius:8px}
.canal-nome{font-weight:600;font-size:14px}
.canal-url{display:block;font-size:12.5px;color:var(--azul);
  text-decoration:none;margin-top:3px;word-break:break-all}
.canal-obs{margin-top:7px;font-size:13px;color:var(--grafite)}

/* Sinais */
.sinais{display:grid;gap:13px}
.sinal{padding:15px 18px;background:var(--fundo);border-radius:8px}
.sinal h4{font-size:14px;margin-bottom:6px}
.sinal p{font-size:13.5px;color:var(--grafite)}
.evidencia{margin-top:8px;font-size:12px;color:var(--cinza);font-style:italic}

/* Dores */
.ressalva{font-size:12.5px;color:var(--cinza);background:var(--fundo);
  padding:10px 14px;border-radius:6px;margin-bottom:16px;border-left:3px solid var(--ambar)}
.dores{display:grid;gap:12px}
.dor{padding:15px 18px;border:1px solid var(--linha);border-radius:8px}
.dor-topo{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
.dor h4{font-size:14px}
.dor p{margin-top:7px;font-size:13.5px;color:var(--grafite)}
.selo{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;
  white-space:nowrap;text-transform:uppercase;letter-spacing:.04em}
.selo-alta{background:rgba(31,157,85,.12);color:var(--verde)}
.selo-media{background:rgba(199,119,0,.12);color:var(--ambar)}
.selo-baixa{background:var(--fundo);color:var(--cinza)}

/* KPIs */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));
  gap:13px;margin-bottom:34px}
.kpi{padding:18px;border:1px solid var(--linha);border-radius:10px;
  display:flex;flex-direction:column;gap:4px}
.kpi-valor{font-size:25px;font-weight:700;letter-spacing:-.02em;color:var(--laranja)}
.kpi-rotulo{font-size:12px;font-weight:600;text-transform:uppercase;
  letter-spacing:.05em;color:var(--cinza)}
.kpi-obs{font-size:12.5px;color:var(--grafite);margin-top:3px}

/* Momento */
.momento{padding:26px 30px;background:var(--tinta);color:#fff;
  border-radius:12px;margin-bottom:34px}
.momento-eyebrow{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--laranja);font-weight:700}
.momento h2{font-size:20px;margin:9px 0 12px;letter-spacing:-.01em}
.momento p{color:rgba(255,255,255,.82);font-size:14px;margin-bottom:10px}
.momento p:last-child{margin-bottom:0}

/* Radar */
.radar{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:16px}
.quadrante{padding:18px 20px;border-radius:10px;border:1px solid var(--linha);
  border-top:3px solid var(--cinza)}
.quadrante h4{font-size:12.5px;text-transform:uppercase;letter-spacing:.07em;
  margin-bottom:13px;color:var(--grafite)}
.quadrante ul{list-style:none;display:grid;gap:11px}
.quadrante li{font-size:13.5px}
.quadrante li strong{display:block;margin-bottom:2px}
.quadrante li span{color:var(--grafite);font-size:13px}
.q-forca{border-top-color:var(--verde)}
.q-atencao{border-top-color:var(--ambar)}
.q-oportunidade{border-top-color:var(--azul)}
.q-risco{border-top-color:var(--vermelho)}

/* Rodapé */
.rodape{padding:26px 52px 40px;border-top:1px solid var(--linha);
  background:var(--fundo);font-size:12.5px;color:var(--cinza)}
.rodape-fontes strong{display:block;margin-bottom:7px;color:var(--grafite);font-size:12px;
  text-transform:uppercase;letter-spacing:.05em}
.rodape-fontes ul{list-style:none;display:flex;flex-wrap:wrap;gap:16px}
.rodape-fontes .avisos{margin-top:9px;display:block;color:var(--ambar)}
.rodape-fontes .avisos li{margin-bottom:3px}
.rodape-geracao{margin-top:18px;padding-top:14px;border-top:1px solid var(--linha)}
.disclaimer{margin-top:8px;font-size:11.5px;line-height:1.5}

@media(max-width:720px){
  .hero,.painel,.abas,.rodape{padding-left:22px;padding-right:22px}
  .radar{grid-template-columns:1fr}
  .ficha th{width:130px}
}

/* Impressão: as duas abas viram seções sequenciais do PDF */
@media print{
  body{background:#fff;font-size:11pt}
  .folha{box-shadow:none;max-width:none}
  .abas{display:none}
  .painel{display:block!important;padding:0 0 20px;page-break-before:always}
  .painel:first-of-type{page-break-before:avoid}
  .hero{padding:0 0 20px}
  .rodape{padding:16px 0 0;background:none}
  .secao{page-break-inside:avoid}
  .quadrante,.dor,.sinal,.kpi{page-break-inside:avoid}
  .momento{background:#f2f2f2!important;color:#000!important;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .momento p{color:#333!important}
  a{text-decoration:none;color:#000}
}
</style>
</head>
<body>
<div class="folha">

  <header class="hero">
    <div class="hero-marca">Formatar · Inteligência Comercial</div>
    <h1>${esc(titulo)}</h1>
    ${e.razaoSocial && e.razaoSocial !== titulo ? `<p class="hero-sub">${esc(e.razaoSocial)}</p>` : ''}
    <div class="hero-tags">
      ${e.cnpjFormatado ? `<span class="tag">${esc(e.cnpjFormatado)}</span>` : ''}
      ${e.anosDeMercado != null ? `<span class="tag">${esc(e.anosDeMercado)} anos de mercado</span>` : ''}
      ${e.porte ? `<span class="tag">${esc(e.porte)}</span>` : ''}
      ${e.endereco?.municipio ? `<span class="tag">${esc(e.endereco.municipio)}/${esc(e.endereco.uf || '')}</span>` : ''}
      ${e.situacao ? `<span class="tag">${esc(e.situacao)}</span>` : ''}
    </div>
  </header>

  <nav class="abas">
    <button class="aba ativa" data-alvo="p1">01 · Resumo Descritivo</button>
    <button class="aba" data-alvo="p2">02 · Painel Executivo</button>
  </nav>

  <div class="painel ativo" id="p1">${aba1 || '<p>Sem conteúdo descritivo disponível.</p>'}</div>
  <div class="painel" id="p2">${aba2 || '<p>Sem painel executivo disponível.</p>'}</div>

  ${rodapeFontes(dados.fontes || {}, dados.gerado || {})}
</div>

<script>
document.querySelectorAll('.aba').forEach(function(botao){
  botao.addEventListener('click', function(){
    document.querySelectorAll('.aba').forEach(function(b){ b.classList.remove('ativa'); });
    document.querySelectorAll('.painel').forEach(function(p){ p.classList.remove('ativo'); });
    botao.classList.add('ativa');
    document.getElementById(botao.dataset.alvo).classList.add('ativo');
  });
});
</script>
</body>
</html>`;
}
