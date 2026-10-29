"""CLI:  python -m plan_desarrollo <comando> ...   (ejecutar desde la carpeta scripts/)."""
import argparse
import json
from pathlib import Path

from . import categorias, conocimiento, evaluar, muestra, paginas, pipeline, vision


def main():
    ap = argparse.ArgumentParser(prog="plan_desarrollo", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("extraer", help="PDF -> JSON (lineas, sectores, programas, indicadores, PPI) + reporte")
    p.add_argument("pdf")
    p.add_argument("salida")
    p.add_argument("--vision", action="store_true", help="lee con la API las paginas-imagen pendientes")

    p = sub.add_parser("ocr", help="reconvierte con OCR las paginas-imagen del capitulo estrategico")
    p.add_argument("pdf")
    p.add_argument("salida")

    p = sub.add_parser("aprender", help="aplica las correcciones escritas en revision.json")
    p.add_argument("salida")

    p = sub.add_parser("alias", help="registra un alias de sector o programa")
    p.add_argument("tipo", choices=conocimiento.TIPOS)
    p.add_argument("variante")
    p.add_argument("canonico")

    p = sub.add_parser("congelar", help="guarda lo extraido (ya revisado) como referencia")
    p.add_argument("salida")
    p.add_argument("nombre")

    p = sub.add_parser("evaluar", help="mide una extraccion contra una referencia")
    p.add_argument("salida")
    p.add_argument("nombre")

    p = sub.add_parser("comparar-vision", help="lectura manual vs lectura por API")
    p.add_argument("salida")

    p = sub.add_parser("muestra", help="arma la pagina HTML de revision humana de una muestra de indicadores")
    p.add_argument("--plan", nargs=3, action="append", metavar=("NOMBRE", "PDF", "SALIDA"), required=True)
    p.add_argument("-n", type=int, default=20)
    p.add_argument("-o", default="revision_muestra.html")
    p.add_argument("--cobertura", nargs="*", default=[], help="carpetas de salida de todos los planes procesados (para la seccion de categorias)")

    p = sub.add_parser("verificar", help="guarda en golden/ el JSON descargado de la pagina de revision")
    p.add_argument("archivo")

    p = sub.add_parser("evaluar-verificadas", help="mide una extraccion contra las filas revisadas a mano")
    p.add_argument("salida")
    p.add_argument("plan")

    p = sub.add_parser("categorias", help="matriz de que campos y niveles trae cada plan (base para el esquema canonico)")
    p.add_argument("carpetas", nargs="+")

    a = ap.parse_args()
    if a.cmd == "extraer":
        print(pipeline.procesar(a.pdf, a.salida, usar_vision_api=a.vision))
    elif a.cmd == "ocr":
        salida = Path(a.salida)
        cfg = pipeline.cargar_config(salida)
        total = paginas.convertir(a.pdf, salida / "paginas_md")
        pag = paginas.cargar(salida / "paginas_md", total)
        _, _, cap2 = pipeline.detecta_rangos(pag, cfg)
        pend = vision.candidatas(a.pdf, range(cap2[0], cap2[1] + 1), set())
        paginas.convertir_ocr(a.pdf, pend, salida / "paginas_ocr")
        print(f"OCR de {len(pend)} paginas: {pend}")
    elif a.cmd == "aprender":
        print(f"{pipeline.aprender(a.salida)} alias aprendidos")
    elif a.cmd == "alias":
        conocimiento.agregar(a.tipo, a.variante, a.canonico)
    elif a.cmd == "congelar":
        print(evaluar.congelar(a.salida, a.nombre))
    elif a.cmd == "evaluar":
        print(json.dumps(evaluar.evaluar(a.salida, a.nombre), indent=1))
    elif a.cmd == "muestra":
        items = muestra.muestra([tuple(x) for x in a.plan], n=a.n)
        carpetas = a.cobertura or [x[2] for x in a.plan]
        muestra.escribe_html(items, a.o, muestra.propuesta_categorias(carpetas))
        print(f"{len(items)} filas en {a.o}")
    elif a.cmd == "verificar":
        print(muestra.verificar(a.archivo))
    elif a.cmd == "evaluar-verificadas":
        print(json.dumps(muestra.evaluar_verificadas(a.salida, a.plan), indent=1))
    elif a.cmd == "categorias":
        print(categorias.matriz(a.carpetas)[0])
    elif a.cmd == "comparar-vision":
        print(json.dumps(evaluar.comparar_vision(a.salida), indent=1))


main()
