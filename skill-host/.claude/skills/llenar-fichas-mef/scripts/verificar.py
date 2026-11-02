"""Lee el archivo recalculado y reporta: verificaciones de la plantilla, errores de fórmula
(separando los heredados) y los totales que se necesitan para la siguiente pasada.

Uso: python verificar.py calculada.xlsx --mapa fichas/FTE-EBR-V03/mapa.json [--json resultado.json]
Sale con código 1 si alguna verificación falla o hay errores nuevos.
"""
import argparse
import json
import sys
import warnings

import openpyxl

try:  # consola de Windows
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


warnings.filterwarnings('ignore')
ERR = ('#REF!', '#VALUE!', '#DIV/0!', '#N/A', '#NAME?', '#NUM!', '#NULL!')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('calculada')
    ap.add_argument('--mapa', required=True)
    ap.add_argument('--json')
    a = ap.parse_args()
    mapa = json.load(open(a.mapa, encoding='utf8'))
    wb = openpyxl.load_workbook(a.calculada, data_only=True)
    res = {'verificaciones': [], 'errores_nuevos': [], 'errores_heredados': [], 'totales': {}}
    fallas = 0
    for v in mapa.get('verificaciones', []):
        val = wb[v['hoja']][v['celda']].value
        sval = '' if val is None else str(val).strip()
        if 'esperado_empieza' in v:
            ok = sval.startswith(v['esperado_empieza'])
        else:
            ok = sval == v['esperado'] or (v.get('si_vacio_ok') and sval == '')
        fallas += not ok
        res['verificaciones'].append({'celda': f"{v['hoja']}!{v['celda']}", 'valor': sval, 'ok': ok, 'desc': v['desc']})
    hered = set(mapa.get('errores_heredados', []))
    for ws in wb.worksheets:
        if ws.title == 'Padron_web':
            continue
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value in ERR:
                    k = f'{ws.title}!{c.coordinate}'
                    (res['errores_heredados'] if k in hered else res['errores_nuevos']).append(f'{k} {c.value}')
    for k, (h, ref) in mapa.get('totales_a_leer', {}).items():
        val = wb[h][ref].value
        res['totales'][k] = val if not hasattr(val, 'isoformat') else val.isoformat()

    for v in res['verificaciones']:
        print(('OK   ' if v['ok'] else 'FALLA'), v['celda'], repr(v['valor'])[:40], '-', v['desc'])
    print(f"\nErrores nuevos: {len(res['errores_nuevos'])}  | heredados de la plantilla: {len(res['errores_heredados'])}")
    for e in res['errores_nuevos'][:40]:
        print('  ', e)
    print('\nTotales:')
    for k, v in res['totales'].items():
        print(f'  {k}: {v}')
    if a.json:
        json.dump(res, open(a.json, 'w', encoding='utf8'), ensure_ascii=False, indent=1, default=str)
    sys.exit(1 if fallas or res['errores_nuevos'] else 0)


if __name__ == '__main__':
    main()
