# llenar-fichas-mef

Skill para Claude Code que llena las fichas técnicas Excel de proyectos de inversión pública del Perú (Invierte.pe / MEF): Formatos 06-A y 06-B, FTE sectoriales y fichas simplificadas. Lo hace a partir de PDFs fuente, sin romper fórmulas ni listas desplegables, y deja en OK todas las verificaciones de la plantilla.

## Instalación

Copia la carpeta `llenar-fichas-mef/` a:

- Personal (todos tus proyectos): `~/.claude/skills/` (Windows: `%USERPROFILE%\.claude\skills\`)
- Solo un proyecto: `<proyecto>/.claude/skills/`

Reinicia Claude Code y comprueba con `/skills`. Se invoca con `/llenar-fichas-mef` o sola cuando pides llenar una ficha.

### Requisitos
- Python 3.9+ y `pip install openpyxl`
- LibreOffice (para recalcular). En Windows: `C:\Program Files\LibreOffice\program\soffice.exe`; lo detecta solo.
- `pdftotext` (poppler). Windows: poppler para Windows en el PATH; Mac: `brew install poppler`; Linux: `poppler-utils`.

## Estructura

```
llenar-fichas-mef/
├── SKILL.md                 ← punto de entrada (corto): reglas, decisión mapa/no mapa, comandos
├── references/              ← se leen solo cuando hacen falta
│   ├── flujo.md             ← llenado por pasadas con una ficha mapeada
│   ├── nueva-ficha.md       ← cómo mapear una plantilla nueva
│   ├── fuentes-y-discrepancias.md
│   ├── excel-interno.md     ← detalles técnicos (XML, x14, regex, LibreOffice)
│   └── reporte.md
├── scripts/                 ← se ejecutan, no se reescriben
│   ├── comun.py  inventario.py  llenar.py  recalcular.py
│   ├── verificar.py  inyectar.py  flujo.py  extraer_datos.py  indice_mapa.py
├── fichas/
│   ├── _plantilla/          ← punto de partida para una ficha nueva
│   └── FTE-EBR-V03/         ← mapa.json, indice.md, notas.md, _generar_mapa.py
├── examples/
│   └── fte-ebr-v03-ie16021/ ← datos.json completo de un caso real de prueba + decisiones
├── evals/evals.json         ← casos para evaluar la skill
└── tests/                   ← pruebas de los scripts (python -m unittest)
```

## Uso rápido (ficha mapeada)

```bash
S=~/.claude/skills/llenar-fichas-mef
python $S/scripts/llenar.py --mapa $S/fichas/FTE-EBR-V03/mapa.json --esqueleto datos.json
# … completar datos.json con los PDFs …
python $S/scripts/flujo.py --plantilla FORMATO.xlsx --mapa $S/fichas/FTE-EBR-V03/mapa.json \
       --datos datos.json --trabajo trabajo --salida FICHA_LLENADA.xlsx
```

## Agregar una ficha del catálogo

Pídele a Claude: "mapea la ficha FTE-SAN-URBANO para la skill llenar-fichas-mef" y adjunta el Excel en blanco, el instructivo y, si puedes, un caso con PDFs. Seguirá `references/nueva-ficha.md` y dejará `fichas/FTE-SAN-URBANO/`. Para mapear conviene el modelo más capaz; los llenados siguientes pueden hacerse con uno intermedio.

## Pruebas

```bash
cd llenar-fichas-mef && python -m unittest discover tests
```
