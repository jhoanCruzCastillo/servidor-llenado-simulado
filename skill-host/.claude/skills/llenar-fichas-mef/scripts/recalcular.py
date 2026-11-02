"""Recalcula todas las fórmulas con LibreOffice (headless) sobre una COPIA del archivo.

Uso: python recalcular.py llena.xlsx calculada.xlsx [--timeout 600]

El archivo calculado solo sirve para LEER resultados (LibreOffice al guardar puede alterar
listas x14 y formatos). El entregable se arma con inyectar.py sobre el archivo editado.
"""
import argparse
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:  # consola de Windows
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


MACRO = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">
<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">
Sub RecalcularYGuardar()
  ThisComponent.calculateAll()
  ThisComponent.store()
  ThisComponent.close(True)
End Sub
</script:module>"""


def find_soffice():
    for name in ('soffice', 'libreoffice'):
        p = shutil.which(name)
        if p:
            return p
    cands = []
    if platform.system() == 'Windows':
        for base in (os.environ.get('ProgramFiles', r'C:\Program Files'), os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')):
            cands.append(os.path.join(base, 'LibreOffice', 'program', 'soffice.exe'))
    elif platform.system() == 'Darwin':
        cands.append('/Applications/LibreOffice.app/Contents/MacOS/soffice')
    for c in cands:
        if os.path.exists(c):
            return c
    sys.exit('No se encontró LibreOffice (soffice). Instálalo o agrégalo al PATH.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('entrada')
    ap.add_argument('salida')
    ap.add_argument('--timeout', type=int, default=600)
    a = ap.parse_args()
    soffice = find_soffice()
    shutil.copyfile(a.entrada, a.salida)
    prof = Path(tempfile.mkdtemp(prefix='lo_prof_'))
    url = prof.as_uri()
    subprocess.run([soffice, '--headless', '--terminate_after_init', f'-env:UserInstallation={url}'],
                   capture_output=True, timeout=120)
    mdir = prof / 'user' / 'basic' / 'Standard'
    mdir.mkdir(parents=True, exist_ok=True)
    (mdir / 'Module1.xba').write_text(MACRO, encoding='utf8')
    if not (mdir / 'script.xlb').exists():
        (mdir / 'script.xlb').write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE library:library PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "library.dtd">\n'
            '<library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false">\n'
            ' <library:element library:name="Module1"/>\n</library:library>', encoding='utf8')
    before = os.stat(a.salida).st_mtime_ns
    r = subprocess.run([soffice, '--headless', '--norestore', f'-env:UserInstallation={url}',
                        'macro:///Standard.Module1.RecalcularYGuardar', os.path.abspath(a.salida)],
                       capture_output=True, text=True, timeout=a.timeout)
    shutil.rmtree(prof, ignore_errors=True)
    if os.stat(a.salida).st_mtime_ns == before:
        sys.exit('LibreOffice no guardó el archivo: NO se recalculó.\n' + (r.stderr or '')[-500:])
    print('recalculado:', a.salida)


if __name__ == '__main__':
    main()
