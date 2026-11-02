"""Matriz maestra en Excel: plan de desarrollo (SisPT) + responsables + seguimiento de los informes del municipio.

Uso: python -m scripts.plan_desarrollo.matriz_maestra <dane>
Salida: insumos/seguimiento_municipal/<dane>/matriz_maestra_<dane>.xlsx

Una fila por indicador de producto del plan, con quien responde, lo programado y lo avanzado en cada informe. Las demas
hojas traen las tablas de origen completas (fichas, resumen, cuadros por dependencia) para auditar cada cifra.
"""
import csv
import json
import re
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .seguimiento_json import ENTRADA, RAIZ, SALIDA, _f, _leer, dep_id
from .seguimiento_pdf import PRODUCTOS

CABECERA = PatternFill("solid", fgColor="1F4E3D")
GRUPO = {"plan": "DDEBF7", "resp": "FCE4D6", "2024": "E2EFDA", "2025": "FFF2CC", "texto": "EDEDED"}
ANIOS = ("2024", "2025", "2026", "2027")


def hoja(wb, titulo, columnas, filas, anchos=None, grupos=None, congelar="A2"):
    ws = wb.create_sheet(titulo)
    ws.append(columnas)
    for fila in filas:
        ws.append(fila)
    for i, c in enumerate(ws[1], 1):
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = CABECERA
        c.alignment = Alignment(wrap_text=True, vertical="center")
        if grupos and grupos[i - 1]:
            c.fill = PatternFill("solid", fgColor=grupos[i - 1])
            c.font = Font(bold=True, color="000000")
        ws.column_dimensions[get_column_letter(i)].width = (anchos or {}).get(columnas[i - 1], 14)
    ws.row_dimensions[1].height = 44
    ws.freeze_panes = congelar
    ws.auto_filter.ref = ws.dimensions
    return ws


def colorea_pct(ws, columnas):
    verde, ambar, rojo = (PatternFill("solid", bgColor=c) for c in ("C6EFCE", "FFEB9C", "FFC7CE"))
    for letra in columnas:
        rango = f"{letra}2:{letra}{ws.max_row}"
        ws.conditional_formatting.add(rango, CellIsRule(operator="greaterThanOrEqual", formula=["100"], fill=verde))
        ws.conditional_formatting.add(rango, CellIsRule(operator="between", formula=["50", "99.99"], fill=ambar))
        ws.conditional_formatting.add(rango, CellIsRule(operator="lessThan", formula=["50"], fill=rojo))


def numerico(v):
    x = _f(v)
    return x if x is not None else (v or None)


def csv_a_hoja(wb, titulo, ruta, anchos=None):
    filas = _leer(ruta)
    if not filas:
        return
    cols = list(filas[0])
    datos = [[numerico(r[c]) if c not in ("narrativa", "texto", "proyecto") else r[c] for c in cols] for r in filas]
    hoja(wb, titulo, cols, datos, anchos or {"narrativa": 90, "texto": 60, "indicador": 40, "dependencia": 28, "proyecto": 40})


def main(dane):
    carpeta = ENTRADA / dane
    plan = json.loads((SALIDA / f"{dane}.json").read_text(encoding="utf-8"))
    seg = json.loads((SALIDA / f"{dane}-seguimiento.json").read_text(encoding="utf-8"))
    deps = {d["id"]: d for d in plan["dependencias"]}
    lineas = {x["id"]: x["nombre"] for x in plan["lineas"]}
    prod = {p["id"]: p for p in plan["productos"]}
    sispt = {r["Código de indicador de producto (SisPT)"]: r for r in _leer(PRODUCTOS) if r["Código DANE"] == dane}

    wb = Workbook()
    wb.remove(wb.active)

    leeme = wb.create_sheet("Léeme")
    for linea in [
        f"Matriz maestra · {plan['municipio']} · Plan de desarrollo {plan['plan']}",
        "",
        "Hojas",
        "Matriz — un indicador de producto por fila: plan (SisPT), responsable, programación e inversión, avance 2024 y 2025 y narrativa.",
        "Por responsable — cada dependencia con quien la dirige, sus productos y el avance de los cuadros oficiales del informe.",
        "Dependencias y Líneas y global — cuadros del informe publicados como imagen y transcritos a mano (plan de acción y avance al cuatrienio).",
        "Fichas 2024 / Fichas 2025 / Fichas infraestructura / Resumen 2025 — tablas extraídas de los PDF de seguimiento, sin transformar.",
        "",
        "Cómo leer el avance",
        "Programada y avance son físicos y del año. % = avance / programada; puede pasar de 100. El avance de una dependencia en los cuadros del informe",
        "es el promedio de los % de sus indicadores con cada uno topado en 100, y cuadra con la hoja Resumen 2025.",
        "2025 viene de la tabla resumen del informe cuando el indicador está en ella (corte al tercer trimestre); si no, de su ficha.",
        "La ficha y la tabla resumen son dos reportes del mismo dato y no siempre coinciden: la columna 'Ficha 2025 difiere' los marca.",
        "",
        "Responsables",
        "'Responsable (plan)' sale del PDF del plan (conf. alta) o se sugiere por sector. 'Reporta (informe)' es la dependencia bajo la que el informe lo presenta.",
        "",
        "Límites",
        f"El informe 2025 trae {len([1 for v in seg['indicadores'].values() if '2025' in v['por_anio']])} de los {len(sispt)} indicadores del plan; los demás no aparecen en ninguna parte del informe.",
        f"El informe 2024 se cruzó por nombre dentro del programa: {len([1 for v in seg['indicadores'].values() if '2024' in v['por_anio']])} indicadores cruzados, {seg['sin_codigo_por_anio'].get('2024', 0)} fichas sin cruzar (ver Fichas 2024).",
        "Los cuadros por dependencia de 2024 no traen el avance al cuatrienio. Todo avance es el reportado por la alcaldía; no está auditado.",
    ]:
        leeme.append([linea])
    leeme.column_dimensions["A"].width = 150
    for fila in (1, 3, 9, 15, 18):
        leeme.cell(row=fila, column=1).font = Font(bold=True, size=12 if fila > 1 else 14)

    cols = (["Código SisPT", "Línea estratégica", "Sector", "Programa", "Producto", "Indicador", "Unidad", "Tipo acumulación", "Meta cuatrienio"]
            + [f"Programación {a}" for a in ANIOS] + [f"Inversión programada {a} (COP)" for a in ANIOS]
            + ["Responsable (plan)", "Confianza", "Persona a cargo", "Cargo", "Reporta (informe 2025)"]
            + ["2024 programada", "2024 avance", "2024 %", "2025 programada", "2025 avance", "2025 %", "2025 fuente", "Ficha 2025 difiere",
               "Código en el plan", "Proyecto", "BPIN", "Narrativa 2024", "Narrativa 2025"])
    grupos = ([GRUPO["plan"]] * 17 + [GRUPO["resp"]] * 5 + [GRUPO["2024"]] * 3 + [GRUPO["2025"]] * 5 + [GRUPO["texto"]] * 6)
    filas = []
    for ip in sorted(sispt, key=lambda x: int(x.split("-")[1])):
        r, p, s = sispt[ip], prod.get(ip, {}), seg["indicadores"].get(ip, {})
        resp = p.get("resp", [])
        nombres = " · ".join(deps[x["dep"]]["nombre"] for x in resp if x["dep"] in deps)
        personas = " · ".join((deps[x["dep"]].get("responsable") or {}).get("nombre", "") for x in resp if x["dep"] in deps)
        cargos = " · ".join((deps[x["dep"]].get("responsable") or {}).get("cargo", "") for x in resp if x["dep"] in deps)
        conf = "/".join(sorted({x["conf"] for x in resp}))
        pa = s.get("por_anio", {})
        inf = (s.get("informe_dep") or {}).get("2025")
        m = re.match(r"(\d+(?:\.\d+)+)\s", r["Personalización de Indicador de Producto"].strip() + " ")
        d24, d25 = pa.get("2024", {}), pa.get("2025", {})
        dif = d25.get("ficha")
        filas.append([
            ip, lineas.get(p.get("linea"), r["Línea estratégica"]), r["Sector (MGA)"], r["Programa (MGA)"], r["Producto (MGA)"],
            r["Indicador de Producto(MGA)"], r["Unidad de medida"], r["Tipo de acumulación"], _f(r["Meta del cuatrienio"]),
            *[_f(r[f"Programación del producto bien o servicio {a}"]) for a in ANIOS],
            *[_f(r[f"Total {a}"]) for a in ANIOS],
            nombres, conf, personas, cargos, deps[inf]["nombre"] if inf in deps else None,
            d24.get("programada"), d24.get("avance"), d24.get("pct"),
            d25.get("programada"), d25.get("avance"), d25.get("pct"), d25.get("fuente"),
            f"ficha: {dif['programada']} programada, {dif['avance']} avance" if dif else None,
            m.group(0).strip() if m else None, s.get("proyecto"), s.get("bpin"),
            (s.get("narrativas") or {}).get("2024"), (s.get("narrativas") or {}).get("2025"),
        ])
    anchos = {"Línea estratégica": 34, "Sector": 24, "Programa": 34, "Producto": 30, "Indicador": 44, "Responsable (plan)": 34,
              "Persona a cargo": 28, "Cargo": 28, "Reporta (informe 2025)": 30, "Ficha 2025 difiere": 30, "Proyecto": 36,
              "Narrativa 2024": 70, "Narrativa 2025": 70}
    ws = hoja(wb, "Matriz", cols, filas, anchos, grupos, congelar="G2")
    for fila in ws.iter_rows(min_row=2, min_col=14, max_col=17):
        for c in fila:
            c.number_format = '#,##0'
    colorea_pct(ws, [get_column_letter(cols.index("2024 %") + 1), get_column_letter(cols.index("2025 %") + 1)])

    # por responsable: cuadros oficiales del informe + lo que sale de la matriz
    por = {}
    for ip, p in prod.items():
        for x in p.get("resp", []):
            por.setdefault(x["dep"], []).append((ip, x["conf"]))
    filas = []
    for d in plan["dependencias"]:
        mios = por.get(d["id"], [])
        pcts = [seg["indicadores"][i]["por_anio"]["2025"]["pct"] for i, _ in mios
                if i in seg["indicadores"] and "2025" in seg["indicadores"][i]["por_anio"] and seg["indicadores"][i]["por_anio"]["2025"]["pct"] is not None]
        o = seg["dependencias"].get(d["id"], {})
        q = d.get("responsable") or {}
        filas.append([d["nombre"], d["tipo"], deps[d["padre"]]["nombre"] if d.get("padre") in deps else None, q.get("nombre"), q.get("cargo"),
                      q.get("correo"), q.get("telefono"), len(mios), sum(1 for _, c in mios if c == "alta"), len(pcts),
                      round(sum(min(100, v) for v in pcts) / len(pcts), 1) if pcts else None,
                      (o.get("2025") or {}).get("metas"), (o.get("2025") or {}).get("plan_accion"), (o.get("2025") or {}).get("cuatrienio"),
                      (o.get("2024") or {}).get("plan_accion"), len(d.get("equipo") or [])])
    ws = hoja(wb, "Por responsable",
              ["Dependencia", "Tipo", "Depende de", "Persona a cargo", "Cargo", "Correo", "Teléfono", "Productos (plan)", "De ellos, según el PDF",
               "Con avance 2025", "Avance 2025 (promedio matriz, tope 100)", "Metas en el informe 2025", "Informe 2025 · plan de acción %",
               "Informe 2025 · avance al cuatrienio %", "Informe 2024 · plan de acción %", "Funcionarios en el directorio"],
              filas, {"Dependencia": 42, "Persona a cargo": 28, "Cargo": 30, "Correo": 30, "Depende de": 30}, congelar="B2")
    colorea_pct(ws, ["K", "M", "N", "O"])

    ws = None
    for titulo, ruta in (("Dependencias", "dependencias.csv"), ("Líneas y global", "lineas_y_global.csv")):
        csv_a_hoja(wb, titulo, carpeta / ruta, {"dependencia": 55, "nombre": 60, "fuente": 70})
    for titulo, ruta in (("Fichas 2024", "fichas_2024.csv"), ("Fichas 2025", "fichas_2025.csv"),
                         ("Fichas infraestructura", "fichas_infra_2024_2025.csv"), ("Resumen 2025", "resumen_2025.csv")):
        csv_a_hoja(wb, titulo, carpeta / ruta)

    destino = carpeta / f"matriz_maestra_{dane}.xlsx"
    wb.save(destino)
    print(f"{destino}: {len(sispt)} indicadores, hojas {wb.sheetnames}")


if __name__ == "__main__":
    main(sys.argv[1])
