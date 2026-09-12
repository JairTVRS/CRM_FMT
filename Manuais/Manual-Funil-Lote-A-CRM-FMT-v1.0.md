# Manual — Lote A: base do funil comercial (CRM Formatar)

**Versão:** 1.0
**Data:** 28/08/2026
**Versão do sistema:** 2.9.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**A migração vem antes do deploy.** Se o código subir sem as colunas novas, o cadastro de leads falha.

```bash
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-004-funil.sql
```

Confirme:

```bash
npx wrangler d1 execute crm-formatar --remote --command="SELECT nome, ordem FROM etapas ORDER BY ordem"
```

Devem aparecer as seis etapas. Depois:

```bash
git add -A
git commit -m "v2.9.0 - Base do funil: campos, advisors, tags e etapas"
git push origin main
```

---

## 2. O que este lote entrega

Ainda **não há quadro kanban nem tela de importação** — isso são os lotes seguintes. Este é o alicerce: os campos, os cadastros de apoio e a reorganização do menu.

### Campos novos nos leads

Canal (substitui "Origem"), atendente, advisor, as quatro datas do acompanhamento comercial, valor da proposta, valor do diagnóstico, etapa no funil, posição na coluna e tags.

Os leads que já existiam foram movidos para "Novo Lead" e tiveram a origem copiada para canal automaticamente.

### Três cadastros de apoio

**Advisors, tags e etapas** seguem a mesma mecânica: digita o nome, vira opção para todos. Sem tela de administração separada e sem perfil de admin — a equipe é pequena e o atrito de um fluxo formal custaria mais que o risco.

A proteção contra estrago é a exclusão condicional: **nada que esteja em uso pode ser removido**. A mensagem informa quantos leads estão vinculados.

### Etapas iniciais

Novo Lead, Qualificação, Proposta, Negociação, Finalizado e Perdido. As duas últimas são marcadas como terminais, o que o quadro vai tratar de forma diferente.

### Menu reorganizado

Configurações saiu do menu principal e foi para o rodapé da barra lateral, ao lado do tema. Ambos viraram só ícone, lado a lado. O ícone do tema mostra **para onde se vai**, não onde se está: no escuro aparece o sol.

---

## 3. Documento obrigatório

CPF ou CNPJ passa a ser obrigatório, na criação e na edição. É a identidade do lead: alimenta o contexto da IA no dossiê e é o que impede duplicidade.

A validação usa o **dígito verificador**, não apenas a contagem de dígitos. Um número digitado errado quase sempre falha nessa conta — não pega tudo, mas pega a maioria dos erros de digitação.

Editar o documento é permitido. Se o novo valor já pertencer a outro lead ativo, o sistema recusa e informa qual é.

**Atenção:** os leads que já existem sem documento válido vão recusar salvar na próxima edição. São poucos, e basta preencher o campo.

---

## 4. Decisões técnicas

**Valores em centavos.** `R$ 25.424,00` é guardado como `2542400`. Soma de coluna do kanban com ponto flutuante acumula erro de arredondamento; com inteiro, não.

**Tags guardam ID, não texto.** O JSON de cada lead tem `[1,4,7]`. Renomear uma tag altera uma linha só, em vez de exigir varrer todos os leads. Há teste confirmando isso.

**"Dias para próximo contato" não é armazenado.** É a diferença entre hoje e a data do próximo contato. Guardado, nasceria desatualizado no dia seguinte; calculado na exibição, está sempre certo.

**Conversores na entrada da API.** `SERVIÇO` vira `SERVIÇOS`, `15/01/26` vira `2026-01-15`, `R$ 25.424,00` vira centavos. Fica pronto para a importação do próximo lote e vale também para o cadastro manual.

**A coluna `origem` continua existindo** no banco, apesar de a API passar a usar `canal`. Remover coluna no SQLite exige recriar a tabela; deixá-la ali não custa nada e preserva o que já foi cadastrado.

---

## 5. Verificação

- [ ] Rodapé mostra engrenagem e ícone de tema lado a lado, sem texto
- [ ] Clicar na engrenagem abre Configurações
- [ ] Alternar o tema troca o ícone (sol ↔ lua) e **não apaga** o botão
- [ ] Cadastrar lead sem documento → recusa com mensagem sobre a IA
- [ ] Cadastrar com CNPJ de dígito errado → recusa
- [ ] Cadastrar com CPF válido → aceita
- [ ] Leads antigos aparecem normalmente na tabela

---

## 6. Próximos lotes

**B — Importação** de `.xlsx`, `.csv` e `.txt`, com pré-visualização e trava de CNPJ.
**C/D — Quadro kanban** com colunas, cartões, arrastar e soltar, e a engrenagem de gerenciar etapas.
**E — Gaveta lateral** para abrir o cartão sem perder o quadro.

O formulário de lead ainda não expõe os campos novos na tela — eles existem no banco e na API, e entram na interface junto com o quadro, para não haver duas rodadas de mudança na mesma ficha.

---

## 7. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 28/08/2026 | Jair Tavares | Versão inicial. Campos do funil, cadastros de advisors, tags e etapas com exclusão condicional, documento obrigatório com dígito verificador, conversores de data e valor, menu de Configurações movido para o rodapé. |
