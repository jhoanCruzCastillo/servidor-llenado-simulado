/**
 * Servidor MCP (stdio) que Claude Code lanza para llenar el Excel de la ficha. Es la "mesa de trabajo" de la IA:
 *
 *   ver_hoja       lo que hay en una hoja del Excel de la ficha (valores, fórmulas ya calculadas, desplegables, fusiones)
 *   llenar_campos  entrega los campos de texto de la sección en curso: se validan, se escriben en el Excel y se devuelve qué quedó
 *   llenar_tablas  entrega las tablas de la solicitud en curso, con la misma comprobación
 *   pedir_datos    pide a la persona un dato que no consta en los documentos (el llenado se pausa; ver src/preguntas.js)
 *
 * La IA entrega por herramienta (argumentos con esquema) y no como texto libre, así que ya no puede devolver un JSON roto. Si algo no es válido la
 * herramienta lo dice con el motivo y la IA puede corregirlo y volver a llamar dentro de la misma conversación.
 *
 * Uso (lo escribe el servidor en el --mcp-config): node mcp-excel.js --raiz <carpeta raíz del paquete> --sesion <carpeta de la sesión>
 * La solicitud en curso la lee de <sesion>/unidad.json. Todo el registro va a stderr: stdout es el canal del protocolo.
 */
for (const m of ['log', 'info', 'warn', 'debug']) console[m] = (...a) => console.error(...a);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { cargarPaquete } from '../paquete.js';
import { informeCampos, informeTablas } from './informes.js';
import { Sesion } from './sesion.js';

const arg = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const raiz = arg('raiz');
const dirSesion = arg('sesion');
if (!raiz || !dirSesion) {
  console.error('Uso: node mcp-excel.js --raiz <paquete> --sesion <carpeta>');
  process.exit(2);
}

const manifiesto = JSON.parse(readFileSync(join(raiz, 'manifiesto.json'), 'utf8'));
const paq = cargarPaquete(raiz, manifiesto);
const sesion = new Sesion(paq, dirSesion);
const unidad = () => JSON.parse(readFileSync(join(dirSesion, 'unidad.json'), 'utf8'));

const texto = (t) => ({ content: [{ type: 'text', text: t }] });
const falla = (t) => ({ isError: true, content: [{ type: 'text', text: t }] });

const server = new McpServer({ name: 'excel_ficha', version: '1.0.0' });

server.registerTool(
  'ver_hoja',
  {
    description:
      'Muestra el contenido actual de una hoja del Excel de la ficha: cada celda con contenido (valor, o el valor que calcula su fórmula), los desplegables con sus opciones válidas y las celdas fusionadas. Úsala para entender dónde va cada dato antes de entregarlo y para revisar cómo quedó. Sin rango muestra el inicio de la hoja; pide rangos acotados (p. ej. "A1:M40").',
    inputSchema: { hoja: z.string().describe('Nombre exacto de la hoja, p. ej. "Datos Generales"'), rango: z.string().optional().describe('Rango A1, p. ej. "A1:M40". Opcional.') },
  },
  async ({ hoja, rango }) => {
    try {
      return texto(await sesion.ver(hoja, rango));
    } catch (e) {
      return falla(`No se pudo leer la hoja: ${e.message}`);
    }
  },
);

server.registerTool(
  'llenar_campos',
  {
    description:
      'Entrega los CAMPOS DE TEXTO de la sección en curso. Incluye una entrada por cada campo de la guía (con valor_propuesto null y estado "no_encontrado" los que no tengan evidencia). Los valores válidos se escriben en el Excel y el resultado te dice qué quedó escrito y qué se descartó y por qué. Puedes volver a llamarla para corregir solo algunos campos: los que no envíes conservan lo anterior.',
    inputSchema: {
      seccion_id: z.string().describe('seccion_id de la sección en curso, tal como figura en la solicitud'),
      campos: z
        .array(
          z.object({
            id: z.string().describe('Identificador exacto del campo, p. ej. "1.01.03"'),
            valor_propuesto: z.string().nullable().describe('Texto a escribir en la celda; null si no hay evidencia'),
            estado: z.enum(['extraido', 'inferido', 'requiere_confirmacion', 'no_encontrado', 'conflictivo']).describe('Qué tan respaldado está el valor'),
            confianza: z.number().min(0).max(1).optional(),
            fuente: z.string().optional().describe('Documento y parte de donde salió'),
            evidencia: z.string().optional().describe('Cita breve que lo respalda'),
          }),
        )
        .describe('Un elemento por campo'),
    },
  },
  async ({ seccion_id, campos }) => {
    try {
      const u = unidad();
      if ((u.tipo !== 'campos' && u.tipo !== 'seccion') || u.seccionId !== seccion_id) {
        return falla(`Ahora no corresponde entregar campos de la sección «${seccion_id}». ${u.tipo === 'campos' || u.tipo === 'seccion' ? `La sección en curso es ${u.seccionId}.` : 'Ahora se piden tablas: usa llenar_tablas.'}`);
      }
      const r = await sesion.guardarCampos(seccion_id, { campos });
      const informe = await informeCampos(sesion, seccion_id, r);
      sesion.registrar('llenar_campos', { seccion_id, campos }, informe);
      return texto(informe);
    } catch (e) {
      return falla(e.message);
    }
  },
);

server.registerTool(
  'llenar_tablas',
  {
    description:
      'Entrega las TABLAS de la solicitud en curso. Cada una lleva su identificador, el valor con la forma exacta de su «tabla actual» (mismas claves y niveles) y la fuente. Las válidas se escriben en el Excel (las filas que no caben en el formato lo hacen crecer); las que no cumplen la forma vuelven con el motivo para que las corrijas y las envíes de nuevo.',
    inputSchema: {
      tablas: z
        .array(
          z.object({
            identificador: z.string().describe('Identificador exacto de la tabla, p. ej. "2.01.01"'),
            valor: z.any().describe('Estructura de la tabla, con la forma exacta de su «tabla actual»'),
            fuente: z.string().optional().describe('Documento y parte de donde salió'),
          }),
        )
        .describe('Una entrada por tabla'),
    },
  },
  async ({ tablas }) => {
    try {
      const u = unidad();
      if (u.tipo !== 'tablas' && u.tipo !== 'seccion') return falla('Ahora se piden los campos de texto de la sección: usa llenar_campos.');
      const r = await sesion.guardarTablas(tablas, u.tablas);
      const informe = await informeTablas(sesion, u, r);
      sesion.registrar('llenar_tablas', { tablas }, informe);
      return texto(informe);
    } catch (e) {
      return falla(e.message);
    }
  },
);

server.registerTool(
  'pedir_datos',
  {
    description:
      'Pide a la PERSONA un dato imprescindible que NO consta en ningún documento ni nota del paquete (p. ej. la naturaleza de intervención o la unidad formuladora). Úsala solo después de buscar bien en los documentos y solo para datos que no puedas inferir con seguridad; nunca para cosas opcionales. Agrupa todas tus preguntas en UNA llamada (máximo 6), concretas y breves, en español. La persona NO llenará los campos de la ficha: escribirá texto o subirá documentos y TÚ extraerás el dato al retomar. `opciones` es para ti (catálogo cerrado), no un formulario. NO esperes la respuesta: tras llamarla, entrega con las otras herramientas lo que SÍ puedes llenar (sin inventar lo que depende de esos datos) y termina con «Listo».',
    inputSchema: {
      preguntas: z
        .array(
          z.object({
            pregunta: z.string().describe('La pregunta, concreta y breve, dirigida a la persona'),
            motivo: z.string().optional().describe('Por qué hace falta (qué campos dependen de este dato)'),
            campo_ids: z.array(z.string()).optional().describe('Identificadores de los campos que dependen de la respuesta'),
            opciones: z.array(z.string()).optional().describe('Si el dato es de un catálogo cerrado (p. ej. un desplegable), las opciones válidas'),
          }),
        )
        .min(1)
        .max(6)
        .describe('Una entrada por dato que falta'),
    },
  },
  async ({ preguntas }) => {
    try {
      const limites = sesion.leerLimites();
      if (!limites.puede_preguntar) {
        return falla('En este trabajo no puedes preguntar a la persona (o ya se agotaron las preguntas permitidas). Decide con lo que consta en los archivos: si falta el dato, deja el campo como no_encontrado o requiere_confirmacion.');
      }
      const u = unidad();
      const anotadas = sesion.anotarPreguntas(preguntas, { id: u.seccionId });
      sesion.registrar('pedir_datos', { preguntas }, `${anotadas.length} pregunta(s) anotada(s)`);
      const entrega = u.tipo === 'campos' ? 'llenar_campos' : u.tipo === 'tablas' ? 'llenar_tablas' : 'llenar_campos y llenar_tablas';
      return texto(`Anotado: se le preguntará a la persona (${anotadas.length} pregunta(s)). No esperes la respuesta. Entrega ahora con ${entrega} lo que SÍ puedes llenar con lo que consta (deja sin inventar lo que depende de esos datos) y termina con «Listo»; se retomará cuando responda.`);
    } catch (e) {
      return falla(e.message);
    }
  },
);

await server.connect(new StdioServerTransport());
