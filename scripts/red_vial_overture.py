"""Busca vías de Overture Maps (transporte) que no están en el mapa real que usa el 3D (OpenStreetMap, vias-<id>.json).
Overture reúne OSM y otras fuentes (p. ej. TomTom): lo que aporta de más son vías posiblemente faltantes en OSM.

Salida: public/data/mapa3d/red-vial-49-overture.json  {"k": 1e5, "o": [[fuente(0 OSM-posterior, 1 otra), clase, x0, y0, dx, dy, ...]], "resumen": {...}}
Uso:    python scripts/red_vial_overture.py        (requiere: pip install overturemaps)
Datos © colaboradores de OpenStreetMap (ODbL), TomTom y Overture Maps Foundation.
"""
import ast, json, shutil, subprocess, sys, tempfile
from pathlib import Path

import pyproj
from shapely.geometry import LineString, Point
from shapely.ops import transform, unary_union

RAIZ = Path(__file__).resolve().parent.parent
DATOS = RAIZ / 'public/data/mapa3d'
BUFFER_M = 15           # un tramo de Overture se considera ya presente en OSM si queda a menos de esto
LARGO_MINIMO_M = 40
K = 100000
to_m = pyproj.Transformer.from_crs(4326, 3116, always_xy=True).transform
to_deg = pyproj.Transformer.from_crs(3116, 4326, always_xy=True).transform
SERVICIO_DESCARTADO = {'driveway', 'parking_aisle', 'drive_through', 'emergency_access'}   # igual que generar_vias_edificios.py
CLASES_CALLE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street'}   # 'service' se omite: son circuitos internos de fincas y parqueaderos
CLASES_CAMINO = {'track', 'path', 'footway', 'bridleway', 'cycleway', 'pedestrian', 'steps'}


def lineas(g):
    if g.is_empty:
        return []
    return [g] if g.geom_type == 'LineString' else [t for x in getattr(g, 'geoms', []) for t in lineas(x)]


def leer_osm():
    d = json.loads((DATOS / 'vias-49.json').read_text(encoding='utf-8'))
    k, sal = d['k'], []
    for v in d['v']:
        x, y, pts = v[1], v[2], [(v[1] / k, v[2] / k)]
        for i in range(3, len(v), 2):
            x += v[i]; y += v[i + 1]; pts.append((x / k, y / k))
        if len(pts) > 1:
            sal.append(transform(to_m, LineString(pts)))
    return sal


def main():
    relieve = json.loads((DATOS / 'relieve-49.json').read_text(encoding='utf-8'))
    o, s, e, n = relieve['bbox']
    with tempfile.TemporaryDirectory() as tmp:
        bruto = Path(tmp) / 'segmentos.geojson'
        subprocess.run([shutil.which('overturemaps'), 'download', f'--bbox={o},{s},{e},{n}', '-f', 'geojson', '--type=segment', '-o', str(bruto)], check=True)
        feats = json.loads(bruto.read_text(encoding='utf-8'))['features']
    osm = unary_union(leer_osm()).buffer(BUFFER_M)
    salida, km = [], {'otra_fuente': 0.0, 'solo_osm_reciente': 0.0}
    for f in feats:
        p = f['properties']
        clase = p.get('class')
        if p.get('subtype') != 'road' or clase not in CLASES_CALLE | CLASES_CAMINO:
            continue
        fuentes = p.get('sources') or []
        fuentes = ast.literal_eval(fuentes) if isinstance(fuentes, str) else fuentes
        otra = any(x.get('dataset') != 'OpenStreetMap' for x in fuentes)
        for t in lineas(transform(to_m, LineString(f['geometry']['coordinates'])).difference(osm)):
            if t.length < LARGO_MINIMO_M or (t.length < 800 and Point(t.coords[0]).distance(Point(t.coords[-1])) < 15):   # circuito cerrado
                continue
            pts = [(round(x * K), round(y * K)) for x, y in transform(to_deg, t).coords]
            fila = [1 if otra else 0, 0 if clase in CLASES_CALLE else 2, pts[0][0], pts[0][1]]
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                fila += [bx - ax, by - ay]
            salida.append(fila)
            km['otra_fuente' if otra else 'solo_osm_reciente'] += t.length / 1000
    resumen = {'tramos': len(salida), 'km_otra_fuente': round(km['otra_fuente'], 1), 'km_osm_posterior': round(km['solo_osm_reciente'], 1)}
    (DATOS / 'red-vial-49-overture.json').write_text(json.dumps({'k': K, 'o': salida, 'resumen': resumen}, separators=(',', ':')), encoding='utf-8')
    print(resumen)


if __name__ == '__main__':
    main()
