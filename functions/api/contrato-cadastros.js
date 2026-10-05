/**
 * /api/contrato-cadastros — formas de preço e empresas contratadas
 * (Lote G, 2.40.0).
 *
 * Decidido com o Jair em 05/10/2026:
 *   - só admin cria, edita, inativa e exclui; a leitura é livre (o lead
 *     precisa das opções);
 *   - INATIVA some das opções do lead, mas quem já a usa continua com ela;
 *   - EXCLUIR apaga de verdade, e é recusado se houver lead vinculado —
 *     a mensagem manda inativar.
 *
 * Por isso a coluna é `ativa`, e não o `ativo` das outras tabelas: lá
 * `ativo = 0` é a exclusão lógica; aqui inativar e excluir são duas
 * coisas diferentes, e as duas existem.
 *
 * GET    ?tipo=todos                         as duas listas, com o uso, e os marcadores
 * POST   ?tipo=formas|contratadas            cria
 * PUT    ?tipo=formas|contratadas&id=N       edita; { ativa } sozinho inativa/reativa; { padrao: 1 } troca a padrão
 * DELETE ?tipo=formas|contratadas&id=N       exclui (recusado se em uso)
 */

import { exigirAdmin } from './_lib/admin.js';
import { cnpjValido, cpfValido, soDigitos } from './_lib/documento.js';
import { marcadoresDesconhecidos, listaDeMarcadores } from './_lib/forma-preco.js';
import { lerContratada, ESTADOS_CIVIS } from './_lib/contrato.js';

const TIPOS = ['formas', 'contratadas'];

function json(objeto, status, cabecalhos) {
  return new Response(JSON.stringify(objeto), { status, headers: cabecalhos });
}

const texto = (v, limite) => {
  if (v == null) return null;
  const t = String(v).trim().replace(/[ \t]+/g, ' ');
  return t ? t.slice(0, limite) : null;
};

/** O texto da cláusula guarda as quebras de linha: a linha em branco separa os itens. */
const textoLongo = (v, limite) => {
  if (v == null) return null;
  const t = String(v).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t ? t.slice(0, limite) : null;
};

const SQL_FORMAS = `
  SELECT f.id, f.nome, f.texto, f.ordem, f.ativa,
         (SELECT COUNT(*) FROM leads l WHERE l.forma_preco_id = f.id AND l.ativo = 1) AS em_uso
    FROM formas_preco f
   ORDER BY f.ativa DESC, f.ordem, f.nome COLLATE NOCASE`;

const SQL_CONTRATADAS = `
  SELECT c.id, c.razao_social, c.cnpj, c.endereco, c.cidade, c.cep, c.representantes, c.padrao, c.ativa,
         (SELECT COUNT(*) FROM leads l WHERE l.contratada_id = c.id AND l.ativo = 1) AS em_uso
    FROM contratadas c
   ORDER BY c.padrao DESC, c.ativa DESC, c.razao_social COLLATE NOCASE`;

/* ==========================================================================
   VALIDAÇÃO
   ========================================================================== */

function validarForma(corpo) {
  const nome = texto(corpo.nome, 80);
  const conteudo = textoLongo(corpo.texto, 4000);
  if (!nome) return { erro: 'Informe o nome da forma de preço.' };
  if (!conteudo) return { erro: 'Escreva o texto da cláusula de preço.' };
  const desconhecidos = marcadoresDesconhecidos(conteudo);
  if (desconhecidos.length) {
    return { erro: `Marcador que não existe: ${desconhecidos.map((k) => `{${k}}`).join(', ')}. Use só os da lista abaixo do campo.` };
  }
  return { valor: { nome, texto: conteudo } };
}

function validarRepresentante(r, i) {
  const nome = texto(r?.nome, 120);
  if (!nome) return { erro: `Representante ${i + 1}: informe o nome.` };
  const cpf = soDigitos(r?.cpf).slice(0, 11) || null;
  if (cpf && !cpfValido(cpf)) return { erro: `Representante ${i + 1} (${nome}): o CPF é inválido.` };
  const estado = texto(r?.estado_civil, 40);
  return {
    valor: {
      nome,
      cpf,
      nacionalidade: texto(r?.nacionalidade, 40),
      estado_civil: ESTADOS_CIVIS.includes(estado) ? estado : (estado || null),
      cargo: texto(r?.cargo, 80),
      residencia: texto(r?.residencia, 120)
    }
  };
}

function validarContratada(corpo) {
  const razao = texto(corpo.razao_social, 200);
  const cnpj = soDigitos(corpo.cnpj).slice(0, 14);
  if (!razao) return { erro: 'Informe a razão social.' };
  if (!cnpjValido(cnpj)) return { erro: 'O CNPJ é inválido. Confira os números.' };

  const lista = Array.isArray(corpo.representantes) ? corpo.representantes : [];
  if (lista.length > 4) return { erro: 'No máximo 4 representantes.' };
  const representantes = [];
  for (const [i, r] of lista.entries()) {
    const v = validarRepresentante(r, i);
    if (v.erro) return v;
    representantes.push(v.valor);
  }

  return {
    valor: {
      razao_social: razao,
      cnpj,
      endereco: texto(corpo.endereco, 300),
      cidade: texto(corpo.cidade, 120),
      cep: soDigitos(corpo.cep).slice(0, 8) || null,
      representantes: JSON.stringify(representantes)
    }
  };
}

function lerTipo(searchParams, cabecalhos) {
  const tipo = searchParams.get('tipo');
  if (!TIPOS.includes(tipo)) return { erro: json({ error: 'Tipo inválido.', code: 'TIPO_INVALIDO' }, 400, cabecalhos) };
  return { tipo };
}

const duplicado = (e) => /UNIQUE|constraint/i.test(e?.message || '');

/* ==========================================================================
   GET
   ========================================================================== */

export async function onRequestGet(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  try {
    const [formas, contratadas] = await Promise.all([
      db.prepare(SQL_FORMAS).all(),
      db.prepare(SQL_CONTRATADAS).all()
    ]);
    return json({
      formas: formas.results || [],
      contratadas: (contratadas.results || []).map(lerContratada),
      marcadores: listaDeMarcadores(),
      estadosCivis: ESTADOS_CIVIS
    }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao carregar os cadastros do contrato.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   POST — cria
   ========================================================================== */

export async function onRequestPost(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const { tipo, erro } = lerTipo(searchParams, cabecalhos);
  if (erro) return erro;
  const recusa = await exigirAdmin(context);
  if (recusa) return recusa;

  let corpo;
  try { corpo = await context.request.json(); } catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  const agora = new Date().toISOString();
  try {
    if (tipo === 'formas') {
      const v = validarForma(corpo);
      if (v.erro) return json({ error: v.erro, code: 'INVALIDO' }, 400, cabecalhos);
      const ultima = await db.prepare('SELECT COALESCE(MAX(ordem), 0) AS n FROM formas_preco').first();
      const registro = await db.prepare(
        `INSERT INTO formas_preco (nome, texto, ordem, ativa, criado_por, criado_em)
         VALUES (?, ?, ?, 1, ?, ?) RETURNING id, nome, texto, ordem, ativa`
      ).bind(v.valor.nome, v.valor.texto, Number(ultima?.n || 0) + 1, usuario.email, agora).first();
      return json({ registro: { ...registro, em_uso: 0 } }, 201, cabecalhos);
    }

    const v = validarContratada(corpo);
    if (v.erro) return json({ error: v.erro, code: 'INVALIDO' }, 400, cabecalhos);
    const c = v.valor;
    const registro = await db.prepare(
      `INSERT INTO contratadas (razao_social, cnpj, endereco, cidade, cep, representantes, padrao, ativa, criado_por, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?) RETURNING *`
    ).bind(c.razao_social, c.cnpj, c.endereco, c.cidade, c.cep, c.representantes, usuario.email, agora).first();
    return json({ registro: { ...lerContratada(registro), em_uso: 0 } }, 201, cabecalhos);

  } catch (e) {
    if (duplicado(e)) {
      return json({
        error: tipo === 'formas' ? 'Já existe uma forma de preço com esse nome.' : 'Já existe uma contratada com esse CNPJ.',
        code: 'DUPLICADO'
      }, 409, cabecalhos);
    }
    return json({ error: 'Falha ao criar.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   PUT — edita, inativa/reativa, troca a padrão
   ========================================================================== */

export async function onRequestPut(context) {
  const cabecalhos = context.data.cabecalhos;
  const usuario = context.data.usuario;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const { tipo, erro } = lerTipo(searchParams, cabecalhos);
  if (erro) return erro;
  const recusa = await exigirAdmin(context);
  if (recusa) return recusa;

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID ausente.' }, 400, cabecalhos);

  let corpo;
  try { corpo = await context.request.json(); } catch (e) { return json({ error: 'Corpo inválido.' }, 400, cabecalhos); }

  const tabela = tipo === 'formas' ? 'formas_preco' : 'contratadas';
  const atual = await db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).bind(id).first();
  if (!atual) return json({ error: 'Registro não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);
  const agora = new Date().toISOString();

  try {
    // --- Contratada padrão: só uma; a padrão tem que estar ativa ---
    if (tipo === 'contratadas' && corpo.padrao) {
      if (!atual.ativa) return json({ error: 'Reative a contratada antes de torná-la padrão.', code: 'INATIVA' }, 409, cabecalhos);
      await db.batch([
        db.prepare('UPDATE contratadas SET padrao = 0 WHERE padrao = 1 AND id <> ?').bind(id),
        db.prepare('UPDATE contratadas SET padrao = 1, atualizado_por = ?, atualizado_em = ? WHERE id = ?').bind(usuario.email, agora, id)
      ]);
      return json({ ok: true }, 200, cabecalhos);
    }

    // --- Inativar / reativar ---
    if (corpo.ativa !== undefined && Object.keys(corpo).length === 1) {
      const ativa = corpo.ativa ? 1 : 0;
      if (!ativa && tipo === 'contratadas' && atual.padrao) {
        return json({ error: 'Esta é a contratada padrão. Torne outra padrão antes de inativar esta.', code: 'PADRAO' }, 409, cabecalhos);
      }
      await db.prepare(`UPDATE ${tabela} SET ativa = ?, atualizado_por = ?, atualizado_em = ? WHERE id = ?`)
        .bind(ativa, usuario.email, agora, id).run();
      return json({ ok: true }, 200, cabecalhos);
    }

    // --- Edição completa ---
    if (tipo === 'formas') {
      const v = validarForma(corpo);
      if (v.erro) return json({ error: v.erro, code: 'INVALIDO' }, 400, cabecalhos);
      await db.prepare('UPDATE formas_preco SET nome = ?, texto = ?, atualizado_por = ?, atualizado_em = ? WHERE id = ?')
        .bind(v.valor.nome, v.valor.texto, usuario.email, agora, id).run();
    } else {
      const v = validarContratada(corpo);
      if (v.erro) return json({ error: v.erro, code: 'INVALIDO' }, 400, cabecalhos);
      const c = v.valor;
      await db.prepare(
        `UPDATE contratadas SET razao_social = ?, cnpj = ?, endereco = ?, cidade = ?, cep = ?, representantes = ?,
                atualizado_por = ?, atualizado_em = ? WHERE id = ?`
      ).bind(c.razao_social, c.cnpj, c.endereco, c.cidade, c.cep, c.representantes, usuario.email, agora, id).run();
    }
    return json({ ok: true }, 200, cabecalhos);

  } catch (e) {
    if (duplicado(e)) {
      return json({
        error: tipo === 'formas' ? 'Já existe uma forma de preço com esse nome.' : 'Já existe uma contratada com esse CNPJ.',
        code: 'DUPLICADO'
      }, 409, cabecalhos);
    }
    return json({ error: 'Falha ao salvar.', details: e.message }, 500, cabecalhos);
  }
}

/* ==========================================================================
   DELETE — só sem lead vinculado
   ========================================================================== */

export async function onRequestDelete(context) {
  const cabecalhos = context.data.cabecalhos;
  const db = context.env.DB;
  const { searchParams } = new URL(context.request.url);
  if (!db) return json({ error: 'Banco de dados não configurado.', code: 'SEM_BINDING' }, 500, cabecalhos);

  const { tipo, erro } = lerTipo(searchParams, cabecalhos);
  if (erro) return erro;
  const recusa = await exigirAdmin(context);
  if (recusa) return recusa;

  const id = Number(searchParams.get('id'));
  if (!id) return json({ error: 'ID ausente.' }, 400, cabecalhos);

  const tabela = tipo === 'formas' ? 'formas_preco' : 'contratadas';
  const coluna = tipo === 'formas' ? 'forma_preco_id' : 'contratada_id';

  try {
    const atual = await db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).bind(id).first();
    if (!atual) return json({ error: 'Registro não encontrado.', code: 'NAO_ENCONTRADO' }, 404, cabecalhos);

    if (tipo === 'contratadas' && atual.padrao) {
      return json({ error: 'Esta é a contratada padrão: não pode ser excluída. Torne outra padrão antes.', code: 'PADRAO' }, 409, cabecalhos);
    }

    // Lead excluído não conta: ninguém mais o vê para trocar a escolha, e
    // contá-lo travaria a exclusão para sempre. Contratos já gerados
    // guardam o texto como foi — não dependem da linha.
    const uso = await db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE ${coluna} = ? AND ativo = 1`).bind(id).first();
    const n = Number(uso?.n || 0);
    if (n > 0) {
      const oque = tipo === 'formas' ? 'Esta forma de preço' : 'Esta contratada';
      return json({
        error: `${oque} está vinculada a ${n} lead(s) e não pode ser excluída. Inative-a para tirá-la das opções.`,
        code: 'EM_USO', quantidade: n
      }, 409, cabecalhos);
    }

    await db.prepare(`DELETE FROM ${tabela} WHERE id = ?`).bind(id).run();
    return json({ ok: true, id }, 200, cabecalhos);
  } catch (e) {
    return json({ error: 'Falha ao excluir.', details: e.message }, 500, cabecalhos);
  }
}
