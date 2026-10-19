/**
 * Endpoints del chat de prueba (todos exigen el token Bearer, igual que el resto de /v1):
 *
 *   GET    /v1/chat/modelos
 *   GET    /v1/chat/conversaciones                         lista (sin mensajes)
 *   POST   /v1/chat/conversaciones          {titulo?, modelo?}
 *   GET    /v1/chat/conversaciones/:id                     con todos sus mensajes
 *   PATCH  /v1/chat/conversaciones/:id      {titulo?, modelo?}
 *   DELETE /v1/chat/conversaciones/:id
 *   POST   /v1/chat/conversaciones/:id/archivos?nombre=…   cuerpo = bytes del archivo (cualquier formato)  → metadatos del adjunto
 *   GET    /v1/chat/conversaciones/:id/archivos/:archivoId  descarga el archivo
 *   DELETE /v1/chat/conversaciones/:id/archivos/:archivoId  quita un adjunto que aún no se envió
 *   POST   /v1/chat/conversaciones/:id/mensajes   {contenido, modelo?, archivos?: [ids]}   → respuesta en streaming (SSE)
 *   POST   /v1/chat/conversaciones/:id/regenerar  {modelo?}              → vuelve a responder al último mensaje (SSE)
 *   POST   /v1/chat/completar  {sistema, mensajes:[{role|rol, content|contenido}], modelo?}  → {texto} (una respuesta, sin guardar; lo usa la plataforma)
 *
 * SSE: Content-Type text/event-stream; eventos `inicio`, `delta` {texto}, `fin` {mensaje, conversacion}, `error` {codigo, mensaje, reintentable}.
 * Si el cliente corta la conexión, se detiene Claude y lo ya generado se guarda como respuesta «interrumpida».
 */
import { config } from '../config.js';
import { ErrorIA } from '../ia/claude.js';
import * as almacen from './almacen.js';
import * as archivos from './archivos.js';
import { completar, generar, modeloValido, MODELOS } from './claudeChat.js';

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
      convId: conv.id,
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
      sse('error', { codigo: ia ? e.codigo : 'interno', mensaje: ia ? e.message : 'Fallo inesperado al generar la respuesta.', reintentable: ia ? e.reintentable : true, detalle: ia ? (e.detalle ?? null) : null });
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
      json(res, 200, { modelos: MODELOS, predeterminado: config.claude.modelo, adjuntos: { max_bytes_por_archivo: archivos.MAX_ARCHIVO_BYTES, max_por_mensaje: archivos.MAX_ARCHIVOS_POR_MENSAJE } });
      return true;
    }

    // Una respuesta para la plataforma (asesor / ayuda por campo): misma Claude Code que el chat de prueba, sin guardar conversación aquí.
    if (req.method === 'POST' && ruta === '/v1/chat/completar') {
      if (config.ia !== 'claude') {
        fallo(res, 503, 'chat_no_disponible', 'El chat con Claude Code solo está activo cuando el servidor corre con IA=claude.');
        return true;
      }
      if (activos.size >= config.chatConcurrencia) {
        fallo(res, 429, 'servidor_ocupado', 'Hay demasiadas respuestas en curso. Intenta de nuevo en unos segundos.', { 'Retry-After': '5' });
        return true;
      }
      const b = await leerJson(req, 2_000_000);
      const modelo = b.modelo ?? config.claude.modelo;
      if (!modeloValido(modelo)) { fallo(res, 400, 'modelo_invalido', `Modelo no válido: ${modelo}.`); return true; }
      const mensajes = (Array.isArray(b.mensajes) ? b.mensajes : []).map((m) => ({
        rol: (m?.role === 'assistant' || m?.rol === 'asistente') ? 'asistente' : 'usuario',
        contenido: String(m?.content ?? m?.contenido ?? '').trim(),
      })).filter((m) => m.contenido);
      if (mensajes.length === 0 || mensajes.at(-1).rol !== 'usuario') {
        fallo(res, 400, 'mensaje_vacio', 'Hace falta al menos un mensaje de la persona (el último).');
        return true;
      }
      const slot = `cplt_${Date.now()}`;
      activos.add(slot);
      const ctl = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
      try {
        const r = await completar({ sistema: typeof b.sistema === 'string' ? b.sistema : '', mensajes, modelo, signal: ctl.signal });
        json(res, 200, { texto: r.texto, modelo, uso: r.uso });
      } catch (e) {
        const ia = e instanceof ErrorIA;
        console.error('[chat] completar:', ia ? `${e.codigo}: ${e.message}` : e);
        if (e instanceof ErrorIA && e.codigo === 'cancelado') {
          fallo(res, 400, 'cancelado', 'La petición se canceló.');
        } else {
          fallo(res, 502, ia ? e.codigo : 'interno', ia ? e.message : 'Fallo inesperado al generar la respuesta.');
        }
      } finally {
        activos.delete(slot);
      }
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

    if ((m = /^\/v1\/chat\/conversaciones\/(cnv_[0-9a-f]{12})(\/mensajes|\/regenerar|\/archivos(?:\/([0-9a-f]{10}))?)?$/.exec(ruta))) {
      const conv = almacen.obtener(m[1]);
      if (!conv) { fallo(res, 404, 'conversacion_no_encontrada', 'La conversación no existe.'); return true; }

      if (!m[2]) {
        if (req.method === 'GET') { json(res, 200, conv); return true; }
        if (req.method === 'DELETE') { almacen.eliminar(conv.id); archivos.borrarTodos(conv.id); res.writeHead(204); res.end(); return true; }
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

      if (m[2]?.startsWith('/archivos')) {
        conv.adjuntos ??= {};
        const aid = m[3];
        if (!aid && req.method === 'POST') {
          const url = new URL(req.url, 'http://localhost');
          const pendientes = Object.values(conv.adjuntos).filter((a) => !a.mensaje_id).length;
          if (pendientes >= archivos.MAX_ARCHIVOS_POR_MENSAJE) { fallo(res, 409, 'demasiados_archivos', `Máximo ${archivos.MAX_ARCHIVOS_POR_MENSAJE} archivos por mensaje.`); return true; }
          const a = await archivos.guardarSubida(req, conv.id, url.searchParams.get('nombre') ?? 'archivo', String(req.headers['content-type'] ?? '').split(';')[0].trim());
          const actual = almacen.obtener(conv.id) ?? conv; // otra subida en paralelo pudo guardar su adjunto mientras llegaban los bytes
          actual.adjuntos ??= {};
          actual.adjuntos[a.id] = { ...a, mensaje_id: null };
          almacen.guardar(actual);
          json(res, 201, a);
          return true;
        }
        const a = aid ? conv.adjuntos[aid] : null;
        if (aid && !a) { fallo(res, 404, 'archivo_no_encontrado', 'El archivo no existe.'); return true; }
        if (aid && req.method === 'GET') {
          if (!archivos.existeArchivo(conv.id, a)) { fallo(res, 404, 'archivo_no_encontrado', 'El archivo ya no está en el servidor.'); return true; }
          res.writeHead(200, {
            'Content-Type': a.tipo || 'application/octet-stream',
            'Content-Length': archivos.tamanoArchivo(conv.id, a),
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}`,
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(archivos.leerArchivo(conv.id, a));
          return true;
        }
        if (aid && req.method === 'DELETE') {
          if (a.mensaje_id) { fallo(res, 409, 'archivo_enviado', 'Ese archivo ya forma parte de un mensaje.'); return true; }
          archivos.borrarArchivo(conv.id, aid);
          delete conv.adjuntos[aid];
          almacen.guardar(conv);
          res.writeHead(204);
          res.end();
          return true;
        }
      }

      if (req.method === 'POST' && m[2] === '/mensajes') {
        const b = await leerJson(req);
        const contenido = typeof b.contenido === 'string' ? b.contenido.trim() : '';
        conv.adjuntos ??= {};
        const ids = Array.isArray(b.archivos) ? b.archivos.map(String) : [];
        if (ids.length > archivos.MAX_ARCHIVOS_POR_MENSAJE) { fallo(res, 400, 'demasiados_archivos', `Máximo ${archivos.MAX_ARCHIVOS_POR_MENSAJE} archivos por mensaje.`); return true; }
        const adjuntos = ids.map((id) => conv.adjuntos[id]);
        if (adjuntos.some((a) => !a || a.mensaje_id)) { fallo(res, 400, 'archivo_invalido', 'Alguno de los archivos adjuntos no existe o ya se envió en otro mensaje.'); return true; }
        if (!contenido && adjuntos.length === 0) { fallo(res, 400, 'mensaje_vacio', 'El mensaje está vacío.'); return true; }
        if (contenido.length > MAX_MENSAJE) { fallo(res, 413, 'mensaje_muy_largo', `El mensaje supera ${MAX_MENSAJE} caracteres.`); return true; }
        const modelo = b.modelo ?? conv.modelo ?? config.claude.modelo;
        if (!modeloValido(modelo)) { fallo(res, 400, 'modelo_invalido', `Modelo no válido: ${modelo}.`); return true; }
        if (!hayCapacidad(res, conv)) return true;
        if (conv.mensajes.at(-1)?.rol === 'usuario') { fallo(res, 409, 'respuesta_pendiente', 'El último mensaje no tiene respuesta: usa «regenerar».'); return true; }

        const mensajeUsuario = almacen.nuevoMensaje('usuario', contenido, adjuntos.length ? { archivos: adjuntos.map(({ mensaje_id: _, ...a }) => a) } : {});
        for (const a of adjuntos) a.mensaje_id = mensajeUsuario.id;
        conv.mensajes.push(mensajeUsuario);
        conv.modelo = modelo;
        if (conv.tituloAutomatico && conv.mensajes.length === 1) conv.titulo = almacen.tituloDesde(contenido || adjuntos[0]?.nombre || '');
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
    if (!res.headersSent) fallo(res, e.http ?? 500, e.codigo ?? (e.http ? 'solicitud_invalida' : 'interno'), e.message);
    else res.end();
    return true;
  }

  fallo(res, 404, 'no_encontrado', 'Ruta desconocida.');
  return true;
}
