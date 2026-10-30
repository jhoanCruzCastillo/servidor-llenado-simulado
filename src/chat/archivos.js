/**
 * Archivos adjuntos del chat de prueba. Viven en DATA_DIR/chat-archivos/<conversacionId>/.
 * Claude los abre con Read desde esa carpeta; no se mezcla nada de un paquete de llenado.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import AdmZip from 'adm-zip';
import { config } from '../config.js';

const IMAGEN = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const TEXTO = new Set(['txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'php', 'sql', 'log']);
const OFFICE = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);
const OFFICE_VIEJO = new Set(['doc', 'xls', 'ppt']);

export const idValido = (id) => /^arc_[0-9a-f]{16}$/.test(id);
export const dirDe = (convId) => join(config.dataDir, 'chat-archivos', convId);
export const hay = (convId) => existsSync(join(dirDe(convId), 'indice.json'));

export const limites = () => ({
  max_bytes_por_archivo: config.chatMaxArchivoMB * 1048576,
  max_por_mensaje: config.chatMaxArchivos,
});

export function eliminarDe(convId) {
  rmSync(dirDe(convId), { recursive: true, force: true });
}

function extension(nombre) {
  const i = String(nombre).lastIndexOf('.');
  return i >= 0 ? nombre.slice(i + 1).toLowerCase() : '';
}

function nombreSeguro(nombre) {
  const base = basename(String(nombre || 'archivo')).replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ()]/g, '_').slice(0, 120);
  return base || 'archivo';
}

function categoriaDe(nombre, tipo) {
  const ext = extension(nombre);
  if (IMAGEN.has(ext) || /^image\/(png|jpeg|gif|webp)$/.test(tipo)) return 'imagen';
  if (ext === 'pdf' || tipo === 'application/pdf') return 'pdf';
  if (OFFICE.has(ext) || OFFICE_VIEJO.has(ext)) return 'documento';
  if (TEXTO.has(ext) || String(tipo).startsWith('text/')) return 'texto';
  return 'otro';
}

function limpiarXml(xml) {
  return String(xml)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extraerTextoOffice(buf, ext) {
  try {
    const zip = new AdmZip(buf);
    if (ext === 'docx') {
      return limpiarXml(zip.getEntry('word/document.xml')?.getData()?.toString('utf8') ?? '');
    }
    if (ext === 'xlsx') {
      const ss = zip.getEntry('xl/sharedStrings.xml')?.getData()?.toString('utf8') ?? '';
      const hojas = zip.getEntries().filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName));
      return [limpiarXml(ss), ...hojas.map((h) => limpiarXml(h.getData().toString('utf8')))].filter(Boolean).join('\n');
    }
    if (ext === 'pptx') {
      return zip.getEntries()
        .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
        .map((e) => limpiarXml(e.getData().toString('utf8')))
        .filter(Boolean)
        .join('\n\n');
    }
    return limpiarXml(zip.getEntry('content.xml')?.getData()?.toString('utf8') ?? '');
  } catch {
    return '';
  }
}

function indiceDe(convId) {
  const f = join(dirDe(convId), 'indice.json');
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return {};
  }
}

function guardarIndice(convId, indice) {
  mkdirSync(dirDe(convId), { recursive: true });
  writeFileSync(join(dirDe(convId), 'indice.json'), JSON.stringify(indice, null, 2));
}

export function meta(adjunto) {
  return {
    id: adjunto.id,
    nombre: adjunto.nombre,
    tipo: adjunto.tipo,
    bytes: adjunto.bytes,
    categoria: adjunto.categoria,
    legible: adjunto.legible,
    ...(adjunto.motivo ? { motivo: adjunto.motivo } : {}),
    ...(adjunto.texto_extraido ? { texto_extraido: true } : {}),
  };
}

export function obtener(convId, archivoId) {
  return indiceDe(convId)[archivoId] ?? null;
}

export function rutaBinaria(convId, archivoId) {
  const a = obtener(convId, archivoId);
  return a ? join(dirDe(convId), a.archivo) : null;
}

/** @returns {list<object>} metas de los ids, en el mismo orden; lanza si alguno no existe. */
export function deIds(convId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const indice = indiceDe(convId);
  return ids.map((id) => {
    const a = indice[id];
    if (!a) {
      throw Object.assign(new Error(`El archivo ${id} no existe en esta conversación.`), { http: 400, codigo: 'archivo_no_encontrado' });
    }
    return meta(a);
  });
}

export function guardar(convId, { nombre, tipo, cuerpo }) {
  const limitesAhora = limites();
  if (!Buffer.isBuffer(cuerpo) || cuerpo.length === 0) {
    throw Object.assign(new Error('El archivo está vacío.'), { http: 400, codigo: 'archivo_vacio' });
  }
  if (cuerpo.length > limitesAhora.max_bytes_por_archivo) {
    throw Object.assign(new Error(`El archivo supera el límite de ${config.chatMaxArchivoMB} MB.`), { http: 413, codigo: 'archivo_muy_grande' });
  }

  const indice = indiceDe(convId);
  if (Object.keys(indice).length >= limitesAhora.max_por_mensaje * 10) {
    throw Object.assign(new Error('Esta conversación ya tiene demasiados archivos.'), { http: 413, codigo: 'demasiados_archivos' });
  }

  const id = `arc_${randomBytes(8).toString('hex')}`;
  const original = nombreSeguro(nombre);
  const ext = extension(original);
  const tipoMime = (tipo || 'application/octet-stream').slice(0, 120);
  const categoria = categoriaDe(original, tipoMime);
  const archivo = `${id}_${original}`;
  const dir = dirDe(convId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, archivo), cuerpo);

  let legible = IMAGEN.has(ext) || ext === 'pdf' || TEXTO.has(ext) || String(tipoMime).startsWith('text/');
  let motivo;
  let textoExtraido = false;

  if (OFFICE.has(ext)) {
    const texto = extraerTextoOffice(cuerpo, ext);
    if (texto) {
      writeFileSync(join(dir, `${id}_${original}.txt`), texto, 'utf8');
      legible = true;
      textoExtraido = true;
    } else {
      legible = false;
      motivo = 'No se pudo extraer texto de este documento.';
    }
  } else if (OFFICE_VIEJO.has(ext) || (!legible && categoria === 'otro')) {
    legible = false;
    motivo = 'Claude no puede abrir este formato. Convierte a PDF, texto o una imagen.';
  }

  const adjunto = {
    id,
    nombre: original,
    tipo: tipoMime,
    bytes: cuerpo.length,
    categoria,
    legible,
    motivo,
    texto_extraido: textoExtraido,
    archivo,
  };
  indice[id] = adjunto;
  guardarIndice(convId, indice);
  return meta(adjunto);
}

export function quitar(convId, archivoId) {
  const indice = indiceDe(convId);
  const a = indice[archivoId];
  if (!a) return false;
  rmSync(join(dirDe(convId), a.archivo), { force: true });
  if (a.texto_extraido) rmSync(join(dirDe(convId), `${a.archivo}.txt`), { force: true });
  delete indice[archivoId];
  guardarIndice(convId, indice);
  return true;
}

/** Lista de nombres reales en el directorio de trabajo, para el prompt. */
export function nombresParaPrompt(adjuntos) {
  return (adjuntos ?? []).map((a) => a.nombre).filter(Boolean);
}
