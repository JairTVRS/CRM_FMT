# Manual — Lote L: mapa de stakeholders e Dossiê de Experiência (CRM Formatar)

**Versão:** 1.0
**Data:** 05/09/2026
**Versão do sistema:** 2.15.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**A migração vem antes do deploy.** Se o código subir sem as tabelas, a
aba Stakeholders abre e falha na primeira consulta — exatamente o que
aconteceu com a proposta na v2.13.0.

```bash
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-008-stakeholders-dossie-cx.sql
```

**Confirme depois de aplicar.** Esta é a segunda metade da convenção, a
que faltou na 006 e custou um dia de proposta quebrada no ar:

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name IN ('stakeholders','dossies_cx')"
```

Duas linhas. Se vier só uma ou nenhuma, **não faça o deploy** — a
migração não passou.

Depois:

```bash
git add -A
git commit -m "v2.15.0 - Mapa de stakeholders e Dossie de Experiencia"
git push
```

A migração é segura para rodar duas vezes: só tem `CREATE ... IF NOT
EXISTS`, nenhum `ALTER TABLE`.

---

## 2. O que este lote entrega

### A ficha do cliente ganhou abas

Até aqui a ficha era um formulário só. Agora tem três abas: **Ficha**,
**Stakeholders** e **Dossiê de Experiência**.

As abas têm classes próprias (`cli-tab-*`) e um comutador próprio, no
`clientes.js`. Não são as `.tab-btn` do modal de lead de propósito: o
`app.js` liga um ouvinte global naquelas classes que esconde **toda**
`.tab-content` da página, e reaproveitá-las faria um clique aqui apagar
as abas da ficha do lead.

### Mapa de stakeholders

As pessoas do lado do cliente: quem decide, quem influencia, quem
participa de cada núcleo.

Cada pessoa tem nome, papel, cargo declarado, contato, **influência**,
**postura**, marca de **patrocinador**, os **núcleos** de que participa e
observações.

Três decisões que valem a pena entender antes de usar:

**Influência e postura nascem "não avaliada", não numa média.** Cadastrar
alguém não é ter avaliado a pessoa. Um "média" ou "neutro" por omissão
carimbaria no mapa um juízo que ninguém emitiu — e este é um documento
que fala de gente com nome. Na tela, "não avaliada" aparece apagada e
tracejada; as demais têm cor. O dossiê conta as duas coisas separado.

**Papel é a função no negócio; cargo é o título que a pessoa usa.** São
campos diferentes porque divergem o tempo todo: o "Analista de Suprimentos"
pode ser o decisor de fato.

**Os núcleos oferecidos são os do cliente**, os marcados na aba Ficha —
não todos os cadastrados. Vincular alguém a um núcleo em que a conta não
é atendida criaria dado que nenhuma tela mostra, e o dossiê aponta
"núcleo atendido sem ninguém mapeado" cruzando justamente essas duas
listas. Se a ficha não tem núcleo marcado, a caixa diz isso e manda
marcar lá.

O botão **+** ao lado de Papel cria um papel novo sem sair da ficha,
como advisors e tags desde o Lote A.

### Dossiê de Experiência

Documento de pós-venda, o oposto do Dossiê Executivo. O Executivo fala de
um prospect que não sabe que existe um documento sobre ele; este fala da
conta como ela é hoje, e é **interno** — a capa diz isso com todas as
letras.

Quatro folhas mais capa:

1. **A conta hoje** — cadastro, jornada, núcleos atendidos, panorama
2. **Mapa de stakeholders** — a tabela das pessoas, o mapa em números,
   a leitura do modelo, o que falta mapear
3. **Leitura da relação** — riscos, oportunidades de expansão, perguntas
   para o próximo contato
4. **Recomendação** — próximos passos, o que o dossiê ainda não vê, e
   como o documento foi produzido

A aba mostra **antes de gerar** o que entra na versão: etapa, tempo de
relação, núcleos, pessoas mapeadas, patrocinador — e, em laranja, as
duas lacunas que o documento vai apontar (núcleo sem ninguém mapeado,
pessoas ainda não avaliadas). Dá a chance de preencher em vez de
descobrir no PDF.

---

## 3. Decisões técnicas

### Gerar sempre gera

No Dossiê Executivo, clicar em gerar abre o existente em vez de refazer:
os fatos externos de um prospect mudam pouco e duas gerações custariam
dinheiro para dizer o mesmo.

Aqui é o contrário. A conta muda toda semana — pessoa nova mapeada, etapa
que avançou — e pedir o dossiê é pedir a leitura de **hoje**. Por isso
são dois botões distintos: **"Abrir a última versão"** e **"Gerar nova
versão"**. Nenhum dos dois decide sozinho o que o usuário quis.

Gerar **nunca sobrescreve**: cria a versão seguinte e a anterior continua
consultável, porque documento lido numa reunião precisa ser reproduzível
como foi lido.

### A chave é o cliente, não o CNPJ

`dossies_cx` é tabela separada de `dossies` e chaveada por `cliente_id`.

Um cliente convertido terá os dois documentos. Chavear ambos por CNPJ
faria as versões de um contarem por cima das do outro — "versão 3" seria
a terceira geração de qualquer um deles. Além disso, o de Experiência
fala da conta como ela existe no CRM; o sujeito é a linha de `clientes`,
não o CNPJ na Receita.

### O juízo sobre pessoas é entrada, não saída

O modelo **não** classifica ninguém. Quem diz que alguém é resistente é a
CX, na ficha. O prompt do sistema proíbe explicitamente redefinir
influência ou postura e proíbe opinar sobre caráter, competência ou vida
pessoal. As observações do modelo devem ser sobre a **relação** — quem
participa de quê, onde a Formatar não tem interlocutor —, não sobre a
pessoa.

Onde está escrito "não avaliada", o prompt manda tratar como informação
que **falta**, nunca como neutralidade.

### O que o dossiê declara que não vê

Reuniões e atas (Lote I), indicadores (K), saúde da carteira (M) e NPS
(N) ainda não chegam ao CRM. O documento tem uma seção própria dizendo
isso.

Não é rodapé de cautela: um dossiê de pós-venda calado sobre reuniões e
saúde seria lido como "está tudo bem por aqui", que é uma afirmação que
ninguém verificou. A lista vive em `PENDENCIAS`, no
`_lib/schema-dossie-cx.js`, e some sozinha — cada lote que chegar apaga a
sua linha.

### A aritmética fica em código

Contar pessoas, achar patrocinadores e cruzar núcleos é exato. Pedir isso
a uma IA seria trocar uma resposta certa por uma provável, e número
errado num bloco factual desmoraliza o documento inteiro. O
`resumirMapa()` calcula, e o contexto entrega o resultado ao modelo já
pronto, com a instrução de não recalcular.

### Exclusão é lógica, sempre

Remover alguém do mapa marca `ativo = 0`. Os dossiês já gerados citam a
pessoa pelo nome, e apagar a linha faria o histórico referenciar alguém
que o banco jura nunca ter existido. O aviso de confirmação diz isso.

O índice único de nome por cliente é **parcial** (`WHERE ativo = 1`):
quem saiu da empresa e voltou pode ser recadastrado.

### Saneamento extraído, não reescrito

`limparHtml`, `texto`, `url` e `lista` moravam no `schema-dossie.js`.
Foram para `_lib/saneamento.js` quando o Dossiê de Experiência virou o
segundo consumidor. O comportamento é o mesmo — só mudou de arquivo.

### O que este lote *não* fez

Os três geradores de documento — dossiê, proposta e agora dossiê de CX —
são **irmãos, não compartilhados**: cada um tem a sua própria função de
calcular a próxima versão e gravar. Unificá-los continua registrado como
dívida no roadmap. Fazê-lo dentro deste lote significaria mexer no
caminho da proposta, que já quebrou em produção uma vez.

---

## 4. Correções que este lote carrega

**A trava de exclusão de núcleo estava incompleta.** Contava só os
clientes. Agora conta também as pessoas do mapa, e a mensagem diz quantos
de cada. Sem isso, um núcleo que saiu da ficha mas continua vinculado a
pessoas poderia ser excluído — e o mapa passaria a citar um núcleo que o
banco não sabe mais nomear.

**A trava de exclusão de papel não existia.** O ramo estava no código
desde a 007 com `emUso = 0`, esperando o consumidor. Ele chegou.

**`limparFicha()` varria o modal inteiro.** Com três formulários dentro
do mesmo modal, isso apagaria o que estivesse sendo digitado na aba ao
lado — e no caixote do patrocinador nem funcionaria, porque `value = ''`
não desmarca uma caixa de seleção. Agora limpa só a aba Ficha.

---

## 5. Verificação

### O que eu verifiquei

Prova real, em SQLite em memória, com a migração 008 de verdade e as
consultas que a API faz — **41 verificações, todas passando**:

- a 008 aplica, cria as duas tabelas e é segura para rodar duas vezes;
- a ordem da listagem (patrocinador, depois influência);
- nome repetido no mesmo cliente é barrado, mas quem saiu e voltou pode
  ser recadastrado;
- a trava do núcleo conta clientes **e** pessoas; a do papel conta as
  pessoas;
- `UNIQUE (cliente_id, versao)` barra duas gerações na mesma versão;
- a aritmética do mapa, incluindo "núcleo atendido sem ninguém mapeado"
  e a distinção entre não avaliada e neutra;
- `mesesDesde` com data ausente, inválida e futura;
- o saneamento da resposta da IA (`<script>` e `onclick` removidos, itens
  vazios descartados, confiança fora da lista caindo para baixa);
- o render do documento com dados vindos desse banco — 15 KB, sem
  `undefined`, sem `[object Object]`, sem vazar identificador;
- conta **sem ninguém mapeado** gera documento mesmo assim;
- seção sem conteúdo não é impressa.

### O que eu NÃO verifiquei — é seu

Nada disso passou por navegador, e a geração real nunca foi chamada:
**a prova usou uma resposta de IA fabricada, não o DeepSeek**.

- [ ] As três abas da ficha trocam, e **clicar nelas não apaga as abas da
      ficha do lead** (abra um lead, troque de aba lá, volte)
- [ ] Cliente novo, ainda não salvo: as abas Stakeholders e Dossiê dizem
      "salve o cliente primeiro"
- [ ] Cadastrar uma pessoa, editar, remover
- [ ] Nome repetido no mesmo cliente dá a mensagem de duplicado
- [ ] O **+** cria um papel novo e já o seleciona
- [ ] Cliente sem núcleo na Ficha: a caixa de núcleos da pessoa manda
      marcar lá
- [ ] Marcar um núcleo na Ficha **sem salvar** e ir na aba Stakeholders —
      ele já aparece na caixa da pessoa
- [ ] O resumo da aba do dossiê bate com o que está na tela
- [ ] **Gerar o dossiê de verdade** — é o único caminho que chama a IA
- [ ] Abrir uma versão antiga pelo histórico
- [ ] Baixar HTML e imprimir/PDF
- [ ] Trocar de cliente e conferir que a lista de pessoas **não** é a do
      anterior

---

## 6. O que fica para os próximos lotes

**Perfis de acesso continuam não existindo, e a dívida cresceu de novo.**
Este lote guarda juízo da Formatar sobre pessoas nomeadas do cliente —
"resistente", "não avaliada", observações escritas à mão. Enquanto só uma
pessoa usa o CX, é aceitável. Quando a equipe crescer, isso vira
requisito, não melhoria.

**Carteira ainda não existe.** O dossiê fala de núcleos atendidos, não de
carteiras. Carteira é cliente + núcleo e chega no Lote I, com as
reuniões.

**O mapa não sabe quem respondeu o quê.** O Lote N vai querer apontar
"quem respondeu o NPS" para uma linha de `stakeholders` — é por isso que
pessoa é tabela e não JSON dentro de `clientes`.

---

## 7. Como rodar local para validar

Sem mudanças em relação ao Lote H: seção 7 do
`Manual-Jornada-Lote-H-CRM-FMT-v1.0.md`. Dois terminais, `npm run dev:hub`
e `npm run dev`; `npm start` **não** serve as rotas das Functions.

Para este lote, aplique a 008 no banco local antes:

```bash
npm run db:local -- --file=db/migracao-008-stakeholders-dossie-cx.sql
```

Se a porta 3000 reclamar, sobrou `workerd` órfão — o sintoma traiçoeiro é
o processo velho continuar servindo com o ambiente antigo:

```powershell
Get-Process workerd | Stop-Process -Force
```

---

## 8. Histórico de versões

| Versão | Data | O quê |
|---|---|---|
| 1.0 | 05/09/2026 | Lote L — mapa de stakeholders e Dossiê de Experiência (sistema 2.15.0) |
