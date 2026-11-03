"""Construcciones reales del catastro de un municipio para el mapa 3D (reemplazan a las huellas de Overture/OSM).

Fuente: servicio cartográfico del Área Metropolitana del Valle de Aburrá, «Girardota_Catastro», capas 4 (Construcciones
Urbanas) y 5 (Construcciones Rurales), © Alcaldía de Girardota, Catastro.
    https://portalidem.metropol.gov.co/server/rest/services/Girardota_Catastro/MapServer

Cada huella se conserva con su contorno real y sus pisos. Solo se unen las huellas de un mismo predio que se tocan y tienen
los mismos pisos y uso (así una casa de 3 pisos con un patio de 1 piso conserva sus dos alturas). Se descartan las menores de
AREA_MINIMA m² (balcones, escaleras, anexos) y se simplifica el contorno a SIMPLIFICAR m. Donde dos huellas se montan una sobre
otra, a la más baja se le resta lo que cubre la más alta, para no dibujar dos volúmenes en el mismo sitio.

    insumos/catastro/construcciones-<capa>-<id>.geojson   copia cruda de la descarga (se reutiliza; --refrescar la baja de nuevo)
    public/data/mapa3d/catastro-<id>.json
        {"k": 1e6, "e": [[altura_m, x0, y0, dx, dy, ...], ...], "p": [pisos], "u": [uso], "r": [origen]}
        enteros = grados × k, primera pareja absoluta y el resto diferencias; el contorno va abierto.
        pisos: 0 si se desconoce. uso: 0 residencial o sin dato, 1 comercial, 2 industrial.
        origen: 0 catastro urbano, 1 catastro rural, 2 complemento (huellas de Overture/OSM de edificios-<id>.json, solo donde
        el catastro no tiene cobertura: el servicio no cubre todo el municipio).

Uso:      python scripts/generar_catastro_3d.py [id_municipio] [--refrescar]   (por defecto 49 = Girardota)
Requiere: pip install shapely
"""
import json, math, sys, urllib.parse, urllib.request
from collections import Counter, defaultdict
from pathlib import Path

from shapely import make_valid
from shapely.geometry import LineString, Polygon, box, shape
from shapely.strtree import STRtree
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

RAIZ = Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if not a.startswith('--')]
MUNICIPIO = int(args[0]) if args else 49
REFRESCAR = '--refrescar' in sys.argv
SERVICIO = 'https://portalidem.metropol.gov.co/server/rest/services/Girardota_Catastro/MapServer'
CAPAS = {'urbanas': 4, 'rurales': 5}
CAMPOS = 'PK_PREDIOS,USO,NO_PISOS'
CRUDO = RAIZ / 'insumos/catastro'
SALIDA = RAIZ / f'public/data/mapa3d/catastro-{MUNICIPIO}.json'
K = 1_000_000
ALTO_PISO = 3.0           # m
MAX_PISOS = 15            # el catastro trae algún registro de 19-20 pisos que es un error
AREA_MINIMA = 10          # m²
CELDA_COBERTURA = 250     # m, celda con al menos MIN_COBERTURA construcciones del catastro = zona cubierta
MIN_COBERTURA = 2
SIMPLIFICAR = 0.35        # m
TRASLAPE_MINIMO = 2        # m², traslapes menores se ignoran
UNIR = 0.1                # m, huellas del mismo predio a menos de esto se funden
USOS = {'C': 1, 'I': 2}
MODULOS_MINIMOS = 3       # huellas de un predio que, con área mediana de AREA_MODULO m² o más, se dejan como módulos sueltos (bodegas en hilera)
AREA_MODULO = 150

relieve = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = relieve['bbox']
M_LON, M_LAT = 111320 * math.cos(math.radians((sur + norte) / 2)), 110574


def descargar(nombre, capa):
    destino = CRUDO / f'construcciones-{nombre}-{MUNICIPIO}.geojson'
    if destino.exists() and not REFRESCAR:
        return json.loads(destino.read_text(encoding='utf-8'))['features']
    CRUDO.mkdir(parents=True, exist_ok=True)
    feats, desde = [], 0
    while True:
        q = urllib.parse.urlencode({
            'where': '1=1', 'geometry': f'{oeste},{sur},{este},{norte}', 'geometryType': 'esriGeometryEnvelope',
            'inSR': 4326, 'outSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': CAMPOS,
            'geometryPrecision': 7, 'resultOffset': desde, 'resultRecordCount': 2000, 'f': 'geojson'})
        req = urllib.request.Request(f'{SERVICIO}/{capa}/query?{q}', headers={'User-Agent': 'recuapp-poc/0.1'})
        lote = json.loads(urllib.request.urlopen(req, timeout=120).read()).get('features', [])
        feats += lote
        print(f'  {nombre}: {len(feats)}', end='\r')
        if len(lote) < 2000:
            break
        desde += 2000
    destino.write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}, separators=(',', ':')), encoding='utf-8')
    print(f'  {nombre}: {len(feats)} huellas -> {destino.relative_to(RAIZ)} ({destino.stat().st_size / 1e6:.1f} MB)')
    return feats


def a_metros(g):
    from shapely import transform
    import numpy as np
    return transform(g, lambda c: np.column_stack(((c[:, 0] - oeste) * M_LON, (c[:, 1] - sur) * M_LAT)))


def deltas(anillo):
    t = [(round((x / M_LON + oeste) * K), round((y / M_LAT + sur) * K)) for x, y in anillo]
    sal = [t[0][0], t[0][1]]
    for (ax, ay), (bx, by) in zip(t, t[1:]):
        sal += [bx - ax, by - ay]
    return sal


def sin_huecos(g):
    """Un polígono con huecos (un zócalo con la torre adentro) se parte con una línea que cruza cada hueco: el visor solo dibuja contornos."""
    pendientes, listos = [g], []
    while pendientes:
        q = pendientes.pop()
        if q.is_empty or q.geom_type != 'Polygon':
            for sub in (getattr(q, 'geoms', [])):
                pendientes.append(sub)
            continue
        if not q.interiors:
            listos.append(q)
            continue
        hx = Polygon(q.interiors[0]).centroid.x
        x0, y0, x1, y1 = q.bounds
        for mitad in (box(x0 - 1, y0 - 1, hx, y1 + 1), box(hx, y0 - 1, x1 + 1, y1 + 1)):
            pendientes.append(q.intersection(mitad))
    return listos


edificios, pisos_l, usos_l, rural_l = [], [], [], []
descartadas = Counter()
huellas = []                       # (polígono en metros, pisos, uso, origen)
for nombre, capa in CAPAS.items():
    feats = descargar(nombre, capa)
    grupos = defaultdict(list)
    for f in feats:
        if not f.get('geometry'):
            continue
        p = f['properties']
        pisos = min(max(int(p.get('NO_PISOS') or 1), 1), MAX_PISOS)
        grupos[(p['PK_PREDIOS'], pisos, USOS.get(p.get('USO'), 0))].append(make_valid(a_metros(shape(f['geometry']))))
    for (_, pisos, uso), gs in grupos.items():
        # una hilera de bodegas de un mismo predio (parque industrial en propiedad horizontal) se queda en módulos, uno al lado del otro
        modulos = len(gs) >= MODULOS_MINIMOS and sorted(g.area for g in gs)[len(gs) // 2] >= AREA_MODULO
        fundida = unary_union([g.buffer(0) for g in gs]) if modulos else unary_union([g.buffer(UNIR) for g in gs]).buffer(-UNIR)
        for parte in ([g.buffer(0) for g in gs] if modulos else (fundida.geoms if hasattr(fundida, 'geoms') else [fundida])):
            if parte.is_empty or parte.geom_type != 'Polygon' or parte.area < AREA_MINIMA:
                descartadas[nombre] += 1
                continue
            huellas.append((parte, pisos, uso, 1 if nombre == 'rurales' else 0))

# ── traslapes: el catastro guarda huellas montadas unas sobre otras (un zócalo de 1 piso con una torre dentro, por ejemplo).
# Dibujarlas completas pone dos volúmenes en el mismo sitio, así que a la más baja se le resta lo que cubre la más alta.
arbol = STRtree([h[0] for h in huellas])
recortadas = 0
for i, (g, pisos, uso, origen) in enumerate(huellas):
    resta = [huellas[j][0] for j in arbol.query(g)
             if j != i and (huellas[j][1] > pisos or (huellas[j][1] == pisos and j < i)) and huellas[j][0].intersection(g).area > TRASLAPE_MINIMO]
    if resta:
        g = g.difference(unary_union(resta))
        recortadas += 1
    for parte in sin_huecos(g):
        if parte.area < AREA_MINIMA:
            continue
        s = parte.simplify(SIMPLIFICAR, preserve_topology=True)
        if s.is_empty or s.geom_type != 'Polygon' or s.area < AREA_MINIMA:
            continue
        anillo = list(orient(Polygon(s.exterior), 1.0).exterior.coords)[:-1]
        if len(anillo) < 3:
            continue
        edificios.append([round(pisos * ALTO_PISO, 1)] + deltas(anillo))
        pisos_l.append(pisos); usos_l.append(uso); rural_l.append(origen)
print(f'catastro: {len(edificios)} construcciones ({recortadas} recortadas por traslape; descartadas por pequeñas: {dict(descartadas)})')

# ── complemento: huellas de Overture/OSM solo donde el catastro no llega ──────────────────────────────
def celda(x, y):
    return int(x // CELDA_COBERTURA), int(y // CELDA_COBERTURA)


def centro_delta(a, k):
    x, y = a[1], a[2]
    xs, ys = [x], [y]
    for i in range(3, len(a), 2):
        x += a[i]; y += a[i + 1]; xs.append(x); ys.append(y)
    return (sum(xs) / len(xs) / k - oeste) * M_LON, (sum(ys) / len(ys) / k - sur) * M_LAT


# Urbanizaciones en propiedad horizontal que el catastro no trae como construcciones (Llano Azul, junto a la unidad deportiva). Ahí no se
# toman las huellas de Overture/OSM (agrupan las hileras en bloques informes): se arman los bloques de casas adosadas de 2 pisos a ambos lados
# de las calles locales de la zona, como en la imagen satelital. (oeste, este, sur, norte) en grados.
ZONAS_URBANIZACION = [(-75.4513, -75.4486, 6.3705, 6.3727)]
ANCHO_VIA = [34, 13, 6]    # m, ancho con que el mapa dibuja las vías de cada clase (ANCHO_VIA en mapa3d.component.ts)
RETIRO, FONDO_CASA = 3.0, 10.0
LARGO_BLOQUE, PASAJE = (28, 44), (4, 6)   # m: largo de un bloque de casas adosadas y pasaje entre bloques


def bloques_de_urbanizacion(zona):
    """Rectángulos (en metros) de bloques de casas adosadas frente a las calles locales de la zona, sin pisar vías ni otros bloques."""
    from shapely.ops import substring
    import random
    d = json.loads((RAIZ / f'public/data/mapa3d/vias-{MUNICIPIO}.json').read_text(encoding='utf-8'))
    lineas = []
    for v in d['v']:
        x, y, pts = v[1], v[2], [(v[1], v[2])]
        for i in range(3, len(v), 2):
            x += v[i]; y += v[i + 1]; pts.append((x, y))
        if len(pts) > 1:
            lineas.append((v[0], LineString([((px / d['k'] - oeste) * M_LON, (py / d['k'] - sur) * M_LAT) for px, py in pts])))
    recinto = box((zona[0] - oeste) * M_LON, (zona[2] - sur) * M_LAT, (zona[1] - oeste) * M_LON, (zona[3] - sur) * M_LAT)
    calzadas = unary_union([l.buffer(ANCHO_VIA[c] / 2 + 1.5) for c, l in lineas])
    azar, bloques = random.Random(2025), []
    desplazamiento = ANCHO_VIA[1] / 2 + RETIRO + FONDO_CASA / 2
    for clase, linea in lineas:
        if clase != 1 or not linea.intersects(recinto):
            continue
        tramo = linea.intersection(recinto)
        for parte in (tramo.geoms if hasattr(tramo, 'geoms') else [tramo]):
            if parte.geom_type != 'LineString' or parte.length < LARGO_BLOQUE[0]:
                continue
            for lado in ('left', 'right'):
                paralela = parte.parallel_offset(desplazamiento, lado)
                for frente in (paralela.geoms if hasattr(paralela, 'geoms') else [paralela]):
                    if frente.geom_type != 'LineString' or frente.length < LARGO_BLOQUE[0]:
                        continue
                    s = azar.uniform(0, PASAJE[1])
                    while True:
                        largo = azar.uniform(*LARGO_BLOQUE)
                        if s + largo > frente.length:
                            break
                        casa = substring(frente, s, s + largo).buffer(FONDO_CASA / 2, cap_style=2, join_style=2).simplify(0.3)
                        s += largo + azar.uniform(*PASAJE)
                        if casa.geom_type != 'Polygon' or not casa.within(recinto) or casa.intersects(calzadas):
                            continue
                        if any(casa.buffer(1.5).intersects(o) for o in bloques):
                            continue
                        bloques.append(casa)
    return bloques


por_celda = Counter()
for b in edificios:
    por_celda[celda(*centro_delta(b, K))] += 1
overture = json.loads((RAIZ / f'public/data/mapa3d/edificios-{MUNICIPIO}.json').read_text(encoding='utf-8'))
nuevos, en_cubierta = 0, 0
for b in overture['e']:
    cx, cy = centro_delta(b, overture['k'])
    lon_c, lat_c = cx / M_LON + oeste, cy / M_LAT + sur
    if any(z[0] < lon_c < z[1] and z[2] < lat_c < z[3] for z in ZONAS_URBANIZACION):
        continue                       # las urbanizaciones se arman aparte (bloques_de_urbanizacion)
    if por_celda[celda(cx, cy)] >= MIN_COBERTURA:
        en_cubierta += 1
        continue
    pts, x, y = [], b[1], b[2]
    pts.append((x, y))
    for i in range(3, len(b), 2):
        x += b[i]; y += b[i + 1]; pts.append((x, y))
    anillo = [((px / overture['k'] - oeste) * M_LON, (py / overture['k'] - sur) * M_LAT) for px, py in pts]
    edificios.append([b[0]] + deltas(anillo))
    pisos_l.append(0); usos_l.append(0); rural_l.append(2)
    nuevos += 1
for zona in ZONAS_URBANIZACION:
    casas = bloques_de_urbanizacion(zona)
    for g in casas:
        edificios.append([2 * ALTO_PISO] + deltas(list(orient(g, 1.0).exterior.coords)[:-1]))
        pisos_l.append(2); usos_l.append(0); rural_l.append(2)
    print(f'urbanización {zona}: {len(casas)} bloques de casas adosadas (2 pisos)')
print(f'complemento: {nuevos} huellas de Overture fuera de la cobertura del catastro ({en_cubierta} dentro de ella, ignoradas)')

SALIDA.write_text(json.dumps({'k': K, 'e': edificios, 'p': pisos_l, 'u': usos_l, 'r': rural_l}, separators=(',', ':')), encoding='utf-8')
print(f'{SALIDA.name}: {len(edificios)} construcciones, {SALIDA.stat().st_size / 1e6:.2f} MB')
print('pisos:', dict(sorted(Counter(pisos_l).items())), '| uso:', dict(Counter(usos_l)))
