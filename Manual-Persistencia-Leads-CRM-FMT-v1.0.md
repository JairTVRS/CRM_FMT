# Manual — Persistência de Leads (CRM Formatar)

**Versão:** 1.0
**Data:** 28/08/2026
**Projeto:** CRM_FMT — `https://crm-fmt.pages.dev`
**Versão do sistema:** 2.8.0
**Responsável:** Jair Tavares

---

## 1. O problema que isto resolve

Até aqui os leads **nunca foram gravados em lugar nenhum**. O `app.js` montava as linhas da tabela direto no DOM e não persistia. Qualquer recarregamento da página apagava tudo — o deploy só tornava isso visível porque força o recarregamento.

A partir desta versão, os leads vivem no banco D1 e sobrevivem a recarregamento, deploy e troca de navegador. Vários consultores passam a ver a mesma base.

**Atenção:** o que já se perdeu não é recuperável. Não houve gravação em disco, memória ou banco — não existe backup de onde restaurar.

---

## 2. Instalação

**Passo 1 — Migração do banco** (antes do deploy):

```bash
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-003-leads.sql
```

Confirme:

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```

Deve listar `leads` junto com `dossies` e `cache_cnpj`.

**Passo 2 — Deploy:**

```bash
git add -A
git commit -m "v2.8.0 - Persistencia dos leads em D1"
git push origin main
```

A migração vem primeiro de propósito: se o código subir antes da tabela existir, a listagem falha até a migração rodar.

---

## 3. Arquivos

| Arquivo | Situação |
|---|---|
| `db/migracao-003-leads.sql` | **novo** — tabela `leads` e índices |
| `functions/api/leads.js` | **novo** — CRUD completo |
| `public/js/leads.js` | **reescrito do zero** |
| `public/js/app.js` | salvamento e ações delegados ao `Leads` |
| `public/index.html` | IDs de paginação |
| `package.json` | versão 2.8.0 |

---

## 4. O que mudou no comportamento

**A tabela agora vem do banco.** Recarregar a página não perde nada. Paginação, busca e filtros por ramo e segmento funcionam de verdade — antes existiam na tela mas não faziam nada.

**A busca espera você parar de digitar.** Um atraso de 350 ms evita uma consulta por tecla pressionada.

**A ficha abre completa.** Antes, editar um lead preenchia só quatro campos, porque só isso existia no atributo JSON da linha. Agora o registro vem inteiro do banco, com as três abas.

**Documento duplicado é bloqueado.** Se você tentar cadastrar um CNPJ que já existe, o sistema avisa e informa qual lead o está usando.

**Exclusão é lógica.** O registro sai da listagem mas permanece no banco com `ativo = 0`. Histórico comercial não se apaga sem rastro, e um lead excluído por engano tem volta:

```bash
npx wrangler d1 execute crm-formatar --remote --command="UPDATE leads SET ativo=1 WHERE id=<id>"
```

O documento fica liberado para recadastro após a exclusão — o índice único só considera leads ativos.

**Tudo é auditado.** Cada lead registra quem criou, quando, quem alterou por último e quando.

---

## 5. Decisões técnicas

**O `leads.js` foi reescrito, não recuperado.** O arquivo original era código morto: procurava `tabela-leads-body` enquanto o HTML tem `table-leads-body`, e `search-input` em vez de `input-search-lead`. Nunca renderizou nada. Aproveitar aquilo significaria auditar linha a linha um código que nunca rodou; escrever contra o banco saiu mais limpo.

**Uma fonte só desenha a tabela.** As funções `renderRowContent` e `atualizarContadorTabela` foram removidas do `app.js`. Duas fontes desenhando as mesmas linhas foi o que criou a confusão original entre `app.js` e `leads.js`.

**Lista branca de campos na API.** O endpoint só aceita os quinze campos conhecidos; qualquer coisa a mais no corpo da requisição é descartada. Textos longos são truncados no servidor, não só na tela.

**Nenhuma entrada do usuário entra em SQL por concatenação.** Busca, filtros e paginação usam parâmetros ligados.

**Índice único parcial no documento.** Impede dois cadastros ativos com o mesmo CNPJ, mas não bloqueia recadastro após exclusão nem conflita entre leads sem documento.

**O conteúdo das linhas é escapado.** Nome de lead com `<` ou `&` não quebra a tabela nem injeta HTML.

---

## 6. Verificação

- [ ] Cadastrar um lead → **recarregar a página (F5)** → o lead continua lá
- [ ] Cadastrar o mesmo CNPJ de novo → aviso de duplicidade com o nome do lead existente
- [ ] Editar um lead → todos os campos das três abas vêm preenchidos
- [ ] Buscar por nome → filtra; buscar por CNPJ com máscara → também filtra
- [ ] Filtrar por ramo e segmento juntos → resultado combinado
- [ ] Cadastrar 11 leads → paginação aparece e os botões funcionam
- [ ] Excluir → sai da lista; o mesmo CNPJ pode ser cadastrado de novo
- [ ] Gerar dossiê de um lead → o clipe aparece na linha dele
- [ ] Abrir em outro navegador com outro usuário → mesma base de leads

---

## 7. O que fica pendente

**O `server.js` local não usa o D1.** Ele mantém a persistência em `leads.json` e agora diverge da produção. Como toda a lógica vive nas Functions, a alternativa é rodar o ambiente local com `npx wrangler pages dev public`, que executa as Functions reais contra o D1. Vale conversar sobre aposentar o `server.js`.

**O `setup.js` continua na raiz.** Se rodado por engano, reescreve o `server.js` numa versão Supabase completamente diferente. Sugiro apagar.

---

## 8. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 28/08/2026 | Jair Tavares | Versão inicial. Tabela `leads` em D1, CRUD completo com auditoria e exclusão lógica, `leads.js` reescrito do zero, paginação, busca e filtros funcionais. |
