/**
 * Diagnóstico de un trabajo: qué hizo el servidor y qué respondió la IA, SIN los documentos del cliente.
 * Sirve para entender por qué un llenado salió vacío o incompleto (GET /v1/trabajos/:id/diagnostico).
 */
import AdmZip from 'adm-zip';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dirDe } from './store.js';

const VISTA = 700;

function leerLog(dir) {
  const f = join(dir, 'log.ndjson');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-400).map((l) => {
    try { return JSON.parse(l); } catch { return { evento: 'linea_ilegible', texto: l.slice(0, 200) }; }
  });
}

/** Cada archivo de `salida/` es la respuesta cruda de UNA llamada a la IA (ya parseada como JSON). */
function leerSalidas(dir) {
  const d = join(dir, 'salida');
  if (!existsSync(d)) return [];
  return readdirSync(d).sort().map((archivo) => {
    const ruta = join(d, archivo);
    const texto = readFileSync(ruta, 'utf8');
    let resumen = null;
    try {
      const j = JSON.parse(texto);
      if (Array.isArray(j.campos)) {
        const por = {};
        for (const c of j.campos) por[c.estado] = (por[c.estado] ?? 0) + 1;
        resumen = { tipo: 'campos', campos: j.campos.length, por_estado: por };
      } else if (Array.isArray(j.tablas)) {
        resumen = { tipo: 'tablas', tablas: j.tablas.map((t) => ({ id: t.identificador, filas: Array.isArray(t.valor) ? t.valor.length : null })) };
      }
    } catch { resumen = { tipo: 'no_es_json' }; }
    return { archivo, bytes: statSync(ruta).size, resumen, inicio: texto.slice(0, VISTA) };
  });
}

function leerResumenResultado(dir) {
  const f = join(dir, 'resultado.zip');
  if (!existsSync(f)) return null;
  try {
    const e = new AdmZip(f).getEntries().find((x) => x.entryName.endsWith('resumen.json'));
    return e ? JSON.parse(e.getData().toString('utf8')) : null;
  } catch { return null; }
}

export function diagnosticoDe(t) {
  const dir = dirDe(t.id);
  return {
    trabajo_id: t.id,
    estado: t.estado,
    etapa: t.etapa,
    mensaje: t.mensaje,
    error: t.error ?? null,
    creado_en: t.creado_en,
    iniciado_en: t.iniciado_en ?? null,
    terminado_en: t.terminado_en ?? null,
    purgado_en: t.purgado_en ?? null,
    simulacion: t.simulacion ?? null,
    uso: t.uso ?? {},
    secciones: t.secciones.map((s) => ({ numero: s.numero, nombre: s.nombre, estado: s.estado, campos: `${s.campos_completados}/${s.campos_totales}`, tablas: `${s.tablas_completadas}/${s.tablas_totales}`, fallos: s.fallos ?? 0 })),
    advertencias: (t.advertencias ?? []).slice(0, 300),
    resumen_resultado: leerResumenResultado(dir),
    llamadas_a_la_ia: leerSalidas(dir),
    log: leerLog(dir),
  };
}
