/**
 * Adaptador de IA: un modelo LOCAL servido por Ollama (gratuito, sin cuota, los documentos no salen de la máquina).
 *
 * Mismo contrato que el adaptador de Claude (preparar / resolver / ejecutarUnidad), pero el ciclo de herramientas lo hace
 * este servidor: se le pasa al modelo la lista de herramientas, se ejecutan las que pide y se le devuelve el resultado,
 * hasta que responde sin pedir ninguna.
 *
 *  - Herramientas del Excel (ver_hoja, llenar_campos, llenar_tablas): las mismas que src/excel/mcp-excel.js, sobre la misma
 *    Sesion y con los mismos informes; aquí corren en el proceso en vez de por MCP.
 *  - Herramientas de documentos y web (listar_documentos, extraer_documento, buscar_web, leer_url): del paquete
 *    HERRAMIENTAS_LOCAL (Desktop/LLM/herramientas). extraer_documento hace las veces de Read/Glob/Grep de Claude Code y
 *    solo puede abrir archivos del paquete del trabajo.
 *
 * Un modelo local tiene poco contexto (32k tokens por defecto): los resultados viejos de herramientas se recortan cuando
 * la conversación se acerca al límite, porque Ollama, si se pasa, corta el inicio en silencio.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { promptCampos, promptSistema, promptTablas } from '../prompts.js';
import { informeCampos, informeTablas } from '../excel/informes.js';
import { Sesion } from '../excel/sesion.js';
import { ErrorRespuesta, extraerJsonTolerante } from '../validar.js';
import { ErrorIA } from './claude.js';

// Reemplaza la línea de Read/Glob/Grep del entorno de Claude Code: el modelo local tiene otras herramientas.
const ENTORNO_LOCAL = (web) => `# Herramientas en este servidor (IA local)

- NO tienes Read, Glob ni Grep. Para los archivos del paquete usa \`listar_documentos\` (lista todo, con rutas relativas a la raíz del paquete) y \`extraer_documento\` (abre cualquiera de esos archivos por su ruta, p. ej. \`04_proyecto_del_usuario/prompt_del_usuario.md\`; los PDF escaneados pasan por OCR y los Excel vienen con la dirección de cada celda). Si la respuesta trae \`continuar_desde\`, el texto sigue: vuelve a llamar con \`desde\` si te hace falta el resto.
${web ? `- También tienes \`buscar_web\` y \`leer_url\`. Úsalas SOLO para datos públicos (normativa del MEF/Invierte.pe, códigos, información institucional) y cita la URL como fuente. Los datos del proyecto (montos, metas, beneficiarios, ubicación, fechas) salen ÚNICAMENTE de los documentos del usuario: nunca de internet.
` : ''}- Ve directo: abre primero \`prompt_del_usuario.md\` y la guía de la sección; no abras archivos que no necesitas (cada uno ocupa memoria).`;

const PROPIEDADES_CAMPO = {
  id: { type: 'string', description: 'Identificador exacto del campo, p. ej. "1.01.03"' },
  valor_propuesto: { type: ['string', 'null'], description: 'Texto a escribir en la celda; null si no hay evidencia' },
  estado: { type: 'string', enum: ['extraido', 'inferido', 'requiere_confirmacion', 'no_encontrado', 'conflictivo'] },
  confianza: { type: 'number', description: 'Entre 0 y 1' },
  fuente: { type: 'string', description: 'Documento y parte de donde salió' },
  evidencia: { type: 'string', description: 'Cita breve que lo respalda' },
};

const HERRAMIENTAS_EXCEL = [
  {
    name: 'ver_hoja',
    description: 'Muestra una hoja del Excel de la ficha: cada celda con contenido (valor, o lo que calcula su fórmula), los desplegables con sus opciones válidas y las celdas fusionadas. Pide rangos acotados (p. ej. "A1:M40").',
    parameters: { type: 'object', properties: { hoja: { type: 'string', description: 'Nombre exacto de la hoja' }, rango: { type: 'string', description: 'Rango A1 opcional, p. ej. "A1:M40"' } }, required: ['hoja'] },
  },
  {
    name: 'llenar_campos',
    description: 'Entrega los CAMPOS DE TEXTO de la sección en curso: una entrada por cada campo de la guía (valor_propuesto null y estado "no_encontrado" los que no tengan evidencia). Te responde qué quedó escrito en el Excel y qué se descartó; puedes volver a llamarla solo con los campos a corregir.',
    parameters: { type: 'object', properties: { seccion_id: { type: 'string' }, campos: { type: 'array', items: { type: 'object', properties: PROPIEDADES_CAMPO, required: ['id', 'valor_propuesto', 'estado'] } } }, required: ['seccion_id', 'campos'] },
  },
  {
    name: 'llenar_tablas',
    description: 'Entrega las TABLAS de la solicitud en curso. Cada una con su identificador, el valor con la forma EXACTA de su «tabla actual» (mismas claves y niveles; un arreglo JSON, no un texto) y la fuente. Las que no cumplan la forma vuelven con el motivo para corregirlas.',
    parameters: {
      type: 'object',
      properties: {
        tablas: {
          type: 'array',
          items: { type: 'object', properties: { identificador: { type: 'string' }, valor: { type: 'array', description: 'Filas de la tabla con la forma exacta de su «tabla actual»', items: { type: 'object' } }, fuente: { type: 'string' } }, required: ['identificador', 'valor'] },
        },
      },
      required: ['tablas'],
    },
  },
].map((f) => ({ type: 'function', function: f }));

let moduloHerramientas = null;
/** Importa una sola vez el paquete de herramientas de documentos/web (está fuera de este repo). */
async function cargarHerramientas() {
  const dir = config.local.herramientasDir;
  if (!dir) return null;
  const archivo = join(dir, 'src', 'herramientas.js');
  if (!existsSync(archivo)) throw new ErrorIA('ia_no_disponible', `No se encontraron las herramientas locales en ${archivo} (revisa HERRAMIENTAS_LOCAL).`);
  moduloHerramientas ??= import(pathToFileURL(archivo).href);
  return moduloHerramientas;
}

/**
 * Tokens aproximados de un texto. Medido con Qwen3 sobre un prompt real de la FTE Cuidado Diurno (español + tablas markdown):
 * 90 547 caracteres → 44 966 tokens, ~2 caracteres por token (mucho menos que los ~4 del inglés).
 */
const tokensDe = (texto) => Math.ceil(String(texto ?? '').length / 2);

/** Texto exacto de cada .md de instrucciones y secciones → su ruta en el paquete (los bloques del prompt son esos archivos tal cual). */
function indiceDeArchivos(raiz) {
  const indice = new Map();
  const recorrer = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (e.name.endsWith('.md')) indice.set(readFileSync(ruta, 'utf8'), relative(raiz, ruta).split(sep).join('/'));
    }
  };
  recorrer(join(raiz, '01_instrucciones'));
  recorrer(join(raiz, '05_secciones_a_llenar'));
  return indice;
}

/** De una guía con un apartado «## Sección N: …» por sección, el apartado de esta sección (o null). */
function apartadoDeSeccion(texto, seccion) {
  const partes = texto.split(/^(?=## Sección )/m);
  const encabezado = (p) => p.split('\n', 1)[0].replace(/^## Sección\s+/, '').trim();
  const num = (x) => (/^\d+$/.test(String(x)) ? String(Number(x)) : String(x));
  return partes.find((p) => p.startsWith('## Sección ') && encabezado(p) === `${seccion.numero}: ${seccion.nombre}`)
    ?? partes.find((p) => p.startsWith('## Sección ') && num(encabezado(p).split(':')[0]) === num(seccion.numero))
    ?? null;
}

/**
 * Los prompts del paquete se escribieron para un modelo con contexto enorme: pegan documentos de apoyo enteros (la guía campo por
 * campo de TODA la ficha, la convención JSON de las plantillas…). Un bloque más grande que `umbral` no se pega: de una guía por
 * secciones queda solo el apartado de la sección en curso; del resto, una nota con la ruta para abrirlo con extraer_documento.
 */
function compactar(texto, { seccion, indice, umbral }) {
  if (tokensDe(texto) <= umbral) return texto;
  const ruta = indice.get(texto);
  const donde = ruta ? `\`${ruta}\`` : 'el paquete';
  const titulo = (texto.match(/^#\s+.+$/m)?.[0] ?? '# Documento de apoyo').trim();
  const apartado = seccion ? apartadoDeSeccion(texto, seccion) : null;
  if (apartado && tokensDe(apartado) <= umbral) {
    const preambulo = texto.slice(0, texto.search(/^## Sección /m)).trim();
    return `${tokensDe(preambulo) <= 800 ? preambulo : titulo}\n\n_(Documento largo: aquí va solo el apartado de esta sección. Completo en ${donde}; ábrelo con extraer_documento si necesitas otro apartado.)_\n\n${apartado.trim()}`;
  }
  return `${titulo}\n\n_(Documento de apoyo largo, ~${tokensDe(texto)} tokens: no se incluye para no llenar la memoria del modelo. Está en ${donde}; ábrelo con extraer_documento solo si lo necesitas para esta sección.)_`;
}
const tokensDeMensajes = (msgs) => msgs.reduce((s, m) => s + tokensDe(m.content) + tokensDe(m.tool_calls ? JSON.stringify(m.tool_calls) : ''), 0);
const OMITIDO = '[Resultado anterior omitido para ahorrar memoria. Si lo vuelves a necesitar, llama otra vez a la herramienta.]';

/** Cuando la conversación no cabe en el contexto, vacía los resultados de herramientas más viejos (los dos últimos se conservan). */
function ajustarContexto(mensajes, presupuesto) {
  const herramientas = mensajes.map((m, i) => (m.role === 'tool' && m.content !== OMITIDO ? i : -1)).filter((i) => i >= 0);
  for (const i of herramientas.slice(0, -2)) {
    if (tokensDeMensajes(mensajes) <= presupuesto) break;
    mensajes[i] = { ...mensajes[i], content: OMITIDO };
  }
  return tokensDeMensajes(mensajes) <= presupuesto;
}

export function crearIALocal() {
  const c = config.local;

  // node:http y no fetch: el fetch de Node corta a los 5 min sin cabeceras, y con un prompt largo el modelo local
  // tarda más que eso en empezar a responder. El límite real es c.timeoutMs (la señal).
  function postOllama(cuerpo, signal) {
    return new Promise((resolve, reject) => {
      const req = (c.url.startsWith('https:') ? httpsRequest : httpRequest)(`${c.url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal }, (res) => {
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { texto += d; });
        res.on('end', () => resolve({ status: res.statusCode, texto }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ model: c.modelo, stream: false, keep_alive: '30m', options: { num_ctx: c.numCtx }, ...cuerpo }));
    });
  }

  async function chat(cuerpo, signal) {
    // Un 500 suele ser pasajero (p. ej. gpt-oss pide una herramienta inexistente y Ollama no puede leer la respuesta): se repite el turno una vez.
    for (let intento = 1; ; intento++) {
      let r;
      try {
        r = await postOllama(cuerpo, signal);
      } catch (e) {
        if (signal?.aborted) throw signal.reason?.name === 'TimeoutError'
          ? new ErrorIA('tiempo_agotado', `El modelo local no terminó en ${Math.round(c.timeoutMs / 60000)} min.`, { reintentable: true })
          : new ErrorIA('cancelado', 'Cancelado.');
        throw new ErrorIA('ia_no_disponible', `Ollama no responde en ${c.url} (¿está abierto?).`, { reintentable: true, detalle: String(e.message) });
      }
      if (r.status === 200) return JSON.parse(r.texto);
      if (r.status === 404) throw new ErrorIA('ia_no_disponible', `Ollama no tiene el modelo «${c.modelo}» (ollama pull / ollama create).`, { detalle: r.texto.slice(0, 300) });
      if (r.status >= 500 && intento < 2) continue;
      throw new ErrorIA('ia_no_disponible', `Ollama respondió HTTP ${r.status}.`, { reintentable: r.status >= 500, detalle: r.texto.slice(0, 300) });
    }
  }

  /**
   * Ciclo de herramientas: modelo → herramientas → modelo… hasta una respuesta sin llamadas o hasta agotar los turnos.
   * @param {{sistema: string, usuario: string, definiciones: object[], ejecutar: (nombre: string, args: object) => Promise<string>, signal?: AbortSignal}} p
   */
  async function conversar({ sistema, usuario, definiciones, ejecutar, signal }) {
    const limite = AbortSignal.timeout(c.timeoutMs);
    const senal = signal ? AbortSignal.any([signal, limite]) : limite;
    // Se reserva espacio para la respuesta del modelo (llamadas a herramientas con una sección entera de campos).
    const presupuesto = c.numCtx - c.reservaSalida;
    const mensajes = [{ role: 'system', content: sistema }, { role: 'user', content: usuario }];
    if (tokensDeMensajes(mensajes) > presupuesto) {
      // No se llama al modelo (Ollama cortaría el inicio sin avisar). ErrorRespuesta: falla solo esta unidad, el trabajo sigue.
      throw new ErrorRespuesta(`La solicitud (~${tokensDeMensajes(mensajes)} tokens) no cabe en el contexto del modelo local (${c.numCtx}). Sube LOCAL_NUM_CTX o baja MAX_CARACTERES_POR_LLAMADA / TABLAS_POR_LLAMADA.`);
    }
    const uso = { llamadas: 1, tokens_entrada: 0, tokens_salida: 0, costo_usd_referencial: 0 };
    const usadas = [];

    for (let turno = 1; turno <= c.maxTurnos; turno++) {
      if (!ajustarContexto(mensajes, presupuesto)) {
        throw new ErrorRespuesta('La conversación ya no cabe en la memoria del modelo: lee menos archivos (o solo las partes necesarias) y entrega antes.');
      }
      const r = await chat({ messages: mensajes, tools: definiciones }, senal);
      uso.tokens_entrada += r.prompt_eval_count ?? 0;
      uso.tokens_salida += r.eval_count ?? 0;
      const m = r.message ?? {};
      mensajes.push({ role: 'assistant', content: m.content ?? '', ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) });
      if (!m.tool_calls?.length) return { final: String(m.content ?? ''), uso, turnos: turno, usadas, agotoTurnos: false };

      for (const llamada of m.tool_calls) {
        const { name, arguments: args } = llamada.function ?? {};
        // Con los argumentos (recortados): sin ellos no se sabe qué archivo abrió ni qué hoja miró.
        usadas.push(`${name}(${JSON.stringify(args ?? {}).slice(0, 120)})`);
        let salida;
        try {
          salida = await ejecutar(name, typeof args === 'string' ? JSON.parse(args || '{}') : (args ?? {}));
        } catch (e) {
          salida = `Error: ${e.message}`;
        }
        // Un solo resultado nunca puede llevarse la mitad del contexto.
        const max = Math.floor(presupuesto * 3 * 0.35);
        if (salida.length > max) salida = `${salida.slice(0, max)}\n[…recortado: pide un rango o una parte más acotada]`;
        mensajes.push({ role: 'tool', tool_name: name, content: salida });
      }
    }
    return { final: '', uso, turnos: c.maxTurnos, usadas, agotoTurnos: true };
  }

  return {
    nombre: `local (${c.modelo} en Ollama)`,
    proveedor: 'ollama-local',
    modelo: c.modelo,

    // Síncrono como el de Claude (pipeline.js no lo espera): las herramientas se cargan aparte y cada unidad espera `docs`.
    preparar(paq, dirTrabajo, { sesion, motor = 'estructura' } = {}) {
      if (motor === 'skill') {
        throw new ErrorIA('motor_no_soportado', 'El motor «skill» (agente libre que escribe el Excel por su cuenta) solo funciona con Claude Code. Con la IA local usa el motor «estructura».');
      }
      const docs = cargarHerramientas().then((mod) => mod?.crearHerramientas({ carpetaDocumentos: paq.rutaRaiz, raizPermitida: config.dataDir, web: c.web, maxCaracteres: c.maxCaracteresHerramienta }) ?? null);
      docs.catch(() => {}); // el error real sale al esperarla en la primera unidad
      const opciones = { indice: indiceDeArchivos(paq.rutaRaiz), umbral: c.maxTokensBloque };
      const entornoLocal = c.herramientasDir ? ENTORNO_LOCAL(c.web) : '# Herramientas en este servidor (IA local)\n\n- No tienes herramientas para abrir archivos: trabaja con lo que viene en la solicitud.';
      return {
        // Qué hizo el modelo en cada unidad (turnos, herramientas, tokens): el pipeline solo guarda lo entregado, no el camino.
        registrar: (datos) => {
          try { appendFileSync(join(dirTrabajo, 'ia_local.ndjson'), `${JSON.stringify({ t: new Date().toISOString(), ...datos })}\n`); } catch { /* el registro nunca tumba el llenado */ }
        },
        // El sistema depende de la sección: de las guías largas va solo el apartado de la sección en curso.
        sistemaPara: (seccion) => {
          const bloques = paq.instrucciones.bloques.map((b) => compactar(b, { ...opciones, seccion }));
          return `${promptSistema({ ...paq, instrucciones: { ...paq.instrucciones, bloques } }, { excel: !!sesion, motor })}\n---\n\n${entornoLocal}\n`;
        },
        // seccion.md (la guía de la propia sección) va siempre entera: es lo que más necesita la unidad. Solo se compactan sus contextos de apoyo.
        seccionPara: (seccion) => ({
          ...seccion,
          contexto: (seccion.contexto ?? []).map((t) => compactar(t, { ...opciones, seccion })),
        }),
        docs,
        // La misma sesión que abriría el servidor MCP del Excel (otra instancia sobre la misma carpeta, como hace mcp-excel.js).
        sesion: sesion ? new Sesion(paq, sesion.dir) : null,
      };
    },

    /** Modo JSON (SALIDA=json): el modelo lee con las herramientas de documentos y responde el JSON de la unidad. */
    async resolver(unidad, paq, { coherencia = '', correccion = '', signal, preparado }) {
      const seccion = preparado.seccionPara(unidad.seccion);
      const usuario = unidad.tipo === 'campos'
        ? promptCampos(paq, seccion, coherencia, correccion)
        : promptTablas(paq, seccion, unidad.tablas, coherencia, correccion);
      const docs = await preparado.docs;
      const r = await conversar({
        sistema: preparado.sistemaPara(unidad.seccion),
        usuario,
        definiciones: docs?.definiciones ?? [],
        ejecutar: async (n, a) => JSON.stringify(await docs.ejecutar(n, a)),
        signal,
      });
      preparado.registrar({ seccion: unidad.seccion.numero, tipo: unidad.tipo, modo: 'json', turnos: r.turnos, herramientas: r.usadas, ...r.uso, final: r.final.slice(0, 300) });
      if (r.agotoTurnos) throw new ErrorRespuesta('Se agotaron los turnos antes de terminar; lee solo lo necesario y entrega el JSON.');
      const { json, reparado } = extraerJsonTolerante(r.final);
      return { bruto: json, uso: r.uso, reparado };
    },

    /** Modo Excel: el modelo mira la hoja y entrega con llenar_campos / llenar_tablas, que validan y escriben en el Excel. */
    async ejecutarUnidad(unidad, paq, { coherencia = '', correccion = '', signal, preparado }) {
      const { sesion } = preparado;
      if (!sesion) throw new ErrorIA('interno', 'La IA local se llamó en modo Excel sin sesión de Excel.');
      const docs = await preparado.docs;
      // El MCP de Claude arranca con la sesión fresca en cada unidad; aquí la instancia vive todo el trabajo, así que se relee.
      sesion.recargar();
      const seccion = preparado.seccionPara(unidad.seccion);
      const usuario = unidad.tipo === 'campos'
        ? promptCampos(paq, seccion, coherencia, correccion, { excel: true })
        : promptTablas(paq, seccion, unidad.tablas, coherencia, correccion, { excel: true });
      const u = JSON.parse(readFileSync(join(sesion.dir, 'unidad.json'), 'utf8'));

      // Las mismas comprobaciones y textos que src/excel/mcp-excel.js.
      const excel = {
        async ver_hoja({ hoja, rango }) {
          return sesion.ver(hoja, rango);
        },
        async llenar_campos({ seccion_id, campos }) {
          if (u.tipo === 'tablas') return 'Error: ahora se piden tablas: usa llenar_tablas.';
          if (u.tipo !== 'ficha' && (u.tipo !== 'campos' || u.seccionId !== seccion_id)) {
            return `Error: ahora no corresponde entregar campos de la sección «${seccion_id}». ${u.tipo === 'campos' ? `La sección en curso es ${u.seccionId}.` : 'Usa llenar_tablas.'}`;
          }
          const r = await sesion.guardarCampos(seccion_id, { campos });
          const informe = await informeCampos(sesion, seccion_id, r);
          sesion.registrar('llenar_campos', { seccion_id, campos }, informe);
          return informe;
        },
        async llenar_tablas({ tablas }) {
          if (u.tipo !== 'ficha' && u.tipo !== 'tablas') return 'Error: ahora se piden los campos de texto de la sección: usa llenar_campos.';
          // Los modelos chicos a veces mandan la tabla como texto JSON en vez de arreglo.
          const lista = (Array.isArray(tablas) ? tablas : []).map((t) => {
            if (typeof t?.valor !== 'string') return t;
            try { return { ...t, valor: JSON.parse(t.valor) }; } catch { return t; }
          });
          const r = await sesion.guardarTablas(lista, u.tipo === 'ficha' ? undefined : u.tablas);
          const informe = await informeTablas(sesion, u, r);
          sesion.registrar('llenar_tablas', { tablas: lista }, informe);
          return informe;
        },
      };

      const r = await conversar({
        sistema: preparado.sistemaPara(unidad.seccion),
        usuario,
        definiciones: [...HERRAMIENTAS_EXCEL, ...(docs?.definiciones ?? [])],
        ejecutar: async (nombre, args) => {
          if (excel[nombre]) {
            try {
              return await excel[nombre](args);
            } catch (e) {
              return `Error: ${e.message}`;
            }
          }
          if (docs) return JSON.stringify(await docs.ejecutar(nombre, args));
          return `Error: herramienta desconocida «${nombre}».`;
        },
        signal,
      });
      preparado.registrar({ seccion: unidad.seccion.numero, tipo: unidad.tipo, modo: 'excel', turnos: r.turnos, herramientas: r.usadas, agoto_turnos: r.agotoTurnos, ...r.uso, final: r.final.slice(0, 300) });
      return {
        uso: r.uso,
        agotoTurnos: r.agotoTurnos,
        cierre: `[${r.turnos} turnos: ${r.usadas.map((u) => u.split('(')[0]).join(', ') || 'sin herramientas'}] ${r.final}`.slice(0, 300),
      };
    },
  };
}

/** Estado de Ollama y del modelo, para /v1/salud. */
export async function infoLocal() {
  const c = config.local;
  try {
    const version = (await (await fetch(`${c.url}/api/version`, { signal: AbortSignal.timeout(5000) })).json()).version;
    const r = await fetch(`${c.url}/api/show`, { method: 'POST', body: JSON.stringify({ model: c.modelo }), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { instalado: false, version, mensaje: `Ollama no tiene el modelo «${c.modelo}».` };
    let herramientas = 'desactivadas (sin HERRAMIENTAS_LOCAL)';
    if (c.herramientasDir) herramientas = existsSync(join(c.herramientasDir, 'src', 'herramientas.js')) ? (c.web ? 'documentos y web' : 'documentos') : `no encontradas en ${c.herramientasDir}`;
    return { instalado: true, version, modelo: c.modelo, contexto: c.numCtx, herramientas };
  } catch (e) {
    return { instalado: false, mensaje: `Ollama no responde en ${c.url}: ${e.message}` };
  }
}
