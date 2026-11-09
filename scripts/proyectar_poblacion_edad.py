"""Proyección de la población de Girardota por sexo y edad, de 2018 a 2050, en cada zona (cabecera y cada vereda):

    public/data/poblacion/<codigo_dane>-edad.json

Es una ESTIMACIÓN para planear, construida en tres pasos:

1. Municipio, 2018–2042 (dato oficial). Proyección municipal del DANE por área, sexo y edad simple (PPED, actualización
   de 2025). La Gobernación de Antioquia publica la misma serie (POB_ANT 2006-2035, ajuste de agosto de 2025): el script
   lo comprueba edad por edad y deja la diferencia en `metadata.gobernacion`.

2. Municipio, 2043–2050 (extrapolación). Se siguen las cohortes de Girardota con las razones de cambio por cohorte
   (Hamilton-Perry) de una población de referencia del DANE que sí llega a 2050 — la región Valle de Aburrá si su archivo
   está, si no el total nacional — corregidas por el diferencial propio de Girardota en 2038–2042:
       P(s, a, t) = P(s, a-1, t-1) · RCC_ref(s, a, t) · k(s, a)        k = media 2038–2042 de RCC_Girardota / RCC_ref
   Los nacimientos (edad 0) salen de la razón niños / mujeres de 15–49 de la referencia, con el mismo diferencial.
   Se hace por separado para la cabecera y para el área rural (centros poblados y rural disperso).

3. Zonas (método de participación por cohorte). La población rural de cada vereda en 2018 sale del Censo 2018 (secciones
   rurales repartidas por viviendas, igual que generar_poblacion_veredas.py, más los centros poblados que caen en ella),
   con su estructura propia de sexo y grupos de 10 años; las edades simples se abren con el patrón rural del municipio
   (ajuste proporcional iterativo, IPF) y se ajustan para que las veredas sumen exactamente el municipio en cada sexo y
   edad. Después cada vereda conserva su participación en cada cohorte a medida que envejece:
       part_v(s, a, t) = part_v(s, a-1, t-1)          y la edad 0 según las mujeres de 15–49 de la vereda y su fecundidad
   relativa en 2018. Así las veredas con más jóvenes crecen más y las envejecidas menos, y en cada año las veredas suman
   exactamente la proyección rural del municipio por sexo y edad. La cabecera es una sola zona (no hay edad por barrio).

Limitaciones: supone que la migración relativa de cada vereda se mantiene como en 2018; no ve proyectos de vivienda
nuevos. 2043–2050 no es dato oficial. El censo cuenta personas sin la corrección por omisión que aplica el DANE; por eso
solo se usa para las participaciones, nunca para los totales.

Entradas: insumos/poblacion/dane_pped/<dane>_area_sexo_edad.csv        (scripts/extraer_proyeccion_dane_mun.py)
          insumos/poblacion/gobernacion/<dane>_area_sexo_edad.csv      (scripts/extraer_proyeccion_gobernacion.ps1)
          insumos/poblacion/dane_pped/PPED-AreaSexoEdadReg-2018-2050.xlsx  (opcional, región Valle de Aburrá)
          insumos/poblacion/PPED-AreaSexoEdadNac-2018-2070.xlsx          (referencia de respaldo)
          insumos/poblacion/anex-DCD-Proypoblacion-PerteneniaEtnicoRacialmun.xlsx  (serie DANE anterior, para comparar)
          insumos/geografia/dane_cnpv2018/{veredas,seccion_rural,clase,zona_urbana}
          public/data/mapa3d/edificios-<id>.json
Uso:      python -I scripts/proyectar_poblacion_edad.py [codigo_dane] [id_municipio]   (por defecto 05308 y 49)

Datos © DANE (CNPV 2018, MGN 2018, veredas 2020, PPED 2018-2042 y 2018-2050/2070), Gobernación de Antioquia (POB_ANT)
y Overture Maps Foundation (huellas de edificios).
"""
import csv, json, sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import openpyxl
import shapefile
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import Polygon, shape
from shapely.ops import transform, unary_union

RAIZ = Path(__file__).resolve().parent.parent
DANE = sys.argv[1] if len(sys.argv) > 1 else '05308'
MUNICIPIO = int(sys.argv[2]) if len(sys.argv) > 2 else 49
POB = RAIZ / 'insumos/poblacion'
GEO = RAIZ / 'insumos/geografia/dane_cnpv2018'
A0, A_OFICIAL, A1 = 2018, 2042, 2050
ANIOS = list(range(A0, A1 + 1))
EDADES = 101                      # 0..99 y 100+ (última edad abierta)
AREAS = ('cabecera', 'rural')
SEXOS = ('H', 'M')
GRUPOS = [f'{i}-{i + 4}' for i in range(0, 80, 5)] + ['80+']
DIFERENCIAL = range(2038, A_OFICIAL + 1)   # años con que se mide el diferencial de Girardota frente a la referencia
AREA_MIN, AREA_MAX = 30, 250      # m², huellas que se cuentan como vivienda (como en generar_poblacion_veredas.py)
a_m = Transformer.from_crs(4326, 9377, always_xy=True).transform


# ───────────────────────── 1. municipio, serie oficial ─────────────────────────
def leer_csv(ruta, edad_max):
    """{(área, año): array[2 sexos, EDADES]} desde un CSV anio,area,sexo,edad,personas."""
    d = defaultdict(lambda: np.zeros((2, EDADES)))
    with ruta.open(encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if r['area'] in AREAS:
                d[(r['area'], int(r['anio']))][SEXOS.index(r['sexo']), min(int(r['edad']), edad_max)] += float(r['personas'])
    return dict(d)


oficial = leer_csv(POB / f'dane_pped/{DANE}_area_sexo_edad.csv', EDADES - 1)
assert all((a, t) in oficial for a in AREAS for t in range(A0, A_OFICIAL + 1)), 'faltan años en la serie del DANE'


def a_grupos(m):
    """array[..., EDADES] → array[..., 17 grupos quinquenales, 80+ abierto]."""
    return np.concatenate([m[..., :80].reshape(*m.shape[:-1], 16, 5).sum(-1), m[..., 80:].sum(-1, keepdims=True)], -1)


def comparar_gobernacion():
    ruta = POB / f'gobernacion/{DANE}_area_sexo_edad.csv'
    if not ruta.exists():
        return None
    gob = leer_csv(ruta, 80)
    peor, suma = 0, 0
    for (a, t), g in gob.items():
        if (a, t) in oficial:
            o = oficial[(a, t)].copy()
            o[:, 80] = o[:, 80:].sum(1); o[:, 81:] = 0
            peor = max(peor, float(np.abs(o - g).max())); suma += float(np.abs(o - g).sum())
    anios = sorted({t for _, t in gob})
    print(f'Gobernación {anios[0]}–{anios[-1]} frente a DANE PPED 2018–2035: diferencia máxima {peor:.0f} personas en una edad')
    return {'anios': [anios[0], anios[-1]], 'diferencia_maxima_por_edad': round(peor), 'diferencia_total': round(suma)}


# ───────────────────────── 2. municipio, 2043–2050 ─────────────────────────
def leer_referencia():
    """Población de referencia por área, sexo y edad simple hasta 2050: Valle de Aburrá (DANE regional) o total nacional."""
    for ruta, territorio in ((POB / 'dane_pped/PPED-AreaSexoEdadReg-2018-2050.xlsx', 'Valle de Aburr'),
                             (POB / 'PPED-AreaSexoEdadNac-2018-2070.xlsx', 'Total Nacional')):
        if not ruta.exists():
            continue
        ws = openpyxl.load_workbook(ruta, read_only=True).worksheets[-1]
        filas = ws.iter_rows(values_only=True)
        for cab in filas:
            if any(isinstance(c, str) and c.startswith('Hombres 0') for c in cab):
                break
        col = {}
        for i, c in enumerate(cab):
            if isinstance(c, str) and c.split()[0] in ('Hombres', 'Mujeres') and 'año' in c:
                col[i] = (0 if c.startswith('Hombres') else 1, min(int(c.split()[1]), EDADES - 1))
        ref = {}
        for f in filas:
            texto = [str(x) for x in f[:4] if x is not None]
            anio = next((int(x) for x in f[:4] if isinstance(x, (int, float)) and 2000 < x < 2100), None)
            area = 'cabecera' if any(x.startswith('Cabecera') for x in texto) else \
                   'rural' if any(x.startswith('Centros') for x in texto) else \
                   'total' if 'Total' in texto[1:] else None
            if anio is None or area is None or not any(territorio in x for x in texto):
                continue
            m = np.zeros((2, EDADES))
            for i, (s, e) in col.items():
                m[s, e] += float(f[i] or 0)
            ref[(area, anio)] = m
        if ref:
            completar_areas(ref)
            nombre ='región Valle de Aburrá (DANE, PPED 2018-2050)' if 'Reg' in ruta.name else 'total nacional (DANE, PPED 2018-2070)'
            print(f'Referencia 2043–2050: {nombre}')
            return ref, nombre
    raise SystemExit('No hay población de referencia para extender después de 2042')


def rcc(p0, p1):
    """Razones de cambio por cohorte de t-1 a t, por sexo y edad 1..100 (la última edad es abierta)."""
    r = np.ones_like(p1)
    r[:, 1:-1] = p1[:, 1:-1] / np.maximum(p0[:, :-2], 1e-9)
    r[:, -1] = p1[:, -1] / np.maximum(p0[:, -2] + p0[:, -1], 1e-9)
    return r


def mujeres_fertiles(p):
    return p[1, 15:50].sum()


def seguir_cohortes(p0, r, ninos_por_mujer):
    """Un año más: cada cohorte por su razón de cambio r [2, EDADES]; la edad 0 por niños / mujeres de 15–49."""
    p = np.zeros_like(p0)
    p[:, 1:-1] = p0[:, :-2] * r[:, 1:-1]
    p[:, -1] = (p0[:, -2] + p0[:, -1]) * r[:, -1]
    p[:, 0] = mujeres_fertiles(p) * ninos_por_mujer
    return p


def completar_areas(ref, ventana=5):
    """La serie regional del DANE separa cabecera y rural solo hasta 2045; de ahí en adelante trae el total. Los años
    que faltan en cada área se siguen con las razones del total, corregidas por la diferencia del área frente al total
    en los últimos `ventana` años con área (el mismo método con que se extiende Girardota)."""
    ultimo = max(t for a, t in ref if a == 'cabecera')
    faltan = [t for a, t in sorted(ref) if a == 'total' and t > ultimo]
    if not faltan:
        return
    print(f'Referencia por área hasta {ultimo}; {faltan[0]}–{faltan[-1]} se completan con el total regional')
    for area in AREAS:
        anios = range(ultimo - ventana + 1, ultimo + 1)
        k = np.mean([rcc(ref[(area, t - 1)], ref[(area, t)]) / rcc(ref[('total', t - 1)], ref[('total', t)])
                     for t in anios], axis=0)
        kn = np.mean([(ref[(area, t)][:, 0] / mujeres_fertiles(ref[(area, t)])) /
                      (ref[('total', t)][:, 0] / mujeres_fertiles(ref[('total', t)])) for t in anios], axis=0)
        for t in faltan:
            tot = ref[('total', t)]
            ref[(area, t)] = seguir_cohortes(ref[(area, t - 1)], rcc(ref[('total', t - 1)], tot) * k,
                                             tot[:, 0] / mujeres_fertiles(tot) * kn)
    for t in faltan:   # las dos áreas se reparten exactamente el total regional, por sexo y edad
        suma = ref[('cabecera', t)] + ref[('rural', t)]
        for area in AREAS:
            ref[(area, t)] = ref[(area, t)] * ref[('total', t)] / np.maximum(suma, 1e-9)


def extender(ref):
    serie = dict(oficial)
    for area in AREAS:
        k = np.mean([rcc(oficial[(area, t - 1)], oficial[(area, t)]) / rcc(ref[(area, t - 1)], ref[(area, t)])
                     for t in DIFERENCIAL], axis=0)
        k_nac = np.mean([(oficial[(area, t)][:, 0] / mujeres_fertiles(oficial[(area, t)])) /
                         (ref[(area, t)][:, 0] / mujeres_fertiles(ref[(area, t)])) for t in DIFERENCIAL], axis=0)
        for t in range(A_OFICIAL + 1, A1 + 1):
            serie[(area, t)] = seguir_cohortes(serie[(area, t - 1)], rcc(ref[(area, t - 1)], ref[(area, t)]) * k,
                                               ref[(area, t)][:, 0] / mujeres_fertiles(ref[(area, t)]) * k_nac)
    return serie


# ───────────────────────── 3. zonas ─────────────────────────
def leer_shp(ruta, filtro):
    r = shapefile.Reader(str(ruta), encoding='utf-8')
    campos = [c[0] for c in r.fields[1:]]
    for sr in r.iterShapeRecords():
        d = dict(zip(campos, sr.record))
        if filtro(d):
            yield d, shape(sr.shape.__geo_interface__)


def estructura(d):
    """(personas por grupo de 10 años [9], personas por sexo [2]) de un registro del MGN integrado."""
    return (np.array([d[f'STP34_{i}_ED'] or 0 for i in range(1, 10)], float),
            np.array([d['STP32_1_SE'] or 0, d['STP32_2_SE'] or 0], float))


def edificios():
    e = json.loads((RAIZ / f'public/data/mapa3d/edificios-{MUNICIPIO}.json').read_text(encoding='utf-8'))
    k, centros, areas = e['k'], [], []
    for _, *c in e['e']:
        x, y, pts = c[0], c[1], [(c[0], c[1])]
        for i in range(2, len(c), 2):
            x += c[i]; y += c[i + 1]; pts.append((x, y))
        p = Polygon([(a / k, b / k) for a, b in pts])
        if p.is_valid and not p.is_empty:
            pm = transform(a_m, p)
            centros.append(pm.centroid); areas.append(pm.area)
    return centros, areas


def base_veredas():
    """Por vereda: nombre, código y estructura 2018 (edad decenal [9], sexo [2]) de rural disperso + centros poblados."""
    veredas = list(leer_shp(GEO / 'veredas/CRVeredas_2020.shp', lambda d: d['DPTOMPIO'] == DANE))
    secciones = list(leer_shp(GEO / 'seccion_rural/MGN_ANM_SECCION_RURAL.shp', lambda d: d['MPIO_CDPMP'] == DANE))
    zonas_u = list(leer_shp(GEO / 'zona_urbana/MGN_ANM_ZU.shp', lambda d: d['MPIO_CDPMP'] == DANE))
    urbano = unary_union([transform(a_m, g.buffer(0)) for _, g in zonas_u])
    centros, areas = edificios()
    arbol = STRtree([centros[i] for i, a in enumerate(areas) if AREA_MIN <= a <= AREA_MAX and not urbano.contains(centros[i])])
    v_m = [transform(a_m, g.buffer(0)) for _, g in veredas]
    edad, sexo = np.zeros((len(veredas), 9)), np.zeros((len(veredas), 2))
    for d, g in secciones:                       # rural disperso, repartido por viviendas
        e, s = estructura(d)
        if not e.sum():
            continue
        gm = transform(a_m, g.buffer(0))
        trozos = [(i, gm.intersection(v)) for i, v in enumerate(v_m) if gm.intersects(v)]
        pesos = np.array([len(arbol.query(t, predicate='contains')) for _, t in trozos], float)
        if not pesos.sum():
            pesos = np.array([t.area for _, t in trozos])
        for (i, _), w in zip(trozos, pesos / pesos.sum()):
            edad[i] += e * w; sexo[i] += s * w
    sin_vereda = []
    for d, g in zonas_u:                          # centros poblados, a la vereda que contiene su centro
        if d['CLAS_CCDGO'] != '2':
            continue
        c = transform(a_m, g.buffer(0)).representative_point()
        i = next((i for i, v in enumerate(v_m) if v.contains(c)), None)
        if i is None:
            i = int(np.argmin([v.distance(c) for v in v_m])); sin_vereda.append(d['ZU_CDIVI'])
        e, s = estructura(d)
        edad[i] += e; sexo[i] += s
    if sin_vereda:
        print(f'centros poblados fuera de toda vereda, asignados a la más cercana: {sin_vereda}')
    info = [{'codigo': d['CODIGO_VER'], 'nombre': d['NOMBRE_VER'].title()} for d, _ in veredas]
    return info, edad, sexo


def ipf_semilla(semilla, edad10, sexo, vueltas=60):
    """Abre una estructura (sexo [2] × edad decenal [9]) en edades simples con la forma de `semilla` [2, EDADES]."""
    x = semilla.copy() + 1e-6
    tramo = [slice(10 * i, 10 * i + 10) for i in range(8)] + [slice(80, EDADES)]
    for _ in range(vueltas):
        for i, sl in enumerate(tramo):
            x[:, sl] *= edad10[i] / max(x[:, sl].sum(), 1e-9)
        x *= (sexo / np.maximum(x.sum(1), 1e-9))[:, None]
    return x


def ajustar_filas_columnas(x, filas, columnas, vueltas=200):
    """IPF de x [zonas, celdas]: cada zona suma `filas` y cada celda (sexo-edad) suma `columnas`."""
    x = x + 1e-9
    for _ in range(vueltas):
        x *= (filas / x.sum(1))[:, None]
        x *= (columnas / np.maximum(x.sum(0), 1e-12))[None, :]
    return x


def proyectar_zonas(serie, edad, sexo):
    """Participación por cohorte: devuelve {año: array[veredas, 2, EDADES]} que suma la serie rural en cada celda."""
    m18 = serie[('rural', A0)]
    abiertas = np.stack([ipf_semilla(m18, e, s) for e, s in zip(edad, sexo)])           # [V, 2, EDADES]
    total_v = edad.sum(1) / edad.sum() * m18.sum()                                       # tamaño relativo del censo
    x = ajustar_filas_columnas(abiertas.reshape(len(edad), -1), total_v, m18.ravel()).reshape(abiertas.shape)
    part = x / np.maximum(m18, 1e-12)[None]
    # fecundidad relativa de cada vereda en 2018: niños 0–4 por mujer de 15–49, frente al conjunto rural
    ninos = x[:, :, :5].sum((1, 2)); mujeres = x[:, 1, 15:50].sum(1)
    fec = (ninos / mujeres) / (m18[:, :5].sum() / m18[1, 15:50].sum())
    salida = {A0: x}
    for t in ANIOS[1:]:
        anterior, m, nueva = salida[t - 1], serie[('rural', t)], np.zeros_like(part)
        nueva[:, :, 1:-1] = part[:, :, :-2]
        pesos = anterior[:, :, -2:].sum(2) / np.maximum(serie[('rural', t - 1)][:, -2:].sum(1), 1e-12)
        nueva[:, :, -1] = pesos
        madres = anterior[:, 1, 14:49].sum(1) * fec                                     # mujeres que tendrán 15–49
        nueva[:, :, 0] = (madres / madres.sum())[:, None]
        nueva /= np.maximum(nueva.sum(0, keepdims=True), 1e-12)                          # cada celda suma 1
        part = nueva
        salida[t] = part * m[None]
    return salida


# ───────────────────────── salida ─────────────────────────
def redondeo_controlado(x, total):
    """Redondea x [zonas] a enteros que suman `total` (restos mayores)."""
    piso = np.floor(x).astype(int)
    falta = int(round(total)) - piso.sum()
    if falta > 0:
        piso[np.argsort(-(x - piso))[:falta]] += 1
    elif falta < 0:
        piso[np.argsort(x - piso)[:-falta]] -= 1
    return piso


def indicadores(g):
    """g [2, 17 grupos] → edad mediana aproximada, dependencia y envejecimiento."""
    t = g.sum(0)
    menores, mayores, activos = t[:3].sum(), t[13:].sum(), t[3:13].sum()
    acum, mitad, med = np.cumsum(t), t.sum() / 2, 0.0
    i = int(np.searchsorted(acum, mitad))
    if i < 16:
        antes = acum[i - 1] if i else 0
        med = 5 * i + 5 * (mitad - antes) / max(t[i], 1e-9)
    else:
        med = 80.0
    return {'edad_mediana': round(med, 1), 'dependencia': round(100 * (menores + mayores) / activos, 1),
            'envejecimiento': round(100 * mayores / max(menores, 1e-9), 1)}


def serie_anterior():
    """Serie municipal DANE anterior (2018–2035, solo totales por área), para comparar."""
    ruta = POB / 'anex-DCD-Proypoblacion-PerteneniaEtnicoRacialmun.xlsx'
    if not ruta.exists():
        return None
    ws = openpyxl.load_workbook(ruta, read_only=True).worksheets[0]
    d = defaultdict(dict)
    for f in ws.iter_rows(values_only=True):
        area = 'cabecera' if str(f[5]).startswith('Cabecera') else 'rural' if str(f[5]).startswith('Centros') else None
        if f[2] == DANE and str(f[4]).isdigit() and area:
            d[area][int(f[4])] = int(f[6])
    return {a: [d[a].get(t) for t in ANIOS] for a in AREAS}


def main():
    gob = comparar_gobernacion()
    ref, nombre_ref = leer_referencia()
    serie = extender(ref)
    info, edad, sexo = base_veredas()
    print(f'{len(info)} veredas; censo 2018 rural asignado {edad.sum():,.0f} personas')
    veredas = proyectar_zonas(serie, edad, sexo)

    zonas = [{'id': 'cabecera', 'nombre': 'Cabecera municipal', 'tipo': 'cabecera'}] + \
            [{'id': v['codigo'], 'nombre': v['nombre'], 'tipo': 'vereda', 'codigo': v['codigo']} for v in info]
    for z in zonas:
        z.update({'H': [], 'M': [], 'indicadores': []})
    for t in ANIOS:
        cab = a_grupos(serie[('cabecera', t)])
        rur = a_grupos(veredas[t])                                     # [V, 2, 17]
        objetivo = a_grupos(serie[('rural', t)])
        enteros = np.zeros(rur.shape, int)
        for s in range(2):
            for g in range(len(GRUPOS)):
                enteros[:, s, g] = redondeo_controlado(rur[:, s, g], objetivo[s, g])
        bloques = [np.rint(cab).astype(int)] + list(enteros)
        for z, b in zip(zonas, bloques):
            z['H'].append(b[0].tolist()); z['M'].append(b[1].tolist())
            z['indicadores'].append(indicadores(b.astype(float)))

    municipio = {a: {'H': [], 'M': []} for a in AREAS}
    for t in ANIOS:
        for a in AREAS:
            g = np.rint(a_grupos(serie[(a, t)])).astype(int)
            municipio[a]['H'].append(g[0].tolist()); municipio[a]['M'].append(g[1].tolist())

    datos = {
        'metadata': {
            'tipo': 'estimación', 'municipio': DANE, 'anios': ANIOS, 'oficial_hasta': A_OFICIAL, 'grupos': GRUPOS,
            'metodo': 'Municipio: DANE PPED 2018-2042 por área, sexo y edad simple; 2043-2050 por razones de cambio por '
                      f'cohorte de la {nombre_ref} corregidas por el diferencial de Girardota 2038-2042. Veredas: '
                      'estructura del Censo 2018 repartida por viviendas, abierta en edades simples por IPF y proyectada '
                      'por participación por cohorte, calibrada en cada año a la proyección rural del municipio.',
            'fuente': 'DANE (CNPV 2018, MGN 2018, veredas 2020, PPED 2018-2042 y 2018-2050), Gobernación de Antioquia '
                      '(POB_ANT 2006-2035), Overture Maps Foundation',
            'referencia_2043_2050': nombre_ref,
            'gobernacion': gob,
        },
        'municipio': municipio,
        'serie_anterior': serie_anterior(),
        'zonas': zonas,
    }
    destino = RAIZ / f'public/data/poblacion/{DANE}-edad.json'
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(datos, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{destino.relative_to(RAIZ)}  {destino.stat().st_size / 1024:.0f} KB')

    # resumen y comprobaciones
    for t in (2018, 2025, 2030, 2035, 2042, 2050):
        i = ANIOS.index(t)
        cab = sum(zonas[0]['H'][i]) + sum(zonas[0]['M'][i])
        rur = sum(sum(z['H'][i]) + sum(z['M'][i]) for z in zonas[1:])
        ofi = sum(serie[(a, t)].sum() for a in AREAS)
        ind = indicadores(a_grupos(serie[('cabecera', t)] + serie[('rural', t)]))
        print(f'{t}: cabecera {cab:,} + rural {rur:,} = {cab + rur:,} (serie {ofi:,.0f}) · mediana {ind["edad_mediana"]} '
              f'· dependencia {ind["dependencia"]} · envejecimiento {ind["envejecimiento"]}')


if __name__ == '__main__':
    main()
