document.addEventListener('DOMContentLoaded', () => {
  const btnTheme = document.getElementById('btn-theme') || document.getElementById('btn-tema') || document.querySelector('.btn-theme');
  
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      const isLight = document.body.classList.contains('light-theme');

      // Tenta encontrar a logo por id ou por seletor de classe
      const brandLogo = document.getElementById('brand-logo') || document.querySelector('.logo img') || document.querySelector('header img');
      if (brandLogo) {
        brandLogo.src = isLight ? 'logo-preta.png' : 'logo-branca.png';
      }

      // Alterna o texto do botão
      btnTheme.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';
    });
  }
});