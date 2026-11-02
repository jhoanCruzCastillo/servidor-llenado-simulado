# Flujo de llenado (ficha con mapa)

Úsalo cuando `fichas/<CÓDIGO>/` ya existe. Si no existe, primero `nueva-ficha.md`.

## 0. Preparar
- Directorio de trabajo propio (no dentro de la skill). Copia la plantilla en blanco del usuario; nunca la edites en sitio.
- Extrae texto de los PDFs: `pdftotext -layout archivo.pdf archivo.txt`. Lee completos los PDFs fuente; del instructivo, solo las secciones que necesites (el índice y las notas de la ficha ya resumen lo importante).
- Lee `fichas/<CÓDIGO>/notas.md` y `fichas/<CÓDIGO>/indice.md`. **No** leas `mapa.json` completo salvo para depurar.
- Anota los insumos que la fuente menciona y no fueron adjuntados.

## 1. Escribir datos.json (pasada 1)
- Genera el esqueleto: `python scripts/llenar.py --mapa fichas/<C>/mapa.json --esqueleto datos.json`. Borra lo que no uses; `null` = no escribir.
- Llena por identificador. Si la fuente usa identificadores (01.05.4, 03.03.1…), coinciden con el índice. Si no, empareja por el nombre del ítem.
- Reglas de valores:
  - Textos de lista: copiar exacto de la lista del índice (tildes, mayúsculas, espacios).
  - Fechas: `"AAAA-MM-DD"`. Porcentajes: fracción (`0.07`), salvo que las notas digan otra cosa.
  - Números como número, no como texto (salvo códigos con ceros a la izquierda, como partidas o CIP: texto).
  - Tablas grandes (`lista`): solo filas con dato, en orden.
- Lo que depende de totales calculados se deja para la pasada 2 (ver notas de la ficha).

## 2. Ejecutar y leer totales
```
python scripts/flujo.py --plantilla FORMATO.xlsx --mapa fichas/<C>/mapa.json --datos datos.json --trabajo trabajo
```
Revisa los AVISO de `llenar.py` (valor fuera de lista, clave desconocida, columna oculta) y corrige. `verificar.py` imprime las verificaciones, los errores nuevos y los **totales**.

## 3. Pasadas 2 y 3
Crea `pasada2.json` (y `pasada3.json`) solo con los campos que dependen de los totales, y vuelve a ejecutar pasando todos los archivos de datos, en orden:
```
python scripts/flujo.py ... --datos datos.json --datos pasada2.json --datos pasada3.json --trabajo trabajo
```
Los archivos posteriores sobrescriben por identificador completo (un `grupo` en pasada2 reemplaza el grupo entero: incluye todas sus claves).

Para repartir montos en un cronograma, reparte uniforme por mes dentro de los meses de cada componente, agrupa por periodo, redondea a 2 decimales y ajusta el último periodo para que la suma sea exacta.

## 4. Entregar
Cuando todas las verificaciones den OK y no haya errores nuevos:
```
python scripts/flujo.py ... --salida ENTREGABLE.xlsx
```
`inyectar.py` debe reportar N/N fórmulas actualizadas en cada hoja. Nombre sugerido: `FTE_<código>_<IE o proyecto>_LLENADA.xlsx`.

Si una verificación no puede quedar en OK sin contradecir la fuente, no la fuerces: entrega y explícalo.

## 5. Reporte
Sigue `reporte.md`.
