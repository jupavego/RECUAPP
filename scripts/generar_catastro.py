"""Reemplaza las casas del diorama del Pueblo 3D por las construcciones reales del catastro de Girardota.

Fuente: servicio cartográfico del Área Metropolitana del Valle de Aburrá, capa «Construcciones Urbanas»
(https://portalidem.metropol.gov.co/server/rest/services/Girardota_Catastro/MapServer/4), © Alcaldía de Girardota, Catastro.

Cada predio se agrupa en construcciones (huellas que se tocan, a ≤ 0.5 m) y cada una queda como
    [x, z, área_m2, giro, pisos, uso, corto, largo]
con x hacia el este y z hacia el sur desde el centro del diorama (metros), `giro` el ángulo del lado corto (como en
pueblo.component.ts), `pisos` el promedio de NO_PISOS ponderado por área, y `uso` 0 residencial/sin dato, 1 comercial, 2 industrial.
`corto` y `largo` son las medidas del rectángulo mínimo que envuelve la huella.

    public/data/plan/girardota-diorama.json   se reescribe el campo `casas`

Uso:      python scripts/generar_catastro.py
Requiere: pip install shapely
"""
import json, math, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import transform, unary_union

RAIZ = Path(__file__).resolve().parent.parent
DIORAMA = RAIZ / 'public/data/plan/girardota-diorama.json'
CAPA = 'https://portalidem.metropol.gov.co/server/rest/services/Girardota_Catastro/MapServer/4/query'
CAMPOS = 'PK_PREDIOS,USO,NO_PISOS'
UNION = 0.5               # m, huellas del mismo predio a menos de esto forman una sola construcción
AREA_MINIMA = 20          # m², se descartan anexos, balcones y ruido del catastro
USOS = {'C': 1, 'I': 2}

d = json.loads(DIORAMA.read_text(encoding='utf-8'))
lon0, lat0 = d['centro']
M_LON, M_LAT = 111320 * math.cos(math.radians(lat0)), 110574
mitad_x, mitad_z = d['ancho'] / 2, d['fondo'] / 2
margen = 40               # m extra para no cortar construcciones en el borde


# ── descarga por páginas (el servicio entrega 2000 por consulta) ───────────────
sobre = f'{lon0 - (mitad_x + margen) / M_LON},{lat0 - (mitad_z + margen) / M_LAT},{lon0 + (mitad_x + margen) / M_LON},{lat0 + (mitad_z + margen) / M_LAT}'
huellas, desde = [], 0
while True:
    q = urllib.parse.urlencode({
        'where': '1=1', 'geometry': sobre, 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326, 'outSR': 4326,
        'spatialRel': 'esriSpatialRelIntersects', 'outFields': CAMPOS, 'resultOffset': desde,
        'resultRecordCount': 2000, 'f': 'geojson'})
    req = urllib.request.Request(f'{CAPA}?{q}', headers={'User-Agent': 'recuapp-poc/0.1'})
    lote = json.loads(urllib.request.urlopen(req, timeout=90).read()).get('features', [])
    huellas += lote
    if len(lote) < 2000:
        break
    desde += 2000
print(f'huellas descargadas: {len(huellas)}')

# ── una construcción por grupo de huellas que se tocan dentro de un mismo predio ───
por_predio = defaultdict(list)
for f in huellas:
    g = shape(f['geometry'])
    if g.is_empty:
        continue
    por_predio[f['properties']['PK_PREDIOS']].append((g, f['properties']))


def a_plano(g):
    """Geometría (lon, lat) → geometría en metros locales."""
    return transform(lambda lo, la: ((lo - lon0) * M_LON, -(la - lat0) * M_LAT), g)


casas = []
for predio, lista in por_predio.items():
    plano = [(a_plano(g), p) for g, p in lista]
    union = unary_union([g.buffer(UNION / 2) for g, _ in plano])
    for c in (union.geoms if hasattr(union, 'geoms') else [union]):
        propias = [(g, p) for g, p in plano if c.contains(g.representative_point())]
        area = sum(g.area for g, _ in propias)
        if area < AREA_MINIMA:
            continue
        pisos = sum(g.area * max(p['NO_PISOS'] or 1, 1) for g, p in propias) / area
        mayor = max(propias, key=lambda t: t[0].area)[1]
        envolvente = unary_union([g for g, _ in propias]).minimum_rotated_rectangle
        if envolvente.geom_type != 'Polygon':
            continue
        v = list(envolvente.exterior.coords)
        lados = [(math.hypot(b[0] - a[0], b[1] - a[1]), (b[0] - a[0], b[1] - a[1])) for a, b in zip(v, v[1:3])]
        (l1, d1), (l2, d2) = lados
        corto, largo, dir_corto = (l1, l2, d1) if l1 <= l2 else (l2, l1, d2)
        cx, cz = envolvente.centroid.x, envolvente.centroid.y
        if abs(cx) > mitad_x or abs(cz) > mitad_z:
            continue
        giro = math.atan2(-dir_corto[1], dir_corto[0]) % math.pi
        casas.append([round(cx), round(cz), round(area), round(giro, 2), max(1, round(pisos)),
                      USOS.get(mayor['USO'], 0), round(corto, 1), round(largo, 1)])

casas.sort(key=lambda c: (c[0], c[1]))
d['casas'] = casas
DIORAMA.write_text(json.dumps(d, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
conteo = defaultdict(int)
for c in casas:
    conteo[c[4]] += 1
print(f'construcciones: {len(casas)}  pisos: {dict(sorted(conteo.items()))}  comerciales: {sum(c[5] == 1 for c in casas)}  industriales: {sum(c[5] == 2 for c in casas)}')
print(f'{DIORAMA.name}: {DIORAMA.stat().st_size / 1024:.0f} KB')
