"""Modela la red vial de Girardota con la base oficial (IGAC) y la cruza con el mapa real de vías (OpenStreetMap).

Salidas (public/data/mapa3d/):
  red-vial-49.geojson      cada vía IGAC con su estado, fuente y estilo visual (color, ancho, trazo, opacidad)
                           + cobertura en OSM + concordancia. Las vías de OSM que el IGAC no tiene van como
                           fuente 'osm' (trazo punteado fino).
  red-vial-49-informe.json resumen del cruce (km por estado/fuente, vías IGAC sin par en OSM, etc.)
  red-vial-49-vista.html   vista previa (Leaflet) para revisar la red sobre el mapa de calles

Uso:  python scripts/red_vial_girardota.py

⚠ Los códigos del IGAC (tipo_via, estado_superficie, accesibilidad) no traen diccionario en la carpeta de insumos.
  estado_superficie se validó contra la etiqueta surface de OSM (ver comentarios de DICCIONARIO_SUPERFICIE); tipo_via y
  accesibilidad siguen siendo SUPUESTOS: confírmelos con la ficha técnica del IGAC antes de publicar. Cambiar un significado solo exige editar el diccionario.
"""
import json, math
from pathlib import Path

import pyproj
from shapely.geometry import LineString, Polygon, mapping
from shapely.ops import transform, unary_union

RAIZ = Path(__file__).resolve().parent.parent
IGAC = RAIZ / 'insumos/geografia/igac_vias_girardota.geojson'
MUNICIPIOS = RAIZ / 'public/data/mapa/municipios.json'
ID_MUNICIPIO = 49
HOLGURA_LIMITE_M = 100  # el límite del mapa está simplificado (~10 m)
OSM = RAIZ / 'public/data/mapa3d/vias-49.json'
SALIDA = RAIZ / 'public/data/mapa3d'
BUFFER_M = 25          # un tramo OSM se considera "la misma vía" si queda a menos de esto del eje IGAC (el IGAC es 1:100.000)
CONCORDA = 0.7         # fracción del eje IGAC cubierta por OSM para decir que concuerda

# --- SUPUESTOS a confirmar con la ficha del IGAC -----------------------------------------------------------------
DICCIONARIO_SUPERFICIE = {
    '3301': 'pavimentada',
    '3306': 'afirmada',        # MIXTA: contrastado con la etiqueta surface de OSM (45 % asfalto, 37 % grava, 18 % tierra)
    '3350': 'sin_pavimentar',  # contrastado con OSM: grava y barro
    # 3301 pavimentada: contrastado con OSM (97 % asfalto / pavimento / concreto)
    'Sin Valor': 'sin_dato',
}
DICCIONARIO_TIPO = {'1': 'Autopista/doble calzada', '3': 'Troncal', '4': 'Transversal', '5': 'Carretera secundaria',
                    '6': 'Carretera terciaria', '7': 'Camino / sendero'}
DICCIONARIO_ACCESO = {'3600': 'restringida', '3601': 'permanente', 'Sin Valor': 'sin_dato'}
# ------------------------------------------------------------------------------------------------------------------

# estilo por ESTADO de la vía (estado de la superficie) — la línea punteada es siempre "sin dato / sin confirmar"
ESTILO_ESTADO = {
    'pavimentada':    {'color': '#2E7D32', 'ancho': 5, 'trazo': None},
    'afirmada':       {'color': '#F9A825', 'ancho': 4, 'trazo': None},
    'sin_pavimentar': {'color': '#8D5524', 'ancho': 3, 'trazo': '6 4'},
    'sin_dato':       {'color': '#757575', 'ancho': 2, 'trazo': '2 4'},
}
# estilo por FUENTE: define opacidad y borde (qué tan confiable/duplicada es la información)
ESTILO_FUENTE = {
    'igac+osm': {'opacidad': 1.0, 'borde': '#000000', 'nota': 'oficial y confirmada en el mapa real'},
    'igac':     {'opacidad': 0.75, 'borde': '#C62828', 'nota': 'solo en la base oficial (sin par en OSM)'},
    'osm':      {'opacidad': 0.6, 'borde': None, 'nota': 'solo en el mapa real (no está en la base oficial)'},
}
ESTILO_OSM_CLASE = {0: ('#546E7A', 3), 1: ('#90A4AE', 2), 2: ('#B0BEC5', 1)}   # sin estado oficial: grises por clase OSM
NOMBRE_CLASE_OSM = {0: 'principal', 1: 'local', 2: 'sendero'}

to_m = pyproj.Transformer.from_crs(4326, 3116, always_xy=True).transform     # MAGNA-SIRGAS Bogotá, metros
to_deg = pyproj.Transformer.from_crs(3116, 4326, always_xy=True).transform


def limite_municipal():
    """Polígono del municipio (polilínea codificada con 4 decimales en municipios.json), en metros."""
    d = json.loads(MUNICIPIOS.read_text(encoding='utf-8'))
    m = next(x for x in d['municipios'] if x['id'] == ID_MUNICIPIO)
    s, i, lat, lon, pts = m['g'][0][0], 0, 0, 0, []
    while i < len(s):
        v = []
        for _ in range(2):
            r = sh = 0
            while True:
                b = ord(s[i]) - 63; i += 1; r |= (b & 31) << sh; sh += 5
                if b < 32:
                    break
            v.append(~(r >> 1) if r & 1 else r >> 1)
        lat += v[0]; lon += v[1]; pts.append((lon / 1e4, lat / 1e4))
    return transform(to_m, Polygon(pts)).buffer(HOLGURA_LIMITE_M)


def partes_lineales(g):
    if g.is_empty:
        return []
    return [g] if g.geom_type == 'LineString' else [t for x in getattr(g, 'geoms', []) for t in partes_lineales(x)]


def leer_osm():
    d = json.loads(OSM.read_text(encoding='utf-8'))
    k, lineas = d['k'], []
    for v in d['v']:
        x, y, pts = v[1], v[2], []
        pts.append((x / k, y / k))
        for i in range(3, len(v), 2):
            x += v[i]; y += v[i + 1]
            pts.append((x / k, y / k))
        if len(pts) > 1:
            lineas.append((v[0], LineString(pts)))
    return lineas


def main():
    limite = limite_municipal()
    osm_m = [(c, t) for c, g in leer_osm() for t in partes_lineales(transform(to_m, g).intersection(limite))]
    igac = []   # el IGAC trae tramos que salen del municipio: se recorta al límite
    for f in json.loads(IGAC.read_text(encoding='utf-8'))['features']:
        for t in partes_lineales(transform(to_m, LineString(f['geometry']['coordinates'])).intersection(limite)):
            if t.length > 30:
                igac.append((f['properties'], t))
    osm_buf = unary_union([g for _, g in osm_m]).buffer(BUFFER_M)

    feats, cubierto = [], []
    km = {}
    for i, (p, g) in enumerate(igac):
        zona = g.buffer(BUFFER_M)
        cob = g.intersection(osm_buf).length / g.length if g.length else 0
        cubierto.append(zona)
        sup = DICCIONARIO_SUPERFICIE.get(str(p['estado_superficie']), 'sin_dato')
        fuente = 'igac+osm' if cob >= CONCORDA else 'igac'
        # clases OSM que corren junto a esta vía (para detectar discrepancias de jerarquía)
        clases = sorted({NOMBRE_CLASE_OSM[c] for c, og in osm_m if og.intersection(zona).length > 30})
        e, ef = ESTILO_ESTADO[sup], ESTILO_FUENTE[fuente]
        props = {
            'id': f'igac-{i}', 'fuente': fuente, 'estado': sup,
            'tipo': DICCIONARIO_TIPO.get(str(p['tipo_via']), str(p['tipo_via'])),
            'carriles': {'3501': 1, '3502': 2}.get(str(p['numero_carriles'])),
            'acceso': DICCIONARIO_ACCESO.get(str(p['accesibilidad']), 'sin_dato'),
            'eje_vial': (p.get('eje_vial') or None),
            'longitud_m': round(g.length), 'cobertura_osm': round(cob, 2), 'clases_osm': clases,
            'estilo': {'color': e['color'], 'ancho': e['ancho'], 'trazo': e['trazo'],
                       'opacidad': ef['opacidad'], 'borde': ef['borde']},
        }
        feats.append({'type': 'Feature', 'geometry': mapping(transform(to_deg, g)), 'properties': props})
        km[(sup, fuente)] = km.get((sup, fuente), 0) + g.length / 1000

    # OSM que el IGAC no tiene: lo que sobra fuera del buffer de cualquier eje oficial
    cubierto_u = unary_union(cubierto)
    solo_osm_m, huecos = 0, 0
    for c, og in osm_m:
        resto = og.difference(cubierto_u)
        partes = [resto] if resto.geom_type == 'LineString' else list(getattr(resto, 'geoms', []))
        for t in partes:
            if t.is_empty or t.length < 40:
                continue
            col, anc = ESTILO_OSM_CLASE[c]
            feats.append({'type': 'Feature', 'geometry': mapping(transform(to_deg, t)), 'properties': {
                'id': f'osm-{huecos}', 'fuente': 'osm', 'estado': 'sin_dato', 'tipo': NOMBRE_CLASE_OSM[c],
                'longitud_m': round(t.length), 'cobertura_osm': 1.0, 'clases_osm': [NOMBRE_CLASE_OSM[c]],
                'estilo': {'color': col, 'ancho': anc, 'trazo': '4 3', 'opacidad': ESTILO_FUENTE['osm']['opacidad'], 'borde': None}}})
            huecos += 1
            solo_osm_m += t.length

    salida = {'type': 'FeatureCollection', 'crs_nota': 'WGS84', 'leyenda': {'estado': ESTILO_ESTADO, 'fuente': ESTILO_FUENTE},
              'features': feats}
    (SALIDA / 'red-vial-49.geojson').write_text(json.dumps(salida, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    sin_par = [f['properties'] for f in feats if f['properties']['fuente'] == 'igac']
    informe = {
        'igac_tramos': len(igac), 'igac_km': round(sum(v for v in km.values()), 1),
        'km_por_estado_y_fuente': {f'{a}|{b}': round(v, 1) for (a, b), v in sorted(km.items())},
        'osm_km_no_oficial': round(solo_osm_m / 1000, 1), 'osm_tramos_no_oficial': huecos,
        'igac_sin_par_en_osm': [{'id': s['id'], 'tipo': s['tipo'], 'estado': s['estado'], 'm': s['longitud_m'], 'cobertura': s['cobertura_osm']} for s in sin_par],
        'discrepancia_jerarquia': [{'id': f['properties']['id'], 'tipo': f['properties']['tipo'], 'osm': f['properties']['clases_osm']}
                                    for f in feats if f['properties']['fuente'] == 'igac+osm' and f['properties']['tipo'].startswith('Camino') and 'principal' in f['properties']['clases_osm']],
    }
    (SALIDA / 'red-vial-49-informe.json').write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding='utf-8')
    escribir_vista(salida)
    print(json.dumps({k: informe[k] for k in ('igac_tramos', 'igac_km', 'km_por_estado_y_fuente', 'osm_km_no_oficial')}, ensure_ascii=False, indent=1))
    print('IGAC sin par en OSM:', len(sin_par))


def escribir_vista(datos):
    html = """<!doctype html><meta charset="utf-8"><title>Red vial Girardota</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#m{height:100%;margin:0}
#l{position:absolute;z-index:999;right:10px;top:10px;background:#fff;padding:8px 10px;font:12px sans-serif;border-radius:6px;box-shadow:0 1px 4px #0005}
#l i{display:inline-block;width:22px;border-top-width:4px;border-top-style:solid;margin-right:6px;vertical-align:middle}</style>
<div id="m"></div><div id="l"><b>Estado</b><br><i style="border-color:#2E7D32"></i>pavimentada<br><i style="border-color:#F9A825"></i>afirmada / mixta
<br><i style="border-color:#8D5524;border-top-style:dashed"></i>sin pavimentar<br><i style="border-color:#757575;border-top-style:dotted"></i>sin dato
<br><b>Fuente</b><br>borde negro = IGAC+OSM · borde rojo = solo IGAC · punteado gris = solo OSM
<br><label><input type="checkbox" id="g"> sat&eacute;lite (Esri)</label></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
const D=__DATOS__;
const m=L.map('m').setView([6.38,-75.45],12);
const calles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap'}).addTo(m);
const sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Esri'});
g.onchange=()=>g.checked?(m.removeLayer(calles),sat.addTo(m)):(m.removeLayer(sat),calles.addTo(m));
const cap=L.featureGroup().addTo(m);
D.features.forEach(f=>{const s=f.properties.estilo,ll=f.geometry.coordinates.map(c=>[c[1],c[0]]);
 if(s.borde)L.polyline(ll,{color:s.borde,weight:s.ancho+3,opacity:.9}).addTo(cap);
 L.polyline(ll,{color:s.color,weight:s.ancho,opacity:s.opacidad,dashArray:s.trazo}).addTo(cap)
  .bindPopup(Object.entries(f.properties).filter(([k])=>k!='estilo').map(([k,v])=>k+': '+v).join('<br>'));});
m.fitBounds(cap.getBounds());
</script>"""
    (SALIDA / 'red-vial-49-vista.html').write_text(html.replace('__DATOS__', json.dumps(datos, ensure_ascii=False, separators=(',', ':'))), encoding='utf-8')


GOOGLE_HTML = r"""<!doctype html><meta charset="utf-8"><title>Red vial Girardota vs Google Maps</title>
<style>html,body,#m{height:100%;margin:0}#p{position:absolute;z-index:5;left:10px;top:10px;background:#fff;padding:8px 10px;font:12px sans-serif;border-radius:6px;box-shadow:0 1px 4px #0005;max-width:260px;max-height:80%;overflow:auto}
#p i{display:inline-block;width:22px;border-top:4px solid;margin-right:6px;vertical-align:middle}#p a{display:block;color:#C62828;cursor:pointer;margin:2px 0}</style>
<div id="m"></div><div id="p"><b>Red IGAC sobre Google Maps</b><br>
<label><input type="checkbox" id="u" checked> <b>Red unificada</b> (3D + IGAC)</label><br>
<label><input type="checkbox" id="v"> red IGAC original</label><br>
<label><input type="checkbox" id="s"> sat&eacute;lite</label><br>
<label><input type="checkbox" id="q"> calles OSM (todas, finas)</label><br>
<label><input type="checkbox" id="w" checked> <b style="color:#D81B60">Overture que OSM no tiene</b></label><br>
<label>Opacidad <input type="range" id="o" min="0.1" max="1" step="0.1" value="0.8"></label><br>
<i style="border-color:#2E7D32"></i>pavimentada<br><i style="border-color:#F9A825"></i>afirmada / mixta<br><i style="border-color:#8D5524;border-top-style:dashed"></i>sin pavimentar<br>
<i style="border-color:#757575;border-top-style:dotted"></i>sin dato<br><i style="border-color:#C62828;border-top-style:double"></i>borde rojo: solo IGAC, sin v&iacute;a en el 3D<br><b>Calles OSM</b> (grises, sin estado oficial)<br><i style="border-color:#37474F;border-top-width:2px"></i>principal<br><i style="border-color:#455A64;border-top-width:1px"></i>local<br><i style="border-color:#78909C;border-top-width:1px"></i>sendero / camino<br><i style="border-color:#D81B60"></i>Overture, no est&aacute; en OSM<br><b>Revisar (oficial sin par en OSM):</b><div id="r"></div></div>
<script>
const D=__DATOS__;const O=__OSM__;const V=__OVERTURE__;const U=__UNIFICADA__;
function ini(){
 const m=new google.maps.Map(document.getElementById('m'),{center:{lat:6.38,lng:-75.45},zoom:12,mapTypeId:'roadmap',streetViewControl:false});
 const L=[];let op=.8;
 const GR={0:['#37474F',2],1:['#455A64',1.2],2:['#78909C',1]};
 const LO=O.map(([c,pts])=>new google.maps.Polyline({path:pts.map(q=>({lat:q[1],lng:q[0]})),map:m,strokeColor:GR[c][0],strokeWeight:GR[c][1],strokeOpacity:.75,zIndex:1,clickable:false}));
 const LV=V.map(([c,pts])=>new google.maps.Polyline({path:pts.map(q=>({lat:q[1],lng:q[0]})),map:m,strokeColor:'#D81B60',strokeWeight:c?2:3,strokeOpacity:.9,zIndex:3,clickable:false}));
 w.onchange=()=>LV.forEach(l=>l.setVisible(w.checked));
 q.onchange=()=>LO.forEach(l=>l.setVisible(q.checked));
 D.features.filter(f=>f.properties.fuente!=='osm').forEach(f=>{const s=f.properties.estilo,path=f.geometry.coordinates.map(c=>({lat:c[1],lng:c[0]}));
  const o={path,map:m,strokeColor:s.color,strokeOpacity:s.trazo?0:op,strokeWeight:Math.max(2,s.ancho-1),zIndex:2};
  if(s.trazo)o.icons=[{icon:{path:'M 0,-1 0,1',strokeOpacity:op,scale:s.ancho-1},offset:'0',repeat:s.trazo.split(' ')[0]*3+'px'}];
  const l=new google.maps.Polyline(o);L.push([l,s]);
  l.addListener('click',e=>new google.maps.InfoWindow({position:e.latLng,content:Object.entries(f.properties).filter(([k])=>k!='estilo').map(([k,v])=>k+': '+v).join('<br>')}).open(m));
  if(f.properties.fuente==='igac'){const a=document.createElement('a');a.textContent=f.properties.id+' · '+f.properties.tipo+' · '+f.properties.longitud_m+' m';
   a.onclick=()=>{const b=new google.maps.LatLngBounds();path.forEach(q=>b.extend(q));m.fitBounds(b)};r.appendChild(a);}});
 const LU=U.map(([st,pts,fu])=>{const o={path:pts.map(q=>({lat:q[1],lng:q[0]})),map:m,strokeColor:st.color,strokeOpacity:st.trazo?0:st.opacidad,strokeWeight:Math.max(1.5,st.ancho-1),zIndex:fu==='osm'?2:4,clickable:false};
  if(st.trazo)o.icons=[{icon:{path:'M 0,-1 0,1',strokeOpacity:st.opacidad,scale:st.ancho-1},offset:'0',repeat:st.trazo.split(' ')[0]*3+'px'}];
  return new google.maps.Polyline(o)});
 u.onchange=()=>LU.forEach(l=>l.setVisible(u.checked));
 L.forEach(([l])=>l.setVisible(false));
 const pinta=()=>L.forEach(([l,s])=>{l.setVisible(v.checked);s.trazo?l.setOptions({icons:l.get('icons').map(i=>({...i,icon:{...i.icon,strokeOpacity:op}}))}):l.setOptions({strokeOpacity:op})});
 v.onchange=pinta;o.oninput=()=>{op=+o.value;pinta()};s.onchange=()=>m.setMapTypeId(s.checked?'hybrid':'roadmap');
}
</script><script src="https://maps.googleapis.com/maps/api/js?key=__KEY__&callback=ini" async></script>"""


def overture():
    """Vías de Overture que no están en OSM (scripts/red_vial_overture.py); [] si todavía no se generó."""
    ruta = SALIDA / 'red-vial-49-overture.json'
    if not ruta.exists():
        return []
    d = json.loads(ruta.read_text(encoding='utf-8'))
    R_A_M = to_m
    limite = limite_municipal()          # Overture se bajó por rectángulo: se recorta al municipio
    sal = []
    for f in d['o']:
        x, y, pts = f[2], f[3], [(f[2] / d['k'], f[3] / d['k'])]
        for i in range(4, len(f), 2):
            x += f[i]; y += f[i + 1]; pts.append((x / d['k'], y / d['k']))
        for t in partes_lineales(transform(R_A_M, LineString(pts)).intersection(limite)):
            if t.length >= 40:
                sal.append([f[1], [[round(a, 5), round(b, 5)] for a, b in transform(to_deg, t).coords]])
    return sal


def unificada():
    """Red unificada (scripts/red_vial_unificada.py) como [estilo, [[lon, lat], ...], fuente]; [] si todavía no se generó."""
    ruta = SALIDA / 'red-vial-49-unificada.geojson'
    if not ruta.exists():
        return []
    return [[f['properties']['estilo'], [[round(x, 5), round(y, 5)] for x, y in f['geometry']['coordinates']], f['properties']['fuente']]
            for f in json.loads(ruta.read_text(encoding='utf-8'))['features']]


def escribir_vista_google():
    """Vista sobre Google Maps (Maps JavaScript API). Usa la clave de src/environments/environment.ts, que solo funciona
    desde localhost, así que el archivo queda en insumos/ (no en public/) para que la clave no viaje al sitio publicado:
        python -m http.server 8000 --directory insumos/geografia   →   http://localhost:8000/red-vial-49-google.html"""
    import re
    clave = re.search(r"googleMapsApiKey:\s*'([^']+)'", (RAIZ / 'src/environments/environment.ts').read_text(encoding='utf-8')).group(1)
    datos = json.loads((SALIDA / 'red-vial-49.geojson').read_text(encoding='utf-8'))
    out = RAIZ / 'insumos/geografia/red-vial-49-google.html'
    out.write_text(GOOGLE_HTML.replace('__DATOS__', json.dumps(datos, separators=(',', ':'))).replace('__OSM__', json.dumps([[c, [[round(x, 5), round(y, 5)] for x, y in g.coords]] for c, g in leer_osm()], separators=(',', ':'))).replace('__UNIFICADA__', json.dumps(unificada(), separators=(',', ':'))).replace('__OVERTURE__', json.dumps(overture())).replace('__KEY__', clave), encoding='utf-8')
    print('Vista Google:', out)


if __name__ == '__main__':
    if '--solo-google' in __import__('sys').argv:
        escribir_vista_google()
    else:
        main()
        escribir_vista_google()
