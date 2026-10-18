/**
 * Conversaciones del chat de prueba: un JSON por conversación en DATA_DIR/chat/ (el volumen de Railway).
 *
 * { id, titulo, modelo, creado_en, actualizado_en, session_id, mensajes: [
 *     { id, rol: 'usuario'|'asistente', contenido, creado_en, modelo?, uso?, interrumpido? } ] }
 *
 * `session_id` es la sesión de Claude Code para continuar la conversación con --resume (null = no hay o se reinició).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { ahora } from '../store.js';

const dir = join(config.dataDir, 'chat');
mkdirSync(dir, { recursive: true });

export const idValido = (id) => /^cnv_[0-9a-f]{12}$/.test(id);
const ruta = (id) => join(dir, `${id}.json`);

export function obtener(id) {
  if (!idValido(id) || !existsSync(ruta(id))) return null;
  try {
    return JSON.parse(readFileSync(ruta(id), 'utf8'));
  } catch {
    return null;
  }
}

export function guardar(c) {
  c.actualizado_en = ahora();
  const tmp = `${ruta(c.id)}.tmp`;
  writeFileSync(tmp, JSON.stringify(c, null, 2));
  renameSync(tmp, ruta(c.id)); // escritura atómica: un corte no deja el archivo a medias
  return c;
}

export function crear({ titulo, modelo }) {
  const c = {
    id: `cnv_${randomBytes(6).toString('hex')}`,
    titulo: (titulo || 'Nueva conversación').slice(0, 120),
    tituloAutomatico: !titulo,
    modelo,
    creado_en: ahora(),
    actualizado_en: ahora(),
    session_id: null,
    mensajes: [],
  };
  return guardar(c);
}

export function eliminar(id) {
  if (idValido(id)) rmSync(ruta(id), { force: true });
}

/** Resumen para la lista (sin los mensajes), de la más reciente a la más antigua. */
export function listar() {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => obtener(f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en))
    .map(resumen);
}

export const resumen = (c) => ({
  id: c.id,
  titulo: c.titulo,
  modelo: c.modelo,
  creado_en: c.creado_en,
  actualizado_en: c.actualizado_en,
  mensajes: c.mensajes.length,
});

export function nuevoMensaje(rol, contenido, extra = {}) {
  return { id: randomUUID(), rol, contenido, creado_en: ahora(), ...extra };
}

/** Título automático a partir del primer mensaje de la persona. */
export function tituloDesde(texto) {
  const t = texto.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t || 'Nueva conversación';
}
