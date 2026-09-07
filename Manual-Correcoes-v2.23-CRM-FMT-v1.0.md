# Manual — v2.23.0: a sessão para de cair, e o dossiê para de inventar

**Versão:** 1.0
**Data:** 07/09/2026
**Versão do sistema:** 2.23.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Este lote é seguro para subir ANTES da migração.** É a primeira vez que
digo isso, e a razão é específica: nada no código escreve `etapa_desde`
— quem escreve são os gatilhos, que só existem depois da migração. Sem a
coluna, `cliente.etapa_desde` chega `undefined`, o dossiê trata como "o
CRM não sabe" e diz isso no documento. Que é a verdade de hoje.

A migração não é opcional, só não é bloqueante: sem ela a coluna nunca
começa a ser preenchida, e daqui a seis meses continuaremos sem saber há
quanto tempo cada conta está onde está.

```bash
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-011-etapa-desde.sql
```

**Confira depois de aplicar** — a segunda metade da convenção:

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%etapa_desde%'"
```

Devem aparecer os quatro: `clientes_etapa_desde_ins`,
`clientes_etapa_desde_upd`, `leads_etapa_desde_ins`,
`leads_etapa_desde_upd`.

### A 011 NÃO é segura para rodar duas vezes

Usa `ALTER TABLE ADD COLUMN`, e o SQLite não tem `IF NOT EXISTS` para
coluna — a segunda execução falha com `duplicate column name`. Os
gatilhos são `IF NOT EXISTS` e sobrevivem; o `ALTER` não. Se estiver na
dúvida sobre já ter rodado:

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM pragma_table_info('clientes') WHERE name='etapa_desde'"
```

### Eu não consegui aplicar a migração

O `wrangler` desta máquina está autenticado, mas o token OAuth **não tem
o escopo de D1** — as permissões dele vão de `workers` a `containers` e
D1 não está na lista. Qualquer consulta responde `7403: The given account
is not valid or is not authorized to access this service`.

Duas saídas, qualquer uma serve:

- rodar você mesmo os comandos acima; ou
- rodar `npx wrangler login` (abre o navegador e renova o token com os
  escopos atuais) — depois disso eu aplico.

---

## 2. O que muda

### A sessão para de cair

**Este era o pior dos quatro.** Buscar informação ou recarregar a página
devolvia você para a tela de login, várias vezes por hora.

A causa não estava no login. Estava aqui, em `public/js/auth.js`:

```js
if (resposta.status === 401 || resposta.status === 403) {
  idToken = null;
  mostrarLogin(...);
}
```

Qualquer 403 derrubava a sessão. E `/api/plano-acao` respondia 403 quando
faltava permissão na chave do hub. Abrir o Plano de Ação, portanto,
expulsava você do CRM — e mostrava o erro do **hub** na tela de **login**,
como se o *seu* acesso tivesse sido revogado.

O 403 estava carregando dois sentidos incompatíveis:

| | Quem não pode | Quem resolve |
|---|---|---|
| "você não tem acesso" | o usuário | o administrador do CRM |
| "a chave do hub não tem" | o servidor | quem administra o hub |

O segundo nunca deveria expulsar ninguém.

**A correção tem duas metades, de propósito.** O servidor parou de usar
403 para problema de chave — passou a 503, o mesmo que `HUB_SEM_CHAVE` já
usava, e pela mesma razão: é configuração, não autorização. E o front
passou a encerrar a sessão **só** nos quatro códigos que o
`_middleware.js` emite para isso: `TOKEN_AUSENTE`, `TOKEN_INVALIDO`,
`SEM_CADASTRO`, `INATIVO`.

Uma metade sozinha bastaria hoje. As duas juntas cobrem o 403 que alguma
rota futura vá inventar — o front deixou de confiar no código de status
para uma decisão que só o `code` pode responder.

Um 401 **sem** código continua derrubando: é o que o servidor responde
quando o token nem chega a ser lido. Um 403 sem código, não — na dúvida,
manter a pessoa dentro do app é o erro barato.

### O dossiê para de inventar

O Dossiê de Experiência da ALPHATEX, gerado em 07/09/2026, afirmou com
**CONFIANÇA ALTA**:

> "Estagnação na etapa de Diagnóstico por mais de 83 meses sem avanço
> registrado"

O CRM não sabia disso. Sabia duas coisas separadas — `data_inicio` de
2019 (início do contrato, vindo do ERP) e a etapa "Diagnóstico", posta na
importação em massa do dia anterior. O modelo somou as duas.

E não foi por falta de aviso. O prompt **já proibia**, com todas as
letras, falar de reuniões, atas, NPS e saúde, e proibia tratar a ausência
de mapa como risco do cliente. O documento fez as duas coisas.

**A lição não é escrever um prompt melhor.** Instrução em prompt é
pedido, não garantia. Este documento nomeia pessoas de um cliente real e
é lido como se fosse apurado; o que ele afirma precisa passar por uma
conferência que não dependa da boa vontade do modelo.

Três medidas, nesta ordem:

1. **O dado passa a existir.** `etapa_desde` (migração 011), com nulo
   significando "não sei" — e não a data de hoje, que transformaria
   ignorância em fato.
2. **O contexto diz o que não sabe.** Onde `etapa_desde` é nulo, o
   material entregue ao modelo declara: *"O CRM NÃO SABE. É PROIBIDO
   afirmar ou estimar há quanto tempo o cliente está nesta etapa."* E
   avisa que início da jornada e etapa atual são fatos **separados**.
3. **A guarda confere depois.** Todo item que se apoie numa fonte que o
   CRM ainda não tem é **descartado**, e o descarte é declarado.

Na análise real da ALPHATEX, os **três riscos caíram** — e a
oportunidade, as perguntas e as lacunas do mapa sobreviveram. A guarda
não é tesoura cega.

**Descarte, e não reescrita:** um item apoiado em fonte inexistente não
tem versão salvável. Só listas são descartadas — riscos, oportunidades,
perguntas, lacunas, que são afirmações discretas. Texto corrido
(panorama, recomendação) não é apagado por uma palavra no meio; para ele
fica o aviso, porque descartar o panorama deixaria o documento sem
começo.

**A guarda se desarma sozinha.** Quando as atas chegarem, basta
`'reunioes'` entrar no conjunto de fontes presentes e os itens que falam
delas passam a valer — sem tocar na função.

### O nome dos arquivos

`Dossie_Experiencia_ALPHATEX-COMERCIO-IMPORTACAO-E_2026_09`

Duas causas somadas: o gerador recebia a **razão social** em vez do nome
fantasia, e juntava até quatro palavras. Agora:

| Entrada | Saída |
|---|---|
| `ALPHATEX` (fantasia) | `Dossie_Experiencia_Alphatex_2026_09` |
| a razão social inteira, como reserva | `Dossie_Experiencia_Alphatex-Comercio-Importacao_2026_09` |
| `JBS` | `Proposta_JBS_2026_09` — sigla curta não vira "Jbs" |

Conectivos (`de`, `da`, `e`) saem; caixa alta com mais de três letras
vira capitalizada, porque o ERP grava tudo em maiúsculas e `ALPHATEX`
grita num nome de arquivo.

Vale para o download **e para o título**, que é de onde o "Imprimir /
PDF" tira o nome — sem isso a proposta, que só existe como PDF, nunca
teria nome padronizado.

---

## 3. Decisões técnicas

### Por que gatilho no banco, e não código

Existem **seis** caminhos de escrita que põem um registro numa etapa:
criação de cliente, conversão de lead, importação de planilha, os dois
caminhos do hub e o arraste do cartão. Espalhar a regra por seis lugares
é convidar o sétimo a esquecer dela — e esquecer aqui não dá erro, dá
silêncio. Foi exatamente assim que o defeito original passou.

O gatilho vale para todo caminho, inclusive os que ainda não existem. A
contrapartida é honesta: é lógica invisível para quem lê só o JavaScript,
e por isso está documentada na migração e apontada no código.

`WHEN NEW.etapa_id IS NOT OLD.etapa_id` — `IS NOT`, não `<>`, porque
`<>` não compara NULO. Sem isso, entrar numa etapa vindo de "sem etapa"
não seria detectado. E reordenar cartão dentro da mesma coluna, que
regrava `etapa_id` com o mesmo valor, não zera a data.

### O funil ganhou o campo junto

`comandosDeMover` é genérico para leads e clientes. Dar a coluna só a uma
tabela obrigaria a função a saber qual é qual. Além disso, "há quanto
tempo este lead está parado nesta etapa" é a mesma pergunta útil.

### 503 e não 424

424 (Failed Dependency) é semanticamente mais preciso para "a dependência
do servidor falhou". Ficou de fora porque `HUB_SEM_CHAVE` já usava 503
para o mesmo tipo de problema, e duas respostas diferentes para
"configuração do hub" só criariam uma pergunta a mais. O `code` no corpo
é o que a tela lê; o status é para quem olha a rede.

---

## 4. Verificação

### O que eu verifiquei

**Onze suítes, 424 conferências, todas passando.** As duas novas:

- **51 conferências** da sessão, do nome do arquivo e da guarda. A tabela
  de decisão da sessão é exercida caso a caso: 403 com
  `HUB_SEM_PERMISSAO` não derruba, 403 com `SEM_CADASTRO` derruba, 401
  sem código derruba, 403 sem código não.
- **13 conferências dos gatilhos contra SQLite de verdade**, via
  `node:sqlite` — com o SQL **lido do arquivo da migração**, não
  recopiado. Conferir o texto do `.sql` não provaria nada: gatilho é
  lógica, e lógica errada em gatilho falha em silêncio.

Sobre a guarda, o caso provado é o **real**: os itens do PDF da ALPHATEX
foram transcritos para a prova e são exatamente os que o sistema gerou.
Os três riscos caem; a oportunidade, as perguntas e as lacunas passam. E
está provado que, com as fontes presentes, os mesmos itens voltam a
passar — uma guarda que nunca solta é um bloqueio, não uma guarda.

### O que eu NÃO verifiquei — é seu

Nada passou por navegador. E **a migração 011 não foi aplicada**: o
token desta máquina não tem escopo de D1.

- [ ] O rodapé diz **v2.23.0**
- [ ] Abrir o **Plano de Ação**: mostra o aviso da permissão e **você
      continua logado**. É o teste central do lote
- [ ] Recarregar a página e navegar entre as telas sem cair
- [ ] Aplicar a migração 011 e conferir os quatro gatilhos
- [ ] Mover um cartão de coluna, e depois **reordenar dentro da mesma**
      — a data só pode mudar no primeiro caso
- [ ] Gerar um Dossiê de Experiência: a linha "Nesta etapa desde" aparece
      como *não registrado* nos clientes antigos
- [ ] E **nenhum risco fala em estagnação de N meses** nem em reuniões
- [ ] Baixar o dossiê: `Dossie_Experiencia_Alphatex_2026_09.html`
- [ ] Imprimir uma proposta: o navegador sugere `Proposta_<Cliente>_2026_09`
- [ ] Depois de aplicar a 011, criar um cliente novo e conferir que o
      dossiê dele passa a mostrar a data real

---

## 5. Pendências

**`hub:portfolios:read` na chave do hub.** Único bloqueio do Plano de
Ação, e não é trabalho de código — é a permissão concedida à chave, no
hub. Depois desta versão, a falta dela vira um aviso na tela em vez de
uma expulsão.

**A estrutura do `contacts` do `/customers`.** Bloqueia a 2.24.0. Será
resolvida por um diagnóstico dentro do próprio lote, não por
documentação.

---

## 6. Histórico de versões

| Versão | Data | O quê |
|---|---|---|
| 1.0 | 07/09/2026 | Sessão que não cai mais, guarda contra afirmação sem fonte, `etapa_desde` e o nome padrão dos documentos (sistema 2.23.0) |
