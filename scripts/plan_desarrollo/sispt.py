"""Consolida los Excel del plan indicativo de SisPT (uno por municipio) en tablas planas.

Entrada: insumos/sispt_plan_indicativo/<dane>.xlsx. Salida (misma carpeta, /consolidado): lineas.csv, resultado.csv,
productos.csv (con total por año), resumen.csv (conteos por municipio).
"""
import csv
import re
import sys
from pathlib import Path

import openpyxl

HOJAS = {"lineas": "L", "resultado": "Indicadores de resultado", "productos": "Plan indicativo - Productos"}


def _filas(wb, prefijo):
    for ws in wb:
        if ws.title.startswith(prefijo):
            f = list(ws.iter_rows(values_only=True))
            return [str(c or "").strip() for c in f[1]], f[2:]
    return [], []


def _norm(c):
    return re.sub(r"\s+", " ", c).strip()


def consolida(carpeta):
    carpeta = Path(carpeta)
    out = carpeta / "consolidado"
    out.mkdir(exist_ok=True)
    tablas = {"lineas": [], "resultado": [], "productos": []}
    cab = {}
    resumen = []
    for x in sorted(carpeta.glob("*.xlsx")):
        wb = openpyxl.load_workbook(x, read_only=True, data_only=True)
        n = {}
        for k, pref in HOJAS.items():
            h, filas = _filas(wb, "L\u00edneas" if k == "lineas" else pref)
            filas = [r for r in filas if r and r[0]]
            cab.setdefault(k, h)
            for r in filas:
                tablas[k].append(dict(zip(h, r)))
            n[k] = len(filas)
        resumen.append({"dane": x.stem, "lineas": n["lineas"], "resultado": n["resultado"], "productos": n["productos"]})
        wb.close()
    for k, filas in tablas.items():
        cols = list(dict.fromkeys(c for f in filas for c in f))
        with open(out / f"{k}.csv", "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(filas)
    with open(out / "resumen.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, ["dane", "lineas", "resultado", "productos"])
        w.writeheader()
        w.writerows(resumen)
    return {k: len(v) for k, v in tablas.items()}, resumen


if __name__ == "__main__":
    print(consolida(sys.argv[1])[0])
