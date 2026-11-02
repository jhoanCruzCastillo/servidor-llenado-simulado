# Caso: FTE-EBR-V03 — I.E. 16021 Nuestra Señora de Guadalupe (local 121808)

Caso de prueba con datos ficticios (paquete "Proyecta Fácil"): Bellavista / Jaén / Cajamarca, Primaria 0263541 y Secundaria 1347681, Mejoramiento y Ampliación, demolición total de 3 pabellones de adobe y 3 edificaciones nuevas.

`datos.json` contiene **todas** las entradas finales (las tres pasadas juntas). Sirve para:
- ver cómo se escribe cada tipo de campo;
- probar la skill: `flujo.py --datos datos.json` sobre la plantilla en blanco reproduce el entregable (30/30 verificaciones OK, 0 errores nuevos).

## Resultado
- Costo de inversión viable calculado por el Excel: **S/ 5 143 547.17** (la fuente decía S/ 6 385 200; sus subtotales no salían de sus propios anexos).
- VAC Alt. 1: 4 079 114 · VAC Alt. 2: 3 267 336. La Alt. 2 se descarta por criterio técnico (el adobe no cumple la E.030), no por costo.

## Qué se llenó en cada pasada
| Pasada | Campos |
|---|---|
| 1 | Todo lo de los PDFs |
| 2 | `03.03.8` GG como monto (10 % de 3 143 328.31 / 186 000 / 161 011.53); `01.15.5` y `01.15.6` fechas de metas; `01.15.1` secciones de Inicial = 0 |
| 3 | `01.16.14` cronograma en 6 trimestres; `01.16.10.mobiliario_equipo = -0.01`; `01.16.16.recursos_publicos = 5143547.17`; `06.01.residual_pct = 210000 / 5143547.17` |

## Decisiones (lo que se reportó al usuario)
- **Cronograma:** 16 meses de ejecución y la plantilla solo tiene 12 columnas → trimestres (6). Los meses de cada componente se respetaron; el expediente va completo en el periodo 1.
- **Demanda año por año:** el insumo C (SIAGIE) no venía. Se derivó de la matrícula 2025 (156 P / 94 S) hasta 168 / 142 en el año 10, con cada grado ≤ 30.
- **Aulas de secundaria:** la fuente decía "6P+6S", pero el Anexo 02 tiene 5. Se usaron 5 en capacidad y en el PASO 4. El Anexo 03 se dejó con 6 aulas de secundaria, como decía su PDF.
- **Capacidad optimizada = 0** (todas las aulas se demuelen), no 250.
- **Inicial:** secciones = 0 (con 1, el PASO 4 pedía 6 aulas de inicial).
- **Kits:** se registraron 16 de mobiliario y 9 de equipo como pedía la fuente; solo tienen costo los de "Otros Espacios".
- **Biblioteca** en el Anexo 03 → ambiente "Otros Espacios" (no existe en la lista).
- **Lluvias "Medio-Alto"** → "Alto". **Involucrados:** 6 actores en 5 filas (APAFA + Comunidad El Palto juntos).
- **Arreglos institucionales 9.2.4** = "No aplica" (texto de la fuente; AVISO aceptable).
- **Vacíos a propósito:** CUI, DNI, plano. Las coordenadas de 5.3 las trae el padrón (difieren del PDF).
