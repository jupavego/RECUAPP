"""RESUMEN.md reproducible: estado de cada plan extraido y cobertura de categorias.

Los planes escaneados no dejan carpeta de salida (la extraccion se niega a hacerlos), asi que se leen de
`OMITIDOS.json` en la carpeta de salidas: {"subregion": ["Plan", ...]}.
"""
import json
from collections import Counter
from pathlib import Path

from .categorias import CAMPOS, perfil

SUBREGIONES = ("bajo_cauca", "magdalena_medio", "nordeste", "occidente", "oriente", "suroeste", "uraba")
POCOS = 60  # menos indicadores de producto que esto: casi siempre es lectura incompleta, no un plan chico


ABURRA = {"girardota", "itagui", "bello", "envigado", "caldas", "barbosa", "medellin", "sabaneta", "la_estrella", "copacabana"}


def _subregion(nombre):
    """(subregion, plan) por el prefijo de la carpeta; sin prefijo, es del Valle de Aburra o del Norte."""
    for s in SUBREGIONES:
        if nombre.startswith(s + "_"):
            return s.replace("_", " "), nombre[len(s) + 1:]
    return ("valle de aburra" if nombre in ABURRA else "norte"), nombre


def _estado(f, formatos):
    if f["indicadores"] == 0:
        return "SIN INDICADORES (otro formato o tablas-imagen)" if not f["resultado"] else "SOLO RESULTADO"
    return f"POCOS (<{POCOS})" if f["indicadores"] < POCOS else "ok"


def _formatos(carpeta):
    ind = json.loads((Path(carpeta) / "indicadores.json").read_text(encoding="utf8"))
    return "/".join(sorted({i.get("formato", "?") for i in ind})) or ""


def escribe(salidas, destino=None):
    salidas = Path(salidas)
    carpetas = sorted(c for c in salidas.iterdir() if c.is_dir() and (c / "indicadores.json").exists())
    raiz = (salidas / "indicadores.json").exists()
    omitidos = json.loads((salidas / "OMITIDOS.json").read_text(encoding="utf8")) \
        if (salidas / "OMITIDOS.json").exists() else {}
    filas, perfiles = [], []
    for c in ([salidas] if raiz else []) + carpetas:
        f = perfil(c)
        f["plan"] = "girardota" if c == salidas else c.name
        f["sub"], f["nombre"] = _subregion(f["plan"])
        f["formato"] = _formatos(c)
        f["estado"] = _estado(f, f["formato"])
        perfiles.append(f)
    n_ok = [f for f in perfiles if f["indicadores"]]
    n_omit = sum(len(v) for v in omitidos.values())
    L = ["# Resumen de la extraccion de planes de desarrollo 2024-2027", "",
         f"{len(perfiles) + n_omit} PDF revisados: {len(n_ok)} con indicadores de producto, {n_omit} omitidos por escaneados, "
         f"{len(perfiles) - len(n_ok)} sin indicadores de producto. Total: {sum(f['indicadores'] for f in perfiles)} "
         f"indicadores de producto y {sum(f['resultado'] for f in perfiles)} de resultado.", "",
         "## Estado por plan", "",
         "| Subregion | Plan | Estado | Producto | Resultado | Formato | PPI de inversion hallado |", "|---|---|---|---|---|---|---|"]
    for f in perfiles:
        L.append(f"| {f['sub']} | {f['nombre']} | {f['estado']} | {f['indicadores']} | {f['resultado']} | {f['formato']} | {f['ppi']} |")
    for sub, planes in omitidos.items():
        for p in planes:
            L.append(f"| {sub} | {p} | OMITIDO (escaneado) | 0 | 0 | - | - |")
    n = len(n_ok)
    L += ["", "## Cobertura de categorias (planes con indicadores)", "",
          "| Categoria | Planes con >=80 % lleno | Planes con 0 % | Mediana |", "|---|---|---|---|"]
    for k, nombre in CAMPOS:
        v = sorted(f["cobertura"][k] for f in n_ok)
        L.append(f"| {nombre} | {sum(x >= 80 for x in v)} de {n} | {sum(x == 0 for x in v)} | {v[n // 2] if n else 0} % |")
    combos = Counter(tuple(k for k, _ in CAMPOS if f["cobertura"][k] >= 50) for f in n_ok)
    nucleo = [nombre for k, nombre in CAMPOS
              if n and sum(f["cobertura"][k] >= 50 for f in n_ok) >= 0.8 * n]
    L += ["", "## Hallazgos para el esquema",
          f"- {n} planes con indicadores dan {len(combos)} combinaciones distintas de campos (llenos en >=50 % de las filas): "
          "el esquema necesita un nucleo pequeño y campos opcionales.",
          f"- Nucleo (lleno en >=50 % de las filas en >=80 % de los planes): {', '.join(nucleo)}.",
          "- Los porcentajes no distinguen 'el plan no lo trae' de 'el parser no lo leyo'; la revision humana de la muestra lo resuelve."]
    if (salidas / "PENDIENTES.json").exists():
        L += ["", "## Planes con lectura incompleta y por que"]
        for plan, motivo in json.loads((salidas / "PENDIENTES.json").read_text(encoding="utf8")).items():
            L.append(f"- **{plan}**: {motivo}")
    texto = "\n".join(L) + "\n"
    (Path(destino) if destino else salidas / "RESUMEN.md").write_text(texto, encoding="utf8")
    return texto
