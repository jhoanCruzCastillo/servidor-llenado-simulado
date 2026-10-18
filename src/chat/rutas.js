/**
 * Endpoints del chat de prueba (todos exigen el token Bearer, igual que el resto de /v1):
 *
 *   GET    /v1/chat/modelos
 *   GET    /v1/chat/conversaciones                         lista (sin mensajes)
 *   POST   /v1/chat/conversaciones          {titulo?, modelo?}
 *   GET    /v1/chat/conversaciones/:id                     con todos sus mensajes
 *   PATCH  /v1/chat/conversaciones/:id      {titulo?, modelo?}
 *   DELETE /v1/chat/conversaciones/:id
 *   POST   /v1/chat/conversaciones/:id/mensajes   {contenido, modelo?}   → respuesta en streaming (SSE)
 *   POST   /v1/chat/conversaciones/:id/regenerar  {modelo?}              → vuelve a responder al último mensaje (SSE)
 *
 * SSE: Content-Type text/event-stream; eventos `inicio`, `delta` {texto}, `fin` {mensaje, conversacion}, `error` {codigo, mensaje, reintentable}.
 * Si el cliente corta la conexión, se detiene Claude y lo ya generado se guarda como respuesta «interrumpida».
 */
import { config } from '../config.js';
import { ErrorIA } from '../ia/claude.js';
import * as almacen from './almacen.js';
import { generar, modeloValido, MODELOS } from './claudeChat.js';

const MAX_MENSAJE = 20_000;
const activos = new Set(); // conversaciones con una respuesta en curso

const json = (res, codigo, cuerpo) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(cuerpo));
};
const fallo = (res, http, codigo, mensaje, extra = {}) => {
  res.writeHead(http, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify({ error: { codigo, mensaje, detalle: null } }));
};

async function leerJson(req, max = 1_000_000) {
  let tam = 0;
  const trozos = [];
  for await (const t of req) {
    tam += t.length;
    if (tam > max) throw Object.assign(new Error('Cuerpo demasiado grande.'), { http: 413 });
    trozos.push(t);
  }
  if (tam === 0) return {};
  try {
    return JSON.parse(Buffer.concat(trozos).toString('utf8'));
  } catch {
    throw Object.assign(new Error('El cuerpo no es un JSON válido.'), { http: 400 });
  }
}

/** Comprueba, ANTES de modificar la conversación, que se puede generar ahora. Responde el error y devuelve false si no. */
function hayCapacidad(res, conv) {
  if (activos.has(conv.id)) { fallo(res, 409, 'respuesta_en_curso', 'Esta conversación ya está generando una respuesta.'); return false; }
  if (activos.size >= config.chatConcurrencia) { fallo(res, 429, 'servidor_ocupado', 'Hay demasiadas respuestas en curso. Intenta de nuevo en unos segundos.', { 'Retry-After': '5' }); return false; }
  return true;
}

/** Responde a la última entrada de la conversación por SSE. `reiniciar`: no reanudar la sesión de Claude (regenerar). */
async function responder(req, res, conv, { modelo, reiniciar }) {
  activos.add(conv.id);

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const sse = (evento, datos) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`); };
  const latido = setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n'); }, 15_000);

  const ctl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctl.abort(); });

  let parcial = '';
  try {
    sse('inicio', { conversacion: almacen.resumen(conv), modelo });
    const r = await generar({
      mensajes: conv.mensajes,
      sessionId: conv.session_id,
      modelo,
      reiniciar,
      signal: ctl.signal,
      onDelta: (texto) => { parcial += texto; sse('delta', { texto }); },
    });
    const m = almacen.nuevoMensaje('asistente', r.texto, { modelo, uso: r.uso });
    conv.mensajes.push(m);
    conv.session_id = r.sessionId ?? conv.session_id;
    almacen.guardar(conv);
    sse('fin', { mensaje: m, conversacion: almacen.resumen(conv) });
  } catch (e) {
    if (e instanceof ErrorIA && e.codigo === 'cancelado') {
      const texto = (e.parcial || parcial).trim();
      if (texto) {
        conv.mensajes.push(almacen.nuevoMensaje('asistente', texto, { modelo, interrumpido: true }));
        conv.session_id = null; // la sesión de Claude no vio esa respuesta cortada: se reconstruye con el historial
        almacen.guardar(conv);
      }
    } else {
      const ia = e instanceof ErrorIA;
      console.error('[chat] error:', ia ? `${e.codigo}: ${e.message}` : e);
      sse('error', { codigo: ia ? e.codigo : 'interno', mensaje: ia ? e.message : 'Fallo inesperado al generar la respuesta.', reintentable: ia ? e.reintentable : true });
    }
  } finally {
    clearInterval(latido);
    activos.delete(conv.id);
    if (!res.writableEnded) res.end();
  }
}

/** @returns {Promise<boolean>} true si la ruta era del chat (y ya se respondió) */
export async function manejarChat(req, res, ruta) {
  let m;
  if (!ruta.startsWith('/v1/chat/')) return false;

  try {
    if (req.method === 'GET' && ruta === '/v1/chat/modelos') {
      json(res, 200, { modelos: MODELOS, predeterminado: config.claude.modelo });
      return true;
    }

    if (ruta === '/v1/chat/conversaciones') {
      if (req.method === 'GET') { json(res, 200, { conversaciones: almacen.listar() }); return true; }
      if (req.method === 'POST') {
        const b = await leerJson(req);
        const modelo = b.modelo ?? config.claude.modelo;
        if (!modeloValido(modelo)) { fallo(res, 400, 'modelo_invalido', `Modelo no válido: ${modelo}.`); return true; }
        json(res, 201, almacen.crear({ titulo: typeof b.titulo === 'string' ? b.titulo.trim() : '', modelo }));
        return true;
      }
    }

    if ((m = /^\/v1\/chat\/conversaciones\/(cnv_[0-9a-f]{12})(\/mensajes|\/regenerar)?$/.exec(ruta))) {
      const conv = almacen.obtener(m[1]);
      if (!conv) { fallo(res, 404, 'conversacion_no_encontrada', 'La conversación no existe.'); return true; }

      if (!m[2]) {
        if (req.method === 'GET') { json(res, 200, conv); return true; }
        if (req.method === 'DELETE') { almacen.eliminar(conv.id); res.writeHead(204); res.end(); return true; }
        if (req.method === 'PATCH') {
          const b = await leerJson(req);
          if (typeof b.titulo === 'string' && b.titulo.trim()) { conv.titulo = b.titulo.trim().slice(0, 120); conv.tituloAutomatico = false; }
          if (b.modelo !== undefined) {
            if (!modeloValido(b.modelo)) { fallo(res, 400, 'modelo_invalido', `Modelo no válido: ${b.modelo}.`); return true; }
            conv.modelo = b.modelo;
          }
          json(res, 200, almacen.guardar(conv));
          return true;
        }
      }

      if (req.method === 'POST' && m[2] === '/mensajes') {
        const b = await leerJson(req);
        const contenido = typeof b.contenido === 'string' ? b.contenido.trim() : '';
        if (!contenido) { fallo(res, 400, 'mensaje_vacio', 'El mensaje está vacío.'); return true; }
        if (contenido.length > MAX_MENSAJE) { fallo(res, 413, 'mensaje_muy_largo', `El mensaje supera ${MAX_MENSAJE} caracteres.`); return true; }
        const modelo = b.modelo ?? conv.modelo ?? config.claude.modelo;
        if (!modeloValido(modelo)) { fallo(res, 400, 'modelo_invalido', `Modelo no válido: ${modelo}.`); return true; }
        if (!hayCapacidad(res, conv)) return true;
        if (conv.mensajes.at(-1)?.rol === 'usuario') { fallo(res, 409, 'respuesta_pendiente', 'El último mensaje no tiene respuesta: usa «regenerar».'); return true; }

        conv.mensajes.push(almacen.nuevoMensaje('usuario', contenido));
        conv.modelo = modelo;
        if (conv.tituloAutomatico && conv.mensajes.length === 1) conv.titulo = almacen.tituloDesde(contenido);
        almacen.guardar(conv);
        await responder(req, res, conv, { modelo, reiniciar: false });
        return true;
      }

      if (req.method === 'POST' && m[2] === '/regenerar') {
        const b = await leerJson(req);
        const modelo = b.modelo ?? conv.modelo ?? config.claude.modelo;
        if (!modeloValido(modelo)) { fallo(res, 400, 'modelo_invalido', `Modelo no válido: ${modelo}.`); return true; }
        if (!hayCapacidad(res, conv)) return true;
        if (conv.mensajes.at(-1)?.rol === 'asistente') conv.mensajes.pop(); // se descarta la respuesta anterior
        if (conv.mensajes.at(-1)?.rol !== 'usuario') { fallo(res, 409, 'nada_que_regenerar', 'No hay un mensaje de la persona al que responder.'); return true; }
        conv.session_id = null; // la sesión de Claude ya contiene la respuesta descartada: se reconstruye con el historial
        conv.modelo = modelo;
        almacen.guardar(conv);
        await responder(req, res, conv, { modelo, reiniciar: true });
        return true;
      }
    }
  } catch (e) {
    if (!res.headersSent) fallo(res, e.http ?? 500, e.http ? 'solicitud_invalida' : 'interno', e.message);
    else res.end();
    return true;
  }

  fallo(res, 404, 'no_encontrado', 'Ruta desconocida.');
  return true;
}
