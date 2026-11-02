"""Ordena las huellas de edificios del tejido urbano para que respeten las manzanas, como en la vida real.

Las huellas de OpenStreetMap / Overture atraviesan calles y dejan manzanas con huecos. Este script, en metros locales:

  1. Marca el tejido urbano: celdas de 40 m con >= 20 edificios en ellas y sus 8 vecinas (se contrasta con la ortofoto,
     public/data/mapa3d/ortofoto-<id>.jpg, donde ese tejido es el de los techos de teja).
  2. Resta a ese tejido las calles (vías principales y locales, con su calzada y acera) y los cauces: lo que queda son las manzanas.
  3. Recorta cada edificio a su manzana y lo vuelve rectángulo si se parece a uno (así cuadran los techos a dos aguas).
  4. Rellena el frente de la manzana con predios rectangulares (ancho 6-10 m, fondo 9-15 m) alineados a la calle, solo
     donde queda sitio libre, y una segunda fila detrás (fondo 7-12 m, con 30 % de patios vacíos).

    public/data/mapa3d/edificios-<id>.json            entrada (se conserva)
    public/data/mapa3d/edificios-ordenados-<id>.json  salida, mismo formato {"k": 1e5, "e": [[altura_m, x0, y0, dx, dy, ...], ...]}

Uso:  python scripts/ordenar_manzanas.py [id_municipio]   (por defecto 49 = Girardota)
Requiere:  pip install shapely numpy
"""
import json, math, random, sys
from collections import Counter
from pathlib import Path

from shapely.geometry import LineString, MultiPolygon, Polygon, box
from shapely.ops import unary_union
from shapely.geometry.polygon import orient

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 else 49
DATOS = RAIZ / 'public/data/mapa3d'

CELDA, MIN_URBANO = 40, 20
ANCHO_VIA = [34, 13, 6]            # igual que el mapa 3D; los senderos (2) no cuentan como calle
MARGEN_VIA = 2.0                   # acera: el edificio queda a esta distancia del borde de la calzada
PRED_ANCHO, PRED_FONDO, PRED_FONDO_2 = (6, 10), (9, 15), (7, 12)
AREA_MIN_EDIF, AREA_MIN_MANZANA, AREA_MAX_MANZANA = 20, 150, 60000
HUECO_PREDIO, HUECO_FILA_2 = 0.05, 0.3   # fracción de predios que se dejan vacíos (lotes sin construir y patios)

relieve = json.loads((DATOS / f'relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = relieve['bbox']
M_LON, M_LAT = 111320 * math.cos(math.radians((sur + norte) / 2)), 110574


def leer(nombre):
    return json.loads((DATOS / nombre).read_text(encoding='utf-8'))


def anillo(a, k, desde):
    """[.., x0, y0, dx, dy, ...] → lista de (x, y) en metros locales."""
    x, y, out = a[desde], a[desde + 1], []
    out.append(((x / k - oeste) * M_LON, (y / k - sur) * M_LAT))
    for i in range(desde + 2, len(a), 2):
        x += a[i]; y += a[i + 1]
        out.append(((x / k - oeste) * M_LON, (y / k - sur) * M_LAT))
    return out


def codificar(altura, pts, k):
    ent = [(round((x / M_LON + oeste) * k), round((y / M_LAT + sur) * k)) for x, y in pts]
    out = [altura, ent[0][0], ent[0][1]]
    for (ax, ay), (bx, by) in zip(ent, ent[1:]):
        out += [bx - ax, by - ay]
    return out


def poligonos(g):
    if g.is_empty: return []
    return [g] if isinstance(g, Polygon) else [p for p in getattr(g, 'geoms', []) if isinstance(p, Polygon)]


edif = leer(f'edificios-{MUNICIPIO}.json'); K = edif['k']
vias = leer(f'vias-{MUNICIPIO}.json')
cauces = leer(f'cauces-{MUNICIPIO}.json')

# ── 1. edificios y tejido urbano ──────────────────────────────────────────
base = []
for e in edif['e']:
    pts = anillo(e, K, 1)
    if len(pts) >= 3:
        p = Polygon(pts)
        if not p.is_valid: p = p.buffer(0)
        if not p.is_empty: base.append((e[0], p))
celdas = Counter()
for _, p in base:
    c = p.centroid; celdas[(int(c.x // CELDA), int(c.y // CELDA))] += 1
urbanas = [(i, j) for (i, j) in celdas if sum(celdas.get((i + a, j + b), 0) for a in (-1, 0, 1) for b in (-1, 0, 1)) >= MIN_URBANO]
urbano = unary_union([box(i * CELDA, j * CELDA, (i + 1) * CELDA, (j + 1) * CELDA) for i, j in urbanas]).buffer(CELDA / 2).buffer(-CELDA / 2)

# ── 2. calles y cauces → manzanas ──────────────────────────────────────────
calles = unary_union([LineString(anillo(v, vias['k'], 1)).buffer(ANCHO_VIA[v[0]] / 2 + MARGEN_VIA, cap_style=2)
                      for v in vias['v'] if v[0] <= 1 and len(v) >= 5])
rios = unary_union([LineString(anillo(c, cauces['k'], 2)).buffer(max(c[0], 4) / 2 + MARGEN_VIA, cap_style=2)
                    for c in cauces['c'] if len(c) >= 6])
manzanas = [m for m in poligonos(urbano.difference(unary_union([calles, rios])))
            if AREA_MIN_MANZANA <= m.area <= AREA_MAX_MANZANA]
indice = {i: m for i, m in enumerate(manzanas)}
print(f'tejido urbano: {len(urbanas)} celdas, {len(manzanas)} manzanas')

# ── 3. edificios recortados a su manzana ──────────────────────────────────
rnd = random.Random(2468)
salida, grandes = [], 0
dentro = {i: [] for i in indice}
fuera = []
for h, p in base:
    c = p.centroid
    if not urbano.contains(c):
        fuera.append((h, p)); continue
    if p.area > 1200:                  # naves y bodegas: se dejan como están
        fuera.append((h, p)); grandes += 1; continue
    for i, m in indice.items():
        if m.bounds[0] <= c.x <= m.bounds[2] and m.bounds[1] <= c.y <= m.bounds[3] and m.intersects(p) and m.contains(c):
            dentro[i].append((h, p)); break


def como_rectangulo(p, m):
    r = p.minimum_rotated_rectangle
    if isinstance(r, Polygon) and r.area < p.area * 1.6:
        q = r.intersection(m)
        return max(poligonos(q), key=lambda z: z.area) if poligonos(q) else p
    return p


nuevos = 0
for i, m in indice.items():
    puestos = []                       # (altura, polígono) ya dentro de la manzana
    for h, p in sorted(dentro[i], key=lambda t: -t[1].area):
        for q in poligonos(p.intersection(m)):
            if q.area < AREA_MIN_EDIF: continue
            q = como_rectangulo(q, m).simplify(0.4)
            if q.area < AREA_MIN_EDIF or any(q.intersection(o).area > 0.3 * q.area for _, o in puestos): continue
            puestos.append((h, q))
    libre = m.buffer(-0.3).difference(unary_union([q.buffer(0.6) for _, q in puestos]) if puestos else Polygon())
    # ── 4. predios en el frente de la manzana, alineados a la calle; una segunda fila (más angosta, con más huecos) detrás de la primera ──
    for fila, (fondo, hueco) in enumerate([(PRED_FONDO, HUECO_PREDIO), (PRED_FONDO_2, HUECO_FILA_2)]):
        for pol in poligonos(m.buffer(-0.3) if fila == 0 else libre.buffer(-0.3)):
            pol = orient(pol, 1.0)     # exterior antihorario, huecos horarios: la izquierda es siempre el interior
            for lista in [pol.exterior] + list(pol.interiors):
                c = list(lista.coords)
                for (ax, ay), (bx, by) in zip(c, c[1:]):
                    largo = math.hypot(bx - ax, by - ay)
                    if largo < 5: continue
                    ux, uy = (bx - ax) / largo, (by - ay) / largo
                    nx, ny = -uy, ux
                    t = 0.0
                    while t < largo - 4:
                        w, d = rnd.uniform(*PRED_ANCHO), rnd.uniform(*fondo)
                        w = min(w, largo - t)
                        x0, y0 = ax + ux * t, ay + uy * t
                        lote = Polygon([(x0, y0), (x0 + ux * w, y0 + uy * w), (x0 + ux * w + nx * d, y0 + uy * w + ny * d), (x0 + nx * d, y0 + ny * d)])
                        if lote.intersection(libre).area >= 0.9 * lote.area:
                            t += w + 0.3
                            libre = libre.difference(lote.buffer(0.3))
                            if rnd.random() < hueco: continue
                            puestos.append((0.0, lote)); nuevos += 1
                        else:
                            t += 2.5
    salida += puestos

total = [(h, p) for h, p in salida] + fuera
enc = []
for h, g in total:
    for p in poligonos(g):
        pts = list(p.exterior.coords)[:-1]
        if len(pts) >= 3: enc.append(codificar(h, pts, K))
(DATOS / f'edificios-ordenados-{MUNICIPIO}.json').write_text(json.dumps({'k': K, 'e': enc}, separators=(',', ':')), encoding='utf-8')
print(f'edificios: {len(base)} originales -> {len(enc)} ({nuevos} predios nuevos, {grandes} naves intactas, {len(fuera)} fuera del tejido o naves)')
