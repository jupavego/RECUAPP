"""Jardines y patios del casco urbano: lo que queda libre de cada predio una vez descontadas las construcciones.

Fuente: catastro de Girardota (capas 4 y 5 «Construcciones» y 6 y 7 «Predios» (urbanos y rurales) del servicio del Área Metropolitana del
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
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 49
SERVICIO = 'https://portalidem.metropol.gov.co/server/rest/services/Girardota_Catastro/MapServer'
CRUDO = RAIZ / 'insumos/catastro'
SALIDA = RAIZ / f'public/data/mapa3d/jardines-{MUNICIPIO}.json'
K = 1_000_000
AREA_MINIMA = 12          # m²
AREA_MAXIMA = 20000       # m²: un resto mayor es un lote grande, parque o potrero, no un jardín (el césped taparía las vías que lo cruzan)
MARGEN = 0.4              # m entre la construcción y el patio
FRANJA = 1.0              # m: se quitan las franjas de menos de 2 m (abrir con -1 y +1)
SIMPLIFICAR = 0.4
MAX_ARBOLES, MAX_MATAS = 2, 6
M2_POR_ARBOL, M2_POR_MATA = 70, 14
RADIO_FINCA = 18          # m alrededor de las construcciones de un predio rural
MAX_ARBOLES_FINCA = 3

relieve = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = relieve['bbox']
M_LON, M_LAT = 111320 * math.cos(math.radians((sur + norte) / 2)), 110574


def predios(capa=6, nombre='urbanos'):
    destino = CRUDO / f'predios-{nombre}-{MUNICIPIO}.geojson'
    if destino.exists():
        return json.loads(destino.read_text(encoding='utf-8'))['features']
    feats, desde = [], 0
    while True:
        q = urllib.parse.urlencode({
            'where': '1=1', 'geometry': f'{oeste},{sur},{este},{norte}', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
            'outSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': 'PK_PREDIOS', 'geometryPrecision': 7,
            'resultOffset': desde, 'resultRecordCount': 1000, 'f': 'geojson'})
        req = urllib.request.Request(f'{SERVICIO}/{capa}/query?{q}', headers={'User-Agent': 'recuapp-poc/0.1'})
        lote = json.loads(urllib.request.urlopen(req, timeout=120).read()).get('features', [])
        feats += lote
        if len(lote) < 1000:
            break
        desde += 1000
    destino.write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}, separators=(',', ':')), encoding='utf-8')
    print(f'predios {nombre}: {len(feats)} -> {destino.relative_to(RAIZ)}')
    return feats


# Calzadas del mapa 3D (vias-<id>.json, clases 0 principal, 1 local y 2 sendero) con el ancho con que se dibujan (ANCHO_VIA en mapa3d.component.ts)
# más un margen: el césped de un predio nunca las cubre.
ANCHO_VIA, MARGEN_VIA = [34, 13, 6], 2.0


def calzadas():
    d = json.loads((RAIZ / f'public/data/mapa3d/vias-{MUNICIPIO}.json').read_text(encoding='utf-8'))
    franjas = []
    for v in d['v']:
        x, y, pts = v[1], v[2], []
        pts.append((x, y))
        for i in range(3, len(v), 2):
            x += v[i]; y += v[i + 1]; pts.append((x, y))
        if len(pts) > 1:
            franjas.append(LineString([((px / d['k'] - oeste) * M_LON, (py / d['k'] - sur) * M_LAT) for px, py in pts]).buffer(ANCHO_VIA[v[0]] / 2 + MARGEN_VIA))
    return unary_union(franjas)


def a_metros(g):
    return transform(g, lambda c: np.column_stack(((c[:, 0] - oeste) * M_LON, (c[:, 1] - sur) * M_LAT)))


def codificar(x, y):
    return round((x / M_LON + oeste) * K), round((y / M_LAT + sur) * K)


huellas = defaultdict(list)
for nombre in ('urbanas', 'rurales'):
    for f in json.loads((CRUDO / f'construcciones-{nombre}-{MUNICIPIO}.geojson').read_text(encoding='utf-8'))['features']:
        if f.get('geometry'):
            huellas[f['properties']['PK_PREDIOS']].append(make_valid(a_metros(shape(f['geometry']))))

VIAS = calzadas()
azar = random.Random(20251102)
jardines, arboles, matas = [], [], []
sin_construccion = 0
for rural, f in [(False, f) for f in predios()] + [(True, f) for f in predios(7, 'rurales')]:
    if not f.get('geometry'):
        continue
    lote = make_valid(a_metros(shape(f['geometry']))).buffer(0)
    construido = huellas.get(f['properties']['PK_PREDIOS'], [])
    if not construido:
        sin_construccion += 1          # lote sin construir: se deja a la vegetación general, no es un jardín
        continue
    if rural:                          # finca: el patio es el entorno de la casa (RADIO_FINCA m), el resto del predio queda al paisaje
        lote = lote.intersection(unary_union([c.buffer(RADIO_FINCA) for c in construido]))
    libre = lote.buffer(-0.2).difference(unary_union([c.buffer(MARGEN) for c in construido])).buffer(-FRANJA).buffer(FRANJA)
    libre = libre.difference(VIAS).buffer(-FRANJA).buffer(FRANJA)           # sin cubrir calzadas
    for parte in (libre.geoms if hasattr(libre, 'geoms') else [libre]):
        if parte.is_empty or parte.geom_type != 'Polygon' or parte.area < AREA_MINIMA or parte.area > AREA_MAXIMA:
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

        n_arb = min(MAX_ARBOLES_FINCA if rural else MAX_ARBOLES, int(parte.area // (M2_POR_ARBOL * (3 if rural else 1))))
        n_mat = min(3 if rural else MAX_MATAS, max(1, int(parte.area // M2_POR_MATA)))
        a = puntos(parte.buffer(-2.5), n_arb)
        m = puntos(parte.buffer(-0.6), n_mat)
        jardines.append(contorno)
        arboles.append([c for p in a for c in codificar(p.x, p.y)])
        matas.append([c for p in m for c in codificar(p.x, p.y)])

SALIDA.write_text(json.dumps({'k': K, 'j': jardines, 'a': arboles, 'm': matas}, separators=(',', ':')), encoding='utf-8')
print(f'jardines: {len(jardines)} patios, {sum(len(a) // 2 for a in arboles)} árboles, {sum(len(m) // 2 for m in matas)} matas '
      f'({sin_construccion} predios sin construcción ignorados) -> {SALIDA.name} {SALIDA.stat().st_size / 1e6:.2f} MB')
