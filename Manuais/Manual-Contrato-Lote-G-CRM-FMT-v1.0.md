# Manual — v2.40.0: o contrato (Lote G)

**Versão:** 1.0
**Data:** 05/10/2026
**Versão do sistema:** 2.40.0
**Responsável:** Jair Tavares

O CRM passa a gerar o contrato de prestação de serviços. O modelo é
padrão e o próprio app o monta: os dados do cliente vêm do lead, o escopo
e os valores vêm da última proposta, e a forma de preço e a contratada
vêm de cadastros feitos nas Configurações.

---

## 1. Antes do primeiro contrato (admin, uma vez)

Em **Configurações → Empresas contratadas**, clique em **Editar** na
Formatar Consultoria Empresarial Ltda e:

1. cadastre **quem assina pela Formatar** (nome, CPF, nacionalidade,
   estado civil, cargo e cidade onde reside). Pode ter até 4; no contrato
   eles saem ligados por "e/ou";
2. confira o **endereço da sede**. Ele veio do cartão CNPJ (Av. Sete de
   Setembro, 1470, Apto 301, Centro, Divinópolis/MG). Se a sede for outra,
   corrija aqui.

Sem ninguém cadastrado para assinar, o contrato não é gerado e a aba
Contrato do lead avisa.

## 2. Formas de preço (Configurações, só admin)

Seis formas já vêm cadastradas: Diagnóstico + consultoria mensal,
Diagnóstico isento + consultoria mensal, Só diagnóstico, Só consultoria
mensal, Projeto em parcelas e Valor por hora.

- O **texto** é a cláusula de preço do contrato. Os valores entre chaves
  (`{valor_mensal}`, `{meses}`…) vêm da proposta, escritos em número e
  por extenso. Ao editar, clique num valor da lista para inseri-lo.
- Uma **linha em branco** separa os itens (A, B…).
- **Inativar**: a forma some da lista do lead, mas quem já a usa continua
  com ela.
- **Excluir**: só funciona quando nenhum lead usa a forma. Se algum usar,
  o CRM recusa e sugere inativar.

## 3. No lead

### 3.1 Aba Contrato

- **Quilômetro rodado**: o valor negociado com este cliente. Vem
  preenchido com R$ 1,75 e vale para a proposta e para o contrato.
- **Forma de preço** e **Empresa contratada**: a contratada vem com a
  padrão escolhida.
- **Quem assina pelo cliente**: nome, CPF, nacionalidade, estado civil,
  profissão e cidade onde reside. Se o lead for pessoa física (CPF), quem
  assina é a própria pessoa e o nome e o CPF não são pedidos.
- **Para gerar**: a lista do que ainda falta e onde preencher.
- **Gerar contrato** salva a ficha antes e abre o contrato numa aba nova.
  Lá, "Salvar como PDF", e o PDF segue para o Clicksign. Gerar de novo
  cria a versão seguinte, e a anterior continua disponível.

### 3.2 Aba Proposta

- O km agora vem da aba Contrato (o campo da proposta só mostra o valor).
- A forma de preço entra nas **propostas novas**, numa folha própria
  ("Forma de pagamento"), com o mesmo texto que vai ao contrato. As
  propostas já geradas não mudam.
- Campos novos: **Valor do projeto**, **Número de parcelas** e **Valor da
  hora**, para as formas "Projeto em parcelas" e "Valor por hora".
- Se a forma usar um valor que a proposta não tem, a geração é barrada e
  o CRM diz qual campo preencher.

## 4. Na ficha do cliente

Em **Documentos de contexto**, a linha **Contrato** mostra o contrato do
lead que deu origem ao cliente, com Abrir e Baixar.

## 5. O que o modelo traz

O texto é o do contrato em uso, com o que mudou em 2026: km por lead,
rescisão com 30 dias de aviso e sem multa (a CONTRATANTE paga o que já
foi executado e o proporcional do mês) e o reajuste "a ser pago à
CONTRATADA" (o modelo antigo dizia "à CONTRATANTE"). As cláusulas fixas
estão em `functions/api/_lib/contrato-template.js`. Mudar o texto delas
é uma decisão do jurídico; a alteração é feita no código.

## 6. Instalação (feita no deploy)

A migração 027 é aplicada antes do deploy, pelo `--command`, um comando
por instrução. As conferências estão no cabeçalho de
`db/migracao-027-contrato.sql`.
