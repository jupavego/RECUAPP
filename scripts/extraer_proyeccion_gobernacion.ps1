# Extrae del modelo de datos (Power Pivot) del libro de la Gobernación de Antioquia la población de un municipio por
# año, área, sexo y edad simple, y la guarda en el mismo formato que la serie del DANE:
#
#     insumos/poblacion/gobernacion/<codigo_dane>_area_sexo_edad.csv   (anio, area, sexo, edad 0..80, personas)
#
# La tabla visible del libro solo muestra totales; el detalle por edad está en la tabla POB_Mpal_2006-2035 del modelo,
# que se consulta con DAX a través de Excel (necesita Excel de escritorio instalado). La edad 80 es «80 años y más».
#
# Uso:  powershell -File scripts/extraer_proyeccion_gobernacion.ps1 [-Dane 05308]
# Datos © Gobernación de Antioquia, Departamento Administrativo de Planeación, POB_ANT 2006-2035 (ajuste de agosto de 2025).
param([string]$Dane = '05308')

$raiz = Split-Path -Parent $PSScriptRoot
$libro = Join-Path $raiz 'insumos\poblacion\POB_ANT_2006-2035_Ajust_Med_19-08-2025_pub.xlsx'
$carpeta = Join-Path $raiz 'insumos\poblacion\gobernacion'
New-Item -ItemType Directory -Force $carpeta | Out-Null
$copia = Join-Path $env:TEMP "pob_ant_$Dane.xlsx"
Copy-Item $libro $copia -Force   # se abre una copia de solo lectura para no tocar el original

$xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($copia, 0, $true)
  $wb.Model.Initialize()
  $cn = $wb.Model.DataModelConnection.ModelConnection.ADOConnection
  # columnas de la tabla: DP, DPNOM, DPMP, MPIO, AÑO, ÁREA GEOGRÁFICA, Genero, Edad, Edad_Num, Pob, Edad_decenal
  # (se leen por posición: PowerShell 5.1 lee este archivo sin BOM y desfigura la Ñ y la Á de los nombres)
  $rs = $cn.Execute("EVALUATE FILTER('POB_Mpal_2006-2035', 'POB_Mpal_2006-2035'[DPMP] = ""$Dane"")")
  $out = New-Object System.Collections.Generic.List[string]
  $out.Add('anio,area,sexo,edad,personas')
  while (-not $rs.EOF) {
    $f = $rs.Fields
    $sexo = if ([string]$f.Item(6).Value -like 'Hombre*') { 'H' } else { 'M' }
    $area = if ([string]$f.Item(5).Value -like 'Cabecera*') { 'cabecera' } else { 'rural' }
    $out.Add(('{0},{1},{2},{3},{4}' -f $f.Item(4).Value, $area, $sexo, $f.Item(8).Value, [math]::Round([double]$f.Item(9).Value)))
    $rs.MoveNext()
  }
  $rs.Close()
  $destino = Join-Path $carpeta "${Dane}_area_sexo_edad.csv"
  [IO.File]::WriteAllLines($destino, $out, [Text.UTF8Encoding]::new($false))
  "$($out.Count - 1) filas -> $destino"
} finally {
  if ($wb) { $wb.Close($false) }
  $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  Remove-Item $copia -ErrorAction SilentlyContinue
}
