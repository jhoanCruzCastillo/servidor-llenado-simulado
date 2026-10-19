/**
 * Prueba de la pausa por preguntas (estado «esperando_datos») SIN gastar cuota, con dos motores:
 *   - IA simulada (responde con «preguntas» en su JSON), y
 *   - Claude Code falso (scripts/claude-falso.js) que llama a la herramienta MCP `pedir_datos` de verdad, pasando por el servidor MCP y el Excel.
 *
 * Comprueba, para cada motor: que se pausa con preguntas · que responder reanuda y la respuesta llega a la ficha · que «omitir» continúa sin repetir
 * la pregunta · que cancelar en pausa funciona · que sin `puede_preguntar` nunca se pausa · las validaciones de /respuestas · y que la pausa
 * sobrevive a un reinicio del servidor.
 *
 *   npm run probar:preguntas -- <paquete.zip>
 */
import AdmZip from 'adm-zip';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const paquete = process.argv[2] ?? 'ejemplos/paquete_entrada_ejemplo_fte-cuidado-diurno.zip';
const PUERTO = 8093;
const base = `http://localhost:${PUERTO}`;
const H = { Authorization: 'Bearer prueba' };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SIMULACION = { secciones: ['01'], preguntar_en: ['01'] };

let fallos = 0;
const verificar = (nombre, ok, detalle = '') => {
  if (!ok) fallos++;
  console.log(`  ${ok ? '✔' : '✘'} ${nombre}${!ok && detalle ? `\n      ${detalle}` : ''}`);
  return ok;
};

/** Levanta el servidor con el motor pedido sobre una carpeta de datos (se puede reutilizar para probar el reinicio). */
async function levantar(motor, datos) {
  const env = { ...process.env, PUERTO: String(PUERTO), URL_PUBLICA: base, SERVIDOR_TOKEN: 'prueba', DATA_DIR: datos, SIMULADA_DEMORA_MS: '30', REINTENTOS: '1', FALSO_CONTADOR: join(datos, 'contador.txt') };
  if (motor === 'simulada') env.IA = 'simulada';
  else Object.assign(env, { IA: 'claude', CLAUDE_BIN: process.execPath, CLAUDE_BIN_ARGS: resolve('scripts/claude-falso.js'), FALSO_PREGUNTAR: '1' });
  let log = '';
  const srv = spawn(process.execPath, ['src/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/v1/salud`)).ok) break; } catch { /* arrancando */ } await dormir(200); }
  return { log: () => log, parar: async () => { srv.kill(); await dormir(400); } };
}

async function enviar(metadata) {
  const form = new FormData();
  form.append('paquete', new Blob([readFileSync(paquete)]), 'p.zip');
  form.append('metadata', JSON.stringify(metadata));
  const r = await fetch(`${base}/v1/trabajos`, { method: 'POST', headers: H, body: form });
  return (await r.json()).trabajo_id;
}
const estado = async (id) => (await fetch(`${base}/v1/trabajos/${id}`, { headers: H })).json();
async function esperar(id, quiere, segundos = 90) {
  let e;
  for (let i = 0; i < segundos * 4; i++) {
    e = await estado(id);
    if (quiere.includes(e.estado)) return e;
    if (['completado', 'error', 'cancelado'].includes(e.estado)) return e; // terminó por otro camino
    await dormir(250);
  }
  return e;
}
const responder = (id, cuerpo) => fetch(`${base}/v1/trabajos/${id}/respuestas`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
async function respuestaJson(e) {
  const buf = Buffer.from(await (await fetch(e.resultado.url)).arrayBuffer());
  const entrada = new AdmZip(buf).getEntries().find((x) => x.entryName.endsWith('respuesta.json'));
  return JSON.parse(entrada.getData().toString('utf8'));
}
const valorDe = (resp, campoId) => resp.secciones.flatMap((s) => s.campos).find((c) => c.id === campoId)?.valor_propuesto ?? null;

async function probarMotor(motor) {
  console.log(`\n── Motor: ${motor === 'simulada' ? 'IA simulada' : 'Claude Code falso (herramienta MCP pedir_datos)'} ──`);
  const datos = mkdtempSync(join(tmpdir(), 'pf-preguntas-'));
  let s = await levantar(motor, datos);
  try {
    // 1. Se pausa con preguntas, sin resultado.
    let id = await enviar({ puede_preguntar: true, simulacion: SIMULACION });
    let e = await esperar(id, ['esperando_datos']);
    if (!verificar('se pausa en «esperando_datos»', e.estado === 'esperando_datos', `estado=${e.estado} mensaje=${e.mensaje} error=${JSON.stringify(e.error)}\n${s.log().slice(-500)}`)) return;
    let q = e.preguntas[0];
    verificar('trae preguntas con id, texto y campo', e.preguntas.length >= 1 && /^q\d+$/.test(q.id) && q.pregunta.length > 3 && Array.isArray(q.campo_ids) && q.campo_ids.length >= 1, JSON.stringify(e.preguntas));
    verificar('sin resultado y por debajo de 100%', e.resultado === null && e.porcentaje < 100, `porcentaje=${e.porcentaje}`);
    verificar('cuenta la pausa', e.pausas === 1);

    // 2. Validaciones del endpoint.
    let     r = await responder(id, { respuestas: [] });
    verificar('sin respuestas ni omitir ni texto → 422 faltan_respuestas', r.status === 422 && (await r.json()).error.codigo === 'faltan_respuestas');
    r = await responder(id, { texto: 'Material de prueba: el dato pedido está en este texto.' });
    verificar('texto libre (sin respuestas campo a campo) → 202', r.status === 202);
    e = await esperar(id, ['completado', 'esperando_datos', 'error']);
    verificar('con texto el trabajo sale de la pausa', e.estado !== 'esperando_datos', `estado=${e.estado}`);

    id = await enviar({ puede_preguntar: true, simulacion: SIMULACION });
    e = await esperar(id, ['esperando_datos']);
    if (!verificar('segunda pausa para el resto de la prueba', e.estado === 'esperando_datos' && e.preguntas?.[0], `estado=${e.estado}`)) return;
    q = e.preguntas[0];
    r = await responder(id, { respuestas: [{ id: 'q999', respuesta: 'x' }] });
    verificar('pregunta inexistente → 400', r.status === 400);
    verificar('sigue pausado tras los rechazos', (await estado(id)).estado === 'esperando_datos');

    // 3. Reinicio del servidor: la pausa sobrevive (todo está en disco).
    await s.parar();
    s = await levantar(motor, datos);
    e = await estado(id);
    verificar('la pausa sobrevive a un reinicio del servidor', e.estado === 'esperando_datos' && e.preguntas.length >= 1 && e.preguntas[0].id === q.id, `estado=${e.estado}`);

    // 4. Responder reanuda y el dato llega a la ficha. Si el campo es de catálogo, la respuesta debe ser una de sus opciones (si no, el validador la
    //    descarta: es la protección de siempre). Para distinguirla del valor que el motor pone por defecto, se mide antes con un trabajo SIN preguntas.
    const idBase = await enviar({ simulacion: SIMULACION });
    const eBase = await esperar(idBase, ['completado']);
    const BASE = eBase.estado === 'completado' ? valorDe(await respuestaJson(eBase), q.campo_ids[0]) : null;
    const RESP = q.opciones.length ? (q.opciones.find((o) => o !== BASE) ?? q.opciones[0]) : 'Respuesta de prueba';
    verificar('la pregunta de un campo de catálogo lleva sus opciones', q.opciones.length === 0 || q.opciones.includes(RESP), JSON.stringify(q.opciones).slice(0, 200));
    r = await responder(id, { respuestas: e.preguntas.map((p, k) => ({ id: p.id, respuesta: k === 0 ? RESP : 'dato de prueba' })) });
    const eResp = await r.json();
    verificar('POST /respuestas → 202 y vuelve a la cola', r.status === 202 && ['en_cola', 'procesando'].includes(eResp.estado), `status=${r.status} estado=${eResp.estado}`);
    verificar('el porcentaje no baja al reanudar', eResp.porcentaje >= e.porcentaje, `antes=${e.porcentaje} después=${eResp.porcentaje}`);
    e = await esperar(id, ['completado']);
    if (verificar('termina «completado» tras responder', e.estado === 'completado' && e.porcentaje === 100, `estado=${e.estado} error=${JSON.stringify(e.error)}\n${s.log().slice(-600)}`)) {
      const resp = await respuestaJson(e);
      verificar('la respuesta de la persona llegó al campo de la ficha', valorDe(resp, q.campo_ids[0]) === RESP, `valor=${valorDe(resp, q.campo_ids[0])} · advertencias: ${JSON.stringify(e.advertencias.filter((a) => String(a.identificador).includes(q.campo_ids[0]) || /01/.test(String(a.identificador))).slice(0, 3))}`);
      verificar('no se repitió la pausa', e.pausas === 1, `pausas=${e.pausas}`);
    }
    r = await responder(id, { respuestas: [] });
    verificar('responder a un trabajo que no está pausado → 409', r.status === 409);

    // 5. «Aplicar lo disponible»: omitir continúa sin ese dato y sin volver a preguntar.
    id = await enviar({ puede_preguntar: true, simulacion: SIMULACION });
    e = await esperar(id, ['esperando_datos']);
    verificar('(omitir) se pausa', e.estado === 'esperando_datos');
    r = await responder(id, { respuestas: [], omitir_pendientes: true });
    verificar('(omitir) omitir_pendientes → 202', r.status === 202);
    e = await esperar(id, ['completado']);
    if (verificar('(omitir) termina sin repetir la pregunta', e.estado === 'completado' && e.pausas === 1, `estado=${e.estado} pausas=${e.pausas}`)) {
      const resp = await respuestaJson(e);
      verificar('(omitir) el campo no recibió una respuesta inventada', valorDe(resp, q.campo_ids[0]) !== RESP);
    }

    // 6. Cancelar estando en pausa.
    id = await enviar({ puede_preguntar: true, simulacion: SIMULACION });
    e = await esperar(id, ['esperando_datos']);
    r = await fetch(`${base}/v1/trabajos/${id}/cancelar`, { method: 'POST', headers: H });
    e = await r.json();
    verificar('cancelar en pausa → «cancelado» sin preguntas', e.estado === 'cancelado' && e.preguntas.length === 0, `estado=${e.estado}`);

    // 7. Sin puede_preguntar el trabajo nunca se pausa (compatibilidad con la plataforma actual).
    id = await enviar({ simulacion: SIMULACION });
    e = await esperar(id, ['esperando_datos']);
    verificar('sin puede_preguntar nunca se pausa y completa', e.estado === 'completado' && e.pausas === 0, `estado=${e.estado} pausas=${e.pausas} error=${JSON.stringify(e.error)}`);
    verificar('el estado trae «preguntas» vacío', Array.isArray(e.preguntas) && e.preguntas.length === 0);

    // 8. max_pausas = 0 equivale a no permitir preguntas.
    id = await enviar({ puede_preguntar: true, max_pausas: 0, simulacion: SIMULACION });
    e = await esperar(id, ['esperando_datos']);
    verificar('max_pausas: 0 → no se pausa', e.estado === 'completado' && e.pausas === 0, `estado=${e.estado}`);
  } finally {
    await s.parar();
    rmSync(datos, { recursive: true, force: true }); // carpeta temporal creada por este mismo script
  }
}

await probarMotor('simulada');
await probarMotor('claude-falso');
console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : '\nTodas las comprobaciones pasaron.');
process.exit(fallos ? 1 : 0);
