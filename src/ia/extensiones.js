/**
 * Extensiones de Claude Code para el llenado: plugin propio (skills cortas) y ajustes de cuota.
 *
 * No se instalan plugins del marketplace: cada skill/comando que Claude puede invocar solo
 * (nombre + descripción) entra en el contexto de TODOS los turnos y gasta cuota aunque no se use.
 * Las bundled (`/batch`, `/debug`, `/code-review`…) se apagan. Las dos skills de este plugin
 * se cargan con `--plugin-dir` y también se copian a CLAUDE_CONFIG_DIR para --resume.
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR_PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../claude-plugin');
export const HERRAMIENTAS_ARCHIVO = ['Read', 'Glob', 'Grep', 'Skill'];

export function prepararExtensiones(dirConfig) {
  mkdirSync(dirConfig, { recursive: true });
  writeFileSync(join(dirConfig, 'settings.json'), `${JSON.stringify({ disableBundledSkills: true }, null, 2)}\n`);
  const onboarding = join(dirConfig, '.claude.json');
  if (!existsSync(onboarding)) writeFileSync(onboarding, JSON.stringify({ hasCompletedOnboarding: true }));

  const origen = join(DIR_PLUGIN, 'skills');
  if (existsSync(origen)) cpSync(origen, join(dirConfig, 'skills'), { recursive: true });

  return { pluginDir: existsSync(join(DIR_PLUGIN, '.claude-plugin', 'plugin.json')) ? DIR_PLUGIN : null };
}

/** Flags comunes de Claude Code en el llenado (plugin + skill tool; sin bundled). */
export function argsExtensiones(preparado) {
  const args = ['--setting-sources', 'user,project,local'];
  if (preparado.pluginDir) args.push('--plugin-dir', preparado.pluginDir);
  return args;
}
