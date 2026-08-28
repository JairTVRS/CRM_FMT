# Indicador de progresso do dossiê — v2.8.1

**Data:** 28/08/2026

## O problema

As etapas paravam de mudar aos 50 segundos. Passado esse ponto a tela
congelava num texto fixo, e o usuário não tinha como saber se o sistema
ainda estava trabalhando ou tinha travado.

## O que foi feito

**Anel de progresso com tempo decorrido.** O anel preenche em função do
tempo, e o número no centro mostra quanto já passou (`45s`, `1min 20s`).

**Etapas até 140 segundos.** Eram cinco, agora são oito. A última diz
que está demorando mais que o normal, mas segue em andamento — em vez
de simplesmente parar de responder.

## Por que o anel não mostra percentual real

Não existe percentual verdadeiro para mostrar: não há como saber onde o
modelo está no meio da geração. Uma barra que finge 40%, 60%, 80% seria
invenção, e quando travasse em 80% por meio minuto o usuário desconfiaria
mais do que antes.

O anel avança por uma curva assintótica sobre o tempo decorrido:

| Tempo | Anel |
|---|---|
| 10s | 30% |
| 30s | 66% |
| 60s | 88% |
| 120s | 93% |
| adiante | 93% |

Sobe rápido no início, desacelera, e **para em 93%**. Os 7% finais só
fecham quando a resposta chega de verdade. Assim o usuário vê movimento
constante sem que o sistema afirme um número falso, e o fechamento do
anel é informação real: acabou.

## Arquivos

| Arquivo | O que mudou |
|---|---|
| `public/js/dossie.js` | Cronômetro, curva do anel, etapas estendidas |
| `public/index.html` | SVG do anel no lugar do spinner |
| `public/assets/css/dossie.css` | Estilo do anel e do contador |
| `package.json` | 2.8.1 |

## Detalhes de implementação

O contador usa `tabular-nums`, então os dígitos não "pulam" de largura a
cada atualização. O anel começa no topo (`rotate(-90deg)`) e tem
`stroke-linecap: round`, com transição de 0,3s para o avanço não ficar
granulado — ele é atualizado quatro vezes por segundo.

O `limparTimers` agora também encerra o cronômetro, então erro ou
fechamento do modal no meio da geração não deixa um `setInterval`
rodando em segundo plano.
