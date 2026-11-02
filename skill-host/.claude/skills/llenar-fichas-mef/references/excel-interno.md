# Detalles técnicos del Excel (leer solo si algo falla o vas a tocar los scripts)

## Por qué no se guarda con openpyxl
Las plantillas del MEF y de los sectores usan validaciones de datos y formato condicional en extensiones `x14` (`<x14:dataValidation>` dentro de `<extLst>`). openpyxl las descarta al guardar: se pierden las listas desplegables de activos, ambientes, etc. Por eso:
- **Lectura**: openpyxl (dos cargas: fórmulas y `data_only=True` para valores en caché).
- **Escritura**: `comun.set_cells` edita `xl/worksheets/sheetN.xml` dentro del zip y copia el resto sin tocar.

## Escritura de celdas (`comun.set_cells`)
- Conserva el estilo `s=` de la celda existente; si la celda no existe, la inserta en orden de columna y, si hace falta, crea la fila.
- Texto como `inlineStr` (no toca sharedStrings). Números como `<v>`. Fechas como serial de Excel (base 1899-12-30).
- Solo se escribe en la celda ancla de un rango combinado.
- `write_workbook` agrega `fullCalcOnLoad="1"` en `<calcPr>` para que Excel recalcule al abrir.

## Recálculo
`recalcular.py` abre una copia con LibreOffice headless, ejecuta `calculateAll()` con una macro en un perfil temporal y guarda. Esa copia **solo se lee**: LibreOffice reescribe el archivo a su manera. Si falla porque no encuentra `soffice`, instala LibreOffice o agrégalo al PATH.

## Inyección de valores (`inyectar.py`)
Copia los valores calculados a los `<v>` de las celdas con fórmula del archivo editado, para que visores y vistas previas muestren los números correctos. Expresión regular:
```
<c r="REF"(attrs)>(<f .../>|<f ...>texto</f>)(<v ...>texto</v>|<v/>)?</c>
```
Trampas ya resueltas, no reintroducirlas:
- No usar `.*?` dentro de `<f>` o `<v>`: con `<v/>` el motor retrocede y una coincidencia se come la celda vecina.
- `<v>` puede traer atributos (`xml:space="preserve"`) o venir vacío (`<v/>`).
- Las fórmulas compartidas aparecen como `<f t="shared" si="3"/>`.
- No tocar fórmulas con vínculos externos (`[6]FICHA!S617`) ni celdas donde LibreOffice dio error: se conserva el valor original.
- Texto → `t="str"`; booleano → `t="b"`; número → sin `t`.

`inyectar.py` imprime N/T por hoja; si N < T, hay un formato de celda que el regex no reconoce: revisarlo antes de entregar.

## Columnas ocultas y celdas desbloqueadas "fantasma"
Varias plantillas tienen columnas ocultas desbloqueadas entre los años (J en la FTE-EBR). El inventario las marca y `llenar.py` avisa si se escribe en ellas.

## Validaciones con espacios
Listas como `"Bajo, Medio, Alto"` generan opciones con espacio inicial (" Medio"). Escribe el valor sin espacio salvo que una fórmula compare el texto exacto; `llenar.py` compara sin espacios ni mayúsculas para avisar.
