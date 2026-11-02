"""Pasada completa en un comando: llenar -> recalcular -> verificar -> (inyectar).

Uso:
  python flujo.py --plantilla FORMATO.xlsx --mapa fichas/X/mapa.json --datos datos.json [--datos pasada2.json] \
                  --trabajo ./trabajo --salida ENTREGABLE.xlsx

Sin --salida solo recalcula y verifica (para leer totales y preparar la siguiente pasada).
Con --salida además inyecta los valores calculados y deja el entregable.
"""
import argparse
import os
import subprocess
import sys

try:  # consola de Windows
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


HERE = os.path.dirname(os.path.abspath(__file__))


def run(args):
    print('$', ' '.join(os.path.basename(x) if i == 1 else x for i, x in enumerate(args)))
    return subprocess.run([sys.executable] + args).returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plantilla', required=True)
    ap.add_argument('--mapa', required=True)
    ap.add_argument('--datos', action='append', required=True)
    ap.add_argument('--trabajo', default='trabajo')
    ap.add_argument('--salida')
    a = ap.parse_args()
    os.makedirs(a.trabajo, exist_ok=True)
    llena = os.path.join(a.trabajo, 'llena.xlsx')
    calc = os.path.join(a.trabajo, 'calculada.xlsx')
    cmd = [os.path.join(HERE, 'llenar.py'), '--plantilla', a.plantilla, '--mapa', a.mapa, '--salida', llena]
    for d in a.datos:
        cmd += ['--datos', d]
    if run(cmd):
        sys.exit('falló llenar')
    if run([os.path.join(HERE, 'recalcular.py'), llena, calc]):
        sys.exit('falló recalcular')
    rc = run([os.path.join(HERE, 'verificar.py'), calc, '--mapa', a.mapa,
              '--json', os.path.join(a.trabajo, 'verificacion.json')])
    if a.salida:
        run([os.path.join(HERE, 'inyectar.py'), llena, calc, a.salida])
        print('\nEntregable:', a.salida, '(verificaciones', 'OK)' if rc == 0 else 'CON FALLAS: revisar antes de entregar)')
    sys.exit(rc)


if __name__ == '__main__':
    main()
