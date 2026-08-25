document.addEventListener('DOMContentLoaded', () => {
  console.log('App Formatar inicializado.');

  const menuItems = document.querySelectorAll('.menu-item');
  const views = document.querySelectorAll('.content-body');
  const btnTheme = document.getElementById('btn-theme');
  const btnLogout = document.getElementById('btn-logout');
  const brandLogo = document.getElementById('brand-logo');

  // Alternância de Menus/Views (Navegação SPA)
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();

      // Remove classe ativa de todos os botões do menu
      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      // Oculta todas as views
      const targetId = item.getAttribute('data-target');
      views.forEach(view => {
        if (view.id === targetId) {
          view.classList.remove('hidden');
        } else {
          view.classList.add('hidden');
        }
      });

      // Atualiza a hash na URL
      window.location.hash = item.getAttribute('href');
    });
  });

  // Troca de Tema e Logomarca Dinâmica (logo-branca.png <-> logo-preta.png)
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark-theme');
      
      if (brandLogo) {
        brandLogo.src = isDark ? 'logo-preta.png' : 'logo-branca.png';
      }
    });
  }

  // Logout
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (confirm('Deseja realmente sair?')) {
        window.location.href = '/login';
      }
    });
  }
});