"""Baja las vías (OpenStreetMap, vía Overpass) y las huellas de edificios (Overture Maps, que reúne OSM,
Microsoft y Google) de un municipio y las guarda compactas para el mapa 3D:

    public/data/mapa3d/vias-<id>.json        {"k": 1e5, "v": [[clase, x0, y0, dx, dy, ...], ...]}
    public/data/mapa3d/edificios-<id>.json   {"k": 1e5, "e": [[altura_m, x0, y0, dx, dy, ...], ...]}

Las coordenadas son enteros (grados × k), la primera pareja absoluta y el resto como diferencias.
Clases: 0 vía principal, 1 vía local, 2 sendero/camino. Los cauces van aparte (generar_cauces.py). Altura 0 = desconocida (el mapa la estima).

Requiere:  pip install overturemaps
Uso:       python scripts/generar_vias_edificios.py [id_municipio]   (por defecto 49 = Girardota)

Datos © colaboradores de OpenStreetMap (ODbL) y Overture Maps Foundation (ODbL / CDLA-Permissive-2.0).
"""
import json, math, shutil, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 else 49
K = 100000
TOLERANCIA = 1.0          # m, simplificación de las huellas
AREA_MINIMA = 15          # m², se descartan casetas y ruido

CLASES = {
    'motorway': 0, 'motorway_link': 0, 'trunk': 0, 'trunk_link': 0, 'primary': 0, 'primary_link': 0,
    'secondary': 0, 'secondary_link': 0, 'tertiary': 0, 'tertiary_link': 0,
    'residential': 1, 'unclassified': 1, 'service': 1, 'living_street': 1,
    'track': 2, 'footway': 2, 'path': 2, 'steps': 2, 'bridleway': 2, 'cycleway': 2, 'pedestrian': 2,
}
# vías de OSM que no son calle (circulación interna de la cancha junto a la quebrada La Ferrería, en Girardota)
IDS_EXCLUIDOS = {1082917732, 1082917733, 1175551339, 1175551340}
SERVICIO_DESCARTADO = {'parking_aisle', 'driveway', 'drive-through', 'emergency_access'}

relieve = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = relieve['bbox']
M_LON = 111320 * math.cos(math.radians((sur + norte) / 2))
M_LAT = 110574
SALIDA = RAIZ / 'public/data/mapa3d'


def deltas(puntos):
    """[(lon, lat), ...] → [x0, y0, dx, dy, ...] en enteros."""
    t = [(round(lo * K), round(la * K)) for lo, la in puntos]
    sal = [t[0][0], t[0][1]]
    for (ax, ay), (bx, by) in zip(t, t[1:]):
        sal += [bx - ax, by - ay]
    return sal


def simplificar(p, tol):
    """Douglas-Peucker sobre una lista de (lon, lat) con la tolerancia en metros."""
    if len(p) < 3:
        return p
    ax, ay = p[0]; bx, by = p[-1]
    dx, dy = (bx - ax) * M_LON, (by - ay) * M_LAT
    largo = math.hypot(dx, dy)
    mejor, imejor = 0, 0
    for i in range(1, len(p) - 1):
        px, py = (p[i][0] - ax) * M_LON, (p[i][1] - ay) * M_LAT
        d = abs(px * dy - py * dx) / largo if largo else math.hypot(px, py)
        if d > mejor:
            mejor, imejor = d, i
    if mejor <= tol:
        return [p[0], p[-1]]
    return simplificar(p[:imejor + 1], tol)[:-1] + simplificar(p[imejor:], tol)


def area_m2(anillo):
    s = 0
    for (ax, ay), (bx, by) in zip(anillo, anillo[1:] + anillo[:1]):
        s += (ax * M_LON) * (by * M_LAT) - (bx * M_LON) * (ay * M_LAT)
    return abs(s) / 2


# ── vías ──────────────────────────────────────────────────────────────────
consulta = f'[out:json][timeout:180];way["highway"]({sur},{oeste},{norte},{este});out geom tags;'
SERVIDORES = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
              'https://overpass.private.coffee/api/interpreter']
elementos = None
for intento in range(6):
    servidor = SERVIDORES[intento % len(SERVIDORES)]
    try:
        req = urllib.request.Request(servidor, data=urllib.parse.urlencode({'data': consulta}).encode(),
                                     headers={'User-Agent': 'recuapp-poc/0.1'})
        elementos = json.loads(urllib.request.urlopen(req, timeout=240).read())['elements']
        break
    except Exception as e:      # Overpass es público y a veces responde 502/504: se reintenta en otro servidor
        print(f'{servidor}: {e}')
        time.sleep(10)
if elementos is None:
    sys.exit('Overpass no respondió')


def recortar(pts):
    """Parte una polilínea (lon, lat) en los tramos que quedan dentro del recuadro del relieve."""
    tramos, actual = [], []
    for a, b in zip(pts, pts[1:]):
        t0, t1 = 0.0, 1.0
        dx, dy = b[0] - a[0], b[1] - a[1]
        for p, q in ((-dx, a[0] - oeste), (dx, este - a[0]), (-dy, a[1] - sur), (dy, norte - a[1])):
            if p == 0:
                if q < 0:
                    t0, t1 = 1, 0
            elif p < 0:
                t0 = max(t0, q / p)
            else:
                t1 = min(t1, q / p)
        if t0 >= t1:
            if len(actual) > 1:
                tramos.append(actual)
            actual = []
            continue
        ini, fin = (a[0] + t0 * dx, a[1] + t0 * dy), (a[0] + t1 * dx, a[1] + t1 * dy)
        if t0 > 0 and len(actual) > 1:
            tramos.append(actual)
            actual = []
        actual = (actual or [ini]) + [fin]
        if t1 < 1:
            tramos.append(actual)
            actual = []
    if len(actual) > 1:
        tramos.append(actual)
    return tramos


def es_real(tags):
    """Descarta lo que no es calle ni camino: accesos a parqueaderos y garajes, y andenes/cruces que ya van junto a la calzada."""
    if tags.get('highway') == 'service' and tags.get('service') in SERVICIO_DESCARTADO:
        return False
    if tags.get('highway') == 'footway' and tags.get('footway') in ('sidewalk', 'crossing', 'traffic_island'):
        return False
    return True


vias, descartadas = [], 0
for e in elementos:
    tags = e.get('tags', {})
    clase = CLASES.get(tags.get('highway'))
    if clase is None or len(e.get('geometry', [])) < 2:
        continue
    if e.get('id') in IDS_EXCLUIDOS or not es_real(tags):
        descartadas += 1
        continue
    for tramo in recortar([(g['lon'], g['lat']) for g in e['geometry']]):
        vias.append([clase] + deltas(simplificar(tramo, 2.0)))
(SALIDA / f'vias-{MUNICIPIO}.json').write_text(json.dumps({'k': K, 'v': vias}, separators=(',', ':')), encoding='utf-8')
print(f'vías: {len(vias)} (descartadas {descartadas} que no son calle ni camino)')

# ── edificios ─────────────────────────────────────────────────────────────
cli = shutil.which('overturemaps')
if not cli:
    sys.exit('Falta overturemaps: pip install overturemaps')
with tempfile.TemporaryDirectory() as tmp:
    bruto = Path(tmp) / 'edificios.geojson'
    subprocess.run([cli, 'download', f'--bbox={oeste},{sur},{este},{norte}', '-f', 'geojson',
                    '--type=building', '-o', str(bruto)], check=True)
    features = json.loads(bruto.read_text(encoding='utf-8'))['features']

edificios = []
for f in features:
    g = f['geometry']
    props = f.get('properties') or {}
    polis = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']] if g['type'] == 'Polygon' else []
    altura = props.get('height') or (props.get('num_floors') or 0) * 3
    for poli in polis:
        anillo = [(x, y) for x, y in poli[0]][:-1]
        if len(anillo) < 3 or area_m2(anillo) < AREA_MINIMA:
            continue
        anillo = simplificar(anillo + [anillo[0]], TOLERANCIA)[:-1]
        if len(anillo) < 3:
            continue
        edificios.append([round(float(altura), 1)] + deltas(anillo))
(SALIDA / f'edificios-{MUNICIPIO}.json').write_text(json.dumps({'k': K, 'e': edificios}, separators=(',', ':')), encoding='utf-8')
conaltura = sum(1 for e in edificios if e[0])
print(f'edificios: {len(edificios)} ({conaltura} con altura conocida)')
for n in (f'vias-{MUNICIPIO}.json', f'edificios-{MUNICIPIO}.json'):
    print(n, f'{(SALIDA / n).stat().st_size / 1024:.0f} KB')
