# Manual — Lote 1: a importação lê a planilha certa

**Versão:** 1.0
**Data:** 11/09/2026
**Versão do sistema:** 2.23.2 (entregue junto com os lotes 1 a 3)
**Responsável:** Jair Tavares

---

## 1. Instalação

**Não há migração. Não há variável de ambiente. Nada a fazer no painel da
Cloudflare.** O lote inteiro é front-end: dois arquivos alterados, um
arquivo de prova acrescentado.

```
public/js/importar.js      reescrita a camada de leitura e validação
public/index.html          botão "Baixar log" no bloco de erro
dev/prova/importacao.mjs   35 conferências, novas
```

Subir é o deploy normal. Reverter é reverter o commit — nenhum dado é
tocado por este lote.

---

## 2. O problema que este lote resolve

A usuária subiu `Gestão de Propostas Formatar.xlsx` e recebeu:

> **Cabeçalho não reconhecido**
> Nenhuma coluna com o nome do cliente foi encontrada.
> Coluna não reconhecida: Feriados (Fonte: ANBIMA)
> Coluna não reconhecida: \_\_EMPTY
> Coluna não reconhecida: Dias em processo

Nenhuma dessas colunas existe na planilha que ela enxerga. O arquivo tem
duas abas:

| Aba | Estado | Conteúdo |
|---|---|---|
| `Config` | **oculta** | feriados ANBIMA, faixas de tempo, lista de status |
| `Propostas` | visível | os 105 registros de verdade |

O importador pegava `pasta.SheetNames[0]` — a primeira da lista, que é a
**oculta**. Ele leu a Config inteira e nunca chegou perto da Propostas.
O `__EMPTY` é como a SheetJS nomeia coluna sem título: sobra da Config,
não erro de quem montou a planilha.

Ou seja: a mensagem estava tecnicamente correta e praticamente inútil.
Descrevia uma aba que a pessoa não pode ver.

---

## 3. O que muda

### 3.1 Uma aba só, e o aviso ensina a resolver

A regra é do usuário: **mais de uma aba, o arquivo é recusado — inclusive
se a aba extra estiver oculta.** Contar só as visíveis aceitaria em
silêncio justamente o que causou o problema.

O que mudou foi o aviso, que agora nomeia o que encontrou:

```
O arquivo tem mais de uma aba

A importação aceita apenas uma. Deixe somente a aba com os
dados dos leads e reimporte.

• Abas encontradas: Config (oculta) · Propostas
• Para remover uma aba oculta: clique com o botão direito em
  qualquer etiqueta na parte de baixo do Excel, escolha
  "Reexibir", selecione a aba e apague.
```

Nomear a aba oculta é o que torna o aviso acionável. Sem o nome
`Config`, a instrução "apague a aba oculta" não tem alvo.

### 3.2 O cabeçalho não precisa estar na linha 1

Antes, a linha 1 era assumida como cabeçalho. Agora as 20 primeiras
linhas são pontuadas por quantos títulos conhecidos elas contêm, e a de
maior pontuação vence. Título, logo e linha em branco acima da tabela
deixam de quebrar a leitura.

Empate fica com a linha de cima: numa planilha que repete os títulos, a
primeira ocorrência é a que tem os dados abaixo.

### 3.3 As colunas obrigatórias são conferidas no cabeçalho

Antes a checagem era indireta — "nenhuma linha produziu nome". Agora é
direta e diz o que falta:

```
Falta a coluna obrigatória: CNPJ

Confira o cabeçalho da planilha, preencha as colunas
obrigatórias e reimporte os dados.

• Linha do cabeçalho: 1
• Colunas reconhecidas: Status, Data Cadastro, Quem atendeu?,
  Nome do cliente, Segmento, Cidade, Telefone de Contato, ...
• Coluna ignorada: Faixa de Tempo
• Coluna ignorada: Dias em processo
• Coluna ignorada: R$ Total Negociado
```

**As colunas ignoradas nunca bloqueiam.** Elas aparecem como informação,
para quem quiser conferir se alguma deveria estar sendo aproveitada.

> A frase "baixe o modelo da planilha" e o botão que o gera entram no
> **lote 2**, junto com a geração nativa do `.xlsx`. Prometer o modelo
> antes de o botão existir seria mandar o usuário procurar o que não está
> lá.

### 3.4 O rastro de fórmulas do fim é descartado

As sete últimas linhas da planilha real (100 a 106) **não estão vazias**:

```
L100  A=46267.65  C=1900/01  D=0  F=0  G=Data errada  I=0  J=110
```

São fórmulas que se estendem além dos dados. Cortar na "primeira linha
vazia" não as pegaria, e as sete entrariam como leads sem nome —
bloqueando a importação inteira com um erro que não é erro.

A regra é outra: **descartar, do fim para trás, as linhas sem nome de
cliente.** Linha sem nome no *meio* dos dados continua sendo erro e é
reportada como tal — ali é digitação faltando, não fim de planilha.

Resultado na planilha real: 105 linhas lidas, 98 úteis.

### 3.5 A numeração das linhas passa a ser a real

O `_linha` era calculado como `índice + 2`, o que só está certo quando o
cabeçalho é a linha 1 e a aba começa em A1. Agora vem da posição real na
planilha, inclusive quando a aba começa fora da A1.

Sem isso, o relatório de erros manda conferir a linha errada — e com 98
registros isso custa a tarde de alguém.

### 3.6 Log em arquivo

O botão **Baixar log** salva na máquina o mesmo conteúdo do aviso, em
`.txt`. Existe porque a planilha frequentemente não é de quem importa: a
CX recebe o arquivo pronto e precisa devolver o que corrigir sem
depender de print de tela.

### 3.7 Os títulos das colunas passam a ser escapados

A lista de detalhes era montada com `innerHTML` a partir dos títulos
vindos do arquivo. Uma planilha com `<img onerror=...>` no cabeçalho
executaria script na sessão de quem importou. Agora tudo passa por
`esc()`.

Não havia exploração conhecida — é uma porta que foi fechada enquanto o
trecho estava aberto.

---

## 4. Decisões técnicas

**Por que contar as abas ocultas, se isso recusa a planilha real.**
Chegamos a considerar contar só as visíveis, o que faria o arquivo atual
passar sem ninguém editar nada. A decisão do usuário foi a regra estrita,
e ela é defensável: aceitar em silêncio uma aba que a pessoa não vê é
exatamente o mecanismo que produziu o erro original. O custo é uma
operação manual, uma vez, com instrução na tela.

**Por que pontuar linhas em vez de exigir o cabeçalho na linha 1.**
Exigir a linha 1 é mais simples e mais rígido. Mas planilha de trabalho
real quase sempre tem título ou logo no topo, e o custo de errar é alto:
o arquivo é recusado sem que nada esteja errado com ele.

**Por que o corte olha o nome e não a linha inteira.** Testado contra o
arquivo real: as sete linhas de rastro têm valor em seis colunas. Só o
nome distingue dado de sobra de fórmula.

**O que este lote deliberadamente NÃO faz.** Não mexe em qual coluna
alimenta a etapa (`Status` × `Status2`), não mapeia `Data Fechamento2`,
não gera modelo e não aceita `.xls`/`.xlsb`. Tudo isso é lote 2 — separar
mantém cada manual legível e cada reversão barata.

---

## 5. Verificação

```bash
npm run prova
```

Devem passar **462 conferências em 12 suítes**, das quais 35 são a suíte
`importacao.mjs`, nova.

A suíte carrega as funções do `public/js/importar.js` **de verdade** —
não uma cópia — injetando uma saída técnica antes do `return` do IIFE. Se
o importador mudar, é a versão nova que responde.

As 13 conferências finais rodam contra a planilha real em
`docs/Gestão de Propostas Formatar.xlsx`. Esse arquivo **não está no
Git**: tem 98 clientes com telefone e valor de contrato. Sem ele, a suíte
pula esse bloco e avisa; as 22 sintéticas continuam valendo.

### Verificação manual

1. Abrir Leads › Importar e escolher `Gestão de Propostas Formatar.xlsx`
2. Deve aparecer **"O arquivo tem mais de uma aba"**, nomeando
   `Config (oculta) · Propostas`
3. Clicar em **Baixar log** e conferir que o `.txt` traz o mesmo texto
4. No Excel: botão direito numa etiqueta › Reexibir › Config › apagar
5. Reimportar. Agora deve aparecer **"Falta a coluna obrigatória: CNPJ"**,
   com a linha do cabeçalho e as colunas ignoradas listadas

O passo 5 é o comportamento correto e final deste lote: a planilha
realmente não tem CNPJ em nenhuma das 26 colunas.

---

## 6. Pendências

**A importação ainda não conclui, e isso é esperado.** Faltam:

| Lote | O que destrava |
|---|---|
| 2 | Modelo `.xlsx` gerado pelo app, arquivo das 98 linhas para preencher os CNPJs, `.xls`/`.xlsb`, precedência de `Status2`, `Data Fechamento2` |
| 3 | Confirmação das etapas novas (`Captação`, e `Fechamento` → `Finalizado`) |

**Não importe os 98 leads antes do lote 3.** Sem ele, as etapas
`Captação` e `Fechamento` ainda não existem no CRM e os leads dessas duas
caem em "Novo Lead" — incluindo os 34 negócios ganhos.

**Achado registrado para o lote 2.** A coluna `Data Fechamento2` tem
formato de data aplicado, mas guarda valores como `9900` em 37 das 98
linhas. Lida como data, `9900` vira 07/02/1927. O mapeamento vai precisar
de uma faixa de sanidade, não só do conversor.

**A versão saiu como 2.23.2**, corretiva, com os três lotes juntos — a
importação só entrega valor completa. A 2.24.0 e a 2.25.0 seguem
reservadas para stakeholders e dossiê, como o roadmap definiu.

---

## 7. Histórico de versões

| Versão | Data | Mudança |
|---|---|---|
| 1.0 | 11/09/2026 | Documento inicial |
