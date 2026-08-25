document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('form-configuracoes');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const configData = {
        openai: document.getElementById('api-openai').value,
        anthropic: document.getElementById('api-anthropic').value,
        google: document.getElementById('api-google').value,
        deepseek: document.getElementById('api-deepseek').value,
        groq: document.getElementById('api-groq').value,
        ollama: document.getElementById('api-ollama').value,
      };

      console.log('Salvando configurações:', configData);
      alert('Chaves de API salvas com sucesso!');
    });
  }
});