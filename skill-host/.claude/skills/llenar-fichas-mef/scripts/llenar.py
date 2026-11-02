"""Escribe datos.json en la plantilla usando el mapa de la ficha (sin openpyxl al guardar).

Uso:
  python llenar.py --plantilla FORMATO.xlsx --mapa fichas/FTE-EBR-V03/mapa.json --datos datos.json --salida llena.xlsx
  python llenar.py --mapa fichas/FTE-EBR-V03/mapa.json --esqueleto datos_vacio.json   # plantilla de datos

datos.json:
{
  "plantilla": "FTE-EBR-V03",
  "campos": {
    "01.01.3": "MEJORAMIENTO Y AMPLIACIÓN",                       # tipo celda
    "01.03.1": {"nivel": "Gobierno Local", "entidad": "..."},      # tipo grupo
    "01.08.1": {"agua": {"red_localidad": "No", "tipo_alt": "(1) Pozo Propio "}},   # tipo filas
    "03.03.1": [{"edificacion": 1, "piso": 1, "ambiente": "Aula 1°", ...}, ...],     # tipo lista (en orden)
    "01.16.23": {"operacion_sin": [52000, 52000, ...]}               # tipo anual (periodo 1..n)
  },
  "celdas": {"FICHA!U788": -0.01}                                   # escape: hoja!celda directa
}
null = no escribir. Fechas como "AAAA-MM-DD". Porcentajes como fracción (0.07).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from comun import split_ref, write_workbook  # noqa: E402

try:  # consola de Windows
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass



def norm(x):
    return str(x).strip().lower()


def check_opt(warns, cid, key, val, opciones):
    if opciones and val not in (None, '') and isinstance(val, str):
        if norm(val) not in {norm(o) for o in opciones}:
            warns.append(f'{cid}.{key}: "{val}" no está en la lista {opciones[:8]}')


def resolve(mapa, datos):
    vals, warns = {}, []
    C = mapa['campos']
    hidden = {h: set(c) for h, c in mapa.get('columnas_ocultas', {}).items()}

    def put(hoja, ref, v, cid):
        if v is None:
            return
        if split_ref(ref)[0] in hidden.get(hoja, ()):
            warns.append(f'{cid}: {ref} está en columna oculta')
        vals.setdefault(hoja, {})[ref] = v

    for cid, v in (datos.get('campos') or {}).items():
        if cid not in C:
            warns.append(f'{cid}: identificador no existe en el mapa (ignorado)')
            continue
        m, h, t = C[cid], C[cid]['hoja'], C[cid]['tipo']
        op = m.get('opciones') or {}
        opf = m.get('opciones_por_fila') or {}
        if t == 'celda':
            check_opt(warns, cid, '', v, op if isinstance(op, list) else None)
            put(h, m['celda'], v, cid)
        elif t == 'grupo':
            for k, x in v.items():
                if k not in m['celdas']:
                    warns.append(f'{cid}.{k}: clave desconocida; válidas: {list(m["celdas"])}')
                    continue
                check_opt(warns, cid, k, x, op.get(k))
                put(h, m['celdas'][k], x, cid)
        elif t == 'filas':
            for fk, row in v.items():
                if fk not in m['filas']:
                    warns.append(f'{cid}.{fk}: fila desconocida; válidas: {list(m["filas"])}')
                    continue
                for ck, x in row.items():
                    if ck not in m['columnas']:
                        warns.append(f'{cid}.{fk}.{ck}: columna desconocida; válidas: {list(m["columnas"])}')
                        continue
                    check_opt(warns, cid, f'{fk}.{ck}', x, op.get(ck) or opf.get(ck, {}).get(fk))
                    put(h, f'{m["columnas"][ck]}{m["filas"][fk]}', x, cid)
        elif t == 'lista':
            if len(v) > m['max_filas']:
                warns.append(f'{cid}: {len(v)} filas pero la plantilla admite {m["max_filas"]}; se truncan')
            for i, row in enumerate(v[:m['max_filas']]):
                r = m['fila_inicio'] + i
                for ck, x in row.items():
                    if ck not in m['columnas']:
                        warns.append(f'{cid}[{i}].{ck}: columna desconocida; válidas: {list(m["columnas"])}')
                        continue
                    check_opt(warns, cid, f'[{i}].{ck}', x, op.get(ck))
                    put(h, f'{m["columnas"][ck]}{r}', x, cid)
        elif t == 'anual':
            cols = m['columnas_periodo']
            for fk, serie in v.items():
                if fk not in m['filas']:
                    warns.append(f'{cid}.{fk}: fila desconocida; válidas: {list(m["filas"])}')
                    continue
                if len(serie) > len(cols):
                    warns.append(f'{cid}.{fk}: {len(serie)} periodos pero hay {len(cols)} columnas; se truncan')
                for c, x in zip(cols, serie):
                    put(h, f'{c}{m["filas"][fk]}', x, cid)
    for k, x in (datos.get('celdas') or {}).items():
        hoja, ref = k.rsplit('!', 1)
        put(hoja.strip("'"), ref, x, k)
    return vals, warns


def esqueleto(mapa):
    out = {}
    for cid, m in mapa['campos'].items():
        t = m['tipo']
        if t == 'celda':
            out[cid] = None
        elif t == 'grupo':
            out[cid] = {k: None for k in m['celdas']}
        elif t == 'filas':
            out[cid] = {f: {c: None for c in m['columnas']} for f in m['filas']}
        elif t == 'lista':
            out[cid] = [{c: None for c in m['columnas']}]
        elif t == 'anual':
            out[cid] = {f: [None] * len(m['columnas_periodo']) for f in m['filas']}
    return {'plantilla': mapa['plantilla'], 'campos': out, 'celdas': {}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plantilla')
    ap.add_argument('--mapa', required=True)
    ap.add_argument('--datos', action='append', help='puede repetirse; los posteriores sobrescriben')
    ap.add_argument('--salida')
    ap.add_argument('--esqueleto')
    a = ap.parse_args()
    mapa = json.load(open(a.mapa, encoding='utf8'))
    if a.esqueleto:
        json.dump(esqueleto(mapa), open(a.esqueleto, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
        print('esqueleto escrito en', a.esqueleto)
        return
    datos = {'campos': {}, 'celdas': {}}
    for p in a.datos or []:
        d = json.load(open(p, encoding='utf8'))
        datos['campos'].update(d.get('campos') or {})
        datos['celdas'].update(d.get('celdas') or {})
    vals, warns = resolve(mapa, datos)
    write_workbook(a.plantilla, a.salida, vals)
    n = sum(len(v) for v in vals.values())
    print(f'{n} celdas escritas en {a.salida}')
    for w in warns:
        print('AVISO', w)


if __name__ == '__main__':
    main()
