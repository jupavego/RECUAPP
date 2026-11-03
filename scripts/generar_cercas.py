"""Cercas de los predios: la lotificación del catastro dibujada como linderos.

Fuente: catastro de Girardota (capas 6 «Predios Urbanos» y 7 «Predios Rurales» del servicio del Área Metropolitana del Valle de
Aburrá, © Alcaldía de Girardota, Catastro). Las construcciones salen de la descarga que deja generar_catastro_3d.py en
insumos/catastro/; los predios se bajan aquí (y se guardan en la misma carpeta).

El lindero entre dos predios vecinos se cuenta una sola vez (se unen todos los bordes y se parten en los cruces). Al lindero se le
quita lo que queda a menos de MARGEN_CASA m de una construcción —ahí manda el muro de la casa— y se descartan los tramos cortos.

    public/data/mapa3d/cercas-<id>.json
        {"k": 1e6, "u": [[x0, y0, dx, dy, ...], ...], "r": [[...], ...]}
        u: linderos urbanos; r: linderos rurales (enteros = grados × k, primera pareja absoluta y el resto diferencias)

Uso:      python scripts/generar_cercas.py [id_municipio]   (por defecto 49 = Girardota; requiere haber corrido generar_catastro_3d.py)
Requiere: pip install shapely
"""
import json, math, sys, urllib.parse, urllib.request
from pathlib import Path

import numpy as np
from shapely import make_valid, transform
from shapely.geometry import shape
from shapely.ops import linemerge, unary_union

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 49
SERVICIO = 'https://portalidem.metropol.gov.co/server/rest/services/Girardota_Catastro/MapServer'
CRUDO = RAIZ / 'insumos/catastro'
SALIDA = RAIZ / f'public/data/mapa3d/cercas-{MUNICIPIO}.json'
K = 1_000_000
MARGEN_CASA = 1.2         # m: junto a una construcción no se pone cerca
TRAMO_MINIMO = {'u': 3.0, 'r': 12.0}     # m: tramos más cortos se descartan
SIMPLIFICAR = {'u': 0.5, 'r': 2.0}

relieve = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = relieve['bbox']
M_LON, M_LAT = 111320 * math.cos(math.radians((sur + norte) / 2)), 110574


def predios(capa, nombre):
    destino = CRUDO / f'predios-{nombre}-{MUNICIPIO}.geojson'
    if destino.exists():
        return json.loads(destino.read_text(encoding='utf-8'))['features']
    feats, desde = [], 0
    while True:
        q = urllib.parse.urlencode({
            'where': '1=1', 'geometry': f'{oeste},{sur},{este},{norte}', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
            'outSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': 'PK_PREDIOS,AREA_M2,TIPO,TOTAL_EDIF',
            'geometryPrecision': 7, 'resultOffset': desde, 'resultRecordCount': 1000, 'f': 'geojson'})
        req = urllib.request.Request(f'{SERVICIO}/{capa}/query?{q}', headers={'User-Agent': 'recuapp-poc/0.1'})
        lote = json.loads(urllib.request.urlopen(req, timeout=120).read()).get('features', [])
        feats += lote
        if len(lote) < 1000:
            break
        desde += 1000
    destino.write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}, separators=(',', ':')), encoding='utf-8')
    print(f'predios {nombre}: {len(feats)} -> {destino.relative_to(RAIZ)}')
    return feats


def a_metros(g):
    return transform(g, lambda c: np.column_stack(((c[:, 0] - oeste) * M_LON, (c[:, 1] - sur) * M_LAT)))


def codificar(x, y):
    return round((x / M_LON + oeste) * K), round((y / M_LAT + sur) * K)


construcciones = []
for nombre in ('urbanas', 'rurales'):
    for f in json.loads((CRUDO / f'construcciones-{nombre}-{MUNICIPIO}.geojson').read_text(encoding='utf-8'))['features']:
        if f.get('geometry'):
            construcciones.append(make_valid(a_metros(shape(f['geometry']))))
casas = unary_union([c.buffer(MARGEN_CASA) for c in construcciones])
print(f'{len(construcciones)} construcciones')

salida = {}
for clave, capa, nombre in (('u', 6, 'urbanos'), ('r', 7, 'rurales')):
    bordes = [make_valid(a_metros(shape(f['geometry']))).buffer(0).boundary for f in predios(capa, nombre) if f.get('geometry')]
    lindero = unary_union(bordes).difference(casas)             # une los bordes (los comunes quedan una vez) y quita lo junto a casas
    lineas = linemerge(lindero) if lindero.geom_type != 'LineString' else lindero
    lineas = list(lineas.geoms) if hasattr(lineas, 'geoms') else [lineas]
    res, largo = [], 0.0
    for l in lineas:
        if l.is_empty or l.length < TRAMO_MINIMO[clave]:
            continue
        s = l.simplify(SIMPLIFICAR[clave], preserve_topology=False)
        if s.is_empty or s.geom_type != 'LineString' or len(s.coords) < 2:
            continue
        t = [codificar(x, y) for x, y in s.coords]
        c = [t[0][0], t[0][1]]
        for (ax, ay), (bx, by) in zip(t, t[1:]):
            c += [bx - ax, by - ay]
        res.append(c)
        largo += s.length
    salida[clave] = res
    print(f'{nombre}: {len(res)} tramos, {largo / 1000:.1f} km, {sum(len(c) // 2 for c in res)} vértices')

SALIDA.write_text(json.dumps({'k': K, **salida}, separators=(',', ':')), encoding='utf-8')
print(f'-> {SALIDA.name} {SALIDA.stat().st_size / 1e6:.2f} MB')
