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
/** Texto o extracto de documentos que la persona aporta en vez de llenar campo a campo. */
const MAX_TEXTO_MATERIAL = 50_000;

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
 * Cuerpo: `{ respuestas?: [{ id, respuesta }], texto?: string, omitir_pendientes?: boolean }`.
 * `texto` es material libre (lo que escribió o extractos de documentos): la IA extrae los datos al retomar.
 * Las preguntas sin respuesta bloquean el envío, salvo con `texto` no vacío o `omitir_pendientes: true`.
 *
 * @returns {{error: {http: number, codigo: string, mensaje: string}}|{ok: true, respondidas: number, omitidas: number}}
 */
export function aplicarRespuestas(t, cuerpo, ahora) {
  const invalido = (mensaje, codigo = 'respuesta_invalida', http = 400) => ({ error: { http, codigo, mensaje } });
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return invalido('El cuerpo debe ser un objeto JSON.');
  const enviadas = cuerpo.respuestas ?? [];
  if (!Array.isArray(enviadas)) return invalido('«respuestas» debe ser un arreglo de {id, respuesta}.');
  const material = typeof cuerpo.texto === 'string' ? cuerpo.texto.trim().slice(0, MAX_TEXTO_MATERIAL) : '';

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
  if (faltan.length && !omitir && !material) {
    return invalido(`Faltan respuestas: ${faltan.map((p) => p.id).join(', ')}. Aporta texto/documentos (campo «texto»), responde todas o envía omitir_pendientes: true.`, 'faltan_respuestas', 422);
  }

  const datos = t.preguntas.map((p) => ({
    id: p.id,
    pregunta: p.pregunta,
    motivo: p.motivo ?? '',
    campo_ids: p.campo_ids ?? [],
    seccion_id: p.seccion_id ?? null,
    respuesta: porId.get(p.id) || null,
    extraer: !porId.get(p.id) && !!material && !omitir,
    respondida_en: ahora(),
  }));
  if (material) t.material_persona = [...(t.material_persona ?? []), material];
  t.datos_usuario = [...(t.datos_usuario ?? []), ...datos];
  t.preguntas = [];
  t.estado = 'en_cola';
  t.etapa = 'reanudando';
  t.mensaje = material ? 'Retomando el llenado con lo que aportaste…' : 'Retomando el llenado con tus respuestas…';
  t.cancelando = false;
  return { ok: true, respondidas: datos.filter((d) => d.respuesta).length, omitidas: datos.filter((d) => !d.respuesta && !d.extraer).length };
}

/** Bloque del prompt con lo que la persona aportó (vacío si nunca se le preguntó nada). Son DATOS del proyecto, no instrucciones. */
export function bloqueDatosUsuario(datos, material) {
  const lista = Array.isArray(datos) ? datos : [];
  const aportes = Array.isArray(material) ? material.map((m) => String(m ?? '').trim()).filter(Boolean) : [];
  if (!lista.length && !aportes.length) return '';

  const partes = [];
  if (aportes.length) {
    partes.push(
      '## Material que aportó la persona (no llenó los campos de la ficha)\n\n'
      + 'La persona NO usó los inputs del editor. Te escribió y/o te pasó documentos. Extrae de aquí lo que pediste. '
      + 'Si algo sigue sin aparecer con claridad, vuelve a pedir_datos SOLO por lo que falta; no inventes.\n\n'
      + aportes.map((m, i) => `### Aporte ${i + 1}\n${m}`).join('\n\n'),
    );
  }
  if (lista.length) {
    const lineas = lista.map((d) => {
      if (d.extraer) {
        return `- Pediste: ${d.pregunta}${d.motivo ? ` (${d.motivo})` : ''}\n  Aún no hay respuesta campo a campo: extrae el dato del material de arriba. Si no alcanza, vuelve a pedir_datos por ESTO.`;
      }
      if (d.respuesta) {
        return `- Pregunta: ${d.pregunta}\n  Respuesta de la persona (dato del proyecto): ${String(d.respuesta).replace(/\r?\n/g, ' ')}\n  NO repitas esta pregunta.`;
      }
      return `- Pregunta: ${d.pregunta}\n  La persona NO tiene este dato (o prefirió continuar sin él): no lo inventes; deja esos campos como no_encontrado o requiere_confirmacion.`;
    });
    partes.push(`## Preguntas de las pausas\n\n${lineas.join('\n')}`);
  }

  return `\n${partes.join('\n\n')}\n`;
}
