/**
 * Puerta de entrada para Node al código de Excel de la plataforma (se empaqueta en vendor/excel-ficha.mjs, ver build.mjs).
 *
 *  - escribirFicha: escribe valores (identificador → valor) en el Excel con el MISMO escritor del navegador (`insertarValoresEnExcel`).
 *  - volcarFicha:   lee un Excel llenado y devuelve identificador → valor con el MISMO volcado del superusuario (`leerValoresDeExcel`).
 *  - verHoja:       texto legible de un rango de una hoja (valores, fórmulas calculadas, desplegables) para que la IA "vea" el Excel.
 */
import { DOMParser, Document as LDocument, Element as LElement } from 'linkedom';
import { writeFileSync } from 'node:fs';
import { leerValoresDeExcel } from '../../../frontend/src/lib/excelReader';
import { insertarValoresEnExcel } from '../../../frontend/src/lib/excelWriter';
import { calcularCelda } from '../../../frontend/src/lib/excelFormulaEval';
import { catalogoDeListas } from '../../../frontend/src/lib/xlsxListas';
import { leerLibroXlsx } from '../../../frontend/src/lib/xlsxXmlReader';

// linkedom trae DOMParser pero no XMLSerializer: un documento XML de linkedom se serializa con toString().
class XMLSerializerNode {
  serializeToString(nodo: { toString(): string }): string {
    return nodo.toString();
  }
}

// linkedom no entiende getElementsByTagName('*') (devuelve vacío): el lector de Excel lo usa para leer los desplegables (<dataValidation>). Se completa con querySelectorAll('*').
for (const proto of [LElement.prototype, LDocument.prototype] as unknown as { getElementsByTagName: (n: string) => unknown; querySelectorAll: (s: string) => unknown }[]) {
  const original = proto.getElementsByTagName;
  proto.getElementsByTagName = function (this: { querySelectorAll: (s: string) => unknown }, nombre: string) {
    return nombre === '*' ? this.querySelectorAll('*') : original.call(this, nombre);
  };
}
const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser = DOMParser;
g.XMLSerializer = XMLSerializerNode;

export interface AvisoEscritura {
  campo: string;
  celda: string;
  valor: string;
}

/** Escribe `valores` sobre el Excel `formato` (que no se modifica) y deja el resultado en `salida`. */
export async function escribirFicha(opts: {
  formato: string;
  plantilla: unknown;
  valores: Record<string, string>;
  salida: string;
}): Promise<{ avisos: AvisoEscritura[]; bytes: number }> {
  const avisos: AvisoEscritura[] = [];
  // Los desplegables solo se hacen cumplir en los campos simples: en las tablas el rango de una validación del formato a veces cubre más celdas de las que debe.
  const dataUrl = await insertarValoresEnExcel(
    opts.formato,
    opts.plantilla as never,
    opts.valores,
    undefined,
    (a) => {
      for (const x of a as unknown as AvisoEscritura[]) avisos.push(x);
    },
    { listasSoloEnCamposSimples: true },
  );
  const coma = dataUrl.indexOf(',');
  const buf = Buffer.from(dataUrl.slice(coma + 1), 'base64');
  writeFileSync(opts.salida, buf);
  return { avisos, bytes: buf.length };
}

export interface ResultadoLectura {
  valores: Record<string, string>;
  camposLeidos: number;
  camposVacios: number;
  tablasLeidas: number;
  filasTablaLeidas: number;
  filasExtraDetectadas: number;
  celdasSinCalcular: number;
  [k: string]: unknown;
}

/** Lee un Excel llenado y devuelve los valores de la ficha (todas las secciones, o solo `seccionesIds`). */
export async function volcarFicha(opts: {
  excel: string;
  excelEstructura?: string;
  plantilla: unknown;
  seccionesIds?: string[];
  valoresActuales?: Record<string, string>;
}): Promise<ResultadoLectura> {
  const r = await leerValoresDeExcel(opts.excel, opts.plantilla as never, {
    camposSimples: true,
    tablas: true,
    imagenes: false,
    seccionesIds: opts.seccionesIds ? new Set(opts.seccionesIds) : undefined,
    valoresActuales: opts.valoresActuales ?? {},
    excelEstructura: opts.excelEstructura,
  });
  return r as unknown as ResultadoLectura;
}

const letraAIndice = (letra: string): number => [...letra.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function indiceALetra(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Describe un rango de una hoja, una línea por celda con contenido: `H8 = valor`, `G7 = «calculado»  (fórmula: …)`, `[lista: a | b | c]`,
 * y `(fusión 13×1)` cuando la celda abarca varias. Es lo que "ve" quien llena el Excel.
 */
export async function verHoja(opts: { excel: string; hoja: string; rango?: string; maxCeldas?: number }): Promise<string> {
  const libro = await leerLibroXlsx(opts.excel);
  if (!libro.hojas.includes(opts.hoja)) return `La hoja «${opts.hoja}» no existe. Hojas del libro: ${libro.hojas.join(', ')}.`;
  const maxFila = libro.filaMaxima(opts.hoja) ?? 1;
  let c1 = 1, f1 = 1, c2 = 30, f2 = Math.min(maxFila, 60);
  if (opts.rango) {
    const m = opts.rango.toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!m) return `Rango no válido: «${opts.rango}». Usa por ejemplo A1:M40.`;
    c1 = letraAIndice(m[1]);
    f1 = Number(m[2]);
    c2 = m[3] ? letraAIndice(m[3]) : c1;
    f2 = m[4] ? Number(m[4]) : f1;
  }
  const tope = opts.maxCeldas ?? 400;
  const catalogo = catalogoDeListas(libro);
  const memo = new Map<string, unknown>();
  const lineas: string[] = [];
  let cuenta = 0;
  let cortado = false;
  for (let f = f1; f <= f2 && !cortado; f++) {
    for (let c = c1; c <= c2; c++) {
      const ref = `${indiceALetra(c)}${f}`;
      const celda = libro.celda(opts.hoja, ref);
      const formula = libro.formulaDe(opts.hoja, ref);
      const opciones = catalogo.opcionesDe(opts.hoja, ref);
      if (!celda?.valor && !formula && !opciones) continue;
      if (++cuenta > tope) { cortado = true; break; }
      const partes: string[] = [];
      if (formula) {
        const calc = calcularCelda(libro, new Map(), opts.hoja, ref, memo);
        partes.push(`${ref} = ${calc?.soportado ? `«${calc.texto}»` : `«${celda?.valor ?? ''}»`}  (calculada por el Excel: no se escribe)`);
      } else {
        partes.push(`${ref} = ${celda?.valor ? JSON.stringify(celda.valor.length > 300 ? celda.valor.slice(0, 300) + '…' : celda.valor) : '(vacía)'}`);
      }
      const fus = libro.fusion(opts.hoja, ref);
      if (fus && (fus.filas > 1 || fus.columnas > 1)) partes.push(`(fusión ${fus.columnas}×${fus.filas})`);
      if (opciones?.length) partes.push(`[lista: ${opciones.slice(0, 15).join(' | ')}${opciones.length > 15 ? ` … (+${opciones.length - 15})` : ''}]`);
      lineas.push(partes.join(' '));
    }
  }
  const cab = `Hoja «${opts.hoja}», rango ${indiceALetra(c1)}${f1}:${indiceALetra(c2)}${f2} (la hoja llega hasta la fila ${maxFila}).`;
  if (lineas.length === 0) return `${cab}\nNo hay celdas con contenido en ese rango.`;
  return `${cab}\n${lineas.join('\n')}${cortado ? `\n… (se muestran las primeras ${tope} celdas; pide un rango más pequeño)` : ''}`;
}
