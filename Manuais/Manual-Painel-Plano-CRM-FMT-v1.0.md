# Manual — v2.26.0: o painel do plano de ação

**Versão:** 1.0
**Data:** 21/09/2026
**Versão do sistema:** 2.26.0
**Responsável:** Jair Tavares

---

## 1. Instalação

Sem migração, sem permissão nova. Sobe com o deploy. Depende da 2.25.0
(migração 012), que já está no ar.

---

## 2. O que mudou

Pedido do usuário em 21/09/2026, depois de ver a 2.25.0 no ar:

1. **Ordenar por qualquer coluna.** Um clique no cabeçalho ordena A → Z,
   outro Z → A, o terceiro volta à ordem original (atrasadas primeiro).
   Célula vazia vai sempre para o fim. "Ação" ordena pelo número N.M,
   "Data prevista" pela data.
2. **Painel acima da tabela**, no lugar da fileira de cartões:
   - **Ações em aberto por prazo** (rosca): atrasadas, vencem em até 7
     dias, no prazo, sem data prevista. Cor de status, sempre com ícone e
     rótulo ao lado — a cor nunca carrega o sentido sozinha.
   - **Gargalos de cadastro** (barras): sem responsável, sem data prevista,
     sem 5W2H, cada um como fração das abertas.
   - **Ações em aberto por núcleo** (colunas), maior primeiro; passando de
     oito núcleos, o resto vira "Outros".
   - Quatro cartões no cabeçalho: em aberto, atrasadas, fechadas, total.

**Tudo no painel filtra a tabela com um clique** — fatia, linha da
legenda, gargalo, coluna de núcleo, cartão. Clicar de novo desfaz.

O painel conta sobre o recorte de **cliente, núcleo e busca**, mas **não**
sobre a situação: escolher "Atrasadas" não transforma a rosca em 100%
atrasada. Com um cliente escolhido, os números são dele.

### Três desvios conscientes do esboço enviado

- O esboço tinha barras de gargalo em duas cores empilhadas sem legenda
  que dissesse o que cada parte era. Ficou uma cor só: a barra é "quantas
  das abertas", e o número está ao lado.
- A legenda do esboço repetia "Com pendências" duas vezes. As fatias
  agora são as quatro faixas de prazo, que não se sobrepõem.
- O esboço não tinha fatia para "fechadas": a rosca é das abertas, e as
  fechadas estão no cartão do cabeçalho.

### A carga que parava com "excesso de requisições"

No primeiro dia no ar, a carga parou em 22/05 com "O hub recusou por
excesso de requisições". Cada passo pedia de novo todas as carteiras,
clientes, tipos e times — mais de vinte páginas por mês lido. Três
correções:

- **Memória de 10 minutos** para essas quatro listas (`memorizar` em
  `_lib/hub.js`). Só as reuniões são pedidas de novo a cada passo.
- **O servidor espera e tenta de novo** quando o hub responde 429,
  respeitando o `Retry-After` (até 5 s, duas vezes).
- **A tela pausa e retoma** se mesmo assim o hub recusar: mostra
  "O ERP pediu uma pausa — retomando em Ns" e continua de onde parou.

O que já tinha sido carregado não se perdeu: o cursor fica gravado, e a
próxima abertura da tela continua de 22/05.

---

## 3. Como verificar

1. Abrir o Plano de Ação: a linha do topo deve chegar a "Atas lidas até
   hoje" sem parar. Se aparecer a pausa, ela retoma sozinha.
2. Clicar na fatia vermelha: a tabela mostra só as atrasadas. Clicar de
   novo: volta para "Em aberto".
3. Clicar numa coluna de núcleo: o filtro de núcleo muda junto.
4. Clicar em "Responsável" no cabeçalho duas vezes: A → Z e Z → A.

Provas: 663 conferências em 14 suítes. O dublê do hub ganhou o modo
`--limite` (a primeira chamada a cada rota responde 429). O painel foi
conferido com captura de tela sobre dados fictícios; os números reais,
só no navegador.
