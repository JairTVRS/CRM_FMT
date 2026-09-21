# Manual — v2.27.0: a sessão de 7 dias

**Versão:** 1.0
**Data:** 21/09/2026
**Versão do sistema:** 2.27.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Um segredo novo na Cloudflare, ANTES do deploy:** `SESSAO_SECRET`.
É ele que assina o cookie. Qualquer valor aleatório e longo serve; nunca
precisa ser lido de volta.

```
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" | npx wrangler pages secret put SESSAO_SECRET --project-name crm-fmt
```

Conferir: `npx wrangler pages secret list --project-name crm-fmt` lista
`SESSAO_SECRET`.

**Sem o segredo, nada quebra:** o CRM se comporta como antes, pedindo
login a cada recarga. **Trocar o segredo desconecta todo mundo** — é o
botão de emergência se um cookie vazar.

Sem migração: a sessão não usa tabela.

---

## 2. O que mudou

Pedido em 11/09/2026 (Lote 4, opção B) e de novo em 21/09: "toda vez que
recarrego o app fecha".

**A causa:** o login do Google entrega um token que vive ~1 hora e só
existia na memória da página. F5 apagava a memória. E o front respondia
"sessão não iniciada" sem nem mandar a requisição ao servidor
(`auth.js:258` na 2.26.0) — então nenhuma solução só no servidor teria
funcionado.

**Agora:**

- No login com o Google, o servidor devolve um cookie `crm_sessao`
  assinado (HMAC-SHA-256), válido por **7 dias**.
- Ao abrir ou recarregar o CRM, a página pergunta ao `/api/me` só com o
  cookie. Se vale, o app abre direto — sem tela de login, sem Google.
- **O cookie se renova a cada abertura.** Quem usa o CRM todo dia não sai
  nunca; quem fica 7 dias sem abrir entra de novo.
- **Sair** apaga o cookie (`POST /api/sair`).

### O que continua protegendo

- **O ERP continua mandando.** A cada requisição o servidor confere no hub
  se o e-mail está ativo (cache de 5 minutos, como sempre). Desativar
  alguém no ERP tira o acesso em até 5 minutos, com ou sem cookie.
- **O cookie é HttpOnly**: nenhum script da página o lê.
- **Secure, SameSite=Strict, Path=/api**: só em HTTPS, só para a API, e
  nunca numa requisição que nasceu noutro site.
- **Adulterar invalida**: trocar o e-mail dentro do cookie quebra a
  assinatura. Cookie vencido, forjado ou de outra chave volta ao login.

### De quebra

O `renovando` do login ficava `true` para sempre quando o One Tap do
Google não aparecia (cooldown), e o token nunca mais era renovado.
Corrigido — e com o cookie, a renovação do token deixou de ser
necessária.

---

## 3. Arquivos

| Arquivo | O quê |
|---|---|
| `functions/api/_lib/sessao.js` | **Novo.** Assina, lê e confere o cookie |
| `functions/api/_middleware.js` | Aceita o cookie quando não há token; emite/renova no `/api/me` |
| `functions/api/me.js` | Devolve `sessao.ate` |
| `functions/api/sair.js` | **Novo.** Apaga o cookie |
| `public/js/auth.js` | Tenta o cookie antes do Google; manda requisição sem token quando o cookie vale |
| `dev/prova/sessao-cookie.mjs` | **Nova.** 25 conferências |

---

## 4. Como verificar

1. Entrar uma vez com o Google.
2. **F5.** O CRM abre direto, sem tela de login.
3. Fechar o navegador, abrir de novo: continua dentro.
4. **Sair**, depois F5: pede login.

O que não consegui exercitar daqui: o token real do Google (a prova usa o
cookie direto, e o caminho do token é o mesmo de antes) e o navegador de
verdade guardando o cookie.
