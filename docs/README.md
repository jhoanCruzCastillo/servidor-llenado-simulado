# Servidor de llenado — documentación para el equipo del servidor

> Copia del contrato mantenido en la plataforma (`docs/servidor-llenado-externo/`). Los ejemplos grandes (Educación EBR y Desarrollo Productivo, 17–58 MB) no se incluyen aquí; en `../ejemplos/` hay solo los de **Cuidado Diurno** y los JSON de estado.

Proyecta Fácil envía a este servidor un `.zip` con la ficha técnica y los documentos de un proyecto; el servidor se lo pasa a una IA (Kimi, Claude, ChatGPT…), informa el avance y, al terminar, entrega un enlace a otro `.zip` con la ficha llenada.

## Qué leer y en qué orden

| # | Documento | Para qué |
|---|---|---|
| 1 | [01_CONTRATO_DEL_SERVIDOR.md](01_CONTRATO_DEL_SERVIDOR.md) | **Endpoints, JSON de estado** (porcentaje, sección en curso), enlace al zip de resultado, errores, seguridad, tiempos. |
| 2 | [02_PAQUETE_QUE_ENVIAMOS.md](02_PAQUETE_QUE_ENVIAMOS.md) | El zip que **recibe** el servidor: qué es cada carpeta y cada archivo, y cómo alimentar a la IA con él. |
| 3 | [03_RESULTADO_QUE_ESPERAMOS.md](03_RESULTADO_QUE_ESPERAMOS.md) | El zip que **devuelve** el servidor: `respuesta.json`, Excel y `resumen.json`, y qué valida la plataforma. |

## Esquemas formales (JSON Schema 2020-12)

- [`estado.schema.json`](estado.schema.json) — objeto de estado del trabajo.
- [`respuesta.schema.json`](respuesta.schema.json) — `respuesta.json` y (en `$defs/resumen`) `resumen.json`.

## Ejemplos (`../ejemplos/`)

| Archivo | Qué es |
|---|---|
| `paquete_entrada_ejemplo_fte-ebr-v03.zip` | **Lo que enviamos**: paquete real de la plantilla FTE-EBR-V03 (Educación EBR v03), 150 archivos. |
| `resultado_ejemplo_fte-ebr-v03.zip` | **Lo que esperamos recibir**: `respuesta.json` + `ficha_llenada.xlsx` + `resumen.json`, con los datos del ejemplo ya llenado de esa plantilla. |
| `paquete_entrada_ejemplo_fte-cuidado-diurno.zip` / `resultado_ejemplo_fte-cuidado-diurno.zip` | Segundo par entrada/salida, de la plantilla **FTE-CUIDADO-DIURNO** (Desarrollo e Inclusión Social): 20 secciones, 77 tablas. El resultado sale del ejemplo ya llenado de esa plantilla y de su Excel. |
| `paquete_entrada_ejemplo_fte-desarrollo-prod.zip` / `resultado_ejemplo_fte-desarrollo-prod.zip` | Tercer par, de **FTE-DESARROLLO-PROD** (Agricultura / desarrollo productivo): 22 secciones, 80 tablas, Excel **con macros (`.xlsm`, ≈ 29 MB)**. El resultado sale de la ficha de ejemplo del café (Chanchamayo), que está llena solo en parte: 46 de las 80 tablas van en su estado base. |
| `crear_trabajo_metadata.json`, `crear_trabajo_respuesta_202.json` | Cuerpo de `metadata` y respuesta de `POST /v1/trabajos`. |
| `estado_01_en_cola.json` … `estado_08_cancelado.json` | El objeto de estado en cada momento del ciclo de vida (en cola, llenando campos, llenando tablas, avanzado, ensamblando, **completado con el enlace**, error, cancelado). |
| `estado_09_esperando_datos.json` | El trabajo **en pausa**: la IA necesita datos que no constan en los documentos y trae sus `preguntas` (solo si la plataforma envió `metadata.puede_preguntar: true`; ver contrato §2.4 bis). |
| `error_http_400.json` | Formato de los errores HTTP. |

Todos los JSON de estado y el zip de resultado están **validados contra los esquemas**; el `sha256` y `bytes` de `estado_06_completado.json` corresponden al zip de ejemplo real.

## Implementación de referencia

Este mismo repositorio (`../README.md`) es un servidor que implementa este contrato, con Claude Code o con una IA simulada.

## Resumen en 30 segundos

1. `POST /v1/trabajos` (zip + metadata) → `202 {trabajo_id}`.
2. `GET /v1/trabajos/{id}` cada pocos segundos → `{estado, porcentaje, mensaje, seccion_actual, secciones[], totales}`.
3. Con `estado: "completado"` y `porcentaje: 100`: `resultado.url` (zip) + `sha256` + `bytes`.
4. Nosotros descargamos, verificamos, validamos `respuesta.json` y lo aplicamos a la ficha.

**Opcional — preguntas a la persona.** Si el `metadata` trae `puede_preguntar: true`, el servidor puede pasar a `estado: "esperando_datos"` (con `preguntas[]`) cuando falta un dato imprescindible. No mantiene ningún proceso esperando: la plataforma muestra las preguntas, la persona responde cuando pueda (incluso días después) y nosotros llamamos a `POST /v1/trabajos/{id}/respuestas`; el trabajo vuelve a `en_cola` y continúa. Sin `puede_preguntar` el servidor nunca se pausa.
