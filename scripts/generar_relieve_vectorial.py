"""Convierte el relieve de public/data/mapa3d/relieve-<id>.json en curvas de nivel vectoriales (SVG)
para usarlas de fondo tenue: public/img/relieve-<id>.svg. Trazos negros sobre transparente: en la
página se pintan con el color del tema usando el SVG como máscara CSS.

Uso:  python scripts/generar_relieve_vectorial.py [id_municipio]   (por defecto 49 = Girardota)
"""
import base64, json, sys
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 else 49
BLOQUE = 5          # se promedia en bloques de 5x5: ~125 m; un fondo no necesita más detalle
CADA = 50           # una curva cada 50 m
MAESTRA = 5         # cada 5 curvas (250 m), una más gruesa

r = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
nx, ny = r['nx'], r['ny']
dm = np.frombuffer(base64.b64decode(r['dm']), dtype='<i2').reshape(ny, nx).astype(np.float32) / 10
h, w = ny // BLOQUE, nx // BLOQUE
z = dm[:h * BLOQUE, :w * BLOQUE].reshape(h, BLOQUE, w, BLOQUE).mean(axis=(1, 3))
k = np.array([1, 2, 1], dtype=np.float32) / 4        # suavizado leve para curvas limpias
for _ in range(4):                                   # varias pasadas: curvas largas y fluidas, sin dientes
    z = np.apply_along_axis(lambda v: np.convolve(np.pad(v, 1, mode='edge'), k, 'valid'), 0, z)
    z = np.apply_along_axis(lambda v: np.convolve(np.pad(v, 1, mode='edge'), k, 'valid'), 1, z)

# bits: 1=NO 2=NE 4=SE 8=SO por encima del nivel; aristas 0=N 1=E 2=S 3=O
CASOS = {1: [(3, 0)], 2: [(0, 1)], 3: [(3, 1)], 4: [(1, 2)], 6: [(0, 2)], 7: [(3, 2)], 8: [(3, 2)], 9: [(0, 2)],
         11: [(1, 2)], 12: [(3, 1)], 13: [(0, 1)], 14: [(3, 0)]}


def curvas(nivel):
    segs = []
    for i in range(h - 1):
        for j in range(w - 1):
            a, b, c, d = z[i, j], z[i, j + 1], z[i + 1, j + 1], z[i + 1, j]
            idx = (a > nivel) * 1 + (b > nivel) * 2 + (c > nivel) * 4 + (d > nivel) * 8
            if idx in (0, 15):
                continue

            def p(arista):
                if arista == 0: t = (nivel - a) / (b - a); return (j + t, i)
                if arista == 1: t = (nivel - b) / (c - b); return (j + 1, i + t)
                if arista == 2: t = (nivel - d) / (c - d); return (j + t, i + 1)
                t = (nivel - a) / (d - a); return (j, i + t)

            if idx in (5, 10):                                   # punto de silla: se resuelve con el promedio
                alto = (a + b + c + d) / 4 > nivel
                pares = [(0, 1), (3, 2)] if (idx == 5) == alto else [(3, 0), (1, 2)]
            else:
                pares = CASOS[idx]
            segs += [(p(e1), p(e2)) for e1, e2 in pares]
    return segs


def unir(segs):
    """une segmentos sueltos en polilíneas largas (mucho menos texto en el SVG)"""
    clave = lambda q: (round(q[0] * 50), round(q[1] * 50))
    por_punta = {}
    for n, (a, b) in enumerate(segs):
        por_punta.setdefault(clave(a), []).append(n); por_punta.setdefault(clave(b), []).append(n)
    usado, lineas = set(), []
    for n0, (a0, b0) in enumerate(segs):
        if n0 in usado:
            continue
        usado.add(n0)
        linea = [a0, b0]
        for sentido in (0, 1):
            while True:
                fin = linea[-1] if sentido == 0 else linea[0]
                sig = next((m for m in por_punta.get(clave(fin), []) if m not in usado), None)
                if sig is None:
                    break
                usado.add(sig)
                a, b = segs[sig]
                nuevo = b if clave(a) == clave(fin) else a
                linea = linea + [nuevo] if sentido == 0 else [nuevo] + linea
        lineas.append(linea)
    return lineas


def trazo(lineas, minimo=10):
    """curvas suaves: cada polilínea se dibuja como una cadena de cuadráticas que pasan por los puntos medios"""
    out = []
    for l in lineas:
        if len(l) < minimo:
            continue
        l = l[::2] + ([l[-1]] if len(l) % 2 == 0 else [])      # un punto de cada dos basta tras suavizar
        d = f'M{l[0][0]:.1f} {l[0][1]:.1f}'
        for a, b in zip(l[1:-1], l[2:]):
            d += f'Q{a[0]:.1f} {a[1]:.1f} {(a[0] + b[0]) / 2:.1f} {(a[1] + b[1]) / 2:.1f}'
        d += f'L{l[-1][0]:.1f} {l[-1][1]:.1f}'
        out.append(d)
    return ''.join(out)


finas, maestras = [], []
inicio = int(np.ceil(z.min() / CADA))
for n in range(inicio, int(z.max() // CADA) + 1):
    (maestras if n % MAESTRA == 0 else finas).extend(unir(curvas(n * CADA)))

ruta = RAIZ / f'public/img/relieve-{MUNICIPIO}.svg'
ruta.write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">'
    f'<path d="{trazo(finas)}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>'
    f'<path d="{trazo(maestras)}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>', encoding='utf-8')
print(f'{w}x{h}, {len(finas)} curvas finas, {len(maestras)} maestras, {ruta.stat().st_size / 1024:.0f} KB')
