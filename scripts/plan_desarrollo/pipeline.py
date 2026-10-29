"""Orquesta la extraccion completa de un plan: paginas -> estructura -> PPI -> cruce -> validacion -> reporte."""
import json
from pathlib import Path

from . import conocimiento, paginas, vision
from .estructura import es_tabla_indicadores, tablas_de_indicadores
from .ppi import (es_pagina_ppi_programa, es_pagina_ppi_sector, parsea_ppi_programas,
                  parsea_ppi_sectores, valida_sectores, valida_totales_linea)
from .ppi_tablas import bloques_inversion, tablas_ppi
from .texto import construir_vocab, filas_tabla, limpia, mejor, norm

UMBRAL = 0.75
MARGEN_INICIO = 5
UMBRAL_TEXTO = 0.3  # bajo esta fraccion de paginas con texto el PDF se considera escaneado y se omite


def cargar_config(salida):
    f = salida / "config.json"
    return json.loads(f.read_text(encoding="utf8")) if f.exists() else {}


def detecta_rangos(pag, cfg):
    """Rangos de paginas por contenido; config.json puede fijarlos (paginas_cap2, paginas_anexo)."""
    total = len(pag)
    p_sec = [(n, md) for n, md in pag if es_pagina_ppi_sector(md)]
    if "paginas_anexo" in cfg:
        a, b = cfg["paginas_anexo"]
        p_anexo = [(n, md) for n, md in pag if a <= n <= b]
    else:
        p_anexo = _corridas_anexo(pag, total)
    if "paginas_cap2" in cfg:
        cap2 = tuple(cfg["paginas_cap2"])
    else:
        con_ind = [n for n, md in pag if "Indicadores de producto programa" in md
                   or any(es_tabla_indicadores(t) for t in _tablas(md))]
        ini = max(1, min(con_ind) - MARGEN_INICIO) if con_ind else 1  # antes de la 1a tabla puede haber tablas-imagen
        fin = (min(n for n, _ in p_sec) - 1) if p_sec else (max(con_ind) if con_ind else total)
        cap2 = (ini, max(fin, ini))
    return p_sec, p_anexo, cap2


def _tiene_cabecera_anexo(md):
    for t in _tablas(md):
        k = norm(" ".join(limpia(c) for fila in t[:2] for c in fila)).replace(" ", "")  # el encabezado vertical sale letra a letra
        if "linea" in k and "sector" in k and "programa" in k:
            return True
    return False


def _corridas_anexo(pag, total):
    """Paginas de PPI por programa: corridas contiguas cuya primera pagina trae el encabezado linea/sector/programa."""
    cand = [n for n, md in pag if n > total * 0.5 and es_pagina_ppi_programa(md)]
    texto = dict(pag)
    out, corrida = [], []
    for n in cand + [None]:
        if corrida and (n is None or n != corrida[-1] + 1):
            if _tiene_cabecera_anexo(texto[corrida[0]]):
                out += [(k, texto[k]) for k in corrida]
            corrida = []
        if n is not None:
            corrida.append(n)
    return out


def _tablas(md):
    return [t for t in filas_tabla(md) if t]


def canon_desde_arbol(bloques):
    """Cuando el plan no trae el anexo de Girardota, los nombres del PPI salen de la jerarquia inferida.

    Se admiten todos los niveles bajo la raiz: lo que un plan llama "programa" en sus indicadores puede ser
    un sector o un subprograma en su PPI (Envigado).
    """
    canon, lineas = {}, {}
    for b in bloques:
        if sum(r["con_hijos"] for r in b["registros"]) == 0:
            continue
        for r in b["registros"]:
            ruta = r["ruta"]
            sector = r["etiqueta"] if r["nivel"] == "sector" else ruta.get("sector")
            canon.setdefault(r["etiqueta"], sector)
            lineas.setdefault(r["etiqueta"], ruta.get("linea") or ruta.get("dimension"))
    return canon, lineas


def canon_programas(prog):
    canon = {}
    for r in prog:
        if r["estado"] != "total":
            canon.setdefault(r["programa"], r["sector"])
    return canon


def procesar(pdf, salida, usar_vision_api=False):
    fraccion = paginas.fraccion_con_texto(pdf)
    if fraccion < UMBRAL_TEXTO:
        raise SystemExit(f"{Path(pdf).name}: PDF escaneado ({fraccion:.0%} de paginas con texto). Se omite: el OCR "
                         "completo es caro y su calidad no esta asegurada. Pedir una version con texto.")
    salida = Path(salida)
    salida.mkdir(parents=True, exist_ok=True)
    cfg = cargar_config(salida)
    pages_dir = salida / "paginas_md"
    total = paginas.convertir(pdf, pages_dir)
    pag = paginas.cargar(pages_dir, total)
    construir_vocab(md for _, md in pag)

    p_sec, p_anexo, cap2 = detecta_rangos(pag, cfg)
    pag = paginas.aplicar_ocr(pag, salida / "paginas_ocr", cap2)
    p_cap2 = [(n, md) for n, md in pag if cap2[0] <= n <= cap2[1]]

    sect = parsea_ppi_sectores(p_sec)
    prog = parsea_ppi_programas(p_anexo)
    canon = canon_programas(prog)
    ppi_t = tablas_ppi(pag)
    bloques = bloques_inversion(ppi_t)
    linea_arbol = {}
    if not canon:
        canon, linea_arbol = canon_desde_arbol(bloques)
    nombres = list(canon)
    alias = conocimiento.cargar()

    # ---- indicadores leidos del texto: cada tabla se asigna al pie "Indicadores de producto programa X"
    tablas, captions = tablas_de_indicadores(p_cap2)
    producto = [t for t in tablas if t["tipo"] == "producto"]
    resultado = [dict(i, pagina=t["n"], linea=t["linea"], sector=t["sector"]) for t in tablas
                 if t["tipo"] == "resultado" for i in t["ind"]]
    por_orden = bool(canon) and len(producto) == len(captions)
    indicadores = []
    for k, t in enumerate(producto):
        cand = captions[k] if por_orden else t["cand"]
        for ind in t["ind"]:
            cand_i = ind.get("programa") or cand or ind.get("programa_sub")
            if canon and cand_i:
                sc, nombre_pp = conocimiento.resuelve("programa", cand_i, nombres, UMBRAL, alias)
            else:
                sc, nombre_pp = 0, None
            ind.update(linea=(linea_arbol.get(nombre_pp) if nombre_pp else None) or t["linea"],
                       sector=canon[nombre_pp] if nombre_pp and canon[nombre_pp] else (ind.get("sector") or t["sector"]),
                       programa=nombre_pp or cand_i, coincidencia_ppi=round(sc, 2) if canon else None,
                       pagina=t["n"], fuente_lectura="texto", formato=t.get("formato"))
            indicadores.append(ind)

    # ---- tablas-imagen: lectura revisada a mano (indicadores_vision.json) y lectura por API (vision_api/)
    con_tabla = {t["n"] for t in tablas if t["ind"]}
    nums = range(cap2[0], cap2[1] + 1)
    pend = vision.candidatas(pdf, nums, con_tabla)
    if usar_vision_api:
        rutas = paginas.renderizar(pdf, pend, salida / "vision_pendientes")
        vision.leer(rutas, salida, nombres)
    linea_de = {r["programa"]: r["linea"] for r in prog}
    manual = salida / "indicadores_vision.json"
    desde_vision = (json.loads(manual.read_text(encoding="utf8")) if manual.exists() else []) \
        + vision.cargar_leidas(salida)
    ya = {i["programa"] for i in indicadores}
    for v in desde_vision:
        sc, nombre_pp = conocimiento.resuelve("programa", v["programa"], nombres, UMBRAL, alias)
        if nombre_pp in ya or (nombre_pp is None and v["programa"] in ya):
            continue
        if nombre_pp is None:  # sin cruce claro: si se parece mucho a un programa ya leido, es duplicado
            sc2, cerca = mejor(v["programa"], list(ya))
            if sc2 >= 0.5:
                continue
        v.update(programa=nombre_pp or v["programa"], sector=canon.get(nombre_pp),
                 linea=linea_de.get(nombre_pp), coincidencia_ppi=round(sc, 2))
        v.setdefault("fuente_lectura", "vision")
        indicadores.append(v)
    ya_vision = {i["pagina"] for i in indicadores if str(i.get("fuente_lectura", "")).startswith("vision")}

    # ---- sectores: todos los nombres se llevan al nombre del PPI (alias aprendido o similitud)
    sectores_ppi = sorted({s for s in canon.values() if s})
    for i in indicadores:
        if i.get("sector"):
            if sectores_ppi:
                _, s = conocimiento.resuelve("sector", i["sector"], sectores_ppi, 0.8, alias)
                i["sector"] = s or i["sector"]

    val = valida_sectores(sect, prog)
    tot = valida_totales_linea(prog)

    for nombre, obj in [("indicadores_resultado", resultado), ("ppi_tablas", ppi_t), ("ppi_arbol", bloques), ("indicadores", indicadores), ("ppi_sectores", sect),
                        ("ppi_programas", prog), ("validacion_ppi", val)]:
        (salida / f"{nombre}.json").write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf8")

    pend_sin_leer = [n for n in pend if n not in ya_vision]
    resumen = reporte(salida, indicadores, nombres, canon, sect, prog, val, tot, pend_sin_leer, cap2,
                      (tablas, captions, por_orden))
    cola_revision(salida, indicadores, prog, val, nombres, canon)
    return resumen


def reporte(salida, indicadores, nombres, canon, sect, prog, val, tot, pend, cap2, info):
    tablas, captions, por_orden = info
    ok = sum(v["cuadra"] for v in val)
    rev = [r for r in prog if r["estado"] == "revisar"]
    con_ind = {i["programa"] for i in indicadores}
    sin_ind = [p for p in nombres if p not in con_ind]
    bajos = [i for i in indicadores if i["coincidencia_ppi"] is not None and i["coincidencia_ppi"] < UMBRAL]
    por_fuente = {}
    for i in indicadores:
        por_fuente[i.get("fuente_lectura", "?")] = por_fuente.get(i.get("fuente_lectura", "?"), 0) + 1
    L = ["# Reporte de extraccion",
         f"- Capitulo estrategico detectado: paginas {cap2[0]}-{cap2[1]}",
         f"- Indicadores de producto: {len(indicadores)} {por_fuente} (sin cruce claro con el PPI: {len(bajos)})",
         f"- Programas en el PPI: {len(nombres)}; con indicadores: {len(nombres) - len(sin_ind)}",
         f"- Sectores del resumen PPI: {len(sect)}; cuadran con la suma de programas: {ok}",
         f"- Filas del Anexo a revisar a mano: {len(rev)}",
         f"- Paginas-imagen candidatas sin leer: {len(pend)} {pend}",
         "", "## Programas del PPI sin indicadores extraidos"] + [f"- {p} ({canon[p]})" for p in sin_ind]
    L += ["", "## Sectores que no cuadran"] + [
        f"- {v['sector']}: diferencia {v['diferencia']}" for v in val if not v["cuadra"]]
    L += ["", "## Totales de linea del propio Anexo vs suma de sus filas"] + [
        f"- {r['linea'][:45]} (p{r['pagina']}): diferencia {r['diferencia']}" for r in tot]
    g_anexo = [sum(r["anios"][j] for r in tot if len(r["anios"]) == 4) for j in range(4)]
    g_cap3 = [sum(v["resumen"][j] for v in val) for j in range(4)]
    L += ["", "## Anexo vs resumen por sector (inconsistencia de la fuente, si existe)",
          f"- Suma de totales de linea del Anexo: {g_anexo}",
          f"- Suma de sectores del resumen: {g_cap3}",
          f"- Diferencia: {[g_cap3[j] - g_anexo[j] for j in range(4)]}"]
    L += ["", "## Filas a revisar"] + [f"- p{r['pagina']} {r['sector']} / {r['programa']}: {r['anios']}" for r in rev]
    (salida / "reporte.md").write_text("\n".join(L), encoding="utf8")
    return "\n".join(L[:8])


def cola_revision(salida, indicadores, prog, val, nombres, canon):
    """Lista de lo dudoso. Cada item admite una `correccion`; `aprender` convierte alias en conocimiento."""
    items, sin_cruce = [], set()
    for i in indicadores:
        if i["coincidencia_ppi"] is not None and i["coincidencia_ppi"] < UMBRAL and i["programa"] not in sin_cruce:
            sin_cruce.add(i["programa"])
            items.append(dict(tipo="programa_sin_cruce", pagina=i.get("pagina"), valor=i["programa"],
                              sugerencia=None, correccion=None))
    vistos = set()
    for i in indicadores:
        if i.get("fuente_lectura") == "vision-api" and i["programa"] not in vistos:
            vistos.add(i["programa"])
            items.append(dict(tipo="vision_sin_revisar", pagina=i.get("pagina"), valor=i["programa"], correccion=None))
    for r in prog:
        if r["estado"] == "revisar":
            items.append(dict(tipo="ppi_fila", pagina=r["pagina"], valor=f"{r['sector']} / {r['programa']}",
                              anios=r["anios"], correccion=None))
    for v in val:
        if not v["cuadra"]:
            items.append(dict(tipo="sector_no_cuadra", valor=v["sector"], diferencia=v["diferencia"], correccion=None))
    con_ind = {i["programa"] for i in indicadores}
    for p in nombres:
        if p not in con_ind:
            items.append(dict(tipo="programa_sin_indicadores", valor=p, sector=canon[p], correccion=None))
    for k, it in enumerate(items, 1):
        it["id"] = k
    (salida / "revision.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf8")
    return items


def aprender(salida):
    """Aplica las correcciones escritas en revision.json: {"alias": {"tipo": "programa"|"sector", "canonico": "..."}}."""
    f = Path(salida) / "revision.json"
    n = 0
    for it in json.loads(f.read_text(encoding="utf8")):
        c = it.get("correccion")
        if c and "alias" in c:
            conocimiento.agregar(c["alias"]["tipo"], it["valor"], c["alias"]["canonico"])
            n += 1
    return n
