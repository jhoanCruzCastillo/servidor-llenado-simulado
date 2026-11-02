"""Pruebas rápidas (sin LibreOffice): python -m unittest discover tests"""
import json
import os
import sys
import tempfile
import unittest
import warnings

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import comun  # noqa: E402
import llenar  # noqa: E402

warnings.filterwarnings('ignore')


class TestEscritura(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.src = os.path.join(self.d, 'src.xlsx')
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'FICHA'
        ws['A1'] = 'etiqueta'
        ws['B2'] = 'viejo'
        ws['C3'] = '=B2&"x"'
        wb.create_sheet('Anexo 2. Presup')
        wb.save(self.src)

    def test_escribe_conservando_y_tipos(self):
        out = os.path.join(self.d, 'out.xlsx')
        comun.write_workbook(self.src, out, {
            'FICHA': {'B2': 'Sí', 'D2': 12.5, 'B10': '2027-03-02', 'AA1': 'col lejana'},
            'Anexo 2. Presup': {'F70': 'Aula & <Primaria>'}})
        wb = openpyxl.load_workbook(out)
        ws = wb['FICHA']
        self.assertEqual(ws['A1'].value, 'etiqueta')
        self.assertEqual(ws['B2'].value, 'Sí')
        self.assertEqual(ws['D2'].value, 12.5)
        self.assertEqual(ws['C3'].value, '=B2&"x"')
        # sin estilo de fecha se lee como serial; en las plantillas la celda ya tiene formato de fecha
        self.assertEqual(ws['B10'].value, (__import__('datetime').date(2027, 3, 2) - __import__('datetime').date(1899, 12, 30)).days)
        self.assertEqual(ws['AA1'].value, 'col lejana')
        self.assertEqual(wb['Anexo 2. Presup']['F70'].value, 'Aula & <Primaria>')

    def test_full_calc(self):
        out = os.path.join(self.d, 'out.xlsx')
        comun.write_workbook(self.src, out, {'FICHA': {'B2': 1}})
        import zipfile
        self.assertIn('fullCalcOnLoad="1"', zipfile.ZipFile(out).read('xl/workbook.xml').decode())


class TestRegexInyeccion(unittest.TestCase):
    def test_v_vacio_no_come_vecinas(self):
        xml = ('<row r="70"><c r="U70" s="1" t="str"><f>IF(K70="X",T70,"")</f><v/></c>'
               '<c r="V70" s="2"><f>COUNTA(U70)</f><v>0</v></c>'
               '<c r="W70" t="str"><f>A1</f><v xml:space="preserve"> texto </v></c>'
               '<c r="X70"><f t="shared" si="3"/><v>5</v></c></row>')
        refs = [m.group(1) for m in comun.FORMULA_CELL.finditer(xml)]
        self.assertEqual(refs, ['U70', 'V70', 'W70', 'X70'])
        for m in comun.FORMULA_CELL.finditer(xml):
            self.assertEqual(m.group(0).count('<c '), 1)

    def test_cached_cell(self):
        self.assertEqual(comun.cached_cell_xml('A1', ' s="3" t="str"', '<f>B1</f>', 7),
                         '<c r="A1" s="3"><f>B1</f><v>7</v></c>')
        self.assertIn('t="str"', comun.cached_cell_xml('A1', '', '<f>B1</f>', 'OK'))


class TestMapas(unittest.TestCase):
    def mapas(self):
        base = os.path.join(ROOT, 'fichas')
        for d in sorted(os.listdir(base)):
            p = os.path.join(base, d, 'mapa.json')
            if d.startswith('_') or not os.path.exists(p):
                continue
            yield d, json.load(open(p, encoding='utf8'))

    def test_sin_celdas_duplicadas_ni_ocultas(self):
        for name, m in self.mapas():
            hidden = {h: set(c) for h, c in m.get('columnas_ocultas', {}).items()}
            seen = {}
            for cid, f in m['campos'].items():
                t, h = f['tipo'], f['hoja']
                if t == 'celda':
                    refs = [f['celda']]
                elif t == 'grupo':
                    refs = list(f['celdas'].values())
                elif t == 'filas':
                    refs = [f'{c}{r}' for r in f['filas'].values() for c in f['columnas'].values()]
                elif t == 'lista':
                    refs = [f'{c}{f["fila_inicio"] + i}' for i in range(f['max_filas']) for c in f['columnas'].values()]
                else:
                    refs = [f'{c}{r}' for r in f['filas'].values() for c in f['columnas_periodo']]
                for r in refs:
                    key = (h, r)
                    self.assertNotIn(key, seen, f'{name}: {h}!{r} en {cid} y {seen.get(key)}')
                    seen[key] = cid
                    self.assertNotIn(comun.split_ref(r)[0], hidden.get(h, ()), f'{name}: {cid} usa columna oculta {r}')

    def test_ejemplo_resuelve(self):
        m = json.load(open(os.path.join(ROOT, 'fichas', 'FTE-EBR-V03', 'mapa.json'), encoding='utf8'))
        d = json.load(open(os.path.join(ROOT, 'examples', 'fte-ebr-v03-ie16021', 'datos.json'), encoding='utf8'))
        vals, warns = llenar.resolve(m, d)
        self.assertGreater(sum(len(v) for v in vals.values()), 1500)
        self.assertEqual([w for w in warns if 'No aplica' not in w], [])

    def test_esqueleto_cubre_todo(self):
        m = json.load(open(os.path.join(ROOT, 'fichas', 'FTE-EBR-V03', 'mapa.json'), encoding='utf8'))
        self.assertEqual(set(llenar.esqueleto(m)['campos']), set(m['campos']))


if __name__ == '__main__':
    unittest.main()
