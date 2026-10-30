"""Responsables de cada dependencia, leidos de las paginas del sitio de la alcaldia.

Cada pagina de dependencia trae, tras la miga de pan, el cargo en mayusculas, el nombre y un perfil. Uso:
    python -m plan_desarrollo.responsables_web <url_listado> <salida.json> [carpeta_fotos]
Solo lee paginas publicas y guarda cargo, nombre, perfil resumido, la URL y la fecha de lectura.
"""
import html
import json
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urljoin

UA = {"User-Agent": "Mozilla/5.0"}


def _get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read().decode("utf8", "ignore")


def _lineas(b):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", b, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t)).replace("\u200b", "").replace("\xa0", " ")
    return [l.strip() for l in t.split("\n") if l.strip()]


MENORES = {"de", "del", "la", "y", "e", "en", "para", "el", "los", "las"}


def _titulo(t):
    """Pasa MAYUSCULAS a Capitalizacion normal ("DE", "Y" en minuscula); respeta lo que ya viene en minusculas."""
    if not t.isupper():
        return t
    return " ".join(w.lower() if i and w.lower() in MENORES else w.capitalize() for i, w in enumerate(t.split()))


def dependencias(url_listado):
    """[(titulo, url)] de los enlaces de la pagina de listado, sin repetir."""
    b = _get(url_listado)
    vistos, out = set(), []
    for h, t in re.findall(r'<a[^>]+href="([^"]*Dependencias/Paginas[^"]*)"[^>]*>(.*?)</a>', b, flags=re.S):
        u = urljoin(url_listado, h)
        titulo = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", t))).replace("\u200b", "").strip()
        if titulo and u not in vistos and not u.endswith("default.aspx"):
            vistos.add(u)
            out.append((titulo, u))
    return out


def _foto(b, url):
    """URL absoluta de la foto del responsable: la primera imagen subida a PublishingImages de la pagina."""
    m = re.search(r'<img[^>]+src="([^"]*PublishingImages[^"]*)"', b)
    return urljoin(url, m.group(1)) if m else None


def lee(url):
    """cargo, nombre, perfil y foto de una pagina de dependencia; None si no la reconoce."""
    b = _get(url)
    L = _lineas(b)
    try:
        i = next(k for k, l in enumerate(L) if l == "Dependencias" and k + 2 < len(L) and L[k + 1] == L[k + 2] or l == "Dependencias" and k > 8 and L[k - 1] == "Nuestra Alcaldía")
    except StopIteration:
        return None
    resto = L[i + 3:]
    fin = next((k for k, l in enumerate(resto) if l.startswith("Alcad") or l.startswith("Alcaldía Municipal de")), len(resto))
    resto = resto[:fin]
    if len(resto) < 2:
        return None
    perfil = ""
    if "PERFIL" in resto and resto.index("PERFIL") >= 2:
        k = resto.index("PERFIL")  # el nombre va justo antes del perfil y el cargo antes del nombre (el titulo puede partirse en lineas)
        cargo, nombre = resto[k - 2], resto[k - 1]
        perfil = resto[k + 1] if k + 1 < len(resto) else ""
    else:
        cargo, nombre = resto[0], resto[1]
    return {"cargo": _titulo(cargo), "nombre": _titulo(nombre), "perfil": perfil[:600], "foto_url": _foto(b, url)}


def descarga_fotos(filas, carpeta):
    """Guarda la foto de cada responsable en `carpeta` y pone en `foto` el nombre del archivo."""
    carpeta.mkdir(parents=True, exist_ok=True)
    for f in filas:
        r = f["responsable"]
        if not r or not r.get("foto_url"):
            continue
        ext = r["foto_url"].rsplit(".", 1)[-1].lower().split("?")[0]
        nombre = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFD", unquote(f["url"].rsplit("/", 1)[-1]).removesuffix(".aspx").lower()).encode("ascii", "ignore").decode()).strip("-") + "." + ext
        try:
            (carpeta / nombre).write_bytes(urllib.request.urlopen(urllib.request.Request(r["foto_url"], headers=UA), timeout=60).read())
            r["foto"] = nombre
        except Exception as e:
            print("sin foto", f["dependencia"], e)
        time.sleep(0.5)


def main(url_listado, salida, carpeta_fotos=None):
    filas = []
    for titulo, u in dependencias(url_listado):
        try:
            r = lee(u)
        except Exception as e:
            r = None
            print("fallo", titulo, e)
        filas.append({"dependencia": titulo, "url": u, "responsable": r})
        time.sleep(1)
    if carpeta_fotos:
        descarga_fotos(filas, Path(carpeta_fotos))
    json.dump({"fuente": url_listado, "fecha": date.today().isoformat(), "dependencias": filas}, open(salida, "w", encoding="utf8"),
              ensure_ascii=False, indent=1)
    return filas


if __name__ == "__main__":
    for f in main(*sys.argv[1:4]):
        print(f["dependencia"][:45].ljust(46), (f["responsable"] or {}).get("cargo"), "|", (f["responsable"] or {}).get("nombre"))
