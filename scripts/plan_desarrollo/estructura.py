"""Lineas, sectores, programas e indicadores de producto (capitulo estrategico del plan)."""
import re

from . import columnas
from .texto import filas_tabla, limpia, norm

ARTICULO = re.compile(r"^ART[IÍ�]CULO\s*\d+\s*[°º.:\-–]*\s*", re.I)
CODIGO = re.compile(r"^[\d.]+\s*[:.\-–]\s*")  # "1.1.1:" delante del nombre de un programa
RE_LINEA = re.compile(r"^(?:L[ií�]nea estrat[eé�]gica|Eje estrat[eé�]gico|Dimensi[oó�]n|Pilar|Reto)\s*(\d+)?\s*[:.\-–]?\s*(.*)", re.I)
RE_SECTOR = re.compile(r"^Sector\s+(?!es\b|de inversi)(.+)$", re.I)
RE_PROG = re.compile(r"^Programa\s*(?:[\d.]+\s*)?[:.\-–]?\s*(.+)$", re.I)
RE_CAPT = re.compile(r"Indicadores de producto programa\s+(.+?)\.?\s*Fuente", re.I)
RE_RESP = re.compile(r"^Responsables?\s*:\s*(.+)$", re.I)
RE_TIPO = re.compile(r"^Indicadores? de (producto|resultado)s?\b", re.I)


def recorre_estructura(paginas):
    """Itera paginas y emite eventos (pagina, tipo, valor, texto)."""
    ev = []
    for n, md in paginas:
        lineas = md.splitlines()
        for k, ln in enumerate(lineas):
            s = limpia(ln.lstrip("# "))
            if len(s) > 200 or ln.startswith("|"):
                continue
            s = ARTICULO.sub("", s)
            m = RE_LINEA.match(s)
            if m:
                ev.append((n, "linea", int(m.group(1)) if m.group(1) else m.group(2).strip(), s))
                continue
            m = RE_SECTOR.match(s)
            if m and len(s) < 90:
                ev.append((n, "sector", m.group(1).strip(), s))
                continue
            m = RE_PROG.match(s)
            if m:
                nombre = CODIGO.sub("", m.group(1).strip())
                if not re.search("[A-Za-záéíóúñ]", nombre):  # "Programa 1.1.1": el nombre va en la linea siguiente
                    nombre = next((limpia(x.lstrip("# ")) for x in lineas[k + 1:] if x.strip()
                                   and not x.startswith("|")), "")[:150]
                ev.append((n, "programa", nombre, s))
                continue
            m = RE_RESP.match(s)
            if m:
                ev.append((n, "responsable", m.group(1).strip(), s))
                continue
            m = RE_CAPT.search(s)
            if m:
                ev.append((n, "caption", m.group(1).strip(), s))
                continue
            m = RE_TIPO.match(s)
            if m and len(s) < 120:
                ev.append((n, "tipo", m.group(1).lower(), s))
        for t in filas_tabla(md):
            ev.append((n, "tabla", t, ""))
    return ev


def es_tabla_indicadores(t):
    return columnas.clasifica(t) is not None


def _con_responsable(inds, responsable):
    """Si el plan pone el responsable en el titulo del programa y no en una columna, se hereda."""
    for i in inds:
        if responsable and not i.get("responsable"):
            i["responsable"] = responsable
    return inds


def tablas_de_indicadores(paginas):
    """Devuelve (tablas, pies). Cada tabla lleva la linea/sector/programa/tipo vigentes y sus indicadores."""
    linea = sector = programa = caption = titulo = None
    responsable = None
    tipo_ctx = None  # el titulo "Indicadores de resultado" vale solo para la tabla que le sigue
    tablas, captions = [], []
    for n, tipo, val, _ in recorre_estructura(paginas):
        if tipo == "linea":
            linea = val
        elif tipo == "sector":
            sector = val
        elif tipo == "programa":
            programa, responsable = val, None
        elif tipo == "responsable":
            responsable = val
        elif tipo == "tipo":
            tipo_ctx = val
        elif tipo == "caption":
            captions.append(val)
            caption = val
        elif tipo == "tabla":
            c = columnas.clasifica(val)
            if not c:
                continue
            hi, cols, tipo_tabla, tit = c
            if tit:
                titulo = tit
            tablas.append(dict(n=n, linea=linea, sector=sector, cand=programa or caption or titulo,
                               tipo=tipo_tabla or tipo_ctx or "producto", ind=_con_responsable(columnas.parsea(val, hi, cols), responsable)))
            tipo_ctx = None
    return tablas, captions
