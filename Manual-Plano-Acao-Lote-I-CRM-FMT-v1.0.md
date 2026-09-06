# Manual — Lote I: reuniões, atas e o plano de ação em 5W2H (CRM Formatar)

**Versão:** 1.0
**Data:** 06/09/2026
**Versão do sistema:** 2.21.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**A migração vem antes do deploy.** Sem a tabela, a tela abre e falha ao
tentar ler as anotações.

```bash
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-010-acoes-5w2h.sql
```

**Confira depois de aplicar** — a segunda metade da convenção:

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name LIKE '%acoes%'"
```

Devem aparecer `acoes_cx` e `idx_acoes_cx_carteira`. A 010 é **segura
para rodar duas vezes** — só `CREATE ... IF NOT EXISTS`, ao contrário da
009.

### Permissões do hub

Este lote usa **quatro escopos novos**, além do de clientes que já
funciona:

| Permissão | Para quê |
|---|---|
| `hub:meetings:read` | as reuniões e as atas |
| `hub:portfolios:read` | as carteiras |
| `hub:meeting-types:read` | os tipos de reunião (os núcleos) |
| `hub:teams:read` | os times |

Faltando qualquer uma, a tela **diz qual falta** — não fica vazia. A
mensagem nomeia a permissão exata, porque o erro passou a saber de qual
grupo de endpoint veio.

---

## 2. O que muda

Uma tela nova no menu, ao lado de Jornada: **Plano de Ação**. O CX abre e
vê a fila de ações abertas de **todas as carteiras**, ordenada pelo que
dói primeiro — atrasadas na frente, depois as que se arrastam há mais
tempo.

### A numeração por cliente

Na ata, a sequência de ações é **por tipo de reunião**: o Comercial tem
as suas 1, 2, 3 e o Financeiro tem as dele, também a partir de 1. Num
cliente com três carteiras isso produz **três "AÇÃO 1"**, e numa tela que
lista o cliente inteiro elas colidem.

O CRM passa a dar um número **por cliente**, corrido e independente da
sequência do núcleo. O identificador fica **`N.M`**:

| | |
|---|---|
| **N** | a sequência do cliente, dada pelo CRM |
| **M** | o número da ação no tipo de reunião — como a ata a chama |

A Alphatex teria `1.1` (ação 1 do cliente, que é a ação 1 do Comercial) e
`2.1` (ação 2 do cliente, que é a ação 1 do Financeiro).

**O número é gravado, nunca calculado na hora.** Calculado, ele
renumeraria sozinho: quando a ação 1 fosse concluída e saísse do plano, a
ação 2 viraria 1, e "Alphatex ação 2" passaria a significar outra coisa
na semana seguinte. É o mesmo defeito que o manual v2.3 evita ao dizer
que o ID nasce e morre com a ação.

**Consequência assumida: abrir a tela escreve.** A primeira leitura
atribui os números que faltam. Se duas pessoas abrirem ao mesmo tempo, a
trava de unicidade `(cliente, número)` barra a colisão e a segunda pega o
número seguinte.

Ação cuja carteira o ERP não devolveu **não recebe número** — não há
chave estável onde guardá-lo. Ela continua na fila, mostrando `AÇÃO M` e
um aviso; sumir seria pior.

### As duas metades, e a fronteira entre elas

| O que a ata diz | O que a CX anota |
|---|---|
| **What** — a descrição da AÇÃO | **Why** — por quê |
| **Who** — `Resp.:` | **Where** — onde |
| **When** — `Prazo:` | **How** — como |
| Status, dias em aberto, atraso | **How much** — quanto |
| Vem do ERP, ao vivo. **Não se edita.** | Fica no CRM. Editável. |

A fronteira é visível na tela de propósito: misturar as duas faria
parecer que dá para corrigir a ata por aqui, e não dá — quem é dono dela
é o ERP.

### Por que o 5W2H não é preenchido por IA

Decisão de 06/09/2026. A alternativa era a IA sugerir Why e How a partir
dos tópicos de contexto da ata. Foi recusada: sugestão não confirmada
vira verdade com o tempo, e este é um plano que as pessoas cobram umas
das outras.

O parser também não usa IA. Contar ações e ler estrutura de texto regular
tem resposta certa; pedir isso a um modelo trocaria uma resposta exata
por uma provável — e número errado num indicador de saúde desmoraliza o
indicador inteiro.

---

## 3. Decisões técnicas

### A chave da anotação é (carteira + número da ação)

É o ponto mais importante do desenho.

O manual v2.3 diz que o ID da ação **nasce e morre com ela** e que a
sequência é **por carteira**. A mesma AÇÃO 7 reaparece nas atas seguintes
até ser encerrada. Chavear a anotação por reunião faria o 5W2H se perder
na semana seguinte — justamente quando ele passa a valer.

### A ata mais recente manda

Ação concluída ou cancelada **sai** do plano e fica registrada só no
contexto. Então o que está na última ata da carteira é o que continua
aberto; as anteriores servem para saber **desde quando** a ação vem se
arrastando.

### O que nunca sai desta rota

As **notas privadas do consultor** — as linhas finais em CAIXA ALTA — e o
`technicalNotes` da reunião. O parser separa as primeiras em campo
próprio e a rota não as devolve; o segundo sequer é pedido ao hub. O
contexto da ata também não sai: a rota devolve o plano, não a ata.

### O nome do núcleo vem do ERP; a ata é a reserva

`meetingType` volta como ObjectId cru nas reuniões e nas carteiras. Uma
chamada a `GET /meeting-types` resolve todos de uma vez — a lista é
pequena, nove no ERP hoje.

**O ERP é dono do nome.** Se o consultor escreveu "LOGISTICA" no
cabeçalho e o cadastro diz "Logística", vale o cadastro. O cabeçalho da
ata continua sendo lido e serve de reserva: se o tipo de reunião não
estiver na lista, o nome que o consultor escreveu é melhor que nada.

O filtro de `isActive` fica de fora de propósito: um núcleo desativado no
ERP continua tendo atas antigas, e não poder nomeá-lo transformaria o
histórico em ObjectId na tela.

### Os três níveis chegam à tela, e não se confundem

| Nível | O que é | De onde vem |
|---|---|---|
| **Time** | O agrupamento interno da Formatar: Governança, Operações | `GET /teams` |
| **Núcleo** | O tipo de reunião no cliente: Logística, Estoque, Conselho Gestor | `GET /meeting-types` |
| **Carteira** | Cliente + núcleo. É nela que tudo do CX se pendura | `GET /portfolios` |

`meeting-types` devolve `teams` como **array de ObjectId**. Um tipo de
reunião pertence a exatamente um Time, mas a API o entrega como lista —
guardamos o primeiro para usar e a lista inteira para o dia em que
deixar de ser 1:1.

Na tela, Time e núcleo têm aparências **deliberadamente diferentes**:
confundi-los visualmente seria confundir os dois conceitos. E o filtro
por Time deixa a CX ler a fila por frente de trabalho.

São cinco consultas ao ERP por carregamento — carteiras, reuniões,
clientes, tipos e times —, todas em paralelo. As três últimas são listas
pequenas: nove tipos e cinco times hoje.

### A janela é de seis meses

Cobre com folga a carteira mensal e a quinzenal. Ir mais longe custaria
páginas do hub para achar ações que, se ainda estivessem abertas, teriam
reaparecido numa ata recente.

---

## 4. Os quatro defeitos que a ata real revelou

O parser foi escrito contra o manual v2.3. Uma ata de verdade quebrou
quatro coisas que a especificação não antecipava:

1. **Os tópicos usam `1.` com ponto**, e eu esperava `1 ` com espaço. A
   hierarquia inteira se perdia.
2. **`[PARTICIPANTES CLIENTE A CONFIRMAR]` virava um participante.** O
   pior dos quatro: reportava **um** participante do cliente onde há
   **zero**, sem aviso — e a presença do cliente é sinal do Health Score.
3. **O ponto final ficava grudado no último nome** ("Raylannder.").
4. **"Plano de ação:" virava tópico de contexto**, tratando linha
   estrutural como conteúdo.

O parser também passou a aceitar `AÇÃO`, `ACAO`, `ACÃO` e `AÇAO`: cedilha
e til se perdem em cópia entre editores, e recusar a ação por causa de um
acento perderia o plano inteiro.

---

## 5. Verificação

### O que eu verifiquei

**Nove suítes, todas passando.** As deste lote:

- **66 verificações do parser** contra o manual: datas, notas privadas,
  os quatro status, ata completa, ata malformada, ID repetido, CRLF do
  Word, descrição que transborda a linha;
- **20 verificações contra a ata REAL**, transcrita da sua captura — os
  quatro defeitos acima, agora travados contra regressão;
- **48 verificações do plano, ponta a ponta**: a prova sobe o dublê do
  hub num processo à parte, com **duas reuniões da mesma carteira**, e
  chama os handlers reais.

Sobre a numeração, está provado que ela é **gravada e não recalculada**:
reler o plano não renumera, não cria linha nova, e o próximo número
continua sendo o seguinte — nunca um vago.

O caso que mais importa está coberto: a **AÇÃO 1 está na ata de agosto e
sumiu da de setembro** — e o plano corretamente não a mostra.

Também está provado que **nada do que é interno vaza**: nota privada,
`technicalNotes` e contexto da ata não aparecem em lugar nenhum da
resposta.

### O que eu NÃO verifiquei — é seu

Nada passou por navegador, e **a chave real nunca foi usada** — toda a
prova falou com o dublê.

- [ ] Abrir **Plano de Ação**. Ou lista as ações, ou diz qual permissão
      falta
- [ ] As ações batem com o que está nas atas do ERP
- [ ] A ordenação começa pelas atrasadas
- [ ] O identificador `N.M` aparece e faz sentido para o cliente
- [ ] Recarregar a tela **não** renumera nada
- [ ] Preencher o 5W2H de uma ação e recarregar — tem que persistir
- [ ] Preencher de novo, mudando um campo — não pode duplicar
- [ ] Os filtros: cliente, **time**, "só as atrasadas", "sem 5W2H preenchido"
- [ ] O Time aparece ao lado do núcleo, com aparência distinta
- [ ] Os avisos da leitura das atas, no rodapé recolhido
- [ ] **Conferir se `participants` são mesmo os da Formatar** e
      `customerParticipants` os do cliente — ver a pendência abaixo

---

## 6. Pendências

**O mapeamento dos participantes foi confirmado** em 06/09/2026:
`participants` são os funcionários da Formatar e `customerParticipants`
os do cliente. O código já estava assim; só o comentário mudou. Importa
porque a presença do **cliente** é insumo do Health Score.

**Nenhuma.** Todos os contratos do hub necessários ao lote chegaram e
estão implementados.

---

## 7. Histórico de versões

| Versão | Data | O quê |
|---|---|---|
| 1.0 | 06/09/2026 | Parser das atas, plano de ação em 5W2H e a tela própria (sistema 2.21.0) |
