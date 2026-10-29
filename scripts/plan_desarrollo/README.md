# plan_desarrollo

Extrae de un Plan de Desarrollo Territorial en PDF: **líneas estratégicas, sectores, programas, indicadores de
producto y Plan Plurianual de Inversiones (PPI)**. Probado con Girardota 2024-2027.

Se ejecuta desde `scripts/` con un entorno que tenga `pymupdf4llm<2` (la 2.0 publicada está vacía) y, solo para
leer tablas-imagen con IA, `anthropic`.

## Flujo para un plan nuevo

```bash
python -m plan_desarrollo extraer plan.pdf salida/        # JSON + reporte.md + revision.json
python -m plan_desarrollo extraer plan.pdf salida/ --vision   # además lee con la API las páginas-imagen (ANTHROPIC_API_KEY)
```

1. Leer `salida/reporte.md`: qué cuadra, qué programas quedaron sin indicadores, qué páginas-imagen faltan.
2. Si el detector de rangos falla, fijarlos en `salida/config.json`: `{"paginas_cap2": [87, 252], "paginas_anexo": [312, 317]}`.
3. Revisar `salida/revision.json`. Para enseñar un alias (p. ej. un sector escrito distinto), añadir en el ítem
   `"correccion": {"alias": {"tipo": "sector", "canonico": "Salud Y Proteccion Social"}}` y ejecutar
   `python -m plan_desarrollo aprender salida/`; o directamente `alias sector "variante" "Canónico"`.
4. Con el plan ya revisado: `congelar salida/ nombre_plan` lo guarda en `golden/`. Cualquier cambio futuro al
   código se mide con `evaluar salida/ nombre_plan` (precisión y recall por categoría).

## Qué cambió al probar 7 planes (Girardota + 6)
Cada plan trae el mismo contenido con otra plantilla (orden y nombre de columnas, títulos, dónde va el
responsable). Por eso las tablas de indicadores se leen **por el texto del encabezado** (`columnas.py`), no por
posición, y se separan en `indicadores` (producto) e `indicadores_resultado`. Un título "Indicadores de
resultado" solo vale para la tabla que le sigue. El PPI se entrega como `ppi_tablas.json` (cualquier tabla con
columnas 2024-2027 y su nivel) además del formato por programa de Girardota.

### PPI de cualquier plan (`ppi_tablas.py`)
Las columnas (cada año y el total) se leen del encabezado, y la jerarquía línea → sector → programa se **infiere de
las sumas**: una fila es padre de las siguientes cuando estas suman su valor. Sale en `ppi_arbol.json` (con la
ruta de cada fila). Si el plan no trae el anexo de Girardota, los nombres del PPI sirven para cruzar los
indicadores y heredar su línea y sector. Un padre cuyos hijos no suman exacto queda sin hijos (no se adivina).

## Revisión humana de una muestra (la verdad con que se mide)
```bash
python -m plan_desarrollo muestra --plan itagui "<pdf>" insumos/plan_extraido/itagui [--plan ...] -n 20 -o insumos/plan_extraido/revision_muestra.html
```
Abrir el HTML, marcar cada fila como correcta/incorrecta comparando con la página del PDF (hay enlace) y descargar
`muestra_revisada.json`. Luego `python -m plan_desarrollo verificar muestra_revisada.json` lo guarda en `golden/`, y
`evaluar-verificadas <salida> <plan>` dice cuántas filas correctas siguen saliendo iguales y cuántas incorrectas
siguen saliendo tras un cambio de código.

### Definir las categorías con datos
`python -m plan_desarrollo categorias <carpetas...>` mide, por plan, qué campos existen y con qué cobertura (20 planes
hasta ahora). La página de revisión (`muestra ... --cobertura <todas las carpetas>`) muestra esa evidencia y deja marcar
cada categoría como obligatoria / recomendada / opcional / descartar, además de decisiones generales (nivel del PPI,
indicadores de resultado, alineación ODS/PND/PDD, nombres de niveles). `verificar` guarda las decisiones en
`conocimiento/categorias.json`. Las cifras no distinguen "el plan no lo trae" de "el parser no lo leyó".

## Qué es automático
- Conversión por página con caché, detección de rangos por contenido, parseo de tablas con texto.
- Reparación de ligaduras/glifos perdidos con el vocabulario del propio plan.
- Cruce programa ↔ PPI por similitud + alias aprendidos; sectores unificados al nombre del PPI.
- Validaciones: suma de programas vs resumen por sector, y totales de línea del anexo vs suma de filas.
- Tablas-imagen: `vision` renderiza las páginas candidatas y las lee con la API (una respuesta por página en
  `vision_api/`, no se vuelve a pagar). `comparar-vision` mide la API contra una lectura manual.

## Dónde aprende
- `conocimiento/alias.json`: alias de sector/programa (versionado con el código, lo usan todos los planes).
- `golden/*.json`: planes revisados; son las pruebas de regresión.

## Limitaciones conocidas
- **PDFs escaneados (sin capa de texto) se omiten** a propósito: `extraer` se detiene con un aviso. El OCR completo es caro y la calidad no está asegurada; lo correcto es pedir al municipio una versión con texto. Omitidos hasta ahora: Sabaneta, La Estrella y Copacabana.
- El golden de Girardota se re-congeló al detectar que contenía indicadores de resultado mezclados con los de producto y un nombre con glifo roto. Sus 52 indicadores por visión siguen sin doble verificación. Los otros 6 planes no tienen golden.
- Las reglas de estructura asumen títulos "Línea estratégica N / Sector X / Programa Y" y el pie
  "Indicadores de producto programa X". Otro formato obliga a ajustar `estructura.py`.
- La lectura por API no se ha probado aún (sin API key en este entorno).
