/**
 * Arma el zip de resultado (contrato 03): respuesta.json + resumen.json (+ ficha_llenada.xlsx/.xlsm si se pudo).
 */
import AdmZip from 'adm-zip';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { config } from './config.js';
import { ahora, dirDe } from './store.js';

const json = (o) => JSON.stringify(o, null, 2) + '\n';

/**
 * @param {object} t    trabajo
 * @param {object} paq  paquete cargado
 * @param {{campos: Map<string, object[]>, tablas: Map<string, object>}} res  resultados ya validados
 */
export function ensamblar(t, paq, res) {
  const m = paq.manifiesto;
  const eco = { carpeta_raiz: m.carpeta_raiz, ficha_id: m.ficha.id, plantilla_codigo: m.plantilla.codigo, version_paquete: m.version_paquete };

  // Una entrada por cada sección con campos y, en ella, TODOS sus campos; una entrada por cada tabla del paquete.
  const secciones = paq.secciones
    .filter((s) => s.campos.length > 0)
    .map((s) => ({
      seccion_id: s.id,
      campos: res.campos.get(s.id) ?? s.campos.map((c) => ({ id: c.identificador, valor_propuesto: null, estado: 'no_encontrado', confianza: 0, fuente: '', evidencia: '' })),
    }));
  const tablas = paq.secciones.flatMap((s) =>
    s.tablas.map((tb) => {
      const r = res.tablas.get(tb.id);
      return { identificador: tb.id, valor: r?.valor ?? tb.base, fuente: r?.fuente ?? '' };
    }),
  );

  const cont = { total: 0, extraido: 0, inferido: 0, requiere_confirmacion: 0, conflictivo: 0, no_encontrado: 0 };
  for (const s of secciones) {
    for (const c of s.campos) {
      cont.total++;
      cont[c.estado] = (cont[c.estado] ?? 0) + 1;
    }
  }
  const sinCambios = tablas.filter((x) => !res.tablas.has(x.identificador)).length;

  // Excel: solo con la IA simulada, donde el resultado ES el ejemplo de referencia y su Excel es coherente con él.
  const usaExcelDelEjemplo = config.ia === 'simulada' && paq.ejemplo.excel;
  const extExcel = usaExcelDelEjemplo ? extname(paq.ejemplo.excel) : null;
  const excel = usaExcelDelEjemplo
    ? { incluido: true, archivo: `ficha_llenada${extExcel}`, basado_en: `02_estructura_base/formato_base${extExcel}`, nota: 'Simulación: es el Excel del ejemplo de referencia del paquete.' }
    : { incluido: false, motivo: 'Este servidor simulado todavía no escribe el Excel; la plataforma aplica respuesta.json.' };

  const usoPorModelo = Object.values(t.uso ?? {});
  const resumen = {
    version_resultado: '1.0',
    trabajo_id: t.id,
    paquete: eco,
    generado_en: ahora(),
    duracion_segundos: Math.max(0, Math.round((Date.now() - Date.parse(t.iniciado_en ?? t.creado_en)) / 1000)),
    modelos: usoPorModelo,
    conteos: {
      secciones_con_campos: secciones.length,
      campos_texto: cont,
      tablas_entregadas: tablas.length,
      tablas_sin_cambios_respecto_al_formato: sinCambios,
    },
    excel,
    advertencias: (t.advertencias ?? []).slice(0, 500),
  };
  if (t.nota) resumen.nota = t.nota;

  const raiz = `resultado-llenado-ia_${t.id}`;
  const zip = new AdmZip();
  zip.addFile(`${raiz}/respuesta.json`, Buffer.from(json({ version_respuesta: '1.0', paquete: eco, secciones, tablas }), 'utf8'));
  zip.addFile(`${raiz}/resumen.json`, Buffer.from(json(resumen), 'utf8'));
  if (usaExcelDelEjemplo) zip.addLocalFile(paq.ejemplo.excel, raiz, `ficha_llenada${extExcel}`);

  const ruta = join(dirDe(t.id), 'resultado.zip');
  zip.writeZip(ruta);
  const buf = readFileSync(ruta);
  const token = randomBytes(16).toString('hex');
  return {
    ruta,
    tokenDescarga: token,
    resultado: {
      url: `${config.urlPublica}/descargas/${t.id}/${token}/resultado.zip`,
      formato: 'zip',
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
      expira_en: new Date(Date.now() + config.expiraResultadoHoras * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      requiere_autorizacion: false,
    },
  };
}

export const tamano = (ruta) => statSync(ruta).size;
export const leer = (ruta) => createReadStream(ruta);
