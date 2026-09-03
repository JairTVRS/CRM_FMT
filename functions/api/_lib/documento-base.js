/**
 * _lib/documento-base.js — A casca dos documentos da Formatar.
 *
 * Infraestrutura compartilhada, não um template. Aqui moram a paleta da
 * marca, a tipografia, as regras de página e o cabeçalho/rodapé; o
 * conteúdo de cada documento vive no seu próprio arquivo.
 *
 * Consumidores: a proposta comercial (Lote E) e, no Lote G, o contrato e
 * o documento de boas-vindas. O dossiê tem template próprio e mais
 * antigo — quando fizer sentido, migra para cá também.
 *
 * O PDF sai da impressão do navegador, não de biblioteca. Foi decisão
 * combinada: tipografia impecável, custo zero, e nada de dependência
 * externa num projeto sem empacotador.
 */

/* ==========================================================================
   IDENTIDADE VISUAL
   Manual de Identidade Formatar. Ficam aqui, e não espalhados pelos
   templates, para que trocar a marca seja um lugar só.
   ========================================================================== */

export const MARCA = {
  laranja: '#F2421A',
  tinta: '#0D0D0D',
  tintaSuave: '#1A1A1A',
  cinza: '#8C887F',
  creme: '#F4F1EA',
  branco: '#FFFFFF'
};

/** Dados da contratada. O CNPJ da assinatura não é o da marca. */
export const FORMATAR = {
  marca: 'formatar',
  assinatura: 'GESTÃO, GOVERNANÇA E CONEXÕES',
  endereco: 'Rua Coronel João Notini, 1511 — Bairro Sidil — Divinópolis/MG — CEP 35500-017',
  telefone: '(37) 3213-0005',
  site: 'www.formatar.com.br',
  email: 'formatar@formatar.com.br'
};

/* ==========================================================================
   UTILIDADES DE FORMATAÇÃO
   ========================================================================== */

export function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** AAAA-MM-DD para DD/MM/AAAA, sem passar por Date (evita fuso). */
export function dataBr(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

/** Centavos para "R$ 25.424,00". */
export function moeda(centavos) {
  if (centavos == null || centavos === '') return '';
  return (Number(centavos) / 100).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2
  });
}

/** CNPJ ou CPF com máscara; devolve como veio se não reconhecer. */
export function documentoBr(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return valor || '';
}

/* ==========================================================================
   FOLHA DE ESTILO
   ========================================================================== */

function estilos() {
  return `
:root{
  --laranja:${MARCA.laranja};
  --tinta:${MARCA.tinta};
  --tinta-suave:${MARCA.tintaSuave};
  --cinza:${MARCA.cinza};
  --creme:${MARCA.creme};
}

*{box-sizing:border-box;margin:0;padding:0}

body{
  font-family:"Poppins","Urbane Rounded",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  color:var(--tinta);
  background:#8a8a8a;             /* fora da folha, só na tela */
  font-size:11pt;
  line-height:1.55;
}

/* Cada .folha é uma página A4. Na tela aparecem empilhadas com sombra;
   na impressão, uma por página. */
.folha{
  width:210mm;
  min-height:297mm;
  padding:18mm 18mm 22mm;
  margin:0 auto 8mm;
  background:#fff;
  position:relative;
  display:flex;
  flex-direction:column;
}

.folha.capa{
  background:var(--tinta);
  color:#fff;
  justify-content:space-between;
  padding:24mm 20mm;
}

/* ---------- Marca ---------- */
.marca{font-size:26pt;font-weight:700;letter-spacing:-.02em;line-height:1}
.marca-assinatura{
  font-size:6.5pt;letter-spacing:.22em;text-transform:uppercase;
  color:var(--laranja);margin-top:2mm;font-weight:600
}
.capa .marca{font-size:34pt}

/* ---------- Cabeçalho e rodapé das folhas internas ---------- */
.folha-topo{
  display:flex;align-items:flex-end;justify-content:space-between;
  border-bottom:2px solid var(--laranja);
  padding-bottom:4mm;margin-bottom:8mm
}
.folha-topo .marca{font-size:15pt;color:var(--tinta)}
.folha-topo .marca-assinatura{font-size:5.5pt}

.folha-titulo{
  font-size:7.5pt;letter-spacing:.16em;text-transform:uppercase;
  color:var(--cinza);font-weight:600;text-align:right
}

.folha-rodape{
  position:absolute;left:18mm;right:18mm;bottom:10mm;
  border-top:1px solid #e0ddd6;padding-top:3mm;
  display:flex;justify-content:space-between;
  font-size:7pt;color:var(--cinza)
}

.conteudo{flex:1}

/* ---------- Kicker e títulos ---------- */
.kicker{
  font-size:7.5pt;letter-spacing:.18em;text-transform:uppercase;
  color:var(--laranja);font-weight:600;margin-bottom:2mm
}

h1{font-size:22pt;font-weight:700;line-height:1.15;letter-spacing:-.015em;margin-bottom:5mm}
h2{font-size:13pt;font-weight:700;margin:7mm 0 3mm;letter-spacing:-.01em}
h2:first-child{margin-top:0}
h3{font-size:10.5pt;font-weight:600;margin:4mm 0 1.5mm}

p{margin-bottom:2.5mm;text-align:justify}
strong{font-weight:600}

/* ---------- Blocos ---------- */
.bloco{background:var(--creme);padding:5mm;border-radius:2mm;margin-bottom:4mm}
.bloco-escuro{background:var(--tinta);color:#fff;padding:5mm;border-radius:2mm;margin-bottom:4mm}
.bloco-escuro .kicker{color:var(--laranja)}

.faixa-laranja{background:var(--laranja);color:#fff;padding:4mm 5mm;border-radius:2mm;margin-bottom:4mm}

/* ---------- Tabela de dados ---------- */
table{width:100%;border-collapse:collapse;margin-bottom:4mm}
th{
  background:var(--tinta);color:#fff;text-align:left;
  padding:2.5mm 3mm;font-size:8pt;letter-spacing:.08em;text-transform:uppercase;font-weight:600
}
td{padding:2.5mm 3mm;border-bottom:1px solid #e8e5de;font-size:9.5pt;vertical-align:top}
tr:nth-child(even) td{background:#faf9f6}
td.rotulo{width:38%;color:var(--cinza);font-weight:500}
td.valor{font-weight:600}

/* ---------- Listas ---------- */
ul{list-style:none;margin-bottom:3mm}
li{padding-left:6mm;position:relative;margin-bottom:1.5mm;font-size:9.5pt;text-align:justify}
li::before{
  content:'';position:absolute;left:0;top:2.1mm;
  width:2.5mm;height:2.5mm;background:var(--laranja);border-radius:.5mm
}
ol{margin:0 0 3mm 5mm}
ol li{padding-left:1mm}
ol li::before{display:none}

/* ---------- Assinaturas ---------- */
.assinaturas{display:flex;gap:12mm;margin-top:14mm}
.assinatura{flex:1;text-align:center}
.assinatura .linha{border-top:1px solid var(--tinta);margin-bottom:2mm}
.assinatura .nome{font-weight:600;font-size:9.5pt}
.assinatura .cargo{font-size:8pt;color:var(--cinza)}

/* ---------- Barra de impressão (some no papel) ---------- */
.barra-imprimir{
  position:fixed;top:0;left:0;right:0;z-index:10;
  background:var(--tinta);color:#fff;padding:10px 16px;
  display:flex;align-items:center;justify-content:space-between;
  font-size:13px
}
.barra-imprimir button{
  background:var(--laranja);color:#fff;border:none;
  padding:8px 18px;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer
}
.espaco-barra{height:46px}

@media print{
  body{background:#fff}
  .barra-imprimir,.espaco-barra{display:none}
  .folha{
    margin:0;
    /* Sem quebra forçada na última folha: geraria uma página em branco */
    page-break-after:always;
    box-shadow:none
  }
  .folha:last-child{page-break-after:auto}

  /* Sem isto o navegador descarta os fundos escuros e a capa sai branca */
  -webkit-print-color-adjust:exact;print-color-adjust:exact
}

@page{size:A4;margin:0}
`;
}

/* ==========================================================================
   MONTAGEM
   ========================================================================== */

/**
 * Cabeçalho e rodapé padrão de uma folha interna.
 * `numero` e `total` alimentam a paginação impressa.
 */
export function folha({ titulo, conteudo, numero, total, rodapeEsquerda }) {
  return `
<section class="folha">
  <div class="folha-topo">
    <div>
      <div class="marca">${FORMATAR.marca}</div>
      <div class="marca-assinatura">${FORMATAR.assinatura}</div>
    </div>
    <div class="folha-titulo">${esc(titulo || '')}</div>
  </div>
  <div class="conteudo">${conteudo}</div>
  <div class="folha-rodape">
    <span>${esc(rodapeEsquerda || FORMATAR.site)}</span>
    <span>${numero} / ${total}</span>
  </div>
</section>`;
}

/**
 * Documento completo, pronto para abrir numa aba e imprimir.
 *
 * A barra do topo existe porque o PDF sai da impressão do navegador: sem
 * ela o usuário precisaria descobrir sozinho que é Ctrl+P e escolher
 * "Salvar como PDF".
 */
export function documento({ titulo, folhas }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>${estilos()}</style>
</head>
<body>
<div class="barra-imprimir">
  <span>${esc(titulo)}</span>
  <button onclick="window.print()">Salvar como PDF</button>
</div>
<div class="espaco-barra"></div>
${folhas.join('\n')}
</body>
</html>`;
}
