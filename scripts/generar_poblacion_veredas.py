"""Estima la población rural dispersa de cada vereda de un municipio y la guarda como GeoJSON liviano:

    public/data/mapa/poblacion/veredas-<codigo_dane>.geojson

Es una ESTIMACIÓN, no un dato oficial. Método:
  1. Reparto dasimétrico: las personas de cada sección rural del Censo 2018 (DANE, MGN integrado, STP27_PERS) se
     reparten entre las veredas que la cruzan según las viviendas que hay en cada trozo, medidas con las huellas de
     edificios (30–250 m², fuera de zonas urbanas). En Girardota esto explica ~80 % de la variación de personas entre
     secciones; repartir por área solo explica ~12 %. Si una sección no tiene edificios se reparte por área.
  2. Calibración: el total de cada año se fija en la población rural dispersa oficial: la proyección DANE de
     «centros poblados y rural disperso» del municipio × la proporción de rural disperso del Censo 2018
     (clase 3 / clases 2+3). Así las veredas suman exactamente el control y no se mezcla crecimiento urbano.
  3. Viviendas: las del Censo 2018 (STVIVIENDA) se reparten con el mismo método y se calibran al total rural
     disperso del municipio (`viv2018`); además se cuentan las edificaciones residenciales actuales de cada vereda
     (`edif`, huellas de 30–250 m²) y todas las huellas (`edif_total`, incluye bodegas y otros usos).
  Solo cubre población rural dispersa; la cabecera y los centros poblados no hacen parte del resultado.

Requiere:  pip install pyshp shapely pyproj openpyxl numpy
Entradas:  insumos/geografia/dane_cnpv2018/{veredas,seccion_rural,clase,zona_urbana}  (descomprimidos)
           insumos/poblacion/anex-DCD-Proypoblacion-PerteneniaEtnicoRacialmun.xlsx
           public/data/mapa3d/edificios-<id>.json  (ver generar_vias_edificios.py)
Uso:       python scripts/generar_poblacion_veredas.py [codigo_dane] [id_municipio]   (por defecto 05308 y 49 = Girardota)

Datos © DANE (CNPV 2018, MGN 2018, veredas 2020, proyecciones) y Overture Maps Foundation (ODbL / CDLA-Permissive-2.0).
"""
import json, sys
from pathlib import Path

import openpyxl
import shapefile
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import Polygon, shape
from shapely.ops import transform, unary_union

RAIZ = Path(__file__).resolve().parent.parent
DANE = sys.argv[1] if len(sys.argv) > 1 else '05308'
MUNICIPIO = int(sys.argv[2]) if len(sys.argv) > 2 else 49
BASE = RAIZ / 'insumos/geografia/dane_cnpv2018'
ANIOS = [2018, 2025, 2030, 2035]
AREA_MIN, AREA_MAX = 30, 250   # m², huellas que se cuentan como vivienda (descarta casetas y bodegas)
DECIMALES = 5                  # ≈ 1 m
TOLERANCIA = 0.00005           # ≈ 5 m, simplificación de los límites

a_m = Transformer.from_crs(4326, 9377, always_xy=True).transform   # MAGNA-SIRGAS Origen Nacional, metros


def leer(ruta, filtro):
    r = shapefile.Reader(str(ruta), encoding='utf-8')
    campos = [c[0] for c in r.fields[1:]]
    for sr in r.iterShapeRecords():
        d = dict(zip(campos, sr.record))
        if filtro(d):
            yield d, shape(sr.shape.__geo_interface__)


def edificios():
    """Centroides y áreas (m²) de las huellas de public/data/mapa3d/edificios-<id>.json."""
    e = json.loads((RAIZ / f'public/data/mapa3d/edificios-{MUNICIPIO}.json').read_text(encoding='utf-8'))
    k = e['k']
    centros, areas = [], []
    for _, *c in e['e']:
        x, y, pts = c[0], c[1], [(c[0], c[1])]
        for i in range(2, len(c), 2):
            x += c[i]; y += c[i + 1]; pts.append((x, y))
        p = Polygon([(a / k, b / k) for a, b in pts])
        if p.is_valid and not p.is_empty:
            pm = transform(a_m, p)
            centros.append(pm.centroid); areas.append(pm.area)
    return centros, areas


def control_rural():
    """Rural disperso oficial por año = proyección «centros poblados y rural disperso» × proporción del Censo 2018."""
    r = shapefile.Reader(str(BASE / 'clase/MGN_ANM_MPIOCL.shp'), encoding='utf-8')
    campos = [c[0] for c in r.fields[1:]]
    filas = {d['CLAS_CCDGO']: d for d in (dict(zip(campos, x)) for x in r.records()) if d['MPIO_CDPMP'] == DANE}
    clases = {c: d['STP27_PERS'] for c, d in filas.items()}
    proporcion = clases['3'] / (clases['2'] + clases['3'])
    ws = openpyxl.load_workbook(RAIZ / 'insumos/poblacion/anex-DCD-Proypoblacion-PerteneniaEtnicoRacialmun.xlsx',
                                read_only=True).worksheets[0]
    rural = {int(f[4]): f[6] for f in ws.iter_rows(values_only=True)
             if f[2] == DANE and str(f[5]).startswith('Centros') and str(f[4]).isdigit()}
    print(f'Censo 2018 rural disperso {clases["3"]:,.0f} = {proporcion:.1%} de rural (clases 2+3)')
    return {a: rural[a] * proporcion for a in ANIOS}, filas['3']['STVIVIENDA']


veredas = list(leer(BASE / 'veredas/CRVeredas_2020.shp', lambda d: d['DPTOMPIO'] == DANE))
secciones = list(leer(BASE / 'seccion_rural/MGN_ANM_SECCION_RURAL.shp', lambda d: d['MPIO_CDPMP'] == DANE))
urbano = unary_union([transform(a_m, g.buffer(0)) for _, g in
                      leer(BASE / 'zona_urbana/MGN_ANM_ZU.shp', lambda d: d['MPIO_CDPMP'] == DANE)])
print(f'{len(veredas)} veredas, {len(secciones)} secciones rurales')

centros, areas = edificios()
vivienda = [i for i, a in enumerate(areas) if AREA_MIN <= a <= AREA_MAX and not urbano.contains(centros[i])]
arbol = STRtree([centros[i] for i in vivienda])

v_m = [transform(a_m, g.buffer(0)) for _, g in veredas]
base = [0.0] * len(veredas)
base_viv = [0.0] * len(veredas)
solo_area = 0
for d, g in secciones:
    personas = d['STP27_PERS'] or 0
    viviendas = d['STVIVIENDA'] or 0
    if not personas:
        continue
    gm = transform(a_m, g.buffer(0))
    trozos = [(i, gm.intersection(v)) for i, v in enumerate(v_m) if gm.intersects(v)]
    pesos = [len(arbol.query(t, predicate='contains')) for _, t in trozos]
    if not sum(pesos):
        pesos = [t.area for _, t in trozos]
        solo_area += 1
    for (i, _), w in zip(trozos, pesos):
        base[i] += personas * w / sum(pesos)
        base_viv[i] += viviendas * w / sum(pesos)
print(f'{solo_area} secciones sin edificios repartidas por área; personas asignadas {sum(base):,.0f}')

control, viv_control = control_rural()
todas = STRtree([c for c, a in zip(centros, areas) if not urbano.contains(c)])
features = []
for (d, g), b, bv, vm in zip(veredas, base, base_viv, v_m):
    props = {'codigo': d['CODIGO_VER'], 'nombre': d['NOMBRE_VER'].title(), 'municipio': d['NOMB_MPIO'].title(),
             'viv2018': round(bv / sum(base_viv) * viv_control),
             'edif': len(arbol.query(vm, predicate='contains')),
             'edif_total': len(todas.query(vm, predicate='contains'))}
    for a in ANIOS:
        props[f'pob{a}'] = round(b / sum(base) * control[a])
    geom = g.simplify(TOLERANCIA, preserve_topology=True)
    features.append({'type': 'Feature', 'properties': props, 'geometry': geom.__geo_interface__})


def redondear(c):
    return [redondear(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(x, DECIMALES) for x in c]


for f in features:
    f['geometry'] = {'type': f['geometry']['type'], 'coordinates': redondear(f['geometry']['coordinates'])}

salida = RAIZ / f'public/data/mapa/poblacion/veredas-{DANE}.geojson'
salida.parent.mkdir(parents=True, exist_ok=True)
coleccion = {'type': 'FeatureCollection',
             'metadata': {'tipo': 'estimación', 'alcance': 'población rural dispersa', 'anios': ANIOS,
                          'fuente': 'Censo 2018 (DANE) repartido por viviendas (huellas de edificios) sobre veredas DANE '
                                    '2020; totales calibrados a la proyección DANE de rural disperso'},
             'features': features}
salida.write_text(json.dumps(coleccion, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('viviendas 2018', sum(f['properties']['viv2018'] for f in features), 'control', round(viv_control),
      '| edif', sum(f['properties']['edif'] for f in features), '| edif_total', sum(f['properties']['edif_total'] for f in features))
print(f'{salida.relative_to(RAIZ)}  {salida.stat().st_size / 1024:.0f} KB')
for a in ANIOS:
    print(a, sum(f['properties'][f'pob{a}'] for f in features), 'control', round(control[a]))
