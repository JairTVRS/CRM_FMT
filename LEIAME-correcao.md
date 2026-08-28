# Correção — tabela de leads presa em erro de carregamento (v2.8.3)

**Data:** 28/08/2026

## Sintoma

A tabela exibia "Não foi possível carregar os leads" mesmo com os leads
gravados no banco. Parecia perda de cadastro, mas era falha de leitura:
o dado estava lá o tempo todo.

## Causa

Questão de ordem, não de dados.

O `leads.js` carregava a tabela no `DOMContentLoaded`. Esse evento
dispara assim que o HTML termina de ser lido — **antes de o login do
Google concluir**. Naquele instante o `auth.js` ainda não tem token, e o
`fetch` interceptado devolve um 401 sintético em vez de chamar o
servidor.

O `leads.js` recebia esse 401, caía no bloco de erro e mostrava a
mensagem. Quando a autenticação terminava segundos depois, ninguém
mandava recarregar a tabela — ela ficava congelada no erro até um F5,
que reiniciava o mesmo ciclo.

Isso explica por que a mesma chamada funcionava no console do navegador:
ali o usuário já estava autenticado.

## Correção

O `auth.js` passa a anunciar `crm:autenticado` quando a sessão é
validada pelo servidor, e o `leads.js` carrega a tabela ao ouvir esse
evento em vez de no `DOMContentLoaded`.

Os controles da tela (busca, filtros, paginação) continuam sendo ligados
no `DOMContentLoaded` — só o carregamento de dados espera.

O ouvinte usa `{ once: true }`: se o token for renovado mais tarde, a
tabela não recarrega do zero sem motivo.

## Detalhe de projeto

O evento é disparado apenas no ramo de sucesso do `verificarAcesso`,
depois do `/api/me` responder 200. Não dispara quando o usuário
autentica no Google mas não tem cadastro ativo no hub (403), nem quando
o servidor está fora do ar. Nesses casos a tabela não deve tentar
carregar mesmo.

Qualquer módulo futuro que precise de dados no arranque deve ouvir
`crm:autenticado` em vez de `DOMContentLoaded`.

## Arquivos

| Arquivo | O que mudou |
|---|---|
| `public/js/auth.js` | Dispara `crm:autenticado` após validar a sessão |
| `public/js/leads.js` | Carrega a tabela ao ouvir o evento |
| `package.json` | 2.8.3 |
