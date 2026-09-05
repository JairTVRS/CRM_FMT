# Manual — Ajustes de tela (CRM Formatar)

**Versão:** 1.0
**Data:** 05/09/2026
**Versão do sistema:** 2.16.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Não tem migração.** Só arquivos de front. Commit e push:

```bash
git add -A
git commit -m "v2.16.0 - Calendario pelo campo, CEP no ViaCEP e fim da analise falsa"
git push
```

Nasceu da verificação em navegador da v2.15.0, e não do roadmap: são três
incômodos reais achados usando o sistema.

---

## 2. O que muda

### O calendário abre clicando no campo

Os campos de data **sempre foram** `input type="date"` — o calendário
nativo já existia, atrás do ícone à direita. O que não existia era abri-lo
clicando no meio do campo, e quem esperava o calendário concluía que não
tinha.

Vale para os quatro campos do funil (cadastro, último contato, próximo
contato, fechamento) e para o início da jornada na ficha do cliente.

Um ouvinte delegado no documento, não campo a campo: os campos de data
vivem dentro de modais e alguns são desenhados depois do carregamento.
Digitar continua funcionando — com o calendário aberto, as teclas ainda
vão para o campo.

### CEP preenche o endereço

Preencher o CEP consulta o **ViaCEP** e completa Cidade/UF e logradouro.
Dispara ao sair do campo e assim que os 8 dígitos aparecem — colar um CEP
não deveria exigir sair do campo para funcionar.

Abaixo do campo, uma linha diz o que aconteceu: a cidade encontrada, "CEP
não encontrado", ou o motivo da falha.

**O número do imóvel sobrevive.** O ViaCEP é base de logradouro, não de
imóvel: não devolve número. Se o campo já tinha "Rua Exemplo, 1511 -
Centro", trocar o logradouro cru apagaria o 1511 — que é a parte que só o
usuário sabe. A mesclagem preserva o primeiro número solto do valor
anterior.

**O CEP manda no endereço.** Decisão de 05/09/2026: quando a consulta de
CNPJ (Receita) e a de CEP discordarem, vence o CEP — é a intenção mais
recente e mais específica de quem está digitando. A Receita segue
preenchendo o que a base de CEP não tem.

### A IA não inventa mais análise quando falha

Este é o mais sério dos três.

Quando a chamada de enriquecimento falhava, o `catch` **escrevia uma
análise fabricada** na tela — "Empresa atuante no mercado com presença
digital identificada", "Forte alinhamento para projetos de governança
corporativa" — com aparência de resultado real e **sem nenhuma marca de
que era falsa**. O único sinal ia para o console do navegador, que ninguém
lê.

Num CRM, isso vai parar numa reunião como se fosse pesquisa de verdade.

Agora a falha diz que falhou e diz por quê: a causa vem dos campos `error`
e `details` do corpo da resposta, não do código de status. É a mesma lição
do incidente da 006 — "Falha ao gerar a proposta" escondia
`no such table: propostas` por um dia inteiro.

---

## 3. Decisões técnicas

### Por que o ViaCEP é chamado do navegador

O `auth.js` intercepta o `fetch` global e injeta o ID token **só** em URLs
que contenham `/api/`. A do ViaCEP não contém, então passa limpa e o token
não vaza.

O serviço é público, tem CORS liberado e não pede chave. Um endpoint
próprio nas Functions só acrescentaria um salto e consumo de Worker — ao
contrário da consulta de CNPJ, que passa pelo servidor porque depende de
provedor com limite.

### CEP inexistente não é erro de rede

O ViaCEP responde **200 com `{ erro: true }`** para CEP que não existe.
Tratar isso como sucesso preencheria a ficha com nada e o usuário não
saberia por quê. O código testa o campo `erro` explicitamente.

---

## 4. Verificação

### O que eu verifiquei

24 verificações, todas passando, incluindo **chamada real ao ViaCEP**:

- formatação do CEP (8 dígitos, já formatado, incompleto, vazio, nulo);
- a mesclagem de endereço em seis cenários — com número, sem número, com
  ViaCEP devolvendo campos vazios, com valor anterior nulo;
- o ViaCEP de verdade no CEP 35500-017 (o da própria Formatar): responde
  200, devolve Divinópolis/MG e logradouro, e **não** devolve número —
  que é a razão de a mesclagem existir;
- CEP inexistente vindo como 200 + `erro: true`;
- o texto fabricado da IA não existe mais em lugar nenhum do `app.js`, e
  o caminho que o escrevia saiu.

As provas do Lote L continuam passando (41 verificações + a conferência
de fiação de ids e classes).

### O que eu NÃO verifiquei — é seu

- [ ] Clicar no meio de cada campo de data abre o calendário
- [ ] Digitar a data no teclado continua funcionando
- [ ] Digitar um CEP válido preenche Cidade/UF e logradouro
- [ ] **Colar** um CEP dispara a busca sem precisar sair do campo
- [ ] Um endereço com número tem o número preservado ao trocar o CEP
- [ ] CEP inexistente (ex.: 99999-999) mostra "CEP não encontrado"
- [ ] Salvar o lead grava o endereço preenchido pelo CEP
- [ ] Desligar a chave de IA em Configurações e clicar em "Preencher
      campos com IA" — tem que aparecer o **erro**, nunca uma análise

---

## 5. Histórico de versões

| Versão | Data | O quê |
|---|---|---|
| 1.0 | 05/09/2026 | Calendário pelo campo, CEP no ViaCEP, fim da análise falsa (sistema 2.16.0) |
