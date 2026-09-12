# Manual — Dossiê Executivo, Lote 6 (CRM Formatar)

**Versão:** 1.0
**Data:** 28/08/2026
**Projeto:** CRM_FMT — `https://crm-fmt.pages.dev`
**Escopo:** sete correções apontadas no uso real da v2.7.0
**Responsável:** Jair Tavares

---

## 1. Arquivos

| Arquivo | Situação |
|---|---|
| `package.json` | versão 2.7.1 |
| `public/index.html` | sandbox do iframe, Instagram recolhido |
| `public/js/app.js` | limpeza do formulário, clipe na tabela |
| `public/js/dossie.js` | nome de arquivo, download direto |
| `public/assets/css/dossie.css` | estilo do recolhido e do clipe |
| `functions/api/dossier.js` | mensagens, endpoint de existentes, prompt |
| `functions/api/_lib/schema-dossie.js` | radar até 5 itens |

---

## 2. As sete correções

### 1 · Mensagens em linguagem de negócio

"Site: HTTP 530" virava jargão na tela do consultor. Agora cada falha técnica é traduzida:

| Antes | Agora |
|---|---|
| `Site: HTTP 530` | O site do lead está fora do ar no momento, então não pôde ser analisado. |
| `Site: HTTP 404` | O endereço do site não foi encontrado. Confira se está correto na ficha do lead. |
| `Site: Tempo esgotado.` | O site demorou demais para responder e a leitura foi interrompida. |
| `Site: renderizado por JavaScript` | O site não expõe texto legível para leitura automática. |
| `CNPJ: não encontrado` | CNPJ não localizado na base da Receita Federal. |

O aviso sobre Instagram só aparece se você tiver colado algo e o conteúdo não puder ser aproveitado. Antes aparecia sempre.

### 2 · Aba 02 não abria no navegador

Bug meu, de configuração do iframe. O sandbox estava como `allow-same-origin allow-modals allow-popups` — sem `allow-scripts`, então o JavaScript que troca as abas não rodava. No arquivo baixado funcionava porque ali não há sandbox.

A correção não foi simplesmente acrescentar a permissão. `allow-scripts` combinado com `allow-same-origin` permitiria ao conteúdo do frame alcançar o CRM, e parte desse conteúdo vem de um modelo de IA. O sandbox agora é `allow-scripts allow-modals allow-popups`, **sem** `allow-same-origin`: os scripts rodam, a impressão funciona, e o frame fica em origem opaca, sem acesso à página principal.

### 3 · Nome do arquivo

`dossie-35818816000101-v1.html` virou `Dossie_FEHEROS-SHOP_2026-08_v1.html`.

O nome vem da razão social ou nome fantasia, sem acentos, sem o tipo societário (LTDA, ME, EPP, EIRELI, S/A), limitado a quatro palavras. A versão fica no fim porque baixar duas versões no mesmo mês geraria `(1)` no nome, e aí não se sabe qual é qual.

### 4 · Clipe na tabela

Cada linha ganha um 📎 quando aquele CNPJ já tem dossiê. Clicar **baixa direto**, sem abrir o modal.

O botão nasce oculto e só aparece após a consulta. Se ela falhar, nenhuma linha exibe clipe — indicador ausente é melhor que indicador errado.

Endpoint novo: `GET /api/dossier?existentes=cnpj1,cnpj2,...` devolve quais têm dossiê e em que versão. Uma requisição para a página inteira, não uma por linha. Aceita até 100 CNPJs por chamada, com parâmetros ligados (`bind`), não concatenados.

### 5 · Formulário sujo em cadastro novo

Bug anterior a este projeto. O `limparFormularioModal` zerava apenas quatro campos, e um cadastro novo herdava e-mail, CEP, cidade, logradouro, observações, ramo e segmento do lead editado antes.

A limpeza agora é por varredura: todo `input`, `textarea` e `select` dentro do modal é zerado. Campo novo na ficha já nasce coberto, sem precisar lembrar de incluir na função.

### 6 · Instagram manual

Recolhido dentro de um bloco "Complementar com conteúdo do Instagram (opcional)", fechado por padrão. O texto explica que a leitura automática depende de aprovação da Meta, em andamento.

**A integração com a Graph API já está escrita e testada** desde o Lote 2. Quando o app for aprovado, ativar é cadastrar três variáveis:

```
INSTAGRAM_FONTE=graph_api
IG_BUSINESS_ACCOUNT_ID=<id da conta da Formatar>
INSTAGRAM_ACCESS_TOKEN=<token de usuário do sistema>   [Secret]
```

Com isso o campo manual deixa de ser necessário. Ele permanece no código porque o Business Discovery só atende contas Business e Creator — perfil pessoal a Meta recusa, e nesses casos o campo é a única alternativa.

### 7 · Radar sempre com 2 itens

O exemplo no prompt mostrava um item por quadrante e o modelo copiava o padrão. Agora a instrução pede de 2 a 5 conforme o material disponível, com a ressalva de nunca inventar item para preencher cota. O validador corta em 5.

---

## 3. Verificação

- [ ] Abrir dossiê pelo CRM → **aba 02 · Painel Executivo troca ao clicar**
- [ ] Imprimir de dentro do modal → diálogo de impressão abre normalmente
- [ ] Baixar → arquivo `Dossie_NOME-EMPRESA_2026-08_v1.html`
- [ ] Tabela → clipe aparece só nas linhas com dossiê
- [ ] Clicar no clipe → baixa direto, sem abrir modal
- [ ] "+ Incluir Lead" após editar outro → **todos os campos vazios**, nas três abas
- [ ] Gerar dossiê de site fora do ar → aviso em português, sem código HTTP
- [ ] Sem colar Instagram → nenhum aviso sobre Instagram
- [ ] Radar → quadrantes com quantidade variável, até cinco

---

## 4. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 28/08/2026 | Jair Tavares | Sete correções da v2.7.0: sandbox do iframe, limpeza completa do formulário, mensagens em linguagem de negócio, nome de arquivo legível, clipe por linha com download direto, Instagram recolhido e radar de 2 a 5 itens. |
