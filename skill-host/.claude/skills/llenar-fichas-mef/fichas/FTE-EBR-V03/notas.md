# FTE-EBR-V03 — notas de la plantilla

FTE para el mejoramiento, ampliación y/o recuperación de los servicios de Educación Inicial, Primaria y Secundaria (MINEDU, versión 03, diciembre 2025). Aplica a montos ≤ S/ 82 000 000.

Archivos: `mapa.json` (máquina), `indice.md` (lo que se lee para llenar), `_generar_mapa.py` (regenera el mapa si cambia el Excel).

## Hojas

| Hoja | Qué se llena | Notas |
|---|---|---|
| FICHA | Secciones 1-25 | Columnas B y J ocultas: los años van en G,H,I,K…Q y los periodos del cronograma en E,F,G,H,I,K…Q (máx. 12). |
| Anexo 1. Registro de C.U | GG, U, IGV, fecha, CU de la UF, justificación | Porcentajes como fracción (0.10). La justificación I25 es una sola celda combinada para todas las filas. |
| Anexo 2. Presup. Infraestruct. | Edificaciones, PASO 3, 5, 6, 7 y 8 | Ver abajo. |
| Anexo 3. Presup de MOB y EQUIP | % transporte, kits, detalle de bienes | Ver abajo. |
| Anexo 4. RESUMEN DE PRESUPUESTO | Nada | Automático. |
| Anexo 5. Evaluación Eco. | TSD, factores, residual, O&M de alternativa 2 | La alternativa 1 sale de la FICHA. |
| Padron_web, Data, Formato 7A | Nada | Ocultas. |

## Lo que se llena por pasadas

1. **Pasada 1 (datos directos):** todo lo que viene en los PDFs, incluyendo GG = 0 o vacío.
2. **Pasada 2 (después de recalcular):**
   - `03.03.8` GG como **monto**: `gg_obras = %GG × totales.cd_infraestructura`, `gg_contingencia = %GG × cd_contingencia`, `gg_mobiliario_equipo = %GG × cd_mobiliario_equipo` (redondear a 2 decimales).
   - `01.15.5` fechas de metas: una entrada por cada fila de 15.2 que tenga activo (en el caso de ejemplo fueron 24: 15 de infraestructura, 5 de mobiliario y 4 de equipo). Las filas aparecen en el orden de los anexos.
3. **Pasada 3:**
   - `01.16.14` cronograma: cada fila debe sumar exactamente `total_obras_civiles`, `total_contingencia`, `total_mobiliario`, `total_equipo` y los otros costos (ajustar el último periodo por redondeo).
   - `01.16.10` corrección por redondeo: si U766/U776/U789 dan "X" con diferencia ±0.01, poner esa diferencia (ej. `mobiliario_equipo: -0.01`).
   - `01.16.16.recursos_publicos` = `costo_total`.
   - `06.01.residual_pct` = valor residual / `costo_inversion_viable`.

`verificar.py` imprime todos estos totales.

## Particularidades (aprendidas en el primer llenado)

- **Código de local** (`01.05.4`, celda H100) como número. Llena departamento, provincia, distrito, ubigeo, nombre de la IE, zona, modulares, nivel y coordenadas desde `Padron_web`. Si el PDF trae otras coordenadas, **no** sobrescribir: las de 5.3 son fórmulas. Mencionarlo en el reporte.
- **Nombre del PI** (C13): se arma solo con la naturaleza, los servicios marcados, la IE y la ubicación.
- **C1.3** (`01.05.7`): la plantilla trae "X" en Mejoramiento y "-" en Mejoramiento y Ampliación por defecto. Hay que poner explícitamente la X correcta y "-" en las otras tres.
- **Indicadores 4.2** (`01.04.4`): el valor de calidad tiene formato %; 1 = 100 %. El espacio geográfico usa la lista ("Distrito", no "Distrital").
- **Servicios básicos** (`01.08.1`): cada fila tiene su propia lista de tipo alternativo. Copiar el texto exacto, incluido "(1) Pozo Propio " con espacio final.
- **Informe de suelos** (`01.08.10`): la lista es "SI"/"NO" en mayúsculas. Casi todo lo demás usa "Sí"/"No".
- **Peligros** (`01.08.21`, `01.18.2`): los niveles son Bajo/Medio/Alto/Muy Alto. No existe "Medio-Alto"; elegir uno y reportarlo.
- **Verificación 9.2.4 arreglos** (`01.09.11.arreglos`): la lista es "Si"/"No", sin tilde. Si la fuente dice "No aplica", escribirlo (genera un AVISO aceptable).
- **Involucrados** (`01.10.1`): solo 5 filas. Si hay más actores, fusionar los afines y reportarlo. No hay columna de percepción: va dentro de `intereses`.
- **Horizonte** (`01.13.1`/`01.13.4`): la plantilla tiene "Contratación / Elaboración / Revisión y aprobación / Otro" y "Contratación ejecución / Ejecución / Recepción y liquidación / Otro". Reagrupar las actividades de la fuente sin cambiar los totales de (a) y (b).
- **Balance O/D** (`01.14.8`–`01.14.11`): la oferta es la oferta **optimizada** (0 si todas las aulas se demuelen). Inicial sin servicio: todo en 0.
- **Capacidad** (`01.14.16`): `aulas_optimizadas` = aulas existentes que no se demuelen. `aulas_proyecto` debe coincidir con el PASO 3 del Anexo 02.
- **15.1** (`01.15.1`): Inicial sin servicio → `secciones_manana` = 0. Con 1, el PASO 4 pide "Incrementar 6 aulas".
- **Demanda de aulas** = ROUND(demanda / máx. por aula). Para que un grado dé 1 sección, su demanda del año 10 debe ser ≤ 30 (o ≤ 1.5 × máx.).
- **Cronograma** (`01.16.11`): solo 12 columnas. Si la ejecución dura más de 12 meses, usar `trimestres` (lista con espacio: " trimestres"; escribir "trimestres") y agrupar los meses de cada componente por trimestre.
- **Anexo 01**: llenar `cu_uf` solo en los activos que se usan. "Laboratorios y/o Talleres" es la fila 32 (la que busca el PASO 3).
- **Anexo 02 PASO 3** (`03.03.1`): `activo` = nombre exacto de Anexo 1 B25:B46. Los SS.HH. son "SS.HH. y/o vestidores (SS.HH.)". Edificación y piso son números.
- **Anexo 02 PASO 5**: la parte A (`03.03.3`) va una fila por AE de obras exteriores; la parte B (`03.03.4`) lleva el detalle con CU directo (sin GG/U/IGV).
- **Anexo 02 PASO 6** (`03.03.5`): `%EDIF` y `%CT` → metrado como fracción (0.04 = 4 %) y sin `cu_directo`. `tipo` = "otros".
- **Anexo 02 PASO 7** (`03.03.6`): si la fuente da el CD parcial y no el CU, usar `cu_directo = CD / metrado` (sin redondear).
- **Anexo 03** (`04.03.3`): `ambiente` usa la lista de Data!Z26:Z39. No hay "Biblioteca": usar "Otros Espacios" (va a "Mobiliario de Ambientes Complementarios"). `es_ae` es "Si"/"No" **sin tilde**: las fórmulas comparan con "Si".
- **Kits** (`04.02.1`/`04.02.2`): solo tienen costo los bienes con `es_ae = "No"`. Un kit con N > 0 y sin bienes AE=No aparece en metas con costo 0. Si la fuente lo pide así, respetarlo y reportarlo.
- **Errores heredados** de la plantilla (no tocar): FICHA J106:J108 (`=+#REF!`), AR740:AR742, Z702:Z703 y Anexo 4 B33.
- **Tiempo de recálculo**: unos 2 minutos por pasada (el padrón tiene 67 000 filas).
