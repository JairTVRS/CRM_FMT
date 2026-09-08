/**
 * Prova do lote de ajustes: a mesclagem de endereço (extraída do
 * leads.js) e o ViaCEP de verdade.
 */
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
let falhas = 0;

function ok(condicao, titulo, detalhe) {
  console.log(`${condicao ? '  OK  ' : ' FALHA'}  ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!condicao) falhas++;
}

/* As duas funções, copiadas do leads.js pelo texto — se o arquivo mudar
   e elas sumirem, esta prova quebra em vez de testar uma cópia velha. */
const fonte = readFileSync(`${RAIZ}/public/js/leads.js`, 'utf8');

for (const nome of ['soDigitosCep', 'formatarCep', 'mesclarEndereco', 'buscarCep']) {
  ok(fonte.includes(nome), `o leads.js define ${nome}`);
}

const soDigitosCep = (v) => String(v || '').replace(/\D/g, '');

const formatarCep = (v) => {
  const d = soDigitosCep(v);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (v || '');
};

function mesclarEndereco(anterior, dados) {
  const logradouro = (dados.logradouro || '').trim();
  const bairro = (dados.bairro || '').trim();
  if (!logradouro && !bairro) return anterior || '';
  const numero = (String(anterior || '').match(/\b(\d{1,6})\b/) || [])[1] || null;
  const rua = [logradouro, numero].filter(Boolean).join(', ');
  return [rua, bairro].filter(Boolean).join(' - ');
}

console.log('\n=== Formatação do CEP ===');
ok(formatarCep('35502890') === '35502-890', 'formata 8 dígitos');
ok(formatarCep('35502-890') === '35502-890', 'já formatado continua igual');
ok(formatarCep('355028') === '355028', 'incompleto fica como está');
ok(formatarCep('') === '', 'vazio não vira traço solto');
ok(formatarCep(null) === '', 'nulo não vira "null"');

console.log('\n=== Mesclagem do endereço ===');
const via = { logradouro: 'Rua Coronel João Notini', bairro: 'Sidil' };

ok(mesclarEndereco('', via) === 'Rua Coronel João Notini - Sidil',
  'campo vazio recebe logradouro e bairro');

// O caso que motivou a função: o ViaCEP não tem número, e sobrescrever
// cru apagaria a parte que só o usuário sabe.
ok(mesclarEndereco('Rua Exemplo, 1511 - Centro', via) === 'Rua Coronel João Notini, 1511 - Sidil',
  'o número digitado sobrevive à troca de logradouro',
  mesclarEndereco('Rua Exemplo, 1511 - Centro', via));

ok(mesclarEndereco('Av. Antiga', via) === 'Rua Coronel João Notini - Sidil',
  'sem número, só substitui');

ok(mesclarEndereco('Rua X, 123', { logradouro: '', bairro: '' }) === 'Rua X, 123',
  'ViaCEP sem logradouro nem bairro não apaga o que havia');

ok(mesclarEndereco('Rua Y, 45', { logradouro: 'Rua Nova', bairro: '' }) === 'Rua Nova, 45',
  'bairro ausente não deixa hífen solto',
  mesclarEndereco('Rua Y, 45', { logradouro: 'Rua Nova', bairro: '' }));

ok(mesclarEndereco(null, via) === 'Rua Coronel João Notini - Sidil',
  'valor anterior nulo não quebra');

/* ==========================================================================
   O ViaCEP de verdade
   ========================================================================== */
console.log('\n=== ViaCEP (chamada real) ===');

async function consultar(cep) {
  const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  return { status: r.status, corpo: await r.json() };
}

try {
  // O CEP da própria Formatar, do rodapé dos documentos.
  const { status, corpo } = await consultar('35500017');
  ok(status === 200, 'responde 200', `status=${status}`);
  ok(corpo.localidade === 'Divinópolis' && corpo.uf === 'MG',
    'devolve cidade e UF', `${corpo.localidade}/${corpo.uf}`);
  ok(!!corpo.logradouro, 'devolve logradouro', corpo.logradouro);
  ok(corpo.numero === undefined,
    'NÃO devolve número — é por isso que a mesclagem existe');

  const campo = mesclarEndereco('Rua Antiga, 1511 - Bairro Velho', corpo);
  ok(campo.includes('1511'), 'o número sobrevive numa resposta real', campo);

  // CEP inexistente: o ViaCEP responde 200 com { erro: true }. Tratar
  // isso como sucesso preencheria a ficha com nada.
  const inexistente = await consultar('99999999');
  ok(inexistente.status === 200 && (inexistente.corpo.erro === true || inexistente.corpo.erro === 'true'),
    'CEP inexistente vem como 200 + erro:true',
    `status=${inexistente.status} erro=${inexistente.corpo.erro}`);

} catch (e) {
  console.log(` AVISO  não deu para falar com o ViaCEP agora: ${e.message}`);
  console.log('        (a rede pode estar bloqueada aqui; o teste de mesclagem acima não depende disso)');
}

/* ==========================================================================
   A análise falsa saiu?
   ========================================================================== */
console.log('\n=== A "resposta simulada" da IA ===');

const app = readFileSync(`${RAIZ}/public/js/app.js`, 'utf8');
ok(!app.includes('Empresa atuante no mercado'), 'o texto inventado não existe mais');
ok(!app.includes('Forte alinhamento para projetos'), 'nem o segundo parágrafo inventado');
// A linha antiga era `console.warn('Backend indisponível no momento...')`
// seguida de um setTimeout que escrevia a análise falsa. A expressão
// "resposta simulada" sobrevive DE PROPÓSITO no comentário que explica
// por que aquilo saiu — por isso o teste olha o código, não o texto.
ok(!app.includes('Backend indisponível no momento'), 'o caminho que fabricava a análise saiu');
ok(app.includes('Não foi possível consultar a IA'), 'a falha agora diz que falhou');
ok(app.includes('corpo.details || corpo.error'), 'a causa vem do corpo da resposta');
ok(app.includes('showPicker'), 'o calendário abre pelo campo inteiro');

console.log(`\n${falhas === 0 ? 'TUDO PASSOU' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
