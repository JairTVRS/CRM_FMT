# Manual — v2.34.1: barra do topo e tema claro

**Versão:** 1.0
**Data:** 28/09/2026
**Versão do sistema:** 2.34.1
**Responsável:** Jair Tavares

Pedido de 28/09/2026: o padrão dos outros sistemas da Formatar — os
ícones do usuário, das configurações e do tema no canto superior
direito — e o CRM abrindo no tema claro. Sem migração.

## O que mudou

- **Barra do topo**, à direita: **tema** (lua no claro, sol no escuro),
  **configurações** (engrenagem) e o **usuário** — um círculo com as
  iniciais, ou a foto do Google. Clicar no círculo abre o menu com nome,
  e-mail, "Administrador" (quando for), a versão do sistema e **Sair**.
  A barra fica parada ao rolar a tela.
- **A barra lateral ficou só com o menu**, mais estreita (216 px em vez
  de 240), com "Jornada do cliente" numa linha só.
- **Tema claro por padrão.** Quem preferir o escuro clica na lua; a
  escolha fica guardada **naquele navegador**. O tema é aplicado antes de
  a página aparecer, então não pisca escuro ao abrir. O logo (barra
  lateral e tela de login) acompanha o tema.
- A tela do Plano de Ação continua cabendo na janela, descontando a
  barra do topo.

## Arquivos

| Arquivo | O quê |
|---|---|
| `public/index.html` | Barra do topo; rodapé da barra lateral removido; tema claro aplicado no `<head>` |
| `public/js/auth.js` | Avatar com iniciais e o menu do usuário |
| `public/js/app.js` | Tema lembrado por navegador (`crm_tema`), claro por padrão |
| `public/assets/css/main.css`, `auth.css`, `cx.css` | Estilos da barra, menu mais compacto, altura do Plano |

## Como verificar

1. Ctrl+F5: o CRM abre claro; no canto superior direito, lua, engrenagem
   e o círculo com as iniciais.
2. Clique no círculo: nome, e-mail, versão e Sair.
3. Clique na lua: fica escuro; F5 — continua escuro. Clique no sol para
   voltar.
