"""Muestra para revision humana: de ahi sale la verdad con la que se mide al modulo.

`muestra` arma una pagina HTML con filas extraidas (al azar + las sospechosas) y un enlace a la pagina del PDF.
La persona marca cada fila como correcta o incorrecta y descarga un JSON; `verificar` lo guarda en golden/.
"""
import html
import json
import random
import urllib.parse
from pathlib import Path

from .evaluar import GOLDEN
from .texto import norm

CAMPOS = ["nombre", "unidad", "linea_base", "meta", "tipo_acumulado", "responsable", "programa", "linea", "sector"]


def clave(i):
    return f"{i['pagina']}|{norm(i['nombre'])}"


def _sospechosa(i):
    return not (i.get("linea_base") and i.get("meta") and i.get("programa")) or len(i["nombre"]) < 12


DECISIONES = [
    dict(id="ppi_nivel", pregunta="PPI: ¿a que nivel minimo lo exigimos?",
         opciones=["programa", "sector", "linea", "solo total por año"],
         evidencia="Solo 6 de 20 planes traen la inversion por linea/sector/programa en texto extraible; 12 no la traen."),
    dict(id="resultado", pregunta="¿Guardamos tambien los indicadores de resultado (separados de los de producto)?",
         opciones=["si", "no"], evidencia="Ya se extraen aparte: 852 de resultado frente a 4.394 de producto."),
    dict(id="alineacion", pregunta="¿Capturamos la alineacion (ODS, PND, PDD) como categoria propia?",
         opciones=["si", "no", "solo ODS"], evidencia="Solo la traen algunos planes (p. ej. Angostura, San Andres)."),
    dict(id="jerarquia", pregunta="Niveles superiores: ¿usamos nombres fijos (linea > sector > programa) o los del plan?",
         opciones=["nombres fijos", "los del plan + equivalencia"],
         evidencia="Los planes los llaman linea, eje, dimension, pilar, reto, componente o estrategia."),
]


def propuesta_categorias(carpetas):
    """Cobertura de cada campo en los planes ya procesados + una recomendacion inicial (editable)."""
    from .categorias import CAMPOS, perfil
    filas = [perfil(c) for c in carpetas]
    n = len(filas)
    out = []
    for campo, nombre in CAMPOS:
        v = [f["cobertura"][campo] for f in filas]
        buenos = sum(x >= 80 for x in v)
        rec = "obligatoria" if buenos >= 0.75 * n else "recomendada" if buenos >= 0.4 * n else "opcional"
        out.append(dict(campo=campo, nombre=nombre, planes_completos=buenos, planes_vacios=sum(x == 0 for x in v),
                        total=n, recomendacion=rec, decision=None, nota=""))
    return out


def muestra(planes, n=20, sospechosas=6, semilla=7):
    """planes: [(nombre, pdf, carpeta_de_salida)] -> lista de items a revisar."""
    items = []
    for nombre, pdf, salida in planes:
        ind = json.loads((Path(salida) / "indicadores.json").read_text(encoding="utf8"))
        rnd = random.Random(semilla)
        sosp = [i for i in ind if _sospechosa(i)]
        elegidas = rnd.sample(sosp, min(sospechosas, len(sosp)))
        resto = [i for i in ind if i not in elegidas]
        elegidas += rnd.sample(resto, min(n - len(elegidas), len(resto)))
        for i in elegidas:
            items.append(dict(plan=nombre, pdf=str(pdf).replace("\\", "/"), clave=clave(i), sospechosa=_sospechosa(i),
                              pagina=i["pagina"], campos={k: i.get(k) for k in CAMPOS}, estado=None, correccion=""))
    for k, it in enumerate(items, 1):
        it["id"] = k
    return items


PAGINA = """<!doctype html><html lang="es"><meta charset="utf-8"><title>Revision de muestra</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font:15px/1.4 system-ui,sans-serif;margin:0 auto;max-width:900px;padding:16px;background:#f6f6f4;color:#1c1c1a}
h1{font-size:20px}.barra{position:sticky;top:0;background:#f6f6f4;padding:8px 0;border-bottom:1px solid #ccc;z-index:2}
.card{background:#fff;border:1px solid #d8d8d2;border-radius:8px;padding:12px;margin:12px 0}
.card.ok{border-left:6px solid #2e7d32}.card.mal{border-left:6px solid #c62828}
.meta{font-size:13px;color:#555;margin-bottom:6px}.sosp{background:#fff3cd;padding:1px 6px;border-radius:4px;font-size:12px}
table{border-collapse:collapse;width:100%}td{padding:3px 6px;border-top:1px solid #eee;vertical-align:top}td:first-child{width:130px;color:#666}
button{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid #888;background:#fff;cursor:pointer;margin-right:6px}
button.on-ok{background:#2e7d32;color:#fff}button.on-mal{background:#c62828;color:#fff}
input{font:inherit;width:100%;box-sizing:border-box;margin-top:6px;padding:5px}a{color:#0b57d0}
@media(prefers-color-scheme:dark){body{background:#161614;color:#eee}.barra{background:#161614}.card{background:#222220;border-color:#444}
td{border-color:#333}.meta{color:#aaa}button{background:#2a2a28;color:#eee}input{background:#2a2a28;color:#eee;border:1px solid #555}}
</style>
<h1>Revision de muestra de indicadores</h1>
<h2>1. Categorias</h2>
<p>Que campos exigimos para cada indicador. "Planes completos" = en cuantos planes el campo viene lleno en el 80 % o mas de las filas.
La recomendacion sale de esos numeros; cambia la decision si tu criterio es otro.</p>
<div id="cats"></div><div id="decs"></div>
<h2>2. Revision de filas</h2>
<p>Abre la pagina del PDF y compara la fila. Marca <b>Correcta</b> si todos los campos coinciden con el PDF,
<b>Incorrecta</b> si alguno esta mal (escribe abajo cual y como deberia ser). Si dudas, dejala sin marcar.</p>
<div class="barra"><span id="cuenta"></span> <button onclick="bajar()">Descargar muestra_revisada.json</button></div>
<div id="lista"></div>
<script>
const CATS=__CATS__;const DECS=__DECS__;const ITEMS=__DATOS__;const LLAVE="muestra_revision_v1";
try{const g=JSON.parse(localStorage.getItem(LLAVE)||"{}");ITEMS.forEach(i=>{if(g[i.id]){i.estado=g[i.id].estado;i.correccion=g[i.id].correccion}})}catch(e){}
const L2="categorias_v1";
try{const g=JSON.parse(localStorage.getItem(L2)||"{}");CATS.forEach(c=>{if(g[c.campo]){c.decision=g[c.campo].decision;c.nota=g[c.campo].nota}});DECS.forEach(d=>{if(g[d.id]){d.respuesta=g[d.id].respuesta;d.nota=g[d.id].nota}})}catch(e){}
function guardar(){try{const g={};ITEMS.forEach(i=>g[i.id]={estado:i.estado,correccion:i.correccion});localStorage.setItem(LLAVE,JSON.stringify(g));
const h={};CATS.forEach(c=>h[c.campo]={decision:c.decision,nota:c.nota});DECS.forEach(d=>h[d.id]={respuesta:d.respuesta,nota:d.nota});localStorage.setItem(L2,JSON.stringify(h))}catch(e){}}
function decide(campo,v){CATS.find(c=>c.campo===campo).decision=v;guardar();pintaCats()}
function notaCat(campo,v){CATS.find(c=>c.campo===campo).nota=v;guardar()}
function responde(id,v){DECS.find(d=>d.id===id).respuesta=v;guardar();pintaCats()}
function notaDec(id,v){DECS.find(d=>d.id===id).nota=v;guardar()}
function pintaCats(){const O=["obligatoria","recomendada","opcional","descartar"];
document.getElementById("cats").innerHTML="<table><tr><td><b>Categoria</b></td><td><b>Planes completos</b></td><td><b>Decision</b></td></tr>"+CATS.map(c=>`<tr><td>${c.nombre}<br><small>recomendacion: <b>${c.recomendacion}</b></small></td><td>${c.planes_completos} de ${c.total}<br><small>vacio en ${c.planes_vacios}</small></td><td>${O.map(o=>`<button class="${(c.decision||'')===o?'on-ok':''}" onclick="decide('${c.campo}','${o}')">${o}</button>`).join("")}<input placeholder="nota" value="${(c.nota||'').replace(/"/g,'&quot;')}" oninput="notaCat('${c.campo}',this.value)"></td></tr>`).join("")+"</table>";
document.getElementById("decs").innerHTML=DECS.map(d=>`<div class="card"><b>${d.pregunta}</b><br><small>${d.evidencia}</small><div style="margin-top:6px">${d.opciones.map(o=>`<button class="${d.respuesta===o?'on-ok':''}" onclick="responde('${d.id}','${o}')">${o}</button>`).join("")}</div><input placeholder="nota" value="${(d.nota||'').replace(/"/g,'&quot;')}" oninput="notaDec('${d.id}',this.value)"></div>`).join("")}
function marca(id,e){const i=ITEMS.find(x=>x.id===id);i.estado=i.estado===e?null:e;guardar();pinta()}
function nota(id,v){ITEMS.find(x=>x.id===id).correccion=v;guardar()}
function pinta(){const L=document.getElementById("lista");L.innerHTML="";let hechas=0;
ITEMS.forEach(i=>{if(i.estado)hechas++;const d=document.createElement("div");d.className="card "+(i.estado||"");
const url=encodeURI("../plan/"+i.pdf)+"#page="+i.pagina;
d.innerHTML=`<div class="meta"><b>#${i.id}</b> · ${i.plan} · <a href="${url}" target="_blank">PDF pagina ${i.pagina}</a>${i.sospechosa?' · <span class="sosp">sospechosa</span>':''}</div>
<table>${Object.entries(i.campos).map(([k,v])=>`<tr><td>${k}</td><td>${v==null||v===""?'<i>(vacio)</i>':String(v).replace(/</g,"&lt;")}</td></tr>`).join("")}</table>
<div style="margin-top:8px"><button class="${i.estado==='ok'?'on-ok':''}" onclick="marca(${i.id},'ok')">Correcta</button>
<button class="${i.estado==='mal'?'on-mal':''}" onclick="marca(${i.id},'mal')">Incorrecta</button></div>
<input placeholder="Si esta incorrecta: que campo y como deberia ser" value="${(i.correccion||'').replace(/"/g,'&quot;')}" oninput="nota(${i.id},this.value)">`;
L.appendChild(d)});document.getElementById("cuenta").textContent=hechas+" de "+ITEMS.length+" revisadas"}
function bajar(){const b=new Blob([JSON.stringify({items:ITEMS,categorias:CATS,decisiones:DECS},null,1)],{type:"application/json"});const a=document.createElement("a");
a.href=URL.createObjectURL(b);a.download="muestra_revisada.json";a.click()}
pintaCats();pinta();
</script></html>"""


def escribe_html(items, destino, categorias=None):
    def js(x):
        return json.dumps(x, ensure_ascii=False).replace("</", "<\/")
    pag = PAGINA.replace("__DATOS__", js(items)).replace("__CATS__", js(categorias or [])).replace("__DECS__", js(DECISIONES))
    Path(destino).write_text(pag, encoding="utf8")


def verificar(archivo):
    """Guarda el resultado de la revision en golden/<plan>.json: filas verificadas y filas que no deben aparecer."""
    datos = json.loads(Path(archivo).read_text(encoding="utf8"))
    items = datos["items"] if isinstance(datos, dict) else datos
    if isinstance(datos, dict) and (datos.get("categorias") or datos.get("decisiones")):
        destino = GOLDEN.parent / "conocimiento" / "categorias.json"
        destino.parent.mkdir(exist_ok=True)
        destino.write_text(json.dumps(dict(categorias=datos.get("categorias"), decisiones=datos.get("decisiones")),
                                      ensure_ascii=False, indent=1), encoding="utf8")
    GOLDEN.mkdir(exist_ok=True)
    por_plan = {}
    for it in items:
        if it["estado"]:
            por_plan.setdefault(it["plan"], []).append(it)
    resumen = {}
    for plan, its in por_plan.items():
        destino = GOLDEN / f"{plan}.json"
        ref = json.loads(destino.read_text(encoding="utf8")) if destino.exists() else {}
        ver = {v["clave"]: v for v in ref.get("verificados", [])}
        mal = {m["clave"]: m for m in ref.get("incorrectos", [])}
        for it in its:
            if it["estado"] == "ok":
                ver[it["clave"]] = dict(clave=it["clave"], campos=it["campos"])
                mal.pop(it["clave"], None)
            else:
                mal[it["clave"]] = dict(clave=it["clave"], campos=it["campos"], nota=it["correccion"])
                ver.pop(it["clave"], None)
        ref["verificados"], ref["incorrectos"] = list(ver.values()), list(mal.values())
        destino.write_text(json.dumps(ref, ensure_ascii=False, indent=1), encoding="utf8")
        resumen[plan] = (len(ver), len(mal))
    return resumen


def evaluar_verificadas(salida, plan):
    """Sobre lo revisado a mano: cuantas filas correctas siguen saliendo iguales y cuantas incorrectas siguen saliendo."""
    ref = json.loads((GOLDEN / f"{plan}.json").read_text(encoding="utf8"))
    ind = {clave(i): i for i in json.loads((Path(salida) / "indicadores.json").read_text(encoding="utf8"))}
    ver, mal = ref.get("verificados", []), ref.get("incorrectos", [])
    iguales = sum(1 for v in ver if v["clave"] in ind and all(
        norm(str(ind[v["clave"]].get(k) or "")) == norm(str(val or "")) for k, val in v["campos"].items()))
    return dict(verificadas=len(ver), siguen_iguales=iguales,
                incorrectas_conocidas=len(mal), siguen_saliendo=sum(1 for m in mal if m["clave"] in ind))
