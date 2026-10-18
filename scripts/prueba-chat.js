/**
 * Prueba de los endpoints del chat SIN gastar cuota: levanta el servidor con el Claude Code falso (scripts/claude-falso.js)
 * y recorre el flujo completo: crear, enviar con streaming (SSE), reanudar, sesión perdida, regenerar, error, cancelar, concurrencia, CORS.
 *   npm run probar:chat
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PUERTO = 8093;
const base = `http://localhost:${PUERTO}`;
const H = { Authorization: 'Bearer prueba', 'Content-Type': 'application/json' };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const ok = (cond, texto, detalle = '') => { if (!cond) fallos++; console.log(`${cond ? '✔' : '✘'} ${texto}${!cond && detalle ? `  → ${detalle}` : ''}`); };

async function conServidor(env, fn) {
  const datos = mkdtempSync(join(tmpdir(), 'pf-chat-'));
  let log = '';
  const srv = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, IA: 'claude', CLAUDE_BIN: process.execPath, CLAUDE_BIN_ARGS: resolve('scripts/claude-falso.js'), PUERTO: String(PUERTO), URL_PUBLICA: base, SERVIDOR_TOKEN: 'prueba', DATA_DIR: datos, FALSO_CONTADOR: join(datos, 'c.txt'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/v1/salud`)).ok) break; } catch { /* arrancando */ } await dormir(200); }
    await fn();
  } finally {
    srv.kill();
    await dormir(300);
    rmSync(datos, { recursive: true, force: true }); // carpeta temporal creada por este mismo script
  }
}

const api = (ruta, opciones = {}) => fetch(`${base}${ruta}`, { headers: H, ...opciones });
const json = async (ruta, opciones) => { const r = await api(ruta, opciones); return { status: r.status, cuerpo: r.status === 204 ? null : await r.json() }; };

/** Envía un mensaje y lee el SSE completo. Con `cortarTras` (ms) cancela la petición a medias. */
async function enviar(id, contenido, { ruta = 'mensajes', cuerpo, cortarTras } = {}) {
  const ctl = new AbortController();
  const r = await api(`/v1/chat/conversaciones/${id}/${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo ?? { contenido }), signal: ctl.signal });
  if (!r.ok) return { status: r.status, error: (await r.json()).error, eventos: [] };
  if (cortarTras) setTimeout(() => ctl.abort(), cortarTras);
  const eventos = [];
  let buf = '';
  try {
    const rd = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const bloque = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(bloque)?.[1];
        const datos = /^data: (.+)$/m.exec(bloque)?.[1];
        if (ev) eventos.push({ ev, datos: JSON.parse(datos) });
      }
    }
  } catch { /* cortado a propósito */ }
  return { status: r.status, eventos };
}
const texto = (r) => r.eventos.filter((e) => e.ev === 'delta').map((e) => e.datos.texto).join('');

// ───────────────────────────────────────────────────────────────────────────────
console.log('── Flujo principal');
await conServidor({}, async () => {
  ok((await fetch(`${base}/v1/chat/conversaciones`)).status === 401, 'sin token → 401');

  const pre = await fetch(`${base}/v1/chat/conversaciones`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'http://localhost:5173' && /authorization/i.test(pre.headers.get('access-control-allow-headers')), 'CORS: preflight de localhost:5173 permitido');
  const pre2 = await fetch(`${base}/v1/chat/conversaciones`, { method: 'OPTIONS', headers: { Origin: 'https://otro-sitio.com' } });
  ok(!pre2.headers.get('access-control-allow-origin'), 'CORS: un origen no listado no recibe permiso');

  const mod = await json('/v1/chat/modelos');
  ok(mod.status === 200 && mod.cuerpo.modelos.some((m) => m.id === 'sonnet'), 'GET modelos');
  ok((await json('/v1/chat/conversaciones', { method: 'POST', body: JSON.stringify({ modelo: 'gpt-9' }) })).status === 400, 'modelo inválido → 400');

  const c = await json('/v1/chat/conversaciones', { method: 'POST', body: '{}' });
  const id = c.cuerpo.id;
  ok(c.status === 201 && /^cnv_/.test(id), 'crear conversación', JSON.stringify(c.cuerpo));

  const r1 = await enviar(id, 'Hola, ¿qué tal?');
  const fin1 = r1.eventos.find((e) => e.ev === 'fin');
  ok(r1.eventos[0]?.ev === 'inicio', 'SSE: primer evento «inicio»');
  ok(r1.eventos.filter((e) => e.ev === 'delta').length >= 5, 'SSE: llegan varios «delta» (streaming real)', String(r1.eventos.length));
  ok(fin1 && texto(r1) === fin1.datos.mensaje.contenido, 'SSE: «fin» trae el mismo texto que los deltas concatenados');
  ok(/Hola, ¿qué tal\?/.test(texto(r1)), 'el servidor pasó el mensaje a Claude');

  const lista = await json('/v1/chat/conversaciones');
  ok(lista.cuerpo.conversaciones[0]?.titulo === 'Hola, ¿qué tal?', 'título automático desde el primer mensaje', lista.cuerpo.conversaciones[0]?.titulo);

  const r2 = await enviar(id, 'Segundo mensaje');
  ok(/sesión reanudada/.test(texto(r2)), 'segundo mensaje reanuda la sesión de Claude (--resume)');

  const reg = await enviar(id, '', { ruta: 'regenerar', cuerpo: {} });
  ok(/historial reconstruido/.test(texto(reg)), 'regenerar: responde de nuevo reconstruyendo el historial');
  let conv = (await json(`/v1/chat/conversaciones/${id}`)).cuerpo;
  ok(conv.mensajes.length === 4 && conv.mensajes.at(-1).rol === 'asistente', 'regenerar reemplaza la última respuesta (4 mensajes)', String(conv.mensajes.length));

  const err = await enviar(id, 'esto falla [[error]]');
  ok(err.eventos.some((e) => e.ev === 'error' && e.datos.reintentable), 'error de Claude → evento «error» reintentable');
  conv = (await json(`/v1/chat/conversaciones/${id}`)).cuerpo;
  ok(conv.mensajes.at(-1).rol === 'usuario', 'tras el error queda el mensaje de la persona sin respuesta');
  const pend = await enviar(id, 'otro');
  ok(pend.status === 409 && pend.error.codigo === 'respuesta_pendiente', 'enviar con respuesta pendiente → 409 (hay que regenerar)');

  const p = await json(`/v1/chat/conversaciones/${id}`, { method: 'PATCH', body: JSON.stringify({ titulo: 'Renombrada', modelo: 'haiku' }) });
  ok(p.cuerpo.titulo === 'Renombrada' && p.cuerpo.modelo === 'haiku', 'renombrar y cambiar modelo (PATCH)');
  ok((await json(`/v1/chat/conversaciones/${id}`, { method: 'DELETE' })).status === 204 && (await json(`/v1/chat/conversaciones/${id}`)).status === 404, 'borrar conversación');
});

console.log('\n── Cancelar a media respuesta');
await conServidor({ FALSO_RITMO_MS: '40' }, async () => {
  const id = (await json('/v1/chat/conversaciones', { method: 'POST', body: '{}' })).cuerpo.id;
  await enviar(id, 'cuéntame todo [[largo]]', { cortarTras: 1200 });
  await dormir(800);
  const conv = (await json(`/v1/chat/conversaciones/${id}`)).cuerpo;
  const ult = conv.mensajes.at(-1);
  ok(ult?.rol === 'asistente' && ult.interrumpido === true && ult.contenido.length > 20, 'al cortar la conexión se guarda lo generado como «interrumpido»', JSON.stringify(ult)?.slice(0, 160));
  ok(conv.session_id === null, 'tras interrumpir se descarta la sesión de Claude (el historial la reconstruye)');
  const siguiente = await enviar(id, 'sigue');
  ok(siguiente.eventos.some((e) => e.ev === 'fin') && /historial reconstruido/.test(texto(siguiente)), 'se puede seguir conversando después de interrumpir');
});

console.log('\n── Sesión de Claude perdida (p. ej. tras un redespliegue sin volumen)');
await conServidor({ FALSO_SESION_PERDIDA: '1' }, async () => {
  const id = (await json('/v1/chat/conversaciones', { method: 'POST', body: '{}' })).cuerpo.id;
  await enviar(id, 'primero');
  const r = await enviar(id, 'segundo');
  ok(r.eventos.some((e) => e.ev === 'fin') && /historial reconstruido/.test(texto(r)), 'si --resume falla, se reintenta con el historial y la persona no ve el error');
});

console.log('\n── Concurrencia');
await conServidor({ FALSO_RITMO_MS: '40', CHAT_CONCURRENCIA: '1' }, async () => {
  const a = (await json('/v1/chat/conversaciones', { method: 'POST', body: '{}' })).cuerpo.id;
  const b = (await json('/v1/chat/conversaciones', { method: 'POST', body: '{}' })).cuerpo.id;
  const larga = enviar(a, 'larga [[largo]]', { cortarTras: 1500 });
  await dormir(400);
  const otra = await enviar(b, 'hola');
  ok(otra.status === 429 && otra.error.codigo === 'servidor_ocupado', 'con el límite alcanzado, otra conversación recibe 429');
  const mismaConv = await enviar(a, 'doble');
  ok(mismaConv.status === 409, 'la misma conversación no admite dos respuestas a la vez (409)');
  await larga;
  ok((await json(`/v1/chat/conversaciones/${b}`)).cuerpo.mensajes.length === 0, 'el 429 no deja mensajes huérfanos en la conversación rechazada');
});

console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : '\nTodo el chat se comporta como se espera.');
process.exit(fallos ? 1 : 0);
