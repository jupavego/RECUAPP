"""Baja la elevación abierta (AWS Terrain Tiles, formato Terrarium, ~30 m) de un municipio y la
guarda como una cuadrícula regular lon/lat en public/data/mapa3d/relieve-<id>.json.

Uso:  python scripts/generar_relieve.py [id_municipio]   (por defecto 49 = Girardota)
"""
import base64, io, json, math, sys, urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 else 49
Z = 13               # ~19 m por píxel; la fuente real es de ~30 m
MARGEN = 0.012       # grados alrededor del municipio, para que el relieve vecino rodee la "isla"
PASO_M = 25          # separación de la cuadrícula resultante, en metros

datos = json.loads((RAIZ / 'public/data/mapa/municipios.json').read_text(encoding='utf-8'))
m = next(x for x in datos['municipios'] if x['id'] == MUNICIPIO)
oeste, sur, este, norte = m['b']
oeste -= MARGEN; sur -= MARGEN; este += MARGEN; norte += MARGEN


def px(lon, lat):
    """lon/lat → píxel global (fraccionario) del mosaico Mercator en el zoom Z."""
    n = 256 * 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


x0, y0 = px(oeste, norte)
x1, y1 = px(este, sur)
tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
mosaico = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), dtype=np.float32)
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png'
        img = np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(url).read())).convert('RGB'), dtype=np.float32)
        mosaico[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = \
            img[..., 0] * 256 + img[..., 1] + img[..., 2] / 256 - 32768

lat0 = (sur + norte) / 2
m_lon = 111320 * math.cos(math.radians(lat0))
nx = int((este - oeste) * m_lon / PASO_M) + 1
ny = int((norte - sur) * 110574 / PASO_M) + 1
lons = np.linspace(oeste, este, nx)
lats = np.linspace(norte, sur, ny)          # fila 0 = norte
gx = np.array([px(lo, lats[0])[0] for lo in lons]) - tx0 * 256
gy = np.array([px(lons[0], la)[1] for la in lats]) - ty0 * 256
ix, iy = np.floor(gx).astype(int), np.floor(gy).astype(int)
fx, fy = (gx - ix)[None, :], (gy - iy)[:, None]
ix1, iy1 = np.minimum(ix + 1, mosaico.shape[1] - 1), np.minimum(iy + 1, mosaico.shape[0] - 1)
elev = (mosaico[iy][:, ix] * (1 - fx) * (1 - fy) + mosaico[iy][:, ix1] * fx * (1 - fy)
        + mosaico[iy1][:, ix] * (1 - fx) * fy + mosaico[iy1][:, ix1] * fx * fy)

dm = np.round(elev * 10).astype('<i2')       # decímetros
salida = RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json'
salida.parent.mkdir(parents=True, exist_ok=True)
salida.write_text(json.dumps({
    'bbox': [oeste, sur, este, norte], 'nx': nx, 'ny': ny, 'min': float(elev.min()), 'max': float(elev.max()),
    'dm': base64.b64encode(dm.tobytes()).decode(),
}), encoding='utf-8')
print(f'{m["n"]}: {nx}x{ny}, {elev.min():.0f}–{elev.max():.0f} m, {salida.stat().st_size / 1024:.0f} KB')
