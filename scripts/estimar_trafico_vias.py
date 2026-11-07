"""Estima el tráfico diario de cada tramo de la red vial de Girardota y lo guarda para el mapa 3D:

    public/data/mapa3d/trafico-<id>.json

Es una ESTIMACIÓN de modelo, no un conteo. Solo hay un punto medido (peaje El Trapiche, ANI); el resto sale del
modelo y se publica con su rango (escenarios bajo/medio/alto) y un nivel de confianza por tipo de vía.

Método (modelo gravitacional con asignación a la red, la forma más simple del modelo de cuatro etapas):
  1. Red: red-vial-49-unificada.geojson sin senderos. Velocidad por tipo de vía; tiempo de viaje por tramo.
  2. Zonas: celdas de 200 m. En cada una se suma el área construida (huella × pisos) del catastro AMVA por uso:
     residencial (R), comercial (C), industrial (I) y sin uso (otros).
  3. Población (DANE, proyección 2025): la de la cabecera se reparte por el área residencial de las construcciones
     urbanas; la de centros poblados y rural, por la de las rurales.
  4. Generación (vehículos, sin motos, por día): personas × tasa de viajes en vehículo + carga por área industrial y
     comercial. Atracción: área residencial + 4 × comercial + 1,5 × industrial (+ equipamientos).
  5. Distribución: una parte de los viajes sale del municipio (sobre todo hacia Medellín por la autopista sur); el
     resto se reparte entre zonas con un modelo gravitacional  T_ij ∝ P_i · A_j · exp(-β · t_ij).
  6. Asignación: todo o nada por la ruta más rápida (sin congestión).
  7. Calibración: el tráfico de paso por la Autopista Norte (Barbosa ↔ Medellín, que no genera Girardota) es lo que
     falta para que el modelo dé en el peaje lo que contó la ANI en el último año completo.

Todos los supuestos numéricos están en SUPUESTOS y viajan en el archivo de salida.
Uso:  python -I scripts/estimar_trafico_vias.py
"""
import heapq, json, math
from collections import defaultdict
from pathlib import Path

import numpy as np
import shapefile
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from shapely.geometry import LineString, Point, shape
from shapely.ops import unary_union

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO, DANE = 49, '05308'
RED = RAIZ / f'public/data/mapa3d/red-vial-{MUNICIPIO}-unificada.geojson'
PEAJE = RAIZ / f'public/data/mapa3d/trafico-trapiche-{MUNICIPIO}.json'
EQUIP = RAIZ / f'public/data/mapa3d/equipamientos-catastro-{MUNICIPIO}.json'
SALIDA = RAIZ / f'public/data/mapa3d/trafico-{MUNICIPIO}.json'
DGEO = RAIZ / 'insumos/geografia/dane_cnpv2018'

LAT0 = 6.375
MLAT, MLON = 110574.0, 111320.0 * math.cos(math.radians(LAT0))

SUPUESTOS = {
    'poblacion_2025': {'cabecera': 33900, 'rural': 22412, 'fuente': 'DANE, proyección municipal 2018-2035'},
    'velocidad_kmh': {'Autopista/doble calzada': 60, 'Troncal': 50, 'Transversal': 40, 'principal': 35,
                      'Carretera secundaria': 30, 'Carretera terciaria': 25, 'local': 20},
    'atraccion': {'R': 1.0, 'C': 4.0, 'I': 1.5, 'otro': 0.3, 'equipamiento_m2': 800},
    'carga_viajes_por_100m2': {'I': 0.4, 'C': 0.2},
    'carga_externa': 0.75,
    'salidas': {'sur': 0.80, 'norte': 0.15, 'otras': 0.05},
    # tasa = viajes en vehículo (auto, taxi, bus, camión liviano; sin motos) por persona y día; externa = parte de
    # esos viajes que sale del municipio; beta = sensibilidad al tiempo (1/min)
    'escenarios': {'bajo': {'tasa': 0.18, 'externa': 0.30, 'beta': 0.18},
                   'medio': {'tasa': 0.25, 'externa': 0.40, 'beta': 0.12},
                   'alto': {'tasa': 0.33, 'externa': 0.50, 'beta': 0.08}},
    'celda_m': 200,
}
ESC = list(SUPUESTOS['escenarios'])
CLASES = [(10000, 'muy alto'), (3000, 'alto'), (1000, 'medio'), (300, 'bajo'), (0, 'muy bajo')]


def xy(lon, lat): return ((lon + 75.44) * MLON, (lat - LAT0) * MLAT)


# ---------- 1. red ----------
feats = [f for f in json.loads(RED.read_text(encoding='utf-8'))['features']
         if f['properties']['tipo'] in SUPUESTOS['velocidad_kmh'] and f['properties'].get('clase_osm') != 'sendero']
clave = lambda c: (round(c[0], 5), round(c[1], 5))
# cruces en «T»: un extremo que cae sobre el medio de otro tramo (sin vértice común) se pega a ese tramo y le
# agrega allí un vértice, para que la red quede conectada
from shapely import STRtree
from shapely.ops import nearest_points
geoms = [LineString([xy(*c) for c in f['geometry']['coordinates']]) for f in feats]
idx_lineas = STRtree(geoms)
extremos = defaultdict(int)
for f in feats:
    cs = f['geometry']['coordinates']; extremos[clave(cs[0])] += 1; extremos[clave(cs[-1])] += 1
todos = defaultdict(int)
for f in feats:
    for c in {clave(c) for c in f['geometry']['coordinates']}: todos[c] += 1
insertar = defaultdict(list)                                   # tramo -> [(distancia a lo largo, coord)]
pegados = 0
for i, f in enumerate(feats):
    cs = f['geometry']['coordinates']
    for extremo, pos_e in ((cs[0], 0), (cs[-1], -1)):
        if todos[clave(extremo)] > 1: continue                 # ya comparte vértice con otro tramo
        p = Point(xy(*extremo))
        cand = [j for j in idx_lineas.query(p.buffer(12)) if j != i]
        if not cand: continue
        j = min(cand, key=lambda j: geoms[j].distance(p))
        if geoms[j].distance(p) > 12: continue
        q = nearest_points(geoms[j], p)[0]
        lon, lat = q.x / MLON - 75.44, q.y / MLAT + LAT0
        insertar[j].append((geoms[j].project(q), [lon, lat]))
        cs[pos_e] = [lon, lat]
        pegados += 1
for j, puntos in insertar.items():
    cs = feats[j]['geometry']['coordinates']
    acum = [0.0]
    for p, q in zip(cs, cs[1:]): acum.append(acum[-1] + math.dist(xy(*p), xy(*q)))
    for d, c in sorted(puntos, reverse=True):
        k = next((k for k in range(1, len(cs)) if acum[k] >= d), len(cs) - 1)
        cs.insert(k, c); acum.insert(k, d)
print(f'cruces en T pegados: {pegados}')

uso = defaultdict(int)
for f in feats:
    cs = f['geometry']['coordinates']
    for c in {clave(c) for c in cs}: uso[c] += 1
    uso[clave(cs[0])] += 1; uso[clave(cs[-1])] += 1          # los extremos siempre son nodos
nodos, coord = {}, []
def nodo(k):
    if k not in nodos: nodos[k] = len(coord); coord.append(xy(*k))
    return nodos[k]
aristas = []                                                  # (a, b, minutos, metros, indice de tramo)
for i, f in enumerate(feats):
    v = SUPUESTOS['velocidad_kmh'][f['properties']['tipo']] / 3.6
    cs = [clave(c) for c in f['geometry']['coordinates']]
    a, largo = nodo(cs[0]), 0.0
    for p, q in zip(cs, cs[1:]):
        largo += math.dist(xy(*p), xy(*q))
        if uso[q] > 1 or q == cs[-1]:
            b = nodo(q)
            if a != b: aristas.append((a, b, largo / v / 60, largo, i))
            a, largo = b, 0.0
coord = np.array(coord)
N = len(coord)


def matriz(ars):
    mejor = {}
    for k, (a, b, t, _, _) in enumerate(ars):
        for u, w in ((a, b), (b, a)):
            if (u, w) not in mejor or t < ars[mejor[(u, w)]][2]: mejor[(u, w)] = k
    filas, cols = zip(*mejor)
    return csr_matrix(([ars[k][2] + 1e-6 for k in mejor.values()], (filas, cols)), shape=(N, N)), mejor


# une las piezas sueltas a la red principal (tramos que no comparten vértice por diferencias de digitalización)
G, _ = matriz(aristas)
ncomp, etiqueta = connected_components(G, directed=False)
principal = np.bincount(etiqueta).argmax()
from scipy.spatial import cKDTree
arbol_p = cKDTree(coord[etiqueta == principal]); ids_p = np.where(etiqueta == principal)[0]
unidos = 0
for c in range(ncomp):
    if c == principal: continue
    miembros = np.where(etiqueta == c)[0]
    d, j = arbol_p.query(coord[miembros])
    k = int(np.argmin(d))
    if d[k] <= 30:
        aristas.append((int(miembros[k]), int(ids_p[j[k]]), d[k] / (20 / 3.6) / 60, float(d[k]), -1)); unidos += 1
G, mejor = matriz(aristas)
ncomp, etiqueta = connected_components(G, directed=False)
principal = np.bincount(etiqueta).argmax()
en_red = etiqueta == principal
print(f'red: {len(feats)} tramos, {N} nodos, {len(aristas)} aristas; {unidos} piezas unidas; '
      f'{en_red.sum()} nodos en la red principal ({ncomp} componentes)')
arbol = cKDTree(coord[en_red]); ids_red = np.where(en_red)[0]
cercano = lambda p: int(ids_red[arbol.query(p)[1]])

# ---------- 2-3. zonas, actividad y población ----------
def area_m2(anillo):
    p = [xy(*c) for c in anillo]
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(p, p[1:]))) / 2

celdas = defaultdict(lambda: np.zeros(7))      # R, C, I, otro, pob, x·peso, y·peso
C_M = SUPUESTOS['celda_m']
def leer_construcciones(nombre):
    out = []
    for f in json.loads((RAIZ / f'insumos/catastro/{nombre}').read_text(encoding='utf-8'))['features']:
        g = f['geometry']
        anillos = [g['coordinates'][0]] if g['type'] == 'Polygon' else [p[0] for p in g['coordinates']]
        a = sum(area_m2(r) for r in anillos) * max(1, int(f['properties'].get('NO_PISOS') or 1))
        cx = sum(c[0] for c in anillos[0]) / len(anillos[0]); cy = sum(c[1] for c in anillos[0]) / len(anillos[0])
        u = (f['properties'].get('USO') or ' ').strip() or 'otro'
        out.append((xy(cx, cy), u if u in 'RCI' else 'otro', a))
    return out

for nombre, pob in (('construcciones-urbanas-49.geojson', SUPUESTOS['poblacion_2025']['cabecera']),
                    ('construcciones-rurales-49.geojson', SUPUESTOS['poblacion_2025']['rural'])):
    cons = leer_construcciones(nombre)
    total_r = sum(a for _, u, a in cons if u == 'R')
    for (x, y), u, a in cons:
        c = celdas[(int(x // C_M), int(y // C_M))]
        c['RCI'.index(u) if u in 'RCI' else 3] += a
        if u == 'R': c[4] += pob * a / total_r
        c[5] += x * a; c[6] += y * a

equip = json.loads(EQUIP.read_text(encoding='utf-8')) if EQUIP.exists() else {}
n_equip = 0
for e in equip.values():
    if isinstance(e, dict) and 'lon' in e and 'lat' in e:
        x, y = xy(e['lon'], e['lat'])
        c = celdas[(int(x // C_M), int(y // C_M))]
        c[1] += SUPUESTOS['atraccion']['equipamiento_m2'] / SUPUESTOS['atraccion']['C']   # en «m² comerciales»
        c[5] += x; c[6] += y; n_equip += 1

zonas = []
for k, c in celdas.items():
    peso = c[:4].sum()
    if peso <= 0: continue
    centro = (c[5] / peso, c[6] / peso)
    zonas.append({'n': cercano(centro), 'R': c[0], 'C': c[1], 'I': c[2], 'otro': c[3], 'pob': c[4]})
at = SUPUESTOS['atraccion']
A = np.array([at['R'] * z['R'] + at['C'] * z['C'] + at['I'] * z['I'] + at['otro'] * z['otro'] for z in zonas])
POB = np.array([z['pob'] for z in zonas])
CARGA = np.array([(z['I'] * SUPUESTOS['carga_viajes_por_100m2']['I'] + z['C'] * SUPUESTOS['carga_viajes_por_100m2']['C']) / 100
                  for z in zonas])
NZ = np.array([z['n'] for z in zonas])
print(f'zonas: {len(zonas)} celdas de {C_M} m con actividad; población {POB.sum():,.0f}; '
      f'carga {CARGA.sum():,.0f} viajes/día; {n_equip} equipamientos')

# ---------- salidas del municipio ----------
limite = unary_union([shape(s.__geo_interface__) for s, r in
                      ((s, dict(zip([f[0] for f in rd.fields[1:]], rec)))
                       for rd in [shapefile.Reader(str(DGEO / 'veredas/CRVeredas_2020.shp'), encoding='utf-8')]
                       for s, rec in zip(rd.shapes(), rd.records()))
                      if r['DPTOMPIO'] == DANE] +
                     [shape(s.__geo_interface__) for rd in [shapefile.Reader(str(DGEO / 'zona_urbana/MGN_ANM_ZU.shp'), encoding='utf-8')]
                      for s, rec in zip(rd.shapes(), rd.records())
                      if dict(zip([f[0] for f in rd.fields[1:]], rec))['MPIO_CDPMP'] == DANE]).buffer(0.0005)
grado = np.bincount(np.array([a for a, *_ in aristas] + [b for _, b, *_ in aristas]), minlength=N)
inv = {v: k for k, v in nodos.items()}
autopista = {i for i, f in enumerate(feats) if f['properties']['tipo'] == 'Autopista/doble calzada'}
fuera = lambda n: not limite.contains(Point(inv[n]))
nodos_auto = sorted({n for a, b, _, _, i in aristas if i in autopista for n in (a, b) if en_red[n]})
# extremos de la autopista dentro de la red: el par de nodos más alejado; el del oeste va a Copacabana/Medellín
pc = coord[nodos_auto]
i0 = int(np.argmax(np.linalg.norm(pc - pc[0], axis=1))); i1 = int(np.argmax(np.linalg.norm(pc - pc[i0], axis=1)))
sur, norte = sorted((nodos_auto[i0], nodos_auto[i1]), key=lambda n: coord[n][0])
otras = sorted({n for a, b, _, _, i in aristas if i >= 0 and feats[i]['properties']['tipo'] != 'local'
                for n in (a, b) if en_red[n] and grado[n] == 1 and fuera(n)} - {sur, norte})
# una salida por zona del borde (a menos de 1 km entre sí cuenta como la misma)
filtradas = []
for n in otras:
    if all(math.dist(coord[n], coord[m]) > 1000 for m in filtradas + [sur, norte]): filtradas.append(n)
otras = filtradas
print(f'salidas: sur {inv[sur]}, norte {inv[norte]}, otras {[inv[n] for n in otras]}')

# ---------- 5-6. distribución y asignación ----------
origenes = sorted(set(NZ.tolist()) | {sur, norte} | set(otras))
pos = {n: k for k, n in enumerate(origenes)}
T, pred = dijkstra(G, directed=True, indices=origenes, return_predecessors=True)
print(f'rutas: {len(origenes)} orígenes × {N} nodos')
# tiempo entre zonas (por su nodo)
TZ = T[[pos[n] for n in NZ]][:, NZ]
flujo_arista = np.zeros((len(aristas), len(ESC)))


def cargar(o, demanda):
    """Asigna a la red la demanda (N × escenarios) que sale del nodo o, por su árbol de rutas más rápidas."""
    fila = pos[o]
    d, p = T[fila], pred[fila]
    acc = demanda.copy()
    orden = np.argsort(-np.where(np.isfinite(d), d, -1))
    for v in orden:
        if not np.isfinite(d[v]) or v == o: continue
        if not acc[v].any(): continue
        u = p[v]
        flujo_arista[mejor[(u, v)]] += acc[v]
        acc[u] += acc[v]


def por_tramo():
    """Flujo de cada tramo = promedio de sus pedazos (entre nodos) ponderado por largo."""
    suma, largo = np.zeros((len(feats), len(ESC))), np.zeros(len(feats))
    for k, (_, _, _, m, i) in enumerate(aristas):
        if i >= 0: suma[i] += flujo_arista[k] * m; largo[i] += m
    return suma / np.maximum(largo, 1e-9)[:, None]


sal = SUPUESTOS['salidas']
for zi, o in enumerate(NZ):
    dem = np.zeros((N, len(ESC)))
    for e, nombre in enumerate(ESC):
        p = SUPUESTOS['escenarios'][nombre]
        viajes = POB[zi] * p['tasa']
        interna = viajes * (1 - p['externa']) + CARGA[zi] * (1 - SUPUESTOS['carga_externa'])
        externa = viajes * p['externa'] + CARGA[zi] * SUPUESTOS['carga_externa']
        w = A * np.exp(-p['beta'] * TZ[zi]); w[zi] *= 0.0 if len(w) > 1 else 1; s = w.sum()
        if s > 0 and interna > 0: np.add.at(dem[:, e], NZ, interna * w / s)
        if externa > 0:
            dem[sur, e] += externa * sal['sur']; dem[norte, e] += externa * sal['norte']
            for n in otras: dem[n, e] += externa * sal['otras'] / len(otras)
            if not otras: dem[sur, e] += externa * sal['otras']
    cargar(o, dem)

# ---------- 7. calibración con el peaje ----------
peaje = json.loads(PEAJE.read_text(encoding='utf-8'))
obs = peaje['base']['tpd']
pp = xy(peaje['lon'], peaje['lat'])
lineas = [LineString([xy(*c) for c in f['geometry']['coordinates']]) for f in feats]
en_peaje = [i for i in autopista if lineas[i].distance(Point(pp)) < 40 and lineas[i].length > 300]
flujo_local = por_tramo()
local_peaje = flujo_local[en_peaje].sum(axis=0)
paso = np.maximum(obs - local_peaje, 0)
dem = np.zeros((N, len(ESC))); dem[sur] = paso
cargar(norte, dem)
flujo = por_tramo()
print(f'control: modelo en el peaje tras calibrar {dict(zip(ESC, flujo[en_peaje].sum(axis=0).round()))}')
print(f'peaje: tramos {[feats[i]["properties"]["id"] for i in en_peaje]}; observado {obs:,} veh/día; '
      f'del municipio {dict(zip(ESC, local_peaje.round()))}; de paso {dict(zip(ESC, paso.round()))}')

# corredor de paso: tramos donde más de la mitad del flujo es el tráfico de paso anclado al peaje
de_paso = (flujo - flujo_local)[:, ESC.index('medio')] > 0.5 * flujo[:, ESC.index('medio')]
# calzadas separadas: la asignación sin sentidos manda todo por una de las dos; cada calzada muestra el total
# del corredor (suma con su gemela paralela)
corredor = flujo.copy()
gemela = {}
def rumbo(l):
    (x0, y0), (x1, y1) = l.coords[0], l.coords[-1]; return math.atan2(y1 - y0, x1 - x0)
mayores = [i for i, f in enumerate(feats) if f['properties']['tipo'] != 'local' and lineas[i].length >= 120]
idx_mayores = STRtree([lineas[i] for i in mayores])
for i in mayores:
    lim = 60 if i in autopista or de_paso[i] else 35
    muestras = [lineas[i].interpolate(k / 10, normalized=True) for k in range(1, 10)]
    mejor_j, mejor_s = None, 0.0
    for c in idx_mayores.query(lineas[i].buffer(lim)):
        j = mayores[c]
        if j == i or abs(math.sin(rumbo(lineas[i]) - rumbo(lineas[j]))) > 0.4: continue
        # gemela: corre paralela a menos de `lim` en al menos 60 % de la longitud de este tramo
        s = sum(lineas[j].distance(p) < lim for p in muestras) / len(muestras)
        if s >= 0.6 and s > mejor_s: mejor_j, mejor_s = j, s
    if mejor_j is not None:
        corredor[i] = flujo[i] + flujo[mejor_j]; gemela[i] = mejor_j

# ---------- salida ----------
def clase(v): return next(n for lim, n in CLASES if v >= lim)
def confianza(t, i):
    if i in en_peaje: return 'medida'
    # alta: el corredor de paso, anclado al conteo del peaje (o su calzada gemela)
    if de_paso[i] or (i in gemela and de_paso[gemela[i]]): return 'alta'
    if t in ('Autopista/doble calzada', 'Troncal', 'Transversal', 'principal', 'Carretera secundaria'): return 'media'
    return 'baja'

tramos, resumen = [], defaultdict(float)
for i, f in enumerate(feats):
    v = corredor[i]
    if v.max() < 1: continue
    lo, me, hi = (float(x) for x in (v.min(), v[ESC.index('medio')], v.max()))
    g = LineString(f['geometry']['coordinates']).simplify(0.00001)
    t = f['properties']['tipo']
    tramos.append({'id': f['properties']['id'], 't': t, 'vd': round(me, -1), 'min': round(lo, -1), 'max': round(hi, -1),
                   'c': clase(me), 'conf': confianza(t, i), 'dc': i in gemela,
                   'g': [[round(x, 5), round(y, 5)] for x, y in g.coords]})
    resumen[clase(me)] += f['properties']['longitud_m'] / 1000

salida = {
    'tipo': 'estimación', 'anio': peaje['base']['anio'], 'unidad': 'vehículos por día, ambos sentidos, sin motos',
    'metodo': 'modelo gravitacional con asignación todo o nada, calibrado con el peaje El Trapiche',
    'fuentes': ['ANI · peaje El Trapiche', 'Catastro AMVA (uso y pisos de construcciones)', 'DANE, proyección 2025',
                'Red vial unificada (IGAC + OpenStreetMap)'],
    'peaje': {'obs': obs, 'del_municipio': dict(zip(ESC, local_peaje.round().tolist())),
              'de_paso': dict(zip(ESC, paso.round().tolist()))},
    'supuestos': SUPUESTOS, 'clases': [{'desde': lim, 'n': n} for lim, n in CLASES],
    'km_por_clase': {k: round(v, 1) for k, v in resumen.items()}, 'tramos': tramos,
}
SALIDA.write_text(json.dumps(salida, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'{len(tramos)} tramos con tráfico; km por clase {dict((k, round(v, 1)) for k, v in resumen.items())}')
print(f'archivo {SALIDA.name}: {SALIDA.stat().st_size / 1e6:.2f} MB')
top = sorted(tramos, key=lambda t: -t['vd'])
for t in [x for x in top if not x['dc']][:12]: print('  ', t['id'], t['t'], t['vd'], (t['min'], t['max']), t['g'][0])
