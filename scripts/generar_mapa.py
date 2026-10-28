"""Arma los datos del mapa territorial de Antioquia que consume la app.

Fuente: el repositorio Encuentrala (recursos/datos_cercania.json y
recursos/datos_veredas.json). De ahi se toman SOLO los contornos y la jerarquia
municipio > corregimiento > vereda; las unidades de servicio (UDS) y cualquier
dato de ellas se descartan a proposito: por ahora el mapa no ubica puntos.

Salida (public/data/mapa/):
  municipios.json        125 municipios: nombre, subregion, bbox, centro y contorno
  territorio/<id>.json   corregimientos y veredas de un municipio (carga por demanda)

El contorno de cada municipio NO viene del archivo de municipios de Encuentrala (muy simplificado y
desalineado con el mapa veredal): se calcula fusionando las veredas del propio municipio, asi los tres
niveles (municipio, corregimiento, vereda) salen de la misma fuente y encajan. Requiere shapely.

Los contornos van como "encoded polyline" con 4 decimales (~11 m). TIENE que
coincidir con PRECISION en src/app/features/mapa/utils/polyline.ts.

Uso:  python scripts/generar_mapa.py <carpeta recursos de Encuentrala>
"""
import json
import sys
from pathlib import Path

from shapely.geometry import Polygon
from shapely.ops import unary_union

PRECISION = 1e4
SALIDA = Path(__file__).resolve().parent.parent / "public" / "data" / "mapa"

# La fuente trae los municipios en mayuscula y sin tildes; se restauran para mostrarlos.
TILDES = {
    "ABRIAQUI": "Abriaquí", "ALEJANDRIA": "Alejandría", "AMAGA": "Amagá",
    "ANGELOPOLIS": "Angelópolis", "ANORI": "Anorí", "ANZA": "Anzá", "APARTADO": "Apartadó",
    "BRICEÑO": "Briceño", "BURITICA": "Buriticá", "CACERES": "Cáceres",
    "CAÑASGORDAS": "Cañasgordas", "CARACOLI": "Caracolí", "CHIGORODO": "Chigorodó",
    "COCORNA": "Cocorná", "CONCEPCION": "Concepción", "EBEJICO": "Ebéjico",
    "ENTRERRIOS": "Entrerríos", "GOMEZ PLATA": "Gómez Plata", "ITAGUI": "Itagüí",
    "JARDIN": "Jardín", "JERICO": "Jericó", "LA UNION": "La Unión", "MEDELLIN": "Medellín",
    "MURINDO": "Murindó", "MUTATA": "Mutatá", "NARIÑO": "Nariño", "NECOCLI": "Necoclí",
    "NECHI": "Nechí", "PUERTO BERRIO": "Puerto Berrío", "SAN ANDRES DE CUERQUIA": "San Andrés de Cuerquia",
    "SAN JERONIMO": "San Jerónimo", "SAN JOSE DE LA MONTAÑA": "San José de la Montaña",
    "SAN JUAN DE URABA": "San Juan de Urabá", "SAN PEDRO DE URABA": "San Pedro de Urabá",
    "SANTA BARBARA": "Santa Bárbara", "SONSON": "Sonsón", "SOPETRAN": "Sopetrán",
    "TAMESIS": "Támesis", "TARAZA": "Tarazá", "VALPARAISO": "Valparaíso", "VEGACHI": "Vegachí",
    "VIGIA DEL FUERTE": "Vigía del Fuerte", "YALI": "Yalí", "YOLOMBO": "Yolombó",
    "YONDO": "Yondó", "CIUDAD BOLIVAR": "Ciudad Bolívar", "EL PEÑOL": "El Peñol",
    "PEÑOL": "Peñol", "CAROLINA": "Carolina del Príncipe", "SAN VICENTE": "San Vicente Ferrer",
    "SANTAFE DE ANTIOQUIA": "Santa Fe de Antioquia", "DONMATIAS": "Donmatías",
    "SAN PEDRO": "San Pedro de los Milagros", "ARGELIA": "Argelia", "GUATAPE": "Guatapé",
    "SAN RAFAEL": "San Rafael", "REMEDIOS": "Remedios", "LA CEJA": "La Ceja",
}
MINUSCULAS = {"de", "del", "la", "las", "los", "el", "y"}

# Las 9 subregiones del departamento. La fuente no trae la de Medellin (no tiene contorno propio).
SUBREGIONES = {
    "BAJO CAUCA": "Bajo Cauca", "MAGDALENA MEDIO": "Magdalena Medio", "NORDESTE": "Nordeste",
    "NORTE": "Norte", "OCCIDENTE": "Occidente", "ORIENTE": "Oriente", "SUROESTE": "Suroeste",
    "URABA": "Urabá", "VALLE DE ABURRA": "Valle de Aburrá",
}
SUBREGION_POR_DEFECTO = {"MEDELLIN": "VALLE DE ABURRA"}


def bonito(nombre: str) -> str:
    if nombre in TILDES:
        return TILDES[nombre]
    palabras = nombre.lower().split()
    return " ".join(p if (i and p in MINUSCULAS) else p.capitalize() for i, p in enumerate(palabras))


def _zigzag(v: int) -> int:
    return ~(v << 1) if v < 0 else v << 1


def _chunk(v: int) -> str:
    out = ""
    while v >= 0x20:
        out += chr((0x20 | (v & 0x1F)) + 63)
        v >>= 5
    return out + chr(v + 63)


def encode_polyline(pts) -> str:
    plat = plon = 0
    out = []
    for lat, lon in pts:
        ilat, ilon = round(lat * PRECISION), round(lon * PRECISION)
        out.append(_chunk(_zigzag(ilat - plat)) + _chunk(_zigzag(ilon - plon)))
        plat, plon = ilat, ilon
    return "".join(out)


def decode_polyline(texto: str):
    pts, i, lat, lon = [], 0, 0, 0
    for _ in range(len(texto)):
        if i >= len(texto):
            break
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
                lon += d
        pts.append((lat / PRECISION, lon / PRECISION))
    return pts


def contorno_de_veredas(veredas):
    """Fusiona las veredas en un solo contorno. El cierre (buffer +/-) tapa las rendijas entre vecinas
    que deja la simplificacion; los huecos grandes (zonas sin vereda en el mapa oficial) se respetan."""
    figuras = []
    for v in veredas:
        for poli in v["g"]:
            anillos = [decode_polyline(a) for a in poli]
            figura = Polygon(anillos[0], anillos[1:]).buffer(0)
            if not figura.is_empty:
                figuras.append(figura)
    union = unary_union(figuras).buffer(0.0003).buffer(-0.0003).simplify(0.0002)
    partes = list(union.geoms) if union.geom_type == "MultiPolygon" else [union]
    g = [[encode_polyline(list(p.exterior.coords))] + [encode_polyline(list(h.coords)) for h in p.interiors]
         for p in partes if not p.is_empty]
    x0, y0, x1, y1 = union.bounds
    # shapely recibio (lat, lon) como (x, y); el formato publico es [oeste, sur, este, norte].
    return g, [round(y0, 4), round(x0, 4), round(y1, 4), round(x1, 4)]


def escribir(ruta: Path, datos) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main(recursos: Path) -> None:
    cerc = json.loads((recursos / "datos_cercania.json").read_text(encoding="utf-8"))
    vere = json.loads((recursos / "datos_veredas.json").read_text(encoding="utf-8"))
    nombres = [m["nombre"] for m in cerc["municipios"]]
    assert nombres == vere["municipios"], "los dos JSON no listan los mismos municipios"

    por_muni = {i: ([], []) for i in range(len(nombres))}
    for c in vere["corregimientos"]:
        por_muni[c["m"]][0].append(c)
    for v in vere["veredas"]:
        por_muni[v["m"]][1].append(v)

    municipios = []
    for i, m in enumerate(cerc["municipios"]):
        corrs, veredas = por_muni[i]
        g, bbox = contorno_de_veredas(veredas)
        municipios.append({
            "id": i,
            "n": bonito(m["nombre"]),
            "s": SUBREGIONES[m.get("subregion") or SUBREGION_POR_DEFECTO[m["nombre"]]],
            "b": bbox,
            "c": m["centro"],
            "g": g,
        })

        # Indice local de corregimiento: las veredas lo referencian por posicion en este archivo.
        idx_corr = {gi: li for li, gi in enumerate(
            j for j, c in enumerate(vere["corregimientos"]) if c["m"] == i)}
        escribir(SALIDA / "territorio" / f"{i}.json", {
            "c": [{"n": c["n"], "p": c["p"], "g": c["g"]} for c in corrs],
            "v": [{"n": v["n"], "t": v.get("t", "VE"), "cr": idx_corr.get(v["cr"]) if v.get("cr") is not None else None,
                   "p": v["p"], "g": v["g"]} for v in veredas],
        })

    escribir(SALIDA / "municipios.json", {
        "fuente": "Contornos municipales (Encuentrala) · Mapa Veredal Digital de Antioquia, DAP Gobernación de Antioquia",
        "bbox": cerc["bbox_depto"],
        "municipios": municipios,
    })
    n_v = sum(len(v) for _, v in por_muni.values())
    print(f"{len(municipios)} municipios, {len(vere['corregimientos'])} corregimientos, {n_v} veredas -> {SALIDA}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
