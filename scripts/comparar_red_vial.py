"""Mide la coincidencia entre la red vial modelada (red-vial-49.geojson, base IGAC) y la del mapa 3D (vias-49.json).
Uso: python scripts/comparar_red_vial.py     → imprime y guarda public/data/mapa3d/red-vial-49-comparacion.json"""
import json, sys
from pathlib import Path
import numpy as np, pyproj
from shapely.geometry import LineString
from shapely.ops import transform, unary_union
sys.path.insert(0, str(Path(__file__).parent))
import red_vial_girardota as R

UMBRALES = (10, 25, 50)
limite = R.limite_municipal()
v3d = [(c, t) for c, g in R.leer_osm() for t in R.partes_lineales(transform(R.to_m, g).intersection(limite))]
red = [(f['properties'], transform(R.to_m, LineString(f['geometry']['coordinates'])))
       for f in json.loads((R.SALIDA / 'red-vial-49.geojson').read_text(encoding='utf-8'))['features'] if f['properties']['fuente'] != 'osm']
u3d, ured = unary_union([t for _, t in v3d]), unary_union([g for _, g in red])
km3d, kred = u3d.length / 1000, ured.length / 1000
sal = {'km_red_modelada': round(kred, 1), 'km_mapa3d': round(km3d, 1), 'umbrales': {}}
for u in UMBRALES:
    b3, br = u3d.buffer(u), ured.buffer(u)
    sal['umbrales'][u] = {
        'modelada_dentro_del_3d_pct': round(100 * ured.intersection(b3).length / ured.length, 1),
        'mapa3d_dentro_de_la_modelada_pct': round(100 * u3d.intersection(br).length / u3d.length, 1)}
b3 = u3d.buffer(25)
por = {}
for p, g in red:
    k = f"{p['estado']}"
    a = por.setdefault(k, [0, 0]); a[0] += g.length; a[1] += g.intersection(b3).length
sal['por_estado_25m_pct'] = {k: round(100 * v[1] / v[0], 1) for k, v in por.items()}
por = {}
for p, g in red:
    a = por.setdefault(p['tipo'], [0, 0]); a[0] += g.length; a[1] += g.intersection(b3).length
sal['por_tipo_25m_pct'] = {k: [round(v[0] / 1000, 1), round(100 * v[1] / v[0], 1)] for k, v in por.items()}
# desfase medio: distancia de puntos del eje oficial (cada 20 m) a la vía del 3D más cercana, solo donde coinciden
d = []
for p, g in red:
    for s in np.arange(0, g.length, 20):
        q = g.interpolate(s); dist = u3d.distance(q)
        if dist <= 25: d.append(dist)
sal['desfase_m'] = {'mediana': round(float(np.median(d)), 1), 'p90': round(float(np.percentile(d, 90)), 1)}
(R.SALIDA / 'red-vial-49-comparacion.json').write_text(json.dumps(sal, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps(sal, ensure_ascii=False, indent=1))
