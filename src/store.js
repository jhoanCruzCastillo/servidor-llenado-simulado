/**
 * Trabajos: modelo interno, persistencia en disco y construcción del objeto de estado del contrato
 * (docs/servidor-llenado-externo/01_CONTRATO_DEL_SERVIDOR.md §3, esquema estado.schema.json).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const dirTrabajos = join(config.dataDir, 'trabajos');
const archivoIdem = join(config.dataDir, 'idempotencia.json');
mkdirSync(dirTrabajos, { recursive: true });

/** @type {Map<string, object>} */
const trabajos = new Map();
let idempotencia = existsSync(archivoIdem) ? JSON.parse(readFileSync(archivoIdem, 'utf8')) : {};

export const ahora = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const dirDe = (id) => join(dirTrabajos, id);
export const TERMINALES = ['completado', 'error', 'cancelado'];

export function guardar(t) {
  t.actualizado_en = ahora();
  writeFileSync(join(dirDe(t.id), 'estado.json'), JSON.stringify(t, null, 2));
}

export function registrar(t) {
  trabajos.set(t.id, t);
  guardar(t);
  return t;
}

export const obtener = (id) => trabajos.get(id);
export const todos = () => [...trabajos.values()];

export function eliminar(id) {
  trabajos.delete(id);
  for (const [k, v] of Object.entries(idempotencia)) if (v === id) delete idempotencia[k];
  persistirIdem();
  rmSync(dirDe(id), { recursive: true, force: true });
}

export const buscarIdem = (clave) => (clave ? idempotencia[clave] : undefined);
export function guardarIdem(clave, id) {
  if (!clave) return;
  idempotencia[clave] = id;
  persistirIdem();
}
const persistirIdem = () => writeFileSync(archivoIdem, JSON.stringify(idempotencia, null, 2));

/** Al arrancar: carga los trabajos del disco. Los que estaban en curso se dan por fallidos (el proceso murió con ellos). */
export function cargarDeDisco() {
  for (const id of readdirSync(dirTrabajos)) {
    const f = join(dirDe(id), 'estado.json');
    if (!existsSync(f)) continue;
    try {
      const t = JSON.parse(readFileSync(f, 'utf8'));
      if (!TERMINALES.includes(t.estado)) {
        t.estado = 'error';
        t.etapa = t.etapa ?? 'recibido';
        t.mensaje = 'El servidor se reinició durante el llenado. Envía el paquete de nuevo.';
        t.error = { codigo: 'interno', mensaje: 'El servidor se reinició mientras el trabajo estaba en curso.', reintentable: true, detalle: null };
        t.terminado_en = ahora();
        guardar(t);
      }
      trabajos.set(t.id, t);
    } catch (e) {
      console.warn(`[store] no se pudo leer ${f}: ${e.message}`);
    }
  }
}

// ── Objeto de estado del contrato ─────────────────────────────────────────────

const pctSeccion = (s) => {
  const total = s.campos_totales + s.tablas_totales;
  return total === 0 ? 100 : Math.min(100, Math.floor((100 * (s.campos_completados + s.tablas_completadas)) / total));
};

export function totalesDe(t) {
  const sum = (k) => t.secciones.reduce((a, s) => a + s[k], 0);
  return {
    secciones_totales: t.secciones.length,
    secciones_completadas: t.secciones.filter((s) => ['completada', 'omitida', 'con_errores'].includes(s.estado)).length,
    campos_totales: sum('campos_totales'),
    campos_completados: sum('campos_completados'),
    tablas_totales: sum('tablas_totales'),
    tablas_completadas: sum('tablas_completadas'),
  };
}

/** Porcentaje del contrato §3.4: monótono, tope 99 mientras no haya resultado publicado, 100 ⇔ completado. */
export function porcentajeDe(t) {
  if (t.estado === 'completado') return 100;
  if (t.estado === 'en_cola') return 0;
  const x = totalesDe(t);
  const total = x.campos_totales + x.tablas_totales;
  const bruto = total === 0 ? 0 : Math.floor((100 * (x.campos_completados + x.tablas_completadas)) / total);
  t.porcentajeMax = Math.max(t.porcentajeMax ?? 0, Math.min(bruto, 99));
  return t.porcentajeMax;
}

export function aEstado(t) {
  const totales = totalesDe(t);
  const hechas = totales.campos_completados + totales.tablas_completadas;
  const total = totales.campos_totales + totales.tablas_totales;
  let restantes = null;
  if (t.estado === 'procesando' && t.iniciado_en && hechas >= 3 && total > hechas) {
    const transcurridos = (Date.now() - Date.parse(t.iniciado_en)) / 1000;
    restantes = Math.round((transcurridos / hechas) * (total - hechas));
  } else if (t.estado === 'completado') {
    restantes = 0;
  }
  const actual = t.seccionActualId ? t.secciones.find((s) => s.id === t.seccionActualId) : null;
  return {
    version_estado: '1.0',
    trabajo_id: t.id,
    referencia: t.referencia ?? null,
    estado: t.estado,
    cancelando: !!t.cancelando && !TERMINALES.includes(t.estado),
    porcentaje: porcentajeDe(t),
    etapa: t.etapa,
    mensaje: t.mensaje,
    seccion_actual: actual && t.estado === 'procesando' ? { id: actual.id, numero: actual.numero, nombre: actual.nombre } : null,
    totales,
    secciones: t.secciones.map((s) => ({
      id: s.id, numero: s.numero, nombre: s.nombre, estado: s.estado, porcentaje: pctSeccion(s),
      campos_totales: s.campos_totales, campos_completados: s.campos_completados,
      tablas_totales: s.tablas_totales, tablas_completadas: s.tablas_completadas,
    })),
    creado_en: t.creado_en,
    iniciado_en: t.iniciado_en ?? null,
    actualizado_en: t.actualizado_en,
    terminado_en: t.terminado_en ?? null,
    segundos_restantes_estimados: restantes,
    resultado: t.estado === 'completado' ? t.resultado : null,
    error: t.estado === 'error' ? t.error : null,
    advertencias: (t.advertencias ?? []).slice(0, 200),
  };
}
