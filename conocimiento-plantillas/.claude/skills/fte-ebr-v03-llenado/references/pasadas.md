# Pasadas 2 y 3 (patrón)

Los JSON de cada pasada son `[hoja, celda, valor]`. Nunca reutilices un `pass1.json` de otro proyecto.

## Pasada 1

Ingresos del PDF/chat en FICHA 1–24 y Anexos 1, 2, 3, 5. No escribas GG (J728/K728/M728), fechas 15.2 (P:S de filas con tipo de factor), ni el cronograma 16.2: salen de cálculos. `chk.py` + `xl.ps1` + `CalculateFull`.

Lee después, como mínimo:

- Anexo 2 `E737:J800` (CD civiles / contingencia / mob-eq).
- FICHA `C678:T742` (metas 15.2: columna de tipo de factor).
- Totales de inversión / residual que alimentan 16.2 y Anexo 5.

## Pasada 2

Tras el recálculo:

- GG Anexo 2 = 10 % del CD de cada bloque: J728 civiles, K728 contingencia, M728 mob/eq.
- Fechas 15.2 (P inicio formulación, Q fin formulación, R inicio ejecución, S fin ejecución) **solo** en filas 678–735 y 740–742 cuyo tipo sea `Infraestructura`, `Mobiliario` o `Equipo`.
- Ajusta oferta actual F614/F615 si el recálculo lo exige (p. ej. Inicial en 0).

Vuelve a recalcular.

## Pasada 3

- Cronograma 16.2: filas 830, 831, 833, 834, 838–841; columnas de periodo E,F,G,H,I,K… (máx. 12; **J no cuenta**). Pesos según el calendario 01.16.14 / 01.16.20 de **este** proyecto.
- `alloc(total, pesos)`: redondeo a 2 decimales y el residuo en el **último periodo con peso > 0**.
- Si |K789 − T789| ≈ 0,01 → U788 (o U765/U775 en A1/A2).
- Anexo 5 F8 = residual_alt1 / inversión_alt1; M8 = residual_alt2 / inversión_alt2 (fracción, no monto).
