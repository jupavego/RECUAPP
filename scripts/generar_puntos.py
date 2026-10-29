"""Arma los puntos de interes de un municipio a partir de los Excel de la carpeta insumos/.

Por ahora solo Girardota (DIVIPOLA 05308). Salida: public/data/mapa/puntos/<id municipio>.json

Cada punto: c categoria, t tipo, n nombre, d direccion, tel, web, lat/lng, a aproximada (true si la ubicacion es el
centro de la vereda o una estimacion por direccion), g estimada por direccion, v vereda, f fuente y e estado.

Los datos del mapa siempre son coordenadas. Cuando el Excel solo trae una direccion, se convierte aqui, una vez:
  1. scripts/coordenadas_manuales.json  {"Nombre exacto del punto": [lat, lng]}  siempre manda
     (con un tercer valor true si la coordenada es solo una estimacion).
  2. OpenStreetMap (Nominatim), con las respuestas guardadas en scripts/geocache.json. Solo ubica la calle, no el numero
     de puerta, asi que se acepta unicamente si cae dentro de la zona urbana (cabecera) y el punto queda marcado como
     estimado (g). Lo que no se logre ubicar se omite y se avisa al final: se resuelve con coordenadas manuales.

Uso:  python scripts/generar_puntos.py
"""
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from math import cos, sin, pi
from pathlib import Path

import openpyxl
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

RAIZ = Path(__file__).resolve().parent.parent
INSUMOS = RAIZ / "insumos"
SALIDA = RAIZ / "public" / "data" / "mapa" / "puntos"
MUNICIPIO = "Girardota"
DIVIPOLA = "05308"
ID_MUNICIPIO = 49  # posicion en public/data/mapa/municipios.json
BBOX = (-75.50, 6.30, -75.39, 6.45)  # oeste, sur, este, norte (con margen)


def norm(s) -> str:
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def dentro(lat, lng) -> bool:
    return BBOX[0] <= lng <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


class Hoja:
    """Hoja de Excel cuyas filas se rellenan hasta 20 columnas (en modo lectura pueden venir mas cortas)."""

    def __init__(self, ws):
        self.ws = ws

    def iter_rows(self, min_row=1, values_only=True):
        for r in self.ws.iter_rows(min_row=min_row, values_only=values_only):
            yield tuple(r) + (None,) * max(0, 20 - len(r))


def hoja(archivo: str, indice: int = 0) -> Hoja:
    return Hoja(openpyxl.load_workbook(INSUMOS / archivo, read_only=True).worksheets[indice])


def limpio(v):
    v = None if v is None else str(v).strip()
    return v or None


puntos: list[dict] = []
avisos: list[str] = []


def agregar(**p):
    puntos.append({k: v for k, v in p.items() if v not in (None, "")})


# ── Cultura, patrimonio y medios ───────────────────────────────────────────────
TIPOS_CULTURA = {
    "Casa de Cultura": ("cultura", "Casa de cultura"),
    "Escuela de música": ("cultura", "Escuela de música"),
    "Biblioteca": ("cultura", "Biblioteca"),
    "Escenario - LEP": ("cultura", "Escenario cultural"),
    "Emisora de interés público": ("cultura", "Emisora de interés público"),
    "Emisora comercial": ("cultura", "Emisora comercial"),
    "Emisora comunitaria": ("cultura", "Emisora comunitaria"),
    "Bienes Inmuebles Patrimoniales - BICN": ("patrimonio", "Bien de interés cultural nacional"),
    "Sitio Arqueológico": ("patrimonio", "Sitio arqueológico"),
}
FUENTE_CULTURA = "Ministerio de las Culturas · Espacios de las artes, las culturas y los saberes"

for r in hoja("cultura/Espacios_de_las_Artes,_las_Culturas_y_los_Saberes_20261028.xlsx").iter_rows(min_row=2, values_only=True):
    if str(r[1]) != DIVIPOLA or r[0] not in TIPOS_CULTURA:
        continue
    cat, tipo = TIPOS_CULTURA[r[0]]
    lat, lng = float(r[7]), float(r[8])
    if not dentro(lat, lng):
        avisos.append(f"cultura fuera del municipio: {r[4]} {lat},{lng}")
        continue
    # la descripcion trae a veces la direccion y a veces datos de frecuencia o NIT; solo se usa la direccion de lugar
    agregar(c=cat, t=tipo, n=limpio(r[4]), d=limpio(r[6]) if cat == "cultura" and r[0] not in ("Escuela de música",) and not str(r[6]).startswith("Lugar") else None,
            lat=round(lat, 6), lng=round(lng, 6),
            f=f"{limpio(r[9])} · vía {FUENTE_CULTURA}" if limpio(r[9]) else FUENTE_CULTURA,
            x=limpio(r[5]) if r[0].startswith("Emisora") else None)

# La biblioteca publica esta en cultura y en el directorio RNBP: se enriquece la de cultura con el RNBP y no se duplica.
for r in hoja("bibliotecas/DirectorioRNBP.xlsx").iter_rows(values_only=True):
    if r and r[3] and norm(r[3]) == "girardota":
        for p in puntos:
            if p["t"] == "Biblioteca":
                p.update({k: v for k, v in dict(
                    n=limpio(r[7]), d=limpio(r[8]), tel=limpio(r[9]).split("/")[0] if limpio(r[9]) else None,
                    mail=limpio(r[11]), e=limpio(r[14]),
                    f="Red Nacional de Bibliotecas Públicas · Directorio RNBP").items() if v})

# ── Deporte ────────────────────────────────────────────────────────────────────
TIPOS_DEPORTE = {
    "2.5": "Pista de patinaje", "2.6": "Pista de bicicrós", "3.1": "Placa polideportiva", "3.2": "Placa polideportiva",
    "5.1": "Cancha de fútbol", "10.1": "Cancha sintética", "10.2": "Cancha sintética",
}
for r in hoja("deporte/Consolidado_Escenarios_Mindeporte_20261028.xlsx").iter_rows(min_row=2, values_only=True):
    if norm(r[3]) != "girardota":
        continue
    m = re.findall(r"-?\d+\.\d+", str(r[12]).replace(" - ", " -"))
    if len(m) < 2:
        avisos.append(f"deporte sin coordenadas: {r[4]}")
        continue
    lat, lng = float(m[0]), -abs(float(m[1]))
    if not dentro(lat, lng) and dentro(lat, -75 - (abs(lng) - 78)):
        avisos.append(f"deporte con longitud corregida (-78 -> -75): {r[4]}")
        lng = -75 - (abs(lng) - 78)
    if not dentro(lat, lng):
        avisos.append(f"deporte fuera del municipio: {r[4]} {lat},{lng}")
        continue
    nombre = re.sub(r"\s+del municipio de Girardota$", "", str(r[4]).strip())
    agregar(c="deporte", t=TIPOS_DEPORTE.get(str(r[1]), "Escenario deportivo"), n=nombre,
            lat=round(lat, 6), lng=round(lng, 6), f="Mindeporte · Consolidado de escenarios deportivos",
            x=f"Aforo: {int(float(r[5]))} espectadores" if str(r[5]).replace(".", "").isdigit() and float(r[5]) > 0 else None,
            e="Responsable: " + limpio(r[8]) if limpio(r[8]) else None)

# Canchas y piscinas públicas de OpenStreetMap que el consolidado de Mindeporte no trae (insumos/deporte/osm_escenarios_girardota.json,
# bajado con Overpass y filtrado: sin acceso privado y a más de 60 m de un escenario oficial). Solo se conservan las que caen dentro del municipio.
FUENTE_OSM = "OpenStreetMap · colaboradores (ODbL), sin verificar por Mindeporte"
for o in json.loads((INSUMOS / "deporte" / "osm_escenarios_girardota.json").read_text(encoding="utf-8")):
    agregar(c="deporte", t=o["t"] + " (OSM)", n=o["n"] or o["t"], lat=o["lat"], lng=o["lng"], f=FUENTE_OSM)

# ── Justicia (el Excel no trae coordenadas: se geocodifican en la app) ─────────
for r in hoja("justicia/Directorio_Personerias_Defensoria_Antioquia_125_municipios.xlsx", 0).iter_rows(min_row=5, values_only=True):
    if r[1] and norm(r[1]) == "girardota":
        agregar(c="justicia", t="Personería municipal", n="Personería Municipal de Girardota", d=limpio(r[5]),
                tel=limpio(r[8]), mail=limpio(r[9]), web=limpio(r[10]), geo=f"{limpio(r[5])}, Colombia",
                f="Directorio de personerías · verificado en el sitio oficial")
for r in hoja("justicia/Directorio_Policia_Antioquia_125_municipios.xlsx", 2).iter_rows(min_row=2, values_only=True):
    if r[0] and norm(r[0]) == "girardota":
        agregar(c="justicia", t="Estación de policía", n=limpio(r[1]), d=limpio(r[5]), tel=limpio(r[6]),
                web=limpio(r[10]), geo=f"{limpio(r[5])}, Colombia", f="Policía Nacional · Directorio de estaciones")

# ── Educacion: sedes educativas ────────────────────────────────────────────────
terr = json.loads((RAIZ / "public/data/mapa/territorio/49.json").read_text(encoding="utf-8"))
veredas = {norm(z["n"]): z["p"] for z in terr["v"] if z.get("t") == "VE"}
usados: dict[str, int] = {}


def vereda_de(texto: str):
    t = norm(re.sub(r"^vda\.?\s*", "", norm(texto)))
    t = re.sub(r"\s+parte\s+(alta|baja)$", "", t)
    return t if t in veredas else None


def direccion_legible(d: str) -> str:
    d = re.sub(r"<EOF>", "", d).strip()
    d = re.sub(r"\b(KR|CRA|CARRERA)\b\.?", "Carrera", d, flags=re.I)
    d = re.sub(r"\b(CL|CLL|CALLE)\b\.?", "Calle", d, flags=re.I)
    return re.sub(r"\s+", " ", d)


def nombre_geo(d: str) -> str:
    """'Carrera 17 11 51' -> 'Carrera 17 # 11-51' para que el geocodificador lo entienda."""
    m = re.match(r"(Carrera|Calle)\s+(\d+\s*[A-Za-z]?)\s+(\d+\s*[A-Za-z]?)[\s-]+(\d+)$", d, flags=re.I)
    if m:
        return f"{m.group(1)} {m.group(2).replace(' ', '')} # {m.group(3).replace(' ', '')}-{m.group(4)}"
    return d


for r in hoja("educacion/Sedes_de_los_Establecimientos_Educativos_del_Departamento_de_Antioquia_20261028.xlsx").iter_rows(min_row=2, values_only=True):
    if str(r[3]) != DIVIPOLA:
        continue
    estado = str(r[12])
    if "DEFINITIVO" in estado.upper():
        continue
    sede = limpio(r[8])
    etapas = limpio(r[13])
    base = dict(c="educacion", t="Sede educativa " + str(r[9]).lower(), n=sede, tel=limpio(r[11]),
                x="Establecimiento: " + limpio(r[6]) + (" · Niveles: " + etapas.capitalize() if etapas else ""),
                e="Cierre temporal" if "TEMPORAL" in estado.upper() else "Activa",
                f="Secretaría de Educación · Sedes de los establecimientos educativos")
    if str(r[9]).upper() == "RURAL":
        v = vereda_de(str(r[10]))
        if not v:
            avisos.append(f"sede rural sin vereda reconocida: {sede} ({r[10]})")
            continue
        k = usados.get(v, 0)
        usados[v] = k + 1
        lat, lng = veredas[v]
        if k:  # varias sedes en la misma vereda: se abren un poco para que no queden encimadas
            ang = k * 2 * pi / 3
            lat, lng = lat + 0.0007 * sin(ang), lng + 0.0007 * cos(ang)
        agregar(**base, d="Vereda " + limpio(str(r[10]).replace("VDA.", "").replace("VDA", "")).title(),
                lat=round(lat, 6), lng=round(lng, 6), a=True)
    else:
        d = direccion_legible(str(r[10]))
        agregar(**base, d=d, geo=f"{nombre_geo(d)}, Girardota, Antioquia, Colombia")

# ── Turismo: sitios de interes (el Excel trae vereda o sector, no coordenadas) ──
# id del Excel -> (vereda donde se ubica, o None si se geocodifica un lugar urbano). Quedan fuera los que no son un
# lugar unico: 4 (ya estan en deporte con coordenadas), 5 (microcuencas, sin ubicacion), 8 (trapiches, ~27 dispersos)
# y 11 (Casa de la cultura, ya esta en cultura con coordenadas).
TURISMO = {
    1: (None, "Parque Principal"), 2: (None, "Parque Principal"), 10: (None, "Parque Principal"),
    12: (None, "Parque Principal"), 7: (None, "Carrera 16 # 12-01"),
    3: ("san andres", None), 6: ("el barro", None), 9: ("san andres", None),
    13: ("el cano", None), 14: ("el cano", None),
}
FUENTE_TURISMO = "Alcaldía de Girardota · Sitios de interés (con vereda, PBOT 2025)"
usados_t: dict[str, int] = {}
for r in hoja("turismo/Sitios_de_Interes_Girardota_con_Vereda.xlsx").iter_rows(min_row=5, values_only=True):
    try:
        i = int(r[0])
    except (TypeError, ValueError):
        continue
    if i not in TURISMO:
        continue
    vereda, lugar = TURISMO[i]
    base = dict(c="turismo", t=limpio(r[2]), n=limpio(r[1]), x=limpio(r[3]), f=FUENTE_TURISMO,
                e=limpio(r[7]), d=limpio(r[5]) if vereda else limpio(r[4]))
    obs = limpio(r[8]) if "DISCREPANCIA" in str(r[7]) or i == 14 else None
    if obs:
        base["x"] = f"{base['x']} · Nota: {obs}"
    if vereda:
        k = usados_t.get(vereda, 0)
        usados_t[vereda] = k + 1
        lat, lng = veredas[vereda]
        ang = (k + 1) * 2 * pi / 5
        lat, lng = lat + 0.0012 * sin(ang), lng + 0.0012 * cos(ang)  # aparte de las escuelas de la misma vereda
        agregar(**base, lat=round(lat, 6), lng=round(lng, 6), a=True)
    else:
        agregar(**base, geo=f"{lugar}, Girardota, Antioquia, Colombia")

# ── Salud (el Excel trae direccion o vereda, no coordenadas) ───────────────────
# hoja "Puntos de salud": id -> (vereda, direccion a geocodificar). Fuera queda el 7 (Providas): su direccion es un
# kilometro de la via al Hatillo y el propio archivo dice que la vereda no esta confirmada.
SALUD = {
    1: (None, "Carrera 16 # 11-01"), 2: (None, "Carrera 18 # 5A-65"), 3: (None, "Carrera 18 # 5A-65"),
    4: (None, "Calle 9 # 14-106"), 8: (None, "Calle 7 # 15-41"),
    5: ("san diego", None), 6: ("san diego", None), 9: ("el paraiso", None),
}
FUENTE_SALUD = "Directorio de puntos de salud de Girardota (REPS y fuentes institucionales)"
usados_s: dict[str, int] = {}


def punto_salud(base: dict, vereda, lugar):
    if vereda:
        k = usados_s.get(vereda, 0)
        usados_s[vereda] = k + 1
        lat, lng = veredas[vereda]
        ang = (k + 3) * 2 * pi / 5
        agregar(**base, lat=round(lat + 0.0014 * sin(ang), 6), lng=round(lng + 0.0014 * cos(ang), 6), a=True)
    else:
        agregar(**base, geo=f"{lugar}, Girardota, Antioquia, Colombia")


for r in hoja("salud/Puntos_de_Salud_Girardota_con_Vereda.xlsx", 0).iter_rows(min_row=5, values_only=True):
    try:
        i = int(r[0])
    except (TypeError, ValueError):
        continue
    if i in SALUD:
        punto_salud(dict(c="salud", t=limpio(r[2]), n=limpio(r[1]), d=limpio(r[4]), tel=limpio(r[7]), mail=limpio(r[8]),
                         x=limpio(r[6]), e=limpio(r[9]), f=FUENTE_SALUD), *SALUD[i])

# Atencion prehospitalaria: bomberos voluntarios.
for r in hoja("salud/Puntos_de_Salud_Girardota_con_Vereda.xlsx", 2).iter_rows(min_row=5, values_only=True):
    if r[0] and r[1] and "bomberos" in norm(r[1]):
        punto_salud(dict(c="salud", t=limpio(r[2]), n=limpio(r[1]), d=limpio(r[3]), tel=limpio(r[6]), mail=limpio(r[7]),
                         x=limpio(r[5]), e=limpio(r[8]), f=FUENTE_SALUD), None, str(r[3]).split(";")[0])

# Puesto rural mencionado en el PBOT 2025, por verificar. Los otros cuatro de la hoja son referencias historicas que el
# propio archivo pide no publicar como servicio activo, y quedan fuera.
for r in hoja("salud/Puntos_de_Salud_Girardota_con_Vereda.xlsx", 1).iter_rows(min_row=5, values_only=True):
    if r[1] == "Centro de Salud de San Andrés":
        punto_salud(dict(c="salud", t="Centro de salud rural (por verificar)", n=limpio(r[1]), d="Vereda " + limpio(r[2]),
                         x=limpio(r[3]), e=limpio(r[4]), f="PBOT Girardota 2025 · Diagnóstico territorial"), "san andres", None)

# ── Detalle de patrimonio y arqueologia ────────────────────────────────────────
# El Excel de cultura solo trae nombre, coordenadas y fuente (el bien patrimonial, ademas, la direccion): no hay
# descripcion, periodo ni cultura asociada. Se explica el tipo de lugar y se agrega el codigo de registro.
ARQUEOLOGICO = ("Lugar inscrito en el inventario de sitios arqueológicos del Instituto Colombiano de Antropología e "
                "Historia (ICANH): sitio con evidencias de ocupación humana antigua. El archivo de origen no trae "
                "descripción, periodo ni cultura asociada.")
BICN = ("Bien inmueble declarado Bien de Interés Cultural de la Nación (BICN), según el registro del Ministerio de las "
        "Culturas. El archivo de origen no trae descripción.")
for p in puntos:
    if p["c"] != "patrimonio":
        continue
    if p["t"] == "Sitio arqueológico":
        n = norm(p["n"])
        if "punto de hallazgo" in n:
            p["t"] = "Sitio arqueológico · punto de hallazgo"
        elif "yacimiento" in n:
            p["t"] = "Sitio arqueológico · yacimiento"
        codigo = re.match(r"^([A-Z]{2,}\d*[A-Z]*\d*(?:-\d+)?)\b", p["n"])
        p["x"] = ARQUEOLOGICO + (f" Código de registro: {codigo.group(1)}." if codigo else "")
    else:
        p["x"] = BICN

# Las coordenadas manuales también corrigen puntos que ya traían coordenadas de su fuente (p. ej. un escenario de Mindeporte mal ubicado).
_manuales_previos = json.loads((RAIZ / "scripts" / "coordenadas_manuales.json").read_text(encoding="utf-8"))
for p in puntos:
    if "lat" in p and p["n"] in _manuales_previos:
        p["lat"], p["lng"] = _manuales_previos[p["n"]][:2]

# ── Vereda o zona donde cae cada punto con coordenadas exactas ─────────────────
PRECISION_POLY = 1e-4


def decodificar(texto: str):
    pts, i, lat, lng = [], 0, 0, 0
    while i < len(texto):
        for eje in (0, 1):
            sh = res = 0
            while True:
                b = ord(texto[i]) - 63
                i += 1
                res |= (b & 0x1F) << sh
                sh += 5
                if b < 0x20:
                    break
            d = ~(res >> 1) if res & 1 else res >> 1
            if eje == 0:
                lat += d
            else:
                lng += d
        pts.append((lng * PRECISION_POLY, lat * PRECISION_POLY))
    return pts


zonas = []
for z in terr["v"]:
    poli = [Polygon(decodificar(anillos[0]), [decodificar(h) for h in anillos[1:]]).buffer(0) for anillos in z["g"]]
    zonas.append((z, unary_union(poli)))
for p in puntos:
    if "lat" not in p or p.get("a"):
        continue
    pt = Point(p["lng"], p["lat"])
    for z, geom in zonas:
        if geom.buffer(0.0002).contains(pt):
            p["v"] = "Cabecera municipal" if z.get("t") == "CM" else ("Vereda " + z["n"])
            break

puntos[:] = [p for p in puntos if p.get("f") != FUENTE_OSM or "v" in p]  # las de OSM fuera de las veredas del municipio se descartan

# ── Direcciones -> coordenadas ─────────────────────────────────────────────────
CACHE = RAIZ / "scripts" / "geocache.json"
MANUALES = RAIZ / "scripts" / "coordenadas_manuales.json"
cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
manuales = json.loads(MANUALES.read_text(encoding="utf-8")) if MANUALES.exists() else {}
urbana = unary_union([g for z, g in zonas if z.get("t") == "CM"]).buffer(0.0003)


def nominatim(q: str):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 1, "viewbox": "-75.50,6.45,-75.39,6.30", "bounded": 1, "countrycodes": "co"})
    req = urllib.request.Request(url, headers={"User-Agent": "RECUAPP-geocodificador/1.0"})
    r = json.load(urllib.request.urlopen(req, timeout=20))
    time.sleep(1.1)  # politica de uso de Nominatim: maximo 1 consulta por segundo
    return [float(r[0]["lat"]), float(r[0]["lon"])] if r else None


def convertir(p: dict):
    if p["n"] in manuales:  # [lat, lng] exacto, o [lat, lng, true] si el valor es una estimacion
        m = manuales[p["n"]]
        return m[:2], len(m) > 2 and m[2]
    for q in (p["geo"], f'{p["n"]}, Girardota, Antioquia, Colombia'):
        if q not in cache:
            try:
                cache[q] = nominatim(q)
            except OSError as e:
                avisos.append(f"sin red para convertir {q}: {e}")
                continue
        pos = cache[q]
        if pos and urbana.contains(Point(pos[1], pos[0])):
            return pos, True
    return None, True


ocupados = {(round(p["lat"], 4), round(p["lng"], 4)) for p in puntos if "lat" in p}
for p in puntos:
    if "geo" not in p:
        continue
    pos, estimada = convertir(p)
    del p["geo"]
    if not pos:
        avisos.append(f"SIN COORDENADAS (agregar en coordenadas_manuales.json): {p['n']} · {p.get('d')}")
        continue
    lat, lng = pos
    for k in range(1, 20):  # puntos en la misma direccion (p. ej. el parque principal) se abren para verlos todos
        if (round(lat, 4), round(lng, 4)) not in ocupados:
            break
        lat, lng = pos[0] + 0.00018 * k * sin(k * 1.9), pos[1] + 0.00018 * k * cos(k * 1.9)
    ocupados.add((round(lat, 4), round(lng, 4)))
    p.update(lat=round(lat, 6), lng=round(lng, 6))
    if estimada:
        p["g"] = True
CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")
puntos[:] = [p for p in puntos if "lat" in p]

SALIDA.mkdir(parents=True, exist_ok=True)
(SALIDA / f"{ID_MUNICIPIO}.json").write_text(
    json.dumps({"municipio": MUNICIPIO, "puntos": puntos}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

sys.stdout.reconfigure(encoding="utf-8")
print(f"{len(puntos)} puntos")
for c in sorted({p['c'] for p in puntos}):
    print(" ", c, sum(p['c'] == c for p in puntos), "· sin coordenadas:", sum(p['c'] == c and 'lat' not in p for p in puntos))
print("\n".join(avisos))
