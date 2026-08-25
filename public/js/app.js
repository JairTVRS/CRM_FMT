// FONTE ÚNICA DA VERDADE DA VERSÃO DO SISTEMA
const APP_VERSION = 'v2.5.19';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Atualiza a versão exibida no rodapé
  const versionSpan = document.getElementById('app-version');
  if (versionSpan) {
    versionSpan.textContent = APP_VERSION;
  }
});

// 2. Escuta de cliques globais (garante o clique mesmo se o botão recarregar na tela)
document.addEventListener('click', (event) => {
  // Verifica se o clique foi no botão de tema ou em texto dentro dele
  const btnTheme = event.target.closest('#btn-theme, .topbar-btn, button[onclick*="theme"]');
  
  if (btnTheme && (btnTheme.textContent.includes('Modo Claro') || btnTheme.textContent.includes('Modo Escuro'))) {
    event.preventDefault();
    
    // Alterna a classe de tema claro
    document.body.classList.toggle('light-theme');
    document.documentElement.classList.toggle('light-theme');
    
    const isLight = document.body.classList.contains('light-theme');

    // Troca o texto do botão
    btnTheme.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';

    // Procura e alterna todas as imagens de logo do sistema
    const brandLogos = document.querySelectorAll('#brand-logo, .brand img, .brand-img');
    brandLogos.forEach(logo => {
      logo.src = isLight ? 'logo-preta.png' : 'logo-branca.png';
    });
  }
});