"""Lectura de tablas que son imagen con un modelo de vision.

Dos pasos: `cola` detecta y renderiza las paginas candidatas; `leer` las envia a la API de Claude con un
esquema JSON fijo y guarda una respuesta por pagina (cache: una pagina no se vuelve a pagar).
"""
import base64
import json
import os
import re

from . import paginas

MODELO = os.environ.get("PLAN_VISION_MODELO", "claude-sonnet-5-5")

PROMPT = """La imagen es una pagina de un Plan de Desarrollo Territorial de un municipio colombiano.
Extrae unicamente las tablas de INDICADORES DE PRODUCTO (columnas tipicas: nombre del indicador, unidad de
medida, linea base, meta del cuatrienio, tipo de acumulado, responsable).

Para cada fila devuelve un objeto con: programa, nombre, unidad, linea_base, meta, tipo_acumulado, responsable.
- "programa": si la pagina trae un titulo o pie "Indicadores de producto programa X", usa ese nombre; si no,
  elige el mas probable de esta lista: {programas}
- Copia los textos y cifras tal como aparecen; no inventes. Si una celda es ilegible, dejala vacia ("").
- Si la pagina no contiene tablas de indicadores de producto, responde [].
Responde SOLO con la lista JSON, sin texto adicional ni comillas de bloque de codigo."""


def candidatas(pdf, numeros, con_tabla, min_cobertura=0.05):
    """Paginas con imagenes y sin tabla de indicadores leida del texto.

    Es deliberadamente laxa: el texto de una tabla-imagen suele venir parcial (hasta 230 palabras en una pagina
    tabular), asi que un filtro por poco texto perdia paginas. Una pagina narrativa solo cuesta una respuesta [].
    """
    info = paginas.cobertura_imagen(pdf, [n for n in numeros if n not in con_tabla])
    return [n for n, v in info.items() if v["cobertura"] >= min_cobertura]


def _json(texto):
    texto = re.sub(r"^```(?:json)?|```$", "", texto.strip(), flags=re.M).strip()
    return json.loads(texto)


def leer(rutas, salida, programas):
    """rutas: {pagina: png}. Escribe vision_api/pNNN.json por pagina nueva; devuelve las leidas ahora."""
    try:
        import anthropic
    except ImportError as e:
        raise SystemExit("Falta el paquete 'anthropic' (pip install anthropic) para leer imagenes.") from e
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("Falta la variable de entorno ANTHROPIC_API_KEY.")
    cliente = anthropic.Anthropic()
    carpeta = salida / "vision_api"
    carpeta.mkdir(exist_ok=True)
    leidas = []
    for n, png in sorted(rutas.items()):
        destino = carpeta / f"p{n:03d}.json"
        if destino.exists():
            continue
        b64 = base64.standard_b64encode(png.read_bytes()).decode()
        msg = cliente.messages.create(
            model=MODELO, max_tokens=6000,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                {"type": "text", "text": PROMPT.format(programas="; ".join(programas))}]}])
        try:
            filas = _json(msg.content[0].text)
        except Exception as e:
            destino.with_suffix(".error.txt").write_text(f"{e}\n{msg.content[0].text}", encoding="utf8")
            continue
        for f in filas:
            f["pagina"] = n
            f["fuente"] = "vision-api"
        destino.write_text(json.dumps(filas, ensure_ascii=False, indent=1), encoding="utf8")
        leidas.append(n)
    return leidas


def cargar_leidas(salida):
    """Indicadores leidos por la API en corridas anteriores."""
    out = []
    for f in sorted((salida / "vision_api").glob("p*.json")) if (salida / "vision_api").exists() else []:
        out += json.loads(f.read_text(encoding="utf8"))
    return out
