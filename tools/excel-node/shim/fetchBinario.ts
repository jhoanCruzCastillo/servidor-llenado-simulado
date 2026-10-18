import { existsSync, readFileSync } from 'node:fs';

/** Sustituto en Node de frontend/src/lib/fetchBinario.ts: `fuente` es un data URI o la ruta de un archivo local. */
export async function fetchBinarioOrFalla(fuente: string, init: RequestInit = {}): Promise<Response> {
  if (fuente.startsWith('data:') || /^https?:/i.test(fuente)) {
    const r = await fetch(fuente, init);
    if (!r.ok) throw new Error(`No se pudo leer el Excel (${r.status}).`);
    return r;
  }
  if (!existsSync(fuente)) throw new Error(`No existe el archivo ${fuente}.`);
  return new Response(readFileSync(fuente));
}
