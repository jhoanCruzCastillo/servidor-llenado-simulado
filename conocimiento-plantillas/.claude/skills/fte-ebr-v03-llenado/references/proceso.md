# FTE-EBR-V03 — Cómo llenar el Excel

Aprendido el 2026-10-30. Mapa y trampas de la **plantilla**, no de un proyecto.

## 1. Escribir con Excel (COM), no con openpyxl

- `openpyxl` **borra** las validaciones x14 (listas desplegables que apuntan a otras hojas) y el formato condicional extendido al guardar. No lo uses para guardar; úsalo solo para leer/inspeccionar.
- Escribir con Excel vía COM (PowerShell) conserva listas, fórmulas, protección y formatos. Script: `scripts/xl.ps1` (abre, escribe `[hoja, celda, valor]`, `CalculateFull`, guarda `.xlsx` (51), devuelve rangos pedidos en JSON).
- En PowerShell 5.1 los números de `ConvertFrom-Json` hay que castearlos: `$rng.Value2 = [double]$val` (si no: "No se puede convertir Int32 a String").
- Las fechas se escriben como serial de Excel (días desde 1899-12-30); las celdas ya tienen formato de fecha.
- Python: `python -P` (no `-I`).

## 2. Hojas protegidas: celda bloqueada = no es de ingreso

- FICHA, Anexos 1-5, Data y Padron_web están protegidas (sin contraseña conocida; no hace falta).
- **Solo se escribe en celdas desbloqueadas** (`MergeArea.Locked = False`). El script omite y lista las bloqueadas. Esto evita pisar totales/brechas/precios sociales/Anexo 4.
- Bloqueadas que parecen de ingreso pero **no** lo son: FICHA E356 (otros peligros CC), F421 y F428 (comentarios B2/C2 de saneamiento), F499 (rótulo "Otro"), L502 (horizonte = 10 fijo), P616/P617 (comentarios capacidad), Anexo 2 D604, Anexo 5 D18:D26 y K18:K26 (reinversiones: no se pueden ingresar).
- Para listar celdas de ingreso: openpyxl `cell.protection.locked == False` y que no sea fórmula (`scripts/unl.py`).

## 3. Flujo en pasadas (los montos dependen de cálculos)

1. Datos de entrada (FICHA secciones 1-24, Anexos 1, 2, 3, 5).
2. Recalcular y leer CD de cada bloque → GG del Anexo 2 (J728 obras civiles, K728 contingencia, M728 mob/eq; 10 % del CD) + fechas de metas 15.2 (P:S solo en filas 678-735 / 740-742 con "Tipo de factor" no vacío).
3. Recalcular y leer totales → cronograma financiero 16.2 (E830:Q841; columnas E,F,G,H,I,K,L…Q — **la J no es periodo**), valor residual (Anexo 5 F8 = residual/inversión; M8 alt. 2).
4. Si queda diferencia de 0,01 entre K789 y T789 → usar "Corrección por redondeo" U788 (U765/U775 para A1/A2).
- Repartir montos por periodo con el residuo de redondeo en el **último periodo con peso**, no en uno vacío.

## 4. Mapa de celdas FICHA (identificador → celda)

- 01.01.3 naturaleza L18 (`MEJORAMIENTO Y AMPLIACIÓN` u otra de la lista) + marca C1.3 G131:G134 ("X" en la opción, "-" en el resto; la base trae X en G133 por defecto).
- 01.01.4/5 programa: L20 (Sí) / N20 (No) con "X". 01.02.3 G31 (lista, ej. `0105 Educación Secundaria`).
- OPMI I39:I42, UF I47:I50, UEI I55:I58 (nivel, entidad, nombre, responsable); UEP I63.
- Servicios K70:K73 (I,P,S,EBA); brechas P70 (calidad) P72 (cobertura).
- Calidad filas 81-83 (I espacio, L año, M valor en % → 1 = 100 %, O contribución); cobertura filas 89-91 (M es número, formato 0.00).
- 01.05.4 H100 = código de local (dispara Padron_web: depto/prov/distrito, IE, modulares, lat/long). L106 se interviene. Áreas productivas: K118:K125 altitud, L118:L125 Sí/No.
- 6.1 N144 localidad; 6.2 D152; 7.1 F161.
- 8.1 filas 178-185: E (red localidad), G (IE01), K (otra provisión), M (tipo alt., texto exacto de E190:P194, ojo espacio final en `(1) Pozo Propio `), O comentario.
- 8.2: F203/L203/N203/P203, F209, L212/O212 (UTM), F216 cerco, F222 forma, M219:M222 topografía, F231 (`SI`/`NO`), L232:L236 tipo suelo, F237 cap. portante, F243 nivel freático, H241 profesional, P241 CIP.
- 8.2.3 F251/F275/F276/F277. 8.2.4 filas 285-308: G total, I, K-N, O demoler, P comentario. 8.2.5 filas 321-326: G, I, K..O "X", P.
- 8.2.6 F331/F332. 8.3 filas 339-357 (E,F,G,H año,K,L); zonas Q339:Q346; FEN Q349; peligro mayor Q351 (lista); año Q354.
- 9: H364; predio fila 372 (F,H,K,M,O); 380 (F,M,O,Q); 387 (F,H,K,M); 401 (E..L); 410 (E..Q); D421 (B1), D428 (C1); G433:G435 (G434 lista "Si,No" sin tilde).
- 10 involucrados filas 442-446 (D,F ámbito lista,G,I posición lista,L,N). 11.2 G457:G459/O457:O459. 12.2 G473:G475/O473:O475. 12.3 F479 (alt. 2).
- 13: L489:L492 (ET), L496:L499 (obra).
- 14.1 F510, F513, F516:F519 ("X"/"-"), F520. 14.2 oferta/demanda por grado en columnas G,H,I,K..Q (J no es año): Inicial 528-545, Primaria 554-570, Secundaria 579-592. 14.3 H604/H605 unidad. 14.4 F614:F618 actual, H aulas optimizadas, I máx, L aulas con proyecto, M máx (K y N son fórmula).
- 15.1 Inicial E633/E635/E637; Primaria E647/E649/E651; Secundaria E661/E663/E665 (columnas E,G,I,L,N,P). "Cantidad Máx. Aulas" es fórmula.
- 15.2 fechas P678:S742; comentarios C749.
- 16.1 otros costos K801:K804, control concurrente K812. 16.2 H822 fecha, H823 `meses`/`trimestres`, H824 n.º periodos (máx. 12 columnas). 16.3 aporte M855, recursos públicos M857, marca F857. 16.4 I872 fecha inicio O&M, I873, O&M filas 878/879 (sin) 881/882 (con).
- 17.1 C893; 17.2 I902 (inversión A2 a mano). 18.1 C921; 18.2 filas 931-950 (E,F,G,H,K,P); 18.4 M957; 18.6 G964:L966.
- 19 K974:K979 (ET) / M974:M979 (obra); 20 K984:K988; 21.1 K995/K996; 21.2 C/G/N 1001-1005; 23 F1022/F1024, C1028, C1034, C1040; 24 L1049:L1062.

## 5. Anexos

- **Anexo 1**: I15 GG, I17 utilidad, I19 IGV, B19 fecha, B13 fuente; F25:F46 CU de la UF (repetir el PRONIED de E); **justificación es una sola celda combinada I25:I46** (escribir en I25).
- **Anexo 2**: O19 n.º edificaciones; M23:O42 pisos/niveles/nombre. PASO 3 filas 70-572: C edif, D piso, E naturaleza, F nombre, H m2, J activo (texto exacto de Anexo 1 B25:B46), L nivel (I,P,S,IP,PS,IS,IPS). PASO 5 parte A 599-604 (D,E,F,L; H/Q son fórmulas, H604 = área útil); parte B 610-675 (B nat, D, H, I und, J activo, L, M CU). PASO 6 681-699 (B, D, H, I und incl. `%EDIF` con H en fracción 0.04, J `otros`, L, M). PASO 7 706-713 (D, H cant, I amb/est/glb, J metrado, K um, L, M CU; costo = J×M). PASO 8 J728/K728/M728 GG (monto), J730/K730/M730 % utilidad.
- **Anexo 3**: F78 % transporte; kits I40:I52 (mob) e I59:I71 (equipo); detalle desde fila 86: B tipo ambiente (lista Data!Z26:Z39: no existe "Biblioteca" → usar `Otros Espacios`), D nombre, E `Si`/`No` (**sin tilde**, la fórmula Q compara con "Si"), F M/E, G n.º ambientes, I cantidad por ambiente, K PU con IGV sin flete. Solo los E="No" van a kits.
- **Anexo 4**: todo automático (bloqueado).
- **Anexo 5**: F7/M7 TSD, D8/D9/K8/K9 factores, F8/M8 % valor residual (residual = −inversión×%), J18 O&M sin proyecto alt. 2, L18 O&M con proyecto alt. 2. Alt. 1 se arma sola desde FICHA (G902, G880, G883).

## 6. Trampas de coherencia

- Inicial sin demanda: poner secciones turno mañana = 0 (no 1), si no el Paso 4 pide incrementar aulas de Inicial.
- 16.2 solo admite 12 periodos: si hay más meses, usar trimestres.
- Opciones de nivel de peligro: solo Bajo/Medio/Alto/Muy Alto ("Medio-Alto" → Alto).
- El total que arma el Excel (precios PRONIED ÷ 1,17 ÷ 1,18 como CU directo) puede no coincidir con el monto "de identidad" del PDF; M857 no está ligado a ninguna fórmula.
- Al guardar, Excel puede renumerar vínculos externos preexistentes ([6]→[5]) en FICHA Y678:Y703: es normal, mismos destinos.
- Columnas de años/periodos: **J no es periodo** (hueco visual). Listas: texto **exacto**, incluidos espacios finales.
- G434 y Anexo 3 E: `Si`/`No` **sin tilde**.
