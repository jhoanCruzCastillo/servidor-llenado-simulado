---
name: llenar-fichas-mef
description: Llena fichas técnicas Excel de inversión pública del Perú (Invierte.pe / MEF), como el Formato 06-A/06-B, las FTE sectoriales (FTE-EBR-V03, FTE-SAN-URBANO, FTE-CARRETERAS…) y las fichas simplificadas FS, a partir de PDFs fuente, el instructivo y un ejemplo de llenado. Escribe solo en las celdas de entrada sin perder listas desplegables, recalcula, deja todas las verificaciones de la plantilla en OK y reporta las discrepancias. También sirve para mapear una plantilla nueva del catálogo. Úsala siempre que pidan llenar, completar o revisar una ficha técnica, FTE, ficha simplificada o formato de proyecto de inversión pública en Excel.
compatibility: Python 3.9+ con openpyxl; LibreOffice (soffice) para recalcular; pdftotext (poppler) para leer PDFs.
---

# Llenar fichas técnicas del MEF

Entrada típica: el Excel en blanco de la ficha, PDFs "fuente de la verdad" con los valores, el instructivo y, a veces, un ejemplo de llenado. Salida: el mismo Excel llenado, con todas las verificaciones internas en OK, más un reporte breve de decisiones y discrepancias.

## Tres reglas que no se negocian

1. **Nunca guardes con openpyxl.** Borra las listas desplegables x14 de estas plantillas. Toda escritura pasa por `scripts/llenar.py` (edita el XML).
2. **Solo celdas de entrada** (desbloqueadas, grises o celestes). Totales, nombre del PI, ubigeo, precios sociales y anexos de resumen son fórmulas: no se tocan aunque la fuente traiga un número.
3. **El Excel calcula, la fuente informa.** Si un total no cuadra con la fuente, se queda el calculado y se reporta.

## Paso 1: ¿la ficha ya tiene mapa?

Fichas mapeadas (`fichas/`):

| Código | Ficha | Estado |
|---|---|---|
| FTE-EBR-V03 | Educación Inicial, Primaria y Secundaria (MINEDU v03) | Probada de punta a punta (caso I.E. 16021) |

Identifica la plantilla por el título de la hoja principal y por los nombres de las hojas.

- **Tiene mapa** → lee `fichas/<CÓDIGO>/notas.md` y `fichas/<CÓDIGO>/indice.md`, y sigue `references/flujo.md`. No necesitas explorar el Excel ni leer `mapa.json` completo.
- **No tiene mapa** → sigue `references/nueva-ficha.md` (inventario, mapa, prueba). Es la parte cara; avisa al usuario que el primer llenado de una plantilla nueva toma más tiempo.

## Paso 2: llenar por pasadas

```
python scripts/llenar.py --mapa fichas/<C>/mapa.json --esqueleto datos.json      # plantilla de datos
python scripts/flujo.py --plantilla FORMATO.xlsx --mapa fichas/<C>/mapa.json \
       --datos datos.json [--datos pasada2.json …] --trabajo trabajo [--salida ENTREGABLE.xlsx]
```

`flujo.py` = llenar → recalcular (LibreOffice, ~2 min) → verificar → inyectar (con `--salida`). Las pasadas 2 y 3 llenan lo que depende de totales calculados: GG como monto, cronograma, redondeos, monto financiado, valor residual. La lista exacta está en las notas de cada ficha.

Termina solo cuando `verificar.py` muestre todas las verificaciones en OK y 0 errores nuevos, o cuando una que no puede quedar en OK esté justificada en el reporte.

## Paso 3: reportar

Sigue `references/reporte.md`: estado, monto calculado vs fuente, decisiones, vacíos. Envía el .xlsx con un nombre descriptivo.

## Cuándo leer cada referencia

| Archivo | Cuándo |
|---|---|
| `references/flujo.md` | Siempre que la ficha tiene mapa |
| `references/fuentes-y-discrepancias.md` | Cuando la fuente se contradice, no cuadra o no cabe en la plantilla |
| `references/nueva-ficha.md` | Plantilla sin mapa |
| `references/excel-interno.md` | Si un script falla, si `inyectar.py` reporta N < T, o si vas a modificar los scripts |
| `references/reporte.md` | Al terminar |

## Scripts (`scripts/`)

| Script | Hace |
|---|---|
| `inventario.py` | Lista compacta de celdas de entrada con etiquetas, rangos combinados, listas (incl. x14) y columnas ocultas |
| `llenar.py` | datos.json + mapa → xlsx (avisa valores fuera de lista, claves desconocidas, columnas ocultas); `--esqueleto` |
| `recalcular.py` | Recalcula una copia con LibreOffice headless |
| `verificar.py` | Verificaciones de la plantilla, errores nuevos vs heredados, totales para la siguiente pasada |
| `inyectar.py` | Pone los valores recalculados en el archivo editado (entregable) |
| `flujo.py` | Los cuatro anteriores en orden |
| `extraer_datos.py` | Ficha ya llenada → datos.json (reutilizar un caso como base) |
| `indice_mapa.py` | mapa.json → indice.md |

## Al terminar una ficha nueva o descubrir una trampa

Agrega la trampa como una línea en `fichas/<CÓDIGO>/notas.md` ("Particularidades"). Si cambiaste `mapa.json`, regenera `indice.md`. Así el siguiente llenado no repite la iteración.
