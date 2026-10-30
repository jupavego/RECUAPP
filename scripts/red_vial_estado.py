"""Archivo de estado vial para el mapa 3D, sacado de la red unificada (red-vial-49-unificada.geojson):
los tramos de vías que ya existen en el 3D y que el IGAC dice que NO están pavimentados. El mapa los repinta encima del asfalto.

    public/data/mapa3d/vias-estado-49.json   {"k": 1e5, "v": [[estado, clase, x0, y0, dx, dy, ...], ...]}

estado: 1 mixta (IGAC 3306: afirmado con tramos pavimentados), 2 sin pavimentar (IGAC 3350: tierra / grava)
clase:  0 vía principal, 1 vía local (los senderos ya se dibujan de tierra y no se repintan)
Las coordenadas son enteros (grados × k), la primera pareja absoluta y el resto como diferencias.

Uso: python scripts/red_vial_unificada.py && python scripts/red_vial_estado.py
"""
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DATOS = RAIZ / 'public/data/mapa3d'
K = 100000
ESTADOS = {'afirmada': 1, 'sin_pavimentar': 2}
CLASES = {'principal': 0, 'local': 1}

filas, km = [], {1: 0.0, 2: 0.0}
for f in json.loads((DATOS / 'red-vial-49-unificada.geojson').read_text(encoding='utf-8'))['features']:
    p = f['properties']
    if p['fuente'] != 'igac+osm' or p['estado'] not in ESTADOS or p.get('clase_osm') not in CLASES:
        continue
    pts = [(round(x * K), round(y * K)) for x, y in f['geometry']['coordinates']]
    if len(pts) < 2:
        continue
    fila = [ESTADOS[p['estado']], CLASES[p['clase_osm']], pts[0][0], pts[0][1]]
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        fila += [bx - ax, by - ay]
    filas.append(fila)
    km[ESTADOS[p['estado']]] += p['longitud_m'] / 1000
(DATOS / 'vias-estado-49.json').write_text(json.dumps({'k': K, 'v': filas}, separators=(',', ':')), encoding='utf-8')
print(f"{len(filas)} tramos: mixta {km[1]:.1f} km, sin pavimentar {km[2]:.1f} km")
