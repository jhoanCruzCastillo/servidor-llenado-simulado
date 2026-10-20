/**
 * Lectura del paquete que envía la plataforma (contrato: docs/servidor-llenado-externo/02_PAQUETE_QUE_ENVIAMOS.md).
 * Todo se descubre leyendo manifiesto.json y secciones.json: no se asume ninguna sección ni campo concreto.
 */
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { config } from './config.js';

export class ErrorPaquete extends Error {
  constructor(codigo, mensaje, http = 400) {
    super(mensaje);
    this.codigo = codigo;
    this.http = http;
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Valida el zip y lo extrae en `destino`. Es la validación síncrona de `POST /v1/trabajos` (contrato 01 §2.2).
 * @returns {{raiz: string, rutaRaiz: string, manifiesto: object}}
 */
export function validarYExtraer(rutaZip, destino) {
  let zip;
  try {
    zip = new AdmZip(rutaZip);
  } catch {
    throw new ErrorPaquete('paquete_invalido', 'El archivo no es un zip válido o está corrupto.');
  }
  const entradas = zip.getEntries().filter((e) => !e.isDirectory);
  if (entradas.length === 0) throw new ErrorPaquete('paquete_invalido', 'El zip está vacío.');

  // Un único directorio raíz, sin rutas absolutas ni "..".
  const raices = new Set();
  for (const e of entradas) {
    const nombre = e.entryName.replaceAll('\\', '/');
    if (nombre.startsWith('/') || /^[A-Za-z]:/.test(nombre) || nombre.split('/').includes('..')) {
      throw new ErrorPaquete('paquete_invalido', `Ruta no permitida dentro del zip: ${nombre}`);
    }
    raices.add(nombre.split('/')[0]);
  }
  if (raices.size !== 1) throw new ErrorPaquete('paquete_invalido', 'El zip debe tener un único directorio raíz.');
  const raiz = [...raices][0];

  const entManifiesto = zip.getEntry(`${raiz}/manifiesto.json`);
  if (!entManifiesto) throw new ErrorPaquete('paquete_invalido', 'No se encontró manifiesto.json en la raíz del paquete.');
  let manifiesto;
  try {
    manifiesto = JSON.parse(entManifiesto.getData().toString('utf8'));
  } catch {
    throw new ErrorPaquete('manifiesto_invalido', 'manifiesto.json no es un JSON válido.', 422);
  }
  if (!config.versionesPaqueteSoportadas.includes(String(manifiesto.version_paquete))) {
    throw new ErrorPaquete('version_paquete_no_soportada', `Versión de paquete no soportada: ${manifiesto.version_paquete}. Soportadas: ${config.versionesPaqueteSoportadas.join(', ')}.`, 422);
  }
  for (const k of ['carpeta_raiz', 'ficha', 'plantilla', 'secciones', 'archivos']) {
    if (manifiesto[k] === undefined) throw new ErrorPaquete('manifiesto_invalido', `manifiesto.json no trae «${k}».`, 422);
  }

  // Integridad: cada archivo del manifiesto existe y su sha256 coincide.
  for (const a of manifiesto.archivos) {
    const ent = zip.getEntry(`${raiz}/${a.ruta}`);
    if (!ent) throw new ErrorPaquete('paquete_invalido', `Falta el archivo ${a.ruta} listado en el manifiesto.`);
    if (sha256(ent.getData()) !== a.sha256) {
      throw new ErrorPaquete('paquete_invalido', `La huella sha256 de ${a.ruta} no coincide con el manifiesto.`);
    }
  }

  // Extracción (con control de ruta, aunque ya se validó arriba).
  const base = resolve(destino);
  for (const e of entradas) {
    const rel = e.entryName.replaceAll('\\', '/');
    const ruta = resolve(base, rel);
    if (!ruta.startsWith(base + sep)) throw new ErrorPaquete('paquete_invalido', `Ruta no permitida: ${rel}`);
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, e.getData());
  }
  return { raiz, rutaRaiz: join(base, raiz), manifiesto };
}

const leerJson = (ruta) => JSON.parse(readFileSync(ruta, 'utf8'));
const leerTexto = (ruta) => (existsSync(ruta) ? readFileSync(ruta, 'utf8') : '');

/** Lista los .md de una carpeta ordenados por nombre (recursivo en un nivel: las instrucciones van en subcarpetas numeradas). */
function mdOrdenados(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((d) => (d.isDirectory() ? mdOrdenados(join(dir, d.name)) : d.name.endsWith('.md') ? [join(dir, d.name)] : []));
}

/**
 * Carga todo lo que el servidor necesita del paquete ya extraído.
 * @returns {object} modelo del paquete (ver más abajo)
 */
export function cargarPaquete(rutaRaiz, manifiesto) {
  const secJson = leerJson(join(rutaRaiz, '05_secciones_a_llenar', 'secciones.json')).secciones;
  const estructura = leerJson(join(rutaRaiz, '02_estructura_base', 'estructura.json'));

  // Estado base de cada tabla (valorEjemplo), por identificador.
  const baseTablas = new Map();
  for (const s of estructura.secciones) {
    for (const sub of s.subsecciones ?? []) {
      for (const c of sub.campos ?? []) {
        if (c.tipo === 'tabla' && c.configTabla) {
          let v = c.valorEjemplo;
          if (typeof v === 'string') {
            try {
              v = JSON.parse(v);
            } catch {
              v = [];
            }
          }
          baseTablas.set(c.identificador, { etiqueta: c.etiqueta, base: Array.isArray(v) ? v : [] });
        }
      }
    }
  }

  const secciones = manifiesto.secciones.map((m) => {
    const carpeta = join(rutaRaiz, m.carpeta);
    const j = secJson.find((s) => s.id === m.id);
    const dirTablas = join(carpeta, 'tablas');
    const tablas = existsSync(dirTablas)
      ? readdirSync(dirTablas)
          .filter((f) => f.endsWith('.md'))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .map((f) => {
            const id = f.slice(0, -3);
            const md = leerTexto(join(dirTablas, f));
            const filasGrandes = md.match(/con (\d+) filas en total, casi tod/);
            const ruta = `${String(m.carpeta).replaceAll('\\', '/')}/tablas/${f}`;
            return { id, md, ruta, base: baseTablas.get(id)?.base ?? [], etiqueta: baseTablas.get(id)?.etiqueta ?? id, grande: !!filasGrandes, filasMax: filasGrandes ? Number(filasGrandes[1]) : null };
          })
      : [];
    return {
      id: m.id,
      numero: m.numero,
      nombre: m.nombre,
      carpeta: m.carpeta,
      hoja: j?.hoja ?? null,
      campos: j?.campos ?? [],
      seccionMd: leerTexto(join(carpeta, 'seccion.md')),
      contexto: mdOrdenados(join(carpeta, 'contexto')).map((f) => leerTexto(f)),
      tablas,
    };
  });

  // Instrucciones, en el orden numérico de las carpetas (rol → prompt → reglas → contextos), luego modo y formato.
  const dirInst = join(rutaRaiz, '01_instrucciones');
  const bloques = ['01_rol', '02_prompt_sistema', '03_reglas_de_llenado', '04_contextos_generales'].flatMap((d) => mdOrdenados(join(dirInst, d)).map((f) => leerTexto(f)));
  const modoMd = leerTexto(join(dirInst, '05_modo_de_llenado.md'));
  const formatoMd = leerTexto(join(dirInst, '06_formato_de_respuesta.md'));

  const ejemploRuta = join(rutaRaiz, '03_ejemplo_referencia');
  const ejemploJson = existsSync(join(ejemploRuta, 'ejemplo.json')) ? leerJson(join(ejemploRuta, 'ejemplo.json')) : null;
  const ejemploExcel = ['ejemplo.xlsm', 'ejemplo.xlsx'].map((f) => join(ejemploRuta, f)).find((f) => existsSync(f)) ?? null;

  return {
    rutaRaiz,
    manifiesto,
    modo: manifiesto.modo_de_llenado ?? 'flexible',
    secciones,
    instrucciones: { bloques, modoMd, formatoMd },
    ejemplo: { json: ejemploJson, excel: ejemploExcel },
  };
}
