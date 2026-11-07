"""Proyecta el tráfico del peaje El Trapiche (Autopista Norte, km 25, Girardota) y lo guarda para el mapa 3D:

    public/data/mapa3d/trafico-trapiche-<id>.json

Datos: «Tráfico Vehicular ANI» (datos.gov.co, 8yi9-t44c), vehículos por mes y categoría de tarifa desde ago-2021.
Las motos no pagan peaje, así que no están en la cuenta. Se descarga una vez a insumos/movilidad/ (ver --descargar).

Método:
  1. Serie mensual de vehículos por día (total del mes / días del mes), para que febrero no parezca una caída.
  2. Modelo log-lineal con tendencia y un efecto fijo por mes (estacionalidad):  ln(v) = a + b·t + m[mes] + e.
     Se ajusta por mínimos cuadrados. Ago-2023 repite exactamente la cifra de jul-2023 (dato duplicado en la fuente):
     se excluye del ajuste.
  3. Validación fuera de muestra: se ajusta hasta may-2025 y se predicen los 12 meses siguientes (error MAPE).
  4. Escenarios a 2035 a partir del último año observado, con la estacionalidad del modelo:
       alto  = la tendencia estimada se mantiene;
       medio = el crecimiento converge a 3,0 % anual (elasticidad ~1 al PIB de largo plazo), mitad del camino en 3 años;
       bajo  = el crecimiento converge a 1,5 % anual (población + motorización), mitad del camino en 2 años.
     Banda de incertidumbre mensual: ±1,96 desviaciones del residuo del modelo.

Uso:  python -I scripts/proyectar_trafico_trapiche.py [--descargar]
"""
import calendar, json, math, sys, urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = 49
CRUDO = RAIZ / 'insumos/movilidad/ani-peajes-trapiche-cabildo.json'
SALIDA = RAIZ / f'public/data/mapa3d/trafico-trapiche-{MUNICIPIO}.json'
URL = ("https://www.datos.gov.co/resource/8yi9-t44c.json?$where=peaje%20in('TRAPICHE','CABILDO')"
       "&$limit=5000&$order=desde")
HASTA = 2035
EXCLUIR = {'2023-08'}                     # repite la cifra de 2023-07
PESADOS = {'IV', 'V', 'VI', 'VII', 'IVE', 'VE'}

if '--descargar' in sys.argv or not CRUDO.exists():
    CRUDO.parent.mkdir(parents=True, exist_ok=True)
    CRUDO.write_bytes(urllib.request.urlopen(URL, timeout=60).read())

filas = [r for r in json.loads(CRUDO.read_text(encoding='utf-8')) if r['peaje'] == 'TRAPICHE']
mes_total, mes_pesados = defaultdict(int), defaultdict(int)
for r in filas:
    k = r['desde'][:7]
    n = int(r['cantidadtrafico'])
    mes_total[k] += n
    if r['categoriatarifa'] in PESADOS: mes_pesados[k] += n
meses = sorted(mes_total)
dias = lambda k: calendar.monthrange(int(k[:4]), int(k[5:]))[1]
vd = np.array([mes_total[k] / dias(k) for k in meses])
t0 = int(meses[0][:4]) * 12 + int(meses[0][5:]) - 1
idx = lambda k: int(k[:4]) * 12 + int(k[5:]) - 1 - t0


def diseno(ts, mm):
    X = np.zeros((len(ts), 13))
    X[:, 0] = 1
    X[:, 1] = np.asarray(ts) / 12.0       # tendencia en años
    for i, m in enumerate(mm):
        if m != 1: X[i, m] = 1             # enero es la base
    return X


def ajustar(ks):
    ks = [k for k in ks if k not in EXCLUIR]
    X = diseno([idx(k) for k in ks], [int(k[5:]) for k in ks])
    y = np.log([mes_total[k] / dias(k) for k in ks])
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    res = y - X @ b
    sd = float(np.sqrt(res @ res / (len(y) - X.shape[1])))
    r2 = 1 - (res @ res) / ((y - y.mean()) @ (y - y.mean()))
    return b, sd, float(r2)


b, sd, r2 = ajustar(meses)
crec_tendencia = math.exp(b[1]) - 1
estacional = {m: math.exp(b[m] if m != 1 else 0.0) for m in range(1, 13)}
prom = sum(estacional.values()) / 12
estacional = {m: v / prom for m, v in estacional.items()}   # factor del mes respecto al promedio del año

# validación: ajusta hasta may-2025 y predice jun-2025..may-2026
corte = [k for k in meses if k <= '2025-05']
prueba = [k for k in meses if k > '2025-05' and k not in EXCLUIR][:12]
bv, _, _ = ajustar(corte)
pred = np.exp(diseno([idx(k) for k in prueba], [int(k[5:]) for k in prueba]) @ bv)
real = np.array([mes_total[k] / dias(k) for k in prueba])
mape = float(np.mean(np.abs(pred - real) / real))
sesgo = float(np.mean((pred - real) / real))

# años completos observados
anual = defaultdict(int)
for k in meses: anual[int(k[:4])] += mes_total[k]
completos = {a: v for a, v in anual.items() if sum(1 for k in meses if k.startswith(str(a))) == 12}
ultimo = max(completos)
base_diaria = completos[ultimo] / (366 if calendar.isleap(ultimo) else 365)
pesados_pct = sum(mes_pesados[k] for k in meses if k.startswith(str(ultimo))) / completos[ultimo]

# el año en curso (parcial) ya observado sirve para anclar: crecimiento ene-may del último año vs el anterior
parcial = [k for k in meses if k.startswith(str(ultimo + 1))]
crec_parcial = (sum(mes_total[k] for k in parcial) /
                sum(mes_total[f'{ultimo}-{k[5:]}'] for k in parcial) - 1) if parcial else None


def escenario(meta, media_vida):
    """Crecimiento anual que va de la tendencia observada hacia `meta` (media_vida en años); None = constante."""
    serie, v = {}, base_diaria
    for i, a in enumerate(range(ultimo + 1, HASTA + 1), start=1):
        g = crec_tendencia if meta is None else meta + (crec_tendencia - meta) * 0.5 ** (i / media_vida)
        v *= 1 + g
        serie[a] = {'tpd': round(v), 'crec': round(g, 4)}
    return serie


esc = {'alto': escenario(None, 1), 'medio': escenario(0.03, 3), 'bajo': escenario(0.015, 2)}

# pronóstico mensual del escenario medio para los 12 meses siguientes al último dato, con banda
ult = meses[-1]
mensual = []
for j in range(1, 13):
    n = idx(ult) + j
    a, m = (t0 + n) // 12, (t0 + n) % 12 + 1
    anio = esc['medio'].get(a) or {'tpd': base_diaria}
    v = anio['tpd'] * estacional[m]
    mensual.append({'mes': f'{a}-{m:02d}', 'vd': round(v), 'min': round(v * math.exp(-1.96 * sd)),
                    'max': round(v * math.exp(1.96 * sd))})

salida = {
    'peaje': 'El Trapiche', 'via': 'Autopista Norte (Ruta 62), km 25', 'lat': 6.3997, 'lon': -75.4330,
    'fuente': 'ANI · Tráfico Vehicular (datos.gov.co 8yi9-t44c)', 'nota': 'vehículos que pagan peaje; las motos no se cuentan',
    'observado': {'meses': meses, 'vd': [round(x) for x in vd],
                  'anual': {str(a): v for a, v in sorted(anual.items())}, 'excluidos': sorted(EXCLUIR)},
    'modelo': {'tipo': 'log-lineal con tendencia y estacionalidad mensual (MCO)', 'r2': round(r2, 3),
               'crec_tendencia': round(crec_tendencia, 4), 'sd_log': round(sd, 4),
               'estacional': {str(m): round(v, 3) for m, v in estacional.items()},
               'validacion': {'entrena_hasta': '2025-05', 'meses': len(prueba), 'mape': round(mape, 4), 'sesgo': round(sesgo, 4)}},
    'base': {'anio': ultimo, 'tpd': round(base_diaria), 'pesados_pct': round(pesados_pct, 3),
             'crec_parcial_siguiente': None if crec_parcial is None else round(crec_parcial, 4),
             'meses_parcial': len(parcial)},
    'escenarios': esc, 'mensual_medio': mensual,
}
SALIDA.write_text(json.dumps(salida, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

print(f'meses {meses[0]}..{meses[-1]} ({len(meses)}), R² {r2:.3f}, tendencia {crec_tendencia:+.1%}/año, sd {sd:.3f}')
print(f'validación jun-2025..may-2026: MAPE {mape:.1%}, sesgo {sesgo:+.1%}')
print(f'base {ultimo}: {base_diaria:,.0f} veh/día, pesados {pesados_pct:.0%}; ene-may {ultimo + 1} vs {ultimo}: {crec_parcial:+.1%}')
for n, s in esc.items(): print(n, {a: s[a]['tpd'] for a in (2026, 2030, 2035)})
print('estacional', {m: round(v, 2) for m, v in estacional.items()})
