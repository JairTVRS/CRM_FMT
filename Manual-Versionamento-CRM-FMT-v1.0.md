# Manual — Unificação do versionamento de documentos (CRM Formatar)

**Versão:** 1.0
**Data:** 05/09/2026
**Versão do sistema:** 2.17.0
**Responsável:** Jair Tavares

---

## 1. Instalação

### ⚠️ A ordem importa mais do que o normal aqui

O código novo lê `WHERE status = 'concluido'` da tabela `propostas`. Essa
coluna **não existe** antes da migração 009. Se o deploy subir primeiro,
**toda leitura de proposta quebra** com `no such column: status` — a
mesma forma exata do incidente da v2.13.0.

**Migração primeiro. Sempre.**

### A 009 NÃO é segura para rodar duas vezes

As 007 e 008 eram, porque só tinham `CREATE ... IF NOT EXISTS`. Esta tem
`ALTER TABLE ADD COLUMN`, e o SQLite não oferece
`ADD COLUMN IF NOT EXISTS`. Reaplicar devolve `duplicate column name` e
aborta no meio.

**Confira ANTES:**

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('propostas')"
```

Se `status` já aparecer, **não aplique** — já foi.

**Aplique:**

```bash
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-009-propostas-status.sql
```

**Confira DEPOIS** (a segunda metade da convenção, a que faltou na 006):

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('propostas')"
npx wrangler d1 execute crm-formatar --remote --command="SELECT versao, status FROM propostas ORDER BY versao"
```

Devem aparecer `status` e `erro_mensagem`, e **toda proposta que já
existia tem que estar com `status = 'concluido'`**. Se alguma vier nula,
ela sumiu da tela — pare e me avise.

Só então:

```bash
git add -A
git commit -m "v2.17.0 - Versionamento de documento num modulo so"
git push
```

---

## 2. O que muda

**Nada na tela.** Este lote é dívida técnica: o comportamento visível é o
mesmo, e a verificação existe para provar que continua sendo.

### O problema

Os três geradores — Dossiê Executivo, Proposta Comercial e Dossiê de
Experiência — guardavam documento do mesmo jeito: calcula a próxima
versão, renderiza o HTML **com o número em mão**, grava, e na colisão do
`UNIQUE` refaz com o número seguinte.

Estava escrito **três vezes**: em `_lib/storage.js`, dentro da
`proposta.js` e dentro da `dossie-cx.js`. Com um consumidor, extrair era
abstração prematura — está registrado assim no roadmap desde o Lote E.
Com três, e um quarto a caminho (o contrato, no Lote G), deixou de ser.

### A solução

Um `_lib/versionamento.js` com uma fábrica, `criarVersionador`,
parametrizada pelo que de fato varia:

| | `dossies` | `propostas` | `dossies_cx` |
|---|---|---|---|
| chave | `cnpj` | `lead_id` | `cliente_id` |

O Executivo é chaveado por CNPJ porque fala de um prospect que talvez nem
esteja no CRM; a proposta, por lead; o de Experiência, por cliente. São
sujeitos diferentes — é por isso que as três tabelas existem, em vez de
uma com um campo "tipo".

O que não varia mora no módulo: `versao`, `gerado_por`, `gerado_em`,
`html`, `tamanho_bytes`, `dados_json`, `status`. Colunas próprias de cada
documento — `razao_social` e as `fonte_*` do Executivo, o `provider` de
quem usa IA — entram por `extras`, um mapa de coluna para valor.

---

## 3. Os dois defeitos que a unificação revelou

Comparar as três cópias lado a lado mostrou coisas que ninguém veria
lendo uma só.

### A proposta era a única que não registrava falha

`dossies` e `dossies_cx` gravam uma linha com `status = 'erro'` e a
mensagem quando a geração quebra. A proposta não deixava rastro nenhum.

A ironia é que foi **justamente a proposta** que quebrou em produção na
v2.13.0, e ficou um dia inteiro falhando sem que o banco guardasse uma
linha sequer sobre isso.

É o que a migração 009 conserta.

**Não entra coluna `provider` na proposta.** As outras duas têm porque o
documento é escrito por IA; a proposta sai de um formulário preenchido
por gente. Uma coluna sempre nula documentaria uma semelhança que não
existe.

### O `dados_json` do Executivo guardava `versao: null`

O `dados_json` existe para permitir reprocessar o template — mudar
layout, corrigir cálculo — sem chamar a IA de novo. Mas o Executivo
gravava `montarDados(null)`: o número da versão ficava nulo no JSON.

Reprocessar a partir dele renderizaria uma capa **sem versão**. O Dossiê
de Experiência já contornava isso reinjetando o número na hora de gravar;
o Executivo não.

Agora `dados` pode ser função da versão, e os três gravam o número certo.

---

## 4. Decisões técnicas

### Por que `storage.js` continua existindo

Virou uma camada fina que configura o versionador para `dossies` e traduz
os nomes que a `dossier.js` já usava.

Poderia sumir, com a `dossier.js` falando direto com o módulo. Não sumiu
porque `salvarDossie` sabe transformar `fontes` e `dados.empresa` em
coluna — `fonte_cnpj`, `razao_social`. Isso é conhecimento do Executivo,
não de documento em geral, e empurrá-lo para o módulo comum faria o comum
saber de dossiê.

### Nome de tabela em SQL por interpolação

Não há como parametrizar identificador em SQLite. Todos vêm de constantes
do nosso próprio código, nunca de requisição — mas há uma checagem contra
`/^[A-Za-z_][A-Za-z0-9_]*$/` na criação do versionador e em cada coluna
de `extras`. É o tipo de porta que se fecha antes de alguém pensar em
abri-la.

### O HTML continua sendo montado dentro do laço

`montarHtml` recebe o número da versão em vez de o HTML vir pronto. É o
que permite ao documento estampar "Versão N" na própria capa: o número só
é conhecido lá dentro, e **na colisão o documento é re-renderizado com o
número certo**. Montar fora gravaria um documento dizendo "Versão 3"
numa linha gravada como versão 4.

A proposta é a exceção que confirma a regra: ela não estampa versão, e
seu `montarHtml` ignora o número que recebe.

---

## 5. Verificação

### O que eu verifiquei

**33 verificações, todas passando**, contra as **três formas de tabela de
verdade** em SQLite em memória, através de um adaptador que expõe a mesma
API do D1 — testar contra outra interface provaria outra coisa.

- a 009 acrescenta as colunas, e a proposta que já existia **nasce
  `concluido` e não some da tela**;
- reaplicar a 009 **quebra** — o aviso do cabeçalho é verdadeiro, e está
  provado;
- os três gravam, numeram a partir do que já existia e **nunca
  sobrescrevem**;
- o `dados_json` guarda o número certo nos três, inclusive no Executivo;
- as guardas: HTML vazio, documento gigante, `montarHtml` que não é
  função, sem binding do D1 — e **nenhuma recusa deixa linha no banco**;
- nome de tabela fora do padrão é recusado na criação;
- a **colisão de verdade**: uma gravação intercalada no meio do processo
  força a retentativa, que refaz com o número seguinte — e o documento
  gravado estampa a versão certa, não a que colidiu;
- a proposta deixa rastro ao falhar, a linha de erro **não** aparece no
  histórico nem abre como documento, e o padrão continua sendo a última
  versão concluída;
- `dados_json` corrompido devolve null em vez de lançar;
- nenhum dos três endpoints tem `INSERT` ou cálculo de versão próprio, e
  o módulo comum tem exatamente dois `INSERT`.

As provas dos lotes anteriores continuam passando: 41 do Lote L, 24 dos
ajustes de tela, e a conferência de fiação de ids e classes.

### O que eu NÃO verifiquei — é seu

Nada passou por navegador, e **nenhuma geração real foi chamada**. Como
este lote mexe nos três caminhos de documento, a verificação importa mais
que o normal:

- [ ] **Gerar uma proposta** num lead — o caminho que já quebrou em
      produção
- [ ] Abrir uma proposta antiga pelo histórico (as de antes da 009)
- [ ] Gerar uma segunda versão e conferir que a primeira continua abrindo
- [ ] **Gerar um Dossiê Executivo** e conferir a versão na capa
- [ ] Abrir um dossiê antigo pelo seletor de versões
- [ ] **Gerar um Dossiê de Experiência** (precisa de um cliente cadastrado)
- [ ] Com a chave de IA desligada, gerar um dossiê e conferir que a linha
      de erro **não** aparece no histórico

---

## 6. O que fica

**A dívida do roadmap está paga**, e o contrato do Lote G passa a ser o
quarto consumidor quase de graça: configura tabela e chave, e as
`extras` que forem próprias dele.

---

## 7. Histórico de versões

| Versão | Data | O quê |
|---|---|---|
| 1.0 | 05/09/2026 | Versionamento num módulo só; proposta ganha registro de falha (sistema 2.17.0) |
