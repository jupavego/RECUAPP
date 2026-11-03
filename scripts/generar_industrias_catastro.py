"""Fábricas del inventario de emisiones ancladas a su bodega real del catastro (parques industriales como en la vida real).

Cada fábrica de public/data/mapa3d/industrias-<id>.json se asigna a la construcción del catastro que ocupa (la que contiene su
coordenada o la más cercana a menos de TOLERANCIA m, de al menos AREA_MINIMA m²). Una construcción solo se asigna a una fábrica: en
un parque industrial cada empresa es uno de los módulos del parque. El mapa 3D dibuja entonces esa bodega con su contorno real, la
chimenea y el humo sobre ella, en lugar de poner un módulo genérico encogido en otro sitio. Las fábricas sin construcción cerca
conservan la ubicación de siempre.

    public/data/mapa3d/industrias-catastro-<id>.json
        {"<nombre>": {"lon", "lat", "yaw", "largo", "fondo", "pisos", "parque", "poly": [[x, z], ...]}}
        lon/lat: centro de la bodega. yaw: giro (rad) sobre Y del mapa 3D que lleva su fachada (+z local) hacia la vía más cercana.
        largo (x local, a lo largo de la fachada) y fondo (z local) en metros. poly: contorno real en metros, en ese marco local (x, z).
        parque: nombre del parque industrial según la dirección de la fábrica (o null).
    insumos/catastro/industrias-informe-<id>.json   decisión por fábrica (incluye las que quedan con la ubicación de siempre)

Uso:      python scripts/generar_industrias_catastro.py [id_municipio]   (por defecto 49 = Girardota)
Requiere: pip install shapely   (y haber corrido generar_catastro_3d.py)
"""
import json, math, re, sys
from pathlib import Path

import numpy as np
from shapely import make_valid, transform
from shapely.geometry import LineString, Point, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 49
CRUDO = RAIZ / 'insumos/catastro'
SALIDA = RAIZ / f'public/data/mapa3d/industrias-catastro-{MUNICIPIO}.json'
INFORME = CRUDO / f'industrias-informe-{MUNICIPIO}.json'
TOLERANCIA = 17        # m: hasta dónde se busca la bodega cuando la coordenada no cae dentro de una (más lejos la bodega suele ser de otra empresa)
AREA_MINIMA = 150      # m²
AREA_MAXIMA = 12000    # m²: una construcción mayor (centro comercial, ciudadela) no es una bodega de una sola empresa
LADO_MINIMO = 12       # m: una huella más angosta (galpón, cobertizo, franja) no es el módulo de una empresa
ANCHO_VIA = [34, 13, 6]
ALCANCE = 160

relieve = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = relieve['bbox']
LON0, LAT0 = (oeste + este) / 2, (sur + norte) / 2
M_LON, M_LAT = 111320 * math.cos(math.radians(LAT0)), 110574


def a_metros(g):
    return transform(g, lambda c: np.column_stack(((c[:, 0] - LON0) * M_LON, (c[:, 1] - LAT0) * M_LAT)))


def lado_corto(g):
    xs, ys = g.minimum_rotated_rectangle.exterior.coords.xy
    return min(math.hypot(xs[1] - xs[0], ys[1] - ys[0]), math.hypot(xs[2] - xs[1], ys[2] - ys[1]))


construcciones = []                                  # (polígono en metros, pisos, PK)
for nombre in ('urbanas', 'rurales'):
    for f in json.loads((CRUDO / f'construcciones-{nombre}-{MUNICIPIO}.geojson').read_text(encoding='utf-8'))['features']:
        if f.get('geometry'):
            p = f['properties']
            g = make_valid(a_metros(shape(f['geometry']))).buffer(0)
            if g.geom_type == 'Polygon' and AREA_MINIMA <= g.area <= AREA_MAXIMA and lado_corto(g) >= LADO_MINIMO:
                construcciones.append((g, min(max(int(p.get('NO_PISOS') or 1), 1), 15), p['PK_PREDIOS']))
arbol = STRtree([c[0] for c in construcciones])

vj = json.loads((RAIZ / f'public/data/mapa3d/vias-{MUNICIPIO}.json').read_text(encoding='utf-8'))
calzadas = []
for v in vj['v']:
    x, y = v[1], v[2]
    pts = [((x / vj['k'] - LON0) * M_LON, (y / vj['k'] - LAT0) * M_LAT)]
    for i in range(3, len(v), 2):
        x += v[i]; y += v[i + 1]
        pts.append(((x / vj['k'] - LON0) * M_LON, (y / vj['k'] - LAT0) * M_LAT))
    if len(pts) > 1:
        calzadas.append(LineString(pts).buffer(ANCHO_VIA[min(v[0], 2)] / 2))
vias = unary_union(calzadas)


def distancia_a_via(origen, ang):
    rayo = LineString([origen, (origen[0] + math.cos(ang) * ALCANCE, origen[1] + math.sin(ang) * ALCANCE)])
    hit = rayo.intersection(vias)
    return Point(origen).distance(hit) if not hit.is_empty else math.inf


def parque_de(direccion):
    m = re.search(r'(parque\s+(?:industrial|empresarial)[^,]*?|centro\s+log\S*\s+industrial[^,]*?)(?:\s+(?:bodega|ph)\b.*|,.*|$)', direccion or '', re.I)
    return re.sub(r'\s+', ' ', m.group(1)).strip() if m else None


industrias = [f for f in json.loads((RAIZ / f'public/data/mapa3d/industrias-{MUNICIPIO}.json').read_text(encoding='utf-8'))
              if f.get('lat') and f.get('lon') and oeste < f['lon'] < este and sur < f['lat'] < norte]
trabajo = []
for f in industrias:
    pt = Point((f['lon'] - LON0) * M_LON, (f['lat'] - LAT0) * M_LAT)
    cands = sorted((0 if construcciones[i][0].contains(pt) else 1, construcciones[i][0].distance(pt), -construcciones[i][0].area, i)
                   for i in arbol.query(pt.buffer(TOLERANCIA)) if construcciones[i][0].distance(pt) <= TOLERANCIA)
    trabajo.append((f, pt, cands))
trabajo.sort(key=lambda t: (t[2][0][0], t[2][0][1]) if t[2] else (2, 0))
usadas, resultado, informe = set(), {}, {}
for f, pt, cands in trabajo:
    nombre = f['n']
    inf = informe[nombre] = {'parque': parque_de(f.get('dir'))}
    libres = [c for c in cands if c[3] not in usadas]
    if not libres:
        inf['motivo'] = 'sin construcción del catastro a menos de %d m' % TOLERANCIA if not cands else 'sus construcciones cercanas ya son de otra fábrica'
        continue
    prio, d, _, i = libres[0]
    usadas.add(i)
    g, pisos, pk = construcciones[i]
    rect = g.minimum_rotated_rectangle
    xs, ys = rect.exterior.coords.xy
    lados = [(math.hypot(xs[k + 1] - xs[k], ys[k + 1] - ys[k]), math.atan2(ys[k + 1] - ys[k], xs[k + 1] - xs[k])) for k in range(2)]
    eje = max(lados)[1]
    c0 = rect.centroid.coords[0]
    ang = min((eje + k * math.pi / 2 for k in range(4)), key=lambda a: distancia_a_via(c0, a))
    if math.isinf(distancia_a_via(c0, ang)):
        ang = eje + math.pi / 2
    ux, uy = math.cos(ang), math.sin(ang)              # fachada (hacia la vía)
    vx, vy = -uy, ux
    s = g.simplify(0.6, preserve_topology=True)
    pts = list(s.exterior.coords)[:-1]
    loc = [(round((x - c0[0]) * vx + (y - c0[1]) * vy, 1), round((x - c0[0]) * ux + (y - c0[1]) * uy, 1)) for x, y in pts]
    largo = max(p[0] for p in loc) - min(p[0] for p in loc)
    fondo = max(p[1] for p in loc) - min(p[1] for p in loc)
    cx, cz = (max(p[0] for p in loc) + min(p[0] for p in loc)) / 2, (max(p[1] for p in loc) + min(p[1] for p in loc)) / 2
    loc = [[round(x - cx, 1), round(z - cz, 1)] for x, z in loc]
    centro = (c0[0] + vx * cx + ux * cz, c0[1] + vy * cx + uy * cz)
    resultado[nombre] = {'lon': round(LON0 + centro[0] / M_LON, 7), 'lat': round(LAT0 + centro[1] / M_LAT, 7),
                         'yaw': round(math.atan2(ux, -uy), 4), 'largo': round(largo, 1), 'fondo': round(fondo, 1), 'pisos': pisos,
                         'parque': inf['parque'], 'poly': loc}
    inf.update(motivo='coordenada dentro de la construcción' if prio == 0 else f'construcción más cercana, a {d:.0f} m',
               largo=round(largo, 1), fondo=round(fondo, 1), area=round(g.area), pisos=pisos, vertices=len(loc))

SALIDA.write_text(json.dumps(resultado, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
INFORME.write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'{len(resultado)} de {len(industrias)} fábricas ancladas a su bodega -> {SALIDA.relative_to(RAIZ)} ({SALIDA.stat().st_size / 1e3:.0f} KB)')
for n, i in sorted(informe.items(), key=lambda t: (t[1].get('parque') or '~', t[0])):
    print(f"  {(i.get('parque') or '-')[:34]:34s} {n[:36]:36s} {i.get('largo', '-')}x{i.get('fondo', '-')} m {i.get('pisos', '-')}p | {i['motivo']}")
