"""Regenera mapa.json de FTE-EBR-V03: estructura de campos (escrita a mano) + listas
desplegables leídas del Excel en blanco.

Uso: python _generar_mapa.py FORMATO_FTE_EBR.xlsx [mapa.json]
Luego: python ../../scripts/indice_mapa.py mapa.json > indice.md
"""
import json, sys, warnings, zipfile
import openpyxl
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
from comun import expand_sqref, ext_validations, list_options, sheet_paths
warnings.filterwarnings('ignore')
SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mapa.json')

FI, A1, A2, A3, A5 = 'FICHA', 'Anexo 1. Registro de C.U', 'Anexo 2. Presup. Infraestruct.', \
    'Anexo 3. Presup de MOB y EQUIP', 'Anexo 5. Evaluación Eco.'
YC = ['G', 'H', 'I', 'K', 'L', 'M', 'N', 'O', 'P', 'Q']            # años 1..10 (J oculta)
PC = ['E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'O', 'P', 'Q']  # periodos 1..12 (J oculta)
C = {}

def celda(i, hoja, ref, desc): C[i] = {'tipo': 'celda', 'hoja': hoja, 'celda': ref, 'desc': desc}
def grupo(i, hoja, celdas, desc): C[i] = {'tipo': 'grupo', 'hoja': hoja, 'celdas': celdas, 'desc': desc}
def filas(i, hoja, f, cols, desc): C[i] = {'tipo': 'filas', 'hoja': hoja, 'filas': f, 'columnas': cols, 'desc': desc}
def lista(i, hoja, r0, n, cols, desc): C[i] = {'tipo': 'lista', 'hoja': hoja, 'fila_inicio': r0, 'max_filas': n, 'columnas': cols, 'desc': desc}
def anual(i, hoja, f, cols, desc): C[i] = {'tipo': 'anual', 'hoja': hoja, 'filas': f, 'columnas_periodo': cols, 'desc': desc}

# ======================= FICHA — Sección I
celda('01.01.2', FI, 'L16', 'Código CUI (lo asigna el aplicativo; normalmente vacío)')
celda('01.01.3', FI, 'L18', 'Naturaleza de intervención (alimenta el nombre del PI)')
grupo('01.01.4', FI, {'si': 'L20', 'no': 'N20'}, '¿Pertenece a un programa de inversión? marcar X')
celda('01.01.6', FI, 'L23', 'Código del programa de inversión')
celda('01.02.3', FI, 'G31', 'Grupo funcional (lista)')
for i, r, n in [('01.03.1', 39, 'OPMI'), ('01.03.2', 47, 'UF'), ('01.03.3', 55, 'UEI')]:
    grupo(i, FI, {'nivel': f'I{r}', 'entidad': f'I{r+1}', 'nombre': f'I{r+2}', 'responsable': f'I{r+3}'}, f'Institucionalidad {n}')
celda('01.03.4', FI, 'I63', 'Nombre de la UEP')
grupo('01.04.1', FI, {'inicial': 'K70', 'primaria': 'K71', 'secundaria': 'K72', 'eba': 'K73'}, 'Servicios intervenidos (X)')
celda('01.04.2', FI, 'P70', 'Brecha de calidad (X)')
celda('01.04.3', FI, 'P72', 'Brecha de cobertura (X)')
filas('01.04.4', FI, {'inicial': 80, 'primaria': 81, 'secundaria': 82, 'eba': 83},
      {'espacio': 'I', 'anio': 'L', 'valor': 'M', 'contribucion': 'O'},
      'Indicadores de calidad por servicio (valor en formato %, contribución en N° IE = ítem 4.3)')
filas('01.04.6', FI, {'inicial': 88, 'primaria': 89, 'secundaria': 90, 'eba': 91},
      {'espacio': 'I', 'anio': 'L', 'valor': 'M', 'contribucion': 'O'},
      'Indicadores de cobertura por servicio (contribución en persona/año = ítem 4.3)')
# ======================= Sección II
celda('01.05.4', FI, 'H100', 'Código de local ESCALE (número). Llena ubicación, IE y modulares desde Padron_web')
filas('01.05.5', FI, {'ie1': 106, 'ie2': 107, 'ie3': 108}, {'interviene': 'L'}, '¿Se interviene la IE? (nombre y zona son fórmulas)')
filas('01.05.6', FI, {str(i): 117 + i for i in range(1, 9)}, {'altitud': 'K', 'interviene': 'L'},
      'Áreas productivas: altitud y ¿se interviene? (modular, nivel, lat/long son fórmulas del padrón)')
grupo('01.05.7', FI, {'ampliacion': 'G131', 'recuperacion': 'G132', 'mejoramiento': 'G133', 'mejoramiento_y_ampliacion': 'G134'},
      'C1.3 Naturaleza de intervención en el servicio: una X, el resto "-"')
filas('01.06.1', FI, {'1': 144, '2': 145, '3': 146, '4': 147, '5': 148}, {'localidad': 'N'},
      'Localización del área de influencia: localidad (dpto/prov/distrito son fórmulas en 1-3)')
celda('01.06.2', FI, 'D152', 'Descripción del área de estudio / influencia')
celda('01.07.1', FI, 'F161', 'Población afectada')
filas('01.08.1', FI, {'agua': 178, 'desague': 179, 'electricidad': 180, 'alumbrado': 181, 'telefonia': 182,
                      'internet': 183, 'residuos': 184, 'gas': 185},
      {'red_localidad': 'E', 'ie01': 'G', 'ie02': 'H', 'ie03': 'I', 'provision_alt': 'K', 'tipo_alt': 'M', 'comentario': 'O'},
      'Servicios básicos. tipo_alt debe copiarse EXACTO de la lista (ej. "(1) Pozo Propio " con espacio final)')
T = {'t01': 203, 't02': 204, 't03': 205}
filas('01.08.3', FI, T, {'adjunta': 'F'}, '¿Se adjunta estudio topográfico? por terreno')
filas('01.08.7', FI, T, {'area': 'L', 'area_util': 'N', 'perimetro': 'P'}, 'Medidas del terreno (m2, m2, m)')
filas('01.08.4', FI, {'t01': 209, 't02': 210, 't03': 211}, {'limites': 'F'}, '¿Límites definidos?')
filas('01.08.8', FI, {'t01': 212, 't02': 213, 't03': 214}, {'x': 'L', 'y': 'O'}, 'Coordenadas UTM')
filas('01.08.5', FI, {'t01': 216, 't02': 217, 't03': 218}, {'cerco': 'F'}, 'Cerco perimétrico (lista)')
filas('01.08.6', FI, {'t01': 222, 't02': 223, 't03': 224}, {'forma': 'F'}, 'Forma del terreno (lista)')
filas('01.08.9', FI, {'llano': 219, 'inclinado': 220, 'muy_inclinado': 221, 'accidentado': 222},
      {'t01': 'M', 't02': 'O', 't03': 'Q'}, 'Topografía: X en el tipo, "-" en los demás')
filas('01.08.10', FI, {'t01': 231, 't02': 232, 't03': 233}, {'adjunta': 'F'}, '¿Informe de suelos? (lista SI/NO en mayúsculas)')
filas('01.08.11', FI, {'t01': 237, 't02': 238, 't03': 239}, {'kg_cm2': 'F'}, 'Capacidad portante')
filas('01.08.12', FI, {'t01': 243, 't02': 244, 't03': 245}, {'m': 'F'}, 'Nivel freático')
filas('01.08.13', FI, {'grava': 232, 'arena': 233, 'limos_baja': 234, 'limos_alta': 235, 'organicos': 236},
      {'t01': 'L', 't02': 'N', 't03': 'P'}, 'Tipo de suelo: X / -')
grupo('01.08.14', FI, {'profesional': 'H241', 'cip': 'P241'}, 'Responsable del estudio de suelos')
celda('01.08.15', FI, 'F251', 'Arquitectura existente')
grupo('01.08.16', FI, {'estructuras': 'F275', 'electricas': 'F276', 'sanitarias': 'F277'}, 'Estructuras / IIEE / IISS')
filas('01.08.17', FI, {'ini_aula': 285, 'ini_psicomotricidad': 286, 'ini_sum': 287,
                       'pri_aula': 289, 'pri_aip': 290, 'pri_lab': 291, 'pri_biblioteca': 292, 'pri_auditorio': 293, 'pri_sum': 294,
                       'sec_aula': 296, 'sec_aip': 297, 'sec_lab': 298, 'sec_biblioteca': 299, 'sec_auditorio': 300, 'sec_sum': 301,
                       'administracion': 303, 'cocina': 304, 'servicios_generales': 305, 'deposito': 306, 'residencia': 307, 'sshh': 308},
      {'total': 'G', 'no_interv': 'I', 'construccion': 'K', 'reforzamiento': 'L', 'remodelacion': 'M', 'reparacion': 'N', 'demoler': 'O', 'comentario': 'P'},
      'Activos existentes en edificaciones (llenar 0 en filas sin activos)')
filas('01.08.18', FI, {'cercos': 321, 'muro': 322, 'deportivo_sin_cob': 323, 'deportivo_con_cob': 324, 'inst_exteriores': 325, 'espacios_exteriores': 326},
      {'cuenta': 'G', 'requiere': 'I', 'construccion': 'K', 'reforzamiento': 'L', 'remodelacion': 'M', 'reparacion': 'N', 'demolicion': 'O', 'comentario': 'P'},
      'Activos de obras exteriores (Sí/No y X/-)')
grupo('01.08.19', FI, {'mobiliario': 'F331', 'equipo': 'F332'}, 'Estado de mobiliario y equipo (01.08.19 y 01.08.20)')
filas('01.08.21', FI, {'sismos': 339, 'tsunamis': 340, 'heladas': 341, 'friajes': 342, 'erupciones': 343, 'sequias': 344,
                       'granizadas': 345, 'lluvias': 346, 'avalanchas': 347, 'huaycos': 348, 'deslizamientos': 349, 'erosion': 350,
                       'inundaciones': 351, 'vientos': 352, 'incendios_urbanos': 353, 'incendios_forestales': 354, 'radiacion': 355,
                       'contaminacion': 357},
      {'existe': 'E', 'nivel': 'F', 'antecedentes': 'G', 'especificar': 'H', 'afectado': 'K', 'mitigable': 'L'},
      'Peligros. nivel ∈ Bajo/Medio/Alto/Muy Alto (no existe "Medio-Alto")')
filas('01.08.22', FI, {'aulas': 339, 'computadoras': 340, 'administrativo': 341, 'otros_ambientes': 342, 'redes_exteriores': 343,
                       'cerco': 344, 'mobiliarios': 345, 'equipamientos': 346}, {'afectada': 'Q'}, 'Zonas afectadas (Sí/No)')
grupo('01.08.23', FI, {'fen': 'Q349', 'peligro_mayor': 'Q351', 'anio': 'Q354'}, 'FEN (01.08.23), peligro mayor (01.08.24), año (01.08.25)')
celda('01.09.1', FI, 'H364', '¿Se adjunta informe técnico de saneamiento?')
P = {'p01': 0, 'p02': 1, 'p03': 2, 'p04': 3}
filas('01.09.2', FI, {k: 372 + v for k, v in P.items()},
      {'adjunta_partida': 'F', 'partida': 'H', 'oficina': 'K', 'area': 'M', 'comentario': 'O'}, 'Información registral por predio')
filas('01.09.3', FI, {k: 380 + v for k, v in P.items()},
      {'area_levantamiento': 'F', 'compatibles': 'M', 'rectificar': 'O', 'comentario': 'Q'}, 'Levantamiento topográfico vs registral')
filas('01.09.4', FI, {k: 387 + v for k, v in P.items()},
      {'margesi': 'F', 'codigo': 'H', 'busqueda_catastral': 'K', 'comentario': 'M'}, 'Información complementaria (Margesí)')
filas('01.09.5', FI, {k: 401 + v for k, v in P.items()},
      {'minedu_titular': 'E', 'entidad_titular': 'F', 'derecho_inscrito': 'G', 'tipo_derecho': 'H', 'saneado_minedu': 'I',
       'sustentar_arreglos': 'K', 'comentario': 'L'}, 'A1 Titularidad')
filas('01.09.6', FI, {k: 410 + v for k, v in P.items()},
      {'problema_titularidad': 'E', 'subsanable_tit': 'F', 'accion_tit': 'G', 'problema_areas': 'H', 'subsanable_area': 'I',
       'accion_area': 'K', 'sustenta_area_tecnica': 'L', 'area_tecnica': 'M', 'acta_compromiso': 'N', 'area_acta': 'O',
       'saneamiento_completo': 'P', 'comentario': 'Q'}, 'A2 Acciones complementarias')
grupo('01.09.7', FI, {'arreglos': 'D421', 'comentario_arreglos': 'F421', 'disponibilidad': 'D428', 'documento_disponibilidad': 'F428'},
      '9.2.2 y 9.2.3 (01.09.7 a 01.09.10)')
grupo('01.09.11', FI, {'saneamiento': 'G433', 'arreglos': 'G434', 'disponibilidad': 'G435'}, 'Verificación 9.2.4')
lista('01.10.1', FI, 442, 5, {'actor': 'D', 'ambito': 'F', 'entidad': 'G', 'posicion': 'I', 'intereses': 'L', 'contribucion': 'N'},
      'Matriz de involucrados (máx. 5 filas)')
grupo('01.11.2', FI, {'causa_infra': 'G457', 'causa_mobiliario': 'G458', 'causa_equipo': 'G459',
                      'efecto_riesgo': 'O457', 'efecto_bajo_nivel': 'O458', 'efecto_baja_cobertura': 'O459'}, 'Causas y efectos (X)')
grupo('01.12.2', FI, {'medio_infra': 'G473', 'medio_mobiliario': 'G474', 'medio_equipo': 'G475',
                      'fin_seguridad': 'O473', 'fin_nivel': 'O474', 'fin_cobertura': 'O475'}, 'Medios y fines (X)')
celda('01.12.4', FI, 'F479', 'Alternativa 2 (texto). La alternativa 1 es fórmula')
grupo('01.13.1', FI, {'contratacion_et': 'L489', 'elaboracion_et': 'L490', 'revision_aprobacion_et': 'L491', 'otro_a': 'L492'},
      'Horizonte (a) en meses')
grupo('01.13.4', FI, {'contratacion_ejecucion': 'L496', 'ejecucion': 'L497', 'recepcion_liquidacion': 'L498', 'otro_b': 'L499'},
      'Horizonte (b) en meses')
grupo('01.14.1', FI, {'fuentes': 'F510', 'parametros': 'F513', 'vive_area_influencia': 'F516', 'mismas_caracteristicas': 'F517',
                      'oferta_publica_privada': 'F518', 'otros_supuestos': 'F519', 'otros_texto': 'F520'},
      'Parámetros y supuestos (01.14.1 a 01.14.7; supuestos con X)')
anual('01.14.8', FI, {'0_1_oferta': 528, '0_1_demanda': 529, '1_2_oferta': 531, '1_2_demanda': 532, '2_3_oferta': 534, '2_3_demanda': 535,
                      '3_oferta': 538, '3_demanda': 539, '4_oferta': 541, '4_demanda': 542, '5_oferta': 544, '5_demanda': 545},
      YC, 'Balance O/D Inicial por edad, años 1-10 (si no hay Inicial: todo 0)')
anual('01.14.10', FI, {f'g{g}_{t}': 554 + 3 * (g - 1) + (0 if t == 'oferta' else 1) for g in range(1, 7) for t in ('oferta', 'demanda')},
      YC, 'Balance O/D Primaria por grado, años 1-10. Oferta = oferta optimizada (0 si todo se demuele)')
anual('01.14.11', FI, {f'g{g}_{t}': 579 + 3 * (g - 1) + (0 if t == 'oferta' else 1) for g in range(1, 6) for t in ('oferta', 'demanda')},
      YC, 'Balance O/D Secundaria por grado, años 1-10')
filas('01.14.12', FI, {'inicial_c1': 602, 'inicial_c2': 603, 'primaria': 604, 'secundaria': 605, 'eba': 606},
      {'unidad': 'H', 'ultimo_anio': 'K', 'sumatoria': 'N'}, 'Beneficiarios: unidad ("Estudiantes"); K y N solo para EBA')
filas('01.14.16', FI, {'inicial_c1': 614, 'inicial_c2': 615, 'primaria': 616, 'secundaria': 617, 'eba': 618},
      {'actual': 'F', 'aulas_optimizadas': 'H', 'max_optimizada': 'I', 'aulas_proyecto': 'L', 'max_proyecto': 'M'},
      'Capacidad de producción. aulas_optimizadas = aulas existentes que NO se demuelen')
EI, EP, ES = ['E', 'G', 'I', 'L', 'N', 'P'], ['E', 'G', 'I', 'L', 'N', 'P'], ['E', 'G', 'I', 'L', 'N']
anual('01.15.1', FI, {'oferta_aulas': 633, 'max_por_aula': 635, 'secciones_manana': 637}, EI,
      '15.1 Inicial por edad (0-1,1-2,2-3,3,4,5). Sin servicio: secciones 0 (con 1 genera aulas fantasma)')
anual('01.15.2', FI, {'oferta_aulas': 647, 'max_por_aula': 649, 'secciones_manana': 651}, EP, '15.1 Primaria por grado 1-6')
anual('01.15.3', FI, {'oferta_aulas': 661, 'max_por_aula': 663, 'secciones_manana': 665}, ES, '15.1 Secundaria por grado 1-5')
celda('01.15.4', FI, 'E670', 'Demanda de aulas funcionales JEC (opcional)')
lista('01.15.5', FI, 678, 58, {'et_inicio': 'P', 'et_fin': 'Q', 'ejec_inicio': 'R', 'ejec_fin': 'S'},
      'Fechas de cada fila de metas 15.2 (las filas se generan desde los anexos; una entrada por fila con activo, en el mismo orden)')
filas('01.15.6', FI, {'otras_infra': 740, 'otras_mobiliario': 741, 'otras_equipo': 742},
      {'et_inicio': 'P', 'et_fin': 'Q', 'ejec_inicio': 'R', 'ejec_fin': 'S'}, 'Fechas de acciones que no generan AE')
celda('01.15.11', FI, 'C749', 'Comentarios sobre metas, costos y plazos')
grupo('01.16.7', FI, {'gestion': 'K801', 'expediente': 'K802', 'supervision': 'K803', 'liquidacion': 'K804'}, 'Otros costos de inversión (S/)')
celda('01.16.9', FI, 'K812', 'Costo de control concurrente')
grupo('01.16.10', FI, {'obras': 'U765', 'contingencia': 'U775', 'mobiliario_equipo': 'U788'},
      'Corrección por redondeo del IGV: ingresar la diferencia cuando U766/U776/U789 marcan "X" (ej. -0.01)')
grupo('01.16.11', FI, {'fecha_inicio': 'H822', 'tipo_periodo': 'H823', 'numero_periodos': 'H824'},
      'Cronograma: fecha inicio (01.16.11), meses|trimestres (01.16.12), N° periodos (01.16.13). Máx. 12 columnas')
anual('01.16.14', FI, {'obras_civiles': 830, 'contingencia': 831, 'mobiliario': 833, 'equipo': 834, 'intangibles': 835,
                       'gestion': 838, 'expediente': 839, 'supervision': 840, 'liquidacion': 841}, PC,
      'Cronograma financiero por periodo. Cada fila debe sumar su total (ver verificaciones U829-U843)')
grupo('01.16.16', FI, {'aporte_si': 'F855', 'aporte_no': 'F857', 'aporte_monto': 'M855', 'recursos_publicos': 'M857'},
      'Aporte de beneficiarios (01.16.16-01.16.19). recursos_publicos = costo total de inversión viable')
grupo('01.16.21', FI, {'inicio_om': 'I872', 'horizonte': 'I873'}, 'Inicio de operación (fecha día 1 del mes) y horizonte')
anual('01.16.23', FI, {'operacion_sin': 878, 'mantenimiento_sin': 879, 'operacion_con': 881, 'mantenimiento_con': 882}, YC,
      'O&M a precios de mercado, años 1-10')
celda('01.17.1', FI, 'C893', 'Beneficios sociales')
celda('01.17.2', FI, 'I902', 'Costo de inversión de la Alternativa 2 a precios de mercado')
celda('01.18.1', FI, 'C921', 'Análisis de sostenibilidad')
filas('01.18.2', FI, {'sismos': 931, 'tsunamis': 932, 'heladas': 933, 'friajes': 934, 'erupciones': 935, 'sequias': 936, 'granizadas': 937,
                      'lluvias': 938, 'avalanchas': 939, 'huaycos': 940, 'deslizamientos': 941, 'erosion': 942, 'inundaciones': 943,
                      'vientos': 944, 'incendios_urbanos': 945, 'incendios_forestales': 946, 'radiacion': 947},
      {'afecta': 'E', 'peligro': 'F', 'vulnerabilidad': 'G', 'riesgo': 'H', 'medidas': 'K', 'en_presupuesto': 'P'},
      'Medidas de reducción de riesgos')
celda('01.18.4', FI, 'M957', 'UEP que asume la O&M')
celda('01.18.5', FI, 'M959', 'Organización privada que asume la O&M')
filas('01.18.6', FI, {'organo_tecnico': 964, 'disponibilidad_recursos': 965, 'arreglos_funcionamiento': 966},
      {'entidad': 'G', 'compromiso': 'L'}, 'Documentos que sustentan la O&M')
filas('01.19.1', FI, {'adm_directa': 974, 'contrata': 975, 'obras_por_impuestos': 976, 'concurso_oferta': 977, 'convenio': 978, 'estado_a_estado': 979},
      {'expediente': 'K', 'obra': 'M'}, 'Modalidad de ejecución (X)')
grupo('01.20.1', FI, {'ordinarios': 'K984', 'directamente_recaudados': 'K985', 'credito': 'K986', 'donaciones': 'K987', 'determinados': 'K988'},
      'Fuente de financiamiento (X)')
grupo('01.21.1', FI, {'adm_directa': 'K995', 'adm_indirecta': 'K996'}, 'Modalidad de elaboración de la FTE (X)')
lista('01.21.2', FI, 1001, 5, {'nombre': 'C', 'dni': 'G', 'especialidad': 'K', 'colegiatura': 'N'},
      'Equipo formulador (especialidad ya trae Arquitecto/Economista/Ing. Civil en filas 1-3)')
lista('01.21.3', FI, 1011, 1, {'razon_social': 'C', 'ruc': 'G', 'contrato': 'K', 'fecha': 'N'}, 'Consultor contratado (solo adm. indirecta)')
grupo('01.23.1', FI, {'viable': 'F1022', 'no_viable': 'F1024', 'argumentos': 'C1028', 'lecciones': 'C1034', 'recomendaciones': 'C1040'},
      'Conclusiones (01.23.1 a 01.23.5)')
grupo('01.24.1', FI, {'ficha_firmada': 'L1049', 'anexo01': 'L1050', 'anexo02': 'L1051', 'anexo03': 'L1052', 'anexo04': 'L1053',
                      'anexo05': 'L1054', 'formato07a': 'L1055', 'diagnostico': 'L1058', 'oferta_demanda': 'L1059',
                      'propuesta_tecnica': 'L1060', 'propuesta_costos': 'L1061', 'evaluacion': 'L1062'}, 'Anexos que se adjuntan (X)')
# ======================= Anexo 01
grupo('02.01.1', A1, {'fuente': 'B13', 'gg': 'I15', 'utilidad': 'I17', 'fecha': 'B19', 'igv': 'I19', 'justificacion': 'I25'},
      'Fuente, % GG, % utilidad, fecha, % IGV (fracciones: 0.10) y justificación (I25 combinada para todas las filas)')
AE = {}
wbv = openpyxl.load_workbook(SRC, data_only=True)
for r in range(25, 47):
    AE[wbv[A1].cell(r, 2).value] = r
filas('02.01.6', A1, AE, {'cu_uf': 'F'}, 'CU total estimado por la UF (incluye CD+GG+U+IGV). La clave es el nombre exacto del activo')
# ======================= Anexo 02
celda('03.01.3', A2, 'O19', 'N° de edificaciones')
lista('03.01.4', A2, 23, 20, {'pisos': 'M', 'niveles': 'N', 'nombre': 'O'}, 'Detalle de edificaciones (N° 1..n es fórmula)')
lista('03.03.1', A2, 70, 503, {'edificacion': 'C', 'piso': 'D', 'naturaleza': 'E', 'ambiente': 'F', 'metrado': 'H',
                               'activo': 'J', 'nivel': 'L'},
      'PASO 3 ambientes. edificacion y piso numéricos (el formato muestra E-01 / 1P). activo = nombre exacto de Anexo 1 B25:B46')
celda('03.03.2', A2, 'E588', 'PASO 4: justificación de variación de aulas')
filas('03.03.3', A2, {'cercos': 599, 'muro': 600, 'deportivo_sin_cob': 601, 'deportivo_con_cob': 602, 'espacios_exteriores': 603,
                      'inst_exteriores': 604}, {'piso': 'D', 'naturaleza': 'E', 'nombre': 'F', 'nivel': 'L'},
      'PASO 5 parte A (resumen de obras exteriores)')
lista('03.03.4', A2, 610, 66, {'naturaleza': 'B', 'nombre': 'D', 'metrado': 'H', 'unidad': 'I', 'activo': 'J', 'nivel': 'L', 'cu_directo': 'M'},
      'PASO 5 parte B: detalle de obras exteriores (CU directo sin GG/U/IGV)')
lista('03.03.5', A2, 681, 19, {'naturaleza': 'B', 'actividad': 'D', 'metrado': 'H', 'unidad': 'I', 'tipo': 'J', 'nivel': 'L', 'cu_directo': 'M'},
      'PASO 6 provisionales/preliminares/SSO. %EDIF y %CT: metrado como fracción (0.04) y SIN cu_directo. tipo="otros"')
lista('03.03.6', A2, 706, 8, {'actividad': 'D', 'cantidad': 'H', 'unidad': 'I', 'metrado': 'J', 'um': 'K', 'nivel': 'L', 'cu_directo': 'M'},
      'PASO 7 contingencia (CD parcial = metrado × cu_directo)')
grupo('03.03.8', A2, {'gg_obras': 'J728', 'gg_contingencia': 'K728', 'gg_mobiliario_equipo': 'M728',
                      'utilidad_obras': 'J730', 'utilidad_contingencia': 'K730', 'utilidad_mobiliario_equipo': 'M730'},
      'PASO 8: GG como MONTO (S/) y utilidad como fracción (0.07). Los GG dependen del CD calculado: segunda pasada')
lista('03.03.18', A2, 786, 3, {'descripcion': 'E', 'monto': 'H'}, 'Otros factores productivos')
# ======================= Anexo 03
celda('04.03.1', A3, 'F78', '% transporte y embalaje (fracción, 0.08)')
filas('04.02.1', A3, {'inicial': 40, 'primaria': 41, 'secundaria': 42, 'psicomotricidad': 43, 'aip': 44, 'laboratorio': 45,
                      'taller_creativo': 46, 'taller_arte': 47, 'taller_ept': 48, 'cocina': 49, 'topico': 50, 'deportivos': 51,
                      'otros_espacios': 52}, {'kits': 'I'}, 'N° de kits de mobiliario (solo tienen costo los bienes con AE=No)')
filas('04.02.2', A3, {'inicial': 59, 'primaria': 60, 'secundaria': 61, 'psicomotricidad': 62, 'aip': 63, 'laboratorio': 64,
                      'taller_creativo': 65, 'taller_arte': 66, 'taller_ept': 67, 'cocina': 68, 'topico': 69, 'deportivos': 70,
                      'otros_espacios': 71}, {'kits': 'I'}, 'N° de kits de equipo')
lista('04.03.3', A3, 86, 1250, {'ambiente': 'B', 'bien': 'D', 'es_ae': 'E', 'tipo': 'F', 'n_ambientes': 'G', 'cantidad': 'I', 'pu': 'K'},
      'Detalle de bienes. ambiente ∈ Data!Z26:Z39 (no hay Biblioteca: usar "Otros Espacios"). es_ae "Si"/"No" SIN tilde. tipo M/E. pu con IGV sin flete')
# ======================= Anexo 05
grupo('06.01', A5, {'tsd': 'F7', 'factor_inversion': 'D8', 'factor_om': 'D9', 'residual_pct': 'F8'},
      'Alternativa 1: TSD, factores, valor residual como FRACCIÓN de la inversión (valor/inversión)')
grupo('06.02', A5, {'tsd': 'M7', 'factor_inversion': 'K8', 'factor_om': 'K9', 'residual_pct': 'M8', 'om_sin_proyecto': 'J18', 'om_con_proyecto': 'L18'},
      'Alternativa 2: la inversión viene de FICHA I902; O&M anual constante (años 2-10 son fórmulas)')

# ---- opciones de listas (normal + x14)
paths, _ = sheet_paths(SRC)
z = zipfile.ZipFile(SRC)
wb = openpyxl.load_workbook(SRC)
dv = {}
for h in {v['hoja'] for v in C.values()}:
    d = {}
    for v in wb[h].data_validations.dataValidation:
        if v.type == 'list':
            for ref in expand_sqref(str(v.sqref)): d[ref] = v.formula1
    for sq, f in ext_validations(z.read(paths[h]).decode('utf8')):
        for ref in expand_sqref(sq): d[ref] = f
    dv[h] = d
def opts(h, ref):
    f = dv[h].get(ref)
    o = list_options(f, wbv, h) if f else None
    return [str(x) for x in o] if o else None
for k, v in C.items():
    h = v['hoja']
    if v['tipo'] == 'celda':
        o = opts(h, v['celda']);  v.update({'opciones': o} if o else {})
    elif v['tipo'] == 'grupo':
        oo = {kk: opts(h, ref) for kk, ref in v['celdas'].items()}
        oo = {kk: o for kk, o in oo.items() if o}
        if oo: v['opciones'] = oo
    elif v['tipo'] in ('filas', 'lista'):
        oo, por_fila = {}, {}
        for col, L in v['columnas'].items():
            if v['tipo'] == 'lista':
                o = opts(h, f"{L}{v['fila_inicio']}")
                if o: oo[col] = o
                continue
            per = {key: opts(h, f'{L}{rr}') for key, rr in v['filas'].items()}
            per = {key: o for key, o in per.items() if o}
            if not per: continue
            uniq = {json.dumps(o) for o in per.values()}
            if len(uniq) == 1: oo[col] = next(iter(per.values()))
            else: por_fila[col] = per
        if oo: v['opciones'] = oo
        if por_fila: v['opciones_por_fila'] = por_fila

mapa = {
    'plantilla': 'FTE-EBR-V03',
    'nombre': 'FTE para el mejoramiento, ampliación y/o recuperación de los servicios de Educación Inicial, Primaria y Secundaria (MINEDU, v03)',
    'hojas_ocultas_relevantes': {'Padron_web': 'padrón de locales (lookups desde FICHA!H100)', 'Data': 'listas', 'Formato 7A': 'formato de registro'},
    'columnas_ocultas': {'FICHA': ['B', 'J']},
    'campos': C,
    'verificaciones': [
        {'hoja': FI, 'celda': f'U{r}', 'esperado': 'OK', 'desc': d} for r, d in
        [(766, 'Obras civiles: K766 = T766'), (776, 'Contingencia'), (789, 'Mobiliario y equipo'), (797, 'Metas físicas'),
         (829, 'Cronograma infraestructura'), (830, 'Cronograma obras civiles'), (831, 'Cronograma contingencia'),
         (833, 'Cronograma mobiliario'), (834, 'Cronograma equipo'), (835, 'Cronograma intangibles'),
         (838, 'Cronograma gestión'), (839, 'Cronograma expediente'), (840, 'Cronograma supervisión'), (841, 'Cronograma liquidación'),
         (842, 'Cronograma otros costos'), (843, 'Costo de inversión viable'), (844, 'Control concurrente'),
         (864, 'Cronograma físico infraestructura'), (865, 'Cronograma físico equipo'), (866, 'Cronograma físico mobiliario'),
         (867, 'Cronograma físico intangibles')]
    ] + [
        {'hoja': A2, 'celda': 'R745', 'esperado': 'ok', 'desc': 'CD Anexo 02 = FICHA K761'},
        {'hoja': A2, 'celda': 'R746', 'esperado': 'OK', 'desc': 'GG de infraestructura'},
        {'hoja': A2, 'celda': 'R777', 'esperado': 'OK', 'desc': 'GG de mobiliario'},
        {'hoja': A2, 'celda': 'H796', 'esperado_empieza': 'OK', 'desc': 'PASO 10 verificación final'},
        {'hoja': A2, 'celda': 'N581', 'esperado': 'ok', 'desc': 'PASO 4 aulas Inicial', 'si_vacio_ok': True},
        {'hoja': A2, 'celda': 'N582', 'esperado': 'ok', 'desc': 'PASO 4 aulas Primaria', 'si_vacio_ok': True},
        {'hoja': A2, 'celda': 'N583', 'esperado': 'ok', 'desc': 'PASO 4 aulas Secundaria', 'si_vacio_ok': True},
        {'hoja': 'Anexo 4. RESUMEN DE PRESUPUESTO', 'celda': 'F36', 'esperado': 'Validación = OK', 'desc': 'Anexo 04 edificaciones'},
        {'hoja': 'Anexo 4. RESUMEN DE PRESUPUESTO', 'celda': 'G36', 'esperado': 'Validación = OK', 'desc': 'Anexo 04 metrados'},
    ],
    'totales_a_leer': {
        'cd_infraestructura': [A2, 'J745'], 'cd_contingencia': [A2, 'J760'], 'cd_mobiliario_equipo': [A2, 'J776'],
        'total_obras_civiles': [FI, 'T830'], 'total_contingencia': [FI, 'T831'], 'total_mobiliario': [FI, 'T833'],
        'total_equipo': [FI, 'T834'], 'diferencia_redondeo_obras': [FI, 'U767'], 'diferencia_redondeo_mobeq': [FI, 'U790'],
        'costo_inversion_viable': [FI, 'K807'], 'costo_total': [FI, 'K815'], 'vac_alt1': [A5, 'D63'], 'vac_alt2': [A5, 'K63'],
        'nombre_pi': [FI, 'C13'],
    },
    'errores_heredados': ['FICHA!J106', 'FICHA!J107', 'FICHA!J108', 'FICHA!AR740', 'FICHA!AR741', 'FICHA!AR742',
                          'FICHA!Z702', 'FICHA!Z703', 'Anexo 4. RESUMEN DE PRESUPUESTO!B33'],
}
C['03.03.1'].get('opciones',{}).pop('edificacion',None)
json.dump(mapa, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(len(C), 'campos')
