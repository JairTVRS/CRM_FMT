# Versão do sistema — fonte única

**Versão deste documento:** 1.0 · 27/08/2026

## O problema

A versão estava em três lugares independentes: a constante `APP_VERSION`
no `app.js`, um comentário no cabeçalho do mesmo arquivo e a mensagem de
commit. Nada mantinha os três em sincronia, e eles divergiram na prática —
o rodapé exibia `v2.5.22` com o código já em `v2.6.1`.

## Como ficou

O `package.json` passa a ser a única fonte. O caminho é:

```
package.json  →  /api/config  →  auth.js  →  rodapé
```

O `/api/config` já era buscado no arranque para obter o Client ID do
Google, então não há requisição extra. O `server.js` local lê o mesmo
arquivo, e o comportamento é idêntico em desenvolvimento e produção.

## Como subir a versão

Um comando, na raiz do projeto:

```bash
npm version 2.7.1 --no-git-tag-version
```

Ou, usando o atalho registrado no `package.json`:

```bash
npm run versao 2.7.1
```

O `--no-git-tag-version` evita que o npm crie commit e tag por conta
própria — você continua commitando à mão, seguindo a convenção de
prefixar a mensagem com a versão.

Fluxo completo:

```bash
npm version 2.7.1 --no-git-tag-version
git add -A
git commit -m "v2.7.1 - Descricao da mudanca"
git push origin main
```

## Identificação do build

Em produção o rodapé mostra apenas a versão (`v2.7.0`).

Em deploys de preview, mostra também a branch e o commit
(`v2.7.0 · minha-branch@a1b2c3d`), lendo `CF_PAGES_BRANCH` e
`CF_PAGES_COMMIT_SHA`, que o Cloudflare injeta em cada build. Passar o
mouse sobre o rodapé exibe o commit em qualquer ambiente.

Serve para eliminar a dúvida de "qual build está no ar" quando algo se
comporta de forma inesperada.

## Arquivos alterados

| Arquivo | O que mudou |
|---|---|
| `package.json` | Versão para 2.7.0; script `versao` |
| `functions/api/config.js` | Importa o `package.json`; devolve versão, commit e ambiente |
| `public/js/auth.js` | Publica `window.CRM_CONFIG` e escreve o rodapé |
| `public/js/app.js` | Constante `APP_VERSION` removida |
| `server.js` | Lê o `package.json`; marca ambiente como `local` |

## Ponto de atenção

O `config.js` usa `import pkg from '../../package.json'`. O empacotador
do Cloudflare Pages resolve importação de JSON, mas isso não foi testado
em produção — só localmente. **Confira o rodapé logo após o primeiro
deploy.** Se a versão não aparecer, o build terá falhado nessa
importação, e a alternativa é gerar um `public/js/versao.js` a partir do
`package.json` antes do commit.
