"""Directorio de funcionarios de una alcaldia: contactos de la hoja de calculo publicada en su sitio.

Uso: python -m plan_desarrollo.directorio_web <url_xlsx> <salida.json> <url_pagina_directorio>
Solo guarda lo necesario para contactar: nombre, cargo, dependencia, correo, telefono y extension. La hoja trae
ademas formacion, experiencia y salario; no se copian.
"""
import json
import sys
import tempfile
import urllib.request
from datetime import date
from pathlib import Path

import openpyxl

UA = {"User-Agent": "Mozilla/5.0"}
CAMPOS = {"nombre": 0, "cargo": 4, "dependencia": 5, "correo": 6, "telefono": 7, "extension": 8}


def _txt(v):
    return " ".join(str(v).split()) if v not in (None, "") else None


def lee(url_xlsx):
    with tempfile.TemporaryDirectory() as d:
        ruta = Path(d) / "directorio.xlsx"
        ruta.write_bytes(urllib.request.urlopen(urllib.request.Request(url_xlsx, headers=UA), timeout=60).read())
        hoja = openpyxl.load_workbook(ruta, data_only=True).active
        filas = list(hoja.iter_rows(values_only=True))
    out = []
    for f in filas:
        r = {k: _txt(f[i]) for k, i in CAMPOS.items()}
        if not r["nombre"] or not r["correo"] or "@" not in r["correo"]:
            continue  # encabezados y filas vacias
        r["correo"] = r["correo"].lower()
        out.append(r)
    return out


def main(url_xlsx, salida, url_pagina):
    filas = lee(url_xlsx)
    json.dump({"fuente": url_pagina, "archivo": url_xlsx, "fecha": date.today().isoformat(), "funcionarios": filas},
              open(salida, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    return filas


if __name__ == "__main__":
    f = main(*sys.argv[1:4])
    print(len(f), "funcionarios")
