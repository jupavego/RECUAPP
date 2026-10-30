"""Base del plan de desarrollo por municipio: SisPT (consolidado) como estructura oficial + datos del PDF donde cruzan.

Entrada: insumos/sispt_plan_indicativo/consolidado/*.csv e insumos/plan_extraido/*/indicadores.json.
Salida: insumos/plan_base/<dane>.json e index.json. Cada producto lleva `pdf` (pagina, linea_base, responsable...) si
hay un indicador extraido del PDF con codigo MGA igual o nombre parecido (Jaccard >= UMBRAL); `solo_pdf` lista lo que
el PDF trae y SisPT no.
`atipico` marca productos con recursos absurdos (error de digitacion en SisPT); OJO: los montos de SisPT son poco fiables (El Bagre suma 392 billones en cuatro años), por eso el indice no los totaliza.
"""
import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

UMBRAL = 0.5
AÑOS = ("2024", "2025", "2026", "2027")
# Un producto con mas de este valor en un solo año es casi seguro error de digitacion en SisPT (hay hasta 5,8e16 COP).
TOPE_ANUAL = {"05001": 1e13}
TOPE_DEFECTO = 1e12
SUBREG = r"^(bajo_cauca|magdalena_medio|nordeste|occidente|oriente|suroeste|uraba)_"


def _n(s):
    return re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFD", str(s or "").lower()).encode("ascii", "ignore").decode())


def _toks(s):
    return {w for w in _n(s).split() if len(w) > 3}


def _num(s):
    s = str(s or "").replace(".", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _leer(p):
    with open(p, encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def _col(h, prefijo, ultimo=False):
    c = [x for x in h if x.startswith(prefijo)]
    return c[-1] if ultimo else c[0]


def construye(raiz):
    raiz = Path(raiz)
    cons = raiz / "insumos/sispt_plan_indicativo/consolidado"
    out = raiz / "insumos/plan_base"
    out.mkdir(exist_ok=True)
    lin, res, pro = (_leer(cons / f"{k}.csv") for k in ("lineas", "resultado", "productos"))
    h = list(pro[0])
    C = {k: _col(h, p, u) for k, p, u in [
        ("dane", "Código DANE", 0), ("ent", "Entidad", 0), ("plan", "Nombre del plan", 0), ("id", "Código de indicador de producto (SisPT)", 0),
        ("linea", "Línea", 0), ("scod", "Código del sector", 0), ("sec", "Sector", 0), ("pcod", "Código del programa", 0), ("prog", "Programa", 0),
        ("prcod", "Código del producto", 0), ("prod", "Producto (MGA)", 0), ("icod", "Código de indicador de producto (MGA)", 0),
        ("ind", "Indicador de Producto", 0), ("pers", "Personaliza", 0), ("uni", "Unidad", 0), ("meta", "Meta del cuatrienio", 0),
        ("princ", "Principal", 0), ("ods", "ODS", 0), ("acum", "Tipo de acumulación", 0), ("bpin", "BPIN", 0)]}
    fuentes = {a: [c for c in h if c.endswith(" " + a) and not c.startswith("Total") and not c.startswith("Programación")] for a in AÑOS}
    por, lineas, resu = defaultdict(list), defaultdict(list), defaultdict(list)
    for r in pro:
        por[r[C["dane"]]].append(r)
    for r in lin:
        lineas[r[C["dane"]]].append({"id": r["Consecutivo"], "nombre": r[_col(list(r), "Línea")]})
    for r in res:
        k = list(r)
        resu[r[C["dane"]]].append({"id": r["Consecutivo"], "linea": r[_col(k, "Línea")], "indicador": r[_col(k, "Indicador de resultado")],
                                   "meta": r[_col(k, "Meta")], "pnd": r[_col(k, "Está")]})
    pdf = {}
    for f in (raiz / "insumos/plan_extraido").glob("*/indicadores.json"):
        d = json.loads(f.read_text(encoding="utf8"))
        if d:
            pdf[_n(re.sub(SUBREG, "", f.parent.name)).replace(" ", "")] = d
    girardota = raiz / "insumos/plan_extraido/indicadores.json"
    if girardota.exists():
        pdf["girardota"] = json.loads(girardota.read_text(encoding="utf8"))
    indice = []
    for dane, filas in sorted(por.items()):
        ent = filas[0][C["ent"]]
        prods = []
        for r in filas:
            rec = {}
            for a in AÑOS:
                tot = _num(r.get(_col(h, "Total " + a)))
                src = {c[: -len(a) - 1]: _num(r[c]) for c in fuentes[a] if _num(r[c])}
                rec[a] = {"total": tot or 0, "fuentes": src}
            prods.append({
                "id": r[C["id"]], "linea": r[C["linea"]], "sector": {"cod": r[C["scod"]], "nombre": r[C["sec"]]},
                "programa": {"cod": r[C["pcod"]], "nombre": r[C["prog"]]}, "producto": {"cod": r[C["prcod"]], "nombre": r[C["prod"]]},
                "indicador": {"cod": r[C["icod"]], "nombre": r[C["ind"]], "personalizado": r[C["pers"]]},
                "unidad": r[C["uni"]], "meta": _num(r[C["meta"]]), "principal": r[C["princ"]] == "Sí", "ods": r[C["ods"]],
                "acumulacion": r[C["acum"]], "programacion": {a: _num(r[_col(h, "Programación del producto bien o servicio " + a)]) for a in AÑOS},
                "recursos": rec, "atipico": any(rec[a]["total"] > TOPE_ANUAL.get(dane, TOPE_DEFECTO) for a in AÑOS), "bpin": r[C["bpin"]] or None, "pdf": None})
        st = [_toks(p["indicador"]["personalizado"] + " " + p["indicador"]["nombre"]) for p in prods]
        solo, emp = [], 0
        for i in pdf.get(_n(ent).replace(" ", ""), []):
            c, t, mejor = str(i.get("codigo") or ""), _toks(i["nombre"]), (0, -1)
            for j, p in enumerate(prods):
                if c and c[:9] == p["indicador"]["cod"][:9]:
                    mejor = (1.1, j)
                    break
                if t and st[j]:
                    mejor = max(mejor, (len(t & st[j]) / len(t | st[j]), j))
            datos = {k: i.get(k) for k in ("pagina", "linea_base", "unidad", "meta_2024", "meta_2027", "responsable", "programa") if i.get(k)}
            if mejor[0] >= UMBRAL and (prods[mejor[1]]["pdf"] is None or prods[mejor[1]]["pdf"]["_s"] < mejor[0]):
                prods[mejor[1]]["pdf"] = {**datos, "_s": round(mejor[0], 2)}
            elif mejor[0] < UMBRAL:
                solo.append({"nombre": i["nombre"], **datos})
        emp = sum(p["pdf"] is not None for p in prods)
        for p in prods:
            if p["pdf"]:
                p["pdf"]["coincidencia"] = p["pdf"].pop("_s")
        doc = {"dane": dane, "municipio": ent, "plan": filas[0][C["plan"]], "lineas": lineas[dane], "resultado": resu[dane],
               "productos": prods, "solo_pdf": solo}
        (out / f"{dane}.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf8")
        indice.append({"dane": dane, "municipio": ent, "plan": doc["plan"], "lineas": len(doc["lineas"]), "resultado": len(doc["resultado"]),
                       "productos": len(prods), "con_pdf": emp, "solo_pdf": len(solo),
                       "atipicos": sum(p["atipico"] for p in prods)})
    (out / "index.json").write_text(json.dumps(indice, ensure_ascii=False, indent=1), encoding="utf8")
    return indice


if __name__ == "__main__":
    ix = construye(sys.argv[1])
    print(len(ix), "municipios;", sum(i["productos"] for i in ix), "productos;", sum(i["con_pdf"] for i in ix), "con dato del PDF;", sum(i["solo_pdf"] for i in ix), "solo PDF")
