# Manual — Lote F (parte 2): os clientes do ERP na Jornada (CRM Formatar)

**Versão:** 1.0
**Data:** 05/09/2026
**Versão do sistema:** 2.19.0
**Responsável:** Jair Tavares

---

## 1. ONDE COLAR A CHAVE

Este é o passo que falta para tudo funcionar. **A chave não vai em
nenhum arquivo do repositório** — é um Secret do ambiente.

### Em produção (Cloudflare Pages)

1. Painel da Cloudflare → **Workers & Pages** → o projeto do CRM
2. **Settings** → **Variables and Secrets**
3. **Add variable**, escolhendo o tipo **Secret** (não "Plaintext")
4. Nome: `HUB_API_KEY` · Valor: a Secret Key do hub
5. Salvar e **refazer o deploy** — variável nova só entra em vigor no
   build seguinte

**A permissão necessária é `hub:customers:read`.** A chave que hoje
valida usuários tem apenas `hub:users:read`.

**Se a chave de clientes for outra**, diferente da que valida usuários,
crie um segundo Secret chamado **`HUB_CUSTOMERS_KEY`**. Quando ele
existe, tem prioridade; quando não, usa-se a `HUB_API_KEY`. Assim as duas
situações funcionam sem mexer no código.

### Em desenvolvimento

No `.dev.vars` da raiz — que está no `.gitignore` e nunca vai para o Git:

```
HUB_API_KEY="cole-a-chave-aqui"
HUB_BASE_URL="http://127.0.0.1:8787/v1"
```

A segunda linha aponta para o dublê local. Sem ela, o desenvolvimento
local fala com o hub de verdade.

### Como saber se deu certo, sem adivinhar

Abra a **Jornada**. Se a chave não tiver a permissão, a tela diz
exatamente isso em vez de ficar vazia. Para o diagnóstico direto:

```
GET /api/hub-clientes?diagnostico=1
```

Responde uma de três coisas: que falta a chave, que falta a permissão
`hub:customers:read` (e como resolver), ou que está tudo certo e quantos
clientes ativos o ERP tem.

Ele **nunca devolve a chave** — só diz qual variável foi usada.

---

## 2. O que muda

Agora existem **três caminhos** para um cliente chegar à trilha de CX, e
os três funcionam:

| Caminho | Como |
|---|---|
| **1. Lead finalizado** | A conversão, entregue na 2.18.0 |
| **2. Já é cliente no ERP** | Aparece sozinho na Jornada — **este lote** |
| **3. Cadastro manual** | Continua existindo, para o que fugir dos dois |

### A Jornada passa a listar o ERP, ao vivo

O hub é dono de quem é cliente ativo; a linha de `clientes` no CRM guarda
só a camada de jornada — etapa, núcleos, stakeholders, observações.

Três estados que a tabela distingue, e que **não podem ser confundidos**:

| Estado | Selo | O que significa |
|---|---|---|
| No ERP, com jornada | — | O caso normal |
| No ERP, **sem jornada** | `sem jornada` (laranja) | É cliente confirmado, mas ninguém definiu a jornada dele. Falta uma ação nossa. |
| Só no CRM | `sem ERP` (apagado) | Conversão que o ERP ainda não tem, ou cliente que saiu do filtro de status lá |

O laranja é a cor de "faça algo"; o apagado e tracejado é ausência de
informação, o mesmo código visual das marcas "não avaliada" no mapa de
stakeholders.

**Um botão ➕ começa a jornada** de quem está sem ela: cria a ficha do
CRM já vinculada ao ERP, com a razão social, a classificação 1–6 e o
início da relação vindos de lá.

### A trava do ERP se liga sozinha

A regra do roadmap — "todo cliente de CX tem que existir no ERP" — agora
é cumprida, e o comportamento depende do que o ambiente tem:

| Situação | O que acontece |
|---|---|
| Chave presente, CNPJ existe no ERP | Converte **e grava o `erp_id`** |
| Chave presente, CNPJ **não** existe | Barra e avisa |
| Chave ausente, ou hub fora do ar | Converte com `erp_id` nulo, e avisa por quê |

A última linha é deliberada: barrar sem poder verificar deixaria a
conversão inutilizável, e um problema nosso não pode virar um bloqueio
para quem está usando.

---

## 3. Decisões técnicas

### O cruzamento é por CNPJ, não por `erp_id`

Enquanto o vínculo não é gravado, o CNPJ é a única coisa que os dois
lados têm em comum. É por isso que a ficha do cliente exige CNPJ e recusa
CPF — decisão que já estava no Lote H e só agora mostra para que servia.

### O vínculo nunca vem do cliente HTTP

Nem na conversão, nem no "trazer para a jornada": o `erp_id` é sempre
obtido pelo servidor, consultando o hub pelo CNPJ. Um vínculo carimbado à
mão é pior que vínculo nenhum, porque a trava passaria a confiar nele.

### `erp_id` já era TEXT

O hub devolve `id` como ObjectId (`507f1f77bcf86cd799439011`), não como
número. A tabela do Lote H já declarava `erp_id TEXT` — **por isso este
lote não tem migração**. O `nid` do ERP, esse sim numérico, também é
lido e devolvido.

### `fields` é obrigatório

O endpoint `/customers` responde 400 sem ele. Pedimos só o que a Jornada
mostra; trazer `contacts` e `addresses` multiplicaria a resposta por
nada, já que a ficha do CRM tem os seus.

### Falha do hub vira código legível, nunca 500

`HUB_SEM_CHAVE`, `HUB_SEM_PERMISSAO`, `HUB_CREDENCIAL`, `HUB_LIMITE`,
`HUB_INDISPONIVEL`. A tela precisa poder dizer "falta a permissão
`hub:customers:read`" — **lista vazia é indistinguível de "não há
clientes"**, que é outra afirmação, e falsa.

### O dublê local ganhou `/customers`

Quatro clientes, um deles `inactive` para provar que o filtro funciona.
E um modo novo, `--sem-permissao`, que responde 403 — é o que permite
conferir se a tela explica o motivo em vez de ficar vazia:

```bash
node dev/hub-stub.mjs --sem-permissao
```

---

## 4. Verificação

### O que eu verifiquei

**32 verificações, todas passando, ponta a ponta**: a prova sobe o dublê
do hub **de verdade** num processo à parte e chama os handlers reais
contra ele. Um dublê de dublê provaria que o meu falso concorda com o meu
falso.

- o diagnóstico nos três estados: sem chave, com chave válida, e com
  chave sem permissão — cada um com a mensagem e o "como resolver";
- o cruzamento: quem está nos dois lados vem com a jornada do CRM e o id
  do ERP; quem só está no ERP vem "sem jornada"; quem só está no CRM não
  some; o `inactive` do ERP **não** aparece;
- os núcleos anotados no CRM sobrevivem ao cruzamento;
- trazer para a jornada grava o vínculo vindo do hub, usa o
  `contractedAt` como início da relação, e **não duplica** quem já tinha
  ficha;
- CNPJ que não existe no ERP não vira jornada;
- a trava da conversão nos três cenários, incluindo que **sem chave a
  conversão continua funcionando** — não podia regredir;
- com permissão faltando, a conversão **segue permitida**: o problema é
  nosso, não do usuário.

As cinco provas anteriores continuam passando.

### O que eu NÃO verifiquei — é seu

Nada passou por navegador, e **a chave real nunca foi usada** — toda a
prova falou com o dublê.

- [ ] Cadastrar a chave e conferir em `/api/hub-clientes?diagnostico=1`
- [ ] A Jornada listar os clientes ativos do ERP
- [ ] Um cliente "sem jornada" e o botão ➕ criando a ficha dele
- [ ] Buscar por nome e por CNPJ na Jornada
- [ ] **Sem a permissão**, a tela dizer o motivo em vez de ficar vazia
- [ ] Converter um lead cujo CNPJ está no ERP — tem que gravar o vínculo
- [ ] Converter um lead cujo CNPJ **não** está — tem que barrar
- [ ] Abrir a ficha de um cliente e conferir "Vinculado ao ERP (ID …)"
- [ ] Com o cliente na jornada, abrir **Stakeholders** e **Dossiê de
      Experiência** — a verificação do Lote L, ainda pendente

---

## 5. O que fica

Com a chave, o **Lote F fecha**. Os próximos — I (reuniões e atas), M, N
— dependem da mesma chave, então o mesmo cadastro destrava a fila
inteira.

O que a Jornada ainda **não** faz: o quadro kanban continua mostrando só
quem tem jornada definida. É proposital — o quadro é a jornada, e quem
não tem etapa não está nela. Quem está "sem jornada" aparece na tabela,
que é onde a ação de começar existe.

---

## 6. Histórico de versões

| Versão | Data | O quê |
|---|---|---|
| 1.0 | 05/09/2026 | Clientes do ERP na Jornada, trava e vínculo do `erp_id` (sistema 2.19.0) |
