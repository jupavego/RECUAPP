"""Tanques de almacenamiento (patio de tanques junto al Parque Industrial del Norte, Girardota).

Fuentes:
  1. Catastro: las construcciones rurales con huella circular (círculos de CAD, no casas) dentro de la zona del patio de tanques.
  2. Imagen satelital de Google Maps (captura del usuario, 2026-11-02): los tanques grandes no están en el catastro, así que se
     calcaron sobre la captura. La captura tiene la escala de 50 m ≈ 90 px (0,556 m/px) y su píxel (761, 490) es el punto
     6,3834887 N, -75,4559916 E (centro del mapa en el enlace de Google). DESPLAZAR corrige a mano el conjunto (m al este, m al norte)
     si al compararlo con las construcciones del catastro hay un corrimiento.

    public/data/mapa3d/tanques-<id>.json
        [[lon, lat, radio_m, alto_m], ...]

Uso:      python scripts/generar_tanques.py [id_municipio]   (por defecto 49 = Girardota)
Requiere: pip install shapely
"""
import json, math, sys
from pathlib import Path

import numpy as np
from shapely import transform
from shapely.geometry import shape

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 49
SALIDA = RAIZ / f'public/data/mapa3d/tanques-{MUNICIPIO}.json'
CENTRO_PX, CENTRO_LL, M_PX = (761, 490), (6.3834887, -75.4559916), 0.556
DESPLAZAR = (70.0, -76.0)       # m (este, norte): calibrado con las esquinas de las bodegas del Parque Industrial del Norte (catastro) en la captura
# (x px, y px, diámetro px) de cada tanque en la captura
TANQUES_PX = [
    (935, 133, 22), (908, 152, 24), (938, 168, 22), (858, 182, 22), (912, 182, 24), (886, 196, 24), (860, 213, 24),
    (777, 213, 20), (779, 243, 22), (700, 255, 18), (684, 260, 22), (665, 266, 18), (652, 276, 16), (712, 268, 14), (740, 285, 16),
    (883, 323, 14), (902, 320, 14), (895, 334, 14), (905, 335, 14),
]
RADIO_ZONA = 230         # m alrededor del centro de los tanques de la captura para buscar círculos del catastro
CIRCULARIDAD = 0.92
AREA_MINIMA = 25         # m²

relieve = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = relieve['bbox']
LON0, LAT0 = (oeste + este) / 2, (sur + norte) / 2
M_LON, M_LAT = 111320 * math.cos(math.radians(LAT0)), 110574


def alto(radio):
    return round(min(14.0, max(6.0, radio * 1.1)), 1)


# captura → metros del mapa (x este, y norte desde el origen del mapa)
cx0, cy0 = (CENTRO_LL[1] - LON0) * M_LON, (CENTRO_LL[0] - LAT0) * M_LAT
manuales = [(cx0 + (u - CENTRO_PX[0]) * M_PX + DESPLAZAR[0], cy0 - (v - CENTRO_PX[1]) * M_PX + DESPLAZAR[1], d * M_PX / 2) for u, v, d in TANQUES_PX]
zx = sum(t[0] for t in manuales) / len(manuales)
zy = sum(t[1] for t in manuales) / len(manuales)

reales = []
for nombre in ('rurales', 'urbanas'):
    for f in json.loads((RAIZ / f'insumos/catastro/construcciones-{nombre}-{MUNICIPIO}.geojson').read_text(encoding='utf-8'))['features']:
        if not f.get('geometry'):
            continue
        g = transform(shape(f['geometry']), lambda c: np.column_stack(((c[:, 0] - LON0) * M_LON, (c[:, 1] - LAT0) * M_LAT)))
        if g.geom_type != 'Polygon' or g.area < AREA_MINIMA or len(g.exterior.coords) < 10:
            continue
        if 4 * math.pi * g.area / g.length ** 2 < CIRCULARIDAD or math.hypot(g.centroid.x - zx, g.centroid.y - zy) > RADIO_ZONA:
            continue
        reales.append((g.centroid.x, g.centroid.y, math.sqrt(g.area / math.pi)))

tanques = list(reales)
for x, y, r in manuales:
    if all(math.hypot(x - a, y - b) > max(r, c) + 2 for a, b, c in reales):       # donde hay un círculo del catastro manda el del catastro
        tanques.append((x, y, r))
out = [[round(LON0 + x / M_LON, 7), round(LAT0 + y / M_LAT, 7), round(r, 1), alto(r)] for x, y, r in tanques]
SALIDA.write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
print(f'{len(out)} tanques ({len(reales)} del catastro, {len(out) - len(reales)} de la captura) -> {SALIDA.relative_to(RAIZ)}')
