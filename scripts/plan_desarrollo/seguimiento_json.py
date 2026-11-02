"""Convierte lo extraido de los informes de seguimiento en public/data/plan/<dane>-seguimiento.json.

Uso: python -m scripts.plan_desarrollo.seguimiento_json <dane>

Lee insumos/seguimiento_municipal/<dane>/ (fichas_<anio>.csv, resumen_2025.csv de seguimiento_pdf.py y los cuadros
dependencias.csv y lineas_y_global.csv transcritos de las imagenes del informe) y los cruza con los productos SisPT.
El avance de un indicador sale de la tabla resumen del informe cuando existe (es la que suman los cuadros oficiales) y,
si no, de su ficha. Los indicadores van por codigo SisPT (IP-xx); lo que no se puede cruzar se cuenta en `sin_codigo`.
"""
import csv
import json
import re
import sys
from pathlib import Path

from .seguimiento_pdf import norm, PRODUCTOS

RAIZ = Path(__file__).resolve().parents[2]
ENTRADA = RAIZ / "insumos/seguimiento_municipal"
SALIDA = RAIZ / "public/data/plan"

# nombre de la dependencia en los informes de Girardota -> id de la dependencia en <dane>.json (piloto)
DEPENDENCIAS = [
    ("planeacion", "pla"), ("servicios administrativos", "adm"), ("hacienda", "hac"), ("proteccion social", "sub_prot"),
    ("comunicaciones", "com"), ("gobierno", "gob"), ("educacion", "edu"), ("salud", "sal"), ("inder", "inder"),
    ("cultura", "sub_cul"), ("agricultura", "agri"), ("infraestructura", "inf"), ("transporte", "tra"),
    ("medio ambiente", "amb"), ("ambiente", "amb"), ("disciplinario", "cid"), ("control interno", "cia"),
    ("participacion ciudadana", "sub_part"), ("desarrollo economico", "sub_dec"),
]


def _f(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _leer(ruta):
    if not ruta.exists():
        return []
    with open(ruta, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def dep_id(nombre):
    n = norm(nombre)
    if "disciplinario" in n:
        return "cid"
    if "salud" in n:  # "Salud, participacion ciudadana y proteccion social" tambien nombra a otras dos
        return "sal"
    return next((i for k, i in DEPENDENCIAS if k in n), None)


def productos_sispt(dane):
    """codigo del plan (a.b.c.d) -> IP, y (programa a.b.c, nombre normalizado) -> IP."""
    por_codigo, por_nombre = {}, {}
    for r in _leer(PRODUCTOS):
        if r["Código DANE"] != dane:
            continue
        ip = r["Código de indicador de producto (SisPT)"]
        pers = r["Personalización de Indicador de Producto"].strip()
        m = re.match(r"(\d+\.\d+\.\d+)\.(\d+)\s", pers + " ")
        if m:
            por_codigo.setdefault(f"{m.group(1)}.{m.group(2)}", ip)
            for nombre in (pers, r["Indicador de Producto(MGA)"]):
                por_nombre.setdefault((m.group(1), norm(nombre)), ip)
    return por_codigo, por_nombre


def pct(prog, av):
    return round(100 * av / prog, 1) if prog and av is not None else None


def main(dane):
    carpeta = ENTRADA / dane
    por_codigo, por_nombre = productos_sispt(dane)
    anios, indicadores, sin_codigo = {}, {}, {}

    resumen = {}
    for r in _leer(carpeta / "resumen_2025.csv"):
        ip = por_codigo.get(r["codigo_plan"])
        if ip:
            resumen[ip] = r

    for fichero in sorted(carpeta.glob("fichas_20*.csv")):
        anio = fichero.stem.split("_")[1]
        anios[anio] = True
        sin_codigo[anio] = 0
        for r in _leer(fichero):
            if r["con_fila_numerica"] != "True":
                continue
            ip = por_codigo.get(r.get("codigo_plan", "")) or por_nombre.get((r["programa_cod"], norm(r["indicador"])))
            if not ip:
                sin_codigo[anio] += 1
                continue
            e = indicadores.setdefault(ip, {"por_anio": {}})
            prog, av = _f(r["meta_programada"]), _f(r["avance_fisico"])
            e["por_anio"][anio] = {"programada": prog, "avance": av, "pct": pct(prog, av), "fuente": "ficha"}
            if anio == "2025":
                e["acumulacion"] = r["acumulacion"] or None
                e["proyecto"] = r["proyecto"] or None
                e["bpin"] = r["bpin"] or None
            e.setdefault("narrativas", {})[anio] = r["narrativa"] or None
            e.setdefault("informe_dep", {})[anio] = dep_id(r["dependencia"])

    for ip, r in resumen.items():  # la tabla resumen manda sobre la ficha
        e = indicadores.setdefault(ip, {"por_anio": {}})
        antes = e["por_anio"].get("2025")
        nuevo = {"programada": _f(r["programado"]), "avance": _f(r["ejecutado"]), "pct": _f(r["avance_pct"]), "fuente": "tabla"}
        if antes and (antes["programada"], antes["avance"]) != (nuevo["programada"], nuevo["avance"]):
            nuevo["ficha"] = {k: antes[k] for k in ("programada", "avance", "pct")}
        e["por_anio"]["2025"] = nuevo
        e.setdefault("informe_dep", {}).setdefault("2025", dep_id(r["dependencia"]))

    ultimo = max(anios) if anios else None
    for e in indicadores.values():
        u = e["por_anio"].get(ultimo) or {}
        e.update({"programada": u.get("programada"), "avance": u.get("avance"), "pct": u.get("pct")})
    # el avance que ve el resto de la app es el del ultimo anio; los indicadores sin dato de ese anio no cuentan
    indicadores = {k: v for k, v in indicadores.items() if v["pct"] is not None or v["por_anio"]}

    dependencias = {}
    for r in _leer(carpeta / "dependencias.csv"):
        i = dep_id(r["dependencia"])
        if not i:
            continue
        dependencias.setdefault(i, {})[r["anio"]] = {
            "metas": int(r["total_metas"]) if r["total_metas"] else None,
            "cuatrienio": _f(r["avance_cuatrienio_pct"]), "plan_accion": _f(r["avance_plan_accion_pct"]),
        }
    glob = {}
    for r in _leer(carpeta / "lineas_y_global.csv"):
        glob.setdefault(r["anio"], []).append({"nivel": r["nivel"], "nombre": r["nombre"],
                                               "cuatrienio": _f(r["avance_cuatrienio_pct"]), "plan_accion": _f(r["avance_plan_accion_pct"])})

    out = {"anio": int(ultimo) if ultimo else None, "anios": sorted(anios), "fuente": "Informes de seguimiento del municipio",
           "sin_codigo": sin_codigo.get(ultimo, 0), "sin_codigo_por_anio": sin_codigo,
           "indicadores": indicadores, "dependencias": dependencias, "global": glob}
    destino = SALIDA / f"{dane}-seguimiento.json"
    destino.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    por = {a: sum(1 for v in indicadores.values() if a in v["por_anio"]) for a in sorted(anios)}
    print(f"{destino}: {len(indicadores)} indicadores {por}; sin codigo {sin_codigo}; {len(dependencias)} dependencias; "
          f"{destino.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1])
