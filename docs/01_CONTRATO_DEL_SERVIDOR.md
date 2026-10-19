# 01 · Contrato del servidor de llenado

Documento para quien construye el **servidor de llenado** (el que recibe nuestro paquete, se lo pasa a una IA — Kimi, Claude, ChatGPT u otra — y nos devuelve la ficha llenada).
Define **qué endpoints expone, qué JSON devuelve en cada uno y cómo debe comportarse**. Los otros dos documentos describen el contenido de los zips:

| Documento | De qué trata |
|---|---|
| **01_CONTRATO_DEL_SERVIDOR.md** (este) | Endpoints, JSON de estado, porcentaje, enlace al resultado, errores, seguridad, tiempos |
| [02_PAQUETE_QUE_ENVIAMOS.md](02_PAQUETE_QUE_ENVIAMOS.md) | El zip que **nosotros enviamos**: cada carpeta, cada archivo y cómo alimentar la IA con él |
| [03_RESULTADO_QUE_ESPERAMOS.md](03_RESULTADO_QUE_ESPERAMOS.md) | El zip que **el servidor nos entrega**: `respuesta.json`, Excel, `resumen.json` y qué validamos nosotros |

Actores: **Proyecta Fácil** (nuestra plataforma; la llamamos «la plataforma») y **el servidor de llenado** (el que ustedes construyen; «el servidor»). El navegador del usuario **nunca** habla con el servidor: solo lo hace el backend de la plataforma.

---

## 1. Flujo completo

```
 Plataforma (nuestro backend)                              Servidor de llenado
 ───────────────────────────                               ───────────────────
 1. Arma el paquete .zip (doc 02)
 2. POST /v1/trabajos  (zip + metadata) ───────────────▶  3. Valida el zip, crea el trabajo, lo encola
                       ◀─────────────── 202 {trabajo_id, estado: "en_cola"}
                                                          4. Descomprime, alimenta a la IA, llena
 5. GET /v1/trabajos/{id}  cada 2–5 s ─────────────────▶     sección por sección y tabla por tabla
                       ◀─────────────── 200 {estado: "procesando", porcentaje: 45,
                                             seccion_actual: «ASPECTOS GENERALES», …}
          …                                               6. Arma el zip de resultado y lo publica
 7. GET /v1/trabajos/{id} ─────────────────────────────▶
                       ◀─────────────── 200 {estado: "completado", porcentaje: 100,
                                             resultado: {url: "https://…/resultado.zip", sha256, …}}
 8. Descarga resultado.url, verifica sha256, descomprime
 9. Valida respuesta.json y la aplica a la ficha (doc 03)
```

Puntos clave del diseño:

- **El servidor es asíncrono.** `POST /v1/trabajos` responde al instante (no espera a la IA). Un llenado grande puede tardar de varios minutos a más de una hora.
- **La plataforma consulta (polling).** Cada 2–5 s mientras el usuario mira el avance en pantalla; cada 20–30 s si no. Un webhook opcional (§6) puede avisar antes, pero el polling siempre existe como respaldo.
- **El resultado es un enlace a un zip**, no el contenido dentro del JSON de estado. El JSON de estado se mantiene liviano (se consulta miles de veces).
- **El contrato del avance es exactamente el que ya mostramos al usuario**: porcentaje global, sección en curso («Procesando ASPECTOS GENERALES — 12 de 55 campos»), y contadores de campos y tablas. Ver §3.

---

## 2. Endpoints

Base: `https://<host-del-servidor>/v1` · Formato: JSON UTF-8 (salvo la subida del zip, que es `multipart/form-data`) · Fechas: ISO-8601 en UTC (`2026-10-17T22:40:00Z`).

### 2.1 Autenticación

Todas las llamadas llevan `Authorization: Bearer <token>`. Un token por entorno (desarrollo / producción), que ustedes emiten y nosotros guardamos como variable de entorno del backend. Sin token o con token inválido → `401`.

### 2.2 `POST /v1/trabajos` — enviar un paquete y crear el trabajo

`multipart/form-data` con dos partes:

| Parte | Tipo | Obligatoria | Contenido |
|---|---|---|---|
| `paquete` | archivo `.zip` (`application/zip`) | sí | El paquete tal como se describe en el documento 02. |
| `metadata` | texto JSON | no | Datos que ustedes devuelven tal cual en el estado y en el webhook (ver abajo). |

Cabeceras que enviamos:

- `Idempotency-Key: <texto>` — si repetimos el envío con la misma clave (por un corte de red, por ejemplo), el servidor **no crea otro trabajo**: devuelve el ya creado (`200` en vez de `202`). Conservar la clave ≥ 24 h.

`metadata` (todo opcional; el servidor debe tolerar claves que no conozca):

```json
{
  "referencia": { "ficha_id": 140, "plantilla_codigo": "FTE-EBR-V03" },
  "callback_url": "https://api.proyectafacil.example/api/llenado-externo/webhook",
  "solicitado_por": "usuario-123",
  "puede_preguntar": true,
  "max_pausas": 3
}
```

- `puede_preguntar` (booleano, por defecto `false`): permite que la IA **pida datos a la persona** cuando falta uno imprescindible que no consta en los documentos (p. ej. la naturaleza de intervención o la unidad formuladora). Con `false` el trabajo **nunca** pasa a `esperando_datos` (comportamiento de siempre). Ver §2.4 bis.
- `max_pausas` (entero, por defecto lo que fije el servidor, hoy 3; el servidor nunca concede más que su tope): cuántas veces puede pausarse este trabajo para preguntar. `0` equivale a `puede_preguntar: false`.

> Nada de `metadata` es necesario para trabajar: **todo lo imprescindible ya viene dentro del paquete** (`manifiesto.json`). `metadata` solo sirve para que ustedes nos devuelvan nuestra referencia y para el webhook.

**Validación mínima que el servidor debe hacer en esta llamada (síncrona y rápida, < 10 s)** — si falla, responde error y **no** crea trabajo:

1. Es un zip válido y descomprimible.
2. Existe un único directorio raíz con `manifiesto.json` válido dentro.
3. `manifiesto.json → version_paquete` es una versión que el servidor soporta (hoy `"1.0"`).
4. Los archivos del manifiesto (`archivos[]`) existen y su `sha256` coincide (al menos `manifiesto.json`, `05_secciones_a_llenar/secciones.json` y `02_estructura_base/estructura.json`; idealmente todos).

**Respuesta exitosa — `202 Accepted`** (o `200` si fue un reintento idempotente):

```json
{
  "trabajo_id": "trb_01J9ZQ4K8M2V7X",
  "estado": "en_cola",
  "creado_en": "2026-10-17T22:15:30Z",
  "url_estado": "https://<host>/v1/trabajos/trb_01J9ZQ4K8M2V7X"
}
```

`trabajo_id`: texto opaco, único, ≤ 64 caracteres, seguro para ir en una URL. Es lo único que guardamos para seguir el trabajo.

**Errores** (formato en §5): `400 paquete_invalido` · `401 no_autorizado` · `413 paquete_muy_grande` · `415 tipo_no_soportado` · `422 version_paquete_no_soportada` / `manifiesto_invalido` · `429 limite_de_solicitudes` · `503 servidor_ocupado`.

**Tamaño**: aceptar paquetes de al menos **200 MB**. El paquete de ejemplo con el padrón y dos Excel pesa 17 MB; los proyectos con PDFs de planos o memorias extensas pueden pasar de 100 MB.

### 2.3 `GET /v1/trabajos/{trabajo_id}` — estado

Devuelve el **objeto de estado** descrito en §3. Es el endpoint que consultamos una y otra vez; debe ser barato (no depender de la IA, leer de una base de datos o caché) y tolerar al menos **1 consulta por segundo por trabajo**.

- `200` con el objeto de estado (también cuando el trabajo está en `error` o `cancelado`: el error va **dentro** del objeto, no como código HTTP).
- `404 trabajo_no_encontrado` solo si el id nunca existió o ya fue purgado (§8).

### 2.4 `POST /v1/trabajos/{trabajo_id}/cancelar` — cancelar

El usuario puede cancelar desde la plataforma. El servidor debe **dejar de gastar IA lo antes posible**.

- `200` con el objeto de estado. Si pudo detenerlo de inmediato: `estado: "cancelado"`. Si necesita unos segundos: `estado: "procesando"` + `cancelando: true`, y luego pasa a `cancelado`.
- Si el trabajo ya estaba en `completado`, `error` o `cancelado`: `200` con el estado actual (idempotente, no es error).
- Un trabajo cancelado **no** produce resultado (`resultado: null`).
- Un trabajo en `esperando_datos` se cancela de inmediato (no hay nada en ejecución).

### 2.4 bis `POST /v1/trabajos/{trabajo_id}/respuestas` — responder las preguntas de la IA

Solo aplica a trabajos creados con `metadata.puede_preguntar: true`. Cuando la IA necesita un dato que no consta en los documentos, el trabajo pasa a **`esperando_datos`** y el objeto de estado trae las **`preguntas`** (§3.2). El servidor **no mantiene ningún proceso abierto** esperando: todo queda en disco, así que la persona puede cerrar sesión y responder horas o días después, y la pausa sobrevive a un reinicio del servidor. Si nadie responde en el plazo del servidor (hoy 14 días) el trabajo pasa a `cancelado`.

Cuerpo (`application/json`):

```json
{
  "respuestas": [
    { "id": "q1", "respuesta": "Mejoramiento" },
    { "id": "q2", "respuesta": "Gerencia de Desarrollo Social" }
  ],
  "omitir_pendientes": false
}
```

- `respuestas[].id` es el `id` de una pregunta del estado; `respuesta`, texto de hasta 4000 caracteres. Si la pregunta trae `opciones` (campo de catálogo), la respuesta debe ser una de ellas: si no, el validador descarta el valor y queda como advertencia.
- `omitir_pendientes: true` («aplicar lo disponible»): las preguntas sin respuesta se dan por «la persona no tiene el dato»; la IA continúa **sin inventarlo** y **no vuelve a preguntarlo**.
- Respuestas: `202` con el objeto de estado (el trabajo vuelve a `en_cola` y se retoma **desde la solicitud que preguntó**, con las respuestas en el prompt; lo ya llenado se conserva) · `409 estado_invalido` si el trabajo no está en `esperando_datos` · `422 faltan_respuestas` si quedan preguntas sin respuesta y no se envió `omitir_pendientes` · `400 respuesta_invalida` si un `id` no existe o una respuesta es demasiado larga.

### 2.5 `DELETE /v1/trabajos/{trabajo_id}` — borrar datos (recomendado)

Borra el paquete recibido, los archivos intermedios y el resultado. Lo llamamos cuando aplicamos el resultado a la ficha, para no dejar documentos de clientes más tiempo del necesario. `204` si se borró; `204` también si ya no existía. (Independiente de esto, la retención automática de §8 aplica igual.)

### 2.6 `GET /v1/salud` — verificación

Sin autenticación. `200 {"ok": true, "version_servidor": "1.0.0", "versiones_paquete_soportadas": ["1.0"]}`. Lo usamos para monitoreo y para mostrar un mensaje claro si el servidor está caído.

---

## 3. El objeto de estado (corazón del contrato)

Es lo que devuelve `GET /v1/trabajos/{id}`, `POST …/cancelar` y lo que se envía al webhook. **Esquema formal: [`estado.schema.json`](estado.schema.json)**. Ejemplos reales en [`../ejemplos/`](../ejemplos/).

### 3.1 Ejemplo: en pleno llenado

```json
{
  "version_estado": "1.0",
  "trabajo_id": "trb_01J9ZQ4K8M2V7X",
  "referencia": { "ficha_id": 140, "plantilla_codigo": "FTE-EBR-V03" },

  "estado": "procesando",
  "cancelando": false,
  "porcentaje": 45,
  "etapa": "llenando_tablas",
  "mensaje": "Procesando «ASPECTOS GENERALES» — tabla 28 de 75",

  "seccion_actual": { "id": "d3a96d61-750f-4b37-ae42-4ad57446138a", "numero": "01", "nombre": "ASPECTOS GENERALES" },

  "totales": {
    "secciones_totales": 6,       "secciones_completadas": 0,
    "campos_totales": 66,         "campos_completados": 55,
    "tablas_totales": 118,        "tablas_completadas": 28
  },

  "secciones": [
    { "id": "d3a96d61-750f-4b37-ae42-4ad57446138a", "numero": "01", "nombre": "ASPECTOS GENERALES",
      "estado": "en_curso",  "porcentaje": 63, "campos_totales": 55, "campos_completados": 55, "tablas_totales": 75, "tablas_completadas": 28 },
    { "id": "941fabc3-5267-414b-8793-101fbce82d5e", "numero": "02", "nombre": "ANEXO 01: COSTOS UNITARIOS REFERENCIALES DE ACTIVOS ESTRATEGICOS",
      "estado": "pendiente", "porcentaje": 0,  "campos_totales": 5,  "campos_completados": 0,  "tablas_totales": 1,  "tablas_completadas": 0 }
  ],

  "creado_en": "2026-10-17T22:15:30Z",
  "iniciado_en": "2026-10-17T22:15:41Z",
  "actualizado_en": "2026-10-17T22:29:12Z",
  "terminado_en": null,
  "segundos_restantes_estimados": 1500,

  "resultado": null,
  "error": null,
  "advertencias": []
}
```

(El ejemplo se acorta a 2 secciones por legibilidad; el real lista **todas** las secciones del paquete.)

### 3.2 Campos, uno por uno

| Campo | Tipo | Siempre | Significado |
|---|---|---|---|
| `version_estado` | texto | sí | Versión de este contrato. Hoy `"1.0"`. |
| `trabajo_id` | texto | sí | El id devuelto al crear el trabajo. |
| `referencia` | objeto \| null | sí | Eco de `metadata.referencia` tal cual lo enviamos. `null` si no se envió. |
| `estado` | enumeración | sí | `en_cola` · `procesando` · `esperando_datos` · `completado` · `error` · `cancelado`. Ver §3.3. `esperando_datos` solo aparece si se creó con `metadata.puede_preguntar: true`. |
| `preguntas` | arreglo | no (si falta, se asume `[]`) | **Solo con `estado: "esperando_datos"`** (en cualquier otro, `[]`): lo que la IA necesita saber. Cada una: `{ "id": "q1", "pregunta": "…", "motivo": "…", "campo_ids": ["1.01.01"], "opciones": ["…"], "seccion_id": "…" }`. `opciones` viene lleno si el dato es de un catálogo cerrado. Se responden con §2.4 bis. |
| `pausas` | entero | no (si falta, se asume `0`) | Cuántas veces se ha pausado este trabajo para preguntar. |
| `cancelando` | booleano | sí | `true` entre que se pidió cancelar y que se detuvo de verdad. |
| `porcentaje` | entero 0–100 | sí | Avance global. Reglas en §3.4. |
| `etapa` | enumeración | sí | Fase técnica actual: `recibido` · `validando_paquete` · `analizando_documentos` · `llenando_secciones` · `llenando_tablas` · `ensamblando_resultado` · `finalizado` · `esperando_datos` · `reanudando` (las dos últimas solo con preguntas). (Si trabajan por secciones completas —campos y tablas juntos— usen `llenando_secciones` durante todo el llenado.) |
| `mensaje` | texto | sí | Frase **lista para mostrar al usuario**, en español, ≤ 200 caracteres (ej. `Procesando «ASPECTOS GENERALES» — tabla 28 de 75`). Cuando `completado`: `Listo.`; cuando `error`: el motivo resumido. |
| `seccion_actual` | objeto \| null | sí | La sección que se está llenando **ahora** (`id`, `numero`, `nombre` tal cual vienen en `secciones.json`). `null` si el trabajo está en cola, ensamblando o terminado. Si procesan varias secciones en paralelo, la de menor número aún no completada. |
| `totales` | objeto | sí | Contadores globales: secciones, **campos de texto** y **tablas**. Los totales se fijan al leer `secciones.json` y **no cambian** durante el trabajo. En cola (antes de leer el paquete) pueden ir en `0`. |
| `secciones` | arreglo | sí | Una entrada por sección del paquete, en el orden de `secciones.json`. Con su propio `estado` (`pendiente` · `en_curso` · `completada` · `con_errores` · `omitida`), `porcentaje` y contadores. Permite pintar la lista de secciones con su barra. |
| `creado_en` / `iniciado_en` / `actualizado_en` / `terminado_en` | fecha \| null | sí | `iniciado_en`: cuando empezó a procesar (sale de `en_cola`). `actualizado_en`: **se mueve cada vez que hay progreso** (lo usamos para detectar trabajos colgados). `terminado_en`: al llegar a `completado`, `error` o `cancelado`. |
| `segundos_restantes_estimados` | entero \| null | sí | Estimación honesta o `null` si no se puede calcular. Nunca un valor inventado fijo. |
| `resultado` | objeto \| null | sí | **Solo con `estado: "completado"`**: ver §4. En cualquier otro estado, `null`. |
| `error` | objeto \| null | sí | **Solo con `estado: "error"`**: ver §3.5. En cualquier otro estado, `null`. |
| `advertencias` | arreglo | sí | Avisos que no detienen el trabajo (documento ilegible, sección con fallos recuperados…). Cada una: `{ "ambito": "paquete\|documento\|seccion\|campo\|tabla", "identificador": "…", "mensaje": "…" }`. Puede ir vacío. |

### 3.3 Estados y transiciones

```
 en_cola ──▶ procesando ──▶ completado        (resultado != null, porcentaje = 100)
    │            │  └─────▶ error              (error != null)
    └────────────┴────────▶ cancelado          (tras POST …/cancelar)

 procesando ──▶ esperando_datos ──▶ en_cola ──▶ procesando …   (solo con metadata.puede_preguntar; se responde con POST …/respuestas)
                     └────────────▶ cancelado                    (POST …/cancelar, o sin respuesta tras el plazo del servidor)
```

- `esperando_datos` **no es terminal** y no ocupa ningún proceso del servidor. El `porcentaje` se mantiene (no baja ni llega a 100) y `resultado` es `null`. Al responder, el trabajo vuelve a `en_cola` y retoma lo que quedaba.
- Tras una pausa el porcentaje sigue sin bajar: la solicitud que preguntó se repite entera, pero sus contadores no avanzaron hasta terminarla.

- Un estado terminal (`completado`, `error`, `cancelado`) **nunca cambia después**.
- `completado` significa «hay un zip de resultado descargable». Si algunas secciones o tablas fallaron pero se pudo entregar el resto, el estado es **`completado`** y los fallos se listan en `advertencias` (y en `resumen.json` del zip); esas secciones quedan sin llenar y nosotros se lo indicamos al usuario. `error` se reserva para cuando **no hay nada útil que entregar**.

### 3.4 Reglas del porcentaje (importantes: es lo que ve el usuario)

1. **Unidad de trabajo** = un campo de texto **o** una tabla (las cifras de `totales`). Se cuentan los de **todas** las secciones del paquete.
2. `porcentaje = floor( 100 × (campos_completados + tablas_completadas) / (campos_totales + tablas_totales) )`. Si prefieren ponderar las tablas más pesadas (p. ej. una tabla de 500 filas vale más que un campo de una línea), pueden, siempre que se cumplan las reglas 3–6.
3. **Nunca baja.** Es monótono no decreciente durante todo el trabajo (si reintentan una tabla, no retroceden el contador).
4. **Solo llega a 100 cuando el resultado ya es descargable.** Mientras se arma/sube el zip, el máximo es `99` (y `etapa: "ensamblando_resultado"`).
5. **`porcentaje = 100` ⇔ `estado = "completado"` ⇔ `resultado != null`.** Los tres cambian en la misma escritura; jamás se debe ver `100` con `resultado: null`.
6. Un campo/tabla «completado» incluye también los que la IA respondió «no encontrado» o vacío: significa *procesado*, no *con dato*.
7. En `en_cola` **sin haber empezado nunca** (`iniciado_en: null`), `porcentaje: 0`; un trabajo reanudado tras una pausa vuelve a `en_cola` **conservando** su porcentaje. En `esperando_datos`, el último alcanzado. En `error`/`cancelado`, el último porcentaje alcanzado (no se pone a 0 ni a 100).

La plataforma muestra al usuario `porcentaje`, `mensaje` y la lista `secciones` tal cual; por eso el `mensaje` debe estar bien escrito.

### 3.5 Objeto `error`

```json
{
  "codigo": "ia_no_disponible",
  "mensaje": "El proveedor de IA no respondió después de 5 reintentos.",
  "reintentable": true,
  "detalle": "HTTP 529 overloaded_error durante la sección 03 (tabla 03.03.1)"
}
```

| `codigo` | Cuándo |
|---|---|
| `paquete_invalido` | El zip pasó la validación inicial pero resultó inutilizable al procesarlo (archivos corruptos, estructura incoherente). |
| `ia_no_disponible` | El proveedor de IA falló/no respondió de forma sostenida. |
| `limite_de_uso_ia` | Cuota o límite de tokens/minuto agotado. |
| `respuesta_invalida` | La IA no logró producir un `respuesta.json` válido tras los reintentos. |
| `tiempo_agotado` | El trabajo superó el tiempo máximo (§7). |
| `interno` | Cualquier otro fallo del servidor. |

`reintentable: true` = tiene sentido que la plataforma envíe el mismo paquete de nuevo. `detalle` es para soporte técnico (no se muestra al usuario); `mensaje` sí puede mostrarse.

---

## 4. El resultado: enlace a un zip

Cuando `estado = "completado"`, el objeto de estado trae:

```json
"resultado": {
  "url": "https://descargas.servidor.example/trb_01J9ZQ4K8M2V7X/resultado.zip?firma=…",
  "formato": "zip",
  "bytes": 8294246,
  "sha256": "9f2c…c41a",
  "expira_en": "2026-10-24T22:40:00Z",
  "requiere_autorizacion": false
}
```

| Campo | Significado |
|---|---|
| `url` | **Enlace directo** (HTTPS) al zip. Preferimos una **URL prefirmada** (S3, GCS, R2…) que se pueda descargar con un simple `GET` sin cabeceras especiales. |
| `formato` | Siempre `"zip"` por ahora. |
| `bytes` | Tamaño exacto en bytes, para validar la descarga. |
| `sha256` | Huella SHA-256 (hexadecimal, minúsculas) del zip. La plataforma la verifica tras descargar; si no coincide, reintenta y luego lo reporta como error. |
| `expira_en` | Hasta cuándo funciona el enlace. Mínimo **24 h** desde que pasó a `completado` (recomendado 7 días). |
| `requiere_autorizacion` | `false` si la URL se descarga sola (prefirmada). `true` si hay que mandar el mismo `Authorization: Bearer …` de la API. Cualquiera de las dos sirve; la primera es más simple. |

Si el enlace expira antes de que la plataforma lo descargue, volvemos a consultar `GET /v1/trabajos/{id}`: **el servidor debe renovar la URL** (devolver una nueva y vigente) mientras el trabajo no haya sido purgado.

El **contenido del zip** está definido en el documento [03_RESULTADO_QUE_ESPERAMOS.md](03_RESULTADO_QUE_ESPERAMOS.md) y hay un ejemplo real en [`../ejemplos/resultado_ejemplo_fte-ebr-v03.zip`](../ejemplos/resultado_ejemplo_fte-ebr-v03.zip).

---

## 5. Formato de errores HTTP

Cualquier respuesta no exitosa de la API (4xx/5xx) usa este cuerpo:

```json
{ "error": { "codigo": "paquete_invalido", "mensaje": "No se encontró manifiesto.json en la raíz del zip.", "detalle": null } }
```

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 400 | `paquete_invalido` | No es un zip, está corrupto, falta `manifiesto.json` o un archivo cuyo `sha256` no coincide. |
| 401 | `no_autorizado` | Token ausente o inválido. |
| 404 | `trabajo_no_encontrado` | El id no existe o fue purgado. |
| 413 | `paquete_muy_grande` | Supera el límite del servidor (indicar el límite en `mensaje`). |
| 415 | `tipo_no_soportado` | La parte `paquete` no es un zip. |
| 422 | `version_paquete_no_soportada` / `manifiesto_invalido` | `version_paquete` desconocida o el manifiesto no cumple lo mínimo. |
| 429 | `limite_de_solicitudes` | Demasiadas llamadas; incluir `Retry-After`. |
| 503 | `servidor_ocupado` | Sin capacidad ahora; incluir `Retry-After`. La plataforma reintenta con espera creciente. |
| 500 | `interno` | Fallo inesperado. |

Regla general: **«el trabajo falló» no es un error HTTP** (eso va dentro del objeto de estado, §3.5). Los errores HTTP son solo para llamadas mal hechas o servidor caído.

---

## 6. Webhook opcional

Si `metadata.callback_url` viene en la creación, al pasar a un estado terminal (`completado`, `error` o `cancelado`) el servidor hace:

```
POST <callback_url>
Content-Type: application/json
X-Firma-Sha256: <HMAC-SHA256 hexadecimal del cuerpo, con el secreto compartido>
```

con el **mismo objeto de estado** de §3 como cuerpo. Reintentar con espera creciente (p. ej. 10 s, 1 min, 5 min, 30 min) hasta recibir `2xx`. **El webhook es solo una aceleración**: la plataforma sigue consultando el estado y no depende de recibirlo. (En la primera versión de la integración podemos no implementarlo del lado nuestro; igual debe estar contemplado.)

---

## 7. Tiempos y concurrencia

| Tema | Requisito |
|---|---|
| `POST /v1/trabajos` | Responder en < 15 s aunque el zip sea grande. |
| `GET /v1/trabajos/{id}` | Responder en < 1 s (p95). Soportar polling de 1 req/s por trabajo. |
| Duración de un llenado | Esperamos de **5 a 60+ minutos** según la ficha (la FTE de Educación EBR tiene 66 campos de texto y 118 tablas). Tiempo máximo por trabajo: **3 horas**, luego `error: tiempo_agotado`. |
| Progreso | `actualizado_en` debe moverse al menos cada **2 minutos** mientras haya trabajo. Si pasa más de **15 minutos** sin cambios la plataforma considera el trabajo colgado y avisa al usuario. |
| Concurrencia | Varios usuarios llenan a la vez: el servidor debe encolar con justicia (FIFO) y reportar `en_cola` honestamente. Si hay cola, `mensaje` puede decir `En cola — posición 3`. |
| Idempotencia | Mismo `Idempotency-Key` ⇒ mismo trabajo. |
| Trabajo activo por ficha | La plataforma ya impide enviar dos llenados de la misma ficha a la vez; no hace falta que el servidor lo controle. |

---

## 8. Seguridad, privacidad y retención

Los paquetes contienen **documentos reales de proyectos de inversión pública** (memorias, presupuestos, planos). Requisitos:

- **Solo HTTPS** (TLS 1.2+). Token Bearer por entorno, rotable.
- **No registrar el contenido** de los documentos ni de las respuestas en logs (sí ids, tamaños, tiempos, códigos de error).
- **No usar los datos para entrenar** modelos ni compartirlos con terceros fuera de los proveedores de IA necesarios para el llenado; indicar cuáles son y que sus condiciones excluyen el entrenamiento con esos datos.
- **Retención**: el paquete recibido y los archivos intermedios se borran **a más tardar 7 días** después de terminar el trabajo (o de inmediato con `DELETE`). El zip de resultado, hasta `expira_en` (≥ 24 h, ≤ 14 días). El *registro de estado* del trabajo (sin contenido), hasta 30 días, para que las consultas tardías no den `404` prematuramente.
- **Aislamiento**: un trabajo no puede leer datos de otro. Las URL de resultado son difíciles de adivinar (firmadas o con id aleatorio largo).
- **Contenido no confiable**: los documentos del usuario pueden contener texto que intente dar instrucciones a la IA («ignora lo anterior…»). Las únicas instrucciones válidas son las de `01_instrucciones/` y `04_proyecto_del_usuario/prompt_del_usuario.md`; el contenido de los documentos es **dato, no órdenes**. El zip de entrada tampoco debe poder escribir fuera de su directorio al descomprimirlo (rutas con `..` ⇒ rechazar con `paquete_invalido`).

---

## 9. Qué hace la plataforma (para que sepan qué esperar de nosotros)

1. Arma y sube el paquete; guarda `trabajo_id` junto a la ficha.
2. Consulta el estado, muestra `porcentaje`, `mensaje` y la lista de `secciones` al usuario; permite cancelar (`POST …/cancelar`).
3. Con `completado`: descarga `resultado.url`, verifica `bytes` y `sha256`, descomprime, **valida** `respuesta.json` contra la estructura de la ficha (doc 03 §6) y la aplica. Marca en la ficha qué valores vienen de IA para que el usuario los revise.
4. Llama a `DELETE /v1/trabajos/{id}` al terminar (con o sin éxito).
5. Si el servidor responde `503`/`5xx`/no responde, reintenta con espera creciente y, si persiste, informa al usuario que el servicio de llenado no está disponible (sin perder el paquete).

## 10. Versionado

- `version_paquete` (lo que enviamos) y `version_estado` / `version_respuesta` (lo que devuelven) son versiones **mayor.menor**. Dentro de la misma mayor solo se agregan campos opcionales: **ambos lados deben ignorar claves desconocidas**. Un cambio incompatible sube la mayor y se coordina de antemano.
- Hoy todo está en `"1.0"`.

## 11. Checklist de aceptación (lo que probaremos juntos)

- [ ] `POST /v1/trabajos` con [`../ejemplos/paquete_entrada_ejemplo_fte-ebr-v03.zip`](../ejemplos/paquete_entrada_ejemplo_fte-ebr-v03.zip) → `202` + `trabajo_id`; repetir con el mismo `Idempotency-Key` → mismo trabajo.
- [ ] Zip corrupto, sin manifiesto o con `sha256` alterado → `400 paquete_invalido`.
- [ ] El estado pasa por `en_cola → procesando → completado`; `porcentaje` nunca baja; `100` solo con `resultado` presente.
- [ ] `seccion_actual`, `mensaje` y `secciones[]` reflejan el avance real (sección por sección).
- [ ] `resultado.url` descarga un zip cuyo `sha256` y `bytes` coinciden, con la estructura del doc 03.
- [ ] `POST …/cancelar` en mitad del llenado detiene el gasto de IA y deja `cancelado` sin resultado.
- [ ] Un fallo de la IA a media ficha: o se recupera (advertencia) o termina en `error` con `codigo` y `reintentable` correctos; nunca queda colgado en `procesando`.
- [ ] El estado se puede consultar 1 vez por segundo durante una hora sin degradarse.
