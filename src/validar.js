/**
 * Validación y normalización de lo que responde la IA, antes de aceptarlo (contrato 03 §6 y doc 02 §4 paso 7).
 * Lanza ErrorRespuesta cuando la respuesta no se puede aprovechar: el pipeline reintenta con ese mensaje como retroalimentación.
 * Lo recuperable se corrige y se anota como advertencia.
 */
export class ErrorRespuesta extends Error {}

const ESTADOS = ['extraido', 'inferido', 'requiere_confirmacion', 'no_encontrado', 'conflictivo', 'calculado'];

const sinTildes = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
const clave = (s) => sinTildes(String(s)).toLowerCase().replace(/\s+/g, ' ').trim();

/** Saca el primer JSON (objeto o arreglo) de un texto que puede traer ```json … ``` o prosa alrededor. */
export function extraerJson(texto) {
  let t = String(texto ?? '').trim();
  const cerco = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerco) t = cerco[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    /* intenta recortar entre el primer y el último delimitador */
  }
  const ini = t.search(/[[{]/);
  if (ini < 0) throw new ErrorRespuesta('La respuesta no contiene ningún JSON.');
  const cierre = t[ini] === '{' ? '}' : ']';
  const fin = t.lastIndexOf(cierre);
  if (fin <= ini) throw new ErrorRespuesta('El JSON de la respuesta está incompleto (¿se cortó?).');
  try {
    return JSON.parse(t.slice(ini, fin + 1));
  } catch (e) {
    throw new ErrorRespuesta(`La respuesta no es un JSON válido: ${e.message}`);
  }
}

// ── Campos de texto ───────────────────────────────────────────────────────────

/**
 * @param {object|Array} bruto  respuesta de la IA para una sección
 * @param {object} seccion      sección del paquete (campos esperados)
 * @param {string} modo         'estricto' | 'flexible' | 'inventar'
 * @returns {{campos: object[], advertencias: object[]}} un elemento por cada campo esperado, en el orden de secciones.json
 */
export function validarCampos(bruto, seccion, modo) {
  const lista = Array.isArray(bruto) ? bruto : bruto?.campos;
  if (!Array.isArray(lista)) throw new ErrorRespuesta('Falta el arreglo «campos» en la respuesta de la sección.');
  const porId = new Map(lista.filter((c) => c && c.id != null).map((c) => [String(c.id).trim(), c]));
  const advertencias = [];
  const aviso = (id, mensaje) => advertencias.push({ ambito: 'campo', identificador: id, mensaje });

  const desconocidos = [...porId.keys()].filter((id) => !seccion.campos.some((c) => c.identificador === id));
  if (desconocidos.length) advertencias.push({ ambito: 'seccion', identificador: seccion.numero, mensaje: `Se ignoraron ${desconocidos.length} ids que no existen en la sección: ${desconocidos.slice(0, 5).join(', ')}` });

  const campos = seccion.campos.map((def) => {
    const id = def.identificador;
    const vacio = { id, valor_propuesto: null, estado: 'no_encontrado', confianza: 0, fuente: '', evidencia: '' };
    const c = porId.get(id);
    if (!c) return vacio;

    let estado = ESTADOS.includes(c.estado) ? c.estado : 'extraido';
    let valor = c.valor_propuesto;
    if (valor !== null && valor !== undefined && typeof valor === 'object') valor = JSON.stringify(valor);
    valor = valor === null || valor === undefined ? null : String(valor).trim();
    if (valor === '' || valor === null) return vacio;
    if (estado === 'no_encontrado' || estado === 'calculado') return vacio;
    if (modo === 'estricto' && estado === 'inferido') {
      aviso(id, 'Modo estricto: se descartó un valor marcado como inferido.');
      return vacio;
    }

    if (Array.isArray(def.opciones) && def.opciones.length) {
      const exacta = def.opciones.find((o) => String(o) === valor) ?? def.opciones.find((o) => clave(o) === clave(valor));
      if (exacta === undefined) {
        aviso(id, `El valor «${valor.slice(0, 60)}» no es una de las opciones válidas; se descartó.`);
        return vacio;
      }
      valor = String(exacta);
    }
    const confianza = Number(c.confianza);
    return {
      id,
      valor_propuesto: valor,
      estado,
      confianza: Number.isFinite(confianza) ? Math.min(1, Math.max(0, confianza)) : 0.5,
      fuente: String(c.fuente ?? '').trim(),
      evidencia: String(c.evidencia ?? '').trim(),
    };
  });
  return { campos, advertencias };
}

// ── Tablas ────────────────────────────────────────────────────────────────────

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hoja = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Lleva `valor` a la forma exacta de `base` (el estado base de la tabla): mismas claves, mismo número de filas/bloques/nodos,
 * celdas como texto. Lo que sobra se descarta y lo que falta se completa con el valor base; cada ajuste se cuenta.
 * `ajustes` acumula contadores para la advertencia. Con `extensible` el arreglo de más nivel puede tener un número libre de filas.
 */
function normalizar(base, valor, ajustes, extensible = false) {
  if (Array.isArray(base)) {
    if (!Array.isArray(valor)) throw new ErrorRespuesta('Se esperaba un arreglo en esa posición de la tabla.');
    if (extensible) {
      const plantilla = base[0] ?? valor.find(esObjeto) ?? {};
      return valor.map((v) => normalizar(plantilla, esObjeto(v) ? v : {}, ajustes));
    }
    if (valor.length !== base.length) ajustes.filas += Math.abs(valor.length - base.length);
    return base.map((b, i) => normalizar(b, valor[i] === undefined ? b : valor[i], ajustes));
  }
  if (esObjeto(base)) {
    if (!esObjeto(valor)) throw new ErrorRespuesta('Se esperaba un objeto en esa posición de la tabla.');
    const salida = {};
    for (const k of Object.keys(base)) {
      if (!(k in valor)) ajustes.claves++;
      salida[k] = Array.isArray(base[k]) || esObjeto(base[k]) ? normalizar(base[k], valor[k] ?? base[k], ajustes) : hoja(valor[k] ?? base[k]);
    }
    for (const k of Object.keys(valor)) if (!(k in base)) ajustes.claves++;
    return salida;
  }
  return hoja(valor);
}

/**
 * @param {*} bruto  valor que devolvió la IA para la tabla
 * @param {object} tabla  { id, base, grande, filasMax }
 * @returns {{valor: Array, advertencias: object[]}}
 */
export function validarTabla(bruto, tabla) {
  const valor = esObjeto(bruto) && 'valor' in bruto ? bruto.valor : bruto;
  if (!Array.isArray(valor)) throw new ErrorRespuesta(`La tabla ${tabla.id}: «valor» debe ser un arreglo con la forma de la tabla actual.`);
  const ajustes = { filas: 0, claves: 0 };
  let resultado;
  try {
    if (tabla.grande) {
      if (tabla.filasMax && valor.length > tabla.filasMax) throw new ErrorRespuesta(`La tabla ${tabla.id} tiene como máximo ${tabla.filasMax} filas y se devolvieron ${valor.length}.`);
      resultado = normalizar(tabla.base, valor, ajustes, true);
    } else {
      resultado = normalizar(tabla.base, valor, ajustes);
    }
  } catch (e) {
    if (e instanceof ErrorRespuesta) throw new ErrorRespuesta(`Tabla ${tabla.id}: ${e.message}`);
    throw e;
  }
  const advertencias = [];
  if (ajustes.filas || ajustes.claves) {
    advertencias.push({
      ambito: 'tabla',
      identificador: tabla.id,
      mensaje: `Se ajustó la forma de la tabla a la del formato (${ajustes.filas} filas y ${ajustes.claves} claves distintas).`,
    });
  }
  return { valor: resultado, advertencias };
}
