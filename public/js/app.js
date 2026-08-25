const btnTheme = document.getElementById('btn-theme');
const brandLogo = document.getElementById('brand-logo');

if (btnTheme) {
  btnTheme.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    
    const isLight = document.body.classList.contains('light-theme');
    
    // Alterna a imagem da logo
    if (brandLogo) {
      brandLogo.src = isLight ? './logo-preta.png' : './logo-branca.png';
    }
    
    // Alterna o texto do botão
    btnTheme.textContent = isLight ? 'Modo Claro' : 'Modo Escuro';
  });
}