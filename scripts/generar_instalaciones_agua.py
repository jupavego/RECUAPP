"""Instalaciones de agua de Girardota (bocatomas de acueductos veredales, sistemas de tratamiento rural, PTAR urbana proyectada) ubicadas
sobre la Figura 2-78 «Infraestructura de servicios públicos» del PBOT (Revisión y ajuste 2022, Documento de formulación, p. 345).

El mapa del PBOT está en MAGNA-SIRGAS Colombia Bogotá (EPSG:3116) con retícula cada 2 km. Se calibró con la retícula (12,73 m por píxel) y
se comprobó contra los tanques de EPM, cuyas coordenadas exactas se conocen: coinciden a menos de 1 px (~13 m). Los píxeles de cada símbolo
se detectaron por color en la figura (insumos/territorial/pbot/figuras/p345-1-Image1794.jpg, extraída del PDF); por eso la ubicación de cada
instalación es aproximada (± ~25 m).

    public/data/mapa3d/instalaciones-agua-49.json
        [[tipo, nombre, lon, lat, estado, radio_m], ...]
        tipo: bocatoma | ptar_rural | ptar_urbana | eca        estado: operación | proyecto

Uso:      python scripts/generar_instalaciones_agua.py
Requiere: pip install pyproj
"""
import json
from pathlib import Path

from pyproj import Transformer

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / 'public/data/mapa3d/instalaciones-agua-49.json'
# retícula de la figura: este 844.000 en x=242 px y norte 1.204.000 en y=101 px, 157,14 px cada 2 km
X0, E0, Y0, N0, M_PX = 242.0, 844000.0, 101.0, 1204000.0, 2000 / 157.14
a_ll = Transformer.from_crs(3116, 4326, always_xy=True)


def ll(px, py):
    lon, lat = a_ll.transform(E0 + (px - X0) * M_PX, N0 - (py - Y0) * M_PX)
    return round(lon, 6), round(lat, 6)


# píxeles de los símbolos de la figura (centro)
BOCATOMAS = [
    (345.6, 222.5), (576.2, 238.8), (537.7, 240.6), (428.4, 338.8), (548.8, 346.3), (570.6, 350.8), (624.5, 526.7), (855.9, 543.6),
    (888.0, 563.3), (347.1, 573.4), (857.0, 579.9), (549.6, 654.4), (861.8, 687.3), (736.5, 719.7), (920.1, 752.7), (897.3, 758.7),
    (876.2, 760.0), (456.0, 782.7), (695.9, 793.5), (555.7, 831.7), (677.5, 839.4), (704.9, 844.4), (629.2, 876.6), (461.5, 883.2),
    (825.9, 883.5), (467.4, 893.0), (464.4, 1034.7), (789.0, 1126.5),
]
# sistemas de tratamiento rural (morado), con la vereda en que cae según la figura 2-79
PTAR_RURAL = [(388.1, 555.5, 'Portachuelo'), (464.5, 541.7, 'El Paraíso'), (527.1, 530.9, 'Loma de los Ochoa'), (651.0, 483.6, 'San Andrés'),
              (463.2, 640.9, 'San Esteban')]
# áreas para desarrollo de la PTAR urbana (proyecto, no construida) y predio de la ECA; radio equivalente al área del símbolo
PTAR_URBANA = [(730.1, 566.7, 471, '1.ª etapa'), (719.0, 578.6, 111, '2.ª etapa')]
ECA = (746.0, 558.6, 89)

salida = []
for i, (x, y) in enumerate(BOCATOMAS, 1):
    lon, lat = ll(x, y)
    salida.append(['bocatoma', f'Bocatoma de acueducto veredal {i}', lon, lat, 'operación', 0])
for x, y, v in PTAR_RURAL:
    lon, lat = ll(x, y)
    salida.append(['ptar_rural', f'Sistema de tratamiento rural · {v}', lon, lat, 'operación', 0])
for x, y, a, etapa in PTAR_URBANA:
    lon, lat = ll(x, y)
    salida.append(['ptar_urbana', f'PTAR urbana de Girardota ({etapa}, proyecto)', lon, lat, 'proyecto', round((a / 3.14159) ** 0.5 * M_PX)])
lon, lat = ll(ECA[0], ECA[1])
salida.append(['eca', 'Predio de la ECA (estación de clasificación y aprovechamiento)', lon, lat, 'proyecto', round((ECA[2] / 3.14159) ** 0.5 * M_PX)])
SALIDA.write_text(json.dumps(salida, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
print(f'{len(salida)} instalaciones -> {SALIDA.relative_to(RAIZ)}')
