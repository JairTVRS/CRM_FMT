# Manual — Lote H: jornada do cliente (CRM Formatar)

**Versão:** 1.0
**Data:** 04/09/2026
**Versão do sistema:** 2.14.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**A migração vem antes do deploy.** Se o código subir sem a tabela
`clientes`, a tela da Jornada abre e falha na primeira consulta.

```bash
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-007-jornada-cx.sql
```

Confirme:

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT nome, ordem, encerra FROM etapas WHERE pipeline='jornada' ORDER BY ordem"
npx wrangler d1 execute crm-formatar --remote --command="SELECT nome FROM nucleos WHERE ativo=1"
```

Nove etapas e cinco núcleos. Depois:

```bash
git add -A
git commit -m "v2.14.0 - Jornada do cliente, clientes e nucleos"
git push origin main
```

**Esta migração é idempotente**, ao contrário da 004 e da 005. Ela não
tem nenhum `ALTER TABLE`: só `CREATE ... IF NOT EXISTS` e `INSERT ...
WHERE NOT EXISTS`. Rodar duas vezes não duplica nada nem devolve erro —
verificado rodando duas vezes seguidas contra um SQLite real.

---

## 2. O que este lote entrega

### A segunda trilha

Item **Jornada** no menu lateral, ao lado de Leads. É a trilha de CX:
relacionamento com cliente ativo, pipeline próprio, quadro próprio.

O funil comercial não mudou de comportamento.

### As nove etapas

Contrato assinado · Boas-vindas · Diagnóstico · Plano de ação ·
Implantação · Acompanhamento · Estabilização · Governança · **Encerrado**
(terminal, nasce recolhida).

**Estes nomes são ponto de partida, não contrato.** "Gerenciar etapas"
renomeia, reordena, troca a cor e marca terminal — ajustar a jornada para
o que a CX pratica **não exige migração nova**. Foi por isso que semeei
uma sequência em vez de esperar a lista: o custo de corrigir na tela é
zero, e o quadro vazio não teria como ser testado.

**Expansão não é etapa.** Pela decisão do roadmap ela é acréscimo de
produto ou serviço à entrega — não move o cartão nem volta ao funil.

### Cliente

Tabela `clientes` separada de `leads`. Captar cliente e cuidar de cliente
são processos diferentes: campos, etapas e ciclo de vida próprios.

A ficha tem razão social, nome fantasia, CNPJ, contato, cidade, etapa da
jornada, classificação 1–6, início da jornada, núcleos atendidos e
observações.

**CNPJ é obrigatório e validado por dígito verificador.** Aqui é CNPJ e
não "CNPJ ou CPF" como no lead: é por ele que o Lote F vai casar o
registro com o ERP, e aceitar CPF criaria um cliente que a conversão
nunca encontraria. Quem digita um CPF recebe uma mensagem que diz isso.

### Núcleos e papéis

Botão **"Núcleos e papéis"** no topo da tela.

**Núcleo é o Tipo de Reunião** — o nível do meio entre Time (agrupamento
interno) e Carteira (cliente + núcleo). Semeados: Gestão Comercial,
Gestão de Pessoas, Gestão de Operações, Gestão Financeira, Governança.

**Papel é a função da pessoa do lado do cliente.** A lista **nasce
vazia** de propósito — semear papéis inventados encheria as opções com o
que ninguém escolheu. Quem vai consumi-los de verdade é o mapa de
stakeholders do Dossiê de Experiência (Lote L).

Mesma mecânica de advisors e tags: digita o nome, vira opção para todos.
**Núcleo atendido por algum cliente não pode ser excluído** — a mensagem
diz quantos clientes o seguram.

### Ver inativos

Cliente inativado sai do quadro mas segue consultável, com a ficha
abrindo normalmente e um botão de reativar. A exclusão é lógica, como nos
leads: histórico de relacionamento não se apaga sem rastro.

---

## 3. Decisões técnicas

**O quadro virou fábrica, não foi copiado.** O Lote C prometeu que a
jornada reaproveitaria o mesmo componente; a promessa foi cobrada aqui. O
`quadro.js` era um singleton com o pipeline numa constante e os IDs do
DOM embutidos — dava para uma trilha só. Agora `Quadro.criar()` devolve
uma instância, e o funil e a jornada são duas configurações do mesmo
código: qual API chamar, quais filtros mandar, como desenhar o cartão, se
o cabeçalho soma dinheiro. Arraste, teto por coluna, colunas recolhidas e
gerenciamento de etapas existem uma vez só.

**Um modal de etapas para as duas trilhas.** Quem abre informa o
pipeline. Duplicar o modal duplicaria os ouvintes, e dois ouvintes no
mesmo `#etapas-lista` gravariam a mesma edição duas vezes, cada um no seu
pipeline.

**O montador do quadro saiu para `_lib/quadro.js`.** Não é cosmético: a
regra "registro sem etapa cai na primeira coluna" e o teto por coluna
precisam valer igual nas duas trilhas. Com dois consumidores, duas cópias
divergiriam na primeira manutenção.

**A jornada não soma dinheiro no cabeçalho.** O valor do contrato é do
Lote G; R$ 0 em nove colunas seria pior que soma nenhuma.

**A tela da Jornada só busca dados quando é aberta.** Diferente dos
leads, que são a tela inicial: puxar as duas trilhas no login gastaria
consultas ao D1 por uma aba que talvez nem seja aberta.

**`erp_id` e `lead_id` não são campos de formulário.** Ficam fora da
lista de campos graváveis de propósito — são vínculos, preenchidos pela
conversão do Lote F a partir do que o hub responder. Deixá-los expostos
permitiria carimbar um ID de ERP à mão, e um vínculo falso é pior que
vínculo nenhum, porque a trava do Lote F passaria a confiar nele.
**Verificado**: `erp_id` mandado no corpo é ignorado.

**Cadastro manual sem checar o ERP, por ora.** A regra "todo cliente de
CX tem que existir no ERP" continua valendo e vira trava no Lote F.
Aplicá-la agora, sem a chave do hub para verificar, deixaria a trilha
inteira inutilizável. `erp_id` nulo significa "cadastrado à mão, ainda
não conferido" — e o cartão do quadro mostra **"sem ERP"** para que isso
não passe por conferido.

**Filtro por núcleo usa `json_each`, não `LIKE`.** Um `LIKE '%1%'` sobre
o JSON de IDs casaria com 1, 10, 11 e 21. **Verificado**: filtrar pelo
núcleo 13 não traz quem tem 1 e 3.

**O índice único do CNPJ é parcial, só entre ativos.** Um cliente
inativado precisa poder voltar com o mesmo CNPJ, e um índice total
impediria justamente isso.

---

## 4. Correções que este lote carrega

Três bugs latentes que só se manifestariam **depois** de existir um
segundo pipeline — ou seja, agora.

**Lead novo podia nascer numa coluna do CX.** O `POST /api/leads`
escolhia a etapa padrão com `ORDER BY ordem LIMIT 1` **sem filtrar
pipeline**. A jornada também tem uma etapa de ordem 1, e o desempate
ficava por conta do banco. **Verificado** que agora cai sempre na
primeira do funil comercial.

**A importação de planilha tinha o mesmo problema, em dobro.** O mapa de
etapas por nome não filtrava pipeline — um "Encerrado" da jornada entraria
no mapa — e a etapa padrão saía da mesma consulta sem escopo.

**Etapa da jornada com cliente dentro seria apagada como se estivesse
vazia.** A trava de exclusão condicional contava só `leads`. Uma coluna
cheia de clientes respondia "0 em uso", e apagá-la deixaria os cartões
órfãos, sem coluna para onde voltar. Agora conta as duas tabelas e a
mensagem diz qual das duas segura a etapa. **Verificado** nos dois
sentidos: com cliente dentro recusa; vazia, exclui.

Além desses, dois endurecimentos:

- `/api/leads` **ignora** `?pipeline=` na query. Antes, `?pipeline=jornada`
  devolvia as nove colunas do CX zeradas — colunas de uma trilha com os
  registros da outra. Cada endpoint responde pela sua trilha.
- Mover cartão de cliente **confere se a etapa de destino é da jornada**.
  Sem isso um corpo forjado moveria o cliente para uma coluna do funil, e
  o cartão sumiria dos dois quadros.

---

## 5. Verificação

O que **eu** verifiquei, contra SQLite real (migrações aplicadas em
ordem, rotas exercitadas por um shim da interface do D1): 9 etapas
semeadas com a nona terminal, idempotência da migração rodando duas
vezes, CNPJ único entre ativos e reaproveitável após inativação, criação
com saneamento dos núcleos, recusa de CPF, recusa de CNPJ inválido,
duplicado devolvendo o existente, `erp_id` do corpo ignorado, quadro com
9 colunas, mover dentro da jornada, recusa de mover para o outro
pipeline, filtro por núcleo sem falso positivo, exclusão de etapa e de
núcleo em uso, papéis sem coluna `cor`, inativar/reativar, e as duas
regressões do pipeline. 45 asserções: 36 de rotas e 9 de migração.

O que **você** precisa conferir no navegador — nada disso foi testado:

- [ ] Item "Jornada" aparece no menu e abre a tela
- [ ] Incluir Cliente grava e aparece na tabela
- [ ] CNPJ inválido é recusado com mensagem clara
- [ ] Alternador Tabela/Quadro aparece à direita dos filtros
- [ ] Nove colunas na ordem; **Encerrado** nasce recolhida
- [ ] Arrastar cartão de cliente entre etapas persiste após F5 — **no mouse e no toque de um tablet**
- [ ] Reordenar dentro da coluna persiste
- [ ] Clicar no cartão abre a ficha do cliente
- [ ] Cartão sem vínculo de ERP mostra **"sem ERP"**
- [ ] Marcar núcleos na ficha → aparecem no cartão e na coluna Núcleos da tabela
- [ ] Filtrar por núcleo → vale na tabela e no quadro
- [ ] "Núcleos e papéis": criar, renomear, trocar cor, excluir
- [ ] Excluir núcleo em uso → recusado com a contagem
- [ ] Criar um papel → entra na lista
- [ ] "Gerenciar etapas" no quadro da jornada mostra **as etapas da jornada**, não as do funil, e o título diz qual trilha
- [ ] O mesmo botão na tela de Leads continua mostrando as seis do funil
- [ ] "Ver inativos" → lista os desligados e o botão de reativar funciona
- [ ] Estreitar a janela abaixo de 900px com o quadro aberto → cai para a tabela
- [ ] **Nada mudou na tela de Leads**: cadastro, importação de planilha e quadro do funil seguem iguais

---

## 6. O que fica para os próximos lotes

**F — Cliente e conversão.** Segue travado pela chave do hub com escopo
ampliado. Quando chegar: busca do CNPJ no ERP com trava, `erp_id` e
`lead_id` preenchidos na conversão, classificação herdada do lead. A
tabela e a tela já estão prontas para receber — o Lote F acrescenta por
cima, não refaz.

**G — Contrato e boas-vindas**, esperando o template em Word.

**I — Reuniões e atas**, que traz a **carteira** (cliente + núcleo). O
vocabulário de núcleos que este lote criou é o que ela vai usar.

**L — Dossiê de Experiência e stakeholders**, o consumidor de verdade dos
papéis.

---

## 7. Como rodar local para validar

**`npm start` não serve estas rotas.** Ele sobe o `server.js`, que ficou
para trás na migração para o Cloudflare: mantém leads em memória e usa
`PUT /api/leads/:id`, enquanto as Functions usam `?id=` e D1. Quem serve
as rotas de verdade é o Wrangler.

### Uma vez só

**1. `wrangler.toml`** — já criado na raiz e **fora do Git**. Sem ele, o
`wrangler d1 execute --local` responde *"Couldn't find a D1 DB with the
name or binding 'DB'"*. Ele está no `.gitignore` de propósito: um
`wrangler.toml` versionado faria o Cloudflare Pages configurar o build
por ele em vez do painel, mudando produção sem necessidade.

**2. `.dev.vars`** — já criado e completo, com o `GOOGLE_CLIENT_ID`, as
chaves de IA que estavam no `.env`, e o apontamento para o dublê do hub.

**Por que existe um dublê.** O middleware pergunta ao hub, a cada
requisição, se o e-mail que logou está ativo no ERP. Isso exige a
`HUB_API_KEY`, que está cadastrada como *Secret* na Cloudflare — e
segredo lá é **de mão única**: grava e nunca devolve, nem para você. O
hub também não emite chave por autoatendimento. Sem alguma saída,
nenhuma rota protegida sobe na máquina de desenvolvimento.

A saída foi uma costura mínima: `HUB_USERS_URL` passou a ser lida do
ambiente, com o hub real como padrão. Em produção a variável não existe
e o comportamento publicado é idêntico ao de antes.

**O que isso NÃO afrouxa:** o ID token do Google continua validado por
inteiro — assinatura RS256 contra o JWKS do Google, `aud`, `iss`, `exp` e
e-mail verificado. Você faz login de verdade com sua conta. Só a pergunta
seguinte, "este e-mail está ativo no ERP?", muda de endereço.
**Verificado**: token forjado é recusado com
`{"code":"TOKEN_INVALIDO","error":"Sessão inválida: Chave de assinatura
não reconhecida."}`.

O dublê vive em `dev/hub-stub.mjs`. Ele **nunca vai ao ar**: o Pages
publica `public/` e executa `functions/`, e `dev/` não é nem uma nem
outra. Escuta só em `127.0.0.1`.

Quando a chave do hub existir para desenvolvimento, basta apagar a linha
`HUB_USERS_URL` do `.dev.vars` e pôr a chave real em `HUB_API_KEY` — o
código não muda.

**3. Popular o banco local.** O D1 local nasce vazio; as migrações
precisam ser aplicadas nele também, na ordem:

```bash
npm run db:local -- --file=db/schema.sql
npm run db:local -- --file=db/migracao-002-html-no-d1.sql
npm run db:local -- --file=db/migracao-003-leads.sql
npm run db:local -- --file=db/migracao-004-funil.sql
npm run db:local -- --file=db/migracao-005-pipelines-classificacao.sql
npm run db:local -- --file=db/migracao-006-propostas.sql
npm run db:local -- --file=db/migracao-007-jornada-cx.sql
```

As migrações 004 e 005 devolvem `duplicate column name` se rodarem duas
vezes — inofensivo, significa que já estavam aplicadas. **Isso já foi
feito**: o banco local está com as 6 etapas do funil e as 9 da jornada.

### A cada sessão

**Dois terminais.** No primeiro, o dublê do hub:

```bash
npm run dev:hub
```

No segundo, a aplicação:

```bash
npm run dev
```

Abre em **http://localhost:3000**.

Se a porta 3000 reclamar que está ocupada, sobrou `workerd` de uma
execução anterior — o Wrangler nem sempre leva os filhos junto ao ser
interrompido. No PowerShell:

```powershell
Get-Process workerd -ErrorAction SilentlyContinue | Stop-Process -Force
```

O sintoma de não fazer isso é traiçoeiro: o processo velho continua
servindo com o **ambiente antigo**, e alterações no `.dev.vars` parecem
não ter efeito.

Para testar como a tela reage a um acesso negado, sem mexer em nada:

```bash
node dev/hub-stub.mjs --inativo        # usuário existe, mas isActive=false
node dev/hub-stub.mjs --sem-cadastro   # e-mail não consta no ERP
``` A porta importa: `localhost:3000` está
na lista de origens permitidas do middleware, e o Google Cloud Console
precisa dela como origem JavaScript autorizada para o login funcionar.

Para consultar o banco local sem sair do terminal:

```bash
npm run db:local -- --command "SELECT nome FROM etapas WHERE pipeline='jornada' ORDER BY ordem"
```

O `npm run db:remoto` é o mesmo contra o banco de produção — sem `-y`, de
propósito: no remoto a confirmação é uma proteção, não um atrito.

### O que eu verifiquei desse fluxo

Migrações aplicadas no D1 local (6 etapas comerciais + 9 da jornada
conferidas por consulta), servidor sobe em `127.0.0.1:3000`,
`/api/config` responde com a versão **v2.14.0**, e `index.html`,
`assets/css/cx.css` e `js/clientes.js` são servidos com 200.

**O que não dá para eu verificar:** o login. Ele depende do
`HUB_API_KEY`, e a partir daí é navegador — que é a sua parte, com a
lista da seção 5.

### Dados de teste

O banco local é um arquivo em `.wrangler/state`, separado do de produção.
Pode cadastrar cliente à vontade: não encosta no ambiente publicado. Para
zerar e recomeçar, apague `.wrangler/state` e reaplique as migrações.

---

## 8. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 04/09/2026 | Jair Tavares | Versão inicial. Trilha de CX com as nove etapas da jornada no pipeline próprio, tabela e ficha de clientes com cadastro manual, cadastro de núcleos e papéis, quadro refatorado em fábrica para servir as duas trilhas, montador do quadro extraído para `_lib`, ver inativos com reativação, e correção de três bugs latentes de separação entre pipelines. |
