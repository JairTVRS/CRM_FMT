// FONTE ÚNICA DA VERDADE DA VERSÃO DO SISTEMA
const APP_VERSION = 'v2.5.19';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Atualiza a versão exibida no rodapé
  const versionSpan = document.getElementById('app-version');
  if (versionSpan) {
    versionSpan.textContent = APP_VERSION;
  }
});

// 2. Event Delegation Global acionado em QUALQUER clique da tela
document.addEventListener('click', (event) => {
  // Captura qualquer elemento (botão, span ou div) que contenha "Modo Claro" ou "Modo Escuro"
  const target = event.target;
  const btnText = target.textContent ? target.textContent.trim() : '';

  if (btnText === 'Modo Claro' || btnText === 'Modo Escuro') {
    event.preventDefault();
    
    // Alterna o tema no HTML e no Body
    document.body.classList.toggle('light-theme');
    document.documentElement.classList.toggle('light-theme');
    
    const isLight = document.body.classList.contains('light-theme');

    // Atualiza o texto de todos os botões de tema na tela
    target.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';

    // Troca a imagem da logo para o tema selecionado
    const brandLogos = document.querySelectorAll('#brand-logo, .brand img, .brand-img, .brand');
    brandLogos.forEach(element => {
      if (element.tagName === 'IMG') {
        element.src = isLight ? 'logo-preta.png' : 'logo-branca.png';
      } else {
        const imgInside = element.querySelector('img');
        if (imgInside) imgInside.src = isLight ? 'logo-preta.png' : 'logo-branca.png';
      }
    });
  }
});