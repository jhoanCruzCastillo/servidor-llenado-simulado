/**
 * Chat con Claude Code (CLI) en modo streaming (`claude -p --output-format stream-json`), con la misma credencial de suscripción
 * que el resto del servidor. Sin archivos es un chat sin herramientas; con adjuntos, Claude lee desde la carpeta de la conversación.
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

const SISTEMA_CON_ARCHIVOS =
  'Esta es una conversación de chat. La persona puede adjuntar archivos; están en tu directorio de trabajo, con sus nombres originales. '
  + 'Usa la herramienta Read para abrirlos (PDF, imágenes, texto; de Word/Excel/PowerPoint hay un .txt extraído al lado). '
  + 'No hay Excel de ficha ni JSON de plantilla: solo lo que la persona puso en este chat. '
  + 'Responde en el idioma de la persona (por defecto español). Markdown cuando ayude. '
  + 'No ejecutes comandos ni escribas archivos. Si un archivo no se puede leer, dilo.';

// Por defecto el chat usa la MISMA configuración de Claude Code que el resto del servidor (HOME del usuario). Con CHAT_CONFIG_DIR las sesiones
// pueden vivir en otro directorio (p. ej. el volumen) para sobrevivir a redespliegues; sin ello se reconstruyen con el historial.
const dirConfig = process.env.CHAT_CONFIG_DIR || null;
const dirTrabajo = join(config.dataDir, 'chat-cwd'); // directorio de trabajo fijo y vacío: las sesiones se asocian a él

/** Prepara las carpetas de Claude Code para el chat (una vez al arrancar). */
export function prepararChat() {
  mkdirSync(dirTrabajo, { recursive: true });
  if (!dirConfig) return;
  mkdirSync(dirConfig, { recursive: true });
  const f = join(dirConfig, '.claude.json');
  if (!existsSync(f)) writeFileSync(f, JSON.stringify({ hasCompletedOnboarding: true }));
}

const comillas = (s) => `"${String(s).replaceAll('"', '\\"')}"`;

function textoDeMensaje(m) {
  const nombres = (m.archivos ?? []).map((a) => a.nombre).filter(Boolean);
  const texto = String(m.contenido ?? '').trim();
  if (nombres.length === 0) return texto;
  const lista = nombres.map((n) => `«${n}»`).join(', ');
  return texto ? `${texto}\n[Archivos: ${lista}]` : `[Archivos: ${lista}]`;
}

function bloqueArchivos(adjuntos) {
  const nombres = (adjuntos ?? []).map((a) => a.nombre).filter(Boolean);
  if (nombres.length === 0) return '';
  return '\n\nArchivos en el directorio de trabajo (ábrelo con Read; no hay Excel ni JSON de ficha, solo lo adjunto):\n'
    + nombres.map((n) => `- ${n}`).join('\n');
}

/** Historial como texto, para reanudar una conversación cuando la sesión de Claude Code ya no existe o se regenera una respuesta. */
function promptConHistorial(mensajes) {
  const previos = mensajes.slice(0, -1);
  const ultimo = mensajes.at(-1);
  const cierre = textoDeMensaje(ultimo) + bloqueArchivos(ultimo.archivos);
  if (previos.length === 0) return cierre;
  const hist = previos.map((m) => `${m.rol === 'usuario' ? 'Persona' : 'Asistente'}: ${textoDeMensaje(m)}`).join('\n\n');
  return `Esta es la conversación hasta ahora:\n\n${hist}\n\n---\nContinúa la conversación respondiendo al último mensaje de la persona, sin mencionar este resumen.\n\nPersona: ${cierre}`;
}

/** Una ejecución de `claude`. Devuelve { texto, sessionId, uso } o lanza ErrorIA. `onDelta(texto)` recibe cada trozo. */
function ejecutarUnaVez({ prompt, resumeId, modelo, signal, onDelta, cwd, conArchivos }) {
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', modelo,
    '--append-system-prompt', conArchivos ? SISTEMA_CON_ARCHIVOS : SISTEMA,
    '--tools', conArchivos ? 'Read,Glob' : '',
    '--permission-mode', 'dontAsk',
    '--max-turns', conArchivos ? '12' : '3',
    '--setting-sources', 'project,local',
    '--strict-mcp-config',
  ];
  if (conArchivos) args.push('--allowedTools', 'Read,Glob');
  if (resumeId) args.push('--resume', resumeId);

  const { cmd, args: previos, shell } = resolverBin();
  const todos = [...previos, ...args];
  const env = dirConfig ? { ...entornoLimpio(), CLAUDE_CONFIG_DIR: dirConfig } : entornoLimpio();
  const cwdFinal = cwd || dirTrabajo;

  return new Promise((resolve, reject) => {
    const proc = shell
      ? spawn([comillas(cmd), ...todos.map(comillas)].join(' '), { cwd: cwdFinal, env, shell: true, windowsHide: true })
      : spawn(cmd, todos, { cwd: cwdFinal, env, windowsHide: true });

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
export async function generar({ mensajes, sessionId, modelo, reiniciar = false, signal, onDelta, dirArchivos = null }) {
  const ultimo = mensajes.at(-1);
  const conArchivos = !!dirArchivos;
  const extras = { modelo, signal, onDelta, cwd: dirArchivos, conArchivos };
  if (!reiniciar && sessionId) {
    try {
      return await ejecutarUnaVez({ prompt: textoDeMensaje(ultimo) + bloqueArchivos(ultimo.archivos), resumeId: sessionId, ...extras });
    } catch (e) {
      const sesionPerdida = e instanceof ErrorIA && /no conversation found|session.*(not found|does not exist)/i.test(`${e.detalle ?? ''} ${e.message}`);
      if (!sesionPerdida) throw e;
    }
  }
  return ejecutarUnaVez({ prompt: promptConHistorial(mensajes), resumeId: null, ...extras });
}

