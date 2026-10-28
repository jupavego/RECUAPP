"""PPI generico: cualquier tabla con columnas 2024-2027, sin asumir el formato de un municipio.

Dos ideas que sustituyen a las reglas fijas por plan:
- Las columnas (cada anio y el total) se reconocen por el texto del encabezado, no por su orden.
- La jerarquia (linea -> sector -> programa...) se infiere de las SUMAS: una fila es padre de las filas
  siguientes cuando estas suman su valor. Asi funciona aunque el plan solo ponga todo en una lista plana.
"""
import re

from .texto import filas_tabla, limpia, norm, valores_celdas

ANIOS = ("2024", "2025", "2026", "2027")
FINANCIERO = re.compile(r"ingreso|gasto|funcionamiento|deuda|sgp|recursos? propios|icld|regal|credito|superavit|"
                        r"transferencia|fuente|tributari|asignaci|estampilla|sobretasa|contribucion|multas|compensacion|"
                        r"alumbrado|impuesto|rendimiento|etesa|coljuegos|fondo|excedente|cofinanc|convenio", re.I)
NIVELES_PALABRA = [("dimension", "dimension"), ("linea", "linea"), ("eje", "eje"), ("pilar", "pilar"),
                   ("reto", "reto"), ("sector", "sector"), ("programa", "programa")]
NIVELES_DEFECTO = ["linea", "sector", "programa", "subprograma"]


def columnas_anios(cab):
    """{'2024': j, ..., 'total': j} leyendo el encabezado; None si no estan los cuatro anios."""
    cols = {}
    for j, c in enumerate(cab):
        k = norm(limpia(c)).replace(" ", "")
        if re.search(r"cuatrienio|20242027", k):
            cols.setdefault("total", j)
            continue
        m = re.search(r"(2024|2025|2026|2027)", k)
        if m:
            cols.setdefault(m.group(1), j)
        elif "total" in k:
            cols.setdefault("total", j)
    return cols if all(a in cols for a in ANIOS) else None


def _valor(celda):
    """Monto de una celda: admite cifras chicas sin separador de miles (tablas en millones) y '-' como 0."""
    c = celda.replace("$", "").strip()
    if re.fullmatch(r"\d{1,3}", c):
        return int(c)
    v = valores_celdas([celda])
    return v[0] if v else None


def lee_tabla(t, previa=None):
    """(cabecera, filas, columnas) o None si no es una tabla anual de montos.

    `previa` = (columnas, n_columnas) de la tabla anterior: una tabla que sigue en la pagina siguiente suele
    venir sin encabezado y se lee con las mismas columnas.
    """
    for hi in (0, 1):
        if hi >= len(t):
            return None
        cab = [limpia(x) for x in t[hi]]
        if "indicador" in norm(" ".join(cab)):
            return None
        cols = columnas_anios(cab)
        if cols:
            break
    else:
        if not previa or len(t[0]) != previa[1]:
            return None
        cols, hi, cab = previa[0], -1, [""] * previa[1]
    filas = []
    for f in t[hi + 1:]:
        c = [limpia(x) for x in f]
        if len(c) < len(cab):
            c = [""] * (len(cab) - len(c)) + c
        anios = [_valor(c[cols[a]]) if cols[a] < len(c) else None for a in ANIOS]
        etiqueta = c[0]
        if etiqueta and None not in anios:
            total = _valor(c[cols["total"]]) if "total" in cols and cols["total"] < len(c) else None
            filas.append(dict(etiqueta=etiqueta, anios=anios, total=total if total is not None else sum(anios)))
    return (cab, filas, cols) if len(filas) >= 2 else None


def tablas_ppi(paginas):
    """Tablas anuales de montos tal cual, con su nivel inferido del encabezado."""
    out, previa, ult = [], None, None
    for n, md in paginas:
        unidad = "millones" if re.search(r"millones", md[:3000], re.I) else "pesos"
        for t in filas_tabla(md):
            r = lee_tabla(t, previa if ult is not None and n - ult <= 1 else None) if t else None
            if r:
                cab, filas, cols = r
                previa, ult = (cols, len(t[0])), n
                out.append(dict(pagina=n, cabecera=cab[0], unidad=unidad, filas=filas, ncols=len(t[0]),
                                financiero=sum(bool(FINANCIERO.search(f["etiqueta"])) for f in filas) >= len(filas) * 0.3))
    return out


# ---------------------------------------------------------------- jerarquia por sumas
def _cuadra(total, suma, n_hijos):
    return abs(total - suma) <= max(n_hijos + 1, total * 0.0005)


def arbol(filas):
    """Convierte la lista plana en [(profundidad, fila, cuadra_con_hijos)] segun las sumas."""
    n = len(filas)
    memo = {}

    def nodo(i):
        if i in memo:
            return memo[i]
        f = filas[i]
        hijos, j, acc = [], i + 1, 0
        while j < n and f["total"] > 0 and acc < f["total"] and not _cuadra(f["total"], acc, len(hijos)):
            h, j2 = nodo(j)
            hijos.append(h)
            acc += h["fila"]["total"]
            j = j2
        if hijos and _cuadra(f["total"], acc, len(hijos)):
            res = (dict(fila=f, hijos=hijos), j)
        else:
            res = (dict(fila=f, hijos=[]), i + 1)
        memo[i] = res
        return res

    raices, i = [], 0
    while i < n:
        r, i = nodo(i)
        raices.append(r)
    out = []

    def recorre(x, d):
        out.append((d, x["fila"], bool(x["hijos"])))
        for h in x["hijos"]:
            recorre(h, d + 1)

    for r in raices:
        recorre(r, 0)
    return out


def niveles_de(cabecera):
    """Nombres de nivel segun el encabezado ('Dimensiones, lineas y programas' -> dimension, linea, programa)."""
    k = norm(cabecera)
    hallados = sorted((k.find(p), nivel) for p, nivel in NIVELES_PALABRA if p in k)
    nombres = [n for _, n in hallados]
    return nombres if len(nombres) >= 2 else NIVELES_DEFECTO


def _palabras_nivel(cabecera):
    k = norm(cabecera)
    return [n for p, n in NIVELES_PALABRA if p in k]


def _mismos_niveles(a, b):
    """Dos encabezados que nombran niveles distintos (lineas vs dimensiones+lineas+programas) son tablas distintas."""
    pa, pb = _palabras_nivel(a), _palabras_nivel(b)
    return not pa or not pb or pa == pb


def bloques_inversion(tablas):
    """Une tablas consecutivas de inversion (misma estructura en paginas seguidas) y les infiere la jerarquia."""
    bloques, actual = [], None
    for t in tablas:
        if t["financiero"]:
            actual = None
            continue
        if (actual and t["pagina"] - actual["paginas"][-1] <= 1 and t["unidad"] == actual["unidad"]
                and t["ncols"] == actual["ncols"] and _mismos_niveles(t["cabecera"], actual["cabecera"])):
            actual["filas"] += t["filas"]
            actual["paginas"].append(t["pagina"])
        else:
            actual = dict(paginas=[t["pagina"]], cabecera=t["cabecera"], unidad=t["unidad"],
                          ncols=t["ncols"], filas=list(t["filas"]))
            bloques.append(actual)
    out = []
    for b in bloques:
        niveles = niveles_de(b["cabecera"])
        ruta, registros = {}, []
        for d, f, tiene_hijos in arbol(b["filas"]):
            nivel = niveles[min(d, len(niveles) - 1)]
            ruta = {k: v for k, v in ruta.items() if niveles.index(k) < d} if d else {}
            ruta[nivel] = f["etiqueta"]
            registros.append(dict(nivel=nivel, profundidad=d, etiqueta=f["etiqueta"], anios=f["anios"], total=f["total"],
                                  ruta=dict(ruta), con_hijos=tiene_hijos))
        raiz = [r for r in registros if r["profundidad"] == 0]
        out.append(dict(paginas=b["paginas"], cabecera=b["cabecera"], unidad=b["unidad"], niveles=niveles,
                        total_raices=[sum(r["anios"][j] for r in raiz) for j in range(4)],
                        registros=registros))
    return out
