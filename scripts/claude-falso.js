/**
 * «Claude Code» de mentira para probar la tubería (lanzar el proceso, pasar el prompt por stdin, parsear `--output-format json`,
 * validar, reintentar) SIN gastar cuota. Se usa con:   CLAUDE_BIN=node   CLAUDE_BIN_ARGS=scripts/claude-falso.js   IA=claude
 *
 * Lee el prompt de stdin y responde con un JSON válido construido a partir del propio prompt:
 *  - campos: todos «no_encontrado», salvo los que traen `opciones` (elige la primera)
 *  - tablas: devuelve la «tabla actual» tal cual
 * Variables para provocar fallos:  FALSO_FALLA=basura|vacio|limite|sin_sesion   FALSO_FALLA_VECES=N (por defecto solo la primera llamada)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('0.0.0-falso (Claude Code simulado)'); process.exit(0); }
if (args[0] === 'auth') { console.log('Claude Code falso: sin autenticación real'); process.exit(0); }

let prompt = '';
for await (const trozo of process.stdin) prompt += trozo;

// Contador de llamadas entre procesos (cada llamada es un proceso nuevo).
const contador = process.env.FALSO_CONTADOR || join(tmpdir(), 'claude-falso-contador.txt');
// En Windows el antivirus puede bloquear un instante el archivo (EBUSY): se reintenta y, si no se puede, se sigue sin contar.
const tocar = (fn) => { for (let i = 0; i < 20; i++) { try { return fn(); } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); } } return undefined; };
const n = (existsSync(contador) ? Number(tocar(() => readFileSync(contador, 'utf8')) ?? 0) : 0) + 1;
tocar(() => writeFileSync(contador, String(n)));

const salida = (result, extra = {}) => {
  console.log(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result, num_turns: 1, total_cost_usd: 0,
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...extra,
  }));
};

// ── Modo chat: `--output-format stream-json` (misma forma de eventos que el Claude Code real) ──────────────────────────
if (args.includes('stream-json')) {
  const { randomUUID } = await import('node:crypto');
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const emitir = (o) => console.log(JSON.stringify(o));
  const i = args.indexOf('--resume');
  const resumeId = i >= 0 ? args[i + 1] : null;
  const sid = resumeId ?? randomUUID();
  emitir({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-falso', tools: [] });

  const error = (texto) => {
    emitir({ type: 'assistant', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: texto }] }, session_id: sid });
    emitir({ type: 'result', subtype: 'success', is_error: true, result: texto, session_id: sid, usage: {} });
    process.exit(1);
  };
  const ultima = prompt.split('Persona: ').at(-1).trim(); // solo el último mensaje manda (el historial puede contener marcas antiguas)
  if (resumeId && process.env.FALSO_SESION_PERDIDA === '1') error(`No conversation found with session ID: ${resumeId}`);
  if (/\[\[error\]\]/.test(ultima)) error('API Error: 529 overloaded_error');

  const conHistorial = prompt.includes('Esta es la conversación hasta ahora');
  let respuesta = `¡Hola! Soy el **Claude falso** de pruebas${resumeId ? ' (sesión reanudada)' : ''}${conHistorial ? ' (con historial reconstruido)' : ''}.

Me escribiste:

> ${ultima.slice(0, 200)}

Algunas cosas para probar el formato:

- Una lista con *cursiva* y \`código en línea\`
- Otro punto

\`\`\`js
function saludar(nombre) {
  return 'Hola, ' + nombre;
}
\`\`\`

| Columna A | Columna B |
|---|---|
| 1 | 2 |
| 3 | 4 |
`;
  // Adjuntos: el Claude real los abriría con Read; el falso comprueba que existen donde el servidor dijo (cwd de la conversación) y cuenta sus bytes.
  const rutasAdjuntas = [...ultima.matchAll(/^- (adjuntos\/\S+\/[^\n]*?) — /gm)].map((x) => x[1]);
  if (rutasAdjuntas.length || args.includes('Read')) {
    const filas = rutasAdjuntas.map((r) => {
      try { return `- \`${r}\`: ${readFileSync(r).length} bytes (herramientas: ${args[args.indexOf('--tools') + 1] || 'ninguna'})`; } catch { return `- \`${r}\`: NO existe desde ${process.cwd()}`; }
    });
    respuesta += `\n\nArchivos recibidos (${rutasAdjuntas.length}):\n\n${filas.join('\n')}\n`;
  }
  if (/\[\[largo\]\]/.test(ultima)) respuesta = Array.from({ length: 80 }, (_, n) => `Línea ${n + 1} de una respuesta larga para probar el botón de detener.`).join('\n\n');

  for (let p = 0; p < respuesta.length; p += 9) {
    emitir({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: respuesta.slice(p, p + 9) } }, session_id: sid, parent_tool_use_id: null });
    await esperar(Number(process.env.FALSO_RITMO_MS ?? 15));
  }
  emitir({ type: 'assistant', message: { model: 'claude-falso', role: 'assistant', content: [{ type: 'text', text: respuesta }] }, session_id: sid });
  emitir({ type: 'result', subtype: 'success', is_error: false, result: respuesta, session_id: sid, total_cost_usd: 0, usage: { input_tokens: 120, output_tokens: Math.ceil(respuesta.length / 4), cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  process.exit(0);
}

const falla = process.env.FALSO_FALLA;
const veces = Number(process.env.FALSO_FALLA_VECES ?? 1);
if (falla && n <= veces) {
  if (falla === 'basura') { salida('Claro, aquí tienes la respuesta: ```json\n{ esto no es json }\n```'); process.exit(0); }
  if (falla === 'vacio') { salida('{"campos": "no soy un arreglo"}'); process.exit(0); }
  if (falla === 'limite') { salida('Claude AI usage limit reached|1760000000', { is_error: true }); process.exit(1); }
  if (falla === 'sin_sesion') { salida('Not logged in · Please run /login', { is_error: true }); process.exit(1); }
}

// ── Modo Excel: Claude Code con el servidor MCP del Excel (--mcp-config). Se comporta como un cliente MCP que entrega con las herramientas. ──────────────
const iMcp = args.indexOf('--mcp-config');
if (iMcp >= 0) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const cfg = JSON.parse(readFileSync(args[iMcp + 1], 'utf8'));
  const [[nombre, srv]] = Object.entries(cfg.mcpServers);
  const cliente = new Client({ name: 'claude-falso', version: '0.0.0' });
  await cliente.connect(new StdioClientTransport({ command: srv.command, args: srv.args, env: { ...process.env, ...(srv.env ?? {}) }, stderr: 'ignore' }));
  const herramientas = (await cliente.listTools()).tools.map((t) => t.name);
  const permitidas = args[args.indexOf('--allowedTools') + 1].split(',');
  for (const h of herramientas) if (!permitidas.includes(`mcp__${nombre}__${h}`)) { salida(`herramienta no permitida: ${h}`, { is_error: true }); process.exit(1); }

  if (process.env.FALSO_SIN_ENTREGA === '1' && n <= Number(process.env.FALSO_FALLA_VECES ?? 1)) { await cliente.close(); salida('Listo'); process.exit(0); }
  const texto = (r) => r.content?.map((c) => c.text).join('\n') ?? '';
  if (/Usa la herramienta ver_hoja/.test(prompt)) {
    const r = await cliente.callTool({ name: 'ver_hoja', arguments: { hoja: 'Hoja de prueba' } });
    await cliente.close();
    salida(texto(r).match(/B1 = "([^"]+)"/)?.[1] ?? 'no pude leer B1');
    process.exit(0);
  }
  if (/# Tarea: llenar los CAMPOS/.test(prompt)) {
    const id = prompt.match(/seccion_id: `([^`]+)`/)?.[1];
    const hoja = prompt.match(/Mira la hoja «([^»]+)»/)?.[1];
    if (hoja) await cliente.callTool({ name: 'ver_hoja', arguments: { hoja, rango: 'A1:T20' } });
    const campos = [...prompt.matchAll(/^- (\S+) — "[^\n]*?"(?: \(tipo: [^)]*\))?(?: — opciones válidas: ([^\n]*?))?(?: — |$)/gm)].map((m) => {
      const opcion = m[2]?.split(' | ')[0]?.trim();
      return opcion
        ? { id: m[1], valor_propuesto: opcion, estado: 'extraido', confianza: 0.9, fuente: 'falso', evidencia: '' }
        : { id: m[1], valor_propuesto: null, estado: 'no_encontrado', confianza: 0, fuente: '', evidencia: '' };
    });
    // FALSO_PREGUNTAR=1: como la IA real ante un dato que falta, llama a pedir_datos (una vez: tras la respuesta el prompt trae «Datos que la persona respondió»)
    // y usa esa respuesta como valor del primer campo para poder comprobar que llegó hasta la ficha.
    if (process.env.FALSO_PREGUNTAR === '1' && campos.length) {
      const respuestaPersona = prompt.match(/Respuesta de la persona \(dato del proyecto\): (.+)/)?.[1]?.trim();
      const sinDato = /La persona NO tiene este dato/.test(prompt);
      if (!respuestaPersona && !sinDato) {
        // Si el campo es de catálogo (desplegable), la pregunta lleva sus opciones: la respuesta tiene que ser una de ellas.
        const opciones = [...prompt.matchAll(/^- (\S+) — "[^\n]*?"(?: \(tipo: [^)]*\))?(?: — opciones válidas: ([^\n]*?))?(?: — |$)/gm)][0]?.[2]?.split(' | ').map((o) => o.trim()).filter(Boolean) ?? [];
        const r = await cliente.callTool({ name: 'pedir_datos', arguments: { preguntas: [{ pregunta: `Prueba MCP: ¿qué va en el campo ${campos[0].id}?`, motivo: 'No consta en los documentos.', campo_ids: [campos[0].id], opciones }] } });
        console.error(texto(r).slice(0, 200));
      } else if (respuestaPersona) {
        campos[0] = { id: campos[0].id, valor_propuesto: respuestaPersona, estado: 'extraido', confianza: 1, fuente: 'Respuesta de la persona', evidencia: '' };
      }
    }
    const r = await cliente.callTool({ name: 'llenar_campos', arguments: { seccion_id: id, campos } });
    console.error(texto(r).slice(0, 300));
  } else {
    const bloques = prompt.split(/={19} TABLA /).slice(1);
    const tablas = bloques.map((b) => {
      const identificador = b.match(/^(\S+) =+/)?.[1];
      const actual = b.split(/^Tabla actual[^\n]*\n/m)[1]?.split('\n')[0];
      let valor = [];
      try { valor = JSON.parse(actual); } catch { /* sin «tabla actual» legible */ }
      return { identificador, valor, fuente: 'falso' };
    });
    const r = await cliente.callTool({ name: 'llenar_tablas', arguments: { tablas } });
    console.error(texto(r).slice(0, 300));
  }
  await cliente.close();
  salida('Listo');
  process.exit(0);
}

if (/# Tarea: llenar los CAMPOS/.test(prompt)) {
  const id = prompt.match(/seccion_id: `([^`]+)`/)?.[1];
  const campos = [...prompt.matchAll(/^- (\S+) — "[^\n]*?"(?: \(tipo: [^)]*\))?(?: — opciones válidas: ([^\n]*?))?(?: — |$)/gm)].map((m) => {
    const opcion = m[2]?.split(' | ')[0]?.trim();
    return opcion
      ? { id: m[1], valor_propuesto: opcion, estado: 'extraido', confianza: 0.9, fuente: 'falso', evidencia: '' }
      : { id: m[1], valor_propuesto: null, estado: 'no_encontrado', confianza: 0, fuente: '', evidencia: '' };
  });
  salida(JSON.stringify({ seccion_id: id, campos }));
} else {
  const bloques = prompt.split(/={19} TABLA /).slice(1);
  const tablas = bloques.map((b) => {
    const identificador = b.match(/^(\S+) =+/)?.[1];
    const actual = b.split(/^Tabla actual[^\n]*\n/m)[1]?.split('\n')[0];
    let valor = [];
    try { valor = JSON.parse(actual); } catch { /* tabla sin «tabla actual» legible */ }
    return { identificador, valor, fuente: '' };
  });
  salida(JSON.stringify({ tablas }));
}
