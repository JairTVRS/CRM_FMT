# Manual — v2.33.0: os prospects do ERP no funil

**Versão:** 1.0
**Data:** 28/09/2026
**Versão do sistema:** 2.33.0
**Responsável:** Jair Tavares

Terceira entrega do lote da jornada do lead. Os prospects que estavam no
ERP ficavam "soltos", sem o CRM para a gestão. Agora entram no funil
sozinhos, uma vez por dia.

---

## 1. Instalação (feita em 28/09/2026)

Três partes, nesta ordem:

**1. Migração 018** — antes do deploy:

```
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-018-prospects-erp.sql
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('prospects_erp', 'importacoes_erp')"
```

Não é segura de rodar duas vezes (`ALTER TABLE ADD COLUMN`).

**2. O segredo `CRON_SECRET`**, o MESMO valor nos dois lugares:

- no Pages (`crm-fmt`): `npx wrangler pages secret put CRON_SECRET --project-name crm-fmt`
- no Worker, depois de publicado (item 3)

O valor não está em lugar nenhum do repositório. Para trocá-lo, gere
outro e cadastre nos dois lugares de novo; o Pages só lê o novo no
deploy seguinte.

**3. O Worker da importação diária**, da pasta `workers/prospects-diario`:

```
npx wrangler deploy
npx wrangler secret put CRON_SECRET
```

Ele se chama `crm-fmt-prospects-diario` e aparece no painel da
Cloudflare em **Workers & Pages**, com o gatilho **0 9 * * \*** (09:00
UTC = **06:00 de Brasília**). Os logs de cada rodada ficam lá.

---

## 2. O que mudou

### 2.1 Todo dia às 06:00

Os prospects do ERP (clientes com status **prospect**) que o CRM ainda
não conhece entram como leads:

| No ERP | No CRM |
|---|---|
| Prospect novo | Lead em **Novo Lead**, canal **ERP (prospect)**, **sem responsável**, com nome, CNPJ, telefone e e-mail do ERP |
| Mesmo CNPJ de um lead que já existe | **Não duplica**: o lead existente só ganha o vínculo com o ERP |
| CNPJ que só existe num lead **excluído** | **Não volta** — alguém tirou esse lead do funil de propósito |
| Prospect sem CNPJ | Entra também, sem documento (preencha na ficha para gerar dossiê) |

**Depois de importado, o CRM é o dono do lead.** Mudar o prospect no
ERP não muda o lead no CRM, e um lead importado que for excluído não
volta nas rodadas seguintes: o CRM guarda quais prospects já viu.

### 2.2 Os leads sem responsável

Os importados chegam **sem responsável**. Na tela de Leads, o filtro
**Sem responsável** mostra todos; abra cada um e escolha o **CX
responsável** na aba Funil. As Configurações dizem quantos ainda faltam.

### 2.3 "Importar agora"

Em **Configurações → Prospects do ERP**, o admin vê as últimas
importações (quando, diária ou manual, quantos novos, vinculados e não
recriados) e tem o botão **Importar agora**, para não esperar as 06:00.
A diária roda uma vez por dia; a manual, quantas vezes o admin quiser —
nenhuma duplica nada.

---

## 3. Arquivos

| Arquivo | O quê |
|---|---|
| `db/migracao-018-prospects-erp.sql` | `leads.erp_id`, `prospects_erp` (a memória), `importacoes_erp` (as rodadas) |
| `functions/api/_lib/prospects.js` | A regra: planejar (criar / vincular / não recriar) e gravar em lotes |
| `functions/api/prospects.js` | Novo: GET as rodadas; POST roda (Worker ou admin) |
| `functions/api/_middleware.js` | O Worker entra pelo `CRON_SECRET`, só em `POST /api/prospects` |
| `workers/prospects-diario/` | Novo: o Worker com o Cron Trigger (só dá a hora) |
| `public/js/configuracoes.js`, `index.html` | O cartão Prospects do ERP |
| `dev/prova/prospects.mjs` | Nova: 28 conferências |

---

## 4. Como verificar

1. Ctrl+F5. **Configurações → Prospects do ERP**: "Nenhuma importação
   ainda" e, para admin, o botão **Importar agora**.
2. Clique em **Importar agora**. O resumo diz quantos prospects o ERP
   tem e quantos viraram leads.
3. Leads → filtro **Sem responsável**: os novos, com canal "ERP
   (prospect)".
4. No dia seguinte, as Configurações mostram uma rodada **diária** às
   06:00. Se não mostrarem, o log do Worker no painel da Cloudflare diz
   o que aconteceu.
