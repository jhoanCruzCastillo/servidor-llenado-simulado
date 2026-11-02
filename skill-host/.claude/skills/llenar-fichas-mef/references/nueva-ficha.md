# Mapear una ficha nueva

Se hace una sola vez por plantilla, y es la parte cara. El resultado (`fichas/<CÓDIGO>/`) hace baratos los llenados siguientes. Conviene el modelo más capaz disponible.

## 1. Inventario
```
python scripts/inventario.py FORMATO.xlsx --salida inventario.txt
python scripts/inventario.py FORMATO.xlsx --hoja FICHA --filas 1-250     # por tramos
```
Celda de entrada = desbloqueada y sin fórmula (gris = texto/número, celeste = lista). El inventario muestra las etiquetas de la fila, los rangos combinados, las listas (también las x14 que openpyxl no ve) y marca `(oculta)` las columnas ocultas. Lee el inventario por tramos, no completo de una vez.

Además, revisa con openpyxl (solo lectura) las fórmulas que consumen las entradas clave, para saber el texto exacto que esperan (`IF(E86="Si",…)`) y qué celdas de verificación existen (columnas tipo U con "OK"/"X", "Validación = OK", "CORREGIR…", PASO de verificación final).

## 2. Diseñar los campos
- Identificadores: usa los del insumo o del instructivo si existen (sección.ítem.sub). Si no, sigue el patrón `SS.II.N` por sección del Excel (01 = FICHA, 02 = Anexo 01…).
- Elige el tipo:
  - `celda`: un valor.
  - `grupo`: varias celdas sueltas con nombre.
  - `filas`: una tabla con filas fijas con nombre (servicios, peligros, predios).
  - `lista`: una tabla de filas libres en orden (ambientes, bienes, involucrados).
  - `anual`: series por periodo.
- Claves en minúsculas y sin tildes (`red_localidad`, `t01`). Columnas ocultas: nunca dentro de `columnas_periodo`.
- `desc`: una línea que diga qué es y la trampa principal (formato, texto exacto, pasada 2).

## 3. Generar mapa.json
Lo más mantenible es un `_generar_mapa.py` como el de `fichas/FTE-EBR-V03/`: declara los campos a mano y lee las opciones de las listas desde el Excel (normales y x14, también por fila). Agrega:
- `verificaciones`: cada celda de control con `esperado` (o `esperado_empieza`, `si_vacio_ok`).
- `totales_a_leer`: los montos que necesitan las pasadas 2 y 3.
- `errores_heredados`: los errores que ya trae la plantilla en blanco (recalcúlala sin datos y lista los `#REF!`/`#VALUE!`).
- `columnas_ocultas`.

Después: `python scripts/indice_mapa.py fichas/<C>/mapa.json > fichas/<C>/indice.md`.

## 4. Probar
1. Llena con datos reales o de prueba usando `flujo.md`, hasta que todas las verificaciones den OK.
2. Prueba de ida y vuelta: `extraer_datos.py` del entregable → `flujo.py` con ese datos.json sobre la plantilla en blanco → deben salir las mismas verificaciones y totales.
3. Guarda el caso en `examples/<código>-<caso>/` (datos.json + README con decisiones).

## 5. Documentar
Copia `fichas/_plantilla/notas.md` y llénalo con hojas, pasadas y particularidades. Cada sorpresa que costó una iteración va como una línea en "Particularidades".
