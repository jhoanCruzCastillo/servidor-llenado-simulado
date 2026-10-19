# 03 · El resultado que esperamos (zip de salida)

Qué debe contener el `.zip` al que apunta `resultado.url` cuando el trabajo llega a `completado` (ver el contrato en [01_CONTRATO_DEL_SERVIDOR.md](01_CONTRATO_DEL_SERVIDOR.md) §4), cómo se arma cada archivo y qué hace la plataforma con él.

> **Ejemplo real:** [`../ejemplos/resultado_ejemplo_fte-ebr-v03.zip`](../ejemplos/resultado_ejemplo_fte-ebr-v03.zip). Sus valores salen del ejemplo ya llenado «CUSTOM002» de la plantilla **FTE-EBR-V03** (Educación EBR versión 03) y su Excel; es el resultado que el servidor **nos devolvería** al procesar [`../ejemplos/paquete_entrada_ejemplo_fte-ebr-v03.zip`](../ejemplos/paquete_entrada_ejemplo_fte-ebr-v03.zip). Los datos de proyecto (nombres, cifras) son de ese ejemplo, no de los documentos del paquete de entrada: **sirve para ver la forma, no el contenido**.

## 1. Contenido del zip

```
resultado-llenado-ia_<trabajo_id>/            ← un único directorio raíz (recomendado; también aceptamos los archivos en la raíz del zip)
├── respuesta.json        OBLIGATORIO · Los datos llenados. Es lo que la plataforma aplica a la ficha.
├── ficha_llenada.xlsx    ESPERADO   · El Excel oficial con esos mismos datos escritos. Copia de respaldo / descarga.
│                         (.xlsm si el formato base lo es, como en FTE-DESARROLLO-PROD: `ficha_llenada.xlsm`)
└── resumen.json          OBLIGATORIO · Metadatos del trabajo: conteos, modelos usados, advertencias.
```

| Archivo | Obligatorio | Para qué lo usamos |
|---|---|---|
| `respuesta.json` | **Sí** | **Fuente de verdad del resultado.** Lo validamos y lo escribimos en la ficha del usuario, campo por campo y tabla por tabla. Si falta o es inválido, el trabajo se considera fallido. |
| `ficha_llenada.xlsx` | Esperado («ambos, por si acaso») | Lo guardamos junto a la ficha como Excel generado por el servidor para revisión y descarga, y como respaldo si el usuario quiere contrastar. **No sobrescribe** los datos de la ficha: manda `respuesta.json`. Si el servidor no puede generarlo, se omite y se declara en `resumen.json → excel.incluido: false`; el trabajo igual se aplica. |
| `resumen.json` | **Sí** | Auditoría: cuánto se llenó, con qué modelos, qué advertencias hubo. Lo mostramos en el detalle del llenado. |

Reglas del zip: UTF-8; sin rutas absolutas ni `..`; sin archivos extra (si agregan alguno, lo ignoramos); tamaño razonable (el ejemplo pesa 8 MB, casi todo el Excel).

---

## 2. `respuesta.json`

Esquema formal: [`respuesta.schema.json`](respuesta.schema.json). Es **el mismo formato que describe `06_formato_de_respuesta.md` del paquete de entrada**, con dos claves de cabecera más (`version_respuesta`, `paquete`).

```json
{
  "version_respuesta": "1.0",
  "paquete": {
    "carpeta_raiz": "paquete-llenado-ia_fte-ebr-v03_ficha-140_20261017-221521",
    "ficha_id": 140,
    "plantilla_codigo": "FTE-EBR-V03",
    "version_paquete": "1.0"
  },
  "secciones": [
    {
      "seccion_id": "d3a96d61-750f-4b37-ae42-4ad57446138a",
      "campos": [
        { "id": "01.01.2", "valor_propuesto": null,           "estado": "no_encontrado", "confianza": 0.0,  "fuente": "", "evidencia": "" },
        { "id": "01.01.3", "valor_propuesto": "MEJORAMIENTO", "estado": "extraido",      "confianza": 0.95, "fuente": "Notas del cliente", "evidencia": "«Naturaleza de intervención: Mejoramiento»" }
      ]
    }
  ],
  "tablas": [
    {
      "identificador": "01.03.1",
      "valor": [
        { "fc1290af-f8c2-4c64-8e84-b451dc7d3681": "Nivel de gobierno :", "9fe2cf0e-4958-4ba7-ab84-f794b628823f": "GOBIERNO LOCAL" }
      ],
      "fuente": "Memoria descriptiva, pág. 1"
    }
  ]
}
```

### 2.1 Cabecera

| Clave | Obligatoria | Descripción |
|---|---|---|
| `version_respuesta` | sí | `"1.0"`. |
| `paquete` | sí | **Eco de lo que vino en el paquete** (`manifiesto.json`): `carpeta_raiz`, `ficha_id`, `plantilla_codigo`, `version_paquete`. Lo usamos para comprobar que el resultado corresponde a la ficha y plantilla enviadas. Si no coincide, lo rechazamos. |

### 2.2 `secciones[]` — campos de texto

Una entrada por cada sección de `05_secciones_a_llenar/secciones.json` **que tenga campos de texto** (una sección con `campos_de_texto: 0` —como la 05 del ejemplo— no aparece aquí).

- `seccion_id` — el `id` de la sección tal cual viene en `secciones.json`.
- `campos[]` — **una entrada por cada campo** de esa sección (todos los de `secciones.json`, también los que no se pudieron llenar):

| Clave | Tipo | Descripción |
|---|---|---|
| `id` | texto | El `identificador` del campo (p. ej. `01.01.3`). Exactamente como en `secciones.json`. **No** el `id` UUID. |
| `valor_propuesto` | texto \| `null` | El valor. `null` si no hay dato (`no_encontrado`). Siempre **texto** (los números también: `"2450.5"`). |
| `estado` | enumeración | `extraido` (consta explícitamente) · `inferido` (deducido con justificación; **prohibido en modo estricto**) · `requiere_confirmacion` (hay un candidato pero dudoso) · `conflictivo` (los documentos se contradicen) · `no_encontrado` · `calculado` (no se usa: no se envían campos calculados). |
| `confianza` | número 0–1 | Confianza de la IA. Orientativa. |
| `fuente` | texto | De dónde salió: nombre del documento (y página/parte). Vacío si `no_encontrado`. **Solo documentos reales** del paquete. |
| `evidencia` | texto | Cita breve del texto que respalda el valor. Opcional pero muy recomendado en `inferido`/`conflictivo`. |

Cómo lo trata la plataforma (reutiliza la misma lógica del llenado con IA que ya tiene hoy; el detalle visual puede cambiar, el contrato no):

| `estado` | Qué hacemos |
|---|---|
| `extraido` | Se escribe en el campo y se marca como llenado por IA. |
| `inferido` | Se escribe y se marca como inferido, para que el usuario lo revise. |
| `requiere_confirmacion` / `conflictivo` | Se tratan igual: se escribe y se marca «requiere confirmación», mostrando `fuente` y `evidencia`. |
| `no_encontrado` / `calculado` | **No se escribe nada** (se conserva lo que ya tuviera el usuario). |

### 2.3 `tablas[]` — una por tabla

**Una entrada por cada archivo de `05_secciones_a_llenar/<sección>/tablas/`**, aunque no haya información (en ese caso, el estado base). Las tablas listadas en `manifiesto.json → tablas_omitidas` no deben venir.

| Clave | Tipo | Descripción |
|---|---|---|
| `identificador` | texto | El identificador de la tabla (nombre del archivo `.md` sin extensión, p. ej. `01.15.8`). |
| `valor` | arreglo | La tabla llenada, **con la forma exacta que pide su archivo** (ver abajo). |
| `fuente` | texto | Breve descripción de dónde salió la información (documento y parte). Vacío si no hubo evidencia. |

**Forma de `valor`, según el tipo de tabla** (el archivo de cada tabla indica cuál es; detalle en [doc 02 §3.7](02_PAQUETE_QUE_ENVIAMOS.md)):

```jsonc
// 1) Filas simples — las claves son los ids reales de columna; mismo número de filas que la "tabla actual"
[ { "fc1290af-…": "Nivel de gobierno :", "9fe2cf0e-…": "GOBIERNO LOCAL" }, … ]

// 1b) Filas simples muy grandes (p. ej. 504 filas casi vacías) — SOLO las filas con datos, de arriba hacia abajo
[ { "item": "Aula de Educación Primaria", "metrado": "373.26", "unidad": "m2", … }, … ]

// 2) Filas agrupadas en bloques — mismos bloques, mismas filas; "grupo" intacto; "valoresGrupo" si la tabla actual lo trae
[ { "grupo": "Costo / Eficacia", "filas": [ { "f9abdcda-…": "Ratio C-E", "2227be0a-…": "" } ], "valoresGrupo": { … } } ]

// 3) Jerárquica — árbol; misma cantidad de nodos e hijos; solo cambian los "value"
[ { "value": "Mejoramiento", "children": [ { "value": "…", "children": [] } ] } ]
```

Reglas de las tablas (las mismas que recibe la IA):

1. **Forma exacta**: mismas claves en cada fila/objeto, mismo número de filas/bloques/nodos que la «tabla actual» (salvo las «muy grandes», donde solo se devuelven las filas con datos).
2. **Rótulos fijos intactos**: la primera columna de una tabla con filas fijas trae un rótulo («Nivel de gobierno :»); se deja igual y se llena el resto de esa fila.
3. **Sin evidencia ⇒ celda vacía `""`** (nunca `null`, nunca «N/A», nunca «-»), salvo que la tabla actual traiga un valor ya correcto.
4. **Una celda = un dato.** Nunca dos elementos separados por `;` o `,`.
5. **Números como texto, sin separador de miles** (`"2450"`, `"2450.50"`); decimales con punto.
6. **Opciones cerradas**: texto idéntico a la opción del catálogo/lista desplegable. Si ninguna calza, celda vacía.
7. **Celdas calculadas / de solo lectura** (las que el Excel calcula): no se envían valores; devolver lo que traía la tabla actual.
8. **Revisar lo que ya viene escrito**: una celda con texto en la «tabla actual» puede ser dato de ejemplo del formato; hay que corregirla si el proyecto dice otra cosa.

---

## 3. `ficha_llenada.xlsx`

El **formato oficial** (`02_estructura_base/formato_base.xlsx`) con los valores de `respuesta.json` escritos en sus celdas — para que alguien pueda abrir el archivo y ver la ficha llenada tal como la presentaría Invierte.pe.

Requisitos:

1. **Partir de `formato_base.xlsx`** (no crear un Excel nuevo): conservar hojas, estilos, celdas combinadas, listas desplegables, fórmulas y macros. Si el base es `.xlsm`, entregar `ficha_llenada.xlsm` (y declararlo en `resumen.json`).
2. **Campos de texto**: escribir `valor_propuesto` en la celda `captura` del campo (`columna` + `fila` en la hoja de su sección, `hoja` en `secciones.json`). Las celdas combinadas se escriben en su celda superior izquierda. Los `numero`/`decimal` van como número real, no como texto.
3. **Tablas**: escribir cada fila en el rango de la tabla (columnas según `configTabla`). Si una tabla tiene más filas con datos que las del formato, **insertar filas** (el formato crece hacia abajo) y respetar que las **fórmulas** de las filas siguientes se desplacen; **no reemplazar fórmulas por valores**.
4. **No tocar** celdas con fórmula, calculadas por el Excel, ni las de otras hojas fuera de las capturas.
5. El archivo debe abrir **sin avisos de reparación** en Excel y recalcular correctamente al abrirse.

> **Por qué es un archivo «esperado» y no obligatorio:** escribir bien un Excel complejo (filas que crecen, fórmulas, macros) es la parte más laboriosa. Lo que la plataforma aplica es `respuesta.json`; el Excel es un entregable de valor añadido y de respaldo. Si no pueden entregarlo en la primera versión, el contrato lo permite (`excel.incluido: false`). Nosotros ya generamos Excel con la misma lógica en la plataforma, por lo que podemos contrastar el resultado con el suyo.

---

## 4. `resumen.json`

Esquema en [`respuesta.schema.json`](respuesta.schema.json) (definición `resumen`). Ejemplo:

```json
{
  "version_resultado": "1.0",
  "trabajo_id": "trb_ejemplo_0001",
  "paquete": { "carpeta_raiz": "paquete-llenado-ia_fte-ebr-v03_ficha-140_20261017-221521", "ficha_id": 140, "plantilla_codigo": "FTE-EBR-V03", "version_paquete": "1.0" },
  "generado_en": "2026-10-17T22:40:00Z",
  "duracion_segundos": 1260,
  "modelos": [
    { "proveedor": "ejemplo", "modelo": "modelo-de-ejemplo", "llamadas": 114, "tokens_entrada": 8200000, "tokens_salida": 310000 }
  ],
  "conteos": {
    "secciones_con_campos": 5,
    "campos_texto": { "total": 66, "extraido": 39, "inferido": 0, "requiere_confirmacion": 0, "conflictivo": 0, "no_encontrado": 27 },
    "tablas_entregadas": 118,
    "tablas_sin_cambios_respecto_al_formato": 9
  },
  "excel": { "incluido": true, "archivo": "ficha_llenada.xlsx", "basado_en": "02_estructura_base/formato_base.xlsx" },
  "advertencias": [
    { "ambito": "campo", "identificador": "01.01.2", "mensaje": "El código del proyecto lo asigna el Banco de Inversiones; no consta en los documentos." },
    { "ambito": "tabla", "identificador": "01.08.14", "mensaje": "Sin información en los documentos: se devuelve la tabla en su estado base." }
  ]
}
```

| Clave | Obligatoria | Descripción |
|---|---|---|
| `version_resultado` | sí | `"1.0"`. |
| `trabajo_id` | sí | Id del trabajo en el servidor. |
| `paquete` | sí | Eco, igual que en `respuesta.json`. |
| `generado_en`, `duracion_segundos` | sí | Cuándo se terminó y cuánto tardó. |
| `modelos[]` | recomendado | Modelos de IA usados y consumo (llamadas, tokens). Nos sirve para costos. |
| `conteos` | sí | Totales por estado. `campos_texto.total` debe igualar la suma de `campos_de_texto` de las secciones pedidas; `tablas_entregadas` debe igualar el total de tablas pedidas. |
| `excel` | sí | `incluido` (true/false), `archivo`, `basado_en`. Si `incluido: false`, añadir el motivo en `motivo`. |
| `advertencias[]` | sí (puede ir `[]`) | Todo lo que el usuario debería saber: campos que no pudieron llenarse y por qué, tablas con respuesta inválida descartada, documentos ilegibles, conflictos entre documentos… `ambito`: `paquete` · `documento` · `seccion` · `campo` · `tabla`. |

---

## 5. Cómo se construye (resumen para el servidor)

1. Los resultados parciales se acumulan **sección por sección** (campos de texto) y **tabla por tabla**.
2. `respuesta.json → secciones[]` y `tablas[]` se ensamblan al final con **todos** los campos/tablas del paquete, llenados o no. El orden sigue el de `secciones.json` y el de los archivos de tablas (no es obligatorio, sí recomendable).
3. `ficha_llenada.xlsx` se genera a partir de `respuesta.json` + `formato_base.xlsx` (§3).
4. `resumen.json` se calcula a partir de los resultados reales (no a mano).
5. Se comprime todo en el zip descrito, se calcula `sha256` y `bytes`, se publica en un almacenamiento con URL prefirmada y **recién entonces** el estado pasa a `completado` con `porcentaje: 100` y `resultado` (contrato 01 §3.4).

**Si el trabajo se pausó para preguntar** (contrato 01 §2.4 bis), el resultado **no cambia de formato**: es el mismo zip. Las respuestas de la persona son un insumo más para la IA —igual que los documentos— y no hay un campo especial que las marque; solo se espera que el valor resultante cumpla las mismas validaciones. Si la persona omitió una pregunta («aplicar lo disponible»), el campo queda en su estado base (nunca se inventa) y conviene declararlo en `advertencias[]` (`ambito: "campo"`). Mientras el trabajo está en `esperando_datos` no hay `resultado` ni se ha escrito nada en la ficha de la persona.

---

## 6. Qué valida la plataforma al recibirlo (lo que no deben romper)

Aunque confíen en la IA, **la plataforma valida todo** antes de escribir en la ficha del usuario. Son las mismas validaciones que ya aplicamos hoy cuando llamamos a la IA directamente; la integración con este servidor las reutiliza (ya está construida del lado de la plataforma: `LlenadoExternoWorker` vigila el trabajo, aplica el resultado y gestiona las pausas). Lo que no pasa la validación se descarta (nunca se escribe) y se avisa al usuario. Cuanto más apegado al contrato, menos descartes.

| # | Validación | Si falla |
|---|---|---|
| 1 | El zip descargado coincide con `bytes` y `sha256` del estado. | Reintentamos la descarga; si persiste, el trabajo se informa como fallido. |
| 2 | Existe `respuesta.json` válido (UTF-8, JSON) y su `paquete` corresponde a la ficha/plantilla enviada. | Resultado rechazado completo. |
| 3 | Cada `seccion_id` y cada `id` de campo existen en la estructura y son campos **editables y no calculados**. | Esa entrada se ignora (aviso). |
| 4 | Campos con **opciones** (lista cerrada, desplegable del Excel o catálogo): el valor debe coincidir exactamente con una opción vigente; las listas **en cascada** se revisan contra el valor ya elegido en la celda superior. | Ese valor se descarta (aviso). |
| 5 | Cada tabla: `identificador` existente; `valor` con la forma de su tipo (claves de columna, bloques, árbol); número de filas/nodos igual al del formato (salvo las «muy grandes», que se completan solas). Toleramos pequeños desajustes recuperables (una fila de más o de menos al final, claves en distinto orden) y los registramos como advertencia; un desajuste de estructura no recuperable descarta **esa tabla**. | Se descarta esa tabla (aviso); el resto sigue. |
| 6 | Rótulos fijos y celdas calculadas de las tablas no se sobrescriben. | Se conserva el valor del formato. |
| 7 | Todos los valores son texto; números sin separador de miles. | Se normalizan cuando es inequívoco; si no, se descartan. |

**Qué hace la plataforma después:** guarda los valores aceptados en la ficha, marca el **origen** de cada uno («llenado por IA», con `estado`, `fuente` y `evidencia` visibles para revisión), guarda el Excel y el `resumen.json` junto al trabajo, y muestra al usuario un resumen: «N campos llenados, M tablas, X advertencias». El usuario revisa y corrige; nada se considera definitivo hasta que él lo guarda.

---

## 7. Checklist del zip de resultado

- [ ] `respuesta.json`: JSON válido UTF-8; `paquete` coincide con el paquete recibido.
- [ ] Una entrada en `secciones[]` por cada sección con campos de texto; en ella, **todos** sus campos (con `estado` y `valor_propuesto` coherentes: `no_encontrado` ⇒ `null`).
- [ ] Una entrada en `tablas[]` por cada archivo de `tablas/`, con la forma exacta de su tipo.
- [ ] En modo `estricto`: ningún `estado: "inferido"` y ninguna celda con dato sin respaldo en un documento real.
- [ ] Ids exactos (`identificador`, no UUID, en campos; ids de columna reales en tablas).
- [ ] Opciones idénticas al catálogo; números sin miles; una celda = un dato.
- [ ] `ficha_llenada.xlsx` parte del formato base y abre sin reparación (o `excel.incluido: false` con motivo).
- [ ] `resumen.json` coherente con `respuesta.json` (los conteos suman).
- [ ] `sha256` y `bytes` informados en el estado coinciden con el zip publicado.
