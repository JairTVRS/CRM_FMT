# Manual — Lote D: gaveta lateral e ficha completa (CRM Formatar)

**Versão:** 1.0
**Data:** 03/09/2026
**Versão do sistema:** 2.12.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Este lote não tem migração de banco.** Todos os campos já existiam desde o v2.9.0 — o que faltava era a tela.

```bash
git add -A
git commit -m "v2.12.0 - Gaveta lateral e ficha completa do lead"
git push origin main
```

---

## 2. O que este lote entrega

### A ficha virou gaveta

A ficha do lead deixou de ser um cartão centrado e passou a **deslizar da direita**, ocupando pouco mais de um terço da tela.

O motivo é o quadro: um modal centrado tapava as colunas, e era exatamente isso que a gaveta veio resolver — você abre um cartão, mexe nele e continua vendo o funil atrás.

Fecha de três jeitos: o **×**, a tecla **Esc**, ou clicando fora da gaveta. Em tela estreita ela ocupa a largura toda, porque ali não há quadro atrás para preservar.

### Aba "Funil" — os campos que faltavam

O manual do Lote A dizia que os campos do funil entrariam na tela junto com o quadro, para não haver duas rodadas de mudança na mesma ficha. É este o momento. A aba nova traz:

**Etapa do funil** · **Advisor** · **Quem atendeu** · **Data de cadastro** · **Último contato** · **Próximo contato** · **Valor da proposta** · **Valor do diagnóstico** · **Data de fechamento** · **Tags**

Com isso, tudo que a importação de planilha já gravava passa a ser visível e editável na tela.

### Advisor: digita o nome, vira opção

O campo tem sugestão dos advisors existentes, mas aceita nome novo. **Ao salvar, um advisor inédito é cadastrado automaticamente** e o lead já sai vinculado — a mesma mecânica do Lote A, sem tela de administração.

### Tags como chips

As tags aparecem como etiquetas coloridas que ligam e desligam no clique. O campo abaixo cria uma tag nova, que já nasce marcada no lead — quem acabou de criar quer usar.

### "Dias para o próximo contato", ao lado da data

Escolhida a data, aparece ao lado quantos dias faltam — ou quantos já se passaram, em vermelho, quando o prazo venceu.

**Esse número não é guardado no banco.** Gravado, nasceria desatualizado no dia seguinte; calculado na exibição, está sempre certo. É a mesma decisão do Lote A.

### Padrões de um lead novo

Ao clicar em "+ Incluir Lead", a data de cadastro vem com hoje, "quem atendeu" vem com o seu e-mail, e a etapa vem com a primeira coluna do funil.

---

## 3. Decisões técnicas

**A gaveta é uma troca de casca, não de conteúdo.** O elemento continua sendo o mesmo `#modal-lead`, com os mesmos ids dentro — mudou a classe e o CSS. Por isso o dossiê e o enriquecimento por IA seguem funcionando sem uma linha alterada: eles nunca souberam em que tipo de janela estavam.

**Um lugar só para editar lead.** A gaveta serve à tabela e ao quadro. Duas telas de edição para o mesmo registro divergiriam na primeira manutenção.

**Cadastros num módulo próprio** (`cadastros.js`). Advisors, tags e etapas são as mesmas listas para a ficha, o quadro e — mais à frente — a jornada do cliente. Uma cópia por tela ficaria desatualizada no primeiro cadastro novo.

**A aba do funil sabe se remontar.** Se a ficha for aberta antes de as listas chegarem do servidor, os selects nasceriam vazios e a etapa e o advisor do lead se perderiam ao salvar. O evento `crm:cadastros` reexecuta o preenchimento com o mesmo lead.

**Valores continuam em centavos no banco.** A tela mostra `25.424,00` e manda o texto; a API converte com o mesmo conversor da importação. O ida-e-volta foi verificado, inclusive contra separador não-ASCII, que quebraria a conversão em silêncio.

**Os padrões do lead novo são aplicados depois da limpeza.** O `limparFormularioModal` zera o formulário por varredura; se os padrões viessem antes, seriam apagados em seguida. A ordem foi invertida no `app.js`.

**O rodapé da gaveta é fixo.** A aba do funil é longa, e um botão "Salvar" que rola para fora da tela é um botão que não é usado.

---

## 4. Verificação

- [ ] Clicar num lead da tabela → a ficha **desliza da direita**, não abre no centro
- [ ] Clicar num cartão do quadro → a ficha abre e **o quadro continua visível atrás**
- [ ] Esc fecha a ficha; clicar fora também; clicar dentro não fecha
- [ ] Aba "Funil" aparece entre "Dados Gerais" e "Contato & Endereço"
- [ ] Preencher etapa, datas e valores → salvar → reabrir → **os valores voltam certos**
- [ ] Valor digitado como `25.424,00` volta como `25.424,00` (não como `2542400` nem `254,24`)
- [ ] Escolher data de próximo contato no passado → aparece "N dia(s) em atraso" em vermelho
- [ ] Digitar um advisor que não existe → salvar → ele passa a aparecer na sugestão dos outros leads
- [ ] Criar uma tag → ela já nasce marcada no lead aberto
- [ ] Ligar e desligar tags → salvar → reabrir → as marcadas continuam marcadas
- [ ] "+ Incluir Lead" → data de cadastro com hoje, "quem atendeu" com seu e-mail, etapa na primeira coluna
- [ ] Trocar a etapa pela ficha → o cartão muda de coluna no quadro ao salvar
- [ ] Gerar dossiê pela aba de IA → **continua funcionando como antes**
- [ ] Em tela estreita, a ficha ocupa a largura toda

---

## 5. O que fica para os próximos lotes

**E — Gerador de documentos** e a proposta comercial com a identidade visual da empresa.

**F — Cliente e conversão**, onde o lead em "Finalizado" abre a tela de conversão e a classificação é herdada pelo cliente.

A gaveta construída aqui é a mesma que vai abrir a ficha do cliente na trilha de CX.

---

## 6. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 03/09/2026 | Jair Tavares | Versão inicial. Ficha do lead convertida em gaveta lateral com fechamento por Esc e clique fora, aba "Funil" expondo etapa, advisor, atendente, as quatro datas, os dois valores e tags, criação de advisor e de tag ao digitar, dias para o próximo contato calculados na exibição, e módulo compartilhado de cadastros. |
