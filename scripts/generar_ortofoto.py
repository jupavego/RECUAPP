"""Imagen satelital de un municipio (Sentinel-2 sin nubes de EOX, ~10 m), recortada al mismo recuadro que
el relieve y guardada en public/data/mapa3d/ortofoto-<id>.jpg para usarla como textura del terreno 3D.

Fuente: «Sentinel-2 cloudless – https://s2maps.eu» de EOX IT Services GmbH (contiene datos de Copernicus
Sentinel modificados 2020), licencia CC BY-NC-SA 4.0: sirve para prototipo; para producción hay que
reemplazarla por ortoimágenes con licencia adecuada (p. ej. IGAC).

Uso:  python scripts/generar_ortofoto.py [id_municipio]   (por defecto 49 = Girardota)
"""
import io, json, math, sys, urllib.request
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
MUNICIPIO = int(sys.argv[1]) if len(sys.argv) > 1 else 49
Z = 15
ANCHO = 3072

relieve = json.loads((RAIZ / f'public/data/mapa3d/relieve-{MUNICIPIO}.json').read_text(encoding='utf-8'))
oeste, sur, este, norte = relieve['bbox']


def px(lon, lat):
    n = 256 * 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


x0, y0 = px(oeste, norte)
x1, y1 = px(este, sur)
tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
mosaico = Image.new('RGB', ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        url = f'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{Z}/{ty}/{tx}.jpg'
        mosaico.paste(Image.open(io.BytesIO(urllib.request.urlopen(url).read())).convert('RGB'), ((tx - tx0) * 256, (ty - ty0) * 256))

recorte = mosaico.crop((round(x0 - tx0 * 256), round(y0 - ty0 * 256), round(x1 - tx0 * 256), round(y1 - ty0 * 256)))
alto = round(ANCHO * ((norte - sur) * 110574) / ((este - oeste) * 111320 * math.cos(math.radians((sur + norte) / 2))))
salida = RAIZ / f'public/data/mapa3d/ortofoto-{MUNICIPIO}.jpg'
recorte.resize((ANCHO, alto), Image.LANCZOS).save(salida, quality=88)
print(f'{ANCHO}x{alto}, {salida.stat().st_size / 1024:.0f} KB')
