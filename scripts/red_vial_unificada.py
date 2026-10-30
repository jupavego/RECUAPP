"""Red vial unificada de Girardota: la geometría del mapa 3D (vias-49.json, continua y ya validada) como base, con los
atributos oficiales del IGAC (estado de la superficie, tipo, carriles, acceso) pasados a los tramos que coinciden.

  · Cada vía del 3D se corta cada PASO m; cada pedazo toma el tramo IGAC más cercano (≤ BUFFER_M) y casi paralelo (≤ ANGULO_MAX°).
  · Los pedazos contiguos con el mismo tramo vuelven a unirse (los de menos de MIN_TRAMO_M se absorben en el vecino), sin mover la geometría.
  · Lo que el IGAC trae y el 3D no tiene va aparte (fuente 'igac', borde rojo) con sus extremos enganchados a la red del 3D.
  · Lo del 3D sin equivalente oficial queda gris por clase, sin estado (fuente 'osm').

Salida: public/data/mapa3d/red-vial-49-unificada.geojson y red-vial-49-unificada-informe.json
Uso:    python scripts/red_vial_unificada.py
"""
import json, math, sys
from pathlib import Path

from shapely import STRtree
from shapely.geometry import LineString, Point, mapping
from shapely.ops import nearest_points, substring, transform, unary_union

sys.path.insert(0, str(Path(__file__).parent))
import red_vial_girardota as R

PASO = 10
BUFFER_M = 25
ANGULO_MAX = 35
MIN_TRAMO_M = 40


def rumbo(a, b):
    return math.atan2(b[1] - a[1], b[0] - a[0])


def dif_angulo(a, b):
    d = abs(a - b) % math.pi
    return math.degrees(min(d, math.pi - d))


def fusionar(runs):
    fus = []
    for r in runs:
        if fus and fus[-1][0] == r[0]:
            fus[-1][2] = r[2]
        else:
            fus.append(list(r))
    return fus


def absorber_cortos(runs, paso_m):
    """Un tramo asignado de menos de MIN_TRAMO_M toma el de su vecino (evita parpadeo en cruces)."""
    runs = fusionar(runs)
    cambiado = True
    while cambiado and len(runs) > 1:
        cambiado = False
        for j, (a, k0, k1) in enumerate(runs):
            if (k1 - k0) * paso_m >= MIN_TRAMO_M:
                continue
            vecino = runs[j - 1] if j > 0 else runs[j + 1]
            runs[j][0] = vecino[0]
            runs = fusionar(runs)
            cambiado = True
            break
    return runs


def main():
    limite = R.limite_municipal()
    igac = []
    for f in json.loads(R.IGAC.read_text(encoding='utf-8'))['features']:
        for t in R.partes_lineales(transform(R.to_m, LineString(f['geometry']['coordinates'])).intersection(limite)):
            if t.length > 30:
                igac.append((f['properties'], t))
    base = [(c, t) for c, g in R.leer_osm() for t in R.partes_lineales(transform(R.to_m, g).intersection(limite))]
    arbol = STRtree([g for _, g in igac])

    def tramo_cercano(a, b, clase):
        """índice del tramo IGAC más cercano y casi paralelo al pedazo a-b, o None"""
        m = Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        r0 = rumbo(a, b)
        mejor, dmejor = None, BUFFER_M + 1
        for i in arbol.query(m.buffer(BUFFER_M)):
            p, g = igac[i]
            d = g.distance(m)
            if d >= dmejor:
                continue
            s = g.project(m)
            q0, q1 = g.interpolate(max(0, s - 8)), g.interpolate(min(g.length, s + 8))
            if (q0.x, q0.y) == (q1.x, q1.y) or dif_angulo(r0, rumbo((q0.x, q0.y), (q1.x, q1.y))) > ANGULO_MAX:
                continue
            if clase == 2 and str(p['tipo_via']) not in ('6', '7'):     # un sendero junto a una vía mayor no hereda su estado
                continue
            mejor, dmejor = int(i), d
        return mejor

    feats, usado, km = [], [], {}
    for clase, g in base:
        n = max(1, int(round(g.length / PASO)))
        cortes = [g.length * k / n for k in range(n + 1)]
        asign = []
        for s0, s1 in zip(cortes, cortes[1:]):
            a, b = g.interpolate(s0), g.interpolate(s1)
            asign.append(tramo_cercano((a.x, a.y), (b.x, b.y), clase))
        runs = []
        for k, a in enumerate(asign):
            if runs and runs[-1][0] == a:
                runs[-1][2] = k + 1
            else:
                runs.append([a, k, k + 1])
        for a, k0, k1 in absorber_cortos(runs, g.length / n):
            t = substring(g, cortes[k0], cortes[k1])
            if t.length < 1:
                continue
            if a is None:
                col, anc = R.ESTILO_OSM_CLASE[clase]
                props = {'fuente': 'osm', 'estado': 'sin_dato', 'tipo': R.NOMBRE_CLASE_OSM[clase], 'clase_osm': R.NOMBRE_CLASE_OSM[clase],
                         'estilo': {'color': col, 'ancho': anc, 'trazo': None, 'opacidad': R.ESTILO_FUENTE['osm']['opacidad'], 'borde': None}}
            else:
                p = igac[a][0]
                sup = R.DICCIONARIO_SUPERFICIE.get(str(p['estado_superficie']), 'sin_dato')
                e = R.ESTILO_ESTADO[sup]
                props = {'fuente': 'igac+osm', 'estado': sup, 'tipo': R.DICCIONARIO_TIPO.get(str(p['tipo_via']), str(p['tipo_via'])),
                         'clase_osm': R.NOMBRE_CLASE_OSM[clase], 'carriles': {'3501': 1, '3502': 2}.get(str(p['numero_carriles'])),
                         'acceso': R.DICCIONARIO_ACCESO.get(str(p['accesibilidad']), 'sin_dato'), 'eje_vial': p.get('eje_vial') or None,
                         'igac_id': a, 'estilo': {'color': e['color'], 'ancho': e['ancho'], 'trazo': e['trazo'], 'opacidad': 1.0, 'borde': None}}
                usado.append(t.buffer(BUFFER_M))
            props['longitud_m'] = round(t.length)
            clave = (props['fuente'], props['estado'])
            km[clave] = km.get(clave, 0) + t.length / 1000
            feats.append({'type': 'Feature', 'geometry': mapping(transform(R.to_deg, t)), 'properties': props})

    # lo oficial que el 3D no tiene: se agrega, con los extremos enganchados a la red
    red3d = unary_union([g for _, g in base])
    cubierto = unary_union(usado)
    for i, (p, g) in enumerate(igac):
        for t in R.partes_lineales(g.difference(cubierto)):
            if t.length < 40:
                continue
            pts = list(t.coords)
            for idx in (0, -1):
                q = nearest_points(Point(pts[idx]), red3d)[1]
                if Point(pts[idx]).distance(q) <= BUFFER_M:
                    pts[idx] = (q.x, q.y)
            t = LineString(pts)
            sup = R.DICCIONARIO_SUPERFICIE.get(str(p['estado_superficie']), 'sin_dato')
            e = R.ESTILO_ESTADO[sup]
            props = {'fuente': 'igac', 'estado': sup, 'tipo': R.DICCIONARIO_TIPO.get(str(p['tipo_via']), str(p['tipo_via'])), 'igac_id': i,
                     'longitud_m': round(t.length), 'estilo': {'color': e['color'], 'ancho': e['ancho'], 'trazo': e['trazo'], 'opacidad': 0.75, 'borde': '#C62828'}}
            km[('igac', sup)] = km.get(('igac', sup), 0) + t.length / 1000
            feats.append({'type': 'Feature', 'geometry': mapping(transform(R.to_deg, t)), 'properties': props})

    for k, f in enumerate(feats):
        f['properties']['id'] = f'u-{k}'
    (R.SALIDA / 'red-vial-49-unificada.geojson').write_text(
        json.dumps({'type': 'FeatureCollection', 'features': feats}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    informe = {'tramos': len(feats), 'km_total': round(sum(km.values()), 1),
               'km_con_atributos_igac': round(sum(v for (f, _), v in km.items() if f == 'igac+osm'), 1),
               'km_base_3d': round(sum(g.length for _, g in base) / 1000, 1),
               'km_igac_agregado_sin_par': round(sum(v for (f, _), v in km.items() if f == 'igac'), 1),
               'km_por_fuente_y_estado': {f'{a}|{b}': round(v, 1) for (a, b), v in sorted(km.items())}}
    (R.SALIDA / 'red-vial-49-unificada-informe.json').write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(informe, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
