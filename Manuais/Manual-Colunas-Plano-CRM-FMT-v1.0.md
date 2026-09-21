# Manual — v2.28.0: as colunas do plano, do jeito de cada um

**Versão:** 1.0
**Data:** 21/09/2026
**Versão do sistema:** 2.28.0
**Responsável:** Jair Tavares

---

## 1. Instalação

**Migração 013, antes do deploy** (segura de rodar duas vezes):

```
npx wrangler d1 execute crm-formatar --remote --file=db/migracao-013-preferencias.sql
npx wrangler d1 execute crm-formatar --remote --command="SELECT name FROM sqlite_master WHERE name = 'preferencias_usuario'"
```

Sem ela, a tela abre no padrão e a configuração vale só até recarregar
— nada quebra.

**A Fase 3 da 2.24.0 passa a ser a migração 014** (era 012, depois 013).

---

## 2. O que mudou

Pedido de 21/09/2026, no modelo da tela de reuniões do ERP: uma
engrenagem ao lado dos filtros que abre **Configurar exibição**.

- **☰ arrastar** muda a ordem das colunas na tabela. Pelo teclado: foco
  na alça e setas para cima/baixo.
- **👁 olho** mostra ou esconde a coluna. A última visível não se esconde.
- **↕ setas** ordenam a tabela pela coluna: A → Z, Z → A, sem ordem. É a
  mesma ordenação do clique no cabeçalho.
- **Exibindo N por página**: 50, 100, 200 ou 500.
- **restaurar colunas** volta tudo ao padrão.

**Salvo por usuário, no servidor** (`preferencias_usuario`, uma linha por
e-mail e tela). Vale em qualquer computador; a configuração de uma pessoa
não mexe na de outra. O e-mail vem sempre da sessão — ninguém lê nem grava
a preferência de outro.

A ordenação escolhida no cabeçalho também fica salva.

---

## 3. Arquivos

| Arquivo | O quê |
|---|---|
| `db/migracao-013-preferencias.sql` | Tabela `preferencias_usuario` |
| `functions/api/preferencias.js` | **Novo.** GET/PUT `?chave=`; o servidor só guarda o JSON (até 8 KB) |
| `public/js/plano-acao.js` | Engrenagem, painel, arrastar, olho, ordenação, por página |
| `public/index.html`, `public/assets/css/cx.css` | Botão e painel lateral |
| `dev/prova/preferencias.mjs` | **Nova.** 15 conferências |

---

## 4. Como verificar

1. Clicar na engrenagem ao lado de "Em aberto".
2. Arrastar "Cliente" para o topo; esconder "Onde". A tabela muda na hora.
3. F5: continua igual.
4. Entrar com outro usuário: vê o padrão, não a sua configuração.

Conferido em captura de tela e com o teclado simulado. **Arrastar com o
mouse não pôde ser exercitado daqui** — o navegador sem janela não
arrasta.

---

## 5. v2.28.1 — uma rolagem só

Pedido de 21/09/2026: "a página está ficando grande para scroll".

A página rolava **e** a tabela rolava: para chegar ao fim de uma era
preciso rolar as duas. Agora:

- **A tela do plano ocupa a altura da janela.** Cabeçalho, gráficos e
  filtros ficam parados; só a tabela rola. Em janela muito baixa (menos
  de ~34rem) a página volta a rolar, para a tabela não ficar com três
  linhas.
- **O painel ficou mais baixo** (rosca e colunas menores, menos espaço
  entre as linhas) e **as linhas da tabela também**: o texto longo corta
  em duas linhas em vez de três — o texto inteiro aparece ao clicar para
  editar.
- **Botão de gráficos** ao lado da engrenagem: recolhe o painel e a tabela
  ganha a altura dele. Os cartões do cabeçalho continuam à vista. A
  escolha fica salva com a configuração de colunas (e "restaurar colunas"
  volta a mostrar os gráficos).

Sem migração.
