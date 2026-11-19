/**
 * Porta do dublê do hub (dev/hub-stub.mjs), num lugar só.
 *
 * O dublê e as provas que o sobem importam daqui, para que nunca fiquem
 * cada um numa porta. O padrão é 8787; quando outro processo já estiver
 * nela (um `wrangler dev` de outro projeto, por exemplo), rode com outra:
 *
 *   PowerShell:  $env:HUB_STUB_PORTA = "8797"; npm run prova
 *   Bash:        HUB_STUB_PORTA=8797 npm run prova
 *
 * Para o `npm run dev:hub` manual, ajuste também o HUB_BASE_URL /
 * HUB_USERS_URL do .dev.vars para a mesma porta.
 */
const bruto = process.env.HUB_STUB_PORTA;

export const PORTA_HUB = bruto === undefined || bruto === '' ? 8787 : Number(bruto);

if (!Number.isInteger(PORTA_HUB) || PORTA_HUB < 1 || PORTA_HUB > 65535) {
  throw new Error(`HUB_STUB_PORTA inválida: "${bruto}". Use um número inteiro de 1 a 65535.`);
}

export const ORIGEM_HUB = `http://127.0.0.1:${PORTA_HUB}`;
export const BASE_HUB = `${ORIGEM_HUB}/v1`;
