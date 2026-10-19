# Servidor de llenado simulado

Es el «servidor externo» del que habla [`docs/`](docs/README.md), pero construido por nosotros para probar la integración de punta a punta antes de que exista el real. Implementa el **mismo contrato**: recibe el paquete `.zip`, llena la ficha con **Claude Code** (usando la suscripción Pro), informa el avance (porcentaje, sección en curso) y entrega un enlace a un zip con `respuesta.json` + `resumen.json`.

```
Plataforma ──POST /v1/trabajos (zip)──▶ este servidor ──claude -p──▶ Claude Code (tu suscripción)
           ◀──GET  /v1/trabajos/{id}── estado: %, sección en curso, advertencias
           ◀──resultado.url (zip) ────── respuesta.json + resumen.json (+ Excel solo en modo simulado)
```

> Esta unidad es **solo el servidor**. Conectar la plataforma (backend CodeIgniter) a esta URL es el siguiente paso; hoy la plataforma sigue usando su simulación interna.
>
> **Despliegue en Railway (GitHub → Railway):** ver [`DESPLIEGUE_RAILWAY.md`](DESPLIEGUE_RAILWAY.md).

## Carpeta

```
servidor-llenado-simulado/
├── src/
│   ├── index.js       HTTP: endpoints del contrato, cola de trabajos, retención
│   ├── paquete.js     valida (sha256, rutas) y lee el paquete; descubre secciones/tablas desde manifiesto.json
│   ├── pipeline.js    recorre el paquete por unidades, reintenta, valida, reporta avance, ensambla
│   ├── prompts.js     arma el prompt de sistema (instrucciones del propio paquete) y el de cada unidad
│   ├── validar.js     valida/normaliza lo que responde la IA (ids, opciones, modo estricto, forma exacta de tablas)
│   ├── resultado.js   respuesta.json, resumen.json, zip, sha256
│   ├── store.js       trabajos en disco + objeto de estado del contrato
│   ├── webhook.js     aviso opcional al terminar (firmado HMAC)
│   ├── chat/          chat de prueba: rutas (SSE), almacén de conversaciones y adaptador de streaming con Claude Code
│   └── ia/
│       ├── claude.js    Claude Code (CLI, `claude -p`) con la suscripción
│       └── simulada.js  sin IA: devuelve los valores del ejemplo de referencia del paquete
├── docs/              contrato del servidor (copia): endpoints, paquete que se recibe, resultado que se entrega, esquemas JSON
├── ejemplos/          JSON de estado de ejemplo y el par entrada/salida de Cuidado Diurno
├── Dockerfile · docker-entrypoint.sh · railway.json   despliegue (Railway)
└── scripts/
    ├── verificar-claude.js  comprueba instalación, sesión y que NO se use la API de pago
    ├── probar.js            cliente de prueba (hace lo que hará la plataforma)
    ├── prueba-fallos.js     regresión de errores de la ruta Claude, sin gastar cuota
    ├── prueba-chat.js       regresión de los endpoints del chat (streaming, cancelar, CORS…)
    └── claude-falso.js      «Claude Code» de mentira para esa regresión
```

## Puesta en marcha

Requisitos: Node ≥ 22.9.

```bash
cd servidor-llenado-simulado
npm install
cp .env.example .env      # y ajusta lo que necesites (el token, la IA…)
npm start                 # http://localhost:8090
```

Extra para operación: `POST /v1/diagnostico/claude-excel` hace una prueba real de la conexión Claude Code ↔ herramientas del Excel (sin ella, un llenado real podría fallar en silencio). `GET /v1/salud` incluye `listo_para_llenar` y el estado de Claude Code (instalado, versión, qué credencial usará); `POST /v1/diagnostico/claude` (con token) hace una llamada mínima real para confirmar que la credencial funciona.

Token por defecto: `dev-token-cambiar` (cámbialo con `SERVIDOR_TOKEN`). Los trabajos se guardan en `~/.proyectafacil-sim` (ruta corta y **fuera del repo**: el paquete tiene rutas de más de 200 caracteres y, dentro del repo, Claude Code leería el `CLAUDE.md` del proyecto). Cámbialo con `DATA_DIR`.

## Usar Claude Code con tu suscripción Pro

1. **Instala Claude Code** (CLI independiente; la app de escritorio no lo pone en el PATH): `npm install -g @anthropic-ai/claude-code`, o el instalador nativo de la documentación de Anthropic. Si queda fuera del PATH, define `CLAUDE_BIN=C:\ruta\claude.exe` en `.env`.
2. **Inicia sesión con la cuenta Pro** — una de dos:
   - `claude login` (interactivo, una vez por equipo). **Recomendado.**
   - `claude setup-token` genera un token de larga duración de la suscripción; ponlo en `.env` como `CLAUDE_CODE_OAUTH_TOKEN=…` (útil si el servidor corre en otra máquina).
3. **Verifica**: `npm run verificar:claude`. Muestra versión, estado de sesión y hace una llamada mínima real. Si ves `loggedIn: false`, falta el paso 2.

Cómo se garantiza que gasta suscripción y no API de pago:

- **No se usa `--bare`**: ese modo ignora el login y solo acepta `ANTHROPIC_API_KEY`.
- Al proceso hijo se le **quitan** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` y `ANTHROPIC_BASE_URL` (si estuvieran definidas, Claude Code las preferiría y cobraría por API) y las variables `CLAUDE_CODE_*` de otra sesión. Solo `PERMITIR_API_KEY=1` lo desactiva.
- Claude Code arranca **sin tu configuración de usuario** (`--setting-sources project,local`, sin MCP), con **solo lectura** (`--tools Read,Glob,Grep`) y sin guardar sesiones: no hereda hooks, plugins ni `CLAUDE.md` personales.

Límites a tener presentes (plan Pro):

- La cuota es por ventana de ~5 h y semanal, compartida con tu uso normal de Claude. Una ficha completa de Educación (66 campos + 118 tablas ≈ 40–60 llamadas, cada una leyendo documentos) **puede agotarla**. Si pasa, el trabajo termina en `error` con `limite_de_uso_ia` (reintentable) y hay que esperar a que se reinicie la ventana.
- Por eso se puede **acotar** el llenado para pruebas (ver `probar.js` abajo) y el modelo por defecto es `sonnet` (`CLAUDE_MODELO`).
- Una sola llamada a la vez (`CONCURRENCIA_TRABAJOS=1`): no se paraleliza para no quemar la cuota.
- Es para **desarrollo y pruebas nuestras**. Un servicio de producción que atienda a clientes no debería correr sobre una suscripción personal; ahí corresponde la API (o el plan que Anthropic indique para ese uso).

## Probarlo

```bash
# 1) Sin IA y sin gastar nada: devuelve los valores del ejemplo (también el Excel del ejemplo)
IA=simulada npm start
npm run probar -- ejemplos/paquete_entrada_ejemplo_fte-cuidado-diurno.zip

# 2) Con Claude Code real, ACOTADO (secciones 02 y 06, máximo 4 llamadas a la IA)
npm start
npm run probar -- ejemplos/paquete_entrada_ejemplo_fte-cuidado-diurno.zip --secciones 02,06 --max-unidades 4

# 3) Cancelar a los 20 s
npm run probar -- <paquete.zip> --cancelar-en 20

# 4) Regresión de errores de la ruta Claude (sin cuota): reintentos, límite de suscripción, sin sesión, Claude inexistente
npm run probar:fallos

# 5) Pausa para preguntar a la persona (sin cuota): esperando_datos, respuestas, omitir, cancelar, reinicio del servidor
npm run probar:preguntas -- <paquete.zip>
```

`probar.js` envía el paquete, muestra el avance (`%`, etapa, mensaje), descarga el resultado, verifica `bytes` y `sha256` y comprueba que `respuesta.json` cubre **todos** los campos y tablas que pedía el paquete. Paquetes de ejemplo en [`docs/servidor-llenado-externo/ejemplos/`](ejemplos/) (Educación EBR, Cuidado Diurno, Desarrollo Productivo).

`metadata.simulacion` (opcional, solo para pruebas) acota el trabajo: `{"secciones": ["02","06"], "max_unidades": 4}`. Lo que queda fuera se da por resuelto sin llenar (campos `no_encontrado`, tablas en su estado base) y se anota en `advertencias`.

## Chat de prueba (para la UI `chat-ui-prueba`)

> **Adjuntos**: `POST /v1/chat/conversaciones/:id/archivos?nombre=…` (cuerpo = bytes del archivo), `GET`/`DELETE …/archivos/:archivoId`, y `archivos: [ids]` en el envío del mensaje. Claude lee los adjuntos con `Read` desde `DATA_DIR/chat-cwd/<conversación>/adjuntos/`. `npm run probar:adjuntos` lo verifica sin gastar cuota.

Además del llenado, el servidor expone un chat sobre Claude Code (streaming, sin herramientas), para probar la suscripción de punta a punta desde una interfaz. Mismas credenciales y mismo `SERVIDOR_TOKEN`; las conversaciones se guardan en el volumen (`DATA_DIR/chat`).

| Endpoint | Qué hace |
|---|---|
| `GET /v1/chat/modelos` | Modelos disponibles (`sonnet`, `opus`, `haiku`) y el predeterminado |
| `GET /v1/chat/conversaciones` | Lista (sin mensajes), de la más reciente a la más antigua |
| `POST /v1/chat/conversaciones` `{titulo?, modelo?}` | Crea una conversación |
| `GET /v1/chat/conversaciones/{id}` | Conversación con todos sus mensajes |
| `PATCH /v1/chat/conversaciones/{id}` `{titulo?, modelo?}` | Renombra / cambia de modelo |
| `DELETE /v1/chat/conversaciones/{id}` | Elimina |
| `POST /v1/chat/conversaciones/{id}/mensajes` `{contenido, modelo?}` | Responde en **streaming (SSE)** |
| `POST /v1/chat/conversaciones/{id}/regenerar` `{modelo?}` | Vuelve a responder al último mensaje (SSE) |
| `POST /v1/chat/completar` `{sistema, mensajes, modelo?}` | Una respuesta JSON `{texto}` **sin guardar** conversación. Lo usa el backend de Proyecta Fácil (asesor / ayuda por campo) con la **misma** Claude Code / suscripción Pro. |

**SSE:** eventos `inicio`, `delta` `{texto}`, `fin` `{mensaje, conversacion}` y `error` `{codigo, mensaje, reintentable}`. Si el cliente corta la conexión se detiene Claude y lo generado se guarda como respuesta *interrumpida*.

**Cómo funciona:** cada respuesta lanza `claude -p --output-format stream-json --verbose --include-partial-messages --tools ""` y reenvía los trozos de texto. La conversación continúa con `--resume <session_id>`; si esa sesión ya no existe (o se regenera una respuesta) se reconstruye el contexto con el historial guardado. Las sesiones de Claude viven en `DATA_DIR/claude-config`, así que sobreviven a los redespliegues si hay volumen. Límite de respuestas simultáneas: `CHAT_CONCURRENCIA` (2). CORS: `CORS_ORIGENES` (por defecto `localhost:5173/5174`).

Pruebas sin cuota: `npm run probar:chat` (streaming, reanudar, sesión perdida, regenerar, error, cancelar, concurrencia, CORS) y `npm run dev:falso` para usar la UI contra un servidor local con un Claude falso.

## El Excel es el entregable (modo `SALIDA=excel`, el normal)

El resultado es el **Excel oficial de la plantilla ya llenado** (`ficha_llenada.xlsx`/`.xlsm` dentro del zip); `respuesta.json` lo acompaña con el detalle (estado, confianza, fuente de cada campo) y como respaldo. La plataforma lee ese Excel con el volcado del superusuario.

- **La IA ve y llena el Excel.** Claude Code recibe tres herramientas (servidor MCP propio, `src/excel/mcp-excel.js`): `ver_hoja` (una hoja tal como está: etiquetas, valores, lo que calculan las fórmulas, desplegables con sus opciones, fusiones), `llenar_campos` y `llenar_tablas`. Las guías del paquete (`seccion.md`, tablas, `estructura.json`) siguen siendo su ayuda para saber qué va en cada campo, pero el Excel manda en celdas, formatos y opciones.
- **Entrega con herramientas, no con texto**: los argumentos tienen esquema, así que ya no puede devolver un JSON roto. Cada entrega se valida (ids, opciones, forma exacta de las tablas) y se **escribe en el Excel**; la respuesta de la herramienta le dice qué quedó escrito, qué se descartó y por qué, y puede corregir dentro de la misma conversación.
- **Mismo escritor que la plataforma** (`tools/excel-node` empaqueta `insertarValoresEnExcel` y el volcado del frontend en `vendor/excel-ficha.mjs`): fechas, números, desplegables, tablas que crecen y fórmulas nativas se tratan igual que en una exportación normal. En cada entrega el libro se reescribe desde el formato en blanco con todo lo acumulado (así las filas que crecen siempre caen donde corresponde).
- La IA simulada entrega JSON y el servidor lo escribe en el mismo Excel, así que el zip también trae `ficha_llenada`. Con `SALIDA=json` se vuelve al comportamiento anterior (Claude responde un JSON, sin Excel).
- Cada entrega queda en `salida/` del diagnóstico (`NNN_<sección>_<campos|tablas>_<n>.json`: lo que envió la IA y lo que le respondió la herramienta); si Claude termina sin entregar nada se anota `…_sin_entrega.json` con su último mensaje.

## Cómo trabaja (por dentro)

1. **Recibe** (`POST /v1/trabajos`): valida el zip (raíz única, sin rutas peligrosas, `version_paquete`, **sha256 de cada archivo**), lo extrae y responde `202`. Todo se descubre del `manifiesto.json`: no hay secciones ni plantillas fijas en el código.
2. **Unidades de trabajo**, por sección y en orden: una llamada para los **campos de texto** y luego las **tablas en lotes** (`TABLAS_POR_LLAMADA`; las «muy grandes» van solas).
3. **Cada llamada** a Claude Code: prompt de sistema = `01_instrucciones/` del paquete (rol → prompt → reglas → contextos → **modo de llenado al final**); mensaje = `seccion.md` / archivos de tabla. Claude trabaja con el paquete como directorio y **lee** `prompt_del_usuario.md`, `documentos_texto/`, los PDF originales y los datos de apoyo. Para mantener la coherencia, cada llamada recibe los valores ya fijados en las secciones anteriores.
4. **Valida** cada respuesta: ids exactos, opciones del catálogo, `inferido` descartado en modo estricto, números como texto y **forma exacta de cada tabla** (mismas claves, filas/nodos; solo las filas con datos en las muy grandes). Lo recuperable se corrige con una advertencia; lo inservible se **reintenta** (hasta `REINTENTOS`) con el motivo como retroalimentación; si aun así falla, esa tabla queda en su estado base y se anota.
5. **Errores de la IA**: sobrecarga/red → reintento con espera creciente; límite de la suscripción o sin sesión → el trabajo termina en `error` (`limite_de_uso_ia` / `ia_no_disponible`) con `reintentable` correcto.
6. **Avance**: `porcentaje` = (campos + tablas completados) / total, nunca baja, máximo 99 hasta publicar el zip; `100 ⇔ completado ⇔ resultado.url`.
7. **Entrega**: `respuesta.json` + `resumen.json` en un zip, enlace `/descargas/<id>/<token>/resultado.zip` con `bytes` y `sha256`; vigencia 7 días (si expira, el `GET` de estado lo renueva). El paquete recibido se borra a los 7 días (`RETENCION_DIAS`) o al instante con `DELETE`.

**Diagnóstico (mientras se afina el servicio).** Al recibir `DELETE` se borran los documentos del cliente y el paquete, pero se conservan unos días (`DIAGNOSTICO_DIAS`, 3) el log, las respuestas crudas de la IA y el resultado. Con `GET /v1/trabajos` (últimos 30) y `GET /v1/trabajos/{id}/diagnostico` se ve qué pasó: estado por sección, advertencias, qué devolvió la IA en cada llamada (resumen por estado de campo / filas por tabla + inicio del texto), el `resumen.json` del resultado y el log. `CONSERVAR_DIAGNOSTICO=0` borra todo en el acto.

**Preguntar a la persona (opt-in).** Con `metadata.puede_preguntar: true` en el envío, Claude dispone de la herramienta MCP `pedir_datos` para pedir un dato imprescindible que no consta en los documentos (naturaleza de intervención, unidad formuladora…). Al terminar esa llamada el trabajo pasa a `esperando_datos` con las `preguntas` en el estado: no queda ningún proceso corriendo (todo está en disco, sobrevive a reinicios). La persona **no llena los campos de la ficha**: escribe texto o pasa documentos (`texto` en `POST /v1/trabajos/{id}/respuestas`); la IA extrae al retomar y, si no alcanza, puede volver a `pedir_datos`. `omitir_pendientes: true` = continuar sin esos datos (no inventa). El trabajo vuelve a la cola y retoma **desde la solicitud que preguntó**; lo ya llenado se conserva y el porcentaje no baja. Límites: `max_pausas` por trabajo (metadata; tope del servidor `MAX_PAUSAS`, 3) y `ESPERA_DATOS_DIAS` (14) sin respuesta → `cancelado`. Sin `puede_preguntar` nada cambia respecto a antes.

Endpoints: `POST /v1/trabajos` · `GET /v1/trabajos/{id}` · `POST /v1/trabajos/{id}/cancelar` · `POST /v1/trabajos/{id}/respuestas` · `DELETE /v1/trabajos/{id}` · `GET /v1/salud` — formatos exactos en [`01_CONTRATO_DEL_SERVIDOR.md`](docs/01_CONTRATO_DEL_SERVIDOR.md).

## Límites de esta primera versión

- **El Excel depende de la plantilla**: el servidor escribe con el mismo código de Excel de la plataforma (`vendor/excel-ficha.mjs`). Si cambia el escritor o el volcado del frontend hay que regenerarlo (`cd tools/excel-node && npm install && npm run build`) y commitear el resultado.
- **Sin resultados parciales**: si la suscripción se agota a mitad de ficha, el trabajo falla (`limite_de_uso_ia`); lo ya llenado no se entrega.
- **Rótulos fijos de las tablas**: se mantiene la forma, pero no se restauran las celdas de rótulo si la IA las cambia.
- Estado en memoria + disco de **un solo proceso**; un reinicio marca los trabajos en curso como `error` (reintentable).
- Los documentos de cada trabajo y las respuestas crudas de la IA quedan en `DATA_DIR/trabajos/<id>/` (para depurar). No se registran contenidos en consola.

## Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| `No se encontró Claude Code («claude»)` | No está instalado o fuera del PATH → `CLAUDE_BIN` en `.env`. |
| `OAuth session expired` / `Not logged in` | `claude login` (o `CLAUDE_CODE_OAUTH_TOKEN`). Comprueba con `npm run verificar:claude`. |
| `limite_de_uso_ia` | Se agotó la ventana de la suscripción. Espera o acota con `metadata.simulacion`. |
| El trabajo tarda mucho | Normal con Claude real: cada llamada lee documentos. Sube `CLAUDE_TIMEOUT_MIN` si hay PDF enormes, o baja `CLAUDE_MODELO`/`CLAUDE_ESFUERZO`. |
| `ENOENT`/ruta demasiado larga al extraer | `DATA_DIR` demasiado largo: usa una ruta corta como `C:\pf-sim`. |
