document.addEventListener('DOMContentLoaded', () => {
  const btnTheme = document.getElementById('btn-theme') || document.querySelector('.btn-theme');
  const brandLogo = document.getElementById('brand-logo');

  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      const isLight = document.body.classList.contains('light-theme');

      // Troca a imagem da logo
      if (brandLogo) {
        brandLogo.src = isLight ? 'logo-preta.png' : 'logo-branca.png';
      }

      // Atualiza o texto do botão
      btnTheme.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';
    });
  }
});