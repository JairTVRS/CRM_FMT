# Manual de Implantação — Login Google e Proteção da API (CRM Formatar)

**Versão:** 1.0
**Data:** 26/08/2026
**Projeto:** CRM_FMT — `https://crm-fmt.pages.dev`
**Responsável:** Jair Tavares

---

## 1. O que esta entrega faz

Fecha a Fase 4 do procedimento de segurança: o endpoint `/api/enrich-lead`, que hoje aceita requisição de qualquer origem sem credencial, passa a exigir autenticação.

O modelo adotado:

1. A pessoa entra com a conta Google (qualquer conta — não há restrição de domínio).
2. O navegador recebe um **ID token** e o envia em toda chamada à API.
3. O servidor **valida o token** (assinatura RSA contra as chaves públicas do Google, `aud`, `iss`, `exp`, e-mail verificado).
4. Com o e-mail em mãos, o servidor consulta o **hub da Formatar** e verifica se existe cadastro com `isActive: true`.
5. Só então a requisição chega ao endpoint.

Desligar o `isActive` no hub corta o acesso do usuário em até 5 minutos (tempo do cache). Nenhum cadastro paralelo precisa ser mantido.

> **Ponto importante:** a tela de login que aparece no navegador é conveniência visual. Quem barra o acesso de verdade é o `_middleware.js`, no servidor, que revalida tudo a cada requisição. Esconder a interface nunca protegeria a API.

---

## 2. Arquivos da entrega

Extrair na raiz do repositório (`C:\Users\Formatar\Desktop\crm_leads`), sobrescrevendo o que já existe.

| Arquivo | Situação | O que faz |
|---|---|---|
| `functions/api/_middleware.js` | **novo** | Guarda de autenticação de todas as rotas `/api/*` |
| `functions/api/config.js` | **novo** | Rota pública que entrega o Client ID ao frontend |
| `functions/api/me.js` | **novo** | Devolve o usuário logado |
| `functions/api/enrich-lead.js` | reescrito | CORS restrito; usa a autenticação do middleware |
| `public/js/auth.js` | **novo** | Login com Google Identity Services e injeção do token |
| `public/assets/css/auth.css` | **novo** | Estilos da tela de login (não altera o `main.css`) |
| `public/index.html` | reescrito | Overlay de login, scripts e identificação do usuário |
| `server.js` | reescrito | Mesma autenticação em desenvolvimento local |
| `.env.example` | atualizado | Novas variáveis `GOOGLE_CLIENT_ID` e `HUB_API_KEY` |

**Apagar após extrair:**

```bash
git rm functions/api/users.js
```

Esse arquivo nunca funcionou — apontava para `/api/users`, que não existe no hub (o caminho correto é `/v1/users`), e chamava sem credencial. A consulta ao hub agora acontece dentro do middleware, com a Secret Key. Ele ficou obsoleto.

---

## 3. Configuração

### 3.1 Google Cloud Console

1. Acesse **console.cloud.google.com** → selecione ou crie um projeto.
2. Vá em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**.
3. Tipo de aplicativo: **Aplicativo da Web**. Nome sugerido: `CRM Formatar`.
4. Em **Origens JavaScript autorizadas**, adicione exatamente estas três:

```
https://crm-fmt.pages.dev
http://localhost:3000
http://127.0.0.1:3000
```

5. **URIs de redirecionamento**: deixe em branco. O fluxo usado não redireciona.
6. Copie o **Client ID** gerado (termina em `.apps.googleusercontent.com`).

Se for a primeira vez no projeto, o Google pede para configurar a **Tela de permissão OAuth** antes. Tipo **Externo**, preencha nome do app, e-mail de suporte e e-mail do desenvolvedor. Não precisa publicar nem passar por verificação: sem escopos sensíveis, o app funciona em modo de teste para qualquer conta.

### 3.2 Hub da Formatar

Gere uma **Secret Key** com a permissão `hub:users:read`. Ela será usada só pelo servidor.

### 3.3 Cloudflare Pages

Painel → projeto **crm-fmt** → **Settings → Environment variables → Add variable**. Marque **Production** e **Preview** em cada uma:

| Nome | Tipo | Valor |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Texto | Client ID do passo 3.1 |
| `HUB_API_KEY` | **Secret (encrypted)** | Secret Key do passo 3.2 |
| `DEEPSEEK_API_KEY` | **Secret (encrypted)** | A chave nova, gerada após a revogação |

As variáveis só passam a valer **depois de um novo deploy**. Faça um `git push` ou use *Retry deployment* no painel.

### 3.4 Desenvolvimento local

> **Desatualizado desde a migração para o Cloudflare.** Este manual mandava
> preencher o `.env` e rodar `npm start`. O `server.js` **não serve as rotas
> das Functions** — quem serve é o Wrangler, e ele lê `.dev.vars`, não `.env`.
> O procedimento correto está na **seção 7 do
> `Manual-Jornada-Lote-H-CRM-FMT-v1.0.md`**.

Em resumo: as variáveis do painel da Cloudflare valem para o **site
publicado**. Rodando local, o código roda na sua máquina e a Cloudflare
não participa — por isso o `.dev.vars`, que é o equivalente local daquele
painel.

**O `HUB_API_KEY` não pode ser copiado do painel.** Ele é cadastrado como
*Secret (encrypted)*, e segredo na Cloudflare é de mão única: grava e
nunca devolve. Para o ambiente local, gere uma Secret Key nova no hub com
permissão `hub:users:read` (passo 3.2) — de preferência uma só para
desenvolvimento, que possa ser revogada sem tocar na de produção.

O `GOOGLE_CLIENT_ID` é do tipo *Texto* e não é segredo: aparece no painel
e também na resposta pública de `GET /api/config`.

---

## 4. Verificação

Depois do deploy, teste nesta ordem:

- [ ] Abrir `https://crm-fmt.pages.dev` → aparece a tela de login, e o app fica oculto
- [ ] Entrar com uma conta cadastrada e ativa no hub → o CRM abre, e o nome aparece no rodapé da barra lateral
- [ ] Entrar com uma conta Google sem cadastro → mensagem informando que não há acesso liberado
- [ ] Inativar seu usuário no hub, aguardar 5 minutos, recarregar → o acesso é recusado
- [ ] Chamar a API sem token → deve responder **401**:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Content-Type: application/json" -d '{"nome":"Teste"}' \
  https://crm-fmt.pages.dev/api/enrich-lead
```

Esse último é o teste que importa: era exatamente assim que qualquer pessoa consumia suas chaves de IA.

---

## 5. Como diagnosticar problemas

Toda recusa vem com um campo `code` no JSON, para localizar a causa rápido.

| `code` | Status | Significado | O que fazer |
|---|---|---|---|
| `TOKEN_AUSENTE` | 401 | Requisição sem `Authorization` | Normal fora do app; dentro dele, indica sessão perdida |
| `TOKEN_INVALIDO` | 401 | Assinatura, `aud`, `iss` ou `exp` reprovados | Conferir se o `GOOGLE_CLIENT_ID` do servidor é o mesmo do frontend |
| `SEM_CADASTRO` | 403 | E-mail sem registro no hub | Cadastrar a pessoa no hub |
| `INATIVO` | 403 | Cadastro existe, `isActive: false` | Reativar no hub |
| `HUB_CREDENCIAL` | 500 | Hub recusou a Secret Key | Chave inválida, bloqueada ou sem `hub:users:read` |
| `HUB_LIMITE` | 429 | Rate limit do hub | Aguardar; o cache de 5 min já reduz muito a frequência |
| `HUB_INDISPONIVEL` | 503 | Hub fora do ar | Repetir depois |
| `CONFIG_AUSENTE` | 500 | Falta variável de ambiente | Conferir o passo 3.3 e refazer o deploy |

**Erro comum:** se o botão do Google não aparecer, quase sempre é a origem não cadastrada no OAuth Client. O console do navegador mostra algo sobre origem não permitida. Confira o passo 3.1 — inclusive o `https://` e a ausência de barra no final.

---

## 6. Decisões técnicas

**Google Identity Services, não a biblioteca antiga.** O guia que originou a conversa usa `platform.js` / `gapi.auth2`, cujo suporte foi encerrado pelo Google. Esta implementação usa `accounts.google.com/gsi/client`, a geração atual.

**Interceptação global do `fetch`.** O `auth.js` embrulha o `window.fetch` e injeta o header `Authorization` em toda chamada para `/api/`. Por isso `app.js`, `leads.js` e `configuracoes.js` **não precisaram ser alterados** — menos risco de regressão nesta entrega.

**Middleware em vez de checagem por endpoint.** O `_middleware.js` do Cloudflare Pages roda antes de qualquer função sob `/api/`. Assim, endpoints novos nascem protegidos por padrão, em vez de depender de alguém lembrar de adicionar a verificação.

**Caches em memória.** As chaves públicas do Google ficam 1 hora em cache; o resultado da consulta ao hub, 5 minutos por e-mail. Sem isso, cada clique geraria duas chamadas externas e esbarraria no rate limit do hub. O efeito colateral é a latência de até 5 minutos ao inativar alguém — aceitável para o caso de uso.

**Correções aproveitadas no `server.js`.** A reescrita também consertou três defeitos que existiam antes: o provedor de IA escolhido era ignorado (chamava OpenAI sempre), `ramos.json` e `segmentos.json` eram procurados na raiz em vez de `data/`, e o formato da resposta do enriquecimento divergia do que o frontend espera. Agora o comportamento local é igual ao de produção.

---

## 7. O que esta entrega não resolve

**Qualquer pessoa com conta Google chega até a validação.** Conforme sua decisão, não há filtro por domínio. O cadastro no hub é o que barra — mas quem não tem cadastro ainda consome uma consulta ao hub por tentativa. Não há custo de IA envolvido, então o risco é baixo.

**Não há teto de uso por usuário.** Um usuário legítimo e ativo pode disparar quantos enriquecimentos quiser. Se isso virar preocupação, o caminho é um contador diário em Cloudflare KV, chaveado por e-mail.

**Os leads continuam sem persistência em produção.** O Cloudflare não tem banco; o `app.js` mantém tudo em memória e perde no F5. É o item 2 do plano original, ainda em aberto.

---

## 8. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 26/08/2026 | Jair Tavares | Versão inicial. Login com Google Identity Services, validação de ID token no servidor, autorização via `isActive` no hub da Formatar, CORS restrito a `crm-fmt.pages.dev` e `localhost`, e alinhamento do `server.js` ao comportamento de produção. |
