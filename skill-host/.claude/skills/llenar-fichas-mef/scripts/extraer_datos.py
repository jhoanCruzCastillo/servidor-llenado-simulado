"""Extrae un datos.json desde una ficha YA llenada (para reutilizarla como base de otra, o
para revisar qué se ingresó). Solo lee las celdas de entrada definidas en el mapa.

Uso: python extraer_datos.py ficha_llena.xlsx --mapa fichas/FTE-EBR-V03/mapa.json --salida datos.json
"""
import argparse
import datetime
import json
import warnings

import openpyxl
import sys

try:  # consola de Windows
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


warnings.filterwarnings('ignore')


def clean(v):
    if isinstance(v, str) and v.startswith('='):
        return None
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.date().isoformat() if isinstance(v, datetime.datetime) else v.isoformat()
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return int(v)
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx')
    ap.add_argument('--mapa', required=True)
    ap.add_argument('--salida', required=True)
    a = ap.parse_args()
    mapa = json.load(open(a.mapa, encoding='utf8'))
    wb = openpyxl.load_workbook(a.xlsx)
    out = {}
    for cid, m in mapa['campos'].items():
        ws = wb[m['hoja']]
        g = lambda ref: clean(ws[ref].value)  # noqa: E731
        t = m['tipo']
        if t == 'celda':
            v = g(m['celda'])
            if v is not None:
                out[cid] = v
        elif t == 'grupo':
            d = {k: g(r) for k, r in m['celdas'].items()}
            d = {k: v for k, v in d.items() if v is not None}
            if d:
                out[cid] = d
        elif t == 'filas':
            d = {}
            for fk, r in m['filas'].items():
                row = {ck: g(f'{c}{r}') for ck, c in m['columnas'].items()}
                row = {k: v for k, v in row.items() if v is not None}
                if row:
                    d[fk] = row
            if d:
                out[cid] = d
        elif t == 'lista':
            rows = []
            for i in range(m['max_filas']):
                r = m['fila_inicio'] + i
                row = {ck: g(f'{c}{r}') for ck, c in m['columnas'].items()}
                row = {k: v for k, v in row.items() if v is not None}
                rows.append(row)
            while rows and not rows[-1]:
                rows.pop()
            if rows:
                out[cid] = rows
        elif t == 'anual':
            d = {}
            for fk, r in m['filas'].items():
                serie = [g(f'{c}{r}') for c in m['columnas_periodo']]
                while serie and serie[-1] is None:
                    serie.pop()
                if serie:
                    d[fk] = serie
            if d:
                out[cid] = d
    json.dump({'plantilla': mapa['plantilla'], 'campos': out, 'celdas': {}},
              open(a.salida, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f'{len(out)} campos extraídos a {a.salida}')


if __name__ == '__main__':
    main()
