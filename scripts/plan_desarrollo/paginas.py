"""Conversion del PDF a markdown por pagina (con cache) y deteccion de paginas-imagen."""
import pymupdf
import pymupdf4llm


def _convierte(doc, i, ocr):
    try:
        return pymupdf4llm.to_markdown(doc, pages=[i], use_ocr=ocr, show_progress=False)
    except Exception as e:  # pagina problematica: se deja marcada
        return f"ERROR {e}"


def convertir(pdf, pages_dir):
    """Una pagina por archivo pNNN.md; las ya convertidas no se repiten."""
    pages_dir.mkdir(parents=True, exist_ok=True)
    d = pymupdf.open(pdf)
    for i in range(len(d)):
        f = pages_dir / f"p{i + 1:03d}.md"
        if not f.exists():
            f.write_text(_convierte(d, i, False), encoding="utf8")
    return len(d)


def convertir_ocr(pdf, numeros, ocr_dir):
    """Reconvierte con OCR las paginas indicadas (1-based)."""
    ocr_dir.mkdir(parents=True, exist_ok=True)
    d = pymupdf.open(pdf)
    for n in numeros:
        f = ocr_dir / f"p{n:03d}.md"
        if not f.exists():
            f.write_text(_convierte(d, n - 1, True), encoding="utf8")


def cargar(pages_dir, total):
    return [(i, (pages_dir / f"p{i:03d}.md").read_text(encoding="utf8")) for i in range(1, total + 1)]


def aplicar_ocr(pag, ocr_dir, rango):
    """Sustituye, dentro del rango, las paginas cuya version OCR trae mas filas de tabla."""
    if not ocr_dir.exists():
        return pag
    out = []
    for n, md in pag:
        f = ocr_dir / f"p{n:03d}.md"
        if rango[0] <= n <= rango[1] and f.exists():
            o = f.read_text(encoding="utf8")
            if not o.startswith("ERROR") and o.count("\n|") > md.count("\n|"):
                md = o
        out.append((n, md))
    return out


def cobertura_imagen(pdf, numeros):
    """Por pagina: fraccion cubierta por imagenes y numero de palabras de texto real."""
    d = pymupdf.open(pdf)
    info = {}
    for n in numeros:
        p = d[n - 1]
        area = p.rect.width * p.rect.height
        cub = sum(max(0, (b["bbox"][2] - b["bbox"][0]) * (b["bbox"][3] - b["bbox"][1]))
                  for b in p.get_image_info())
        info[n] = dict(cobertura=min(1.0, cub / area) if area else 0, palabras=len(p.get_text().split()))
    return info


def renderizar(pdf, numeros, carpeta, dpi=130):
    carpeta.mkdir(parents=True, exist_ok=True)
    d = pymupdf.open(pdf)
    rutas = {}
    for n in numeros:
        f = carpeta / f"p{n:03d}.png"
        if not f.exists():
            d[n - 1].get_pixmap(dpi=dpi).save(f)
        rutas[n] = f
    return rutas


def fraccion_con_texto(pdf, muestra=40):
    """Fraccion de paginas (de una muestra repartida) con capa de texto. Un PDF escaneado da ~0."""
    d = pymupdf.open(pdf)
    paso = max(1, len(d) // muestra)
    paginas = range(0, len(d), paso)
    return sum(len(d[i].get_text()) > 200 for i in paginas) / len(paginas)
