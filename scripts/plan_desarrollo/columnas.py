"""Tablas de indicadores guiadas por el texto del encabezado, no por la posicion de las columnas.

Cada plan trae el mismo contenido con otro orden y otros nombres de columna ("Dependencia lider",
"Medido a traves de", "Forma de acumulacion"...). Aqui se reconoce que significa cada columna.
"""
import re

from .texto import limpia, norm

# (campo, patron sobre el encabezado compacto: sin tildes, minusculas y sin espacios). El orden importa.
REGLAS = [
    ("codigo", r"^codigo"),
    ("ano_base", r"^ano"),
    ("linea_base", r"lineabase|^lbase"),
    ("meta_anual", r"^20\d\d$"),
    ("meta", r"^meta"),
    ("tipo_acumulado", r"acumul|orientacion|formadecalculo"),
    ("responsable", r"responsable|dependencia|lider"),
    ("fuente", r"^fuente"),
    ("unidad", r"^unidad|medidoatraves"),  # "Medido a traves de" trae la unidad ("Numero de beneficiarios")
    ("programa", r"^programa"),
    ("producto", r"^producto"),
    ("nombre", r"indicador|^nombre"),
]


def compacto(c):
    return norm(limpia(c)).replace(" ", "")


def mapea(celdas):
    """{indice_de_columna: campo} para una fila de encabezado, o None si no parece de indicadores."""
    cols, usados = {}, set()
    for j, c in enumerate(celdas):
        k = compacto(c)
        if not k:
            continue
        for campo, pat in REGLAS:
            if re.search(pat, k):
                if campo == "meta_anual":
                    campo = f"meta_{k}"
                if campo not in usados:
                    cols[j] = campo
                    usados.add(campo)
                break
    if "nombre" in usados and ({"linea_base", "meta"} & usados):
        return cols
    return None


def tipo_por_cabecera(celdas):
    """'resultado' / 'producto' si el propio encabezado lo dice; None si no."""
    k = "".join(compacto(c) for c in celdas)  # sin separador: el titulo puede venir partido entre columnas
    if re.search(r"indicadoresde?producto|indicadordeproducto", k):
        return "producto"
    if re.search(r"indicadoresde?resultado|indicadorderesultado", k):
        return "resultado"
    return None


def clasifica(t):
    """Si la tabla es de indicadores: (fila_de_encabezado, columnas, tipo, titulo). Si no, None.

    El encabezado puede ser la fila 0 o la 1 (la 0 trae entonces el titulo, p. ej. el programa).
    """
    for hi in (0, 1):
        if hi < len(t):
            cols = mapea(t[hi])
            if cols:
                titulo = ""
                if hi == 1:
                    celdas = [limpia(x) for x in t[0] if limpia(x)]
                    titulo = celdas[0] if len(set(celdas)) == 1 else ""
                return hi, cols, tipo_por_cabecera(t[hi]), titulo
    return None


def _parece_titulo(txt):
    """Un titulo real, no una celda cortada ('Gobierno y')."""
    return len(txt) >= 15 and norm(txt).split()[-1] not in {"y", "e", "de", "del", "la", "el", "en", "los", "las", "para"}


def parsea(t, hi, cols):
    """Filas de datos -> dicts con los campos reconocidos. Una fila con una sola celda llena es un subtitulo."""
    out, programa = [], ""
    for fila in t[hi + 1:]:
        c = [limpia(x) for x in fila]
        if len(c) < len(t[hi]):  # celdas combinadas: faltan las de la izquierda
            c = [""] * (len(t[hi]) - len(c)) + c
        llenas = [x for x in c if x]
        if not llenas:
            continue
        rec = {campo: c[j] for j, campo in cols.items() if j < len(c) and c[j]}
        if "programa" in rec:
            programa = rec["programa"]
        elif programa:
            rec["programa_sub"] = programa
        if not rec.get("nombre"):
            if len(set(llenas)) == 1 and "programa" not in cols and _parece_titulo(llenas[0]):
                programa = llenas[0]  # subtitulo: nombre del programa para las filas siguientes
            continue
        if norm(rec["nombre"]).startswith(("nombre", "indicador")) and len(rec) <= 2:
            continue
        if not (rec.get("linea_base") or rec.get("meta")):
            continue  # fragmento de celda partida o tabla de otro tipo, no un indicador
        for campo in ("unidad", "linea_base", "meta", "tipo_acumulado", "responsable"):
            rec.setdefault(campo, "")
        out.append(rec)
    return out
