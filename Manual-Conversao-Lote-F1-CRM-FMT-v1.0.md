# Manual — Lote F (parte 1): o lead vira cliente (CRM Formatar)

**Versão:** 1.0
**Data:** 05/09/2026
**Versão do sistema:** 2.18.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Não tem migração.** O Lote H já deixou tudo pronto no banco: a tabela
`clientes` com `lead_id` e `erp_id` nascendo nulos, o índice único de
CNPJ entre ativos e o índice de `lead_id`.

```bash
git add -A
git commit -m "v2.18.0 - Lead finalizado vira cliente"
git push
```

---

## 2. O problema

São **dois caminhos** para um cliente chegar à trilha de CX, e **nenhum
dos dois existia**:

1. **O lead finaliza e vira cliente.** Mover para "Finalizado" não
   produzia efeito nenhum — nem conversão, nem aviso. O comportamento
   estava certo (a conversão sempre foi o Lote F), mas era **mudo**.
2. **O cliente já existe no ERP com status ativo e aparece sozinho.**

Este lote entrega o **caminho 1**. O caminho 2 depende da chave do hub
com escopo ampliado e do contrato do endpoint de clientes — a
documentação do hub exige login, então nem o formato da resposta é
conhecido ainda.

---

## 3. O que muda

### Dois gatilhos, e os dois são necessários

**Arrastar o cartão** para uma etapa marcada como "encerra" abre a tela
de conversão. Só depois de o movimento ser **gravado** — avisar antes
ofereceria uma conversão apoiada num movimento que o banco talvez tenha
recusado.

**Um botão na aba Funil da ficha**, em "Trilha de CX". Sem ele, um lead
que já estava parado em "Finalizado" desde antes de a conversão existir
nunca teria como ser convertido, porque ninguém o arrastaria de novo. Era
exatamente o caso na estreia: havia um lead em Finalizado e a Jornada
estava vazia.

O mesmo bloco mostra o estado: se o lead já virou cliente, diz qual, e
oferece **abrir a ficha dele**.

### A conversão é uma tela, não um efeito colateral

Decisão registrada no roadmap desde o começo: **lead finalizado não vira
cliente sozinho**. A conversão pede o que o funil não tem — etapa da
jornada, núcleos de atendimento, data de início da relação.

O que o funil **já** sabe é herdado e não se redigita: razão social,
CNPJ, telefone, e-mail, pessoa de contato, cidade e a classificação 1–6.

### O que impede a conversão, e por quê

| Impedimento | Motivo |
|---|---|
| Lead já convertido | Um lead não vira dois clientes. A tela diz qual cliente ele é e oferece abrir. |
| CNPJ já é de outro cliente | Pode ter vindo de cadastro manual ou de um lead duplicado. |
| Lead sem CNPJ | É por ele que o cliente será casado com o ERP. A mensagem manda preencher na ficha. |
| Documento é CPF | Cliente de CX é a **empresa contratante**. Um cliente com CPF nunca seria encontrado no ERP. |

Converter **fora** de uma etapa de encerramento é permitido — a tela
apenas avisa que o normal é converter ao finalizar. Barrar impediria
corrigir um lead que foi finalizado e voltou.

---

## 4. Decisões técnicas

### Endpoint separado do `/api/clientes`

O `/api/clientes` é o cadastro manual, e ele exclui `lead_id` e `erp_id`
da lista de campos **de propósito**: assim nenhuma requisição carimba um
vínculo à mão, e um vínculo falso com o ERP é pior que vínculo nenhum,
porque a trava do Lote F passaria a confiar nele.

No `/api/conversao` o `lead_id` é o assunto, não um campo de formulário.

### `erp_id` continua nulo

A regra "todo cliente de CX tem que existir no ERP" depende da chave do
hub. Barrar agora, sem poder verificar, deixaria a conversão
inutilizável.

O cartão do quadro já diz **"sem ERP"**, e a tela de conversão explica o
que isso quer dizer: *cadastro ainda não conferido* — **não** *cliente
fora do ERP*. São coisas diferentes, e a distinção está no roadmap.

### A checagem é feita duas vezes

O `GET` diz se pode; o `POST` refaz a mesma checagem antes de gravar. Não
é redundância: entre a tela abrir e o botão ser clicado, outra pessoa
pode ter convertido o mesmo lead. E se as duas passarem, o índice único
de CNPJ é a defesa final.

### `aoMover` no componente de quadro

O `Quadro.criar()` ganhou um callback `aoMover(registro, etapa)`, chamado
depois da gravação. O quadro da jornada não o usa — mover cliente entre
etapas da jornada não converte nada.

---

## 5. Verificação

### O que eu verifiquei

**30 verificações, todas passando**, chamando os **handlers de verdade**
(`onRequestGet` e `onRequestPost` do endpoint) com um contexto falso
sobre SQLite em memória. Testar só as auxiliares provaria menos.

- lead inexistente, inativo e sem `lead_id` na URL;
- a sugestão herda nome, CNPJ, telefone, contato, cidade e classificação;
- sem CNPJ, com CPF, e fora da etapa de encerramento;
- a conversão grava `lead_id`, deixa `erp_id` nulo e limpa o CNPJ;
- núcleos repetidos e inválidos são descartados;
- **o mesmo lead não vira dois clientes**, e outro lead com o mesmo CNPJ
  é barrado tanto na tela quanto na gravação;
- **nenhuma tentativa recusada cria cliente**;
- etapa do funil comercial é recusada e cai na primeira da jornada;
- sem data informada, a relação começa hoje;
- ao final, a Jornada mostra os convertidos, cada um na etapa certa e
  todos marcados como sem ERP.

Mais a conferência de fiação: os 18 ids que o `conversao.js` procura
existem no HTML, e a ordem de carga dos scripts respeita as dependências.
As provas anteriores continuam passando (Lote L, ajustes de tela,
versionamento).

### O que eu NÃO verifiquei — é seu

- [ ] Arrastar um lead para "Finalizado" abre a tela de conversão
- [ ] Converter, e o cliente **aparecer na Jornada** sem F5
- [ ] Abrir a ficha do lead já convertido: o bloco "Trilha de CX" diz que
      ele já é cliente e o botão abre a ficha do cliente
- [ ] Arrastar o mesmo lead de novo dentro de "Finalizado" **não** deve
      incomodar com aviso nenhum
- [ ] Um lead sem CNPJ arrastado para "Finalizado" avisa o motivo
- [ ] Converter pelo botão da ficha, sem arrastar
- [ ] Com o cliente criado, abrir as abas **Stakeholders** e **Dossiê de
      Experiência** — é o que destrava a verificação do Lote L, que até
      agora não pôde ser feita por falta de cliente

---

## 6. O que falta para fechar o Lote F

| O quê | Depende de |
|---|---|
| A **trava do ERP** — barrar CNPJ que não existe no hub | chave do hub |
| O preenchimento de `erp_id` | chave do hub |
| **O caminho 2** — ativos do ERP aparecerem na Jornada | chave do hub **e** o contrato do endpoint de clientes |

Para o caminho 2 eu preciso de duas coisas que só você consegue: o
**escopo da chave** e o trecho da documentação do grupo **Clientes** —
caminho, parâmetros de consulta e campos da resposta. A doc do hub exige
login.

---

## 7. Histórico de versões

| Versão | Data | O quê |
|---|---|---|
| 1.0 | 05/09/2026 | Conversão de lead em cliente, sem a trava do ERP (sistema 2.18.0) |
