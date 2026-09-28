# Manual — v2.31.0: o funil arrumado

**Versão:** 1.0
**Data:** 28/09/2026
**Versão do sistema:** 2.31.0
**Responsável:** Jair Tavares

Primeira entrega do lote da jornada do lead (agenda, gravação,
transcrição, insights e laudo — ver o ROADMAP). Esta arruma o funil
antes de a agenda entrar nele.

---

## 1. Instalação

**Duas coisas, nesta ordem, antes do deploy.**

### 1.1 Migração 016

```
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-016-funil-responsavel-perda.sql
```

Conferir depois:

```
npx wrangler d1 execute crm-formatar --remote --command="SELECT id, nome, encerra, resultado FROM etapas WHERE pipeline = 'comercial' AND ativo = 1 ORDER BY ordem"
npx wrangler d1 execute crm-formatar --remote --command="SELECT COUNT(*) AS motivos FROM motivos_perda WHERE ativo = 1"
npx wrangler d1 execute crm-formatar --remote --command="SELECT COUNT(*) AS sem_responsavel FROM leads WHERE ativo = 1 AND responsavel IS NULL"
```

Esperado: "Contrato emitido" com `resultado = ganho`, "Perdido" com
`perdido`, as demais em branco; **5** motivos; sem responsável só os
leads importados antes por alguém sem e-mail registrado (normalmente 0).

**Não é segura de rodar duas vezes** (`ALTER TABLE ADD COLUMN` responde
"duplicate column name" — quer dizer que já estava aplicada).

**Sem a 016 a 2.31.0 não funciona:** a lista de etapas e o quadro leem
a coluna nova. Por isso a migração vem antes do push.

### 1.2 Permissão `hub:user-groups:read` na chave do CRM

No hub, conceda à chave do CRM a permissão **`hub:user-groups:read`**
(mesmo lugar em que foram concedidas as do Lote I).

Sem ela o CRM funciona, mas **ninguém é admin**: as Configurações mostram
"A chave do hub não tem a permissão hub:user-groups:read" e os motivos de
perda ficam só de leitura.

---

## 2. O que mudou

### 2.1 CX responsável

Cada lead tem um **CX responsável** — quem conduz o lead da entrada até
o contrato emitido ou a perda.

- Nasce com **quem cadastrou** (na ficha e na importação de planilha).
- Na aba **Funil** da ficha, dá para trocar por qualquer usuário **que já
  entrou no CRM**. Não é a lista inteira do hub: lá estão todos os
  operadores da Formatar.
- Os leads que já existiam ficaram com quem os cadastrou.
- Nova coluna **Responsável** na tabela, "CX: nome" no cartão do quadro,
  e um filtro com **Meus leads**, cada usuário e **Sem responsável** — é
  onde os prospects do ERP vão cair (2.33.0).

A lista de usuários se forma sozinha: cada vez que alguém abre o CRM, o
acesso fica registrado. Quem já tinha cadastrado lead entrou na lista
pela migração; o nome aparece depois do primeiro acesso (até lá, o
e-mail).

"Quem atendeu" continua existindo, como estava: é texto livre, o
histórico da planilha.

### 2.2 Admin pelo grupo do hub

Quem é admin no CRM é decidido pelo **grupo do usuário no hub**:
**Planejamento e Controle de Produção** e **Sócios**. A comparação ignora
maiúsculas e acentos.

As Configurações dizem, no topo, se você é admin e qual é o seu grupo.
Hoje o admin cuida dos motivos de perda; nas próximas entregas, das
chaves de IA e dos roteiros.

Para mudar os grupos sem deploy: variável `ADMIN_GRUPOS` no painel da
Cloudflare (nomes separados por vírgula). Fica fora do CRM de propósito —
numa tela, um admin poderia se descadastrar e ninguém mais voltaria.

### 2.3 Motivos de perda

Levar um lead para uma etapa de perda **exige um motivo**, pelas duas
portas:

- na **ficha**: ao escolher a etapa Perdido, aparecem "Motivo da perda" e
  uma observação opcional;
- no **quadro**: ao soltar o cartão em Perdido, abre uma janela pedindo o
  motivo. Cancelar devolve o cartão para onde estava.

Tirar o lead da perda **apaga o motivo** — um lead reaberto não está
perdido. Os leads que já estavam em Perdido ficam como "não informado" e
continuam editáveis.

Os cinco modelos, nas **Configurações → Motivos de perda**:

1. Preço acima do esperado
2. Sem prioridade no momento
3. Fechou com concorrente
4. Sem retorno do lead
5. Fora do perfil atendido

Só admin cria, renomeia e exclui. Motivo que já explica alguma perda não
pode ser excluído, só renomeado.

### 2.4 Encerramento: ganho ou perdido

"Finalizado" passou a se chamar **Contrato emitido**.

Em **Gerenciar etapas** do funil, o antigo "terminal" virou uma escolha:
**em aberto**, **encerra: ganho** ou **encerra: perdido**. Ganho oferece
a conversão em cliente; perdido pede o motivo. A jornada do cliente
continua com o "terminal" de sempre.

Lead em etapa de perda **não converte**: a ficha diz para movê-lo de
volta para uma etapa em aberto primeiro.

### 2.5 Defeito corrigido: a conversão ao arrastar nunca disparava

Desde que existe, arrastar um lead para "Finalizado" deveria abrir a
conversão em cliente. **Nunca abriu.** No `quadro.js`, a função do
arraste se chamava `aoMover` — o mesmo nome do aviso de "cartão movido"
— e a declaração de dentro escondia a de fora. O aviso chamava a função
do arraste, que saía na primeira linha.

A conversão só funcionava pelo botão da ficha. Agora funciona também ao
soltar o cartão em **Contrato emitido**. A prova `ids.mjs` passou a
recusar função com o nome de um parâmetro da fábrica do quadro — e foi
conferida contra o código antigo, onde falha.

---

## 3. Arquivos

| Arquivo | O quê |
|---|---|
| `db/migracao-016-funil-responsavel-perda.sql` | `etapas.resultado`, `leads.responsavel`/motivo, `motivos_perda`, `usuarios_crm` |
| `functions/api/_lib/admin.js` | Novo: admin pelo grupo do hub, `exigirAdmin` |
| `functions/api/_lib/hub.js` | `mapaDeGrupos`, permissão `hub:user-groups:read` |
| `functions/api/_middleware.js` | Pede `userGroup` ao hub no login |
| `functions/api/me.js` | Devolve admin/grupo; registra o acesso em `usuarios_crm` |
| `functions/api/usuarios.js` | Novo: a lista de responsáveis |
| `functions/api/leads.js` | Responsável, motivo obrigatório na ficha e no arraste, filtro |
| `functions/api/cadastros.js` | Tipo `motivos` (só admin); `resultado` das etapas |
| `functions/api/conversao.js` | Impedimento `LEAD_PERDIDO` |
| `functions/api/importar.js` | Lead importado nasce com responsável |
| `public/js/perda.js` | Novo: janela do motivo e cartão das Configurações |
| `public/js/leads.js`, `cadastros.js`, `quadro.js`, `conversao.js`, `configuracoes.js` | Telas |
| `dev/prova/funil.mjs` | Nova: 48 conferências |
| `dev/prova/ids.mjs` | Guarda contra função que esconde parâmetro da fábrica |

---

## 4. Como verificar

1. Ctrl+F5. Configurações: o topo diz se você é admin e o grupo.
2. Tabela de leads: coluna **Responsável**; filtro **Meus leads**.
3. Abrir um lead → aba Funil → trocar o **CX responsável** → salvar.
4. Na mesma aba, escolher **Perdido** sem motivo → salvar: recusa.
   Escolher o motivo → salva.
5. No quadro, arrastar um lead para **Perdido**: abre a janela do motivo.
   Cancelar: o cartão volta.
6. Arrastar um lead com CNPJ para **Contrato emitido**: abre a conversão.
7. Gerenciar etapas: "Contrato emitido" em **encerra: ganho**, "Perdido"
   em **encerra: perdido**.
