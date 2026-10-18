/**
 * Cliente de prueba: hace lo que hará la plataforma. Envía un paquete, consulta el estado hasta el final, descarga el resultado,
 * verifica bytes/sha256 y comprueba que respuesta.json cubre todo lo que pedía el paquete.
 *
 *   npm run probar -- <paquete.zip> [--secciones 01,06] [--max-unidades 3] [--cancelar-en 20] [--url http://localhost:8090] [--token ...]
 */
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opcion = (n, def) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : def; };
const archivo = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!archivo) { console.error('Uso: npm run probar -- <paquete.zip> [--secciones 01,06] [--max-unidades N] [--cancelar-en SEG]'); process.exit(2); }

const base = (opcion('url', process.env.URL_PUBLICA || `http://localhost:${process.env.PUERTO || 8090}`)).replace(/\/+$/, '');
const token = opcion('token', process.env.SERVIDOR_TOKEN || 'dev-token-cambiar');
const cancelarEn = Number(opcion('cancelar-en', 0));
const H = { Authorization: `Bearer ${token}` };

const simulacion = {};
if (opcion('secciones')) simulacion.secciones = opcion('secciones').split(',').map((s) => s.trim());
if (opcion('max-unidades')) simulacion.max_unidades = Number(opcion('max-unidades'));

const form = new FormData();
form.append('paquete', new Blob([readFileSync(archivo)], { type: 'application/zip' }), 'paquete.zip');
form.append('metadata', JSON.stringify({ referencia: { prueba: true }, ...(Object.keys(simulacion).length ? { simulacion } : {}) }));

let r = await fetch(`${base}/v1/trabajos`, { method: 'POST', headers: { ...H, 'Idempotency-Key': `prueba-${Date.now()}` }, body: form });
const creado = await r.json();
console.log('POST /v1/trabajos →', r.status, creado);
if (r.status !== 202) process.exit(1);
const id = creado.trabajo_id;

const t0 = Date.now();
let ultimo = '';
let cancelado = false;
let e;
while (true) {
  e = await (await fetch(`${base}/v1/trabajos/${id}`, { headers: H })).json();
  const linea = `${String(e.porcentaje).padStart(3)}%  ${e.estado.padEnd(10)} ${e.etapa.padEnd(22)} ${e.mensaje}`;
  if (linea !== ultimo) { console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s  ${linea}`); ultimo = linea; }
  if (['completado', 'error', 'cancelado'].includes(e.estado)) break;
  if (cancelarEn && !cancelado && (Date.now() - t0) / 1000 >= cancelarEn) {
    cancelado = true;
    const c = await fetch(`${base}/v1/trabajos/${id}/cancelar`, { method: 'POST', headers: H });
    console.log('POST cancelar →', c.status, (await c.json()).estado);
  }
  await new Promise((res) => setTimeout(res, 2000));
}

console.log('\nFinal:', e.estado, '| terminado_en:', e.terminado_en, '| advertencias:', e.advertencias.length);
if (e.error) console.log('error:', e.error);
if (e.estado !== 'completado') process.exit(e.estado === 'cancelado' && cancelarEn ? 0 : 1);

// ── Descarga y verificación del resultado ─────────────────────────────────────
const dl = await fetch(e.resultado.url);
const buf = Buffer.from(await dl.arrayBuffer());
const okBytes = buf.length === e.resultado.bytes;
const okSha = createHash('sha256').update(buf).digest('hex') === e.resultado.sha256;
console.log(`descarga: ${dl.status} · ${(buf.length / 1048576).toFixed(1)} MB · bytes ${okBytes ? 'OK' : 'NO COINCIDEN'} · sha256 ${okSha ? 'OK' : 'NO COINCIDE'}`);

const zip = new AdmZip(buf);
const nombres = zip.getEntries().map((x) => x.entryName);
console.log('contenido:', nombres.map((n) => n.split('/').pop()).join(', '));
const leerJson = (fin) => JSON.parse(zip.getEntries().find((x) => x.entryName.endsWith(fin)).getData().toString('utf8'));
const resp = leerJson('respuesta.json');
const resumen = leerJson('resumen.json');

const pq = new AdmZip(readFileSync(archivo));
const raizP = pq.getEntries()[0].entryName.split('/')[0];
const secs = JSON.parse(pq.getEntry(`${raizP}/05_secciones_a_llenar/secciones.json`).getData().toString('utf8')).secciones;
const idsCampos = secs.flatMap((s) => s.campos.map((c) => c.identificador));
const idsTablas = pq.getEntries().filter((x) => /\/tablas\/[^/]+\.md$/.test(x.entryName)).map((x) => x.entryName.split('/').pop().slice(0, -3));
const respCampos = new Set(resp.secciones.flatMap((s) => s.campos.map((c) => c.id)));
const respTablas = new Set(resp.tablas.map((x) => x.identificador));
const faltanC = idsCampos.filter((i) => !respCampos.has(i));
const faltanT = idsTablas.filter((i) => !respTablas.has(i));
console.log(`cobertura: campos ${idsCampos.length - faltanC.length}/${idsCampos.length} · tablas ${idsTablas.length - faltanT.length}/${idsTablas.length}`);
console.log('conteos:', JSON.stringify(resumen.conteos.campos_texto), '| tablas sin cambios:', resumen.conteos.tablas_sin_cambios_respecto_al_formato, '| excel:', resumen.excel.incluido);
console.log('modelos:', JSON.stringify(resumen.modelos));
const bien = okBytes && okSha && !faltanC.length && !faltanT.length;
console.log(bien ? '\nOK: el resultado cumple el contrato.' : '\nFALLO: revisa los puntos de arriba.');
process.exit(bien ? 0 : 1);
