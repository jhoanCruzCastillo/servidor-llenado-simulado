/**
 * Textos que las herramientas de llenado devuelven a la IA: qué quedó escrito en el Excel, qué se descartó y qué falta.
 * Se comprueba contra el Excel releído con el volcado de la plataforma, no contra lo que la IA dijo haber enviado.
 */

const lista = (xs, max = 12) => xs.slice(0, max).join(', ') + (xs.length > max ? ` … (+${xs.length - max})` : '');

/** @param {import('./sesion.js').Sesion} sesion */
export async function informeCampos(sesion, seccionId, r) {
  const conValor = r.campos.filter((c) => c.valor_propuesto);
  const sinValor = r.campos.filter((c) => !c.valor_propuesto);
  const lineas = [`Guardados ${conValor.length} de ${r.campos.length} campos de la sección en el Excel.`];
  if (sinValor.length) lineas.push(`Sin valor (no_encontrado o descartados): ${lista(sinValor.map((c) => c.id))}.`);
  for (const a of r.advertencias.slice(0, 15)) lineas.push(`- ${a.identificador}: ${a.mensaje}`);
  if (r.avisosExcel.length) {
    lineas.push(`El Excel NO aceptó ${r.avisosExcel.length} valor(es) por no estar en su desplegable; revisa las opciones con ver_hoja y vuelve a enviarlos:`);
    for (const a of r.avisosExcel.slice(0, 10)) lineas.push(`- ${a.campo ? `${a.campo} · ` : ""}${a.celda}: «${String(a.valor).slice(0, 60)}»`);
  }
  try {
    const leido = await sesion.leerDelExcel([seccionId]);
    const ausentes = conValor.filter((c) => !(c.id in (leido.valores ?? {})));
    if (ausentes.length) lineas.push(`No aparecen al releer el Excel (celda calculada por fórmula o fuera del formato): ${lista(ausentes.map((c) => c.id))}.`);
  } catch (e) {
    lineas.push(`(No se pudo releer el Excel para comprobarlo: ${String(e.message).slice(0, 120)}.)`);
  }
  lineas.push('Si todo es correcto, termina. Si corriges algo, vuelve a llamar solo con los campos que cambian.');
  return lineas.join('\n');
}

/** @param {import('./sesion.js').Sesion} sesion */
export async function informeTablas(sesion, unidad, r) {
  const lineas = [];
  if (r.aceptadas.length) lineas.push(`Guardadas en el Excel: ${r.aceptadas.map((a) => `${a.id} (${Array.isArray(a.valor) ? a.valor.length : 0} filas)`).join(', ')}.`);
  for (const x of r.rechazadas) lineas.push(`RECHAZADA ${x.identificador}: ${x.motivo}`);
  for (const a of r.advertencias.slice(0, 10)) lineas.push(`- ${a.identificador}: ${a.mensaje}`);
  if (r.avisosExcel.length) {
    lineas.push(`El Excel NO aceptó ${r.avisosExcel.length} valor(es) por no estar en su desplegable:`);
    for (const a of r.avisosExcel.slice(0, 10)) lineas.push(`- ${a.campo ? `${a.campo} · ` : ""}${a.celda}: «${String(a.valor).slice(0, 60)}»`);
  }
  sesion.recargar();
  const pendientes = (unidad.tablas ?? []).filter((id) => !sesion.res.tablas.has(id));
  lineas.push(pendientes.length ? `Faltan por entregar de esta solicitud: ${pendientes.join(', ')}.` : 'Ya están entregadas todas las tablas de esta solicitud. Termina.');
  return lineas.join('\n');
}
