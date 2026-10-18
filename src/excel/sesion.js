/**
 * Sesión de llenado sobre el Excel de la ficha.
 *
 * El Excel es el entregable: cada vez que la IA (o el modo simulado) entrega campos o tablas ya validados, se acumulan aquí y el libro
 * `ficha_llenada.<ext>` se REESCRIBE entero a partir del formato oficial en blanco con todo lo acumulado, usando el mismo escritor que la plataforma
 * (vendor/excel-ficha.mjs). Se reescribe desde el formato —y no se parchea el anterior— porque las tablas que crecen desplazan filas y la
 * posición de cada cosa solo es coherente calculada sobre el formato original.
 *
 * El estado vive en disco (`estado.json`) porque lo escriben dos procesos distintos: el servidor y, cuando llena Claude Code, el servidor MCP
 * que Claude Code lanza (src/excel/mcp-excel.js). Nunca escriben a la vez: el servidor espera a que Claude termine.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ErrorRespuesta, validarCampos, validarTabla } from '../validar.js';

const cargarMotor = (() => {
  let p;
  return () => (p ??= import('../../vendor/excel-ficha.mjs'));
})();

const leerJson = (ruta) => JSON.parse(readFileSync(ruta, 'utf8'));

/** Formato en blanco del paquete (.xlsm si la plantilla trae macros, si no .xlsx). */
export function formatoDelPaquete(rutaRaiz) {
  const dir = join(rutaRaiz, '02_estructura_base');
  const f = ['formato_base.xlsm', 'formato_base.xlsx'].map((n) => join(dir, n)).find((r) => existsSync(r));
  return f ?? null;
}

export class Sesion {
  /**
   * @param {object} paq  paquete cargado (cargarPaquete)
   * @param {string} dir  carpeta de la sesión (se crea)
   */
  constructor(paq, dir) {
    this.paq = paq;
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.formato = formatoDelPaquete(paq.rutaRaiz);
    this.plantilla = join(paq.rutaRaiz, '02_estructura_base', 'estructura.json');
    this.extension = this.formato ? extname(this.formato) : '.xlsx';
    this.rutaExcel = join(dir, `ficha_llenada${this.extension}`);
    this.rutaEstado = join(dir, 'estado.json');
    this.res = { campos: new Map(), tablas: new Map() };
    this.valores = {};
    this.advertencias = [];
    this.rutaRegistro = join(dir, 'llamadas.ndjson');
    this.recargar();
  }

  get disponible() {
    return !!this.formato;
  }

  /** Vuelve a leer el estado de disco (lo pudo haber cambiado el servidor MCP de Claude Code). */
  recargar() {
    this.res = { campos: new Map(), tablas: new Map() };
    this.valores = {};
    this.advertencias = [];
    if (!existsSync(this.rutaEstado)) return;
    const e = leerJson(this.rutaEstado);
    for (const [id, campos] of Object.entries(e.campos ?? {})) this.res.campos.set(id, campos);
    for (const [id, t] of Object.entries(e.tablas ?? {})) this.res.tablas.set(id, t);
    this.valores = e.valores ?? {};
    this.advertencias = e.advertencias ?? [];
  }

  persistir() {
    const tmp = `${this.rutaEstado}.tmp`;
    writeFileSync(tmp, JSON.stringify({ campos: Object.fromEntries(this.res.campos), tablas: Object.fromEntries(this.res.tablas), valores: this.valores, advertencias: this.advertencias }, null, 2));
    renameSync(tmp, this.rutaEstado);
  }

  /** Reescribe el Excel con todo lo acumulado. `avisos`: valores que el Excel no aceptó por no estar en su desplegable ({campo, celda, valor}). */
  async escribirExcel() {
    if (!this.disponible) return { avisos: [], bytes: 0 };
    const motor = await cargarMotor();
    const tmp = join(this.dir, `.escribiendo${this.extension}`);
    // El escritor de la plataforma informa por consola (cientos de celdas con fórmula propia): se silencia, salvo la lista de valores que NO escribió.
    const { info, warn } = console;
    const rechazados = [];
    console.info = () => {};
    console.warn = (msg, ...resto) => {
      if (String(msg).includes('no se escribieron') && Array.isArray(resto[0])) rechazados.push(...resto[0]);
    };
    let r;
    try {
      r = await motor.escribirFicha({ formato: this.formato, plantilla: leerJson(this.plantilla), valores: this.valores, salida: tmp });
    } finally {
      console.info = info;
      console.warn = warn;
    }
    renameSync(tmp, this.rutaExcel);
    const idPorCelda = this.idsPorCelda();
    const avisos = [...r.avisos];
    for (const x of rechazados) {
      const m = String(x).match(/^(.*)!([A-Z]+\d+)="(.*)"$/s);
      if (m) avisos.push({ campo: idPorCelda.get(`${m[1]}!${m[2]}`) ?? '', celda: `${m[1]}!${m[2]}`, valor: m[3] });
    }
    return { ...r, avisos };
  }

  /** Anota como advertencias los valores que el Excel no aceptó (una sola vez cada uno: cada reescritura vuelve a informar los anteriores). */
  anotarAvisosExcel(avisos) {
    for (const a of avisos) {
      const identificador = a.campo || a.celda;
      const mensaje = `El Excel no aceptó «${String(a.valor).slice(0, 60)}» en ${a.celda} por no estar entre las opciones de su desplegable.`;
      if (!this.advertencias.some((x) => x.identificador === identificador && x.mensaje === mensaje)) this.advertencias.push({ ambito: 'campo', identificador, mensaje });
    }
  }

  /** hoja!celda → identificador de los campos simples (para decir de qué campo habla un aviso del Excel). */
  idsPorCelda() {
    if (this._idsPorCelda) return this._idsPorCelda;
    const m = new Map();
    for (const sec of leerJson(this.plantilla).secciones ?? []) {
      for (const sub of sec.subsecciones ?? []) {
        for (const c of sub.campos ?? []) {
          if (c.tipo !== 'tabla' && c.tipo !== 'tabla_jerarquica' && c.captura?.columna && c.captura.fila) m.set(`${sec.hoja}!${String(c.captura.columna).toUpperCase()}${c.captura.fila}`, c.identificador);
        }
      }
    }
    return (this._idsPorCelda = m);
  }

  /**
   * Guarda los campos de texto de una sección ya validados: los acumula y reescribe el Excel.
   * @returns {{campos: object[], advertencias: object[], avisosExcel: object[]}}
   */
  async guardarCampos(seccionId, brutoOCampos, { yaValidado = false } = {}) {
    const seccion = this.paq.secciones.find((s) => s.id === seccionId);
    if (!seccion) throw new ErrorRespuesta(`La sección «${seccionId}» no existe en el paquete.`);
    const validado = yaValidado ? { campos: brutoOCampos, advertencias: [] } : validarCampos(brutoOCampos, seccion, this.paq.modo);
    const { advertencias } = validado;
    let { campos } = validado;
    this.recargar();
    // Si la IA reenvía solo algunos campos para corregirlos, los demás conservan lo que ya había (validarCampos devuelve uno por campo esperado, vacío si no vino).
    const previos = this.res.campos.get(seccionId);
    if (previos && !yaValidado) {
      const lista = Array.isArray(brutoOCampos) ? brutoOCampos : brutoOCampos?.campos;
      const enviados = new Set((lista ?? []).filter((c) => c && c.id != null).map((c) => String(c.id).trim()));
      campos = campos.map((c) => (enviados.has(c.id) ? c : previos.find((p) => p.id === c.id) ?? c));
    }
    this.res.campos.set(seccionId, campos);
    this.advertencias.push(...advertencias);
    for (const c of campos) {
      if (c.valor_propuesto) this.valores[c.id] = c.valor_propuesto;
      else delete this.valores[c.id];
    }
    this.persistir();
    const { avisos } = await this.escribirExcel();
    this.anotarAvisosExcel(avisos);
    this.persistir();
    return { campos, advertencias, avisosExcel: avisos };
  }

  /**
   * Valida y guarda tablas. Las que no sirven NO se guardan y se devuelven con el motivo (la IA puede corregirlas y volver a enviarlas).
   * @param {{identificador: string, valor: *, fuente?: string}[]} lista
   * @param {string[]} [permitidas]  ids que esta solicitud puede llenar; cualquier otro se rechaza
   */
  async guardarTablas(lista, permitidas) {
    const conocidas = new Map(this.paq.secciones.flatMap((s) => s.tablas.map((t) => [t.id, t])));
    const aceptadas = [];
    const rechazadas = [];
    const advertencias = [];
    for (const e of lista) {
      const id = String(e?.identificador ?? '').trim();
      const tb = conocidas.get(id);
      if (!tb) { rechazadas.push({ identificador: id, motivo: `La tabla «${id}» no existe en el paquete.` }); continue; }
      if (permitidas && !permitidas.includes(id)) { rechazadas.push({ identificador: id, motivo: `La tabla «${id}» no es de esta solicitud (las de ahora: ${permitidas.join(', ')}).` }); continue; }
      try {
        const { valor, advertencias: adv } = validarTabla(e, tb);
        aceptadas.push({ id, valor, fuente: String(e.fuente ?? '').trim() });
        advertencias.push(...adv);
      } catch (err) {
        if (!(err instanceof ErrorRespuesta)) throw err;
        rechazadas.push({ identificador: id, motivo: err.message });
      }
    }
    let avisosExcel = [];
    if (aceptadas.length) {
      this.recargar();
      this.advertencias.push(...advertencias);
      for (const a of aceptadas) {
        this.res.tablas.set(a.id, { valor: a.valor, fuente: a.fuente });
        this.valores[a.id] = JSON.stringify(a.valor);
      }
      this.persistir();
      avisosExcel = (await this.escribirExcel()).avisos;
      this.anotarAvisosExcel(avisosExcel);
      this.persistir();
    }
    return { aceptadas, rechazadas, advertencias, avisosExcel };
  }

  /** Lo que el Excel contiene de verdad ahora (leído con el volcado de la plataforma): para comprobar y mostrar a la IA. */
  async leerDelExcel(seccionesIds) {
    if (!this.disponible || !existsSync(this.rutaExcel)) return { valores: {} };
    const motor = await cargarMotor();
    return motor.volcarFicha({ excel: this.rutaExcel, excelEstructura: this.formato, plantilla: leerJson(this.plantilla), seccionesIds });
  }

  /** Deja constancia de cada entrega de la IA (entrada y respuesta de la herramienta) para el diagnóstico. */
  registrar(herramienta, entrada, informe) {
    try {
      appendFileSync(this.rutaRegistro, JSON.stringify({ t: new Date().toISOString(), herramienta, entrada, informe }) + '\n');
    } catch { /* el registro nunca debe tumbar el llenado */ }
  }

  /** Entregas registradas desde la n-ésima (para copiarlas al diagnóstico). */
  leerRegistro(desde = 0) {
    if (!existsSync(this.rutaRegistro)) return [];
    return readFileSync(this.rutaRegistro, 'utf8').split('\n').filter(Boolean).slice(desde).map((l) => JSON.parse(l));
  }

  async ver(hoja, rango) {
    if (!this.disponible) return 'Este paquete no trae el Excel en blanco (02_estructura_base/formato_base.xlsx).';
    const motor = await cargarMotor();
    const excel = existsSync(this.rutaExcel) ? this.rutaExcel : this.formato;
    return motor.verHoja({ excel, hoja, rango });
  }
}
