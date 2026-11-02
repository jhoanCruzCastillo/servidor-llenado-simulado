"""Utilidades compartidas: lectura del zip, mapa hoja->XML, validaciones y escritura de celdas
directamente en el XML (sin openpyxl al guardar, para no perder listas desplegables x14)."""
import datetime
import os
import re
import zipfile
from xml.sax.saxutils import escape

EPOCH = datetime.datetime(1899, 12, 30)


# ---------------------------------------------------------------- referencias de celda
def col2n(c):
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n


def n2col(n):
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def split_ref(ref):
    m = re.match(r'([A-Z]+)(\d+)$', ref)
    if not m:
        raise ValueError(f'Referencia inválida: {ref}')
    return m.group(1), int(m.group(2))


def expand_sqref(sqref):
    """'A1:B3 D5' -> set de celdas (acotado a rangos razonables)."""
    out = set()
    for part in sqref.split():
        if ':' in part:
            a, b = part.split(':')
            ca, ra = split_ref(a)
            cb, rb = split_ref(b)
            if (rb - ra + 1) * (col2n(cb) - col2n(ca) + 1) > 200000:
                continue
            for r in range(ra, rb + 1):
                for c in range(col2n(ca), col2n(cb) + 1):
                    out.add(f'{n2col(c)}{r}')
        else:
            out.add(part)
    return out


# ---------------------------------------------------------------- libro
def sheet_paths(xlsx_path):
    """Devuelve {nombre_hoja: 'xl/worksheets/sheetN.xml'} y {nombre: estado}."""
    z = zipfile.ZipFile(xlsx_path)
    wbx = z.read('xl/workbook.xml').decode('utf8')
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf8')
    rid2t = {}
    for m in re.finditer(r'<Relationship\b[^>]*>', rels):
        tag = m.group(0)
        i = re.search(r'Id="([^"]+)"', tag)
        t = re.search(r'Target="([^"]+)"', tag)
        if i and t:
            target = t.group(1).lstrip('/')
            rid2t[i.group(1)] = target if target.startswith('xl/') else 'xl/' + target
    paths, states = {}, {}
    for m in re.finditer(r'<sheet\b[^>]*>', wbx):
        tag = m.group(0)
        name = re.search(r'name="([^"]+)"', tag).group(1)
        name = name.replace('&amp;', '&').replace('&quot;', '"').replace('&apos;', "'")
        rid = re.search(r'r:id="([^"]+)"', tag).group(1)
        st = re.search(r'state="([^"]+)"', tag)
        paths[name] = rid2t[rid]
        states[name] = st.group(1) if st else 'visible'
    return paths, states


def ext_validations(sheet_xml):
    """Listas desplegables en extensiones x14 (openpyxl NO las lee). -> [(sqref, formula)]"""
    out = []
    for e in re.findall(r'<x14:dataValidation\b.*?</x14:dataValidation>', sheet_xml, re.S):
        f = re.findall(r'<xm:f>(.*?)</xm:f>', e, re.S)
        sq = re.findall(r'<xm:sqref>(.*?)</xm:sqref>', e, re.S)
        if f and sq:
            out.append((sq[0], f[0].replace('&amp;', '&').replace('&quot;', '"')))
    return out


def list_options(formula, wb_values=None, default_sheet=None):
    """Convierte la fórmula de una validación en lista de opciones.
    '"a,b"' -> ['a','b'] ; "'Hoja'!$B$2:$B$9" -> valores de esas celdas (si se pasa wb_values)."""
    if formula is None:
        return None
    f = formula.strip()
    if f.startswith('"') and f.endswith('"'):
        return [x for x in f[1:-1].split(',')]
    m = re.match(r"^=?(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$", f)
    if m and wb_values is not None:
        sheet, c1, r1, c2, r2 = m.groups()
        try:
            ws = wb_values[sheet or default_sheet] if (sheet or default_sheet) else None
        except KeyError:
            return None
        if ws is None:
            return None
        vals = []
        for r in range(int(r1), int(r2) + 1):
            for c in range(col2n(c1), col2n(c2) + 1):
                v = ws.cell(r, c).value
                if v not in (None, ''):
                    vals.append(v)
        return vals
    return None


# ---------------------------------------------------------------- escritura XML
def _cell_xml(ref, value, style):
    s = f' s="{style}"' if style is not None else ''
    if value is None:
        return f'<c r="{ref}"{s}/>'
    if isinstance(value, str) and re.match(r'^\d{4}-\d{2}-\d{2}$', value):
        value = datetime.date.fromisoformat(value)
    if isinstance(value, (datetime.date, datetime.datetime)):
        if not isinstance(value, datetime.datetime):
            value = datetime.datetime(value.year, value.month, value.day)
        value = (value - EPOCH).total_seconds() / 86400
        if value == int(value):
            value = int(value)
    if isinstance(value, bool):
        return f'<c r="{ref}"{s} t="b"><v>{int(value)}</v></c>'
    if isinstance(value, (int, float)):
        return f'<c r="{ref}"{s}><v>{repr(float(value)) if isinstance(value, float) else value}</v></c>'
    return f'<c r="{ref}"{s} t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'


def set_cells(xml, values):
    """values: {ref: valor}. Reemplaza/inserta celdas conservando el estilo (s=)."""
    byrow = {}
    for ref, v in values.items():
        byrow.setdefault(split_ref(ref)[1], []).append((ref, v))
    for r, items in sorted(byrow.items()):
        rx = re.compile(rf'<row r="{r}"[^>]*?(?:/>|>.*?</row>)', re.S)
        m = rx.search(xml)
        if not m:
            rows = [(int(x.group(1)), x.start()) for x in re.finditer(r'<row r="(\d+)"', xml)]
            pos = next((p for rr, p in rows if rr > r), xml.index('</sheetData>'))
            xml = xml[:pos] + f'<row r="{r}"></row>' + xml[pos:]
            m = rx.search(xml)
        row = m.group(0)
        if row.endswith('/>'):
            row = row[:-2] + '></row>'
        for ref, v in items:
            cm = re.search(rf'<c r="{ref}"(?P<a>[^>]*?)(?:/>|>.*?</c>)', row, re.S)
            if cm:
                sm = re.search(r'\bs="(\d+)"', cm.group('a'))
                row = row[:cm.start()] + _cell_xml(ref, v, sm.group(1) if sm else None) + row[cm.end():]
            else:
                cn = col2n(split_ref(ref)[0])
                cells = [(col2n(split_ref(x.group(1))[0]), x.start())
                         for x in re.finditer(r'<c r="([A-Z]+\d+)"', row)]
                pos = next((p for cc, p in cells if cc > cn), row.rindex('</row>'))
                row = row[:pos] + _cell_xml(ref, v, None) + row[pos:]
        xml = xml[:m.start()] + row + xml[m.end():]
    return xml


def write_workbook(src, out, values_by_sheet, full_calc=True):
    """values_by_sheet: {nombre_hoja: {ref: valor}}. Copia el zip y edita solo esas hojas."""
    paths, _ = sheet_paths(src)
    by_path = {}
    for sheet, vals in values_by_sheet.items():
        if sheet not in paths:
            raise KeyError(f'Hoja no encontrada: {sheet}')
        by_path.setdefault(paths[sheet], {}).update(vals)
    zin = zipfile.ZipFile(src)
    tmp = out + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in by_path:
                data = set_cells(data.decode('utf8'), by_path[item.filename]).encode('utf8')
            elif item.filename == 'xl/workbook.xml' and full_calc:
                xml = data.decode('utf8')
                if 'fullCalcOnLoad' not in xml:
                    xml = re.sub(r'<calcPr\b', '<calcPr fullCalcOnLoad="1"', xml, count=1)
                data = xml.encode('utf8')
            zout.writestr(item, data)
    os.replace(tmp, out)


# ---------------------------------------------------------------- inyección de valores en caché
FORMULA_CELL = re.compile(
    r'<c r="([A-Z]+\d+)"([^>]*?)>(<f[^>]*?/>|<f[^>]*?>[^<]*</f>)(<v[^>]*>[^<]*</v>|<v/>)?</c>')
ERRORES = ('#REF!', '#VALUE!', '#DIV/0!', '#N/A', '#NAME?', '#NUM!', '#NULL!')


def cached_cell_xml(ref, attrs, f, val):
    attrs = re.sub(r'\s+t="[^"]*"', '', attrs)
    if val is None:
        return f'<c r="{ref}"{attrs} t="str">{f}<v></v></c>'
    if isinstance(val, bool):
        return f'<c r="{ref}"{attrs} t="b">{f}<v>{int(val)}</v></c>'
    if isinstance(val, datetime.datetime):
        val = (val - EPOCH).total_seconds() / 86400
    if isinstance(val, (int, float)):
        return f'<c r="{ref}"{attrs}>{f}<v>{repr(val) if isinstance(val, float) else val}</v></c>'
    return f'<c r="{ref}"{attrs} t="str">{f}<v xml:space="preserve">{escape(str(val))}</v></c>'
