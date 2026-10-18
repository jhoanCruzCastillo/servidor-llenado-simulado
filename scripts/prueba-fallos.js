/**
 * Prueba de regresión de la ruta «Claude Code» SIN gastar cuota: levanta el servidor con un Claude Code falso (scripts/claude-falso.js)
 * que falla a propósito de distintas maneras, y comprueba cómo reacciona el servidor.
 *   npm run probar:fallos -- [paquete.zip]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const paquete = process.argv[2] ?? 'ejemplos/paquete_entrada_ejemplo_fte-cuidado-diurno.zip';
const PUERTO = 8092;
const base = `http://localhost:${PUERTO}`;
const H = { Authorization: 'Bearer prueba' };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const escenarios = [
  { nombre: 'Normal', env: {}, espera: (e) => e.estado === 'completado' && e.porcentaje === 100 && e.resultado },
  { nombre: 'Primera respuesta con basura → reintenta', env: { FALSO_FALLA: 'basura' }, espera: (e, log) => e.estado === 'completado' && /respuesta_invalida/.test(log) },
  { nombre: 'Primera respuesta con forma incorrecta → reintenta', env: { FALSO_FALLA: 'vacio' }, espera: (e, log) => e.estado === 'completado' && /respuesta_invalida/.test(log) },
  { nombre: 'Límite de la suscripción → error limite_de_uso_ia (reintentable)', env: { FALSO_FALLA: 'limite' }, espera: (e) => e.estado === 'error' && e.error?.codigo === 'limite_de_uso_ia' && e.error.reintentable === true && e.resultado === null },
  { nombre: 'Sin sesión → error ia_no_disponible (no reintentable)', env: { FALSO_FALLA: 'sin_sesion' }, espera: (e) => e.estado === 'error' && e.error?.codigo === 'ia_no_disponible' && e.error.reintentable === false },
  { nombre: 'Claude Code no existe → error ia_no_disponible', env: { CLAUDE_BIN: 'no-existe-claude-xyz', CLAUDE_BIN_ARGS: '', REINTENTOS: '0' }, espera: (e) => e.estado === 'error' && e.error?.codigo === 'ia_no_disponible' },
];

let fallos = 0;
for (const esc of escenarios) {
  const datos = mkdtempSync(join(tmpdir(), 'pf-fallos-'));
  let log = '';
  const srv = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, IA: 'claude', CLAUDE_BIN: process.execPath, CLAUDE_BIN_ARGS: resolve('scripts/claude-falso.js'), PUERTO: String(PUERTO), URL_PUBLICA: base, SERVIDOR_TOKEN: 'prueba', DATA_DIR: datos, REINTENTOS: '1', FALSO_CONTADOR: join(datos, 'contador.txt'), ...esc.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/v1/salud`)).ok) break; } catch { /* aún arrancando */ } await dormir(200); }
    const form = new FormData();
    form.append('paquete', new Blob([readFileSync(paquete)]), 'p.zip');
    form.append('metadata', JSON.stringify({ simulacion: { secciones: ['02'] } }));
    const c = await (await fetch(`${base}/v1/trabajos`, { method: 'POST', headers: H, body: form })).json();
    let e;
    for (let i = 0; i < 120; i++) {
      e = await (await fetch(`${base}/v1/trabajos/${c.trabajo_id}`, { headers: H })).json();
      if (['completado', 'error', 'cancelado'].includes(e.estado)) break;
      await dormir(500);
    }
    const bien = !!esc.espera(e, log);
    if (!bien) fallos++;
    console.log(`${bien ? '✔' : '✘'} ${esc.nombre}  →  ${e.estado}${e.error ? ` (${e.error.codigo})` : ''} · ${e.porcentaje}%`);
    if (!bien) console.log('   estado final:', JSON.stringify({ estado: e.estado, error: e.error, mensaje: e.mensaje }), '\n   log:', log.slice(-600));
  } finally {
    srv.kill();
    await dormir(300);
    rmSync(datos, { recursive: true, force: true }); // carpeta temporal creada por este mismo script
  }
}
console.log(fallos ? `\n${fallos} escenario(s) fallaron.` : '\nTodos los escenarios se comportaron como se espera.');
process.exit(fallos ? 1 : 0);
