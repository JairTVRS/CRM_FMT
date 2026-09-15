# Manual — v2.24.0: o cliente é do ERP, o CRM anota por cima

**Versão:** 1.0
**Data:** 15/09/2026
**Versão do sistema:** 2.24.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Este lote não tem migração.** Não cria tabela, não altera coluna, não
precisa de permissão nova no hub. Sobe com o deploy e pronto.

As permissões que ele usa — `hub:customers:read`, `hub:meetings:read`,
`hub:meeting-types:read` e `hub:teams:read` — **já estão na chave**. A
única que ainda falta, `hub:portfolios:read`, continua faltando e
continua bloqueando só o Plano de Ação: este lote foi desenhado para não
depender dela.

Nada aqui depende da migração 011, que segue pendente.

---

## 2. O que aconteceu

Em 15/09/2026 foi gerado o Dossiê de Experiência de um cliente real. O
documento disse, com todas as letras:

> Nenhum núcleo marcado na ficha deste cliente.
>
> Nenhuma pessoa mapeada. Sem o mapa, a conta depende da memória de quem
> a atende.
>
> A conta, pelo que o CRM mostra, é uma relação sem rosto registrado.

E a folha de Recomendação mandou a CX ir a campo levantar os
interlocutores e marcar os núcleos atendidos.

**As pessoas e os núcleos estavam cadastrados no ERP o tempo todo.**

O dossiê não estava inventando nada: ele lia a ficha do CRM, e a ficha
estava mesmo vazia. O erro era anterior — **ele nunca tinha perguntado ao
ERP.** A função que reunia os dados do documento não fazia uma única
chamada ao hub.

Havia quatro afirmações falsas pelo mesmo motivo, e a pior delas nomeava
o ERP para falar de um dado que nunca tinha consultado:

> Não há registro de classificação na escala 1–6 do ERP.

O campo `classification` já vinha do hub desde a 2.19.0. O documento lia
a cópia local, que estava nula.

**O dano não foi o dossiê curto — foi a Recomendação.** Um documento com
o nome da Formatar encomendou trabalho de campo para levantar o que já
estava cadastrado.

---

## 3. O que mudou

### 3.1 A conta passa a ser lida ao vivo

Identidade, contato, classificação e **pessoas** vêm agora do ERP, a cada
geração. A linha do cliente no CRM guarda o que é legitimamente dela: a
etapa da jornada, as observações da CX e a avaliação das pessoas.

| Do ERP, ao vivo | Do CRM, anotado por cima |
|---|---|
| Razão social, fantasia, CNPJ | Etapa da jornada |
| Telefone, e-mail | Observações da CX |
| Classificação (letra, ver 4) | Influência, postura, patrocinador |
| Pessoas, cargo e contato principal | Vínculo com o lead de origem |
| Núcleos atendidos | |

### 3.2 Núcleo, nesta folha, é o Time

Decidido com o usuário em 15/09/2026. A folha **A conta hoje** lista os
Times da Formatar (Governança, Operações), com os tipos de reunião que os
compõem ao lado, e o histórico de encontros de cada um.

> ⚠️ **Atenção, e isto vai gerar pergunta da CX:** no **Plano de Ação**,
> na carteira e na numeração das ações, "núcleo" continua significando o
> **tipo de reunião** (Logística, Estoque, Conselho Gestor). São dois
> níveis diferentes com o mesmo apelido em telas diferentes.
>
> É por isso que a folha mostra os dois: `Operações (Logística)`. Quem
> comparar as duas telas consegue reconciliar sem adivinhar.

Os núcleos são derivados das **reuniões** do cliente, não das carteiras.
A carteira seria a fonte mais correta — ela existe antes da primeira
reunião acontecer —, mas é justamente ela que a permissão que falta
bloqueia. Quando `hub:portfolios:read` chegar, entra como acréscimo.

### 3.3 A ligação pessoa × núcleo é apurada, não declarada

O ERP não pergunta "de qual frente esta pessoa participa". Mas registra
quem sentou em cada reunião — que é a mesma informação, melhor apurada.
É daí que sai a coluna Núcleos na folha de stakeholders.

### 3.4 Três estados, nunca dois

Esta é a mudança de fundo, e vale para tudo que o documento diz.

Antes existiam dois estados: **tem** ou **não tem**. Não havia como o
documento saber a diferença entre "o ERP respondeu que não há ninguém" e
"não foi possível perguntar ao ERP" — as duas coisas viravam a mesma
frase.

Agora são três, e cada um tem a sua frase:

| Situação | O que o documento diz |
|---|---|
| Consultado, tem conteúdo | lista o que encontrou |
| Consultado, veio vazio | "o ERP foi consultado e não há nenhuma pessoa cadastrada" |
| **Não consultado** | "não foi possível ler as pessoas desta conta no ERP" + o motivo |

Há um quarto caso, próprio das pessoas: quando o ERP devolve as pessoas
por referência interna em vez dos dados, a folha diz **"o ERP registra 4
pessoas nesta conta"** e explica que é este documento que ainda não
consegue nomeá-las. Nunca que não existem.

### 3.5 A guarda é código, não prompt

O prompt ganhou uma regra absoluta nova — não afirmar o vazio que não
conferiu. **Mas instrução em prompt é pedido, não garantia**, e essa
lição já custou caro antes, em 07/09/2026.

Então a conferência está em código, no `filtrarPorFontes()`. Quando o ERP
não foi consultado, qualquer item da análise que afirme "nenhuma pessoa
mapeada", "nenhum núcleo atendido", "a entrega é invisível" ou parecido é
**descartado**, e o descarte é declarado no documento.

Quando o ERP **foi** consultado e voltou vazio, os mesmos itens passam.
A guarda não é uma tesoura cega: o que muda é ter olhado.

### 3.6 O que o documento ainda não pode dizer

O CRM agora sabe **quais** núcleos são atendidos, **quantas** reuniões
houve e **quando** foi a última. Continua sem ler o **conteúdo** das
atas.

Contagem não é conteúdo: o dossiê pode dizer que houve duas reuniões de
Operações, a última em 03/09. Não pode dizer como foram, o que se tratou
nelas, nem se o cliente está satisfeito. Isso é a 2.25.0.

Um efeito colateral bom: ao estreitar a regra sobre reuniões, apareceu um
buraco que estava coberto por acidente — o termo "percepção" só era
barrado porque os textos que o usavam também citavam reuniões. Agora ele
é barrado pelo motivo certo, pela pendência da voz do cliente.

---

## 4. Decisões técnicas

**A listagem continua enxuta.** `contacts` e `addresses` entram só no
detalhe de UMA conta, não na listagem da Jornada — carregar as pessoas de
cada cliente para imprimir uma linha por cliente multiplicaria a resposta
por nada. O comentário antigo que justificava deixar `contacts` de fora
dizia outra coisa, e essa premissa era a errada.

**A rota de detalhe existe** — `GET /customers/{id}`, confirmada na
documentação do hub em 15/09/2026, com `hub:customers:read` e `fields`
obrigatório. É o caminho principal. O fallback pela listagem filtrada por
`document` ficou como rede de segurança e como caminho para o cliente que
tem CNPJ no CRM mas ainda não tem `erp_id` gravado.

**A classificação do ERP é uma LETRA, não a escala 1–6.** A doc mostra
`"classification": "A"`. O código assumia inteiro e devolvia `null` para
qualquer string — ou seja, o dossiê continuaria afirmando "não há
registro de classificação no ERP" mesmo depois de consultá-lo. Era o
mesmo defeito deste lote sobrevivendo por outra porta, e só apareceu
porque a doc foi conferida.

O valor agora passa como está, letra ou número. **Não convertemos uma
escala na outra**: são de sistemas diferentes, e inventar a
correspondência trocaria um dado certo por um palpite. O prompt manda o
modelo usar o valor como veio e proíbe tratá-lo como nota ou percentual.

**403 sobe como erro; "não achei" devolve nulo.** São coisas diferentes,
e confundi-las faria uma conta existente parecer inexistente.

**A junção da avaliação da CX é por e-mail, em tempo de leitura.** Sem
migração. A amarra durável, pelo id do contato do ERP, é a Fase 3 — e
depende de o ERP ter id estável por contato, coisa que o próprio código
agora relata quando a primeira conta real passa.

**O formato do `contacts` não foi adivinhado — e a doc não o define.** A
documentação do hub descreve `contacts` como objeto livre
(`{"additionalProperty": "anything"}`), que é o placeholder do OpenAPI
para "forma não especificada". Então não havia o que consultar: o
tradutor aceita as variantes plausíveis (`name`/`fullName`,
`jobTitle`/`role`, `isMain`/`isPrimary`), deixa nulo o que não achar e
**registra qual chave encontrou**. Na primeira geração real contra o ERP,
ele responde sozinho qual é a forma verdadeira.

**Campos que existem e ficaram de fora:** `segment`, `branch` e
`category` são ObjectId de outras coleções do ERP; `createdAt` e
`updatedAt` não têm uso no documento. Entram quando alguma tela precisar.

**`principal` é nulo quando não há marcação.** Devolver `false` diria
"esta pessoa não é a principal"; a verdade é "este ERP não marca
principal". A diferença vira frase errada no documento.

---

## 5. Como verificar

Esta parte é sua — eu não tenho a chave do hub para exercitar o caminho
real.

1. **Abra o cliente ZANNA SOUND e gere o dossiê de novo.** É o teste que
   responde tudo. Espere ver os núcleos atendidos e as pessoas do ERP na
   folha de stakeholders, com cargo e contato principal.

2. **Confira a classificação** na folha "A conta hoje". Se o ERP tiver
   classificação nessa conta, ela aparece agora — e aparece como o ERP a
   escreve. Se vier uma letra onde você esperava um número de 1 a 6, está
   certo: são escalas diferentes, e o CRM não converte uma na outra.

3. **Leia a folha de Recomendação.** Ela não pode mais mandar levantar em
   campo interlocutores e núcleos que já existem. Se ainda mandar,
   me avise com o PDF — significa que a guarda deixou passar.

4. **Compare com o Plano de Ação.** O núcleo lá é o tipo de reunião; aqui
   é o Time. Os dois nomes aparecem na folha justamente para essa
   conferência.

5. **Um cliente cadastrado à mão, sem vínculo com o ERP.** O documento
   tem que dizer que não consultou — nunca que não há.

---

## 6. O que NÃO foi testado

Nenhuma geração real de IA foi chamada em prova, como em todos os lotes
anteriores: as suítes usam análise fabricada.

**A forma real do `contacts` continua sendo hipótese.** É a única coisa
deste lote que só a primeira execução contra o hub de verdade confirma.
Se a forma for outra, as pessoas aparecem sem cargo ou sem contato
principal — mas **não** aparecem como inexistentes, que era o defeito.

**Provas:** `npm run prova` — 646 conferências em 14 suítes. As duas
novas são `conta.mjs` (70) e `dossie-conta.mjs` (52), e metade delas não
testa o caminho feliz: testa o hub em 403, o hub fora do ar, o servidor
sem chave e o cliente sem vínculo. Em todos, o que se prova é que a
resposta é "não consultei", e nunca uma lista vazia.

---

## 7. O que ficou pendente

- **Fase 3** — a migração 012: aposentar o campo de núcleos da ficha e o
  cadastro de Papéis, e amarrar a avaliação da CX ao id do contato do
  ERP. Entra na fila com a 011, que também não foi aplicada.
- **`hub:portfolios:read`** — destrava o Plano de Ação e melhora a
  completude dos núcleos.
- **A 2.25.0** — o dossiê lê as atas, e a Balança Avaliativa.
