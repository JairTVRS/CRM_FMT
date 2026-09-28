/**
 * Worker da importação diária dos prospects do ERP (2.33.0).
 *
 * Só dá a hora: o Cron Trigger dispara `scheduled`, que chama o CRM. A
 * importação em si — ler o hub, não duplicar, não trazer de volta quem
 * foi excluído — mora no CRM (`functions/api/_lib/prospects.js`).
 *
 * O CRM reconhece esta chamada pelo cabeçalho X-Cron-Secret, comparado
 * com o CRON_SECRET dele. Sem o segredo aqui, o Worker não chama nada.
 */

async function chamarCrm(env) {
  if (!env.CRON_SECRET) {
    console.log('[prospects] sem CRON_SECRET: nada a fazer');
    return;
  }
  const resposta = await fetch(`${env.CRM_URL}/api/prospects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': env.CRON_SECRET },
    body: '{}'
  });
  // O resumo vai para o log do Worker (painel → Workers → Logs).
  console.log(`[prospects] ${resposta.status} ${(await resposta.text()).slice(0, 500)}`);
}

export default {
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(chamarCrm(env));
  },

  // Abrir o endereço do Worker no navegador não dispara nada.
  async fetch() {
    return new Response('Importação diária dos prospects do CRM Formatar. Roda às 06:00 (Brasília).', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};
