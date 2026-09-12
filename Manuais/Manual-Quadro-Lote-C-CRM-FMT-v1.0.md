# Manual — Lote C: quadro do funil (CRM Formatar)

**Versão:** 1.0
**Data:** 03/09/2026
**Versão do sistema:** 2.11.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**A migração vem antes do deploy.** Se o código subir sem a coluna `pipeline`, o quadro não encontra etapa nenhuma e abre vazio.

```bash
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-005-pipelines-classificacao.sql
```

Confirme:

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT nome, pipeline, encerra FROM etapas ORDER BY ordem"
```

As seis etapas devem aparecer com `pipeline = comercial`. Depois:

```bash
git add -A
git commit -m "v2.11.0 - Quadro do funil, classificacao do lead e correcao do canal"
git push origin main
```

**A migração não é idempotente.** Rodar duas vezes devolve `duplicate column name` — inofensivo, significa que já estava aplicada.

---

## 2. O que este lote entrega

### O quadro

Ao lado dos filtros há um alternador **Tabela / Quadro**. A escolha fica gravada no navegador e vale para as próximas visitas.

Cada coluna é uma etapa do funil. O cabeçalho mostra o **total real** da etapa e a **soma das propostas**. O cartão traz nome, cidade, canal, classificação, valor e quantos dias faltam para o próximo contato — vermelho quando já passou.

**Finalizado e Perdido nascem recolhidas.** São as etapas que só acumulam; abertas, dominariam o quadro com leads que já não pedem ação. A setinha no cabeçalho expande, e essa escolha também é lembrada.

**Clicar no cartão abre a ficha do lead.** A gaveta lateral é o Lote D; até lá o modal que já existe evita um cartão que não faz nada.

### Arrastar e soltar, inclusive no toque

Arraste **pela alça** (os seis pontinhos à esquerda do cartão), não pelo corpo. A alça existe por causa do toque: arrastar pelo corpo competiria com a rolagem vertical da coluna e um gesto anularia o outro.

Funciona com mouse, dedo e caneta. Chegando perto da borda, a faixa de colunas rola sozinha.

### Classificação de 1 a 6

Campo novo na ficha e filtro novo na tela. É o critério interno de complexidade do projeto, e **é a classificação que vai acompanhar o lead quando ele virar cliente** (Lote F) — o ERP usa a mesma escala.

### Gerenciar etapas

Botão no topo do quadro. Permite criar, renomear, trocar a cor, reordenar com as setas e marcar como terminal.

**Etapa com lead dentro não pode ser excluída** — a mensagem informa quantos leads a seguram. E nenhum pipeline pode ficar sem nenhuma etapa.

### Correção: o Canal não estava sendo salvo

A ficha mandava `origem`; a API, desde o Lote A, só lê `canal`. **O valor escolhido no formulário era descartado em silêncio** e a coluna da tabela aparecia vazia em todo lead novo.

O campo agora se chama Canal na tela, é gravado corretamente, e a leitura cobre os dois nomes — leads antigos, gravados em `origem`, continuam aparecendo.

### Filtro por Canal

Filtro novo na tela, que faltava desde o Lote A. **As opções saem do banco, não de uma lista fixa no código**: a importação de planilha aceita qualquer texto no canal — a base já tem "Inbound" e "eventos" —, e um enum deixaria esses leads fora do filtro sem ninguém perceber.

O filtro também alcança os leads antigos, gravados em `origem`.

---

## 3. Decisões técnicas

**Pointer Events, não HTML5 Drag & Drop.** O DnD nativo simplesmente não dispara em toque. Um polyfill traria dependência num projeto sem empacotador; Pointer Events cobre mouse, toque e caneta com um caminho de código só.

**O quadro é genérico por pipeline desde já.** A jornada do cliente do CX é outro pipeline na mesma tabela `etapas` e vai reaproveitar este mesmo componente. Construir o quadro duas vezes seria o desperdício mais caro do projeto.

**Teto de 50 cartões por coluna, aplicado no banco.** Uma coluna com centenas de leads travaria o navegador. O corte usa `ROW_NUMBER()` particionado pela etapa, então o excedente nem sai do D1 — o contador do topo continua mostrando o total real, e o botão "carregar mais" traz o lote seguinte só daquela coluna.

**O que não coube na tela vai para o fim da coluna.** Ao soltar um cartão, os visíveis recebem posição 0..n-1 e os não carregados vão para 100000. Sem isso a reordenação só valeria dentro do teto: os demais continuariam em 0 e se embaralhariam com os arrumados na leitura seguinte. "O que você não viu vem depois do que você arrumou" é previsível; embaralhar em silêncio não é.

**Uma chamada por soltar, e só a coluna de destino é regravada.** A coluna de origem fica com um buraco na sequência de posições — inofensivo, já que a ordenação é relativa. Regravar as duas dobraria a escrita para nada.

**Um filtro só para as duas visões.** O `leads.js` é dono do estado dos filtros e o quadro lê dele. Alternar entre tabela e quadro não pode mudar o conjunto de leads exibido, e duas cópias do filtro divergiriam na primeira manutenção.

**Abaixo de 900px o quadro some.** Um kanban de seis colunas não é usável em celular, com ou sem toque. O alternador desaparece e a tabela assume; se a janela encolher com o quadro aberto, ele cai para a tabela sozinho.

**Lead sem etapa cai na primeira coluna.** Não deveria existir — a migração 004 preencheu todos e a exclusão de etapa em uso é bloqueada —, mas um cartão invisível seria pior que um cartão no lugar errado.

---

## 4. Verificação

- [ ] Alternador Tabela/Quadro aparece à direita dos filtros
- [ ] Seis colunas na ordem correta; Finalizado e Perdido recolhidas
- [ ] Expandir uma coluna terminal e recarregar → continua expandida
- [ ] Arrastar cartão entre colunas persiste após F5 — **no mouse e no toque de um tablet**
- [ ] Reordenar dentro da coluna persiste
- [ ] Soma da coluna bate com a soma dos cartões
- [ ] Clicar no cartão abre a ficha do lead
- [ ] Cadastrar lead com classificação → aparece no cartão e na tabela
- [ ] Filtrar por classificação → vale na tabela e no quadro
- [ ] Escolher um Canal e salvar → **a coluna Canal mostra o valor** (antes ficava vazia)
- [ ] Filtro "Todos os Canais" lista os canais que existem na base, incluindo os vindos de planilha
- [ ] Filtrar por um canal → vale na tabela e no quadro
- [ ] Criar etapa nova → vira coluna; excluir etapa com lead → recusada com a contagem
- [ ] Renomear etapa e trocar a cor → refletem no quadro ao fechar o modal
- [ ] Coluna com mais de 50 leads → mostra "carregar mais" e o contador com o total real
- [ ] Estreitar a janela abaixo de 900px com o quadro aberto → cai para a tabela

---

## 5. O que fica para os próximos lotes

**D — Gaveta lateral** para abrir o cartão sem perder o quadro, com a ficha completa do lead e os campos do funil que hoje existem só no banco.

**E — Gerador de documentos** e a proposta comercial com a identidade visual da empresa.

**F — Cliente e conversão**, onde a classificação criada aqui é herdada pelo cliente.

O quadro da jornada do cliente (Lote H) reaproveita este mesmo componente: muda a constante do pipeline, não o código.

---

## 6. Ponto de atenção

O `server.js` local **não** acompanha estas rotas. Ele mantém leads em memória e usa `PUT /api/leads/:id`, enquanto as Functions usam `?id=` e D1 — uma divergência que já existia desde a migração para o Cloudflare. Para testar este lote use `npx wrangler pages dev` ou o ambiente publicado, não `npm start`.

---

## 7. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 03/09/2026 | Jair Tavares | Versão inicial. Quadro kanban genérico por pipeline, arrastar e soltar com suporte a toque via Pointer Events, teto por coluna com carregar mais, colunas terminais recolhidas, gerenciamento de etapas com cor/ordem/terminal e exclusão condicional, classificação do lead de 1 a 6 com filtro, filtro por Canal com opções vindas do banco, e correção do Canal que não estava sendo gravado. |
