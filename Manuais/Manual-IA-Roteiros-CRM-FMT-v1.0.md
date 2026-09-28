# Manual — v2.34.0: chaves de IA e roteiros de reunião

**Versão:** 1.0
**Data:** 28/09/2026
**Versão do sistema:** 2.34.0
**Responsável:** Jair Tavares

Quarta entrega do lote da jornada do lead. Prepara a gravação e a
transcrição (2.35.0) e os insights durante a reunião (2.36.0): a IA
passa a ser configurada num lugar só, e cada tipo de reunião ganha o seu
roteiro.

---

## 1. Instalação (feita em 28/09/2026)

**1. Migração 019**, antes do deploy (segura de rodar duas vezes):

```
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-019-ia-e-roteiros.sql
```

**2. O segredo `CHAVES_SECRET`** no Pages — é com ele que as chaves
cadastradas pela tela ficam cifradas no banco:

```
npx wrangler pages secret put CHAVES_SECRET --project-name crm-fmt
```

O valor não está no repositório. **Não troque sem motivo:** trocado, as
chaves cadastradas pela tela deixam de decifrar (aparecem como "Sem
chave") e precisam ser cadastradas de novo. As do painel não são afetadas.

**3. Workers AI — um passo seu, para a 2.35.0.** No painel da
Cloudflare: **Workers & Pages → crm-fmt → Settings → Bindings → Add →
Workers AI**, nome da variável **`AI`**. Depois, um novo deploy (o
próximo push). As Configurações dizem "Workers AI: ligado" quando der
certo. É a transcrição grátis para os testes; sem ela a 2.35.0 precisa de
uma chave paga.

---

## 2. O que mudou

### 2.1 Um cartão só: "Inteligência artificial"

Em **Configurações**, o provedor e as chaves ficam juntos:

- **Provedor em uso** — vale para **todos**: o dossiê, o dossiê de
  experiência e o enriquecimento do lead. Só admin muda.
- **As chaves**, uma linha por provedor:
  - **Painel da Cloudflare** — cadastrada lá; vale primeiro;
  - **Cadastrada no CRM ••••1a2b** — cadastrada aqui pelo admin;
  - **Sem chave**.
- O admin **cola a chave e salva**. Ela fica **cifrada** no banco e
  **nunca volta para a tela** — só os 4 últimos caracteres. **Remover**
  apaga a do CRM (a do painel só se apaga no painel).

### 2.2 Três defeitos que saíram junto

| Antes | Agora |
|---|---|
| A escolha do provedor ficava **no navegador de cada um** | Fica no servidor e vale para todos |
| Ela começava em **ChatGPT**, que não tinha chave — o enriquecimento falhava para quem nunca abriu as Configurações | Sem escolha, usa o primeiro provedor que tem chave |
| O **dossiê ignorava** a escolha e usava sempre DeepSeek | O dossiê usa o provedor em uso |

Se o escolhido ficar sem chave, a tela diz qual está em uso de fato.

### 2.3 Roteiros de reunião

Em **Configurações → Roteiros de reunião**, cada tipo de reunião do Time
Vendas (hub) aparece com o roteiro em vigor:

- **Enviar .md** (admin) — o arquivo com os objetivos e as perguntas da
  reunião. Enviar de novo cria a **versão seguinte**; as anteriores
  continuam consultáveis.
- **Ver** — abre o texto, com o seletor de versões.

Na **reunião da agenda**, abaixo do tipo, aparece "Roteiro: versão N —
**Ver o roteiro**", para o CX estudar junto com o dossiê.

A IA ainda não lê o roteiro: isso é a 2.36.0 (insights durante a
reunião). Aqui ele é guardado, versionado e mostrado.

---

## 3. Arquivos

| Arquivo | O quê |
|---|---|
| `db/migracao-019-ia-e-roteiros.sql` | `chaves_ia` (cifradas), `config_geral` (provedor em uso), `roteiros` (versionados) |
| `functions/api/_lib/chaves-ia.js` | Novo: cifra AES-GCM, `ambienteDeIA`, `provedorAtivo` |
| `functions/api/config-ia.js` | Novo: GET a situação (sem as chaves); PUT só admin |
| `functions/api/roteiros.js` | Novo: listar, ler versões, enviar (admin) |
| `functions/api/dossier.js`, `dossie-cx.js`, `enrich-lead.js` | Usam as chaves do CRM e o provedor em uso |
| `public/js/configuracoes.js`, `roteiros.js`, `agenda.js`, `app.js` | As telas |
| `dev/prova/ia-roteiros.mjs` | Nova: 35 conferências |

---

## 4. Como verificar

1. Ctrl+F5 → **Configurações → Inteligência artificial**: DeepSeek como
   "Painel da Cloudflare", os outros "Sem chave", o provedor em uso.
2. (Admin) Colar uma chave de teste noutro provedor e salvar: aparece
   "Cadastrada no CRM ••••" e os 4 últimos.
3. **Roteiros de reunião**: os tipos do Time Vendas. Enviar um .md para
   um deles; "Ver" mostra o texto e a versão 1. Enviar de novo: versão 2.
4. Agenda → abrir uma reunião daquele tipo: "Roteiro: versão 2 — Ver o
   roteiro".
