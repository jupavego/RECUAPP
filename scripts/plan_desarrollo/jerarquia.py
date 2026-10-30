"""Jerarquia y cardinalidad linea estrategica -> sector -> programa de un plan ya extraido.

La relacion se toma del Anexo del PPI por programa (cada fila trae linea, sector y programa), que es la fuente
mas fiable de pertenencia; los indicadores solo aportan el conteo por programa. Las lineas se unifican por su
numero porque el Anexo pega el titulo varias veces ("Linea LINEA 1 ... Linea").
"""
import json
import re
from collections import defaultdict
from pathlib import Path

from .texto import norm

_NUM = re.compile(r"linea\D*?(\d+)")


def _numero(linea):
    m = _NUM.search(norm(linea or ""))
    return m.group(1) if m else None


def _nombres_linea(salida):
    """Nombre limpio por numero de linea, tomado de la jerarquia inferida del PPI cuando existe."""
    f = Path(salida) / "ppi_arbol.json"
    nombres = {}
    if f.exists():
        for b in json.loads(f.read_text(encoding="utf8")):
            for r in b["registros"]:
                if r["nivel"] == "linea" and _numero(r["etiqueta"]):
                    nombres.setdefault(_numero(r["etiqueta"]), re.sub(r"(?i)^l[^\s]*nea( estrat[^\s]*gica)?:?\s*", "", r["etiqueta"]))
    return nombres


def _bonito(nombres):
    """De las variantes de un mismo nombre, la que no esta toda en mayusculas."""
    return next((n for n in nombres if not n.isupper()), nombres[0])


def construye(salida):
    salida = Path(salida)
    prog = [r for r in json.loads((salida / "ppi_programas.json").read_text(encoding="utf8")) if r["estado"] != "total"]
    inds = json.loads((salida / "indicadores.json").read_text(encoding="utf8"))
    # sector y programa se comparan sin mayusculas ni tildes: el Anexo los escribe distinto segun la linea
    variantes = defaultdict(list)
    for r in prog:
        variantes[norm(r["sector"])].append(r["sector"])
    sector_de = {k: _bonito(v) for k, v in variantes.items()}
    llave = lambda sector, programa: (norm(sector or ""), norm(programa or ""))
    n_ind = defaultdict(int)
    for i in inds:
        n_ind[llave(i.get("sector"), i.get("programa"))] += 1

    nombres = _nombres_linea(salida)
    arbol = defaultdict(lambda: defaultdict(dict))  # linea -> sector -> programa -> datos
    sin_linea = []
    for r in prog:
        num = _numero(r["linea"])
        if num is None:
            sin_linea.append(f"{r['sector']} / {r['programa']}")
            continue
        etiqueta = nombres.get(num) or r["linea"]
        sector = sector_de[norm(r["sector"])]
        arbol[(num, etiqueta)][sector][r["programa"]] = dict(
            ppi_total=sum(r["anios"]) if r.get("anios") else None, indicadores=n_ind.get(llave(sector, r["programa"]), 0))

    lineas = [dict(numero=num, linea=et, n_sectores=len(sec), n_programas=sum(len(p) for p in sec.values()),
                   n_indicadores=sum(d["indicadores"] for p in sec.values() for d in p.values()),
                   ppi_total=sum(d["ppi_total"] or 0 for p in sec.values() for d in p.values()),
                   sectores=[dict(sector=s, n_programas=len(p), n_indicadores=sum(d["indicadores"] for d in p.values()),
                                  ppi_total=sum(d["ppi_total"] or 0 for d in p.values()),
                                  programas=[dict(programa=n, **d) for n, d in p.items()]) for s, p in sec.items()])
              for (num, et), sec in sorted(arbol.items())]

    # cardinalidades: cuantas lineas toca cada sector y cuantos sectores/lineas tiene cada programa
    lineas_de_sector, ubicaciones_programa = defaultdict(set), defaultdict(set)
    for l in lineas:
        for s in l["sectores"]:
            lineas_de_sector[s["sector"]].add(l["numero"])
            for p in s["programas"]:
                ubicaciones_programa[p["programa"]].add((l["numero"], s["sector"]))
    en_ppi = {llave(s["sector"], p["programa"]) for l in lineas for s in l["sectores"] for p in s["programas"]}
    sin_programa = sorted({(i.get("sector"), i.get("programa")) for i in inds
                           if llave(i.get("sector"), i.get("programa")) not in en_ppi}, key=str)
    return dict(
        resumen=dict(lineas=len(lineas), sectores=len(lineas_de_sector),
                     programas=sum(l["n_programas"] for l in lineas), indicadores=len(inds),
                     indicadores_sin_programa_en_ppi=len(sin_programa)),
        cardinalidad=dict(
            sectores_por_linea={l["linea"]: l["n_sectores"] for l in lineas},
            programas_por_linea={l["linea"]: l["n_programas"] for l in lineas},
            lineas_por_sector={s: sorted(v) for s, v in sorted(lineas_de_sector.items())},
            sectores_en_varias_lineas=sorted(s for s, v in lineas_de_sector.items() if len(v) > 1),
            programas_en_varios_lugares=sorted(p for p, v in ubicaciones_programa.items() if len(v) > 1)),
        filas_sin_linea=sin_linea,
        indicadores_sin_programa_en_ppi=[list(x) for x in sin_programa],
        arbol=lineas)


def escribe(salida):
    """Guarda jerarquia.json y devuelve unas lineas para el reporte."""
    j = construye(salida)
    (Path(salida) / "jerarquia.json").write_text(json.dumps(j, ensure_ascii=False, indent=1), encoding="utf8")
    r, c = j["resumen"], j["cardinalidad"]
    return (f"{r['lineas']} lineas, {r['sectores']} sectores, {r['programas']} programas; "
            f"sectores en varias lineas: {len(c['sectores_en_varias_lineas'])}; "
            f"programas repetidos: {len(c['programas_en_varios_lugares'])}")
