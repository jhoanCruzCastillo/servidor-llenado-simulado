/**
 * Adaptador de IA: Claude Code (CLI) en modo no interactivo (`claude -p`), usando la SUSCRIPCIÓN de la persona.
 *
 * Cómo se asegura que use la suscripción y no la API de pago:
 *  - No se usa `--bare`: ese modo solo acepta ANTHROPIC_API_KEY y nunca lee el login (OAuth) de la suscripción.
 *  - Al hijo se le quitan ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL y las variables CLAUDE_CODE_* de otra sesión
 *    (salvo CLAUDE_CODE_OAUTH_TOKEN, el token de larga duración de `claude setup-token`). Si ANTHROPIC_API_KEY llegara a estar definida,
 *    Claude Code la preferiría sobre la suscripción y se cobraría por API.
 *  - Credenciales: las de `claude login` en este equipo, o CLAUDE_CODE_OAUTH_TOKEN.
 */
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { promptCampos, promptSistema, promptTablas } from '../prompts.js';
import { ErrorRespuesta, extraerJson } from '../validar.js';

export class ErrorIA extends Error {
  constructor(codigo, mensaje, { reintentable = false, detalle = null } = {}) {
    super(mensaje);
    this.codigo = codigo;
    this.reintentable = reintentable;
    this.detalle = detalle;
  }
}

/** Entorno del proceso hijo: el del servidor, sin nada que desvíe a la API de pago ni que confunda a Claude Code. */
export function entornoLimpio(proceso = process.env, permitirApiKey = config.claude.permitirApiKey) {
  const env = {};
  for (const [k, v] of Object.entries(proceso)) {
    if (v === undefined) continue;
    if (!permitirApiKey && ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL'].includes(k)) continue;
    if (k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDE_CODE_OAUTH_TOKEN') continue;
    if (k === 'CLAUDECODE') continue;
    env[k] = v;
  }
  return env;
}

let binResuelto = null;
/** { cmd, args, shell }: en Windows un `claude.cmd` (instalación con npm) solo se puede lanzar a través del shell. */
export function resolverBin() {
  if (binResuelto) return binResuelto;
  const { bin, binArgs } = config.claude;
  let ruta = bin;
  if (process.platform === 'win32' && !/[\\/]/.test(bin) && !/\.[a-z]+$/i.test(bin)) {
    const r = spawnSync('where', [bin], { encoding: 'utf8' });
    const hallados = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    ruta = hallados.find((p) => /\.exe$/i.test(p)) ?? hallados[0] ?? bin;
  }
  binResuelto = { cmd: ruta, args: binArgs, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(ruta) };
  return binResuelto;
}

const comillas = (s) => `"${String(s).replaceAll('"', '\\"')}"`;

export function matarArbol(proc) {
  if (!proc.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
  else proc.kill('SIGKILL');
}

/** Ejecuta `claude` con los argumentos dados y el prompt por stdin. Devuelve { stdout, stderr, code }. */
export function ejecutarClaude(args, { stdin = '', cwd, timeoutMs, signal } = {}) {
  const { cmd, args: previos, shell } = resolverBin();
  const todos = [...previos, ...args];
  return new Promise((resolve, reject) => {
    const proc = shell
      ? spawn([comillas(cmd), ...todos.map(comillas)].join(' '), { cwd, env: entornoLimpio(), shell: true, windowsHide: true })
      : spawn(cmd, todos, { cwd, env: entornoLimpio(), windowsHide: true });
    let stdout = '';
    let stderr = '';
    let terminado = false;
    const fin = (fn, v) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(reloj);
      signal?.removeEventListener('abort', alAbortar);
      fn(v);
    };
    const reloj = timeoutMs ? setTimeout(() => { matarArbol(proc); fin(reject, new ErrorIA('tiempo_agotado', `Claude Code no terminó en ${Math.round(timeoutMs / 60000)} min.`, { reintentable: true })); }, timeoutMs) : null;
    const alAbortar = () => { matarArbol(proc); fin(reject, new ErrorIA('cancelado', 'Cancelado.')); };
    if (signal) signal.aborted ? alAbortar() : signal.addEventListener('abort', alAbortar, { once: true });
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (e) => fin(reject, new ErrorIA('ia_no_disponible', e.code === 'ENOENT' ? `No se encontró Claude Code («${cmd}»). Instálalo o define CLAUDE_BIN en .env.` : `No se pudo lanzar Claude Code: ${e.message}`)));
    proc.on('close', (code) => fin(resolve, { stdout, stderr, code }));
    proc.stdin.on('error', () => {}); // el hijo puede cerrar stdin antes de leerlo todo
    proc.stdin.end(stdin);
  });
}

/** Interpreta la salida `--output-format json` (un objeto, o un arreglo de eventos con el tipo "result" al final). */
export function leerResultado(stdout) {
  let j;
  try {
    j = JSON.parse(stdout);
  } catch {
    throw new ErrorIA('ia_no_disponible', 'Claude Code no devolvió un JSON legible.', { reintentable: true, detalle: stdout.slice(0, 500) });
  }
  if (Array.isArray(j)) j = [...j].reverse().find((e) => e?.type === 'result') ?? j.at(-1);
  return j ?? {};
}

/** Clasifica un fallo de Claude Code (texto de error de la suscripción o de la red). */
export function clasificarFallo(texto) {
  const t = String(texto ?? '');
  if (/usage limit|limit reached|limit will reset|out of extra usage|reached your .*limit|weekly limit|5-hour limit/i.test(t)) {
    return new ErrorIA('limite_de_uso_ia', 'Se alcanzó el límite de uso de la suscripción de Claude. Hay que esperar a que se reinicie la ventana.', { reintentable: true, detalle: t.slice(0, 400) });
  }
  if (/not logged in|please run .*login|invalid api key|authentication|oauth token|401|unauthorized/i.test(t)) {
    return new ErrorIA('ia_no_disponible', 'Claude Code no tiene sesión. Ejecuta `claude login` o define CLAUDE_CODE_OAUTH_TOKEN (claude setup-token).', { reintentable: false, detalle: t.slice(0, 400) });
  }
  if (/overloaded|529|503|502|timeout|timed out|econnreset|enotfound|network|rate.?limit|429/i.test(t)) {
    return new ErrorIA('ia_no_disponible', 'Claude no está disponible o respondió con sobrecarga.', { reintentable: true, detalle: t.slice(0, 400) });
  }
  return new ErrorIA('ia_no_disponible', 'Claude Code terminó con error.', { reintentable: true, detalle: t.slice(0, 400) });
}

/** Estado de Claude Code en este servidor: instalado, versión y qué credencial usará (nunca se expone el valor). */
export async function infoClaude() {
  try {
    const r = await ejecutarClaude(['--version'], { timeoutMs: 30_000 });
    if (r.code !== 0) return { instalado: false, mensaje: `--version terminó con código ${r.code}` };
    const env = entornoLimpio();
    const credencial = env.CLAUDE_CODE_OAUTH_TOKEN ? 'token_de_suscripcion' : env.ANTHROPIC_API_KEY ? 'api_key' : 'login_local';
    return { instalado: true, version: r.stdout.trim(), credencial };
  } catch (e) {
    return { instalado: false, mensaje: e.message };
  }
}

/** Una llamada mínima REAL (una palabra) con los mismos parámetros que usa el servidor: confirma que la credencial funciona. */
export async function probarClaude() {
  const t0 = Date.now();
  try {
    const r = await ejecutarClaude(
      ['-p', '--output-format', 'json', '--model', config.claude.modelo, '--tools', '', '--max-turns', '1', '--no-session-persistence', '--setting-sources', 'project,local', '--strict-mcp-config'],
      { stdin: 'Responde exactamente con la palabra OK y nada más.', cwd: process.cwd(), timeoutMs: 120_000 },
    );
    const j = leerResultado(r.stdout);
    if (j.is_error || r.code !== 0) {
      const e = clasificarFallo(`${j.result ?? ''}
${r.stderr}`);
      return { ok: false, codigo: e.codigo, mensaje: e.message, detalle: e.detalle };
    }
    const u = j.usage ?? {};
    return {
      ok: true,
      respuesta: String(j.result).trim().slice(0, 40),
      segundos: Number(((Date.now() - t0) / 1000).toFixed(1)),
      modelo_pedido: config.claude.modelo,
      tokens_entrada: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      tokens_salida: u.output_tokens ?? 0,
    };
  } catch (e) {
    return { ok: false, codigo: e.codigo ?? 'ia_no_disponible', mensaje: e.message };
  }
}

export function crearIAClaude() {
  const c = config.claude;

  return {
    nombre: `claude (${c.modelo})`,
    proveedor: 'anthropic-claude-code',
    modelo: c.modelo,

    /** Escribe el prompt del sistema del trabajo en un archivo (supera el límite de longitud de la línea de comandos). */
    preparar(paq, dirTrabajo) {
      const archivo = join(dirTrabajo, 'sistema.md');
      writeFileSync(archivo, promptSistema(paq), 'utf8');
      return { archivoSistema: archivo };
    },

    /**
     * Resuelve una unidad de trabajo.
     * @returns {{bruto: object, uso: object}} bruto = JSON ya parseado de la respuesta (aún sin validar)
     */
    async resolver(unidad, paq, { coherencia = '', correccion = '', signal, preparado }) {
      const usuario = unidad.tipo === 'campos'
        ? promptCampos(paq, unidad.seccion, coherencia, correccion)
        : promptTablas(paq, unidad.seccion, unidad.tablas, coherencia, correccion);

      const args = [
        '-p',
        '--output-format', 'json',
        '--model', c.modelo,
        '--append-system-prompt-file', preparado.archivoSistema,
        '--tools', 'Read,Glob,Grep',
        '--allowedTools', 'Read,Glob,Grep',
        '--permission-mode', 'dontAsk',
        '--max-turns', String(c.maxTurnos),
        '--no-session-persistence',
        '--setting-sources', 'project,local',
        '--strict-mcp-config',
      ];
      if (c.esfuerzo) args.push('--effort', c.esfuerzo);

      const { stdout, stderr, code } = await ejecutarClaude(args, { stdin: usuario, cwd: paq.rutaRaiz, timeoutMs: c.timeoutMs, signal });
      let r;
      try {
        r = leerResultado(stdout);
      } catch (e) {
        if (code !== 0) throw clasificarFallo(`${stderr}\n${stdout}`);
        throw e;
      }
      const textoResultado = typeof r.result === 'string' ? r.result : '';
      if (r.is_error || (code !== 0 && !textoResultado)) throw clasificarFallo(`${textoResultado}\n${stderr}\n${r.subtype ?? ''}`);
      if (r.subtype === 'error_max_turns') throw new ErrorRespuesta('Se agotaron los turnos antes de terminar; trabaja más directo y entrega el JSON.');

      const u = r.usage ?? {};
      const uso = {
        llamadas: 1,
        tokens_entrada: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        tokens_salida: u.output_tokens ?? 0,
        costo_usd_referencial: r.total_cost_usd ?? 0,
      };
      return { bruto: extraerJson(textoResultado), uso };
    },
  };
}
