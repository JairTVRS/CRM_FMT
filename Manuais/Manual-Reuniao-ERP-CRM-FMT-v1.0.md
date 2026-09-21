# Manual — v2.30.0: a reunião é do ERP

**Versão:** 1.0
**Data:** 21/09/2026
**Versão do sistema:** 2.30.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Migração 015, antes do deploy:**

```
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-015-status-do-cliente.sql
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('acoes_cx') WHERE name = 'cliente_status'"
npx wrangler d1 execute crm-formatar --remote --command="SELECT carregado_ate, completa FROM plano_carga"
```

A última deve mostrar `carregado_ate` vazio e `completa` 0.

**Não é segura de rodar duas vezes** (`ALTER TABLE ADD COLUMN`).

**A migração volta o cursor da carga.** A primeira abertura do Plano de
Ação depois do deploy relê os seis meses de atas, em passos, uma vez — é
o que aplica as regras novas às ações já gravadas. Nada se perde: a ata
mais recente de cada carteira é reaplicada pela regra da sombra, então só
muda o que a leitura nova lê diferente, e cada mudança vai para o
histórico como feita pela ata. As edições da CX ficam.

A Fase 3 da 2.24.0 passa a ser a **migração 016**.

---

## 2. O que mudou

Três pedidos de 21/09/2026, a partir da lista de avisos da leitura das
atas.

### 2.1 A data da reunião é a do ERP

A data, o cliente, o tipo de reunião e os participantes do cliente
**sempre vieram do ERP** no plano — mas a ata continuava sendo conferida
linha a linha, e cada cabeçalho fora do manual gerava um aviso: "Não foi
possível ler a data da reunião na segunda linha", "A primeira linha não
traz o núcleo depois do hífen"… Centenas deles, e nenhum mudava nada.

Agora, onde o ERP entregou a informação, a linha da ata não é conferida.
Os avisos que sobram são os que dependem só do texto: ação sem Status,
ação repetida, ata sem nenhuma ação lida.

E a tabela ganhou a coluna **Data da reunião** — a do ERP, em 01/01/2026.

O dossiê não mudou: ele continua conferindo o cabeçalho, porque lá a ata
é lida como documento.

### 2.2 Sem "Resp.:", o responsável é quem conduziu a reunião

Ação sem responsável na ata fica com os **participantes da Formatar** na
reunião (`participants.user` no ERP), pelo nome do usuário. Mais de um
aparece como "Marina / Paulo". A sala da reunião, que também vem nessa
lista, é ignorada.

Entra como valor da ata: a CX pode trocar, e a troca dela vale até a ata
nomear alguém.

**O formato de `participants` não foi confirmado com uma resposta real**
— a documentação do hub não traz exemplo. O CRM aceita `{ user: 'id' }`,
`{ user: { id, name } }` e o id solto, e resolve o nome pela lista de
usuários do hub (mesma permissão do login). **Se depois da carga o "sem
responsável" não cair**, é esse formato: me mande um print do
`participants` de uma reunião.

Se a lista de usuários falhar, a carga segue — a ação só continua sem
responsável.

### 2.3 Status do cliente, com filtro

Coluna **Status do cliente** (Ativo, Inativo, Prospect, Avulso) e um
filtro novo ao lado da busca. **O padrão é "Clientes ativos"**, e a
escolha de cada usuário fica salva com a configuração de colunas.

O status vem do ERP e é conferido **em todas as ações a cada carga**:
cliente inativado no ERP muda no plano mesmo sem reunião nova. O filtro
vale também para os gráficos e para a lista de clientes.

Antes, o plano pedia ao ERP só os clientes ativos — o inativo ficava com
o nome escrito na ata. Agora pede todos.

---

## 3. Arquivos

| Arquivo | O quê |
|---|---|
| `db/migracao-015-status-do-cliente.sql` | Coluna `cliente_status`; volta o cursor |
| `functions/api/_lib/ata.js` | Opção `cabecalhoDoErp`: não confere o que o ERP deu |
| `functions/api/_lib/hub.js` | `mapaDeUsuarios`, `nomesDosParticipantes` |
| `functions/api/_lib/plano.js` | Responsável da reunião como reserva; `clienteStatus` |
| `functions/api/plano-acao.js` | Clientes de todos os status, usuários, status a cada passo |
| `public/js/plano-acao.js`, `index.html`, `cx.css` | Colunas e filtro novos |
| `dev/hub-stub.mjs`, `dev/prova/plano.mjs` | Usuários `u1`/`u2`; +6 conferências (111) |

---

## 4. Como verificar

1. Ctrl+F5. A carga recomeça ("Carregando as atas do ERP") e vai até hoje.
2. A lista de avisos no fim da tela ficou curta — sem data, núcleo,
   cliente ou participantes do cabeçalho.
3. O cartão "sem responsável" caiu.
4. O filtro mostra "Clientes ativos"; trocar para "Todos os status" traz
   os inativos. F5: a escolha continua.
