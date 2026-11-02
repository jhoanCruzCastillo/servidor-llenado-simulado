# Cambios

## 1.0.0 — 2026-10-30
- Estructura modular: SKILL.md corto, `references/`, `scripts/`, `fichas/`, `examples/`, `evals/` y `tests/`.
- Scripts: inventario, llenar (datos.json + mapa), recalcular (LibreOffice headless), verificar, inyectar, flujo, extraer_datos, indice_mapa.
- Ficha mapeada: FTE-EBR-V03 (109 campos, 30 verificaciones). Probada de ida y vuelta con el caso I.E. 16021 / local 121808: todas las verificaciones en OK y 0 errores nuevos.
- Corregido el regex de inyección: ya maneja `<v/>` y `<v xml:space="preserve">` sin comerse celdas vecinas.
