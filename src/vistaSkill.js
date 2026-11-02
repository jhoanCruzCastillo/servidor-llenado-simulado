/**
 * Carpeta de trabajo de Claude en motor `skill`.
 * Archivos: Excel en blanco, Excel(es) de ejemplo, PDFs/originales de la fuente de la verdad,
 * y el proceso aprendido (skill fte-ebr-v03-llenado) en ./conocimiento/.
 * El texto del chatbot de la ficha no se copia aquí: viaja como mensaje (stdin).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const esExcel = (n) => /\.(xlsx|xlsm)$/i.test(n);

function copiarExcels(origen, destino) {
  if (!existsSync(origen)) return;
  mkdirSync(destino, { recursive: true });
  for (const n of readdirSync(origen)) {
    if (esExcel(n)) copyFileSync(join(origen, n), join(destino, n));
  }
}

function copiarFuente(src04, dest04) {
  const docs = join(src04, 'documentos');
  if (!existsSync(docs)) return;
  mkdirSync(join(dest04, 'documentos'), { recursive: true });
  for (const n of readdirSync(docs)) {
    if (n.startsWith('_') || /\.md$/i.test(n)) continue;
    copyFileSync(join(docs, n), join(dest04, 'documentos', n));
  }
}

function copiarSkillAprendida(destino) {
  const skill = join(config.claude.skillAprendido, '.claude', 'skills', 'fte-ebr-v03-llenado');
  if (!existsSync(join(skill, 'SKILL.md'))) return;
  const dest = join(destino, 'conocimiento');
  mkdirSync(join(dest, 'scripts'), { recursive: true });
  copyFileSync(join(skill, 'SKILL.md'), join(dest, 'SKILL.md'));
  const refs = join(skill, 'references');
  if (existsSync(refs)) {
    mkdirSync(join(dest, 'references'), { recursive: true });
    for (const n of readdirSync(refs)) {
      copyFileSync(join(refs, n), join(dest, 'references', n));
    }
  }
  const scripts = join(skill, 'scripts');
  if (existsSync(scripts)) {
    for (const n of readdirSync(scripts)) {
      copyFileSync(join(scripts, n), join(dest, 'scripts', n));
    }
  }
}

export function prepararVistaSkill(paq, destino) {
  mkdirSync(destino, { recursive: true });
  copiarExcels(join(paq.rutaRaiz, '02_estructura_base'), join(destino, '02_estructura_base'));
  copiarExcels(join(paq.rutaRaiz, '03_ejemplo_referencia'), join(destino, '03_ejemplo_referencia'));
  copiarFuente(join(paq.rutaRaiz, '04_proyecto_del_usuario'), join(destino, '04_proyecto_del_usuario'));
  copiarSkillAprendida(destino);
}
