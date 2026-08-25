document.addEventListener('DOMContentLoaded', () => {
  console.log('App Formatar inicializado.');

  const btnTheme = document.getElementById('btn-theme');
  const btnLogout = document.getElementById('btn-logout');

  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (confirm('Deseja realmente sair?')) {
        window.location.href = '/login';
      }
    });
  }
});