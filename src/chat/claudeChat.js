/**
 * Chat con Claude Code (CLI) en modo streaming (`claude -p --output-format stream-json`), con la misma credencial de suscripción
 * que el resto del servidor. Es un chat sin herramientas: Claude Code se usa como motor de conversación.
 *
 * Eventos que se leen de stdout (una línea JSON cada uno):
 *   {"type":"system","subtype":"init","session_id":…}                                  → id de sesión (para --resume)
 *   {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}}   → trozos de texto
 *   {"type":"assistant","message":{"model":"<synthetic>","content":[{"type":"text","text":"Failed to authenticate…"}]}}  → mensaje de error de Claude Code
 *   {"type":"result","is_error":false,"result":"…texto final…","session_id":…,"usage":{…}}      → fin
 */
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { clasificarFallo, entornoLimpio, ErrorIA, matarArbol, resolverBin } from '../ia/claude.js';

export const MODELOS = [
  { id: 'sonnet', nombre: 'Sonnet', descripcion: 'Equilibrado y rápido; el que menos cuota gasta' },
  { id: 'opus', nombre: 'Opus', descripcion: 'El más capaz; gasta bastante más cuota' },
  { id: 'haiku', nombre: 'Haiku', descripcion: 'El más ligero y veloz' },
];
export const modeloValido = (m) => MODELOS.some((x) => x.id === m);

const SISTEMA =
  'Esta es una conversación de chat general. Responde de forma clara, cercana y útil, en el idioma de la persona (por defecto español). '
  + 'Usa Markdown cuando ayude (listas, tablas, bloques de código indicando el lenguaje). '
  + 'No tienes herramientas ni acceso a archivos, internet ni a ejecutar código en esta conversación: no finjas hacerlo. Si no sabes algo, dilo.';

const dirConfig = join(config.dataDir, 'claude-config'); // las sesiones de Claude Code viven en el volumen para sobrevivir a redespliegues
const dirTrabajo = join(config.dataDir, 'chat-cwd'); // directorio de trabajo fijo y vacío: las sesiones se asocian a él

/** Prepara las carpetas de Claude Code para el chat (una vez al arrancar). */
export function prepararChat() {
  mkdirSync(dirConfig, { recursive: true });
  mkdirSync(dirTrabajo, { recursive: true });
  const f = join(dirConfig, '.claude.json');
  if (!existsSync(f)) writeFileSync(f, JSON.stringify({ hasCompletedOnboarding: true }));
}

const comillas = (s) => `"${String(s).replaceAll('"', '\\"')}"`;

/** Historial como texto, para reanudar una conversación cuando la sesión de Claude Code ya no existe o se regenera una respuesta. */
function promptConHistorial(mensajes) {
  const previos = mensajes.slice(0, -1);
  const ultimo = mensajes.at(-1);
  if (previos.length === 0) return ultimo.contenido;
  const hist = previos.map((m) => `${m.rol === 'usuario' ? 'Persona' : 'Asistente'}: ${m.contenido}`).join('\n\n');
  return `Esta es la conversación hasta ahora:\n\n${hist}\n\n---\nContinúa la conversación respondiendo al último mensaje de la persona, sin mencionar este resumen.\n\nPersona: ${ultimo.contenido}`;
}

/** Una ejecución de `claude`. Devuelve { texto, sessionId, uso } o lanza ErrorIA. `onDelta(texto)` recibe cada trozo. */
function ejecutarUnaVez({ prompt, resumeId, modelo, signal, onDelta }) {
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', modelo,
    '--append-system-prompt', SISTEMA,
    '--tools', '',
    '--permission-mode', 'dontAsk',
    '--max-turns', '3',
    '--setting-sources', 'project,local',
    '--strict-mcp-config',
  ];
  if (resumeId) args.push('--resume', resumeId);

  const { cmd, args: previos, shell } = resolverBin();
  const todos = [...previos, ...args];
  const env = { ...entornoLimpio(), CLAUDE_CONFIG_DIR: dirConfig };

  return new Promise((resolve, reject) => {
    const proc = shell
      ? spawn([comillas(cmd), ...todos.map(comillas)].join(' '), { cwd: dirTrabajo, env, shell: true, windowsHide: true })
      : spawn(cmd, todos, { cwd: dirTrabajo, env, windowsHide: true });

    let buffer = '';
    let stderr = '';
    let texto = '';
    let hubo = false;
    let sessionId = resumeId ?? null;
    let sintetico = '';
    let resultado = null;
    let terminado = false;
    const fin = (fn, v) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(reloj);
      signal?.removeEventListener('abort', alAbortar);
      fn(v);
    };
    const reloj = setTimeout(() => { matarArbol(proc); fin(reject, new ErrorIA('tiempo_agotado', 'Claude no terminó de responder a tiempo.', { reintentable: true })); }, config.claude.timeoutMs);
    const alAbortar = () => { matarArbol(proc); fin(reject, Object.assign(new ErrorIA('cancelado', 'Cancelado.'), { parcial: texto })); };
    if (signal) signal.aborted ? alAbortar() : signal.addEventListener('abort', alAbortar, { once: true });

    const linea = (l) => {
      let e;
      try { e = JSON.parse(l); } catch { return; }
      if (e.session_id) sessionId = e.session_id;
      if (e.type === 'stream_event' && !e.parent_tool_use_id) {
        const d = e.event?.type === 'content_block_delta' ? e.event.delta : null;
        if (d?.type === 'text_delta' && d.text) { hubo = true; texto += d.text; onDelta(d.text); }
      } else if (e.type === 'assistant' && e.message?.model === '<synthetic>') {
        sintetico = (e.message.content ?? []).map((c) => c.text ?? '').join('');
      } else if (e.type === 'result') {
        resultado = e;
      }
    };

    proc.stdout.on('data', (d) => {
      buffer += d;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) { linea(buffer.slice(0, i).trim()); buffer = buffer.slice(i + 1); }
    });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.stdin.on('error', () => {});
    proc.on('error', (e) => fin(reject, new ErrorIA('ia_no_disponible', e.code === 'ENOENT' ? `No se encontró Claude Code («${cmd}»).` : `No se pudo lanzar Claude Code: ${e.message}`)));
    proc.on('close', (code) => {
      if (buffer.trim()) linea(buffer.trim());
      if (resultado?.is_error || (!resultado && code !== 0)) {
        return fin(reject, clasificarFallo(`${resultado?.result ?? ''}\n${sintetico}\n${stderr}`));
      }
      const final = typeof resultado?.result === 'string' ? resultado.result : texto;
      if (!hubo && final) onDelta(final); // sin streaming parcial: se entrega todo de una vez
      const u = resultado?.usage ?? {};
      fin(resolve, {
        texto: final,
        sessionId: resultado?.session_id ?? sessionId,
        uso: {
          tokens_entrada: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          tokens_salida: u.output_tokens ?? 0,
        },
      });
    });
    proc.stdin.end(prompt);
  });
}

/**
 * Genera la respuesta a la última entrada de `mensajes` (que debe ser de la persona).
 * Reanuda la sesión de Claude Code si existe; si ya no existe (o se pide `reiniciar`, p. ej. al regenerar), reconstruye el contexto con el historial.
 */
export async function generar({ mensajes, sessionId, modelo, reiniciar = false, signal, onDelta }) {
  const ultimo = mensajes.at(-1);
  if (!reiniciar && sessionId) {
    try {
      return await ejecutarUnaVez({ prompt: ultimo.contenido, resumeId: sessionId, modelo, signal, onDelta });
    } catch (e) {
      const sesionPerdida = e instanceof ErrorIA && /no conversation found|session.*(not found|does not exist)/i.test(`${e.detalle ?? ''} ${e.message}`);
      if (!sesionPerdida) throw e;
    }
  }
  return ejecutarUnaVez({ prompt: promptConHistorial(mensajes), resumeId: null, modelo, signal, onDelta });
}

