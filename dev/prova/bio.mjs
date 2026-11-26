/**
 * Prova da página BIO (2.45.0).
 *
 * O que importa:
 *   - pelo CRM (com login) troca-se a imagem e o link de cada vaga, e só
 *     das vagas conhecidas; quem trocou fica gravado;
 *   - a rota pública só LÊ, só as vagas da lista, e não expõe quem trocou;
 *   - a versão nunca volta atrás (o cache de um ano depende disso);
 *   - só JPEG/PNG/WebP de verdade (pelo conteúdo), nada de SVG;
 *   - os vídeos vêm do feed do YouTube e, se ele falhar, a página segue.
 * Nada aqui sai para a rede: o fetch é substituído.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { onRequestGet as bioGet, onRequestPut as bioPut, onRequestDelete as bioDelete } from '../../functions/api/bio.js';
import { onRequestGet as publicoGet } from '../../functions/publico/bio.js';
import { onRequestGet as imagemGet } from '../../functions/publico/bio-imagem.js';
import { lerFeedDoYoutube, buscarVideos, tipoDaImagem, VAGAS } from '../../functions/api/_lib/bio.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

// D1 de mentira sobre o node:sqlite. O D1 recebe BLOB como ArrayBuffer; o
// node:sqlite, como Uint8Array — o shim converte.
function d1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x)); return api; },
        async first() { return stmt.get(...args) ?? null; },
        async run() { return stmt.run(...args); },
        async all() { return { results: stmt.all(...args) }; }
      };
      return api;
    }
  };
}

// O feed do YouTube, de mentira — nenhuma prova sai para a rede.
const FEED = `<?xml version="1.0"?><feed>
  <title>Formatar Gestão e Governança</title>
  <entry><yt:videoId>wZp4KkdLrus</yt:videoId><title>QUANTO CUSTA A SUA META PERFEITA?</title><published>2026-11-17T12:23:07+00:00</published></entry>
  <entry><yt:videoId>f5OHcYMEWBQ</yt:videoId><title>ANTES DE PEGAR AQUELE EMPRÉSTIMO, ASSISTA ISSO &amp; MAIS</title><published>2026-11-10T15:00:24+00:00</published></entry>
</feed>`;
let feedResponde = true;
globalThis.fetch = async () => (feedResponde ? new Response(FEED, { status: 200 }) : new Response('', { status: 500 }));

const bd = new DatabaseSync(':memory:');
const migracao = readFileSync(`${RAIZ}/db/migracao-030-bio.sql`, 'utf8');
bd.exec(migracao);
bd.exec(migracao);

const CAB = { 'Content-Type': 'application/json' };
const ctx = (url, { metodo = 'GET', corpo, email = 'jair@formatar.com.br', db = d1(bd) } = {}) => ({
  request: new Request(`https://crm-fmt.pages.dev${url}`, corpo === undefined ? { method: metodo } : {
    method: metodo, headers: CAB, body: JSON.stringify(corpo)
  }),
  env: { DB: db },
  data: { cabecalhos: CAB, usuario: { email } }
});
const ler = async (r) => ({ status: r.status, corpo: await r.json() });

// Imagens de mentira: só o cabeçalho importa para a conferência de tipo.
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(200, 7)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(200, 3)]);
const dataUrl = (buf, tipo = 'image/png') => `data:${tipo};base64,${buf.toString('base64')}`;
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

console.log('\n=== 1. Lista de vagas ===');
ok(true, 'a 030 roda duas vezes sem erro');
const lista = await ler(await bioGet(ctx('/api/bio')));
ok(lista.status === 200 && lista.corpo.vagas.length === Object.keys(VAGAS).length,
  `as ${Object.keys(VAGAS).length} vagas aparecem, mesmo sem nada gravado`);
ok(lista.corpo.vagas.every((v) => !v.temImagem && v.versao === 0), 'todas começam sem imagem');
ok(lista.corpo.vagas.find((v) => v.vaga === 'capa').aceitaLink === false
  && lista.corpo.vagas.find((v) => v.vaga === 'post-1').aceitaLink === true,
  'capa não aceita link; postagem aceita');

console.log('\n=== 2. Trocar a imagem ===');
const p1 = await ler(await bioPut(ctx('/api/bio?vaga=capa', { metodo: 'PUT', corpo: { imagem: dataUrl(png) } })));
ok(p1.status === 200 && p1.corpo.versao === 1, 'grava a capa na versão 1', JSON.stringify(p1.corpo));
const linha = bd.prepare('SELECT imagem, imagem_tipo, atualizado_por FROM bio_vagas WHERE vaga = ?').get('capa');
ok(Buffer.from(linha.imagem).equals(png), 'os bytes gravados são exatamente os enviados');
ok(linha.imagem_tipo === 'image/png', 'o tipo sai do conteúdo: image/png');
ok(linha.atualizado_por === 'jair@formatar.com.br', 'quem trocou fica gravado (da sessão)');

const p2 = await ler(await bioPut(ctx('/api/bio?vaga=post-1', { metodo: 'PUT',
  corpo: { imagem: dataUrl(webp, 'image/webp'), link: 'https://www.instagram.com/p/ABC123/' } })));
ok(p2.status === 200, 'postagem com imagem WebP e link');
const p3 = await ler(await bioPut(ctx('/api/bio?vaga=post-1', { metodo: 'PUT', corpo: { imagem: dataUrl(png) } })));
const post1 = bd.prepare('SELECT link, versao, imagem_tipo FROM bio_vagas WHERE vaga = ?').get('post-1');
ok(p3.corpo.versao === 2 && post1.link === 'https://www.instagram.com/p/ABC123/' && post1.imagem_tipo === 'image/png',
  'trocar só a imagem mantém o link e sobe a versão');
await bioPut(ctx('/api/bio?vaga=post-1', { metodo: 'PUT', corpo: { link: 'https://www.instagram.com/p/XYZ/' } }));
const post1b = bd.prepare('SELECT link, versao, imagem_tipo FROM bio_vagas WHERE vaga = ?').get('post-1');
ok(post1b.link === 'https://www.instagram.com/p/XYZ/' && post1b.imagem_tipo === 'image/png' && post1b.versao === 3,
  'trocar só o link mantém a imagem');
await bioPut(ctx('/api/bio?vaga=post-1', { metodo: 'PUT', corpo: { link: '' } }));
ok(bd.prepare('SELECT link FROM bio_vagas WHERE vaga = ?').get('post-1').link === null, 'link vazio tira o link');

console.log('\n=== 3. Recusas ===');
const r = async (url, corpo) => (await bioPut(ctx(url, { metodo: 'PUT', corpo }))).status;
ok(await r('/api/bio?vaga=../etc', { imagem: dataUrl(png) }) === 400, 'vaga desconhecida: 400');
ok(await r('/api/bio', { imagem: dataUrl(png) }) === 400, 'sem vaga: 400');
ok(await r('/api/bio?vaga=capa', {}) === 400, 'sem imagem nem link: 400');
ok(await r('/api/bio?vaga=capa', { imagem: dataUrl(svg, 'image/png') }) === 415, 'SVG disfarçado de PNG: 415 (o tipo sai do conteúdo)');
ok(await r('/api/bio?vaga=capa', { imagem: 'data:image/png;base64,@@@não-é-base64' }) === 400, 'base64 quebrado: 400');
const grande = Buffer.concat([png, Buffer.alloc(901 * 1024)]);
ok(await r('/api/bio?vaga=capa', { imagem: dataUrl(grande) }) === 413, 'acima de 900 KB: 413');
ok(await r('/api/bio?vaga=capa', { link: 'https://formatar.com.br' }) === 400, 'link na capa (não aceita): 400');
ok(await r('/api/bio?vaga=post-2', { link: 'http://formatar.com.br' }) === 400, 'link sem https: 400');
ok(await r('/api/bio?vaga=post-2', { link: 'javascript:alert(1)' }) === 400, 'link javascript: 400');
ok(tipoDaImagem(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0])) === 'image/jpeg', 'JPEG reconhecido pelo conteúdo');

console.log('\n=== 4. A rota pública ===');
bd.prepare("INSERT INTO bio_vagas (vaga, imagem, imagem_tipo, versao, atualizado_por, atualizado_em) VALUES ('vaga-intrusa', ?, 'image/png', 1, 'x', 'x')").run(png);
const pub = await ler(await publicoGet(ctx('/publico/bio')));
ok(pub.status === 200 && pub.corpo.vagas.capa?.v === 1, 'a capa aparece com a versão da imagem');
ok(pub.corpo.vagas['post-1']?.v === 4 && pub.corpo.vagas['post-1'].link === null, 'a postagem aparece com a versão');
ok(!pub.corpo.vagas['vaga-intrusa'], 'vaga fora da lista nunca sai, mesmo gravada no banco');
ok(!pub.corpo.vagas['solucao-1'], 'vaga sem imagem nem link não aparece');
ok(!JSON.stringify(pub.corpo).includes('formatar.com.br"') && !JSON.stringify(pub.corpo).includes('jair@'),
  'não expõe quem trocou');
ok(pub.corpo.videos.length === 2 && pub.corpo.videos[0].id === 'wZp4KkdLrus', 'traz os vídeos do feed, do mais novo');

const img = await imagemGet(ctx('/publico/bio-imagem?vaga=capa&v=1'));
ok(img.status === 200 && img.headers.get('Content-Type') === 'image/png'
  && Buffer.from(await img.arrayBuffer()).equals(png), 'a imagem sai com os bytes e o tipo certos');
ok(/immutable/.test(img.headers.get('Cache-Control')), 'versão certa: cache de um ano');
const velha = await imagemGet(ctx('/publico/bio-imagem?vaga=capa&v=0'));
ok(velha.status === 200 && /max-age=60\b/.test(velha.headers.get('Cache-Control')), 'versão velha: entrega a atual, com cache curto');
ok(velha.headers.get('X-Content-Type-Options') === 'nosniff', 'nosniff na imagem');
ok((await imagemGet(ctx('/publico/bio-imagem?vaga=vaga-intrusa&v=1'))).status === 404, 'vaga fora da lista: 404');
ok((await imagemGet(ctx('/publico/bio-imagem?vaga=solucao-2'))).status === 404, 'vaga sem imagem: 404');

for (const arquivo of ['functions/publico/bio.js', 'functions/publico/bio-imagem.js']) {
  const fonte = readFileSync(`${RAIZ}/${arquivo}`, 'utf8');
  ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i.test(fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))
    && !/onRequest(Post|Put|Delete|Patch)\b/.test(fonte),
    `${arquivo} só lê (sem escrita no banco, só GET)`);
}

console.log('\n=== 5. Voltar ao padrão ===');
const del = await ler(await bioDelete(ctx('/api/bio?vaga=capa', { metodo: 'DELETE' })));
const capa = bd.prepare('SELECT imagem, versao FROM bio_vagas WHERE vaga = ?').get('capa');
ok(del.status === 200 && capa.imagem === null, 'tira a imagem');
ok(capa.versao === 2, 'e a versão continua subindo (não volta a 1: o cache de um ano depende disso)');
ok(!(await ler(await publicoGet(ctx('/publico/bio')))).corpo.vagas.capa, 'a página pública volta ao padrão');
ok((await imagemGet(ctx('/publico/bio-imagem?vaga=capa&v=1'))).status === 404, 'e o endereço antigo não entrega mais nada');
const p4 = await ler(await bioPut(ctx('/api/bio?vaga=capa', { metodo: 'PUT', corpo: { imagem: dataUrl(png) } })));
ok(p4.corpo.versao === 3, 'gravar de novo depois de tirar sobe para 3, nunca reaproveita');
ok((await bioDelete(ctx('/api/bio?vaga=nada', { metodo: 'DELETE' }))).status === 400, 'remover vaga desconhecida: 400');

console.log('\n=== 6. Vídeos do YouTube ===');
const lidos = lerFeedDoYoutube(FEED);
ok(lidos.length === 2 && lidos[1].titulo === 'ANTES DE PEGAR AQUELE EMPRÉSTIMO, ASSISTA ISSO & MAIS', 'entidades do XML desfeitas');
ok(!lidos.some((v) => v.titulo === 'Formatar Gestão e Governança'), 'o título do canal não vira vídeo');
const muitos = `<feed>${Array.from({ length: 15 }, (_, i) => `<entry><yt:videoId>video${i}xx</yt:videoId><title>V${i}</title></entry>`).join('')}</feed>`;
ok(lerFeedDoYoutube(muitos).length === 6, 'no máximo 6 na página');
feedResponde = false;
ok((await buscarVideos()).length === 0, 'YouTube fora do ar: lista vazia, sem erro');
const semYoutube = await ler(await publicoGet(ctx('/publico/bio')));
ok(semYoutube.status === 200 && semYoutube.corpo.videos.length === 0, 'e a rota pública responde do mesmo jeito');
feedResponde = true;

console.log('\n=== 7. Sem a migração 030 ===');
const vazio = d1(new DatabaseSync(':memory:'));
const g = await ler(await bioGet(ctx('/api/bio', { db: vazio })));
ok(g.status === 200 && g.corpo.aviso && g.corpo.vagas.length, 'o CRM lista as vagas e avisa da migração');
const pp = await ler(await bioPut(ctx('/api/bio?vaga=capa', { metodo: 'PUT', corpo: { imagem: dataUrl(png) }, db: vazio })));
ok(pp.status === 503 && pp.corpo.code === 'SEM_MIGRACAO_030', 'gravar diz qual migração falta');
const pv = await ler(await publicoGet(ctx('/publico/bio', { db: vazio })));
ok(pv.status === 200 && Object.keys(pv.corpo.vagas).length === 0, 'a página pública abre no padrão');

console.log('\n=== 8. A página ===');
const html = readFileSync(`${RAIZ}/public/bio.html`, 'utf8');
ok(html.includes("numero: '553799564071'"), 'o WhatsApp corporativo (+55 37 9956-4071)');
const atribuicoes = [...html.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
ok(atribuicoes.length > 0 && atribuicoes.every((a) => a.startsWith('ICONES[')),
  'innerHTML só com os ícones fixos; texto sempre por textContent', atribuicoes.join(' | '));
ok(/window\.parent\.location\.origin === location\.origin/.test(html), 'o lápis só aparece dentro do próprio CRM');
const crm = readFileSync(`${RAIZ}/public/js/bio.js`, 'utf8');
ok(/ev\.origin !== window\.location\.origin/.test(crm) && /ev\.source !== quadro\(\)\.contentWindow/.test(crm),
  'o CRM só aceita o pedido do lápis vindo da própria prévia');

console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
