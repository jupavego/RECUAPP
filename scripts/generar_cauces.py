"""Ríos, quebradas y lagos de un municipio, con su nombre y un ancho real o estimado, para el mapa 3D:

    public/data/mapa3d/cauces-<id>.json
        {"k": 1e5, "n": [nombres], "d": [nombres derivados], "c": [[ancho_m, i_nombre, x0, y0, dx, dy, ...], ...],
         "i": [mismo formato que c, tramos del IGAC que OSM no tiene], "t": [mismo formato, tramos entubados], "l": [[i_nombre, x0, y0, dx, dy, ...], ...]}
        # c = cauces en superficie, t = tramos soterrados (se dibujan tenues), l = lagos (polígonos)

Las coordenadas son enteros (grados × k): la primera pareja absoluta y el resto diferencias; i_nombre = -1 si no
tiene nombre y -2 - i para un nombre derivado de la red (lista d: «Afluente de …»).

De dónde sale cada dato:
  · Trazado, nombre y lagos: OpenStreetMap (Overpass).
  · Ancho: la etiqueta `width` de OSM cuando existe (p. ej. el Río Medellín trae 30 m). Si no, se estima con la
    geometría hidráulica de los ríos, ancho ≈ 1,2 + 1,8·√(área aportante en km²), donde el área aportante sale de
    acumular el flujo sobre el relieve (mismo relieve del mapa 3D). Solo cuenta lo que cae dentro del recuadro,
    así que en ríos que nacen fuera subestima: por eso los ríos sin etiqueta usan un mínimo de 12 m.
  · Los tramos entubados (tunnel=culvert) van aparte (t) para dibujarlos tenues y que el río no parezca cortado.
  · Verificación: si un cauce termina sin desembocar en otro cauce, un lago o el borde del recuadro, se completa
    siguiendo el drenaje del relieve cuesta abajo (en OSM varios cauces se cortan en un mismo límite de mapeo).

Uso:  python scripts/generar_cauces.py [id_municipio] [--cache archivo.json] [--igac drenajes.geojson]
      (--cache reutiliza una descarga previa de Overpass, que a veces responde 502/504;
       --igac suma los drenajes del IGAC 1:100.000 que OSM no tiene: capa «Drenajes Sencillos» del servicio
       http://dhime.ideam.gov.co/server/rest/services/Cartografia_Basica/Hidrografia/MapServer/0, consultada con f=geojson)

Datos © colaboradores de OpenStreetMap (ODbL).
"""
import base64, heapq, json, math, sys, time, urllib.parse, urllib.request
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if not a.startswith('--')]
MUNICIPIO = int(args[0]) if args else 49
CACHE = Path(sys.argv[sys.argv.index('--cache') + 1]) if '--cache' in sys.argv else None
IGAC = Path(sys.argv[sys.argv.index('--igac') + 1]) if '--igac' in sys.argv else None
K = 100000
ANCHO_MIN, ANCHO_MAX_QUEBRADA, ANCHO_RIO_SIN_DATO = 2.0, 16.0, 12.0

rel = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = rel['bbox']
nx, ny = rel['nx'], rel['ny']
M_LAT = 110574
M_LON = 111320 * math.cos(math.radians((sur + norte) / 2))


# ── datos de OSM ──────────────────────────────────────────────────────────
def descargar():
    q = (f'[out:json][timeout:180];(way["waterway"]({sur},{oeste},{norte},{este});'
         f'way["natural"="water"]({sur},{oeste},{norte},{este}););out geom tags;')
    servidores = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
                  'https://overpass.private.coffee/api/interpreter']
    for intento in range(6):
        s = servidores[intento % len(servidores)]
        try:
            req = urllib.request.Request(s, data=urllib.parse.urlencode({'data': q}).encode(),
                                         headers={'User-Agent': 'recuapp-poc/0.1'})
            return json.loads(urllib.request.urlopen(req, timeout=240).read())['elements']
        except Exception as e:      # Overpass es público: a veces responde 502/504 y se reintenta en otro servidor
            print(f'{s}: {e}')
            time.sleep(8)
    sys.exit('Overpass no respondió')


elementos = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE else descargar()

# ── acumulación de flujo sobre el relieve (inundación por prioridad + D8) ──
elev = np.frombuffer(base64.b64decode(rel['dm']), dtype='<i2').reshape(ny, nx).astype(np.float64) / 10
visto = np.zeros((ny, nx), dtype=bool)
padre = np.full(ny * nx, -1, dtype=np.int64)
orden = []
cola = []
for j in range(ny):
    for i in (0, nx - 1):
        cola.append((elev[j, i], j * nx + i)); visto[j, i] = True
for i in range(1, nx - 1):
    for j in (0, ny - 1):
        cola.append((elev[j, i], j * nx + i)); visto[j, i] = True
heapq.heapify(cola)
nivel = elev.copy()
VECINOS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
while cola:
    z, p = heapq.heappop(cola)
    orden.append(p)
    j, i = divmod(p, nx)
    for dj, di in VECINOS:
        jj, ii = j + dj, i + di
        if 0 <= jj < ny and 0 <= ii < nx and not visto[jj, ii]:
            visto[jj, ii] = True
            nivel[jj, ii] = max(elev[jj, ii], z + 1e-4)      # rellena depresiones para que el agua siempre salga
            padre[jj * nx + ii] = p
            heapq.heappush(cola, (nivel[jj, ii], jj * nx + ii))
acum = np.ones(ny * nx)
for p in reversed(orden):                                    # cada celda se descarga en la que la descubrió
    if padre[p] >= 0:
        acum[padre[p]] += acum[p]
acum = acum.reshape(ny, nx)
CELDA_KM2 = (M_LON * (este - oeste) / (nx - 1)) * (M_LAT * (norte - sur) / (ny - 1)) / 1e6


def area_aportante(puntos):
    """Mayor área aportante (km²) a lo largo de la línea, buscando el cauce en el entorno 3×3 de cada punto."""
    mejor = 1
    for lo, la in puntos:
        i = round((lo - oeste) / (este - oeste) * (nx - 1))
        j = round((norte - la) / (norte - sur) * (ny - 1))
        if 0 <= i < nx and 0 <= j < ny:
            mejor = max(mejor, acum[max(0, j - 1):j + 2, max(0, i - 1):i + 2].max())
    return mejor * CELDA_KM2


def numero(texto):
    try:
        return float(str(texto).replace(',', '.').split()[0])
    except (ValueError, IndexError):
        return None


def deltas(puntos):
    t = [(round(lo * K), round(la * K)) for lo, la in puntos]
    sal = [t[0][0], t[0][1]]
    for (ax, ay), (bx, by) in zip(t, t[1:]):
        sal += [bx - ax, by - ay]
    return sal


# ── armado ────────────────────────────────────────────────────────────────
nombres, indice = [], {}


def i_nombre(n):
    if not n:
        return -1
    if n not in indice:
        indice[n] = len(nombres)
        nombres.append(n)
    return indice[n]


class Cauce:
    def __init__(self, nombre, pts, ancho, entubado):
        self.nombre, self.pts, self.ancho, self.entubado = nombre, pts, ancho, entubado
        self.completado = 0          # puntos agregados siguiendo el drenaje
        self.igac = False            # tramo tomado del IGAC 1:100.000 (no está en OSM)
        self.derivado = None         # índice de un nombre "Afluente de …" deducido de la red


cauces, lagos, poligonos_lago = [], [], []
for e in elementos:
    t = e.get('tags', {})
    g = e.get('geometry', [])
    if len(g) < 2:
        continue
    pts = [(p['lon'], p['lat']) for p in g]
    if t.get('waterway') in ('river', 'stream', 'canal'):
        ancho = numero(t.get('width'))
        if ancho is None:
            if t['waterway'] == 'river':
                ancho = ANCHO_RIO_SIN_DATO
            else:
                ancho = min(ANCHO_MAX_QUEBRADA, max(ANCHO_MIN, 1.2 + 1.8 * math.sqrt(area_aportante(pts))))
        cauces.append(Cauce(t.get('name'), pts, round(ancho, 1), t.get('tunnel') in ('culvert', 'yes', 'building')))
    elif t.get('natural') == 'water' and len(pts) >= 4:
        area = abs(sum(a[0] * M_LON * b[1] * M_LAT - b[0] * M_LON * a[1] * M_LAT for a, b in zip(pts, pts[1:]))) / 2
        poligonos_lago.append(pts)
        if area >= 400:                                      # estanques de pocos metros no se dibujan
            lagos.append([i_nombre(t.get('name'))] + deltas(pts[:-1]))

# ── drenajes del IGAC 1:100.000 que OpenStreetMap no tiene ───────────────────────────────────────────────
# A esa escala el trazado puede estar corrido unos 100 m, así que solo se agregan los tramos que quedan a más de
# UMBRAL_IGAC_M de cualquier cauce de OSM (lo más cercano se considera el mismo cauce, ya dibujado). Cada tramo se
# orienta cuesta abajo y se conecta con el cauce de OSM más próximo, para que desemboque como cualquier otro.
UMBRAL_IGAC_M = 120
LARGO_MIN_IGAC_M = 300
CONEXION_IGAC_M = 200

igac_nombrados = []      # (nombre, puntos en metros) de todos los drenajes del IGAC que traen nombre
if IGAC:
    def a_m(p):
        return ((p[0] - oeste) * M_LON, (p[1] - sur) * M_LAT)

    def a_lonlat(m):
        return (oeste + m[0] / M_LON, sur + m[1] / M_LAT)

    celdas = {}
    for c in cauces:
        for a, b in zip(c.pts, c.pts[1:]):
            ma, mb = a_m(a), a_m(b)
            n = max(1, int(math.hypot(mb[0] - ma[0], mb[1] - ma[1]) / 10))
            for t in range(n + 1):
                q = (ma[0] + (mb[0] - ma[0]) * t / n, ma[1] + (mb[1] - ma[1]) * t / n)
                celdas.setdefault((int(q[0] // 150), int(q[1] // 150)), []).append(q)

    def mas_cercano(q, radio):
        mejor, d_mejor = None, radio
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for r in celdas.get((int(q[0] // 150) + di, int(q[1] // 150) + dj), ()):
                    d = math.hypot(r[0] - q[0], r[1] - q[1])
                    if d < d_mejor:
                        mejor, d_mejor = r, d
        return mejor, d_mejor

    def elevacion(p):
        i = min(nx - 1, max(0, round((p[0] - oeste) / (este - oeste) * (nx - 1))))
        j = min(ny - 1, max(0, round((norte - p[1]) / (norte - sur) * (ny - 1))))
        return elev[j, i]

    nuevos = 0
    km = 0.0
    for f in json.loads(IGAC.read_text(encoding='utf-8'))['features']:
        g = f['geometry']
        props = f.get('properties') or {}
        nombre = (props.get('nombre_geografico') or props.get('NOMBRE_GEOGRAFICO') or '').strip() or None
        for linea in (g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]):
            m = [a_m(p) for p in linea]
            denso = []
            for a, b in zip(m, m[1:]):
                n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 20))
                denso += [(a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n) for t in range(n)]
            denso.append(m[-1])
            if nombre:
                igac_nombrados.append((nombre, np.array(denso)))
            lejos = [oeste <= a_lonlat(q)[0] <= este and sur <= a_lonlat(q)[1] <= norte and mas_cercano(q, UMBRAL_IGAC_M)[0] is None for q in denso]
            i = 0
            while i < len(denso):
                if not lejos[i]:
                    i += 1
                    continue
                j = i
                while j + 1 < len(denso) and lejos[j + 1]:
                    j += 1
                tramo = denso[i:j + 1]
                largo = 20 * (len(tramo) - 1)
                if largo >= LARGO_MIN_IGAC_M:
                    pts = [a_lonlat(q) for q in tramo[::2]] + ([a_lonlat(tramo[-1])] if len(tramo) % 2 == 0 else [])
                    if elevacion(pts[0]) < elevacion(pts[-1]):          # se dibuja cuesta abajo, como OSM
                        pts.reverse()
                    # conexión con el cauce de OSM más próximo, si queda cerca de la desembocadura
                    destino, _ = mas_cercano(a_m(pts[-1]), CONEXION_IGAC_M)
                    if destino is not None:
                        pts.append(a_lonlat(destino))
                    ancho = min(ANCHO_MAX_QUEBRADA, max(ANCHO_MIN, 1.2 + 1.8 * math.sqrt(area_aportante(pts))))
                    c = Cauce(nombre, pts, round(ancho, 1), False)
                    c.igac = True
                    cauces.append(c)
                    nuevos += 1
                    km += largo / 1000
                i = j + 1
    print(f'IGAC 1:100.000: se agregaron {nuevos} tramos ({km:.1f} km) que OSM no tiene')

# ── verificación y reparación: ¿algún cauce termina "en el aire"? ─────────────
# En OSM cada línea de agua se dibuja en el sentido de la corriente: su último punto debe caer en otro cauce
# (confluencia), en un lago o en el borde del recuadro. Si no, el río quedaría cortado a medio camino; suele ser
# un hueco del mapeo (varios terminan en la misma latitud o longitud). Se completa siguiendo el drenaje del relieve
# cuesta abajo hasta que encuentre otro cauce, un lago o el borde.
TOLERANCIA_M = 18
MARGEN_BORDE_M = 80
MAX_PASOS = 500             # ~12 km a 25 m por celda


def a_metros(p):
    return np.array([(p[0] - oeste) * M_LON, (p[1] - sur) * M_LAT])


def reconstruir_segmentos():
    seg = []
    for ni, c in enumerate(cauces):
        m = [a_metros(p) for p in c.pts]
        seg += [(ni, a, b) for a, b in zip(m, m[1:])]
    return (np.array([s[1] for s in seg]), np.array([s[2] for s in seg]), np.array([s[0] for s in seg]))


def distancia_a_otras(p, propia, A, B, DUENO):
    ab = B - A
    t = np.clip(((p - A) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-9), 0, 1)
    d = np.linalg.norm(A + ab * t[:, None] - p, axis=1)
    d[DUENO == propia] = 1e9
    return d.min()


def en_poligono(p, poli):
    x, y = p
    dentro = False
    for a, b in zip(poli, poli[1:] + poli[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            dentro = not dentro
    return dentro


def en_borde(p):
    return min(p[0] - oeste, este - p[0]) * M_LON < MARGEN_BORDE_M or min(p[1] - sur, norte - p[1]) * M_LAT < MARGEN_BORDE_M


def termina_bien(ni, fin, A, B, DUENO):
    return (en_borde(fin) or any(en_poligono(fin, poli) for poli in poligonos_lago)
            or distancia_a_otras(a_metros(fin), ni, A, B, DUENO) <= TOLERANCIA_M)


def celda(p):
    return (round((norte - p[1]) / (norte - sur) * (ny - 1)), round((p[0] - oeste) / (este - oeste) * (nx - 1)))


def punto(j, i):
    return (oeste + i / (nx - 1) * (este - oeste), norte - j / (ny - 1) * (norte - sur))


A, B, DUENO = reconstruir_segmentos()
cortados = [ni for ni, c in enumerate(cauces) if not c.entubado and not termina_bien(ni, c.pts[-1], A, B, DUENO)]
print(f'verificación: {len(cortados)} de {len(cauces)} cauces terminan en el aire')
for ni in cortados:
    c = cauces[ni]
    j, i = celda(c.pts[-1])
    j, i = max(0, min(ny - 1, j)), max(0, min(nx - 1, i))
    # se ubica el cauce en el entorno 3×3 y se baja siguiendo el árbol de drenaje
    ventana = [(jj, ii) for jj in range(max(0, j - 1), min(ny, j + 2)) for ii in range(max(0, i - 1), min(nx, i + 2))]
    j, i = max(ventana, key=lambda q: acum[q])
    nuevos = []
    for _ in range(MAX_PASOS):
        p = padre[j * nx + i]
        if p < 0:
            break
        j, i = divmod(int(p), nx)
        nuevos.append(punto(j, i))
        if termina_bien(ni, nuevos[-1], A, B, DUENO):
            break
    c.pts = c.pts + nuevos[::2] + ([nuevos[-1]] if len(nuevos) % 2 == 0 and nuevos else [])
    c.completado = len(nuevos)
    A, B, DUENO = reconstruir_segmentos()
    print(f'  · {c.nombre or "(sin nombre)"}: se completó {len(nuevos) * 25 / 1000:.1f} km hasta '
          f'{"desembocar" if termina_bien(ni, c.pts[-1], A, B, DUENO) else "el límite de búsqueda"}')
restantes = [ni for ni, c in enumerate(cauces) if not c.entubado and not termina_bien(ni, c.pts[-1], A, B, DUENO)]
print(f'tras la reparación quedan {len(restantes)} sin desembocar')

# ── nombres oficiales del IGAC para cauces de OSM que no traen nombre ────────────────────────────────────
# Si un cauce sin nombre corre pegado (≤ 70 m en al menos la mitad de su trazado) a un drenaje del IGAC con nombre,
# se le pone ese nombre. El IGAC es la fuente oficial, así que gana sobre el nombre derivado de la red.
bautizados = []
if igac_nombrados:
    for c in cauces:
        if c.nombre or c.entubado:
            continue
        P = np.array([a_metros(q) for q in c.pts])
        mejor, mejor_frac = None, 0.5
        for nombre, D in igac_nombrados:
            frac = float(np.mean([np.min(np.linalg.norm(D - q, axis=1)) <= 70 for q in P]))
            if frac >= mejor_frac:
                mejor, mejor_frac = nombre, frac
        if mejor:
            c.nombre = mejor
            bautizados.append(mejor)
    print(f'nombres del IGAC: {len(bautizados)} cauces sin nombre en OSM reciben el nombre oficial del IGAC')
    for n in sorted(set(bautizados))[:12]:
        print('  ·', n)

# ── nombre por relación: "Afluente de X" ──────────────────────────────────────
# Un cauce sin nombre desemboca en otro; si ese tiene nombre (o el siguiente aguas abajo), se le llama "Afluente de …".
# No es un nombre oficial: es un dato derivado de la red, y la ficha del mapa lo trata como tal.
A, B, DUENO = reconstruir_segmentos()


def receptor(ni):
    fin = a_metros(cauces[ni].pts[-1])
    ab = B - A
    t = np.clip(((fin - A) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-9), 0, 1)
    d = np.linalg.norm(A + ab * t[:, None] - fin, axis=1)
    d[DUENO == ni] = 1e9
    j = int(d.argmin())
    return int(DUENO[j]) if d[j] <= TOLERANCIA_M + 7 else None


derivados, indice_derivado = [], {}
sin_derivar = 0
for ni, c in enumerate(cauces):
    if c.nombre or c.entubado:
        continue
    actual, saltos, visto = receptor(ni), 0, {ni}
    while actual is not None and not cauces[actual].nombre and actual not in visto and saltos < 6:
        visto.add(actual)
        actual, saltos = receptor(actual), saltos + 1
    if actual is None or not cauces[actual].nombre:
        sin_derivar += 1
        continue
    n = cauces[actual].nombre
    texto = f'Afluente del {n}' if n.lower().startswith(('río ', 'rio ')) else f'Afluente de {n}'
    if texto not in indice_derivado:
        indice_derivado[texto] = len(derivados)
        derivados.append(texto)
    c.derivado = indice_derivado[texto]
print(f'nombres por relación: {sum(1 for c in cauces if c.derivado is not None)} cauces sin nombre ahora son "Afluente de …"; '
      f'{sin_derivar} siguen sin nombre')

# ── salida ────────────────────────────────────────────────────────────────
def codigo_nombre(c):
    """≥ 0: nombre real (lista n); ≤ -2: nombre derivado (lista d, índice = -2 - código); -1: sin nombre."""
    if c.nombre:
        return i_nombre(c.nombre)
    return -2 - c.derivado if c.derivado is not None else -1


superficie = [[c.ancho, codigo_nombre(c)] + deltas(c.pts) for c in cauces if not c.entubado and not c.igac]
de_igac = [[c.ancho, codigo_nombre(c)] + deltas(c.pts) for c in cauces if c.igac]
def segmento_max_m(pts):
    return max((math.hypot((b[0] - a[0]) * M_LON, (b[1] - a[1]) * M_LAT) for a, b in zip(pts, pts[1:])), default=0)


# Un túnel largo (conducción de varios km) no es un cauce de superficie y, dibujado con pocos puntos, se vería como
# una recta absurda. Solo se dibujan los entubados cortos, que son los que evitan que un cauce parezca cortado.
LARGO_MAX_ENTUBADO_M = 600
largos_descartados = [c for c in cauces if c.entubado and segmento_max_m(c.pts) > LARGO_MAX_ENTUBADO_M]
for c in largos_descartados:
    print(f'  · entubado largo omitido: {c.nombre or "(sin nombre)"} ({segmento_max_m(c.pts) / 1000:.1f} km en un solo tramo)')
entubados = [[c.ancho, i_nombre(c.nombre)] + deltas(c.pts) for c in cauces if c.entubado and c not in largos_descartados]
salida = RAIZ / f'public/data/mapa3d/cauces-{MUNICIPIO}.json'
salida.write_text(json.dumps({'k': K, 'n': nombres, 'd': derivados, 'c': superficie, 'i': de_igac, 't': entubados, 'l': lagos},
                             ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
anchos = sorted(c[0] for c in superficie)
print(f'cauces: {len(superficie)} en superficie (ancho {anchos[0]}–{anchos[-1]} m, mediana {anchos[len(anchos) // 2]} m), '
      f'{len(de_igac)} del IGAC, {len(entubados)} entubados, {len(lagos)} lagos, {len(nombres)} nombres, {salida.stat().st_size / 1024:.0f} KB')
