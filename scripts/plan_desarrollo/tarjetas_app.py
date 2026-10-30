"""Datos para la vista de tarjetas de la app: un JSON por entidad en public/data/plan/<dane>.json.

Parte de insumos/plan_base/<dane>.json (SisPT + PDF) y de insumos/dependencias/<dane>.json (las secretarias reales
de la alcaldia, tomadas de su sitio web). Empareja de nuevo los indicadores del PDF contra los productos de SisPT (uno a
uno, por nombre del indicador MGA, programa y meta) y asigna responsables:
- del PDF: el texto `responsable` se empareja con las dependencias reales por palabras clave (alta);
- pista por sector MGA cuando el PDF no lo trae (media o baja). Es sugerencia, nunca reemplaza la dependencia real.
"""
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

UMBRAL = 0.6
AÑOS = ("2024", "2025", "2026", "2027")

# sector MGA (2 digitos) -> (ids de dependencia, confianza). Solo pista: la dependencia real manda.
PISTA_SECTOR = {
    "04": (["pla"], "media"), "12": (["gob"], "media"), "17": (["agri"], "media"), "19": (["sal"], "media"),
    "21": (["inf"], "media"), "22": (["edu"], "media"), "23": (["adm"], "media"), "24": (["inf", "tra"], "media"),
    "25": (["cia"], "media"), "32": (["amb"], "media"), "33": (["edu"], "media"), "35": (["hac"], "media"),
    "36": (["hac"], "media"), "39": (["edu"], "media"), "40": (["inf", "pla"], "media"),
    "41": (["sal", "gob"], "baja"), "45": (["gob"], "baja"),
}


def _n(s):
    return re.sub(r"[^a-z0-9 ]", " ", unicodedata.normalize("NFD", str(s or "").lower()).encode("ascii", "ignore").decode())


def _le(s):
    """Codigo de la linea estrategica ("LE-1") al inicio de un texto como "LE-1-Linea estrategica 1: ..."."""
    m = re.match(r"LE-\d+", s or "")
    return m.group() if m else ""


def _toks(s):
    return {w for w in _n(s).split() if len(w) > 3}


def _jac(a, b):
    return len(a & b) / len(a | b) if a and b else 0.0


def _num(s):
    s = str(s or "").replace(".", "").replace(",", ".").strip().rstrip("%")
    try:
        return float(s)
    except ValueError:
        return None


def _responsables(texto, deps, otras):
    """(ids de dependencias, otras entidades) que nombra un texto de responsable del PDF.

    Las subsecretarias se buscan primero y su frase se quita del texto, para que no cuente tambien a su secretaria
    solo porque el nombre comparte palabras ("Subsecretaria de Proteccion Social" no es la Secretaria de Salud).
    """
    t = " " + _n(texto) + " "
    ids = []
    for d in deps:
        if d.get("padre") and any(c in t for c in d["claves"]):
            ids.append(d["id"])
            for c in d["claves"]:
                t = t.replace(c, " ")
    ids += [d["id"] for d in deps if not d.get("padre") and any(c in t for c in d["claves"])]
    if "disciplinario" in t and "cia" in ids:
        ids.remove("cia")
    if "control interno" in t and "disciplinario" not in t and "cid" in ids:
        ids.remove("cid")
    fuera = [o["nombre"] for o in otras if any(c in t for c in o["claves"])]
    return ids, fuera


def _empareja(prods, pdf):
    """Un indicador del PDF por producto de SisPT como maximo, mejor puntaje primero."""
    cand = []
    for i, p in enumerate(prods):
        nombres = [_toks(p["indicador"]["nombre"]), _toks(p["indicador"]["personalizado"])]
        prog = _toks(p["programa"]["nombre"])
        for j, x in enumerate(pdf):
            t = _toks(x["nombre"])
            s = max(_jac(t, n) for n in nombres)
            if s < 0.5:
                continue
            s += 0.2 * (_jac(_toks(x.get("programa")), prog) >= 0.5)
            a, b = _num(x.get("meta")), p["meta"]
            s += 0.15 * (a is not None and b is not None and abs(a - b) < 1e-6)
            if s >= UMBRAL:
                cand.append((s, i, j))
    cand.sort(reverse=True)
    usado_p, usado_x, par = set(), set(), {}
    for s, i, j in cand:
        if i not in usado_p and j not in usado_x:
            usado_p.add(i)
            usado_x.add(j)
            par[i] = j
    return par, [j for j in range(len(pdf)) if j not in usado_x]


def _ppi(carpeta, lineas):
    """Plan plurianual de inversiones del PDF (pesos corrientes por año). Es la fuente de montos: SisPT no es creible.

    Trae el total por año, las lineas, los sectores (con la marca de si su resumen cuadra con la suma de sus programas)
    y los programas. Los programas no cubren todo el total: el PDF no los lista completos o no se leyeron.
    """
    sec = json.loads((carpeta / "ppi_sectores.json").read_text(encoding="utf8"))
    prog = json.loads((carpeta / "ppi_programas.json").read_text(encoding="utf8"))
    val = {_n(v["sector"]).strip(): v for v in json.loads((carpeta / "validacion_ppi.json").read_text(encoding="utf8"))}
    nombre = {_n(g["sector"]).strip(): g["sector"] for g in prog if g.get("sector")}
    por_linea = defaultdict(lambda: [0] * 4)
    sectores = []
    for k, v in sec.items():
        n = _n(v["sector"]).strip()
        ver = val.get(n, {})
        m = re.search(r"Estrat[eé]gica:\s*(\d+)", v["linea"])
        le = f"LE-{m.group(1)}" if m else ""
        for i, x in enumerate(v["anios"]):
            por_linea[le][i] += x
        sectores.append({"nombre": nombre.get(n, v["sector"]), "linea": le, "anios": v["anios"], "cuadra": ver.get("cuadra"),
                         "suma_programas": ver.get("suma_programas"), "pagina": v.get("pagina")})
    programas = [{"sector": g["sector"], "nombre": g["programa"], "anios": g["anios"]} for g in prog if g["estado"] == "ok"]
    return {
        "fuente": "Plan plurianual de inversiones del PDF del plan (pesos corrientes)",
        "anios": list(AÑOS),
        "total": [sum(s["anios"][i] for s in sectores) for i in range(4)],
        "lineas": [{"id": l["id"], "nombre": re.sub(r"^L[ií]nea estrat[eé]gica \d+:\s*", "", l["nombre"]), "anios": por_linea[l["id"]]} for l in lineas],
        "sectores": sorted(sectores, key=lambda s: -sum(s["anios"])),
        "programas": sorted(programas, key=lambda g: -sum(g["anios"])),
    }


STOP = {"de", "del", "la", "y", "e", "el", "los", "las", "secretaria", "subsecretaria"}


def _directorio(raiz, dane):
    """Funcionarios del directorio publicado por la alcaldia (insumos/dependencias/<dane>_directorio.json); [] si no esta."""
    f = raiz / f"insumos/dependencias/{dane}_directorio.json"
    return json.loads(f.read_text(encoding="utf8"))["funcionarios"] if f.exists() else []


def _equipo(deps, funcionarios):
    """{id de dependencia: [{nombre, cargo, correo, telefono, extension}]} segun las reglas `directorio` de cada dependencia.

    Cada regla es "campo:texto" (campo: dependencia, cargo o correo) y se busca en el campo sin tildes. Las reglas por cargo o
    correo van primero (una oficina o subsecretaria dentro de otra dependencia); cada funcionario queda en una sola dependencia.
    Solo se publican correos institucionales (los del dominio de la alcaldia).
    """
    reglas = [(d["id"], (r.split(":", 1)[0], _n(r.split(":", 1)[1]).strip())) for d in deps for r in d.get("directorio", [])]
    reglas.sort(key=lambda x: x[1][0] == "dependencia")
    equipo = {d["id"]: [] for d in deps}
    for f in funcionarios:
        for id_, (campo, texto) in reglas:
            if texto in _n(f.get(campo)):
                correo = f["correo"] if f["correo"].endswith("@girardota.gov.co") else None
                equipo[id_].append({"nombre": f["nombre"], "cargo": f["cargo"], "correo": correo,
                                    "telefono": f.get("telefono"), "extension": f.get("extension")})
                break
    return equipo


def _contacto(nombre, funcionarios):
    """correo, telefono y extension del funcionario del directorio que se llama como `nombre` (apellidos y nombres, sin orden)."""
    t = {x for x in _n(nombre).split() if x not in STOP}
    puntaje, f = max(((_jac(t, {x for x in _n(g["nombre"]).split() if x not in STOP}), g) for g in funcionarios), key=lambda x: x[0], default=(0, None))
    if not f or puntaje < 0.7:
        return {}
    return {k: f[k] for k in ("correo", "telefono", "extension") if f.get(k)}


def _responsables_web(raiz, dane, deps):
    """Persona a cargo de cada dependencia, leida del sitio de la alcaldia (insumos/dependencias/<dane>_responsables.json).

    Empareja por URL y, si no, por nombre (palabras en comun, sin articulos). Devuelve ({id: {cargo, nombre, url}}, alcalde, fecha).
    """
    f = raiz / f"insumos/dependencias/{dane}_responsables.json"
    if not f.exists():
        return {}, None, None
    web = json.loads(f.read_text(encoding="utf8"))
    leidas = [w for w in web["dependencias"] if w.get("responsable")]
    toks = lambda t: {x for x in _n(t).split() if x not in STOP}
    por_dep, alcalde = {}, None
    contactos = _directorio(raiz, dane)
    for w in leidas:
        if _n(w["dependencia"]).strip() == "alcalde municipal":
            alcalde = {"cargo": w["responsable"]["cargo"], "nombre": w["responsable"]["nombre"], "url": w["url"],
                       **_contacto(w["responsable"]["nombre"], contactos)}
    for d in deps:
        mejor = next((w for w in leidas if d.get("url") and w["url"] == d["url"]), None)
        if not mejor:
            def puntaje(w):  # parecido de nombres; 1 si el titulo del sitio esta entero dentro del nombre (que puede traer aclaraciones)
                a, b = toks(d["nombre"]), toks(w["dependencia"])
                return 1.0 if len(b) >= 2 and b <= a else len(a & b) / len(a | b)
            c, mejor = max(((puntaje(w), w) for w in leidas if "alcalde" not in _n(w["dependencia"])), key=lambda x: x[0], default=(0, None))
            if c < 0.6:
                mejor = None
        if mejor:
            r = mejor["responsable"]
            por_dep[d["id"]] = {"cargo": r["cargo"], "nombre": r["nombre"], "url": mejor["url"], **_contacto(r["nombre"], contactos)}
    return por_dep, alcalde, web["fecha"]


def construye(raiz, dane):
    raiz = Path(raiz)
    base = json.loads((raiz / f"insumos/plan_base/{dane}.json").read_text(encoding="utf8"))
    dep = json.loads((raiz / f"insumos/dependencias/{dane}.json").read_text(encoding="utf8"))
    deps, otras = dep["dependencias"], dep["otras_entidades"]
    alias, forzados, reglas = dep.get("alias_responsable", {}), dep.get("producto_responsable", {}), dep.get("reasignar", [])
    reparto = dep.get("reparto_productos", {})
    personas, alcalde, fecha_web = _responsables_web(raiz, dane, deps)
    equipos = _equipo(deps, _directorio(raiz, dane))
    pdf = json.loads((raiz / "insumos/plan_extraido/indicadores.json").read_text(encoding="utf8")) \
        if dane == "05308" else []
    prods = base["productos"]
    par, solo = _empareja(prods, pdf)
    por_dep = {d["id"]: {"alta": 0, "media": 0, "baja": 0} for d in deps}
    cal = Counter()
    salida = []
    for i, p in enumerate(prods):
        x = pdf[par[i]] if i in par else None
        resp, fuera, nota = [], [], None
        if x and x.get("responsable"):
            al = alias.get(_n(x["responsable"]).strip())
            if al:  # texto del PDF que no nombra una dependencia (p. ej. «Alcaldía»): se asigna a mano y queda como sugerido
                resp, nota = [{"dep": d, "conf": "media"} for d in al["dep"]], al["nota"]
            else:
                ids, fuera = _responsables(x["responsable"], deps, otras)
                for rg in reglas:  # una subsecretaria que el PDF junta y el organigrama separa
                    ids = [rg["hacia"] if i == rg["desde"] and p["sector"]["cod"] in rg["sectores"] else i for i in ids]
                resp = [{"dep": d, "conf": "alta"} for d in ids]
        fz = forzados.get(p["indicador"]["nombre"])
        if fz and not resp:
            resp, fuera, nota = [{"dep": d, "conf": "media"} for d in fz["dep"]], [], fz["nota"]
        rp = reparto.get(p["id"])
        if rp and any(r["dep"] == rp["desde"] for r in resp):  # el PDF dice la secretaria; el reparto entre sus dependencias es por tematica
            resp = [{"dep": rp["dep"], "conf": "media"} if r["dep"] == rp["desde"] else r for r in resp]
            nota = rp["nota"]
        if not resp and not fuera:
            ids, conf = PISTA_SECTOR.get(p["sector"]["cod"], ([], None))
            resp = [{"dep": d, "conf": conf} for d in ids]
        for r in resp:
            por_dep[r["dep"]][r["conf"]] += 1
        cal["con_pdf"] += x is not None
        cal["resp_pdf"] += any(r["conf"] == "alta" for r in resp)
        cal["resp_pista"] += bool(resp) and not any(r["conf"] == "alta" for r in resp)
        cal["resp_otra_entidad"] += bool(fuera) and not resp
        cal["sin_resp"] += not resp and not fuera
        cal["atipico"] += p["atipico"]
        salida.append({
            "id": p["id"], "linea": _le(p["linea"]), "sector": p["sector"]["cod"], "programa": p["programa"]["cod"],
            "producto": p["producto"]["nombre"], "indicador": p["indicador"]["nombre"],
            "detalle": p["indicador"]["personalizado"], "unidad": p["unidad"], "meta": p["meta"], "ods": p["ods"],
            "prog": [p["programacion"][a] for a in AÑOS],
            "resp": resp, "fuera": fuera, "nota": nota,
            "pdf": {"pagina": x.get("pagina"), "linea_base": x.get("linea_base")} if x else None,
        })
    n = len(prods)
    sectores, programas, lineas, ods = {}, {}, {}, Counter()
    for p in prods:
        s = sectores.setdefault(p["sector"]["cod"], {"cod": p["sector"]["cod"], "nombre": p["sector"]["nombre"].strip(), "productos": 0, "programas": set()})
        s["productos"] += 1
        s["programas"].add(p["programa"]["cod"])
        g = programas.setdefault(p["programa"]["cod"], {"cod": p["programa"]["cod"], "nombre": p["programa"]["nombre"], "sector": p["sector"]["cod"], "productos": 0})
        g["productos"] += 1
        ods[p["ods"] or "Sin ODS"] += 1
    for l in base["lineas"]:
        k = l["id"]
        lineas[k] = {"id": k, "nombre": re.sub(r"^L[ií]nea estrat[eé]gica \d+:\s*", "", l["nombre"]), "productos": 0, "programas": set()}
    for p in prods:
        k = _le(p["linea"])
        if k in lineas:
            lineas[k]["productos"] += 1
            lineas[k]["programas"].add(p["programa"]["cod"])
    for s in sectores.values():
        s["programas"] = len(s["programas"])
    for l in lineas.values():
        l["programas"] = len(l["programas"])
    return {
        "dane": dane, "municipio": base["municipio"], "plan": base["plan"],
        "fuente": {"nombre": "DNP, SisPT (plan indicativo) y PDF del plan", "fecha": "2026-10-30"},
        "dependencias": [{k: d.get(k) for k in ("id", "nombre", "tipo", "url", "padre", "padre_confirmado", "nota", "icono")} | {"productos": por_dep[d["id"]], "responsable": personas.get(d["id"]), "equipo": equipos[d["id"]]} for d in deps],
        "alcalde": alcalde, "responsables_fecha": fecha_web,
        "otras_entidades": [{"nombre": o["nombre"], "icono": o.get("icono")} for o in otras],
        "lineas": list(lineas.values()),
        "sectores": sorted(sectores.values(), key=lambda s: -s["productos"]),
        "programas": sorted(programas.values(), key=lambda g: -g["productos"]),
        "resultado": [{"id": r["id"], "linea": _le(r["linea"]), "indicador": r["indicador"], "meta": r["meta"]} for r in base["resultado"]],
        "ods": [{"nombre": k, "productos": v} for k, v in ods.most_common()],
        "financiacion": _ppi(raiz / "insumos/plan_extraido", base["lineas"]) if dane == "05308" else None,
        "productos": salida,
        "solo_pdf": [{"nombre": pdf[j]["nombre"], "pagina": pdf[j].get("pagina"), "responsable": pdf[j].get("responsable")} for j in solo],
        "calidad": {"productos": n, "indicadores_pdf": len(pdf), **{k: cal[k] for k in
                    ("con_pdf", "resp_pdf", "resp_pista", "resp_otra_entidad", "sin_resp", "atipico")}},
    }


if __name__ == "__main__":
    raiz, dane = sys.argv[1], sys.argv[2]
    d = construye(raiz, dane)
    destino = Path(raiz) / "public/data/plan"
    destino.mkdir(parents=True, exist_ok=True)
    (destino / f"{dane}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    print(json.dumps(d["calidad"], ensure_ascii=False))
