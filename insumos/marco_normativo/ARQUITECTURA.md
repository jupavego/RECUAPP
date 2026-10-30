# Arquitectura: gestion de proyectos publicos sobre el plan de desarrollo

Estado: propuesta para validar con el usuario. Nada de esto esta construido salvo las capas de datos (ver "Ya existe").

## Principio
El plan de desarrollo es el catalogo de lo prometido; el proyecto es lo ejecutado. Todo proyecto se ata a un producto/indicador del plan, y todo producto tiene una dependencia responsable.

## Ya existe
- Catalogo MGA (sector > programa > producto > indicador): `scratchpad/dnp/catalogo.xlsx`, a copiar a `insumos/`.
- Plan base por municipio, 125 JSON: `insumos/plan_base/` (SisPT + datos del PDF), generado por `scripts/plan_desarrollo/base.py`.
- Extractor de PDF (`scripts/plan_desarrollo`), usado como validacion y complemento.
- App Angular 19 + Supabase con roles user/admin, mapa 2D y 3D.

## Responsables: la realidad institucional de cada alcaldia
No se sintetizan ni se fusionan secretarias. Cada alcaldia tiene las suyas, con su nombre y cantidad (unas mas que otras), y cada una queda como entidad propia de la app, con vistas y modulos propios mas adelante.
1. `dependencia` (por municipio): se siembra desde el sitio web de la alcaldia (p. ej. Girardota publica 14: Agricultura y Desarrollo Rural; Ambiental y Desarrollo Sostenible; Gobierno y Derechos Humanos; Hacienda y Desarrollo Economico; Infraestructura; Planeacion, Desarrollo Territorial y Participacion Ciudadana; Salud y Proteccion Social; Servicios Administrativos; Transito y Transporte; Educacion y Cultura; y las oficinas de Comunicaciones, Juridica, Control Interno Disciplinario y Asesora de Control Interno). La pagina se pudo leer sin login; cada municipio tendra su propio formato.
2. Asignacion producto > dependencia, relacion N a N (un producto puede tener varios responsables, y un sector puede compartir responsable):
   - del PDF: el texto de `responsable` se empareja con las dependencias reales de ese municipio (un texto con varias secretarias asigna todas);
   - del sector/programa MGA: pista para sugerir cuando el PDF no lo trae (Educacion > la dependencia cuyo nombre trata educacion en ese municipio). Es solo sugerencia con confianza, nunca renombra ni reemplaza la dependencia real.
3. Cada asignacion guarda `fuente` (pdf | sector_mga | manual) y confianza; lo sugerido sin respaldo del PDF queda pendiente de revision.

## Modelo de datos (Supabase)
- Referencia (solo lectura): `municipio`, `sector_mga`, `programa_mga`, `plan_producto` (desde plan_base), `plan_indicador_resultado`, `plan_linea`.
- Responsables: `dependencia` (por municipio, desde el sitio de la alcaldia) y `producto_dependencia` (N a N, con fuente y confianza). Solo una tabla auxiliar `pista_sector` (sector MGA > palabras clave) para sugerir.
- Operativo: `proyecto`, `proyecto_producto` (vinculo N a N con `plan_producto`), `financiacion`, `avance` (hitos, % fisico y financiero), `evidencia`, `auditoria`.
- Cada fila de referencia lleva `fuente` (sispt | pdf | manual) y fecha.

## Montos
Dos niveles separados:
- Programado: plan indicativo de SisPT, mostrado como "indicativo, fuente DNP-SisPT". Se ocultan los valores atipicos (campo `atipico`, 2.024 productos en 75 municipios) y se avisa. Pendiente validar contra el PPI del PDF.
- Ejecutado: lo capturan alcaldia e internos, por proyecto.

## Roles
- admin: todo.
- interno: edita cualquier municipio.
- alcaldia: edita solo su municipio y solo los productos de su dependencia (RLS por municipio + dependencia).
- publico: lectura.

## Fuente y licencia
SisPT es publico (institucion publica que lo pone a disposicion de la comunidad). Se conserva siempre la atribucion "Fuente: DNP, SisPT" con fecha de descarga. No encontre terminos de reutilizacion explicitos; se asume uso abierto con atribucion.

## Alcance actual (sin mapa)
La app es el entorno para exponer y gestionar proyectos publicos y sus resultados, y que la ciudadania interactue con ellos. Por ahora solo se construye la estructura que absorbe y presenta, por entidad, las categorias de los planes de desarrollo. El mapa queda fuera.

### Contrato de absorcion (una sola forma de entrada)
El JSON de `insumos/plan_base/<dane>.json` es el contrato: entidad > lineas, resultado, productos (sector > programa > producto > indicador MGA, unidad, meta, linea base, ODS, programacion anual, recursos por fuente, responsable). Cualquier fuente (SisPT, PDF, carga manual) se mapea a ese contrato; cada campo guarda `fuente` y fecha. Agregar un municipio o una fuente nueva no cambia la app.

### Presentacion por entidad (guiada por las categorias, no por el municipio)
- Ficha de entidad: plan, vigencia, lineas estrategicas, conteos por sector.
- Arbol: linea > sector > programa > producto > indicador, con meta, programacion y responsable.
- Vista por dependencia responsable (las dependencias reales de la alcaldia).
- Vista por sector/ODS y comparacion entre entidades.
- Montos: programado SisPT con aviso de indicativo; los atipicos se ocultan.

### Reservado para despues (el modelo ya lo admite)
Proyectos y su vinculo a productos, avance y evidencias capturados por alcaldias e internos, e interaccion ciudadana (seguimiento, comentarios, solicitudes).

## Piloto
Girardota (05308) para probar el contrato y las vistas antes de cargar los 125. Primero: cargar las dependencias reales de Girardota y emparejar el `responsable` del PDF; medir cuantos productos quedan con responsable y cuantos necesitan la pista por sector.

## Mapa de procesos (flujo de trabajo)
1. Fuentes: SisPT (Excel por entidad), catalogo MGA, PDF del plan, sitio web de la alcaldia (dependencias).
2. Ingesta: consolidar SisPT (`sispt.py`), extractor de PDF (responsable, linea base), cargar dependencias reales, cruce por codigo y texto.
3. Base unica: contrato `plan_base` por entidad (lineas, productos, indicadores, metas, responsables N a N, fuente y confianza).
4. Control: reglas de calidad del marco normativo y revision humana de muestra y discrepancias.
5. Exposicion: ficha de entidad, arbol del plan, vista por dependencia.
6. Despues: proyectos, avance y montos (alcaldias e internos), ciudadania.

Diagramas: `diagramas/flujo_procesos.svg` (mapa de procesos) y `diagramas/oferta_servicios.svg` (oferta de servicios para el cliente).

## Piloto Girardota: estado (2026-10-30)
- Dependencias reales: `insumos/dependencias/05308.json` (14, del sitio de la alcaldia).
- Datos para la app: `python scripts/plan_desarrollo/tarjetas_app.py .. 05308` genera `public/data/plan/05308.json`.
- Vista: ruta `/plan` (o `/plan/05308`), `src/app/features/plan/`. Tarjetas: resumen, lineas, sectores, responsables, programas, resultado, ODS, recursos programados, calidad, solo en el PDF; listado filtrable de productos.
- Medicion: de 244 productos de SisPT, 208 (85 %) cruzan con el PDF; 199 (82 %) tienen responsable segun el PDF, 37 (15 %) solo pista por sector, 7 apuntan a una entidad fuera de la lista (INDER) y 1 queda sin responsable.
- Alerta: aun excluyendo 54 productos con montos absurdos, los totales de SisPT para Girardota (~1,7 billones al año) no son creibles; la vista los muestra marcados como sin validar.
- Subsecretarias (2026-10-30): son dependencias propias con `padre` y `padre_confirmado`. En Girardota el PDF nombra la Subsecretaria de Proteccion Social (11 productos, padre supuesto: Salud) y la de Participacion Ciudadana y Economia Solidaria (18, padre supuesto: Planeacion, por confirmar; trabajo, turismo y empleo podrian depender de Hacienda). El sitio de la alcaldia no las lista. La secretaria muestra su conteo mas el de sus subsecretarias.
- Montos (2026-10-30): la tarjeta de inversion usa el PPI del PDF (Girardota: $72, 79, 85 y 91 mil millones en 2024-2027, unos $327 mil millones; por linea, sector y programa). Los montos por producto de SisPT se quitaron de la vista. 7 de 17 sectores se marcan "revisar" porque su resumen no coincide con la suma de sus programas; el PDF no desglosa por fuente de financiacion.
- Iconos (2026-10-30): 20 iconos recortados de `insumos/imgs/` a `public/img/iconos/NN-nombre.png` (fondo transparente). Cada dependencia lleva `icono` en `insumos/dependencias/<dane>.json`; la vista los muestra en la tarjeta de responsables y en las capsulas. Girardota: 12 de 14 dependencias tienen icono (Servicios Administrativos, Comunicaciones, Control Interno Disciplinario y Asesora no tienen simbolo en el set; salen con inicial).
- Iconos, 2da tanda (2026-10-30): 4 iconos de estilo azul y verde (`21` a `24` en `public/img/iconos/`) para Servicios Administrativos, Comunicaciones, Control Interno Disciplinario y Asesora de Control Interno. Girardota ya tiene icono en las 14 dependencias. Quedaron sin usar la antena (excluida) y el escudo con columnas.
- Personas responsables (2026-10-30): `scripts/plan_desarrollo/responsables_web.py` lee la pagina de cada dependencia en el sitio de la alcaldia (cargo y nombre; el perfil se guarda en `insumos/dependencias/05308_responsables.json`, no en la app). `tarjetas_app.py` lo empareja con las dependencias (URL o nombre) y la tarjeta de responsables muestra "cargo: nombre" con enlace a la pagina de origen. En Girardota: 20 paginas, 19 con persona (incluye al alcalde). El sitio tambien lista Subsecretaria de Seguridad y Convivencia, de Cultura y de Desarrollo Economico y Competitividad, que no estan en `05308.json`.
- Organigrama de Girardota (2026-10-30): se alineo `05308.json` con el organigrama oficial. Subsecretarias de Seguridad y Espacio Publico, Cultura, Desarrollo Economico y Competitividad y Tecnologia e Innovacion, y las unidades Comisarias de Familia e Inspeccion de Policia, todas confirmadas. La subsecretaria combinada del PDF (participacion ciudadana y economia solidaria, trabajo, turismo y empleo) se separa: los productos de sectores 35 y 36 pasan a Desarrollo Economico (regla `reasignar`). INDER es entidad externa (no esta en el organigrama) con su nota. «Alcaldia» y «Mantenimiento Comunicaciones» (PDF) van a Comunicaciones y «Coliseos adecuados» al INDER, como sugeridos con nota (`alias_responsable`, `producto_responsable`).
