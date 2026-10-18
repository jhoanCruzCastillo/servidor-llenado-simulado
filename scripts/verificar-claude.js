/**
 * Comprueba que Claude Code está instalado, con sesión, y que el servidor lo va a usar con la SUSCRIPCIÓN (no con la API de pago).
 * Hace UNA llamada mínima real (consume una fracción ínfima de la cuota). Uso: npm run verificar:claude
 */
import { config } from '../src/config.js';
import { ejecutarClaude, entornoLimpio, leerResultado, resolverBin } from '../src/ia/claude.js';

const ok = (m) => console.log(`  ✔ ${m}`);
const aviso = (m) => console.log(`  ⚠ ${m}`);
const mal = (m) => console.log(`  ✘ ${m}`);

console.log('Verificación de Claude Code\n');
const bin = resolverBin();
console.log(`Ejecutable: ${bin.cmd}${bin.args.length ? ' ' + bin.args.join(' ') : ''}`);

// 1) Variables que desviarían a la API de pago
const peligrosas = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'].filter((k) => process.env[k]);
if (peligrosas.length && !config.claude.permitirApiKey) aviso(`${peligrosas.join(', ')} está definida en este entorno: el servidor la IGNORA al lanzar Claude Code, para no cobrar por API.`);
else if (peligrosas.length) aviso(`PERMITIR_API_KEY=1: se usará ${peligrosas.join(', ')} → se COBRA por API, no por suscripción.`);
else ok('No hay variables de API de pago en el entorno.');
const limpio = entornoLimpio();
console.log(limpio.CLAUDE_CODE_OAUTH_TOKEN ? '  ✔ Se usará CLAUDE_CODE_OAUTH_TOKEN (token de `claude setup-token`).' : '  · Sin CLAUDE_CODE_OAUTH_TOKEN: se usará el login de `claude login` de este equipo.');

// 2) Versión
let r;
try {
  r = await ejecutarClaude(['--version'], { timeoutMs: 30_000 });
} catch (e) {
  mal(e.message);
  process.exit(1);
}
if (r.code !== 0) { mal(`--version terminó con código ${r.code}: ${r.stderr.slice(0, 200)}`); process.exit(1); }
ok(`Versión: ${r.stdout.trim()}`);

// 3) Estado de autenticación (informativo)
try {
  const a = await ejecutarClaude(['auth', 'status'], { timeoutMs: 30_000 });
  console.log('\n`claude auth status`:\n' + (a.stdout || a.stderr).trim().split('\n').map((l) => '    ' + l).join('\n'));
} catch { /* algunas versiones no tienen el subcomando */ }

// 4) Llamada mínima real, con los mismos parámetros que el servidor
console.log('\nLlamada de prueba (mínima)…');
const t0 = Date.now();
try {
  r = await ejecutarClaude(
    ['-p', '--output-format', 'json', '--model', config.claude.modelo, '--tools', '', '--max-turns', '1', '--no-session-persistence', '--setting-sources', 'project,local', '--strict-mcp-config'],
    { stdin: 'Responde exactamente con la palabra OK y nada más.', cwd: process.cwd(), timeoutMs: 120_000 },
  );
  const j = leerResultado(r.stdout);
  if (j.is_error || r.code !== 0) {
    mal(`Claude Code respondió con error: ${String(j.result ?? r.stderr).slice(0, 300)}`);
    console.log('\n  Si dice que no hay sesión: ejecuta `claude login` con tu cuenta Pro, o genera un token con `claude setup-token` y ponlo en .env como CLAUDE_CODE_OAUTH_TOKEN.');
    process.exit(1);
  }
  ok(`Respuesta: «${String(j.result).trim().slice(0, 40)}» en ${((Date.now() - t0) / 1000).toFixed(1)} s · modelo pedido: ${config.claude.modelo}`);
  const u = j.usage ?? {};
  console.log(`  · tokens: entrada ${(u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)}, salida ${u.output_tokens ?? 0}`);
  console.log(`  · total_cost_usd reportado: ${j.total_cost_usd ?? 'n/d'} (con suscripción es solo referencial: no se factura)`);
  console.log('\nTodo listo. Arranca el servidor con `npm start` (IA=claude).');
} catch (e) {
  mal(e.message);
  process.exit(1);
}
