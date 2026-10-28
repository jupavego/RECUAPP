"""Arma los datos del mapa territorial de Antioquia que consume la app.

Fuente: el repositorio Encuentrala (recursos/datos_cercania.json y
recursos/datos_veredas.json). De ahi se toman SOLO los contornos y la jerarquia
municipio > corregimiento > vereda; las unidades de servicio (UDS) y cualquier
dato de ellas se descartan a proposito: por ahora el mapa no ubica puntos.

Salida (public/data/mapa/):
  municipios.json        125 municipios: nombre, subregion, bbox, centro y contorno
  territorio/<id>.json   corregimientos y veredas de un municipio (carga por demanda)

Los contornos van como "encoded polyline" con 4 decimales (~11 m). TIENE que
coincidir con PRECISION en src/app/features/mapa/utils/polyline.ts.

Uso:  python scripts/generar_mapa.py <carpeta recursos de Encuentrala>
"""
import json
import shutil
import sys
from pathlib import Path

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


def escribir(ruta: Path, datos) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main(recursos: Path) -> None:
    cerc = json.loads((recursos / "datos_cercania.json").read_text(encoding="utf-8"))
    vere = json.loads((recursos / "datos_veredas.json").read_text(encoding="utf-8"))
    nombres = [m["nombre"] for m in cerc["municipios"]]
    assert nombres == vere["municipios"], "los dos JSON no listan los mismos municipios"

    if SALIDA.exists():
        shutil.rmtree(SALIDA)

    por_muni = {i: ([], []) for i in range(len(nombres))}
    for c in vere["corregimientos"]:
        por_muni[c["m"]][0].append(c)
    for v in vere["veredas"]:
        por_muni[v["m"]][1].append(v)

    municipios = []
    for i, m in enumerate(cerc["municipios"]):
        corrs, veredas = por_muni[i]
        if m.get("poligono"):
            g = [[encode_polyline(anillo)] for anillo in m["poligono"]]
        else:
            # Medellin no trae contorno municipal en la fuente: se arma con el de sus corregimientos.
            g = [poly for c in corrs for poly in c["g"]]
        municipios.append({
            "id": i,
            "n": bonito(m["nombre"]),
            "s": SUBREGIONES[m.get("subregion") or SUBREGION_POR_DEFECTO[m["nombre"]]],
            "b": [round(x, 4) for x in m["bbox"]] if m.get("bbox") else None,
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
