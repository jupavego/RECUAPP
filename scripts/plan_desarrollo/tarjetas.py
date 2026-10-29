"""Indicadores en formato tarjeta (Montebello): un bloque de texto por indicador, sin tabla.

    INDICADOR 1.1.7 COD. INDICADOR
    Rendicion de cuentas realizadas. 450200101
    META No Acumulado RESPONSABLE
    4  [Numero]
    Equipo de Gobierno.
    LINEA BASE 2
    APUESTA PARA RECUPERAR LA RUTA DEL PROGRESO ...
    SECTOR PRODUCTO
    Gobierno Territorial Servicio de promocion a la participacion ciudadana (4502001)
"""
import re

from .texto import limpia, norm

RE_INICIO = re.compile(r"INDICADOR\s+([\d.]+)\s+COD\.?\s*INDICADOR", re.I)
RE_META = re.compile(r"^META\s*(.*?)\s*RESPONSABLES?\s*$", re.I)
RE_VALOR = re.compile(r"^(\S+?)\s*\[(.+?)\]\s*(.*)$")
RE_LB = re.compile(r"^L[IÍ]NEA BASE\s*(\S*)", re.I)

# Sectores del catalogo MGA, para separar "<sector> <producto>"
SECTORES = ["Gobierno Territorial", "Salud y Protección Social", "Educación", "Vivienda, Ciudad y Territorio",
            "Agricultura y Desarrollo Rural", "Transporte", "Ambiente y Desarrollo Sostenible", "Minas y Energía",
            "Cultura", "Deporte y Recreación", "Inclusión Social", "Justicia y del Derecho",
            "Tecnologías de la Información y las Comunicaciones", "Tecnologías de la Información", "Comercio, Industria y Turismo", "Trabajo",
            "Ciencia, Tecnología e Innovación", "Información Estadística", "Defensa", "Igualdad y No Discriminación",
            "Interior", "Servicio Público", "Organismos de Control", "Planeación", "Hacienda"]


def _sector_producto(txt):
    k = norm(txt)
    for s in sorted(SECTORES, key=len, reverse=True):
        if k.startswith(norm(s)):
            return s, txt[len(s):].strip()  # la longitud sin tildes coincide con la del original
    return "", txt


def _tarjeta(num, bloque):
    lineas = [limpia(x) for x in bloque.split("\n")]
    lineas = [x for x in lineas if x]
    rec = {"numero": num}
    k = next((i for i, x in enumerate(lineas) if RE_META.match(x)), None)
    if k is None:
        return None
    nombre = " ".join(lineas[:k])
    m = re.search(r"(?<!\d)(\d{9})(?!\d)", nombre)  # el codigo MGA puede quedar al inicio, al final o a mitad del nombre
    if m:
        rec["codigo"] = m.group(1)
        nombre = re.sub(r"\s+", " ", nombre[:m.start()] + " " + nombre[m.end():]).strip()
    rec["nombre"] = nombre
    acum = RE_META.match(lineas[k]).group(1)
    if acum:
        rec["tipo_acumulado"] = acum
    resto = lineas[k + 1:]
    j = next((i for i, x in enumerate(resto) if RE_LB.match(x)), None)
    if j is None:
        return None
    m = RE_VALOR.match(resto[0]) if resto else None
    if m:
        rec["meta"], rec["unidad"] = m.group(1), m.group(2)
        responsable = ([m.group(3)] if m.group(3) else []) + resto[1:j]
    else:
        rec["meta"] = resto[0] if resto else ""
        responsable = resto[1:j]
    rec["responsable"] = " ".join(responsable)
    rec["linea_base"] = RE_LB.match(resto[j]).group(1)
    s = next((i for i, x in enumerate(resto) if norm(x) == "sector producto"), None)
    if s is not None and s + 1 < len(resto):
        sector, producto = _sector_producto(" ".join(resto[s + 1:]))
        m = re.search(r"\((\d{7})\)\s*\d*\s*$", producto)
        if m:
            rec["codigo_producto"] = m.group(1)
            producto = producto[:m.start()].strip()
        if sector:
            rec["sector"] = sector
        rec["producto"] = producto
    return rec if rec["nombre"] and (rec["meta"] or rec["linea_base"]) else None


def lee(md):
    """Tarjetas de una pagina (texto del convertidor, con <br> entre lineas)."""
    texto = re.sub(r"<br>|<!--.*?-->", "\n", md)
    inicios = list(RE_INICIO.finditer(texto))
    out = []
    for a, b in zip(inicios, inicios[1:] + [None]):
        t = _tarjeta(a.group(1), texto[a.end():b.start() if b else len(texto)])
        if t:
            out.append(t)
    return out
