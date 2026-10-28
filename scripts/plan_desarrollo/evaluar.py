"""Mide una extraccion contra una referencia verificada (golden set) y compara lecturas de vision."""
import json
from pathlib import Path

from .texto import norm

GOLDEN = Path(__file__).parent / "golden"


def _leer(salida, nombre):
    return json.loads((Path(salida) / f"{nombre}.json").read_text(encoding="utf8"))


def congelar(salida, nombre):
    """Guarda como referencia lo extraido (tras revisarlo a mano) para medir corridas futuras."""
    ind = _leer(salida, "indicadores")
    prog = [r for r in _leer(salida, "ppi_programas") if r["estado"] == "ok"]
    ref = dict(
        sectores={k: v["anios"] for k, v in _leer(salida, "ppi_sectores").items()},
        programas={norm(r["programa"]): r["anios"] for r in prog},
        indicadores=sorted({f"{norm(i['programa'])}|{norm(i['nombre'])}" for i in ind}),
    )
    GOLDEN.mkdir(exist_ok=True)
    destino = GOLDEN / f"{nombre}.json"
    destino.write_text(json.dumps(ref, ensure_ascii=False, indent=1), encoding="utf8")
    return destino


def _prf(obtenido, esperado):
    o, e = set(obtenido), set(esperado)
    vp = len(o & e)
    return dict(precision=round(vp / len(o), 3) if o else 0, recall=round(vp / len(e), 3) if e else 0,
                esperados=len(e), obtenidos=len(o))


def evaluar(salida, nombre):
    ref = json.loads((GOLDEN / f"{nombre}.json").read_text(encoding="utf8"))
    ind = _leer(salida, "indicadores")
    prog = {norm(r["programa"]): r["anios"] for r in _leer(salida, "ppi_programas") if r["estado"] == "ok"}
    sect = {k: v["anios"] for k, v in _leer(salida, "ppi_sectores").items()}
    obtenidos = {f"{norm(i['programa'])}|{norm(i['nombre'])}" for i in ind}
    return dict(
        indicadores=_prf(obtenidos, ref["indicadores"]),
        programas=_prf(prog, ref["programas"]),
        programas_con_cifras_exactas=sum(prog.get(k) == v for k, v in ref["programas"].items()),
        sectores=_prf(sect, ref["sectores"]),
        sectores_con_cifras_exactas=sum(sect.get(k) == v for k, v in ref["sectores"].items()),
    )


def comparar_vision(salida):
    """Lectura manual revisada (indicadores_vision.json) vs lectura por API (vision_api/) en las mismas paginas."""
    salida = Path(salida)
    manual = json.loads((salida / "indicadores_vision.json").read_text(encoding="utf8"))
    api = []
    for f in sorted((salida / "vision_api").glob("p*.json")):
        api += json.loads(f.read_text(encoding="utf8"))
    paginas = {m["pagina"] for m in manual} & {a["pagina"] for a in api}
    res = {}
    for p in sorted(paginas):
        m = {norm(x["nombre"]) for x in manual if x["pagina"] == p}
        a = {norm(x["nombre"]) for x in api if x["pagina"] == p}
        res[p] = _prf(a, m)
    return res
