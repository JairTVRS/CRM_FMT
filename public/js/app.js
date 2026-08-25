// FONTE ÚNICA DA VERDADE DA VERSÃO DO SISTEMA
const APP_VERSION = 'v2.5.18';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Atualiza a versão exibida na tela automaticamente
  const versionSpan = document.getElementById('app-version');
  if (versionSpan) {
    versionSpan.textContent = APP_VERSION;
  }

  // 2. Mapeamento de elementos para alternância do Modo Claro/Escuro
  const btnTheme = document.getElementById('btn-theme') || document.querySelector('.topbar-btn');
  
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      document.documentElement.classList.toggle('light-theme');
      
      const isLight = document.body.classList.contains('light-theme');

      // Busca o elemento da logo por id ou pelas classes comuns da marca
      const brandLogo = document.getElementById('brand-logo') || 
                        document.querySelector('.brand img') || 
                        document.querySelector('.brand-img');

      if (brandLogo) {
        // Altera a imagem com base no tema atual
        brandLogo.src = isLight ? 'logo-preta.png' : 'logo-branca.png';
      }

      // Atualiza o texto do botão
      btnTheme.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';
    });
  }
});