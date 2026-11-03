"""Redes subterráneas de acueducto y alcantarillado de Girardota: geoportal público de EPM (ArcGIS FeatureServer del visor
«Redes Acueducto y Alcantarillado»), recortadas al cuadro del municipio.

    public/data/mapa3d/redes-agua-49.json
        { "t": [[tipo, diametro_mm, profundidad_m, [[lon, lat], ...], material, estado, nombre], ...],
          "p": [[tipo, lon, lat, dato], ...] }
    tipo de tubería: a1 acueducto primaria · a2 acueducto secundaria · rs alcantarillado sanitario · rl alcantarillado lluvias/combinado
    tipo de punto:   tq tanque (dato = capacidad m³) · hd hidrante · vl válvula primaria · cm cámara de inspección · ds descarga

Uso: python scripts/generar_redes_agua.py [id_municipio]   (por defecto 49 = Girardota)
"""
import json, sys, urllib.parse, urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 else 49
SALIDA = RAIZ / f'public/data/mapa3d/redes-agua-{MUNICIPIO}.json'
oeste, sur, este, norte = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))['bbox']
BASE = 'https://services1.arcgis.com/lHSB5M3vxFT82S7P/ArcGIS/rest/services/'
AC, AL, MZA, MZL = 'P_Redes_Acueducto_GE', 'P_Redes_Alcantarillado_GE2', 'P_Matriz_Acueducto_GE', 'P_Matriz_Alcantarillado_GE'


def consultar(servicio, capa):
    """Todas las entidades de la capa dentro del cuadro, con su geometría en WGS84, de a 1000."""
    out, desde = [], 0
    while True:
        q = urllib.parse.urlencode({'where': '1=1', 'geometry': f'{oeste},{sur},{este},{norte}', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
                                    'outSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*', 'returnGeometry': 'true',
                                    'resultOffset': desde, 'resultRecordCount': 1000, 'f': 'json'})
        r = urllib.request.Request(f'{BASE}{servicio}/FeatureServer/{capa}/query?{q}', headers={'User-Agent': 'Mozilla/5.0'})
        d = json.loads(urllib.request.urlopen(r, timeout=120).read())
        out += d.get('features', [])
        if not d.get('exceededTransferLimit'):
            return out
        desde += len(d['features'])


def num(v, por=1.0):
    try:
        return round(float(v) * por, 2) if v not in (None, '') else 0
    except (TypeError, ValueError):
        return 0


tubos, puntos = [], []


def tuberias(servicio, capa, tipo, fdiam, fprof=None, por_diam=1.0, clasifica=None, fnombre=None):
    n = 0
    for f in consultar(servicio, capa):
        a = f['attributes']
        if str(a.get('ESTADO') or '').upper() in ('ABANDONADO', 'RETIRADO', 'PROYECTADO'):
            continue
        t = clasifica(a) if clasifica else tipo
        for tramo in (f.get('geometry') or {}).get('paths', []):
            pts = [[round(p[0], 6), round(p[1], 6)] for p in tramo]
            if len(pts) > 1:
                tubos.append([t, num(a.get(fdiam), por_diam), num(a.get(fprof)) if fprof else 0, pts, str(a.get('MATERIAL') or ''), str(a.get('ESTADO') or ''),
                              str(a.get(fnombre) or '') if fnombre else ''])
                n += 1
    print(f'{servicio}/{capa} {tipo}: {n} tramos')


def agua_lluvia(a):
    return 'rl' if any(k in str(a.get('TIPO_AGUA') or '').upper() for k in ('LLUV', 'COMBIN', 'PLUVI')) else 'rs'


def marcas(servicio, capa, tipo, fdato=None):
    n = 0
    for f in consultar(servicio, capa):
        g = f.get('geometry')
        if g and 'x' in g:
            puntos.append([tipo, round(g['x'], 6), round(g['y'], 6), num((f['attributes'] or {}).get(fdato)) if fdato else 0])
            n += 1
    print(f'{servicio}/{capa} {tipo}: {n} puntos')


tuberias(AC, 15, 'a1', 'DIAMETRO_NOMINAL', 'PROFUNDIDAD', fnombre='NOMBRE_CIRCUITO')
tuberias(AC, 16, 'a2', 'DIAMETRO_NOMINAL', 'PROFUNDIDAD', fnombre='NOMBRE_CIRCUITO')
tuberias(MZA, 12, 'a1', 'DIAMETRO_NOMINAL', 'PROFUNDIDAD')
tuberias(MZA, 13, 'a2', 'DIAMETRO_NOMINAL', 'PROFUNDIDAD')
tuberias(AL, 11, 'rs', 'DIAMETRO', 'PROF_BATEA_ENTRADA', clasifica=agua_lluvia, fnombre='NOMBRE_COLECTOR_INTERCEPTOR')
tuberias(MZL, 5, 'rs', 'DIAMETRO', clasifica=agua_lluvia)
marcas(AC, 12, 'tq', 'CAPACIDAD')
marcas(AC, 3, 'hd')
marcas(AC, 9, 'vl')
marcas(AL, 4, 'cm')
marcas(AL, 3, 'ds')
SALIDA.write_text(json.dumps({'t': tubos, 'p': puntos}, separators=(',', ':')), encoding='utf-8')
print(f'{len(tubos)} tramos, {len(puntos)} puntos -> {SALIDA.relative_to(RAIZ)} ({SALIDA.stat().st_size // 1024} KB)')
