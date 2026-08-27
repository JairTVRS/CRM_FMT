# Manual — Dossiê Executivo, Lote 5 e correções (CRM Formatar)

**Versão:** 1.0
**Data:** 27/08/2026
**Projeto:** CRM_FMT — `https://crm-fmt.pages.dev`
**Escopo:** interface do dossiê e cinco correções da v2.6.1
**Responsável:** Jair Tavares

---

## 1. O que muda para o usuário

O botão da aba Inteligência Artificial passa a ser **"Gerar Inteligência"** e abre o modal do dossiê. O antigo enriquecimento não sumiu: virou um segundo botão, **"Preencher campos com IA"**, porque são funções diferentes — um preenche campos do lead em segundos, o outro produz um documento em cerca de um minuto.

O modal se comporta assim:

- **Já existe dossiê para o CNPJ** → abre o existente, com o histórico de versões num seletor. Não gera nada, não espera.
- **Não existe** → mostra a tela inicial, com um campo opcional para colar bio e legendas do Instagram, e o aviso de que a geração leva de 30 a 60 segundos.
- **Durante a geração** → progresso com etapas nomeadas ("Consultando dados cadastrais na Receita…", "Lendo o site institucional…").
- **Pronto** → o documento aparece num iframe, com botões de baixar HTML, imprimir em PDF e gerar nova versão.

---

## 2. Arquivos

| Arquivo | Situação |
|---|---|
| `public/js/dossie.js` | **novo** — lógica do modal |
| `public/assets/css/dossie.css` | **novo** — estilos do modal |
| `public/index.html` | reescrito — botões, modal e scripts |
| `functions/api/dossier.js` | reescrito — correções 1 e 2 |
| `functions/api/_lib/storage.js` | reescrito — correção 1 |
| `functions/api/_lib/dossie-template.js` | reescrito — correção 5 |
| `functions/api/_lib/cnpj.js` | reescrito — correções 3 e 4 |

---

## 3. As cinco correções

**1. Versão vazia no rodapé.** O documento saía com "Versão —". A causa era de ordem: o HTML era renderizado antes de gravar, e é a gravação que determina o número. Agora o `salvarDossie` recebe uma *função* que monta o HTML, e a chama já sabendo a versão. Efeito colateral bom: quando dois consultores geram ao mesmo tempo e há colisão de número, o documento é re-renderizado com o valor correto, em vez de gravar um HTML com a versão errada.

**2. Ausência de Instagram virando "não tem presença digital".** No teste, o modelo colocou "Presença digital limitada" nos pontos de atenção porque nenhum Instagram foi informado — confundindo dado não coletado com fato sobre a empresa. O prompt agora instrui explicitamente a não tratar do tema quando o dado não veio.

**3 e 4. Porte, capital social e nome fantasia em branco.** A BrasilAPI falhou na sua conta e a consulta caiu para a OpenCNPJ, que usa nomes de campo diferentes. Ampliei os apelidos aceitos e o capital social agora aceita string com vírgula ou ponto. **Estas duas correções são um palpite fundamentado, não uma verificação** — não consigo alcançar a OpenCNPJ do meu ambiente. Veja a seção 5.

**5. Radar em coluna única na impressão.** A media query de largura pegava na página impressa e empilhava os quatro quadrantes, gastando páginas. Agora o print força 2×2 no radar, três colunas nos KPIs e duas nos itens de portfólio. O dossiê de teste deve cair de seis para cerca de quatro páginas.

---

## 4. Decisões técnicas do modal

**O documento nunca é aberto por URL.** O endpoint exige token, e navegação de aba não passa pelo `auth.js` — foi o que produziu aquele `TOKEN_AUSENTE` no teste. O modal busca o HTML por fetch autenticado e injeta no iframe via `srcdoc`.

**O iframe isola o CSS.** O dossiê tem variáveis com nomes parecidos com as do `main.css`; sem isolamento, os dois colidiriam. O `sandbox` permite `allow-same-origin` e `allow-modals` — o segundo é necessário para o `window.print()` funcionar de dentro do frame.

**O download é por Blob.** Um link direto para a URL do endpoint responderia 401. O HTML já está em memória, então vira Blob e baixa.

**O progresso é por tempo decorrido, não barra real.** Não há como saber onde o modelo está no meio da geração. Uma barra percentual seria invenção; etapas nomeadas por tempo são honestas e cumprem a função de mostrar que o sistema não travou.

---

## 5. O que ainda precisa ser verificado

As correções 3 e 4 dependem dos nomes de campo reais da OpenCNPJ, que não consigo consultar daqui. Abra esta URL no navegador e me mande o resultado:

```
https://api.opencnpj.org/07091149000172
```

Com a resposta em mãos, mapeio os campos com precisão em vez de tentar apelidos. Se o porte e o capital continuarem em branco depois deste lote, é isso que falta.

Vale notar que a BrasilAPI ter falhado pode ter sido momentâneo. Se ela voltar a responder, esses campos aparecem normalmente e a questão perde urgência.

---

## 6. Verificação

Após o deploy, no CRM:

- [ ] Abrir um lead com CNPJ preenchido → aba Inteligência Artificial mostra os dois botões
- [ ] "Gerar Inteligência" num CNPJ já processado → abre o existente, sem esperar
- [ ] O rodapé do documento mostra **"Versão 2"**, não "Versão —"
- [ ] "Gerar nova versão" → pede confirmação, gera a versão 3, e o seletor de histórico aparece
- [ ] Trocar de versão no seletor → o documento troca
- [ ] "Baixar HTML" → arquivo `dossie-<cnpj>-v<n>.html` abre offline com o layout intacto
- [ ] "Imprimir / PDF" → radar em 2×2, documento em torno de quatro páginas
- [ ] Lead sem CNPJ → mensagem explicando que o campo é obrigatório, sem chamar a IA
- [ ] Colar bio e legendas do Instagram → a seção Presença Digital reflete o conteúdo colado
- [ ] Sem Instagram informado → o documento **não** afirma que a empresa não tem presença digital

---

## 7. Histórico de versões

| Versão | Data | Autor | Alterações |
|---|---|---|---|
| 1.0 | 27/08/2026 | Jair Tavares | Versão inicial. Modal do dossiê com iframe isolado, progresso por etapa, entrada manual de Instagram, histórico de versões, download e impressão. Cinco correções da v2.6.1. |
