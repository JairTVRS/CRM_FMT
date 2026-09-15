/**
 * Prova da Fase 1 do lote "o cliente é do ERP" — a camada do hub que lê
 * a conta inteira: as pessoas (`contacts`) e os núcleos atendidos.
 *
 * O que esta suíte existe para impedir é UM defeito específico, visto
 * num documento real em 15/09/2026: o dossiê afirmou "nenhuma pessoa
 * mapeada" e "nenhum núcleo marcado" sobre uma conta cujas pessoas e
 * núcleos estavam no ERP o tempo todo — e mandou a CX ir a campo
 * levantar o que já existia.
 *
 * Por isso metade das conferências abaixo não é sobre o caminho feliz:
 * é sobre o hub em 403, o hub fora do ar e o cliente sem vínculo. Nos
 * três, o que se prova é que a resposta é "NÃO CONSULTEI" — nunca uma
 * lista vazia, que quem imprime leria como "não existe".
 *
 * Como nas outras suítes, o dublê sobe de verdade num processo à parte e
 * os módulos vêm do original em `functions/`. Dublê de dublê provaria
 * que o meu falso concorda com o meu falso.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  traduzirContato, lerContatos, consultarHub,
  buscarContaDoHub, nucleosDoCliente,
  CAMPOS_CLIENTE, CAMPOS_CLIENTE_DETALHE,
  listarClientesDoHub, buscarClientePorCnpj, ErroHub
} from '../../functions/api/_lib/hub.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
const BASE = 'http://127.0.0.1:8787/v1';

const ACME = '507f1f77bcf86cd799439011';
const VALE_VERDE = '507f1f77bcf86cd799439012';
const FORMATAR = '507f1f77bcf86cd799439013';
const SAIU_FORA = '507f1f77bcf86cd799439014';

let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

const env = (extra = {}) => ({ HUB_API_KEY: 'chave-de-teste', HUB_BASE_URL: BASE, ...extra });

async function subirDuble(args = []) {
  const p = spawn(process.execPath, [`${RAIZ}/dev/hub-stub.mjs`, ...args], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/customers`);
      return p;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('o dublê do hub não subiu');
}

const derrubar = (p) => new Promise((r) => { p.once('exit', r); p.kill(); });

/* ==========================================================================
   1. O TRADUTOR DE CONTATO — sem rede, só forma
   ========================================================================== */
console.log('\n-- o tradutor de contato --');

{
  const c = traduzirContato({
    id: 'x1', name: 'Tatiana Moraes', email: 'tati@acme.com.br',
    phone: '31988887777', jobTitle: 'Diretora', isMain: true
  });
  ok(c.nome === 'Tatiana Moraes', 'lê o nome');
  ok(c.cargo === 'Diretora', 'lê o cargo por `jobTitle`');
  ok(c.principal === true, 'lê o principal por `isMain`');
  ok(c.chavesVistas.includes('cargo=jobTitle'), 'registra QUAL chave encontrou',
     c.chavesVistas.join(' '));
}

{
  // A gramática do hub é camelCase em inglês, mas não sabemos qual
  // variante ele usa para contato. O tradutor aceita as plausíveis.
  const c = traduzirContato({ _id: 'x2', fullName: 'Bruno', mobile: '31999', role: 'Gerente' });
  ok(c.erp_id === 'x2', 'aceita `_id` como id');
  ok(c.nome === 'Bruno', 'aceita `fullName` como nome');
  ok(c.telefone === '31999', 'aceita `mobile` como telefone');
  ok(c.cargo === 'Gerente', 'aceita `role` como cargo');
}

{
  // O ponto mais importante do tradutor inteiro.
  const c = traduzirContato({ id: 'x3', name: 'Sem marcação' });
  ok(c.principal === null,
     'sem marcação de principal, `principal` é null — não false',
     'null é "este ERP não marca"; false seria "esta pessoa não é a principal"');
}

{
  const c = traduzirContato('607f1f77bcf86cd799439999');
  ok(c.referencia === true && c.erp_id === '607f1f77bcf86cd799439999',
     'contato que vem como ObjectId cru é marcado como referência');
  ok(c.nome === null, 'referência não inventa nome');
}

/* ==========================================================================
   2. O LEITOR DE `contacts` — os cinco formatos
   ========================================================================== */
console.log('\n-- os formatos de `contacts` --');

ok(lerContatos({}).formato === 'ausente', 'campo que não veio é `ausente`');
ok(lerContatos({ contacts: [] }).formato === 'vazio', 'lista vazia é `vazio`');
ok(lerContatos({ contacts: [{ id: 'a', name: 'A' }] }).formato === 'objetos',
   'lista de objetos é `objetos`');
ok(lerContatos({ contacts: ['a', 'b'] }).formato === 'referencias',
   'lista de ObjectId é `referencias`');
ok(lerContatos({ contacts: { id: 'a', name: 'A' } }).formato === 'inesperado',
   'objeto solto é `inesperado`, e a pessoa não se perde');

{
  // `ausente` e `vazio` são os dois que o dossiê NÃO pode confundir.
  const a = lerContatos({});
  const v = lerContatos({ contacts: [] });
  ok(a.formato !== v.formato,
     '`ausente` e `vazio` são estados distintos',
     'um é "não veio no campo", o outro é "o ERP não tem ninguém"');
}

{
  const r = lerContatos({
    contacts: [
      { id: 'a', name: 'A', isMain: true },
      { id: 'b', name: 'B', isMain: false }
    ]
  });
  ok(r.temIdEstavel === true, 'diz que há id estável quando todos têm id');
  ok(r.temMarcacaoPrincipal === true, 'diz que há marcação de principal');
}

{
  const r = lerContatos({ contacts: [{ name: 'Sem id' }] });
  ok(r.temIdEstavel === false,
     'sem id em todos, `temIdEstavel` é false',
     'é a resposta que decide se a amarra da CX é por id ou por e-mail');
  ok(r.temMarcacaoPrincipal === false, 'sem marcação, `temMarcacaoPrincipal` é false');
}

/* ==========================================================================
   3. A CONSULTA COM ESTADO — erro vira dado, não exceção
   ========================================================================== */
console.log('\n-- consulta com estado declarado --');

{
  const r = await consultarHub('teste', async () => ({ x: 1 }));
  ok(r.consultado === true && r.dado.x === 1, 'sucesso vem com `consultado: true`');
}

{
  const r = await consultarHub('teste', async () => {
    throw new ErroHub('HUB_SEM_PERMISSAO', 'falta hub:teams:read', 403);
  });
  ok(r.consultado === false, 'falha NÃO lança — vira `consultado: false`');
  ok(r.erro.codigo === 'HUB_SEM_PERMISSAO' && r.erro.status === 403,
     'o motivo sobrevive à travessia', r.erro.mensagem);
}

/* ==========================================================================
   4. CONTRA O DUBLÊ — o caminho completo
   ========================================================================== */
const duble = await subirDuble();

console.log('\n-- a listagem NÃO carrega as pessoas --');

{
  ok(!CAMPOS_CLIENTE.includes('contacts'),
     'CAMPOS_CLIENTE (listagem) não pede `contacts`');
  ok(CAMPOS_CLIENTE_DETALHE.includes('contacts'),
     'CAMPOS_CLIENTE_DETALHE pede `contacts`');

  const { clientes } = await listarClientesDoHub(env(), { status: 'active' });
  ok(clientes.length === 3, 'a Jornada continua listando os 3 ativos', `veio ${clientes.length}`);
}

console.log('\n-- a classificação vem como ela é --');

{
  // A doc do `GET /customers/{id}`, conferida em 15/09/2026, mostra
  // `"classification": "A"`. O código assumia inteiro de escala 1–6 e
  // devolvia null para qualquer letra — o que faria o dossiê afirmar
  // que o ERP não tem classificação nesta conta. Exatamente o defeito
  // que este lote existe para consertar, sobrevivendo por outra porta.
  const { clientes } = await listarClientesDoHub(env(), { status: 'active' });

  const acme = clientes.find((c) => c.erp_id === ACME);
  ok(acme.classificacao === 'A',
     'classificação em LETRA atravessa intacta',
     'era null antes de 15/09/2026, e o documento dizia que não existia');

  const formatar = clientes.find((c) => c.erp_id === FORMATAR);
  ok(formatar.classificacao === 4,
     'e classificação em NÚMERO também — o tradutor não escolhe um tipo');

  const saiuFora = await buscarClientePorCnpj(env(), '11222333000181');
  ok(saiuFora.classificacao === 1, 'conta inativa também traz a sua');

  ok(clientes.every((c) => c.classificacao !== null),
     'nenhuma conta do dublê perde a classificação no caminho');
}

console.log('\n-- a conta inteira, pela rota de detalhe --');

{
  const conta = await buscarContaDoHub(env(), { erpId: ACME });
  ok(conta !== null, 'acha a conta');
  ok(conta.via === 'detalhe', 'usou `GET /customers/{id}`', conta && conta.via);
  ok(conta.cliente.nome_fantasia === 'Acme Indústria', 'traduz a identidade');
  ok(conta.contatos.formato === 'objetos', 'lê as pessoas embutidas');
  ok(conta.contatos.contatos.length === 2, 'as duas pessoas da Acme');

  const principal = conta.contatos.contatos.find((c) => c.principal === true);
  ok(principal && principal.nome === 'Tatiana Moraes',
     'identifica o contato principal', principal && principal.nome);
  ok(principal && principal.cargo === 'Diretora de Operações', 'o cargo vem do ERP');
}

{
  // A conta que o dossiê de hoje descreveria como "sem ninguém" — e que
  // tem duas pessoas, nenhuma marcada como principal.
  const conta = await buscarContaDoHub(env(), { erpId: VALE_VERDE });
  ok(conta.contatos.contatos.length === 2, 'Vale Verde tem 2 pessoas no ERP');
  ok(conta.contatos.temMarcacaoPrincipal === false,
     'e nenhuma marcada como principal — diferente de não ter pessoa');
  ok(conta.contatos.contatos.every((c) => c.principal === null),
     'todas com `principal: null`');
}

{
  const conta = await buscarContaDoHub(env(), { erpId: FORMATAR });
  ok(conta.contatos.formato === 'referencias',
     '`contacts` por ObjectId é reconhecido, não quebra');
  ok(conta.contatos.contatos.every((c) => c.referencia && !c.nome),
     'e não inventa nome para a referência');
}

{
  const conta = await buscarContaDoHub(env(), { erpId: SAIU_FORA });
  ok(conta.contatos.formato === 'ausente',
     'conta sem o campo `contacts` devolve `ausente`');
}

{
  const conta = await buscarContaDoHub(env(), { erpId: 'nao-existe-no-erp' });
  ok(conta === null, 'id que não existe devolve null — perguntou e não achou');
}

console.log('\n-- o hub SEM a rota de detalhe: cai na listagem --');

await derrubar(duble);
const dubleSemDetalhe = await subirDuble(['--sem-detalhe']);

{
  const conta = await buscarContaDoHub(env(), {
    erpId: ACME, documento: '12345678000190'
  });
  ok(conta !== null, 'ainda acha a conta sem a rota de detalhe');
  ok(conta && conta.via === 'listagem-por-documento',
     'pelo filtro exato de `document`', conta && conta.via);
  ok(conta && conta.contatos.contatos.length === 2,
     'e as pessoas vêm igual — o fallback não é degradado');
}

{
  // Sem a rota E sem o CNPJ não há por onde: null é a resposta certa.
  const conta = await buscarContaDoHub(env(), { erpId: ACME });
  ok(conta === null, 'sem rota de detalhe e sem CNPJ, devolve null');
}

/* ==========================================================================
   5. OS NÚCLEOS
   ========================================================================== */
await derrubar(dubleSemDetalhe);
const duble2 = await subirDuble();

console.log('\n-- os núcleos atendidos (o núcleo é o Time) --');

{
  const r = await nucleosDoCliente(env(), VALE_VERDE);
  ok(r.consultado === true, 'consultou');
  ok(r.nucleos.length === 1, 'um núcleo', `${r.nucleos.length}`);
  ok(r.nucleos[0].nome === 'Operações',
     'e ele é o TIME, não o tipo de reunião', r.nucleos[0].nome);
  ok(r.nucleos[0].tiposDeReuniao.map((t) => t.nome).join() === 'Logística',
     'carregando junto o tipo de reunião que o compõe',
     'é o que reconcilia esta tela com o Plano de Ação');
  ok(r.nucleos[0].reunioesRealizadas === 2, 'conta as realizadas',
     `${r.nucleos[0].reunioesRealizadas}`);
  ok(r.nucleos[0].ultimaReuniao === '2026-09-03T12:00:00.000Z',
     'e guarda a mais recente', r.nucleos[0].ultimaReuniao);
  ok(r.totalReunioesRealizadas === 2, 'a reunião CANCELADA não conta');
}

{
  // Acme só tem reunião agendada. O núcleo existe e é atendido, mas não
  // tem histórico — e isso não é a mesma coisa que não ter núcleo.
  const r = await nucleosDoCliente(env(), ACME);
  ok(r.consultado === true, 'Acme: consultou');
  ok(r.nucleos.length === 1 && r.nucleos[0].nome === 'Operações',
     'núcleo atendido mesmo sem reunião realizada');
  ok(r.nucleos[0].reunioesRealizadas === 0 && r.nucleos[0].reunioesPrevistas === 1,
     'realizada 0, prevista 1 — declarado, não escondido');
  ok(r.totalReunioesRealizadas === 0, 'e o total de realizadas é 0');
}

{
  const r = await nucleosDoCliente(env(), SAIU_FORA);
  ok(r.consultado === true && r.nucleos.length === 0,
     'cliente sem nenhuma reunião: consultado, e a lista é MESMO vazia');
}

{
  const r = await nucleosDoCliente(env(), null);
  ok(r.consultado === false, 'cliente sem erp_id: `consultado: false`');
  ok(/erp_id/.test(r.motivo), 'e o motivo diz por quê', r.motivo);
}

console.log('\n-- o hub calado nunca vira lista vazia --');

await derrubar(duble2);
const duble3 = await subirDuble(['--sem-permissao']);

{
  const r = await nucleosDoCliente(env(), VALE_VERDE);
  ok(r.consultado === false,
     'com 403, `consultado: false` — NÃO uma lista vazia',
     'é exatamente o defeito que este lote existe para consertar');
  ok(r.nucleos.length === 0, 'e a lista não traz sobra parcial');
  ok(/reuniões|tipos de reunião|times/.test(r.motivo || ''),
     'o motivo nomeia a fonte que falhou', r.motivo);
  ok(r.fontes.reunioes.erro && r.fontes.reunioes.erro.codigo === 'HUB_SEM_PERMISSAO',
     'e o código do erro sobrevive para a tela');
}

await derrubar(duble3);

{
  // Hub fora do ar: ninguém atendendo na porta.
  const r = await nucleosDoCliente(env(), VALE_VERDE);
  ok(r.consultado === false, 'hub fora do ar: `consultado: false`');
  ok(r.nucleos.length === 0, 'e nenhuma lista inventada');
}

{
  // E a busca da conta: erro de permissão TEM que subir, porque devolver
  // null aqui seria "perguntei e não achei" — mentira.
  const duble4 = await subirDuble(['--sem-permissao']);
  let subiu = false;
  try {
    await buscarContaDoHub(env(), { erpId: ACME, documento: '12345678000190' });
  } catch (e) {
    subiu = e instanceof ErroHub && e.codigo === 'HUB_SEM_PERMISSAO';
  }
  ok(subiu, '403 na busca da conta SOBE como erro, não vira null',
     'null seria lido como "esta conta não existe no ERP"');
  await derrubar(duble4);
}

console.log(`\n${falhas ? `${falhas} FALHA(S)` : 'tudo certo'}`);
process.exit(falhas ? 1 : 0);
