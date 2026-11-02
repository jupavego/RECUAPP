"""Extrae todo el contenido tabular y narrativo de un informe de seguimiento municipal (PDF de texto).

Uso: python -m scripts.plan_desarrollo.seguimiento_pdf <informe.pdf> <etiqueta> <carpeta_salida> [dane]

Salidas en <carpeta_salida>:
  fichas_<etiqueta>.csv   una fila por ficha de indicador de producto: dependencia, sector, programa, indicador, meta de
                          producto, proyecto y BPIN, tipo de acumulacion, unidad, LB, meta del cuatrienio, meta
                          programada y avance fisico del anio, narrativa y pagina. Con `dane`, cruza con SisPT.
  resumen_<etiqueta>.csv  filas de las tablas resumen por dependencia (codigo del plan, programado, ejecutado, avance %);
                          solo existen en los informes que las traen.
Los cuadros de avance por dependencia, linea y global van como imagen en el PDF y se transcriben aparte.
"""
import csv
import re
import sys
import unicodedata
from pathlib import Path

import pypdf

PRODUCTOS = Path(__file__).resolve().parents[2] / "insumos/sispt_plan_indicativo/consolidado/productos.csv"
# el informe mezcla "0.75", "0,75" y "100%"; el texto del PDF parte palabras ("Mantenimient" + "o")
NUMTOK = re.compile(r"(?<![\w.,])-?\d+(?:[.,]\d+)?%?(?![\w])")
TIPOS = ("incremento", "mantenimiento", "flujo", "capacidad", "stock", "reduccion")
IND = re.compile(r"INDICADOR DE\s+PRODUCTO")
MARCA = re.compile(r"=====P(\d+)")
DEPENDENCIA = re.compile(r"^\s*((?:SECRETAR[ÍI]A|SUBSECRETAR[ÍI]A|OFICINA|INDER|CONTROL INTERNO)[^\n]*)\n"
                         r"(?:[^\n]*\n){0,3}?\s*Objetivo", re.I)


def sin_tildes(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def norm(s):
    s = re.sub(r"^\d+(\.\d+)+\s*", "", sin_tildes(s).strip())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def compacto(s):
    return re.sub(r"[^a-z0-9]", "", sin_tildes(s))


def limpia(s):
    return re.sub(r"\s+", " ", MARCA.sub(" ", s or "")).strip()


def num(tok):
    t = tok.rstrip("%")
    t = t.replace(",", ".") if "," in t and "." not in t else t.replace(",", "")
    try:
        return float(t)
    except ValueError:
        return None


def paginas(pdf):
    return [(p.extract_text() or "") for p in pypdf.PdfReader(pdf).pages]


def indice(pags):
    """(pagina base 0, titulo) de cada dependencia en el indice impreso; el numero impreso va una pagina adelante."""
    out = []
    for t in pags[:6]:
        for m in re.finditer(r"^\s*(\S[^\n]*?)\s*\.{5,}\s*(\d+)\s*$", t, re.M):
            titulo, pag = limpia(m.group(1)), int(m.group(2))
            if re.match(r"(secretar|subsecretar|oficina|inder|control interno)", titulo, re.I):
                out.append((pag - 1, titulo))
    return sorted(out)


def dependencias(pags):
    """Dependencia vigente en cada pagina: por indice impreso si existe y, si no, por encabezado de seccion."""
    idx = indice(pags)
    dep, actual, k = [], "", 0
    for i, t in enumerate(pags):
        m = DEPENDENCIA.match(t)
        if m:
            actual = limpia(m.group(1))
        while k < len(idx) and idx[k][0] <= i:
            actual = idx[k][1]
            k += 1
        dep.append(actual)
    return dep


def ficha(bloque):
    """(tipo, unidad, lb, meta, programada, avance, anio, fin_fila) o None si la fila no trae los 4 numeros."""
    h = re.search(r"F[ÍI]SICO\s*(\d{4})", bloque)
    anio = h.group(1) if h else ""
    if h:
        ini = h.end()
    else:  # encabezado de tabla ausente: la fila empieza en el tipo de acumulacion
        h = re.search(r"(INCREMENTO|MANTENIMIENTO|FLUJO|CAPACIDAD|STOCK|REDUCCI.N)", bloque, re.I)
        if not h:
            return None
        ini = h.start()
    seg = bloque[ini:ini + 400]
    nums = list(NUMTOK.finditer(MARCA.sub(lambda m: " " * len(m.group()), seg)))
    if len(nums) < 4:
        return None
    n = nums[:4]
    previo = seg[:n[0].start()]
    tipo = next((t for t in TIPOS if compacto(previo).startswith(t[:5])), "")
    lb, meta, prog = (num(x.group()) for x in n[:3])
    av = num(n[3].group())
    if n[3].group().endswith("%") and prog:
        av = av / 100 * prog  # avance dado como % de lo programado
    return tipo, limpia(previo), lb, meta, prog, av, anio, ini + n[3].end()


def fichas(pags, dep):
    texto = "\n".join(f"=====P{i}\n{t}" for i, t in enumerate(pags))
    sector = programa = ""
    pag = 0
    out = []
    for bloque in re.split(r"(?=SECTOR\s+\d)|(?=INDICADOR DE\s+PRODUCTO)", texto):
        inicio_pag = pag
        marcas = MARCA.findall(bloque)
        if marcas:
            pag = int(marcas[-1])
        if bloque.startswith("SECTOR"):
            m = re.match(r"SECTOR\s+(.*?)\n\s*PROGRAMA\s+(.*?)\n", bloque, re.S)
            if m:
                sector, programa = (limpia(g) for g in m.groups())
            k = IND.search(bloque)
            bloque = bloque[k.start():] if k else ""
        if not IND.match(bloque):
            continue
        m = re.match(r"INDICADOR DE\s+PRODUCTO\s*(.*?)\s*META DE\s+PRODUCTO\s*(.*?)(?=NOMBRE Y C[ÓO]DIGO|CARACTER[ÍI]STICAS|TIPO DE|\n\s*\n|$)",
                     bloque, re.S)
        p = re.search(r"NOMBRE Y C[ÓO]DIGO\s*PROYECTO\s*BPI[NM]\s*(.*?)(?=CARACTER[ÍI]STICAS|TIPO DE|$)", bloque, re.S)
        proyecto = limpia(p.group(1)) if p else ""
        bpin = re.search(r"\b(20\d{11})\b", proyecto)
        f = ficha(bloque)
        t, u, lb, meta, prog, av, anio, fin = f if f else ("", "", None, None, None, None, "", m.end())
        narrativa = re.sub(r"\bPROGRAMA\s+\d[\d.]*:?[^\n]*", " ", bloque[fin:])
        out.append({"dependencia": dep[inicio_pag], "sector": sector, "programa": programa,
                    "programa_cod": (re.match(r"\d[\d.]*\d", programa) or [""])[0],
                    "indicador": limpia(m.group(1)), "meta_producto": limpia(m.group(2)),
                    "proyecto": limpia(re.sub(r"\b(Codigo )?(BPIN?:?\s*)?20\d{11}\b", "", proyecto)),
                    "bpin": bpin.group(1) if bpin else "", "acumulacion": t, "unidad": u, "lb": lb,
                    "meta_cuatrienio": meta, "meta_programada": prog, "avance_fisico": av, "anio_ficha": anio,
                    "con_fila_numerica": bool(f), "pagina": inicio_pag + 1, "narrativa": limpia(narrativa)})
    return out


def resumen(pags, dep):
    """Filas de las tablas 'Codigo | Nombre indicador | Nombre meta | Programado | Ejecutado | Avance fisico'.

    Las tablas parten las celdas en varias lineas y continuan en otras paginas sin encabezado, asi que se leen las
    filas por su codigo del plan (cuatro numeros separados por punto, al inicio de linea) y los tres numeros finales."""
    out = []
    fila = re.compile(r"(?m)^(\d+\.\d+\.\d+\.\d+)\s+(.*?)\s+(-?\d[\d.,]*)\s+(-?\d[\d.,]*)\s+(-?\d[\d.,]*)\s*%", re.S)
    for i, t in enumerate(pags):
        for m in fila.finditer(t):
            cod, txt, prog, ejec, av = m.groups()
            out.append({"dependencia": dep[i], "codigo_plan": cod, "texto": limpia(txt), "programado": num(prog),
                        "ejecutado": num(ejec), "avance_pct": num(av), "pagina": i + 1})
    return out


def enlaza(fs, rs):
    """Asigna el codigo del plan a cada ficha: mismo texto de indicador (sin espacios) dentro de la misma dependencia."""
    usados = set()
    for f in fs:
        k = compacto(f["indicador"])
        base = [(j, r) for j, r in enumerate(rs) if j not in usados and r["dependencia"] == f["dependencia"]
                and compacto(r["texto"]).startswith(k)]
        cand = [(j, r) for j, r in base if abs((r["programado"] or 0) - (f["meta_programada"] or 0)) < 1e-6] or base
        f["codigo_plan"] = ""
        if cand:
            j, r = cand[0]
            usados.add(j)
            f["codigo_plan"] = r["codigo_plan"]
            f["programado_resumen"], f["ejecutado_resumen"], f["avance_resumen_pct"] = r["programado"], r["ejecutado"], r["avance_pct"]
    return fs


def cruza_sispt(filas, dane, anio):
    """Cruza por codigo del plan (SisPT lo guarda al inicio de la personalizacion del indicador)."""
    prod = {}
    with open(PRODUCTOS, encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            if r["Código DANE"] == dane:
                cod = re.match(r"(\d+(?:\.\d+)+)\s", r["Personalización de Indicador de Producto"].strip() + " ")
                if cod:
                    prod.setdefault(cod.group(1), r)
    col = f"Programación del producto bien o servicio {anio}"
    for f in filas:
        r = prod.get(f.get("codigo_plan", ""))
        f["codigo_sispt"] = r["Código de indicador de producto (SisPT)"] if r else ""
        f["meta_sispt"] = r["Meta del cuatrienio"] if r else ""
        f["programado_sispt"] = r[col] if r else ""
    return filas


def escribe(ruta, filas):
    cols = list(dict.fromkeys(c for f in filas for c in f))
    with open(ruta, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, cols)
        w.writeheader()
        w.writerows(filas)


if __name__ == "__main__":
    pdf, etiqueta, salida = sys.argv[1:4]
    dane = sys.argv[4] if len(sys.argv) > 4 else ""
    pags = paginas(pdf)
    dep = dependencias(pags)
    fs, rs = fichas(pags, dep), resumen(pags, dep)
    if rs:
        enlaza(fs, rs)
        for f in fs:  # la ficha y la tabla resumen son dos reportes de lo mismo; se marca cuando no coinciden
            if f.get("codigo_plan"):
                f["coincide_resumen"] = (f["meta_programada"] == f["programado_resumen"]
                                         and f["avance_fisico"] == f["ejecutado_resumen"])
    for f in fs:
        f["pct_avance"] = round(100 * f["avance_fisico"] / f["meta_programada"], 1) if f["meta_programada"] and f["avance_fisico"] is not None else ""
    if dane:
        cruza_sispt(fs, dane, re.search(r"\d{4}", etiqueta).group())
    Path(salida).mkdir(parents=True, exist_ok=True)
    escribe(Path(salida) / f"fichas_{etiqueta}.csv", fs)
    if rs:
        escribe(Path(salida) / f"resumen_{etiqueta}.csv", rs)
    print(f"{len(fs)} fichas, {len(rs)} filas de resumen, {sum(1 for f in fs if f.get('codigo_plan'))} fichas con codigo del plan")
