# Marco normativo y metodológico de los planes de desarrollo municipal (Colombia)

Estado: **borrador de investigación**. Cada afirmación lleva su nivel de verificación:
- **Verificado**: leído en una fuente (enlace o archivo local).
- **Por verificar**: viene de la investigación previa pegada por el usuario o de memoria; falta abrir la fuente.

## 1. Ley 152 de 1994 (Ley Orgánica del Plan de Desarrollo)

Verificado en [relatoria.colombiacompra.gov.co](https://relatoria.colombiacompra.gov.co/normativa/ley-152-de-1994) (resumen automático; confirmar literales contra el texto en Función Pública o SUIN-Juriscol, cuyos certificados fallaron desde aquí).

- Art. 3, principios: a autonomía, b ordenación de competencias, c coordinación, d consistencia (con el marco fiscal), e prioridad del gasto público social, f continuidad, g participación, h sustentabilidad ambiental, i desarrollo armónico de las regiones, j proceso de planeación, k eficiencia, l viabilidad, m coherencia, n conformación de los planes (parte estratégica + plan de inversiones).
- Art. 31: el plan territorial tiene **una parte estratégica y un plan de inversiones a mediano y corto plazo**. Es la columna vertebral del esquema.
- Arts. 33-34: Consejo Territorial de Planeación (representantes de sectores económico, social, ecológico, educativo, cultural, comunitario).
- Art. 39: el plan sigue el **programa de gobierno inscrito** por el alcalde electo; el Consejo de Gobierno lo consolida en 2 meses desde la posesión; el CTP tiene 1 mes para concepto.
- Art. 40: se presenta al Concejo dentro de los 4 primeros meses; el Concejo tiene 1 mes; si no decide, el alcalde puede adoptarlo por decreto.
- Arts. 41-43: planes de acción por secretaría, evaluación de gestión y resultados, informe anual de ejecución.
- Art. 29 (nivel nacional, aplicable por analogía, art. 36): plan indicativo cuatrienal con planes de acción anuales como base de la evaluación.

Consecuencia para la app: el plan **no es un documento libre**. Siempre debe tener parte estratégica (líneas → sectores → programas → indicadores/metas) y plan de inversiones (PPI). Un plan que no trae PPI o metas está incompleto frente al art. 31, no es solo "otro formato".

## 2. Kit de Planeación Territorial (KPT) del DNP

Verificado indirectamente (guías del KPT alojadas por gobernaciones, versión 2020; falta confirmar la vigente 2024-2027 en portalterritorial.dnp.gov.co/kpt):
- Unidades: generalidades, equipo territorial, 1 líneas estratégicas, 2 diagnóstico, 3 plan estratégico, 4 plan plurianual de inversiones.
- Plan estratégico = identificar y priorizar indicadores que miden los resultados de las líneas estratégicas.
- PPI = plan de financiamiento indicativo con la proyección de recursos para las metas del plan estratégico.
- Plan indicativo = instrumento que traduce el plan en productos, metas e indicadores con programación anual.

### 2b. Lineamientos oficiales de formulación 2024-2027 (DNP, 30-nov-2023)
Verificado (PDF de 18 páginas leído completo: [colaboracion.dnp.gov.co, producto 5744](https://colaboracion.dnp.gov.co/CDT/Desarrollo%20Territorial/Portal%20Territorial/ATT/5744%20-%20Documento%20Lineamientos%20Formulaci%C3%B3n%20Planes%20de%20Desarrollo%20Territoriales%20Final.pdf)). Es un protocolo de acompañamiento del DNP, no una norma.
- Normas de referencia obligatoria además de la Ley 152: Ley 131 y 134 de 1994 y Ley 1757 de 2015 (voto programático: el programa de gobierno es la base y su incumplimiento puede llevar a revocatoria); **Decreto 1865 de 1994** (la CAR/Corporación recibe copia del proyecto y emite concepto en 15 días); **Ley 1909 de 2018 art. 22** (publicar programas y proyectos del PPI en la web y hacer **audiencias públicas del PPI**).
- Calendario 2024: proyecto al CTP y a la CAR el 29-feb; concepto CAR 15-mar; concepto CTP 31-mar; luego audiencias públicas del PPI, proyecto de acuerdo, dos rondas de discusión (comisión y plenaria), publicación del PDT aprobado en la web.
- Contenido exigido por el DNP: documento base con **Parte Estratégica + Plan Plurianual de Inversiones**, más un **capítulo independiente de regalías y un capítulo de paz**.
- Armonización con: PND "Colombia Potencia Mundial de la Vida 2022-2026" (cinco transformaciones: ordenamiento alrededor del agua, seguridad humana y justicia social, derecho humano a la alimentación, transformación productiva/internacionalización/acción climática, convergencia regional) y 18 metas trazadoras (catastro multipropósito, déficit habitacional, deforestación, conectividad digital, mortalidad materna, siniestros viales, etc.), plan quinquenal de las CAR y apuestas subregionales.
- Efecto en nuestros datos: PND/ODS/paz/PDET son **campos de alineación** legítimos pero opcionales; los capítulos de regalías y paz explican por qué algunos planes traen secciones aparte.

### 2c. Guía de Plan Indicativo del DNP: el esquema canónico
Verificado (PDF de 25 páginas leído; es la versión del ciclo 2020-2023 con ejemplo "meta 2023", [copia de la Gobernación del Valle](https://ogpt.valledelcauca.gov.co/storage/Clientes/ogpt/principal/imagenes/contenidos/3420-guia%20de%20orientaciones%20plan%20indicativo.pdf); el DNP publica una versión en [Portal Territorial KPT](https://colaboracion.dnp.gov.co/CDT/Desarrollo%20Territorial/Portal%20Territorial/KPT/Guia%20de%20Orientaciones%20Plan%20Indicativo.pdf) que no pude abrir para comparar).

Estructura del plan según el KPT: **Línea estratégica → Indicador de bienestar/resultado → Programa → Producto → Indicador(es) de producto**. Es exactamente la jerarquía que ya extraemos.

Columnas del formato Excel del Plan Indicativo (la lista que debería guiar nuestro esquema):
1. Código DANE departamento y municipio (DIVIPOLA) y nombres.
2. Línea estratégica / dimensión / eje / pilar.
3. Indicador de bienestar/resultado, línea base, unidad de medida, **meta de resultado del cuatrienio** (+ hasta 3 metas de resultado indirecto).
4. Programa del PDT, **programa y código según el Manual de Clasificación Programática**, sector FUT (para planes hechos con sectores FUT) y sector del Manual.
5. Producto del PDT, **producto y código según el catálogo de productos de la MGA**, indicador de producto y su código.
6. Línea base de producto, unidad de medida, **meta de producto del cuatrienio** (no acumulada), **orientación de la meta (mantenimiento / incremento)**.
7. ODS de producto; aporte a construcción de paz (pilar del Plan Marco de Implementación) y a la política de víctimas; iniciativa PDET (código, pilar, nivel).
8. **Responsable** (dependencia).
9. Programación física anual (cuatro vigencias) y, en la matriz completa, programación financiera por fuente.

Reglas de calidad que el propio DNP da (tablas 3 y 5 de la guía): meta de resultado sin productos, meta de producto sin resultado, indicador inconsistente con la meta, metas ambiguas, **plan sin metas**, metas que no son competencia del municipio, **metas de gestión (van al Plan de Acción, no al plan indicativo)**, programas distintos a los del Manual. Los planes que no usaron el Manual ni el catálogo MGA pueden **homologarse**; por eso muchos planes no traen códigos.

Consecuencias directas para nuestro esquema:
- Nuestros campos (nombre, unidad, línea base, meta, responsable, programa, línea, sector, código) coinciden con el formato DNP. Faltan: `orientacion` (mantenimiento/incremento), `ods`, `codigo_dane`, `programacion_anual`, `meta_resultado` ligada al programa.
- Distinguir en el dato indicadores de **gestión** de los de **producto** (los de gestión no deberían estar en el plan indicativo, pero muchos municipios los incluyen).
- La relación **resultado → programa → producto** es la que ya buscamos con las tablas "híbridas"; en el estándar DNP cada programa lleva su indicador de bienestar.

## 3. Clasificación de la inversión pública del DNP (la pieza que más nos sirve)

Verificado en el manual descargado (v5, mayo 2018, copia de Riohacha; hay v6.7 de 2023 por confirmar). Texto local: `scratchpad/manual_clasif.txt`.
- Niveles: **Sector (2 dígitos) → Programa (4 dígitos: sector + 2) → Subprograma → Producto → Indicador de producto**.
- Los programas son sectoriales y excluyentes; un proyecto va en un solo programa.
- Dos tipos de programa: misionales (producen bienes y servicios, tienen marco de desempeño) y de **fortalecimiento de la gestión y dirección del sector** (código terminado en 99, sin marco de desempeño).
- Sectores relevantes en municipios: 17 Agricultura, 19 Salud, 22 Educación, 24 Transporte, 32 Ambiente, 33 Cultura, 35 Comercio/Industria/Turismo, 36 Trabajo, 40 Vivienda, 41 Inclusión social, 43 Deporte, 45 Gobierno territorial; 140 programas en total.
- Fundamento: art. 2.2.6.2.1 del Decreto 1082 de 2015 y art. 148 de la Ley 1753 de 2015 (inversión orientada a resultados).

### Hallazgo con nuestros datos
Los códigos que traen los indicadores extraídos **son los del catálogo DNP**: los 2 primeros dígitos son el sector y los 4 primeros el programa (ejemplos reales: `190303100` → salud / 1903; `220206200` → educación / 2202; `240211600` → transporte / 2402).
Medido sobre `indicadores.json` de 95 planes (18.101 indicadores de producto):
- 4.151 (23 %) traen código de 6 a 9 dígitos; 21 planes lo traen en la mayoría de sus filas.
- Largos: 9 dígitos (producto + indicador) 2.102; 7 dígitos (producto) 1.600; 6 dígitos 436.
- Sectores más frecuentes: 45 Gobierno territorial, 41 Inclusión social, 40 Vivienda, 22 Educación, 19 Salud, 32 Ambiente, 17 Agricultura, 24 Transporte, 43 Deporte.
- Cuidado: los códigos de 6 dígitos (p. ej. Guatapé `010101`) parecen **numeración propia del municipio** y no del DNP; hay que validarlos contra el catálogo antes de derivar sector.

Implicación: donde hay código, el sector y el programa se asignan **sin adivinar** (exacto). Donde no hay, se clasifica por texto con el diccionario y se marca como "inferido".

### Catálogo de productos MGA
Verificado en búsqueda (DNP, [Catálogos](https://www.dnp.gov.co/LaEntidad_/subdireccion-general-inversiones-seguimiento-evaluacion/direccion-proyectos-informacion-para-inversion-publica/Paginas/catalagos.aspx) y [Guía orientadora para la definición de productos](https://colaboracion.dnp.gov.co/CDT/proyectosinformacioninversionpublica/manuales/guia_orientadora_definicion_de_productos.pdf)): el catálogo estandariza los bienes y servicios por sector, programa, subprograma y producto. Código de **programa = 4 dígitos (2 de sector)**, código de **producto = 7 dígitos** (ej. 3302079), y el indicador de producto agrega dígitos (ej. 170400300 para el producto 1704003). Eso explica los largos 7 y 9 de nuestros datos. El Excel del catálogo se publica en las ayudas de la MGA (mgaayuda.dnp.gov.co); **no lo he descargado**: es el diccionario exacto para validar códigos y nombres de producto.
- El manual de clasificación se actualiza cada 4 años (vigente 2020-2023 según una publicación del DNP); la guía del Plan Indicativo cita la **v6** del manual. Falta confirmar la versión para 2024-2027.

### 3b. Prueba de SisPT y del catálogo (29-oct-2026)

**Catálogo de productos MGA: descargado y legible.** `https://mgaayuda.dnp.gov.co/Recursos/CATALOGO_DE_PRODUCTOS.xlsx` (2,4 MB, fecha de descarga 26-oct-2026, vigente 2026). Hojas: Sectores (33), Sectores-Programas-Subprogramas (219 filas), **Catálogo de Productos MGA-PIIP (11.213 filas: sector, programa, producto 7 dígitos, indicador de producto 9 dígitos, unidad, "medido a través de", indicador principal)**, productos con EDT, entregables, actividades y **ODS** (171 metas). Es el diccionario exacto para validar y completar códigos.

**SisPT publica el Plan Indicativo de cada entidad ya normalizado, sin autenticación.**
- Lista de entidades con código DANE: `GET https://sispt.dnp.gov.co/api/pu/entidadterritorial`.
- Excel por entidad: `GET https://sispt.dnp.gov.co/api/pu/PDT/Excel/Entidad/{codigo_dane}` (ej. 05002 Abejorral, 63 KB). Es el mismo botón de descarga de la página "Programación y formulación"; la página lo ofrece a cualquier visitante. Desde Python hay que enviar un `User-Agent` (curl de Windows falla el handshake TLS).
- Hojas del Excel: **Líneas estratégicas**, **Indicadores de resultado** (con meta, si está en el PND y transformación PND), **Plan indicativo - Productos** (86 columnas: línea, sector, programa, producto e indicador MGA con códigos, personalización del indicador, unidad, meta del cuatrienio, indicador principal, ODS, tipo de acumulación, programación física anual y financiera por fuente: recursos propios, SGP por sector, crédito, cofinanciación, otros), **Plan indicativo SGR**, **Iniciativas SGR**, **Iniciativas PATR**.
- También: `SisPT - Resumen PI.xlsx` (alertas por entidad: indicadores de producto cargados, con programación física/financiera, calidad de BPIN, si cargó PPI) y un SharePoint con los PDF de los PDT 2024-2027.
- Cifras de la portada (jun-2026): 1.124 entidades con programación 2025 y 147.908 indicadores de producto.

**Qué cambia:** esto es el esquema objetivo **poblado con datos oficiales** para los 125 municipios, incluidos los 28 que no pudimos leer (escaneados o con tablas-imagen). Nuestro extractor de PDF deja de ser la fuente principal de indicadores y pasa a: validar, aportar lo que SisPT no trae (diagnóstico, texto de programas, PPI por programa en el plan aprobado) y servir de respaldo cuando SisPT esté incompleto.

**Medición contra nuestros datos (indicativa, no concluyente):**
- Conteo de indicadores de producto SisPT vs. nuestro `indicadores.json`, 98 municipios emparejados por nombre: mediana de nuestro/SisPT = 0,86; solo 36 de 98 dentro de ±20 %. Los 13 con cero o casi cero son los ya conocidos como ilegibles (Alejandría, Caracolí, Giraldo, Olaya, San José de la Montaña, San Roque, Turbo, Murindó…). Varios municipios nuestros superan en más de 30 % a SisPT (Medellín 856 vs 596, Envigado 567 vs 317, Apartadó 539 vs 339): puede ser duplicación nuestra o que el PDT aprobado traiga más que lo cargado en SisPT; hay que revisarlo. 27 municipios no se emparejaron por diferencia de nombre/carpeta, no necesariamente por falta.
- Prueba fina en Abejorral: SisPT trae 198 filas (195 indicadores MGA distintos); nosotros extrajimos 148 filas con 109 códigos distintos y **107 de esos 109 coinciden con SisPT (98 %)**. Los códigos venían dentro del nombre ("... (450108100)"), no en el campo `codigo`: contando también los códigos embebidos, el **28 %** de los indicadores (4.995 de 18.101) trae código, no el 23 % medido antes.

**Pendiente de decisión (el usuario):** descargar los 125 Excel (≈125 × ~60-100 KB) a una carpeta de insumos. Es contenido público del DNP, pero no hay aviso explícito de licencia/uso en lo que leí; conviene confirmar condiciones de reutilización (datos abiertos) antes de redistribuirlo dentro de la app, y hacer la descarga con pausas para no cargar el servidor.

## 4. Por verificar

- Otras guías: orientaciones para la formulación de PDT (versión 2024), enfoque a resultados, Kit de Seguimiento.
- **SisPT** ([sispt.dnp.gov.co](https://sispt.dnp.gov.co/reportes/default-reportes)) publica "consulta pública de información del PDT 2024-2027" y alertas de cargue: los municipios cargan allí sus planes estructurados. Si es consultable o descargable, sería **la fuente oficial estructurada** para contrastar y completar nuestra extracción (y para los 28 planes que no pudimos leer). Prioridad alta.
- TerriData como fuente de línea base de diagnóstico (permitiría validar `linea_base` de los planes).
- Cartilla de prioridades ambientales PDT 2024-2027 (MinAmbiente) y cartilla de planeación participativa (CNP).
- Ley 388/1997 (armonización con POT) y Ley 1757/2015 (CTP): sin fuente abierta aún. Ley 819/2003 (Marco Fiscal de Mediano Plazo anual) y Ley 617/2000 (categorización y límites de gasto de funcionamiento): confirmadas solo en informes de entidades, no en el texto de la ley. Decreto 1499/2017 (MIPG, política de participación) confirmado en documentos de terceros.
- Las "14 dimensiones" y los "5 niveles" de la investigación previa son **síntesis propia**, no norma; úsense como lista de chequeo, no como requisito legal.

## 5. Qué cambia en la arquitectura de RECUAPP

1. **Taxonomía oficial como eje**: sector (2 dígitos) y programa (4 dígitos) del DNP son la llave común entre municipios, mejor que inventar un diccionario. Cargar los 140 programas como catálogo.
2. **Dos tipos de dato por indicador**: `clasificacion = codigo_dnp | inferida_texto`, con el código guardado cuando existe.
3. **Lista de cumplimiento estructural por plan** (no puntaje oficial): ¿tiene parte estratégica?, ¿PPI?, ¿indicadores de producto con línea base y meta?, ¿de resultado?, ¿responsables?, ¿códigos DNP? Ya la cubre en parte `RESUMEN.md`.
4. **Alineación PND/PDD/ODS** es opcional (casi no aparece); no condicionar el esquema a ella.
5. **Adoptar como esquema destino el formato del Plan Indicativo del DNP** (sección 2c): campos DANE, línea, resultado, programa (+código), producto (+código MGA), indicador, línea base, meta, orientación, ODS, responsable, programación anual. Lo que el plan no trae queda vacío con motivo ("no lo trae" vs "no se leyó").
6. **Buscar primero el dato oficial**: revisar si SisPT/KPT permite consultar o descargar los PDT 2024-2027 cargados por los municipios; de ser así, nuestro extractor pasa a validar y completar, no a ser la única fuente.
7. Para conectar con proyectos públicos: llave **municipio + sector (2 dígitos) + programa (4 dígitos)**; el BPIN/SUIFP clasifica los proyectos con el mismo catálogo, así que la unión sería directa. (Por verificar contra el SUIFP.)

## 3c. Descarga y consolidado de SisPT (125 municipios de Antioquia)

- Excel originales: `insumos/sispt_plan_indicativo/<dane>.xlsx` (11 MB). Consolidado: `insumos/sispt_plan_indicativo/consolidado/` (`lineas.csv` 666 filas, `resultado.csv` 3.307, `productos.csv` 26.507 con 86 columnas, `resumen.csv`). Se regenera con `plan_desarrollo/sispt.py`.
- Los 125 traen productos (mediana 195 por municipio, mínimo 59, máximo 726) y todos con código de producto MGA.
- Al emparejar por nombre, unos 35 municipios no tienen extracción propia con indicadores (parte es por tildes en el emparejamiento, parte por planes escaneados/omitidos); SisPT los cubre.
- Pendiente: licencia de reutilización, y que el plan indicativo cargado puede diferir del PDF aprobado.

## 3d. Cruce SisPT vs. extraccion de PDF

Archivos: `sispt_plan_indicativo/cruce_pdf.csv` (por municipio) y `cruce_nuestros_sin_par.csv` (indicadores nuestros sin par en SisPT). Emparejamiento: codigo MGA si lo tenemos, si no similitud de palabras (Jaccard >= 0.5) del nombre contra el indicador de producto de SisPT. Es un emparejamiento aproximado.

- 90 municipios cruzados; 5 sin emparejar por nombre (Carolina del Principe, El Penol, El Retiro, La Ceja v2, San Vicente Ferrer).
- De 17.321 indicadores nuestros, 10.492 (61 %) tienen par en SisPT; en el 80 % de esos pares la meta del cuatrienio coincide.
- Nuestra extraccion cubre 9.024 de 19.491 productos de SisPT (46 %) en esos municipios.
- Planes con 0 pares y causas vistas: **Tarso** (el nombre extraido es el titulo de la linea, columnas corridas: error del extractor); **La Union, San Luis, Murindo, Puerto Triunfo, San Andres de Cuerquia** quedan por revisar; La Union y San Luis extraen indicadores de resultado/bienestar, que SisPT guarda en otra hoja (no se cruzaron contra `resultado.csv`).

## 3e. Base por municipio (SisPT + PDF)

`python -c "from plan_desarrollo.base import construye; construye('..')"` (desde `scripts/`) genera `insumos/plan_base/<dane>.json` (125, 33 MB) e `index.json`. Estructura: SisPT como base (lineas, resultado, productos con sector/programa/producto/indicador MGA, meta, ODS, programacion y recursos por fuente y año) y, en cada producto, `pdf` con pagina, linea base y responsable cuando el PDF cruza; `solo_pdf` trae lo que el PDF tiene y SisPT no.
- 26.507 productos; 9.128 con dato del PDF; 6.937 indicadores solo en PDF (parte es ruido del extractor, p. ej. Tarso).
- **Montos de SisPT poco fiables**: 2.024 productos en 75 municipios tienen algun año con valores absurdos (hasta 5,8e16 COP) y los totales municipales tampoco cuadran (El Bagre 392 billones). Usar las metas y la estructura, no los montos, hasta validarlos contra el PPI del PDF.
- No esta en `public/`: pendiente la licencia.
