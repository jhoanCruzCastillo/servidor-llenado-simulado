---
name: fte-ebr-v03-llenado
description: Llena el Excel FTE-EBR-V03 (ficha técnica educativa Invierte.pe / MINEDU) con Excel COM, en pasadas, solo celdas desbloqueadas. Usar cuando el directorio tiene formato_base.xlsx/.xlsm, ejemplos y PDFs del proyecto.
---

# Llenar FTE-EBR-V03

Aprendido de un llenado real que sí conservó listas, fórmulas y coherencia. **Mismo mecanismo:** Excel en blanco + ejemplos + PDFs + mensaje del chatbot. Esta skill es el *cómo*, no los *valores*.

Los números, textos y fechas salen **solo** de los documentos y el chat **de este** proyecto. No copies cifras de un caso anterior (`pass1.py` de otro trabajo es basura para este).

## Herramienta de escritura

- **Escribe con Excel COM** (`scripts/xl.ps1`). `openpyxl` al guardar **borra** validaciones x14 (listas que apuntan a otras hojas) y formato condicional extendido. Úsalo solo para leer / inspeccionar.
- PowerShell 5.1: castear números (`[double]$val`). Fechas = serial Excel (días desde 1899-12-30).
- Python: `python -P` (no `-I`; openpyxl está en site-packages de usuario).
- Entrega: `./ficha_llenada.xlsx` (SaveAs 51). Conserva protección, fórmulas y listas.

Uso:

```powershell
powershell -File conocimiento/scripts/xl.ps1 -In <formato_base.xlsx> -Out ficha_llenada.xlsx -Values passN.json -ReadSpec readN.json -ReadOut readN_out.json
```

`passN.json` = lista `[hoja, celda, valor]`. `xl.ps1` **omite celdas bloqueadas** y las lista.

## Regla de oro

Hojas protegidas. **Solo se escribe en celdas desbloqueadas** (`MergeArea.Locked = False`). Si parece de ingreso pero está bloqueada, es fórmula o rótulo: no la pises.

Antes de escribir: `python -P conocimiento/scripts/unl.py formato_base.xlsx` (lista ingresos). Tras armar el JSON: `python -P conocimiento/scripts/chk.py formato_base.xlsx passN.json` (fórmulas, merges, duplicados).

Mapa de celdas, anexos y trampas: `references/proceso.md`. Flujo de pasadas: `references/pasadas.md`.

## Orden

1. Leer instructivo + fuente de verdad + ejemplo (forma y extensión, no copiar datos).
2. Pasada 1: ingresos (FICHA 1–24, Anexos 1, 2, 3, 5). Recalcular.
3. Pasada 2: leer CD / totales calculados → GG Anexo 2, fechas 15.2. Recalcular.
4. Pasada 3: cronograma 16.2, valor residual Anexo 5, corrección de redondeo.
5. Anotar hallazgos nuevos en `./conocimiento/` (mapa, trampa, script). No reescribir esta skill con datos del proyecto.

Si el Excel de este directorio **no** es FTE-EBR-V03, aplica igual COM + desbloqueadas + pasadas, y mapea celdas desde el libro (no inventes el mapa de otra plantilla).
