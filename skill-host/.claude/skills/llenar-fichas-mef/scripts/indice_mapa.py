"""Genera un índice legible (indice.md) a partir de mapa.json: identificador, tipo, claves y
listas válidas. Es lo que se lee para llenar datos.json (el JSON completo pesa más).

Uso: python indice_mapa.py fichas/FTE-EBR-V03/mapa.json > fichas/FTE-EBR-V03/indice.md
"""
import json
import sys

try:  # consola de Windows
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass



def short(opts, n=40):
    o = [str(x).strip() for x in opts]
    s = ' | '.join(o[:n])
    return s + (' | …' if len(o) > n else '')


def main():
    m = json.load(open(sys.argv[1], encoding='utf8'))
    print(f"# Índice de campos — {m['plantilla']}\n")
    print(f"{m.get('nombre', '')}\n")
    print('Generado con `scripts/indice_mapa.py`; no editar a mano (editar mapa.json y regenerar).\n')
    print('Tipos: **celda** → valor · **grupo** → {clave: valor} · **filas** → {fila: {columna: valor}} · '
          '**lista** → [{columna: valor}, …] en orden · **anual** → {fila: [periodo1, periodo2, …]}\n')
    hoja = None
    for cid, f in m['campos'].items():
        if f['hoja'] != hoja:
            hoja = f['hoja']
            print(f'\n## {hoja}\n')
        t = f['tipo']
        line = f"- **{cid}** `{t}` — {f['desc']}"
        if t == 'celda':
            line += f" (`{f['celda']}`)"
        elif t == 'grupo':
            line += '\n  - claves: ' + ', '.join(f'`{k}`' for k in f['celdas'])
        elif t == 'filas':
            line += '\n  - filas: ' + ', '.join(f'`{k}`' for k in f['filas'])
            line += '\n  - columnas: ' + ', '.join(f'`{k}`' for k in f['columnas'])
        elif t == 'lista':
            line += f"\n  - máx. {f['max_filas']} filas; columnas: " + ', '.join(f'`{k}`' for k in f['columnas'])
        elif t == 'anual':
            line += '\n  - filas: ' + ', '.join(f'`{k}`' for k in f['filas'])
            line += f"\n  - {len(f['columnas_periodo'])} periodos"
        op = f.get('opciones')
        if isinstance(op, list):
            line += f'\n  - lista: {short(op)}'
        elif isinstance(op, dict):
            for k, o in op.items():
                line += f'\n  - lista `{k}`: {short(o)}'
        for k, per in (f.get('opciones_por_fila') or {}).items():
            for fk, o in per.items():
                line += f'\n  - lista `{k}` en `{fk}`: {short(o)}'
        print(line)


if __name__ == '__main__':
    main()
