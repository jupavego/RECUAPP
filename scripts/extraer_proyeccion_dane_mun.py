"""Extrae de la proyección municipal del DANE (PPED, actualización 2025) las filas de un municipio y las guarda livianas:

    insumos/poblacion/dane_pped/<codigo_dane>_area_sexo_edad.csv   (año, área, sexo, edad simple 0..100, personas)

Entrada:  insumos/poblacion/dane_pped/PPED-AreaSexoEdadMun-2018-2042_VP.xlsx  (132 MB, no va a git)
          https://www.dane.gov.co/files/censo2018/proyecciones-de-poblacion/Municipal/PPED-AreaSexoEdadMun-2018-2042_VP.xlsx
Uso:      python -I scripts/extraer_proyeccion_dane_mun.py [codigo_dane]   (por defecto 05308 = Girardota)

Datos © DANE, Proyecciones de población y estudios demográficos (PPED), 2018-2042.
"""
import csv, sys
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parent.parent
DANE = sys.argv[1] if len(sys.argv) > 1 else '05308'
CARPETA = RAIZ / 'insumos/poblacion/dane_pped'
AREAS = {'Cabecera Municipal': 'cabecera', 'Centros Poblados y Rural Disperso': 'rural', 'Total': 'total'}

ws = openpyxl.load_workbook(CARPETA / 'PPED-AreaSexoEdadMun-2018-2042_VP.xlsx', read_only=True).worksheets[-1]
filas = ws.iter_rows(values_only=True)
cab = None
for f in filas:
    if f[6] == 'Total' and f[7] == 'Hombres':
        cab = f
        break
# columnas «Hombres N años» y «Mujeres N años»; la última edad es «100 años y más»
cols = []
for i, c in enumerate(cab):
    if isinstance(c, str) and (c.startswith('Hombres ') or c.startswith('Mujeres ')) and 'año' in c:
        sexo = 'H' if c.startswith('Hombres') else 'M'
        cols.append((i, sexo, int(c.split()[1])))
assert len(cols) == 202, len(cols)

salida = []
for f in filas:
    if f[2] != DANE:   # el encabezado dice MPIO, DPMP pero la 3.ª columna es el código y la 4.ª el nombre
        continue
    anio, area = int(f[4]), AREAS[f[5]]
    suma = 0
    for i, sexo, edad in cols:
        salida.append((anio, area, sexo, edad, int(f[i])))
        suma += int(f[i])
    assert suma == int(f[6]), (anio, area, suma, f[6])

destino = CARPETA / f'{DANE}_area_sexo_edad.csv'
with destino.open('w', newline='', encoding='utf-8') as o:
    w = csv.writer(o)
    w.writerow(['anio', 'area', 'sexo', 'edad', 'personas'])
    w.writerows(salida)
print(f'{len(salida)} filas -> {destino.relative_to(RAIZ)}')
