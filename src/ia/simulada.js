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

    async resolver(unidad, paq, { signal }) {
      await espera(config.simulada.demoraMs, signal);
      const valores = paq.ejemplo.json?.valores ?? {};
      const fuentes = paq.ejemplo.json?.fuentes && !Array.isArray(paq.ejemplo.json.fuentes) ? paq.ejemplo.json.fuentes : {};
      const uso = { llamadas: 1, tokens_entrada: 0, tokens_salida: 0, costo_usd_referencial: 0 };

      if (unidad.tipo === 'campos') {
        const campos = unidad.seccion.campos.map((def) => {
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
