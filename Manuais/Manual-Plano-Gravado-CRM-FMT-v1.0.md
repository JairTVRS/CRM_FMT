# Manual — v2.25.0: o plano de ação é gravado e se edita

**Versão:** 1.0
**Data:** 21/09/2026
**Versão do sistema:** 2.25.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Esta versão tem migração, e ela vai ANTES do deploy.**

```
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-012-plano-gravado.sql
```

Conferir DEPOIS (a segunda metade da convenção):

```
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('acoes_cx_log','plano_carga','plano_carteiras')"
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('acoes_cx') WHERE name IN ('status','data_prevista','versao')"
```

As duas consultas precisam devolver três linhas cada.

**A 012 NÃO é segura de rodar duas vezes** (`ALTER TABLE ADD COLUMN`,
como a 009). Se aparecer `duplicate column name`, ela já foi aplicada:
confira com as consultas acima e siga.

Antes de rodar: `npx wrangler whoami` precisa mostrar escopo de D1. O
token desta máquina não tinha (erro 7403) — a saída é
`npx wrangler login`, ou o usuário roda.

**Sem a migração**, a tela do Plano de Ação diz "O banco ainda não tem a
migração 012" em vez de mostrar o plano. Nada mais no CRM é afetado.

Nenhuma permissão nova no hub.

---

## 2. O que mudou

Pedido do usuário em 21/09/2026, com quatro pontos:

1. **Tabela compacta**, no formato da planilha que a CX já usa, com as
   colunas: Ação, Cliente, Tipo de reunião, Núcleo, Descrição,
   Responsável, Por quê, Onde, Como, Quando, Data prevista e Status.
2. **Todo campo se edita com um clique** — por exemplo, mudar o status de
   Pendente para Concluída.
3. **Toda alteração fica registrada**: quem, o quê, quando, de que valor
   para que valor.
4. **Carregar uma vez só.** A tela relia seis meses de atas a cada
   abertura. Agora o que já veio fica gravado, e cada carga traz só as
   reuniões novas desde a última.

### Como a tela funciona agora

- **Abrir a tela lê o banco do CRM** — instantâneo — e em seguida busca
  no ERP as reuniões novas. A linha "Atas lidas até …" no topo diz até
  onde a carga chegou. O botão **Buscar novas ações** força uma carga.
- **A primeira carga** lê seis meses em passos de um mês (uns oito
  passos). A tela mostra o avanço. Só acontece uma vez.
- **Clique numa célula** para editar. **Enter** grava, **Esc** desiste,
  clicar fora também grava. No texto longo, Shift+Enter quebra a linha.
  O status grava assim que se escolhe na lista.
- **O relógio 🕘 no fim da linha** abre o histórico da ação.
- **Os cartões do topo filtram** a tabela, e contam sobre o que está
  filtrado: com um cliente escolhido, os números são dele.
- A tabela mostra 200 linhas por vez; "Mostrar mais" traz as seguintes.

### O que não se edita

**Cliente, Tipo de reunião e Núcleo.** Os três juntos são a carteira, e a
carteira é a chave da ação: mudar um deles seria mover a ação para outra
carteira, e a ata seguinte a recriaria na original.

### "Núcleo" nesta tela é o Time

A coluna **Tipo de reunião** mostra o tipo (Inteligência Operacional,
Logística…) e a coluna **Núcleo** mostra o **Time** da Formatar (Gestão
de Operações, Governança). É o mesmo sentido que "núcleo" já tinha no
Dossiê de Experiência desde 15/09. Antes desta versão, no Plano de Ação,
"núcleo" era o tipo de reunião.

### Quando × Data prevista

- **Quando** é o prazo **como está escrito na ata**: "out/26",
  "A definir", "5–9/10/26".
- **Data prevista** é uma data de calendário. A carga a preenche quando
  a ata traz `dd/mm/aa`; nos outros casos fica vazia para a CX pôr.
  **É por ela que o atraso é calculado.**

Isso explica os 1898 "sem prazo" do print de 21/09: quase nenhuma ata usa
`dd/mm/aa`. Agora a CX pode preencher a data prevista direto na tabela.

### Status novos

Além dos quatro da ata (Nova, Pendente, Em andamento, Repactuado):

- **Concluída** e **Cancelada** — a CX escolhe.
- **Saiu da ata** — só a carga põe. O manual das atas v2.3 diz que ação
  encerrada **sai** do plano; antes ela sumia da tela, agora fica gravada
  com a data em que saiu. Fica fora do filtro "Em aberto".

---

## 3. Decisões técnicas

### A regra de quem vence: a alteração mais recente

A CX edita o responsável; na semana seguinte chega uma ata nova. Quem
vale?

Cada campo que vem da ata tem uma **sombra** no banco — o que a última
ata dizia. Na carga:

- **a ata nova diz o mesmo que a sombra** → a ata não mudou nada; vale o
  que a CX escreveu;
- **a ata nova diz outra coisa** → alguém mudou na reunião; a ata vence,
  e o histórico registra a troca como feita "pela ata · reunião N".

Sem a sombra, cada carga desfaria as edições da CX. Exceção: ação que a
CX marcou Concluída ou Cancelada e depois sai da ata continua como a CX
marcou.

**Isto reverte a decisão de 06/09/2026** ("O quê, quem, quando e status
vêm do ERP ao vivo e não se editam"). Foi pedido explícito do usuário.

### A carga incremental

- `plano_carga.carregado_ate` é o cursor. Cada passo pede ao hub no
  máximo um mês de reuniões a partir dele.
- **Folga de 14 dias:** depois da primeira carga, cada passo recua 14
  dias antes do cursor. A ata é escrita depois da reunião, e o hub filtra
  pela data da reunião; sem a folga, a ata escrita hoje de uma reunião de
  ontem nunca seria lida. **Ata escrita mais de 14 dias depois da reunião
  não é lida** — se isso acontecer, é aumentar `FOLGA_DIAS`.
- `plano_carteiras` guarda a ata mais recente aplicada por carteira. Reler
  uma ata antiga (pela folga) nunca passa por cima da nova.
- **Uma carga por vez:** `plano_carga.travado_em`. Outra pessoa abrindo a
  tela durante uma carga não dispara a segunda. Trava de mais de 3 minutos
  é de carga que morreu, e expira. Durante a carga, uma edição recebe
  "tente em alguns segundos".
- Se um mês passar do teto de páginas do hub, a janela encolhe pela
  metade e tenta de novo.

### Gravação em lote com um parâmetro JSON

Cada comando manda as linhas como **um** parâmetro JSON, lido no SQL com
`json_each`. O D1 limita a 100 parâmetros por comando.

**Achado ao desenhar:** o print de 21/09 mostra "AÇÃO 8" onde devia
aparecer "N.8". A numeração da 2.21.0 inseria uma linha por comando, 1900
comandos num lote, e falhava calada — a tela mostrava a ação sem número.
A carga nova numera junto com a gravação.

### Conflito entre duas pessoas

A tela manda o valor que a pessoa estava vendo. Se no banco já é outro,
a gravação é recusada com o valor atual ("alterado por fulano enquanto
você editava") — em vez de apagar a mudança do outro sem ninguém saber.
Cada linha tem uma `versao` que muda a cada escrita.

### O histórico

Tabela `acoes_cx_log`, uma linha por campo alterado: `campo`, `de`,
`para`, `origem` (`crm` ou `ata`), `reuniao_nid`, `por`, `por_nome`, `em`.
Nunca se apaga nem se edita. A primeira carga registra "Ação carregada da
ata" para cada ação.

### O que continua NÃO saindo

As notas privadas em CAIXA ALTA e o `technicalNotes`. Nada da ata além
das ações é gravado. A prova confere a resposta **e o banco**.

---

## 4. Arquivos

| Arquivo | O quê |
|---|---|
| `db/migracao-012-plano-gravado.sql` | Colunas novas em `acoes_cx`; `acoes_cx_log`, `plano_carga`, `plano_carteiras` |
| `functions/api/_lib/plano.js` | **Novo.** Mescla ata × banco, regra de quem vence, validação dos campos |
| `functions/api/plano-acao.js` | GET lê o banco; POST `?carga=1` é um passo da carga; PATCH `?id=` edita um campo; GET `?log=` é o histórico. O PUT saiu |
| `public/js/plano-acao.js` | Tabela, edição por célula, histórico, carga em passos |
| `public/index.html`, `public/assets/css/cx.css` | Tela e modal do histórico |
| `dev/hub-stub.mjs` | Filtra reuniões por data, e aceita reunião nova em tempo de execução (`POST /__reuniao`) |
| `dev/prova/plano.mjs` | Reescrita: 85 conferências |

---

## 5. Como verificar (no navegador, depois do deploy)

1. **Abrir o Plano de Ação pela primeira vez.** A linha do topo mostra a
   carga andando ("já lidas até …") e termina em "Atas lidas até hoje".
   As ações aparecem com identificador **N.M** — não mais "AÇÃO M".
2. **Sair e voltar à tela.** Abre na hora, sem "Lendo as atas".
3. **Mudar um status** de Pendente para Concluída. A linha sai do filtro
   "Em aberto"; em "Fechadas" ela aparece.
4. **Abrir o 🕘 dessa linha.** Aparece "Status: Pendente → Concluída",
   com o seu nome, a hora e "à mão".
5. **Preencher a Data prevista** de uma ação "A definir". Se a data for
   passada, a célula fica vermelha com os dias de atraso.
6. **Conflito:** abrir a tela em duas abas, editar o mesmo campo nas
   duas. A segunda recebe o aviso e o valor da primeira.
7. **Buscar novas ações** num dia com reunião nova: só ela é lida.

O que **não** consegui exercitar daqui: o D1 de verdade (a prova usa
SQLite em memória com as migrações reais; `UPDATE … FROM` e `json_each`
existem nos dois) e o volume real — 1900 ações, 608 carteiras.

---

## 6. Pendências

- **Migração 012 no D1 remoto** antes do deploy, e conferida depois.
- **"Quanto" e "Observações"** continuam gravados e editáveis pela API,
  mas não têm coluna na tabela — não estavam na lista pedida. As
  anotações já feitas não se perderam.
- **Ler "out/26" como data prevista** (último dia do mês) resolveria boa
  parte dos "sem data prevista" de uma vez. Não foi feito: é inferência
  sobre o que o consultor quis dizer, e isso é decisão do usuário.
