"""Conocimiento acumulado entre planes: alias de sectores y programas aprendidos de las correcciones.

Vive en conocimiento/alias.json, dentro de este paquete, y se versiona con el codigo:
cada correccion humana queda como un alias que los siguientes planes ya aplican solos.
"""
import json
from pathlib import Path

from .texto import mejor, norm

ARCHIVO = Path(__file__).parent / "conocimiento" / "alias.json"
TIPOS = ("sector", "programa")


def cargar():
    if ARCHIVO.exists():
        return json.loads(ARCHIVO.read_text(encoding="utf8"))
    return {t: {} for t in TIPOS}


def agregar(tipo, variante, canonico):
    if tipo not in TIPOS:
        raise ValueError(f"tipo debe ser uno de {TIPOS}")
    datos = cargar()
    datos.setdefault(tipo, {})[norm(variante)] = canonico
    ARCHIVO.parent.mkdir(parents=True, exist_ok=True)
    ARCHIVO.write_text(json.dumps(datos, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf8")


def resuelve(tipo, nombre, canon, umbral=0.75, alias=None):
    """(similitud, nombre canonico): alias aprendido primero, similitud aproximada despues."""
    alias = (alias if alias is not None else cargar()).get(tipo, {})
    k = norm(nombre)
    if k in alias:
        return 1.0, alias[k]
    sc, c = mejor(nombre, canon)
    return (sc, c) if sc >= umbral else (sc, None)
