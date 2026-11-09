"""Planes de acción anuales de cada dependencia (formato E-PL-F-004 de la alcaldía) → JSON para la app.

Entrada: insumos/seguimiento_municipal/<dane>/planes_accion_<anio>/<dep>.xlsx (un Excel por dependencia, con el id de
la dependencia como nombre) y fuentes.csv (dep, archivo original, url publicada).
Salida: public/data/plan/<dane>-plan-accion-<anio>.json

Cada hoja del Excel es un proyecto: línea, sector, programa, proyecto y BPIN arriba; debajo, filas con el indicador de
producto (meta del cuatrienio y del año), las acciones programadas con su meta por trimestre y el presupuesto
apropiado por fuente. La sección «Seguimiento» del formato viene sin diligenciar, así que aquí solo hay programación.

Cada indicador se cruza con un producto del plan (IP-xx) por parecido del nombre, dentro de los productos de la misma
dependencia, con un empujón si el BPIN coincide con el del informe de seguimiento.

Uso: python scripts/plan_desarrollo/planes_accion.py [dane] [anio]
"""
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parents[2]
# un proyecto de un municipio de este tamaño no pasa de esto; por encima es casi seguro un error de digitación
TOPE_PROYECTO = 100_000_000_000
FUENTES = ("propios", "regalias", "otros", "sgp", "cofinanciacion")  # columnas 2 a 6 del formato
VACIAS = {"", "no", "n/a", "na", "-", "0", "fin", "none"}
PALABRAS_VACIAS = set("de del la las el los en y o a para por con al un una su sus que se e".split())


def txt(v):
    s = "" if v is None else str(v)
    s = s.replace("​", "").replace("\xa0", " ").replace("_", " ")
    return re.sub(r"\s+", " ", s).strip()


def num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = txt(v).replace("%", "")
    if re.fullmatch(r"-?\d+(?:[.,]\d+)?", s):
        return float(s.replace(",", "."))
    return None


def plano(s):
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def fichas(s):
    return {w for w in re.findall(r"[a-z0-9]+", plano(s)) if len(w) > 2 and w not in PALABRAS_VACIAS}


def celda(f, j):
    return f[j] if j < len(f) else None


def leer_hoja(ws):
    filas = list(ws.iter_rows(values_only=True, max_row=200))
    cab = next((i for i, f in enumerate(filas[:25]) if "INDICADOR DE PRODUCTO" in txt(celda(f, 8)).upper()), None)
    if cab is None:
        return None
    meta = next((i for i, f in enumerate(filas[:cab]) if "LINEA ESTRAT" in plano(txt(celda(f, 1))).upper()), None)
    m = filas[meta + 1] if meta is not None else ()
    proyecto = {
        "nombre": txt(celda(m, 12)) or txt(ws.title),
        "bpin": (re.search(r"\d{10,}", txt(celda(m, 16))) or [None])[0],
        "linea": txt(celda(m, 1)),
        "sector": txt(celda(m, 8)),
        "programa": txt(celda(m, 10)),
        "hoja": txt(ws.title),
        "presupuesto": dict.fromkeys(FUENTES, 0.0) | {"total": 0.0},
        "indicadores": [],
    }
    ind = None
    for f in filas[cab + 4:]:
        if any(txt(c).upper() == "FIN" for c in f[:3]):
            break
        for k, j in zip(FUENTES, range(2, 7)):
            v = num(celda(f, j))
            if v:
                proyecto["presupuesto"][k] += v
        tot = num(celda(f, 7))
        if tot:
            proyecto["presupuesto"]["total"] += tot
        nombre = txt(celda(f, 8))
        if nombre and num(celda(f, 8)) is None:
            ind = {
                "indicador": nombre, "tipo": txt(celda(f, 9)) or None, "unidad": txt(celda(f, 10)) or None,
                "linea_base": num(celda(f, 11)), "meta_cuatrienio": num(celda(f, 12)), "meta_anio": num(celda(f, 13)),
                "acciones": [],
            }
            proyecto["indicadores"].append(ind)
        accion = txt(celda(f, 14))
        if accion and plano(accion) not in VACIAS:
            if ind is None:
                ind = {"indicador": None, "tipo": None, "unidad": None, "linea_base": None,
                       "meta_cuatrienio": None, "meta_anio": None, "acciones": []}
                proyecto["indicadores"].append(ind)
            ind["acciones"].append({
                "accion": accion, "unidad": txt(celda(f, 15)) or None, "meta": num(celda(f, 16)),
                "trimestres": [num(celda(f, j)) for j in range(17, 21)],
                "responsable": txt(celda(f, 29)) or None,
            })
    p = proyecto["presupuesto"]
    if not p["total"]:
        p["total"] = sum(p[k] for k in FUENTES)
    if p["total"] > TOPE_PROYECTO:
        proyecto["revisar"] = (f"El presupuesto apropiado del archivo ({p['total']:,.0f}) es atípico para un proyecto "
                               "del municipio; puede ser un error de digitación. No se suma al total.").replace(",", ".")
    if not proyecto["indicadores"] and not p["total"]:
        return None
    return proyecto


def cruzar(proyectos, dep, plan, seguimiento):
    """Asigna a cada indicador el producto del plan (IP-xx) más parecido entre los de la dependencia y su grupo."""
    deps = {d["id"]: d for d in plan["dependencias"]}
    grupo = {dep}
    padre = deps.get(dep, {}).get("padre")
    if padre:
        grupo.add(padre)
    grupo |= {d["id"] for d in plan["dependencias"] if d.get("padre") in grupo}
    candidatos = [x for x in plan["productos"] if any(r["dep"] in grupo for r in x["resp"])] or plan["productos"]
    bpin_de = {ip: s.get("bpin") for ip, s in seguimiento.get("indicadores", {}).items()}
    cruzados = total = 0
    for pr in proyectos:
        for ind in pr["indicadores"]:
            if not ind["indicador"]:
                continue
            total += 1
            a = fichas(ind["indicador"])
            mejor, puntos = None, 0.0
            for x in candidatos:
                b = fichas(x["indicador"]) | fichas(x["producto"])
                if not a or not b:
                    continue
                s = len(a & b) / len(a | fichas(x["indicador"]))
                if pr["bpin"] and bpin_de.get(x["id"]) == pr["bpin"]:
                    s += 0.3
                if s > puntos:
                    mejor, puntos = x, s
            if mejor and puntos >= 0.5:
                ind["ip"] = mejor["id"]
                cruzados += 1
    return cruzados, total


def main(dane="05308", anio="2026"):
    carpeta = RAIZ / f"insumos/seguimiento_municipal/{dane}/planes_accion_{anio}"
    plan = json.loads((RAIZ / f"public/data/plan/{dane}.json").read_text(encoding="utf-8"))
    ruta_seg = RAIZ / f"public/data/plan/{dane}-seguimiento.json"
    seguimiento = json.loads(ruta_seg.read_text(encoding="utf-8")) if ruta_seg.exists() else {}
    with open(carpeta / "fuentes.csv", encoding="utf-8") as fh:
        fuentes = {r["dep"]: r for r in csv.DictReader(fh)}
    salida = {"anio": int(anio), "fuente": "Planes de acción publicados por la alcaldía (Transparencia · Planeación, Gestión y Control)",
              "nota": "Programación del año: la sección de seguimiento del formato viene sin diligenciar.",
              "dependencias": {}}
    for x in sorted(carpeta.glob("*.xlsx")):
        dep = x.stem
        wb = openpyxl.load_workbook(x, read_only=True, data_only=True)
        proyectos = [p for ws in wb if (p := leer_hoja(ws))]
        wb.close()
        cruzados, total = cruzar(proyectos, dep, plan, seguimiento)
        validos = [p for p in proyectos if "revisar" not in p]
        salida["dependencias"][dep] = {
            "archivo": fuentes.get(dep, {}).get("archivo_original"),
            "url": fuentes.get(dep, {}).get("url"),
            "presupuesto": round(sum(p["presupuesto"]["total"] for p in validos)),
            "acciones": sum(len(i["acciones"]) for p in proyectos for i in p["indicadores"]),
            "indicadores": total,
            "cruzados": cruzados,
            "proyectos": proyectos,
        }
        print(f"{dep:9s} proyectos={len(proyectos):3d} indicadores={total:3d} cruzados={cruzados:3d} "
              f"acciones={salida['dependencias'][dep]['acciones']:3d} presupuesto={salida['dependencias'][dep]['presupuesto'] / 1e6:10,.1f} M"
              + ("  (con valor por revisar)" if len(validos) < len(proyectos) else ""))
    destino = RAIZ / f"public/data/plan/{dane}-plan-accion-{anio}.json"
    destino.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    t = salida["dependencias"].values()
    print(f"TOTAL presupuesto={sum(d['presupuesto'] for d in t) / 1e9:,.1f} mil millones; "
          f"indicadores={sum(d['indicadores'] for d in t)} cruzados={sum(d['cruzados'] for d in t)} -> {destino.relative_to(RAIZ)}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
