"""Barrios del casco urbano de Girardota: une las manzanas del catastro por su código de barrio y les pone nombre.

Fuente de la geometría: servicio cartográfico del Área Metropolitana del Valle de Aburrá (gestor catastral),
capa «Manzanas» (https://portalidem.metropol.gov.co/server/rest/services/Girardota_Catastro/MapServer/2),
© Alcaldía de Girardota, Catastro. Cada manzana trae MUNICIPIO, SECTOR, CORREGIMIE y BARRIO; el mismo código va
dentro de PK_PREDIOS: municipio(3) sector(1) corregimiento(3) barrio(3) manzana(4) predio(5).

Fuente de los nombres: «Revisión y ajuste del PBOT 2020», Diagnóstico territorial tomo I, figura 1-2 «División por
barrios» (p. 31) y tabla 1-1. La figura trae cuadrícula MAGNA Colombia Bogotá (EPSG:3116); al georreferenciarla, los
límites del catastro calzan con los del PBOT y cada rótulo cae en un solo código. Dos casos se desempataron aparte:
  015  contiene la «Sede Comunal El Naranjal» (capa Equipamientos Urbanos de Girardota_POT, mismo servicio).
  004  franja vecina, queda Nuevo Horizonte por descarte (confianza media).
  016  el rótulo San José cae en su punta norte; el catastro lo extiende sobre la ladera oriental (confianza media).
  018 y 019 no tienen barrio en el PBOT: suelo urbano del norte y urbanizaciones nuevas al sur de Santana.
Solo el corregimiento 001 (cabecera); el 002 son centros poblados y no se incluyen.

    public/data/mapa3d/barrios-49.geojson   un polígono por barrio, lon/lat, con codigo, nombre, confianza, nota,
                                            rotulo [lon, lat] (punto interior para el nombre), manzanas, area_ha (de las manzanas, sin calles) y area_pbot_ha (tabla 1-1)

Uso:      python scripts/generar_barrios.py
Requiere: pip install shapely
"""
import json, math, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import polylabel, transform, unary_union

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / 'public/data/mapa3d/barrios-49.geojson'
CAPA = 'https://portalidem.metropol.gov.co/server/rest/services/Girardota_Catastro/MapServer/2/query'
CIERRE = 6        # m, tapa las calles internas de un barrio (huecos de hasta 12 m) sin crecer su borde exterior

# codigo de barrio → (nombre, confianza, superficie en la tabla 1-1 del PBOT 2020 en ha, nota)
BARRIOS = {
    '001': ('Aurelio Mejía', 'alta', 6.27, None),
    '002': ('Centro', 'alta', None, None),
    '003': ('El Llano', 'alta', 28.08, 'incluye la urbanización Palmas del Llano'),
    '004': ('Nuevo Horizonte', 'media', 1.65, 'franja entre La Ceiba, El Naranjal y El Salado; nombre por descarte'),
    '005': ('El Paraíso', 'alta', 4.67, None),
    '006': ('El Salado', 'alta', 1.06, None),
    '007': ('La Florida', 'alta', 3.70, None),
    '008': ('Girardota La Nueva', 'alta', 6.86, None),
    '009': ('Guaduales', 'alta', 0.82, None),
    '010': ('Guayacanes', 'alta', 4.15, None),
    '011': ('Juan XXIII', 'alta', 10.70, None),
    '012': ('La Ceiba', 'alta', 3.49, None),
    '013': ('La Ferrería', 'alta', 4.78, None),
    '014': ('Montecarlo', 'alta', 5.40, None),
    '015': ('El Naranjal', 'alta', 0.69, 'contiene la Sede Comunal El Naranjal'),
    '016': ('San José', 'media', None, 'el catastro lo extiende sobre la ladera oriental, fuera del barrio del PBOT'),
    '017': ('Santana', 'alta', 3.66, None),
    '018': (None, 'sin nombre', None, 'suelo urbano del norte sin barrio en el PBOT'),
    '019': (None, 'sin nombre', None, 'urbanizaciones nuevas al sur de Santana (p. ej. Juan Pablo II), sin barrio en el PBOT'),
}

q = urllib.parse.urlencode({'where': "CORREGIMIE='001'", 'outFields': 'PK_MANZANA,BARRIO', 'outSR': 4326,
                            'resultRecordCount': 2000, 'f': 'geojson'})
req = urllib.request.Request(f'{CAPA}?{q}', headers={'User-Agent': 'recuapp-poc/0.1'})
manzanas = json.loads(urllib.request.urlopen(req, timeout=90).read())['features']
print(f'manzanas descargadas: {len(manzanas)}')

lat0 = 6.376
M_LON, M_LAT = 111320 * math.cos(math.radians(lat0)), 110574
a_metros = lambda g: transform(lambda lo, la: (lo * M_LON, la * M_LAT), g)
a_grados = lambda g: transform(lambda x, y: (x / M_LON, y / M_LAT), g)

por_barrio = defaultdict(list)
for f in manzanas:
    g = shape(f['geometry'])
    if not g.is_empty:
        por_barrio[f['properties']['BARRIO']].append(a_metros(g).buffer(0))

faltan = sorted(set(por_barrio) - set(BARRIOS))
if faltan:
    print(f'OJO: códigos de barrio sin nombre en la tabla: {faltan}')

salida = []
for codigo in sorted(por_barrio):
    lista = por_barrio[codigo]
    manz = unary_union(lista)
    poligono = manz.buffer(CIERRE, join_style=2).buffer(-CIERRE, join_style=2).union(manz)
    nombre, confianza, area_pbot, nota = BARRIOS.get(codigo, (None, 'sin nombre', None, None))
    # rótulo: punto interior de la parte más grande, alejado del borde (polo de inaccesibilidad)
    mayor = max(getattr(poligono, 'geoms', [poligono]), key=lambda p: p.area)
    rotulo = a_grados(polylabel(mayor, tolerance=1))
    salida.append({'type': 'Feature', 'geometry': mapping(a_grados(poligono)), 'properties': {
        'codigo': codigo, 'pk': f'3081001{codigo}', 'nombre': nombre, 'confianza': confianza, 'nota': nota,
        'rotulo': [round(rotulo.x, 6), round(rotulo.y, 6)],
        'manzanas': len(lista), 'area_ha': round(manz.area / 1e4, 2), 'area_pbot_ha': area_pbot}})
    print(f'{codigo} {nombre or "—":20s} {len(lista):3d} manzanas {manz.area / 1e4:7.2f} ha')

SALIDA.write_text(json.dumps({'type': 'FeatureCollection', 'fuente':
    'Catastro de Girardota (AMVA, capa Manzanas); nombres: Revisión y ajuste PBOT 2020, figura 1-2',
    'features': salida}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'escrito {SALIDA.relative_to(RAIZ)} ({SALIDA.stat().st_size // 1024} KB)')
