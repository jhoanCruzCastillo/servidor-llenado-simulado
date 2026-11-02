"""Lista celdas de ingreso (desbloqueadas, sin fórmula) del formato base."""
import json
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")
if len(sys.argv) < 2:
    print("uso: python -P unl.py <formato_base.xlsx> [pass.json]")
    sys.exit(2)

wb = openpyxl.load_workbook(sys.argv[1])
mine = set()
if len(sys.argv) > 2:
    V = json.load(open(sys.argv[2], encoding="utf-8"))
    mine = {(a, b) for a, b, _c in V}

for ws in wb.worksheets:
    print("==", ws.title, "protected" if ws.protection.sheet else "NOT protected")
    if not ws.protection.sheet:
        continue
    merged = {}
    for mr in ws.merged_cells.ranges:
        for row in ws.iter_rows(min_row=mr.min_row, max_row=mr.max_row, min_col=mr.min_col, max_col=mr.max_col):
            for c in row:
                if c.coordinate != mr.start_cell.coordinate:
                    merged[c.coordinate] = 1
    out = []
    for row in ws.iter_rows(max_row=min(ws.max_row, 1100)):
        for c in row:
            if c.coordinate in merged:
                continue
            if c.protection.locked:
                continue
            v = c.value
            if isinstance(v, str) and v.startswith("="):
                continue
            if (ws.title, c.coordinate) in mine:
                continue
            out.append(c.coordinate)
    print(len(out))
    print(" ".join(out)[:6000])
