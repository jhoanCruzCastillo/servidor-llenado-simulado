/**
 * Guarda lo que Claude descubrió al llenar (notas, scripts, mapas, skills que haya escrito)
 * para convertirlo después en una skill reutilizable. No se instala sola: hay que revisar el Excel.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const SKIP_DIR = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv']);
const TEXT = /\.(md|txt|json|py|js|mjs|cjs|ts|ps1|sh|bat|csv|yml|yaml|toml|ini|cfg|xml|html)$/i;
const MAX_BYTES = 2_000_000;

function walk(dir, fn) {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, n.name);
    if (n.isDirectory()) {
      if (!SKIP_DIR.has(n.name)) walk(p, fn);
    } else fn(p, n.name);
  }
}

/**
 * @param {string} cwd  directorio de trabajo de Claude (paquete)
 * @param {string} dest carpeta destino (p. ej. trabajos/<id>/conocimiento-cosechado)
 * @param {Set<string>} originales rutas relativas del paquete original (posix)
 * @returns {string[]}
 */
export function cosecharConocimiento(cwd, dest, originales = new Set()) {
  mkdirSync(dest, { recursive: true });
  const copiados = [];
  walk(cwd, (p, nombre) => {
    const rel = relative(cwd, p).replaceAll('\\', '/');
    const bajoConocimiento = rel.startsWith('conocimiento/');
    const skillNueva = rel.startsWith('.claude/skills/');
    if (!bajoConocimiento && !skillNueva && originales.has(rel)) return;
    if (!bajoConocimiento && !skillNueva && !TEXT.test(nombre)) return;
    let bytes = 0;
    try { bytes = statSync(p).size; } catch { return; }
    if (bytes > MAX_BYTES) return;
    const out = join(dest, rel);
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(p, out);
    copiados.push(rel);
  });
  writeFileSync(join(dest, 'indice.json'), `${JSON.stringify({
    generado_en: new Date().toISOString(),
    nota: 'Material que Claude dejó al llenar. Si el Excel está bien, esto se convierte en skill de la plantilla.',
    archivos: copiados,
  }, null, 2)}\n`);
  return copiados;
}

/** Permisos de proyecto para que Claude Code pueda instalar deps y escribir sin preguntar. */
export function escribirSettingsAgente(cwd) {
  const dir = join(cwd, '.claude');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(cwd, 'conocimiento'), { recursive: true });
  writeFileSync(join(dir, 'settings.json'), `${JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions' },
  }, null, 2)}\n`);
}
