"""Jardines y patios del casco urbano: lo que queda libre de cada predio una vez descontadas las construcciones.

Fuente: catastro de Girardota (capas 4 «Construcciones Urbanas» y 6 «Predios Urbanos» del servicio del Área Metropolitana del
Valle de Aburrá, © Alcaldía de Girardota, Catastro). Las construcciones se toman de la descarga que deja
generar_catastro_3d.py en insumos/catastro/; los predios se bajan aquí (y se guardan en la misma carpeta).

Del predio se resta toda huella construida (con 0.4 m de margen) y se quitan las franjas de menos de 2 m. Lo que sobra y mide al
menos AREA_MINIMA m² es un patio o jardín; en cada uno se reparten puntos de siembra con semilla fija.

    public/data/mapa3d/jardines-<id>.json
        {"k": 1e6, "j": [[x0, y0, dx, dy, ...], ...], "a": [[x, y, ...], ...], "m": [[x, y, ...], ...]}
        j: contorno exterior de cada patio (enteros = grados × k, primera pareja absoluta y el resto diferencias, abierto)
        a: puntos absolutos de árboles de ese patio; m: puntos absolutos de matas y flores

Uso:      python scripts/generar_jardines.py [id_municipio]   (por defecto 49 = Girardota; requiere haber corrido generar_catastro_3d.py)
Requiere: pip install shapely
"""
import json, math, random, sys, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
from shapely import transform
from shapely import make_valid
from shapely.geometry import Point, Polygon, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 49
SERVICIO = 'https://portalidem.metropol.gov.co/server/rest/services/Girardota_Catastro/MapServer'
CRUDO = RAIZ / 'insumos/catastro'
SALIDA = RAIZ / f'public/data/mapa3d/jardines-{MUNICIPIO}.json'
K = 1_000_000
AREA_MINIMA = 12          # m²
MARGEN = 0.4              # m entre la construcción y el patio
FRANJA = 1.0              # m: se quitan las franjas de menos de 2 m (abrir con -1 y +1)
SIMPLIFICAR = 0.4
MAX_ARBOLES, MAX_MATAS = 2, 6
M2_POR_ARBOL, M2_POR_MATA = 70, 14

relieve = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = relieve['bbox']
M_LON, M_LAT = 111320 * math.cos(math.radians((sur + norte) / 2)), 110574


def predios():
    destino = CRUDO / f'predios-urbanos-{MUNICIPIO}.geojson'
    if destino.exists():
        return json.loads(destino.read_text(encoding='utf-8'))['features']
    feats, desde = [], 0
    while True:
        q = urllib.parse.urlencode({
            'where': '1=1', 'geometry': f'{oeste},{sur},{este},{norte}', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
            'outSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': 'PK_PREDIOS', 'geometryPrecision': 7,
            'resultOffset': desde, 'resultRecordCount': 1000, 'f': 'geojson'})
        req = urllib.request.Request(f'{SERVICIO}/6/query?{q}', headers={'User-Agent': 'recuapp-poc/0.1'})
        lote = json.loads(urllib.request.urlopen(req, timeout=120).read()).get('features', [])
        feats += lote
        if len(lote) < 1000:
            break
        desde += 1000
    destino.write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}, separators=(',', ':')), encoding='utf-8')
    print(f'predios urbanos: {len(feats)} -> {destino.relative_to(RAIZ)}')
    return feats


def a_metros(g):
    return transform(g, lambda c: np.column_stack(((c[:, 0] - oeste) * M_LON, (c[:, 1] - sur) * M_LAT)))


def codificar(x, y):
    return round((x / M_LON + oeste) * K), round((y / M_LAT + sur) * K)


huellas = defaultdict(list)
for f in json.loads((CRUDO / f'construcciones-urbanas-{MUNICIPIO}.geojson').read_text(encoding='utf-8'))['features']:
    if f.get('geometry'):
        huellas[f['properties']['PK_PREDIOS']].append(make_valid(a_metros(shape(f['geometry']))))

azar = random.Random(20251102)
jardines, arboles, matas = [], [], []
sin_construccion = 0
for f in predios():
    if not f.get('geometry'):
        continue
    lote = make_valid(a_metros(shape(f['geometry']))).buffer(0)
    construido = huellas.get(f['properties']['PK_PREDIOS'], [])
    if not construido:
        sin_construccion += 1          # lote sin construir: se deja a la vegetación general, no es un jardín
        continue
    libre = lote.buffer(-0.2).difference(unary_union([c.buffer(MARGEN) for c in construido])).buffer(-FRANJA).buffer(FRANJA)
    for parte in (libre.geoms if hasattr(libre, 'geoms') else [libre]):
        if parte.is_empty or parte.geom_type != 'Polygon' or parte.area < AREA_MINIMA:
            continue
        s = parte.simplify(SIMPLIFICAR, preserve_topology=True)
        if s.is_empty or s.geom_type != 'Polygon':
            continue
        anillo = list(orient(Polygon(s.exterior), 1.0).exterior.coords)[:-1]
        if len(anillo) < 3:
            continue
        t = [codificar(x, y) for x, y in anillo]
        contorno = [t[0][0], t[0][1]]
        for (ax, ay), (bx, by) in zip(t, t[1:]):
            contorno += [bx - ax, by - ay]

        def puntos(zona, cuantos):
            """Puntos al azar dentro de la zona (con semilla fija), sin acercarse más de 2.5 m entre sí."""
            res, (x0, y0, x1, y1) = [], zona.bounds
            if zona.is_empty:
                return res
            for _ in range(cuantos * 12):
                p = Point(azar.uniform(x0, x1), azar.uniform(y0, y1))
                if zona.contains(p) and all(math.hypot(p.x - q.x, p.y - q.y) > 2.5 for q in res):
                    res.append(p)
                    if len(res) == cuantos:
                        break
            return res

        n_arb = min(MAX_ARBOLES, int(parte.area // M2_POR_ARBOL))
        n_mat = min(MAX_MATAS, max(1, int(parte.area // M2_POR_MATA)))
        a = puntos(parte.buffer(-2.5), n_arb)
        m = puntos(parte.buffer(-0.6), n_mat)
        jardines.append(contorno)
        arboles.append([c for p in a for c in codificar(p.x, p.y)])
        matas.append([c for p in m for c in codificar(p.x, p.y)])

SALIDA.write_text(json.dumps({'k': K, 'j': jardines, 'a': arboles, 'm': matas}, separators=(',', ':')), encoding='utf-8')
print(f'jardines: {len(jardines)} patios, {sum(len(a) // 2 for a in arboles)} árboles, {sum(len(m) // 2 for m in matas)} matas '
      f'({sin_construccion} predios sin construcción ignorados) -> {SALIDA.name} {SALIDA.stat().st_size / 1e6:.2f} MB')
