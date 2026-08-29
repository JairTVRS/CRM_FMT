# Manual — Lote B: importação de planilhas (CRM Formatar)

**Versão:** 1.0
**Data:** 28/08/2026
**Versão do sistema:** 2.10.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Este lote não tem migração de banco.** As colunas necessárias já entraram no v2.9.0.

```bash
git add -A
git commit -m "v2.10.0 - Importacao de planilhas de leads"
git push origin main
```

---

## 2. Como usar

O botão **Importar planilha** fica ao lado do "+ Incluir Lead".

O fluxo tem quatro passos: escolher o arquivo, o sistema lê e confere, você vê a prévia com quantos serão criados e quantos atualizados, e confirma.

**Nada é gravado antes da sua confirmação.** A prévia é só leitura.

Formatos aceitos: **.xlsx, .csv e .txt**. No csv e txt o separador é detectado sozinho — tabulação, ponto e vírgula ou vírgula.

O arquivo `Modelo-Importacao-Leads.csv` que acompanha esta entrega serve de referência de cabeçalho. Abra no Excel, substitua a linha de exemplo pelos seus dados e salve como .xlsx ou .csv.

---

## 3. As regras que você definiu

**CNPJ ou CPF é obrigatório em toda linha.** Se qualquer uma vier sem, a importação inteira para e mostra:

> Acrescente os CNPJs para a importação da tabela. A IA usa esta informação de contexto para inteligência comercial.

A tela lista os números das linhas a corrigir, então você localiza direto na planilha.

**A validação usa dígito verificador.** Um número com a quantidade certa de dígitos mas digitado errado é recusado, com a linha e o valor apontados.

**Documento já cadastrado atualiza, não duplica.** A prévia informa quantos serão atualizados e mostra exemplos.

**Célula vazia não apaga o que já está preenchido.** Se a planilha tem a cidade em branco e o lead no CRM já tem cidade, ela permanece. Só sobrescreve o que vier preenchido.

**Documento repetido dentro da própria planilha** também barra, apontando em que linha ele apareceu pela primeira vez.

---

## 4. Conversões automáticas

| Na planilha | No sistema |
|---|---|
| `SERVIÇO`, `SERVICO`, `Serviços` | `SERVIÇOS` |
| `15/01/26` ou `15/01/2026` | `2026-01-15` |
| `R$ 25.424,00` | 2542400 (centavos) |
| `(37) 9876-2802` | mantido como veio |
| `www.empresa.com.br` | `https://www.empresa.com.br` |

**Advisors novos são criados automaticamente.** Se a planilha traz "Carlos" e ele ainda não existe, o cadastro é feito e o lead vinculado. A tela informa quais foram criados.

**Status2 vira a etapa do funil**, casando pelo nome. Nome que não existir entre as etapas cadastradas cai em "Novo Lead".

**"Dias para próximo contato" é ignorado de propósito.** É a diferença entre hoje e a data do próximo contato — guardado, nasceria desatualizado no dia seguinte. Calculado na exibição, está sempre certo.

Colunas não reconhecidas são listadas na prévia antes de você confirmar, para que nada seja descartado silenciosamente.

---

## 5. Decisões técnicas

**O arquivo é lido no navegador, não no servidor.** Duas razões: você vê os problemas antes de qualquer gravação, e a planilha comercial inteira não trafega pela rede. Só o JSON estruturado sobe.

**A gravação é transacional.** O `batch` do D1 grava tudo ou nada. Meia importação — com metade dos leads dentro e metade fora — seria pior que nenhuma, porque você não saberia onde parou.

**A biblioteca de Excel carrega sob demanda.** A SheetJS só é buscada quando você escolhe um .xlsx. Quem nunca importa planilha não paga esse peso no carregamento diário.

**O .xls binário de 1997 ficou de fora**, como combinamos. Se escolhido, a tela explica que basta abrir no Excel e salvar como .xlsx.

**A validação de documento virou módulo compartilhado.** Estava dentro da rota de leads; a importação precisava da mesma regra, e duas cópias divergiriam com o tempo. Agora as duas usam `_lib/documento.js`.

**Limite de 2000 linhas por importação.** Acima disso o lote fica pesado para uma requisição só. Se sua base for maior, divida em partes — a segunda importação atualiza em vez de duplicar.

---

## 6. Verificação

- [ ] Botão "Importar planilha" aparece ao lado do "+ Incluir Lead"
- [ ] Importar planilha com uma linha sem CNPJ → recusa com a mensagem sobre a IA e lista as linhas
- [ ] Importar com CNPJ de dígito errado → aponta linha e número
- [ ] Prévia mostra total, novos e atualizados **sem gravar**
- [ ] Confirmar → leads aparecem na tabela
- [ ] Importar a mesma planilha de novo → prévia mostra todos como "atualizados", nenhum novo
- [ ] Apagar a cidade de uma linha e reimportar → a cidade **permanece** no CRM
- [ ] Advisor novo na planilha → criado automaticamente e informado na tela

---

## 7. O que fica para os próximos lotes

O quadro kanban (Lotes C e D) e a gaveta lateral (Lote E). Os leads importados já entram com etapa, valores e datas preenchidos — quando o quadro existir, aparecem nas colunas certas sem retrabalho.

A tabela ainda mostra "Origem" no cabeçalho e "Todos os Ramos" no filtro, apesar de o campo ter virado "Canal". Ajusto junto com o quadro, para não mexer duas vezes na mesma tela.

---

## 8. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 28/08/2026 | Jair Tavares | Versão inicial. Importação de .xlsx, .csv e .txt com leitura no navegador, prévia sem gravação, trava de CNPJ obrigatório, atualização por documento sem duplicar, preservação de campos preenchidos, criação automática de advisors e gravação transacional. |
