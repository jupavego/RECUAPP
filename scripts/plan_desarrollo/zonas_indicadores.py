"""Indicadores del plan por vereda, a partir de las veredas que nombran los informes de seguimiento.

Uso: python -m scripts.plan_desarrollo.zonas_indicadores <dane>
Salida: public/data/plan/<dane>-zonas.json  {zonas: {<vereda>: [{ip, indicador, ...}]}}

Los indicadores del plan no tienen ubicacion: aqui se ubican por el texto. Un indicador queda en una vereda cuando la
narrativa, el proyecto o el nombre de la ficha la nombran. Eso es "mencionado en el informe", no "ejecutado alli":
cada entrada lleva el fragmento donde aparece para que se pueda juzgar.
"""
import json
import re
import sys
import unicodedata

from .seguimiento_json import ENTRADA, SALIDA, _leer, productos_sispt
from .seguimiento_pdf import norm

RAIZ = SALIDA.parents[2]
# escrituras del informe que no coinciden con el nombre oficial de la vereda
ALIAS = {"manga arriba": ["mangarriba"], "loma de los ochoa": ["loma los ochoa"]}


def sin_marcas(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower())


def main(dane):
    plan = json.loads((SALIDA / f"{dane}.json").read_text(encoding="utf-8"))
    seg = json.loads((SALIDA / f"{dane}-seguimiento.json").read_text(encoding="utf-8"))
    deps = {d["id"]: d["nombre"] for d in plan["dependencias"]}
    resp = {p["id"]: p["resp"][0]["dep"] for p in plan["productos"] if p.get("resp")}
    municipios = json.loads((RAIZ / "public/data/mapa/municipios.json").read_text(encoding="utf-8"))["municipios"]
    mid = next(m["id"] for m in municipios if norm(m["n"]) == norm(plan["municipio"]))
    territorio = json.loads((RAIZ / f"public/data/mapa/territorio/{mid}.json").read_text(encoding="utf-8"))
    # la vereda que se llama como el municipio se confundiria con cualquier mencion al municipio
    veredas = [z["n"] for z in territorio["v"] if norm(z["n"]) != norm(plan["municipio"])]
    patrones = {}
    for v in veredas:
        for nombre in [norm(v), *ALIAS.get(norm(v), [])]:
            patrones.setdefault(v, []).append(re.compile(r"\b" + re.escape(nombre) + r"\b"))

    por_codigo, por_nombre = productos_sispt(dane)
    zonas, sin_ip, anios = {}, 0, {}
    for fichero in sorted((ENTRADA / dane).glob("fichas_*.csv")):
        etiqueta = fichero.stem.replace("fichas_", "")
        for r in _leer(fichero):
            texto = " ".join([r["indicador"], r["proyecto"], r["narrativa"]])
            plano = norm(texto)
            halladas = [v for v, ps in patrones.items() if len(norm(v)) > 4 and any(p.search(plano) for p in ps)]
            if not halladas:
                continue
            ip = por_codigo.get(r.get("codigo_plan", "")) or por_nombre.get((r["programa_cod"], norm(r["indicador"])))
            if not ip:
                sin_ip += 1
                continue
            e = seg["indicadores"].get(ip, {})
            ultimo = max((a for a, y in e.get("por_anio", {}).items() if y.get("pct") is not None), default=None)
            for v in halladas:
                nombre = next((n for n in [norm(v), *ALIAS.get(norm(v), [])] if re.search(r"\b" + re.escape(n) + r"\b", plano)), norm(v))
                ini = sin_marcas(texto).find(nombre)
                contexto = re.sub(r"\s+", " ", texto[max(0, ini - 100): ini + 140]).strip() if ini >= 0 else ""
                lista = zonas.setdefault(v, [])
                entrada = next((x for x in lista if x["ip"] == ip), None)
                if not entrada:
                    dep = (e.get("informe_dep") or {}).get("2025") or (e.get("informe_dep") or {}).get("2024") or resp.get(ip)
                    entrada = {"ip": ip, "indicador": r["indicador"], "dep": dep, "dep_nombre": deps.get(dep),
                               "pct": e["por_anio"][ultimo]["pct"] if ultimo else None, "anio_pct": int(ultimo) if ultimo else None,
                               "menciones": []}
                    lista.append(entrada)
                etiqueta_anio = "Infraestructura 2024-2025" if etiqueta.startswith("infra") else etiqueta[:4]
                if contexto not in [m["texto"] for m in entrada["menciones"]]:
                    entrada["menciones"].append({"anio": etiqueta_anio, "texto": contexto})
                anios[etiqueta] = anios.get(etiqueta, 0) + 1
    for lista in zonas.values():
        lista.sort(key=lambda x: (x["pct"] is None, x["ip"]))
    out = {"fuente": "Veredas nombradas en los informes de seguimiento (no es la ubicación de la obra)", "zonas": zonas}
    destino = SALIDA / f"{dane}-zonas.json"
    destino.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ind = {x["ip"] for l in zonas.values() for x in l}
    print(f"{destino}: {len(zonas)} veredas de {len(veredas)}, {len(ind)} indicadores, {sin_ip} fichas sin cruzar con el plan; "
          f"{destino.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1])
