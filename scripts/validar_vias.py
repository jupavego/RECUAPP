"""Revisa que las vías del mapa 3D sean coherentes (no inventa nada: solo señala lo sospechoso):

  · extremos sueltos     una vía termina sin tocar otra; si hay otra a menos de 12 m es un posible hueco
  · tramos aislados      grupos de vías pequeños que no se conectan con la red principal
  · duplicados           dos vías encimadas en el mismo trazado
  · sobre edificios      calles (clase 0/1) que atraviesan huellas de edificios
  · en el agua           calles que corren por un cauce (en vez de cruzarlo) o dentro de un lago
  · pendiente imposible  calles con más de 35 % en 90 m seguidos (el relieve es de ~30 m: es un aviso, no una certeza)

Uso:  python scripts/validar_vias.py [id_municipio] [--salida informe.json]   (por defecto 49 = Girardota)
Lee public/data/mapa3d/{vias,edificios,cauces,relieve}-<id>.json (los genera generar_vias_edificios.py, etc.).
"""
import base64, json, math, sys
from pathlib import Path

import numpy as np
import pyproj
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

RAIZ = Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if not a.startswith('--')]
MUNICIPIO = int(args[0]) if args else 49
SALIDA = sys.argv[sys.argv.index('--salida') + 1] if '--salida' in sys.argv else None
DATOS = RAIZ / 'public/data/mapa3d'

TOCA = 3.5               # m, dos vías se consideran conectadas si se acercan a esto (la simplificación mueve vértices ~2 m)
HUECO_MAX = 12           # m, un extremo suelto con otra vía a menos de esto es un posible hueco (más lejos es una calle sin salida)
BORDE = 8                # m, extremos junto al borde del recuadro: la vía sigue fuera, es normal
ISLA_MAX = 250           # m, un grupo de vías más corto que esto sin conexión es sospechoso
EDIF_MIN = 12            # m de calle dentro de un edificio para avisar
PENDIENTE_MAX = 0.35

K_NOMBRE = {0: 'principal', 1: 'local', 2: 'sendero'}
leer = lambda n: json.loads((DATOS / n).read_text(encoding='utf-8'))
vias, edificios, cauces, relieve = (leer(f'{t}-{MUNICIPIO}.json') for t in ('vias', 'edificios', 'cauces', 'relieve'))
oeste, sur, este, norte = relieve['bbox']
a_utm = pyproj.Transformer.from_crs(4326, 32618, always_xy=True)
a_geo = pyproj.Transformer.from_crs(32618, 4326, always_xy=True)


def desde_deltas(v, k, ini):
    x, y, pts = v[ini], v[ini + 1], []
    pts.append((x / k, y / k))
    for i in range(ini + 2, len(v) - 1, 2):
        x += v[i]; y += v[i + 1]
        pts.append((x / k, y / k))
    return pts


def utm(pts):
    a = np.array(pts)
    x, y = a_utm.transform(a[:, 0], a[:, 1])
    return np.c_[x, y]


def lonlat(p):
    lo, la = a_geo.transform(p.x, p.y)
    return round(lo, 5), round(la, 5)


ways = []                # (clase, LineString UTM)
for v in vias['v']:
    c = utm(desde_deltas(v, vias['k'], 1))
    if len(c) > 1 and not np.all(c[0] == c[-1]) or len(c) > 2:
        ways.append((v[0], LineString(c)))
lineas = [g for _, g in ways]
arbol = STRtree(lineas)
caja = Polygon(utm([(oeste, sur), (este, sur), (este, norte), (oeste, norte)])).exterior
informe = {}


def vecinas(i, d):
    """Índices de otras vías a menos de d metros de la vía i."""
    return [j for j in arbol.query(lineas[i], predicate='dwithin', distance=d) if j != i]


# ── 1. extremos sueltos y posibles huecos ─────────────────────────────────
sueltos, huecos = [], []
for i, (c, g) in enumerate(ways):
    if g.is_ring:
        continue
    for extremo in (Point(g.coords[0]), Point(g.coords[-1])):
        if caja.distance(extremo) < BORDE:
            continue
        cerca = [j for j in arbol.query(extremo, predicate='dwithin', distance=TOCA) if j != i]
        if cerca:
            continue
        otras = [j for j in arbol.query(extremo, predicate='dwithin', distance=HUECO_MAX) if j != i]
        d = min((lineas[j].distance(extremo) for j in otras), default=None)
        item = {'clase': K_NOMBRE[c], 'lonlat': lonlat(extremo), 'largo_via_m': round(g.length)}
        if d is not None:
            item['otra_via_a_m'] = round(d, 1)
            huecos.append(item)
        elif c == 0:
            sueltos.append(item)
informe['posibles_huecos'] = huecos
informe['principales_sin_salida'] = sueltos

# ── 2. tramos aislados ────────────────────────────────────────────────────
padre = list(range(len(ways)))
def raiz(x):
    while padre[x] != x:
        padre[x] = padre[padre[x]]; x = padre[x]
    return x
for i in range(len(ways)):
    for j in vecinas(i, TOCA):
        padre[raiz(i)] = raiz(j)
grupos = {}
for i in range(len(ways)):
    grupos.setdefault(raiz(i), []).append(i)
principal = max(grupos.values(), key=lambda m: sum(lineas[i].length for i in m))
islas = []
for m in grupos.values():
    largo = sum(lineas[i].length for i in m)
    if m is principal or largo > ISLA_MAX or all(ways[i][0] == 2 for i in m):
        continue
    if any(caja.distance(lineas[i]) < BORDE for i in m):
        continue
    c = unary_union([lineas[i] for i in m]).centroid
    islas.append({'largo_m': round(largo), 'vias': len(m), 'lonlat': lonlat(c), 'clases': sorted({K_NOMBRE[ways[i][0]] for i in m})})
informe['tramos_aislados'] = sorted(islas, key=lambda x: -x['largo_m'])
informe['red_principal_km'] = round(sum(lineas[i].length for i in principal) / 1000, 1)
informe['red_total_km'] = round(sum(l.length for l in lineas) / 1000, 1)

# ── 3. duplicados ─────────────────────────────────────────────────────────
dups = []
for i in range(len(ways)):
    if ways[i][0] > 1:
        continue
    for j in vecinas(i, 1.5):
        if j < i or ways[j][0] > 1:
            continue
        m = min(lineas[i].length, lineas[j].length)
        solape = lineas[i].intersection(lineas[j].buffer(1.5)).length
        if m > 8 and solape > 0.8 * m:
            dups.append({'lonlat': lonlat(lineas[i].interpolate(0.5, normalized=True)), 'largo_m': round(m)})
informe['duplicados'] = dups

# ── 4. calles sobre edificios ─────────────────────────────────────────────
huellas = [Polygon(utm(desde_deltas(e, edificios['k'], 1))) for e in edificios['e'] if len(e) >= 8]
huellas = [h for h in huellas if h.is_valid]
arb_h = STRtree(huellas)
sobre = []
for i, (c, g) in enumerate(ways):
    if c > 1:
        continue
    dentro = sum(g.intersection(huellas[j]).length for j in arb_h.query(g, predicate='intersects'))
    if dentro >= EDIF_MIN:
        sobre.append({'clase': K_NOMBRE[c], 'm_dentro_de_edificios': round(dentro), 'largo_via_m': round(g.length), 'lonlat': lonlat(g.interpolate(0.5, normalized=True))})
informe['calles_sobre_edificios'] = sorted(sobre, key=lambda x: -x['m_dentro_de_edificios'])

# ── 5. calles en el agua ──────────────────────────────────────────────────
rios = [LineString(utm(desde_deltas(c, cauces['k'], 2))) for c in cauces.get('c', []) if len(c) >= 6]
lagos = [Polygon(utm(desde_deltas(l, cauces['k'], 1))) for l in cauces.get('l', []) if len(l) >= 8]
arb_r = STRtree(rios)
en_agua = []
for i, (c, g) in enumerate(ways):
    if c > 1:
        continue
    cerca = sum(g.intersection(rios[j].buffer(3)).length for j in arb_r.query(g, predicate='dwithin', distance=3))
    lago = sum(g.intersection(p).length for p in lagos if p.is_valid and p.intersects(g))
    if cerca > 40 or lago > 20:
        en_agua.append({'clase': K_NOMBRE[c], 'm_junto_al_cauce': round(cerca), 'm_dentro_de_lagos': round(lago), 'lonlat': lonlat(g.interpolate(0.5, normalized=True))})
informe['calles_en_el_agua'] = sorted(en_agua, key=lambda x: -(x['m_junto_al_cauce'] + x['m_dentro_de_lagos']))

# ── 6. pendiente imposible ────────────────────────────────────────────────
nx, ny = relieve['nx'], relieve['ny']
alt = np.frombuffer(base64.b64decode(relieve['dm']), dtype='<i2').reshape(ny, nx) / 10.0


def cota(lo, la):
    fx, fy = (lo - oeste) / (este - oeste) * (nx - 1), (norte - la) / (norte - sur) * (ny - 1)
    ix, iy = min(int(fx), nx - 2), min(int(fy), ny - 2)
    tx, ty = fx - ix, fy - iy
    return (alt[iy, ix] * (1 - tx) * (1 - ty) + alt[iy, ix + 1] * tx * (1 - ty) + alt[iy + 1, ix] * (1 - tx) * ty + alt[iy + 1, ix + 1] * tx * ty)


empinadas = []
for v in vias['v']:
    if v[0] > 1:
        continue
    pts = desde_deltas(v, vias['k'], 1)
    g = LineString(utm(pts))
    if g.length < 60:
        continue
    n = int(g.length // 30)
    z = [cota(*lonlat_pt) for lonlat_pt in (a_geo.transform(p.x, p.y) for p in (g.interpolate(t * 30) for t in range(n + 1)))]
    pend = [abs(z[t + 3] - z[t]) / 90 for t in range(n - 2) if abs(z[t + 3] - z[t]) / 90 > PENDIENTE_MAX]
    if pend:
        empinadas.append({'clase': K_NOMBRE[v[0]], 'pendiente_max_pct': round(max(pend) * 100), 'ventanas_de_90m': len(pend), 'lonlat': lonlat(g.interpolate(0.5, normalized=True))})
informe['pendiente_sospechosa'] = sorted(empinadas, key=lambda x: -x['pendiente_max_pct'])

# ── resumen ───────────────────────────────────────────────────────────────
print(f'Vías: {len(ways)} tramos, {informe["red_total_km"]} km ({informe["red_principal_km"]} km en la red principal conectada)')
for clave, texto in (('posibles_huecos', f'extremos a menos de {HUECO_MAX} m de otra vía sin tocarla (posible hueco)'),
                     ('principales_sin_salida', 'vías principales que terminan lejos de cualquier otra vía'),
                     ('tramos_aislados', 'grupos pequeños de calles sin conexión con la red'),
                     ('duplicados', 'calles duplicadas encima de otra'),
                     ('calles_sobre_edificios', 'calles que atraviesan edificios'),
                     ('calles_en_el_agua', 'calles que corren por un cauce o lago'),
                     ('pendiente_sospechosa', f'calles con más de {int(PENDIENTE_MAX * 100)} % de pendiente sostenida')):
    lista = informe[clave]
    print(f'  {len(lista):4d}  {texto}')
    for it in lista[:5]:
        print('         ', it)
if SALIDA:
    Path(SALIDA).write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding='utf-8')
    print('informe:', SALIDA)
