# CRM Formatar — instruções para o agente

<!-- BEGIN SKILL_AGENTS_IA_EDITOR -->
<!-- versão: 1.3 -->
## Autonomia e permissões

**Autonomia de desenvolvimento:** ao receber uma tarefa, identifique o repositório e as instruções existentes; execute em sequência leitura, edição normal, testes e validações autorizadas. Não interrompa para pedir decisões técnicas rotineiras já delegadas. Prefira ferramentas nativas, comandos simples (um por chamada, sem encadeamentos desnecessários) e as rotinas revisadas do projeto. Não fixe caminhos absolutos, portas ou endereços: descubra-os na configuração do projeto. Não presuma que caminho temporário ou script dinâmico esteja autorizado. Respeite todas as confirmações técnicas do agente. Para ações destrutivas, publicações, alterações externas, segredos ou mudanças fora do escopo, explique impacto, risco e reversão e peça aprovação explícita. Não altere nem contorne configurações de segurança por conta própria. Ao finalizar, informe o que foi feito, testes, pendências e permissões que ainda interrompem o fluxo.

### Como trabalhar sem pedidos de permissão desnecessários

- Editar arquivos com as ferramentas Edit/Write; nunca com `sed -i` ou substituição via PowerShell.
- Ler e buscar com Read/Grep/Glob, em vez de `Get-Content`, `Select-String` ou `cat`.
- Um comando por chamada. Compostos (`;`, `&&`, `|`, `foreach`) só passam direto se cada parte estiver liberada.
- Portas e endereços vêm da configuração do projeto (`package.json`, `wrangler.toml`, `.env.example`), não de valores lembrados de outra sessão.
- Provas que se repetem ficam em `dev/prova/` e rodam com `npm run prova` ou `node dev/prova/<arquivo>.mjs`. O scratchpad serve só para descartáveis: cada caminho novo pede permissão.
- Banco local: `npm run db:local -- ...` ou `npx wrangler d1 execute crm-formatar --local ...`.
- Servidor local: `npm run dev` em segundo plano. Para parar: encerrar a tarefa em segundo plano, ou `node dev/para-servidor.mjs` (lê a porta do `package.json`, só encerra o `node` que escuta nela). Não usar `Stop-Process`/`taskkill` soltos.
- Versão: `npm run versao <x.y.z>` (sem commit nem tag). Não usar `npm version` direto.
- Branch nova: `git switch --create <nome>`. As formas `-c`, `-C` e `--force-create` pedem confirmação.
- `git add` só com os arquivos nomeados, depois de `git status --short`. Nunca `git add -A`, `git add --all` nem `git add .`: `docs/` e as planilhas têm dado de cliente.

### Sempre com confirmação (produção e itens sensíveis)

- `git push`: o Cloudflare Pages publica a `main` em produção.
- `npm run db:remoto` e qualquer `wrangler ... --remote`: D1 de produção.
- `wrangler deploy` / `wrangler pages deploy`, `wrangler secret`, `wrangler login`.
- `git restore --worktree`, `git switch --discard-changes`/`--force`, `git reset --hard`, `git clean`.
- Editar `.env*`, `.dev.vars`, `wrangler.toml`, `.gitignore` ou `.claude/`.

As permissões ficam em `.claude/settings.local.json` (fora do Git). Até 26/11/2026, os pedidos que ainda aparecem são registrados em `.claude/permission-decisions.jsonl`.
<!-- END SKILL_AGENTS_IA_EDITOR -->
