"""Comprueba que un JSON [hoja, celda, valor] no pise fórmulas, merges mal, ni duplique."""
import json
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")
if len(sys.argv) < 3:
    print("uso: python -P chk.py <formato_base.xlsx> <pass.json>")
    sys.exit(2)

wb = openpyxl.load_workbook(sys.argv[1])
V = json.load(open(sys.argv[2], encoding="utf-8"))
seen = set()
for sh, c, v in V:
    ws = wb[sh]
    cur = ws[c].value
    if (sh, c) in seen:
        print("DUP", sh, c)
    seen.add((sh, c))
    if isinstance(cur, str) and cur.startswith("="):
        print("FORMULA", sh, c, cur[:60])
    elif cur is not None and cur != v:
        print("OVERWRITE", sh, c, repr(cur)[:50], "->", repr(v)[:50])
    for mr in ws.merged_cells.ranges:
        if c in mr and mr.start_cell.coordinate != c:
            print("NOT-TOPLEFT", sh, c, mr.coord)
