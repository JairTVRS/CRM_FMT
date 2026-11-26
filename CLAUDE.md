# CRM Formatar — instruções para o agente

<!-- BEGIN SKILL_AGENTS_IA_EDITOR -->
<!-- versão: 1.4 | instalada: 2026-11-23 | revisada: 2026-11-26 -->
## Autonomia e permissões

**Autonomia de desenvolvimento:** ao receber uma tarefa, identifique o repositório e as instruções existentes; execute em sequência leitura, edição normal, testes e validações autorizadas. Não interrompa para pedir decisões técnicas rotineiras já delegadas. Prefira ferramentas nativas, comandos simples (um por chamada, sem encadeamentos nem prefixo de variável) e as rotinas revisadas do projeto. Não fixe caminhos absolutos, portas ou endereços: descubra-os na configuração do projeto. Não presuma que caminho temporário ou script dinâmico esteja autorizado. Respeite todas as confirmações técnicas do agente. Não mexa em credenciais nem em contas Git; em caso de erro de autenticação, oriente o usuário. Para ações destrutivas, publicações, alterações externas, segredos ou mudanças fora do escopo, explique impacto, risco e reversão e peça aprovação explícita. Não altere nem contorne configurações de segurança por conta própria. Ao finalizar, informe o que foi feito, testes, pendências e permissões que ainda interrompem o fluxo.

### Como trabalhar sem pedidos de permissão desnecessários

- Editar arquivos com as ferramentas Edit/Write; nunca com `sed -i` ou substituição via PowerShell.
- Ler e buscar com Read/Grep/Glob, em vez de `Get-Content`, `Select-String` ou `cat`.
- Um comando por chamada. Compostos (`;`, `&&`, `|`, `foreach`) só passam direto se cada parte estiver liberada.
- Sem prefixo de variável (`VAR=x comando`, `$env:VAR = ...; comando`): não casa com as regras. Exceção: `HUB_STUB_PORTA` para as provas, só quando a porta padrão do dublê estiver ocupada (pede confirmação).
- Portas e endereços vêm da configuração do projeto (`package.json`, `wrangler.toml`, `.env.example`, `dev/porta-hub.mjs`), não de valores lembrados de outra sessão.
- Provas que se repetem ficam em `dev/prova/` e rodam com `npm run prova` ou `node dev/prova/<arquivo>.mjs`. O scratchpad serve só para descartáveis: cada caminho novo pede permissão.
- Banco local: `npm run db:local -- ...` ou `npx wrangler d1 execute crm-formatar --local ...`.
- Servidor local: `npm run dev:hub` e `npm run dev` em segundo plano (o `dev` usa o banco local completo em `.wrangler/local-2361`). Para parar: encerrar a tarefa em segundo plano, ou `node dev/para-servidor.mjs` (lê a porta do `package.json`, só encerra o `node` que escuta nela). Não usar `Stop-Process`/`taskkill` soltos.
- Esperar o servidor subir: `node dev/espera-servidor.mjs` (ou `--hub` para o dublê). Conferir uma rota local: `node dev/confere-local.mjs /rota`. Captura de tela: `node dev/captura.mjs /rota <largura> <altura> <nome>`, que salva em `dev/capturas/` (no celular, largura 500: o Edge sem janela não desenha abaixo disso). Nada de laços com `sleep`, `curl` solto ou navegador direto.
- O Bash já começa na raiz do projeto: sem `cd` no início, sem `echo`/`wc`/heredoc no meio dos comandos e sem script no scratchpad.
- Versão: `npm run versao <x.y.z>` (sem commit nem tag). Não usar `npm version` direto.
- Branch nova: `git switch --create <nome>`. As formas `-c`, `-C` e `--force-create` pedem confirmação.
- `git add` só com os arquivos nomeados, depois de `git status --short`. Nunca `git add -A`, `git add --all`, `git add .` nem `git add -f`/`--force`: `docs/` e as planilhas têm dado de cliente.
- Mensagem de commit começa pela versão do `package.json`: `vX.Y.Z - descrição`.

### Escopo das permissões

- Liberações novas ficam em `.claude/settings.local.json` (fora do Git), nunca no global (`~/.claude/settings.json`), que só tem proteções.
- Não editar o global durante a sessão. Se precisar mudar, preparar o conteúdo completo para o usuário aplicar com o editor fechado.
- Não alterar outro projeto a partir desta sessão.
- Nos pedidos de permissão, responder "Yes" ou "este projeto", nunca "todos os projetos" (grava regra literal no global e vaza para os outros projetos).

### Sempre com confirmação (produção e itens sensíveis)

- `git push`: o Cloudflare Pages publica a `main` em produção.
- `npm run db:remoto` e qualquer `wrangler ... --remote`: D1 de produção.
- `wrangler deploy` / `wrangler pages deploy`, `wrangler secret`, `wrangler login`.
- `git restore --worktree`, `git switch --discard-changes`/`--force`, `git reset --hard`, `git clean`, `git add -f`.
- Editar `.env*`, `.dev.vars`, `wrangler.toml` (raiz e `workers/`), `.gitignore`, `.claude/`, `.git/`, `package.json` ou as rotinas `dev/para-servidor.mjs`, `dev/espera-servidor.mjs`, `dev/confere-local.mjs` e `dev/captura.mjs`.
<!-- END SKILL_AGENTS_IA_EDITOR -->
