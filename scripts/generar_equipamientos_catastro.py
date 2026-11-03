"""Ubicación y orientación de los edificios institucionales (colegios, cultura, salud, justicia) según el catastro.

Para cada punto de interés institucional se busca su predio en el catastro de Girardota (predios y construcciones, descargados
por generar_catastro_3d.py y generar_cercas.py en insumos/catastro/), se mide el terreno que ocupan sus construcciones y se
orienta el edificio con su fachada hacia la vía más cercana. El mapa 3D dibuja entonces el modelo simbólico del lugar a la medida
de ese terreno y en lugar de las huellas sueltas del catastro.

Pasos por punto:
  1. Predio: el que contiene al punto y tiene construcciones (confianza «alta»); si el punto cae en una calle o en un lote vacío,
     el predio construido más cercano a menos de TOLERANCIA m (confianza «media» si está a menos de CERCA m, si no «dudosa»).
     Un predio solo se asigna a un punto; si dos puntos coinciden, el segundo busca el siguiente predio.
  2. Terreno: unión de las construcciones del predio, ensanchada MARGEN m y recortada al predio.
  3. Fachada: de las cuatro direcciones del eje del terreno, la que llega primero a una vía (calzada con su ancho).
  4. Medidas: ancho (a lo largo de la fachada) y fondo del terreno en ese marco, centro, pisos (máximo del predio) y áreas.

    public/data/mapa3d/equipamientos-catastro-<id>.json
        {"<nombre del punto>": {"lon", "lat", "yaw", "ancho", "fondo", "pisos", "predio", "conf"}}   solo «alta» y «media»
        yaw: giro (rad) sobre Y del mapa 3D que lleva la fachada (+z del modelo) hacia la vía; ancho/fondo en metros.
    insumos/catastro/equipamientos-informe-<id>.json   todos los puntos, con el motivo de cada decisión (incluye las «dudosas»)

Ajustes a mano en scripts/equipamientos_manuales.json:
    {"<nombre>": {"predio": "<PK_PREDIOS>"}}   fuerza el predio (confianza «alta»)
    {"<nombre>": {"omitir": true}}              deja el punto con la ubicación de siempre

Uso:      python scripts/generar_equipamientos_catastro.py [id_municipio]   (por defecto 49 = Girardota)
Requiere: pip install shapely
"""
import json, math, sys
from pathlib import Path

import numpy as np
from shapely import make_valid, transform
from shapely.geometry import LineString, Point, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 49
CRUDO = RAIZ / 'insumos/catastro'
SALIDA = RAIZ / f'public/data/mapa3d/equipamientos-catastro-{MUNICIPIO}.json'
INFORME = CRUDO / f'equipamientos-informe-{MUNICIPIO}.json'
MANUALES = RAIZ / 'scripts/equipamientos_manuales.json'
CATEGORIAS = {'educacion', 'cultura', 'salud', 'justicia'}
TOLERANCIA = 45        # m: hasta dónde se busca un predio construido cuando el punto no cae en uno
CERCA = 30             # m: a menos de esto el predio vecino es «media»; más lejos, «dudosa»
MAX_SEMILLA_ALTA = 65  # m: distancia máxima del punto a la construcción más cercana de su predio (predio que lo contiene)
MAX_SEMILLA_MEDIA = 40 # m: ídem cuando el punto cae fuera del predio
AREA_MINIMA = 90       # m² construidos para que un predio cuente como institucional
MARGEN = 5             # m: patio y retiro alrededor de las construcciones
UNIR_CONJUNTO = 14     # m: construcciones del predio a menos de esto una de otra forman un mismo conjunto
RADIO_MAXIMO = 90      # m: ninguna construcción del conjunto está más lejos que esto del punto
ANCHO_VIA = [34, 13, 6]
ALCANCE = 160          # m: hasta dónde se mira buscando la vía

relieve = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = relieve['bbox']
LON0, LAT0 = (oeste + este) / 2, (sur + norte) / 2                     # el mismo origen del mapa 3D
M_LON, M_LAT = 111320 * math.cos(math.radians(LAT0)), 110574


def a_metros(g):
    return transform(g, lambda c: np.column_stack(((c[:, 0] - LON0) * M_LON, (c[:, 1] - LAT0) * M_LAT)))


def leer(nombre):
    return json.loads((CRUDO / nombre).read_text(encoding='utf-8'))['features']


# ── catastro ────────────────────────────────────────────────────────────────────────────────────────
predios = {}                                        # PK → polígono en metros
for nombre in ('urbanos', 'rurales'):
    for f in leer(f'predios-{nombre}-{MUNICIPIO}.geojson'):
        if f.get('geometry'):
            predios[f['properties']['PK_PREDIOS']] = make_valid(a_metros(shape(f['geometry']))).buffer(0)
construcciones = {}                                 # PK → [(polígono, pisos)]
for nombre in ('urbanas', 'rurales'):
    for f in leer(f'construcciones-{nombre}-{MUNICIPIO}.geojson'):
        if f.get('geometry'):
            p = f['properties']
            pisos = min(max(int(p.get('NO_PISOS') or 1), 1), 15)
            construcciones.setdefault(p['PK_PREDIOS'], []).append((make_valid(a_metros(shape(f['geometry']))).buffer(0), pisos))
area_construida = {pk: sum(g.area for g, _ in cs) for pk, cs in construcciones.items()}
claves = list(predios)
arbol = STRtree([predios[k] for k in claves])

# ── vías ────────────────────────────────────────────────────────────────────────────────────────────
vias_json = json.loads((RAIZ / f'public/data/mapa3d/vias-{MUNICIPIO}.json').read_text(encoding='utf-8'))
calzadas = []
for v in vias_json['v']:
    x, y, pts = v[1], v[2], []
    pts.append(((x / vias_json['k'] - LON0) * M_LON, (y / vias_json['k'] - LAT0) * M_LAT))
    for i in range(3, len(v), 2):
        x += v[i]; y += v[i + 1]
        pts.append(((x / vias_json['k'] - LON0) * M_LON, (y / vias_json['k'] - LAT0) * M_LAT))
    if len(pts) > 1:
        calzadas.append(LineString(pts).buffer(ANCHO_VIA[min(v[0], 2)] / 2))
vias = unary_union(calzadas)


def distancia_a_via(origen, ang):
    """Metros desde `origen` hasta la primera calzada en la dirección `ang` (rad, eje x hacia el este, y hacia el norte); inf si no hay."""
    rayo = LineString([origen, (origen[0] + math.cos(ang) * ALCANCE, origen[1] + math.sin(ang) * ALCANCE)])
    hit = rayo.intersection(vias)
    return Point(origen).distance(hit) if not hit.is_empty else math.inf


# ── puntos ──────────────────────────────────────────────────────────────────────────────────────────
puntos = [p for p in json.loads((RAIZ / f'public/data/mapa/puntos/{MUNICIPIO}.json').read_text(encoding='utf-8'))['puntos']
          if p['c'] in CATEGORIAS and p.get('lat') is not None and p.get('lng') is not None]
manuales = json.loads(MANUALES.read_text(encoding='utf-8')) if MANUALES.exists() else {}


def candidatos(pt):
    """(prioridad, distancia, PK) de los predios construidos cerca del punto: primero el que lo contiene, luego los más cercanos."""
    res = []
    for i in arbol.query(pt.buffer(TOLERANCIA)):
        pk = claves[i]
        if area_construida.get(pk, 0) < AREA_MINIMA:
            continue
        d = predios[pk].distance(pt)
        if d <= TOLERANCIA:
            res.append((0 if d == 0 else 1, d, pk))
    return sorted(res)


# los puntos que caen dentro de un predio construido se asignan primero; el resto toma lo que queda libre
trabajo = []
for p in puntos:
    pt = Point((p['lng'] - LON0) * M_LON, (p['lat'] - LAT0) * M_LAT)
    trabajo.append((p, pt, candidatos(pt)))
trabajo.sort(key=lambda t: (t[2][0][0] if t[2] else 2, t[2][0][1] if t[2] else 0))
asignado = {}                                       # PK → nombre
resultado, informe = {}, {}
for p, pt, cands in trabajo:
    nombre, man = p['n'], manuales.get(p['n'], {})
    inf = informe[nombre] = {'categoria': p['c'], 'tipo': p['t'], 'conf': 'sin predio'}
    if man.get('omitir'):
        inf['motivo'] = 'omitido a mano'
        continue
    pk, conf = None, None
    if man.get('predio') in predios:
        pk, conf, inf['motivo'] = man['predio'], 'alta', 'predio elegido a mano'
    else:
        libres = [c for c in cands if c[2] not in asignado]
        if libres:
            prio, d, pk = libres[0]
            conf = 'alta' if prio == 0 else ('media' if d <= CERCA else 'dudosa')
            inf['motivo'] = 'el punto cae dentro del predio' if prio == 0 else f'predio construido más cercano, a {d:.0f} m del punto'
            if cands and libres[0] is not cands[0]:
                inf['motivo'] += f' (el más cercano ya era de «{asignado[cands[0][2]]}»)'
        else:
            inf['motivo'] = 'ningún predio construido a menos de %d m' % TOLERANCIA if not cands else f'sus predios cercanos ya son de «{asignado[cands[0][2]]}»'
    if pk is None:
        continue
    inf.update(predio=pk, conf=conf)
    if conf == 'dudosa':
        continue
    asignado[pk] = nombre

    # terreno: el conjunto de construcciones del predio que rodea al punto (en un lote rural hay fincas enteras), con su patio, dentro del lote
    todas = construcciones[pk]
    cs = [min(todas, key=lambda c: c[0].distance(pt))]
    resto = [c for c in todas if c is not cs[0]]
    crecio = True
    while crecio:
        crecio = False
        cerca = unary_union([g for g, _ in cs]).buffer(UNIR_CONJUNTO)
        for c in list(resto):
            if c[0].intersects(cerca) and c[0].distance(pt) <= RADIO_MAXIMO:
                cs.append(c); resto.remove(c); crecio = True
    semilla = cs[0][0].distance(pt)
    if semilla > (MAX_SEMILLA_ALTA if conf == 'alta' else MAX_SEMILLA_MEDIA):    # un lote enorme con una sola construcción lejos del punto no es confiable
        inf['conf'] = 'dudosa'
        inf['motivo'] += f'; la construcción más cercana del predio está a {semilla:.0f} m del punto'
        del asignado[pk]
        continue
    terreno = unary_union([g for g, _ in cs]).buffer(MARGEN).intersection(predios[pk])
    rect = terreno.minimum_rotated_rectangle
    xs, ys = rect.exterior.coords.xy
    lados = [(math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]), math.atan2(ys[i + 1] - ys[i], xs[i + 1] - xs[i])) for i in range(2)]
    eje = max(lados)[1]                             # dirección del lado largo
    c0 = rect.centroid.coords[0]
    # fachada: de las cuatro direcciones del eje, la que llega primero a una vía
    ang = min((eje + k * math.pi / 2 for k in range(4)), key=lambda a: distancia_a_via(c0, a))
    d_via = distancia_a_via(c0, ang)
    if math.isinf(d_via):                           # sin vía a la vista: la fachada sigue el lado corto
        ang = eje + math.pi / 2
    ux, uy = math.cos(ang), math.sin(ang)
    vx, vy = -uy, ux
    pts = [c for g in ([terreno] if terreno.geom_type == 'Polygon' else terreno.geoms) for c in g.exterior.coords]
    us = [(x - c0[0]) * ux + (y - c0[1]) * uy for x, y in pts]
    vs = [(x - c0[0]) * vx + (y - c0[1]) * vy for x, y in pts]
    fondo, ancho = max(us) - min(us), max(vs) - min(vs)
    cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
    cx, cy = c0[0] + ux * cu + vx * cv, c0[1] + uy * cu + vy * cv
    pisos = max(n for _, n in cs)
    inf.update(ancho=round(ancho, 1), fondo=round(fondo, 1), pisos=pisos, construido=round(sum(g.area for g, _ in cs)), lote=round(predios[pk].area),
               via=None if math.isinf(d_via) else round(d_via))
    if conf == 'media' or math.isinf(d_via):
        inf['aviso'] = 'sin vía a la vista' if math.isinf(d_via) else 'punto fuera del predio'
    # al mapa 3D: z crece hacia el sur, así que la fachada (+z del modelo) apunta a (este, -norte) y el giro es atan2(este, -norte)
    resultado[nombre] = {'lon': round(LON0 + cx / M_LON, 7), 'lat': round(LAT0 + cy / M_LAT, 7), 'yaw': round(math.atan2(ux, -uy), 4),
                         'ancho': round(ancho, 1), 'fondo': round(fondo, 1), 'pisos': pisos, 'predio': pk, 'conf': conf}

SALIDA.write_text(json.dumps(resultado, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
INFORME.write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'{len(resultado)} de {len(puntos)} puntos ajustados -> {SALIDA.relative_to(RAIZ)}  (informe: {INFORME.relative_to(RAIZ)})')
for nombre, inf in sorted(informe.items(), key=lambda t: (t[1]['conf'], t[0])):
    print(f"  {inf['conf']:10s} {nombre[:48]:48s} {inf.get('ancho', '-')}x{inf.get('fondo', '-')} m, {inf.get('pisos', '-')} pisos | {inf.get('motivo', '')}"
          + (f" | {inf['aviso']}" if 'aviso' in inf else ''))
