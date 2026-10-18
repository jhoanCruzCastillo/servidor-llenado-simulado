/**
 * Genera vendor/excel-ficha.mjs: el MISMO código de Excel que usa la plataforma en el navegador (escritor `insertarValoresEnExcel`, lector `leerLibroXlsx`,
 * evaluador de fórmulas y listas, volcado `leerValoresDeExcel`), empaquetado para Node. Así el Excel que entrega este servidor se escribe y se lee con las
 * mismas reglas que el de la plataforma (fechas, números, desplegables, crecimiento de tablas, fórmulas nativas), sin reescribir nada.
 *
 *   cd tools/excel-node && npm install && npm run build
 *
 * Requiere el repositorio del frontend junto a este (../frontend, como en el monorepo local). El resultado se commitea; en Railway no se vuelve a generar.
 * Hay que regenerarlo cuando cambie el código de Excel del frontend.
 */
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

// El frontend baja el Excel con fetchBinarioOrFalla (token del navegador, window…): en Node se sustituye por un lector de archivos / data URIs.
const sustituirFetchBinario = {
  name: 'sustituir-fetch-binario',
  setup(b) {
    b.onResolve({ filter: /(^|\/)fetchBinario$/ }, () => ({ path: resolve(aqui, 'shim/fetchBinario.ts') }));
  },
};

await build({
  entryPoints: [resolve(aqui, 'entrada.ts')],
  outfile: resolve(aqui, '../../vendor/excel-ficha.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  plugins: [sustituirFetchBinario],
  alias: { '@': resolve(aqui, '../../../frontend/src') },
  banner: { js: '// GENERADO por tools/excel-node (npm run build). No editar a mano.\nimport { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  legalComments: 'none',
  logLevel: 'info',
});
