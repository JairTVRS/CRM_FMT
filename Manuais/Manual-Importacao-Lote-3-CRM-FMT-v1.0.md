# Manual — Lote 3: as etapas novas passam pelo usuário

**Versão:** 1.0
**Data:** 11/09/2026
**Versão do sistema:** 2.23.2
**Responsável:** Jair Tavares

---

## 1. Instalação

**Não há migração.** O lote escreve na tabela `etapas`, mas só com
`INSERT`, e só quando alguém clica em "Confirmar importação" com uma
etapa marcada para criar. Nenhuma estrutura muda.

```
functions/api/importar.js      leitura e escrita do apoio, separadas
public/js/importar.js          bloco de decisão na prévia
public/index.html              o contêiner do bloco
public/assets/css/importar.css estilo da lista de etapas
dev/prova/importacao.mjs       86 conferências (eram 70)
package.json                   2.23.1 → 2.23.2
```

**Esta é a versão que fecha a importação.** Os lotes 1 e 2 subiram sem
bump porque sozinhos não concluíam nada; com o 3, o caminho inteiro
funciona. A 2.23.2 é corretiva — a 2.24.0 e a 2.25.0 seguem reservadas
para stakeholders e dossiê, como o roadmap definiu.

---

## 2. O que muda

### 2.1 A prévia passa a perguntar antes de criar

Quando a planilha traz uma etapa que o funil não tem, a prévia mostra:

```
2 etapa(s) da planilha não existem no funil.

  Captação      3 lead(s)    [ Criar a etapa "Captação"        ▾ ]
  Prospecção   12 lead(s)    [ Criar a etapa "Prospecção"      ▾ ]

Advisors que serão cadastrados: Diego.

               [ Cancelar ]  [ Confirmar importação ]
```

Cada etapa tem duas saídas no select: **criar a etapa nova** (o padrão,
porque é o que preserva o dado da planilha) ou **usar uma etapa que já
existe**. Cancelar fecha sem gravar nada.

A pergunta precisa existir porque as duas alternativas silenciosas são
ruins: criar sozinho faz o quadro ganhar colunas que ninguém pediu; usar
a etapa padrão joga fora a posição no funil.

### 2.2 Os advisors param de nascer escondidos

Até a v2.23 o advisor inexistente era criado **no momento da gravação**,
e o usuário descobria depois, na tela de sucesso. Agora ele aparece na
prévia, antes de qualquer escrita.

Foi o que obrigou a separar `lerApoio` de `aplicarApoio`: a prévia
precisa dizer o que será criado sem criar nada.

### 2.3 Três proteções no quadro do funil

**A etapa nasce sempre em `pipeline = 'comercial'`.** A coluna tem
`DEFAULT 'comercial'`, mas depender do default aqui seria frágil: uma
etapa criada pela importação de leads não pode vazar para o quadro da
Jornada do Cliente.

**Nome duplicado não passa.** Diferente de `advisors` e `tags`, a tabela
`etapas` **não tem índice único no nome** ([migracao-004-funil.sql:56](db/migracao-004-funil.sql#L56)).
Nada no banco impede duas "Proposta". A guarda está em duas camadas: o
mapa em memória, com o `toUpperCase()` do JavaScript — que entende
acentos —, e uma consulta `COLLATE NOCASE` antes do `INSERT`, para a
corrida entre dois imports simultâneos.

**Decisão ausente não cria nada.** Se o cliente não mandar a decisão, a
etapa cai na padrão, exatamente como antes deste lote. Criar por omissão
seria escrever no banco sem ninguém ter pedido.

### 2.4 Onde a etapa nova aparece no quadro

No **fim**, e como etapa **não-terminal**. Reposicionar e marcar
"encerra" são um clique cada em Gerenciar etapas. Adivinhar isso aqui
erraria em silêncio — e "terminal" muda como o quadro trata a coluna.

---

## 3. O caminho completo, agora que os três lotes fecharam

1. `node dev/gera-planilha-cnpj.mjs` — já rodado, o arquivo está em
   `docs/Leads-Formatar-preencher-CNPJ.xlsx`
2. Preencher a coluna **CNPJ da Empresa** — 98 células
3. Leads › Importar › escolher o arquivo
4. Na prévia vai aparecer **1 etapa nova: Captação, 3 lead(s)**,
   com "Criar a etapa" já selecionado
5. Confirmar

Depois disso o funil ganha a coluna "Captação" no fim, e os 98 leads
entram assim:

| Etapa | Leads |
|---|---|
| Finalizado | 34 |
| Proposta | 34 |
| Perdido | 25 |
| Captação | 3 |
| Negociação | 2 |

Se preferir que os 3 de "Captação" entrem em "Novo Lead" em vez de criar
uma coluna, troque o select para **Usar a etapa existente: Novo Lead**. A
decisão é na hora, e dá para refazer: reimportar o mesmo arquivo atualiza
os leads pelo CNPJ, não duplica.

---

## 4. Decisões técnicas

**Por que o padrão do select é "criar".** É o que preserva o que está na
planilha. Quem quer unificar sabe que quer; quem não olhou não perde
informação por distração.

**Por que só id vindo da prévia é aceito.** O servidor confere a escolha
contra a lista que ele mesmo mandou. Um id arbitrário no corpo da
requisição é ignorado — sem isso daria para mover lead para uma etapa da
Jornada mandando o id direto.

**Por que a validação de pipeline aparece três vezes.** Na leitura
(`WHERE pipeline = 'comercial'`), na criação (`INSERT ... 'comercial'`) e
na conferência do id escolhido. É a mesma regra em três pontos porque são
três caminhos distintos até o mesmo estrago: lead comercial na trilha de
CX.

**Por que `aplicarApoio` não está no mesmo `batch` dos leads.** A
gravação dos leads é transacional no D1 — ou tudo entra, ou nada. As
etapas e advisors precisam existir **antes**, para virarem id. Se o batch
falhar depois, sobra uma etapa criada sem leads nela: visível, vazia, e
apagável num clique. O contrário — lead apontando para etapa que não
existe — seria pior.

---

## 5. Verificação

```bash
npm run prova
```

**513 conferências em 12 suítes**, 86 na `importacao.mjs`.

As 16 novas rodam contra **SQLite de verdade**, com a tabela `etapas`
montada como a migração 004 a cria, mais uma etapa da Jornada para provar
que o pipeline é respeitado. Cobrem: a separação entre o que existe e o
que não existe, a contagem de leads por etapa nova, o advisor aparecendo
na prévia antes de ser criado, o `INSERT` com pipeline e ordem corretos,
o reaproveitamento de nome repetido, o id forjado sendo ignorado e a
decisão ausente não criando nada.

### Verificação manual

1. Importar um arquivo com uma etapa inventada — a prévia deve listá-la
   com a contagem de leads
2. Trocar o select para uma etapa existente e confirmar — em
   **Gerenciar etapas** não pode ter surgido coluna nova
3. Repetir criando de verdade — a coluna deve aparecer no fim do quadro
4. Importar o mesmo arquivo de novo — a etapa não pode duplicar

---

## 6. Pendências

**Nenhuma bloqueante.** A importação está completa de ponta a ponta.

**O que fica para quem usar:** a etapa criada nasce cinza, no fim do
quadro e como não-terminal. Se "Captação" for para ser a primeira coluna
do funil, é arrastar em Gerenciar etapas.

**Dívida pequena registrada.** O `COLLATE NOCASE` do SQLite só dobra
maiúsculas de ASCII: "CAPTAÇÃO" e "Captação" não são iguais para ele. Na
prática quem protege é o mapa em memória, que usa o `toUpperCase()` do
JavaScript e entende acento. A consulta `COLLATE NOCASE` cobre só a
corrida entre dois imports. Um índice único em `etapas (nome, pipeline)`
resolveria de vez, mas exigiria migração e uma varredura por duplicatas
já existentes — não cabia neste lote.

**Próximos lotes**, na ordem combinada: 4 (sessão de 7 dias, com a
`SESSAO_SECRET` na Cloudflare), 5 (links compartilháveis), 6 (Plano de
Ação sob demanda).

---

## 7. Histórico de versões

| Versão | Data | Mudança |
|---|---|---|
| 1.0 | 11/09/2026 | Documento inicial |
