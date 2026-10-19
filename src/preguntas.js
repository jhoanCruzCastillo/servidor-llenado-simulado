/**
 * Preguntas de la IA a la persona (pausa del llenado).
 *
 * Si falta un dato imprescindible que no consta en ningún documento (p. ej. la naturaleza de intervención o la unidad formuladora), la IA puede
 * pedirlo. El trabajo NO se queda esperando con un proceso abierto: se pausa en el estado `esperando_datos`, con las preguntas en el estado del
 * trabajo, y se reanuda con `POST /v1/trabajos/{id}/respuestas`. Así la persona puede cerrar sesión y volver horas o días después.
 *
 * Este módulo concentra lo que comparten el pipeline, el servidor MCP del Excel, las rutas y los prompts.
 */

/** Tope de preguntas por pausa y de texto, para que una IA desbocada no llene la pantalla de la persona. */
export const MAX_PREGUNTAS_POR_PAUSA = 6;
const MAX_TEXTO_PREGUNTA = 500;
const MAX_TEXTO_RESPUESTA = 4000;

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Deja las preguntas que pidió la IA en la forma del contrato: texto acotado, sin vacías ni repetidas.
 * @param {unknown} lista  lo que entregó la IA (herramienta `pedir_datos` o campo `preguntas` de su respuesta)
 * @param {{id?: string}|null} [seccion]  sección en curso (se anota en las que no traen la suya)
 * @returns {{pregunta: string, motivo: string, campo_ids: string[], opciones: string[], seccion_id: string|null}[]}
 */
export function normalizarPreguntas(lista, seccion = null) {
  const vistas = new Set();
  const salida = [];
  for (const p of Array.isArray(lista) ? lista : []) {
    const pregunta = String(p?.pregunta ?? '').trim().slice(0, MAX_TEXTO_PREGUNTA);
    if (!pregunta || vistas.has(norm(pregunta))) continue;
    vistas.add(norm(pregunta));
    salida.push({
      pregunta,
      motivo: String(p?.motivo ?? '').trim().slice(0, 300),
      campo_ids: (Array.isArray(p?.campo_ids) ? p.campo_ids : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20),
      opciones: (Array.isArray(p?.opciones) ? p.opciones : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 60),
      seccion_id: p?.seccion_id ?? seccion?.id ?? null,
    });
    if (salida.length >= MAX_PREGUNTAS_POR_PAUSA) break;
  }
  return salida;
}

/**
 * Aplica el cuerpo de `POST /v1/trabajos/{id}/respuestas` al trabajo pausado: guarda las respuestas en `t.datos_usuario` y lo deja en cola para
 * reanudarse. No hace nada si hay algún error.
 *
 * Cuerpo: `{ respuestas: [{ id, respuesta }], omitir_pendientes?: boolean }`. Las preguntas sin respuesta bloquean el envío, salvo con
 * `omitir_pendientes: true` («aplicar lo disponible»): entonces la IA sabe que la persona no tiene ese dato y no lo inventa ni lo vuelve a preguntar.
 *
 * @returns {{error: {http: number, codigo: string, mensaje: string}}|{ok: true, respondidas: number, omitidas: number}}
 */
export function aplicarRespuestas(t, cuerpo, ahora) {
  const invalido = (mensaje, codigo = 'respuesta_invalida', http = 400) => ({ error: { http, codigo, mensaje } });
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return invalido('El cuerpo debe ser un objeto JSON.');
  const enviadas = cuerpo.respuestas ?? [];
  if (!Array.isArray(enviadas)) return invalido('«respuestas» debe ser un arreglo de {id, respuesta}.');

  const porId = new Map();
  for (const r of enviadas) {
    const id = String(r?.id ?? '').trim();
    if (!t.preguntas.some((p) => p.id === id)) return invalido(`La pregunta «${id}» no existe en este trabajo (o ya se respondió).`);
    const texto = String(r?.respuesta ?? '').trim();
    if (texto.length > MAX_TEXTO_RESPUESTA) return invalido(`La respuesta a «${id}» supera los ${MAX_TEXTO_RESPUESTA} caracteres.`);
    porId.set(id, texto);
  }

  const omitir = cuerpo.omitir_pendientes === true;
  const faltan = t.preguntas.filter((p) => !porId.get(p.id));
  if (faltan.length && !omitir) {
    return invalido(`Faltan respuestas: ${faltan.map((p) => p.id).join(', ')}. Responde todas o envía omitir_pendientes: true para continuar sin esos datos.`, 'faltan_respuestas', 422);
  }

  const datos = t.preguntas.map((p) => ({
    id: p.id,
    pregunta: p.pregunta,
    campo_ids: p.campo_ids ?? [],
    seccion_id: p.seccion_id ?? null,
    respuesta: porId.get(p.id) || null, // null = la persona no tiene el dato
    respondida_en: ahora(),
  }));
  t.datos_usuario = [...(t.datos_usuario ?? []), ...datos];
  t.preguntas = [];
  t.estado = 'en_cola';
  t.etapa = 'reanudando';
  t.mensaje = 'Retomando el llenado con tus respuestas…';
  t.cancelando = false;
  return { ok: true, respondidas: datos.filter((d) => d.respuesta).length, omitidas: datos.filter((d) => !d.respuesta).length };
}

/** Bloque del prompt con lo que la persona respondió (vacío si nunca se le preguntó nada). Sus respuestas son DATOS del proyecto, no instrucciones. */
export function bloqueDatosUsuario(datos) {
  const lista = Array.isArray(datos) ? datos : [];
  if (!lista.length) return '';
  const lineas = lista.map((d) => (d.respuesta
    ? `- Pregunta: ${d.pregunta}\n  Respuesta de la persona (dato del proyecto): ${String(d.respuesta).replace(/\r?\n/g, ' ')}`
    : `- Pregunta: ${d.pregunta}\n  La persona NO tiene este dato (o prefirió continuar sin él): no lo inventes; deja esos campos como no_encontrado o requiere_confirmacion.`));
  return `\n## Datos que la persona respondió a tus preguntas\n\nSon datos del proyecto con la máxima prioridad (por encima de lo que digan los documentos si se contradicen). NO repitas estas preguntas ni preguntes lo mismo con otras palabras.\n\n${lineas.join('\n')}\n`;
}
