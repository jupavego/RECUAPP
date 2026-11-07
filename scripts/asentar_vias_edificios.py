"""Asienta las vías y las construcciones del mapa 3D sobre el relieve y entre sí, como en la calle real.

Problema que resuelve: las huellas del catastro se dibujan a su tamaño real, pero las calles se dibujaban a un ancho fijo
(13 m de calzada y 17,5 m con acera en una calle local) mientras que la fachada de enfrente está, en la mediana, a 11 m. La
calzada y la acera tapaban la planta baja y la puerta de las casas. Además, la calzada era una cinta plana a 3 m sobre el
terreno del eje: en una ladera flotaba de un lado y enterraba el otro, y cada casa tomaba como piso el punto más bajo de su
huella, así que la puerta quedaba por debajo de la acera.

Pasos (todo en metros locales, con el mismo relieve que dibuja el mapa):

  1. Casas: las que dan a una vía y quedaron giradas unos grados respecto a ella se alinean con la vía (girando sobre su
     centro), y las que pisan la calzada mínima se empujan hacia afuera (hasta EMPUJE_MAX m), sin montarse sobre otra casa.
     El catastro urbano es real: se gira muy poco. Las huellas del complemento (Overture/OSM) y las rurales, más.
  2. Ancho de la calle: en cada punto del eje se mide la distancia a la primera fachada a cada lado. La calzada y la acera
     se angostan para caber en ese hueco (nunca por debajo de MEDIA_MINIMA ni por encima del ancho dibujado de siempre) y
     el cambio de ancho se suaviza para que no haga dientes en los huecos entre casas.
  3. Rasante: la calzada sigue el terreno del eje, con un peralte limitado (PERALTE), y se levanta lo justo para que el
     terreno dibujado (la malla de triángulos del mapa, no solo la interpolación) no la atraviese. La acera va un bordillo
     por encima de la calzada y sube con el terreno hacia la fachada (hasta SUBIDA_ACERA).
  4. Piso de cada casa: el nivel de la acera frente a ella (la puerta queda al ras de la acera, no tapada). La que no da a
     ninguna vía conserva el piso que el mapa calcula del terreno.

Entradas:  public/data/mapa3d/relieve-<id>.json, vias-<id>.json, catastro-<id>.json
Salidas:   public/data/mapa3d/rasante-<id>.json
               {"k": 1e6, "v": [[clase, x0, y0, dx, dy, ...]], "w": [[wa, wb, aa, ab, ...]], "y": [[ya, yb, yaa, yab, ...]]}
               vías principales y locales densificadas (las mismas que vias-<id>.json, con sus vértices originales).
               Por punto: media calzada y borde exterior de la acera a cada lado (dm) y altura de cada borde (cm sobre el
               mínimo del relieve, sin exagerar); el primer punto absoluto y los demás como diferencias con el anterior. Lado a = (ty, -tx) en este/norte, el primer vértice de la cinta del mapa.
           public/data/mapa3d/catastro-asentado-<id>.json
               el mismo formato de catastro-<id>.json con las huellas giradas o empujadas y "n": piso de cada una (cm sobre el
               mínimo del relieve, sin exagerar) o null.
           insumos/asentamiento/conflictos-<id>.geojson
               construcciones que el eje de una vía atraviesa (el trazado de la vía y el catastro no coinciden): para revisar.

Uso:      python -I scripts/asentar_vias_edificios.py [id_municipio]   (por defecto 49 = Girardota)
Requiere: pip install shapely numpy     (un solo proceso, ~1 min y < 1 GB)
"""
import base64, json, math, sys, time
from pathlib import Path

import numpy as np
import shapely
from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Polygon
from shapely.ops import nearest_points
from shapely.strtree import STRtree

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 else 49
DATOS = RAIZ / 'public/data/mapa3d'
K = 1_000_000

ANCHO_VIA = [34, 13]          # m, ancho de calzada dibujado de siempre (ANCHO_VIA del mapa 3D): es el tope
ANDEN = [5.1, 2.3]            # m, acera de siempre (la cinta 1,3× / 1,35× del mapa): también es tope
MEDIA_MINIMA = [4.5, 3.0]     # m, media calzada mínima: dos carros a escala caben (ESCALA_ACTIVOS = 1,8)
ANDEN_MINIMO = 0.9            # m que se dejan para acera entre la calzada y la fachada cuando hay sitio
HOLGURA_FACHADA = 0.25        # la acera termina a esto de la fachada
TALUD_ANCHO = 0.2             # m de ancho que puede cambiar por cada m de vía (1:5), para que no haga dientes
PASO_URBANO, PASO_RURAL = 6.0, 20.0   # m entre puntos del eje: donde hay construcciones a menos de CERCA m, y donde no
CERCA = 25.0
PERALTE = 0.06                # pendiente transversal máxima de la calzada (real, el mapa la exagera)
EPS = 0.35                    # m reales sobre el terreno dibujado (0,56 m en el mapa, con EXAGERACION 1,6)
BORDILLO = 0.15               # m que la acera queda por encima de la calzada
SUBIDA_ACERA = 0.8            # m que la acera puede subir hacia la fachada en un corte de ladera
FRENTE = [14.0, 10.0]         # m del eje a la casa para que se considere que da a la vía (principal, local)
GIRO_MIN = 2.0                # grados: menos que esto no se toca
GIRO_MAX = {0: 12.0, 1: 25.0, 2: 30.0}   # grados por origen: catastro urbano, rural, complemento
AREA_MAX_GIRO = 1500          # m²: los galpones y bloques grandes no se giran
RECTANGULAR = 0.75            # área / área del rectángulo mínimo: solo se giran huellas casi rectangulares
EMPUJE_MAX = 3.0              # m
TRASLAPE_TOLERADO = 1.0       # m² de traslape nuevo con otra casa que se acepta al girar o empujar
AREA_MAX_PISO = 2500          # m²: a las huellas más grandes no se les fija el piso por la acera

relieve = json.loads((DATOS / f'relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
OESTE, SUR, ESTE, NORTE = relieve['bbox']
NX, NY, MINIMO = relieve['nx'], relieve['ny'], relieve['min']
M_LON, M_LAT = 111320 * math.cos(math.radians((SUR + NORTE) / 2)), 110574
ALT = np.frombuffer(base64.b64decode(relieve['dm']), dtype='<i2').astype(np.float64).reshape(NY, NX) / 10 - MINIMO


def leer(nombre):
    return json.loads((DATOS / nombre).read_text(encoding='utf-8'))


def anillo(a, k, desde):
    x, y, out = a[desde], a[desde + 1], []
    out.append(((x / k - OESTE) * M_LON, (y / k - SUR) * M_LAT))
    for i in range(desde + 2, len(a), 2):
        x += a[i]; y += a[i + 1]
        out.append(((x / k - OESTE) * M_LON, (y / k - SUR) * M_LAT))
    return out


def codificar(cabeza, pts):
    ent = [(round((x / M_LON + OESTE) * K), round((y / M_LAT + SUR) * K)) for x, y in pts]
    out = list(cabeza) + [ent[0][0], ent[0][1]]
    for (ax, ay), (bx, by) in zip(ent, ent[1:]):
        out += [bx - ax, by - ay]
    return out


def suelo(x, y):
    """Altura (m sobre el mínimo, sin exagerar) del terreno dibujado: la mayor entre la interpolación bilineal (alturaEn del
    mapa, que siguen las cintas) y la malla de triángulos (diagonal de b a c, como en construirTerreno)."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    fx = np.clip((x / M_LON) / (ESTE - OESTE), 0, 1) * (NX - 1)
    fy = np.clip((NORTE - SUR - y / M_LAT) / (NORTE - SUR), 0, 1) * (NY - 1)
    x0 = np.minimum(np.floor(fx).astype(int), NX - 2); y0 = np.minimum(np.floor(fy).astype(int), NY - 2)
    tx, ty = fx - x0, fy - y0
    a, b, c, d = ALT[y0, x0], ALT[y0, x0 + 1], ALT[y0 + 1, x0], ALT[y0 + 1, x0 + 1]
    bil = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
    tri = np.where(tx + ty <= 1, a + (b - a) * tx + (c - a) * ty, d + (c - d) * (1 - tx) + (b - d) * (1 - ty))
    return np.maximum(bil, tri)


def poligono(pts):
    p = Polygon(pts)
    return p if p.is_valid else p.buffer(0)


def angulo_casa(p):
    q = list(p.minimum_rotated_rectangle.exterior.coords)
    l1, l2 = math.dist(q[0], q[1]), math.dist(q[1], q[2])
    a, b = (q[0], q[1]) if l1 >= l2 else (q[1], q[2])
    return math.atan2(b[1] - a[1], b[0] - a[0])


def rumbo(L, t):
    a, b = L.interpolate(max(0.0, t - 6)), L.interpolate(min(L.length, t + 6))
    return math.atan2(b.y - a.y, b.x - a.x)


t0 = time.time()
# ── entradas ─────────────────────────────────────────────────────────────
vias_d = leer(f'vias-{MUNICIPIO}.json')
cat = leer(f'catastro-{MUNICIPIO}.json')
vias = [(v[0], LineString(anillo(v, vias_d['k'], 1))) for v in vias_d['v'] if v[0] <= 1 and len(v) >= 5]
lineas = [L for _, L in vias]
arbol_vias = STRtree(lineas)
casas = [poligono(anillo(e, cat['k'], 1)) if len(e) >= 7 else Polygon() for e in cat['e']]
origen = cat['r']
arbol_casas = STRtree([c.buffer(EMPUJE_MAX + 1) if not c.is_empty else c for c in casas])
print(f'{len(vias)} vías principales y locales, {len(casas)} construcciones ({time.time() - t0:.0f} s)')


# ── 1. alinear y despejar las casas que dan a una vía ────────────────────
def traslape(p, i):
    return sum(p.intersection(casas[j]).area for j in arbol_casas.query(p) if j != i and not casas[j].is_empty)


def via_mas_cercana(p):
    mejor = None
    for j in arbol_vias.query(p.buffer(FRENTE[0])):
        c, L = vias[j]
        d = L.distance(p)
        if d <= FRENTE[c] and (mejor is None or d < mejor[0]):
            mejor = (d, j)
    return mejor


from collections import Counter
girados = empujados = 0
por_origen = Counter()
conflictos = []
for i, p in enumerate(casas):
    if p.is_empty or p.area < 8:
        continue
    cerca = via_mas_cercana(p)
    if not cerca:
        continue
    d, j = cerca
    clase, L = vias[j]
    if d == 0:
        conflictos.append(i)
        continue
    nuevo = p
    # giro
    if p.area <= AREA_MAX_GIRO and p.area / max(p.minimum_rotated_rectangle.area, 1e-6) >= RECTANGULAR:
        dv = math.degrees(angulo_casa(p) - rumbo(L, L.project(p.centroid)))
        dv = (dv + 45) % 90 - 45
        if GIRO_MIN <= abs(dv) <= GIRO_MAX.get(origen[i], 12):
            g = rotate(p, -dv, origin=p.centroid)
            if traslape(g, i) <= traslape(p, i) + TRASLAPE_TOLERADO:
                nuevo = g
                girados += 1
                por_origen[origen[i]] += 1
    # empuje fuera de la calzada mínima
    req = MEDIA_MINIMA[clase] + ANDEN_MINIMO
    d = L.distance(nuevo)
    if 0 < d < req and req - d <= EMPUJE_MAX:
        a, b = nearest_points(L, nuevo)
        ux, uy = b.x - a.x, b.y - a.y
        n = math.hypot(ux, uy) or 1
        e = translate(nuevo, ux / n * (req - d + 0.05), uy / n * (req - d + 0.05))
        otras = [k for k in arbol_vias.query(e.buffer(FRENTE[0])) if k != j]
        choca = any(vias[k][1].distance(e) < min(MEDIA_MINIMA[vias[k][0]] + ANDEN_MINIMO, vias[k][1].distance(nuevo)) for k in otras)
        if not choca and traslape(e, i) <= traslape(nuevo, i) + TRASLAPE_TOLERADO:
            nuevo = e
            empujados += 1
    casas[i] = nuevo
print(f'casas: {girados} alineadas con su vía, {empujados} despejadas de la calzada, {len(conflictos)} atravesadas por el eje ({time.time() - t0:.0f} s)')
print(f'  alineadas por origen (0 catastro urbano, 1 rural, 2 complemento): {dict(sorted(por_origen.items()))}')

# ── 2 y 3. ancho y rasante de cada vía ────────────────────────────────────
validas = [i for i, c in enumerate(casas) if not c.is_empty]
arbol_fachadas = STRtree([casas[i] for i in validas])


def densificar(L, paso):
    q = list(L.coords)
    out = [q[0]]
    for a, b in zip(q, q[1:]):
        n = max(1, math.ceil(math.dist(a, b) / paso))
        out += [(a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n) for t in range(1, n + 1)]
    return np.array(out)


def diferencias(m):
    """Columnas de enteros (un renglón por punto) → lista plana: el primer renglón absoluto y el resto como diferencias."""
    return np.r_[m[:1], np.diff(m, axis=0)].ravel().tolist()


def suavizar_ancho(w, s):
    """Mínimo en una ventana de ±1 punto (tapa los huecos cortos entre casas) y cambio de ancho limitado a TALUD_ANCHO por m."""
    w = np.minimum(w, np.minimum(np.r_[w[1:], w[-1]], np.r_[w[0], w[:-1]]))
    for i in range(1, len(w)):
        w[i] = min(w[i], w[i - 1] + TALUD_ANCHO * (s[i] - s[i - 1]))
    for i in range(len(w) - 2, -1, -1):
        w[i] = min(w[i], w[i + 1] + TALUD_ANCHO * (s[i + 1] - s[i]))
    return w


salida_v, salida_w, salida_y = [], [], []
rasantes = []                 # (clase, puntos, normal a, medias calzadas, aceras, altura acera a, altura acera b)
angostas = total = 0.0
for clase, L in vias:
    paso = PASO_URBANO if len(arbol_fachadas.query(L.buffer(CERCA))) else PASO_RURAL
    P = densificar(L, paso)
    n = len(P)
    s = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]
    T = np.gradient(P, axis=0)
    T /= np.maximum(np.hypot(T[:, 0], T[:, 1]), 1e-9)[:, None]
    NA = np.c_[T[:, 1], -T[:, 0]]           # lado a (derecha del sentido del trazado)
    alcance = ANCHO_VIA[clase] / 2 + ANDEN[clase] + 1
    # distancia a la primera fachada a cada lado
    libre = {}
    for lado, N in (('a', NA), ('b', -NA)):
        rayos = shapely.linestrings(np.stack([P, P + N * alcance], axis=1))
        ri, pi = arbol_fachadas.query(rayos, predicate='intersects')
        d = np.full(n, np.inf)
        if len(ri):
            cortes = shapely.intersection(rayos[ri], np.array([casas[validas[k]] for k in pi], dtype=object))
            dist = shapely.distance(shapely.points(P[ri]), cortes)
            np.minimum.at(d, ri, dist)
        libre[lado] = d
    W, A = {}, {}
    for lado in ('a', 'b'):
        d = libre[lado]
        w = np.clip(d - ANDEN_MINIMO - HOLGURA_FACHADA, MEDIA_MINIMA[clase], ANCHO_VIA[clase] / 2)
        w = suavizar_ancho(w, s)
        a = np.clip(d - HOLGURA_FACHADA, w, w + ANDEN[clase])
        a = np.maximum(suavizar_ancho(a, s), w)
        W[lado], A[lado] = w, a
    total += s[-1]
    angostas += float(np.sum((np.minimum(W['a'], W['b']) < ANCHO_VIA[clase] / 2 - 0.5)[:-1] * np.diff(s)))
    # rasante: centro sobre el terreno del eje, bordes con peralte limitado
    c = suelo(P[:, 0], P[:, 1])
    ya = c + np.clip(suelo(*(P + NA * W['a'][:, None]).T) - c, -PERALTE * W['a'], PERALTE * W['a'])
    yb = c + np.clip(suelo(*(P - NA * W['b'][:, None]).T) - c, -PERALTE * W['b'], PERALTE * W['b'])
    # se levanta lo justo para que el terreno no atraviese la calzada: cinco puntos del corte y el centro entre puntos
    alza = np.zeros(n)
    for f in (-1, -0.5, 0, 0.5, 1):
        off = np.where(f >= 0, f * W['a'], f * W['b'])
        plano = yb + (ya - yb) * (off + W['b']) / (W['a'] + W['b'])
        alza = np.maximum(alza, suelo(*(P + NA * off[:, None]).T) + EPS - plano)
    if n > 1:
        medio = suelo(*((P[1:] + P[:-1]) / 2).T) + EPS - (ya[1:] + yb[1:] + ya[:-1] + yb[:-1]) / 4
        alza[1:] = np.maximum(alza[1:], medio); alza[:-1] = np.maximum(alza[:-1], medio)
    ya += alza; yb += alza
    # acera: un bordillo sobre la calzada; hacia la fachada sube con el terreno (corte), sin pasar de SUBIDA_ACERA
    yaa = ya + BORDILLO + np.clip(suelo(*(P + NA * A['a'][:, None]).T) + EPS - ya - BORDILLO, 0, SUBIDA_ACERA)
    yab = yb + BORDILLO + np.clip(suelo(*(P - NA * A['b'][:, None]).T) + EPS - yb - BORDILLO, 0, SUBIDA_ACERA)
    salida_v.append(codificar([clase], P.tolist()))
    salida_w.append(diferencias(np.round(np.c_[W['a'], W['b'], A['a'], A['b']] * 10).astype(int)))
    salida_y.append(diferencias(np.round(np.c_[ya, yb, yaa, yab] * 100).astype(int)))
    rasantes.append((clase, P, NA, W, A, yaa, yab))
print(f'vías: {total / 1000:.0f} km, {angostas / 1000:.1f} km angostados para caber entre fachadas ({time.time() - t0:.0f} s)')

# ── 4. piso de cada casa: el nivel de la acera frente a ella ──────────────
ejes = [LineString(r[1]) for r in rasantes]
arbol_ejes = STRtree(ejes)
pisos = [None] * len(casas)
con_piso = 0
for i in validas:
    p = casas[i]
    if p.area > AREA_MAX_PISO:
        continue
    mejor = None
    for j in arbol_ejes.query(p.buffer(FRENTE[0])):
        d = ejes[j].distance(p)
        clase = rasantes[j][0]
        if d <= FRENTE[clase] and (mejor is None or d < mejor[0]):
            mejor = (d, j)
    if not mejor:
        continue
    clase, P, NA, W, A, yaa, yab = rasantes[mejor[1]]
    a, _ = nearest_points(ejes[mejor[1]], p)
    k = int(np.argmin(np.hypot(P[:, 0] - a.x, P[:, 1] - a.y)))
    lado_a = (p.centroid.x - P[k, 0]) * NA[k, 0] + (p.centroid.y - P[k, 1]) * NA[k, 1] >= 0
    acera, alto = (A['a'][k], yaa[k]) if lado_a else (A['b'][k], yab[k])
    if mejor[0] > acera + 4:     # entre la acera y la casa hay más que un antejardín: no da a la vía
        continue
    pisos[i] = int(round((alto + 0.05) * 100))
    con_piso += 1
print(f'pisos: {con_piso} casas con la puerta al nivel de su acera ({time.time() - t0:.0f} s)')

# ── salidas ──────────────────────────────────────────────────────────────
rasante = {'k': K, 'v': salida_v, 'w': salida_w, 'y': salida_y}
(DATOS / f'rasante-{MUNICIPIO}.json').write_text(json.dumps(rasante, separators=(',', ':')), encoding='utf-8')
e_nuevo = []
for i, e in enumerate(cat['e']):
    p = casas[i]
    if p.is_empty or p.geom_type != 'Polygon':
        e_nuevo.append(e)
        continue
    pts = list(p.exterior.coords)[:-1]
    e_nuevo.append(codificar([e[0]], pts))
asentado = {**cat, 'k': K, 'e': e_nuevo, 'n': pisos}
(DATOS / f'catastro-asentado-{MUNICIPIO}.json').write_text(json.dumps(asentado, separators=(',', ':')), encoding='utf-8')
dir_conf = RAIZ / 'insumos/asentamiento'
dir_conf.mkdir(parents=True, exist_ok=True)
feats = [{'type': 'Feature', 'properties': {'indice': i, 'origen': origen[i], 'pisos': cat['p'][i]},
          'geometry': {'type': 'Polygon', 'coordinates': [[[x / M_LON + OESTE, y / M_LAT + SUR] for x, y in casas[i].exterior.coords]]}}
         for i in conflictos if casas[i].geom_type == 'Polygon']
(dir_conf / f'conflictos-{MUNICIPIO}.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}, ensure_ascii=False), encoding='utf-8')
for nombre in (f'rasante-{MUNICIPIO}.json', f'catastro-asentado-{MUNICIPIO}.json'):
    print(f'  {nombre}: {(DATOS / nombre).stat().st_size / 1e6:.1f} MB')
print(f'listo en {time.time() - t0:.0f} s')
