"""Que categorias trae realmente cada plan: base para decidir el esquema canonico de abstraccion.

No decide nada solo: mide, por plan, que campos existen y con que cobertura, para que la decision de que
categorias exigir (y cuales dejar opcionales) se tome con datos de muchos planes y no con el primero que se vio.
"""
import json
from pathlib import Path

CAMPOS = [
    ("nombre", "Nombre del indicador"), ("unidad", "Unidad de medida"), ("linea_base", "Linea base"),
    ("ano_base", "Año de la linea base"), ("meta", "Meta del cuatrienio"), ("meta_2024", "Meta por año"),
    ("tipo_acumulado", "Tipo de acumulado"), ("responsable", "Responsable"), ("fuente", "Fuente"),
    ("codigo", "Codigo de indicador (catalogo MGA)"), ("producto", "Producto (catalogo MGA)"),
    ("programa", "Programa"), ("sector", "Sector"), ("linea", "Linea estrategica"),
    ("ods", "ODS"), ("pnd", "Alineacion PND"), ("pdd", "Alineacion PDD"),
]


def _cobertura(ind, campo):
    return sum(1 for i in ind if i.get(campo) not in (None, "")) / len(ind) if ind else 0


def perfil(carpeta):
    c = Path(carpeta)
    ind = json.loads((c / "indicadores.json").read_text(encoding="utf8"))
    res = json.loads((c / "indicadores_resultado.json").read_text(encoding="utf8")) \
        if (c / "indicadores_resultado.json").exists() else []
    arbol = json.loads((c / "ppi_arbol.json").read_text(encoding="utf8")) if (c / "ppi_arbol.json").exists() else []
    prog = [r for r in json.loads((c / "ppi_programas.json").read_text(encoding="utf8")) if r["estado"] == "ok"] \
        if (c / "ppi_programas.json").exists() else []
    niveles = sorted({r["nivel"] for b in arbol if any(x["con_hijos"] for x in b["registros"]) for r in b["registros"]})
    if len(prog) >= 10:
        ppi = "programa (anexo)"
    elif niveles:
        ppi = "/".join(niveles)
    else:
        ppi = "no hallado"
    return dict(plan=c.name, indicadores=len(ind), resultado=len(res), ppi=ppi,
                cobertura={k: round(_cobertura(ind, k) * 100) for k, _ in CAMPOS},
                programas=len({i.get("programa") for i in ind if i.get("programa")}))


def matriz(carpetas):
    filas = [perfil(c) for c in carpetas if (Path(c) / "indicadores.json").exists()]
    cab = "| Plan | Ind. producto | Ind. resultado | Programas | PPI hallado | " + " | ".join(n for _, n in CAMPOS) + " |"
    sep = "|" + "---|" * (5 + len(CAMPOS))
    lineas = [cab, sep]
    for f in filas:
        lineas.append(f"| {f['plan']} | {f['indicadores']} | {f['resultado']} | {f['programas']} | {f['ppi']} | "
                      + " | ".join(f"{f['cobertura'][k]}%" for k, _ in CAMPOS) + " |")
    n = len(filas)
    if n:
        lineas.append("| **mediana** | | | | | " + " | ".join(
            f"{sorted(f['cobertura'][k] for f in filas)[n // 2]}%" for k, _ in CAMPOS) + " |")
    return "\n".join(lineas), filas
