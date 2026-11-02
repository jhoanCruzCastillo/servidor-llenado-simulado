/**
 * Localiza el Excel que escribió Claude en el directorio del trabajo (no el formato en blanco ni el ejemplo).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const EXCEL = /\.(xlsx|xlsm)$/i;
const SKIP_DIR = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.claude']);

function listar(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, n.name);
    if (n.isDirectory()) {
      if (!SKIP_DIR.has(n.name)) listar(p, acc);
    } else if (EXCEL.test(n.name)) acc.push(p);
  }
  return acc;
}

function tocado(p, desdeMs) {
  try { return statSync(p).mtimeMs > desdeMs + 1500; } catch { return false; }
}

/**
 * @param {string} cwd
 * @param {{ formato?: string|null, ejemplo?: string|null, desdeMs: number }} opts
 * @returns {string|null}
 */
export function hallarExcelLlenado(cwd, { formato = null, ejemplo = null, desdeMs }) {
  const files = listar(cwd);
  const cand = files.filter((p) => {
    const b = basename(p).toLowerCase();
    if (ejemplo && p === ejemplo) return false;
    if (/^ejemplo\./i.test(b)) return false;
    if (formato && p === formato) return tocado(p, desdeMs);
    if (/^formato_base\./i.test(b)) return tocado(p, desdeMs);
    return true;
  });
  const prefer = (re) => cand.find((p) => re.test(basename(p)));
  return prefer(/ficha_llenada/i)
    || prefer(/entregable/i)
    || prefer(/llenad/i)
    || cand.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    || null;
}
