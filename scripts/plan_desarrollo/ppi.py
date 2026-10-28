"""Plan Plurianual de Inversiones: resumen por sector (cap. financiero) y detalle por programa (anexo)."""
import re

from .texto import (MONEY, clave_linea, dinero, filas_tabla, limpia, norm, sin_glitch,
                    sin_letras_sueltas, valores_celdas)


def es_pagina_ppi_sector(md):
    return bool(re.search(r"Línea Estratégica:\s*\d", md) and "Sector de inversión" in md)


def es_pagina_ppi_programa(md):
    """Tabla ancha (>=7 columnas) con varias filas que traen 3+ cifras de dinero."""
    filas = 0
    for t in filas_tabla(md):
        for fila in t:
            if len(fila) >= 7 and len(valores_celdas([limpia(x) for x in fila[3:]])) >= 3:
                filas += 1
    return filas >= 4


def parsea_ppi_sectores(paginas):
    """Cuadro resumen por linea y sector: 4 anios por sector."""
    res = {}
    for n, md in paginas:
        for t in filas_tabla(md):
            for fila in t:
                c = [limpia(x) for x in fila]
                if len(c) < 6:
                    continue
                m = re.match(r"SECTOR\s*(?:\d\.\d:?)?\s*(.+)", c[1], re.I)
                nums = [dinero(x) for x in MONEY.findall(" ".join(c[2:]))]
                if m and len(nums) == 4 and not norm(m.group(1)).startswith("de inversion"):
                    res[norm(m.group(1))] = dict(sector=m.group(1).title(), linea=c[0], anios=nums, pagina=n)
    return res


def parsea_ppi_programas(paginas):
    filas, linea, sector = [], "", ""
    for n, md in paginas:
        for t in filas_tabla(md):
            for fila in t:
                c = [limpia(x) for x in fila]
                if len(c) < 7:
                    continue
                lin = sin_letras_sueltas(c[0])
                if not re.search(r"l.nea\D{0,3}\d", norm(lin)):  # celda de linea cortada: hereda la anterior
                    lin = linea
                sec = sin_glitch(sin_letras_sueltas(c[1])).strip() or sector
                prog = sin_glitch(sin_letras_sueltas(c[2])).rstrip("$ ").strip()
                es_total = bool(re.search(r"\bTotal\b", c[1], re.I))
                sec = re.sub(r"\s*Total\s*$", "", sec, flags=re.I).strip()
                nums = valores_celdas(c[3:])
                if norm(c[1]) == "total" and not prog:  # fila de total de la linea
                    filas.append(dict(pagina=n, linea=linea, sector="", programa="TOTAL LINEA",
                                      anios=nums[:4], estado="total"))
                    continue
                if len(prog) < 6 or norm(prog) == "programa":
                    continue
                linea, sector = lin, sec
                fila_out = dict(pagina=n, linea=lin, sector=sec, programa=prog)
                if es_total and len(nums) == 8:  # programa y total de la linea intercalados
                    fila_out.update(anios=nums[0::2], estado="ok")
                    filas.append(fila_out)
                    filas.append(dict(pagina=n, linea=lin, sector="", programa="TOTAL LINEA",
                                      anios=nums[1::2], estado="total"))
                    continue
                if len(nums) == 3 and not any(nums):  # primera celda vacia: fila de ceros
                    nums = [0, 0, 0, 0]
                fila_out.update(anios=nums, estado="ok" if len(nums) == 4 else "revisar")
                filas.append(fila_out)
    return filas


def valida_sectores(sect, prog):
    """Suma de programas por sector vs el resumen por sector."""
    from difflib import SequenceMatcher
    suma = {}
    for r in prog:
        if r["estado"] != "ok":
            continue
        k = norm(r["sector"])
        suma.setdefault(k, [0, 0, 0, 0])
        for j in range(4):
            suma[k][j] += r["anios"][j]
    val = []
    for k, v in sect.items():
        mejor_k = max(suma, key=lambda x: SequenceMatcher(None, x, k).ratio()) if suma else None
        s = suma.get(mejor_k, [0, 0, 0, 0])
        dif = [v["anios"][j] - s[j] for j in range(4)]
        val.append(dict(sector=v["sector"], resumen=v["anios"], suma_programas=s, diferencia=dif,
                        cuadra=all(abs(x) < 2 for x in dif)))
    return val


def valida_totales_linea(prog):
    """Cada fila TOTAL LINEA del anexo vs la suma de las filas de esa linea."""
    tot = [r for r in prog if r["estado"] == "total"]
    for r in tot:
        suma_l = [0, 0, 0, 0]
        for q in prog:
            if q["estado"] == "ok" and clave_linea(q["linea"]) == clave_linea(r["linea"]):
                for j in range(4):
                    suma_l[j] += q["anios"][j]
        r["suma_filas"] = suma_l
        r["diferencia"] = [r["anios"][j] - suma_l[j] for j in range(4)] if len(r["anios"]) == 4 else None
    return tot
