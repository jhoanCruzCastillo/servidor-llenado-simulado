"""Inventario compacto de celdas de entrada de una plantilla (para mapear una ficha nueva).

Uso:
  python inventario.py plantilla.xlsx                      # todas las hojas visibles
  python inventario.py plantilla.xlsx --hoja FICHA --filas 1-200
  python inventario.py plantilla.xlsx --salida inventario.txt

Por fila imprime las etiquetas de texto y las celdas de entrada:
  celda[rango combinado]=valor_actual {opciones de lista}
Celda de entrada = desbloqueada y sin fórmula. Columnas ocultas se marcan con (oculta).
"""
import argparse
import sys
import warnings
import zipfile

import openpyxl

sys.path.insert(0, __import__('os').path.dirname(__file__))
from comun import expand_sqref, ext_validations, list_options, sheet_paths  # noqa: E402

try:  # consola de Windows
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


warnings.filterwarnings('ignore')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx')
    ap.add_argument('--hoja', action='append')
    ap.add_argument('--filas', help='rango de filas, ej. 1-200')
    ap.add_argument('--salida')
    ap.add_argument('--max-etiqueta', type=int, default=60)
    a = ap.parse_args()

    out = open(a.salida, 'w', encoding='utf8') if a.salida else sys.stdout
    wb = openpyxl.load_workbook(a.xlsx)
    wbv = openpyxl.load_workbook(a.xlsx, data_only=True)
    paths, states = sheet_paths(a.xlsx)
    z = zipfile.ZipFile(a.xlsx)
    hojas = a.hoja or [n for n in wb.sheetnames if states.get(n) == 'visible']
    r0, r1 = (map(int, a.filas.split('-')) if a.filas else (1, 10 ** 7))

    for name in hojas:
        ws = wb[name]
        hidden = {k for k, d in ws.column_dimensions.items() if d.hidden}
        for k, d in list(ws.column_dimensions.items()):
            if d.hidden and d.min and d.max:
                for c in range(d.min, d.max + 1):
                    hidden.add(openpyxl.utils.get_column_letter(c))
        anchors, inner = {}, set()
        for m in ws.merged_cells.ranges:
            anchors[(m.min_row, m.min_col)] = str(m)
            for r in range(m.min_row, m.max_row + 1):
                for c in range(m.min_col, m.max_col + 1):
                    if (r, c) != (m.min_row, m.min_col):
                        inner.add((r, c))
        dv = {}
        for v in ws.data_validations.dataValidation:
            if v.type == 'list':
                for ref in expand_sqref(str(v.sqref)):
                    dv[ref] = v.formula1
        for sq, f in ext_validations(z.read(paths[name]).decode('utf8')):
            for ref in expand_sqref(sq):
                dv[ref] = f
        out.write(f'\n===== {name}  (columnas ocultas: {",".join(sorted(hidden)) or "-"})\n')
        for row in ws.iter_rows(min_row=r0, max_row=min(r1, ws.max_row)):
            labs, ins = [], []
            for c in row:
                if (c.row, c.column) in inner:
                    continue
                v = c.value
                is_f = isinstance(v, str) and v.startswith('=')
                if c.protection.locked is False and not is_f:
                    s = c.coordinate
                    if (c.row, c.column) in anchors:
                        s += f'[{anchors[(c.row, c.column)]}]'
                    if c.column_letter in hidden:
                        s += '(oculta)'
                    if v is not None:
                        s += '=' + repr(v)[:30]
                    if c.coordinate in dv:
                        opts = list_options(dv[c.coordinate], wbv, name)
                        s += ' {' + ('|'.join(str(o) for o in opts)[:120] if opts else dv[c.coordinate][:60]) + '}'
                    ins.append(s)
                elif isinstance(v, str) and not is_f and v.strip():
                    labs.append(f'{c.coordinate}:{v.strip()[:a.max_etiqueta]!r}')
            if ins:
                out.write(f'{row[0].row}| ' + ' ; '.join(labs) + '\n   IN> ' + ' | '.join(ins) + '\n')
            elif labs:
                out.write(f'{row[0].row}| ' + ' ; '.join(labs) + '\n')


if __name__ == '__main__':
    main()
