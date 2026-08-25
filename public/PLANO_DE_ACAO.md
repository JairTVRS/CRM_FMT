# 📋 Plano de Ação & Roadmap — CRM Formatar

Este documento registra todas as pendências, diretrizes visuais e etapas de refatoração do sistema, garantindo alinhamento técnico e fidelidade ao **Manual de Identidade Visual (Formatar College v1.0)**.

---

## 🚀 FASE 1: EXECUÇÃO IMEDIATA (Refatoração Base & Visual)

### 1.1 Limpeza de Emojis / Tom Corporativo
- [ ] Varrer todo o código da aplicação e remover emojis em menus, títulos de cards, botões e modais.
- [ ] Manter apenas rótulos e textos limpos no padrão corporativo.

### 1.2 Aplicação do Design System Formatar (Web)
- [ ] **Variáveis de Cores (CSS Tokens):**
  - Laranja Principal: `#F2421A` (substituir tons genéricos de laranja/azul)
  - Preto / Tinta: `#0D0D0D` / `#1A1A1A`
  - Cinza de Apoio: `#8C887F`
  - Fundo Claro (Creme): `#F4F1EA`
- [ ] **Tipografia (Urbane Rounded):**
  - Definir a família `Urbane Rounded` com fallback (`Poppins`, `sans-serif`).
  - Títulos: `Urbane Rounded Bold` (700)
  - Corpo/Cards: `Urbane Rounded Medium` (500) / `Light` (300)
  - Kickers e Etiquetas: `Urbane Rounded DemiBold` (600) em caixa alta com `letter-spacing`
- [ ] **Ajustes de Componentes:**
  - Corrigir a logo do topo para o padrão oficial Formatar College (círculo + texto).
  - Alinhar botões principais (`#F2421A`) e cards aos padrões de bordas e espaçamentos.

### 1.3 Modularização do Monólito (`index.html`)
- [ ] **Extração de CSS:**
  - Mover o bloco de estilos `<style>` do `index.html` para `assets/css/main.css` e `assets/css/components.css`.
- [ ] **Extração de JS:**
  - Mover os scripts do `index.html` para arquivos dedicados dentro da pasta `/js`:
    - `js/app.js` (inicialização e eventos globais)
    - `js/configuracoes.js` (lógica de chaves de API e provedores)
    - `js/leads.js` (gestão e exibição de leads)

---

## 🔮 FASE 2: PENDÊNCIAS REGISTRADAS (Atualizações Futuras)

### 2.1 Mapeamento e Implementação de Ícones Vetoriais (SVG Line Icons)
*Substituição visual dos antigos emojis por uma biblioteca de ícones em traço fino e discreto:*

- [ ] `ChatGPT`: Ícone vetorial de CPU / IA
- [ ] `Claude`: Ícone vetorial de cérebro / processamento
- [ ] `Gemini`: Ícone vetorial de faíscas / brilho
- [ ] `DeepSeek`: Ícone vetorial de busca / código
- [ ] `Groq`: Ícone vetorial de velocidade / raio em linha
- [ ] `Ollama`: Ícone vetorial de servidor / local host
- [ ] `Leads`: Ícone vetorial de grupo de usuários
- [ ] `Configurações`: Ícone vetorial de engrenagem
- [ ] `Salvar Chaves`: Ícone vetorial de disquete ou check
- [ ] `Modo Escuro`: Ícone vetorial de lua / sol
- [ ] `Sair`: Ícone vetorial de logout

### 2.2 Arquitetura Avançada e Tema Escuro
- [ ] Refatorar o roteamento da aplicação para carregamento dinâmico de componentes sem recarregar o navegador.
- [ ] Ajustar o `Modo Escuro` para seguir estritamente o gradiente/fundo escuro `#0D0D0D` e detalhes `#F2421A` previstos no manual.