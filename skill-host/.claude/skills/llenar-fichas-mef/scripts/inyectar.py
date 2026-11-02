"""Copia los valores recalculados (de la copia procesada por LibreOffice) a las celdas con fórmula
del archivo editado, para que se vean bien en cualquier visor. Conserva todo lo demás intacto.

Uso: python inyectar.py llena.xlsx calculada.xlsx ENTREGABLE.xlsx [--omitir Padron_web]

Reglas: no toca fórmulas con vínculos externos ([n]) ni celdas donde LibreOffice dio error
(mantiene el valor que traía la plantilla).
"""
import argparse
import os
import re
import sys
import warnings
import zipfile

import openpyxl

sys.path.insert(0, os.path.dirname(__file__))
from comun import ERRORES, FORMULA_CELL, cached_cell_xml, sheet_paths  # noqa: E402

try:  # consola de Windows
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


warnings.filterwarnings('ignore')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('editada')
    ap.add_argument('calculada')
    ap.add_argument('salida')
    ap.add_argument('--omitir', action='append', default=['Padron_web'])
    a = ap.parse_args()
    wb = openpyxl.load_workbook(a.calculada, data_only=True)
    paths, _ = sheet_paths(a.editada)
    by_path = {p: n for n, p in paths.items() if n not in a.omitir}
    zin = zipfile.ZipFile(a.editada)
    stats = {}
    tmp = a.salida + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            name = by_path.get(item.filename)
            if name:
                ws = wb[name]

                def rep(m):
                    ref, attrs, f, _v = m.groups()
                    if '[' in f:
                        return m.group(0)
                    val = ws[ref].value
                    if isinstance(val, str) and val in ERRORES:
                        return m.group(0)
                    return cached_cell_xml(ref, attrs, f, val)

                xml, n = FORMULA_CELL.subn(rep, data.decode('utf8'))
                total = len(re.findall(r'<c r="[A-Z]+\d+"[^>]*><f', xml))
                stats[name] = (n, total)
                data = xml.encode('utf8')
            zout.writestr(item, data)
    os.replace(tmp, a.salida)
    for k, (n, t) in stats.items():
        flag = '' if n == t else f'  <-- {t - n} celdas con fórmula sin reconocer'
        print(f'{k}: {n}/{t} fórmulas actualizadas{flag}')


if __name__ == '__main__':
    main()
