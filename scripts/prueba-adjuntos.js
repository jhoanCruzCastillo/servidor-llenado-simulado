/**
 * Prueba de los archivos adjuntos del chat SIN gastar cuota (Claude Code falso): subida cruda, clasificación, extracción de texto de Office,
 * envío con adjuntos (el falso comprueba que existen en el directorio de trabajo de la conversación), validaciones y borrado.
 *   npm run probar:adjuntos
 */
import AdmZip from 'adm-zip';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PUERTO = 8094;
const base = `http://localhost:${PUERTO}`;
const AUTH = { Authorization: 'Bearer prueba' };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const ok = (cond, texto, detalle = '') => { if (!cond) fallos++; console.log(`${cond ? '✔' : '✘'} ${texto}${!cond && detalle ? `  → ${detalle}` : ''}`); };

const datos = mkdtempSync(join(tmpdir(), 'pf-adj-'));
const srv = spawn(process.execPath, ['src/index.js'], {
  env: { ...process.env, IA: 'claude', CLAUDE_BIN: process.execPath, CLAUDE_BIN_ARGS: resolve('scripts/claude-falso.js'), PUERTO: String(PUERTO), URL_PUBLICA: base, SERVIDOR_TOKEN: 'prueba', DATA_DIR: datos, FALSO_CONTADOR: join(datos, 'c.txt'), CHAT_MAX_ARCHIVO_MB: '1', CHAT_MAX_ARCHIVOS: '4' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
srv.stdout.on('data', (d) => { log += d; });
srv.stderr.on('data', (d) => { log += d; });

const json = async (ruta, opciones = {}) => {
  const r = await fetch(`${base}${ruta}`, { ...opciones, headers: { ...AUTH, 'Content-Type': 'application/json', ...opciones.headers } });
  return { status: r.status, cuerpo: r.status === 204 ? null : await r.json().catch(() => null) };
};
const subir = async (id, nombre, bytes, tipo = 'application/octet-stream') => {
  const r = await fetch(`${base}/v1/chat/conversaciones/${id}/archivos?nombre=${encodeURIComponent(nombre)}`, { method: 'POST', headers: { ...AUTH, 'Content-Type': tipo }, body: bytes });
  return { status: r.status, cuerpo: await r.json().catch(() => null) };
};
async function mensaje(id, cuerpo) {
  const r = await fetch(`${base}/v1/chat/conversaciones/${id}/mensajes`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!r.ok) return { status: r.status, error: (await r.json()).error, texto: '' };
  const t = await r.text();
  const texto = [...t.matchAll(/event: delta\ndata: (.+)/g)].map((m) => JSON.parse(m[1]).texto).join('');
  return { status: r.status, texto, fin: /event: fin/.test(t) };
}

// Archivos de prueba: un docx, un pptx y un xlsx mínimos (zip de XML), como los que abre Office.
const zipDe = (archivos) => { const z = new AdmZip(); for (const [n, c] of Object.entries(archivos)) z.addFile(n, Buffer.from(c)); return z.toBuffer(); };
const docx = zipDe({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Informe de &amp; prueba</w:t></w:r></w:p><w:p><w:r><w:t>Segunda línea con ñ</w:t></w:r></w:p></w:body></w:document>' });
const pptx = zipDe({ 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Segunda</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Portada</a:t></a:r></a:p></p:sld>' });
const xlsx = zipDe({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Nombre</t></si><si><t>Edad</t></si><si><t>Ana</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>31</v></c></row></sheetData></worksheet>',
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/v1/salud`)).ok) break; } catch { /* arrancando */ } await dormir(200); }

  const lim = await json('/v1/chat/modelos');
  ok(lim.cuerpo?.adjuntos?.max_por_mensaje === 4 && lim.cuerpo.adjuntos.max_bytes_por_archivo === 1048576, 'el servidor informa los límites de adjuntos', JSON.stringify(lim.cuerpo?.adjuntos));

  const conv = (await json('/v1/chat/conversaciones', { method: 'POST', body: '{}' })).cuerpo;
  const id = conv.id;

  console.log('── Subida y clasificación');
  const a1 = await subir(id, 'foto de prueba.png', png, 'image/png');
  ok(a1.status === 201 && a1.cuerpo.categoria === 'imagen' && a1.cuerpo.legible && a1.cuerpo.bytes === png.length, 'imagen PNG: guardada y legible', JSON.stringify(a1));
  const a2 = await subir(id, 'informe.docx', docx);
  ok(a2.status === 201 && a2.cuerpo.categoria === 'documento' && a2.cuerpo.texto_extraido === true, 'docx: se extrae el texto', JSON.stringify(a2.cuerpo));
  const txt = join(datos, 'chat-cwd', id, 'adjuntos', a2.cuerpo.id, 'informe.docx.texto.txt');
  ok(existsSync(txt) && readFileSync(txt, 'utf8') === 'Informe de & prueba\nSegunda línea con ñ', 'el texto del docx conserva párrafos, entidades y tildes', existsSync(txt) ? JSON.stringify(readFileSync(txt, 'utf8')) : 'no existe');
  const a3 = await subir(id, 'cuadro.xlsx', xlsx);
  ok(a3.cuerpo?.texto_extraido === true && readFileSync(join(datos, 'chat-cwd', id, 'adjuntos', a3.cuerpo.id, 'cuadro.xlsx.texto.txt'), 'utf8') === '=== Hoja: Datos ===\nNombre\tEdad\nAna\t31', 'xlsx: hojas y celdas en texto');
  const a4 = await subir(id, 'diapos.pptx', pptx);
  ok(a4.cuerpo?.texto_extraido === true && /Diapositiva 1 ---\nPortada[\s\S]*Diapositiva 2 ---\nSegunda/.test(readFileSync(join(datos, 'chat-cwd', id, 'adjuntos', a4.cuerpo.id, 'diapos.pptx.texto.txt'), 'utf8')), 'pptx: diapositivas en orden numérico');
  // Con a1..a4 ya hay 4 pendientes (el máximo): el siguiente se rechaza.
  const exceso = await subir(id, 'otro.txt', Buffer.from('x'), 'text/plain');
  ok(exceso.status === 409 && exceso.cuerpo?.error?.codigo === 'demasiados_archivos', 'más de CHAT_MAX_ARCHIVOS pendientes → 409', JSON.stringify(exceso));
  for (const a of [a4]) await json(`/v1/chat/conversaciones/${id}/archivos/${a.cuerpo.id}`, { method: 'DELETE' });
  ok(!existsSync(join(datos, 'chat-cwd', id, 'adjuntos', a4.cuerpo.id)), 'DELETE de un adjunto pendiente lo borra del disco');

  const grande = await subir(id, 'enorme.bin', Buffer.alloc(1048576 + 10, 1));
  ok(grande.status === 413, 'archivo mayor que el máximo → 413', JSON.stringify(grande));
  const vacio = await subir(id, 'vacio.txt', Buffer.alloc(0), 'text/plain');
  ok(vacio.status === 400 && vacio.cuerpo?.error?.codigo === 'archivo_vacio', 'archivo vacío → 400');
  await json(`/v1/chat/conversaciones/${id}/archivos/${a3.cuerpo.id}`, { method: 'DELETE' });
  const bin = await subir(id, 'programa.exe', Buffer.from([0x4d, 0x5a, 0, 1, 2]));
  ok(bin.status === 201 && bin.cuerpo.legible === false && /binario/.test(bin.cuerpo.motivo), 'binario desconocido: se guarda pero se marca como no legible', JSON.stringify(bin.cuerpo));
  await json(`/v1/chat/conversaciones/${id}/archivos/${bin.cuerpo.id}`, { method: 'DELETE' });
  const raro = await subir(id, '../../etc/passwd', Buffer.from('x'), 'text/plain');
  ok(raro.status === 201 && !/[\\/]/.test(raro.cuerpo.nombre), 'el nombre se sanea (sin rutas)', JSON.stringify(raro.cuerpo));
  await json(`/v1/chat/conversaciones/${id}/archivos/${raro.cuerpo.id}`, { method: 'DELETE' });

  console.log('── Envío con adjuntos');
  const sinNada = await mensaje(id, { contenido: '' });
  ok(sinNada.status === 400 && sinNada.error?.codigo === 'mensaje_vacio', 'sin texto y sin archivos → 400');
  const ajeno = await mensaje(id, { contenido: 'hola', archivos: ['0123456789'] });
  ok(ajeno.status === 400 && ajeno.error?.codigo === 'archivo_invalido', 'archivo inexistente → 400');
  const r = await mensaje(id, { contenido: 'Mira esto', archivos: [a1.cuerpo.id, a2.cuerpo.id] });
  ok(r.status === 200 && r.fin, 'mensaje con adjuntos → respuesta completa', r.texto.slice(0, 200));
  ok(r.texto.includes(`adjuntos/${a1.cuerpo.id}/foto de prueba.png\`: ${png.length} bytes`) && /herramientas: Read/.test(r.texto), 'Claude (falso) ve la imagen por su ruta relativa y tiene la herramienta Read', r.texto);
  ok(r.texto.includes(`adjuntos/${a2.cuerpo.id}/informe.docx\`:`), 've también el docx');
  const otraVez = await mensaje(id, { contenido: 'otra', archivos: [a1.cuerpo.id] });
  ok(otraVez.status === 400, 'un archivo ya enviado no se puede adjuntar de nuevo');

  const guardada = (await json(`/v1/chat/conversaciones/${id}`)).cuerpo;
  const um = guardada.mensajes[0];
  ok(um.archivos?.length === 2 && um.archivos[0].nombre === 'foto de prueba.png' && um.archivos[0].mensaje_id === undefined, 'el mensaje guarda los metadatos de sus adjuntos', JSON.stringify(um.archivos));
  const sinTexto = await mensaje(id, { contenido: '', archivos: [] });
  ok(sinTexto.status === 400, 'mensaje vacío sigue rechazado');

  const dl = await fetch(`${base}/v1/chat/conversaciones/${id}/archivos/${a1.cuerpo.id}`, { headers: AUTH });
  const bytes = Buffer.from(await dl.arrayBuffer());
  ok(dl.status === 200 && dl.headers.get('content-type') === 'image/png' && bytes.equals(png), 'GET del adjunto devuelve los mismos bytes con su tipo');
  const sinToken = await fetch(`${base}/v1/chat/conversaciones/${id}/archivos/${a1.cuerpo.id}`);
  ok(sinToken.status === 401, 'sin token no se descarga');
  const pend = await json(`/v1/chat/conversaciones/${id}/archivos/${a1.cuerpo.id}`, { method: 'DELETE' });
  ok(pend.status === 409, 'un adjunto ya enviado no se puede quitar');

  console.log('── Solo archivos (sin texto) y conversación sin adjuntos');
  const b = await subir(id, 'nota.txt', Buffer.from('hola mundo'), 'text/plain');
  const soloArchivo = await mensaje(id, { contenido: '', archivos: [b.cuerpo.id] });
  ok(soloArchivo.status === 200 && soloArchivo.fin && soloArchivo.texto.includes(`adjuntos/${b.cuerpo.id}/nota.txt\`: 10 bytes`), 'se puede enviar solo un archivo, sin texto', soloArchivo.texto.slice(0, 200));
  const lista = (await json('/v1/chat/conversaciones')).cuerpo.conversaciones;
  ok(lista.length === 1, 'la lista de conversaciones sigue bien');
  const sin = (await json('/v1/chat/conversaciones', { method: 'POST', body: '{}' })).cuerpo;
  const r2 = await mensaje(sin.id, { contenido: 'hola' });
  ok(r2.status === 200 && !/Archivos recibidos/.test(r2.texto), 'una conversación sin adjuntos sigue sin herramientas');

  console.log('── Borrado');
  await json(`/v1/chat/conversaciones/${id}`, { method: 'DELETE' });
  ok(!existsSync(join(datos, 'chat-cwd', id)), 'al borrar la conversación se borran sus archivos');
} catch (e) {
  fallos++;
  console.log('✘ la prueba falló:', e.stack ?? e);
  console.log(log.slice(-1500));
} finally {
  srv.kill();
  await dormir(300);
  rmSync(datos, { recursive: true, force: true }); // carpeta temporal creada por este mismo script
}

console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : '\nTodo el manejo de adjuntos se comporta como se espera.');
process.exit(fallos ? 1 : 0);
