# Manual — Lote E: gerador de documentos e proposta comercial (CRM Formatar)

**Versão:** 1.0
**Data:** 03/09/2026
**Versão do sistema:** 2.13.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**A migração vem antes do deploy.** Sem a tabela, a aba de proposta abre mas não gera.

```bash
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-006-propostas.sql
```

Confirme:

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name='propostas'"
```

Depois:

```bash
git add -A
git commit -m "v2.13.0 - Proposta comercial e paleta da marca"
git push origin main
```

**Esta migração é idempotente** — só cria tabela e índices com `IF NOT EXISTS`. Rodar duas vezes não faz mal.

---

## 2. O que este lote entrega

### Proposta comercial gerada pelo sistema

Aba nova na ficha do lead. Preenche-se o contato, o objeto, o escopo contratado e as condições, e o sistema gera a proposta com a identidade visual da Formatar, pronta para salvar em PDF.

**Só a parte comercial**, por decisão de escopo: capa, dados do cliente, objeto, escopo contratado, condições comerciais, despesas de viagem, particularidades e assinaturas. O material institucional — sobre a Formatar, missão, clientes, núcleos — continua sendo o deck fixo que vocês anexam junto.

São cinco folhas A4: capa preta com a marca, e quatro internas numeradas.

### O escopo é montado, não copiado

As sete Partes do contrato viraram um catálogo. **A proposta traz apenas o que foi contratado** — mandar as sete para quem comprou duas é ruído, e ruído em proposta comercial custa caro.

Os textos de cada serviço foram transcritos da proposta e do contrato em uso. Não são redação nova: alterá-los é decisão comercial, não técnica.

### Os valores são preenchidos na geração

Km rodado, condições de pagamento, prazo, início e rescisão aparecem como campos com sugestão preenchida — os valores da proposta atual —, mas **quem gera decide**. Foi assim que combinamos, porque variam por negociação.

Um efeito colateral bem-vindo: como contrato e proposta vão sair do mesmo formulário, some a divergência que existe hoje entre os dois documentos (o km está a R$ 1,60 no contrato e R$ 1,75 na proposta).

### Gerar de novo não sobrescreve

Cada geração cria a versão seguinte e mantém a anterior consultável, com quem gerou e quando. A regra é a mesma do dossiê, e aqui pesa mais: **a proposta é o documento que foi para a mão do cliente**. Se o template mudar — e vai mudar —, é preciso conseguir mostrar exatamente o que foi enviado naquela data, não uma reimpressão com o layout de hoje.

Repropor abre o formulário já preenchido com os dados da última versão. Repropor costuma ser mudar um valor, não redigitar tudo.

### A paleta da marca entrou no sistema

O laranja genérico (`#f97316`) e o azul (`#2563eb`) que vinham do template original deram lugar ao **laranja da marca `#F2421A`**. No tema claro, o fundo passou a ser o creme `#F4F1EA` e o cinza de apoio `#8C887F` assumiu os textos discretos.

Era a pendência **1.2 do PLANO_DE_ACAO**, que fica encerrada.

Os cinzas do tema escuro continuam neutros de propósito — pela mesma razão da v2.8.2: componente de cor no fundo escuro faz o laranja vibrar demais em tela grande.

---

## 3. Decisões técnicas

**A casca dos documentos é infraestrutura compartilhada** (`_lib/documento-base.js`). Ali moram a paleta, a tipografia, as regras de página A4 e o cabeçalho/rodapé. O contrato e o documento de boas-vindas do Lote G reaproveitam tudo — o conteúdo de cada documento é que vive em arquivo próprio.

**O PDF sai da impressão do navegador**, como combinado. O documento abre numa aba com um botão "Salvar como PDF" no topo, que some no papel. Tipografia impecável, custo zero, nenhuma dependência num projeto sem empacotador.

**O documento é buscado por fetch e escrito na aba**, não navegado direto. A rota exige o token que o `auth.js` injeta em cada chamada; uma navegação comum não levaria o cabeçalho e receberia 401. Por isso a aba nasce em branco no clique — navegador bloqueia `window.open` que não venha direto de um gesto — e só depois recebe o conteúdo.

**O HTML renderizado fica guardado no banco**, não apenas os dados que o originaram. É o que garante reproduzir a versão 1 anos depois. Mora numa coluna do D1 e não no R2, pela mesma razão do dossiê: o R2 exige ativação com cartão e o ganho não justifica a dependência.

**Só chaves conhecidas entram no escopo.** A API valida contra o catálogo — um valor inventado no corpo da requisição viraria uma seção vazia num documento que vai para o cliente.

**Tudo que vem do usuário é escapado.** Nome de cliente e objeto entram no HTML do documento; sem escape, um `<script>` no nome do lead viajaria para dentro da proposta. Há teste cobrindo isso.

**Validade sugerida de 30 dias.** Proposta sem prazo envelhece na gaveta do cliente e volta meses depois com o preço de antes.

---

## 4. Verificação

- [ ] Abrir um lead → aba **Proposta** aparece entre "Contato & Endereço" e "Inteligência Artificial"
- [ ] O contato, o telefone e o e-mail vêm preenchidos do lead
- [ ] Os valores de proposta e diagnóstico do funil aparecem já convertidos
- [ ] Tentar gerar sem marcar nenhum serviço → recusa com mensagem
- [ ] Marcar dois serviços e gerar → abre numa aba nova, com a marca e **só os dois serviços**
- [ ] O botão "Salvar como PDF" abre a impressão; **o botão não sai no papel**
- [ ] Imprimir → cinco páginas A4, a capa preta **com o fundo preservado**
- [ ] Gerar de novo → aparece "Versão 2" no histórico, e a versão 1 continua abrindo
- [ ] Reabrir a ficha → o formulário volta preenchido com os dados da última versão
- [ ] Tentar gerar num lead ainda não salvo → avisa para salvar antes
- [ ] Botões e destaques do sistema estão no **laranja da marca**, não no laranja antigo
- [ ] Tema claro → fundo creme, não cinza
- [ ] Alternar tema e navegar por todas as telas → nada ficou ilegível

---

## 5. Pontos de atenção

**A proposta e o contrato divergem hoje.** Comparando os dois documentos que você enviou: o km está a R$ 1,60 no contrato e R$ 1,75 na proposta, e a regra de rescisão da proposta acrescenta "acerto proporcional aos serviços já implantados", que o contrato não tem. Adotei os valores da **proposta** como sugestão dos campos. Quando o contrato entrar (Lote G), sairão do mesmo formulário e a divergência deixa de ser possível — mas **qual dos dois textos vale é decisão de quem responde pelo jurídico**, não minha.

**A redação das cláusulas não foi alterada.** Transcrevi as particularidades e os textos dos serviços dos documentos em uso. Mudar qualquer um é decisão comercial.

---

## 6. O que fica para os próximos lotes

**F — Cliente e conversão**, com a trava do ERP e a classificação herdada do lead.

**G — Contrato e boas-vindas**, reaproveitando a casca de documentos criada aqui. O contrato vai precisar da qualificação do representante legal, preenchida na geração, e do cadastro das empresas contratadas.

---

## 7. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 03/09/2026 | Jair Tavares | Versão inicial. Gerador de documentos compartilhado com a identidade visual da marca, proposta comercial em cinco folhas A4 com escopo montado a partir do catálogo de serviços, versionamento que nunca sobrescreve, geração em PDF pela impressão do navegador, e adoção da paleta oficial (#F2421A, #F4F1EA, #8C887F) no sistema, encerrando a pendência 1.2 do PLANO_DE_ACAO. |
