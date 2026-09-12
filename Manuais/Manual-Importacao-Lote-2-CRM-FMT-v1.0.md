# Manual — Lote 2: modelo, formatos e o mapeamento das colunas

**Versão:** 1.0
**Data:** 11/09/2026
**Versão do sistema:** 2.23.2 (entregue junto com os lotes 1 a 3)
**Responsável:** Jair Tavares

---

## 1. Instalação

**Não há migração. Nada a fazer no painel da Cloudflare.**

```
public/js/importar.js        preferência entre colunas, modelo, formatos
public/index.html            botões "Baixar modelo", formatos aceitos
functions/api/importar.js    faixa de sanidade nas datas
dev/prova/importacao.mjs     70 conferências (eram 35)
dev/gera-planilha-cnpj.mjs   apoio de migração, uso único
```

Subir é o deploy normal. Reverter é reverter o commit.

**Entregue junto:** `docs/Leads-Formatar-preencher-CNPJ.xlsx` — os 98
leads da planilha de propostas, no formato do CRM, com a coluna CNPJ
vazia. É o único trabalho manual da migração.

---

## 2. O que muda

### 2.1 A etapa passa a vir de "Status2"

A planilha tem duas colunas que dizem respeito à etapa:

| Coluna | Valores | Serve? |
|---|---|---|
| F — `Status` | Aberto · Ganho · Perdido | não — são três baldes |
| R — `Status2` | `1 - Captação` … `8 - Perdido` | sim — é a posição no funil |

A regra antiga era "a primeira coluna preenchida vence", e F vem antes de
R. **Resultado: 34 negócios GANHOS entravam como "Novo Lead"**, porque
"Ganho" não é nome de etapa nenhuma no CRM e caía na etapa padrão. Em
silêncio, sem nenhum erro na tela.

Agora existe uma tabela de preferência declarada. Quando duas colunas
disputam o mesmo campo, ela decide — não a ordem das colunas na planilha.

### 2.2 O prefixo numérico sai, e Fechamento vira Finalizado

`4 - Proposta` → `Proposta`. Sem remover o prefixo, **nenhuma** etapa
casaria com o CRM, nem as quatro que já existem com o mesmo nome.

Além disso, um de-para decidido em 11/09: **`7 - Fechamento` → `Finalizado`**.
São a mesma etapa terminal com nomes diferentes; sem isso o funil
terminaria com duas colunas equivalentes, os 34 ganhos na nova e a
"Finalizado" vazia para sempre.

Como fica a planilha real depois deste lote:

| Na planilha | Qtd | No CRM | |
|---|---|---|---|
| `8 - Perdido` | 25 | Perdido | já existe |
| `7 - Fechamento` | 34 | **Finalizado** | já existe |
| `4 - Proposta` | 34 | Proposta | já existe |
| `6 - Negociação` | 2 | Negociação | já existe |
| `1 - Captação` | 3 | Captação | **não existe — lote 3** |

Das cinco, quatro já encontram destino. Só "Captação", com 3 leads,
depende do lote 3.

### 2.3 `Data Fechamento2` entra — com uma peneira

A coluna da planilha chama-se "Data Fechamento**2**", que não existia no
dicionário. A data de fechamento dos 34 ganhos se perdia.

Mapear foi fácil; o problema foi outro. **A coluna tem formato de data
aplicado, mas guarda valores de dinheiro em 37 das 98 linhas** — `9900`,
`6300`. O Excel obedece ao formato e entrega `07/02/1927`: uma data
perfeitamente válida, perfeitamente errada, que entraria sem reclamar.

O servidor passou a recusar data fora da faixa **1990 até o ano atual +
10**. Fora dela, o campo fica vazio. Campo vazio é recuperável; data
falsa gravada no histórico comercial não é.

A peneira vale para **todas** as datas da importação, não só essa coluna.

### 2.4 `.xls` e `.xlsb` passam a ser aceitos

O comentário no topo do importador dizia que o `.xls` exigiria "o pacote
completo da SheetJS". **A justificativa estava errada desde sempre**: o
CDN carregado é o `xlsx.full.min.js`, que é o pacote completo e traz os
dois parsers. A restrição não economizava nada — só obrigava quem tinha
um arquivo antigo a reabrir e salvar de novo.

Verificado de verdade, não por documentação: o `.xlsb` de maio da
Formatar foi lido e devolveu as 4 abas com os estados de ocultação
corretos.

> **Curiosidade que virou prova:** naquele `.xlsb`, a aba Propostas tem o
> cabeçalho na **linha 3**, com um total solto na linha 2. É exatamente o
> caso que a âncora de cabeçalho do lote 1 resolve.

### 2.5 Botão "Baixar modelo", gerado no navegador

Aparece em dois lugares: na tela inicial da importação e no aviso de
coluna faltando.

O modelo é **gerado na hora, no navegador**, e não guardado como arquivo
no servidor. A razão é manutenção: assim ele nunca fica defasado em
relação ao dicionário de colunas que o importador usa para ler. Modelo
desatualizado é pior que modelo nenhum — ensina o formato errado com ar
de oficial.

Sai com uma aba só, pela mesma regra que a importação cobra de quem
envia, e **sem linha de exemplo**: exemplo esquecido na planilha entra
como lead de mentira.

A mensagem de coluna faltando agora fecha com a frase pedida:

> Este é o modelo padrão para importação dos cadastros de leads. Baixe o
> modelo da planilha, preencha as colunas e reimporte os dados.

### 2.6 Listas longas de linha viram resumo

Subir o modelo sem preencher os CNPJs produzia "Sem CNPJ/CPF nas linhas:
2, 3, 4, …, 99" — 98 números numa frase só. Quando o problema atinge a
planilha inteira, a mensagem agora diz **"Sem CNPJ/CPF: todas as 98
linhas"**. Acima de 20, mostra as 20 primeiras e o total.

---

## 3. A planilha de migração

```bash
node dev/gera-planilha-cnpj.mjs
```

Lê `docs/Gestão de Propostas Formatar.xlsx` e escreve
`docs/Leads-Formatar-preencher-CNPJ.xlsx`:

```
98 leads
7 linha(s) de rastro descartadas
34 datas de fechamento mantidas, o resto era dinheiro
coluna CNPJ da Empresa: vazia, para preencher
```

O script usa a **mesma SheetJS que o navegador carrega**, baixada do
mesmo CDN e guardada em `node_modules/.cache` — para que o que ele
entende por "célula" seja o que o importador vai entender depois.

**Não é parte do app.** O modelo em branco que o usuário baixa é gerado
pelo navegador; este script existe só para a carga inicial.

### O caminho da equipe

1. Abrir `docs/Leads-Formatar-preencher-CNPJ.xlsx`
2. Preencher a coluna **CNPJ da Empresa** — 98 células
3. **Esperar o lote 3 subir** (ver seção 6)
4. Leads › Importar › escolher o arquivo
5. Conferir a prévia e confirmar

Os arquivos originais não precisam ser tocados. A planilha de migração já
tem uma aba só, então a regra do lote 1 não incomoda ninguém aqui.

---

## 4. Decisões técnicas

**Por que a preferência é declarada e não inferida.** Daria para supor
que "a coluna com mais valores distintos é a mais específica". Seria
esperto e frágil. Uma lista curta e explícita — `etapa: ['status2',
'etapa', 'status']` — é lida em dois segundos e falha de forma previsível.

**Por que o de-para roda no navegador e não no servidor.** Remover
prefixo e resolver sinônimo é interpretar o vocabulário *daquela
planilha*. O servidor continua fazendo o que sempre fez: casar nome de
etapa com id. Cada lado com um assunto.

**Por que a peneira de datas ficou no servidor.** É onde estão os
conversores e é o único ponto por onde todo dado passa antes de gravar.
Validação que mora só na tela é validação que alguém contorna.

**Por que o modelo não tem linha de exemplo.** Testado nos dois sentidos:
exemplo ajuda a entender o formato, mas a regra de uma aba só impede uma
aba de instruções, e exemplo esquecido vira lead falso. A prévia mostraria
"1 lead novo" — mas contar com a atenção de quem está com pressa é o tipo
de aposta que perde.

**O que este lote deliberadamente NÃO faz.** Não cria etapa nenhuma. A
"Captação" continua sem destino até o lote 3.

---

## 5. Verificação

```bash
npm run prova
```

**497 conferências em 12 suítes**, das quais 70 na `importacao.mjs` (eram
35 no lote 1).

As novas cobrem: remoção de prefixo e sinônimo de etapa, a disputa
Status × Status2, a faixa de sanidade das datas — testada contra o
`functions/api/importar.js` de verdade, carregado como módulo — e a
ida-e-volta completa da planilha de migração.

Dois blocos são pulados com aviso quando os arquivos não estão presentes,
porque nenhum dos dois vai para o Git: a planilha de propostas e a de
migração têm 98 clientes com telefone e valor de contrato.

### Verificação manual

1. Leads › Importar › **Baixar modelo** — deve baixar
   `Modelo-Importacao-Leads.xlsx`, uma aba, 18 colunas, sem dados
2. Subir esse mesmo modelo vazio — deve dizer que não há linhas
3. Subir `Leads-Formatar-preencher-CNPJ.xlsx` **sem preencher** — deve
   dizer **"Sem CNPJ/CPF: todas as 98 linhas"**
4. Preencher dois ou três CNPJs válidos e subir — deve continuar
   acusando as demais, agora com a lista resumida
5. Subir um `.xlsb` — deve ser lido, e recusado por ter mais de uma aba

---

## 6. Pendências

**O lote 3 ainda é obrigatório antes de importar.** Sem ele, os 3 leads
em "Captação" caem na etapa padrão.

> Mudança em relação ao manual do lote 1: o aviso de lá dizia que **37**
> leads seriam afetados, incluindo os 34 ganhos. Com o de-para de
> `Fechamento` → `Finalizado` entregue aqui, sobraram **3**. O risco caiu
> muito, mas não a zero — e são 3 leads em etapa errada contra 5 minutos
> de espera.

**A regra "uma aba só" recusa o `.xlsb` completo da Formatar.** Ele tem 4
abas (Config, Propostas, Dinâmicas e Dashboard, as três primeiras
ocultas). Aceitar `.xlsb` não muda isso — é a regra funcionando. Quem
quiser subir o arquivo-mãe precisa exportar só a aba Propostas.

**A versão saiu como 2.23.2**, corretiva, com os lotes 1 a 3 juntos.

---

## 7. Histórico de versões

| Versão | Data | Mudança |
|---|---|---|
| 1.0 | 11/09/2026 | Documento inicial |
