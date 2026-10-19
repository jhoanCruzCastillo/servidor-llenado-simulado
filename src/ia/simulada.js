/**
 * IA "simulada": no llama a ninguna IA. Responde cada unidad con los valores del ejemplo de referencia del propio paquete
 * (03_ejemplo_referencia/ejemplo.json). Sirve para probar todo el flujo (estado, porcentaje, validación, zip de resultado,
 * integración con la plataforma) sin gastar cuota de la suscripción.
 */
import { config } from '../config.js';

const espera = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Cancelado.'), { codigo: 'cancelado' })); }, { once: true });
  });

export function crearIASimulada() {
  return {
    nombre: 'simulada (valores del ejemplo de referencia)',
    proveedor: 'simulada',
    modelo: 'ejemplo-de-referencia',
    preparar: () => ({}),

    async resolver(unidad, paq, { signal, datosUsuario = [], simulacion = null, puedePreguntar = false }) {
      await espera(config.simulada.demoraMs, signal);
      const valores = paq.ejemplo.json?.valores ?? {};
      const fuentes = paq.ejemplo.json?.fuentes && !Array.isArray(paq.ejemplo.json.fuentes) ? paq.ejemplo.json.fuentes : {};
      const uso = { llamadas: 1, tokens_entrada: 0, tokens_salida: 0, costo_usd_referencial: 0 };

      if (unidad.tipo === 'campos') {
        // Para probar la pausa: con metadata.simulacion.preguntar_en = ["01", …] pregunta UNA vez en esas secciones (el pipeline solo la acepta si el trabajo
        // trae puede_preguntar). Con la respuesta de la persona ya recibida, la usa como valor del primer campo para poder comprobar que llegó a la ficha.
        const primero = unidad.seccion.campos[0];
        // Los números de sección pueden venir como "1" o "01": se comparan sin ceros a la izquierda (igual que el filtro de la simulación).
        const normNum = (x) => (/^\d+$/.test(String(x)) ? String(Number(x)) : String(x));
        const aqui = (simulacion?.preguntar_en ?? []).map(normNum).includes(normNum(unidad.seccion.numero)) && !!primero;
        const pregunta = aqui ? datosUsuario.find((d) => d.seccion_id === unidad.seccion.id) : undefined;
        const preguntar = puedePreguntar && aqui && !pregunta;
        if (preguntar) {
          return {
            bruto: { preguntas: [{ pregunta: `Prueba: ¿qué valor va en «${primero.etiqueta}»?`, motivo: 'Dato que no consta en los documentos.', campo_ids: [primero.identificador], opciones: Array.isArray(primero.opciones) ? primero.opciones : [] }] },
            uso,
          };
        }
        const campos = unidad.seccion.campos.map((def) => {
          if (pregunta?.respuesta && def.identificador === primero.identificador) {
            return { id: def.identificador, valor_propuesto: String(pregunta.respuesta), estado: 'extraido', confianza: 1, fuente: 'Respuesta de la persona', evidencia: '' };
          }
          const v = valores[def.identificador];
          const lleno = v !== undefined && v !== null && typeof v !== 'object' && String(v).trim() !== '';
          return lleno
            ? { id: def.identificador, valor_propuesto: String(v), estado: 'extraido', confianza: 0.95, fuente: String(fuentes[def.identificador] ?? 'Ficha de referencia del paquete'), evidencia: '' }
            : { id: def.identificador, valor_propuesto: null, estado: 'no_encontrado', confianza: 0, fuente: '', evidencia: '' };
        });
        return { bruto: { seccion_id: unidad.seccion.id, campos }, uso };
      }

      const tablas = unidad.tablas.map((t) => {
        let v = valores[t.id];
        if (typeof v === 'string') {
          try { v = JSON.parse(v); } catch { v = null; }
        }
        const lleno = Array.isArray(v) && v.length > 0;
        return { identificador: t.id, valor: lleno ? v : t.base, fuente: lleno ? String(fuentes[t.id] ?? 'Ficha de referencia del paquete') : '' };
      });
      return { bruto: { tablas }, uso };
    },
  };
}
