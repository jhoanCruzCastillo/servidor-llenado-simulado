/**
 * Ejecución de un trabajo: recorre el paquete por unidades (campos de una sección / lote de tablas), se las da a la IA,
 * valida y acumula lo aceptado, reporta el avance y al final ensambla el zip de resultado.
 * Estrategia recomendada en docs/servidor-llenado-externo/02_PAQUETE_QUE_ENVIAMOS.md §4.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { ErrorIA } from './ia/claude.js';
import { ensamblar } from './resultado.js';
import { ahora, dirDe, guardar } from './store.js';
import { cargarPaquete } from './paquete.js';
import { ErrorRespuesta, validarCampos, validarTabla } from './validar.js';
import { notificar } from './webhook.js';

const controles = new Map();
export const cancelarEjecucion = (id) => controles.get(id)?.abort();
export const enEjecucion = (id) => controles.has(id);

const dormir = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Cancelado.'), { codigo: 'cancelado' })); }, { once: true });
  });

function crearLog(t) {
  const archivo = join(dirDe(t.id), 'log.ndjson');
  return (evento, datos = {}) => {
    const linea = { t: ahora(), evento, ...datos };
    try { appendFileSync(archivo, JSON.stringify(linea) + '\n'); } catch { /* el log nunca debe tumbar el trabajo */ }
    console.log(`[${t.id}] ${evento}${Object.keys(datos).length ? ' ' + JSON.stringify(datos) : ''}`);
  };
}

/** Construye las unidades de trabajo en el orden del paquete: por sección, primero sus campos y luego sus tablas en lotes. */
function construirUnidades(paq) {
  const unidades = [];
  for (const sec of paq.secciones) {
    if (sec.campos.length > 0) unidades.push({ tipo: 'campos', seccion: sec });
    let lote = [];
    let chars = 0;
    const cerrar = () => { if (lote.length) unidades.push({ tipo: 'tablas', seccion: sec, tablas: lote }); lote = []; chars = 0; };
    for (const tb of sec.tablas) {
      if (tb.grande) { cerrar(); unidades.push({ tipo: 'tablas', seccion: sec, tablas: [tb] }); continue; }
      if (lote.length >= config.tablasPorLlamada || chars + tb.md.length > config.maxCaracteresPorLlamada) cerrar();
      lote.push(tb);
      chars += tb.md.length;
    }
    cerrar();
  }
  return unidades;
}

/** Líneas «id (etiqueta): valor» de lo ya fijado, para que las secciones siguientes mantengan coherencia. */
function lineasDeCoherencia(sec, campos) {
  return campos
    .filter((c) => c.valor_propuesto && ['extraido', 'requiere_confirmacion'].includes(c.estado))
    .map((c) => `- ${c.id} (${(sec.campos.find((d) => d.identificador === c.id)?.etiqueta ?? '').slice(0, 70)}): ${c.valor_propuesto.slice(0, 160)}`);
}

export async function ejecutar(t, ia) {
  const ctl = new AbortController();
  controles.set(t.id, ctl);
  const log = crearLog(t);
  const salida = join(dirDe(t.id), 'salida');
  mkdirSync(salida, { recursive: true });
  const res = { campos: new Map(), tablas: new Map() };
  const sec = (id) => t.secciones.find((s) => s.id === id);
  const avisar = (a) => { t.advertencias.push(a); };
  let coherencia = [];
  let llamadas = 0;

  const sumarUso = (u) => {
    const k = `${ia.proveedor}/${ia.modelo}`;
    const a = (t.uso[k] ??= { proveedor: ia.proveedor, modelo: ia.modelo, llamadas: 0, tokens_entrada: 0, tokens_salida: 0 });
    a.llamadas += u.llamadas ?? 0;
    a.tokens_entrada += u.tokens_entrada ?? 0;
    a.tokens_salida += u.tokens_salida ?? 0;
  };

  /** Una llamada a la IA con reintentos. Devuelve lo que `validar` acepte; ErrorRespuesta agotado se relanza para que la unidad lo trate. */
  async function llamarIA(unidad, paq, preparado, validar, correccionInicial = '') {
    let correccion = correccionInicial;
    let ultimo;
    for (let intento = 0; intento <= config.reintentos; intento++) {
      if (ctl.signal.aborted) throw Object.assign(new Error('Cancelado.'), { codigo: 'cancelado' });
      try {
        llamadas++;
        const { bruto, uso, reparado } = await ia.resolver(unidad, paq, { coherencia: coherencia.join('\n').slice(0, 6000), correccion, signal: ctl.signal, preparado });
        sumarUso(uso);
        if (reparado) log('json_reparado', { seccion: unidad.seccion.numero, tipo: unidad.tipo });
        writeFileSync(join(salida, `${String(llamadas).padStart(3, '0')}_${unidad.seccion.numero}_${unidad.tipo}.json`), JSON.stringify(bruto, null, 2));
        return validar(bruto);
      } catch (e) {
        if (ctl.signal.aborted || e.codigo === 'cancelado') throw Object.assign(new Error('Cancelado.'), { codigo: 'cancelado' });
        ultimo = e;
        if (e instanceof ErrorRespuesta) { correccion = e.message; log('respuesta_invalida', { seccion: unidad.seccion.numero, intento, motivo: e.message.slice(0, 200) }); continue; }
        if (e instanceof ErrorIA && e.reintentable && e.codigo !== 'limite_de_uso_ia') {
          const espera = 5000 * 2 ** intento;
          log('ia_reintento', { codigo: e.codigo, intento, espera_ms: espera, detalle: String(e.detalle ?? e.message).slice(0, 300) });
          await dormir(espera, ctl.signal);
          continue;
        }
        throw e;
      }
    }
    throw ultimo;
  }

  try {
    t.estado = 'procesando';
    t.iniciado_en = ahora();
    t.etapa = 'validando_paquete';
    t.mensaje = 'Leyendo el paquete…';
    guardar(t);

    const paq = cargarPaquete(t.rutaRaiz, t.manifiesto);
    t.etapa = 'analizando_documentos';
    t.mensaje = 'Analizando los documentos del proyecto…';
    guardar(t);
    const preparado = ia.preparar(paq, dirDe(t.id));
    log('inicio', { ia: ia.nombre, secciones: paq.secciones.length, modo: paq.modo });

    // Los números de sección pueden venir como "2" o "02" según la plantilla: se comparan sin ceros a la izquierda.
    const normNum = (x) => (/^\d+$/.test(String(x)) ? String(Number(x)) : String(x));
    const filtro = t.simulacion?.secciones ? new Set(t.simulacion.secciones.map(normNum)) : null;
    const maxLlamadas = t.simulacion?.max_unidades ?? Infinity;
    const unidades = construirUnidades(paq);

    // Cuántas unidades le quedan a cada sección, para saber cuándo cierra.
    const pendientes = new Map();
    for (const u of unidades) pendientes.set(u.seccion.id, (pendientes.get(u.seccion.id) ?? 0) + 1);

    for (const unidad of unidades) {
      if (ctl.signal.aborted) throw Object.assign(new Error('Cancelado.'), { codigo: 'cancelado' });
      const st = sec(unidad.seccion.id);
      const omitir = (filtro && !filtro.has(normNum(unidad.seccion.numero))) || llamadas >= maxLlamadas;

      if (st.estado === 'pendiente') { st.estado = omitir ? 'omitida' : 'en_curso'; }
      t.seccionActualId = st.id;

      if (omitir) {
        // Simulación acotada (para no gastar cuota): la unidad se da por resuelta sin llenar.
        if (unidad.tipo === 'campos') st.campos_completados = st.campos_totales;
        else st.tablas_completadas += unidad.tablas.length;
        if (st.estado !== 'omitida') st.omitidas = (st.omitidas ?? 0) + 1;
        t.nota = 'Llenado ACOTADO por la simulación (metadata.simulacion): hay secciones/tablas sin llenar a propósito.';
      } else if (unidad.tipo === 'campos') {
        t.etapa = 'llenando_secciones';
        t.mensaje = `Procesando «${st.nombre}» — ${st.campos_totales} campos de texto`;
        guardar(t);
        try {
          const { campos, advertencias } = await llamarIA(unidad, paq, preparado, (b) => validarCampos(b, unidad.seccion, paq.modo));
          res.campos.set(unidad.seccion.id, campos);
          advertencias.forEach(avisar);
          coherencia.push(...lineasDeCoherencia(unidad.seccion, campos));
        } catch (e) {
          if (!(e instanceof ErrorRespuesta)) throw e;
          avisar({ ambito: 'seccion', identificador: unidad.seccion.numero, mensaje: `No se pudo obtener una respuesta válida para los campos de texto: ${e.message.slice(0, 200)}` });
          st.fallos = (st.fallos ?? 0) + 1;
        }
        st.campos_completados = st.campos_totales;
      } else {
        t.etapa = 'llenando_tablas';
        let pend = unidad.tablas;
        let motivo = '';
        for (let ronda = 0; ronda <= config.reintentos && pend.length > 0; ronda++) {
          const primera = st.tablas_completadas + 1;
          t.mensaje = `Procesando «${st.nombre}» — tabla${pend.length > 1 ? 's' : ''} ${primera}${pend.length > 1 ? `–${primera + pend.length - 1}` : ''} de ${st.tablas_totales}`;
          guardar(t);
          const lote = { ...unidad, tablas: pend };
          let aceptadas;
          try {
            aceptadas = await llamarIA(lote, paq, preparado, (b) => {
              const lista = Array.isArray(b) ? b : b?.tablas;
              if (!Array.isArray(lista)) throw new ErrorRespuesta('Falta el arreglo «tablas» en la respuesta.');
              return lista;
            }, motivo);
          } catch (e) {
            if (!(e instanceof ErrorRespuesta)) throw e;
            motivo = e.message; // la estructura general no sirvió ni tras los reintentos de llamarIA: las tablas quedan sin llenar
            break;
          }
          const fallidas = [];
          const motivos = [];
          for (const tb of pend) {
            const e = aceptadas.find((x) => String(x?.identificador) === tb.id);
            try {
              if (!e) throw new ErrorRespuesta(`Tabla ${tb.id}: no vino en la respuesta.`);
              const { valor, advertencias } = validarTabla(e, tb);
              res.tablas.set(tb.id, { valor, fuente: String(e.fuente ?? '').trim() });
              advertencias.forEach(avisar);
              st.tablas_completadas++;
            } catch (err) {
              if (!(err instanceof ErrorRespuesta)) throw err;
              fallidas.push(tb);
              motivos.push(err.message);
            }
          }
          pend = fallidas;
          motivo = motivos.join(' ');
          guardar(t);
        }
        for (const tb of pend) {
          avisar({ ambito: 'tabla', identificador: tb.id, mensaje: `No se obtuvo una respuesta válida tras ${config.reintentos + 1} intentos; se deja la tabla en su estado base. ${motivo.slice(0, 160)}` });
          st.fallos = (st.fallos ?? 0) + 1;
          st.tablas_completadas++;
        }
      }

      // ¿Terminó la sección?
      pendientes.set(unidad.seccion.id, pendientes.get(unidad.seccion.id) - 1);
      if (pendientes.get(unidad.seccion.id) === 0) {
        if (st.estado !== 'omitida') st.estado = st.fallos ? 'con_errores' : 'completada';
        if (st.estado === 'omitida') avisar({ ambito: 'seccion', identificador: st.numero, mensaje: 'Sección omitida por el límite de la simulación.' });
        else if (st.omitidas) avisar({ ambito: 'seccion', identificador: st.numero, mensaje: `${st.omitidas} bloque(s) de la sección quedaron sin llenar por el límite de la simulación.` });
      }
      guardar(t);
    }

    // Ensamblado y publicación (el estado solo pasa a «completado» cuando el zip ya es descargable).
    t.seccionActualId = null;
    t.etapa = 'ensamblando_resultado';
    t.mensaje = 'Armando el archivo de resultado…';
    guardar(t);
    const out = ensamblar(t, paq, res);
    t.tokenDescarga = out.tokenDescarga;
    t.resultado = out.resultado;
    t.estado = 'completado';
    t.etapa = 'finalizado';
    t.mensaje = 'Listo.';
    t.terminado_en = ahora();
    log('completado', { bytes: out.resultado.bytes, llamadas, advertencias: t.advertencias.length });
  } catch (e) {
    t.seccionActualId = null;
    t.terminado_en = ahora();
    if (e.codigo === 'cancelado' || ctl.signal.aborted) {
      t.estado = 'cancelado';
      t.mensaje = 'Llenado cancelado.';
      log('cancelado');
    } else {
      const ia_ = e instanceof ErrorIA;
      t.estado = 'error';
      t.error = {
        codigo: ia_ ? e.codigo : e instanceof ErrorRespuesta ? 'respuesta_invalida' : 'interno',
        mensaje: ia_ || e instanceof ErrorRespuesta ? e.message : 'Fallo inesperado del servidor de llenado.',
        reintentable: ia_ ? e.reintentable : true,
        detalle: ia_ ? e.detalle : String(e.stack ?? e).slice(0, 600),
      };
      t.mensaje = t.error.mensaje.slice(0, 200);
      log('error', { codigo: t.error.codigo, mensaje: t.error.mensaje, detalle: t.error.detalle });
    }
  } finally {
    controles.delete(t.id);
    guardar(t);
    notificar(t).catch(() => {});
  }
}
