/**
 * Webhook opcional (contrato 01 §6): al terminar un trabajo con `callback_url`, POST del mismo objeto de estado
 * firmado con HMAC-SHA256 (cabecera X-Firma-Sha256). Reintenta con espera creciente; la plataforma no depende de recibirlo.
 */
import { createHmac } from 'node:crypto';
import { config } from './config.js';
import { aEstado } from './store.js';

const ESPERAS_MS = [10_000, 60_000, 300_000, 1_800_000];

export async function notificar(t) {
  if (!t.callback_url) return;
  const cuerpo = JSON.stringify(aEstado(t));
  const firma = createHmac('sha256', config.webhookSecreto).update(cuerpo).digest('hex');
  for (let i = 0; i <= ESPERAS_MS.length; i++) {
    try {
      const r = await fetch(t.callback_url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firma-Sha256': firma }, body: cuerpo, signal: AbortSignal.timeout(15_000) });
      if (r.ok) return;
      console.warn(`[${t.id}] webhook respondió ${r.status}`);
    } catch (e) {
      console.warn(`[${t.id}] webhook falló: ${e.message}`);
    }
    if (i < ESPERAS_MS.length) await new Promise((res) => setTimeout(res, ESPERAS_MS[i]));
  }
}
