"""Prototipo: extrae lineas, sectores, programas, indicadores de producto y PPI
de un Plan de Desarrollo Territorial en PDF (probado con Girardota 2024-2027).

Uso:  python extraer_plan.py <plan.pdf> <carpeta_salida>
Requiere: pymupdf4llm<2 (la 2.0 publicada esta vacia).
"""
import json
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

import pymupdf
import pymupdf4llm

MONEY = re.compile(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\d.,])\d{4,}(?![\d.,])|(?<![\d.,])0(?![\d.,])")


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


VOCAB = set()


def repara_ti(txt):
    """El PDF pierde la ligatura 'ti' en algunas fuentes ('Juscia'); se reinserta usando el vocabulario del propio plan."""
    def fix(m):
        w = m.group(0)
        if len(w) < 4 or w.lower() in VOCAB or not VOCAB:
            return w
        for k in range(1, len(w)):
            for ins in ("ti", "titi"):
                c = w[:k] + ins + w[k:]
                if c.lower() in VOCAB:
                    return c
        return w
    return re.sub(r"[A-Za-zÁÉÍÓÚáéíóúñÑ]+", fix, txt)


def limpia(s):
    s = re.sub(r"<br>", " ", s)
    s = re.sub(r"<!--.*?-->", " ", s)
    s = re.sub(r"[*_~]", "", s)
    s = re.sub(r"(?<=[a-zA-Záéíóú])�(?=[a-zA-Záéíóú])", "ti", s)  # ligatura "ti" perdida
    s = s.replace("�", "")
    return repara_ti(re.sub(r"\s+", " ", s).strip())


def dinero(tok):
    # 1.234.567 o 1,234,567 (con decimales opcionales) -> int
    if "," in tok and "." in tok:
        tok = tok.replace(".", "").split(",")[0] if tok.rfind(",") > tok.rfind(".") else tok.replace(",", "").split(".")[0]
    elif tok.count(".") >= 1 and re.fullmatch(r"\d{1,3}(\.\d{3})+", tok):
        tok = tok.replace(".", "")
    elif tok.count(",") >= 1 and re.fullmatch(r"\d{1,3}(,\d{3})+", tok):
        tok = tok.replace(",", "")
    else:
        tok = tok.replace(".", "").replace(",", "")
    return int(tok)


def filas_tabla(md):
    """Devuelve lista de tablas; cada tabla = lista de filas = lista de celdas limpias."""
    tablas, actual = [], []
    for ln in md.splitlines():
        if ln.startswith("|"):
            if re.match(r"^\|[-| ]+\|$", ln):
                continue
            actual.append([c for c in ln.strip().strip("|").split("|")])
        elif actual:
            tablas.append(actual)
            actual = []
    if actual:
        tablas.append(actual)
    return tablas


def convertir(pdf, pages_dir):
    pages_dir.mkdir(parents=True, exist_ok=True)
    d = pymupdf.open(pdf)
    for i in range(len(d)):
        f = pages_dir / f"p{i + 1:03d}.md"
        if f.exists():
            continue
        try:
            md = pymupdf4llm.to_markdown(d, pages=[i], use_ocr=False, show_progress=False)
        except Exception as e:  # pagina problematica: se deja marcada
            md = f"ERROR {e}"
        f.write_text(md, encoding="utf8")
    return len(d)


# ---------------------------------------------------------------- estructura
RE_LINEA = re.compile(r"^L[ií�]nea estrat[eé�]gica\s*(\d)", re.I)
RE_SECTOR = re.compile(r"^Sector\s+(?!es\b)(.+)$", re.I)
RE_PROG = re.compile(r"^Programa\s+(.+)$", re.I)
RE_CAPT = re.compile(r"Indicadores de producto programa\s+(.+?)\.?\s*Fuente", re.I)


def recorre_estructura(paginas):
    """Itera paginas del capitulo 2 y emite eventos (pagina, tipo, valor)."""
    ev = []
    for n, md in paginas:
        for ln in md.splitlines():
            s = limpia(ln.lstrip("# "))
            if len(s) > 200 or ln.startswith("|"):
                continue
            m = RE_LINEA.match(s)
            if m:
                ev.append((n, "linea", int(m.group(1)), s))
                continue
            m = RE_SECTOR.match(s)
            if m and len(s) < 90:
                ev.append((n, "sector", m.group(1).strip(), s))
                continue
            m = RE_PROG.match(s)
            if m:
                ev.append((n, "programa", m.group(1).strip(), s))
                continue
            m = RE_CAPT.search(s)
            if m:
                ev.append((n, "caption", m.group(1).strip(), s))
        for t in filas_tabla(md):
            ev.append((n, "tabla", t, ""))
    return ev


def es_tabla_indicadores(t):
    cab = norm(" ".join(limpia(c) for c in t[0]))
    return "nombre" in cab and "meta" in cab and ("unidad" in cab or "linea base" in cab)


def parsea_indicadores(t):
    out = []
    for fila in t[1:]:
        c = [limpia(x) for x in fila]
        if not any(c):
            continue
        # variante sin "tipo de acumulado": 5 columnas
        if len(c) >= 6:
            nombre, unidad, base, meta, tipo, resp = c[:6]
        elif len(c) == 5:
            nombre, unidad, base, meta, resp = c
            tipo = ""
        else:
            continue
        if not nombre or norm(nombre).startswith("nombre"):
            continue
        out.append(dict(nombre=nombre, unidad=unidad, linea_base=base, meta=meta,
                        tipo_acumulado=tipo, responsable=resp))
    return out


# ------------------------------------------------------------------- PPI
def parsea_ppi_sectores(paginas):
    """Cuadro resumen por linea y sector (Cap. 3): 4 anios por sector."""
    res = {}
    for n, md in paginas:
        for t in filas_tabla(md):
            for fila in t:
                c = [limpia(x) for x in fila]
                if len(c) < 6:
                    continue
                m = re.match(r"SECTOR\s*(?:\d\.\d:?)?\s*(.+)", c[1], re.I)
                nums = [dinero(x) for x in (MONEY.findall(" ".join(c[2:])))]
                if m and len(nums) == 4 and not norm(m.group(1)).startswith("de inversion"):
                    res[norm(m.group(1))] = dict(sector=m.group(1).title(), linea=c[0], anios=nums, pagina=n)
    return res




def sin_glitch(txt):
    # texto vertical del encabezado: 'N o m b r e' o '2 0 2 4' (3+ simbolos sueltos seguidos)
    return re.sub(r"(?:(?<!\S)\S(?!\S) ?){3,}", "", txt)


def sin_letras_sueltas(txt):
    """Quita encabezados verticales ('N o m b r e d e l s e c t o r X') pegados al valor."""
    return re.sub(r"^(?:[A-Za-z] )+", "", txt).strip()


def valores_celdas(celdas):
    """Una cifra por token; un '-' suelto cuenta como 0 (si no, se corren las columnas)."""
    out = []
    for x in celdas:
        x = sin_glitch(x)
        for m in re.finditer(MONEY.pattern + r"|(?<!\S)-(?!\S)", x):
            out.append(0 if m.group(0) == "-" else dinero(m.group(0)))
    return out


def clave_linea(txt):
    m = re.search(r"l.nea\D{0,3}(\d)", norm(txt))
    return m.group(1) if m else norm(txt)


def parsea_ppi_programas(paginas):
    filas, linea, sector = [], "", ""
    for n, md in paginas:
        for t in filas_tabla(md):
            for fila in t:
                c = [limpia(x) for x in fila]
                if len(c) < 7:
                    continue
                lin = sin_letras_sueltas(c[0])
                if not re.search(r"l.nea\D{0,3}\d", norm(lin)):  # celda de linea cortada ("CIUDADANO"): hereda la anterior
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


def mejor(nombre, canon):
    n = norm(nombre)
    sc = [(SequenceMatcher(None, n, norm(c)).ratio(), c) for c in canon]
    return max(sc) if sc else (0, None)


def main(pdf, salida):
    salida = Path(salida)
    pages_dir = salida / "paginas_md"
    total = convertir(pdf, pages_dir)
    pag = [(i, (pages_dir / f"p{i:03d}.md").read_text(encoding="utf8")) for i in range(1, total + 1)]
    for w in re.findall(r"[A-Za-záéíóúñÁÉÍÓÚÑ]{4,}", " ".join(md for _, md in pag)):
        VOCAB.add(w.lower())

    p_sec = [(n, md) for n, md in pag if re.search(r"Línea Estratégica:\s*\d", md) and "Sector de inversión" in md]
    p_anexo = [(n, md) for n, md in pag if n > total - 8 and md.count("|") > 20]
    p_cap2 = [(n, md) for n, md in pag if 70 <= n <= 245]

    sect = parsea_ppi_sectores(p_sec)
    prog = parsea_ppi_programas(p_anexo)

    # programas canonicos (nombre + sector segun el PPI)
    canon = {}
    for r in prog:
        if r["estado"] == "total":
            continue
        canon.setdefault(r["programa"], r["sector"])
    nombres = list(canon)

    # ---- paginas que son imagen: se usa la version con OCR si existe
    ocr_dir = salida / "paginas_ocr"
    if ocr_dir.exists():
        for k, (n, md) in enumerate(pag):
            f = ocr_dir / f"p{n:03d}.md"
            if f.exists():
                o = f.read_text(encoding="utf8")
                if not o.startswith("ERROR") and o.count("\n|") > md.count("\n|"):
                    pag[k] = (n, o)
        p_cap2 = [(n, md) for n, md in pag if 70 <= n <= 245]

    # ---- indicadores: cada tabla se asigna al pie "Indicadores de producto programa X"
    ev = recorre_estructura(p_cap2)
    linea, sector, programa, caption = None, None, None, None
    tablas, captions = [], []
    for n, tipo, val, raw in ev:
        if tipo == "linea":
            linea = val
        elif tipo == "sector":
            sector = val
        elif tipo == "programa":
            programa = val
        elif tipo == "caption":
            captions.append(val)
            caption = val
        elif tipo == "tabla" and es_tabla_indicadores(val):
            tablas.append(dict(n=n, linea=linea, sector=sector, cand=programa or caption, ind=parsea_indicadores(val)))
    por_orden = len(tablas) == len(captions)
    indicadores = []
    for k, t in enumerate(tablas):
        cand = captions[k] if por_orden else t["cand"]
        sc, nombre_pp = mejor(cand, nombres) if cand else (0, None)
        for ind in t["ind"]:
            ind.update(linea=t["linea"], sector=(canon[nombre_pp] if sc >= 0.75 else t["sector"]),
                       programa=(nombre_pp if sc >= 0.75 else cand),
                       coincidencia_ppi=round(sc, 2), pagina=t["n"])
            indicadores.append(ind)
    # ---- complemento: tablas que son imagen pura, transcritas con vision (revisadas a ojo)
    vis = salida / "indicadores_vision.json"
    if vis.exists():
        ya = {i["programa"] for i in indicadores}
        linea_de = {r["programa"]: r["linea"] for r in prog}
        for v in json.loads(vis.read_text(encoding="utf8")):
            sc, nombre_pp = mejor(v["programa"], nombres)
            if nombre_pp in ya:
                continue
            v.update(programa=nombre_pp if sc >= 0.75 else v["programa"],
                     sector=canon.get(nombre_pp), linea=linea_de.get(nombre_pp), coincidencia_ppi=round(sc, 2))
            indicadores.append(v)

    print(f"tablas de indicadores: {len(tablas)} | pies de tabla: {len(captions)} | asignacion por orden: {por_orden}")

    # ---- validacion: suma de programas por sector vs resumen del Cap. 3
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

    for nombre, obj in [("indicadores", indicadores), ("ppi_sectores", sect),
                        ("ppi_programas", prog), ("validacion_ppi", val)]:
        (salida / f"{nombre}.json").write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf8")

    tot = [r for r in prog if r["estado"] == "total"]
    for r in tot:
        suma_l = [0, 0, 0, 0]
        for q in prog:
            if q["estado"] == "ok" and clave_linea(q["linea"]) == clave_linea(r["linea"]):
                for j in range(4):
                    suma_l[j] += q["anios"][j]
        r["suma_filas"] = suma_l
        r["diferencia"] = [r["anios"][j] - suma_l[j] for j in range(4)] if len(r["anios"]) == 4 else None
    ok = sum(v["cuadra"] for v in val)
    rev = [r for r in prog if r["estado"] == "revisar"]
    prog_con_ind = {i["programa"] for i in indicadores}
    sin_ind = [p for p in nombres if p not in prog_con_ind]
    bajos = [i for i in indicadores if i["coincidencia_ppi"] < 0.75]
    lineas = [
        "# Reporte de extraccion",
        f"- Indicadores de producto: {len(indicadores)} (sin cruce claro con el PPI: {len(bajos)})",
        f"- Programas en el PPI: {len(nombres)}; con indicadores: {len(nombres) - len(sin_ind)}",
        f"- Sectores del resumen PPI: {len(sect)}; cuadran con la suma de programas: {ok}",
        f"- Filas del Anexo I a revisar a mano: {len(rev)}",
        "", "## Programas del PPI sin indicadores extraidos"] + [f"- {p} ({canon[p]})" for p in sin_ind]
    lineas += ["", "## Sectores que no cuadran"] + [
        f"- {v['sector']}: diferencia {v['diferencia']}" for v in val if not v["cuadra"]]
    lineas += ["", "## Totales de linea del propio Anexo vs suma de sus filas"] + [
        f"- {r['linea'][:45]} (p{r['pagina']}): diferencia {r['diferencia']}" for r in tot]
    g_anexo = [sum(r["anios"][j] for r in tot if len(r["anios"]) == 4) for j in range(4)]
    g_cap3 = [sum(v["resumen"][j] for v in val) for j in range(4)]
    lineas += ["", "## Anexo I vs resumen del Cap. 3 (inconsistencia de la fuente)",
               f"- Suma de totales de linea del Anexo: {g_anexo}",
               f"- Suma de sectores del resumen Cap. 3: {g_cap3}",
               f"- Diferencia: {[g_cap3[j] - g_anexo[j] for j in range(4)]}"]
    lineas += ["", "## Filas a revisar"] + [f"- p{r['pagina']} {r['sector']} / {r['programa']}: {r['anios']}" for r in rev]
    (salida / "reporte.md").write_text("\n".join(lineas), encoding="utf8")
    print("\n".join(lineas[:6]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
