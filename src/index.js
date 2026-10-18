/**
 * Servidor de llenado simulado — implementa el contrato de docs/servidor-llenado-externo/01_CONTRATO_DEL_SERVIDOR.md:
 *   POST   /v1/trabajos                  (multipart: paquete=.zip, metadata=JSON opcional)   → 202 {trabajo_id}
 *   GET    /v1/trabajos/:id              estado (porcentaje, sección en curso, resultado.url al completar)
 *   POST   /v1/trabajos/:id/cancelar
 *   DELETE /v1/trabajos/:id
 *   GET    /v1/salud
 *   GET    /descargas/:id/:token/resultado.zip   (enlace «prefirmado» del resultado)
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { crearIAClaude, infoClaude, probarClaude } from './ia/claude.js';
import { crearIASimulada } from './ia/simulada.js';
import { cargarPaquete, ErrorPaquete, validarYExtraer } from './paquete.js';
import { cancelarEjecucion, ejecutar, enEjecucion } from './pipeline.js';
import { leer, tamano } from './resultado.js';
import { aEstado, ahora, buscarIdem, cargarDeDisco, dirDe, eliminar, guardar, guardarIdem, obtener, registrar, TERMINALES, todos } from './store.js';

const LIMITE_BYTES = config.limitePaqueteMB * 1024 * 1024;
// En producción no se arranca con un token débil o el de desarrollo (el servidor guarda documentos reales de clientes).
if (config.enProduccion && (config.token === 'dev-token-cambiar' || config.token.length < 16)) {
  console.error('SERVIDOR_TOKEN no está definido o es demasiado corto (mínimo 16 caracteres). Defínelo en las variables del servicio.');
  process.exit(1);
}

const ia = config.ia === 'simulada' ? crearIASimulada() : crearIAClaude();
/** Estado de Claude Code, calculado una vez al arrancar (se muestra en /v1/salud). */
let estadoIA = config.ia === 'simulada' ? { tipo: 'simulada' } : { tipo: 'claude', instalado: null };

// ── Respuestas ────────────────────────────────────────────────────────────────
const enviar = (res, codigo, cuerpo, cabeceras = {}) => {
  const datos = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', ...cabeceras });
  res.end(datos);
};
const fallo = (res, http, codigo, mensaje, detalle = null, cabeceras = {}) => enviar(res, http, { error: { codigo, mensaje, detalle } }, cabeceras);

function autorizado(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(config.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Cola de trabajos ──────────────────────────────────────────────────────────
let corriendo = 0;
function procesarCola() {
  while (corriendo < config.concurrenciaTrabajos) {
    const siguiente = todos().filter((t) => t.estado === 'en_cola').sort((a, b) => a.creado_en.localeCompare(b.creado_en))[0];
    if (!siguiente) return;
    corriendo++;
    // Pasa a «procesando» de inmediato para no tomarlo dos veces; ejecutar() fija el resto.
    siguiente.estado = 'procesando';
    ejecutar(siguiente, ia).finally(() => { corriendo--; procesarCola(); });
  }
}
function mensajeCola(t) {
  const delante = todos().filter((x) => x.estado === 'en_cola' && x.creado_en < t.creado_en).length + corriendo;
  return delante > 0 ? `En cola — posición ${delante + 1}` : 'En cola…';
}

// ── Crear trabajo ─────────────────────────────────────────────────────────────
async function leerMultipart(req) {
  const web = new Request(`http://localhost${req.url}`, { method: 'POST', headers: req.headers, body: Readable.toWeb(req), duplex: 'half' });
  return web.formData();
}

async function crearTrabajo(req, res) {
  if (!/^multipart\/form-data/i.test(req.headers['content-type'] ?? '')) return fallo(res, 415, 'tipo_no_soportado', 'Se esperaba multipart/form-data con la parte «paquete».');
  if (Number(req.headers['content-length'] ?? 0) > LIMITE_BYTES) return fallo(res, 413, 'paquete_muy_grande', `El paquete supera el límite de ${LIMITE_BYTES / 1048576} MB.`);

  const clave = req.headers['idempotency-key'];
  const previo = buscarIdem(clave) && obtener(buscarIdem(clave));
  if (previo) {
    req.resume();
    return enviar(res, 200, { trabajo_id: previo.id, estado: previo.estado, creado_en: previo.creado_en, url_estado: `${config.urlPublica}/v1/trabajos/${previo.id}` });
  }

  let form;
  try {
    form = await leerMultipart(req);
  } catch (e) {
    return fallo(res, 400, 'paquete_invalido', 'No se pudo leer el formulario multipart.', e.message);
  }
  const archivo = form.get('paquete');
  if (!archivo || typeof archivo === 'string') return fallo(res, 400, 'paquete_invalido', 'Falta la parte «paquete» (archivo .zip).');
  if (archivo.size > LIMITE_BYTES) return fallo(res, 413, 'paquete_muy_grande', `El paquete supera el límite de ${LIMITE_BYTES / 1048576} MB.`);

  let metadata = {};
  const metaTexto = form.get('metadata');
  if (typeof metaTexto === 'string' && metaTexto.trim()) {
    try {
      metadata = JSON.parse(metaTexto);
    } catch {
      return fallo(res, 400, 'paquete_invalido', '«metadata» no es un JSON válido.');
    }
  }

  const id = `trb_${randomBytes(6).toString('hex')}`;
  const dir = dirDe(id);
  mkdirSync(dir, { recursive: true });
  try {
    const rutaZip = join(dir, 'paquete.zip');
    writeFileSync(rutaZip, Buffer.from(await archivo.arrayBuffer()));
    const { rutaRaiz, manifiesto } = validarYExtraer(rutaZip, join(dir, 'p'));
    rmSync(rutaZip, { force: true }); // ya está extraído: no se guarda dos veces (el volumen es finito)
    const paq = cargarPaquete(rutaRaiz, manifiesto);

    const t = registrar({
      id,
      creado_en: ahora(),
      iniciado_en: null,
      terminado_en: null,
      estado: 'en_cola',
      cancelando: false,
      etapa: 'recibido',
      mensaje: 'En cola…',
      referencia: metadata.referencia ?? null,
      callback_url: typeof metadata.callback_url === 'string' ? metadata.callback_url : null,
      simulacion: metadata.simulacion ?? null,
      rutaRaiz,
      manifiesto,
      secciones: paq.secciones.map((s) => ({
        id: s.id, numero: s.numero, nombre: s.nombre, estado: 'pendiente',
        campos_totales: s.campos.length, campos_completados: 0, tablas_totales: s.tablas.length, tablas_completadas: 0,
      })),
      seccionActualId: null,
      advertencias: [],
      uso: {},
      error: null,
      resultado: null,
    });
    t.mensaje = mensajeCola(t);
    guardar(t);
    guardarIdem(clave, id);
    procesarCola();
    console.log(`[${id}] recibido ${manifiesto.plantilla.codigo} ficha ${manifiesto.ficha.id} · ${paq.secciones.length} secciones · ${(archivo.size / 1048576).toFixed(1)} MB`);
    return enviar(res, 202, { trabajo_id: id, estado: 'en_cola', creado_en: t.creado_en, url_estado: `${config.urlPublica}/v1/trabajos/${id}` });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    if (e instanceof ErrorPaquete) return fallo(res, e.http, e.codigo, e.message);
    console.error(e);
    return fallo(res, 500, 'interno', 'Fallo inesperado al recibir el paquete.', String(e.message));
  }
}

// ── Rutas ─────────────────────────────────────────────────────────────────────
async function manejar(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ruta = url.pathname.replace(/\/+$/, '') || '/';
  let m;

  if (req.method === 'GET' && ruta === '/v1/salud') {
    // Siempre 200 mientras el proceso viva (lo usa el healthcheck de Railway); `listo_para_llenar` dice si la IA está utilizable.
    const listo = estadoIA.tipo === 'simulada' || estadoIA.instalado === true;
    return enviar(res, 200, { ok: true, version_servidor: config.versionServidor, versiones_paquete_soportadas: config.versionesPaqueteSoportadas, ia: ia.nombre, listo_para_llenar: listo, estado_ia: estadoIA });
  }

  // Enlace de descarga del resultado: la «firma» es el token aleatorio de la URL (no lleva Authorization).
  if (req.method === 'GET' && (m = /^\/descargas\/([\w-]+)\/([0-9a-f]+)\/resultado\.zip$/.exec(ruta))) {
    const t = obtener(m[1]);
    const archivo = t && join(dirDe(t.id), 'resultado.zip');
    if (!t || t.tokenDescarga !== m[2] || !existsSync(archivo)) return fallo(res, 404, 'trabajo_no_encontrado', 'El enlace no existe.');
    if (Date.parse(t.resultado.expira_en) < Date.now()) return fallo(res, 410, 'trabajo_no_encontrado', 'El enlace expiró; consulta el estado para obtener uno nuevo.');
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': tamano(archivo), 'Content-Disposition': `attachment; filename="resultado-${t.id}.zip"` });
    return leer(archivo).pipe(res);
  }

  if (!ruta.startsWith('/v1/')) return fallo(res, 404, 'no_encontrado', 'Ruta desconocida.');
  if (!autorizado(req)) return fallo(res, 401, 'no_autorizado', 'Falta el token Bearer o es inválido.');

  if (req.method === 'POST' && ruta === '/v1/trabajos') return crearTrabajo(req, res);

  // Comprueba que la credencial de Claude funciona (una llamada mínima real; gasta una fracción ínfima de cuota).
  if (req.method === 'POST' && ruta === '/v1/diagnostico/claude') {
    if (config.ia !== 'claude') return enviar(res, 200, { ok: true, mensaje: 'La IA configurada es «simulada»; no hay nada que probar.' });
    const r = await probarClaude();
    return enviar(res, r.ok ? 200 : 502, { ...r, claude: estadoIA });
  }

  if ((m = /^\/v1\/trabajos\/([\w-]+)(\/cancelar)?$/.exec(ruta))) {
    const t = obtener(m[1]);
    if (!t) return fallo(res, 404, 'trabajo_no_encontrado', 'El trabajo no existe o ya fue purgado.');

    if (req.method === 'GET' && !m[2]) {
      if (t.estado === 'en_cola') t.mensaje = mensajeCola(t);
      // Renueva el enlace si ya expiró (contrato §4).
      if (t.estado === 'completado' && Date.parse(t.resultado.expira_en) < Date.now() && existsSync(join(dirDe(t.id), 'resultado.zip'))) {
        t.tokenDescarga = randomBytes(16).toString('hex');
        t.resultado = { ...t.resultado, url: `${config.urlPublica}/descargas/${t.id}/${t.tokenDescarga}/resultado.zip`, expira_en: new Date(Date.now() + config.expiraResultadoHoras * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z') };
        guardar(t);
      }
      return enviar(res, 200, aEstado(t));
    }

    if (req.method === 'POST' && m[2]) {
      if (!TERMINALES.includes(t.estado)) {
        t.cancelando = true;
        if (t.estado === 'en_cola' || !enEjecucion(t.id)) {
          t.estado = 'cancelado';
          t.mensaje = 'Llenado cancelado.';
          t.terminado_en = ahora();
        } else {
          cancelarEjecucion(t.id);
          // La IA se detiene casi al instante; se espera un momento para devolver el estado ya final.
          for (let i = 0; i < 20 && !TERMINALES.includes(t.estado); i++) await new Promise((r) => setTimeout(r, 100));
        }
        guardar(t);
      }
      return enviar(res, 200, aEstado(t));
    }

    if (req.method === 'DELETE' && !m[2]) {
      if (enEjecucion(t.id)) cancelarEjecucion(t.id);
      eliminar(t.id);
      res.writeHead(204);
      return res.end();
    }
  }
  return fallo(res, 404, 'no_encontrado', 'Ruta desconocida.');
}

// ── Retención (contrato §8): el paquete y los intermedios ≤ 7 días tras terminar; el registro de estado, 30 días ───────
function barrer() {
  const ahoraMs = Date.now();
  for (const t of todos()) {
    if (!TERMINALES.includes(t.estado) || !t.terminado_en) continue;
    const dias = (ahoraMs - Date.parse(t.terminado_en)) / 86_400_000;
    if (dias > 30) { eliminar(t.id); continue; }
    if (dias > config.retencionDias) {
      for (const sub of ['p', 'salida', 'sistema.md']) rmSync(join(dirDe(t.id), sub), { recursive: true, force: true });
      if (t.resultado && Date.parse(t.resultado.expira_en) < ahoraMs) rmSync(join(dirDe(t.id), 'resultado.zip'), { force: true });
    }
  }
}

cargarDeDisco();
barrer();
setInterval(barrer, 3600_000).unref();
if (config.ia === 'claude') infoClaude().then((i) => { estadoIA = { tipo: 'claude', ...i }; console.log('Claude Code:', JSON.stringify(i)); });

const servidor = createServer((req, res) => {
  manejar(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) fallo(res, 500, 'interno', 'Fallo inesperado.', String(e.message));
    else res.end();
  });
});
servidor.listen(config.puerto, () => {
  console.log(`Servidor de llenado simulado escuchando en el puerto ${config.puerto}  ·  URL: ${config.urlPublica}  ·  IA: ${ia.nombre}  ·  datos: ${config.dataDir}`);
  if (config.token === 'dev-token-cambiar') console.log('  (token de desarrollo: dev-token-cambiar — cámbialo en .env con SERVIDOR_TOKEN)');
});

// Railway envía SIGTERM al redesplegar: se deja de aceptar conexiones. Los trabajos en curso se marcan como error reintentable al volver a arrancar.
process.on('SIGTERM', () => {
  console.log('SIGTERM: cerrando…');
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
