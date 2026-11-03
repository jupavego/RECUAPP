"""Infraestructura de servicios públicos de Girardota desde OpenStreetMap (Overpass): líneas de alta tensión, subestaciones,
centrales, plantas de tratamiento y tanques de agua.

Las redes de acueducto y alcantarillado NO están en OSM: salen del geoportal de EPM / PBOT (Figura 9-66) y quedan pendientes.

    public/data/mapa3d/infraestructura-<id>.json
        { "lineas":  [[kV, [[lon, lat], ...], circuitos], ...],
          "subs":    [[nombre, kV, [[lon, lat], ...]], ...],          (polígono de la subestación)
          "plantas": [[tipo, nombre, [[lon, lat], ...]], ...] }       (tipo: hidro | ptap | tanque; 1 punto = nodo)

Uso: python scripts/generar_infraestructura.py [id_municipio]   (por defecto 49 = Girardota)
"""
import json, sys, urllib.parse, urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 else 49
SALIDA = RAIZ / f'public/data/mapa3d/infraestructura-{MUNICIPIO}.json'
oeste, sur, este, norte = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))['bbox']
BBOX = f'{sur},{oeste},{norte},{este}'
CONSULTA = f'''[out:json][timeout:60];(
nwr["man_made"~"wastewater_plant|water_works|storage_tank|water_tower"]({BBOX});
nwr["power"~"^(substation|line|plant)$"]({BBOX}););out geom;'''
HOSTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']


def pedir():
    for h in HOSTS:
        try:
            r = urllib.request.Request(h, data=urllib.parse.urlencode({'data': CONSULTA}).encode(), headers={'User-Agent': 'recuapp/1.0'})
            return json.loads(urllib.request.urlopen(r, timeout=120).read())
        except Exception as e:
            print(h, e)
    raise SystemExit('Overpass no responde')


def pts(e):
    if e['type'] == 'node':
        return [[round(e['lon'], 7), round(e['lat'], 7)]]
    return [[round(p['lon'], 7), round(p['lat'], 7)] for p in e.get('geometry', [])]


def kv(t):
    try:
        return round(int(t.get('voltage', '0').split(';')[0]) / 1000)
    except ValueError:
        return 0


lineas, subs, plantas = [], [], []
for e in pedir()['elements']:
    t = e['tags']
    if t.get('power') == 'line':
        lineas.append([kv(t), pts(e), int(t['circuits']) if t.get('circuits', '').isdigit() else 1])
    elif t.get('power') == 'substation':
        subs.append([t.get('name') or t.get('ref') or 'Subestación', kv(t), pts(e)])
    elif t.get('power') == 'plant':
        plantas.append(['hidro', t.get('name', 'Central hidroeléctrica'), pts(e)])
    elif t.get('man_made') == 'wastewater_plant' or t.get('man_made') == 'water_works':
        plantas.append(['ptap', t.get('name', 'Planta de tratamiento'), pts(e)])
    elif t.get('man_made') in ('storage_tank', 'water_tower') and (t.get('content') == 'water' or t.get('operator')):
        plantas.append(['tanque', t.get('name') or t.get('operator', 'Tanque de agua'), pts(e)])
SALIDA.write_text(json.dumps({'lineas': lineas, 'subs': subs, 'plantas': plantas}, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
print(f'{len(lineas)} líneas, {len(subs)} subestaciones, {len(plantas)} plantas/tanques -> {SALIDA.relative_to(RAIZ)}')
