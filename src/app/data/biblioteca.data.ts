/**
 * Biblioteca de RECUAPP: todas las fuentes consultadas, con enlace y cita.
 * Regla: toda fuente nueva (norma, dato, servicio cartográfico, software) se agrega aquí.
 *
 * `verif`:
 *   'leida'  → el documento o servicio se abrió y se usó directamente en el proyecto.
 *   'portal' → se usó el archivo descargado; el enlace es el portal de la entidad (confirmar el vínculo exacto al citar formalmente).
 */
export type CategoriaFuente =
  | 'norma' | 'metodologia' | 'plan' | 'estadistica' | 'sectorial' | 'territorio' | 'cartografia' | 'software';

export interface Fuente {
  id: string;
  cat: CategoriaFuente;
  titulo: string;
  entidad: string;
  anio?: string;
  url: string;
  /** Qué se tomó de la fuente y dónde se usa en RECUAPP. */
  uso: string;
  licencia?: string;
  verif: 'leida' | 'portal';
  /** Archivo local en insumos/ o script que lo procesa (trazabilidad). */
  local?: string;
}

export const CATEGORIAS: { id: CategoriaFuente; nombre: string; desc: string }[] = [
  { id: 'norma',       nombre: 'Normas',                 desc: 'Leyes y decretos que obligan la forma del plan.' },
  { id: 'metodologia', nombre: 'Metodología oficial',    desc: 'Guías del DNP para formular y hacer seguimiento.' },
  { id: 'plan',        nombre: 'Planes y seguimiento',   desc: 'Planes de desarrollo, SisPT y fichas municipales.' },
  { id: 'estadistica', nombre: 'Estadística y población', desc: 'Censo, proyecciones y marco geoestadístico.' },
  { id: 'sectorial',   nombre: 'Datos sectoriales',      desc: 'Educación, salud, cultura, deporte, justicia, ambiente.' },
  { id: 'territorio',  nombre: 'Ordenamiento y territorio', desc: 'PBOT, PDET, reservas, distritos agrarios.' },
  { id: 'cartografia', nombre: 'Cartografía y modelo 3D', desc: 'Catastro, redes, relieve, hidrografía e imágenes.' },
  { id: 'software',    nombre: 'Software y librerías',   desc: 'Herramientas con las que está construida la app.' },
];

export const FUENTES: Fuente[] = [
  // ── Normas ────────────────────────────────────────────────────────────────
  {
    id: 'ley-152-1994', cat: 'norma', verif: 'leida',
    titulo: 'Ley 152 de 1994, Ley Orgánica del Plan de Desarrollo',
    entidad: 'Congreso de la República de Colombia', anio: '1994',
    url: 'https://relatoria.colombiacompra.gov.co/normativa/ley-152-de-1994',
    uso: 'Estructura obligatoria del plan: parte estratégica y plan de inversiones (art. 31), Consejo Territorial de Planeación, plazos de adopción (art. 39-40), planes de acción y evaluación (arts. 41-43).',
    local: 'insumos/marco_normativo/README.md',
  },
  {
    id: 'ley-1909-2018', cat: 'norma', verif: 'leida',
    titulo: 'Ley 1909 de 2018, art. 22 (publicación del plan plurianual de inversiones y audiencias públicas)',
    entidad: 'Congreso de la República de Colombia', anio: '2018',
    url: 'https://normograma.mintic.gov.co/mintic/compilacion/docs/ley_1909_2018.htm',
    uso: 'Referenciada por los lineamientos del DNP 2024-2027; sustenta la publicación de programas y proyectos del PPI.',
    local: 'insumos/marco_normativo/README.md',
  },
  {
    id: 'ley-1757-2015', cat: 'norma', verif: 'leida',
    titulo: 'Ley 1757 de 2015, participación democrática (voto programático)',
    entidad: 'Congreso de la República de Colombia', anio: '2015',
    url: 'https://apps.procuraduria.gov.co/gd_1952/docs/l1757015.htm',
    uso: 'El programa de gobierno inscrito es la base del plan; fundamenta el seguimiento ciudadano.',
    local: 'insumos/marco_normativo/README.md',
  },
  {
    id: 'decreto-1865-1994', cat: 'norma', verif: 'leida',
    titulo: 'Decreto 1865 de 1994, armonización de planes con la gestión ambiental regional',
    entidad: 'Presidencia de la República de Colombia', anio: '1994',
    url: 'https://faolex.fao.org/docs/pdf/col25025.pdf',
    uso: 'La corporación autónoma regional recibe copia del proyecto de plan y emite concepto (15 días).',
    local: 'insumos/marco_normativo/README.md',
  },

  // ── Metodología oficial ──────────────────────────────────────────────────
  {
    id: 'dnp-lineamientos-2024', cat: 'metodologia', verif: 'leida',
    titulo: 'Documento de lineamientos para la formulación de planes de desarrollo territoriales 2024-2027',
    entidad: 'Departamento Nacional de Planeación (DNP)', anio: '2023',
    url: 'https://colaboracion.dnp.gov.co/CDT/Desarrollo%20Territorial/Portal%20Territorial/ATT/5744%20-%20Documento%20Lineamientos%20Formulaci%C3%B3n%20Planes%20de%20Desarrollo%20Territoriales%20Final.pdf',
    uso: 'Contenido exigido (parte estratégica, PPI, capítulos de regalías y paz), calendario de adopción y alineación con el PND y los ODS.',
    local: 'insumos/marco_normativo/README.md',
  },
  {
    id: 'dnp-plan-indicativo', cat: 'metodologia', verif: 'leida',
    titulo: 'Guía de orientaciones para el Plan Indicativo',
    entidad: 'Departamento Nacional de Planeación (DNP), Kit de Planeación Territorial',
    url: 'https://colaboracion.dnp.gov.co/CDT/Desarrollo%20Territorial/Portal%20Territorial/KPT/Guia%20de%20Orientaciones%20Plan%20Indicativo.pdf',
    uso: 'Jerarquía línea estratégica → programa → producto → indicador y reglas de calidad de las metas; define el esquema de datos del plan. Copia leída: Gobernación del Valle del Cauca (ogpt.valledelcauca.gov.co).',
    local: 'insumos/marco_normativo/README.md',
  },
  {
    id: 'dnp-productos-mga', cat: 'metodologia', verif: 'leida',
    titulo: 'Guía orientadora para la definición de productos',
    entidad: 'Departamento Nacional de Planeación (DNP)',
    url: 'https://colaboracion.dnp.gov.co/CDT/proyectosinformacioninversionpublica/manuales/guia_orientadora_definicion_de_productos.pdf',
    uso: 'Códigos de programa (4 dígitos) y producto (7 dígitos) del catálogo MGA con que se validan los productos del plan.',
    local: 'insumos/marco_normativo/README.md',
  },
  {
    id: 'dnp-catalogos', cat: 'metodologia', verif: 'leida',
    titulo: 'Catálogos de la inversión pública (programas y productos)',
    entidad: 'Departamento Nacional de Planeación (DNP)',
    url: 'https://www.dnp.gov.co/LaEntidad_/subdireccion-general-inversiones-seguimiento-evaluacion/direccion-proyectos-informacion-para-inversion-publica/Paginas/catalagos.aspx',
    uso: 'Diccionario oficial de programas y productos de inversión.',
    local: 'insumos/marco_normativo/README.md',
  },

  // ── Planes y seguimiento ─────────────────────────────────────────────────
  {
    id: 'sispt', cat: 'plan', verif: 'leida',
    titulo: 'SisPT: consulta pública de información del Plan de Desarrollo Territorial 2024-2027',
    entidad: 'Departamento Nacional de Planeación (DNP)', anio: '2024',
    url: 'https://sispt.dnp.gov.co/reportes/default-reportes',
    uso: 'Plan indicativo estructurado de los 125 municipios de Antioquia; base para contrastar y completar la extracción de los PDF.',
    local: 'insumos/sispt_plan_indicativo/',
  },
  {
    id: 'pdm-antioquia', cat: 'plan', verif: 'portal',
    titulo: 'Planes de Desarrollo Municipal 2024-2027 de los municipios de Antioquia (acuerdos municipales)',
    entidad: 'Concejos y alcaldías municipales de Antioquia', anio: '2024',
    url: 'https://sispt.dnp.gov.co/reportes/default-reportes',
    uso: 'Documentos PDF de cada plan (Bello, Envigado, Itagüí, Sabaneta, La Estrella, Caldas, Barbosa y más) de los que se extrajo texto y estructura. Cada municipio publica el suyo en su sede electrónica.',
    local: 'insumos/plan/ · insumos/plan_extraido/',
  },
  {
    id: 'fichas-girardota', cat: 'plan', verif: 'portal',
    titulo: 'Fichas de seguimiento 2024 y 2025 y matriz maestra del Plan de Desarrollo de Girardota',
    entidad: 'Alcaldía de Girardota', anio: '2025',
    url: 'https://www.girardota.gov.co',
    uso: 'Avance por línea, dependencia y ficha de inversión; alimenta el seguimiento y los responsables.',
    local: 'insumos/seguimiento_municipal/05308/',
  },
  {
    id: 'directorios-contactos', cat: 'plan', verif: 'portal',
    titulo: 'Alcaldes de Antioquia y directorio de correos institucionales',
    entidad: 'Gobernación de Antioquia / Datos Abiertos', anio: '2026',
    url: 'https://www.datos.gov.co',
    uso: 'Contacto institucional por municipio y dependencias.',
    local: 'insumos/contactos/',
  },

  // ── Estadística y población ──────────────────────────────────────────────
  {
    id: 'dane-proyecciones', cat: 'estadistica', verif: 'leida',
    titulo: 'Proyecciones de población 2018-2070 y 2020-2050 por área, sexo y edad; pertenencia étnico-racial',
    entidad: 'Departamento Administrativo Nacional de Estadística (DANE)', anio: '2025',
    url: 'https://www.dane.gov.co/estadisticas-por-tema/demografia-y-poblacion/proyecciones-de-poblacion',
    uso: 'Población por municipio y rango de edad, y control del total rural disperso de cada vereda. La población 2025 de cabecera y de centros poblados y rural disperso es la base de los viajes del modelo de tráfico estimado.',
    local: 'insumos/poblacion/ · scripts/estimar_trafico_vias.py',
  },
  {
    id: 'dane-cnpv-2018', cat: 'estadistica', verif: 'portal',
    titulo: 'Censo Nacional de Población y Vivienda 2018 y Marco Geoestadístico Nacional integrado (secciones rurales, veredas, zona urbana)',
    entidad: 'Departamento Administrativo Nacional de Estadística (DANE)', anio: '2018',
    url: 'https://geoportal.dane.gov.co/servicios/descarga-y-metadatos/datos-geoestadisticos/',
    uso: 'Estimación de población por vereda (reparto dasimétrico) y límites de veredas del mapa. Veredas y zona urbana dan el límite municipal con el que el modelo de tráfico reconoce las salidas del municipio.',
    local: 'insumos/geografia/dane_cnpv2018/ · scripts/generar_poblacion_veredas.py, estimar_trafico_vias.py',
  },
  {
    id: 'gobant-poblacion', cat: 'estadistica', verif: 'portal',
    titulo: 'Población por municipio y rango de edad; población de Antioquia 2006-2035 ajustada',
    entidad: 'Gobernación de Antioquia, Dirección de Sistemas de Información y Estudios Económicos', anio: '2025',
    url: 'https://www.antioquia.gov.co',
    uso: 'Series de población municipal para contraste con DANE.',
    local: 'insumos/poblacion/',
  },

  // ── Datos sectoriales ────────────────────────────────────────────────────
  {
    id: 'educacion', cat: 'sectorial', verif: 'portal',
    titulo: 'Establecimientos educativos y sedes del departamento de Antioquia',
    entidad: 'Ministerio de Educación Nacional / Datos Abiertos Colombia', anio: '2026',
    url: 'https://www.datos.gov.co',
    uso: 'Colegios y sedes del mapa y del modelo 3D.',
    local: 'insumos/educacion/',
  },
  {
    id: 'cultura', cat: 'sectorial', verif: 'portal',
    titulo: 'Espacios de las artes, las culturas y los saberes',
    entidad: 'Ministerio de las Culturas, las Artes y los Saberes', anio: '2026',
    url: 'https://www.datos.gov.co',
    uso: 'Equipamientos culturales del mapa.',
    local: 'insumos/cultura/',
  },
  {
    id: 'rnbp', cat: 'sectorial', verif: 'portal',
    titulo: 'Directorio de la Red Nacional de Bibliotecas Públicas (RNBP)',
    entidad: 'Biblioteca Nacional de Colombia, Ministerio de las Culturas',
    url: 'https://www.bibliotecanacional.gov.co',
    uso: 'Bibliotecas públicas municipales.',
    local: 'insumos/bibliotecas/DirectorioRNBP.xlsx',
  },
  {
    id: 'deporte', cat: 'sectorial', verif: 'portal',
    titulo: 'Consolidado de escenarios deportivos y directorio de institutos departamentales y municipales del deporte',
    entidad: 'Ministerio del Deporte', anio: '2026',
    url: 'https://www.mindeporte.gov.co',
    uso: 'Escenarios deportivos; complementados con OpenStreetMap en Girardota.',
    local: 'insumos/deporte/',
  },
  {
    id: 'justicia', cat: 'sectorial', verif: 'portal',
    titulo: 'Casas de justicia y centros de convivencia; personerías; policía; defensorías; procesos PARD',
    entidad: 'Ministerio de Justicia y del Derecho · Defensoría del Pueblo · Policía Nacional · ICBF', anio: '2025',
    url: 'https://minjusticia.gov.co/transparencia/Paginas/SEJ-Acceso-a-la-Justicia-Casas-de-Justicia-y-Centros-de-Convivencia-Ciudadana.aspx',
    uso: 'Directorio de justicia, seguridad y protección por municipio.',
    local: 'insumos/justicia/',
  },
  {
    id: 'salud-turismo', cat: 'sectorial', verif: 'portal',
    titulo: 'Puntos de salud y sitios de interés de Girardota, con vereda',
    entidad: 'Alcaldía de Girardota',
    url: 'https://www.girardota.gov.co',
    uso: 'Puntos de interés del mapa (salud y turismo).',
    local: 'insumos/salud/ · insumos/turismo/ · scripts/generar_puntos.py',
  },
  {
    id: 'corantioquia-emisiones', cat: 'sectorial', verif: 'portal',
    titulo: 'Inventario de emisiones atmosféricas, base de datos 2021',
    entidad: 'Corporación Autónoma Regional del Centro de Antioquia (Corantioquia)', anio: '2021',
    url: 'https://www.corantioquia.gov.co',
    uso: 'Fuentes fijas, chimeneas e industrias del modelo 3D. Las direcciones de las industrias vecinas («km 25 Autopista Norte, Peaje El Trapiche») ubican el peaje en el mapa.',
    local: 'insumos/ambiente/Base_Datos_Inventario-2021.xlsx',
  },
  {
    id: 'ani-trafico-peajes', cat: 'sectorial', verif: 'leida',
    titulo: 'Tráfico Vehicular ANI: tráfico mensual por estación de peaje y categoría de tarifa (conjunto 8yi9-t44c)',
    entidad: 'Agencia Nacional de Infraestructura (ANI) / Datos Abiertos Colombia', anio: '2026',
    url: 'https://www.datos.gov.co/Transporte/Tr-fico-Vehicular-ANI/8yi9-t44c',
    uso: 'Vehículos por mes en los peajes El Trapiche (Girardota) y Cabildo, ago-2021 a may-2026: proyección del tráfico a 2035 por escenarios y calibración de la capa de tráfico estimado del mapa 3D.',
    local: 'insumos/movilidad/ani-peajes-trapiche-cabildo.json · scripts/proyectar_trafico_trapiche.py, estimar_trafico_vias.py',
  },

  // ── Ordenamiento y territorio ────────────────────────────────────────────
  {
    id: 'pbot-girardota', cat: 'territorio', verif: 'leida',
    titulo: 'Plan Básico de Ordenamiento Territorial de Girardota, revisión y ajuste 2022: documento de formulación y resumen',
    entidad: 'Municipio de Girardota', anio: '2022',
    url: 'https://www.girardota.gov.co',
    uso: 'Infraestructura de servicios públicos (Figura 2-78, p. 345): bocatomas, sistemas de tratamiento y PTAR; suelos y usos.',
    local: 'insumos/territorial/pbot/ · scripts/generar_instalaciones_agua.py',
  },
  {
    id: 'pdet', cat: 'territorio', verif: 'portal',
    titulo: 'Municipios PDET de Antioquia (Programas de Desarrollo con Enfoque Territorial)',
    entidad: 'Agencia de Renovación del Territorio (ART)',
    url: 'https://www.renovacionterritorio.gov.co',
    uso: 'Campo de alineación PDET del plan.',
    local: 'insumos/territorial/Municipios_PDET_Antioquia.xlsx',
  },
  {
    id: 'ant-reservas', cat: 'territorio', verif: 'portal',
    titulo: 'Zonas de Reserva Campesina; Distritos Agrarios; potencialidades del modelo de plan',
    entidad: 'Agencia Nacional de Tierras / Gobernación de Antioquia',
    url: 'https://www.ant.gov.co',
    uso: 'Capas de contexto rural en el mapa territorial.',
    local: 'insumos/geografia/',
  },
  {
    id: 'encuentrala', cat: 'territorio', verif: 'portal',
    titulo: 'Contornos y jerarquía municipio, corregimiento y vereda de Antioquia (repositorio Encuentrala; Mapa Veredal Digital de Antioquia)',
    entidad: 'Departamento Administrativo de Planeación, Gobernación de Antioquia (vía el repositorio Encuentrala)',
    url: 'https://www.antioquia.gov.co',
    uso: 'Solo contornos y jerarquía territorial del mapa (125 municipios y sus veredas); se descartaron las unidades de servicio.',
    local: 'scripts/generar_mapa.py',
  },

  // ── Cartografía y modelo 3D ──────────────────────────────────────────────
  {
    id: 'catastro-girardota', cat: 'cartografia', verif: 'leida',
    titulo: 'Girardota_Catastro (MapServer): construcciones urbanas y rurales, predios urbanos y rurales',
    entidad: 'Área Metropolitana del Valle de Aburrá, con datos de la Alcaldía de Girardota (Catastro)',
    url: 'https://portalidem.metropol.gov.co/server/rest/services/Girardota_Catastro/MapServer',
    uso: 'Huellas y pisos de las edificaciones, linderos (cercas), jardines y ubicación de equipamientos e industrias en el modelo 3D. El uso (residencial, comercial, industrial) y los pisos de cada construcción dicen dónde nacen y a dónde llegan los viajes del modelo de tráfico.',
    local: 'insumos/catastro/ · scripts/generar_catastro_3d.py, generar_cercas.py, generar_jardines.py, estimar_trafico_vias.py',
  },
  {
    id: 'igac-vias', cat: 'cartografia', verif: 'portal',
    titulo: 'Cartografía básica: red vial (tipo de vía, estado de la superficie, carriles, accesibilidad), escala 1:100.000',
    entidad: 'Instituto Geográfico Agustín Codazzi (IGAC)',
    url: 'https://www.colombiaenmapas.gov.co',
    uso: 'Red vial oficial del municipio, cruzada con OpenStreetMap en la red unificada: estado del pavimento en el mapa 3D y tipo de vía (velocidad) del modelo de tráfico estimado. Los significados de tipo_via y accesibilidad son supuestos por confirmar con la ficha técnica.',
    local: 'insumos/geografia/igac_vias_girardota.geojson · scripts/red_vial_girardota.py, red_vial_unificada.py, estimar_trafico_vias.py',
  },
  {
    id: 'epm-redes', cat: 'cartografia', verif: 'leida',
    titulo: 'Redes de acueducto y alcantarillado (visor geoportal público, ArcGIS FeatureServer)',
    entidad: 'Empresas Públicas de Medellín (EPM)',
    url: 'https://services1.arcgis.com/lHSB5M3vxFT82S7P/ArcGIS/rest/services/',
    uso: 'Tuberías, tanques, hidrantes, válvulas y cámaras recortadas al municipio.',
    local: 'scripts/generar_redes_agua.py',
  },
  {
    id: 'ideam-hidrografia', cat: 'cartografia', verif: 'leida',
    titulo: 'Cartografía básica: hidrografía (drenaje sencillo, escala 1:100.000)',
    entidad: 'IDEAM (DHIME) con base del IGAC',
    url: 'http://dhime.ideam.gov.co/server/rest/services/Cartografia_Basica/Hidrografia/MapServer/0',
    uso: 'Tramos de ríos y quebradas que OpenStreetMap no tiene.',
    local: 'insumos/geografia/ideam_igac_drenaje_sencillo_100k_girardota.geojson · scripts/generar_cauces.py',
  },
  {
    id: 'osm', cat: 'cartografia', verif: 'leida',
    titulo: 'OpenStreetMap (consulta por Overpass API y geocodificación con Nominatim)',
    entidad: 'Colaboradores de OpenStreetMap',
    url: 'https://www.openstreetmap.org/copyright',
    uso: 'Vías, cauces, lagos, líneas de alta tensión, subestaciones, centrales, escenarios deportivos y geocodificación de direcciones. Sus calles completan la red del modelo de tráfico estimado.',
    licencia: 'ODbL 1.0 · © OpenStreetMap contributors',
    local: 'scripts/generar_vias_edificios.py, generar_cauces.py, generar_infraestructura.py, generar_puntos.py, estimar_trafico_vias.py',
  },
  {
    id: 'aws-terrain', cat: 'cartografia', verif: 'leida',
    titulo: 'AWS Terrain Tiles (formato Terrarium, ~30 m)',
    entidad: 'Mapzen / Amazon Web Services (conjunto de datos abierto)',
    url: 'https://registry.opendata.aws/terrain-tiles/',
    uso: 'Elevación del terreno del modelo 3D y curvas de nivel.',
    local: 'scripts/generar_relieve.py, generar_relieve_vectorial.py',
  },
  {
    id: 'eox-s2', cat: 'cartografia', verif: 'leida',
    titulo: 'Sentinel-2 cloudless (2020), s2maps.eu',
    entidad: 'EOX IT Services GmbH (contiene datos de Copernicus Sentinel modificados 2020)',
    anio: '2020',
    url: 'https://s2maps.eu',
    uso: 'Textura satelital del terreno 3D (~10 m). Solo prototipo: para producción reemplazar con ortoimágenes con licencia adecuada (p. ej. IGAC).',
    licencia: 'CC BY-NC-SA 4.0',
    local: 'scripts/generar_ortofoto.py',
  },

  // ── Software y librerías ─────────────────────────────────────────────────
  {
    id: 'angular', cat: 'software', verif: 'leida',
    titulo: 'Angular', entidad: 'Google', url: 'https://angular.dev',
    uso: 'Framework de la aplicación.', licencia: 'MIT',
  },
  {
    id: 'threejs', cat: 'software', verif: 'leida',
    titulo: 'three.js', entidad: 'mrdoob y colaboradores', url: 'https://threejs.org',
    uso: 'Motor del modelo 3D del territorio.', licencia: 'MIT',
  },
  {
    id: 'supabase', cat: 'software', verif: 'leida',
    titulo: 'Supabase', entidad: 'Supabase Inc.', url: 'https://supabase.com',
    uso: 'Autenticación y base de datos.', licencia: 'Apache-2.0',
  },
  {
    id: 'leaflet', cat: 'software', verif: 'leida',
    titulo: 'Leaflet 1.9.4', entidad: 'Vladimir Agafonkin y colaboradores', url: 'https://leafletjs.com',
    uso: 'Visor de verificación de la red vial en los scripts de preparación de datos.', licencia: 'BSD-2-Clause',
    local: 'scripts/red_vial_girardota.py',
  },
  {
    id: 'python-cientifico', cat: 'software', verif: 'leida',
    titulo: 'NumPy, SciPy y Shapely', entidad: 'Comunidades NumPy, SciPy y Shapely',
    url: 'https://scipy.org',
    uso: 'Mínimos cuadrados de la proyección del peaje; rutas más rápidas en la red (Dijkstra) y geometría de vías y zonas del modelo de tráfico.',
    licencia: 'BSD-3-Clause',
    local: 'scripts/proyectar_trafico_trapiche.py, estimar_trafico_vias.py',
  },
];

/** Cita en texto plano, lista para pegar en un documento. */
export function citar(f: Fuente, consulta = '3 de noviembre de 2026'): string {
  const anio = f.anio ? ` (${f.anio})` : '';
  return `${f.entidad}${anio}. ${f.titulo}. ${f.url}. Consultado el ${consulta}.`;
}
