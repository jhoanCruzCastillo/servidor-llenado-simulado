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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { promptSistema, promptUnidad } from '../prompts.js';
import { ErrorRespuesta, extraerJsonTolerante } from '../validar.js';

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
export function ejecutarClaude(args, { stdin = '', cwd, timeoutMs, signal, extraEnv } = {}) {
  const { cmd, args: previos, shell } = resolverBin();
  const todos = [...previos, ...args];
  const env = extraEnv ? { ...entornoLimpio(), ...extraEnv } : entornoLimpio();
  return new Promise((resolve, reject) => {
    const proc = shell
      ? spawn([comillas(cmd), ...todos.map(comillas)].join(' '), { cwd, env, shell: true, windowsHide: true })
      : spawn(cmd, todos, { cwd, env, windowsHide: true });
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
  if (/no conversation found|session .* not found|unknown session/i.test(t)) {
    return new ErrorIA('sesion_ia_perdida', 'La sesión de Claude ya no existe; se reintentará desde cero.', { reintentable: true, detalle: t.slice(0, 400) });
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

/**
 * Prueba REAL de la conexión de herramientas con Excel: Claude Code lanza el servidor MCP de prueba, llama a `ver_hoja` sobre un Excel diminuto y responde
 * la palabra que hay en B1. Si esto pasa, el llenado con herramientas (Claude Code ↔ MCP ↔ Excel) está bien cableado en este servidor.
 */
export async function probarClaudeExcel() {
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'pf-prueba-excel-'));
  try {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const mcpConfig = join(dir, 'mcp.json');
    writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { [SERVIDOR_MCP]: { type: 'stdio', command: process.execPath, args: [resolve(aqui, '../excel/mcp-prueba.js'), resolve(aqui, '../excel/prueba/prueba.xlsx')], env: {} } } }));
    const r = await ejecutarClaude(
      ['-p', '--output-format', 'json', '--model', config.claude.modelo, '--mcp-config', mcpConfig, '--strict-mcp-config', '--tools', '', '--allowedTools', `mcp__${SERVIDOR_MCP}__ver_hoja`, '--permission-mode', 'dontAsk', '--max-turns', '6', '--no-session-persistence', '--setting-sources', 'project,local'],
      { stdin: 'Usa la herramienta ver_hoja para mirar la hoja «Hoja de prueba» y responde SOLO con el valor de la celda B1, sin nada más.', cwd: dir, timeoutMs: 180_000 },
    );
    const j = leerResultado(r.stdout);
    if (j.is_error || r.code !== 0) {
      const e = clasificarFallo(`${j.result ?? ''}
${r.stderr}`);
      return { ok: false, codigo: e.codigo, mensaje: e.message, detalle: e.detalle };
    }
    const respuesta = String(j.result ?? '').trim();
    const funciona = respuesta.includes('MANZANA-42');
    return {
      ok: funciona,
      mensaje: funciona ? 'Claude Code llamó a la herramienta del Excel y leyó la celda B1.' : 'Claude Code respondió, pero no con el valor de la celda: no usó la herramienta (revisa permisos o la conexión MCP).',
      respuesta: respuesta.slice(0, 120),
      turnos: j.num_turns ?? null,
      segundos: Number(((Date.now() - t0) / 1000).toFixed(1)),
      modelo_pedido: config.claude.modelo,
    };
  } catch (e) {
    return { ok: false, codigo: e.codigo ?? 'ia_no_disponible', mensaje: e.message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Nombre del servidor MCP del Excel y sus herramientas (las ve Claude Code como mcp__<servidor>__<herramienta>). */
export const SERVIDOR_MCP = 'excel_ficha';
export const HERRAMIENTAS_MCP = ['ver_hoja', 'llenar_campos', 'llenar_tablas', 'pedir_datos'];

export function crearIAClaude() {
  const c = config.claude;

  return {
    nombre: `claude (${c.modelo})`,
    proveedor: 'anthropic-claude-code',
    modelo: c.modelo,

    /**
     * Escribe el prompt del sistema del trabajo en un archivo (supera el límite de longitud de la línea de comandos).
     * Con `sesion` (modo Excel) también deja la configuración MCP que lanza la «mesa de trabajo» del Excel (src/excel/mcp-excel.js).
     */
    preparar(paq, dirTrabajo, { sesion, puedePreguntar = false } = {}) {
      const archivo = join(dirTrabajo, 'sistema.md');
      writeFileSync(archivo, promptSistema(paq, { excel: !!sesion, preguntas: !!sesion && puedePreguntar }), 'utf8');
      const dirConfig = join(config.dataDir, 'claude-llenado');
      mkdirSync(dirConfig, { recursive: true });
      const preparado = { archivoSistema: archivo, dirConfig };
      if (sesion) {
        const mcpConfig = join(dirTrabajo, 'mcp.json');
        const servidor = resolve(dirname(fileURLToPath(import.meta.url)), '../excel/mcp-excel.js');
        writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { [SERVIDOR_MCP]: { type: 'stdio', command: process.execPath, args: [servidor, '--raiz', paq.rutaRaiz, '--sesion', sesion.dir], env: {} } } }, null, 2));
        preparado.mcpConfig = mcpConfig;
      }
      return preparado;
    },

    /**
     * Resuelve una unidad de trabajo.
     * @returns {{bruto: object, uso: object}} bruto = JSON ya parseado de la respuesta (aún sin validar)
     */
    async resolver(unidad, paq, { coherencia = '', correccion = '', signal, preparado, datos = '', sessionId = null }) {
      const usuario = promptUnidad(unidad, paq, coherencia, correccion, { datos });

      const args = [
        '-p',
        '--output-format', 'json',
        '--model', c.modelo,
        '--append-system-prompt-file', preparado.archivoSistema,
        '--tools', 'Read,Glob,Grep',
        '--allowedTools', 'Read,Glob,Grep',
        '--permission-mode', 'dontAsk',
        '--max-turns', String(c.maxTurnos),
        '--setting-sources', 'project,local',
        '--strict-mcp-config',
      ];
      if (sessionId) args.push('--resume', sessionId);
      if (c.esfuerzo) args.push('--effort', c.esfuerzo);

      const extraEnv = preparado.dirConfig ? { CLAUDE_CONFIG_DIR: preparado.dirConfig } : undefined;
      const { stdout, stderr, code } = await ejecutarClaude(args, { stdin: usuario, cwd: paq.rutaRaiz, timeoutMs: c.timeoutMs, signal, extraEnv });
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
      const { json, reparado } = extraerJsonTolerante(textoResultado);
      return { bruto: json, uso, reparado, sessionId: r.session_id ?? sessionId ?? null };
    },

    /**
     * Resuelve una unidad trabajando sobre el Excel: Claude Code mira la hoja y entrega con las herramientas (src/excel/mcp-excel.js), que validan y
     * escriben en el Excel. No devuelve el contenido: queda en la sesión (`sesion.recargar()` y consultar), el llamador comprueba qué se entregó.
     * @returns {{uso: object}}
     */
    async ejecutarUnidad(unidad, paq, { coherencia = '', correccion = '', signal, preparado, datos = '', sessionId = null }) {
      const usuario = promptUnidad(unidad, paq, coherencia, correccion, { excel: true, datos });

      const mcp = HERRAMIENTAS_MCP.map((h) => `mcp__${SERVIDOR_MCP}__${h}`);
      const args = [
        '-p',
        '--output-format', 'json',
        '--model', c.modelo,
        '--append-system-prompt-file', preparado.archivoSistema,
        '--mcp-config', preparado.mcpConfig,
        '--strict-mcp-config',
        '--tools', 'Read,Glob,Grep',
        '--allowedTools', ['Read', 'Glob', 'Grep', ...mcp].join(','),
        '--permission-mode', 'dontAsk',
        '--max-turns', String(c.maxTurnos),
        '--setting-sources', 'project,local',
      ];
      if (sessionId) args.push('--resume', sessionId);
      if (c.esfuerzo) args.push('--effort', c.esfuerzo);

      const extraEnv = preparado.dirConfig ? { CLAUDE_CONFIG_DIR: preparado.dirConfig } : undefined;
      const { stdout, stderr, code } = await ejecutarClaude(args, { stdin: usuario, cwd: paq.rutaRaiz, timeoutMs: c.timeoutMs, signal, extraEnv });
      let r;
      try {
        r = leerResultado(stdout);
      } catch (e) {
        if (code !== 0) throw clasificarFallo(`${stderr}
${stdout}`);
        throw e;
      }
      const textoResultado = typeof r.result === 'string' ? r.result : '';
      if (r.is_error || (code !== 0 && !textoResultado)) throw clasificarFallo(`${textoResultado}
${stderr}
${r.subtype ?? ''}`);
      // Sin turnos suficientes puede haber entregado la mitad: el llamador mira qué quedó en la sesión y reintenta lo que falta.
      const u = r.usage ?? {};
      return {
        uso: {
          llamadas: 1,
          tokens_entrada: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          tokens_salida: u.output_tokens ?? 0,
          costo_usd_referencial: r.total_cost_usd ?? 0,
        },
        agotoTurnos: r.subtype === 'error_max_turns',
        cierre: textoResultado.slice(0, 300),
        sessionId: r.session_id ?? sessionId ?? null,
      };
    },
  };
}
