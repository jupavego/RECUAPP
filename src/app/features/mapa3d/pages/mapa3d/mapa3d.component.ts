import { DecimalPipe } from '@angular/common';
import { CargadorComponent } from '../../../../shared/components/cargador/cargador.component';
import { PERIODO_CERCA, crearTexturaCercas, filaCerca } from '../../utils/cercas';
import { NEGOCIOS_ATLAS, PALETAS_ATLAS, celdaBahia, celdaLocal, crearAtlasFachadas, crearTexturaTeja } from '../../utils/fachadas';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, NavigationStart, Router, RouterLink } from '@angular/router';
import {
  AfterViewInit, Component, DestroyRef, ElementRef, NgZone, ViewChild, effect, inject, signal,
} from '@angular/core';
import { Observable, catchError, forkJoin, of, tap } from 'rxjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MapaService, Municipio, Punto, Zona } from '../../../mapa/services/mapa.service';
import { CATEGORIA, CATEGORIAS } from '../../../mapa/utils/puntos';
import { Aura, CategoriaServicio, COLOR_INDUSTRIA, GLIFO, Icono, ItemAura, SERVICIOS, SERVICIOS_GRUPO, crearAgrupador, crearAuras, crearIcono } from '../../utils/aura';
import { Conduccion } from '../../utils/conduccion';
import { Avioneta } from '../../utils/avioneta';
import { ESCALA_ACTIVOS } from '../../utils/escala';
import { DatosRasante, Rasante, TramoRasante } from '../../utils/rasante';
import { COLORES_RURALES, Modelo, PARTES_COMFAMA, chimeneaParque, colorParque, modelarEquipamiento, unidadParque } from '../../utils/equipamientos';
import { coloresPorMunicipio, hex } from '../../../mapa/utils/paleta';
import { Geometria, decodeGeometria } from '../../../mapa/utils/polyline';

/** Municipio de la prueba de concepto (mismo id que en public/data/mapa). */
const ID_MUNICIPIO = 49;
/** Exageración vertical del relieve. */
const EXAGERACION = 1.6;
/** Resolución del croquis pintado sobre el terreno (ancho en píxeles). */
const ANCHO_TEXTURA = 3072;
const ANCHO_RESALTE = 1024;
/** Separación entre los valores de rojo del mapa de identificadores (tolera el suavizado de bordes). */
const SALTO_ID = 8;
/** Contorno de las veredas sobre la textura: grosor en píxeles (antes 2), opacidad y puntos redondos. */
const CONTORNO_ZONA_GROSOR = 4.8;
const CONTORNO_ZONA_OPACIDAD = 0.85;
/** Dirección del sol respecto del punto de mira (metros). */
const SOL_DIRECCION = new THREE.Vector3(-9000, 11000, 7000);
/** Nubes: cúmulos de bocanadas translúcidas que el viento arrastra; cada una proyecta su sombra sobre el terreno. */
const NUBES = 3;
/** Cada cúmulo vive con su propio nivel de viento: uno en calma, uno moderado y uno ventoso (0–1), y su sitio de partida. */
const CUMULOS: { nivel: number; x: number; z: number }[] = [
  { nivel: 0.15, x: -0.5, z: -0.35 },
  { nivel: 0.5, x: 0.15, z: 0.4 },
  { nivel: 0.95, x: 0.55, z: -0.15 },
];
/** Fracción del mapa que cubren las nubes en reposo (con ráfaga se abren hasta ~7 %, el tope). */
const COBERTURA_NUBES = 0.055;
const BOCANADAS = 42;
/** Niebla de valle: cuántos hundimientos del relieve se llenan, y su opacidad máxima (muy sutil). */
const NIEBLA_PUNTOS = 18;
const NIEBLA_OPACIDAD = 0.204;
/** Deriva de la niebla con el viento (m/s del modelo): mucho más lenta que las nubes. */
const VELOCIDAD_NIEBLA = 12;
/** Viento: dirección en planta y velocidad (metros del modelo por segundo, lenta a propósito). */
const VIENTO = new THREE.Vector2(0.94, 0.34);
const VELOCIDAD_VIENTO = 55;
/** Las nubes salen y entran por fuera del mapa: margen, y distancia en que se funden al cruzar el borde. */
const MARGEN_NUBES = 7000;
const FUNDIDO_BORDE = 5000;
/** Altura de la base de las nubes sobre la cima del relieve. */
const ALTURA_NUBES = [2300, 3600];
/** Cuánto se oscurece el terreno bajo el centro de una nube. */
const SOMBRA_NUBE = 0.38;
/** Distancia mínima (metros del modelo) entre la cámara y el relieve que tiene debajo. */
const MARGEN_CAMARA_RELIEVE = 320;
/** Por debajo de esta distancia de cámara, árboles y edificios proyectan sombra. */
const DISTANCIA_SOMBRAS = 9000;
/** Ciclos de la textura del agua por segundo (un ciclo ≈ 2 anchos de cauce). */
const VELOCIDAD_AGUA = 0.6;
/** Separación media entre árboles, en metros. */
const PASO_ARBOLES = 38;
const OPACIDAD_ARBOLES = 0.72;
const ALTO_ANTEPECHO = 0.8;
const MEMBRANAS = ['#7d8388', '#5f6469', '#8e8a84', '#6b6560', '#9aa0a5'].map(c => new THREE.Color(c));
const REMATE = new THREE.Color('#d9d5cc');
const TINACO_NEGRO = new THREE.Color('#1d1f22'), TINACO_AZUL = new THREE.Color('#2f6f9f');

/** ¿El punto cae dentro del polígono (xs, zs)? Trazado de rayo. */
function puntoEnPoligono(x: number, z: number, xs: number[], zs: number[]): boolean {
  let dentro = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if ((zs[i] > z) !== (zs[j] > z) && x < (xs[j] - xs[i]) * (z - zs[i]) / (zs[j] - zs[i]) + xs[i]) dentro = !dentro;
  }
  return dentro;
}
const MARGEN_TRANSPARENCIA = 9;      // m: los árboles a menos de esto de una construcción se ven semitransparentes
/** Altitud (m) desde la que el pino empieza a aparecer entre las demás especies, y a partir de la cual es el único árbol. */
const PINO_DESDE = 1900, PINO_TOTAL = 2100;
/** Cantidad de guayacanes amarillos en todo el territorio. */
const GUAYACANES = 62;
/** Especies de zona baja: nombre en el catálogo, altura (m) con que se siembra, color de la copa en la versión lejana. */
const ESPECIES_BAJAS: { nombre: string; alto: number; copa: string }[] = [
  { nombre: 'Samán', alto: 17, copa: '#3f8a3c' },
  { nombre: 'Yarumo', alto: 17, copa: '#86b56f' },
  { nombre: 'Ceiba', alto: 30, copa: '#4f9a45' },
  { nombre: 'Guayacán', alto: 17, copa: '#f2c316' },
];
/** Margen (radianes) respecto de mirar justo desde arriba; y la cámara nunca baja del nivel horizontal del mapa. */
const LIMITE_POLAR = 0.03;
/** Inclinación (radianes desde la vertical) a partir de la cual se ocultan los nombres: ~77°. */
const ANGULO_OCULTAR_NOMBRES = 1.35;
/**
 * Ancho (metros del modelo) de la ladera con que sube el borde de una vereda levantada. Con 30 m el corte es
 * casi vertical: la zona sube completa, como una pieza, y solo se retira del límite lo que cabe en una celda.
 */
const RAMPA_BORDE = 30;
const DIRECCIONES: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707],
];
/** Código DANE del municipio y años de población con que se fija cuántas viviendas se dibujan en cada vereda. */
const CODIGO_DANE = '05308';
/** Años que se listan en la ficha; con el deslizador se puede ir a cualquiera entre el primero y el último. */
const ANIOS_POBLACION = [2018, 2025, 2030, 2035, 2042, 2050];
const ANIO_INICIAL = 2025;
/** Margen (+15 %) sobre las viviendas estimadas por vereda: solo cambia cuántas se dibujan; los datos no se alteran. */
const FACTOR_VIVIENDAS = 1.15;
/** Huellas (m²) que cuentan como vivienda; las menores son casetas y las mayores, bodegas, que se dejan tal cual. */
const AREA_VIVIENDA: [number, number] = [30, 250];
/** Una huella rural de este tamaño (m²) o mayor, de uno o dos pisos y sin otro uso, es una bodega: cubierta de lámina en vez de teja. */
const AREA_BODEGA = 350;
/** Los edificios son diminutos frente al municipio: se agrandan en vertical para que se lean. */
const ESCALA_EDIFICIOS = 3.2;
/** Las construcciones del catastro llevan pisos reales (3 m cada uno): con la misma exageración se verían como torres, así que se agrandan menos. */
const ESCALA_CATASTRO = 2.2;
/** lado (m) de las teselas en que se parten edificios, árboles y terreno para descartar lo que no se ve */
const TESELA = 1500;
/** lado (m) de las teselas de árboles: más chicas que TESELA para que la GPU descarte los que quedan fuera del encuadre */
const TESELA_ARBOL = 750;
/**
 * teselas por lado de un bloque de árboles lejanos (4 × 750 m = 3 km). Cuando todo el bloque queda lejos se dibuja con
 * una sola malla simple por especie en vez de una por tesela: unas 16 veces menos llamadas de dibujo en la vista general.
 */
const TESELAS_POR_BLOQUE = 4;
/** celdas (de unos 23 m) por lado de cada tesela del terreno */
const TESELA_TERRENO = 64;
/**
 * de más lejos que esto los árboles se dibujan con una versión simple. A 10 km la vista inicial (a ~9,5 km) dibujaba
 * casi todos completos: 14 millones de triángulos para árboles de 2 o 3 píxeles. A 3,5 km un árbol mide ~5 píxeles
 * y la copa simple no se distingue del modelo completo.
 */
const DISTANCIA_ARBOL_SIMPLE = 3500;

/** bloque de árboles lejanos: una malla simple con todas sus teselas, y la esfera que la contiene */
type BloqueArboles = { lejos: THREE.InstancedMesh; centro: THREE.Vector3; radio: number };

/** Geometría nueva que reutiliza los buffers de `g` (posición, normal, color, índice): cada tesela añade solo sus atributos por instancia. */
function compartirGeometria(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const nueva = new THREE.BufferGeometry();
  for (const nombre of Object.keys(g.attributes)) nueva.setAttribute(nombre, g.getAttribute(nombre));
  if (g.index) nueva.setIndex(g.index);
  return nueva;
}
/** fachadas detalladas: lado (m) de la tesela, distancia de la cámara a la que se dibujan, ancho de un hueco y lado mínimo */
const TESELA_FACHADA = 400;
const DISTANCIA_FACHADA = 900;
const ANCHO_BAHIA = 4.4;
const LARGO_FACHADA_MIN = 5;
const PALETAS_COLOR = PALETAS_ATLAS.map(p => new THREE.Color(p.pared));
interface LadoFachada { i: number; j: number; x0: number; z0: number; dx: number; dz: number; nx: number; nz: number; largo: number }
/** scripts/generar_cercas.py: linderos de los predios urbanos (u) y rurales (r), como líneas abiertas. */
interface Cercas { k: number; u: number[][]; r: number[][] }
/** scripts/generar_equipamientos_catastro.py: terreno de un edificio institucional según su predio (centro, giro de la fachada hacia la vía, medidas y pisos). */
interface AjusteCatastro { lon: number; lat: number; yaw: number; ancho: number; fondo: number; pisos: number; predio: string; conf: 'alta' | 'media' }
interface TeselaCerca { pos: number[]; uv: number[]; col: number[]; idx: number[]; ids: number[]; pesos: number[]; sx: number; sz: number; k: number; urbano: boolean }
/** lado (m) de las teselas de cercas y distancia de la cámara a la que se dibujan (urbanas y rurales) */
const TESELA_CERCA = 500;
const DISTANCIA_CERCA_URBANA = 1000;
const DISTANCIA_CERCA_RURAL = 700;
const CERCA_BLANCO = new THREE.Color('#ffffff');
const CERCA_COLORES = ['#ffffff', '#f6e3b0', '#bcd7e6', '#cfe3c0', '#f0c9b8', '#d8d2c8'].map(c => new THREE.Color(c));
/** metros de techo que cubre una repetición de la textura de teja */
const ESCALA_TEJA = 3;
interface TeselaTeja { pos: number[]; uv: number[]; col: number[]; idx: number[]; ids: number[]; pesos: number[] }
interface PendienteFachada { lado: LadoFachada; a: [number, number]; c: [number, number]; b: { n: number; hash: number; pisos: number; uso: number; pal: number; suelo: number; techo: number; id: number; peso: number } }
interface TeselaFachada { pos: number[]; uv: number[]; nor: number[]; idx: number[]; ids: number[]; pesos: number[]; sx: number; sz: number; k: number }
/** Ancho dibujado de las vías por clase (principal, local, sendero), en metros del modelo. */
const ANCHO_VIA = [34, 13, 6];
/** Arbolado de calle: separación media entre árboles (m) a cada lado y fracción de sitios que se siembran. */
const PASO_ARBOL_CALLE = 20, FRACCION_ARBOL_CALLE = 0.4;
/** Repinta de grava o tierra las vías que la red oficial (IGAC) dice que no están pavimentadas (vias-estado-<id>.json). */
const USAR_ESTADO_VIAL = true;
/** Los cauces se dibujan a su ancho real × este factor (el Río Medellín: 30 m → 66 m), con un mínimo para que se lean. */
const FACTOR_ANCHO_CAUCE = 2.2;
const ANCHO_MIN_CAUCE = 6;
/** Puentes: solo donde el cauce dibujado mide al menos esto (metros del modelo); tablero, barandas y su amarillo. */
const ANCHO_MIN_PUENTE = 20;
const COLOR_BARANDA = '#f6c312';
/** Cuánto vira el agua del Río Medellín a su color propio, #AF9447 con ondas azules (0 = azul, 1 = pleno). */
const TINTE_MEDELLIN = 1.0;
/**
 * Colores del Río Medellín según el caudal y el clima. El color general va pasando, despacio y al azar, entre los tres
 * primeros; los dos últimos son vertimientos locales que tiñen solo el tramo junto a una industria cercana al río.
 */
const COLORES_MEDELLIN = ['#A0683B', '#4A3324', '#5B7A51'];   // terracota (caudal ordinario), café lodoso (lluvias), verde oliva (tramo alto)
const COLOR_VERTIMIENTO_TEXTIL = '#1E3F8A';                   // azul añil
const COLOR_VERTIMIENTO_COLORANTE = '#9B2242';                // rojo carmín
/** Segundos que tarda el río en pasar de un color al siguiente, y que se queda en cada uno. */
const CAMBIO_COLOR_RIO = 40;
const REPOSO_COLOR_RIO = 25;
/** Una industria tiñe el río si queda a menos de esto (m) de su cauce; la mancha se extiende este alcance a lo largo del río. */
const ALCANCE_CERCA_RIO = 260;
const ALCANCE_MANCHA = 230;
/** Bandada que cruza el Río Medellín de sur a norte: cuántos pájaros, velocidad (m/s del modelo), recorrido total y pausa entre pasadas. */
const PAJAROS = 11;
/** Fábricas: separación mínima entre dos (m). Humo: bocanadas por chimenea, segundos por ciclo, altura de subida, deriva (m/s), radio de la aureola y opacidad. */
/** Etiquetas de los sectores del inventario de Corantioquia. */
const SECTORES: Record<string, string> = {
  BAT: 'Alimentos y bebidas', TXT: 'Textiles', PCE: 'Plásticos y caucho', QMC: 'Química', ASF: 'Asfaltos y mezclas',
  MAD: 'Madera', MMC: 'Metalmecánica', PAP: 'Papel', CVL: 'Cerámica y arcilla', OTR: 'Otros',
};
/** Contaminantes que se muestran y su nombre. */
const CONTAMINANTES: [string, string][] = [
  ['MP', 'Material particulado'], ['PM10', 'PM10'], ['PM2.5', 'PM2.5'], ['SO2', 'SO₂'], ['NO2', 'NO₂'],
  ['CO', 'CO'], ['COV', 'COV'], ['CH4', 'CH₄'], ['CO2', 'CO₂'],
];
const RADIO_FABRICA = 55;
/** Escalas con que cabe una fábrica en su predio: de la nave completa a la mitad. */
const ESCALAS_FABRICA = [1, 0.85, 0.72, 0.6, 0.5];
const HUMO_BOCANADAS = 28;
const HUMO_CICLO = 34;
const HUMO_ALTURA = 140;
const HUMO_DERIVA = 9;
const HUMO_AUREOLA = 100;
const HUMO_OPACIDAD = 0.7;
/** Tráfico de la doble calzada: velocidad de los autos (m/s del modelo), metros entre autos por calzada y su paleta. */
const TRAFICO_VELOCIDAD = [13, 23].map(v => v * ESCALA_ACTIVOS);   // 47–83 km/h reales
const TRAFICO_ESPACIO = 200;
/** Largo aproximado de un vehículo (m del modelo): distancia mínima que guardan entre sí en la red del pueblo. */
const LARGO_AUTO = 5.5 * ESCALA_ACTIVOS;
/** Pueblo: radio (m) alrededor del centro de Girardota donde las vías forman una red, y metros de vía por auto. */
const RADIO_PUEBLO = 2600;
const TRAFICO_ESPACIO_PUEBLO = 227;
/** Dos equipamientos pueden acercarse hasta esta fracción de la suma de sus radios (1 = sin tocarse), para que queden junto a su coordenada. */
const SOLAPE_EQUIPAMIENTOS = 0.75;
/** Las canchas y placas de una misma manzana están pegadas: entre ellas pueden acercarse más. */
const SOLAPE_DEPORTE = 0.4;
/** Las canchas y placas están pegadas a la calle en las manzanas angostas: piden menos holgura a las vías (fracción de su radio) que el resto. */
const HOLGURA_DEPORTE = 0.3;
/** En el tejido urbano los edificios quedan al menos a esta distancia (m) del borde de la calzada. */
const MARGEN_VIA = 1.5;
/** Tejido urbano (se contrasta con la foto satelital): celdas de CELDA_URBANA m y mínimo de edificios en la celda y sus 8 vecinas. */
const CELDA_URBANA = 40, MIN_URBANO = 20;
/** Canchas y placas de un mismo conjunto: distancia máxima entre ellas (m), holgura a la calle y separación entre una y otra. */
const CONJUNTO_DEPORTE = 60, ORILLA_DEPORTE = 4, SEPARACION_DEPORTE = 4;
const COLORES_AUTOS = ['#ff2d2d', '#ff8a00', '#ffd400', '#00d26a', '#00c2ff', '#2f6bff', '#e040fb', '#ff4fa3'];
/**
 * Vehículos del tráfico (modelos del catálogo): el auto es el único que cambia de color; el camión y el bus solo van por
 * vías principales, el campero FJ solo por veredas, y el taxi por cualquier vía.
 */
const FLOTA = ['Auto', 'Taxi', 'Campero FJ', 'Bus', 'Camión con tráiler', 'Moto'];
const [AUTO, TAXI, FJ, BUS, CAMION, MOTO] = [0, 1, 2, 3, 4, 5];
/** Parte de la flota que se reparte entre los tipos que la vía permite; el resto son autos. */
const MEZCLA_FLOTA: [number, number][] = [[CAMION, 0.1], [BUS, 0.04], [TAXI, 0.15], [FJ, 0.2], [MOTO, 0.3]];
/** Color de la carrocería del auto en su modelo: las piezas de este color toman el del vehículo. */
const COLOR_CARROCERIA_AUTO = '#ff2d2d';
/** Color de la carrocería del campero FJ en su modelo: toma uno de COLORES_RURALES (rojo con techo blanco, azul, verde...), distintos a los de los autos. */
const COLOR_CARROCERIA_FJ = '#d8c9a0';
/** Camperos de ruta que salen de cada central de transporte veredal, y personas que se concentran en la plaza de mercado y en las centrales. */
const CAMPEROS_POR_CENTRAL = 12;
const FOCOS_GENTE: [string, number][] = [['Plaza de Mercado', 36], ['Central de transporte veredal (calle 5b)', 24], ['Parqueadero de buses veredal', 24]];
/**
 * Gente a pie (modelos "Personas" del catálogo): camina por las aceras de la red del pueblo, a la misma escala exagerada de los
 * vehículos. Solo se dibuja la que está a menos de GENTE_RADIO metros del punto que se mira, y solo si la cámara está a menos
 * de GENTE_DISTANCIA_MAX de él: fuera de ahí ni se mueve ni se pinta. Velocidad en m/s del modelo.
 */
const GENTE = ['Hombre', 'Mujer', 'Niño escolar', 'Campesino'];
const [HOMBRE, MUJER, NINO, CAMPESINO] = [0, 1, 2, 3];
const MEZCLA_GENTE: [number, number][] = [[CAMPESINO, 0.12], [NINO, 0.15], [MUJER, 0.35]];
const TINTES_GENTE = ['#ffffff', '#f4e6d8', '#e8d2bb', '#d9bd9f', '#cfae90'];
const GENTE_ESCALA = ESCALA_ACTIVOS;
const GENTE_ESPACIO = 60;
const GENTE_MAX = 3000;
const GENTE_RADIO = 350;
const GENTE_DISTANCIA_MAX = 1000;
/** con la cámara más lejos que esto del centro de la vista, los autos (de menos de un píxel) ni se mueven ni se dibujan */
const TRAFICO_DISTANCIA_MAX = 4000;
const GENTE_VELOCIDAD = [1.3, 2.1].map(v => v * ESCALA_ACTIVOS);   // paso real de 4,7 a 7,5 km/h
/** Distancia de la acera al eje de la vía (justo fuera de su calzada, de ANCHO_VIA / 2): en vías principales y en calles locales. */
const GENTE_ACERA = [19.5, 8.5];
/** Tumbos al caminar: cuánto se ladea (rad) y cuánto se inclina hacia adelante en cada paso. */
const GENTE_TUMBO = 0.13, GENTE_CABECEO = 0.04;

/** Une las piezas de un modelo del catálogo en una sola geometría, con el color de cada pieza en sus vértices. */
function fusionarColoreado(piezas: Modelo['piezas']): THREE.BufferGeometry | null {
  if (!piezas.length) return null;
  const c = new THREE.Color(), hayMov = piezas.some(p => p.mov);
  const gs = piezas.map(p => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const n = g.getAttribute('position').count, col = new Float32Array(n * 3);
    c.set(p.color);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (hayMov) {
      const mv = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) mv.set(p.mov ?? [0, 0, 0], i * 3);
      g.setAttribute('miembro', new THREE.BufferAttribute(mv, 3));
    }
    return g;
  });
  return mergeGeometries(gs, false);
}
const VELOCIDAD_PAJAROS = 130;
const RECORRIDO_PAJAROS = 6800;
const PAUSA_PAJAROS = 14;
/**
 * Boeing 787-9 (62,5 m de largo, 59,8 m de envergadura: a escala real, el relieve es lo único que se exagera) que cruza el
 * mapa de El Yarumo a La Holanda: altitud en metros sobre el nivel del mar (se lleva al relieve con la misma exageración, así
 * conserva su holgura sobre las cumbres), velocidad (m/s), pausa entre pasadas y tramo (m) que sigue volando fuera del mapa.
 */
const ALTITUD_AVION = 2850;
/** Ruta en S: cuánto se aparta (m) a cada lado de la recta, y cuánto se exagera la inclinación de las alas en los giros (1 = la física real). */
const AMPLITUD_S_AVION = 2600;
const BANDEO_AVION = 1.6;
const VELOCIDAD_AVION = 110;
const PAUSA_AVION = 30;
const MARGEN_AVION = 3000;
/** Hasta esta distancia a la cámara (m) el avión mide lo real; más allá se agranda en proporción, hasta ESCALA_MAX_AVION veces. */
const DISTANCIA_REAL_AVION = 2500;
/** El avión se dibuja un 25 % más grande que el real (1 = tamaño real). */
const TAMANO_AVION = 1.25;
const ESCALA_MAX_AVION = 5;
/**
 * Estela: una bocanada cada ESTELA_ESPACIO metros por motor (hasta ESTELA_PUFFS en total), que dura ESTELA_VIDA segundos,
 * se ensancha unas 5 veces mientras se disipa y deriva con el viento (m/s). Opacidad máxima. La nube pequeña de la ruta
 * (radio en m) se la traga: dentro de ella la estela casi no se distingue.
 */
const ESTELA_PUFFS = 320;
const ESTELA_VIDA = 24;
const ESTELA_ESPACIO = 26;
const ESTELA_OPACIDAD = 0.3;
const ESTELA_DERIVA = 5;
const NUBE_AVION_RADIO = 480;
/** Salida de los motores (m desde el centro del avión): x, y, z de cada uno. */
const MOTORES_AVION: [number, number, number][] = [[0, 2.8, -9.8], [0, 2.8, 9.8]];
/** Luces del avión (m desde su centro, nariz hacia +x): navegación roja a la izquierda y verde a la derecha, destellos blancos en las puntas de ala y la cola, y baliza roja. */
const LUCES_AVION: { tipo: LuzAvion['tipo']; color: string; pos: [number, number, number]; tam: number }[] = [
  { tipo: 'nav', color: '#ff3a2a', pos: [-12, 8.2, -29.9], tam: 3 },
  { tipo: 'nav', color: '#2aff7a', pos: [-12, 8.2, 29.9], tam: 3 },
  { tipo: 'destello', color: '#f4f8ff', pos: [-12, 8.2, -29.9], tam: 5 },
  { tipo: 'destello', color: '#f4f8ff', pos: [-12, 8.2, 29.9], tam: 5 },
  { tipo: 'destello', color: '#f4f8ff', pos: [-30.8, 7, 0], tam: 5 },
  { tipo: 'baliza', color: '#ff3030', pos: [6, 8.5, 0], tam: 4 },
];
/** Distancia (píxeles) a la que el cursor "toca" un cauce: de lejos son líneas finísimas. */
const TOLERANCIA_CAUCE_PX = 9;
/** Opacidad del velo de color de las veredas sobre la imagen satelital. */
const VELO_VEREDA = 0.2;
/** Ajuste de tono de la foto satelital: más clara, sin desenfoque. */
const TONO_FOTO = 'brightness(1.4) contrast(0.95) saturate(1.1)';
/** Giro (rad) de la cuadrícula del casco urbano de Girardota: el parque y la catedral siguen la dirección de sus calles. */
const GIRO_CASCO = 0.6946;
/**
 * Sitios cuya coordenada en la capa de puntos cae fuera de su lugar real (la catedral figura dentro del parque): se asientan donde
 * están en la realidad, con la orientación de las calles, sin buscar un hueco libre. El modelo reemplaza al catastro bajo su huella.
 */
const SITIOS_FIJOS = new Map<string, { lat: number; lng: number; yaw: number; dim?: [number, number] }>([
  ['Catedral Nuestra Señora del Rosario', { lat: 6.376837, lng: -75.445853, yaw: GIRO_CASCO }],
  ['Parque principal', { lat: 6.377512, lng: -75.446118, yaw: GIRO_CASCO }],
  // Unidad deportiva del INDER (carrera 14 con calle 12A). El estadio va en el centro de su óvalo vial (eje a 22,5°, 142 × 76 m) y las demás unidades
  // a las distancias que da la imagen satelital desde él: centro, giro y huella [largo, ancho] en m.
  ['Pista de patinaje', { lat: 6.373581, lng: -75.451523, yaw: 0.14, dim: [80, 46] }],
  ['Cancha engramada Inder', { lat: 6.373735, lng: -75.450293, yaw: -0.39, dim: [96, 70] }],
  ['Coliseo Metropolitano de Girardota', { lat: 6.373157, lng: -75.450519, yaw: -0.55, dim: [62, 44] }],
  ['Cancha sintetica Inder', { lat: 6.372871, lng: -75.451405, yaw: -0.5, dim: [64, 56] }],
  ['Piscina del inder', { lat: 6.374005, lng: -75.451497, yaw: 0.09, dim: [50, 34] }],
  // Zona aledaña (hospital, casa de la cultura, Innova, estación de policía y las dos placas del INDER): posición respecto al estadio medida en la
  // imagen satelital, con el giro de la cuadrícula del casco (~50°). Las placas van donde las da Mindeporte (techos verdes de la imagen).
  ['E.S.E. Hospital San Rafael de Girardota', { lat: 6.374882, lng: -75.44929, yaw: -0.89, dim: [80, 42] }],
  ['Pedrito Ruiz de Girardota', { lat: 6.374339, lng: -75.449742, yaw: -0.85, dim: [44, 29] }],
  ['Parque educativo Innova', { lat: 6.374367, lng: -75.450465, yaw: 0.15, dim: [64, 34] }],
  ['Estación Girardota', { lat: 6.3742, lng: -75.449181, yaw: -0.85, dim: [40, 48] }],
  ['Placa Inder 1', { lat: 6.373247, lng: -75.44966, yaw: -0.6, dim: [34, 24] }],
  ['Placa Inder 2', { lat: 6.373581, lng: -75.449489, yaw: -0.6, dim: [34, 24] }],
  // Manzana de la plaza de mercado (carrera 16, calle 6 y calle 5B) y las centrales de transporte veredal, medidas sobre la imagen satelital con el
  // pin de Google Maps; todas con el giro de la cuadrícula del casco. De las centrales salen los camperos de ruta hacia las veredas.
  ['Plaza de Mercado', { lat: 6.3780336, lng: -75.4454482, yaw: GIRO_CASCO, dim: [62, 58] }],
  ['Central de transporte veredal (calle 5b)', { lat: 6.378196, lng: -75.445186, yaw: GIRO_CASCO, dim: [40, 36] }],
  ['Parqueadero de buses veredal', { lat: 6.37779, lng: -75.444644, yaw: GIRO_CASCO, dim: [60, 44] }],
  // Manzana de las carreras 16 y 15 con la calle 7: su interior es el parqueadero Santa Ana (lote asfaltado con portón sobre la carrera 16).
  ['Centro comercial (manzana del parque)', { lat: 6.37709, lng: -75.446718, yaw: GIRO_CASCO, dim: [44, 36] }],
  // Barrio Aurelio Mejía: colegio sobre la calle 5 (ala larga de aulas) y, al otro lado de la calle, la placa cubierta y la cancha sintética con su costado
  // de graderías hacia la placa. Posición y giro tomados de las huellas del catastro y de la imagen satelital.
  ['I. E. COLOMBIA', { lat: 6.378315, lng: -75.443862, yaw: -1.171, dim: [68, 30] }],
  ['Placa barrio Aurelio Mejia', { lat: 6.378671, lng: -75.443635, yaw: 2.175, dim: [32, 20] }],
  ['Cancha sintetica Aurelio Mejia', { lat: 6.378833, lng: -75.443341, yaw: 2.15, dim: [56, 40] }],
  ['Parqueadero Santa Ana', { lat: 6.376837, lng: -75.447134, yaw: GIRO_CASCO, dim: [56, 46] }],
  // Colegio Nuestra Señora del Rosario: manzana de la carrera 14 con calle 9, ubicada con el pin de Google Maps y la cuadrícula del casco.
  ['COLEGIO NUESTRA SEÑORA DEL ROSARIO (P)', { lat: 6.37558, lng: -75.446358, yaw: GIRO_CASCO, dim: [58, 46] }],
  // Sede Comfama (carrera 18 Bis con calle 5AA): un solo edificio con el colegio, la piscina y el centro de salud; centro de los predios
  // 0110-00013 y 0110-00014 del catastro. El modelo lo lleva el centro de salud y las otras dos partes van en PARTES.
  ['Centro Integral de Salud Comfama Girardota', { lat: 6.3797616, lng: -75.4462567, yaw: GIRO_CASCO, dim: [59, 27] }],
  // Peaje El Trapiche (Autopista Norte, km 25): centro entre los dos tramos de 12 m en que OSM corta las calzadas en las casetas
  // (vías 3142 y 3143 de vias-49.json, alineados a lo ancho), que concuerda a 10 m con la coordenada de la ANI. Rumbo de la autopista
  // 39° desde el este; calzadas a 15 m entre ejes. Va sobre la vía (modelo.sobreVia): no se corre.
  ['Peaje El Trapiche', { lat: 6.399593, lng: -75.43296, yaw: 0.6807, dim: [96, 59.8] }],
]);
/** Puntos que son parte de otro sitio: no llevan edificio propio; su descripción se suma a la del sitio que los contiene. */
const FUSIONES = new Map<string, string>([['Señor caído', 'Catedral Nuestra Señora del Rosario'], ['Mercado agroverde', 'Parque principal']]);
/**
 * Lugares que comparten un mismo edificio y conservan cada uno su icono y su ficha: `sitio` es el punto de SITIOS_FIJOS que lleva el modelo
 * y (x, z, alto) dónde va el icono en los ejes del modelo; `nivel`, entre qué alturas sobre la losa queda su piso. Al tocar el edificio se abre
 * la parte del piso tocado o, si no hay pisos, la más cercana.
 */
const PARTES = new Map<string, { sitio: string; x: number; z: number; alto: number; nivel?: [number, number] }>([
  ['Centro Integral de Salud Comfama Girardota', { sitio: 'Centro Integral de Salud Comfama Girardota', ...PARTES_COMFAMA.salud }],
  ['COLEGIO COMFAMA', { sitio: 'Centro Integral de Salud Comfama Girardota', ...PARTES_COMFAMA.colegio }],
  ['Piscina de confama', { sitio: 'Centro Integral de Salud Comfama Girardota', ...PARTES_COMFAMA.piscina }],
]);

/** Cuánto se levanta (metros del modelo) una vereda al elegirla; al pasar el cursor solo se le dibuja el borde. */
const ALZA_ELEGIDA = 170;

/** scripts/estimar_trafico_vias.py: vehículos por día estimados en cada tramo (escenario medio y rango bajo–alto). */
interface TraficoRed {
  anio: number; unidad: string; peaje: { obs: number };
  tramos: { id: string; t: string; vd: number; min: number; max: number; c: string; conf: string; dc: boolean; g: [number, number][] }[];
}
/** scripts/proyectar_trafico_trapiche.py: serie del peaje El Trapiche, su modelo y los escenarios a 2035. */
interface TraficoPeaje {
  lat: number; lon: number;
  base: { anio: number; tpd: number; pesados_pct: number };
  modelo: { crec_tendencia: number; validacion: { mape: number } };
  escenarios: Record<string, Record<string, { tpd: number; crec: number }>>;
}
/** Clases de tráfico (vehículos por día): color y grosor de la cinta sobre la vía. */
const CLASES_TRAFICO = [
  { c: 'muy alto', nombre: 'Muy alto', nota: 'más de 10,000', color: '#d32f2f', radio: 5, lejos: 0.0026 },
  { c: 'alto', nombre: 'Alto', nota: '3,000 a 10,000', color: '#fb8c00', radio: 3.6, lejos: 0.0019 },
  { c: 'medio', nombre: 'Medio', nota: '1,000 a 3,000', color: '#fdd835', radio: 2.6, lejos: 0.0013 },
  { c: 'bajo', nombre: 'Bajo', nota: '300 a 1,000', color: '#c0ca33', radio: 1.8, lejos: 0.0008 },
  { c: 'muy bajo', nombre: 'Muy bajo', nota: 'menos de 300', color: '#66bb6a', radio: 1.2, lejos: 0.0004 },
] as const;

/** scripts/generar_barrios.py: barrios del casco urbano (GeoJSON lon/lat). */
interface Barrios {
  features: {
    geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };
    properties: { codigo: string; nombre: string | null; confianza: string; rotulo?: [number, number] };
  }[];
}

interface Relieve {
  bbox: [number, number, number, number];
  nx: number;
  ny: number;
  min: number;
  max: number;
  /** alturas en decímetros, Int16 little-endian en base64 */
  dm: string;
}

/** Datos horneados por scripts/generar_vias_edificios.py: enteros × k, primera pareja absoluta y el resto diferencias. */
interface Compacto {
  k: number;
  v?: number[][];
  e?: number[][];
  /** catastro (scripts/generar_catastro_3d.py), alineados con `e`: pisos (0 = se desconoce), uso (0 residencial, 1 comercial, 2 industrial) y origen (0 catastro urbano, 1 catastro rural, 2 complemento de Overture/OSM) */
  p?: number[];
  u?: number[];
  r?: number[];
  /** catastro asentado (scripts/asentar_vias_edificios.py): piso de cada construcción, el nivel de la acera frente a ella (cm sobre el mínimo del relieve, sin exagerar), o null */
  n?: (number | null)[];
}

/** scripts/generar_jardines.py: contornos de patios y jardines del casco urbano (j) y puntos de árboles (a) y matas (m) de cada uno. */
interface Jardines {
  k: number;
  j: number[][];
  a: number[][];
  m: number[][];
}

interface GrupoCinta { pos: number[]; idx: number[]; ids: number[]; uv: number[]; pesos: number[]; }

/**
 * scripts/generar_cauces.py: c = cauces de OSM [ancho_m, i_nombre, x0, y0, dx, dy…], i = tramos del IGAC 1:100.000 que
 * OSM no tiene (mismo formato), t = entubados, l = lagos [i_nombre, …].
 */
interface Cauces {
  k: number;
  n: string[];
  /** nombres deducidos de la red ("Afluente de …"); en los cauces, el código de nombre es -2 - índice */
  d?: string[];
  c: number[][];
  i?: number[][];
  t?: number[][];
  l?: number[][];
}

/** Un río o quebrada seleccionable: todos sus tramos con el mismo nombre. */
interface Rio {
  clave: string;
  nombre: string;
  /** ancho real o estimado, en metros */
  ancho: number;
  /** pares de vértices de la cinta de agua (cada par = un punto de la línea) */
  tramos: { ini: number; n: number }[];
  largo: number;
  ancla: [number, number];
  anclaLargo: number;
  /** todos sus tramos vienen del IGAC (no están en OpenStreetMap) */
  igac: boolean;
  /** el nombre se dedujo de la red ("Afluente de …"), no es un nombre oficial */
  derivado: boolean;
}

/** Vértices que suben y bajan con su vereda cuando esta se levanta. */
interface Capa {
  atributo: THREE.BufferAttribute;
  base: Float32Array;
  porPieza: number[][];
  /** 0–1 por vértice: el borde de la vereda sube poco a poco, no de golpe */
  peso: Float32Array;
}

/** public/data/mapa/poblacion/veredas-<DANE>.geojson (scripts/generar_poblacion_veredas.py): solo se usan las propiedades. */
interface PoblacionVeredas {
  metadata?: { fuente?: string; tipo?: string };
  features: { properties: { nombre: string; viv2018: number } & Record<string, number | string> }[];
}

/**
 * public/data/poblacion/<DANE>-edad.json (scripts/proyectar_poblacion_edad.py): personas por sexo y grupo de 5 años de
 * la cabecera y de cada vereda, año por año. Hasta `oficial_hasta` es la serie del DANE; después, extrapolación.
 */
interface PoblacionEdad {
  metadata: { anios: number[]; oficial_hasta: number; grupos: string[]; metodo: string; fuente: string; referencia_2043_2050: string };
  zonas: {
    id: string; nombre: string; tipo: 'cabecera' | 'vereda';
    /** [año][grupo] */
    H: number[][]; M: number[][];
    indicadores: { edad_mediana: number; dependencia: number; envejecimiento: number }[];
  }[];
}

/**
 * Grupos de edad por curso de vida (los de la política pública en Colombia: primera infancia, niñez y adolescencia,
 * juventud —Ley 1622 de 2013—, adultez y persona mayor —Ley 1251 de 2008, desde los 60—), armados con los grupos
 * quinquenales de la proyección: `desde` y `hasta` son índices de esos grupos (0 = 0–4 años … 16 = 80 y más).
 */
const GRUPOS_VIDA = [
  { nombre: 'Primera infancia', rango: '0 a 4 años', desde: 0, hasta: 0 },
  { nombre: 'Niñez y adolescencia', rango: '5 a 14 años', desde: 1, hasta: 2 },
  { nombre: 'Jóvenes', rango: '15 a 29 años', desde: 3, hasta: 5 },
  { nombre: 'Adultos jóvenes', rango: '30 a 44 años', desde: 6, hasta: 8 },
  { nombre: 'Adultos', rango: '45 a 59 años', desde: 9, hasta: 11 },
  { nombre: 'Personas mayores', rango: '60 años y más', desde: 12, hasta: 16 },
] as const;

/** Población de una zona en un año por grupo de edad, con su peso y su cambio frente al primer año de la serie. */
interface Piramide {
  anio: number; extrapolado: boolean;
  /** primer año de la serie, con el que se compara */
  base: number;
  total: number; hombres: number; mujeres: number;
  grupos: {
    nombre: string; rango: string; total: number; hombres: number; mujeres: number;
    /** % del total de la zona en el año */
    peso: number;
    /** % de cambio frente al año base (null si en el año base no había nadie) */
    cambio: number | null;
    /** anchos de la barra (en % del grupo más grande de toda la serie) y del contorno del año base */
    ah: number; am: number; base: number;
  }[];
  indicadores: { edad_mediana: number; dependencia: number; envejecimiento: number };
}

interface Bocanada {
  sprite: THREE.Sprite;
  /** desplazamiento respecto del centro de la nube (m) */
  ox: number; oy: number; oz: number;
  tamano: number;
  opacidad: number;
  fase: number;
  giro: number;
  /** giro propio de partida (rad); se pierde a medida que el viento alinea la bocanada */
  rot0: number;
}

/** Polilínea de tráfico. Con rasante, por punto: media calzada y borde de acera a la izquierda (`lp`, `ap`) y a la derecha (`ln`, `an`) del sentido del trazado. */
interface Calzada { x: number[]; z: number[]; y: number[]; cum: number[]; largo: number; lp?: number[]; ln?: number[]; ap?: number[]; an?: number[]; }
/** `tipo` = índice en FLOTA; `k` = su lugar dentro de las mallas instanciadas de ese tipo. */
/** Pose suavizada de un vehículo (`vivo` = ya tiene pose; se apaga al saltar de vía para que no barra el mapa) y su velocidad actual `vi`. */
interface PoseAuto { px?: number; pz?: number; yaw?: number; vi?: number; vivo?: boolean; }
interface Auto extends PoseAuto { calzada: number; s: number; i: number; v: number; carril: number; tipo: number; k: number; }
/** Tramo de vía entre dos cruces de la red del pueblo; `unico` = solo se circula de `ini` a `fin`; `rural` = cae en una vereda. */
interface Arista extends Calzada { unico: boolean; vf: number; ini: string; fin: string; rural: boolean; }
/** `ruta` = tramos (arista, sentido) que le faltan al campero de ruta; `central` = de cuál sale; `ida` = va hacia una vereda (si no, de vuelta a la central). */
interface AutoRed extends PoseAuto { lider?: AutoRed; arista: number; s: number; i: number; dir: 1 | -1; v: number; carril: number; tipo: number; k: number; ruta?: [number, 1 | -1][]; central?: number; ida?: boolean; }
/** Persona a pie: `tipo` = índice en GENTE, `lado` = distancia (con signo) de la acera al eje de la vía, `tinte` = índice en TINTES_GENTE. */
interface Peaton { ancla?: boolean; arista: number; s: number; i: number; dir: 1 | -1; v: number; lado: number; tipo: number; tinte: number; fase: number; }

/** Área de un polígono (lista de [x, z]). */
function areaPoligono(poly: number[][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(a) / 2;
}
/** ¿El punto (x, z) cae dentro del polígono (lista de [x, z])? */
function enPoligono(x: number, z: number, poly: number[][]): boolean {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) dentro = !dentro;
  }
  return dentro;
}
/** scripts/generar_industrias_catastro.py: bodega real del catastro que ocupa una fábrica (contorno en metros, en un marco con la fachada hacia +z). */
/** scripts/generar_tanques.py: tanques de almacenamiento [lon, lat, radio (m), alto (m)]. */
type Tanque = [number, number, number, number];
/** scripts/generar_infraestructura.py: líneas de alta tensión [kV, puntos], subestaciones [nombre, kV, polígono] y plantas [tipo, nombre, puntos] (OSM). */
/** scripts/generar_redes_agua.py: tuberías [tipo, diámetro mm, profundidad m, puntos, material, estado, nombre] y puntos [tipo, lon, lat, dato] de EPM. */
/** Tubería o línea eléctrica (polilínea 3D) o equipo (un punto) que se puede señalar y elegir como un río. */
interface ElementoRed {
  nombre: string; detalle: string; pts: THREE.Vector3[]; radio: number;
  /** si es un edificio de servicios público: lleva pin en el mapa, dentro de su subtipo de la leyenda */
  pin?: { cat: CategoriaServicio; tipo: string; estado: string; fuente: string; aprox: boolean; alto: number };
}
/** A qué edificio señala un pin: un equipamiento, una fábrica o un edificio de servicios públicos. */
type RefPin = { tipo: 'equip' | 'fabrica' | 'servicio'; i: number };
const TOLERANCIA_RED_PX = 8;
const NOMBRE_TUBERIA: Record<string, string> = {
  a1: 'Acueducto · red primaria', a2: 'Acueducto · red secundaria', rs: 'Alcantarillado sanitario', rl: 'Alcantarillado de aguas lluvias',
};
/**
 * Hace que un material engorde con la distancia a la cámara para que tuberías, conductores y torres se vean de lejos (a ~1,5 px de
 * radio): los vértices se separan de su eje a lo largo de la normal, o cada instancia crece sobre sí misma. De cerca no cambia nada.
 */
function engrosar<M extends THREE.Material>(m: M, k: number, tope: number, instanciado = false): M {
  m.onBeforeCompile = sh => {
    const ref = instanciado ? 'instanceMatrix[3].xyz' : 'position';
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float dEngrosar = distance(cameraPosition, (modelMatrix * vec4(${ref}, 1.0)).xyz);
      ${instanciado ? `transformed *= 1.0 + min(dEngrosar * ${k.toFixed(5)}, ${tope.toFixed(1)});` : `transformed += normal * min(dEngrosar * ${k.toFixed(5)}, ${tope.toFixed(1)});`}`);
  };
  m.customProgramCacheKey = () => `engrosar-${k}-${tope}-${instanciado}`;
  return m;
}
/** Prisma de sección cuadrada entre dos puntos 3D: se agrega a los arreglos de una malla indexada (color opcional). */
function prisma(a: THREE.Vector3, b: THREE.Vector3, r: number, pos: number[], idx: number[], col?: number[], c?: THREE.Color): void {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
  const nx = L > 0.01 ? -dz / L : 1, nz = L > 0.01 ? dx / L : 0, base = pos.length / 3;
  for (const p of [a, b]) for (const [u, v] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    pos.push(p.x + nx * u * r, p.y + v * r, p.z + nz * u * r);
    if (col && c) col.push(c.r, c.g, c.b);
  }
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    idx.push(base + k, base + 4 + k, base + 4 + k2, base + k, base + 4 + k2, base + k2);
  }
}
interface RedesAgua { t: [string, number, number, [number, number][], string, string, string][]; p: [string, number, number, number][] }
/** scripts/generar_instalaciones_agua.py: [tipo, nombre, lon, lat, estado, radio m] ubicadas sobre el mapa del PBOT (± ~25 m). */
type InstalacionAgua = [string, string, number, number, string, number];
interface Infraestructura { lineas: [number, [number, number][], number?][]; subs: [string, number, [number, number][]][]; plantas: [string, string, [number, number][]][] }
interface AjusteIndustria { lon: number; lat: number; yaw: number; largo: number; fondo: number; pisos: number; parque: string | null; poly: number[][] }
interface FabricaMapa { x: number; z: number; lon: number; lat: number; n: string; datos: Industria; r: number; esc: number; parque: boolean; yaw: number; lider: boolean; cat?: AjusteIndustria }
interface Industria {
  n: string; ciiu: number | null; c: string; dir?: string; lat: number; lon: number;
  fuentes?: number; combustibles?: string[]; equipos?: string[]; chimenea?: number | null; control?: string[];
  /** emisiones anuales estimadas (Mg/año) y flujos medidos en chimenea (kg/h), por contaminante */
  em?: Record<string, number>; kgh?: Record<string, number>;
}

/** Panel lateral derecho de un pin: datos en forma de tooltip, que se irán ampliando. */
interface FichaPin {
  color: string; glifo: string; categoria: string; titulo: string;
  filas: { k: string; v: string }[];
  fuente: string;
  /** parámetros para abrir este punto en el mapa 2D (solo los equipamientos están allí) */
  mapa2d: { punto: string; lat: number; lng: number; desde: '3d' } | null;
  /** la coordenada es aproximada (centro de la vereda o estimada de la dirección) */
  aproximada: boolean;
}

/** Proyección de población de una vereda en todos los años, para el panel de la zona elegida. */
interface ProyeccionVereda {
  nombre: string; tipo: string;
  /** viv es null en la cabecera: allí se dibuja el catastro completo y no se estiman viviendas */
  anios: { anio: number; pob: number; viv: number | null; alto: number; actual: boolean; extrapolado: boolean }[];
  variacion: string; fuente: string;
  infra: InfraZona;
  piramide: Piramide | null;
  /** primer y último año de la serie, y último año oficial */
  rango: { desde: number; hasta: number; oficial: number } | null;
}

/** public/data/plan/<DANE>-zonas.json (scripts/plan_desarrollo/zonas_indicadores.py): indicadores del plan por vereda nombrada. */
interface ProyectoZona {
  ip: string; indicador: string;
  /** id de la dependencia que lo reporta, y su nombre */
  dep: string | null; dep_nombre: string | null;
  pct: number | null; anio_pct: number | null;
  menciones: { anio: string; texto: string }[];
}
interface ZonasPlan { fuente: string; zonas: Record<string, ProyectoZona[]>; }

/** Infraestructura que cae dentro de una zona, agrupada por categoría (incluye las industrias). */
interface InfraZona {
  total: number;
  grupos: { id: string; nombre: string; color: string; glifo: string; items: { n: string; ref: RefPin }[] }[];
}

interface FichaFabrica {
  nombre: string; sector: string; direccion: string; resumen: string; combustibles: string; control: string;
  emisiones: { k: string; v: string }[]; flujos: string;
}
interface Humo {
  x: number; y: number; z: number;
  fase: number;
  /** índice de su primera bocanada en la malla instanciada del humo */
  ini: number;
  puffs: { tex: number; theta: number; giro: number; tam: number; desv: number }[];
}

interface LuzAvion {
  sprite: THREE.Sprite;
  tipo: 'nav' | 'destello' | 'baliza';
  tam: number;
}

interface PuffEstela {
  sprite: THREE.Sprite;
  /** segundos de vida; −1 = libre para reutilizarse */
  edad: number;
  x: number; y: number; z: number;
  base: number;
}

interface Avion {
  grupo: THREE.Group;
  luces: LuzAvion[];
  /** punto de la recta (x, z) y su dirección unitaria; el avión recorre t ∈ [t0, t1] desde ese punto */
  x0: number; z0: number; dx: number; dz: number; t0: number; t1: number;
  y: number;
  /** la ruta en S: se aparta amp · sen(k · (t − t0)) a un lado de la recta, así que sale y llega sobre ella */
  amp: number; k: number;
}

interface Pajaro {
  grupo: THREE.Group;
  /** ala completa (pivote en el hombro) y su tramo exterior (pivote en el codo) */
  izq: THREE.Group;
  der: THREE.Group;
  codoIzq: THREE.Group;
  codoDer: THREE.Group;
  /** posición respecto del guía: a un lado (ox), atrás hacia el sur (oz) y en altura (oy) */
  ox: number; oz: number; oy: number;
  y: number;
  fase: number;
  ritmo: number;
}

interface Neblina {
  sprite: THREE.Sprite;
  /** posición actual y punto de origen al que vuelve a nacer cuando se va muy lejos */
  x: number; y: number; z: number;
  x0: number; z0: number;
  /** altura sobre el suelo */
  dy: number;
  ancho: number;
  fase: number;
}

interface Nube {
  x: number; y: number; z: number;
  radio: number;
  /** 0 = recogida, 1 = deshecha por el viento (cambia suavemente) */
  dispersion: number;
  /** nivel de viento propio de este cúmulo (0–1) */
  nivel: number;
  bocanadas: Bocanada[];
}

function mulberry32(semilla: number): () => number {
  let a = semilla;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pieza {
  zona: Zona;
  geometria: Geometria;
  /** color de relleno (hex) */
  color: string;
  /** posición del rótulo (lon/lat) */
  rotulo: HTMLElement | null;
}

const TIPOS_ZONA: Record<string, string> = {
  VE: 'Vereda', CM: 'Cabecera municipal', CO: 'Centro poblado', CA: 'Caserío', IN: 'Inspección',
};

@Component({
  selector: 'app-mapa3d',
  standalone: true,
  // en móvil los controles y modos arrancan plegados; al conducir o elegir salida siempre se ven (hay que poder salir)
  host: { '[class.ctl-plegado]': '!controlesAbiertos() && !conduciendo() && !eligiendoSalida()' },
  imports: [DecimalPipe, RouterLink, CargadorComponent],
  template: `
    <div #lienzo class="lienzo" [class.eligiendo]="eligiendoSalida()"
         (mousedown)="alRatonAbajo($event)" (pointerdown)="capaInfo.set(null); alPulsar($event)" (pointerup)="alSoltar($event)"
         (pointerleave)="alSalir()" (contextmenu)="conduciendo() && $event.preventDefault()"></div>
    <div #tilt class="tilt" aria-hidden="true"></div>
    <div class="vineta" aria-hidden="true"></div>

    @if (cargando()) { <div class="estado"><app-cargador tipo="mapa3d" [progreso]="progreso()" /></div> }
    @if (error()) { <div class="estado error">{{ error() }}</div> }

    <div #rotulos class="rotulos" [hidden]="modoFoto() && !conduciendo()" [class.solo-zonas]="conduciendo()"></div>

    <!-- tooltip de una fuente hídrica: aparece junto al cursor al pasar sobre un río o quebrada -->
    @if (tipRio(); as t) {
      <div class="tip-rio" role="tooltip" [class.izq]="t.izq" [class.arriba]="t.arriba" [style.left.px]="t.x" [style.top.px]="t.y">
        <div class="tip-rio__cab">
          <span class="tip-rio__gota" aria-hidden="true">💧</span>
          <div><span class="tip-rio__tipo">{{ t.tipo }}</span><strong>{{ t.nombre }}</strong></div>
        </div>
        <dl>
          @for (f of t.filas; track f.k) { <div><dt>{{ f.k }}</dt><dd>{{ f.v }}</dd></div> }
        </dl>
        @if (t.nota) { <p>{{ t.nota }}</p> }
      </div>
    }

    <div #barraLey class="barra-ley" role="group" aria-label="Leyenda: tipos de edificio">
      <div class="pista">
        @for (l of leyenda; track l.id) {
          <button type="button" class="ley" [class.activa]="capasActivas().has(l.id)" [attr.aria-pressed]="capasActivas().has(l.id)"
                  [attr.aria-label]="l.nombre" [style.--c]="l.color" (click)="alternarCapa(l.id); mostrarCapa($event, l.id)">
            <span class="medalla-ley" aria-hidden="true">{{ l.glifo }}</span>
            <span class="ley-nombre" aria-hidden="true"><b>{{ l.nombre }}</b><i>{{ capasActivas().has(l.id) ? 'en el mapa · clic para ocultar' : 'oculto · clic para mostrar' }}</i></span>
          </button>
        }
        <button type="button" class="ley" [class.activa]="sistemaHidrico()" [attr.aria-pressed]="sistemaHidrico()" style="--c:#ffb300"
                aria-label="Ríos y quebradas" (click)="alternarSistemaHidrico(); mostrarCapa($event, 'rios')">
          <span class="medalla-ley" aria-hidden="true">≈</span>
          <span class="ley-nombre" aria-hidden="true"><b>Ríos y quebradas</b><i>ríos, quebradas, lagos y embalses</i></span>
        </button>
        <button type="button" class="ley" [class.activa]="nombresRios()" [attr.aria-pressed]="nombresRios()" style="--c:#2c88c8"
                aria-label="Nombres de ríos" (click)="alternarNombresRios(); mostrarCapa($event, 'nombres-rios')">
          <span class="medalla-ley" aria-hidden="true">🏷️</span>
          <span class="ley-nombre" aria-hidden="true"><b>Nombres de ríos</b><i>{{ nombresRios() ? 'en el mapa · clic para ocultar' : 'oculto · clic para mostrar' }}</i></span>
        </button>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" class="ley" [class.activa]="serviciosActivos() === subtiposServicios.length" [attr.aria-pressed]="serviciosActivos() === subtiposServicios.length"
                [attr.aria-label]="grupoServicios.nombre" [style.--c]="grupoServicios.color" (click)="alternarServicios(); mostrarCapa($event, 'servicios')">
          <span class="medalla-ley" aria-hidden="true">{{ grupoServicios.glifo }}</span>
          <span class="cuenta" aria-hidden="true">{{ serviciosActivos() }}</span>
          <span class="ley-nombre" aria-hidden="true"><b>{{ grupoServicios.nombre }}</b><i>{{ serviciosActivos() }} de {{ subtiposServicios.length }} tipos en el mapa</i></span>
        </button>
        <span class="ley-hijos" role="group" aria-label="Tipos de servicios públicos">
          @for (l of subtiposServicios; track l.id) {
            <button type="button" class="ley hijo" [class.activa]="capasActivas().has(l.id)" [attr.aria-pressed]="capasActivas().has(l.id)"
                    [attr.aria-label]="l.nombre" [style.--c]="l.color" (click)="alternarCapa(l.id); mostrarCapa($event, l.id)">
              <span class="medalla-ley" aria-hidden="true">{{ l.glifo }}</span>
              <span class="ley-nombre" aria-hidden="true"><b>{{ l.nombre }}</b><i>servicios públicos</i></span>
            </button>
          }
        </span>
        <span class="sep" aria-hidden="true"></span>
        <!-- capas de contexto: vista subterránea, barrios del casco urbano y redes de servicios -->
        <button type="button" class="ley" [class.activa]="subterraneo()" [class.cargando]="cargandoRedesAgua()" [attr.aria-pressed]="subterraneo()"
                [disabled]="cargandoRedesAgua()" aria-label="Subterráneo" style="--c:#a1887f" (click)="alternarSubterraneo(); mostrarCapa($event, 'sub')">
          <span class="medalla-ley" aria-hidden="true">🕳️</span>
          <span class="ley-nombre" aria-hidden="true"><b>Subterráneo</b><i>{{ cargandoRedesAgua() ? 'cargando las redes…' : 'redes de EPM bajo el terreno' }}</i></span>
        </button>
        <button type="button" class="ley" [class.activa]="barriosVisibles()" [class.cargando]="cargandoBarrios()" [attr.aria-pressed]="barriosVisibles()"
                [disabled]="cargandoBarrios()" aria-label="Barrios" style="--c:#ce93d8" (click)="alternarBarrios(); mostrarCapa($event, 'barrios')">
          <span class="medalla-ley" aria-hidden="true">🏘️</span>
          <span class="ley-nombre" aria-hidden="true"><b>Barrios</b><i>{{ cargandoBarrios() ? 'cargando los límites…' : 'límites del casco urbano' }}</i></span>
        </button>
        <button type="button" class="ley" [class.activa]="flujoVisible()" [class.cargando]="cargandoFlujo()" [attr.aria-pressed]="flujoVisible()"
                [disabled]="cargandoFlujo()" aria-label="Tráfico estimado" style="--c:#ef6c00" (click)="alternarFlujo(); mostrarCapa($event, 'trafico')">
          <span class="medalla-ley" aria-hidden="true">🚗</span>
          <span class="ley-nombre" aria-hidden="true"><b>Tráfico estimado</b><i>{{ cargandoFlujo() ? 'calculando la red…' : 'vehículos por día en cada vía' }}</i></span>
        </button>
        @if (hayRedes) {
          <button type="button" class="ley" [class.activa]="redesVisibles()" [attr.aria-pressed]="redesVisibles()"
                  aria-label="Redes" style="--c:#4db6ac" (click)="alternarRedes(); mostrarCapa($event, 'redes')">
            <span class="medalla-ley" aria-hidden="true">🔌</span>
            <span class="ley-nombre" aria-hidden="true"><b>Redes</b><i>redes y servicios en superficie</i></span>
          </button>
        }
      </div>
    </div>
    <!-- tarjeta de la capa tocada: qué contiene, cuántos hay, de qué tipos y de dónde salen los datos -->
    @if (capaInfo(); as ci) {
      @let rc = resumenCapa(ci.id);
      <div class="capa-info" [style.--x.px]="ci.x" [style.--c]="rc.color" role="status">
        <button type="button" class="capa-info__x" (click)="capaInfo.set(null)" aria-label="Cerrar">×</button>
        <div class="capa-info__cab">
          <span class="capa-info__glifo" aria-hidden="true">{{ rc.glifo }}</span>
          <div>
            <strong>{{ rc.nombre }}</strong>
            <span class="capa-info__estado" [class.on]="rc.activa">{{ rc.activa ? 'Encendida en el mapa' : 'Apagada' }}</span>
          </div>
          @if (rc.total !== null) { <b class="capa-info__total">{{ rc.total | number:'1.0-0' }}<small>{{ rc.unidad }}</small></b> }
        </div>
        <p class="capa-info__txt">{{ rc.texto }}</p>
        @if (rc.tipos.length) {
          <ul class="capa-info__tipos">
            @for (t of rc.tipos; track t.t) { <li><span>{{ t.t }}</span><b>{{ t.n }}</b></li> }
          </ul>
        }
        <p class="capa-info__fuente"><b>Fuente:</b> {{ rc.fuentes.join(' · ') }}</p>
      </div>
    }

    <!-- Ayuda: un solo ícono abre el tutorial del mapa (antes era un panel fijo con el texto de ayuda) -->
    <button type="button" class="ayuda-btn" [class.nueva]="!tutorialVisto()" (click)="abrirTutorial()"
            aria-label="Cómo se usa el mapa" title="Cómo se usa el mapa">
      <span aria-hidden="true">?</span>
    </button>

    <!-- Leyendas de las capas de redes: flotan bajo el ícono de ayuda mientras la capa está encendida -->
    @if (hayRedes && redesVisibles() && !subterraneo()) {
      <div class="ley-flot" role="group" aria-label="Redes y servicios">
        <span class="ley-flot__t">🔌 Redes y servicios</span>
        @for (l of leyendaRedes; track l.nombre) {
          <span class="ley-flot__i"><i [style.background]="l.color"></i>{{ l.nombre }}<small>{{ l.nota }}</small></span>
        }
      </div>
    }
    @if (flujoVisible() && !subterraneo() && !(hayRedes && redesVisibles())) {
      <div class="ley-flot" role="group" aria-label="Tráfico estimado">
        <span class="ley-flot__t">🚗 Vehículos por día</span>
        @for (l of leyendaFlujo; track l.nombre) {
          <span class="ley-flot__i"><i [style.background]="l.color"></i>{{ l.nombre }}<small>{{ l.nota }}</small></span>
        }
        <span class="ley-flot__nota">Estimación de modelo calibrada con el peaje El Trapiche ({{ flujoPeaje() | number:'1.0-0' }} veh/día). Sin motos. Toca una vía para ver su rango.</span>
      </div>
    }
    @if (subterraneo()) {
      <div class="ley-flot" role="group" aria-label="Redes subterráneas">
        <span class="ley-flot__t">🕳️ Redes de EPM</span>
        @for (l of leyendaSub; track l.nombre) {
          <span class="ley-flot__i"><i [style.background]="l.color"></i>{{ l.nombre }}</span>
        }
      </div>
    }

    <!-- Fichas de lo seleccionado que no es una vereda con proyección: industria, red, río o zona sin datos -->
    @if (fabricaSeleccion(); as f) {
      <aside class="pin-panel fab-panel" style="--c:#6b7280" aria-label="Detalle de la industria">
        <button type="button" class="cerrar" (click)="cerrarSeleccion()" aria-label="Cerrar detalle">×</button>
        <section class="col col-cab">
          <div class="pin-cab">
            <span class="pin-glifo">🏭</span>
            <div><span class="tipo">Industria · {{ f.sector }}</span><strong>{{ f.nombre }}</strong></div>
          </div>
          @if (f.direccion) { <p class="fab-dato">{{ f.direccion }}</p> }
          <p class="fab-dato">{{ f.resumen }}</p>
          <p class="pin-fuente">Inventario de emisiones atmosféricas · Corantioquia 2021</p>
        </section>
        <section class="col">
          <dl>
            <div><dt>Combustibles</dt><dd>{{ f.combustibles }}</dd></div>
            <div><dt>Control de emisiones</dt><dd>{{ f.control }}</dd></div>
            @if (f.flujos) { <div><dt>Medido en chimenea</dt><dd>{{ f.flujos }}</dd></div> }
          </dl>
        </section>
        <section class="col">
          <h3>Emisiones estimadas</h3>
          @if (f.emisiones.length) {
            <div class="fab-emis">
              @for (e of f.emisiones; track e.k) { <div><span>{{ e.k }}</span><b>{{ e.v }}</b></div> }
            </div>
          } @else {
            <p class="vacio">Sin emisiones estimadas en el inventario.</p>
          }
        </section>
      </aside>
    } @else if (redSeleccion() || rioSeleccion() || (seleccion() && !proyeccion(seleccion()!) && !pinFicha())) {
      <aside class="sel-chip" aria-live="polite">
        @let rd = redSeleccion();
        @let rio = rioSeleccion();
        @let z = seleccion();
        @if (rd) {
          <span class="tipo">{{ rd.detalle }}</span><strong>{{ rd.nombre }}</strong>
        } @else if (rio) {
          <span class="tipo">{{ rio.detalle }}</span><strong>{{ rio.nombre }}</strong>
        } @else if (z) {
          <span class="tipo">{{ tipoDe(z) }}</span><strong>{{ z.n }}</strong>
          @if (datosDe(z); as d) { <span class="dato">{{ d.pob | number:'1.0-0' }} personas · {{ d.viv | number:'1.0-0' }} viviendas ({{ anio() }})</span> }
        }
        <button type="button" class="cerrar" (click)="redSeleccion() || rioSeleccion() ? cerrarSeleccion() : cerrarZona()" aria-label="Cerrar">×</button>
      </aside>
    }

    <!-- Tutorial al estilo de un juego: niveles, barra de progreso y controles dibujados -->
    @if (tutorialAbierto()) {
      @let paso = pasosTutorial[pasoTutorial()];
      <div class="tuto" role="dialog" aria-modal="true" aria-labelledby="tuto-t" (keydown)="teclaTutorial($event)" (click)="cerrarTutorial()">
        <div class="tuto__carta" [style.--c]="paso.color" (click)="$event.stopPropagation()" tabindex="-1" #cartaTuto>
          <div class="tuto__barra" aria-hidden="true"><i [style.width.%]="(pasoTutorial() + 1) / pasosTutorial.length * 100"></i></div>
          <div class="tuto__cab">
            <span class="tuto__nivel">Nivel {{ pasoTutorial() + 1 }} de {{ pasosTutorial.length }}</span>
            <span class="tuto__xp">+{{ (pasoTutorial() + 1) * 50 }} XP</span>
            <button type="button" class="tuto__saltar" (click)="cerrarTutorial()">Saltar ✕</button>
          </div>
          @for (p of [paso]; track pasoTutorial()) {
            <div class="tuto__cuerpo">
              <span class="tuto__emblema" aria-hidden="true">{{ p.emblema }}</span>
              <h2 id="tuto-t">{{ p.titulo }}</h2>
              <p>{{ p.texto }}</p>
              <ul class="tuto__controles">
                @for (c of p.controles; track c.accion) {
                  <li>
                    <span class="tuto__teclas">@for (k of c.teclas; track $index) { <kbd>{{ k }}</kbd> }</span>
                    <span>{{ c.accion }}</span>
                  </li>
                }
              </ul>
            </div>
          }
          <div class="tuto__pie">
            <div class="tuto__puntos" aria-hidden="true">
              @for (p of pasosTutorial; track $index; let i = $index) { <i [class.on]="i <= pasoTutorial()"></i> }
            </div>
            @if (pasoTutorial() > 0) { <button type="button" class="tuto__atras" (click)="moverTutorial(-1)">◀ Atrás</button> }
            @if (pasoTutorial() < pasosTutorial.length - 1) {
              <button type="button" class="tuto__sig" (click)="moverTutorial(1)">Siguiente ▶</button>
            } @else {
              <button type="button" class="tuto__sig tuto__sig--fin" (click)="cerrarTutorial()">¡A explorar! 🚀</button>
            }
          </div>
        </div>
      </div>
    }

    @if (!pinFicha() && !fabricaSeleccion() && seleccion(); as z) {
      @if (proyeccion(z); as pr) {
        <aside class="pin-panel zona-panel" aria-label="Proyección de población de la vereda">
          <button type="button" class="cerrar" (click)="cerrarZona()" aria-label="Cerrar detalle">×</button>
          <header class="zona-tit">
            <strong>{{ pr.nombre }}</strong><span class="tipo">{{ pr.tipo }} · proyección de población</span>
          </header>
          <!-- Acordeón horizontal: la categoría elegida se despliega a lo ancho; las demás quedan como pestañas -->
          <div class="acc-fila">
          @let ps = proyectosDe(z);
          @for (s of seccionesDet; track s.id; let i = $index) {
            <section class="acc" [class.abierta]="seccionDet() === i">
              <button type="button" class="acc-tab" [attr.aria-expanded]="seccionDet() === i" [attr.aria-controls]="'acc-' + s.id"
                      (click)="seccionDet.set(i)" [title]="s.nombre">
                <span class="acc-ico" aria-hidden="true">{{ s.glifo }}</span>
                <b class="acc-num">{{ i === 0 ? cifra(poblacionActual(pr.anios)) : i === 1 ? pr.infra.total : ps.length }}</b>
                <span class="acc-t">{{ s.nombre }}</span>
              </button>
              @if (seccionDet() === i) {
                <div class="acc-cuerpo" [id]="'acc-' + s.id">
                  @switch (s.id) {
                    @case ('pob') {
          <div class="acc-dos" [class.con-piramide]="pr.piramide">
          <div>
          @if (pr.rango; as r) {
            <label class="anio-desliza">
              <span>Año <b>{{ anioVista() ?? anio() }}</b>@if ((anioVista() ?? anio()) > r.oficial) { <em class="extrap">extrapolación</em> }</span>
              <input type="range" [min]="r.desde" [max]="r.hasta" step="1" [value]="anio()"
                     [style.--oficial]="(r.oficial - r.desde) / (r.hasta - r.desde) * 100 + '%'"
                     (input)="verAnio($any($event.target).value, false)" (change)="verAnio($any($event.target).value, true)"
                     aria-label="Año de la proyección de población">
              <span class="escala"><span>{{ r.desde }}</span><span>oficial hasta {{ r.oficial }}</span><span>{{ r.hasta }}</span></span>
            </label>
            <div class="anios-clave" role="group" aria-label="Ir a un año">
              @for (a of aniosPoblacion; track a) {
                <button type="button" class="anio-btn" [attr.aria-pressed]="a === (anioVista() ?? anio())" (click)="cambiarAnio(a)">{{ a }}{{ a > r.oficial ? '*' : '' }}</button>
              }
            </div>
          }
          <table>
            <thead><tr><th>Año</th><th>Personas</th>@if (pr.anios[0].viv !== null) { <th>Viviendas</th> }</tr></thead>
            <tbody>
              @for (a of pr.anios; track a.anio) {
                <tr [class.activa]="a.actual" [class.extrap]="a.extrapolado"><td>@if (pr.rango) { {{ a.anio }}{{ a.extrapolado ? '*' : '' }} } @else { <button type="button" class="anio-btn" [attr.aria-pressed]="a.actual" (click)="cambiarAnio(a.anio)" [title]="'Ver la población de ' + a.anio + ' en el mapa'">{{ a.anio }}</button> }</td><td>{{ cifra(a.pob) }}</td>@if (a.viv !== null) { <td>{{ cifra(a.viv) }}</td> }</tr>
              }
            </tbody>
          </table>
          @if (pr.rango) { <p class="variacion">{{ pr.variacion }}</p> }
          </div>
          @if (pr.piramide; as py) {
            <section class="edades" [attr.aria-label]="'Población por grupo de edad en ' + py.anio">
              <h4>Por grupo de edad · {{ py.anio }}{{ py.extrapolado ? '*' : '' }}</h4>
              <p class="edades-sexo"><span class="h">■ Hombres {{ cifra(py.hombres) }}</span> <span class="m">■ Mujeres {{ cifra(py.mujeres) }}</span></p>
              <ul>
                @for (g of py.grupos; track g.nombre) {
                  <li [title]="cifra(g.hombres) + ' hombres y ' + cifra(g.mujeres) + ' mujeres'">
                    <b class="ge-nom">{{ g.nombre }}</b>
                    <span class="ge-rango">{{ g.rango }}</span>
                    <span class="ge-num"><b>{{ cifra(g.total) }}</b> · {{ cifra(g.peso) }} %</span>
                    <span class="ge-barra"><i class="h" [style.width.%]="g.ah"></i><i class="m" [style.width.%]="g.am"></i><i class="b" [style.left.%]="g.base" [title]="'En ' + py.base"></i></span>
                    @if (g.cambio !== null && py.anio !== py.base) {
                      <span class="ge-cambio" [class.sube]="g.cambio >= 0">{{ g.cambio >= 0 ? '+' : '−' }}{{ cifra(g.cambio < 0 ? -g.cambio : g.cambio) }} % desde {{ py.base }}</span>
                    }
                  </li>
                }
              </ul>
            </section>
          }
          <div>
          @if (pr.piramide; as py) {
            <dl class="indic">
              <div><dt>Edad mediana</dt><dd>{{ cifra(py.indicadores.edad_mediana) }} años<small>la mitad es menor de esa edad</small></dd></div>
              <div><dt>Mayores de 65 por cada 100 niños</dt><dd>{{ cifra(py.indicadores.envejecimiento) }}<small>{{ py.indicadores.envejecimiento >= 100 ? 'ya hay más mayores que niños' : 'aún hay más niños que mayores' }}</small></dd></div>
              <div><dt>Dependientes por cada 100 de 15 a 64</dt><dd>{{ cifra(py.indicadores.dependencia) }}<small>niños y mayores de 65</small></dd></div>
            </dl>
          }
          @if (!pr.rango) { <p class="variacion">{{ pr.variacion }}</p> }
          @if (!pr.piramide) { <p class="pin-fuente">Estimación: {{ pr.fuente }}</p> }
          </div>
          @if (pr.piramide; as py) {
            <p class="pin-fuente pob-fuente">Estimación: {{ pr.fuente }} * extrapolación, no dato oficial. En las barras, la raya vertical marca el grupo en {{ py.base }}.</p>
          }
          </div>
                    }
                    @case ('infra') {
          @if (pr.infra.grupos.length) {
            <div class="acc-grupos">
            @for (g of pr.infra.grupos; track g.id; let primero = $first) {
              <details class="infra" [open]="primero">
                <summary><span class="medalla" [style.background]="g.color">{{ g.glifo }}</span>{{ g.nombre }}<b>{{ g.items.length }}</b></summary>
                <ul>
                  @for (it of g.items; track it.ref.tipo + it.ref.i) {
                    <li><button type="button" (click)="irAPin(it.ref)" title="Ir a este lugar en el mapa">{{ it.n }} <span aria-hidden="true">→</span></button></li>
                  }
                </ul>
              </details>
            }
            </div>
          } @else {
            <p class="vacio">No hay infraestructura registrada en esta zona.</p>
          }
                    }
                    @case ('proy') {
          @if (ps.length) {
            <ul class="proyectos">
              @for (p of ps; track p.ip) {
                <li>
                  <details>
                    <summary>
                      <span class="proyectos__ind">{{ p.indicador }}</span>
                      @if (p.pct !== null) { <b class="proyectos__pct" [class.bajo]="p.pct < 50" [class.alto]="p.pct >= 100" [title]="'Avance ' + p.anio_pct + ' según el informe'">{{ p.pct | number:'1.0-0' }} %</b> }
                    </summary>
                    @if (p.dep) { <p class="proyectos__resp">Responsable: <a [routerLink]="['/responsables', p.dep]">{{ p.dep_nombre }}</a></p> }
                    @for (m of p.menciones; track m.anio) { <p class="proyectos__cita"><b>{{ m.anio }}</b> «…{{ m.texto }}…»</p> }
                  </details>
                </li>
              }
            </ul>
            <p class="pin-fuente">Indicadores del plan cuyo informe de seguimiento nombra esta vereda. Es una mención en el texto, no la ubicación exacta de la obra.</p>
          } @else {
            <p class="vacio">Ningún informe de seguimiento nombra esta zona.</p>
          }
                    }
                  }
                </div>
              }
            </section>
          }
          </div>
        </aside>
      }
    }

    @if (pinFicha(); as p) {
      <aside class="pin-panel lugar-panel" [style.--c]="p.color" aria-label="Detalle del lugar">
        <button type="button" class="cerrar" (click)="cerrarPin()" aria-label="Cerrar detalle">×</button>
        <section class="col col-cab">
          @if (seleccion(); as z) {
            <button type="button" class="volver-zona" (click)="cerrarPin()">← Volver a {{ z.n }}</button>
          }
          <div class="pin-cab">
            <span class="pin-glifo">{{ p.glifo }}</span>
            <div><span class="tipo">{{ p.categoria }}</span><strong>{{ p.titulo }}</strong></div>
          </div>
          @if (p.mapa2d; as q) {
            <a class="pin-mapa" routerLink="/mapa" [queryParams]="q">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.500a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>
              Ver en el mapa 2D
            </a>
          }
          @if (p.aproximada) { <p class="pin-fuente">La ubicación de este punto es aproximada.</p> }
          <p class="pin-fuente">{{ p.fuente }}</p>
        </section>
        <section class="col col-datos">
          <dl>
            @for (f of p.filas; track f.k) { <div><dt>{{ f.k }}</dt><dd>{{ f.v }}</dd></div> }
          </dl>
        </section>
      </aside>
    }

    <p class="creditos">Datos: © colaboradores de OpenStreetMap · Overture Maps · IGAC (drenajes 1:100.000) · Catastro © Alcaldía de Girardota · Sentinel-2 © EOX</p>

    <button type="button" class="foto" [class.activa]="modoFoto()" (click)="alternarFoto()"
            [attr.aria-pressed]="modoFoto()" [attr.title]="modoFoto() ? 'Mostrar marcaciones e íconos' : 'Modo fotografía: ocultar marcaciones e íconos'"
            [attr.aria-label]="modoFoto() ? 'Salir del modo fotografía' : 'Modo fotografía'">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M9 4l-1.5 2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2.500L15 4H9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <circle cx="12" cy="13" r="3.600" fill="none" stroke="currentColor" stroke-width="1.8"/>
      </svg>
    </button>

    <button type="button" class="conducir volar" [class.activa]="(conduciendo() || eligiendoSalida()) && vehiculo() === 'avion'" (click)="alternarConduccion('avion')"
            [attr.aria-pressed]="(conduciendo() || eligiendoSalida()) && vehiculo() === 'avion'"
            [attr.title]="conduciendo() && vehiculo() === 'avion' ? 'Salir del vuelo (Esc)' : eligiendoSalida() && vehiculo() === 'avion' ? 'Cancelar (Esc)' : 'Volar: elige en el mapa dónde empezar'"
            [attr.aria-label]="conduciendo() && vehiculo() === 'avion' ? 'Salir del vuelo' : 'Volar en avioneta'">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M21 15.500v-1.500l-8-5V4.500a1.500 1.500 0 0 0-3 0V9l-8 5v1.500l8-2.200V18l-2 1.500V21l3.500-1 3.500 1v-1.500L13 18v-4.700z" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linejoin="round"/>
      </svg>
    </button>

    <button type="button" class="conducir" [class.activa]="(conduciendo() || eligiendoSalida()) && vehiculo() === 'carro'" (click)="alternarConduccion('carro')"
            [attr.aria-pressed]="(conduciendo() || eligiendoSalida()) && vehiculo() === 'carro'"
            [attr.title]="conduciendo() && vehiculo() === 'carro' ? 'Salir de la conducción (Esc)' : eligiendoSalida() && vehiculo() === 'carro' ? 'Cancelar (Esc)' : 'Conducir: elige en el mapa dónde empezar'"
            [attr.aria-label]="conduciendo() && vehiculo() === 'carro' ? 'Salir de la conducción' : eligiendoSalida() && vehiculo() === 'carro' ? 'Cancelar la conducción' : 'Conducir'">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M3 15.500v-3a1.600 1.600 0 0 1 1.200-1.500L7 10.200l1.900-3a1.600 1.600 0 0 1 1.400-.8h3.600a1.600 1.600 0 0 1 1.300.7l2.200 3.100 2.100.6a1.600 1.600 0 0 1 1.100 1.500v2.700h-2M5 15.500H3M16 15.500H9M7 10.200h10.500M12.200 6.200v4" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="7" cy="16.500" r="2" fill="none" stroke="currentColor" stroke-width="1.700"/>
        <circle cx="18" cy="16.500" r="2" fill="none" stroke="currentColor" stroke-width="1.700"/>
      </svg>
    </button>

    @if (eligiendoSalida()) {
      <div class="aviso-salida" role="status">
        <b>{{ vehiculo() === 'avion' ? '¿Dónde quieres volar?' : '¿Dónde quieres empezar a conducir?' }}</b>
        <span>Haz clic en el mapa; {{ vehiculo() === 'avion' ? 'la avioneta aparece' : 'el carro aparece' }} en la vía más cercana. Puedes mover el mapa para buscar el sitio.</span>
        <span class="aviso-salida__acciones">
          <button type="button" (click)="cancelarSalida(); empezarEnCentro()">Empezar en el centro <kbd>Enter</kbd></button>
          <button type="button" (click)="cancelarSalida()">Cancelar <kbd>Esc</kbd></button>
        </span>
      </div>
    }

    @if (conduciendo()) {
      <div class="hud-conduccion">
        <div class="velocimetro"><b #hudVelocidad>0</b> km/h@if (vehiculo() === 'avion') { · <b #hudAltura>0</b> m de altura}</div>
        <div class="zona-hud" #hudZona></div>
        @if (vehiculo() === 'avion') {
          <p>W/S empuje · ↑/↓ morro abajo/arriba · A/D o ←/→ inclinar y virar · Shift turbo · Espacio freno · Arrastrar mirar · C o 5 recentrar · R reaparecer · Esc salir</p>
        } @else {
          <p>W A S D o flechas · Shift turbo · Espacio freno · Arrastrar mirar · Rueda distancia · C o 5 recentrar · R reaparecer · Esc salir</p>
        }
      </div>
      @if (cayo()) {
        <div class="caida"><strong>{{ vehiculo() === 'avion' ? 'Te estrellaste' : 'Caíste al vacío' }}</strong><button type="button" (click)="reaparecerCarro()">Reaparecer</button></div>
      }
      <div class="mando" aria-hidden="true">
        <div class="giro">
          <button type="button" (pointerdown)="pulsarTecla('KeyA', true)" (pointerup)="pulsarTecla('KeyA', false)" (pointerleave)="pulsarTecla('KeyA', false)">◀</button>
          <button type="button" (pointerdown)="pulsarTecla('KeyD', true)" (pointerup)="pulsarTecla('KeyD', false)" (pointerleave)="pulsarTecla('KeyD', false)">▶</button>
        </div>
        <div class="pedales">
          <button type="button" (pointerdown)="pulsarTecla('KeyW', true)" (pointerup)="pulsarTecla('KeyW', false)" (pointerleave)="pulsarTecla('KeyW', false)">▲</button>
          <button type="button" (pointerdown)="pulsarTecla('KeyS', true)" (pointerup)="pulsarTecla('KeyS', false)" (pointerleave)="pulsarTecla('KeyS', false)">▼</button>
        </div>
      </div>
    }

    <div class="zoom">
      <button type="button" class="zoom__casa" (click)="vistaGeneral()" aria-label="Vista general" title="Vista general: ver todo el municipio">
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button type="button" (click)="acercar(0.75)" aria-label="Acercar">+</button>
      <button type="button" (click)="acercar(1.33)" aria-label="Alejar">−</button>
    </div>

    <!-- solo en móvil: pliega o despliega la columna de controles y modos -->
    <button type="button" class="ctl-toggle" [class.abierto]="controlesAbiertos()" (click)="controlesAbiertos.set(!controlesAbiertos())"
            [attr.aria-expanded]="controlesAbiertos()" [attr.aria-label]="controlesAbiertos() ? 'Ocultar controles del mapa' : 'Mostrar controles del mapa'"
            [attr.title]="controlesAbiertos() ? 'Ocultar controles' : 'Controles y modos del mapa'">
      @if (controlesAbiertos()) {
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
      } @else {
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>
      }
    </button>
  `,
  styles: [`
    :host { position: relative; display: block; height: calc(100dvh - var(--alto-barra)); min-height: 520px;
      background: linear-gradient(#8ec8f2, #e4f2fb 70%); overflow: hidden; }
    .lienzo { position: absolute; inset: 0; }
    /* eligiendo dónde conducir: mira en vez de mano (el código escribe el cursor en línea, por eso el !important) */
    .lienzo.eligiendo { cursor: crosshair !important; }
    .aviso-salida { position: absolute; left: 50%; bottom: 36px; transform: translateX(-50%); z-index: 6; display: grid; gap: 6px;
      max-width: min(460px, calc(100% - 32px)); padding: 12px 16px; border-radius: 14px; text-align: center;
      background: rgba(255,255,255,.92); backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgba(30,60,90,.22);
      font: .82rem/1.35 system-ui; color: #26425a; animation: aviso-entra .18s ease-out; }
    .aviso-salida b { font-size: .95rem; }
    .aviso-salida__acciones { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
    .aviso-salida button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 0; border-radius: 999px;
      background: #e8f0f6; color: #26425a; font: 600 .78rem system-ui; cursor: pointer; }
    .aviso-salida button:first-child { background: #2C88C8; color: #fff; }
    .aviso-salida button:hover { filter: brightness(1.06); }
    .aviso-salida kbd { padding: 0 5px; border-radius: 4px; background: rgba(0,0,0,.12); font: 600 .68rem ui-monospace, monospace; }
    @keyframes aviso-entra { from { opacity: 0; transform: translate(-50%, 6px); } }
    /* tilt-shift: desenfoca arriba y abajo y deja nítida la franja del centro, como una foto de maqueta. Lo hace el
       compositor del navegador sobre el lienzo ya dibujado (no es una pasada de three.js); los rótulos van encima y
       no se desenfocan. Sin desenfoque queda oculto para no costar nada. */
    .tilt { position: absolute; inset: 0; pointer-events: none; display: none;
      backdrop-filter: blur(var(--tilt, 0px)); -webkit-backdrop-filter: blur(var(--tilt, 0px));
      -webkit-mask-image: linear-gradient(to bottom, #000 0%, transparent 36%, transparent 62%, #000 100%);
      mask-image: linear-gradient(to bottom, #000 0%, transparent 36%, transparent 62%, #000 100%); }
    /* viñeta: oscurece apenas los bordes para llevar la mirada al centro; es CSS sobre el lienzo, no una pasada
       de render, así que no le cuesta nada a la GPU de la escena */
    .vineta { position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse 78% 72% at 50% 46%, transparent 46%, rgba(14, 30, 46, .12) 72%, rgba(14, 30, 46, .38) 100%); }
    .estado { position: absolute; inset: 0; display: grid; place-items: center; font: 600 1.1rem system-ui;
      color: #36556b; pointer-events: none; }
    .estado.error { color: #b91c1c; }
    .tip-rio { position: absolute; z-index: 9; pointer-events: none; width: 250px; padding: 10px 12px 9px; border-radius: 14px;
      background: rgba(255,255,255,.96); color: #243746; border: 1px solid #bfe0f4; box-shadow: 0 8px 24px rgba(15,35,55,.28);
      transform: translate(14px, 14px); font: 600 12px/1.35 'Nunito', system-ui, sans-serif; }
    .tip-rio.izq { transform: translate(calc(-100% - 14px), 14px); }
    .tip-rio.arriba { transform: translate(14px, calc(-100% - 14px)); }
    .tip-rio.izq.arriba { transform: translate(calc(-100% - 14px), calc(-100% - 14px)); }
    .tip-rio__cab { display: flex; align-items: center; gap: 9px; margin-bottom: 6px; }
    .tip-rio__gota { flex: none; width: 32px; height: 32px; display: grid; place-items: center; font-size: 16px; border-radius: 4px 50% 50% 50%;
      background: linear-gradient(140deg, #8fd0f2, #2c88c8); }
    .tip-rio__tipo { display: block; font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #2c88c8; }
    .tip-rio strong { display: block; font-size: 14px; line-height: 1.15; }
    .tip-rio dl { margin: 0; display: grid; gap: 2px; }
    .tip-rio dl div { display: flex; justify-content: space-between; gap: 10px; }
    .tip-rio dt { color: #5b7284; font-weight: 600; white-space: nowrap; }
    .tip-rio dd { margin: 0; font-weight: 800; text-align: right; }
    .tip-rio p { margin: 6px 0 0; padding-top: 6px; border-top: 1px dashed #bfe0f4; color: #5b7284; font-size: 11px; font-weight: 600; }
    :host-context(body.tema-oscuro) .tip-rio { background: rgba(22,34,28,.96); color: #eaf3e4; border-color: #2c5a78; }
    :host-context(body.tema-oscuro) .tip-rio dt, :host-context(body.tema-oscuro) .tip-rio p { color: #a9c3d4; }
    .rotulos { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
    .rotulos ::ng-deep .rot { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 4px;
      padding: 2px 8px 2px 5px; border-radius: 999px; white-space: nowrap; will-change: transform;
      transform-origin: 50% 100%;
      background: #ffffff; color: #243746; box-shadow: 0 2px 8px rgba(15,35,55,.35); z-index: 3;
      font: 800 10px/1.1 'Nunito', ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; letter-spacing: .01em; }
    .rotulos ::ng-deep .rot i { flex: none; width: 7px; height: 7px; border-radius: 50%;
      border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(36,55,70,.35); }
    .rotulos ::ng-deep .rot::after { content: ''; position: absolute; left: 50%; bottom: -3px; width: 6px; height: 6px;
      margin-left: -3px; background: inherit; transform: rotate(45deg); border-radius: 0 0 2px 0; }
    .rotulos ::ng-deep .rot.cabecera { font-size: 11.5px; padding: 3px 9px 3px 6px; }
    .rotulos ::ng-deep .rot.activo { font-size: 12.5px; padding: 4px 11px 4px 7px; background: #fff7e0;
      box-shadow: 0 0 0 2.5px #ffb81f, 0 6px 16px rgba(15,35,55,.4); z-index: 5; }
    .rotulos ::ng-deep .rot.activo i { width: 9px; height: 9px; }
    /* los nombres de ríos van debajo de los de veredas, y todos son sólidos: si se cruzan, queda encima la vereda */
    .rotulos ::ng-deep .rot.agua { background: #def2fd; color: #0b4f7a; font-style: italic; z-index: 1; }
    .rotulos ::ng-deep .rot.agua.activo { z-index: 1; }
    .rotulos ::ng-deep .rot.agua i { background: #2c88c8; }
    .rotulos ::ng-deep .rot.fabrica { background: #fff7e0; z-index: 4; }
    /* al conducir (modo foto) solo quedan los nombres de las zonas; el código escribe display en línea, de ahí el !important */
    .rotulos.solo-zonas ::ng-deep .rot.agua, .rotulos.solo-zonas ::ng-deep .rot.fabrica { display: none !important; }
    .rotulos ::ng-deep .rot.fabrica i { background: #6b7280; }
    .creditos { position: absolute; left: 16px; bottom: 8px; margin: 0; max-width: calc(100% - 90px); pointer-events: none;
      font: 600 10px/1.3 system-ui; color: rgba(255,255,255,.92); text-shadow: 0 1px 3px rgba(0,0,0,.7); }
    .foto { position: absolute; z-index: 10; right: 148px; bottom: 16px; width: 38px; height: 38px; padding: 0; display: grid; place-items: center;
      border-radius: 12px; background: rgba(255,255,255,.85); color: #26425a; box-shadow: 0 2px 8px rgba(30,60,90,.25); backdrop-filter: blur(6px); }
    .foto:hover { background: #fff; }
    .conducir { position: absolute; z-index: 10; right: 60px; bottom: 16px; width: 38px; height: 38px; padding: 0; display: grid; place-items: center;
      border-radius: 12px; background: rgba(255,255,255,.85); color: #26425a; box-shadow: 0 2px 8px rgba(30,60,90,.25); backdrop-filter: blur(6px); }
    .conducir.volar { right: 104px; }
    .conducir:hover { background: #fff; }
    .conducir.activa { background: #26425a; color: #fff; }
    .hud-conduccion { position: absolute; z-index: 10; left: 50%; bottom: 20px; transform: translateX(-50%); text-align: center; color: #fff;
      text-shadow: 0 1px 4px rgba(0,0,0,.7); pointer-events: none; font: 600 .8rem system-ui; }
    .hud-conduccion .velocimetro { font-size: 1rem; }
    .hud-conduccion .velocimetro b { font-size: 2rem; }
    .hud-conduccion .zona-hud { margin-top: 2px; font-size: .95rem; letter-spacing: .01em; }
    .hud-conduccion p { margin: 2px 0 0; opacity: .85; }
    .caida { position: absolute; z-index: 11; top: 40%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 16px 26px; border-radius: 16px; background: rgba(20,30,40,.8); color: #fff; font: 1.1rem system-ui; }
    .caida button { padding: 8px 18px; border-radius: 10px; background: #fff; color: #26425a; font-weight: 700; }
    .mando { position: absolute; z-index: 10; left: 16px; right: 16px; bottom: 90px; display: none; justify-content: space-between; pointer-events: none; }
    .mando .giro, .mando .pedales { display: flex; gap: 10px; pointer-events: auto; }
    .mando .pedales { flex-direction: column; }
    .mando button { width: 56px; height: 56px; border-radius: 50%; background: rgba(255,255,255,.7); color: #26425a; font-size: 1.3rem; touch-action: none; }
    @media (pointer: coarse) { .mando { display: flex; } }
    .foto.activa { background: #26425a; color: #fff; }
    .zoom { position: absolute; z-index: 10; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 6px; }
    .zoom button { width: 38px; height: 38px; padding: 0; border-radius: 12px; font: 700 1.3rem/1 system-ui;
      background: rgba(255,255,255,.9); color: #26425a; box-shadow: 0 3px 12px rgba(30,60,90,.25); }
    .zoom button:hover { background: #fff; }
    /* Leyenda horizontal en la parte superior del mapa; los paneles van debajo. */
    :host { --alto-ley: 52px; }
    /* Solo íconos; el nombre brota del ícono al pasar el cursor (o con el foco del teclado), sin mover la fila. */
    .barra-ley { position: absolute; z-index: 11; top: 12px; left: 0; right: 0; margin-inline: auto; width: fit-content; max-width: calc(100% - 156px); box-sizing: border-box;
      border-radius: 999px; background: rgba(255,255,255,.82); backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgba(30,60,90,.2);
      font: .9rem system-ui; color: #26425a; }
    .barra-ley .pista { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px; padding: 5px 8px; }
    .barra-ley .sep { width: 1px; height: 22px; margin: 0 5px; background: rgba(38,66,90,.18); }
    .barra-ley .ley { position: relative; flex: none; width: 36px; height: 36px; padding: 0; display: grid; place-items: center;
      border-radius: 50%; background: transparent; color: #26425a; }
    .barra-ley .ley:hover, .barra-ley .ley:focus-visible { background: transparent; z-index: 2; }
    .barra-ley .medalla-ley { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: .95rem;
      background: #dfe6ec; filter: grayscale(1); opacity: .55; transition: transform .14s ease-out, opacity .1s, filter .1s, box-shadow .1s; }
    /* Subtipos de servicios públicos: en la misma barra, agrupados en una cápsula más clara tras su ícono de grupo. */
    .barra-ley .ley-hijos { display: flex; align-items: center; gap: 0; margin-left: 2px; padding: 0 3px; border-radius: 999px; background: rgba(38,66,90,.07); }
    .barra-ley .ley.hijo { width: 32px; }
    .barra-ley .ley.hijo .medalla-ley { width: 26px; height: 26px; font-size: .82rem; }
    .barra-ley .ley.activa .medalla-ley { background: var(--c); filter: none; opacity: 1; box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px var(--c); }
    .barra-ley .ley:hover .medalla-ley, .barra-ley .ley:focus-visible .medalla-ley { transform: translateY(-3px) scale(1.18) rotate(-8deg); opacity: 1; filter: none; }
    .barra-ley .cuenta { position: absolute; right: 0; bottom: 0; min-width: 16px; height: 16px; padding: 0 3px; box-sizing: border-box; border-radius: 999px;
      background: #26425a; color: #fff; font: 700 .62rem/16px system-ui; text-align: center; pointer-events: none; }
    /* Etiqueta: una cinta del color de la capa que brota del ícono al instante y desliza el nombre. */
    .barra-ley .ley-nombre { position: absolute; top: calc(100% + 8px); left: 50%; display: flex; flex-direction: column; align-items: center; gap: 1px;
      padding: 6px 12px; border-radius: 10px; white-space: nowrap; pointer-events: none;
      background: #26425a; color: #fff; box-shadow: 0 8px 22px rgba(20,40,60,.3); border-bottom: 3px solid var(--c);
      opacity: 0; transform: translate(-50%, -6px) scale(.85); transform-origin: 50% -8px;
      transition: opacity .08s, transform .16s cubic-bezier(.3,1.5,.6,1); }
    .barra-ley .ley-nombre::before { content: ''; position: absolute; top: -5px; left: 50%; width: 10px; height: 10px; background: #26425a;
      transform: translateX(-50%) rotate(45deg); border-radius: 2px; }
    .barra-ley .ley-nombre b { position: relative; font-size: .8rem; font-weight: 700; letter-spacing: .01em;
      clip-path: inset(0 100% 0 0); transition: clip-path .18s ease-out .03s; }
    .barra-ley .ley-nombre i { position: relative; font-style: normal; font-size: .66rem; color: #b9cbd8; opacity: 0;
      transition: opacity .12s .1s; }
    .barra-ley .ley:hover .ley-nombre, .barra-ley .ley:focus-visible .ley-nombre { opacity: 1; transform: translate(-50%, 0) scale(1); }
    .barra-ley .ley:hover .ley-nombre b, .barra-ley .ley:focus-visible .ley-nombre b { clip-path: inset(0 0 0 0); }
    .barra-ley .ley:hover .ley-nombre i, .barra-ley .ley:focus-visible .ley-nombre i { opacity: 1; }
    .barra-ley .pista > .ley:first-child .ley-nombre { left: 0; transform: translate(0, -6px) scale(.85); transform-origin: 20px -8px; }
    .barra-ley .pista > .ley:first-child:hover .ley-nombre, .barra-ley .pista > .ley:first-child:focus-visible .ley-nombre { transform: translate(0, 0) scale(1); }
    .barra-ley .pista > .ley:first-child .ley-nombre::before { left: 20px; }
    @media (prefers-reduced-motion: reduce) {
      .barra-ley .medalla-ley, .barra-ley .ley-nombre, .barra-ley .ley-nombre b, .barra-ley .ley-nombre i { transition: none; }
    }
    /* Tarjeta de la capa tocada: abajo a la izquierda, translúcida y liviana, sin tapar el mapa */
    .capa-info { position: absolute; z-index: 12; left: 16px; bottom: 30px; width: 270px; box-sizing: border-box;
      padding: 10px 12px 10px 14px; border-radius: 14px; background: rgba(255,255,255,.58);
      backdrop-filter: blur(12px) saturate(1.3); -webkit-backdrop-filter: blur(12px) saturate(1.3);
      border: 1px solid rgba(255,255,255,.6); box-shadow: 0 4px 18px rgba(20,40,60,.14); font: .78rem system-ui; color: #23394d;
      animation: capa-info .2s ease-out; }
    /* hilo de color de la capa a la izquierda, en lugar de un borde pesado */
    .capa-info::before { content: ''; position: absolute; left: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 0 3px 3px 0; background: var(--c); }
    @keyframes capa-info { from { opacity: 0; transform: translateY(8px); } }
    /* si abajo hay una franja de detalle o una cápsula de selección, la tarjeta se ubica encima */
    :host:has(.pin-panel) .capa-info { bottom: calc(var(--alto-det) + 28px); }
    :host:has(.sel-chip) .capa-info { bottom: 130px; }
    .barra-ley:has(~ .capa-info) .ley-nombre { display: none; }
    .capa-info__x { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; padding: 0; border-radius: 50%; background: transparent; color: #6b8294; font-size: .95rem; line-height: 1; }
    .capa-info__x:hover { background: rgba(38,66,90,.1); color: #23394d; }
    .capa-info__cab { display: flex; align-items: center; gap: 8px; padding-right: 20px; }
    .capa-info__glifo { flex: none; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; font-size: .85rem;
      background: color-mix(in srgb, var(--c) 30%, transparent); }
    .capa-info__cab strong { display: block; font-size: .86rem; font-weight: 650; line-height: 1.2; }
    .capa-info__estado { font-size: .66rem; color: #7b8f9e; }
    .capa-info__estado.on { color: #3F8A3A; }
    .capa-info__total { margin-left: auto; text-align: right; font-size: 1.1rem; font-weight: 700; line-height: 1; }
    .capa-info__total small { display: block; font-size: .58rem; font-weight: 500; color: #6b8294; }
    .capa-info__txt { margin: 6px 0 4px; line-height: 1.38; color: #3f5a6e; }
    .capa-info__tipos { list-style: none; margin: 0 0 4px; padding: 0; display: grid; gap: 0; }
    .capa-info__tipos li { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; font-size: .74rem; }
    .capa-info__tipos span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #3f5a6e; }
    .capa-info__tipos b { font-weight: 600; }
    .capa-info__fuente { margin: 4px 0 0; padding-top: 4px; border-top: 1px solid rgba(38,66,90,.1); font-size: .66rem; color: #6b8294; }
    .capa-info__fuente b { font-weight: 600; color: #3f5a6e; }
    @media (prefers-reduced-motion: reduce) { .capa-info { animation: none; } }

    /* Botón de ayuda: arriba a la derecha, a la altura de la barra de capas. La primera vez late para invitar a abrirlo. */
    .ayuda-btn { position: absolute; z-index: 11; top: 12px; right: 16px; width: 46px; height: 46px; padding: 0; display: grid; place-items: center;
      border-radius: 50%; background: rgba(255,255,255,.86); color: #26425a; backdrop-filter: blur(8px);
      box-shadow: 0 6px 24px rgba(30,60,90,.2); font: 800 1.25rem/1 system-ui; transition: transform .2s cubic-bezier(.3,1.6,.5,1), background .15s; }
    .ayuda-btn:hover { background: #fff; transform: scale(1.08) rotate(-8deg); }
    /* el «?» en el verde degradado del jardín (el mismo de la marca y de Ingresar) */
    .ayuda-btn span { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; color: #fff;
      background: linear-gradient(140deg, #8CC63F, #3F8A3A 70%); box-shadow: 0 3px 9px rgba(63, 138, 58, .32); }
    .ayuda-btn:hover span { background: linear-gradient(140deg, #9BD24A, #458C2E 70%); }
    .ayuda-btn.nueva::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 3px solid #f5b400; animation: latir 1.6s ease-out infinite; }
    @keyframes latir { from { opacity: .9; transform: scale(.9); } to { opacity: 0; transform: scale(1.35); } }
    /* leyenda de redes encendidas, bajo el botón de ayuda */
    .ley-flot { position: absolute; z-index: 10; top: 70px; right: 16px; width: 230px; display: grid; gap: 4px; padding: 10px 12px; border-radius: 14px;
      background: rgba(255,255,255,.86); backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgba(30,60,90,.18); font: .78rem system-ui; color: #26425a; }
    .ley-flot__t { font-weight: 700; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: #6b8294; margin-bottom: 2px; }
    .ley-flot__i { display: grid; grid-template-columns: 14px 1fr; column-gap: 8px; align-items: center; font-weight: 600; }
    .ley-flot__i i { width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 0 2px #fff; }
    .ley-flot__i small { grid-column: 2; font-weight: 400; font-size: .68rem; color: #6b8294; }
    .ley-flot__nota { margin-top: 4px; font-size: .66rem; line-height: 1.35; color: #6b8294; }
    /* ficha corta (río, red o zona sin proyección): cápsula abajo a la izquierda */
    .sel-chip { position: absolute; z-index: 12; left: 16px; bottom: 30px; max-width: min(420px, calc(100% - 200px)); display: flex; flex-direction: column; gap: 1px;
      padding: 10px 44px 10px 16px; border-radius: 14px; background: rgba(255,255,255,.92); backdrop-filter: blur(8px);
      box-shadow: 0 6px 24px rgba(30,60,90,.22); border-left: 5px solid #26425a; font: .9rem system-ui; color: #26425a; animation: subir-det .2s ease-out; }
    .sel-chip .tipo { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: #6b8294; }
    .sel-chip strong { font-size: 1.05rem; }
    .sel-chip .dato { font-size: .78rem; color: #4d6a80; }
    .sel-chip .cerrar { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; padding: 0; border-radius: 50%; background: rgba(38,66,90,.1); color: #26425a; font-size: 1.2rem; line-height: 1; }
    /* ficha de industria en la franja inferior */
    .fab-panel { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr); grid-auto-flow: row; }
    .fab-panel .fab-dato { margin: 0 0 6px; font-size: .8rem; color: #4d6a80; }
    .fab-panel h3 { margin: 0 0 6px; font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: #6b8294; }
    .fab-panel .fab-emis { display: grid; gap: 2px; font-size: .82rem; }
    .fab-panel .fab-emis div { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; border-top: 1px solid rgba(38,66,90,.1); }
    .fab-panel .fab-emis b { font-weight: 700; }
    .fab-panel .vacio { margin: 0; font-size: .8rem; color: #6b8294; }
    /* año de la población: se elige en la tabla de la vereda */
    .anio-btn { padding: 2px 8px; border-radius: 999px; background: rgba(38,66,90,.08); color: #26425a; font: inherit; font-size: .8rem; }
    .anio-btn:hover { background: rgba(38,66,90,.18); }
    .anio-btn[aria-pressed="true"] { background: #26425a; color: #fff; }
    .zoom .zoom__casa { display: grid; place-items: center; margin-bottom: 4px; }
    .ctl-toggle { display: none; }
    @media (max-width: 640px) { .ctl-toggle { display: grid; } }

    /* Tutorial: carta de juego con barra de experiencia, niveles y controles en teclas */
    .tuto { position: absolute; inset: 0; z-index: 30; display: grid; place-items: center; padding: 16px;
      background: radial-gradient(circle at 50% 40%, rgba(10,25,40,.35), rgba(10,25,40,.72)); backdrop-filter: blur(3px); animation: tuto-fondo .2s ease-out; }
    @keyframes tuto-fondo { from { opacity: 0; } }
    .tuto__carta { position: relative; width: min(520px, 100%); max-height: calc(100% - 16px); overflow: auto; box-sizing: border-box; outline: none;
      padding: 18px 22px 18px; border-radius: 22px; background: linear-gradient(170deg, #fffdf8, #f2f6fa); color: #1f3346;
      box-shadow: 0 24px 60px rgba(0,0,0,.4), 0 0 0 3px var(--c), 0 0 34px color-mix(in srgb, var(--c) 55%, transparent);
      font: .92rem system-ui; animation: tuto-carta .32s cubic-bezier(.3,1.5,.5,1); transition: box-shadow .3s; }
    @keyframes tuto-carta { from { opacity: 0; transform: translateY(16px) scale(.94); } }
    .tuto__barra { height: 8px; border-radius: 999px; background: rgba(31,51,70,.1); overflow: hidden; margin-bottom: 12px; }
    .tuto__barra i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #f5b400, var(--c));
      transition: width .4s cubic-bezier(.3,1.2,.5,1); }
    .tuto__cab { display: flex; align-items: center; gap: 10px; }
    .tuto__nivel { font: 800 .72rem system-ui; letter-spacing: .1em; text-transform: uppercase; color: var(--c); }
    .tuto__xp { padding: 2px 8px; border-radius: 999px; background: #fff3c4; color: #8a5a00; font: 800 .72rem system-ui; }
    .tuto__saltar { margin-left: auto; padding: 4px 10px; background: transparent; color: #6b8294; font-size: .78rem; }
    .tuto__saltar:hover { background: rgba(31,51,70,.08); }
    .tuto__cuerpo { text-align: center; padding: 6px 4px 2px; animation: tuto-paso .3s ease-out; }
    @keyframes tuto-paso { from { opacity: 0; transform: translateX(14px); } }
    .tuto__emblema { display: grid; place-items: center; width: 74px; height: 74px; margin: 6px auto 8px; font-size: 2.3rem; border-radius: 22px;
      background: color-mix(in srgb, var(--c) 16%, #fff); box-shadow: inset 0 -4px 0 color-mix(in srgb, var(--c) 30%, transparent);
      animation: tuto-emblema .5s cubic-bezier(.3,1.8,.5,1); }
    @keyframes tuto-emblema { from { transform: scale(.3) rotate(-25deg); } }
    .tuto h2 { margin: 0 0 6px; font-size: 1.3rem; }
    .tuto__cuerpo > p { margin: 0 auto 12px; max-width: 44ch; color: #4a6072; line-height: 1.45; }
    .tuto__controles { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; text-align: left; }
    .tuto__controles li { display: grid; grid-template-columns: minmax(0, auto) 1fr; align-items: center; gap: 12px; padding: 7px 10px; border-radius: 12px;
      background: rgba(31,51,70,.05); font-size: .84rem; }
    .tuto__teclas { display: flex; flex-wrap: wrap; gap: 4px; }
    .tuto kbd { display: inline-block; padding: 3px 8px; border-radius: 7px; background: #fff; color: #1f3346; white-space: nowrap;
      font: 700 .74rem system-ui; border: 1px solid rgba(31,51,70,.2); box-shadow: 0 2px 0 rgba(31,51,70,.25); }
    .tuto__pie { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
    .tuto__puntos { display: flex; gap: 5px; margin-right: auto; }
    .tuto__puntos i { width: 9px; height: 9px; border-radius: 50%; background: rgba(31,51,70,.18); transition: background .2s, transform .2s; }
    .tuto__puntos i.on { background: var(--c); transform: scale(1.15); }
    .tuto__atras { background: transparent; color: #26425a; box-shadow: inset 0 0 0 1.5px rgba(38,66,90,.3); }
    .tuto__atras:hover { background: rgba(38,66,90,.08); }
    .tuto__sig { background: var(--c); color: #fff; padding: 9px 18px; box-shadow: 0 4px 0 color-mix(in srgb, var(--c) 60%, #000); transition: transform .1s, box-shadow .1s; }
    .tuto__sig:hover { background: var(--c); filter: brightness(1.08); }
    .tuto__sig:active { transform: translateY(3px); box-shadow: 0 1px 0 color-mix(in srgb, var(--c) 60%, #000); }
    .tuto__sig--fin { background: linear-gradient(135deg, #f5b400, #e07b00); box-shadow: 0 4px 0 #a35700; }
    @media (prefers-reduced-motion: reduce) {
      .tuto, .tuto__carta, .tuto__cuerpo, .tuto__emblema, .ayuda-btn.nueva::after { animation: none; }
    }

    /* Detalle de zona o lugar: franja horizontal en la parte inferior del mapa, organizada en columnas. */
    :host { --alto-det: clamp(190px, 34%, 290px); }
    .pin-panel { position: absolute; z-index: 12; left: 16px; right: 16px; bottom: 16px; height: var(--alto-det); box-sizing: border-box;
      display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 0; overflow: hidden; overscroll-behavior: contain;
      padding: 14px 44px 12px 6px; border-radius: 16px; background: rgba(255,255,255,.92); backdrop-filter: blur(8px);
      box-shadow: 0 -4px 24px rgba(30,60,90,.22); border-top: 5px solid var(--c, #26425a); font: .9rem system-ui; color: #26425a;
      animation: subir-det .22s ease-out; }
    @keyframes subir-det { from { opacity: 0; transform: translateY(14px); } }
    @media (prefers-reduced-motion: reduce) { .pin-panel { animation: none; } }
    .pin-panel .col { min-width: 0; overflow-y: auto; padding: 0 14px; border-left: 1px solid rgba(38,66,90,.12); scrollbar-width: thin; }
    .pin-panel .col:first-of-type { border-left: 0; }
    .pin-panel .col > h3:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
    /* Las columnas se reparten el ancho disponible (sin scroll lateral); el texto se ajusta dentro de cada una. */
    /* Zona: cabecera fija + acordeón horizontal. La categoría abierta crece a lo ancho; las cerradas son pestañas verticales. */
    /* Título de la vereda arriba, en una línea; debajo, las cápsulas del acordeón ocupan todo el ancho. */
    .zona-panel { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 12px; }
    .zona-panel .zona-tit { flex: none; display: flex; align-items: baseline; gap: 12px; min-width: 0; padding: 0 44px 0 4px; }
    .zona-panel .zona-tit strong { font-size: 1.15rem; line-height: 1.2; white-space: nowrap; }
    .zona-panel .zona-tit .tipo { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: #6b8294;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .zona-panel .acc-fila { flex: 1; min-height: 0; display: flex; gap: 8px; }
    .zona-panel .acc { min-height: 0; }
    .zona-panel .acc { display: flex; min-width: 0; flex: 0 0 114px; border-radius: 12px; background: rgba(38,66,90,.05);
      transition: flex-grow .32s cubic-bezier(.3,.9,.3,1), background .2s; overflow: hidden; }
    .zona-panel .acc.abierta { flex-grow: 1; background: rgba(38,66,90,.035); }
    .zona-panel .acc-tab { flex: 0 0 114px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 10px 6px;
      border-radius: 12px; background: transparent; color: #26425a; cursor: pointer; transition: background .2s, color .2s; }
    .zona-panel .acc-tab:hover { background: rgba(38,66,90,.1); }
    .zona-panel .acc-tab:focus-visible { outline: 2px solid #e0b33a; outline-offset: -2px; }
    .zona-panel .acc.abierta .acc-tab { background: #26425a; color: #fff; }
    .zona-panel .acc-ico { font-size: 1.35rem; line-height: 1; transition: transform .25s cubic-bezier(.34,1.6,.5,1); }
    .zona-panel .acc-tab:hover .acc-ico { transform: scale(1.15); }
    .zona-panel .acc-num { font-size: 1.05rem; font-weight: 800; line-height: 1; }
    /* nombre de la categoría en horizontal y completo: se parte en líneas dentro de la pestaña, sin puntos suspensivos */
    .zona-panel .acc-t { font-size: .74rem; font-weight: 600; line-height: 1.25; text-align: center; text-wrap: balance; overflow-wrap: normal; hyphens: none; }
    .zona-panel .acc-cuerpo { flex: 1; min-width: 0; overflow-y: auto; padding: 4px 14px 4px 14px; scrollbar-width: thin;
      animation: acc-entrar .28s ease-out .08s both; }
    @keyframes acc-entrar { from { opacity: 0; transform: translateX(-10px); } }
    @media (prefers-reduced-motion: reduce) { .zona-panel .acc { transition: none; } .zona-panel .acc-cuerpo { animation: none; } }
    .zona-panel .acc-dos { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 6px 22px; align-items: start; }
    .zona-panel .acc-dos .variacion { margin-top: 2px; }
    /* tres columnas que se acomodan al ancho: nunca más anchas que la franja, así no aparece desplazamiento horizontal */
    /* año y tabla a la izquierda (angosta), grupos de edad al centro (lo más ancho) e indicadores a la derecha */
    .zona-panel .acc-dos.con-piramide { grid-template-columns: minmax(170px, .75fr) minmax(0, 2.2fr) minmax(180px, .9fr); }
    @media (max-width: 1100px) { .zona-panel .acc-dos.con-piramide { grid-template-columns: minmax(170px, .8fr) minmax(0, 2fr); } }
    @media (max-width: 700px) { .zona-panel .acc-dos.con-piramide { grid-template-columns: minmax(0, 1fr); } }
    .zona-panel .pob-fuente { grid-column: 1 / -1; margin: 2px 0 0; }
    .anios-clave { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 8px; }
    .anios-clave .anio-btn { font-size: .72rem; padding: 1px 7px; }
    .zona-panel .acc-dos > * { min-width: 0; }
    .zona-panel .acc-cuerpo { overflow-x: hidden; }
    .zona-panel .pin-fuente { overflow-wrap: anywhere; }
    .zona-panel tr.extrap td { color: #6b8294; }
    .anio-desliza { display: grid; gap: 2px; margin: 0 0 8px; font-size: .8rem; color: #26425a; }
    .anio-desliza b { font-size: .95rem; }
    .anio-desliza .extrap { margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: #f3e3c3; color: #7a5410; font-style: normal; font-size: .68rem; }
    .anio-desliza input { width: 100%; margin: 4px 0; accent-color: #26425a;
      /* la franja oficial se ve más oscura que la extrapolada */
      background: linear-gradient(90deg, rgba(38,66,90,.35) var(--oficial), rgba(201,145,60,.35) var(--oficial)); border-radius: 999px; height: 4px; }
    .anio-desliza .escala { display: flex; justify-content: space-between; gap: 6px; font-size: .66rem; color: #6b8294; }
    .edades h4 { margin: 0 0 2px; font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: #6b8294; }
    .edades-sexo { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 0 0 6px; font-size: .72rem; font-weight: 600; }
    .edades .h { color: #3f6f97; } .edades .m { color: #b0614a; }
    .edades ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr)); }
    .edades li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1px 8px; font-size: .76rem; color: #26425a; }
    .edades .ge-nom { grid-column: 1 / -1; min-width: 0; color: #26425a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .edades .ge-rango { min-width: 0; color: #6b8294; font-size: .7rem; }
    .edades .ge-num { text-align: right; white-space: nowrap; }
    .edades .ge-barra { grid-column: 1 / -1; position: relative; display: flex; height: 7px; border-radius: 4px; background: rgba(38,66,90,.07); overflow: hidden; }
    .edades .ge-barra .h { background: #6f9cc2; transition: width .25s ease; }
    .edades .ge-barra .m { background: #d98f78; transition: width .25s ease; }
    .edades .ge-barra .b { position: absolute; top: -1px; bottom: -1px; width: 2px; margin-left: -1px; background: #26425a; }
    .edades .ge-cambio { grid-column: 1 / -1; font-size: .68rem; color: #a5532f; }
    .edades .ge-cambio.sube { color: #2f7a4f; }
    .indic { display: grid; gap: 8px; margin: 0 0 8px; }
    .indic dt { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; color: #6b8294; }
    .indic dd { margin: 0; font-size: 1rem; font-weight: 700; color: #26425a; }
    .indic dd small { display: block; font-size: .68rem; font-weight: 400; color: #6b8294; }
    @media (prefers-reduced-motion: reduce) { .edades .ge-barra i { transition: none; } }
    .zona-panel .acc-grupos { columns: 240px; column-gap: 22px; }
    .zona-panel .acc-grupos details { break-inside: avoid; }
    .zona-panel .acc-cuerpo .proyectos { columns: 300px; column-gap: 22px; display: block; }
    .zona-panel .acc-cuerpo .proyectos li { break-inside: avoid; }
    .zona-panel .proyectos__ind { overflow-wrap: anywhere; }
    .zona-panel .barra b { font-size: .68rem; }
    .lugar-panel { grid-template-columns: minmax(0, 1fr) minmax(0, 2.4fr); grid-auto-flow: row; }
    .lugar-panel .col-datos dl { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); column-gap: 18px; }
    /* Con el detalle abierto, los controles suben por encima de la franja y el panel lateral se acorta. */
    :host:has(.pin-panel) .zoom, :host:has(.pin-panel) .foto, :host:has(.pin-panel) .conducir { bottom: calc(var(--alto-det) + 28px); }
    :host:has(.pin-panel) .creditos { display: none; }
    .pin-panel .cerrar { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; padding: 0; border-radius: 50%;
      background: rgba(38,66,90,.1); color: #26425a; font-size: 1.2rem; line-height: 1; }
    .pin-panel .cerrar:hover { background: rgba(38,66,90,.2); }
    .pin-cab { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; padding-right: 26px; }
    .pin-glifo { flex: none; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; font-size: 1.5rem;
      background: var(--c); box-shadow: 0 0 0 3px #fff, 0 0 0 4px rgba(36,55,70,.2); }
    .pin-cab .tipo { display: block; font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: #6b8294; }
    .pin-cab strong { font-size: 1.05rem; line-height: 1.2; }
    .pin-panel dl { margin: 0; display: grid; gap: 8px; }
    .pin-panel dt { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: #6b8294; }
    .pin-panel dd { margin: 1px 0 0; font-size: .86rem; overflow-wrap: anywhere; }
    .pin-mapa { display: inline-flex; align-items: center; gap: 6px; margin-top: 14px; padding: 8px 14px; border-radius: 10px;
      background: #26425a; color: #fff; font-weight: 600; font-size: .85rem; text-decoration: none; }
    .pin-mapa:hover { background: #35597a; }
    .zona-panel .barras { display: flex; align-items: flex-end; gap: 8px; height: 96px; margin: 4px 0 8px; }
    .zona-panel .barra { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 3px;
      height: 100%; padding: 0; background: none; color: #26425a; font: inherit; cursor: pointer; }
    .zona-panel .barra b { font-size: .74rem; font-weight: 700; }
    .zona-panel .barra i { display: block; width: 100%; min-height: 3px; border-radius: 6px 6px 0 0; background: #9db8cc; transition: height .3s, background .2s; }
    .zona-panel .barra span { font-size: .72rem; color: #6b8294; }
    .zona-panel .barra:hover i { background: #7fa2bd; }
    .zona-panel .barra.activa i { background: #26425a; }
    .zona-panel .barra.activa span { color: #26425a; font-weight: 700; }
    .zona-panel table { width: 100%; border-collapse: collapse; font-size: .82rem; }
    .zona-panel th { text-align: right; font-size: .68rem; text-transform: uppercase; letter-spacing: .05em; color: #6b8294; font-weight: 600; padding: 2px 0; }
    .zona-panel th:first-child, .zona-panel td:first-child { text-align: left; }
    .zona-panel td { text-align: right; padding: 3px 0; border-top: 1px solid rgba(38,66,90,.1); }
    .zona-panel tr.activa td { font-weight: 700; color: #26425a; }
    .zona-panel .variacion { margin: 10px 0 0; font-size: .82rem; }
    .zona-panel h3 { display: flex; justify-content: space-between; align-items: baseline; margin: 16px 0 6px; padding-top: 12px;
      border-top: 1px solid rgba(38,66,90,.12); font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: #6b8294; }
    .zona-panel h3 small { font-size: .8rem; font-weight: 700; color: #26425a; letter-spacing: 0; }
    .zona-panel .vacio { margin: 0; font-size: .8rem; color: #6b8294; }
    .zona-panel .proyectos { list-style: none; margin: 0 0 4px; padding: 0; display: grid; gap: 2px; }
    .zona-panel .proyectos summary { cursor: pointer; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: .82rem; padding: 4px 0; }
    .zona-panel .proyectos__ind { color: #26425a; }
    .zona-panel .proyectos__pct { flex: none; font-size: .74rem; padding: 1px 7px; border-radius: 999px; background: #fdf0c8; color: #6d5410; }
    .zona-panel .proyectos__pct.alto { background: #d9efd4; color: #2c6a2a; }
    .zona-panel .proyectos__pct.bajo { background: #f6d8d0; color: #8a3520; }
    .zona-panel .proyectos__resp { margin: 2px 0 4px; font-size: .78rem; color: #6b8294; }
    .zona-panel .proyectos__resp a { color: #26425a; font-weight: 600; }
    .zona-panel .proyectos__cita { margin: 0 0 6px; font-size: .76rem; line-height: 1.45; color: #4a6072; }
    .zona-panel .proyectos__cita b { margin-right: 4px; color: #26425a; }
    .zona-panel details.infra { margin-bottom: 2px; }
    .zona-panel summary { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: .86rem; cursor: pointer; list-style: none; }
    .zona-panel summary::-webkit-details-marker { display: none; }
    .zona-panel summary b { margin-left: auto; font-weight: 700; }
    .zona-panel .medalla { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: .8rem; box-shadow: 0 0 0 2px #fff; }
    .zona-panel details ul { margin: 0 0 6px 32px; padding: 0; list-style: none; display: grid; gap: 1px; }
    .zona-panel details li button { display: block; width: 100%; padding: 3px 6px; border-radius: 6px; background: none; color: #26425a;
      text-align: left; font: inherit; font-size: .8rem; }
    .zona-panel details li button span { opacity: .45; margin-left: 2px; }
    .zona-panel details li button:hover span { opacity: 1; }
    .pin-panel .volver-zona { display: block; margin: 0 0 10px; padding: 0; background: none; color: #35597a; font-size: .8rem; font-weight: 600; }
    .pin-panel .volver-zona:hover { text-decoration: underline; background: none; }
    .zona-panel details li button:hover { background: rgba(38,66,90,.1); }
    .pin-fuente { margin: 12px 0 0; font-size: .72rem; color: #6b8294; }
    /* capa que aún carga: aro que gira alrededor del ícono */
    .barra-ley .ley.cargando { cursor: progress; }
    .barra-ley .ley.cargando::after { content: ''; position: absolute; inset: 2px; border-radius: 50%;
      border: 2px solid transparent; border-top-color: var(--c); animation: girar-ley .8s linear infinite; }
    @keyframes girar-ley { to { transform: rotate(360deg); } }
    /* el último ícono de la fila abre su nombre hacia la izquierda, para no salirse por el borde */
    .barra-ley .pista > .ley:last-child .ley-nombre { left: auto; right: 0; transform: translate(0, -6px) scale(.85); transform-origin: calc(100% - 18px) -8px; }
    .barra-ley .pista > .ley:last-child:hover .ley-nombre, .barra-ley .pista > .ley:last-child:focus-visible .ley-nombre { transform: translate(0, 0) scale(1); }
    .barra-ley .pista > .ley:last-child .ley-nombre::before { left: auto; right: 13px; transform: rotate(45deg); }
    button { border: 0; border-radius: 10px; padding: 7px 14px; background: #26425a; color: #fff;
      font: 600 .82rem system-ui; cursor: pointer; }
    button:hover { background: #35597a; }

    /* Móvil: la leyenda es una sola fila que se desliza (no una masa que tapa el mapa), los controles de la
       esquina se apilan en una columna (sin pisar los créditos) y la ficha de la vereda pasa a acordeón vertical. */
    @media (max-width: 640px) {
      :host { --alto-det: min(58%, 440px); --base: 10px; }
      :host:has(.pin-panel) { --base: calc(var(--alto-det) + 22px); }
      .barra-ley { top: 8px; left: 8px; right: auto; margin-inline: 0; width: auto; max-width: calc(100% - 66px); }
      .barra-ley .pista { flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; overscroll-behavior-x: contain;
        scrollbar-width: none; padding: 4px 8px; }
      .barra-ley .pista::-webkit-scrollbar { display: none; }
      .barra-ley .ley-nombre { display: none; }
      .ayuda-btn { top: 8px; right: 8px; width: 42px; height: 42px; }
      .ley-flot { top: 58px; right: 8px; width: min(230px, calc(100% - 16px)); }
      .capa-info { left: 8px; width: min(270px, calc(100% - 68px)); }
      .sel-chip { left: 8px; max-width: calc(100% - 68px); }
      .creditos { left: 8px; bottom: 4px; max-width: calc(100% - 64px); font-size: 9px; }
      /* el botón de plegar ocupa la base de la columna; zoom y modos se apilan encima */
      :host { --pila: calc(var(--base) + 46px); }
      :host:has(.pin-panel) { --pila: calc(var(--base) + 46px); }
      .ctl-toggle { position: absolute; z-index: 10; right: 10px; bottom: var(--base); width: 38px; height: 38px; padding: 0;
        display: grid; place-items: center; border-radius: 12px; background: rgba(255,255,255,.92); color: #26425a;
        box-shadow: 0 3px 12px rgba(30,60,90,.25); backdrop-filter: blur(6px); }
      .ctl-toggle:hover { background: #fff; }
      .ctl-toggle.abierto { background: #26425a; color: #fff; }
      :host(.ctl-plegado) .zoom, :host(.ctl-plegado) .foto, :host(.ctl-plegado) .conducir { display: none; }
      :host .zoom, :host:has(.pin-panel) .zoom { right: 10px; bottom: var(--pila); }
      :host .foto, :host:has(.pin-panel) .foto,
      :host .conducir, :host:has(.pin-panel) .conducir,
      :host .conducir.volar, :host:has(.pin-panel) .conducir.volar { right: 10px; }
      :host .conducir, :host:has(.pin-panel) .conducir { bottom: calc(var(--pila) + 142px); }
      :host .conducir.volar, :host:has(.pin-panel) .conducir.volar { bottom: calc(var(--pila) + 186px); }
      :host .foto, :host:has(.pin-panel) .foto { bottom: calc(var(--pila) + 230px); }
      /* con la ficha abierta no cabe la columna completa: se quedan solo los controles de zoom */
      :host:has(.pin-panel) .foto, :host:has(.pin-panel) .conducir { display: none; }

      .pin-panel { left: 8px; right: 8px; bottom: 8px; padding: 12px 40px 10px 4px; }
      .pin-panel:not(.zona-panel) { grid-auto-flow: row; grid-auto-columns: minmax(0, 1fr); align-content: start; overflow-y: auto; }
      .pin-panel .col { border-left: 0; padding: 0 10px 10px; overflow: visible; }
      .lugar-panel, .fab-panel { grid-template-columns: minmax(0, 1fr); }
      .lugar-panel .col-datos dl { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }

      .zona-panel { padding: 10px 8px 8px; gap: 6px; }
      .zona-panel .zona-tit { flex-wrap: wrap; gap: 0 8px; padding: 0 40px 0 4px; }
      .zona-panel .zona-tit strong { white-space: normal; font-size: 1.05rem; }
      .zona-panel .zona-tit .tipo { flex-basis: 100%; white-space: normal; }
      .zona-panel .acc-fila { flex-direction: column; gap: 6px; overflow: hidden; }
      .zona-panel .acc { flex: 0 0 auto; flex-direction: column; }
      .zona-panel .acc.abierta { flex: 1 1 0; min-height: 0; }
      .zona-panel .acc-tab { flex: 0 0 auto; flex-direction: row; justify-content: flex-start; gap: 10px; padding: 10px 12px; }
      .zona-panel .acc-t { flex: 1; text-align: left; text-wrap: wrap; }
      .zona-panel .acc-num { order: 3; }
      .zona-panel .acc-cuerpo { flex: 1 1 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 6px 12px 12px; }
    }
  `],
})
export class Mapa3dComponent implements AfterViewInit {
  @ViewChild('lienzo', { static: true }) private lienzo!: ElementRef<HTMLDivElement>;
  @ViewChild('tilt', { static: true }) private capaTilt!: ElementRef<HTMLDivElement>;
  /** tilt-shift al acercarse; en false nunca se desenfoca */
  tiltShift = true;
  /** fuerza actual del tilt-shift (0–1, se suaviza hacia la deseada) y desenfoque escrito en el CSS */
  private tiltK = 0;
  private tiltPx = 0;
  /** flechas pulsadas para desplazar el mapa, si va con Shift y la velocidad actual (se acelera y frena suave) */
  private readonly flechas = new Set<string>();
  private flechaRapida = false;
  private readonly velFlechas = new THREE.Vector2();
  @ViewChild('rotulos', { static: true }) private contenedorRotulos!: ElementRef<HTMLDivElement>;
  @ViewChild('barraLey', { static: true }) private barraLey!: ElementRef<HTMLDivElement>;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly http = inject(HttpClient);
  private readonly ruta = inject(ActivatedRoute);
  private readonly enrutador = inject(Router);
  private readonly mapa = inject(MapaService);
  private readonly zona = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  readonly cargando = signal(true);
  /** avance de la carga, de 0 a 100: descarga de datos (hasta 30) y construcción de la escena por etapas */
  readonly progreso = signal(0);
  private avanzar(p: number) { this.progreso.update(a => Math.max(a, Math.min(100, Math.round(p)))); }
  readonly error = signal('');
  readonly seleccion = signal<Zona | null>(null);
  readonly pinFicha = signal<FichaPin | null>(null);
  /** Franja inferior de la zona: categorías del acordeón horizontal y la que está desplegada. */
  readonly seccionesDet = [
    { id: 'pob', glifo: '👥', nombre: 'Población y viviendas' },
    { id: 'infra', glifo: '🏛️', nombre: 'Infraestructura' },
    { id: 'proy', glifo: '📋', nombre: 'Proyectos y responsables' },
  ] as const;
  readonly seccionDet = signal(0);
  poblacionActual(anios: readonly { actual: boolean; pob: number }[]): number {
    return (anios.find(a => a.actual) ?? anios[anios.length - 1])?.pob ?? 0;
  }
  /** modo fotografía: sin rótulos, pines ni aros de luz */
  readonly modoFoto = signal(false);
  /** controles (zoom, vista general) y modos (foto, volar, conducir): en pantallas angostas arrancan plegados */
  readonly controlesAbiertos = signal(typeof matchMedia === 'function' ? !matchMedia('(max-width: 640px)').matches : true);
  /** al abrirse una tarjeta o ficha (capa, vereda, lugar, industria, río, red) los controles se pliegan para dejarle el espacio;
   *  se pueden volver a abrir con el botón */
  private readonly plegarAlAbrirFicha = effect(() => {
    const abierta = !!(this.capaInfo() || this.seleccion() || this.pinFicha() || this.fabricaSeleccion() || this.redSeleccion() || this.rioSeleccion());
    if (abierta) this.controlesAbiertos.set(false);
  });
  readonly conduciendo = signal(false);
  /** tras pulsar el carro: el próximo clic en el mapa marca dónde empezar a conducir */
  readonly eligiendoSalida = signal(false);
  /** si el modo foto lo encendió la conducción (para apagarlo al salir) */
  private fotoPorConducir = false;
  readonly cayo = signal(false);
  private conduccion?: Conduccion | Avioneta;
  private carro?: Conduccion;
  private avioneta?: Avioneta;
  /** vehículo elegido: el carro por las vías o la avioneta */
  readonly vehiculo = signal<'carro' | 'avion'>('carro');
  /** distancia al borde de la calzada más cercana (negativa sobre ella), para que el carro suba al asfalto */
  private holguraConduccion?: (x: number, z: number) => [number, number, number, number, number];
  /** Ancho y altura de las calles ajustados a las fachadas y al relieve (scripts/asentar_vias_edificios.py); null = vías de ancho fijo. */
  private rasante: Rasante | null = null;
  private antesDeConducir?: { pos: THREE.Vector3; objetivo: THREE.Vector3; fov: number };
  @ViewChild('hudVelocidad') private hudVelocidad?: ElementRef<HTMLElement>;
  @ViewChild('hudZona') private hudZona?: ElementRef<HTMLElement>;
  @ViewChild('hudAltura') private hudAltura?: ElementRef<HTMLElement>;
  private hudAcumulado = 0;
  readonly anio = signal(ANIO_INICIAL);
  readonly hayPoblacion = signal(false);
  readonly aniosPoblacion = ANIOS_POBLACION;

  private renderer!: THREE.WebGLRenderer;
  /** niebla que se acerca al bajar la cámara (perspectiva atmosférica); en false queda el rango fijo de siempre */
  atmosfera = true;
  private escena = new THREE.Scene();
  private camara!: THREE.PerspectiveCamera;
  private controles!: OrbitControls;
  private terreno!: THREE.Mesh;
  private proxy!: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private animacion = 0;
  private vuelo: { t0: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; o0: THREE.Vector3; o1: THREE.Vector3 } | null = null;

  // relieve y proyección local (metros, con el norte hacia -z)
  private relieve!: Relieve;
  private alturas!: Int16Array;
  private lon0 = 0;
  private lat0 = 0;
  private mLon = 1;
  private readonly mLat = 110574;
  private ancho = 0;
  private alto = 0;

  // pintura
  private piezas: Pieza[] = [];
  private foto: HTMLImageElement | null = null;
  private texturaColor!: THREE.CanvasTexture;
  private lienzoLimpio!: HTMLCanvasElement;
  private lienzoConZonas!: HTMLCanvasElement;
  private lienzoIds!: HTMLCanvasElement;
  private ctxIds!: CanvasRenderingContext2D;
  private lienzoResalte!: HTMLCanvasElement;
  private ctxResalte!: CanvasRenderingContext2D;
  private texturaResalte!: THREE.CanvasTexture;
  private hover = -1;
  /** color vivo del Río Medellín (lineal): el shader del agua lo lee cada cuadro */
  private readonly uniformsRio = {
    uRio: { value: new THREE.Color(COLORES_MEDELLIN[0]) },
    uAnil: { value: new THREE.Color(COLOR_VERTIMIENTO_TEXTIL) },
    uCarmin: { value: new THREE.Color(COLOR_VERTIMIENTO_COLORANTE) },
    uT: { value: 0 },
  };
  private colorRio = { de: 0, a: 0, t: 0 };
  private bordeClaves = '';
  private bordeMunicipio: THREE.Object3D[] = [];
  /** visibilidad de los objetos de marcación antes de entrar al modo fotografía */
  private visiblesAntesFoto = new Map<THREE.Object3D, boolean>();
  private bordesHover = new Map<number, THREE.Group>();
  // levantamiento de las veredas
  private capas: Capa[] = [];
  /** identificador de vereda + 1 por píxel del croquis (0 = ninguna) */
  private mapaIds!: Uint8Array;
  private alzado: number[] = [];
  private normalesPendientes = false;
  private elegida = -1;
  private pulsado: { x: number; y: number } | null = null;
  private sol!: THREE.DirectionalLight;
  // sombras bajo demanda: el mapa solo se repinta cuando algo que proyecta sombra cambió
  private sombraTerreno?: THREE.Mesh;
  // sombra de las nubes en una textura sobre todo el terreno, repintada cada dos cuadros
  private rtNubes!: THREE.WebGLRenderTarget;
  private pasoNubes!: { escena: THREE.Scene; camara: THREE.OrthographicCamera };
  private cuadroNubes = 0;
  // normales del terreno: solo se recalculan las de las veredas que se movieron
  private capaTerreno!: Capa;
  private filasTerreno = 0;
  private piezasMovidas = new Set<number>();
  private claveSombra = '';
  private sombraSucia = true;
  private centroSombra = new THREE.Vector3();
  // resolución dinámica: baja mientras la cámara se mueve y la máquina no da abasto
  private ratioMax = 1;
  private degradado = false;
  private ultimoMovimiento = 0;
  // ritmo de cuadros: 60 por segundo mientras se usa el mapa, 30 en reposo y ninguno si el lienzo no se ve
  private ultimaActividad = 0;
  private proximoCuadro = 0;
  private lienzoVisible = true;
  private camaraRitmo = new THREE.Vector3();
  private objetivoRitmo = new THREE.Vector3();
  // último movimiento del cursor sin atender: el hover (pines, rótulos, veredas, ríos) se calcula una vez por cuadro
  private moverPendiente: PointerEvent | null = null;
  private promedioMs = 16;
  private camaraAnterior = new THREE.Vector3();
  private objetivoAnterior = new THREE.Vector3();
  private perf: { el: HTMLElement; acumulado: number; cuadros: number; sombras: number; msActualizar: number; msRender: number } | null = null;
  private nubes: Nube[] = [];
  private nieblas: Neblina[] = [];
  private calzadas: Calzada[] = [];
  private autos: Auto[] = [];
  private fabricas: FabricaMapa[] = [];
  private mallaIndustrias: THREE.Mesh | null = null;
  private inicioFabrica: number[] = [];
  private anilloFabrica: THREE.Mesh | null = null;
  private fabricaElegida = -1;
  private fabricaHover = -1;
  /** Puntos de interés (colegios, hospitales, canchas...) con el edificio que los representa. */
  /** `pin`: dónde va el icono (y su altura sobre la losa) cuando el lugar es parte de un edificio compartido (PARTES), que se nombra en `sitio`. */
  /** `cota`: altura de la plaza nivelada de lo que va sobre la vía (nivelarPlazas) */
  private equipamientos: { x: number; z: number; lon: number; lat: number; n: string; r: number; yaw?: number; pin?: { x: number; z: number; alto: number; nivel?: [number, number]; base?: number }; sitio?: string; cota?: number; datos: { p: Punto; modelo: Modelo } }[] = [];
  private mallaEquip: THREE.Mesh | null = null;
  private geoEquip: THREE.BufferGeometry | null = null;
  private matEquip: THREE.Material | null = null;
  private inicioEquip: number[] = [];
  /** neón en el círculo de cada equipamiento y su icono flotante */
  private auraEquip: Aura | null = null;
  private iconosEquip: Icono[] = [];
  /** tipos de edificio cuyos pines se muestran (la leyenda los deja apagados al inicio) */
  readonly capasActivas = signal<ReadonlySet<string>>(new Set());
  readonly leyenda = [
    ...CATEGORIAS.map(c => ({ id: c.id as string, nombre: c.nombre, color: c.color, glifo: GLIFO[c.id] })),
    { id: 'industria', nombre: 'Industrias', color: COLOR_INDUSTRIA, glifo: GLIFO.industria },
  ];
  /** con una zona elegida solo se ven los pines de esa zona, y solo de los tipos activados en la leyenda */
  private readonly pinVisible = (ic: Icono): boolean =>
    !this.modoFoto() && (this.capasActivas().has(ic.cat) || (this.subterraneo() && ic.cat.startsWith('srv-'))) && (this.aisladas.size ? ic.zona !== undefined && this.aisladas.has(ic.zona) : (this.elegida < 0 || ic.zona === this.elegida));

  /** Redes de servicios (alta tensión, subestaciones, plantas): un grupo que la barra de controles enciende y apaga. */
  readonly redesVisibles = signal(false);   // el mapa abre sin capas encendidas
  private grupoRedes: THREE.Group | null = null;
  alternarRedes(): void {
    this.soltarRed();
    this.redesVisibles.update(v => !v);
    if (this.grupoRedes) this.grupoRedes.visible = this.redesVisibles();
  }

  alternarCapa(id: string): void {
    this.capasActivas.update(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ───────────────── tarjeta de la capa tocada en la barra ─────────────────
  /** capa cuya tarjeta de resumen está abierta y centro horizontal de su ícono dentro de la barra */
  readonly capaInfo = signal<{ id: string; x: number } | null>(null);
  private tCapaInfo = 0;
  private nBarrios = 0;

  mostrarCapa(ev: Event, id: string): void {
    clearTimeout(this.tCapaInfo);
    // se llama después de alternar la capa: si quedó apagada no hay nada que resumir
    if (!this.resumenCapa(id).activa) { this.capaInfo.set(null); return; }
    const boton = (ev.currentTarget ?? ev.target) as HTMLElement;
    const caja = boton.getBoundingClientRect(), barra = this.barraLey.nativeElement.getBoundingClientRect();
    this.capaInfo.set({ id, x: caja.left + caja.width / 2 - barra.left });
    // se cierra sola a los 8 s, o al tocar el mapa u otra capa
    clearTimeout(this.tCapaInfo);
    this.tCapaInfo = window.setTimeout(() => this.capaInfo.set(null), 8000);
  }

  /** Resumen de una capa con lo que ya está cargado: cuántos elementos, de qué tipos y de qué fuente salen. */
  resumenCapa(id: string): { nombre: string; glifo: string; color: string; activa: boolean; total: number | null; unidad: string; texto: string; tipos: { t: string; n: number }[]; fuentes: string[] } {
    const contar = (vals: string[]) => {
      const m = new Map<string, number>();
      for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => ({ t, n }));
    };
    const unicas = (vals: (string | undefined)[]) => [...new Set(vals.filter((v): v is string => !!v))].slice(0, 3);
    const cat = CATEGORIA.get(id as never) as { nombre: string; color: string } | undefined;
    if (cat) {
      const qs = this.equipamientos.filter(q => q.datos.p.c === id);
      return { nombre: cat.nombre, glifo: GLIFO[id as keyof typeof GLIFO], color: cat.color, activa: this.capasActivas().has(id),
        total: qs.length, unidad: qs.length === 1 ? 'lugar' : 'lugares',
        texto: 'Lugares registrados en el municipio. Toca un pin en el mapa para ver su ficha completa.',
        tipos: contar(qs.map(q => q.datos.p.t)), fuentes: unicas(qs.map(q => q.datos.p.f)) };
    }
    const srv = SERVICIOS.find(s => s.id === id);
    if (srv || id === 'servicios') {
      const es = this.servicios.filter(e => (srv ? e.pin!.cat === id : true));
      const grupo = srv ?? SERVICIOS_GRUPO;
      return { nombre: grupo.nombre, glifo: grupo.glifo, color: grupo.color,
        activa: srv ? this.capasActivas().has(id) : this.serviciosActivos() === this.subtiposServicios.length,
        total: es.length, unidad: es.length === 1 ? 'instalación' : 'instalaciones',
        texto: srv ? 'Instalaciones de este servicio público en el municipio.' : 'Energía, acueducto, alcantarillado, gas y demás instalaciones de servicios públicos.',
        tipos: contar(es.map(e => e.pin!.tipo)), fuentes: unicas(es.map(e => e.pin!.fuente)) };
    }
    switch (id) {
      case 'industria':
        return { nombre: 'Industrias', glifo: GLIFO.industria, color: COLOR_INDUSTRIA, activa: this.capasActivas().has(id),
          total: this.fabricas.length, unidad: this.fabricas.length === 1 ? 'industria' : 'industrias',
          texto: 'Empresas con fuentes fijas de emisión: qué queman, cómo controlan el humo y cuánto emiten al año.',
          tipos: contar(this.fabricas.map(f => SECTORES[f.datos.c] ?? f.datos.c)), fuentes: ['Inventario de emisiones atmosféricas · Corantioquia 2021'] };
      case 'rios':
        return { nombre: 'Ríos y quebradas', glifo: '≈', color: '#ffb300', activa: this.sistemaHidrico(), total: null, unidad: '',
          texto: 'Resalta el río Medellín (Aburrá), las quebradas, los lagos y los embalses, con el nombre de cada uno. Toca un cauce para ver su detalle.',
          tipos: [], fuentes: ['IGAC, drenajes 1:100.000', 'OpenStreetMap'] };
      case 'nombres-rios': {
        const n = this.riosConNombre().length;
        return { nombre: 'Nombres de ríos', glifo: '🏷️', color: '#2c88c8', activa: this.nombresRios(), total: n || null, unidad: n === 1 ? 'río o quebrada' : 'ríos y quebradas',
          texto: 'Pone el nombre sobre cada río y quebrada con nombre registrado; al acercarte aparecen los más pequeños. Los nombres deducidos de la red no se rotulan.',
          tipos: [], fuentes: ['IGAC, drenajes 1:100.000', 'OpenStreetMap'] };
      }
      case 'sub':
        return { nombre: 'Subterráneo', glifo: '🕳️', color: '#a1887f', activa: this.subterraneo() || this.cargandoRedesAgua(),
          total: this.elementosAgua.length || null, unidad: 'tramos y puntos',
          texto: 'Vuelve el terreno transparente para ver las redes de acueducto y alcantarillado bajo el suelo.',
          tipos: contar(this.elementosAgua.map(e => e.detalle.split(' · ')[0])), fuentes: ['Redes de acueducto y alcantarillado de EPM'] };
      case 'barrios':
        return { nombre: 'Barrios', glifo: '🏘️', color: '#ce93d8', activa: this.barriosVisibles() || this.cargandoBarrios(),
          total: this.nBarrios || null, unidad: 'barrios',
          texto: 'Límites de los barrios del casco urbano, con su nombre.',
          tipos: [], fuentes: ['Catastro AMVA (límites)', 'PBOT de Girardota 2020 (nombres)'] };
      case 'trafico': {
        const p = this.datosFlujo?.proy;
        const medio = p?.escenarios['medio'];
        return { nombre: 'Tráfico estimado', glifo: '🚗', color: '#ef6c00', activa: this.flujoVisible() || this.cargandoFlujo(),
          total: this.flujoPeaje() || null, unidad: 'veh/día en el peaje',
          texto: p && medio
            ? `Vehículos por día en cada vía (sin motos), con un modelo calibrado con el conteo del peaje El Trapiche en ${p.base.anio}. `
              + `El peaje crece ${(p.modelo.crec_tendencia * 100).toFixed(1)} % al año; en el escenario medio llegaría a `
              + `${(Math.round(medio['2030'].tpd / 100) * 100).toLocaleString('en-US')} veh/día en 2030 y `
            + `${(Math.round(medio['2035'].tpd / 100) * 100).toLocaleString('en-US')} en 2035.`
            : 'Vehículos por día en cada vía (sin motos), con un modelo calibrado con el conteo del peaje El Trapiche.',
          tipos: this.datosFlujo ? contar(this.datosFlujo.red.tramos.map(t => `confianza ${t.conf}`)) : [],
          fuentes: ['ANI · peaje El Trapiche', 'Catastro AMVA', 'DANE · proyección 2025', 'Modelo RECUAPP'] };
      }
      default:
        return { nombre: 'Redes', glifo: '🔌', color: '#4db6ac', activa: this.redesVisibles(),
          total: this.elementosEnergia.length || null, unidad: 'elementos',
          texto: 'Líneas de alta tensión, subestaciones y plantas visibles sobre el terreno.',
          tipos: contar(this.elementosEnergia.map(e => e.detalle.split(' · ')[0])), fuentes: ['OpenStreetMap'] };
    }
  }
  private auraIndustrias: Aura | null = null;
  private agrupadorIconos: ReturnType<typeof crearAgrupador> | null = null;
  private equipHover = -1;
  private rotuloEquip: HTMLElement | null = null;
  private tFabricaHover = 0;
  private tEquipHover = 0;
  private anilloHover: THREE.Mesh | null = null;
  private rotuloFabrica: HTMLElement | null = null;
  readonly fabricaSeleccion = signal<FichaFabrica | null>(null);
  private humos: Humo[] = [];
  private miraTmp = new THREE.Vector3();
  /** Objetos de trabajo de los animadores de gente y tráfico: se reutilizan en cada cuadro para no generar basura. */
  private readonly tmpGente = {
    m4: new THREE.Matrix4(), q: new THREE.Quaternion(), pos: new THREE.Vector3(), escala: new THREE.Vector3(),
    arriba: new THREE.Vector3(0, 1, 0), adelante: new THREE.Vector3(0, 0, 1), derecha: new THREE.Vector3(1, 0, 0),
    tinte: new THREE.Color(), ladeo: new THREE.Quaternion(),
  };
  private readonly cuentaGente: number[] = [];
  private readonly tmpTrafico = {
    m4: new THREE.Matrix4(), q: new THREE.Quaternion(), qz: new THREE.Quaternion(),
    arriba: new THREE.Vector3(0, 1, 0), lateral: new THREE.Vector3(0, 0, 1), pos: new THREE.Vector3(), escala: new THREE.Vector3(1, 1, 1),
  };
  private firmaRotulos: (number | string | null)[] = [];
  private cuadrosRotulos = 0;
  private medidasRotulos: ({ w: number; h: number } | undefined)[] = [];
  /** Cápsulas de zona visibles en pantalla, de mayor a menor prioridad: tapan lo que tengan detrás al pasar o hacer clic. */
  private cajasRotulos: { id: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  /** todas las bocanadas de humo de las chimeneas: una sola llamada de dibujo en vez de una por bocanada */
  private humoInst?: { malla: THREE.Mesh; pos: Float32Array; esc: Float32Array; rot: Float32Array; col: Float32Array; op: Float32Array; atributos: THREE.InstancedBufferAttribute[]; rotAcum: Float32Array };
  private geoIndustrias: THREE.BufferGeometry | null = null;
  private matIndustrias: THREE.Material | null = null;
  private aristas: Arista[] = [];
  private nodos = new Map<string, number[]>();
  private autosRed: AutoRed[] = [];
  /** por tipo de FLOTA: las mallas instanciadas de sus piezas (comparten las matrices) */
  private flota: THREE.InstancedMesh[][] = [];
  /** por tipo de FLOTA: las aristas de la red del pueblo por donde puede circular */
  private viasPermitidas: number[][] = [];
  private geoAutos: THREE.BufferGeometry[] = [];
  private matAutos: THREE.Material[] = [];
  private gente: Peaton[] = [];
  /** por tipo de GENTE: su malla instanciada (solo con las personas que caen dentro del radio de vista) */
  private mallasGente: (THREE.InstancedMesh | null)[] = [];
  private geoGente: THREE.BufferGeometry[] = [];
  private matGente: THREE.Material | null = null;
  private gentePintada = false;
  private traficoVisible = true;
  private pajaros: Pajaro[] = [];
  private avion: Avion | null = null;
  private tiempoAvion = 0;
  private brilloLuz: THREE.Texture | null = null;
  private estela: PuffEstela[] = [];
  private estelaSiguiente = 0;
  private readonly estelaUltima = new THREE.Vector3();
  private nubeAvion: { x: number; y: number; z: number; sprites: THREE.Sprite[] } | null = null;
  private bocas: { x: number; z: number; dx: number; dz: number }[] = [];
  private confluencias: { espuma: THREE.Mesh; fase: number; largo: number }[] = [];
  private texturasConfluencia: THREE.Texture[] = [];
  private materialesConfluencia: THREE.Material[] = [];
  private rutaPajaros: { x: number; z: number } | null = null;
  private tiempoPajaros = 0;
  private geosPajaros: THREE.BufferGeometry[] = [];
  private materialesPajaros: THREE.Material[] = [];
  private readonly vientoVista = new THREE.Vector3();
  private readonly posLuz = new THREE.Vector3();
  private disco: THREE.Sprite | null = null;
  private texturasNubes: THREE.Texture[] = [];
  /** por nube: x, z de su sombra sobre el terreno, radio y opacidad (el shader del terreno los lee) */
  private readonly sombrasNubes = Array.from({ length: NUBES }, () => new THREE.Vector4(0, 0, 1, 0));
  private mallasEdificios: THREE.Mesh[] = [];
  private mallasFachadas: { malla: THREE.Mesh; centro: THREE.Vector3 }[] = [];
  private trabajoFachadas = 0;
  private texCercas?: THREE.CanvasTexture;
  private matCercas?: THREE.MeshStandardMaterial;
  private mallasCercas: { malla: THREE.Mesh; centro: THREE.Vector3; alcance: number }[] = [];
  private matTejado?: THREE.MeshStandardMaterial;
  private atlasFachadas?: THREE.CanvasTexture;
  private matFachadas?: THREE.MeshStandardMaterial;
  /** árboles del casco urbano (de jardín y de calle) que se suman a la vegetación general */
  private arbolesUrbanos: { lon: number; lat: number; x: number; z: number }[] = [];
  /** Cajas de las viviendas por tesela y círculos de los equipamientos: la cámara no los atraviesa. */
  private cajasViv = new Map<number, { x0: number; x1: number; z0: number; z1: number; top: number; id: number; poli: number[] }[]>();
  private tanques: Tanque[] = [];
  private cajasEquip: { x: number; z: number; r: number; top: number; id: number }[] = [];
  // edificios dibujados según la población del año elegido
  private edificiosBase: Compacto | null = null;
  private readonly celdasUrbanas = new Map<number, number>();
  private poblacion: PoblacionVeredas | null = null;
  /** proyección por sexo y edad de la cabecera y cada vereda (2018–2050) */
  private edad: PoblacionEdad | null = null;
  /** año que se está viendo con el deslizador, antes de soltarlo (el mapa se redibuja al soltar) */
  readonly anioVista = signal<number | null>(null);
  private zonasPlan: ZonasPlan | null = null;
  private capasEdificios: Capa[] = [];
  /** vereda (índice) → población y viviendas del año elegido */
  private datosPorVereda = new Map<number, { pob: number; viv: number }>();
  /** un grupo por tesela: con detalle completo y con la versión simple que se usa de lejos */
  private teselasArboles: { cerca: THREE.InstancedMesh; lejos: THREE.InstancedMesh; centro: THREE.Vector3; bloque?: BloqueArboles }[] = [];
  /** bloques de 3 × 3 km con la versión simple de todas sus teselas en una malla: se usan cuando ninguna está cerca */
  private bloquesArboles: BloqueArboles[] = [];
  private texturaRio: THREE.CanvasTexture | null = null;
  private readonly rios = new Map<string, Rio>();
  private aguaPos: THREE.BufferAttribute | null = null;
  private haloHover: THREE.Mesh | null = null;
  private haloElegido: THREE.Mesh | null = null;
  private haloSistema: THREE.Mesh | null = null;
  private halosLagos: THREE.Mesh[] = [];
  /** Capa de la leyenda que deja resaltados (como seleccionados) todos los ríos y quebradas a la vez. */
  readonly sistemaHidrico = signal(false);
  alternarSistemaHidrico(): void {
    this.sistemaHidrico.update(v => !v);
    this.pintarHalos();
    for (const h of this.halosLagos) h.visible = this.sistemaHidrico();
  }
  /** Capa de la leyenda que rotula con su nombre cada río y quebrada (los deducidos de la red no llevan). */
  readonly nombresRios = signal(false);
  alternarNombresRios(): void { this.nombresRios.update(v => !v); }
  private rotulosRios = new Map<string, HTMLElement>();
  private medidasRios = new Map<string, { w: number; h: number }>();
  private riosConNombre(): Rio[] {
    return [...this.rios.values()].filter(r => !r.derivado && r.nombre !== 'Cauce sin nombre registrado').sort((a, b) => b.largo - a.largo);
  }
  /** Tooltip junto al cursor con lo recolectado del cauce que se señala (null: ninguno). */
  readonly tipRio = signal<{ x: number; y: number; izq: boolean; arriba: boolean; nombre: string; tipo: string;
    filas: { k: string; v: string }[]; nota: string } | null>(null);
  private veredasDeRio = new Map<string, string[]>();
  private rioHover: string | null = null;
  private rioElegido: string | null = null;
  private rotuloRio: HTMLElement | null = null;
  private pantallaCauces = new Float32Array(0);
  readonly rioSeleccion = signal<{ nombre: string; detalle: string } | null>(null);
  /** levantamiento actual de cada vereda para la GPU (los árboles lo leen como uniform) */
  private readonly alzadoGpu = new Float32Array(32);
  private giroPendiente = 0;
  private inclinacionPendiente = 0;
  private zoomPendiente = 0;
  private vistaInicial = { pos: new THREE.Vector3(), objetivo: new THREE.Vector3() };

  ngAfterViewInit(): void {
    // la primera visita abre el tutorial (mientras el territorio termina de cargar); después queda en el ícono de ayuda
    let visto = false;
    try { visto = localStorage.getItem('mapa3d-tutorial-visto') === '1'; } catch { /* sin almacenamiento */ }
    if (!visto) { this.tutorialVisto.set(false); setTimeout(() => this.abrirTutorial(), 600); }

    // La leyenda superior puede ocupar una o varias filas: los paneles se ubican debajo de su altura real.
    const obsLey = new ResizeObserver(() =>
      this.host.nativeElement.style.setProperty('--alto-ley', `${this.barraLey.nativeElement.offsetHeight}px`));
    obsLey.observe(this.barraLey.nativeElement);
    this.destroyRef.onDestroy(() => obsLey.disconnect());

    // Si se pide otra sección (menú lateral, enlaces) mientras se vuela, se conduce o se elige el punto de salida, el vehículo se
    // baja solo: antes el candado de la página devolvía el scroll a donde estaba y no dejaba salir del mapa.
    const subNav = this.enrutador.events.subscribe(e => {
      if (!(e instanceof NavigationStart)) return;
      if (this.conduciendo()) this.salirDeConducir();
      if (this.eligiendoSalida()) this.cancelarSalida();
    });
    this.destroyRef.onDestroy(() => subNav.unsubscribe());

    const fuentes = {
      relieve: this.http.get<Relieve>(`data/mapa3d/relieve-${ID_MUNICIPIO}.json`),
      muni: this.mapa.municipios$,
      terr: this.mapa.territorio(ID_MUNICIPIO),
      foto: this.cargarImagen(`data/mapa3d/ortofoto-${ID_MUNICIPIO}.jpg`),
      vias: this.http.get<Compacto>(`data/mapa3d/vias-${ID_MUNICIPIO}.json`).pipe(catchError(() => of(null))),
      viasEstado: this.http.get<Compacto>(`data/mapa3d/vias-estado-${ID_MUNICIPIO}.json`).pipe(catchError(() => of(null))),
      // el catastro asentado trae las casas alineadas con su calle y el piso al nivel de la acera; si falta, el crudo
      edificios: this.http.get<Compacto>(`data/mapa3d/catastro-asentado-${ID_MUNICIPIO}.json`).pipe(
        catchError(() => this.http.get<Compacto>(`data/mapa3d/catastro-${ID_MUNICIPIO}.json`)), catchError(() => of(null))),
      rasante: this.http.get<DatosRasante>(`data/mapa3d/rasante-${ID_MUNICIPIO}.json`).pipe(catchError(() => of(null))),
      cauces: this.http.get<Cauces>(`data/mapa3d/cauces-${ID_MUNICIPIO}.json`).pipe(catchError(() => of(null))),
      industrias: this.http.get<Industria[]>(`data/mapa3d/industrias-${ID_MUNICIPIO}.json`).pipe(catchError(() => of([] as Industria[]))),
      poblacion: this.http.get<PoblacionVeredas>(`data/mapa/poblacion/veredas-${CODIGO_DANE}.geojson`).pipe(catchError(() => of(null))),
      edad: this.http.get<PoblacionEdad>(`data/poblacion/${CODIGO_DANE}-edad.json`).pipe(catchError(() => of(null))),
      puntos: this.mapa.puntos(ID_MUNICIPIO),
      zonasPlan: this.http.get<ZonasPlan>(`data/plan/${CODIGO_DANE}-zonas.json`).pipe(catchError(() => of(null))),
      jardines: this.http.get<Jardines>(`data/mapa3d/jardines-${ID_MUNICIPIO}.json`).pipe(catchError(() => of(null))),
      cercas: this.http.get<Cercas>(`data/mapa3d/cercas-${ID_MUNICIPIO}.json`).pipe(catchError(() => of(null))),
      industriasCat: this.http.get<Record<string, AjusteIndustria>>(`data/mapa3d/industrias-catastro-${ID_MUNICIPIO}.json`).pipe(catchError(() => of({} as Record<string, AjusteIndustria>))),
      infra: this.http.get<Infraestructura | null>(`data/mapa3d/infraestructura-${ID_MUNICIPIO}.json`).pipe(catchError(() => of(null))),
      instalaciones: this.http.get<InstalacionAgua[]>(`data/mapa3d/instalaciones-agua-${ID_MUNICIPIO}.json`).pipe(catchError(() => of([] as InstalacionAgua[]))),
      tanques: this.http.get<Tanque[]>(`data/mapa3d/tanques-${ID_MUNICIPIO}.json`).pipe(catchError(() => of([] as Tanque[]))),
      ajustes: this.http.get<Record<string, AjusteCatastro>>(`data/mapa3d/equipamientos-catastro-${ID_MUNICIPIO}.json`).pipe(catchError(() => of({} as Record<string, AjusteCatastro>))),
    };
    // cada fuente que termina de descargarse suma al avance (los datos pesan hasta el 30 %)
    let descargadas = 0;
    const total = Object.keys(fuentes).length;
    const contadas = Object.fromEntries(Object.entries(fuentes).map(([k, o]) =>
      [k, (o as Observable<unknown>).pipe(tap({ complete: () => this.avanzar(++descargadas / total * 30) }))])) as unknown as typeof fuentes;
    forkJoin(contadas).subscribe({
      next: async ({ relieve, muni, terr, foto, vias, viasEstado, edificios, rasante, cauces, poblacion, edad, industrias, puntos, zonasPlan, jardines, cercas, ajustes, industriasCat, tanques, infra, instalaciones }) => {
        try {
          this.foto = foto;
          this.zonasPlan = zonasPlan;
          this.avanzar(32);
          this.construir(relieve, muni.municipios, terr.v);
          this.avanzar(42);
          if (await this.ceder()) return;
          this.rasante = rasante?.v?.length ? new Rasante(rasante, lon => this.aX(lon), lat => this.aZ(lat), EXAGERACION) : null;
          this.fabricas = this.ubicarIndustrias(industrias, vias, industriasCat);
          this.equipamientos = await this.ubicarEquipamientos(puntos, vias, ajustes);
          if (this.destruido) return;
          this.nivelarPlazas();
          this.avanzar(48);
          if (await this.ceder()) return;
          if (vias?.v) { await this.construirVias(vias); if (this.destruido) return; this.holguraConduccion = this.medirVias(vias); }
          this.avanzar(56);
          if (await this.ceder()) return;
          if (USAR_ESTADO_VIAL && viasEstado?.v) { await this.construirViasEstado(viasEstado); if (this.destruido) return; }
          if (cauces?.c) this.construirCauces(cauces);
          this.avanzar(62);
          if (await this.ceder()) return;
          if (vias?.v && cauces?.c) this.construirPuentes(vias, cauces);
          if (cauces?.c) this.construirPajaros(cauces);
          if (vias?.v) this.construirTrafico(vias);
          this.avanzar(68);
          if (await this.ceder()) return;
          this.construirIndustrias();
          this.construirEquipamientos();
          this.avanzar(72);
          if (await this.ceder()) return;
          this.tanques = tanques;
          this.construirTanques();
          this.construirInfraestructura(infra);
          this.construirInstalacionesAgua(instalaciones);
          this.construirPinesServicios();
          this.avanzar(76);
          if (await this.ceder()) return;
          this.edificiosBase = await this.sinIndustrias(edificios, vias);
          if (this.destruido) return;
          this.avanzar(80);
          this.poblacion = poblacion;
          this.edad = edad;
          this.hayPoblacion.set(!!(edificios?.e && poblacion));
          const dibujados = this.edificiosParaAnio(this.anio());
          if (dibujados?.e) await this.construirEdificiosEnTandas(dibujados);
          this.avanzar(90);
          if (await this.ceder()) return;
          await this.construirJardines(jardines);
          if (this.destruido) return;
          this.construirCercas(cercas);
          this.avanzar(94);
          if (await this.ceder()) return;
          const deJardin = await this.arbolesDeJardin(jardines);
          const deCalle = await this.arbolesDeCalle(vias);
          if (this.destruido) return;
          this.arbolesUrbanos = [...deJardin, ...deCalle];
          this.avanzar(98);
          if (await this.ceder()) return;
          this.construirVegetacion(vias, dibujados, cauces);
          this.avanzar(100);
          this.construido = true;
          this.abrirPuntoDeLaRuta();
          // dentro del recorrido la vista ya existe al volver del mapa 2D: el punto llega como un cambio de la dirección
          let primera = true;
          const sub = this.ruta.queryParamMap.subscribe(q => {
            if (primera) { primera = false; return; }
            if (q.get('punto')) this.abrirPuntoDeLaRuta();
          });
          this.destroyRef.onDestroy(() => sub.unsubscribe());
        } catch (e) {
          console.error(e);
          this.error.set('No se pudo iniciar la vista 3D en este navegador.');
        }
        this.cargando.set(false);
      },
      error: () => { this.error.set('No se pudieron cargar los datos del territorio.'); this.cargando.set(false); },
    });
    this.destroyRef.onDestroy(() => { this.destruido = true; this.soltarPagina?.(); this.liberar(); });
  }

  /** la escena ya está completa: hasta entonces el bucle de dibujo no pinta (se construye por tandas) */
  private construido = false;
  private destruido = false;

  /**
   * Cede el hilo entre tandas de la construcción: levantar todo el territorio de una vez congelaba la página entera
   * (ni el desplazamiento ni el tutorial respondían). Devuelve true si la vista se destruyó mientras tanto.
   */
  private async ceder(): Promise<boolean> {
    await new Promise<void>(r => setTimeout(r, 0));
    return this.destruido;
  }

  /** Imagen de fondo del terreno; si falta, el terreno queda en un color liso. */
  private cargarImagen(url: string): Observable<HTMLImageElement | null> {
    return new Observable(obs => {
      const img = new Image();
      img.onload = () => { obs.next(img); obs.complete(); };
      img.onerror = () => { obs.next(null); obs.complete(); };
      img.src = url;
    });
  }

  /** Cierra la industria, el río o la red seleccionados (sus fichas tienen el mismo botón de cerrar). */
  cerrarSeleccion(): void {
    this.seleccionarFabrica(-1, false);
    this.seleccionarRio(null, false);
    this.soltarRed();
  }

  // ───────────────────────── tutorial ─────────────────────────
  /** Niveles del tutorial: qué se puede hacer en el mapa y con qué teclas o gestos. */
  readonly pasosTutorial: readonly { emblema: string; color: string; titulo: string; texto: string; controles: { teclas: string[]; accion: string }[] }[] = [
    { emblema: '🗺️', color: '#4F9A35', titulo: 'Bienvenido a Girardota en 3D',
      texto: 'Tu misión: recorrer el municipio y descubrir sus veredas, su gente, sus lugares y lo que el plan de desarrollo promete en cada una.',
      controles: [{ teclas: ['?'], accion: 'Vuelve a este tutorial cuando quieras con el botón de ayuda' }] },
    { emblema: '🖱️', color: '#2C88C8', titulo: 'Muévete por el mapa',
      texto: 'El mapa responde como un juego de estrategia: arrastra, acerca y gira la cámara hasta encontrar el mejor ángulo.',
      controles: [
        { teclas: ['Arrastrar'], accion: 'Desplazarte por el territorio' },
        { teclas: ['W A S D', '↑ ← ↓ →'], accion: 'Desplazarte con el teclado (Shift para ir más rápido)' },
        { teclas: ['Rueda'], accion: 'Acercar y alejar' },
        { teclas: ['Rueda presionada'], accion: 'Girar e inclinar la cámara' },
        { teclas: ['Clic derecho'], accion: 'Inclinar la vista' },
      ] },
    { emblema: '🏞️', color: '#C0841A', titulo: 'Explora las veredas',
      texto: 'Cada vereda guarda su población, su infraestructura y los proyectos del plan que la nombran.',
      controles: [
        { teclas: ['Cursor encima'], accion: 'Resaltar una vereda o un río' },
        { teclas: ['Clic'], accion: 'Abrir su ficha en la franja de abajo' },
        { teclas: ['Doble clic'], accion: 'Aislar la zona y desvanecer el resto' },
      ] },
    { emblema: '🧭', color: '#8E5BB5', titulo: 'Enciende capas',
      texto: 'La barra de íconos de arriba es tu inventario: colegios, salud, parques, ríos, servicios públicos, barrios y redes.',
      controles: [
        { teclas: ['Cursor encima'], accion: 'Ver el nombre de la capa' },
        { teclas: ['Clic'], accion: 'Mostrarla u ocultarla en el mapa' },
        { teclas: ['Clic en un pin'], accion: 'Abrir la ficha de ese lugar' },
      ] },
    { emblema: '🚗', color: '#D84F3F', titulo: 'Modos especiales',
      texto: 'Abajo a la derecha están tus herramientas: toma fotos limpias del paisaje o maneja un carro por las vías del municipio.',
      controles: [
        { teclas: ['📷'], accion: 'Modo foto: oculta rótulos e íconos' },
        { teclas: ['🚗'], accion: 'Conducir: haz clic donde quieras empezar; W A S D o flechas, Shift turbo, Espacio freno, arrastra para mirar, C o 5 recentra la cámara, R reaparecer, Esc salir' },
        { teclas: ['⌂'], accion: 'Vista general: volver a ver todo el municipio' },
      ] },
  ];
  readonly tutorialAbierto = signal(false);
  readonly pasoTutorial = signal(0);
  readonly tutorialVisto = signal(true);
  @ViewChild('cartaTuto') private cartaTuto?: ElementRef<HTMLElement>;

  abrirTutorial(): void {
    this.pasoTutorial.set(0);
    this.tutorialAbierto.set(true);
    setTimeout(() => this.cartaTuto?.nativeElement.focus());
  }
  cerrarTutorial(): void {
    this.tutorialAbierto.set(false);
    this.tutorialVisto.set(true);
    try { localStorage.setItem('mapa3d-tutorial-visto', '1'); } catch { /* sin almacenamiento: se volverá a ofrecer */ }
  }
  moverTutorial(d: number): void {
    this.pasoTutorial.update(p => Math.min(this.pasosTutorial.length - 1, Math.max(0, p + d)));
  }
  teclaTutorial(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') { this.cerrarTutorial(); ev.stopPropagation(); }
    else if (ev.key === 'ArrowRight') this.moverTutorial(1);
    else if (ev.key === 'ArrowLeft') this.moverTutorial(-1);
  }

  tipoDe(z: Zona): string { return TIPOS_ZONA[z.t ?? 'VE'] ?? 'Zona'; }

  // ───────────────────────── construcción ─────────────────────────

  private construir(relieve: Relieve, municipios: Municipio[], veredas: Zona[]): void {
    this.relieve = relieve;
    const bin = atob(relieve.dm);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    this.alturas = new Int16Array(bytes.buffer);

    const [o, s, e, n] = relieve.bbox;
    this.lon0 = (o + e) / 2;
    this.lat0 = (s + n) / 2;
    this.mLon = 111320 * Math.cos(this.lat0 * Math.PI / 180);
    this.ancho = (e - o) * this.mLon;
    this.alto = (n - s) * this.mLat;

    const muni = municipios.find(m => m.id === ID_MUNICIPIO)!;
    const tono = coloresPorMunicipio(municipios).get(ID_MUNICIPIO)?.h ?? 140;
    // tonos repartidos por el ángulo áureo: vecinas siempre distintas, y vivos como en un mapa de juego
    this.piezas = veredas.map((z, i) => ({
      zona: z, geometria: decodeGeometria(z.g), color: hex(tono + i * 137.5, 62, 62), rotulo: null,
    }));
    this.alzado = this.piezas.map(() => 0);
    const contorno = decodeGeometria(muni.g);

    this.iniciarRender();
    this.pintarTerreno(contorno);
    this.construirTerreno();
    this.construirBorde(contorno, tono);
    this.construirLuces();
    this.construirNubes();
    this.construirNiebla();
    this.construirAvion();
    this.posicionarCamara();
    this.crearRotulos();
    this.arrancar();
  }

  private iniciarRender(): void {
    const el = this.lienzo.nativeElement;
    this.ratioMax = Math.min(window.devicePixelRatio, 2);
    // con densidad ≥ 1,5 los píxeles ya son tan finos que el suavizado por hardware (MSAA) casi no se nota y
    // multiplica la memoria y el ancho de banda de cada cuadro; solo se pide en pantallas de densidad baja
    this.renderer = new THREE.WebGLRenderer({ antialias: this.ratioMax < 1.5, alpha: true });
    this.renderer.setPixelRatio(this.ratioMax);
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    el.appendChild(this.renderer.domElement);
    if (new URLSearchParams(location.search).has('perf')) this.crearPanelPerf(el);

    this.escena.fog = new THREE.Fog('#dbeaf5', 26000, 56000);

    this.camara = new THREE.PerspectiveCamera(38, el.clientWidth / el.clientHeight, 200, 90000);
    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.08;
    this.controles.maxPolarAngle = Math.PI / 2 - LIMITE_POLAR;
    this.controles.minDistance = 35;   // casi a escala de primera persona; el plano cercano se ajusta en ajustarPlanoCercano()
    this.controles.maxDistance = 32000;
    // como en un mapa: la manito arrastra y desplaza; el clic derecho inclina y gira
    this.controles.screenSpacePanning = false;
    // la rueda presionada se maneja aparte (alMover): gira el mapa en horizontal, sin tope
    this.controles.mouseButtons = { LEFT: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controles.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    // la rueda acerca y aleja con la misma suavidad que los botones +/−
    this.controles.enableZoom = false;
    const rueda = (ev: WheelEvent) => {
      ev.preventDefault();
      // al conducir la rueda acerca o aleja la cámara del carro (no se acumula zoom para cuando se sale)
      if (this.conduciendo()) { this.conduccion?.alejar(Math.exp(ev.deltaY * 0.0012)); return; }
      this.vuelo = null;
      this.zoomPendiente += ev.deltaY * 0.0022;
      this.ultimaActividad = performance.now();
    };
    // fuera de Angular: cada evento del ratón dentro de la zona dispararía una revisión de cambios de toda la vista
    // (un ratón de 1000 Hz manda mil por segundo); el bucle de dibujo los atiende una vez por cuadro
    const mover = (ev: PointerEvent) => this.alMover(ev);
    this.zona.runOutsideAngular(() => {
      this.renderer.domElement.addEventListener('wheel', rueda, { passive: false });
      el.addEventListener('pointermove', mover);
    });
    this.destroyRef.onDestroy(() => {
      this.renderer.domElement.removeEventListener('wheel', rueda);
      el.removeEventListener('pointermove', mover);
    });

    // flechas y W A S D: desplazan el mapa mientras se mantienen pulsadas (el bucle las gasta cuadro a cuadro). Al conducir las
    // maneja el carro, con el tutorial abierto pasan sus tarjetas y en un campo de texto mueven el cursor.
    // W A S D hacen lo mismo que las flechas (como en los juegos)
    const comoFlecha: Record<string, string> = {
      ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
      KeyW: 'ArrowUp', KeyS: 'ArrowDown', KeyA: 'ArrowLeft', KeyD: 'ArrowRight',
    };
    const tecla = (ev: KeyboardEvent) => {
      if (/^Shift/.test(ev.code)) { this.flechaRapida = ev.type === 'keydown'; return; }
      const dir = comoFlecha[ev.code];
      if (!dir) return;
      if (ev.type === 'keyup') { this.flechas.delete(dir); return; }
      const t = ev.target as HTMLElement | null;
      if (ev.ctrlKey || ev.metaKey || ev.altKey || this.conduciendo() || this.tutorialAbierto() || !this.lienzoVisible
        || t?.closest?.('input, textarea, select, [contenteditable]')) return;
      ev.preventDefault();
      this.flechaRapida = ev.shiftKey;
      this.flechas.add(dir);
    };
    const soltarTodo = () => this.flechas.clear();
    this.zona.runOutsideAngular(() => {
      window.addEventListener('keydown', tecla);
      window.addEventListener('keyup', tecla);
      window.addEventListener('blur', soltarTodo);
    });
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('keydown', tecla);
      window.removeEventListener('keyup', tecla);
      window.removeEventListener('blur', soltarTodo);
    });

    const redim = () => {
      if (!el.clientWidth || !el.clientHeight) return;
      this.renderer.setSize(el.clientWidth, el.clientHeight);
      this.camara.aspect = el.clientWidth / el.clientHeight;
      this.camara.updateProjectionMatrix();
    };
    window.addEventListener('resize', redim);
    // el contenedor también cambia sin que cambie la ventana (p. ej. al plegar o abrir el menú lateral)
    const obsCont = new ResizeObserver(redim);
    obsCont.observe(el);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', redim);
      obsCont.disconnect();
    });
  }

  private aX(lon: number): number { return (lon - this.lon0) * this.mLon; }
  private aZ(lat: number): number { return -(lat - this.lat0) * this.mLat; }

  /** Altura (ya exagerada y relativa al punto más bajo) en una posición lon/lat. */
  private alturaEn(lon: number, lat: number): number {
    const { bbox: [o, s, e, n], nx, ny, min } = this.relieve;
    const fx = Math.min(Math.max((lon - o) / (e - o), 0), 1) * (nx - 1);
    const fy = Math.min(Math.max((n - lat) / (n - s), 0), 1) * (ny - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1);
    const tx = fx - x0, ty = fy - y0;
    const h = (x: number, y: number) => this.alturas[y * nx + x] / 10;
    const v = h(x0, y0) * (1 - tx) * (1 - ty) + h(x1, y0) * tx * (1 - ty)
      + h(x0, y1) * (1 - tx) * ty + h(x1, y1) * tx * ty;
    return (v - min) * EXAGERACION;
  }

  /** Traza los anillos de una geometría (lat/lon) sobre un canvas que cubre todo el bbox. */
  private trazar(ctx: CanvasRenderingContext2D, g: Geometria, w: number, h: number): void {
    const [o, s, e, n] = this.relieve.bbox;
    ctx.beginPath();
    for (const poligono of g) {
      for (const anillo of poligono) {
        anillo.forEach(([lat, lon], i) => {
          const x = (lon - o) / (e - o) * w, y = (n - lat) / (n - s) * h;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.closePath();
      }
    }
  }

  private pintarTerreno(contorno: Geometria): void {
    const W = ANCHO_TEXTURA, H = Math.round(W * this.alto / this.ancho);

    // textura del terreno
    const color = document.createElement('canvas');
    color.width = W; color.height = H;
    const c = color.getContext('2d')!;
    // fondo: la imagen satelital de la montaña
    if (this.foto) {
      this.pintarFoto(c, W, H);
    } else {
      c.fillStyle = '#7c9a62';
      c.fillRect(0, 0, W, H);
    }
    // copia sin las zonas dibujadas, para el modo fotografía
    this.lienzoLimpio = document.createElement('canvas');
    this.lienzoLimpio.width = W; this.lienzoLimpio.height = H;
    this.lienzoLimpio.getContext('2d')!.drawImage(color, 0, 0);
    this.lienzoConZonas = color;
    // encima, un velo muy tenue del color de cada vereda y sus límites finos
    c.lineJoin = 'round';
    for (const p of this.piezas) {
      this.trazar(c, p.geometria, W, H);
      c.globalAlpha = VELO_VEREDA;
      c.fillStyle = p.color;
      c.fill('evenodd');
      // límite de la vereda: punteado espaciado (interlineado), translúcido y grueso (12 px)
      c.globalAlpha = CONTORNO_ZONA_OPACIDAD;
      c.lineWidth = CONTORNO_ZONA_GROSOR;
      c.lineCap = 'round';
      // rayitas de mapa del tesoro: con la punta redondeada cada raya mide ~2.4 veces el grosor y deja ~1.6 de hueco
      c.setLineDash([CONTORNO_ZONA_GROSOR * 1.4, CONTORNO_ZONA_GROSOR * 2.6]);
      c.strokeStyle = '#ffffff';
      c.stroke();
      c.setLineDash([]);
    }
    c.globalAlpha = 1;
    c.lineCap = 'butt';
    this.trazar(c, contorno, W, H);
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(255,255,255,.95)';
    c.stroke();

    this.texturaColor = new THREE.CanvasTexture(color);
    this.texturaColor.colorSpace = THREE.SRGBColorSpace;
    this.texturaColor.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    // mapa de identificadores: cada vereda con un rojo distinto, para elegirla con el cursor
    this.lienzoIds = document.createElement('canvas');
    this.lienzoIds.width = W; this.lienzoIds.height = H;
    this.ctxIds = this.lienzoIds.getContext('2d', { willReadFrequently: true })!;
    this.ctxIds.fillStyle = '#000';
    this.ctxIds.fillRect(0, 0, W, H);
    this.piezas.forEach((p, i) => {
      this.trazar(this.ctxIds, p.geometria, W, H);
      this.ctxIds.fillStyle = `rgb(${(i + 1) * SALTO_ID},0,0)`;
      this.ctxIds.fill('evenodd');
    });

    // capa transparente de resalte (se repinta al pasar el cursor)
    this.lienzoResalte = document.createElement('canvas');
    this.lienzoResalte.width = ANCHO_RESALTE;
    this.lienzoResalte.height = Math.round(ANCHO_RESALTE * this.alto / this.ancho);
    this.ctxResalte = this.lienzoResalte.getContext('2d')!;
    this.texturaResalte = new THREE.CanvasTexture(this.lienzoResalte);
    // sin conversión de color: el shader del terreno la mezcla ya codificada, como lo hacía la capa transparente
    this.texturaResalte.colorSpace = THREE.NoColorSpace;
  }

  /** La foto satelital tal cual, solo aclarada para que el terreno se vea más luminoso. */
  private pintarFoto(c: CanvasRenderingContext2D, w: number, h: number): void {
    c.filter = TONO_FOTO;
    c.drawImage(this.foto!, 0, 0, w, h);
    c.filter = 'none';
  }

  private construirTerreno(): void {
    const { nx, ny, bbox: [o, s, e, n] } = this.relieve;
    const malla = (paso: number) => {
      const cx = Math.floor((nx - 1) / paso), cy = Math.floor((ny - 1) / paso);
      const pos = new Float32Array((cx + 1) * (cy + 1) * 3);
      const uv = new Float32Array((cx + 1) * (cy + 1) * 2);
      for (let j = 0; j <= cy; j++) {
        for (let i = 0; i <= cx; i++) {
          const u = Math.min(i * paso, nx - 1) / (nx - 1), v = Math.min(j * paso, ny - 1) / (ny - 1);
          const lon = o + u * (e - o), lat = n - v * (n - s);
          const k = j * (cx + 1) + i;
          pos.set([this.aX(lon), this.alturaEn(lon, lat), this.aZ(lat)], k * 3);
          uv.set([u, 1 - v], k * 2);
        }
      }
      const idx = new Uint32Array(cx * cy * 6);
      let t = 0;
      for (let j = 0; j < cy; j++) {
        for (let i = 0; i < cx; i++) {
          const a = j * (cx + 1) + i, b = a + 1, c = a + cx + 1, d = c + 1;
          idx.set([a, c, b, b, c, d], t);
          t += 6;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      return { g, cx, cy, pos };
    };

    const fino = malla(1);
    this.prepararVertices(fino.g, fino.pos);
    this.capaTerreno = this.capas[this.capas.length - 1];
    this.filasTerreno = fino.cx + 1;
    this.crearTexturaNubes();
    const material = new THREE.MeshStandardMaterial({ map: this.texturaColor, roughness: 1, metalness: 0 });
    // Las caras casi verticales (el corte de una vereda levantada) se pintan de tierra con estratos en vez
    // de la foto estirada. La inclinación sale de las derivadas, así que no depende de normales desactualizadas.
    material.onBeforeCompile = shader => {
      shader.uniforms['uNubesTex'] = { value: this.rtNubes.texture };
      shader.uniforms['uCaja'] = { value: new THREE.Vector4(-this.ancho / 2, -this.alto / 2, this.ancho, this.alto) };
      shader.uniforms['uResalte'] = { value: this.texturaResalte };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vPos;
          uniform sampler2D uResalte;
          uniform sampler2D uNubesTex;
          uniform vec4 uCaja;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float inclinacion = abs(normalize(cross(dFdx(vPos), dFdy(vPos))).y);
          float roca = 1.0 - smoothstep(0.30, 0.55, inclinacion);
          float estrato = 0.5 + 0.5 * sin(vPos.y * 0.11);
          vec3 tierra = mix(vec3(0.40, 0.28, 0.18), vec3(0.60, 0.46, 0.30), estrato);
          diffuseColor.rgb = mix(diffuseColor.rgb, tierra, roca);
          // sombra de las nubes: se calcula aparte en una textura que cubre todo el terreno (ver pintarNubes)
          float despejado = texture2D(uNubesTex, (vPos.xz - uCaja.xy) / uCaja.zw).r;
          diffuseColor.rgb *= mix(vec3(${(1 - SOMBRA_NUBE).toFixed(2)}, ${(1 - SOMBRA_NUBE * 0.8).toFixed(2)}, ${(1 - SOMBRA_NUBE * 0.55).toFixed(2)}), vec3(1.0), despejado);`)
        // resalte de la vereda: se mezcla sin iluminar, ya codificado, y no se pinta sobre las paredes verticales
        // (ahí se vería la textura estirada); antes era una segunda pasada transparente sobre todo el terreno
        .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
          if (inclinacion >= 0.55) {
            vec4 resalte = texture2D(uResalte, vMapUv);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, resalte.rgb, resalte.a);
          }`);
    };
    // La malla completa queda fuera de la escena (de ella se recalculan las normales); lo que se dibuja son teselas
    // de TESELA_TERRENO celdas que comparten sus vértices pero tienen su propio índice, para que la GPU descarte las que no se ven.
    this.terreno = new THREE.Mesh(fino.g, material);
    const { cx, cy, pos } = fino;
    const normal = fino.g.getAttribute('normal'), uv = fino.g.getAttribute('uv'), posicion = fino.g.getAttribute('position');
    const filas = (cx + 1);
    for (let j0 = 0; j0 < cy; j0 += TESELA_TERRENO) {
      for (let i0 = 0; i0 < cx; i0 += TESELA_TERRENO) {
        const i1 = Math.min(i0 + TESELA_TERRENO, cx), j1 = Math.min(j0 + TESELA_TERRENO, cy);
        const idx = new Uint32Array((i1 - i0) * (j1 - j0) * 6);
        let t = 0;
        for (let j = j0; j < j1; j++) {
          for (let i = i0; i < i1; i++) {
            const a = j * filas + i, b = a + 1, c = a + filas, d = c + 1;
            idx.set([a, c, b, b, c, d], t);
            t += 6;
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', posicion);
        g.setAttribute('normal', normal);
        g.setAttribute('uv', uv);
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        // esfera de recorte a partir de la caja de la tesela, con holgura por si una vereda se levanta
        const caja = new THREE.Box3();
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) caja.expandByPoint(new THREE.Vector3(pos[(j * filas + i) * 3], pos[(j * filas + i) * 3 + 1], pos[(j * filas + i) * 3 + 2]));
        }
        g.boundingSphere = caja.getBoundingSphere(new THREE.Sphere());
        g.boundingSphere.radius += ALZA_ELEGIDA + 30;
        const malla = new THREE.Mesh(g, material);
        malla.receiveShadow = true;
        this.escena.add(malla);
        this.teselas.push({ malla, i0, i1, j0, j1 });
      }
    }

    // La sombra del relieve la proyecta una malla a la mitad de resolución (4 veces menos triángulos), un poco
    // más baja para que no sombree la superficie fina. Solo está visible mientras se repinta el mapa de sombras.
    this.sombraTerreno = new THREE.Mesh(malla(2).g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    this.sombraTerreno.position.y = -2;
    this.sombraTerreno.castShadow = true;
    this.sombraTerreno.frustumCulled = false;
    this.sombraTerreno.visible = false;
    this.escena.add(this.sombraTerreno);

    // malla gruesa fuera de la escena: sirve para elegir con el cursor sin recorrer 600 mil triángulos
    this.proxy = new THREE.Mesh(malla(8).g);

    this.construirFaldon(fino.pos, fino.cx, fino.cy);
  }

  /** Registra el croquis de identificadores y agrupa los vértices del terreno por vereda. */
  private prepararVertices(g: THREE.BufferGeometry, pos: Float32Array): void {
    const n = pos.length / 3;
    const W = this.lienzoIds.width, H = this.lienzoIds.height;
    const datos = this.ctxIds.getImageData(0, 0, W, H).data;
    this.mapaIds = new Uint8Array(W * H);
    for (let q = 0; q < W * H; q++) {
      const r = datos[q * 4];
      if (r && !datos[q * 4 + 1] && !datos[q * 4 + 2] && !(r % SALTO_ID)) this.mapaIds[q] = r / SALTO_ID;
    }
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const ids = new Array<number>(n), pesos = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = Math.min(W - 1, Math.round(uv.getX(k) * (W - 1)));
      const y = Math.min(H - 1, Math.round((1 - uv.getY(k)) * (H - 1)));
      ids[k] = this.mapaIds[y * W + x] - 1;
      if (ids[k] >= 0) pesos[k] = this.pesoBorde(this.lon0 + pos[k * 3] / this.mLon, this.lat0 - pos[k * 3 + 2] / this.mLat, ids[k]);
    }
    this.registrarCapa(g.getAttribute('position') as THREE.BufferAttribute, ids, pesos);
  }

  /**
   * Cuánto sube un punto cuando su vereda se levanta: 0 en el límite y 1 a RAMPA_BORDE metros adentro,
   * con una curva suave. Así el borde queda como una ladera y no como un acantilado que estira la textura.
   */
  private pesoBorde(lon: number, lat: number, id: number): number {
    for (let r = 20; r <= RAMPA_BORDE; r += 20) {
      const dLon = r / this.mLon, dLat = r / this.mLat;
      for (const [cx, cy] of DIRECCIONES) {
        if (this.idEn(lon + cx * dLon, lat + cy * dLat) !== id) {
          const t = (r - 20) / RAMPA_BORDE;
          return t * t * (3 - 2 * t);
        }
      }
    }
    return 1;
  }

  /** Vereda (índice) en una posición lon/lat, o -1. */
  private idEn(lon: number, lat: number): number {
    const [o, s, e, n] = this.relieve.bbox;
    const W = this.lienzoIds.width, H = this.lienzoIds.height;
    const x = Math.floor((lon - o) / (e - o) * W), y = Math.floor((n - lat) / (n - s) * H);
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    return this.mapaIds[y * W + x] - 1;
  }

  private registrarCapa(atributo: THREE.BufferAttribute, ids: ArrayLike<number>, pesos: ArrayLike<number>): void {
    const porPieza: number[][] = this.piezas.map(() => []);
    const base = new Float32Array(atributo.count), peso = new Float32Array(atributo.count);
    for (let k = 0; k < atributo.count; k++) {
      base[k] = atributo.getY(k);
      peso[k] = pesos[k];
      const id = ids[k];
      if (id >= 0 && id < porPieza.length && peso[k] > 0) porPieza[id].push(k);
    }
    this.capas.push({ atributo, base, porPieza, peso });
  }

  /** Pasa [x0, y0, dx, dy, ...] (desde la posición `desde`) a pares [lon, lat]. */
  private desdeDeltas(a: number[], k: number, desde: number): [number, number][] {
    const out: [number, number][] = [];
    let x = a[desde], y = a[desde + 1];
    out.push([x / k, y / k]);
    for (let i = desde + 2; i < a.length; i += 2) {
      x += a[i];
      y += a[i + 1];
      out.push([x / k, y / k]);
    }
    return out;
  }

  private nuevoGrupo(): GrupoCinta {
    return { pos: [], idx: [], ids: [], uv: [], pesos: [] };
  }

  /**
   * Agrega al grupo una cinta de `ancho` metros (el ancho total) pegada al relieve a lo largo de la línea
   * [lon, lat]. `periodo` es el largo de un ciclo de la textura a lo largo de la cinta.
   */
  private agregarCinta(g: GrupoCinta, linea: [number, number][], ancho: number, periodo: number, sobreRasante = false): void {
    // las líneas que cruzan el borde del terreno se recortan: fuera de él quedarían flotando
    const [bo, bs, be, bn] = this.relieve.bbox;
    const crudo = linea.filter(q => q[0] >= bo && q[0] <= be && q[1] >= bs && q[1] <= bn);
    if (crudo.length < 2) return;
    // se densifica (un punto cada ~30 m) para que la cinta siga el relieve
    const pts: [number, number][] = [crudo[0]];
    for (let i = 1; i < crudo.length; i++) {
      const a = crudo[i - 1], b = crudo[i];
      const pasos = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * this.mLon, (b[1] - a[1]) * this.mLat) / 30));
      for (let t = 1; t <= pasos; t++) pts.push([a[0] + (b[0] - a[0]) * t / pasos, a[1] + (b[1] - a[1]) * t / pasos]);
    }
    const mitad = ancho / 2;
    const xs = pts.map(q => this.aX(q[0])), zs = pts.map(q => this.aZ(q[1]));
    const ini = g.pos.length / 3;
    let recorrido = 0;
    pts.forEach((q, i) => {
      const a = Math.max(0, i - 1), b = Math.min(pts.length - 1, i + 1);
      let dx = xs[b] - xs[a], dz = zs[b] - zs[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      // en las curvas cerradas el borde se corre hacia afuera (inglete) para que la cinta no se estreche
      let ancho1 = mitad;
      if (i > 0 && i < pts.length - 1) {
        const ex = xs[i] - xs[i - 1], ez = zs[i] - zs[i - 1], el = Math.hypot(ex, ez) || 1;
        ancho1 = mitad / Math.max(0.6, (dx * ex + dz * ez) / el);
      }
      let ya = this.alturaEn(q[0], q[1]) + 3, yb = ya, ma = ancho1, mb = ancho1;
      // encima de una vía de la rasante (estado del pavimento): su mismo ancho y su misma superficie, apenas por encima
      const c = sobreRasante ? this.rasante?.consultar(xs[i], zs[i]) : null;
      if (c && c.d < 3) {
        const mismo = dx * c.tx + dz * c.tz >= 0, eje = this.rasante!.alturaEje(c);
        ma = Math.min(ancho1, mismo ? c.wa : c.wb);
        mb = Math.min(ancho1, mismo ? c.wb : c.wa);
        ya = (this.rasante!.altura(xs[i] - dz * ma, zs[i] + dx * ma) ?? eje) + 0.05;
        yb = (this.rasante!.altura(xs[i] + dz * mb, zs[i] - dx * mb) ?? eje) + 0.05;
      }
      const id = this.idEn(q[0], q[1]);
      g.pos.push(xs[i] - dz * ma, ya, zs[i] + dx * ma, xs[i] + dz * mb, yb, zs[i] - dx * mb);
      g.ids.push(id, id);
      const peso = id >= 0 ? this.pesoBorde(q[0], q[1], id) : 0;
      g.pesos.push(peso, peso);
      if (i) recorrido += Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
      g.uv.push(0, recorrido / periodo, 1, recorrido / periodo);
      if (i) {
        const a0 = ini + (i - 1) * 2;
        g.idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
      }
    });
  }

  /**
   * Calzada y aceras de un tramo de la rasante: la calzada va de borde a borde con su peralte (cada borde a su altura y a su
   * ancho, el que cabe entre las fachadas) y cada acera es una franja aparte, del borde de la calzada (un bordillo más arriba)
   * al borde de la acera, que sube con el terreno hacia la fachada.
   */
  private agregarCintaRasante(calzada: GrupoCinta, acera: GrupoCinta, t: TramoRasante): void {
    const n = t.x.length, periodo = ANCHO_VIA[t.clase] * 1.8, bord = this.rasante!.bordillo;
    const ini = calzada.pos.length / 3, iniA = acera.pos.length / 3;
    // bajo una plaza que va sobre la vía (el peaje) la cinta se corta: la dibuja el pavimento de la plaza, con sus carriles
    // (solo dentro del contorno de su pavimento, que se angosta hacia los extremos: las vías vecinas que pasan al lado se conservan)
    const plazas = this.equipamientos.filter(q => q.datos.modelo.sobreVia && q.datos.modelo.plaza).map(q => {
      const c = q.datos.modelo.plaza!, f = 0.97;                  // 3 % hacia adentro: el borde de la cinta queda bajo el pavimento
      return { x: q.x, z: q.z, yaw: q.yaw ?? 0, xs: c.map(p => p[0] * f), zs: c.map(p => p[1] * f) };
    });
    const bajoPlaza = (x: number, z: number) => plazas.some(q => {
      const dx = x - q.x, dz = z - q.z;
      return puntoEnPoligono(dx * Math.cos(q.yaw) - dz * Math.sin(q.yaw), dx * Math.sin(q.yaw) + dz * Math.cos(q.yaw), q.xs, q.zs);
    });
    const fuera = t.x.map((x, i) => !bajoPlaza(x, t.z[i]));
    let recorrido = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let dx = t.x[b] - t.x[a], dz = t.z[b] - t.z[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      // inglete en las curvas, como en agregarCinta
      let f = 1;
      if (i > 0 && i < n - 1) {
        const ex = t.x[i] - t.x[i - 1], ez = t.z[i] - t.z[i - 1], el = Math.hypot(ex, ez) || 1;
        f = 1 / Math.max(0.6, (dx * ex + dz * ez) / el);
      }
      const id = this.idEn(t.lon[i], t.lat[i]), peso = id >= 0 ? this.pesoBorde(t.lon[i], t.lat[i], id) : 0;
      const nx = -dz * f, nz = dx * f;          // lado a
      const x = t.x[i], z = t.z[i];
      calzada.pos.push(x + nx * t.wa[i], t.ya[i], z + nz * t.wa[i], x - nx * t.wb[i], t.yb[i], z - nz * t.wb[i]);
      calzada.ids.push(id, id);
      calzada.pesos.push(peso, peso);
      if (i) recorrido += Math.hypot(x - t.x[i - 1], z - t.z[i - 1]);
      calzada.uv.push(0, recorrido / periodo, 1, recorrido / periodo);
      // aceras: [interior a, exterior a, interior b, exterior b]
      acera.pos.push(
        x + nx * t.wa[i], t.ya[i] + bord, z + nz * t.wa[i], x + nx * t.aa[i], t.yaa[i], z + nz * t.aa[i],
        x - nx * t.wb[i], t.yb[i] + bord, z - nz * t.wb[i], x - nx * t.ab[i], t.yab[i], z - nz * t.ab[i]);
      for (let k = 0; k < 4; k++) { acera.ids.push(id); acera.pesos.push(peso); acera.uv.push(0.5, 0.5); }
      if (i && (fuera[i] || fuera[i - 1])) {
        const c0 = ini + (i - 1) * 2, a0 = iniA + (i - 1) * 4;
        calzada.idx.push(c0, c0 + 2, c0 + 1, c0 + 1, c0 + 2, c0 + 3);
        acera.idx.push(a0, a0 + 4, a0 + 1, a0 + 1, a0 + 4, a0 + 5, a0 + 2, a0 + 6, a0 + 3, a0 + 3, a0 + 6, a0 + 7);
      }
    }
  }

  /**
   * Plazas que van sobre la vía (el peaje): se nivelan como en la obra. La plaza queda plana a la cota de la calzada en su centro;
   * el terreno bajo su pavimento se rebaja a esa cota y, hasta NIVELA m afuera, empalma suave con el de siempre (si no, el
   * césped de la ladera asoma por encima del pavimento). Las vías que llegan bajan con el mismo empalme para entrar a ras de la
   * plaza. Se cambian el relieve (que usa alturaEn), la malla del terreno y la rasante, antes de dibujar vías y edificios.
   */
  private nivelarPlazas(): void {
    const NIVELA = 40;
    const suave = (d: number) => { const t = Math.min(1, d / NIVELA); return t * t * (3 - 2 * t); };
    let cambio = false;
    for (const q of this.equipamientos) {
      const m = q.datos.modelo;
      if (!m.sobreVia || !m.plaza || !m.losa) continue;
      const yaw = q.yaw ?? 0, co = Math.cos(yaw), si = Math.sin(yaw), ld = m.losa[1];
      const cota = Math.max(...[-ld / 4, -ld / 8, ld / 8, ld / 4].map(b => this.calzadaXZ(q.x + b * si, q.z + b * co))) + 0.05;
      q.cota = cota;
      const xs = m.plaza.map(p => p[0]), zs = m.plaza.map(p => p[1]);
      // distancia (m) de un punto del modelo al pavimento de la plaza: 0 adentro
      const afuera = (x: number, z: number): number => {
        const dx = x - q.x, dz = z - q.z, lx = dx * co - dz * si, lz = dx * si + dz * co;
        if (puntoEnPoligono(lx, lz, xs, zs)) return 0;
        let d = Infinity;
        for (let i = 0; i < xs.length; i++) {
          const j = (i + 1) % xs.length, sx = xs[j] - xs[i], sz = zs[j] - zs[i], ll = sx * sx + sz * sz;
          const t = Math.max(0, Math.min(1, ((lx - xs[i]) * sx + (lz - zs[i]) * sz) / ll));
          d = Math.min(d, Math.hypot(lx - xs[i] - sx * t, lz - zs[i] - sz * t));
        }
        return d;
      };
      const bajar = (y: number, d: number, piso: number) => Math.min(y, piso + (y - piso) * suave(d));
      // relieve y malla del terreno: un vértice de la malla por punto del relieve (k = j·nx + i)
      const { nx, ny, bbox: [o, s, e, n], min } = this.relieve;
      const alcance = m.radio + NIVELA + 30, pos = this.capaTerreno.atributo, base = this.capaTerreno.base;
      const lon0 = this.lon0 + (q.x - alcance) / this.mLon, lon1 = this.lon0 + (q.x + alcance) / this.mLon;
      const lat0 = this.lat0 - (q.z + alcance) / this.mLat, lat1 = this.lat0 - (q.z - alcance) / this.mLat;
      const i0 = Math.max(0, Math.floor((lon0 - o) / (e - o) * (nx - 1))), i1 = Math.min(nx - 1, Math.ceil((lon1 - o) / (e - o) * (nx - 1)));
      const j0 = Math.max(0, Math.floor((n - lat1) / (n - s) * (ny - 1))), j1 = Math.min(ny - 1, Math.ceil((n - lat0) / (n - s) * (ny - 1)));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * nx + i, x = pos.getX(k), z = pos.getZ(k), d = afuera(x, z);
          if (d >= NIVELA) continue;
          const y = pos.getY(k), nuevo = bajar(y, d, cota - 0.35);
          if (nuevo >= y) continue;
          pos.setY(k, nuevo);
          base[k] = nuevo;
          this.alturas[k] = Math.round((nuevo / EXAGERACION + min) * 10);
          cambio = true;
        }
      }
      // vías de la rasante que llegan: mismo empalme, a ras de la plaza
      for (const t of this.rasante?.tramos ?? []) {
        for (let i = 0; i < t.x.length; i++) {
          if (Math.abs(t.x[i] - q.x) > alcance || Math.abs(t.z[i] - q.z) > alcance) continue;
          const d = afuera(t.x[i], t.z[i]);
          if (d >= NIVELA) continue;
          t.ya[i] = bajar(t.ya[i], d, cota + 0.05); t.yb[i] = bajar(t.yb[i], d, cota + 0.05);
          t.yaa[i] = bajar(t.yaa[i], d, cota + 0.2); t.yab[i] = bajar(t.yab[i], d, cota + 0.2);
        }
      }
    }
    if (!cambio) return;
    this.capaTerreno.atributo.needsUpdate = true;
    this.terreno.geometry.computeVertexNormals();
    (this.terreno.geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Altura de la calzada en (x, z) del modelo: la de la rasante si hay una vía ahí, o 3 m sobre el terreno como antes. */
  private calzadaXZ(x: number, z: number): number {
    const c = this.rasante?.consultar(x, z);
    return c && c.d < 3 ? this.rasante!.alturaEje(c) : this.alturaXZ(x, z) + 3;
  }

  /** Malla de un grupo de cintas; `bajar` la hunde unos metros (para bordes) y `orden` decide qué se pinta encima. */
  private crearCinta(g: GrupoCinta, color: string, bajar: number, orden: number, textura?: THREE.Texture, opacidad = 1): THREE.Mesh | null {
    if (!g.pos.length) return null;
    const pos = g.pos.map((val, i) => (i % 3 === 1 ? val - bajar : val));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setIndex(g.idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: textura ? '#ffffff' : color, map: textura ?? null, side: THREE.DoubleSide,
      transparent: opacidad < 1, opacity: opacidad, depthWrite: opacidad >= 1,
      polygonOffset: true, polygonOffsetFactor: -3 - orden, polygonOffsetUnits: -3 - orden,
    }));
    m.renderOrder = orden;
    this.escena.add(m);
    this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, g.ids, g.pesos);
    return m;
  }

  /** Vías como cintas pegadas al relieve: principales con borde oscuro, locales claras, senderos finos. */
  private async construirVias(d: Compacto): Promise<void> {
    let t0 = performance.now();   // por tandas de ~25 ms, para no congelar la página
    const grupos = [this.nuevoGrupo(), this.nuevoGrupo(), this.nuevoGrupo()];
    const ras = this.rasante;
    const aceraP = this.nuevoGrupo(), aceraL = this.nuevoGrupo();
    for (const v of d.v!) {
      if (performance.now() - t0 > 25) { if (await this.ceder()) return; t0 = performance.now(); }
      // con rasante, las principales y locales salen de ella (ancho entre fachadas y altura asentada); los senderos, de siempre
      if (v[0] > 2 || (ras && v[0] < 2)) continue;
      this.agregarCinta(grupos[v[0]], this.desdeDeltas(v, d.k, 1), ANCHO_VIA[v[0]], ANCHO_VIA[v[0]] * 1.8);
    }
    if (ras) for (const t of ras.tramos) {
      if (performance.now() - t0 > 25) { if (await this.ceder()) return; t0 = performance.now(); }
      this.agregarCintaRasante(grupos[t.clase], t.clase === 0 ? aceraP : aceraL, t);
    }
    const [principal, local, sendero] = grupos;
    // remates: un disco de asfalto en cada cruce (une las cintas que llegan con distinto rumbo) y una media luna que cierra
    // cada vía sin salida; el mismo disco, más ancho y debajo, hace de acera
    const nodos = this.nodosViales(ras ? ras.datos : d);
    const asfaltoP = this.nuevoGrupo(), asfaltoL = this.nuevoGrupo();
    for (const n of nodos) {
      if (performance.now() - t0 > 25) { if (await this.ceder()) return; t0 = performance.now(); }
      const [dest, acera] = n.clase === 0 ? [asfaltoP, aceraP] : [asfaltoL, aceraL];
      const a0 = n.cierre === null ? 0 : n.cierre - Math.PI / 2, a1 = n.cierre === null ? Math.PI * 2 : n.cierre + Math.PI / 2;
      const c = ras?.consultar(n.x, n.z);
      if (ras && c) {
        // el cruce toma el ancho de las calles que llegan y se pega a su superficie, no a una cota fija sobre el terreno
        const centro = ras.alturaEje(c), altura = (x: number, z: number) => ras.altura(x, z) ?? centro;
        this.agregarDisco(dest, n.x, n.z, Math.max(c.wa, c.wb) * 1.02, a0, a1, altura);
        this.agregarDisco(acera, n.x, n.z, Math.max(c.aa, c.ab), a0, a1, (x, z) => altura(x, z) - 0.05);
        continue;
      }
      const r = ANCHO_VIA[n.clase] / 2;
      this.agregarDisco(dest, n.x, n.z, r * 1.02, a0, a1);
      this.agregarDisco(acera, n.x, n.z, r * (n.clase === 0 ? 1.3 : 1.35), a0, a1);
    }
    if (ras) {
      // aceras: franjas propias a cada lado, un bordillo por encima de la calzada
      this.crearCinta(aceraP, '#a9aaa8', 0, 0);
      this.crearCinta(aceraL, '#b4b5b2', 0, 0);
    } else {
      // acera / cuneta: la misma cinta, más ancha y apenas por debajo, en gris claro
      this.crearCinta({ ...principal, pos: this.ensanchar(principal.pos, 1.3) }, '#a9aaa8', 1, 0);
      this.crearCinta({ ...local, pos: this.ensanchar(local.pos, 1.35) }, '#b4b5b2', 1, 0);
      this.crearCinta(aceraP, '#a9aaa8', 1, 0);
      this.crearCinta(aceraL, '#b4b5b2', 1, 0);
    }
    // asfalto con sus rayas
    this.crearCinta(principal, '', 0, 1, this.texturaVia('principal'));
    this.crearCinta(local, '', 0, 1, this.texturaVia('local'));
    this.crearCinta(asfaltoP, '#3e4146', 0, 1.5);
    this.crearCinta(asfaltoL, '#55585d', 0, 1.5);
    this.crearCinta(sendero, '#a98f66', 0, 1);
  }

  /**
   * Cruces y extremos de las vías principales y locales: un vértice compartido por dos o más trazos es un cruce (`cierre` nulo,
   * disco completo, con el radio de la vía más ancha) y el extremo de un solo trazo es un fin de vía (`cierre` = rumbo hacia
   * afuera, media luna). Los vértices de una curva, que solo aparecen una vez, no cuentan, ni el punto donde OSM solo corta una vía
   * en dos que siguen derecho (en una caseta de peaje, un puente o un cambio de nombre): ahí no hay cruce y el disco sería una mancha.
   */
  private nodosViales(d: Compacto): { x: number; z: number; clase: number; cierre: number | null }[] {
    const [bo, bs, be, bn] = this.relieve.bbox;
    const acc = new Map<string, { x: number; z: number; clase: number; n: number; cierre: number | null; brazos: number[] }>();
    for (const v of d.v!) {
      if (v[0] > 1) continue;
      const l = this.desdeDeltas(v, d.k, 1);
      if (l.length < 2) continue;
      l.forEach((q, i) => {
        const extremo = i === 0 || i === l.length - 1;
        if (q[0] < bo || q[0] > be || q[1] < bs || q[1] > bn) return;
        const x = this.aX(q[0]), z = this.aZ(q[1]), k = `${Math.round(x / 2)},${Math.round(z / 2)}`;
        let cierre: number | null = null;
        if (extremo) {
          const o = l[i === 0 ? 1 : i - 1];
          cierre = Math.atan2(z - this.aZ(o[1]), x - this.aX(o[0]));
        }
        // rumbo de cada brazo que sale del vértice por esta vía
        const brazos = [i - 1, i + 1].filter(j => j >= 0 && j < l.length).map(j => Math.atan2(this.aZ(l[j][1]) - z, this.aX(l[j][0]) - x));
        const previo = acc.get(k);
        if (previo) {
          previo.n++;
          previo.clase = Math.min(previo.clase, v[0]);
          previo.cierre = null;
          previo.brazos.push(...brazos);
        } else acc.set(k, { x, z, clase: v[0], n: 1, cierre, brazos });
      });
    }
    // dos brazos casi opuestos (±25°): la misma vía que sigue, cortada en dos trazos
    const sigue = (b: number[]) => b.length === 2 && Math.abs(Math.abs(Math.atan2(Math.sin(b[0] - b[1]), Math.cos(b[0] - b[1]))) - Math.PI) < 0.44;
    // un vértice de curva (n = 1 y no es extremo) no es nodo; el extremo suelto sí, como cierre
    return [...acc.values()].filter(a => a.cierre !== null || (a.n > 1 && !sigue(a.brazos)));
  }

  /** Abanico plano pegado al relieve: sector de círculo de `radio` m entre los ángulos `a0` y `a1` (un círculo si abarcan 2π). */
  private agregarDisco(g: GrupoCinta, x: number, z: number, radio: number, a0: number, a1: number, altura?: (x: number, z: number) => number): void {
    const ini = g.pos.length / 3, pasos = Math.max(6, Math.round(24 * (a1 - a0) / (Math.PI * 2)));
    const punto = (px: number, pz: number) => {
      const lon = this.lon0 + px / this.mLon, lat = this.lat0 - pz / this.mLat;
      const id = this.idEn(lon, lat);
      g.pos.push(px, altura ? altura(px, pz) : this.alturaEn(lon, lat) + 3, pz);
      g.ids.push(id);
      g.pesos.push(id >= 0 ? this.pesoBorde(lon, lat, id) : 0);
      g.uv.push(0.5, 0.5);
    };
    punto(x, z);
    for (let i = 0; i <= pasos; i++) {
      const a = a0 + (a1 - a0) * i / pasos;
      punto(x + Math.cos(a) * radio, z + Math.sin(a) * radio);
      if (i) g.idx.push(ini, ini + i, ini + i + 1);
    }
  }

  /**
   * Estado oficial de la superficie: sobre el asfalto de las vías que el IGAC marca como mixtas (afirmado con tramos
   * pavimentados) o sin pavimentar se pinta grava o tierra, con su cuneta. Mismo trazado y ancho que la vía de abajo.
   */
  private async construirViasEstado(d: Compacto): Promise<void> {
    let t0 = performance.now();
    const porEstado = new Map<number, GrupoCinta>();
    for (const v of d.v!) {
      if (performance.now() - t0 > 25) { if (await this.ceder()) return; t0 = performance.now(); }
      const [estado, clase] = v;
      if (!porEstado.has(estado)) porEstado.set(estado, this.nuevoGrupo());
      this.agregarCinta(porEstado.get(estado)!, this.desdeDeltas(v, d.k, 2), ANCHO_VIA[clase], ANCHO_VIA[clase] * 1.8, true);
    }
    const colores: Record<number, string> = { 1: '#a8996f', 2: '#7a5c3a' };      // cuneta: afirmado / tierra
    for (const [estado, g] of porEstado) {
      this.crearCinta({ ...g, pos: this.ensanchar(g.pos, 1.3) }, colores[estado], 0, 2);
      this.crearCinta(g, '', 0, 3, this.texturaViaSinPavimento(estado === 1 ? 'mixta' : 'tierra'));
    }
  }

  /** Grava con parches de asfalto (código IGAC 3306) o tierra con huellas y pasto al centro (3350). */
  private texturaViaSinPavimento(tipo: 'mixta' | 'tierra'): THREE.CanvasTexture {
    const W = 64, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d')!;
    x.fillStyle = tipo === 'mixta' ? '#b8a47e' : '#8a6a45';
    x.fillRect(0, 0, W, H);
    for (let i = 0; i < 320; i++) {        // piedrilla / terrones
      x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},.07)`;
      x.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    x.fillStyle = tipo === 'mixta' ? '#9b8862' : '#6e5233';      // huellas de las llantas
    x.fillRect(W * 0.22, 0, 7, H);
    x.fillRect(W * 0.78 - 7, 0, 7, H);
    if (tipo === 'mixta') {
      x.fillStyle = '#c9b98f';             // grava clara entre los rieles
      x.fillRect(W * 0.38, 0, W * 0.24, H);
      for (const x0 of [4, W - 4 - 22]) {  // placa huella: dos rieles de concreto con juntas y piedra incrustada
        x.fillStyle = '#bdbbb4';
        x.fillRect(x0, 0, 22, H);
        x.fillStyle = '#8f8d86';
        for (let y = 0; y < H; y += 16) x.fillRect(x0, y, 22, 1.5);
        x.fillStyle = '#8a8478';
        for (const [dx, dy] of [[5, 6], [15, 22], [8, 40], [16, 56], [6, 72], [14, 90], [9, 108], [17, 120]]) x.fillRect(x0 + dx, dy, 3, 3);
      }
    } else {
      x.fillStyle = '#6f8f4e';             // pasto entre las huellas
      x.fillRect(W / 2 - 4, 0, 8, H);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  /**
   * Ríos, quebradas y lagos. Cada cauce se dibuja con su ancho: el real que trae OpenStreetMap (Río Medellín, 30 m)
   * o el estimado por la cuenca de drenaje, multiplicado por FACTOR_ANCHO_CAUCE para que se lea a esta escala.
   * Los tramos soterrados van tenues, para que el cauce no parezca cortado donde pasa bajo una calle.
   */
  private construirCauces(d: Cauces): void {
    const agua = this.nuevoGrupo(), soterrado = this.nuevoGrupo();
    let sinNombre = 0;
    const lineasMedellin: [number, number][][] = [];      // trazado (x, z) de los tramos del Medellín
    const afluentes: { p: [number, number]; ancho: number }[] = [];   // extremos de los demás cauces
    const medellin: [number, number][] = [];     // vértices de la cinta de agua que son del Río Medellín
    const entradas: [number[], boolean][] = [
      ...d.c.map(c => [c, false] as [number[], boolean]),
      ...(d.i ?? []).map(c => [c, true] as [number[], boolean]),
    ];
    for (const [c, igac] of entradas) {
      const linea = this.desdeDeltas(c, d.k, 2);
      const visual = Math.max(ANCHO_MIN_CAUCE, c[0] * FACTOR_ANCHO_CAUCE);
      const par0 = agua.pos.length / 6;
      this.agregarCinta(agua, linea, visual, visual * 1.8);
      const pares = agua.pos.length / 6 - par0;
      if (!pares) continue;
      // todos los tramos de un mismo nombre forman un solo río seleccionable
      const texto = c[1] >= 0 ? d.n[c[1]] : c[1] <= -2 ? d.d?.[-2 - c[1]] : undefined;
      const clave = c[1] >= 0 ? `n${c[1]}` : `s${sinNombre++}`;
      const xz = linea.map(q => [this.aX(q[0]), this.aZ(q[1])] as [number, number]);
      if (texto && /medell/i.test(texto)) {
        medellin.push([par0 * 2, (par0 + pares) * 2]);
        lineasMedellin.push(xz);
      } else {
        afluentes.push({ p: xz[0], ancho: c[0] }, { p: xz[xz.length - 1], ancho: c[0] });
      }
      let rio = this.rios.get(clave);
      if (!rio) {
        rio = { clave, nombre: texto ? this.nombreLegible(texto) : 'Cauce sin nombre registrado', ancho: c[0], tramos: [], largo: 0, ancla: linea[0], anclaLargo: 0, igac, derivado: c[1] <= -2 };
        this.rios.set(clave, rio);
      }
      rio.igac = rio.igac && igac;
      const largo = linea.reduce((t, q, i) => t + (i ? Math.hypot((q[0] - linea[i - 1][0]) * this.mLon, (q[1] - linea[i - 1][1]) * this.mLat) : 0), 0);
      rio.tramos.push({ ini: par0, n: pares });
      rio.largo += largo;
      rio.ancho = Math.max(rio.ancho, c[0]);
      if (largo > rio.anclaLargo) { rio.anclaLargo = largo; rio.ancla = linea[Math.floor(linea.length / 2)]; }
    }
    for (const c of d.t ?? []) {
      const visual = Math.max(ANCHO_MIN_CAUCE * 0.7, c[0] * FACTOR_ANCHO_CAUCE * 0.5);
      this.agregarCinta(soterrado, this.desdeDeltas(c, d.k, 2), visual, visual * 1.8);
    }
    this.crearCinta({ ...agua, pos: this.ensanchar(agua.pos, 1.35) }, '#d3e2a6', 1, 0);          // orilla clara
    this.crearCinta(soterrado, '#7fbfe6', 0, 1, undefined, 0.5);
    this.texturaRio = this.texturaAgua();
    const malla = this.crearCinta(agua, '', 0, 2, this.texturaRio);
    this.aguaPos = malla ? malla.geometry.getAttribute('position') as THREE.BufferAttribute : null;
    this.crearHalos(agua);
    this.construirConfluencias(lineasMedellin, afluentes);
    if (malla) this.teñirAgua(malla, medellin);

    // lagos: superficie plana al nivel medio de su orilla
    for (const l of d.l ?? []) {
      const ring = this.desdeDeltas(l, d.k, 1);
      const xs = ring.map(q => this.aX(q[0])), zs = ring.map(q => this.aZ(q[1]));
      const y = ring.reduce((s, q) => s + this.alturaEn(q[0], q[1]), 0) / ring.length + 2;
      const cLon = ring.reduce((s, q) => s + q[0], 0) / ring.length, cLat = ring.reduce((s, q) => s + q[1], 0) / ring.length;
      const id = this.idEn(cLon, cLat), peso = id >= 0 ? this.pesoBorde(cLon, cLat, id) : 0;
      const pos: number[] = [], ids: number[] = [], pesos: number[] = [], idx: number[] = [];
      ring.forEach((_, i) => { pos.push(xs[i], y, zs[i]); ids.push(id); pesos.push(peso); });
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(ring.map((_, i) => new THREE.Vector2(xs[i], zs[i])), [])) idx.push(a, b, c);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: '#4db3e6', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }));
      m.renderOrder = 2;
      this.escena.add(m);
      this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, ids, pesos);
      // marco ámbar de la capa «Ríos y quebradas»: el mismo contorno, agrandado desde su centro, asoma bajo el agua
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cz = zs.reduce((a, b) => a + b, 0) / zs.length;
      const radio = Math.max(10, Math.sqrt(xs.reduce((a, x, i) => a + (x - cx) ** 2 + (zs[i] - cz) ** 2, 0) / xs.length));
      const f = 1 + 5 / radio, posH: number[] = [];
      ring.forEach((_, i) => posH.push(cx + (xs[i] - cx) * f, y - 0.1, cz + (zs[i] - cz) * f));
      const geoH = new THREE.BufferGeometry();
      geoH.setAttribute('position', new THREE.Float32BufferAttribute(posH, 3));
      geoH.setIndex(idx);
      const h = new THREE.Mesh(geoH, new THREE.MeshBasicMaterial({
        color: '#ffb300', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      }));
      h.renderOrder = 1;
      h.visible = this.sistemaHidrico();
      h.frustumCulled = false;
      this.halosLagos.push(h);
      this.escena.add(h);
      this.registrarCapa(geoH.getAttribute('position') as THREE.BufferAttribute, ids, pesos);
    }
  }

  private alturaXZ(x: number, z: number): number {
    return this.alturaEn(this.lon0 + x / this.mLon, this.lat0 - z / this.mLat);
  }

  /**
   * Puentes: donde una vía principal o local cruza un cauce ancho se levanta un puente que sigue el trazado real de la
   * vía (con sus curvas) y el perfil del terreno: sube desde la orilla, salva el cauce por encima y baja a la otra
   * orilla, enrasado con la vía en ambos extremos. Lleva asfalto, aceras, vigas de concreto por debajo y barandas
   * amarillas (pasamanos, travesaño y postes). Cada puente sube con su vereda cuando esta se levanta.
   */
  private construirPuentes(vias: Compacto, cauces: Cauces): void {
    const CELDA = 300;
    type Punto = [number, number];
    type Seg = { a: Punto; b: Punto; ancho: number };
    const rios = new Map<number, Seg[]>();
    const celdas = (a: Punto, b: Punto, f: (k: number) => void) => {
      const i0 = Math.floor(Math.min(a[0], b[0]) / CELDA), i1 = Math.floor(Math.max(a[0], b[0]) / CELDA);
      const j0 = Math.floor(Math.min(a[1], b[1]) / CELDA), j1 = Math.floor(Math.max(a[1], b[1]) / CELDA);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) f(i * 100003 + j);
    };
    const aXZ = (q: Punto): Punto => [this.aX(q[0]), this.aZ(q[1])];
    for (const c of cauces.c) {
      const visual = Math.max(ANCHO_MIN_CAUCE, c[0] * FACTOR_ANCHO_CAUCE);
      if (visual < ANCHO_MIN_PUENTE) continue;
      const l = this.desdeDeltas(c, cauces.k, 2).map(aXZ);
      for (let i = 1; i < l.length; i++) {
        const seg: Seg = { a: l[i - 1], b: l[i], ancho: visual };
        celdas(seg.a, seg.b, k => (rios.get(k) ?? rios.set(k, []).get(k)!).push(seg));
      }
    }

    // cruces: punto del cruce sobre la vía (segmento i), su trazado completo y el ancho de ambos
    type Cruce = { x: number; z: number; ruta: Punto[]; i: number; ancho: number; anchoVia: number };
    const cruces: Cruce[] = [];
    const rutas: Punto[][] = [];
    for (const v of vias.v!) {
      if (v[0] > 1) continue;
      const l = this.desdeDeltas(v, vias.k, 1).map(aXZ);
      rutas.push(l);
      for (let i = 1; i < l.length; i++) {
        const p = l[i - 1], q = l[i];
        const rx = q[0] - p[0], rz = q[1] - p[1], largo = Math.hypot(rx, rz);
        if (largo < 1e-6) continue;
        const vistos = new Set<Seg>();
        celdas(p, q, k => {
          for (const sg of rios.get(k) ?? []) {
            if (vistos.has(sg)) continue;
            vistos.add(sg);
            const sx = sg.b[0] - sg.a[0], sz = sg.b[1] - sg.a[1];
            const den = rx * sz - rz * sx;
            if (Math.abs(den) < 1e-9) continue;
            const t = ((sg.a[0] - p[0]) * sz - (sg.a[1] - p[1]) * sx) / den;
            const u = ((sg.a[0] - p[0]) * rz - (sg.a[1] - p[1]) * rx) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            if (Math.abs(den) / (largo * Math.hypot(sx, sz)) < 0.4) continue;      // vías casi paralelas al cauce: no lo cruzan
            cruces.push({ x: p[0] + t * rx, z: p[1] + t * rz, ruta: l, i, ancho: sg.ancho, anchoVia: ANCHO_VIA[v[0]] });
          }
        });
      }
    }
    // un puente por cruce: se queda el del cauce más ancho y se descartan los vecinos a menos de 40 m
    cruces.sort((a, b) => b.ancho - a.ancho);
    const puentes: Cruce[] = [];
    for (const c of cruces) if (puentes.every(o => Math.hypot(o.x - c.x, o.z - c.z) > 40)) puentes.push(c);
    if (!puentes.length) return;

    // extremos de cada vía, para continuar por la vía que empalma cuando una se acaba (el tramo que cruza el río es corto)
    const EMPALME = 8;
    const extremos = new Map<number, { ruta: Punto[]; inicio: boolean }[]>();
    const clave = (x: number, z: number) => Math.floor(x / EMPALME) * 100003 + Math.floor(z / EMPALME);
    for (const r of rutas) {
      for (const inicio of [true, false]) {
        const q = inicio ? r[0] : r[r.length - 1], k = clave(q[0], q[1]);
        (extremos.get(k) ?? extremos.set(k, []).get(k)!).push({ ruta: r, inicio });
      }
    }

    /**
     * Camina por el trazado de la vía desde el cruce, `total` metros en un sentido, dejando un punto cada `paso`.
     * Al terminarse la vía salta a la que empalma en su extremo y mejor sigue la misma dirección.
     */
    const caminar = (b: Cruce, sentido: 1 | -1, total: number, paso: number): Punto[] => {
      const out: Punto[] = [];
      let ruta = b.ruta, dir = sentido;
      let cur: Punto = [b.x, b.z];
      let idx = sentido > 0 ? b.i : b.i - 1;
      let falta = paso, recorrido = 0, saltos = 0;
      while (recorrido < total) {
        if (idx < 0 || idx >= ruta.length) {
          const fin = ruta[idx < 0 ? 0 : ruta.length - 1], previo = ruta[idx < 0 ? 1 : ruta.length - 2] ?? fin;
          const ux = fin[0] - previo[0], uz = fin[1] - previo[1], ul = Math.hypot(ux, uz) || 1;
          let mejor: { ruta: Punto[]; inicio: boolean } | null = null, mejorDot = 0.3;
          const ci = Math.floor(fin[0] / EMPALME), cj = Math.floor(fin[1] / EMPALME);
          for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
              for (const e of extremos.get((ci + di) * 100003 + cj + dj) ?? []) {
                if (e.ruta === ruta) continue;
                const q = e.inicio ? e.ruta[0] : e.ruta[e.ruta.length - 1], r = e.inicio ? e.ruta[1] : e.ruta[e.ruta.length - 2];
                if (!r || Math.hypot(q[0] - fin[0], q[1] - fin[1]) > EMPALME) continue;
                const dot = (ux * (r[0] - q[0]) + uz * (r[1] - q[1])) / (ul * (Math.hypot(r[0] - q[0], r[1] - q[1]) || 1));
                if (dot > mejorDot) { mejorDot = dot; mejor = e; }
              }
            }
          }
          if (!mejor || ++saltos > 6) break;
          ruta = mejor.ruta;
          dir = mejor.inicio ? 1 : -1;
          idx = mejor.inicio ? 1 : ruta.length - 2;
          cur = fin;
          continue;
        }
        const dst = ruta[idx];
        const d = Math.hypot(dst[0] - cur[0], dst[1] - cur[1]);
        if (d >= falta) {
          cur = [cur[0] + (dst[0] - cur[0]) * falta / d, cur[1] + (dst[1] - cur[1]) * falta / d];
          out.push(cur);
          recorrido += paso;
          falta = paso;
        } else {
          falta -= d;
          cur = dst;
          idx += dir;
        }
      }
      return out;
    };

    type Grupo = { geos: THREE.BufferGeometry[]; ids: number[]; pesos: number[] };
    const nuevo = (): Grupo => ({ geos: [], ids: [], pesos: [] });
    const concreto = nuevo(), asfalto = nuevo(), amarillo = nuevo();
    const periodo = ANCHO_VIA[0] * 1.8;
    const PASO = 8;

    for (const b of puentes) {
      const largoTotal = Math.min(340, b.ancho * 1.4 + 70);
      const mitad = largoTotal / 2;
      const atras = caminar(b, -1, mitad, PASO).reverse(), adelante = caminar(b, 1, mitad, PASO);
      const pts: Punto[] = [...atras, [b.x, b.z], ...adelante];
      if (pts.length < 5) continue;
      const n = pts.length;
      const lon = this.lon0 + b.x / this.mLon, lat = this.lat0 - b.z / this.mLat;
      const id = this.idEn(lon, lat), peso = id >= 0 ? this.pesoBorde(lon, lat, id) : 0;

      // eje: tangente en cada muestra y metros recorridos
      const tx: number[] = [], tz: number[] = [], arco: number[] = [0];
      for (let k = 0; k < n; k++) {
        const a = pts[Math.max(0, k - 1)], c = pts[Math.min(n - 1, k + 1)];
        const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1;
        tx.push(dx / l);
        tz.push(dz / l);
        if (k) arco.push(arco[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      }

      // perfil: de la cota de la vía en una orilla a la de la otra, siempre sobre el terreno que cruza; se suaviza
      const suelo = pts.map(q => this.alturaXZ(q[0], q[1]));
      // los extremos quedan enrasados con la calzada de la vía (la de la rasante, o 3 m sobre el terreno sin ella)
      const enrase = pts.map((q, k) => (k < 2 || k > n - 3) ? this.calzadaXZ(q[0], q[1]) + 0.2 : suelo[k] + 3.2);
      const y0 = enrase[0], y1 = enrase[n - 1];
      let perfil = pts.map((_, k) => Math.max(y0 + (y1 - y0) * (arco[k] / arco[n - 1]), suelo[k] + 3.2 + 2.5 * Math.sin(Math.PI * arco[k] / arco[n - 1])));
      for (let pasada = 0; pasada < 4; pasada++) {
        const previo = perfil;
        perfil = previo.map((v, k) => (k < 2 || k > n - 3) ? v : (previo[k - 1] + 2 * v + previo[k + 1]) / 4);
      }
      perfil = perfil.map((v, k) => (k < 2 || k > n - 3) ? enrase[k] : Math.max(v, suelo[k] + 3.2));

      const ancho = b.anchoVia * 1.15, acera = Math.max(2.4, ancho * 0.08), kerb = 1.2, viga = 4.5;
      /** Cinta que sigue el eje: de (lat0, h0) a (lat1, h1), con la altura relativa al perfil. */
      const cinta = (g: Grupo, lat0: number, h0: number, lat1: number, h1: number, uv = false) => {
        const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
        for (let k = 0; k < n; k++) {
          const nx = -tz[k], nz = tx[k];
          pos.push(pts[k][0] + nx * lat0, perfil[k] + h0, pts[k][1] + nz * lat0, pts[k][0] + nx * lat1, perfil[k] + h1, pts[k][1] + nz * lat1);
          uvs.push(0, arco[k] / periodo, 1, arco[k] / periodo);
          if (k) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv ? uvs : new Array(n * 4).fill(0), 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        g.geos.push(geo);
        for (let k = 0; k < n * 2; k++) { g.ids.push(id); g.pesos.push(peso); }
      };
      /** Barra de sección cuadrada que sigue el eje, centrada en el lateral `lat` y a la altura `h` sobre el perfil. */
      const barra = (lat: number, h: number, grosor: number) => {
        const m = grosor / 2;
        cinta(amarillo, lat - m, h + m, lat + m, h + m);       // arriba
        cinta(amarillo, lat - m, h - m, lat + m, h - m);       // abajo
        cinta(amarillo, lat - m, h - m, lat - m, h + m);       // lado interior
        cinta(amarillo, lat + m, h - m, lat + m, h + m);       // lado exterior
      };

      const calzada = ancho / 2 - acera;
      cinta(asfalto, -calzada, 0.25, calzada, 0.25, true);                         // asfalto con sus rayas
      for (const lado of [-1, 1]) {
        cinta(concreto, lado * calzada, kerb, lado * ancho / 2, kerb);             // acera
        cinta(concreto, lado * calzada, 0.25, lado * calzada, kerb);               // bordillo
        cinta(concreto, lado * ancho / 2, kerb, lado * ancho / 2, -viga);          // viga lateral
        const lat = lado * (ancho / 2 - acera * 0.45);
        barra(lat, kerb + 8.2, 2.4);                                               // pasamanos
        barra(lat, kerb + 4.2, 1.8);                                               // travesaño
      }
      cinta(concreto, -ancho / 2, -viga, ancho / 2, -viga);                        // fondo del tablero

      // postes: uno cada 3 muestras, orientados con el eje
      const m4 = new THREE.Matrix4();
      for (let k = 0; k < n; k += 3) {
        for (const lado of [-1, 1]) {
          const lat = lado * (ancho / 2 - acera * 0.45);
          const g = new THREE.BoxGeometry(2.6, 9.4, 2.6);
          g.applyMatrix4(m4.compose(
            new THREE.Vector3(pts[k][0] - tz[k] * lat, perfil[k] + kerb + 4.7, pts[k][1] + tx[k] * lat),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-tz[k], tx[k])), new THREE.Vector3(1, 1, 1),
          ));
          amarillo.geos.push(g);
          const cuenta = g.getAttribute('position').count;
          for (let q = 0; q < cuenta; q++) { amarillo.ids.push(id); amarillo.pesos.push(peso); }
        }
      }
    }

    const malla = (g: Grupo, material: THREE.Material) => {
      if (!g.geos.length) return;
      // las cintas no traen uv útil salvo el asfalto, pero todas las piezas llevan los mismos atributos para poder unirse
      const geo = mergeGeometries(g.geos, false);
      g.geos.forEach(x => x.dispose());
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.escena.add(mesh);
      this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, g.ids, g.pesos);
    };
    const doble = THREE.DoubleSide;
    malla(concreto, new THREE.MeshStandardMaterial({ color: '#c9c7c0', roughness: 0.9, side: doble }));
    malla(asfalto, new THREE.MeshStandardMaterial({ map: this.texturaVia('principal'), roughness: 0.95, side: doble }));
    malla(amarillo, new THREE.MeshStandardMaterial({ color: COLOR_BARANDA, roughness: 0.6, side: doble }));
  }

  /** Textura de asfalto con rayas: u cruza la vía y v avanza a lo largo (un ciclo por repetición). */
  private texturaVia(tipo: 'principal' | 'local'): THREE.CanvasTexture {
    const W = 64, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d')!;
    x.fillStyle = tipo === 'principal' ? '#3e4146' : '#55585d';
    x.fillRect(0, 0, W, H);
    // granito sutil del asfalto
    for (let i = 0; i < 260; i++) {
      x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},.05)`;
      x.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    if (tipo === 'principal') {
      x.fillStyle = 'rgba(255,255,255,.85)';          // líneas de borde
      x.fillRect(4, 0, 3, H);
      x.fillRect(W - 7, 0, 3, H);
      x.fillStyle = '#f2c230';                          // raya central discontinua
      x.fillRect(W / 2 - 1.5, 6, 3, 52);
      x.fillRect(W / 2 - 1.5, 70, 3, 52);
    } else {
      x.fillStyle = 'rgba(255,255,255,.55)';
      x.fillRect(W / 2 - 1, 10, 2, 40);
      x.fillRect(W / 2 - 1, 74, 2, 40);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  /**
   * Dos capas que marcan un río: una clara para el cursor y otra ámbar para el elegido. Comparten la geometría
   * de una cinta más ancha que el agua (así suben con su vereda) y solo dibujan los tramos del río marcado.
   */
  private crearHalos(agua: GrupoCinta): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.ensanchar(agua.pos, 2.4), 3));
    const atributo = geo.getAttribute('position') as THREE.BufferAttribute;
    this.registrarCapa(atributo, agua.ids, agua.pesos);
    const hacer = (color: string, opacidad: number, orden: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', atributo);
      g.setIndex([]);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: opacidad, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }));
      m.renderOrder = orden;
      m.frustumCulled = false;
      this.escena.add(m);
      return m;
    };
    this.haloHover = hacer('#fff2a6', 0.85, 1);
    this.haloElegido = hacer('#ffb300', 0.95, 1);
    this.haloSistema = hacer('#ffb300', 0.85, 1);
  }

  /** Triángulos de las cintas que pertenecen a un río (mismo orden de vértices que agregarCinta). */
  private indicesDeRio(clave: string | null): number[] {
    const rio = clave ? this.rios.get(clave) : null;
    const idx: number[] = [];
    for (const t of rio?.tramos ?? []) {
      for (let p = 1; p < t.n; p++) {
        const a0 = 2 * (t.ini + p - 1);
        idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
      }
    }
    return idx;
  }

  private pintarHalos(): void {
    this.haloHover?.geometry.setIndex(this.rioHover && this.rioHover !== this.rioElegido ? this.indicesDeRio(this.rioHover) : []);
    this.haloElegido?.geometry.setIndex(this.indicesDeRio(this.rioElegido));
    this.haloSistema?.geometry.setIndex(this.sistemaHidrico() ? [...this.rios.keys()].flatMap(k => this.indicesDeRio(k)) : []);
  }

  /**
   * Cauce bajo el cursor. Se mide en pantalla (distancia del cursor a la línea del cauce, con tolerancia) porque
   * de lejos un arroyo mide menos de un píxel y no se podría tocar con un rayo.
   */
  private rioBajoCursor(ev: PointerEvent): string | null {
    const pos = this.aguaPos;
    if (!pos || !this.rios.size) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const n = pos.count / 2;
    if (this.pantallaCauces.length !== n * 3) this.pantallaCauces = new Float32Array(n * 3);
    const pc = this.pantallaCauces, v = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      v.set((pos.getX(2 * k) + pos.getX(2 * k + 1)) / 2, (pos.getY(2 * k) + pos.getY(2 * k + 1)) / 2, (pos.getZ(2 * k) + pos.getZ(2 * k + 1)) / 2).project(this.camara);
      pc[3 * k] = (v.x * 0.5 + 0.5) * r.width;
      pc[3 * k + 1] = (-v.y * 0.5 + 0.5) * r.height;
      pc[3 * k + 2] = v.z < 1 ? 1 : 0;
    }
    let mejor: string | null = null, mejorD = TOLERANCIA_CAUCE_PX;
    for (const rio of this.rios.values()) {
      for (const t of rio.tramos) {
        for (let p = 1; p < t.n; p++) {
          const a = (t.ini + p - 1) * 3, b = (t.ini + p) * 3;
          if (!pc[a + 2] || !pc[b + 2]) continue;
          if (this.aisladas.size && !this.visibleEnXZ(pos.getX(2 * (t.ini + p)), pos.getZ(2 * (t.ini + p)))) continue;
          const dx = pc[b] - pc[a], dy = pc[b + 1] - pc[a + 1];
          const l2 = dx * dx + dy * dy;
          const u = l2 ? Math.max(0, Math.min(1, ((mx - pc[a]) * dx + (my - pc[a + 1]) * dy) / l2)) : 0;
          const d = Math.hypot(mx - (pc[a] + dx * u), my - (pc[a + 1] + dy * u));
          if (d < mejorD) { mejorD = d; mejor = rio.clave; }
        }
      }
    }
    return mejor;
  }

  /** Elige (o suelta, con null) un río: marca todos sus tramos, muestra su nombre y encuadra la cámara. */
  private seleccionarRio(clave: string | null, volar = true): void {
    if (clave) { this.seleccionarFabrica(-1, false); this.soltarRed(); }
    this.rioElegido = clave;
    const rio = clave ? this.rios.get(clave) : null;
    if (!rio) {
      this.rioSeleccion.set(null);
      this.pintarHalos();
      return;
    }
    // un río y una vereda no se eligen a la vez
    this.elegida = -1;
    this.seleccion.set(null);
    this.pintarResalte();
    this.rioSeleccion.set({
      nombre: rio.nombre,
      detalle: `${rio.ancho >= 10 ? 'Río' : 'Quebrada'} · ancho ≈ ${Math.round(rio.ancho)} m · ${(rio.largo / 1000).toFixed(1)} km en el mapa${rio.igac ? ' · trazado IGAC 1:100.000' : ''}${rio.derivado ? ' · nombre deducido de la red' : ''}`,
    });
    if (!this.rotuloRio) {
      this.rotuloRio = document.createElement('div');
      this.rotuloRio.className = 'rot agua activo';
      this.rotuloRio.append(document.createElement('i'), document.createElement('span'));
      this.contenedorRotulos.nativeElement.appendChild(this.rotuloRio);
    }
    this.rotuloRio.lastElementChild!.textContent = rio.nombre;
    this.pintarHalos();
    if (volar) {
      const [lon, lat] = rio.ancla;
      const objetivo = new THREE.Vector3(this.aX(lon), this.alturaEn(lon, lat), this.aZ(lat));
      const dir = this.camara.position.clone().sub(this.controles.target).normalize();
      this.volarA(objetivo.clone().add(dir.multiplyScalar(Math.min(9000, Math.max(3500, rio.largo * 0.6 + 2500)))), objetivo);
    }
  }

  /** Aleja cada par de vértices de una cinta de su eje: mismas posiciones centrales, más ancha. */
  private ensanchar(pos: number[], f: number): number[] {
    const out = pos.slice();
    for (let i = 0; i + 5 < out.length; i += 6) {
      for (const o of [0, 3]) {
        const cx = (out[i] + out[i + 3]) / 2, cz = (out[i + 2] + out[i + 5]) / 2;
        out[i + o] = cx + (out[i + o] - cx) * f;
        out[i + o + 2] = cz + (out[i + o + 2] - cz) * f;
      }
    }
    return out;
  }

  /**
   * Deja en cada vereda tantas viviendas como le corresponden por población: las viviendas del Censo 2018 llevadas
   * al año elegido con la proyección de la vereda. Se eligen huellas de vivienda al azar (siempre las mismas); las
   * casetas se quitan y las bodegas y demás edificios grandes se conservan. Fuera de las veredas no se toca nada.
   */
  private ajustarAPoblacion(edificios: number[][], k: number, datos: PoblacionVeredas, anio: number, origen?: number[]): Set<number> {
    const norma = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const cupo = new Map<number, number>();
    this.datosPorVereda.clear();
    for (const f of datos.features) {
      const p = f.properties, id = this.piezas.findIndex(z => z.zona.t === 'VE' && norma(z.zona.n) === norma(p.nombre));
      // con la proyección por edad, la población es la de toda la vereda (rural disperso y centros poblados) y las
      // viviendas del censo crecen al mismo ritmo; si no está, la serie vieja de rural disperso
      const ze = this.zonaEdad(p.nombre, 'vereda');
      const actual = ze ? this.totalEdad(ze, anio) : Number(p[`pob${anio}`]);
      const base = ze ? this.totalEdad(ze, 2018) : Number(p['pob2018']);
      if (id < 0 || !(base > 0) || !Number.isFinite(actual)) continue;
      const estimadas = Math.round(p.viv2018 * actual / base);
      cupo.set(id, Math.round(estimadas * FACTOR_VIVIENDAS));
      this.datosPorVereda.set(id, { pob: actual, viv: estimadas });   // la ficha muestra la estimación, sin el margen
    }
    const candidatas = new Map<number, [number, number][]>();   // vereda → [orden aleatorio, índice]
    const quitar = new Set<number>();
    edificios.forEach((e, n) => {
      if (origen?.[n] === 0) return;   // el catastro urbano es la ciudad real: se dibuja completo
      const anillo = this.desdeDeltas(e, k, 1);
      if (anillo.length < 3) return;
      const lon = anillo.reduce((a, q) => a + q[0], 0) / anillo.length, lat = anillo.reduce((a, q) => a + q[1], 0) / anillo.length;
      const id = this.idEn(lon, lat);
      if (!cupo.has(id) || this.esUrbano(lon, lat)) return;   // el tejido urbano denso se dibuja completo
      const doble = anillo.reduce((a, q, i) => { const r = anillo[(i + 1) % anillo.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0);
      const area = Math.abs(doble) / 2 * this.mLon * this.mLat;
      if (area < AREA_VIVIENDA[0]) quitar.add(n);
      else if (area <= AREA_VIVIENDA[1]) {
        const orden = (((n + 1) * 2654435761) >>> 0) % 1000003;
        (candidatas.get(id) ?? candidatas.set(id, []).get(id)!).push([orden, n]);
      }
    });
    for (const [id, lista] of candidatas) {
      lista.sort((a, b) => a[0] - b[0]);
      for (const [, n] of lista.slice(cupo.get(id)!)) quitar.add(n);
    }
    return quitar;
  }

  private zonaEdad(nombre: string, tipo: 'cabecera' | 'vereda'): PoblacionEdad['zonas'][number] | undefined {
    const norma = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    return this.edad?.zonas.find(z => z.tipo === tipo && (tipo === 'cabecera' || norma(z.nombre) === norma(nombre)));
  }

  /** Personas de una zona en un año (NaN si el año no está en la serie). */
  private totalEdad(z: PoblacionEdad['zonas'][number], anio: number): number {
    const i = this.edad!.metadata.anios.indexOf(anio);
    if (i < 0) return NaN;
    return z.H[i].reduce((a, b) => a + b, 0) + z.M[i].reduce((a, b) => a + b, 0);
  }

  /** Población de la zona en el año pedido por grupo de edad; los anchos usan la escala de toda la serie para comparar años. */
  private piramideDe(z: PoblacionEdad['zonas'][number], anio: number): Piramide | null {
    const m = this.edad!.metadata, i = m.anios.indexOf(anio);
    if (i < 0) return null;
    const suma = (v: number[], g: (typeof GRUPOS_VIDA)[number]) => v.slice(g.desde, g.hasta + 1).reduce((a, x) => a + x, 0);
    let maximo = 1;
    for (let t = 0; t < m.anios.length; t++) for (const g of GRUPOS_VIDA) maximo = Math.max(maximo, suma(z.H[t], g) + suma(z.M[t], g));
    const hombres = z.H[i].reduce((a, v) => a + v, 0), mujeres = z.M[i].reduce((a, v) => a + v, 0), total = hombres + mujeres;
    return {
      anio, extrapolado: anio > m.oficial_hasta, base: m.anios[0], total, hombres, mujeres,
      grupos: GRUPOS_VIDA.map(g => {
        const h = suma(z.H[i], g), mu = suma(z.M[i], g), antes = suma(z.H[0], g) + suma(z.M[0], g);
        return {
          nombre: g.nombre, rango: g.rango, total: h + mu, hombres: h, mujeres: mu,
          peso: total ? (h + mu) / total * 100 : 0, cambio: antes ? ((h + mu) / antes - 1) * 100 : null,
          ah: h / maximo * 100, am: mu / maximo * 100, base: antes / maximo * 100,
        };
      }),
      indicadores: z.indicadores[i],
    };
  }

  /** Número entero con punto de miles, como se escribe en Colombia (la app no carga el locale es-CO en Angular). */
  cifra(v: number): string { return Math.round(v).toLocaleString('es-CO'); }

  /** Mientras se arrastra el deslizador solo cambia la ficha; al soltarlo se redibujan las viviendas. */
  verAnio(valor: string, soltar: boolean): void {
    const anio = Number(valor);
    if (!Number.isFinite(anio)) return;
    if (soltar) { this.anioVista.set(null); this.cambiarAnio(anio); }
    else this.anioVista.set(anio);
  }

  /** Edificios del año elegido (los originales si no hay datos de población). */
  private edificiosParaAnio(anio: number): Compacto | null {
    const base = this.edificiosBase;
    if (!base?.e || !this.poblacion) return base;
    const quitar = this.ajustarAPoblacion(base.e, base.k, this.poblacion, anio, base.r);
    const sin = <T>(a?: T[]) => a?.filter((_, n) => !quitar.has(n));
    return { ...base, e: sin(base.e), p: sin(base.p), u: sin(base.u), r: sin(base.r), n: sin(base.n) };
  }

  /** Población y viviendas dibujadas de una vereda en el año elegido. */
  datosDe(z: Zona): { pob: number; viv: number } | undefined {
    this.anio();
    return this.datosPorVereda.get(this.piezas.findIndex(p => p.zona === z));
  }

  /** Vuelve a dibujar las viviendas con la población del año pedido. */
  cambiarAnio(anio: number): void {
    if (anio === this.anio() || !this.escena) return;
    this.anio.set(anio);
    const nuevos = this.edificiosParaAnio(anio);
    if (!nuevos?.e) return;
    if (this.mallasEdificios.length) {
      for (const m of this.mallasEdificios) { this.escena.remove(m); m.geometry.dispose(); }
      for (const f of this.mallasFachadas) { this.escena.remove(f.malla); f.malla.geometry.dispose(); }
      this.mallasFachadas = [];
      (this.mallasEdificios[0].material as THREE.Material).dispose();
      this.capas = this.capas.filter(c => !this.capasEdificios.includes(c));
    }
    this.construirEdificios(nuevos);
    // las veredas levantadas ya no están a ras de suelo: las mallas nuevas deben subir con ellas
    for (const capa of this.capasEdificios) {
      this.alzado.forEach((alto, id) => {
        for (const k of capa.porPieza[id]) capa.atributo.setY(k, capa.base[k] + alto * capa.peso[k]);
      });
      capa.atributo.needsUpdate = true;
    }
  }

  /** Huellas extruidas. Las alturas casi nunca vienen en los datos: se estiman entre 4,5 y 8,5 m. */
  private construirEdificios(d: Compacto): void {
    for (const _ of this.edificiosPorTandas(d)) { /* de corrido: así se rehace al cambiar de año */ }
  }

  /** Lo mismo, pero cediendo el hilo entre tandas: al abrir el mapa son miles de huellas y de corrido congelaban la página. */
  private async construirEdificiosEnTandas(d: Compacto): Promise<void> {
    const g = this.edificiosPorTandas(d);
    // cada tanda sube el avance un punto (80 → 89): el total de tandas no se conoce de antemano
    while (!g.next().done) { this.avanzar(Math.min(89, this.progreso() + 1)); if (await this.ceder()) return; }
  }

  private *edificiosPorTandas(d: Compacto): Generator<void, void, void> {
    const PAREDES = ['#f3e8d6', '#efe0c9', '#f6f0e6', '#ead7bd'].map(c => new THREE.Color(c));
    const TECHOS = ['#c8704f', '#b9825f', '#d6cfc0', '#a3a9ae', '#c98f6a'].map(c => new THREE.Color(c));
    // viviendas de la región: ladrillo de barro con techo a dos aguas de teja de barro; en el casco urbano, edificios de varios pisos pintados
    const LADRILLOS = ['#b9603e', '#a9532f', '#c26a45', '#b25a3a'].map(c => new THREE.Color(c));
    const TEJAS = ['#9e4527', '#b0552f', '#c6683c'].map(c => new THREE.Color(c));
    const URBANOS = ['#efe6d2', '#e4d3b4', '#d9e2e8', '#e9d2cf', '#cfd9c9'].map(c => new THREE.Color(c));
    const LOSA = new THREE.Color('#8e959c');
    // catastro: bodegas e industrias de cubierta metálica; locales y edificios comerciales en tonos sobrios
    const BODEGAS = ['#c9cdd0', '#d9d6cf', '#cfd8de', '#e1e4e7'].map(c => new THREE.Color(c));
    const CUBIERTAS = ['#7f878e', '#aab2b8', '#8e9aa4', '#dfe3e6', '#b9c0c6'].map(c => new THREE.Color(c));    // lámina galvanizada, gris y blanca como en los parques reales
    const COMERCIALES = ['#f3e3c3', '#e9d8b8', '#d9e4ea', '#f1d9c4'].map(c => new THREE.Color(c));
    // una malla por tesela: así la GPU descarta las que quedan fuera de cámara y solo proyectan sombra las del recuadro de la luz
    type Tesela = { pos: number[]; col: number[]; idx: number[]; ids: number[]; pesos: number[] };
    const teselas = new Map<number, Tesela>();
    const pendientes: PendienteFachada[] = [];
    const tejas = new Map<number, TeselaTeja>();
    const ROJIZOS = new Set([...TEJAS, TECHOS[0], TECHOS[1], TECHOS[4]]);
    this.cajasViv.clear();
    const unEdificio = (e: NonNullable<Compacto['e']>[number], n: number): void => {
      const ring = this.desdeDeltas(e, d.k, 1);
      if (ring.length < 3) return;
      const hash = (((n + 1) * 2654435761) >>> 0) % 1000 / 1000;
      const xs = ring.map(q => this.aX(q[0])), zs = ring.map(q => this.aZ(q[1]));
      const cLon = ring.reduce((a, q) => a + q[0], 0) / ring.length, cLat = ring.reduce((a, q) => a + q[1], 0) / ring.length;
      const id = this.idEn(cLon, cLat);
      const doble = ring.reduce((a, q, i) => { const r = ring[(i + 1) % ring.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0);
      const area = Math.abs(doble) / 2 * this.mLon * this.mLat;
      // tejido urbano: casas de 1 a 3 pisos con teja; los predios grandes o algunos al azar son edificios de 3 a 5 pisos
      // catastro: pisos, uso y origen reales; el complemento (Overture/OSM) se estima como siempre
      const pisos = d.p?.[n] ?? 0, uso = d.u?.[n] ?? 0, real = pisos > 0;
      const denso = real ? d.r?.[n] === 0 : this.esUrbano(cLon, cLat);
      // bodegas: uso industrial, o una huella rural grande de uno o dos pisos sin otro uso (hileras de módulos de los parques industriales, galpones)
      const industria = real && (uso === 2 || (uso === 0 && d.r?.[n] === 1 && area >= AREA_BODEGA && pisos <= 2));
      // hileras de casas adosadas de las urbanizaciones (propiedad horizontal) que el catastro no trae: complemento de 2 pisos, siempre con teja
      const hilera = real && d.r?.[n] === 2;
      const urbano = real ? !hilera && !industria && (pisos >= 4 || area > 900 || (uso === 1 && area > 400))
        : denso && (area > AREA_VIVIENDA[1] || (area > 120 && hash > 0.85));
      const casa = real ? hilera || (!urbano && !industria && area <= 400) : area <= AREA_VIVIENDA[1] && !urbano;
      const h = real ? e[0] * ESCALA_CATASTRO : (urbano ? 3 * (3 + Math.floor(hash * 2.2)) * 0.6 : denso ? 3 * (1 + Math.floor(hash * 3)) * 0.6 : e[0] || 4.5 + hash * 4) * ESCALA_EDIFICIOS;
      // piso: el nivel de la acera frente a la casa (catastro asentado), para que la puerta quede al ras de la calle y no tapada;
      // sin él, el punto más bajo de la huella. Las paredes bajan siempre hasta 4 m bajo el terreno más bajo (zócalo en ladera).
      const bajo = Math.min(...ring.map(q => this.alturaEn(q[0], q[1])));
      const nivel = d.n?.[n], piso = nivel != null ? nivel / 100 * EXAGERACION : bajo;
      const suelo = Math.min(bajo, piso) - 4, techo = piso + h;
      const peso = id >= 0 ? this.pesoBorde(cLon, cLat, id) : 0;
      let pared = industria ? BODEGAS[n % BODEGAS.length] : real && uso === 1 && !casa ? COMERCIALES[n % COMERCIALES.length] : urbano ? URBANOS[n % URBANOS.length] : casa ? (denso && n % 2 ? URBANOS[n % URBANOS.length] : LADRILLOS[n % LADRILLOS.length]) : PAREDES[n % PAREDES.length];
      const tejado = industria ? CUBIERTAS[(n * 5 + Math.floor(hash * 7)) % CUBIERTAS.length] : urbano ? LOSA : casa ? TEJAS[n % TEJAS.length] : TECHOS[(n * 7 + Math.floor(hash * 10)) % TECHOS.length];
      // fachada con ventanas, puertas, balcones o letrero en el lado más largo de los edificios del casco urbano del catastro
      const lados = real && d.r?.[n] === 0 && !industria ? this.ladosDeFachada(xs, zs) : [];
      if (lados.length) {
        const pal = urbano ? 4 : Math.floor(hash * 4);
        pared = PALETAS_COLOR[pal];
        lados.forEach((lado, q) => pendientes.push({ lado, a: ring[lado.i], c: ring[lado.j], b: { n: n + q, hash: (hash + q * 0.37) % 1, pisos, uso, pal, suelo: nivel != null ? piso : NaN, techo, id, peso } }));
      }
      const clave = this.claveTesela(this.aX(cLon), this.aZ(cLat));
      let t = teselas.get(clave);
      if (!t) teselas.set(clave, t = { pos: [], col: [], idx: [], ids: [], pesos: [] });
      (this.cajasViv.get(clave) ?? this.cajasViv.set(clave, []).get(clave)!).push({
        x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), top: techo, id, poli: xs.flatMap((x, i) => [x, zs[i]]),
      });
      const { pos, col, idx, ids, pesos } = t;
      const poner = (x: number, y: number, z: number, c: THREE.Color) => {
        pos.push(x, y, z);
        col.push(c.r, c.g, c.b);
        ids.push(id);
        pesos.push(peso);
        return pos.length / 3 - 1;
      };
      // techos marrones (teja de barro): van en una malla aparte, con la textura de tejas; el tinte varía un poco por edificio
      const conTeja = ROJIZOS.has(tejado);
      let tp: TeselaTeja | undefined;
      if (conTeja) {
        tp = tejas.get(clave);
        if (!tp) tejas.set(clave, tp = { pos: [], uv: [], col: [], idx: [], ids: [], pesos: [] });
      }
      const tinte = 0.8 + hash * 0.3;
      const ponerTeja = (x: number, y: number, z: number, u: number, v: number) => {
        tp!.pos.push(x, y, z); tp!.uv.push(u, v); tp!.col.push(tinte, tinte * 0.97, tinte * 0.95); tp!.ids.push(id); tp!.pesos.push(peso);
        return tp!.pos.length / 3 - 1;
      };
      const tejaIdx = tp?.idx ?? [];
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        const a = poner(xs[i], suelo, zs[i], pared), b = poner(xs[j], suelo, zs[j], pared);
        const c = poner(xs[j], techo, zs[j], pared), dd = poner(xs[i], techo, zs[i], pared);
        idx.push(a, b, c, a, c, dd);
      }
      if (casa) {
        // huella de cuatro lados: techo a dos aguas con la cumbrera a lo largo del lado mayor y frontones de ladrillo
        const cuadro = ring.length === 5 && xs[0] === xs[4] && zs[0] === zs[4] ? ring.slice(0, 4).map((_, i) => i) : ring.length === 4 ? [0, 1, 2, 3] : null;
        if (cuadro) {
          const largo = (i: number, j: number) => Math.hypot(xs[cuadro[j]] - xs[cuadro[i]], zs[cuadro[j]] - zs[cuadro[i]]);
          const q = largo(0, 1) >= largo(1, 2) ? cuadro : [cuadro[1], cuadro[2], cuadro[3], cuadro[0]];
          const sube = Math.min(largo(1, 2), largo(0, 1)) * 0.3 * ESCALA_EDIFICIOS / 2;
          const m1 = [(xs[q[1]] + xs[q[2]]) / 2, (zs[q[1]] + zs[q[2]]) / 2], m2 = [(xs[q[3]] + xs[q[0]]) / 2, (zs[q[3]] + zs[q[0]]) / 2];
          const P = (i: number, c: THREE.Color) => poner(xs[q[i]], techo, zs[q[i]], c);
          if (conTeja) {
            // faldones con textura de teja: la u corre a lo largo de la cumbrera y la v sube desde el alero
            const L = largo(0, 1) || 1, ux = (xs[q[1]] - xs[q[0]]) / L, uz = (zs[q[1]] - zs[q[0]]) / L;
            const U = (x: number, z: number) => ((x - xs[q[0]]) * ux + (z - zs[q[0]]) * uz) / ESCALA_TEJA;
            const pend = Math.hypot(Math.min(largo(0, 1), largo(1, 2)) / 2, sube) / ESCALA_TEJA, y = techo + sube;
            const T = (x: number, yy: number, z: number, v: number) => ponerTeja(x, yy, z, U(x, z), v);
            const a0 = T(xs[q[0]], techo, zs[q[0]], 0), a1 = T(xs[q[1]], techo, zs[q[1]], 0), a2 = T(m1[0], y, m1[1], pend), a3 = T(m2[0], y, m2[1], pend);
            const b2 = T(xs[q[2]], techo, zs[q[2]], 0), b3 = T(xs[q[3]], techo, zs[q[3]], 0), c2 = T(m1[0], y, m1[1], pend), c3 = T(m2[0], y, m2[1], pend);
            tejaIdx.push(a0, a1, a2, a0, a2, a3, b2, b3, c3, b2, c3, c2);
          } else {
            const a0 = P(0, tejado), a1 = P(1, tejado), a2 = poner(m1[0], techo + sube, m1[1], tejado), a3 = poner(m2[0], techo + sube, m2[1], tejado);
            const b2 = P(2, tejado), b3 = P(3, tejado), c2 = poner(m1[0], techo + sube, m1[1], tejado), c3 = poner(m2[0], techo + sube, m2[1], tejado);
            idx.push(a0, a1, a2, a0, a2, a3, b2, b3, c3, b2, c3, c2);
          }
          const f1 = P(1, pared), f2 = P(2, pared), f3 = poner(m1[0], techo + sube, m1[1], pared);
          const g3 = P(3, pared), g0 = P(0, pared), g1 = poner(m2[0], techo + sube, m2[1], pared);
          idx.push(f1, f2, f3, g3, g0, g1);
          return;
        }
      }
      const contorno = ring.map((_, i) => new THREE.Vector2(xs[i], zs[i]));
      if (conTeja) {
        const base = tp!.pos.length / 3;
        ring.forEach((_, i) => ponerTeja(xs[i], techo, zs[i], xs[i] / ESCALA_TEJA, zs[i] / ESCALA_TEJA));
        for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contorno, [])) tejaIdx.push(base + a, base + b, base + c);
        return;
      }
      const base = pos.length / 3;
      const membrana = !industria && tejado === LOSA ? MEMBRANAS[n % MEMBRANAS.length] : tejado;       // la placa no es toda del mismo gris: manto asfáltico, concreto, pintura
      ring.forEach((_, i) => poner(xs[i], techo, zs[i], membrana));
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contorno, [])) idx.push(base + a, base + b, base + c);
      // placa de concreto: antepecho de mampostería con remate claro y, en algunas, el tinaco sobre la losa (la caja de cartón no existe en la vida real)
      if (!industria && area > 30 && area < 4000) {
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length;
          const a = poner(xs[i], techo, zs[i], pared), b = poner(xs[j], techo, zs[j], pared);
          const c = poner(xs[j], techo + ALTO_ANTEPECHO, zs[j], REMATE), dd = poner(xs[i], techo + ALTO_ANTEPECHO, zs[i], REMATE);
          idx.push(a, b, c, a, c, dd);
        }
        // tapa del antepecho: una franja de ~25 cm hacia adentro, para que el borde tenga grosor
        const cx0 = xs.reduce((s2, v) => s2 + v, 0) / xs.length, cz0 = zs.reduce((s2, v) => s2 + v, 0) / zs.length;
        const adentro = ring.map((_, i) => {
          const dx = cx0 - xs[i], dz = cz0 - zs[i], L = Math.hypot(dx, dz) || 1;
          return poner(xs[i] + dx / L * 0.35, techo + ALTO_ANTEPECHO, zs[i] + dz / L * 0.35, REMATE);
        });
        const afuera = ring.map((_, i) => poner(xs[i], techo + ALTO_ANTEPECHO, zs[i], REMATE));
        for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; idx.push(afuera[i], afuera[j], adentro[j], afuera[i], adentro[j], adentro[i]); }
        const mx = xs.reduce((s, v) => s + v, 0) / xs.length, mz = zs.reduce((s, v) => s + v, 0) / zs.length;
        const dentro = ring.length <= 8 && xs.every((x, i) => Math.hypot(x - mx, zs[i] - mz) > 2.5) && puntoEnPoligono(mx, mz, xs, zs);
        if (dentro && area > 50 && hash > 0.25) {
          const k = hash > 0.7 ? TINACO_AZUL : TINACO_NEGRO, R = 0.55, H = 1.1;
          const y0 = techo + 0.05, y1 = y0 + H;
          const aro0 = [0, 1, 2, 3, 4, 5].map(s => poner(mx + Math.cos(s * Math.PI / 3) * R, y0, mz + Math.sin(s * Math.PI / 3) * R, k));
          const aro1 = [0, 1, 2, 3, 4, 5].map(s => poner(mx + Math.cos(s * Math.PI / 3) * R, y1, mz + Math.sin(s * Math.PI / 3) * R, k));
          const tapa = poner(mx, y1 + 0.2, mz, k);
          for (let s = 0; s < 6; s++) { const u = (s + 1) % 6; idx.push(aro0[s], aro0[u], aro1[u], aro0[s], aro1[u], aro1[s], aro1[s], aro1[u], tapa); }
        }
      }
    };
    let t0 = performance.now();
    for (let n = 0; n < d.e!.length; n++) {
      unEdificio(d.e![n], n);
      if (performance.now() - t0 > 25) { yield; t0 = performance.now(); }
    }
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide,
    });
    this.mallasEdificios = [];
    this.capasEdificios = [];
    for (const t of teselas.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
      geo.setIndex(t.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(t.idx, 1) : new THREE.Uint16BufferAttribute(t.idx, 1));
      this.acolchar(geo);
      const malla = new THREE.Mesh(geo, material);
      malla.receiveShadow = true;
      this.escena.add(malla);
      this.mallasEdificios.push(malla);
      this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, t.ids, t.pesos);
      this.capasEdificios.push(this.capas[this.capas.length - 1]);
    }
    if (tejas.size) {
      this.matTejado ??= new THREE.MeshStandardMaterial({ map: crearTexturaTeja(), vertexColors: true, flatShading: true, roughness: 0.95, side: THREE.DoubleSide });
      for (const t of tejas.values()) {
        if (!t.pos.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
        geo.setIndex(t.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(t.idx, 1) : new THREE.Uint16BufferAttribute(t.idx, 1));
        this.acolchar(geo);
        const malla = new THREE.Mesh(geo, this.matTejado);
        malla.receiveShadow = true;
        this.escena.add(malla);
        this.mallasEdificios.push(malla);
        this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, t.ids, t.pesos);
        this.capasEdificios.push(this.capas[this.capas.length - 1]);
      }
    }
    this.armarFachadasPorLotes(pendientes);
  }

  /**
   * Las fachadas se arman en lotes de pocos milisegundos entre fotogramas, no de golpe: así la carga y el cambio de año no se
   * congelan. Un cambio de año cancela el trabajo que quedaba a medias.
   */
  private armarFachadasPorLotes(pendientes: PendienteFachada[]): void {
    const ticket = ++this.trabajoFachadas;
    const mapa = new Map<number, TeselaFachada>();
    let i = 0;
    const paso = () => {
      if (ticket !== this.trabajoFachadas) return;
      const t0 = performance.now();
      while (i < pendientes.length && performance.now() - t0 < 5) {
        const p = pendientes[i++];
        // con piso asentado la fachada arranca en él (la puerta al ras de la acera); sin él, en el terreno más bajo del lado
        if (Number.isNaN(p.b.suelo)) p.b.suelo = Math.min(this.alturaEn(p.a[0], p.a[1]), this.alturaEn(p.c[0], p.c[1])) - 0.3;
        this.agregarFachada(mapa, p.lado, p.b);
      }
      if (i < pendientes.length) setTimeout(paso, 0);
      else this.montarFachadas(mapa);
    };
    setTimeout(paso, 0);
  }

  /** Los dos lados más largos del contorno (≥ 5 m), con su normal hacia afuera; ahí se ponen las fachadas. */
  private ladosDeFachada(xs: number[], zs: number[]): LadoFachada[] {
    const cx = xs.reduce((a, v) => a + v, 0) / xs.length, cz = zs.reduce((a, v) => a + v, 0) / zs.length;
    const lados: LadoFachada[] = [];
    for (let i = 0; i < xs.length; i++) {
      const j = (i + 1) % xs.length, largo = Math.hypot(xs[j] - xs[i], zs[j] - zs[i]);
      if (largo < LARGO_FACHADA_MIN) continue;
      const dx = (xs[j] - xs[i]) / largo, dz = (zs[j] - zs[i]) / largo;
      let nx = dz, nz = -dx;
      if (nx * ((xs[i] + xs[j]) / 2 - cx) + nz * ((zs[i] + zs[j]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      lados.push({ i, j, x0: xs[i], z0: zs[i], dx, dz, nx, nz, largo });
    }
    return lados.sort((a, b) => b.largo - a.largo).slice(0, 2);
  }

  /**
   * Pone los cuadros de fachada de un edificio: un cuadro por hueco y por piso, con la celda del atlas que le toca. La planta baja
   * de un local comercial es un solo frente con letrero; la de una casa lleva puerta al centro y ventanas con reja.
   */
  private agregarFachada(mapa: Map<number, TeselaFachada>, l: LadoFachada, b: { n: number; hash: number; pisos: number; uso: number; pal: number; suelo: number; techo: number; id: number; peso: number }): void {
    const cx = l.x0 + l.dx * l.largo / 2, cz = l.z0 + l.dz * l.largo / 2;
    const clave = Math.floor((cx + this.ancho / 2) / TESELA_FACHADA) + Math.floor((cz + this.alto / 2) / TESELA_FACHADA) * 1000;
    let t = mapa.get(clave);
    if (!t) mapa.set(clave, t = { pos: [], uv: [], nor: [], idx: [], ids: [], pesos: [], sx: 0, sz: 0, k: 0 });
    t.sx += cx; t.sz += cz; t.k++;
    const pisos = Math.max(1, b.pisos), alto = (b.techo - b.suelo) / pisos, eps = 0.4;
    const nb = Math.max(1, Math.round(l.largo / ANCHO_BAHIA)), w = l.largo / nb;
    const local = b.uso === 1 && b.pisos >= 1;
    const estiloAlto = Math.floor(b.hash * 4 * 97) % 4;                       // ventana, balcón, persiana o doble
    const TIPO_ALTO = [3, 4, 5, 6][estiloAlto === 1 && pisos < 2 ? 0 : estiloAlto];
    const cuadro = (u: [number, number, number, number], a: number, c: number, y0: number, y1: number) => {
      const ax = l.x0 + l.dx * a + l.nx * eps, az = l.z0 + l.dz * a + l.nz * eps, bx = l.x0 + l.dx * c + l.nx * eps, bz = l.z0 + l.dz * c + l.nz * eps;
      const v = t!.pos.length / 3;
      t!.pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
      t!.uv.push(u[0], u[1], u[2], u[1], u[2], u[3], u[0], u[3]);
      for (let q = 0; q < 4; q++) { t!.nor.push(l.nx, 0, l.nz); t!.ids.push(b.id); t!.pesos.push(b.peso); }
      t!.idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    };
    for (let f = 0; f < pisos; f++) {
      const y0 = b.suelo + f * alto, y1 = y0 + alto;
      if (f === 0 && local) {
        const tipo = Math.floor(b.hash * 12 * 31) % NEGOCIOS_ATLAS.length;
        cuadro(celdaLocal(tipo * 2 + (b.n % 2)), 0, l.largo, y0, y1);
        continue;
      }
      for (let k = 0; k < nb; k++) {
        let tipo: number;
        if (f === 0) tipo = k === Math.floor(nb / 2) ? 1 : nb > 1 && k === 0 && b.hash > 0.8 ? 2 : 0;
        else tipo = b.hash * 10 % 1 > 0.88 && k % 2 ? 7 : TIPO_ALTO;
        cuadro(celdaBahia(tipo, b.pal), k * w, (k + 1) * w, y0, y1);
      }
    }
  }

  /** Una malla de fachadas por tesela: solo se dibuja cuando la cámara está cerca. */
  private montarFachadas(mapa: Map<number, TeselaFachada>): void {
    this.mallasFachadas = [];
    if (!mapa.size) return;
    this.atlasFachadas ??= crearAtlasFachadas();
    this.matFachadas ??= new THREE.MeshStandardMaterial({ map: this.atlasFachadas, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const t of mapa.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
      geo.setIndex(t.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(t.idx, 1) : new THREE.Uint16BufferAttribute(t.idx, 1));
      this.acolchar(geo);
      const malla = new THREE.Mesh(geo, this.matFachadas);
      malla.receiveShadow = true;
      malla.visible = false;
      this.escena.add(malla);
      this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, t.ids, t.pesos);
      const capa = this.capas[this.capas.length - 1];
      this.capasEdificios.push(capa);
      // llegan después del cambio de año: si hay veredas levantadas, suben con ellas
      this.alzado.forEach((alto, id) => {
        for (const k of capa.porPieza[id] ?? []) capa.atributo.setY(k, capa.base[k] + alto * capa.peso[k]);
      });
      capa.atributo.needsUpdate = true;
      this.mallasFachadas.push({ malla, centro: new THREE.Vector3(t.sx / t.k, 0, t.sz / t.k) });
    }
  }

  /** Las fachadas detalladas solo existen para la cámara que está cerca de la tesela. */
  private actualizarFachadas(): void {
    const cam = this.camara.position;
    for (const f of this.mallasFachadas) {
      const dx = cam.x - f.centro.x, dz = cam.z - f.centro.z;
      f.malla.visible = Math.hypot(dx, cam.y * 0.5, dz) < DISTANCIA_FACHADA;
    }
  }

  /**
   * Cercas sobre los linderos de los predios del catastro: una cinta vertical con textura recortada (muro con reja, tapia, portón,
   * alambre de púas, madera, malla o cerca viva) que sigue el terreno. Se arman en lotes entre fotogramas y solo se dibujan cerca.
   */
  private construirCercas(d: Cercas | null): void {
    if (!d) return;
    this.texCercas ??= crearTexturaCercas();
    this.matCercas ??= new THREE.MeshStandardMaterial({ map: this.texCercas, alphaTest: 0.5, vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide });
    const trabajos: { l: number[]; urbano: boolean; n: number }[] = [
      ...d.u.map((l, n) => ({ l, urbano: true, n })), ...d.r.map((l, n) => ({ l, urbano: false, n: n + 100000 })),
    ];
    const mapa = new Map<number, TeselaCerca>();
    const cache = new Map<number, [number, number]>();
    let i = 0;
    const paso = () => {
      const t0 = performance.now();
      while (i < trabajos.length && performance.now() - t0 < 6) {
        const w = trabajos[i++];
        this.agregarCerca(mapa, cache, this.desdeDeltas(w.l, d.k, 0), w.urbano, w.n);
      }
      if (i < trabajos.length) setTimeout(paso, 0);
      else this.montarCercas(mapa);
    };
    setTimeout(paso, 0);
  }

  private agregarCerca(mapa: Map<number, TeselaCerca>, cache: Map<number, [number, number]>, linea: [number, number][], urbano: boolean, n: number): void {
    const azar = (((n + 1) * 2654435761) >>> 0) % 1000 / 1000;
    const tipos = urbano ? [0, 0, 1, 1, 2, 3] : [4, 4, 4, 5, 6, 7];   // urbano: muros, rejas y portones; rural: alambre, madera, malla y seto
    const tipo = tipos[Math.floor(azar * tipos.length)];
    const alto = urbano ? 3.4 : tipo === 7 ? 2.2 : 2.6;
    const conMuro = tipo === 0 || tipo === 1 || tipo === 3;
    const tono = conMuro ? CERCA_COLORES[Math.floor(((azar * 7919) % 1) * CERCA_COLORES.length)] : CERCA_BLANCO;
    const [v0, v1] = filaCerca(tipo);
    const paso = urbano ? 5 : 12;
    let t: TeselaCerca | undefined, clave = -1, dist = 0, ant: [number, number, number, number, number] | null = null, corrida = false;
    const punto = (lon: number, lat: number, x: number, z: number): void => {
      const y = this.alturaEn(lon, lat);
      const k = Math.floor((x + this.ancho / 2) / TESELA_CERCA) + Math.floor((z + this.alto / 2) / TESELA_CERCA) * 1000;
      const largo = ant ? Math.hypot(x - ant[0], z - ant[1]) : 0;
      dist += largo;
      const ck = k * 2 + (urbano ? 1 : 0);
      if (ck !== clave) {                                  // la cinta cambia de tesela: se corta y se sigue desde el punto anterior
        clave = ck;
        t = mapa.get(ck) ?? mapa.set(ck, { pos: [], uv: [], col: [], idx: [], ids: [], pesos: [], sx: 0, sz: 0, k: 0, urbano }).get(ck)!;
        corrida = false;
        if (ant) { this.vertCerca(t, cache, ant[0], ant[1], ant[2], alto, (dist - largo) / PERIODO_CERCA, v0, v1, tono, ant[3], ant[4], false); corrida = true; }
      }
      this.vertCerca(t!, cache, x, z, y, alto, dist / PERIODO_CERCA, v0, v1, tono, lon, lat, corrida);
      corrida = true;
      t!.sx += x; t!.sz += z; t!.k++;
      ant = [x, z, y, lon, lat];
    };
    for (let i = 0; i + 1 < linea.length; i++) {
      const [lo0, la0] = linea[i], [lo1, la1] = linea[i + 1];
      const x0 = this.aX(lo0), z0 = this.aZ(la0), x1 = this.aX(lo1), z1 = this.aZ(la1);
      const pasos = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / paso));
      for (let s = i === 0 ? 0 : 1; s <= pasos; s++) {
        const f = s / pasos;
        punto(lo0 + (lo1 - lo0) * f, la0 + (la1 - la0) * f, x0 + (x1 - x0) * f, z0 + (z1 - z0) * f);
      }
    }
  }

  /** Dos vértices (pie y remate) de la cinta; si `unir`, también los dos triángulos que la cierran con el par anterior. */
  private vertCerca(t: TeselaCerca, cache: Map<number, [number, number]>, x: number, z: number, y: number, alto: number, u: number, v0: number, v1: number,
    c: THREE.Color, lon: number, lat: number, unir: boolean): void {
    const ck = Math.floor(x / 40) + Math.floor(z / 40) * 100000;
    let ip = cache.get(ck);
    if (!ip) {
      const id = this.idEn(lon, lat);
      cache.set(ck, ip = [id, id >= 0 ? this.pesoBorde(lon, lat, id) : 0]);
    }
    const a = t.pos.length / 3;
    t.pos.push(x, y - 0.4, z, x, y + alto, z);
    t.uv.push(u, v0, u, v1);
    t.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    t.ids.push(ip[0], ip[0]); t.pesos.push(ip[1], ip[1]);
    if (unir) t.idx.push(a - 2, a - 1, a + 1, a - 2, a + 1, a);
  }

  private montarCercas(mapa: Map<number, TeselaCerca>): void {
    for (const t of mapa.values()) {
      if (!t.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
      geo.setIndex(t.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(t.idx, 1) : new THREE.Uint16BufferAttribute(t.idx, 1));
      this.acolchar(geo);
      const malla = new THREE.Mesh(geo, this.matCercas);
      malla.visible = false;
      this.escena.add(malla);
      this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, t.ids, t.pesos);
      const capa = this.capas[this.capas.length - 1];
      this.alzado.forEach((alto, id) => {
        for (const k of capa.porPieza[id] ?? []) capa.atributo.setY(k, capa.base[k] + alto * capa.peso[k]);
      });
      capa.atributo.needsUpdate = true;
      this.mallasCercas.push({ malla, centro: new THREE.Vector3(t.sx / t.k, 0, t.sz / t.k), alcance: t.urbano ? DISTANCIA_CERCA_URBANA : DISTANCIA_CERCA_RURAL });
    }
  }

  /** Las cercas de una tesela solo se dibujan con la cámara cerca. */
  private actualizarCercas(): void {
    const cam = this.camara.position;
    for (const f of this.mallasCercas) {
      f.malla.visible = Math.hypot(cam.x - f.centro.x, cam.y * 0.5, cam.z - f.centro.z) < f.alcance;
    }
  }

  /** Patios y jardines de los predios urbanos: césped o patio a ras del terreno, con matas y flores repartidas. */
  private async construirJardines(d: Jardines | null): Promise<void> {
    if (!d?.j.length) return;
    const CESPED = ['#6fb050', '#78b857', '#68a84b', '#82c061'].map(c => new THREE.Color(c));
    const PATIO = ['#b9a98a', '#a8a79f', '#c2b59b'].map(c => new THREE.Color(c));
    const VERDES = ['#2f7d32', '#3c8d40', '#4a9a45', '#2a7030'].map(c => new THREE.Color(c));
    const FLORES = ['#e53935', '#ec407a', '#fdd835', '#ab47bc', '#ff7043', '#f5f5f5'].map(c => new THREE.Color(c));
    const ALZA = 1.6;
    type Tesela = { pos: number[]; col: number[]; idx: number[]; ids: number[]; pesos: number[] };
    const teselas = new Map<number, Tesela>();
    const unJardin = (c: (typeof d.j)[number], n: number): void => {
      const ring = this.desdeDeltas(c, d.k, 0);
      if (ring.length < 3) return;
      const xs = ring.map(q => this.aX(q[0])), zs = ring.map(q => this.aZ(q[1]));
      const cLon = ring.reduce((a, q) => a + q[0], 0) / ring.length, cLat = ring.reduce((a, q) => a + q[1], 0) / ring.length;
      if (this.bajoHuellaEquipamiento(this.aX(cLon), this.aZ(cLat))) return;      // el césped no cubre el modelo que reemplaza a esa parte de la manzana
      const id = this.idEn(cLon, cLat), peso = id >= 0 ? this.pesoBorde(cLon, cLat, id) : 0;
      const azar = (((n + 1) * 2654435761) >>> 0) % 1000 / 1000;
      const patio = azar > 0.8;
      const suelo = patio ? PATIO[n % PATIO.length] : CESPED[n % CESPED.length];
      const clave = this.claveTesela(this.aX(cLon), this.aZ(cLat));
      let t = teselas.get(clave);
      if (!t) teselas.set(clave, t = { pos: [], col: [], idx: [], ids: [], pesos: [] });
      const { pos, col, idx, ids, pesos } = t;
      const poner = (x: number, y: number, z: number, k: THREE.Color) => {
        pos.push(x, y, z); col.push(k.r, k.g, k.b); ids.push(id); pesos.push(peso);
        return pos.length / 3 - 1;
      };
      const base = pos.length / 3;
      ring.forEach(([lo, la], i) => poner(xs[i], this.alturaEn(lo, la) + ALZA, zs[i], suelo));
      for (const [a, b, c2] of THREE.ShapeUtils.triangulateShape(ring.map((_, i) => new THREE.Vector2(xs[i], zs[i])), [])) idx.push(base + a, base + b, base + c2);
      if (patio) return;
      // matas: una pirámide baja y abierta por debajo; cerca de un tercio llevan flores
      const m = d.m[n] ?? [];
      for (let i = 0; i < m.length; i += 2) {
        const lo = m[i] / d.k, la = m[i + 1] / d.k, x = this.aX(lo), z = this.aZ(la), y = this.alturaEn(lo, la) + ALZA;
        const h = (((n * 31 + i) * 2654435761) >>> 0) % 1000 / 1000;
        const flor = h > 0.66, r = flor ? 1.1 : 1.5 + h * 1.2, alto = flor ? 1.5 : 2.6 + h * 1.5;
        const cima = flor ? FLORES[Math.floor(h * 100) % FLORES.length] : VERDES[Math.floor(h * 100) % VERDES.length];
        const aro = VERDES[(n + i) % VERDES.length];
        const v0 = poner(x, y + alto, z, cima);
        const giro = h * Math.PI;
        const anillo = [0, 1, 2, 3].map(q => poner(x + Math.cos(giro + q * Math.PI / 2) * r, y, z + Math.sin(giro + q * Math.PI / 2) * r, aro));
        for (let q = 0; q < 4; q++) idx.push(v0, anillo[q], anillo[(q + 1) % 4]);
      }
    };
    // por tandas de ~25 ms: son miles de predios y triangularlos de corrido congelaba la página varios segundos
    let t0 = performance.now();
    for (let n = 0; n < d.j.length; n++) {
      unJardin(d.j[n], n);
      if (performance.now() - t0 > 25) { if (await this.ceder()) return; t0 = performance.now(); }
    }
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide });
    for (const t of teselas.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
      geo.setIndex(t.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(t.idx, 1) : new THREE.Uint16BufferAttribute(t.idx, 1));
      this.acolchar(geo);
      const malla = new THREE.Mesh(geo, material);
      malla.receiveShadow = true;
      this.escena.add(malla);
      this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, t.ids, t.pesos);
    }
  }

  /** Si el punto cae dentro de la huella (rectángulo girado) de un equipamiento que reemplaza al catastro, como un parque o un parqueadero. */
  private bajoHuellaEquipamiento(x: number, z: number): boolean {
    return this.equipamientos.some(q => {
      const h = q.datos.modelo.huella;
      if (!h) return false;
      const dx = x - q.x, dz = z - q.z, yaw = q.yaw ?? 0;
      return Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) <= h[0] / 2 && Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw)) <= h[1] / 2;
    });
  }

  /** Árboles de los patios: puntos ya calculados con el catastro. */
  private async arbolesDeJardin(d: Jardines | null): Promise<{ lon: number; lat: number; x: number; z: number }[]> {
    const res: { lon: number; lat: number; x: number; z: number }[] = [];
    let n = 0;
    for (const a of d?.a ?? []) {
      if (++n % 120 === 0 && await this.ceder()) return res;   // por tandas: son miles de árboles y cada uno se compara con los equipamientos
      for (let i = 0; i < a.length; i += 2) {
        const lon = a[i] / d!.k, lat = a[i + 1] / d!.k;
        const x = this.aX(lon), z = this.aZ(lat);
        if (!this.bajoHuellaEquipamiento(x, z)) res.push({ lon, lat, x, z });
      }
    }
    return res;
  }

  /** Arbolado de calle: a ambos lados de las vías del tejido urbano, con huecos, sin pisar edificios, calzadas ni equipamientos. */
  private async arbolesDeCalle(vias: Compacto | null): Promise<{ lon: number; lat: number; x: number; z: number }[]> {
    if (!vias?.v) return [];
    const holgura = this.holguraVias(vias), rnd = mulberry32(777);
    // cuadrícula de 40 m con las cajas de los edificios para saber rápido si un punto cae sobre uno
    const CELDA = 40, rejilla = new Map<number, { x0: number; x1: number; z0: number; z1: number }[]>();
    for (const cajas of this.cajasViv.values()) {
      for (const c of cajas) {
        for (let i = Math.floor(c.x0 / CELDA); i <= Math.floor(c.x1 / CELDA); i++) {
          for (let j = Math.floor(c.z0 / CELDA); j <= Math.floor(c.z1 / CELDA); j++) (rejilla.get(i * 100003 + j) ?? rejilla.set(i * 100003 + j, []).get(i * 100003 + j)!).push(c);
        }
      }
    }
    const sobreEdificio = (x: number, z: number, m: number) =>
      (rejilla.get(Math.floor(x / CELDA) * 100003 + Math.floor(z / CELDA)) ?? []).some(c => x > c.x0 - m && x < c.x1 + m && z > c.z0 - m && z < c.z1 + m);
    const res: { lon: number; lat: number; x: number; z: number }[] = [];
    let nv = 0;
    for (const v of vias.v) {
      if (++nv % 25 === 0 && await this.ceder()) return res;
      if (v[0] > 1) continue;
      const pts = this.desdeDeltas(v, vias.k, 1).map(q => [this.aX(q[0]), this.aZ(q[1])]);
      const lado = ANCHO_VIA[v[0]] / 2 + 2.6;
      let falta = rnd() * PASO_ARBOL_CALLE;
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i], largo = Math.hypot(bx - ax, bz - az);
        if (!largo) continue;
        const nx = -(bz - az) / largo, nz = (bx - ax) / largo;
        let t = falta;
        for (; t < largo; t += PASO_ARBOL_CALLE * (0.75 + rnd() * 0.5)) {
          for (const sg of [-1, 1]) {
            if (rnd() > FRACCION_ARBOL_CALLE) continue;
            let l = lado;
            if (this.rasante) {
              // con rasante, a mitad de la acera de ese lado; si la acera es muy angosta para un árbol, no va
              const px = ax + (bx - ax) * t / largo, pz = az + (bz - az) * t / largo;
              const w = this.rasante.anchos(px, pz, (bx - ax) / largo, (bz - az) / largo);
              if (!w) continue;
              const [cal, ace] = sg > 0 ? [w[0], w[2]] : [w[1], w[3]];
              if (ace - cal < 1.6) continue;
              l = (cal + ace) / 2;
            }
            const x = ax + (bx - ax) * t / largo + nx * l * sg, z = az + (bz - az) * t / largo + nz * l * sg;
            const lon = this.lon0 + x / this.mLon, lat = this.lat0 - z / this.mLat;
            if (!this.esUrbano(lon, lat) || holgura(x, z) < (this.rasante ? 0.5 : 2) || sobreEdificio(x, z, this.rasante ? 0.8 : 1.5)) continue;
            if (this.fabricas.some(f => Math.hypot(f.x - x, f.z - z) < f.r + 4) || this.equipamientos.some(q => Math.hypot(q.x - x, q.z - z) < q.r + 3)) continue;
            res.push({ lon, lat, x, z });
          }
        }
        falta = t - largo;
      }
    }
    return res;
  }

  /** Tesela (cuadrícula de TESELA metros) a la que pertenece un punto del modelo. */
  private claveTesela(x: number, z: number): number {
    return Math.floor((x + this.ancho / 2) / TESELA) + Math.floor((z + this.alto / 2) / TESELA) * 1000;
  }

  /** Esfera de recorte con holgura: al levantar una vereda los vértices suben hasta ALZA_ELEGIDA metros. */
  private acolchar(geo: THREE.BufferGeometry): void {
    geo.computeBoundingSphere();
    geo.boundingSphere!.radius += ALZA_ELEGIDA + 30;
  }

  /** Costados de la "maqueta": una cortina que baja desde el borde del terreno. */
  private construirFaldon(pos: Float32Array, cx: number, cy: number): void {
    const base = -260;
    const de = (i: number, j: number) => (j * (cx + 1) + i) * 3;
    const borde: number[] = [];
    for (let i = 0; i <= cx; i++) borde.push(de(i, 0));
    for (let j = 1; j <= cy; j++) borde.push(de(cx, j));
    for (let i = cx - 1; i >= 0; i--) borde.push(de(i, cy));
    for (let j = cy - 1; j > 0; j--) borde.push(de(0, j));
    const v: number[] = [];
    for (let k = 0; k < borde.length; k++) {
      const a = borde[k], b = borde[(k + 1) % borde.length];
      v.push(pos[a], pos[a + 1], pos[a + 2], pos[a], base, pos[a + 2], pos[b], pos[b + 1], pos[b + 2],
        pos[b], pos[b + 1], pos[b + 2], pos[a], base, pos[a + 2], pos[b], base, pos[b + 2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#9a7d58', roughness: 1, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    this.escena.add(m);

    // base de la maqueta: cierra el fondo para verla desde abajo
    const tapa = new THREE.Mesh(new THREE.PlaneGeometry(this.ancho, this.alto),
      new THREE.MeshBasicMaterial({ color: '#8a6f4c', side: THREE.DoubleSide }));
    tapa.rotation.x = Math.PI / 2;
    tapa.position.y = base;
    this.escena.add(tapa);
  }

  /** Muro translúcido sobre el límite municipal: separa la "isla" de sus vecinos. */
  private construirBorde(contorno: Geometria, tono: number): void {
    const v: number[] = [];
    const linea: number[] = [];
    const ALTO = 220;
    for (const poligono of contorno) {
      const anillo = poligono[0];
      for (let i = 0; i < anillo.length; i++) {
        const [la, lo] = anillo[i];
        const [lb, lob] = anillo[(i + 1) % anillo.length];
        const ya = this.alturaEn(lo, la), yb = this.alturaEn(lob, lb);
        const ax = this.aX(lo), az = this.aZ(la), bx = this.aX(lob), bz = this.aZ(lb);
        v.push(ax, ya, az, ax, ya + ALTO, az, bx, yb, bz, bx, yb, bz, ax, ya + ALTO, az, bx, yb + ALTO, bz);
        linea.push(ax, ya + ALTO, az, bx, yb + ALTO, bz);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    const muro = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL((((tono % 360) + 360) % 360) / 360, 0.65, 0.5),
      transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.escena.add(muro);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linea, 3));
    const lineaBorde = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#ffffff' }));
    this.escena.add(lineaBorde);
    this.bordeMunicipio = [muro, lineaBorde];
  }

  private construirLuces(): void {
    this.escena.add(new THREE.HemisphereLight('#ffffff', '#a8b090', 1.9));
    const sol = new THREE.DirectionalLight('#fff6e8', 1.9);
    sol.castShadow = true;
    sol.shadow.mapSize.set(4096, 4096);
    sol.shadow.camera.near = 1000;
    sol.shadow.camera.far = 40000;
    sol.shadow.bias = -0.0004;
    this.sol = sol;
    this.escena.add(sol, sol.target);
    this.actualizarSombras();
  }

  /**
   * Nubes tipo cúmulo: cada una es un racimo de bocanadas (sprites con ruido fractal, iluminadas desde el sol en la
   * propia textura y teñidas según su altura y su lado). El viento cambia solo, con ráfagas y calmas: con ráfaga la
   * nube se estira a favor de su dirección, se aclara y se deshace; en calma se recoge y las vecinas se atraen.
   */
  private construirNubes(): void {
    this.texturasNubes = [11, 23, 37, 51].map(s => this.texturaBocanada(s));
    const rnd = mulberry32(2024);
    const techo = (this.relieve.max - this.relieve.min) * EXAGERACION;
    const limX = this.ancho / 2 + MARGEN_NUBES, limZ = this.alto / 2 + MARGEN_NUBES;
    const sol = new THREE.Vector2(SOL_DIRECCION.x, SOL_DIRECCION.z).normalize();
    // el tamaño sale de la cobertura: el área visible de un cúmulo ronda 5,5 radios²
    const radioBase = Math.sqrt(COBERTURA_NUBES * this.ancho * this.alto / NUBES / 5.5);

    for (let i = 0; i < NUBES; i++) {
      const radio = radioBase * (0.78 + rnd() * 0.44);
      const nube: Nube = {
        x: CUMULOS[i].x * (this.ancho / 2 + 1500), z: CUMULOS[i].z * (this.alto / 2 + 1500),
        y: techo + ALTURA_NUBES[0] + rnd() * (ALTURA_NUBES[1] - ALTURA_NUBES[0]),
        radio, nivel: CUMULOS[i].nivel, dispersion: CUMULOS[i].nivel ** 2, bocanadas: [],
      };
      for (let k = 0; k < BOCANADAS; k++) {
        const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
        const ox = Math.cos(ang) * r * radio * 1.35, oz = Math.sin(ang) * r * radio * 0.8;
        // abultada al centro y plana por debajo, como un cúmulo
        const alto = (1 - r * r) * radio * 0.34 * (0.35 + rnd() * 0.9);
        const oy = alto - radio * 0.08;
        const h = Math.min(1, Math.max(0, alto / (radio * 0.34)));
        const lado = Math.max(-1, Math.min(1, ((ox * sol.x + oz * sol.y) / (radio * 1.35))));
        const claridad = Math.min(1, Math.max(0, 0.62 + 0.3 * h + 0.15 * lado));
        const color = new THREE.Color('#c4dcf5').lerp(new THREE.Color('#fffdf9'), claridad);
        const material = new THREE.SpriteMaterial({
          map: this.texturasNubes[Math.floor(rnd() * this.texturasNubes.length)],
          color, transparent: true, depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = 10;
        this.escena.add(sprite);
        nube.bocanadas.push({
          sprite, ox, oy, oz, rot0: (rnd() - 0.5) * Math.PI * 2,
          tamano: radio * (0.75 + rnd() * 0.7) * (1.15 - r * 0.45),
          opacidad: 0.38 + rnd() * 0.27, fase: rnd() * Math.PI * 2, giro: (rnd() - 0.5) * 0.05,
        });
      }
      this.nubes.push(nube);
    }

    // disco solar: un halo aditivo muy lejano que sigue a la cámara, solo se ve al mirar hacia el sol
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,252,240,1)');
    g.addColorStop(0.08, 'rgba(255,244,214,.95)');
    g.addColorStop(0.25, 'rgba(255,226,170,.28)');
    g.addColorStop(1, 'rgba(255,220,160,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    const textura = new THREE.CanvasTexture(c);
    textura.colorSpace = THREE.SRGBColorSpace;
    this.texturasNubes.push(textura);
    this.disco = new THREE.Sprite(new THREE.SpriteMaterial({
      map: textura, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    }));
    this.disco.scale.setScalar(16000);
    this.disco.renderOrder = 11;
    this.escena.add(this.disco);
    this.animarNubes(0);
  }

  /** Bocanada de nube: ruido fractal con borde que se desvanece, y un sombreado hacia la luz (arriba a la izquierda) horneado. */
  private texturaBocanada(semilla: number): THREE.CanvasTexture {
    const N = 192;
    const hash = (x: number, y: number) => {
      let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(semilla, 982451653);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const valor = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v;
    };
    const fbm = (x: number, y: number) => {
      let a = 0.5, s = 0, f = 1;
      for (let o = 0; o < 5; o++) { s += a * valor(x * f, y * f); f *= 2.03; a *= 0.5; }
      return s;
    };
    const dens = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const px = (i / (N - 1)) * 2 - 1, py = (j / (N - 1)) * 2 - 1;
        const caida = 1 - Math.min(1, Math.max(0, (Math.hypot(px, py) - 0.3) / 0.7));
        const d = Math.min(1, Math.max(0, fbm(px * 2.4 + 7, py * 2.4 + 7) * 2.1 * caida * caida * (3 - 2 * caida) - 0.3));
        dens[j * N + i] = d * d * (3 - 2 * d);
      }
    }
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const d = dens[j * N + i];
        const hacia = dens[Math.max(0, j - 6) * N + Math.max(0, i - 4)];     // lo que hay del lado de la luz
        const lum = Math.min(1.05, Math.max(0.74, 0.9 + (d - hacia) * 1.4));
        const k = (j * N + i) * 4;
        img.data[k] = Math.min(255, 255 * lum * (0.93 + 0.07 * lum));
        img.data[k + 1] = Math.min(255, 255 * lum * (0.96 + 0.04 * lum));
        img.data[k + 2] = Math.min(255, 255 * lum);
        img.data[k + 3] = 255 * d;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /**
   * Niebla de valle: busca los hundimientos del relieve (puntos más bajos que su entorno a ~1,5 km) y deja en cada uno
   * unas cuantas bandas muy tenues y planas, a ras de monte. Se espesan y se aclaran despacio, y se apagan al
   * acercarse la cámara para no tapar el detalle.
   */
  private construirNiebla(): void {
    const mitX = this.ancho / 2 - 800, mitZ = this.alto / 2 - 800;
    const altoEn = (x: number, z: number) => this.alturaEn(this.lon0 + x / this.mLon, this.lat0 - z / this.mLat);
    const candidatos: { x: number; z: number; h: number; hondo: number }[] = [];
    for (let x = -mitX; x <= mitX; x += 400) {
      for (let z = -mitZ; z <= mitZ; z += 400) {
        const h = altoEn(x, z);
        let entorno = 0;
        for (const [cx, cy] of DIRECCIONES) entorno += altoEn(x + cx * 1500, z + cy * 1500);
        candidatos.push({ x, z, h, hondo: entorno / DIRECCIONES.length - h });
      }
    }
    candidatos.sort((a, b) => b.hondo - a.hondo);
    const elegidos: typeof candidatos = [];
    for (const c of candidatos) {
      if (elegidos.length >= NIEBLA_PUNTOS || c.hondo < 40) break;
      if (elegidos.every(e => Math.hypot(e.x - c.x, e.z - c.z) > 2600)) elegidos.push(c);
    }
    // la niebla que caía sobre San Esteban, El Paraíso y Loma de los Ochoa se muda a La Holanda
    const centro = (nombre: string) => this.centroDe(nombre);
    const origen = ['San Esteban', 'El Paraíso', 'Loma de los Ochoa'].map(centro).filter((c): c is { x: number; z: number } => !!c);
    const destino = centro('La Holanda');
    if (destino) {
      let mudadas = 0;
      for (const c of elegidos) {
        if (!origen.some(o => Math.hypot(o.x - c.x, o.z - c.z) < 2800)) continue;
        const ang = mudadas++ * 2.4;
        c.x = destino.x + Math.cos(ang) * 700 * Math.min(mudadas - 1, 1);
        c.z = destino.z + Math.sin(ang) * 700 * Math.min(mudadas - 1, 1);
        c.h = altoEn(c.x, c.z);
      }
    }
    const rnd = mulberry32(77);
    for (const c of elegidos) {
      for (let k = 0; k < 6; k++) {
        const material = new THREE.SpriteMaterial({
          map: this.texturasNubes[Math.floor(rnd() * 4)], color: '#f1f6fc', transparent: true, depthWrite: false, opacity: 0,
        });
        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = 9;
        this.escena.add(sprite);
        const x = c.x + (rnd() - 0.5) * 1400, z = c.z + (rnd() - 0.5) * 1400;
        const dy = 70 + rnd() * 110;
        this.nieblas.push({ sprite, x, z, x0: x, z0: z, dy, y: altoEn(x, z) + dy, ancho: 2200 + rnd() * 1800, fase: rnd() * Math.PI * 2 });
      }
    }
    this.animarNiebla(0);
  }

  /**
   * La niebla viaja despacio con el viento y se escurre hacia lo bajo del relieve (sigue el gradiente cuesta abajo).
   * Pegada al suelo, sube y baja con él; se espesa donde el terreno se hunde y se desvanece sobre lomas y cimas.
   * Al alejarse mucho de su origen se funde y vuelve a formarse allí, así que el ciclo no termina.
   */
  private animarNiebla(dt: number): void {
    const t = performance.now() / 1000;
    const cam = this.camara?.position;
    const { rumbo } = this.vientoEn(t);
    const dx = Math.cos(rumbo), dz = Math.sin(rumbo);
    const mitX = this.ancho / 2, mitZ = this.alto / 2;
    const alto = (x: number, z: number) => this.alturaEn(this.lon0 + x / this.mLon, this.lat0 - z / this.mLat);
    const R = 700;
    for (const n of this.nieblas) {
      const h = alto(n.x, n.z);
      const hE = alto(n.x + R, n.z), hO = alto(n.x - R, n.z), hS = alto(n.x, n.z + R), hN = alto(n.x, n.z - R);
      // hacia abajo del relieve (pendiente limitada) más una brisa lenta; en llano solo manda el viento
      const gx = Math.max(-0.6, Math.min(0.6, (hE - hO) / (2 * R))), gz = Math.max(-0.6, Math.min(0.6, (hS - hN) / (2 * R)));
      n.x += (dx * VELOCIDAD_NIEBLA - gx * 70) * dt;
      n.z += (dz * VELOCIDAD_NIEBLA - gz * 70) * dt;
      const lejos = Math.hypot(n.x - n.x0, n.z - n.z0);
      const salio = Math.abs(n.x) > mitX || Math.abs(n.z) > mitZ;
      if (lejos > 3400 || salio) { n.x = n.x0; n.z = n.z0; }
      n.sprite.position.set(n.x + Math.sin(t * 0.02 + n.fase) * 160, n.y += (h + n.dy - n.y) * Math.min(1, dt * 2) || 0, n.z + Math.cos(t * 0.017 + n.fase * 1.3) * 120);
      n.sprite.scale.set(n.ancho, n.ancho * 0.34, 1);
      // más densa donde el terreno se hunde respecto de su entorno; casi nada sobre lomas
      const hondo = (hE + hO + hS + hN) / 4 - h;
      const valle = Math.min(1, Math.max(0, (hondo + 5) / 45));
      const ciclo = 1 - Math.min(1, Math.max(0, (lejos - 2300) / 1100));      // se funde antes de reiniciarse
      const nace = Math.min(1, lejos / 500);                                    // y se forma poco a poco
      const respira = 0.72 + 0.28 * Math.sin(t * 0.035 + n.fase * 2);
      const cerca = cam ? Math.min(1, Math.max(0, (cam.distanceTo(n.sprite.position) - 1800) / 3500)) : 1;
      (n.sprite.material as THREE.SpriteMaterial).opacity = NIEBLA_OPACIDAD * respira * cerca * (0.25 + 0.75 * valle) * ciclo * Math.max(nace, 0.35);
    }
  }

  /**
   * Tráfico: autos de colores que circulan por las vías principales y, en el pueblo, por todas sus calles.
   *  - Doble calzada: tramos de vía principal con otro tramo paralelo en sentido contrario (OSM dibuja cada calzada en su
   *    sentido de marcha). Fuera del pueblo los autos dan vueltas por cada calzada, uno cada ~200 m, en tres carriles.
   *  - Pueblo: en un radio alrededor de Girardota las vías forman una red (se parten en los puntos que comparten). Cada
   *    auto avanza por una arista y, al llegar a un cruce, elige por dónde seguir; en la doble calzada solo en su sentido,
   *    y en las demás vías en ambos, por el carril derecho. Así entran desde la autopista y recorren las calles.
   * Los vehículos son los modelos del catálogo (auto, taxi, campero FJ, bus y camión con tráiler), repartidos entre los autos
   * de siempre: el camión solo va por vías principales, el FJ solo por veredas y el resto por cualquier vía. Cada tipo va en
   * mallas instanciadas propias.
   */
  private construirTrafico(vias: Compacto): void {
    type Muestra = { x: number; z: number; tx: number; tz: number; p: number };
    const polis: [number, number][][] = [];
    const locales: [number, number][][] = [];
    for (const v of vias.v!) {
      if (v[0] > 1) continue;
      const l = this.desdeDeltas(v, vias.k, 1).map(q => [this.aX(q[0]), this.aZ(q[1])] as [number, number]);
      if (l.length < 2) continue;
      (v[0] === 0 ? polis : locales).push(l);
    }
    // muestras cada ~30 m con su tangente, agrupadas en celdas de 100 m
    const celdas = new Map<number, Muestra[]>();
    const porPoli: Muestra[][] = polis.map(() => []);
    const clave = (x: number, z: number) => Math.floor(x / 100) * 100003 + Math.floor(z / 100);
    polis.forEach((l, p) => {
      for (let i = 1; i < l.length; i++) {
        const dx = l[i][0] - l[i - 1][0], dz = l[i][1] - l[i - 1][1], largo = Math.hypot(dx, dz);
        if (largo < 1e-6) continue;
        const n = Math.max(1, Math.ceil(largo / 30));
        for (let j = 0; j < n; j++) {
          const m: Muestra = { x: l[i - 1][0] + dx * j / n, z: l[i - 1][1] + dz * j / n, tx: dx / largo, tz: dz / largo, p };
          porPoli[p].push(m);
          const k = clave(m.x, m.z);
          (celdas.get(k) ?? celdas.set(k, []).get(k)!).push(m);
        }
      }
    });
    // doble calzada = la mayor parte del tramo tiene vecino a 6–80 m en sentido contrario
    const dobles = new Set<number>();
    porPoli.forEach((ms, p) => {
      if (ms.length < 8) return;
      let hits = 0;
      for (const m of ms) {
        const ci = Math.floor(m.x / 100), cj = Math.floor(m.z / 100);
        let hay = false;
        for (let di = -1; di <= 1 && !hay; di++) {
          for (let dj = -1; dj <= 1 && !hay; dj++) {
            for (const o of celdas.get((ci + di) * 100003 + cj + dj) ?? []) {
              if (o.p === p) continue;
              const d = Math.hypot(o.x - m.x, o.z - m.z);
              if (d >= 6 && d <= 80 && m.tx * o.tx + m.tz * o.tz < -0.6) { hay = true; break; }
            }
          }
        }
        if (hay) hits++;
      }
      if (hits / ms.length > 0.5) dobles.add(p);
    });

    /** Una polilínea densificada (un punto cada ~15 m) con la altura de la vía en cada uno. */
    const densificar = (l: [number, number][]) => {
      const x: number[] = [], z: number[] = [], y: number[] = [], cum: number[] = [];
      let recorrido = 0;
      const agregar = (px: number, pz: number) => {
        if (x.length) recorrido += Math.hypot(px - x[x.length - 1], pz - z[z.length - 1]);
        x.push(px); z.push(pz); y.push(this.calzadaXZ(px, pz)); cum.push(recorrido);
      };
      agregar(l[0][0], l[0][1]);
      for (let i = 1; i < l.length; i++) {
        const n = Math.max(1, Math.ceil(Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]) / 15));
        for (let j = 1; j <= n; j++) agregar(l[i - 1][0] + (l[i][0] - l[i - 1][0]) * j / n, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * j / n);
      }
      const c: Calzada = { x, z, y, cum, largo: recorrido };
      if (this.rasante) {
        // anchos por punto: los carriles y las aceras se acomodan a la calle angosta
        c.lp = []; c.ln = []; c.ap = []; c.an = [];
        for (let i = 0; i < x.length; i++) {
          const a = Math.max(0, i - 1), b = Math.min(x.length - 1, i + 1), L = Math.hypot(x[b] - x[a], z[b] - z[a]) || 1;
          const w = this.rasante.anchos(x[i], z[i], (x[b] - x[a]) / L, (z[b] - z[a]) / L);
          c.lp.push(w?.[0] ?? Infinity); c.ln.push(w?.[1] ?? Infinity); c.ap.push(w?.[2] ?? Infinity); c.an.push(w?.[3] ?? Infinity);
        }
      }
      return c;
    };

    // ── red del pueblo ──
    const centro = this.centroDe('Girardota') ?? { x: 0, z: 0 };
    const enPueblo = (l: [number, number][]) => l.some(q => Math.hypot(q[0] - centro.x, q[1] - centro.z) < RADIO_PUEBLO);
    const red: { l: [number, number][]; unico: boolean; vf: number; poli: number }[] = [];
    polis.forEach((l, p) => { if (enPueblo(l)) red.push({ l, unico: dobles.has(p), vf: 1, poli: p }); });
    for (const l of locales) if (enPueblo(l)) red.push({ l, unico: false, vf: 0.55, poli: -1 });
    const llave = (q: [number, number]) => `${Math.round(q[0])},${Math.round(q[1])}`;
    const uso = new Map<string, number>();
    for (const r of red) for (const q of r.l) uso.set(llave(q), (uso.get(llave(q)) ?? 0) + 1);
    // cada vía se parte en los vértices que comparten con otra (los cruces) y en sus extremos
    for (const r of red) {
      let desde = 0;
      for (let i = 1; i < r.l.length; i++) {
        if (i < r.l.length - 1 && (uso.get(llave(r.l[i])) ?? 0) < 2) continue;
        const tramo = r.l.slice(desde, i + 1);
        desde = i;
        if (tramo.length < 2) continue;
        const d = densificar(tramo);
        if (d.largo < 5) continue;
        const idx = this.aristas.length;
        const ini = llave(tramo[0]), fin = llave(tramo[tramo.length - 1]);
        const mitad = d.x.length >> 1;
        this.aristas.push({ ...d, unico: r.unico, vf: r.vf, ini, fin, rural: this.esRural(d.x[mitad], d.z[mitad]) });
        for (const k of new Set([ini, fin])) (this.nodos.get(k) ?? this.nodos.set(k, []).get(k)!).push(idx);
      }
    }

    this.construirGente();

    // ── autos ──
    const rnd = mulberry32(900);
    const porTipo = FLOTA.map(() => 0);
    /** Tipo de vehículo para una vía: el camión solo en principales y el FJ solo en veredas; el resto va por cualquiera. */
    const elegir = (principal: boolean, rural: boolean): number => {
      let r = rnd();
      for (const [t, p] of MEZCLA_FLOTA) {
        if (((t === CAMION || t === BUS) && !principal) || (t === FJ && !rural)) continue;
        if (r < p) return t;
        r -= p;
      }
      return AUTO;
    };
    // fuera del pueblo, las calzadas dobles dan vueltas por su propio tramo (todas son vías principales)
    const enRed = new Set(red.filter(r => r.poli >= 0).map(r => r.poli));
    for (const p of dobles) {
      if (enRed.has(p)) continue;
      const d = densificar(polis[p]);
      if (d.largo < 150) continue;
      this.calzadas.push(d);
      // el FJ solo la recorre si casi todo su trazado pasa por veredas
      let veredales = 0;
      for (let i = 0; i < d.x.length; i += 4) if (this.esRural(d.x[i], d.z[i])) veredales++;
      const rural = veredales / Math.ceil(d.x.length / 4) > 0.7;
      const n = Math.max(1, Math.round(d.largo / TRAFICO_ESPACIO));
      for (let a = 0; a < n; a++) {
        const tipo = elegir(true, rural);
        this.autos.push({
          calzada: this.calzadas.length - 1, s: rnd() * d.largo, i: 0,
          v: TRAFICO_VELOCIDAD[0] + rnd() * (TRAFICO_VELOCIDAD[1] - TRAFICO_VELOCIDAD[0]),
          carril: [-8, 0, 8][Math.floor(rnd() * 3)], tipo, k: porTipo[tipo]++,
        });
      }
    }
    this.viasPermitidas = FLOTA.map((_, t) => this.aristas.flatMap((e, i) => this.admite(t, e) ? [i] : []));
    // en el pueblo, autos repartidos por las aristas según su largo
    const total = this.aristas.reduce((t, e) => t + e.largo, 0);
    const nRed = Math.round(total / TRAFICO_ESPACIO_PUEBLO);
    const acumulado: number[] = [];
    this.aristas.reduce((t, e, i) => (acumulado[i] = t + e.largo), 0);
    for (let a = 0; a < nRed; a++) {
      const q = rnd() * total;
      const arista = Math.max(0, acumulado.findIndex(c => c >= q));
      const e = this.aristas[arista];
      const tipo = elegir(e.vf === 1, e.rural);
      this.autosRed.push({
        arista, s: rnd() * e.largo, i: 0, dir: e.unico || rnd() < 0.5 ? 1 : -1,
        v: TRAFICO_VELOCIDAD[0] + rnd() * (TRAFICO_VELOCIDAD[1] - TRAFICO_VELOCIDAD[0]), carril: [-8, 0, 8][Math.floor(rnd() * 3)],
        tipo, k: porTipo[tipo]++,
      });
    }
    this.crearRutasVeredales(rnd, porTipo);
    if (!this.autos.length && !this.autosRed.length) return;

    // un juego de mallas instanciadas por tipo de vehículo, con los modelos del catálogo (color por vértice); en el auto,
    // la carrocería es una malla aparte que toma el color de cada auto
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide });
    this.matAutos = [material];
    this.geoAutos = [];
    const color = new THREE.Color();
    this.flota = FLOTA.map((nombre, t) => {
      const cuenta = porTipo[t];
      if (!cuenta) return [];
      const piezas = modelarEquipamiento('vehiculos', 'Vehículo', nombre, () => 0.5).piezas;
      const tinta = t === AUTO ? COLOR_CARROCERIA_AUTO : t === FJ ? COLOR_CARROCERIA_FJ : '';
      const paleta = t === FJ ? COLORES_RURALES : COLORES_AUTOS;
      const pintadas = tinta ? piezas.filter(p => p.color === tinta).map(p => ({ ...p, color: '#ffffff' })) : [];
      const fijas = tinta ? piezas.filter(p => p.color !== tinta) : piezas;
      return [pintadas, fijas].flatMap(grupo => {
        const g = fusionarColoreado(grupo);
        if (!g) return [];
        this.geoAutos.push(g);
        const malla = new THREE.InstancedMesh(g, material, cuenta);
        malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        malla.frustumCulled = false;
        if (grupo === pintadas) for (let i = 0; i < cuenta; i++) malla.setColorAt(i, color.set(paleta[Math.floor(rnd() * paleta.length)]));
        this.escena.add(malla);
        return [malla];
      });
    });
    this.animarTrafico(0);
  }

  /**
   * Reparte la gente por las aceras de la red del pueblo (menos la doble calzada), unas 60 m de vía por persona, con un tope.
   * Cada tipo de persona va en una malla instanciada propia; `animarGente` solo llena las de la zona que se mira.
   */
  private construirGente(): void {
    const aceras = this.aristas.flatMap((e, i) => e.unico ? [] : [i]);
    if (!aceras.length || new URLSearchParams(location.search).has('singente')) return;   // ?singente: para medir el costo de la gente
    const rnd = mulberry32(1700);
    const total = aceras.reduce((t, i) => t + this.aristas[i].largo, 0);
    const acumulado: number[] = [];
    aceras.reduce((t, i, k) => (acumulado[k] = t + this.aristas[i].largo), 0);
    const porTipo = GENTE.map(() => 0);
    for (let a = 0, n = Math.min(GENTE_MAX, Math.round(total / GENTE_ESPACIO)); a < n; a++) {
      const q = rnd() * total;
      const arista = aceras[Math.max(0, acumulado.findIndex(c => c >= q))];
      const e = this.aristas[arista];
      let r = rnd(), tipo = HOMBRE;
      for (const [t, p] of MEZCLA_GENTE) {
        if (r < p) { tipo = t; break; }
        r -= p;
      }
      porTipo[tipo]++;
      this.gente.push({
        arista, s: rnd() * e.largo, i: 0, dir: rnd() < 0.5 ? 1 : -1,
        v: GENTE_VELOCIDAD[0] + rnd() * (GENTE_VELOCIDAD[1] - GENTE_VELOCIDAD[0]),
        lado: (rnd() < 0.5 ? -1 : 1) * GENTE_ACERA[e.vf < 1 ? 1 : 0],
        tipo, tinte: Math.floor(rnd() * TINTES_GENTE.length), fase: rnd() * Math.PI * 2,
      });
    }
    // concentración de gente en la plaza de mercado y en las centrales de transporte: recorre las aceras vecinas sin alejarse de ellas
    const campesino = GENTE.indexOf('Campesino');
    for (const [nombre, cuantos] of FOCOS_GENTE) {
      const f = SITIOS_FIJOS.get(nombre);
      if (!f) continue;
      const fx = this.aX(f.lng), fz = this.aZ(f.lat);
      const cerca: [number, number][] = [];
      for (const i of aceras) {
        const e = this.aristas[i];
        let m = Infinity, kq = 0;
        for (let q = 0; q < e.x.length; q++) { const d = Math.hypot(e.x[q] - fx, e.z[q] - fz); if (d < m) { m = d; kq = q; } }
        if (m < 55) cerca.push([i, e.cum[kq]]);
      }
      for (let a = 0; cerca.length && a < cuantos; a++) {
        const [arista, s0] = cerca[Math.floor(rnd() * cerca.length)], e = this.aristas[arista];
        let r = rnd(), tipo = r < 0.4 && campesino >= 0 ? campesino : HOMBRE;
        if (tipo === HOMBRE) for (const [t, p] of MEZCLA_GENTE) { if (r < p) { tipo = t; break; } r -= p; }
        porTipo[tipo]++;
        this.gente.push({
          ancla: true, arista, s: Math.min(e.largo, Math.max(0, s0 + (rnd() - 0.5) * 40)), i: 0, dir: rnd() < 0.5 ? 1 : -1,
          v: (GENTE_VELOCIDAD[0] + rnd() * (GENTE_VELOCIDAD[1] - GENTE_VELOCIDAD[0])) * 0.6,
          lado: (rnd() < 0.5 ? -1 : 1) * GENTE_ACERA[e.vf < 1 ? 1 : 0],
          tipo, tinte: Math.floor(rnd() * TINTES_GENTE.length), fase: rnd() * Math.PI * 2,
        });
      }
    }
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    this.matGente = material;
    // piernas y brazos se balancean en el vértice (atributo `miembro` del modelo, fase por persona): la GPU lo hace gratis
    material.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec3 miembro;
          attribute float aFase;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          if (miembro.x != 0.0) {
            float angN = miembro.x * sin(aFase) * miembro.z, cN = cos(angN), sN = sin(angN);
            objectNormal = vec3(objectNormal.x, objectNormal.y * cN - objectNormal.z * sN, objectNormal.y * sN + objectNormal.z * cN);
          }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          if (miembro.x != 0.0) {
            float ang = miembro.x * sin(aFase) * miembro.z, c = cos(ang), s = sin(ang), dy = transformed.y - miembro.y;
            transformed.y = miembro.y + dy * c - transformed.z * s;
            transformed.z = dy * s + transformed.z * c;
          }`);
    };
    this.mallasGente = GENTE.map((nombre, t) => {
      const g = porTipo[t] ? fusionarColoreado(modelarEquipamiento('gente', 'Persona', nombre, () => 0.5).piezas) : null;
      if (!g) return null;
      this.geoGente.push(g);
      g.setAttribute('aFase', new THREE.InstancedBufferAttribute(new Float32Array(porTipo[t]), 1).setUsage(THREE.DynamicDrawUsage));
      const malla = new THREE.InstancedMesh(g, material, porTipo[t]);
      malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      malla.setColorAt(0, new THREE.Color('#ffffff'));
      malla.frustumCulled = false;
      malla.count = 0;
      this.escena.add(malla);
      return malla;
    });
  }

  /**
   * Camina a la gente por las aceras y pinta solo la que está dentro de GENTE_RADIO del punto que se mira (al borde del radio
   * se encoge hasta desaparecer). Si la cámara está lejos de ese punto no se mueve ni se pinta a nadie.
   */
  private animarGente(dt: number): void {
    if (!this.gente.length) return;
    const centro = this.controles.target;
    if (this.camara.position.distanceTo(centro) > GENTE_DISTANCIA_MAX) {
      if (this.gentePintada) for (const m of this.mallasGente) if (m) m.count = 0;
      this.gentePintada = false;
      return;
    }
    this.gentePintada = true;
    const { m4, q, pos, escala, arriba, adelante, derecha, tinte, ladeo } = this.tmpGente;
    escala.set(0, 0, 0);
    const cuenta = this.cuentaGente;
    cuenta.length = this.mallasGente.length;
    cuenta.fill(0);
    const borde = GENTE_RADIO * 0.25, t = performance.now() / 1000;
    for (const a of this.gente) {
      let e = this.aristas[a.arista];
      a.s += a.dir * a.v * dt;
      if (a.s > e.largo || a.s < 0) {
        // llegó a un cruce: sigue por cualquier acera que salga de él, o da la vuelta si no hay
        const nodo = a.s > e.largo ? e.fin : e.ini;
        const opciones: [number, 1 | -1][] = [];
        for (const j of this.nodos.get(nodo) ?? []) {
          const o = this.aristas[j];
          if (j === a.arista || o.unico) continue;
          if (o.ini === nodo) opciones.push([j, 1]);
          if (o.fin === nodo) opciones.push([j, -1]);
        }
        if (opciones.length && !a.ancla) {
          const [j, d] = opciones[Math.floor(Math.random() * opciones.length)];
          a.arista = j;
          a.dir = d;
          a.s = d > 0 ? 0 : this.aristas[j].largo;
          a.i = 0;
          e = this.aristas[j];
        } else {
          a.dir = a.dir > 0 ? -1 : 1;
          a.s = Math.min(e.largo, Math.max(0, a.s));
        }
      }
      let i = a.i;
      while (i > 0 && a.s < e.cum[i]) i--;
      while (i < e.cum.length - 2 && a.s > e.cum[i + 1]) i++;
      a.i = i;
      const seg = e.cum[i + 1] - e.cum[i] || 1, k = Math.min(1, Math.max(0, (a.s - e.cum[i]) / seg));
      const tx = a.dir * (e.x[i + 1] - e.x[i]) / seg, tz = a.dir * (e.z[i + 1] - e.z[i]) / seg;
      // con rasante, camina por la mitad de la acera de su lado (la que cabe entre la calzada y la fachada), un bordillo más arriba
      let lado = a.lado, sobre = 0;
      if (e.lp) {
        const izq = a.lado * a.dir > 0, w = izq ? e.lp[i] : e.ln![i], ac = izq ? e.ap![i] : e.an![i];
        if (Number.isFinite(w) && Number.isFinite(ac)) { lado = Math.sign(a.lado) * (w + ac) / 2; sobre = this.rasante!.bordillo; }
      }
      const x = e.x[i] + (e.x[i + 1] - e.x[i]) * k - tz * lado, z = e.z[i] + (e.z[i + 1] - e.z[i]) * k + tx * lado;
      const dx = x - centro.x, dz = z - centro.z, d2 = dx * dx + dz * dz;
      if (d2 > GENTE_RADIO * GENTE_RADIO) continue;
      let y = e.y[i] + (e.y[i + 1] - e.y[i]) * k + sobre;
      const lon = this.lon0 + x / this.mLon, lat = this.lat0 - z / this.mLat, id = this.idEn(lon, lat);
      if (id >= 0 && this.alzado[id] > 0.5) y += this.alzado[id] * this.pesoBorde(lon, lat, id);
      // el paso: rebote al apoyar cada pie y tumbo de lado a lado, sin animar piernas (solo cambia la matriz de la instancia)
      const fase = t * a.v * 0.9 + a.fase, tumbo = Math.sin(fase);
      y += Math.abs(tumbo) * 0.04 * ESCALA_ACTIVOS;
      const tam = GENTE_ESCALA * Math.min(1, (GENTE_RADIO - Math.sqrt(d2)) / borde);
      q.setFromAxisAngle(arriba, Math.atan2(tx, tz));
      q.multiply(ladeo.setFromAxisAngle(adelante, tumbo * GENTE_TUMBO));
      q.multiply(ladeo.setFromAxisAngle(derecha, Math.abs(Math.cos(fase)) * GENTE_CABECEO));
      m4.compose(pos.set(x, y, z), q, escala.set(tam, tam, tam));
      const malla = this.mallasGente[a.tipo]!, n = cuenta[a.tipo]++;
      malla.setMatrixAt(n, m4);
      malla.setColorAt(n, tinte.set(TINTES_GENTE[a.tinte]));
      (malla.geometry.getAttribute('aFase') as THREE.InstancedBufferAttribute).setX(n, fase);
    }
    this.mallasGente.forEach((m, k) => {
      if (!m) return;
      m.count = cuenta[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.geometry.getAttribute('aFase').needsUpdate = true;
    });
  }

  private centrales: { x: number; z: number; nodo: string }[] = [];
  private destinosVeredales: string[] = [];
  private proximoDestino = 0;

  /** Cruce de la red más cercano a un punto. */
  private cruceCerca(x: number, z: number): string {
    let mejor = '', d2 = Infinity;
    for (const e of this.aristas) for (const [k, i] of [[e.ini, 0], [e.fin, e.x.length - 1]] as [string, number][]) {
      const d = (e.x[i] - x) ** 2 + (e.z[i] - z) ** 2;
      if (d < d2) { d2 = d; mejor = k; }
    }
    return mejor;
  }

  /** Camino más corto (por largo de vía) entre dos cruces, respetando las vías de un solo sentido; null si no hay. */
  private rutaEntre(desde: string, hasta: string): [number, 1 | -1][] | null {
    if (desde === hasta) return [];
    const dist = new Map<string, number>([[desde, 0]]), previo = new Map<string, [string, number, 1 | -1]>();
    const abiertos = new Set<string>([desde]), hechos = new Set<string>();
    while (abiertos.size) {
      let n = '', dn = Infinity;
      for (const k of abiertos) { const d = dist.get(k)!; if (d < dn) { dn = d; n = k; } }
      if (n === hasta) break;
      abiertos.delete(n);
      hechos.add(n);
      for (const j of this.nodos.get(n) ?? []) {
        const o = this.aristas[j];
        const pasos: [string, 1 | -1][] = [];
        if (o.ini === n) pasos.push([o.fin, 1]);
        if (o.fin === n && !o.unico) pasos.push([o.ini, -1]);
        for (const [m, d] of pasos) {
          if (hechos.has(m)) continue;
          const nd = dn + o.largo;
          if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); previo.set(m, [n, j, d]); abiertos.add(m); }
        }
      }
    }
    if (!previo.has(hasta)) return null;
    const ruta: [number, 1 | -1][] = [];
    for (let k = hasta; k !== desde;) { const [p, j, d] = previo.get(k)!; ruta.unshift([j, d]); k = p; }
    return ruta;
  }

  /** Al terminar su trayecto: el campero que llegó a una vereda vuelve a su central y el que llegó a la central sale hacia otra vereda. */
  private siguienteTramo(a: AutoRed, nodo: string): [number, 1 | -1] | undefined {
    const base = this.centrales[a.central ?? 0]?.nodo;
    let ruta: [number, 1 | -1][] | null = null;
    if (a.ida && base) { a.ida = false; ruta = this.rutaEntre(nodo, base); }
    else if (this.destinosVeredales.length) {
      a.ida = true;
      for (let i = 0; i < 4 && !ruta; i++) ruta = this.rutaEntre(nodo, this.destinosVeredales[this.proximoDestino++ % this.destinosVeredales.length]);
    }
    a.ruta = ruta ?? undefined;
    return a.ruta?.shift();
  }

  /**
   * Camperos de ruta: salen de las centrales de transporte veredal (Calle 5B y el parqueadero de buses) hacia una vereda tras otra, por el
   * camino más corto de la red, y regresan. Cada vereda con vías es un destino; se reparten de a una por viaje.
   */
  private crearRutasVeredales(rnd: () => number, porTipo: number[]): void {
    const sitios = ['Central de transporte veredal (calle 5b)', 'Parqueadero de buses veredal'].flatMap(n => { const f = SITIOS_FIJOS.get(n); return f ? [{ x: this.aX(f.lng), z: this.aZ(f.lat) }] : []; });
    if (!sitios.length || !this.aristas.length) return;
    const porVereda = new Map<number, string[]>();
    for (const e of this.aristas) {
      if (!e.rural || e.largo < 40) continue;
      const m = e.x.length >> 1, id = this.idEn(this.lon0 + e.x[m] / this.mLon, this.lat0 - e.z[m] / this.mLat);
      if (id >= 0) (porVereda.get(id) ?? porVereda.set(id, []).get(id)!).push(e.fin);
    }
    const destinos = [...porVereda.values()].map(l => l[Math.floor(rnd() * l.length)]);
    for (let i = destinos.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [destinos[i], destinos[j]] = [destinos[j], destinos[i]]; }
    this.destinosVeredales = destinos;
    this.centrales = sitios.map(c => ({ ...c, nodo: this.cruceCerca(c.x, c.z) }));
    let salieron = 0;
    this.centrales.forEach((c, central) => {
      const salidas = (this.nodos.get(c.nodo) ?? []).filter(j => this.aristas[j].ini === c.nodo || !this.aristas[j].unico);
      for (let n = 0; salidas.length && n < CAMPEROS_POR_CENTRAL; n++) {
        const j = salidas[n % salidas.length], o = this.aristas[j], dir: 1 | -1 = o.ini === c.nodo ? 1 : -1;
        const t = 6 + rnd() * Math.min(o.largo * 0.7, 70);
        const ruta = this.rutaEntre(dir > 0 ? o.fin : o.ini, destinos[this.proximoDestino++ % Math.max(1, destinos.length)] ?? c.nodo);
        if (!ruta) continue;
        this.autosRed.push({
          arista: j, s: dir > 0 ? Math.min(t, o.largo) : Math.max(0, o.largo - t), i: 0, dir,
          v: TRAFICO_VELOCIDAD[0] + rnd() * (TRAFICO_VELOCIDAD[1] - TRAFICO_VELOCIDAD[0]), carril: [-8, 0, 8][Math.floor(rnd() * 3)],
          tipo: FJ, k: porTipo[FJ]++, ruta, central, ida: true,
        });
        salieron++;
      }
    });
    console.info(`[mapa3d] camperos de ruta: ${salieron} en ${this.centrales.length} centrales, ${destinos.length} veredas de destino`);
  }

  /** Si un vehículo de ese tipo puede circular por la vía: el camión solo en principales y el FJ solo en veredas. */
  private admite(tipo: number, e: Arista): boolean {
    return tipo === CAMION || tipo === BUS ? e.vf === 1 : tipo === FJ ? e.rural : true;
  }

  /** Si el punto cae en una vereda (no en una cabecera, centro poblado, caserío ni inspección). */
  private esRural(x: number, z: number): boolean {
    const id = this.idEn(this.lon0 + x / this.mLon, this.lat0 - z / this.mLat);
    return id >= 0 && (this.piezas[id].zona.t ?? 'VE') === 'VE';
  }

  private animarTrafico(dt: number): void {
    if (!this.flota.length) return;
    // de lejos los autos miden menos de un píxel: se apagan y se congela su recorrido (al acercarse siguen donde iban)
    const visible = this.conduciendo() || this.camara.position.distanceTo(this.controles.target) < TRAFICO_DISTANCIA_MAX;
    if (visible !== this.traficoVisible) {
      this.traficoVisible = visible;
      for (const m of this.flota.flat()) m.visible = visible;
    }
    if (!visible) return;
    const { m4, q, qz, arriba, lateral, pos, escala } = this.tmpTrafico;
    escala.set(1, 1, 1);
    /**
     * Coloca el auto n sobre la polilínea `c` a `s` metros, mirando en el sentido `dir`, a `carril` metros a su derecha.
     * La pose real sigue a la del trazado con un retraso corto: así los giros en los cruces, el cambio de carril y la vuelta
     * en U salen como arcos y no como quiebres, y el auto mira hacia donde de verdad se mueve.
     */
    const colocar = (a: PoseAuto, tipo: number, n: number, c: Pick<Calzada, 'x' | 'z' | 'y' | 'cum' | 'lp' | 'ln'>, indice: number, s: number, dir: number, carril: number): number => {
      let i = indice;
      while (i > 0 && s < c.cum[i]) i--;
      while (i < c.cum.length - 2 && s > c.cum[i + 1]) i++;
      // en una calle angosta el carril se corre hacia el eje para que el carro (≈1,6 m de medio ancho a escala) no pise la acera
      if (c.lp && carril) {
        const lim = (carril * dir > 0 ? c.lp[i] : c.ln![i]) - 0.9 * ESCALA_ACTIVOS;
        carril = Math.sign(carril) * Math.max(0, Math.min(Math.abs(carril), lim));
      }
      const seg = c.cum[i + 1] - c.cum[i] || 1, t = Math.min(1, Math.max(0, (s - c.cum[i]) / seg));
      const tx = dir * (c.x[i + 1] - c.x[i]) / seg, tz = dir * (c.z[i + 1] - c.z[i]) / seg;
      const ox = c.x[i] + (c.x[i + 1] - c.x[i]) * t - tz * carril, oz = c.z[i] + (c.z[i + 1] - c.z[i]) * t + tx * carril;
      let oy = c.y[i] + (c.y[i + 1] - c.y[i]) * t;
      // si la vereda se levanta, el auto sube con ella
      const lon = this.lon0 + ox / this.mLon, lat = this.lat0 - oz / this.mLat, id = this.idEn(lon, lat);
      if (id >= 0 && this.alzado[id] > 0.5) oy += this.alzado[id] * this.pesoBorde(lon, lat, id);
      const yawVia = Math.atan2(-tz, tx);
      let x = ox, z = oz, yaw = yawVia;
      if (a.vivo && dt > 0) {
        const k = 1 - Math.exp(-dt * (6 + (a.vi ?? 0) * 0.22));
        const px = a.px!, pz = a.pz!;
        x = px + (ox - px) * k;
        z = pz + (oz - pz) * k;
        const mueve = Math.hypot(x - px, z - pz);
        // rumbo: hacia donde se mueve (si avanza) o el de la vía; se gira por el lado corto
        const objetivo = mueve > 0.02 * (a.vi ?? 1) * dt ? Math.atan2(-(z - pz), x - px) : yawVia;
        let dy = objetivo - a.yaw!;
        dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
        yaw = a.yaw! + dy * (1 - Math.exp(-dt * 12));
      }
      a.px = x; a.pz = z; a.yaw = yaw; a.vivo = true;
      q.setFromAxisAngle(arriba, yaw).multiply(qz.setFromAxisAngle(lateral, Math.atan(dir * (c.y[i + 1] - c.y[i]) / seg)));
      m4.compose(pos.set(x, oy, z), q, escala);
      for (const malla of this.flota[tipo]) malla.setMatrixAt(n, m4);
      return i;
    };
    /** Acelera o frena suavemente hacia la velocidad que pide el tramo. */
    const mover = (a: PoseAuto, objetivo: number, vmax: number): number => {
      a.vi ??= vmax;
      a.vi += Math.max(-50 * dt, Math.min(22 * dt, objetivo - a.vi));
      return a.vi;
    };

    this.autos.forEach(a => {
      const c = this.calzadas[a.calzada];
      a.s += mover(a, a.v, a.v) * dt;
      if (a.s >= c.largo) { a.s -= c.largo; a.i = 0; a.vivo = false; }
      a.i = colocar(a, a.tipo, a.k, c, a.i, a.s, 1, a.carril);
    });

    // cada auto de la red mira al que va adelante en su carril: si lo tiene cerca, no lo pasa por encima
    const filas = new Map<number, AutoRed[]>();
    for (const a of this.autosRed) {
      const e = this.aristas[a.arista];
      const carril = e.unico ? Math.round(a.carril / 8) + 1 : 3;
      const clave = a.arista * 8 + (a.dir > 0 ? 0 : 4) + carril;
      (filas.get(clave) ?? filas.set(clave, []).get(clave)!).push(a);
    }
    for (const [clave, fila] of filas) {
      const sentido = (clave & 4) ? -1 : 1;
      fila.sort((p, o) => sentido * (o.s - p.s));          // el primero es el que va más adelante
      fila.forEach((a, j) => { a.lider = j ? fila[j - 1] : undefined; });
    }

    this.autosRed.forEach(a => {
      let e = this.aristas[a.arista];
      // velocidad: la de la vía, más lenta al acercarse a un cruce o a un final de calle, y sin alcanzar al auto de adelante
      const aFin = a.dir > 0 ? e.largo - a.s : a.s;
      let objetivo = a.v * e.vf * (e.unico ? 1 : 0.45 + 0.55 * Math.min(1, aFin / 35));
      if (a.lider && a.lider.arista === a.arista) {
        const hueco = Math.abs(a.lider.s - a.s) - LARGO_AUTO;
        const vl = a.lider.vi ?? objetivo;
        if (hueco < 1.5 * LARGO_AUTO) objetivo = Math.min(objetivo, hueco <= 0.3 * LARGO_AUTO ? 0 : vl * Math.min(1, (hueco - 0.3 * LARGO_AUTO) / LARGO_AUTO));
      }
      a.s += a.dir * mover(a, objetivo, a.v * e.vf) * dt;
      if (a.s > e.largo || a.s < 0) {
        // llegó a un cruce: elige entre las vías que salen de él (en la doble calzada, solo en su sentido)
        const nodo = a.s > e.largo ? e.fin : e.ini;
        const paso = a.ruta ? a.ruta.shift() ?? this.siguienteTramo(a, nodo) : undefined;      // el campero de ruta sigue su trayecto
        const opciones: [number, 1 | -1][] = [];
        if (!paso) for (const j of this.nodos.get(nodo) ?? []) {
          if (j === a.arista) continue;
          const o = this.aristas[j];
          if (!this.admite(a.tipo, o)) continue;
          if (o.ini === nodo) opciones.push([j, 1]);
          if (o.fin === nodo && !o.unico) opciones.push([j, -1]);
        }
        if (paso || opciones.length) {
          const [j, d] = paso ?? opciones[Math.floor(Math.random() * opciones.length)];
          const resto = Math.abs(a.s > e.largo ? a.s - e.largo : a.s);       // lo que sobró del paso, para no perder el avance
          a.arista = j;
          a.dir = d;
          a.s = d > 0 ? Math.min(resto, this.aristas[j].largo) : Math.max(0, this.aristas[j].largo - resto);
          a.i = 0;
          a.carril = [-8, 0, 8][Math.floor(Math.random() * 3)];
        } else if (!e.unico) {
          a.dir = a.dir > 0 ? -1 : 1;                       // calle sin salida: da la vuelta
          a.s = Math.min(e.largo, Math.max(0, a.s));
        } else {
          const lista = this.viasPermitidas[a.tipo];                    // calzada que se acaba: reaparece en otra vía permitida
          a.arista = lista[Math.floor(Math.random() * lista.length)];
          a.dir = 1;
          a.s = 0;
          a.i = 0;
          a.vivo = false;
        }
        e = this.aristas[a.arista];
      }
      // en las vías de doble sentido va por el carril derecho; en la doble calzada, en el que le tocó
      a.i = colocar(a, a.tipo, a.k, e, a.i, a.s, a.dir, e.unico ? a.carril : ANCHO_VIA[e.vf < 1 ? 1 : 0] / 4);
    });
    for (const mallas of this.flota) for (const malla of mallas) malla.instanceMatrix.needsUpdate = true;
  }

  /**
   * Fábricas del inventario de emisiones de Corantioquia (insumos/ambiente/Base_Datos_Inventario-2021.xlsx, filtradas a
   * Girardota en public/data/mapa3d/industrias-49.json). Se descartan las que caen fuera del mapa o sin coordenadas, y
   * las que no caben ni al 50 % junto a otra ya puesta; si el predio está compartido, la fábrica se encoge para caber.
   */
  private ubicarIndustrias(lista: Industria[], vias: Compacto | null, catastro: Record<string, AjusteIndustria> = {}): FabricaMapa[] {
    const holgura = this.holguraVias(vias);
    const intentos: [number, number][] = [[0, 0]];
    for (const r of [25, 50, 75, 100, 130, 160]) for (let k = 0; k < 12; k++) intentos.push([Math.cos(k * Math.PI / 6) * r, Math.sin(k * Math.PI / 6) * r]);
    const out: FabricaMapa[] = [];
    // las que ocupan una bodega real del catastro (módulos de un parque industrial incluidos) se quedan en ella, con su contorno
    for (const f of lista) {
      const c = catastro[f.n];
      if (!c) continue;
      const x = this.aX(c.lon), z = this.aZ(c.lat);
      out.push({ x, z, lon: c.lon, lat: c.lat, n: f.n, datos: f, r: Math.hypot(c.largo, c.fondo) / 2 + 3, esc: 1, parque: false, yaw: c.yaw, lider: false, cat: c });
    }
    for (const f of lista) {
      if (catastro[f.n]) continue;
      const x0 = this.aX(f.lon), z0 = this.aZ(f.lat);
      colocada: for (const [dx, dz] of intentos) {
        const x = x0 + dx, z = z0 + dz;
        if (Math.abs(x) > this.ancho / 2 - 150 || Math.abs(z) > this.alto / 2 - 150) continue;
        // sin pisar a otra fábrica ni una vía: en el sitio más cercano que dé, y si el predio es estrecho o está compartido,
        // la nave se encoge (hasta ESCALA_MIN_FABRICA) para que quepan todas
        for (const esc of ESCALAS_FABRICA) {
          const r = RADIO_FABRICA * esc;
          if (holgura(x, z) < r || !out.every(o => Math.hypot(o.x - x, o.z - z) > o.r + r + 6)) continue;
          out.push({ x, z, lon: this.lon0 + x / this.mLon, lat: this.lat0 - z / this.mLat, n: f.n, datos: f, r, esc, parque: esc < 1, yaw: 0, lider: false });
          break colocada;
        }
      }
    }
    this.armarParques(out);
    return out;
  }

  /**
   * Las fábricas que quedaron encogidas (predio compartido) se ven como un parque industrial: bodegas modulares alineadas
   * en hilera según el eje del grupo, y la primera de cada grupo lleva el pórtico de entrada.
   */
  private armarParques(fab: { x: number; z: number; r: number; parque: boolean; yaw: number; lider: boolean }[]): void {
    const ps = fab.filter(f => f.parque);
    const padre = new Map(ps.map(f => [f, f] as const));
    const raiz = (f: typeof ps[number]): typeof ps[number] => { while (padre.get(f) !== f) f = padre.get(f)!; return f; };
    for (const a of ps) for (const b of ps) if (a !== b && Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r + 40) padre.set(raiz(a), raiz(b));
    const eje = (g: typeof ps): number | null => {
      if (g.length < 2) return null;
      const mx = g.reduce((t, f) => t + f.x, 0) / g.length, mz = g.reduce((t, f) => t + f.z, 0) / g.length;
      let sxx = 0, szz = 0, sxz = 0;
      for (const f of g) { sxx += (f.x - mx) ** 2; szz += (f.z - mz) ** 2; sxz += (f.x - mx) * (f.z - mz); }
      return -0.5 * Math.atan2(2 * sxz, sxx - szz);               // yaw que alinea el largo de la nave (x local) con el eje
    };
    const global = eje(ps) ?? 0;
    const grupos = new Map<typeof ps[number], typeof ps>();
    for (const f of ps) { const r = raiz(f); grupos.set(r, [...(grupos.get(r) ?? []), f]); }
    for (const g of grupos.values()) {
      const yaw = eje(g) ?? global;
      g.forEach((f, i) => { f.yaw = yaw; f.lider = i === 0; });
    }
  }

  /**
   * Puntos de interés de Girardota (colegios, salud, canchas, sitios arqueológicos...), cada uno con su edificio. Se corren
   * hasta un sitio libre cerca de su coordenada: sin pisar una vía, una fábrica ni otro equipamiento.
   */
  private async ubicarEquipamientos(lista: Punto[], vias: Compacto | null, ajustes: Record<string, AjusteCatastro> = {}): Promise<typeof this.equipamientos> {
    const holgura = this.holguraVias(vias);
    const intentos: [number, number][] = [[0, 0]];
    for (let r = 5; r <= 160; r += 5) {                  // anillos cada 5 m, con un punto cada ~6 m: en las esquinas angostas el hueco útil es pequeño
      const n = Math.max(8, Math.ceil(2 * Math.PI * r / 6));
      for (let k = 0; k < n; k++) intentos.push([Math.cos(k * 2 * Math.PI / n) * r, Math.sin(k * 2 * Math.PI / n) * r]);
    }
    const out: typeof this.equipamientos = [];
    const previos = (x: number, z: number, r: number, deporte: boolean) =>
      this.fabricas.every(f => Math.hypot(f.x - x, f.z - z) > f.r + r + 4)
      && out.every(o => Math.hypot(o.x - x, o.z - z) > (o.r + r) * (deporte && o.datos.p.c === 'deporte' ? SOLAPE_DEPORTE : SOLAPE_EQUIPAMIENTOS));
    const conjuntos = this.conjuntosDeporte(lista, holgura);
    // un punto que es parte de otro sitio (el Señor caído está en la catedral) no lleva edificio propio: su ficha se suma a la del sitio
    const incluidos = new Map<string, Punto[]>();
    const ocupadas: { x: number; z: number; yaw: number; dim: [number, number] }[] = [];   // huellas de los sitios fijos ya puestos
    for (const p of lista) { const sitio = FUSIONES.get(p.n); if (sitio) incluidos.set(sitio, [...(incluidos.get(sitio) ?? []), p]); }
    // partes de un edificio compartido (Comfama): se ponen al final, sobre el modelo de su sitio, cada una con su icono
    const partes: Punto[] = [];
    const sitiosPuestos = new Map<string, { x: number; z: number; yaw: number; f: number }>();
    const enSitio = (s: { x: number; z: number; yaw: number; f: number }, lx: number, lz: number) => {
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      return { x: s.x + (lx * c + lz * sn) * s.f, z: s.z + (-lx * sn + lz * c) * s.f };
    };
    const colocar = (p: Punto, i: number): void => {
      if (p.lat == null || p.lng == null || FUSIONES.has(p.n)) return;
      const parte = PARTES.get(p.n);
      if (parte && parte.sitio !== p.n) { partes.push(p); return; }
      const c = conjuntos.get(p);
      if (c) {
        out.push({ x: c.x, z: c.z, lon: this.lon0 + c.x / this.mLon, lat: this.lat0 - c.z / this.mLat, n: p.n, r: c.modelo.radio, yaw: c.yaw, datos: { p, modelo: c.modelo } });
        return;
      }
      const modelo = modelarEquipamiento(p.c, p.t, p.n, mulberry32(9100 + i));
      const fijo = SITIOS_FIJOS.get(p.n);
      if (fijo) {
        let px = this.aX(fijo.lng), pz = this.aZ(fijo.lat);
        if (fijo.dim) {
          // a la medida real del lugar: la huella ocupa su sitio y reemplaza al catastro que caiga dentro
          const [lw, ld] = modelo.losa ?? [modelo.radio * 2, modelo.radio * 2];
          // sin tapar vías: si la huella toca una calzada (o queda a menos de 1,5 m) se corre hasta 30 m y, si no basta, se reduce de a 5 %
          const x0 = px, z0 = pz, cy = Math.cos(fijo.yaw), sn = Math.sin(fijo.yaw);
          const libre = (f: number, ox: number, oz: number): boolean => {
            for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
              const a = i / 6 * fijo.dim![0] / 2 * f, b = j / 6 * fijo.dim![1] / 2 * f;
              const wx = x0 + ox + a * cy + b * sn, wz = z0 + oz - a * sn + b * cy;
              if (holgura(wx, wz) < 1.5) return false;
              // ni pisar a otro sitio fijo: el punto, en los ejes de ese sitio, no cae dentro de su huella (con 2 m de margen)
              if (ocupadas.some(o => {
                const dx = wx - o.x, dz = wz - o.z, lx = dx * Math.cos(o.yaw) - dz * Math.sin(o.yaw), lz = dx * Math.sin(o.yaw) + dz * Math.cos(o.yaw);
                return Math.abs(lx) < o.dim[0] / 2 + 2 && Math.abs(lz) < o.dim[1] / 2 + 2;
              })) return false;
            }
            return true;
          };
          const desplazamientos: [number, number][] = [[0, 0]];
          for (const r of [8, 16, 24, 30]) for (let k = 0; k < 12; k++) desplazamientos.push([r * Math.cos(k * Math.PI / 6), r * Math.sin(k * Math.PI / 6)]);
          let ajuste = 1;
          // lo que va sobre la vía (el peaje) se queda donde está: ocupar la calzada es su oficio
          for (; ajuste > 0.5 && !modelo.sobreVia; ajuste -= 0.05) {
            const d = desplazamientos.find(([ox, oz]) => libre(ajuste, ox, oz));
            if (d) { px += d[0]; pz += d[1]; break; }
          }
          const dim: [number, number] = [fijo.dim[0] * ajuste, fijo.dim[1] * ajuste];
          const sx = dim[0] / lw, sz = dim[1] / ld, sy = Math.max(0.8, Math.min(1.3, Math.min(sx, sz)));
          modelo.piezas.forEach(pz => pz.g.scale(sx, sy, sz));
          modelo.radio *= Math.max(sx, sz);
          modelo.losa = dim;
          modelo.huella = dim;
          ocupadas.push({ x: px, z: pz, yaw: fijo.yaw, dim });
          if (ajuste < 1 || px !== x0) console.info(`[mapa3d] ${p.n}: huella al ${Math.round(ajuste * 100)} % y corrida ${Math.round(Math.hypot(px - x0, pz - z0))} m para no tapar vías`);
        }
        const dentro = incluidos.get(p.n) ?? [];
        const ficha: Punto = dentro.length ? { ...p, x: [p.x, ...dentro.map(q => `${q.n}: ${q.x ?? q.t}`)].filter(Boolean).join(' · ') } : p;
        // el modelo se arma a la medida de `dim`: si el ajustador lo redujo, las partes se acercan en la misma proporción
        const puesto = { x: px, z: pz, yaw: fijo.yaw, f: fijo.dim ? (modelo.losa?.[0] ?? fijo.dim[0]) / fijo.dim[0] : 1 };
        sitiosPuestos.set(p.n, puesto);
        const pin = parte ? { ...enSitio(puesto, parte.x, parte.z), alto: parte.alto, nivel: parte.nivel } : undefined;
        out.push({ x: px, z: pz, lon: this.lon0 + px / this.mLon, lat: this.lat0 - pz / this.mLat, n: p.n, r: modelo.radio, yaw: fijo.yaw, pin, sitio: parte?.sitio, datos: { p: ficha, modelo } });
        return;
      }
      const aj = ajustes[p.n];
      if (aj) {
        // el edificio simbólico se asienta en el terreno que ocupa en el catastro, con la fachada hacia la vía, a la medida del lote y de sus pisos
        const [lw, ld] = modelo.losa ?? [modelo.radio * 2, modelo.radio * 2];
        const f = Math.max(0.3, Math.min(1.15, aj.ancho / lw, aj.fondo / ld));
        const tope = modelo.piezas.reduce((m, pz) => { pz.g.computeBoundingBox(); const t = pz.g.boundingBox!.max.y; return t <= 16 ? Math.max(m, t) : m; }, 0);
        const sy = /emisora/i.test(p.t) || !tope ? 1 : Math.max(0.8, Math.min(1.6, aj.pisos / Math.max(1, Math.round(tope / 3.6))));
        modelo.piezas.forEach(pz => pz.g.scale(f, f * sy, f));
        modelo.radio *= f;
        modelo.losa = [lw * f, ld * f];
        modelo.huella = [aj.ancho, aj.fondo];
        out.push({ x: this.aX(aj.lon), z: this.aZ(aj.lat), lon: aj.lon, lat: aj.lat, n: p.n, r: modelo.radio, yaw: aj.yaw, datos: { p, modelo } });
        return;
      }
      const x0 = this.aX(p.lng), z0 = this.aZ(p.lat);
      for (const [dx, dz] of intentos) {
        const x = x0 + dx, z = z0 + dz;
        if (Math.abs(x) > this.ancho / 2 - 150 || Math.abs(z) > this.alto / 2 - 150) continue;
        if (holgura(x, z) < modelo.radio * (p.c === 'deporte' ? HOLGURA_DEPORTE : 0.7) || !previos(x, z, modelo.radio, p.c === 'deporte')) continue;
        out.push({ x, z, lon: this.lon0 + x / this.mLon, lat: this.lat0 - z / this.mLat, n: p.n, r: modelo.radio, datos: { p, modelo } });
        return;
      }
    };
    // por tandas de pocos sitios: cada uno busca su hueco libre de vías y el conjunto entero congelaba la página varios segundos
    for (let i = 0; i < lista.length; i++) {
      colocar(lista[i], i);
      if (i % 6 === 5 && await this.ceder()) return out;
    }
    // sin edificio propio: el modelo del sitio ya las dibuja; van al final para que el clic sobre la malla no las confunda con el sitio
    for (const p of partes) {
      const parte = PARTES.get(p.n)!, s = sitiosPuestos.get(parte.sitio);
      if (!s) continue;
      const { x, z } = enSitio(s, parte.x, parte.z);
      out.push({ x, z, lon: this.lon0 + x / this.mLon, lat: this.lat0 - z / this.mLat, n: p.n, r: 8, yaw: s.yaw, pin: { x, z, alto: parte.alto, nivel: parte.nivel }, sitio: parte.sitio,
        datos: { p, modelo: { piezas: [], radio: 8 } } });
    }
    return out;
  }

  /**
   * Canchas y placas que comparten punto (a menos de CONJUNTO_DEPORTE m): se acomodan una al lado de la otra, alineadas con las
   * calles, dentro de la manzana. Se mide cuánto espacio libre de calles hay desde el centro del conjunto, se busca el eje más
   * largo y se reduce la escala de los modelos hasta que quepan en fila con una separación entre ellos.
   */
  private conjuntosDeporte(lista: Punto[], holgura: (x: number, z: number) => number): Map<Punto, { x: number; z: number; yaw: number; modelo: Modelo }> {
    const res = new Map<Punto, { x: number; z: number; yaw: number; modelo: Modelo }>();
    const dep = lista.map((p, i) => ({ p, i })).filter(({ p }) => p.c === 'deporte' && p.lat != null && p.lng != null && !SITIOS_FIJOS.has(p.n) && !PARTES.has(p.n));
    const pos = (p: Punto) => [this.aX(p.lng!), this.aZ(p.lat!)];
    const visto = new Set<Punto>();
    for (const a of dep) {
      if (visto.has(a.p)) continue;
      const grupo = dep.filter(b => !visto.has(b.p) && Math.hypot(pos(a.p)[0] - pos(b.p)[0], pos(a.p)[1] - pos(b.p)[1]) < CONJUNTO_DEPORTE);
      grupo.forEach(g => visto.add(g.p));
      if (grupo.length < 2) continue;
      let cx = grupo.reduce((m, g) => m + pos(g.p)[0], 0) / grupo.length, cz = grupo.reduce((m, g) => m + pos(g.p)[1], 0) / grupo.length;
      // espacio libre desde un punto en una dirección, hasta topar con una calle
      const libre = (x: number, z: number, ang: number) => {
        let d = 0;
        while (d < 160 && holgura(x + Math.cos(ang) * d, z + Math.sin(ang) * d) >= ORILLA_DEPORTE) d += 2;
        return d;
      };
      if (holgura(cx, cz) < ORILLA_DEPORTE) continue;          // el centro cae en una calle: se deja el reparto de siempre
      let mejor = 0, largo = 0;
      for (let k = 0; k < 18; k++) {
        const ang = k * Math.PI / 18, l = libre(cx, cz, ang) + libre(cx, cz, ang + Math.PI);
        if (l > largo) { largo = l; mejor = ang; }
      }
      // se centra en el hueco, en el eje largo y en el transversal
      for (const ang of [mejor, mejor + Math.PI / 2]) {
        const dif = (libre(cx, cz, ang) - libre(cx, cz, ang + Math.PI)) / 2;
        cx += Math.cos(ang) * dif; cz += Math.sin(ang) * dif;
      }
      const ancho = libre(cx, cz, mejor) + libre(cx, cz, mejor + Math.PI), fondo = libre(cx, cz, mejor + Math.PI / 2) + libre(cx, cz, mejor - Math.PI / 2);
      const modelos = grupo.map(g => ({ ...g, modelo: modelarEquipamiento(g.p.c, g.p.t, g.p.n, mulberry32(9100 + g.i)) }));
      modelos.sort((m, n) => (n.modelo.losa?.[0] ?? 0) - (m.modelo.losa?.[0] ?? 0));
      const medidas = modelos.map(m => m.modelo.losa ?? [m.modelo.radio * 2, m.modelo.radio * 2]);
      const sumaAncho = medidas.reduce((t, m) => t + m[0], 0) + SEPARACION_DEPORTE * (modelos.length - 1), maxFondo = Math.max(...medidas.map(m => m[1]));
      const esc = Math.max(0.35, Math.min(1, (ancho - 2 * ORILLA_DEPORTE) / sumaAncho, (fondo - 2 * ORILLA_DEPORTE) / maxFondo));
      const yaw = -mejor, ux = Math.cos(mejor), uz = Math.sin(mejor);
      let desde = -(sumaAncho * esc) / 2;
      modelos.forEach((m, k) => {
        m.modelo.piezas.forEach(pz => pz.g.scale(esc, esc, esc));
        m.modelo.radio *= esc;
        if (m.modelo.losa) m.modelo.losa = [m.modelo.losa[0] * esc, m.modelo.losa[1] * esc];
        const mitad = medidas[k][0] * esc / 2, t = desde + mitad;
        res.set(m.p, { x: cx + ux * t, z: cz + uz * t, yaw, modelo: m.modelo });
        desde += medidas[k][0] * esc + SEPARACION_DEPORTE * esc;
      });
    }
    return res;
  }

  /** Función (x, z) → distancia al borde de la vía más cercana (principales y locales; los senderos no cuentan). */
  private holguraVias(vias: Compacto | null): (x: number, z: number) => number {
    const medir = this.medirVias(vias);
    return (x, z) => medir(x, z)[0];
  }

  /** Para un punto: [distancia al borde de la calzada más cercana (negativa encima), x y z del punto del eje más próximo, y el rumbo (tx, tz) del eje ahí]. */
  private medirVias(vias: Compacto | null): (x: number, z: number) => [number, number, number, number, number] {
    const REJ = 200;
    const segs = new Map<number, number[][]>();
    // [ax, az, bx, bz, media calzada del lado a (-sz, sx), la del otro lado]: con rasante, el ancho que cabe entre fachadas
    const lista: number[][] = [];
    if (this.rasante) {
      for (const t of this.rasante.tramos) {
        for (let i = 1; i < t.x.length; i++) lista.push([t.x[i - 1], t.z[i - 1], t.x[i], t.z[i], (t.wa[i - 1] + t.wa[i]) / 2, (t.wb[i - 1] + t.wb[i]) / 2]);
      }
    } else {
      for (const v of vias?.v ?? []) {
        if (v[0] > 1) continue;                      // principales y locales; los senderos no cuentan
        const l = this.desdeDeltas(v, vias!.k, 1).map(q => [this.aX(q[0]), this.aZ(q[1])]);
        for (let i = 1; i < l.length; i++) lista.push([l[i - 1][0], l[i - 1][1], l[i][0], l[i][1], ANCHO_VIA[v[0]] / 2, ANCHO_VIA[v[0]] / 2]);
      }
    }
    for (const sg of lista) {
      const i0 = Math.floor(Math.min(sg[0], sg[2]) / REJ), i1 = Math.floor(Math.max(sg[0], sg[2]) / REJ);
      const j0 = Math.floor(Math.min(sg[1], sg[3]) / REJ), j1 = Math.floor(Math.max(sg[1], sg[3]) / REJ);
      for (let a = i0; a <= i1; a++) for (let c = j0; c <= j1; c++) (segs.get(a * 100003 + c) ?? segs.set(a * 100003 + c, []).get(a * 100003 + c)!).push(sg);
    }
    return (x: number, z: number) => {
      let m = Infinity, qx = x, qz = z, tx = 0, tz = 1;
      const ci = Math.floor(x / REJ), cj = Math.floor(z / REJ);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (const [ax, az, bx, bz, wa, wb] of segs.get((ci + di) * 100003 + cj + dj) ?? []) {
            const sx = bx - ax, sz = bz - az, ll = sx * sx + sz * sz;
            const t = ll > 0 ? Math.min(1, Math.max(0, ((x - ax) * sx + (z - az) * sz) / ll)) : 0;
            const ex = x - ax - sx * t, ez = z - az - sz * t;
            const d = Math.hypot(ex, ez) - (ex * -sz + ez * sx >= 0 ? wa : wb);
            if (d < m) { m = d; qx = ax + sx * t; qz = az + sz * t; const l = Math.sqrt(ll) || 1; tx = sx / l; tz = sz / l; }
          }
        }
      }
      return [m, qx, qz, tx, tz];
    };
  }

  /** Cuenta los edificios por celda: donde hay muchos juntos es tejido urbano, como lo muestra la foto satelital (techos de teja). */
  private medirDensidad(e: Compacto): void {
    this.celdasUrbanas.clear();
    for (const b of e.e!) {
      const q = this.desdeDeltas(b, e.k, 1);
      const c = this.claveUrbana(q.reduce((m, p) => m + p[0], 0) / q.length, q.reduce((m, p) => m + p[1], 0) / q.length);
      this.celdasUrbanas.set(c, (this.celdasUrbanas.get(c) ?? 0) + 1);
    }
  }

  private claveUrbana(lon: number, lat: number): number {
    return Math.floor((this.aX(lon) + this.ancho / 2) / CELDA_URBANA) * 100003 + Math.floor((this.aZ(lat) + this.alto / 2) / CELDA_URBANA);
  }

  /** ¿Cae en tejido urbano denso? Suma de la celda y sus vecinas. */
  private esUrbano(lon: number, lat: number): boolean {
    const c = this.claveUrbana(lon, lat);
    let n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += this.celdasUrbanas.get(c + i * 100003 + j) ?? 0;
    return n >= MIN_URBANO;
  }

  /** En el tejido urbano, un edificio cuyo contorno pisa la calle o su acera (a menos de MARGEN_VIA de la calzada) no se dibuja. */
  private cruzaVia(anillo: number[][], lon: number, lat: number, holgura: (x: number, z: number) => number): boolean {
    if (!this.esUrbano(lon, lat)) return false;
    const p = anillo.map(q => [this.aX(q[0]), this.aZ(q[1])]);
    if (holgura((p.reduce((m, q) => m + q[0], 0)) / p.length, (p.reduce((m, q) => m + q[1], 0)) / p.length) < MARGEN_VIA) return true;
    for (let i = 0; i < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2.5));
      for (let t = 0; t < n; t++) if (holgura(ax + (bx - ax) * t / n, az + (bz - az) * t / n) < MARGEN_VIA) return true;
    }
    return false;
  }

  /** Quita los edificios de OpenStreetMap que quedarían debajo de una fábrica o de un equipamiento (dentro de su radio). */
  private async sinIndustrias(e: Compacto | null, vias: Compacto | null): Promise<Compacto | null> {
    if (!e?.e) return e;
    const k = e.k, holgura = this.holguraVias(vias);
    this.medirDensidad(e);
    const decidir = (b: number[], n: number): boolean => {
      const q = this.desdeDeltas(b, k, 1);
      const lon = q.reduce((m, p) => m + p[0], 0) / q.length, lat = q.reduce((m, p) => m + p[1], 0) / q.length;
      const x = this.aX(lon), z = this.aZ(lat);
      // una construcción del catastro es real: solo se quita si su centro cae sobre la calzada; las demás, si su contorno pisa la calle
      if ((e.p?.[n] ?? 0) > 0 ? holgura(x, z) < 0 : this.cruzaVia(q, lon, lat, holgura)) return false;
      return this.fabricas.every(f => {
        if (!f.cat) return Math.hypot(f.x - x, f.z - z) > f.r + 5;
        // la bodega real de una fábrica la dibuja la fábrica: se quita lo del catastro cuyo centro cae dentro de su contorno
        const dx = x - f.x, dz = z - f.z, c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
        return !enPoligono(dx * c - dz * sn, dx * sn + dz * c, f.cat.poly);
      })
        && !this.huellasSub.some(h => enPoligono(x, z, h))                                              // la subestación reemplaza lo del catastro bajo su patio
        && this.tanques.every(t => Math.hypot(this.aX(t[0]) - x, this.aZ(t[1]) - z) > t[2] + 2)      // el tanque reemplaza a su huella circular del catastro
        && this.equipamientos.every(q => {
          const h = q.datos.modelo.huella;
          if (!h) return Math.hypot(q.x - x, q.z - z) > q.r + 3;
          // con huella real (catedral, parque) solo se reemplaza lo que cae dentro de ese rectángulo girado, no lo que hay alrededor
          const dx = x - q.x, dz = z - q.z, yaw = q.yaw ?? 0;
          return Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) > h[0] / 2 + 1 || Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw)) > h[1] / 2 + 1;
        });
    };
    // por tandas: cada construcción se compara con vías, fábricas, tanques y equipamientos
    const quedan: boolean[] = [];
    let t0 = performance.now();
    for (let n = 0; n < e.e.length; n++) {
      quedan.push(decidir(e.e[n], n));
      if (performance.now() - t0 > 25) { if (await this.ceder()) return e; t0 = performance.now(); }
    }
    const sin = <T>(a?: T[]) => a?.filter((_, n) => quedan[n]);
    return { ...e, e: sin(e.e), p: sin(e.p), u: sin(e.u), r: sin(e.r), n: sin(e.n) };
  }

  /**
   * Un edificio por punto de interés (insumos de la capa de puntos del mapa 2D), modelado según su categoría en
   * utils/equipamientos.ts. Cada uno se asienta sobre una losa en la ladera, con una orientación fija por punto.
   * Todo en una sola malla con color por vértice.
   */
  private construirEquipamientos(): void {
    if (!this.equipamientos.length) return;
    const rnd = mulberry32(5150);
    const geos: THREE.BufferGeometry[] = [], ids: number[] = [], pesos: number[] = [];
    const giro = new THREE.Matrix4();
    const losaColor = new THREE.Color('#9aa0a6');
    const items: ItemAura[] = [];
    const basesSitio = new Map<string, number>();

    for (const q of this.equipamientos) {
      this.inicioEquip.push(ids.length);
      const { modelo } = q.datos;
      const azar = rnd() * Math.PI * 2, yaw = q.yaw ?? azar, cos = Math.cos(yaw), sin = Math.sin(yaw);
      const [lw, ld] = modelo.losa ?? [0, 0];
      // cuadrícula de 5 × 5 sobre la losa (no solo el centro y las esquinas): una loma entre ellas la enterraría
      const alturas: number[] = [];
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        const a = i / 2, b = j / 2;
        alturas.push(this.alturaXZ(q.x + a * (lw / 2) * cos + b * (ld / 2) * sin, q.z - a * (lw / 2) * sin + b * (ld / 2) * cos));
      }
      // lo que va sobre la vía se apoya en la calzada (la más alta de las que cruzan su eje transversal), no en una losa en la ladera
      const sobreVia = modelo.sobreVia
        ? q.cota ?? Math.max(...[-ld / 4, -ld / 8, ld / 8, ld / 4].map(b => this.calzadaXZ(q.x + b * sin, q.z + b * cos))) + 0.05 : null;
      const base = sobreVia ?? (modelo.losa ? Math.max(...alturas) : alturas[12]) + 1, minimo = Math.min(...alturas);
      const id = this.idEn(q.lon, q.lat), peso = id >= 0 ? this.pesoBorde(q.lon, q.lat, id) : 0;
      giro.makeRotationY(yaw);
      const poner = (g: THREE.BufferGeometry, color: THREE.Color) => {
        const geo = g.index ? g.toNonIndexed() : g.clone();
        geo.applyMatrix4(giro);
        geo.translate(q.x, base, q.z);
        const cnt = geo.getAttribute('position').count, col = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.deleteAttribute('uv');
        geos.push(geo);
        for (let i = 0; i < cnt; i++) { ids.push(id); pesos.push(peso); }
      };
      if (modelo.losa && sobreVia === null) {                     // losa que se asienta en la ladera
        const prof = base - minimo + 2;
        poner(new THREE.BoxGeometry(lw, prof, ld).translate(0, -prof / 2, 0), losaColor);
      }
      let alto = 0;
      for (const p of modelo.piezas) {
        poner(p.g, new THREE.Color(p.color));
        p.g.computeBoundingBox();
        alto = Math.max(alto, p.g.boundingBox!.max.y);
      }
      // una parte de un edificio compartido se apoya en la losa de su sitio (puesto antes) y su icono va sobre su ala, no en el centro
      if (q.sitio === q.n) basesSitio.set(q.n, base);
      const b = (q.sitio ? basesSitio.get(q.sitio) : undefined) ?? base, cima = q.pin ? b + q.pin.alto : base + alto;
      if (q.pin) q.pin.base = b;
      const parteSuelta = !!q.sitio && q.sitio !== q.n;
      this.cajasEquip.push({ x: q.x, z: q.z, r: q.r, top: parteSuelta ? cima : base + alto, id });
      const color = CATEGORIA.get(q.datos.p.c)?.color ?? '#ffffff';
      items.push(q.pin && parteSuelta ? { x: q.x, y: b, z: q.z, radio: q.r + 2, alto: q.pin.alto * 1.15 + 4, color }
        : { x: q.x, y: base, z: q.z, radio: q.r + 2, alto: alto * 1.15 + 4, color });
      const icono = crearIcono(q.datos.p.c, color, q.pin?.x ?? q.x, cima, q.pin?.z ?? q.z);
      icono.ref = { tipo: 'equip', i: items.length - 1 };
      icono.zona = this.idEn(q.datos.p.lng ?? q.lon, q.datos.p.lat ?? q.lat);
      this.iconosEquip.push(icono);
    }

    const geo = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!geo) return;
    this.geoEquip = geo;
    this.matEquip = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
    const malla = new THREE.Mesh(geo, this.matEquip);
    this.mallaEquip = malla;
    malla.castShadow = true;
    malla.receiveShadow = true;
    this.escena.add(malla);
    this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, ids, pesos);
    this.auraEquip = crearAuras(items);
    this.auraEquip.resaltar(-1);
    this.escena.add(this.auraEquip.grupo);
    for (const ic of this.iconosEquip) this.escena.add(ic.sprite);
    this.agrupadorIconos ??= crearAgrupador(this.iconosEquip, this.escena, this.pinVisible);
  }

  /**
   * Tanques de almacenamiento (patio de tanques del Parque Industrial del Norte): cilindros blancos de lámina sobre una base de
   * concreto, con la tapa gris y un anillo de refuerzo a media altura. Una sola malla con color por vértice.
   */
  private construirTanques(): void {
    if (!this.tanques.length) return;
    const CUERPOS = ['#e8ebee', '#dfe3e6', '#eef0f2', '#d3d9de'].map(c => new THREE.Color(c));
    const geos: THREE.BufferGeometry[] = [], ids: number[] = [], pesos: number[] = [];
    this.tanques.forEach(([lon, lat, r, h], n) => {
      const x = this.aX(lon), z = this.aZ(lat);
      const alturas = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => this.alturaXZ(x + a * r, z + b * r));
      const base = Math.max(...alturas) + 0.3, minimo = Math.min(...alturas);
      const id = this.idEn(lon, lat), peso = id >= 0 ? this.pesoBorde(lon, lat, id) : 0;
      const poner = (g: THREE.BufferGeometry, color: THREE.Color, y: number) => {
        const geo = g.index ? g.toNonIndexed() : g;
        geo.translate(x, y, z);
        const cnt = geo.getAttribute('position').count, col = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.deleteAttribute('uv');
        geos.push(geo);
        for (let i = 0; i < cnt; i++) { ids.push(id); pesos.push(peso); }
      };
      const prof = base - minimo + 1.5, seg = 28;
      poner(new THREE.CylinderGeometry(r + 0.8, r + 0.8, prof + 0.5, seg).translate(0, -prof / 2 + 0.25, 0), new THREE.Color('#9aa0a6'), base);   // base de concreto
      poner(new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0), CUERPOS[n % CUERPOS.length], base);
      poner(new THREE.CylinderGeometry(r * 0.96, r, 0.7, seg).translate(0, h + 0.35, 0), new THREE.Color('#aab2b8'), base);                         // tapa
      poner(new THREE.CylinderGeometry(r + 0.15, r + 0.15, 0.35, seg).translate(0, h * 0.55, 0), new THREE.Color('#b4bcc3'), base);                // anillo de refuerzo
    });
    const geo = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!geo) return;
    const malla = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 }));
    malla.castShadow = true;
    malla.receiveShadow = true;
    this.escena.add(malla);
    this.mallaTanques = malla;
    this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, ids, pesos);
  }
  private mallaTanques: THREE.Mesh | null = null;

  hayRedes = false;

  // ---- selección de tuberías y líneas eléctricas (igual que los ríos: cursor la ilumina, clic la elige y abre su ficha)
  private elementosAgua: ElementoRed[] = [];
  private elementosEnergia: ElementoRed[] = [];
  private redHover: ElementoRed | null = null;
  private redElegida: ElementoRed | null = null;
  private tRedHover = 0;
  private haloRed: THREE.Group | null = null;
  readonly redSeleccion = signal<{ nombre: string; detalle: string } | null>(null);

  /** Elementos que se pueden señalar ahora: las tuberías en modo subterráneo y las líneas eléctricas cuando se ven. */
  private elementosActivos(): ElementoRed[] {
    if (this.subterraneo()) return this.elementosAgua;
    const energia = this.grupoRedes?.visible ? this.elementosEnergia : [];
    return this.flujoVisible() ? [...energia, ...this.elementosFlujo] : energia;
  }

  /** Elemento más cercano al cursor, medido en pantalla porque de lejos una tubería mide menos de un píxel. */
  private redBajoCursor(ev: PointerEvent): ElementoRed | null {
    const lista = this.elementosActivos();
    if (!lista.length) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top, v = new THREE.Vector3();
    const pantalla = (p: THREE.Vector3): [number, number, boolean] => {
      v.copy(p).project(this.camara);
      return [(v.x * 0.5 + 0.5) * r.width, (-v.y * 0.5 + 0.5) * r.height, v.z < 1];
    };
    let mejor: ElementoRed | null = null, mejorD = TOLERANCIA_RED_PX;
    for (const e of lista) {
      if (e.pts.length === 1) {
        const [x, y, ok] = pantalla(e.pts[0]);
        const d = ok ? Math.hypot(mx - x, my - y) - 6 : Infinity;
        if (d < mejorD) { mejorD = d; mejor = e; }
        continue;
      }
      let [ax, ay, aok] = pantalla(e.pts[0]);
      for (let i = 1; i < e.pts.length; i++) {
        const [bx, by, bok] = pantalla(e.pts[i]);
        if (aok && bok) {
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
          const u = l2 ? Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / l2)) : 0;
          const d = Math.hypot(mx - (ax + dx * u), my - (ay + dy * u));
          if (d < mejorD) { mejorD = d; mejor = e; }
        }
        ax = bx; ay = by; aok = bok;
      }
    }
    return mejor;
  }

  /** Geometría que ilumina un elemento: un tubo más grueso que él, o un haz vertical para un equipo. */
  private geometriaHalo(e: ElementoRed): THREE.BufferGeometry {
    if (e.pts.length === 1) {
      const p = e.pts[0];
      return new THREE.CylinderGeometry(e.radio, e.radio, 90, 24, 1, true).translate(p.x, p.y + 25, p.z);
    }
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < e.pts.length - 1; i++) prisma(e.pts[i], e.pts[i + 1], e.radio * 1.9 + 0.5, pos, idx);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  private pintarHalosRed(): void {
    if (!this.haloRed) {
      this.haloRed = new THREE.Group();
      for (const [color, opacidad] of [['#fff2a6', 0.8], ['#ffb300', 0.95]] as const) {
        const m = new THREE.Mesh(new THREE.BufferGeometry(), engrosar(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacidad, depthWrite: false, side: THREE.DoubleSide }), 0.0028, 40));
        m.renderOrder = 6;
        m.frustumCulled = false;
        this.haloRed.add(m);
      }
      this.escena.add(this.haloRed);
    }
    const [hover, elegido] = this.haloRed.children as THREE.Mesh[];
    hover.geometry.dispose();
    elegido.geometry.dispose();
    hover.geometry = this.redHover && this.redHover !== this.redElegida ? this.geometriaHalo(this.redHover) : new THREE.BufferGeometry();
    elegido.geometry = this.redElegida ? this.geometriaHalo(this.redElegida) : new THREE.BufferGeometry();
  }

  private seleccionarRed(e: ElementoRed | null): void {
    if (e) {
      this.seleccionarFabrica(-1, false);
      this.seleccionarRio(null, false);
      this.deseleccionar();
    }
    this.redElegida = e;
    this.redSeleccion.set(e ? { nombre: e.nombre, detalle: e.detalle } : null);
    this.pintarHalosRed();
  }

  private soltarRed(): void {
    if (this.redElegida || this.redHover) { this.redHover = null; this.seleccionarRed(null); }
  }

  /**
   * Redes de servicios públicos con la geografía real de OpenStreetMap: torres y conductores de las líneas de alta tensión (con
   * flecha entre torres), subestaciones con patio y transformadores, la central hidroeléctrica, la planta de tratamiento y los
   * tanques de agua. Acueducto y alcantarillado aún no: sus trazados son de EPM.
   */
  private construirInfraestructura(d: Infraestructura | null): void {
    if (!d) return;
    const mitadX = this.ancho / 2, mitadZ = this.alto / 2;
    const dentro = (x: number, z: number) => Math.abs(x) < mitadX && Math.abs(z) < mitadZ;
    const grupo = new THREE.Group();
    this.huellasSub = d.subs.map(([, , ps]) => ps.map(([lon, lat]) => [this.aX(lon), this.aZ(lat)]));
    // --- líneas: una torre cada ~160 m y tres conductores con flecha de catenaria
    const cond: number[] = [], torres: { x: number; y: number; z: number; ang: number; alto: number }[] = [];
    for (const [kv, ps, circuitos] of d.lineas) {
      const alto = kv >= 200 ? 42 : 30, sep = kv >= 200 ? 7 : 4.5, vano = 160;
      const pts = ps.map(([lon, lat]) => new THREE.Vector2(this.aX(lon), this.aZ(lat)));
      if (pts.reduce((l, p, i) => l + (i ? p.distanceTo(pts[i - 1]) : 0), 0) < 60) continue;       // barras internas de una subestación
      const puestos: { x: number; z: number; ang: number }[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], largo = a.distanceTo(b), ang = Math.atan2(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.round(largo / vano));
        for (let k = 0; k < n; k++) puestos.push({ x: a.x + (b.x - a.x) * k / n, z: a.y + (b.y - a.y) * k / n, ang });
      }
      const u = pts[pts.length - 1];
      if (pts.length > 1) puestos.push({ x: u.x, z: u.y, ang: puestos[puestos.length - 1].ang });
      const ts = puestos.filter(p => dentro(p.x, p.z)).map(p => ({ ...p, y: this.alturaXZ(p.x, p.z), alto: this.huellasSub.some(h => enPoligono(p.x, p.z, h)) ? 12 : alto }));
      ts.forEach(t => torres.push(t));
      if (ts.length > 1) {
        this.elementosEnergia.push({
          nombre: `Línea de transmisión · ${kv} kV`,
          detalle: `Red eléctrica aérea · ${circuitos ?? 1} circuito${(circuitos ?? 1) > 1 ? 's' : ''} · torre cada ~160 m · OpenStreetMap`,
          pts: ts.map(t => new THREE.Vector3(t.x, t.y + t.alto, t.z)), radio: 1.6,
        });
      }
      for (let i = 0; i < ts.length - 1; i++) {
        const a = ts[i], b = ts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L > vano * 2.5) continue;       // un salto largo es un tramo que sale del mapa
        const nx = Math.cos(a.ang), nz = -Math.sin(a.ang);
        for (const lado of [-1, 0, 1]) {
          const ox = nx * sep * lado, oz = nz * sep * lado, ha = a.alto - (lado === 0 ? 0 : 3), hb = b.alto - (lado === 0 ? 0 : 3);
          let px = a.x + ox, py = a.y + ha, pz = a.z + oz;
          for (let s = 1; s <= 8; s++) {
            const f = s / 8, x = a.x + (b.x - a.x) * f + ox, z = a.z + (b.z - a.z) * f + oz;
            const y = a.y + ha + (b.y + hb - a.y - ha) * f - Math.sin(f * Math.PI) * Math.min(L * 0.025, 6);
            cond.push(px, py, pz, x, y, z);
            px = x; py = y; pz = z;
          }
        }
      }
    }
    if (cond.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(cond, 3));
      grupo.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x80878e, transparent: true, opacity: 0.9 })));
    }
    if (torres.length) {
      // torre de celosía barata: cuatro caras de un tronco de pirámide y dos láminas de cruceta con la trama dibujada en una textura calada
      // (patas, anillos y diagonales en X); 8 + 4 triángulos por torre en vez de cientos de barras
      const trama = (dibujar: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): THREE.CanvasTexture => {
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const g = cv.getContext('2d')!;
        g.strokeStyle = '#fff'; g.lineCap = 'square';
        dibujar(g, w, h);
        const tx = new THREE.CanvasTexture(cv);
        tx.anisotropy = 4;
        return tx;
      };
      const texCuerpo = trama((g, w, h) => {
        const NIV = 7;
        g.lineWidth = 9; g.beginPath(); g.moveTo(5, h); g.lineTo(5, 0); g.moveTo(w - 5, h); g.lineTo(w - 5, 0); g.stroke();
        g.lineWidth = 5;
        for (let k = 0; k <= NIV; k++) { const y = (h * k) / NIV; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
        for (let k = 0; k < NIV; k++) {
          const y0 = (h * k) / NIV, y1 = (h * (k + 1)) / NIV;
          g.beginPath(); g.moveTo(5, y0); g.lineTo(w - 5, y1); g.moveTo(w - 5, y0); g.lineTo(5, y1); g.stroke();
        }
      }, 64, 256);
      const texBrazo = trama((g, w, h) => {
        // cruceta triangulada (de -1 a 1 m, y de -0,7 a 1,9 m): cordones inferior y superior hacia la punta, montantes y diagonales
        const tip = h * 0.73, c = w / 2;
        g.lineWidth = 7;
        g.beginPath();
        for (const [x, lado] of [[0, 1], [w, -1]] as const) {
          g.moveTo(c + lado * -w * 0.06, h * 0.96); g.lineTo(x, tip);
          g.moveTo(c + lado * -w * 0.06, h * 0.04); g.lineTo(x, tip);
        }
        g.stroke();
        g.lineWidth = 4;
        g.beginPath();
        for (const f of [0.18, 0.34]) {
          for (const x of [c - c * (1 - f) , c + c * (1 - f)]) { g.moveTo(x, tip - (tip - h * 0.04) * f * 0.0 - (tip - h * 0.04) * (1 - f) * 0.9); g.lineTo(x, tip + (h * 0.96 - tip) * (1 - f) * 0.9); }
        }
        g.moveTo(c * 0.4, h * 0.2); g.lineTo(c * 0.7, h * 0.6); g.moveTo(w - c * 0.4, h * 0.2); g.lineTo(w - c * 0.7, h * 0.6);
        g.stroke();
      }, 128, 64);
      const wb = 2.2, wt = 0.5, pos4: number[] = [], uv4: number[] = [], idx4: number[] = [];
      const esq: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      esq.forEach(([x0, z0], i) => {
        const [x1, z1] = esq[(i + 1) % 4], o = pos4.length / 3;
        pos4.push(x0 * wb, 0, z0 * wb, x1 * wb, 0, z1 * wb, x1 * wt, 1, z1 * wt, x0 * wt, 1, z0 * wt);
        uv4.push(0, 0, 1, 0, 1, 1, 0, 1);
        idx4.push(o, o + 1, o + 2, o, o + 2, o + 3);
      });
      const cuerpo = new THREE.BufferGeometry();
      cuerpo.setAttribute('position', new THREE.Float32BufferAttribute(pos4, 3));
      cuerpo.setAttribute('uv', new THREE.Float32BufferAttribute(uv4, 2));
      cuerpo.setIndex(idx4);
      cuerpo.computeVertexNormals();
      // cruceta: lámina vertical (vista de frente) y otra horizontal con la misma trama (vista desde arriba), para que se lea desde cualquier ángulo
      const cruceta = mergeGeometries([new THREE.PlaneGeometry(2, 2.6).translate(0, 0.6, 0), new THREE.PlaneGeometry(2, 1.8).rotateX(-Math.PI / 2).translate(0, 0.2, 0)], false);
      const matCuerpo = new THREE.MeshStandardMaterial({ color: 0xb4bac0, map: texCuerpo, alphaTest: 0.5, roughness: 0.7, metalness: 0.5, side: THREE.DoubleSide });
      const mat = new THREE.MeshStandardMaterial({ color: 0xb4bac0, map: texBrazo, alphaTest: 0.5, roughness: 0.7, metalness: 0.5, side: THREE.DoubleSide });
      const im = new THREE.InstancedMesh(cuerpo, matCuerpo, torres.length), ic = new THREE.InstancedMesh(cruceta, mat, torres.length * 2);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Vector3(), pos = new THREE.Vector3();
      torres.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ang);
        im.setMatrixAt(i, m.compose(pos.set(t.x, t.y, t.z), q, e.set(1, t.alto, 1)));
        const brazo = (t.alto > 36 ? 16 : 10) / 2;
        ic.setMatrixAt(i * 2, m.compose(pos.set(t.x, t.y + t.alto, t.z), q, e.set(brazo, 1, 1)));
        ic.setMatrixAt(i * 2 + 1, m.compose(pos.set(t.x, t.y + t.alto - 3, t.z), q, e.set(brazo * 0.7, 1, 1)));
      });
      // cadenas de aisladores colgando de las cuatro puntas de cruceta de cada torre
      const matAis = new THREE.MeshStandardMaterial({ color: 0xcdb9a3, roughness: 0.5 });
      const ia = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 6).translate(0, -1.2, 0), matAis, torres.length * 4);
      const puntaLocal = new THREE.Vector3();
      torres.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ang);
        const brazo = (t.alto > 36 ? 16 : 10) / 2;
        let k = 0;
        for (const [dy, f] of [[0, 1], [-3, 0.7]] as const) for (const lado of [-1, 1]) {
          puntaLocal.set(lado * brazo * f, 0, 0).applyQuaternion(q);
          ia.setMatrixAt(i * 4 + k++, m.compose(pos.set(t.x + puntaLocal.x, t.y + t.alto + dy, t.z + puntaLocal.z), new THREE.Quaternion(), e.set(1, 1, 1)));
        }
      });
      for (const o of [im, ic, ia]) { o.castShadow = true; grupo.add(o); }
    }
    // --- subestaciones: patio de grava, transformadores y aisladores
    for (const [nombreSub, kvSub, ps] of d.subs) {
      const xz = ps.map(([lon, lat]) => [this.aX(lon), this.aZ(lat)]);
      const cx = xz.reduce((s, p) => s + p[0], 0) / xz.length, cz = xz.reduce((s, p) => s + p[1], 0) / xz.length;
      if (!dentro(cx, cz)) continue;
      this.elementosEnergia.push({
        nombre: /subestaci/i.test(nombreSub) ? nombreSub : `Subestación ${nombreSub}`,
        detalle: `Subestación eléctrica${kvSub ? ` · ${kvSub} kV` : ''} · OpenStreetMap`,
        pts: [new THREE.Vector3(cx, this.alturaXZ(cx, cz) + 4, cz)], radio: 18,
        pin: { cat: 'srv-subestacion', tipo: `Subestación eléctrica${kvSub ? ` de ${kvSub} kV` : ''}`, estado: 'En operación', fuente: 'OpenStreetMap', aprox: false, alto: 9 },
      });
      this.construirSubestacion(grupo, nombreSub, xz);
    }
    // --- plantas y tanques
    const COLOR: Record<string, number> = { hidro: 0x5f8fb4, ptap: 0x4aa3a8, tanque: 0xdfe6ea };
    for (const [tipo, nombrePlanta, ps] of d.plantas) {
      const xz = ps.map(([lon, lat]) => [this.aX(lon), this.aZ(lat)]);
      const cx = xz.reduce((s, p) => s + p[0], 0) / xz.length, cz = xz.reduce((s, p) => s + p[1], 0) / xz.length;
      if (!dentro(cx, cz)) continue;
      this.elementosEnergia.push({
        nombre: nombrePlanta,
        detalle: `${{ hidro: 'Central hidroeléctrica', ptap: 'Planta de tratamiento de agua', tanque: 'Tanque de agua' }[tipo] ?? 'Instalación'} · OpenStreetMap`,
        pts: [new THREE.Vector3(cx, this.alturaXZ(cx, cz) + 4, cz)], radio: 14,
        pin: {
          cat: ({ hidro: 'srv-central', ptap: 'srv-tratamiento', tanque: 'srv-tanque' } as Record<string, CategoriaServicio>)[tipo] ?? 'srv-tanque',
          tipo: ({ hidro: 'Central hidroeléctrica', ptap: 'Planta de tratamiento de agua', tanque: 'Tanque de agua' } as Record<string, string>)[tipo] ?? 'Instalación',
          estado: 'En operación', fuente: 'OpenStreetMap', aprox: false, alto: tipo === 'hidro' ? 20 : 11,
        },
      });
      const mat = new THREE.MeshStandardMaterial({ color: tipo === 'hidro' ? 0xd6d3ca : COLOR[tipo] ?? 0xcccccc, roughness: 0.6, metalness: 0.2 });
      const hs = xz.map(p => this.alturaXZ(p[0], p[1])), base = Math.min(...hs) - 0.5, tope = Math.max(...hs);
      let obj: THREE.Mesh;
      if (xz.length >= 3) {
        // casa de máquinas: muros asentados en la ladera (desde el punto más bajo) y cubierta aparte
        const forma = new THREE.Shape(xz.map(p => new THREE.Vector2(p[0] - cx, -(p[1] - cz))));
        const alto = tipo === 'hidro' ? 9 : 8, cuerpo = tope - base + alto;
        obj = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: cuerpo, bevelEnabled: false }).rotateX(-Math.PI / 2), mat);
        if (tipo === 'hidro') {
          const techo = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: 0.7, bevelEnabled: false }).rotateX(-Math.PI / 2).scale(1.03, 1, 1.03), new THREE.MeshStandardMaterial({ color: 0x4f6f8a, roughness: 0.7 }));
          techo.position.set(cx, tope + alto + 0.1, cz);
          techo.castShadow = true;
          grupo.add(techo);
        }
      } else {
        obj = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 7, 20).translate(0, 3.5, 0), mat);     // nodo: tanque / planta pequeña
      }
      obj.position.set(cx, xz.length >= 3 ? base : tope, cz);
      obj.castShadow = obj.receiveShadow = true;
      grupo.add(obj);
    }
    this.grupoRedes = grupo;
    this.hayRedes = true;
    grupo.visible = this.redesVisibles();
    this.escena.add(grupo);
  }

  /**
   * Modo subterráneo: la superficie (terreno, edificios, vegetación, vías) se vuelve translúcida y se muestran las redes de
   * acueducto y alcantarillado del geoportal de EPM, enterradas a su profundidad (exagerada para que se lea). Se cargan al primer uso.
   */
  readonly subterraneo = signal(false);
  readonly cargandoRedesAgua = signal(false);
  readonly leyendaRedes = [
    { nombre: 'Línea de alta tensión', nota: '110 a 230 kV · OpenStreetMap', color: '#80878e' },
  ];
  readonly leyendaSub = [
    { nombre: 'Acueducto · primaria', color: '#2f8fff' }, { nombre: 'Acueducto · secundaria', color: '#7fd4ff' },
    { nombre: 'Alcantarillado sanitario', color: '#e0903f' }, { nombre: 'Alcantarillado lluvias', color: '#4cc79a' },
    { nombre: 'Cámaras · tanques · hidrantes', color: '#e5564b' },
  ];
  private grupoSub: THREE.Group | null = null;
  private superficieOriginal = new Map<THREE.Material, { transparent: boolean; opacity: number; depthWrite: boolean }>();

  /**
   * Barrios del casco urbano (scripts/generar_barrios.py: manzanas del catastro unidas por código de barrio, con los
   * nombres del PBOT 2020). Se cargan al encenderlos: una cinta de color sobre el borde de cada barrio y su nombre encima.
   */
  readonly barriosVisibles = signal(false);
  readonly cargandoBarrios = signal(false);
  private grupoBarrios: THREE.Group | null = null;

  alternarBarrios(): void {
    if (!this.grupoBarrios) {
      if (this.cargandoBarrios()) return;
      this.cargandoBarrios.set(true);
      this.http.get<Barrios>(`data/mapa3d/barrios-${ID_MUNICIPIO}.geojson`).subscribe({
        next: d => { this.construirBarrios(d); this.cargandoBarrios.set(false); this.barriosVisibles.set(true); },
        error: () => this.cargandoBarrios.set(false),
      });
      return;
    }
    this.barriosVisibles.update(v => !v);
    this.grupoBarrios.visible = this.barriosVisibles();
  }

  private construirBarrios(d: Barrios): void {
    this.nBarrios = d.features.length;
    const grupo = new THREE.Group();
    const PASO = 8, ALTO = 10;                // m entre muestras del borde sobre el relieve · alto de la cinta
    d.features.forEach((f, i) => {
      const { nombre, rotulo } = f.properties;
      const color = nombre ? new THREE.Color().setHSL((i * 0.618034) % 1, 0.75, 0.5) : new THREE.Color('#8a9099');
      const cinta: number[] = [], borde: number[] = [];
      const poligonos = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const anillo of poligonos.map(p => p[0])) {
        const puntos: THREE.Vector3[] = [];
        for (let k = 0; k < anillo.length - 1; k++) {
          const [lo0, la0] = anillo[k], [lo1, la1] = anillo[k + 1];
          const L = Math.hypot((lo1 - lo0) * this.mLon, (la1 - la0) * this.mLat), n = Math.max(1, Math.ceil(L / PASO));
          for (let s = 0; s < n; s++) {
            const lo = lo0 + (lo1 - lo0) * s / n, la = la0 + (la1 - la0) * s / n;
            puntos.push(new THREE.Vector3(this.aX(lo), this.alturaEn(lo, la) + 0.5, this.aZ(la)));
          }
        }
        puntos.push(puntos[0]);
        for (let k = 0; k < puntos.length - 1; k++) {
          const a = puntos[k], b = puntos[k + 1];
          cinta.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y + ALTO, b.z, a.x, a.y, a.z, b.x, b.y + ALTO, b.z, a.x, a.y + ALTO, a.z);
          borde.push(a.x, a.y + ALTO, a.z, b.x, b.y + ALTO, b.z);
        }
      }
      const gc = new THREE.BufferGeometry();
      gc.setAttribute('position', new THREE.Float32BufferAttribute(cinta, 3));
      const mc = new THREE.Mesh(gc, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      mc.renderOrder = 3;
      grupo.add(mc);
      const gb = new THREE.BufferGeometry();
      gb.setAttribute('position', new THREE.Float32BufferAttribute(borde, 3));
      grupo.add(new THREE.LineSegments(gb, new THREE.LineBasicMaterial({ color })));
      if (nombre && rotulo) grupo.add(this.rotuloBarrio(nombre, color, rotulo));
    });
    grupo.visible = true;
    this.grupoBarrios = grupo;
    this.escena.add(grupo);
  }

  /** Nombre del barrio en una etiqueta que mira a la cámara, sobre su punto interior; no la tapan los techos. */
  private rotuloBarrio(nombre: string, color: THREE.Color, [lon, lat]: [number, number]): THREE.Sprite {
    const c = document.createElement('canvas'), x = c.getContext('2d')!;
    const fuente = '600 44px system-ui, sans-serif';
    x.font = fuente;
    const w = Math.ceil(x.measureText(nombre).width) + 44, h = 72;
    c.width = w; c.height = h;
    x.font = fuente;
    x.fillStyle = 'rgba(255,255,255,.92)';
    x.beginPath(); x.roundRect(2, 2, w - 4, h - 4, 18); x.fill();
    x.lineWidth = 5; x.strokeStyle = `#${color.getHexString()}`; x.stroke();
    x.fillStyle = '#1f2d3a'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(nombre, w / 2, h / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    // tamaño fijo en pantalla (sin perspectiva): se lee igual de lejos que de cerca
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    const alto = 0.026;                       // fracción del alto de la vista
    s.scale.set(alto * w / h, alto, 1);
    s.position.set(this.aX(lon), this.alturaEn(lon, lat) + 15, this.aZ(lat));
    // de lejos los 17 nombres se montan unos sobre otros: aparecen al acercarse (de 2,6 km a 1,6 km de la cámara)
    const material = s.material;
    s.onBeforeRender = (_r, _e, cam) => {
      material.opacity = Math.min(1, Math.max(0, (2600 - cam.position.distanceTo(s.position)) / 1000));
    };
    s.renderOrder = 12;
    return s;
  }

  /**
   * Tráfico estimado (scripts/estimar_trafico_vias.py y proyectar_trafico_trapiche.py): vehículos por día en cada tramo,
   * de un modelo gravitacional calibrado con el conteo del peaje El Trapiche (ANI). Una cinta sobre la calzada, más
   * gruesa y más roja cuanto más tráfico; al tocarla dice la cifra, su rango entre escenarios y su confianza.
   */
  readonly flujoVisible = signal(false);
  readonly cargandoFlujo = signal(false);
  readonly flujoPeaje = signal(0);
  readonly leyendaFlujo = CLASES_TRAFICO.map(c => ({ nombre: c.nombre, color: c.color, nota: c.nota }));
  private grupoFlujo: THREE.Group | null = null;
  private elementosFlujo: ElementoRed[] = [];
  private datosFlujo: { red: TraficoRed; proy: TraficoPeaje } | null = null;

  alternarFlujo(): void {
    if (!this.grupoFlujo) {
      if (this.cargandoFlujo()) return;
      this.cargandoFlujo.set(true);
      forkJoin({
        red: this.http.get<TraficoRed>(`data/mapa3d/trafico-${ID_MUNICIPIO}.json`),
        proy: this.http.get<TraficoPeaje>(`data/mapa3d/trafico-trapiche-${ID_MUNICIPIO}.json`),
      }).subscribe({
        next: d => {
          this.datosFlujo = d;
          this.construirFlujo(d.red, d.proy);
          this.flujoPeaje.set(d.proy.base.tpd);
          this.cargandoFlujo.set(false);
          this.flujoVisible.set(true);
        },
        error: () => this.cargandoFlujo.set(false),
      });
      return;
    }
    this.flujoVisible.update(v => !v);
    this.grupoFlujo.visible = this.flujoVisible();
    if (!this.flujoVisible()) this.soltarRed();
  }

  private construirFlujo(d: TraficoRed, p: TraficoPeaje): void {
    const PASO = 12;                                       // m entre muestras sobre la calzada
    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');      // como el pipe `number` del resto de la app
    // una malla por clase: de lejos cada una engorda distinto, para que la jerarquía se lea en la vista general
    const mallas = new Map(CLASES_TRAFICO.map(c => [c.c, { pos: [] as number[], idx: [] as number[], col: [] as number[] }]));
    for (const t of d.tramos) {
      const cl = CLASES_TRAFICO.find(c => c.c === t.c) ?? CLASES_TRAFICO[CLASES_TRAFICO.length - 1];
      const color = new THREE.Color(cl.color);
      const { pos, idx, col } = mallas.get(cl.c)!;
      const pts: THREE.Vector3[] = [];
      const punto = (lo: number, la: number) => {
        const x = this.aX(lo), z = this.aZ(la);
        return new THREE.Vector3(x, this.calzadaXZ(x, z) + cl.radio + 0.6, z);
      };
      for (let k = 0; k < t.g.length - 1; k++) {
        const [lo0, la0] = t.g[k], [lo1, la1] = t.g[k + 1];
        const n = Math.max(1, Math.ceil(Math.hypot((lo1 - lo0) * this.mLon, (la1 - la0) * this.mLat) / PASO));
        for (let s = 0; s < n; s++) pts.push(punto(lo0 + (lo1 - lo0) * s / n, la0 + (la1 - la0) * s / n));
      }
      pts.push(punto(...t.g[t.g.length - 1]));
      for (let k = 0; k < pts.length - 1; k++) prisma(pts[k], pts[k + 1], cl.radio, pos, idx, col, color);
      this.elementosFlujo.push({
        nombre: `≈ ${fmt(t.vd)} vehículos por día`,
        detalle: t.conf === 'medida'
          ? `Conteo del peaje El Trapiche · ANI ${d.anio} · ambas calzadas`
          : `Tráfico ${t.c} estimado · rango ${fmt(t.min)}–${fmt(t.max)} · confianza ${t.conf}${t.dc ? ' · suma de ambas calzadas' : ''}`,
        pts, radio: cl.radio,
      });
    }
    const grupo = new THREE.Group();
    // de menos a más tráfico: las cintas gruesas se pintan encima de las delgadas en los cruces
    [...CLASES_TRAFICO].reverse().forEach((cl, orden) => {
      const { pos, idx, col } = mallas.get(cl.c)!;
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const malla = new THREE.Mesh(g, engrosar(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }), cl.lejos, 30));
      malla.renderOrder = 4 + orden * 0.01;
      malla.frustumCulled = false;
      grupo.add(malla);
    });
    grupo.add(this.rotuloBarrio(`Peaje El Trapiche · ${fmt(p.base.tpd)} veh/día`, new THREE.Color('#d32f2f'), [p.lon, p.lat]));
    grupo.visible = true;
    this.grupoFlujo = grupo;
    this.escena.add(grupo);
  }

  alternarSubterraneo(): void {
    const activar = !this.subterraneo();
    if (activar && !this.grupoSub) {
      if (this.cargandoRedesAgua()) return;
      this.cargandoRedesAgua.set(true);
      this.http.get<RedesAgua>(`data/mapa3d/redes-agua-${ID_MUNICIPIO}.json`).subscribe({
        next: d => { this.construirRedesAgua(d); this.cargandoRedesAgua.set(false); this.aplicarSubterraneo(true); },
        error: () => this.cargandoRedesAgua.set(false),
      });
      return;
    }
    this.aplicarSubterraneo(activar);
  }

  private aplicarSubterraneo(activar: boolean): void {
    this.soltarRed();
    this.subterraneo.set(activar);
    if (this.grupoSub) this.grupoSub.visible = activar;
    if (this.grupoRedes) this.grupoRedes.visible = activar || this.redesVisibles();      // en el subterráneo siguen a la vista los modelos de agua y electricidad
    if (activar) {
      this.escena.traverse(o => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.Points) || this.dentroDe(o, this.grupoSub) || this.dentroDe(o, this.grupoRedes) || o === this.mallaTanques) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m instanceof THREE.ShaderMaterial || this.superficieOriginal.has(m)) continue;
          this.superficieOriginal.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
          m.transparent = true;
          m.opacity = 0.17;
          m.depthWrite = false;
          m.needsUpdate = true;
        }
      });
    } else {
      this.superficieOriginal.forEach((v, m) => { m.transparent = v.transparent; m.opacity = v.opacity; m.depthWrite = v.depthWrite; m.needsUpdate = true; });
      this.superficieOriginal.clear();
    }
  }

  private dentroDe(o: THREE.Object3D, grupo: THREE.Object3D | null): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === grupo) return true;
    return false;
  }

  private construirRedesAgua(d: RedesAgua): void {
    const mitadX = this.ancho / 2, mitadZ = this.alto / 2;
    const dentro = (x: number, z: number) => Math.abs(x) < mitadX && Math.abs(z) < mitadZ;
    const COLOR: Record<string, THREE.Color> = {
      a1: new THREE.Color('#2f8fff'), a2: new THREE.Color('#7fd4ff'), rs: new THREE.Color('#e0903f'), rl: new THREE.Color('#4cc79a'),
    };
    const PROF: Record<string, number> = { a1: 2.5, a2: 1.8, rs: 3, rl: 3 };
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    for (const [tipo, diam, prof, ps, material, estado, circuito] of d.t) {
      const r = 0.25 + diam / 1000 * 1.2, c = COLOR[tipo] ?? COLOR['a2'];
      const hondo = Math.max(1.5, (prof > 0 ? prof : PROF[tipo] ?? 2) * 1.8);
      const puntos = ps.map(([lon, lat]) => { const x = this.aX(lon), z = this.aZ(lat); return new THREE.Vector3(x, this.alturaXZ(x, z) - hondo, z); });
      const visibles = puntos.filter(p => dentro(p.x, p.z));
      for (let i = 0; i < puntos.length - 1; i++) {
        const a = puntos[i], b = puntos[i + 1];
        if (dentro(a.x, a.z) && dentro(b.x, b.z)) prisma(a, b, r, pos, idx, col, c);
      }
      if (visibles.length > 1) {
        const cap = tipo === 'a1' || tipo === 'a2' ? 'Red subterránea de acueducto' : 'Red subterránea de alcantarillado';
        this.elementosAgua.push({
          nombre: `${NOMBRE_TUBERIA[tipo] ?? 'Tubería'}${diam ? ` · Ø ${Math.round(diam)} mm` : ''}`,
          detalle: [cap, material.toLowerCase(), prof ? `a ${prof.toFixed(1).replace('.', ',')} m de profundidad` : '', estado.toLowerCase(), circuito ? circuito.toLowerCase() : '', 'geoportal EPM'].filter(Boolean).join(' · '),
          pts: visibles, radio: r,
        });
      }
    }
    const grupo = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tubos = new THREE.Mesh(geo, engrosar(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1, emissive: 0x334455, emissiveIntensity: 0.9, side: THREE.DoubleSide }), 0.003, 34));
    tubos.frustumCulled = false;
    grupo.add(tubos);
    // puntos: cámaras (pozo vertical hasta la superficie), válvulas, hidrantes, descargas y tanques
    const por = (t: string) => d.p.filter(p => p[0] === t).map(([, lon, lat, dato]) => { const x = this.aX(lon), z = this.aZ(lat); return { x, z, y: this.alturaXZ(x, z), dato }; }).filter(p => dentro(p.x, p.z));
    const instanciar = (g: THREE.BufferGeometry, color: number, items: { x: number; y: number; z: number }[], dy: (i: { y: number }) => number, escala?: (i: { dato?: number }) => number) => {
      if (!items.length) return;
      const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.25 }), items.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Vector3(1, 1, 1);
      items.forEach((p, i) => { const s = escala ? escala(p as { dato?: number }) : 1; im.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, dy(p), p.z), q, e.set(s, 1, s))); });
      im.frustumCulled = false;
      grupo.add(im);
    };
    instanciar(new THREE.CylinderGeometry(0.9, 0.9, 3.4, 8).translate(0, 1.7, 0), 0xb9763a, por('cm'), p => p.y - 3.2);
    instanciar(new THREE.CylinderGeometry(0.35, 0.4, 1.3, 6).translate(0, 0.65, 0), 0xe5564b, por('hd'), p => p.y);
    instanciar(new THREE.BoxGeometry(1.6, 1.6, 1.6), 0x2f8fff, por('vl'), p => p.y - 2.2);
    instanciar(new THREE.ConeGeometry(1.6, 3, 8).translate(0, 1.5, 0), 0xe0903f, por('ds'), p => p.y);
    for (const t of por('tq')) {
      const r = Math.min(18, Math.max(4, Math.sqrt((t.dato || 200) / (Math.PI * 6)))), alto = 7;
      const tq = new THREE.Mesh(new THREE.CylinderGeometry(r, r, alto, 28), new THREE.MeshStandardMaterial({ color: 0x9ed8ff, roughness: 0.4, emissive: 0x2f8fff, emissiveIntensity: 0.3 }));
      tq.position.set(t.x, t.y + alto / 2 - 1, t.z);
      grupo.add(tq);
    }
    // el modo subterráneo se pinta después de la superficie translúcida, sin quedar tapado por ella
    grupo.traverse(o => { o.renderOrder = 2; });
    this.grupoSub = grupo;
    this.escena.add(grupo);
  }

  /**
   * Instalaciones de agua del PBOT: bocatomas (caja de captación con mástil azul para ubicarlas de lejos), sistemas de tratamiento rural
   * (dos tanques circulares y caseta), y las áreas proyectadas de la PTAR urbana y de la ECA (huella translúcida, aún sin construir).
   * Van en el grupo de redes y se eligen como el resto.
   */
  private construirInstalacionesAgua(items: InstalacionAgua[]): void {
    if (!items.length) return;
    if (!this.grupoRedes) { this.grupoRedes = new THREE.Group(); this.grupoRedes.visible = this.redesVisibles(); this.escena.add(this.grupoRedes); this.hayRedes = true; }
    const grupo = this.grupoRedes;
    const mat = (c: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.65, ...extra });
    const concreto = mat(0xb9bdc0), azul = mat(0x2f8fff, { emissive: 0x1d5fb0, emissiveIntensity: 0.5 }), teal = mat(0x4aa3a8), caseta = mat(0xd9d4c7), techo = mat(0x7d6f63);
    const ROTULO: Record<string, string> = {
      bocatoma: 'Bocatoma de acueducto veredal', ptar_rural: 'Sistema de tratamiento de agua residual rural',
      ptar_urbana: 'Área para la PTAR urbana', eca: 'Estación de clasificación y aprovechamiento (ECA)',
    };
    const poner = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = o.receiveShadow = true;
      grupo.add(o);
    };
    for (const [tipo, nombre, lon, lat, estado, radio] of items) {
      const x = this.aX(lon), z = this.aZ(lat), y = this.alturaXZ(x, z);
      if (Math.abs(x) > this.ancho / 2 || Math.abs(z) > this.alto / 2) continue;
      if (tipo === 'bocatoma') {
        const vivo = mat(0xffd23f, { emissive: 0xffa800, emissiveIntensity: 0.6 });
        poner(new THREE.CylinderGeometry(8, 8, 0.5, 28), vivo, x, y + 0.3, z);                       // plataforma amarilla visible desde lejos
        poner(new THREE.TorusGeometry(8, 0.5, 6, 32).rotateX(Math.PI / 2), azul, x, y + 0.7, z);
        poner(new THREE.BoxGeometry(4, 2.4, 3.2), concreto, x, y + 1.2, z);
        poner(new THREE.BoxGeometry(4.6, 0.4, 3.8), techo, x, y + 2.6, z);
        poner(new THREE.CylinderGeometry(0.35, 0.35, 14, 8), azul, x, y + 7, z);
        poner(new THREE.SphereGeometry(1.1, 12, 8), azul, x, y + 14.4, z);
      } else if (tipo === 'ptar_rural') {
        for (const dx of [-5.5, 5.5]) poner(new THREE.CylinderGeometry(4, 4, 3, 20), teal, x + dx, y + 1.5, z);
        poner(new THREE.BoxGeometry(5, 3.4, 4), caseta, x, y + 1.7, z + 7);
        poner(new THREE.BoxGeometry(5.6, 0.5, 4.6), techo, x, y + 3.6, z + 7);
        poner(new THREE.CylinderGeometry(0.35, 0.35, 12, 8), mat(0x4aa3a8, { emissive: 0x2a7a7f, emissiveIntensity: 0.5 }), x, y + 6, z - 6);
      } else {
        const color = tipo === 'eca' ? 0xe0903f : 0x2bb3bf;
        const disco = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, 0.6, 40), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.4, roughness: 1, depthWrite: false }));
        disco.position.set(x, y + 0.6, z);
        grupo.add(disco);
        const aro = new THREE.Mesh(new THREE.TorusGeometry(radio, 0.7, 6, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color }));
        aro.position.set(x, y + 0.9, z);
        grupo.add(aro);
      }
      this.elementosEnergia.push({
        nombre,
        detalle: `${ROTULO[tipo] ?? 'Instalación'} · ${estado === 'proyecto' ? 'proyecto, aún no construida' : 'en operación'} · PBOT de Girardota (ubicación aproximada)`,
        pts: [new THREE.Vector3(x, y + 4, z)], radio: Math.max(14, radio * 0.6),
        pin: {
          cat: ({ bocatoma: 'srv-bocatoma', ptar_rural: 'srv-tratamiento', ptar_urbana: 'srv-ptar', eca: 'srv-eca' } as Record<string, CategoriaServicio>)[tipo] ?? 'srv-tratamiento',
          tipo: ROTULO[tipo] ?? 'Instalación', estado: estado === 'proyecto' ? 'Proyecto, aún no construida' : 'En operación',
          fuente: 'PBOT de Girardota, revisión 2022 (Figura 2-78)', aprox: true, alto: tipo === 'bocatoma' ? 18 : tipo === 'ptar_rural' ? 12 : 8,
        },
      });
    }
  }

  /** Edificios de servicios públicos con pin (mismo orden que `ref.i` de sus iconos). */
  private servicios: ElementoRed[] = [];
  private servicioHover = -1;

  private construirPinesServicios(): void {
    this.servicios = this.elementosEnergia.filter(e => e.pin);
    this.servicios.forEach((e, i) => {
      const p = e.pin!, c = e.pts[0], info = SERVICIOS.find(x => x.id === p.cat)!;
      const icono = crearIcono(p.cat, info.color, c.x, c.y - 4 + p.alto, c.z);
      icono.ref = { tipo: 'servicio', i };
      icono.zona = this.idEn(this.lon0 + c.x / this.mLon, this.lat0 - c.z / this.mLat);
      this.iconosEquip.push(icono);
      this.escena.add(icono.sprite);
    });
    this.agrupadorIconos ??= crearAgrupador(this.iconosEquip, this.escena, this.pinVisible);
  }

  private asegurarRotuloEquip(): HTMLElement {
    if (!this.rotuloEquip) {
      this.rotuloEquip = document.createElement('div');
      this.rotuloEquip.className = 'rot fabrica';
      this.rotuloEquip.append(document.createElement('i'), document.createElement('span'));
      this.contenedorRotulos.nativeElement.appendChild(this.rotuloEquip);
    }
    return this.rotuloEquip;
  }

  /** Cápsula con el nombre de un edificio de servicios públicos al pasar el cursor por su pin. */
  private marcarServicioHover(i: number): void {
    this.servicioHover = i;
    if (i < 0) {
      if (this.equipHover < 0 && this.rotuloEquip) this.rotuloEquip.style.display = 'none';
      return;
    }
    const el = this.asegurarRotuloEquip(), e = this.servicios[i];
    (el.firstElementChild as HTMLElement).style.background = SERVICIOS.find(x => x.id === e.pin!.cat)?.color ?? '';
    el.lastElementChild!.textContent = e.nombre;
    el.style.display = '';
  }

  /** Posición (m) del edificio que señala un pin. */
  private posRef(ref: RefPin): { x: number; z: number } {
    if (ref.tipo === 'servicio') { const c = this.servicios[ref.i].pts[0]; return { x: c.x, z: c.z }; }
    return ref.tipo === 'fabrica' ? this.fabricas[ref.i] : this.equipamientos[ref.i];
  }

  /** Leyenda: la categoría «Servicios públicos» se pliega y despliega sus subtipos, cada uno con su pin. */
  readonly grupoServicios = SERVICIOS_GRUPO;
  readonly subtiposServicios = SERVICIOS;
  readonly serviciosAbierto = signal(false);
  serviciosActivos(): number { return SERVICIOS.filter(x => this.capasActivas().has(x.id)).length; }
  alternarServicios(): void {
    const todos = this.serviciosActivos() === SERVICIOS.length;
    this.capasActivas.update(s => { const n = new Set(s); SERVICIOS.forEach(x => todos ? n.delete(x.id) : n.add(x.id)); return n; });
  }

  /** Contorno (m, [x, z]) de cada subestación: el catastro y las torres de alta tensión que caigan dentro los reemplaza su modelo. */
  private huellasSub: number[][][] = [];
  /** Casetas de control reales (lon, lat) vistas en imagen satelital; el resto de subestaciones la pone en su lado oeste. */
  private static readonly CASETA_SUB: Record<string, [number, number]> = { Girardota: [-75.45537, 6.38309] };

  /**
   * Subestación eléctrica a partir de su contorno de OpenStreetMap: patio de grava con cerca perimetral, caseta de control larga con
   * su anexo, pórticos de barras, filas de seccionadores e interruptores con sus aisladores, y tres transformadores de potencia con
   * radiadores y bujes. Todo gira con la arista más larga del patio (así lo orienta la de Girardota, vista en imagen satelital).
   */
  private construirSubestacion(grupo: THREE.Group, nombre: string, xz: number[][]): void {
    const n = xz.length - (xz[0][0] === xz[xz.length - 1][0] && xz[0][1] === xz[xz.length - 1][1] ? 1 : 0);
    const ps = xz.slice(0, n);
    const cx = ps.reduce((s, p) => s + p[0], 0) / n, cz = ps.reduce((s, p) => s + p[1], 0) / n;
    const alturas = ps.map(p => this.alturaXZ(p[0], p[1]));
    const y0 = Math.max(...alturas) + 0.2;
    // patio de grava asentado en la ladera
    const forma = new THREE.Shape(ps.map(p => new THREE.Vector2(p[0], -p[1])));
    const prof = Math.max(0.5, y0 - Math.min(...alturas) + 0.5);
    const patio = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: prof, bevelEnabled: false }).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa8a393, roughness: 1 }));
    patio.position.y = y0 - prof;
    patio.receiveShadow = true;
    grupo.add(patio);
    // marco del patio: u sigue la arista más larga (hacia el este), v es su perpendicular
    let largo = 0, ang = 0;
    for (let i = 0; i < n; i++) {
      const a = ps[i], b = ps[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > largo) { largo = l; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); }
    }
    if (Math.cos(ang) < 0) ang += Math.PI;
    const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux, giro = Math.atan2(-uz, ux);
    const aMundo = (lu: number, lv: number): [number, number] => [cx + lu * ux + lv * vx, cz + lu * uz + lv * vz];
    const aLocal = (x: number, z: number): [number, number] => [(x - cx) * ux + (z - cz) * uz, (x - cx) * vx + (z - cz) * vz];
    const loc = ps.map(p => aLocal(p[0], p[1]));
    const minU = Math.min(...loc.map(p => p[0])), maxU = Math.max(...loc.map(p => p[0])), minV = Math.min(...loc.map(p => p[1])), maxV = Math.max(...loc.map(p => p[1]));
    const distBorde = (x: number, z: number): number => {
      let m = Infinity;
      for (let i = 0; i < n; i++) {
        const a = ps[i], b = ps[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
        const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
        m = Math.min(m, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
      }
      return m;
    };
    // caseta de control: larga en v, junto al lado oeste (o donde se vio en la imagen)
    const real = Mapa3dComponent.CASETA_SUB[nombre.replace(/^Subestación\s+/i, '')];
    const [cbx, cbz] = real ? [this.aX(real[0]), this.aZ(real[1])] : aMundo(minU + 12, (minV + maxV) / 2);
    const [cbu, cbv] = aLocal(cbx, cbz);
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), giro);
    const poner = (g: THREE.BufferGeometry, color: number, lu: number, lv: number, dy: number, rough = 0.7) => {
      const [x, z] = aMundo(lu, lv);
      const o = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: rough }));
      o.position.set(x, y0 + dy, z);
      o.rotation.y = giro;
      o.castShadow = o.receiveShadow = true;
      grupo.add(o);
    };
    poner(new THREE.BoxGeometry(13, 5.5, 42), 0xe6e3da, cbu, cbv, 2.75);                  // caseta
    poner(new THREE.BoxGeometry(13.8, 0.6, 42.8), 0xb4b8ba, cbu, cbv, 5.8);            // cubierta oscura
    poner(new THREE.BoxGeometry(7, 4, 7), 0xe0ddd2, cbu, cbv + 25, 2);                 // anexo
    poner(new THREE.BoxGeometry(7.6, 0.5, 7.6), 0xb4b8ba, cbu, cbv + 25, 4.2);
    const enCaseta = (lu: number, lv: number) => Math.abs(lu - cbu) < 13 && lv > cbv - 25 && lv < cbv + 32;
    // equipo de patio: pórticos, seccionadores, interruptores, barras (instanciados)
    const postes: THREE.Matrix4[] = [], vigas: THREE.Matrix4[] = [], aislad: THREE.Matrix4[] = [], cajas: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), uno = new THREE.Vector3(1, 1, 1);
    const ponerInst = (lista: THREE.Matrix4[], lu: number, lv: number, dy: number, sx = 1, sy = 1, sz = 1) => {
      const [x, z] = aMundo(lu, lv);
      lista.push(m.clone().compose(new THREE.Vector3(x, y0 + dy, z), quat, uno.clone().set(sx, sy, sz)));
    };
    const ruido = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
    let fila = 0;
    for (let lu = minU + 5; lu < maxU - 4; lu += 6, fila++) {
      for (let lv = minV + 7; lv < maxV - 6; lv += 14) {
        const [x, z] = aMundo(lu, lv);
        if (distBorde(x, z) < 5 || !enPoligono(x, z, ps) || enCaseta(lu, lv) || ruido(fila, lv) < 0.18) continue;
        const tipo = fila % 3;
        if (tipo === 0) {                                                  // pórtico: dos postes y la viga de barras
          ponerInst(postes, lu, lv - 6, 7.5, 1, 1.35, 1); ponerInst(postes, lu, lv + 6, 7.5, 1, 1.35, 1);
          ponerInst(vigas, lu, lv, 14.6, 0.9, 0.8, 13);
        } else if (tipo === 1) {                                           // tres columnas de aisladores y su interruptor
          for (const d of [-4, 0, 4]) { ponerInst(aislad, lu, lv + d, 2.2); ponerInst(cajas, lu, lv + d, 0.6, 1, 1, 1); }
          ponerInst(vigas, lu, lv, 4.6, 0.35, 0.35, 9);
        } else {                                                           // barra tubular baja
          ponerInst(vigas, lu, lv, 6.2, 0.3, 0.3, 12);
          ponerInst(postes, lu, lv - 5, 3.1, 0.6, 0.55, 0.6); ponerInst(postes, lu, lv + 5, 3.1, 0.6, 0.55, 0.6);
        }
      }
    }
    const instancias = (g: THREE.BufferGeometry, color: number, lista: THREE.Matrix4[], metal = 0.4) => {
      if (!lista.length) return;
      const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: metal }), lista.length);
      lista.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.frustumCulled = false;
      grupo.add(im);
    };
    instancias(new THREE.BoxGeometry(0.95, 11, 0.95), 0xb9b8b0, postes, 0.05);
    instancias(new THREE.BoxGeometry(1, 1, 1), 0xa3a6a6, vigas);
    instancias(new THREE.CylinderGeometry(0.28, 0.34, 4.2, 8), 0xcdb9a3, aislad, 0.1);
    instancias(new THREE.BoxGeometry(1.8, 1.2, 1.4), 0x7c8a96, cajas);
    // tres transformadores de potencia en el lado este del patio
    for (const f of [0.22, 0.5, 0.78]) {
      const lu = maxU - 11, lv = minV + (maxV - minV) * f;
      const [x, z] = aMundo(lu, lv);
      if (distBorde(x, z) < 6 || !enPoligono(x, z, ps) || enCaseta(lu, lv)) continue;
      poner(new THREE.BoxGeometry(7, 5.5, 5), 0x6d7f8c, lu, lv, 2.75, 0.45);
      poner(new THREE.BoxGeometry(1.4, 4.5, 4.4), 0x5d6e7a, lu - 4.4, lv, 2.4);
      poner(new THREE.BoxGeometry(1.4, 4.5, 4.4), 0x5d6e7a, lu + 4.4, lv, 2.4);
      for (const d of [-1.6, 0, 1.6]) poner(new THREE.CylinderGeometry(0.3, 0.38, 2.6, 8), 0xcdb9a3, lu, lv + d, 6.9, 0.2);
    }
    // cerca perimetral: postes cada 3 m y tres hilos
    const cercaPos: number[] = [], cercaM: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i++) {
      const a = ps[i], b = ps[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.round(l / 3));
      for (let t = 0; t <= k; t++) {
        const x = a[0] + (b[0] - a[0]) * t / k, z = a[1] + (b[1] - a[1]) * t / k, y = this.alturaXZ(x, z);
        cercaM.push(m.clone().compose(new THREE.Vector3(x, Math.max(y, y0 - 0.2) + 1.2, z), new THREE.Quaternion(), uno.clone().set(1, 1, 1)));
        if (t < k) {
          const x2 = a[0] + (b[0] - a[0]) * (t + 1) / k, z2 = a[1] + (b[1] - a[1]) * (t + 1) / k;
          for (const h of [0.5, 1.3, 2.3]) cercaPos.push(x, Math.max(y, y0 - 0.2) + h, z, x2, Math.max(this.alturaXZ(x2, z2), y0 - 0.2) + h, z2);
        }
      }
    }
    instancias(new THREE.BoxGeometry(0.16, 2.5, 0.16), 0x595f66, cercaM, 0.2);
    const gc = new THREE.BufferGeometry();
    gc.setAttribute('position', new THREE.Float32BufferAttribute(cercaPos, 3));
    grupo.add(new THREE.LineSegments(gc, new THREE.LineBasicMaterial({ color: 0x4a5057 })));
  }

  /** El neón pulsa y los iconos flotan sin tapar su edificio. */
  /** Objetos 3D de marcación que el modo fotografía esconde (anillos, halos de río y el borde del municipio). */
  private marcaciones(): THREE.Object3D[] {
    return [this.anilloHover, this.anilloFabrica, this.haloHover, this.haloElegido, this.haloSistema, this.haloRed, ...this.bordeMunicipio].filter((o): o is THREE.Object3D => !!o);
  }

  /**
   * El botón del carro no arranca de una vez: primero se elige dónde empezar con un clic en el mapa (se puede seguir
   * moviendo la cámara para buscar el sitio). Enter arranca en el centro de la pantalla y Esc cancela.
   */
  alternarConduccion(tipo: 'carro' | 'avion' = 'carro'): void {
    if (this.conduciendo()) { this.salirDeConducir(); return; }
    if (this.eligiendoSalida()) {
      if (this.vehiculo() === tipo) { this.cancelarSalida(); return; }
      this.vehiculo.set(tipo);                 // cambió de vehículo mientras elegía: sigue eligiendo el punto
      return;
    }
    this.vehiculo.set(tipo);
    this.vuelo = null;
    this.cerrarPin();
    this.eligiendoSalida.set(true);
    window.addEventListener('keydown', this.alTeclaSalida);
    this.fijarPagina();
  }

  /**
   * Mientras se elige el punto de salida y durante el vuelo o la conducción, las flechas, Espacio y Re Pág / Av Pág son del
   * vehículo y no deben mover la página del recorrido (el mapa es una sección de una página larga). Se frenan en la fase de
   * captura, antes que cualquier otro elemento, y si aun así la página se corre, se devuelve a donde estaba.
   */
  private soltarPagina?: () => void;

  private fijarPagina(): void {
    this.soltarPagina?.();
    const y = window.scrollY;
    const teclaPagina = (e: KeyboardEvent): void => {
      if (!/^(Arrow(Up|Down|Left|Right)|Space|Page(Up|Down)|Home|End)$/.test(e.code)) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
    };
    const alDesplazar = (): void => { if (window.scrollY !== y) window.scrollTo({ top: y, behavior: 'instant' }); };
    window.addEventListener('keydown', teclaPagina, { capture: true });
    window.addEventListener('scroll', alDesplazar, { passive: true });
    this.soltarPagina = () => {
      window.removeEventListener('keydown', teclaPagina, { capture: true });
      window.removeEventListener('scroll', alDesplazar);
      this.soltarPagina = undefined;
    };
  }

  empezarEnCentro(): void { this.empezarAConducir(); }

  cancelarSalida(): void {
    window.removeEventListener('keydown', this.alTeclaSalida);
    this.eligiendoSalida.set(false);
    if (!this.conduciendo()) this.soltarPagina?.();
  }

  private readonly alTeclaSalida = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') { e.preventDefault(); this.zona.run(() => this.cancelarSalida()); }
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      this.zona.run(() => { this.cancelarSalida(); this.empezarAConducir(); });
    }
  };

  /** Punto del suelo bajo el cursor (x, z del modelo), o null si el clic cae fuera del terreno. */
  private sueloBajoCursor(ev: PointerEvent): { x: number; z: number } | null {
    if (!this.proxy) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camara);
    const hit = this.raycaster.intersectObject(this.proxy)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  /**
   * Arranca la conducción en (x, z) o, sin punto, en el punto de mira. Si hay una vía cerca (120 m del clic, 80 m del
   * punto de mira) el carro aparece sobre ella, mirando en el sentido más parecido al de la cámara.
   */
  private empezarAConducir(punto?: { x: number; z: number }): void {
    const suelo = (x: number, z: number): number => {
      if (Math.abs(x) > this.ancho / 2 || Math.abs(z) > this.alto / 2) return -Infinity;
      const h = this.alturaEn(this.lon0 + x / this.mLon, this.lat0 - z / this.mLat);
      // con rasante, el carro va sobre la superficie real de la calzada o la acera (con su peralte y su bordillo)
      if (this.rasante) return this.rasante.altura(x, z) ?? h;
      // sin ella, la calzada es una cinta plana a 3 m sobre el terreno de su eje (en laderas, su borde queda aún más alto que el
      // suelo de al lado): sobre ella el carro va a esa altura, y fuera sube o baja por una rampa de 4 m
      const [d, qx, qz] = this.holguraConduccion?.(x, z) ?? [Infinity, x, z, 0, 1];
      if (d >= 4) return h;
      const calzada = this.alturaXZ(qx, qz) + 3;
      return Math.max(h, h + (calzada - h) * Math.min(1, 1 - d / 4));
    };
    const obstaculo = (p: THREE.Vector3, r: number): boolean => this.empujarCarro(p, r);
    if (this.vehiculo() === 'avion') this.conduccion = this.avioneta ??= new Avioneta(suelo, obstaculo);
    else this.conduccion = this.carro ??= new Conduccion(suelo, obstaculo);
    this.vuelo = null;
    this.cerrarPin();
    const t = this.controles.target, p = this.camara.position;
    this.antesDeConducir = { pos: p.clone(), objetivo: t.clone(), fov: this.camara.fov };
    if (!this.conduccion.objeto.parent) this.escena.add(this.conduccion.objeto);
    this.conduccion.teclas.clear();
    const o = punto ?? { x: t.x, z: t.z };
    const [dVia, vx, vz, tx, tz] = this.holguraConduccion?.(o.x, o.z) ?? [Infinity, o.x, o.z, 0, 1];
    const sobre = dVia < (punto ? 120 : 80);
    // mira la vía en el sentido más parecido al de la cámara
    const mx = t.x - p.x, mz = t.z - p.z, sentido = mx * tx + mz * tz < 0 ? -1 : 1;
    this.conduccion.aparecer(sobre ? vx : o.x, sobre ? vz : o.z, sobre ? Math.atan2(tx * sentido, tz * sentido) : Math.atan2(mx, mz));
    this.controles.enabled = false;
    this.camara.fov = 62;
    this.camara.updateProjectionMatrix();
    this.cayo.set(false);
    // al conducir la vista queda limpia (modo foto), pero conserva los nombres de las zonas para orientarse
    this.fotoPorConducir = !this.modoFoto();
    if (this.fotoPorConducir) this.alternarFoto();
    this.conduciendo.set(true);
    window.addEventListener('keydown', this.alTecla);
    window.addEventListener('keyup', this.alTecla);
    window.addEventListener('blur', this.alPerderFoco);
    this.fijarPagina();
  }

  private salirDeConducir(): void {
    window.removeEventListener('keydown', this.alTecla);
    window.removeEventListener('keyup', this.alTecla);
    window.removeEventListener('blur', this.alPerderFoco);
    this.soltarPagina?.();
    if (!this.conduciendo()) return;
    this.conduccion?.ocultar();
    this.conduccion?.teclas.clear();
    const a = this.antesDeConducir;
    if (a) {
      this.camara.position.copy(a.pos);
      this.controles.target.copy(a.objetivo);
      this.camara.fov = a.fov;
      this.camara.updateProjectionMatrix();
    }
    this.controles.enabled = true;
    this.controles.update();
    if (this.fotoPorConducir && this.modoFoto()) this.alternarFoto();
    this.fotoPorConducir = false;
    this.conduciendo.set(false);
    this.cayo.set(false);
  }

  reaparecerCarro(): void {
    this.conduccion?.reaparecer();
    this.cayo.set(false);
  }

  pulsarTecla(codigo: string, abajo: boolean): void {
    if (abajo) this.conduccion?.teclas.add(codigo); else this.conduccion?.teclas.delete(codigo);
  }

  private readonly alTecla = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
    if (e.type === 'keydown') {
      if (e.code === 'Escape') { this.zona.run(() => this.salirDeConducir()); return; }
      if (e.code === 'KeyR') { this.zona.run(() => this.reaparecerCarro()); return; }
      if (e.code === 'KeyC' || e.code === 'Digit5' || e.code === 'Numpad5') { e.preventDefault(); this.conduccion?.recentrar(); return; }
    }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right))$/.test(e.code)) {
      e.preventDefault();
      this.pulsarTecla(e.code, e.type === 'keydown');
    }
  };

  private readonly alPerderFoco = (): void => this.conduccion?.teclas.clear();

  private conducirFotograma(dt: number): void {
    const c = this.conduccion!;
    c.actualizar(dt);
    c.seguir(this.camara, dt);
    this.acercarCamaraAlCarro(this.camara.position, c.posicion);
    this.camara.lookAt(c.posicion.x, c.posicion.y + 2, c.posicion.z);
    this.controles.target.copy(c.posicion);
    this.hudAcumulado += dt;
    if (this.hudAcumulado > 0.1) {
      this.hudAcumulado = 0;
      const el = this.hudVelocidad?.nativeElement;
      if (el) el.textContent = String(Math.round(c.kmh));
      const ea = this.hudAltura?.nativeElement;
      if (ea && c instanceof Avioneta) ea.textContent = String(Math.round(c.agl));
      const dz = this.hudZona?.nativeElement;
      if (dz) {
        const p = c.posicion, id = this.idEn(this.lon0 + p.x / this.mLon, this.lat0 - p.z / this.mLat);
        dz.textContent = id >= 0 ? `${this.tipoDe(this.piezas[id].zona)} · ${this.piezas[id].zona.n}` : 'Fuera de las zonas del municipio';
      }
    }
    if (c.cayo !== this.cayo()) this.zona.run(() => this.cayo.set(c.cayo));
  }

  alternarFoto(): void {
    this.modoFoto.update(v => !v);
    const foto = this.modoFoto();
    if (foto) {
      this.cerrarPin();
      this.marcarFabricaHover(-1);
      this.marcarEquipHover(-1);
      this.visiblesAntesFoto.clear();
      for (const o of this.marcaciones()) this.visiblesAntesFoto.set(o, o.visible);
    } else {
      this.visiblesAntesFoto.forEach((v, o) => { o.visible = v; });
    }
    // el suelo pierde las zonas dibujadas (velo y límites) y el resalte del cursor
    this.texturaColor.image = foto ? this.lienzoLimpio : this.lienzoConZonas;
    this.texturaColor.needsUpdate = true;
    this.pintarResalte();
  }

  private animarAuras(t: number): void {
    const foto = this.modoFoto();
    if (foto) for (const o of this.marcaciones()) o.visible = false;
    if (this.auraEquip) this.auraEquip.grupo.visible = !foto;
    if (this.auraIndustrias) this.auraIndustrias.grupo.visible = !foto;
    this.auraEquip?.animar(t);
    this.auraIndustrias?.animar(t);
    this.agrupadorIconos?.animar(t, this.camara);
  }

  /**
   * Cada fábrica: losa de concreto que se asienta en la ladera, nave con techo en diente de sierra (cara inclinada de
   * lámina y cara vertical vidriada), bloque de oficinas con franja de ventanas, portones, silos y una chimenea con
   * bandas rojas y blancas. Todo en una sola malla con color por vértice. Sobre cada chimenea sale un penacho de humo.
   */
  private construirIndustrias(): void {
    if (!this.fabricas.length) return;
    const rnd = mulberry32(4242);
    const geos: THREE.BufferGeometry[] = [], ids: number[] = [], pesos: number[] = [];
    const paredes = ['#d9d2c3', '#cbbba3', '#bfd0dc', '#e1e4e7', '#d8c3b0'];
    const lechos = new THREE.Matrix4();
    const itemsAura: ItemAura[] = [];

    this.fabricas.forEach((f, n) => {
      this.inicioFabrica.push(ids.length);
      const esc = f.esc;
      let largo = 48 + rnd() * 20, fondo = 30 + rnd() * 10, alto = 13 + rnd() * 3;
      if (f.parque) { largo = 50 + (largo - 48) * 0.5; fondo = 32 + (fondo - 30) * 0.4; alto = 10.5 + (alto - 13) * 0.5; }   // bodega modular
      const cat = f.cat;
      if (cat) { largo = cat.largo; fondo = cat.fondo; alto = Math.max(9, cat.pisos * 3 * ESCALA_CATASTRO); }              // bodega real del catastro
      const yaw = cat ? cat.yaw : f.parque ? f.yaw : rnd() * Math.PI * 2, cos = Math.cos(yaw), sin = Math.sin(yaw);
      const alturas = [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) => this.alturaXZ(f.x + (a * (largo / 2 + 20) * esc) * cos + (b * (fondo / 2 + 15) * esc) * sin, f.z - (a * (largo / 2 + 20) * esc) * sin + (b * (fondo / 2 + 15) * esc) * cos));
      const base = Math.max(...alturas) + 1, minimo = Math.min(...alturas);
      const id = this.idEn(f.lon, f.lat), peso = id >= 0 ? this.pesoBorde(f.lon, f.lat, id) : 0;
      const pared = paredes[Math.floor(rnd() * paredes.length)];
      /** Pone una pieza (centrada en su origen) en (lx, ly, lz) locales de la fábrica, con su color. */
      const poner = (g: THREE.BufferGeometry, color: string, lx: number, ly: number, lz: number, escalar = true) => {
        const geo = g.index ? g.toNonIndexed() : g;
        geo.translate(lx, ly, lz);
        if (escalar) geo.scale(esc, esc, esc);
        geo.applyMatrix4(lechos.makeRotationY(yaw));
        geo.translate(f.x, base, f.z);
        const c = new THREE.Color(color), cnt = geo.getAttribute('position').count, col = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.deleteAttribute('uv');
        geos.push(geo);
        for (let i = 0; i < cnt; i++) { ids.push(id); pesos.push(peso); }
      };
      const caja = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

      const losa = base - minimo + 3;
      /** Prisma con el contorno real de la bodega, de `grosor` metros de alto desde la altura `y` local. */
      const prisma = (grosor: number, color: string, y: number) =>
        poner(new THREE.ExtrudeGeometry(new THREE.Shape(cat!.poly.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: grosor, bevelEnabled: false }).rotateX(-Math.PI / 2), color, 0, y, 0);
      if (cat) prisma(losa, '#8d939a', -losa);                                                                      // zócalo que se asienta en la ladera
      else if (f.parque) poner(caja((largo + 22) * esc, losa, (fondo + 24) * esc), '#6e747c', 0, -losa / 2, 2 * esc, false);   // plataforma de asfalto del parque
      else poner(caja((largo + 14) * esc, losa, (fondo + 12) * esc), '#9aa0a6', 0, -losa / 2, 0, false);                  // losa que se asienta en la ladera
      let ch: number, cx: number, cz: number;
      if (cat) {
        // módulo de un parque industrial (o nave suelta) con su contorno real: paredes de color corporativo, cubierta a dos aguas si la planta es
        // rectangular, portones y franja de oficinas en la fachada que da a la vía, y la chimenea de la empresa en el fondo
        const col = cat.parque ? colorParque(Math.abs([...f.n].reduce((h, c) => h * 31 + c.charCodeAt(0), 7))) : { pared: pared, acento: '#c4342d' };
        const rect = areaPoligono(cat.poly) / (largo * fondo) > 0.82;
        prisma(alto, col.pared, 0);
        if (rect) {
          const perfil = new THREE.Shape([new THREE.Vector2(-(fondo + 1.2) / 2, 0), new THREE.Vector2((fondo + 1.2) / 2, 0), new THREE.Vector2(0, 3.2)]);
          poner(new THREE.ExtrudeGeometry(perfil, { depth: largo + 1.2, bevelEnabled: false }).translate(0, 0, -(largo + 1.2) / 2).rotateY(Math.PI / 2), '#8a949e', 0, alto, 0);
          poner(caja(largo + 0.4, 1.5, fondo + 0.4), col.acento, 0, alto - 1.65, 0);
          const nP = Math.max(2, Math.round(largo / 12)), w = largo / nP;
          for (let k = 0; k < nP; k++) {
            const x = -largo / 2 + w * (k + 0.5);
            poner(caja(w * 0.62, 5.2, 0.5), '#cdd5da', x, 2.6, fondo / 2 + 0.2);
            poner(caja(w * 0.7, 0.5, 0.6), '#4b5563', x, 5.45, fondo / 2 + 0.25);
            poner(caja(w * 0.7, 0.9, 2), '#9aa0a6', x, 0.45, fondo / 2 + 1.3);
          }
          poner(caja(largo - 4, 1.8, 0.3), '#7fb7d6', 0, 7.3, fondo / 2 + 0.1);
        } else {
          prisma(0.7, '#8a949e', alto);
          prisma(1.2, col.acento, alto - 2.4);
        }
        ch = Math.max(20, Math.min(60, (f.datos.chimenea ?? 14) * 1.8));
        cx = -largo / 2 + 4; cz = -fondo / 2 + 3;
        poner(new THREE.CylinderGeometry(1.1, 1.3, ch, 10), '#8d949b', cx, ch / 2, cz);
        poner(new THREE.CylinderGeometry(1.6, 1.6, 0.8, 10), '#2b2f36', cx, ch + 0.4, cz);
      } else if (f.parque) {
        // fábrica encogida = unidad de un parque industrial: bodega modular, chimenea corta, parqueadero y, la primera, el pórtico
        ({ cx, cz } = chimeneaParque({ largo, fondo }));
        ch = 26 + rnd() * 10;
        const col = colorParque(Math.floor(rnd() * 1e6));
        for (const pz of unidadParque({ largo, fondo, alto, pared: col.pared, acento: col.acento, ch, porteria: f.lider })) poner(pz.g, pz.color, 0, 0, 0);
      } else {
        poner(caja(largo, alto, fondo), pared, 0, alto / 2, 0);                                  // nave
        // techo en diente de sierra: cada diente es un prisma de perfil trapecial con su cara vertical vidriada
        const dientes = Math.max(3, Math.round(fondo / 9)), w = fondo / dientes, h = 6;
        for (let k = 0; k < dientes; k++) {
          const perfil = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(w, 0), new THREE.Vector2(w, h), new THREE.Vector2(0, h * 0.3)]);
          const g = new THREE.ExtrudeGeometry(perfil, { depth: largo, bevelEnabled: false }).rotateY(Math.PI / 2);
          const z0 = fondo / 2 - k * w;
          poner(g, '#8e9aa4', -largo / 2, alto, z0);
          poner(caja(largo - 3, h * 0.7, 0.5), '#8fc4e3', 0, alto + h * 0.5, z0 - w - 0.2);
        }
        // oficinas con franja de ventanas, y portones de carga
        const of = { w: 18, h: alto + 6, d: 24 };
        poner(caja(of.w, of.h, of.d), '#e9e5dc', largo / 2 + of.w / 2, of.h / 2, fondo / 2 - of.d / 2);
        poner(caja(of.w + 0.4, 5, of.d + 0.4), '#7fb7d6', largo / 2 + of.w / 2, of.h - 6, fondo / 2 - of.d / 2);
        poner(caja(of.w + 1.6, 1.2, of.d + 1.6), '#6b7280', largo / 2 + of.w / 2, of.h + 0.6, fondo / 2 - of.d / 2);
        for (let k = 0; k < 3; k++) poner(caja(8, 8, 0.7), '#4b5563', -largo / 2 + 10 + k * 14, 4, fondo / 2 + 0.4);
        // silos / tanques
        const silos = 1 + Math.floor(rnd() * 2);
        for (let k = 0; k < silos; k++) {
          const sx = -largo / 2 + 8 + k * 11, sz = -fondo / 2 - 8, sh = 20 + rnd() * 6;
          poner(new THREE.CylinderGeometry(4.2, 4.2, sh, 14), '#cfd4d9', sx, sh / 2, sz);
          poner(new THREE.ConeGeometry(4.4, 4, 14), '#9aa3ab', sx, sh + 2, sz);
        }
        // chimenea cónica con bandas rojas y blancas, y su aro negro
        ch = 55 + rnd() * 30; cx = -largo / 2 - 7; cz = -fondo / 2 + 6;
        const bandas = 6, seg = ch / bandas;
        for (let k = 0; k < bandas; k++) {
          const r0 = 4.4 - 2 * (k / bandas), r1 = 4.4 - 2 * ((k + 1) / bandas);
          poner(new THREE.CylinderGeometry(r1, r0, seg, 14), k % 2 ? '#d8d8d8' : '#c4342d', cx, seg * (k + 0.5), cz);
        }
        poner(new THREE.CylinderGeometry(2.7, 2.4, 2, 14), '#2b2f36', cx, ch + 1, cz);
      }
      const hx = f.x + (cx * cos + cz * sin) * esc, hz = f.z - (cx * sin + cz * cos) * esc;
      const fase = rnd();
      const puffs: Humo['puffs'] = [];
      for (let k = 0; k < HUMO_BOCANADAS; k++) {
        puffs.push({ tex: Math.floor(rnd() * 4), theta: rnd() * Math.PI * 2, giro: (rnd() - 0.5) * 0.3, tam: 0.8 + rnd() * 0.5, desv: rnd() });
      }
      this.humos.push({ x: hx, y: base + (ch + 2) * esc, z: hz, fase, ini: this.humos.length * HUMO_BOCANADAS, puffs });
      itemsAura.push({ x: f.x, y: base, z: f.z, radio: f.r * 0.95, alto: (alto + 22) * esc, color: COLOR_INDUSTRIA });
      const icono = crearIcono('industria', COLOR_INDUSTRIA, f.x, base + ch * 0.6 * esc, f.z);
      icono.ref = { tipo: 'fabrica', i: n };
      icono.zona = this.idEn(f.datos.lon, f.datos.lat);
      this.iconosEquip.push(icono);
      this.escena.add(icono.sprite);
    });
    this.agrupadorIconos ??= crearAgrupador(this.iconosEquip, this.escena, this.pinVisible);
    this.crearHumo();

    const geo = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!geo) return;
    this.geoIndustrias = geo;
    this.matIndustrias = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
    const malla = new THREE.Mesh(geo, this.matIndustrias);
    this.mallaIndustrias = malla;
    malla.castShadow = true;
    malla.receiveShadow = true;
    this.escena.add(malla);
    this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, ids, pesos);
    this.auraIndustrias = crearAuras(itemsAura);
    this.auraIndustrias.resaltar(-1);
    this.escena.add(this.auraIndustrias.grupo);
  }

  /**
   * Humo: cada bocanada nace oscura en la boca de la chimenea, sube y se desvía con el viento, y al llegar arriba se
   * asienta: se abre en un anillo plano (aureola) que se aclara y se desvanece. Reutiliza las bocanadas de las nubes.
   */
  private animarHumo(): void {
    const h0 = this.humoInst;
    if (!h0 || !this.humos.length) return;
    const t = performance.now() / 1000;
    const { rumbo, fuerza } = this.vientoEn(t);
    const dx = Math.cos(rumbo), dz = Math.sin(rumbo), cam = this.camara.position;
    const suave = (a: number, b: number, v: number) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
    const { pos, esc, col, op, rotAcum } = h0;
    for (const h of this.humos) {
      const dist = Math.hypot(h.x - cam.x, h.y - cam.y, h.z - cam.z);
      const lejos = dist > 18000;
      const cerca = Math.min(1, Math.max(0, (dist - 250) / 900));
      h.puffs.forEach((p, k) => {
        const n = h.ini + k;
        if (lejos) { esc[n * 2] = esc[n * 2 + 1] = 0; return; }   // escala 0: no genera fragmentos
        const u = ((t / HUMO_CICLO + h.fase + k / h.puffs.length) % 1 + 1) % 1;
        const subida = Math.min(1, u / 0.55), ease = 1 - (1 - subida) * (1 - subida);
        const asiento = suave(0.45, 1, u);
        const deriva = HUMO_DERIVA * (0.4 + fuerza) * u * HUMO_CICLO;
        const radio = asiento * HUMO_AUREOLA * (0.7 + 0.5 * p.desv);
        pos[n * 3] = h.x + dx * deriva + Math.cos(p.theta) * radio + Math.sin(t * 0.3 + p.theta) * 3;
        pos[n * 3 + 1] = h.y + HUMO_ALTURA * ease - 14 * asiento;
        pos[n * 3 + 2] = h.z + dz * deriva + Math.sin(p.theta) * radio * 0.8;
        const tam = (24 + 52 * subida + 80 * asiento) * p.tam;
        esc[n * 2] = tam * 1.25;
        esc[n * 2 + 1] = tam * (0.9 - 0.45 * asiento);
        rotAcum[n] += p.giro * 0.016;
        const claro = suave(0, 0.8, u);
        col[n * 3] = 0.42 + 0.46 * claro;
        col[n * 3 + 1] = 0.44 + 0.46 * claro;
        col[n * 3 + 2] = 0.47 + 0.45 * claro;
        op[n] = HUMO_OPACIDAD * suave(0, 0.03, u) * (1 - suave(0.6, 1, u)) * cerca;
      });
    }
    for (const a of h0.atributos) a.needsUpdate = true;
  }

  /**
   * Las bocanadas de humo de todas las chimeneas son instancias de un solo cuadrado que mira a la cámara (como un
   * sprite): cada una lleva su posición, tamaño, giro, color, opacidad y cuál de las 4 texturas de bocanada usa.
   */
  private crearHumo(): void {
    const n = this.humos.length * HUMO_BOCANADAS;
    if (!n) return;
    const pos = new Float32Array(n * 3), esc = new Float32Array(n * 2), rot = new Float32Array(n);
    const col = new Float32Array(n * 3), op = new Float32Array(n), tex = new Float32Array(n);
    this.humos.forEach(h => h.puffs.forEach((p, k) => { tex[h.ini + k] = p.tex; }));
    const geo = new THREE.InstancedBufferGeometry();
    geo.copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry);
    geo.instanceCount = n;
    const atributos = [
      new THREE.InstancedBufferAttribute(pos, 3), new THREE.InstancedBufferAttribute(esc, 2), new THREE.InstancedBufferAttribute(rot, 1),
      new THREE.InstancedBufferAttribute(col, 3), new THREE.InstancedBufferAttribute(op, 1),
    ].map(a => a.setUsage(THREE.DynamicDrawUsage));
    ['iPos', 'iEsc', 'iRot', 'iCol', 'iOp'].forEach((nombre, i) => geo.setAttribute(nombre, atributos[i]));
    geo.setAttribute('iTex', new THREE.InstancedBufferAttribute(tex, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: Object.fromEntries([0, 1, 2, 3].map(i => [`t${i}`, { value: this.texturasNubes[i] }])),
      vertexShader: `
        attribute vec3 iPos; attribute vec2 iEsc; attribute float iRot; attribute vec3 iCol; attribute float iOp; attribute float iTex;
        varying vec2 vUv; varying vec3 vCol; varying float vOp; varying float vTex;
        void main() {
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          vec2 q = position.xy * iEsc;
          float c = cos(iRot), s = sin(iRot);
          mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
          gl_Position = projectionMatrix * mv;
          vUv = uv; vCol = iCol; vOp = iOp; vTex = iTex;
        }`,
      fragmentShader: `
        uniform sampler2D t0, t1, t2, t3;
        varying vec2 vUv; varying vec3 vCol; varying float vOp; varying float vTex;
        void main() {
          // se leen las 4 y se elige una: leer dentro de una rama daría derivadas indefinidas (bordes mal filtrados)
          vec4 a = texture2D(t0, vUv), b = texture2D(t1, vUv), c = texture2D(t2, vUv), d = texture2D(t3, vUv);
          vec4 tx = a * step(vTex, 0.5) + b * step(0.5, vTex) * step(vTex, 1.5) + c * step(1.5, vTex) * step(vTex, 2.5) + d * step(2.5, vTex);
          gl_FragColor = vec4(vCol * tx.rgb, tx.a * vOp);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    const malla = new THREE.Mesh(geo, material);
    malla.frustumCulled = false;
    malla.renderOrder = 8;
    this.escena.add(malla);
    this.humoInst = { malla, pos, esc, rot, col, op, atributos, rotAcum: rot };
  }

  /**
   * Bandada de pájaros pequeños en V suelta que cruza el Río Medellín de sur a norte, a la altura de Girardota: se toma
   * el vértice del río más cercano al casco urbano y se vuela en línea recta hacia el norte, siguiendo el relieve.
   * Cada pájaro son dos alas triangulares que aletean con su propio ritmo; entran y salen achicándose, y tras una
   * pausa vuelve a pasar la bandada.
   */
  private construirPajaros(cauces: Cauces): void {
    const nombre = cauces.n.findIndex(n => /medell/i.test(n));
    const rios = nombre >= 0 ? cauces.c.filter(c => c[1] === nombre) : [...cauces.c].sort((a, b) => b[0] - a[0]).slice(0, 3);
    if (!rios.length) return;
    const centro = this.centroDe('Girardota') ?? { x: 0, z: 0 };
    let punto: { x: number; z: number } | null = null, dmin = Infinity;
    for (const c of rios) {
      for (const q of this.desdeDeltas(c, cauces.k, 2)) {
        const x = this.aX(q[0]), z = this.aZ(q[1]), d = Math.hypot(x - centro.x, z - centro.z);
        if (d < dmin) { dmin = d; punto = { x, z }; }
      }
    }
    if (!punto) return;
    this.rutaPajaros = punto;

    // Contorno de un ala en (x hacia afuera, z hacia atrás; el borde de ataque mira al norte, -z). El tramo interior (brazo)
    // llega hasta el codo; el exterior (mano) lleva las plumas primarias en el borde de fuga, escalonadas.
    const plano = (pts: [number, number][], lado: number) => {
      const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(lado * x, -z))));
      g.rotateX(-Math.PI / 2);
      this.geosPajaros.push(g);
      return g;
    };
    const brazo: [number, number][] = [[0, -9], [6, -10.5], [13, -10], [20, -7.5], [20, -1], [14, 2.5], [7, 4.5], [0, 5]];
    const mano: [number, number][] = [[0, -7.5], [8, -9.5], [17, -9], [26, -6], [34, -1.5], [37, 1.5], [31, 1], [29, 4.5], [23, 2.5], [21, 6], [15, 3.5], [12, 6.5], [6, 4], [0, 0.5]];
    const forma = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0) => { g.translate(x, y, z); this.geosPajaros.push(g); return g; };
    const cuerpo = forma(new THREE.SphereGeometry(1, 10, 8).scale(3.6, 3.2, 12));
    const cabeza = forma(new THREE.SphereGeometry(2.7, 9, 7), 0, 1.2, -12.5);
    const pico = forma(new THREE.ConeGeometry(1.1, 6.5, 6).rotateX(-Math.PI / 2), 0, 0.7, -18.6);
    const cola = forma(new THREE.ShapeGeometry(new THREE.Shape([[-2.5, 8], [-6.5, 21], [-3.5, 24], [0, 22], [3.5, 24], [6.5, 21], [2.5, 8]].map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2));
    const blanco = new THREE.MeshLambertMaterial({ color: '#f6f8fa', emissive: '#7a8490', side: THREE.DoubleSide });
    const plumas = new THREE.MeshLambertMaterial({ color: '#e7ecf1', emissive: '#6b7480', side: THREE.DoubleSide });
    const amarillo = new THREE.MeshLambertMaterial({ color: '#f2a73b', emissive: '#6b4a14' });
    this.materialesPajaros.push(blanco, plumas, amarillo);
    const alaGeos = [-1, 1].map(lado => ({ brazo: plano(brazo, lado), mano: plano(mano, lado) }));
    const rnd = mulberry32(5150);
    for (let i = 0; i < PAJAROS; i++) {
      const fila = Math.ceil(i / 2), lado = i % 2 ? 1 : -1;
      const grupo = new THREE.Group();
      grupo.add(new THREE.Mesh(cuerpo, blanco), new THREE.Mesh(cabeza, blanco), new THREE.Mesh(pico, amarillo), new THREE.Mesh(cola, plumas));
      // alas: el pivote del hombro está a un lado del cuerpo y el del codo al final del brazo
      const [izq, der] = alaGeos.map((g, k) => {
        const signo = k ? 1 : -1;
        const hombro = new THREE.Group();
        hombro.position.set(signo * 2.5, 0.8, 0);
        const codo = new THREE.Group();
        codo.position.set(signo * 20, 0, 0);
        hombro.add(new THREE.Mesh(g.brazo, blanco), codo);
        codo.add(new THREE.Mesh(g.mano, plumas));
        grupo.add(hombro);
        return { hombro, codo };
      });
      this.escena.add(grupo);
      this.pajaros.push({
        grupo, izq: izq.hombro, der: der.hombro, codoIzq: izq.codo, codoDer: der.codo,
        ox: i ? lado * fila * 55 + (rnd() - 0.5) * 40 : 0, oz: i ? fila * 70 + (rnd() - 0.5) * 50 : 0, oy: (rnd() - 0.5) * 50,
        y: this.alturaXZ(punto.x, punto.z) + 330, fase: rnd() * Math.PI * 2, ritmo: 7 + rnd() * 3,
      });
    }
    this.tiempoPajaros = RECORRIDO_PAJAROS / VELOCIDAD_PAJAROS * 0.3;     // al abrir, la bandada ya va por el mapa
    this.animarPajaros(0);
  }

  private animarPajaros(dt: number): void {
    const ruta = this.rutaPajaros;
    if (!ruta || !this.pajaros.length) return;
    const t = performance.now() / 1000;
    this.tiempoPajaros += dt;
    const duracion = RECORRIDO_PAJAROS / VELOCIDAD_PAJAROS;
    const fase = this.tiempoPajaros % (duracion + PAUSA_PAJAROS);
    const volando = fase < duracion;
    const avance = fase / duracion;
    const suave = (v: number) => { const u = Math.min(1, Math.max(0, v / 0.06)); return u * u * (3 - 2 * u); };
    const escala = suave(avance) * suave(1 - avance);
    const zGuia = ruta.z + RECORRIDO_PAJAROS / 2 - avance * RECORRIDO_PAJAROS;     // de sur (+z) a norte (-z)
    for (const p of this.pajaros) {
      p.grupo.visible = volando && escala > 0.01;
      if (!p.grupo.visible) continue;
      const x = ruta.x + p.ox + Math.sin(t * 0.6 + p.fase) * 14, z = zGuia + p.oz;
      p.y += (this.alturaXZ(x, z) + 330 + p.oy + Math.sin(t * 1.1 + p.fase) * 8 - p.y) * Math.min(1, dt * 1.5);
      p.grupo.position.set(x, p.y, z);
      p.grupo.scale.setScalar(escala);
      // el brazo sube y baja y la mano le sigue con un poco de retraso y más recorrido: el ala se curva en el codo
      const a = Math.sin(t * p.ritmo + p.fase) * 0.55;
      const mano = Math.sin(t * p.ritmo + p.fase - 0.9) * 0.55;
      p.izq.rotation.z = a;
      p.der.rotation.z = -a;
      p.codoIzq.rotation.z = mano;
      p.codoDer.rotation.z = -mano;
    }
  }

  /**
   * Boeing 787 (public/data/mapa3d/boeing-787.glb, scripts/optimizar_avion.mjs) en línea recta de El Yarumo a La Holanda,
   * prolongada hasta salir del mapa por ambos lados. Sus luces son sprites que se agrandan con la distancia a la cámara
   * para seguir leyéndose desde lejos (de otro modo, a 9 km, una luz de 30 cm mide menos que un píxel).
   */
  private construirAvion(): void {
    const desde = this.centroDe('El Yarumo'), hasta = this.centroDe('La Holanda');
    if (!desde || !hasta) return;
    const largo = Math.hypot(hasta.x - desde.x, hasta.z - desde.z);
    if (largo < 1) return;
    const dx = (hasta.x - desde.x) / largo, dz = (hasta.z - desde.z) / largo;
    // tramo de la recta que cae dentro del mapa (se entra y se sale por el borde del recuadro), más el margen de cada lado
    let t0 = -Infinity, t1 = Infinity;
    for (const [o, d, mitad] of [[desde.x, dx, this.ancho / 2], [desde.z, dz, this.alto / 2]]) {
      if (Math.abs(d) < 1e-9) continue;
      const a = (-mitad - o) / d, b = (mitad - o) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    t0 -= MARGEN_AVION;
    t1 += MARGEN_AVION;

    const grupo = new THREE.Group();
    grupo.visible = false;
    grupo.rotation.order = 'YXZ';                              // primero el rumbo (y), luego la inclinación de las alas (x)
    const y = (ALTITUD_AVION - this.relieve.min) * EXAGERACION;
    this.brilloLuz = this.texturaBrillo();
    const luces = LUCES_AVION.map(l => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.brilloLuz, color: l.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
      }));
      sprite.position.set(...l.pos);
      sprite.renderOrder = 10;
      grupo.add(sprite);
      return { sprite, tipo: l.tipo, tam: l.tam };
    });
    this.escena.add(grupo);
    this.avion = { grupo, luces, x0: desde.x, z0: desde.z, dx, dz, t0, t1, y, amp: AMPLITUD_S_AVION, k: 2 * Math.PI / (t1 - t0) };
    // al abrir, el avión llega al centro del mapa en 20 s (t del punto de la recta más cercano al centro)
    const tCentro = -(desde.x * dx + desde.z * dz);
    this.tiempoAvion = (tCentro - t0) / VELOCIDAD_AVION - 20;

    // el avión tarda ~20 s en llegar: su modelo (3,6 MB) se pide cuando ya terminó de bajar el resto de la escena
    const pedir = setTimeout(() => new GLTFLoader().load('data/mapa3d/boeing-787.glb', gltf => grupo.add(gltf.scene)), 5000);
    this.destroyRef.onDestroy(() => clearTimeout(pedir));
    this.construirEstela(tCentro + 1800);
  }

  /** Reserva las bocanadas de la estela y levanta la nube pequeña que esta recorre en la ruta, en el punto tNube de la recta. */
  private construirEstela(tNube: number): void {
    const a = this.avion;
    if (!a || !this.texturasNubes.length) return;
    const rnd = mulberry32(8087);
    for (let i = 0; i < ESTELA_PUFFS; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.texturasNubes[i % this.texturasNubes.length], color: '#ffffff', transparent: true, depthWrite: false, opacity: 0,
        rotation: rnd() * Math.PI * 2,
      }));
      sprite.visible = false;
      sprite.renderOrder = 8;
      this.escena.add(sprite);
      this.estela.push({ sprite, edad: -1, x: 0, y: 0, z: 0, base: 8 + rnd() * 4 });
    }

    // la nube: un racimo de bocanadas centrado sobre la S, a la altura del avión
    const lado = a.amp * Math.sin(a.k * (tNube - a.t0));
    const cx = a.x0 + a.dx * tNube - a.dz * lado, cz = a.z0 + a.dz * tNube + a.dx * lado;
    const sprites: THREE.Sprite[] = [];
    for (let i = 0; i < 9; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.texturasNubes[i % this.texturasNubes.length], color: '#f4f8fc', transparent: true, depthWrite: false,
        opacity: 0.8 + rnd() * 0.15, rotation: rnd() * Math.PI * 2,
      }));
      const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * NUBE_AVION_RADIO * 0.55;
      sprite.position.set(cx + Math.cos(ang) * r, a.y + (rnd() - 0.5) * NUBE_AVION_RADIO * 0.5, cz + Math.sin(ang) * r);
      const t = NUBE_AVION_RADIO * (0.9 + rnd() * 0.7);
      sprite.scale.set(t, t * 0.75, 1);
      sprite.renderOrder = 9;
      this.escena.add(sprite);
      sprites.push(sprite);
    }
    this.nubeAvion = { x: cx, y: a.y, z: cz, sprites };
  }

  /** Suelta una bocanada por motor cada ESTELA_ESPACIO metros recorridos. */
  private emitirEstela(a: Avion): void {
    const pos = a.grupo.position;
    const recorrido = this.estelaUltima.distanceTo(pos);
    if (recorrido < ESTELA_ESPACIO) return;
    const salto = recorrido > 800;                              // el avión reapareció al inicio de la ruta: no hay tramo que rellenar
    this.estelaUltima.copy(pos);
    if (salto) return;
    for (const m of MOTORES_AVION) {
      const p = this.estela[this.estelaSiguiente];
      this.estelaSiguiente = (this.estelaSiguiente + 1) % this.estela.length;
      this.posLuz.set(...m);
      a.grupo.localToWorld(this.posLuz);
      p.edad = 0;
      p.x = this.posLuz.x; p.y = this.posLuz.y; p.z = this.posLuz.z;
    }
  }

  /** Las bocanadas de la estela envejecen: se ensanchan, se aclaran y derivan con el viento; la nube de la ruta las difumina. */
  private animarEstela(dt: number): void {
    if (!this.estela.length) return;
    const cam = this.camara.position, nube = this.nubeAvion;
    const { rumbo } = this.vientoEn(performance.now() / 1000);
    const vx = Math.cos(rumbo) * ESTELA_DERIVA * dt, vz = Math.sin(rumbo) * ESTELA_DERIVA * dt;
    for (const p of this.estela) {
      if (p.edad < 0) continue;
      p.edad += dt;
      const u = p.edad / ESTELA_VIDA;
      if (u >= 1) { p.edad = -1; p.sprite.visible = false; continue; }
      p.x += vx;
      p.z += vz;
      // de lejos se agranda como el avión, para que la estela siga leyéndose
      const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
      const f = TAMANO_AVION * Math.min(ESCALA_MAX_AVION, Math.max(1, d / DISTANCIA_REAL_AVION));
      const tam = p.base * (1 + 4 * u) * f;
      let op = ESTELA_OPACIDAD * (1 - u) * Math.min(1, p.edad / 1.2);
      if (nube) {
        const k = Math.min(1, Math.max(0, (NUBE_AVION_RADIO * 1.1 - Math.hypot(p.x - nube.x, p.z - nube.z)) / (NUBE_AVION_RADIO * 0.7)));
        op *= 1 - 0.92 * k * k * (3 - 2 * k);
      }
      p.sprite.visible = op > 0.004;
      p.sprite.position.set(p.x, p.y, p.z);
      p.sprite.scale.set(tam, tam, 1);
      p.sprite.material.opacity = op;
    }
  }

  /** Brillo suave y redondo, blanco: el sprite lo tiñe del color de cada luz. */
  private texturaBrillo(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  private animarAvion(dt: number): void {
    const a = this.avion;
    if (!a) return;
    this.tiempoAvion += dt;
    const duracion = (a.t1 - a.t0) / VELOCIDAD_AVION;
    const fase = this.tiempoAvion % (duracion + PAUSA_AVION);
    a.grupo.visible = fase < duracion;
    if (!a.grupo.visible) return;
    const t = a.t0 + fase * VELOCIDAD_AVION;
    // posición y rumbo sobre la S (la normal a la recta es (−dz, dx)); el rumbo sigue la tangente
    const lateral = (u: number) => a.amp * Math.sin(a.k * (u - a.t0));
    const rumbo = (u: number) => {
      const w = a.amp * a.k * Math.cos(a.k * (u - a.t0));
      return Math.atan2(-(a.dz + a.dx * w), a.dx - a.dz * w);
    };
    const off = lateral(t);
    a.grupo.position.set(a.x0 + a.dx * t - a.dz * off, a.y, a.z0 + a.dz * t + a.dx * off);
    // en un viraje coordinado el avión se inclina atan(v·ω/g): a la izquierda (rumbo creciente) baja el ala izquierda (−z)
    const paso = 40;
    let giro = rumbo(t + paso) - rumbo(t - paso);
    giro -= Math.round(giro / (2 * Math.PI)) * 2 * Math.PI;
    const omega = giro / (2 * paso) * VELOCIDAD_AVION;
    a.grupo.rotation.y = rumbo(t);
    a.grupo.rotation.x = -Math.atan(VELOCIDAD_AVION * omega / 9.81) * BANDEO_AVION;
    const p = this.camara.position;
    // a escala real solo se ve de cerca: de lejos (a 9 km mide 2 px) crece con la distancia, hasta ESCALA_MAX_AVION
    const escala = TAMANO_AVION * Math.min(ESCALA_MAX_AVION, Math.max(1, a.grupo.position.distanceTo(p) / DISTANCIA_REAL_AVION));
    a.grupo.scale.setScalar(escala);
    a.grupo.updateMatrixWorld();
    this.emitirEstela(a);

    // luces discretas: navegación fija, destello blanco doble cada 1,4 s y baliza roja cada 1,2 s (como en un avión real)
    const s = performance.now() / 1000;
    for (const l of a.luces) {
      const d = l.sprite.getWorldPosition(this.posLuz).distanceTo(p);
      // el destello sube y baja en una fracción de segundo, no se enciende de golpe
      const pulso = (inicio: number, ancho: number, ciclo: number) => {
        const u = ((s % ciclo) - inicio) / ancho;
        return u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
      };
      const encendida = l.tipo === 'nav' ? 0.55
        : l.tipo === 'destello' ? Math.max(pulso(0, 0.12, 1.4), pulso(0.2, 0.12, 1.4))
        : 0.9 * pulso(0, 0.35, 1.2);
      l.sprite.material.opacity = encendida;
      l.sprite.visible = encendida > 0.01;
      // tamaño mínimo en pantalla: de lejos la luz sigue leyéndose como un punto que parpadea
      const m = Math.max(l.tam, d * 0.008 * l.tam / 5);
      l.sprite.scale.set(m / escala, m / escala, 1);
    }
  }

  /** Viento del instante t: rumbo en planta (rad) y fuerza 0–1, que cambian despacio, con ráfagas y calmas. */
  private vientoEn(t: number): { rumbo: number; fuerza: number } {
    const rumbo = Math.atan2(VIENTO.y, VIENTO.x) + 0.45 * Math.sin(t * 0.021) + 0.2 * Math.sin(t * 0.047 + 1);
    const fuerza = Math.min(1, Math.max(0.05, 0.45 + 0.4 * Math.sin(t * 0.03) * Math.sin(t * 0.0113 + 1.3) + 0.15 * Math.sin(t * 0.09)));
    return { rumbo, fuerza };
  }

  /**
   * Mueve las nubes con el viento y las deja reaccionar a él: con fuerza se alinean y estiran en su dirección, se
   * difuminan y aclaran (cada nube según la ráfaga que la alcanza); en calma se recogen y se atraen entre sí.
   */
  private animarNubes(dt: number): void {
    const t = performance.now() / 1000;
    const { rumbo, fuerza } = this.vientoEn(t);
    const dx = Math.cos(rumbo), dz = Math.sin(rumbo);
    const limX = this.ancho / 2 + MARGEN_NUBES, limZ = this.alto / 2 + MARGEN_NUBES;
    const cam = this.camara?.position;
    const techoNubes = ALTURA_NUBES[1] - ALTURA_NUBES[0];
    // el viento visto desde la cámara: con viento fuerte las bocanadas se alinean con él en pantalla
    let angulo = 0;
    if (cam) {
      this.vientoVista.set(dx, 0, dz).transformDirection(this.camara.matrixWorldInverse);
      angulo = Math.atan2(this.vientoVista.y, this.vientoVista.x);
    }

    this.nubes.forEach((n, i) => {
      // la ráfaga viaja con el viento: cada nube la siente en un momento distinto
      const racha = 0.5 + 0.5 * Math.sin(t * 0.05 + (n.x * dx + n.z * dz) * 0.0002 + i * 1.7);
      const f = Math.min(1, n.nivel * (0.75 + 0.5 * racha) * (0.8 + 0.4 * fuerza));
      n.dispersion += (f * f - n.dispersion) * Math.min(1, dt * 0.45);
      const vel = VELOCIDAD_VIENTO * (0.2 + 1.6 * f) * (0.85 + 0.3 * (n.y - n.radio) / (techoNubes + 4000));
      n.x += dx * vel * dt;
      n.z += dz * vel * dt;
      // en calma las nubes cercanas se acercan hasta rozarse
      for (const o of this.nubes) {
        if (o === n) continue;
        const ex = o.x - n.x, ez = o.z - n.z, d = Math.hypot(ex, ez);
        const holgura = (n.radio + o.radio) * 2.4;
        if (d < holgura) {                                  // no se amontonan: se apartan si se acercan demasiado
          n.x -= ex / d * (1 - d / holgura) * 40 * dt;
          n.z -= ez / d * (1 - d / holgura) * 40 * dt;
        } else if (d < 7000) {
          const atraccion = (1 - f) * (1 - d / 7000) * 8;
          n.x += ex / d * atraccion * dt;
          n.z += ez / d * atraccion * dt;
        }
      }
      if (n.x > limX) n.x -= 2 * limX; else if (n.x < -limX) n.x += 2 * limX;
      if (n.z > limZ) n.z -= 2 * limZ; else if (n.z < -limZ) n.z += 2 * limZ;
      const borde = Math.max(0, Math.min(1, (limX - Math.abs(n.x)) / FUNDIDO_BORDE, (limZ - Math.abs(n.z)) / FUNDIDO_BORDE));

      // La forma depende del nivel de viento (d: 0 calma … 1 temporal):
      //  calma → cúmulo redondo, alto y apretado; moderado → ladeado a favor del viento, con cola;
      //  temporal → jirones largos, bajos y finos, alineados con el viento.
      const d = n.dispersion;
      const largo = 1 + 2.3 * d;                  // estirado a favor del viento
      const ancho = 1 - 0.4 * d;                  // y más angosto de lado
      const altura = 1.2 - 1.0 * d;               // la calma lo infla hacia arriba; el temporal lo aplasta
      const inclina = 0.15 + 1.9 * d;             // cuánto se tumba la cima en la dirección del viento
      const alinea = Math.min(1, d * 1.6);        // cuánto se alinean las bocanadas con el viento
      for (const b of n.bocanadas) {
        const along = b.ox * dx + b.oz * dz;
        const px = b.ox - along * dx, pz = b.oz - along * dz;
        const cizalla = b.oy * inclina;
        const x = n.x + px * ancho + dx * (along * largo + cizalla) + Math.sin(t * 0.07 + b.fase) * n.radio * 0.06;
        const z = n.z + pz * ancho + dz * (along * largo + cizalla) + Math.cos(t * 0.06 + b.fase * 1.7) * n.radio * 0.05;
        b.sprite.position.set(x, n.y + b.oy * altura, z);
        const respira = 1 + 0.06 * Math.sin(t * 0.11 + b.fase * 2.3);
        const tam = b.tamano * (1 - 0.3 * d) * respira;
        b.sprite.scale.set(tam * 1.25 * (1 + 1.8 * d), tam * 0.85 * (1 - 0.25 * d), 1);
        const m = b.sprite.material as THREE.SpriteMaterial;
        m.rotation = angulo + b.rot0 * (1 - alinea) + b.giro * Math.sin(t * 0.1 + b.fase);
        // al acercarse la cámara se funde, para no atravesar un muro blanco
        const cerca = cam ? Math.min(1, Math.max(0, (cam.distanceTo(b.sprite.position) - 1200) / 3000)) : 1;
        m.opacity = b.opacidad * (1 - 0.5 * d) * borde * cerca;
      }
      // la sombra cae sobre el terreno siguiendo la dirección de los rayos del sol
      const h = n.y - 800;
      this.sombrasNubes[i].set(
        n.x - SOL_DIRECCION.x / SOL_DIRECCION.y * h, n.z - SOL_DIRECCION.z / SOL_DIRECCION.y * h,
        n.radio * (1.15 + 0.9 * n.dispersion), borde * (1 - 0.45 * n.dispersion),
      );
    });
    if (this.disco && cam) {
      this.disco.position.copy(cam).addScaledVector(SOL_DIRECCION.clone().normalize(), 60000);
    }
  }

  /**
   * La sombra solo se calcula alrededor de lo que se mira: así, al acercarse, cada píxel del mapa de sombras
   * cubre ~1 m y los edificios y árboles proyectan sombra nítida; de lejos basta con una sombra del relieve.
   */
  private actualizarSombras(): void {
    const dist = this.camara.position.distanceTo(this.controles.target);
    // el encuadre de la sombra cambia por saltos y no con cada centímetro que se mueve la cámara: su tamaño sube o baja
    // en escalones de 25 % y su centro se pega a una cuadrícula de 1/8 de ese tamaño. Así, al desplazarse o acercarse,
    // el mapa de sombras (4096², todo lo que proyecta sombra se vuelve a dibujar) se repinta unas pocas veces y no en
    // cada cuadro. El 7 % extra cubre lo que el centro pegado se aparta del punto que se mira.
    const necesaria = Math.min(11000, Math.max(2200, dist * 0.85 * 1.07));
    const mitad = Math.min(11000, 2200 * Math.pow(1.25, Math.ceil(Math.log(necesaria / 2200) / Math.log(1.25) - 1e-6)));
    const paso = mitad / 8, t = this.controles.target;
    const centro = this.centroSombra.set(Math.round(t.x / paso) * paso, Math.round(t.y / paso) * paso, Math.round(t.z / paso) * paso);
    const c = this.sol.shadow.camera;
    c.left = -mitad; c.right = mitad; c.top = mitad; c.bottom = -mitad;
    c.updateProjectionMatrix();
    this.sol.target.position.copy(centro);
    this.sol.position.copy(centro).add(SOL_DIRECCION);
    this.sol.shadow.normalBias = (mitad * 2 / 4096) * 4;
    // los árboles y edificios solo proyectan sombra cuando se ven de cerca (ahorra mucho trabajo a la GPU)
    const cerca = dist < DISTANCIA_SOMBRAS;
    for (const m of this.mallasEdificios) m.castShadow = cerca;
    for (const t of this.teselasArboles) t.cerca.castShadow = t.lejos.castShadow = cerca;
    for (const b of this.bloquesArboles) b.lejos.castShadow = cerca;
    // el mapa de sombras solo se repinta si la luz se movió, cambió su alcance o algo que proyecta sombra se alzó
    const clave = `${centro.x}|${centro.y}|${centro.z}|${mitad}|${cerca}`;
    if (clave !== this.claveSombra) { this.claveSombra = clave; this.sombraSucia = true; }
  }

  /**
   * Las manchas de sombra de las nubes se evalúan una vez en una textura de 1024 px que cubre todo el terreno
   * (unos 11 m por texel) en lugar de una vez por píxel de pantalla: el terreno solo la muestrea.
   */
  private crearTexturaNubes(): void {
    const w = 1024, h = Math.round(w * this.alto / this.ancho);
    this.rtNubes = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, colorSpace: THREE.NoColorSpace });
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uNubes: { value: this.sombrasNubes },
        uCaja: { value: new THREE.Vector4(-this.ancho / 2, -this.alto / 2, this.ancho, this.alto) },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec4 uNubes[${NUBES}];
        uniform vec4 uCaja;
        float hashN(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float ruidoN(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hashN(i), hashN(i + vec2(1.0, 0.0)), f.x), mix(hashN(i + vec2(0.0, 1.0)), hashN(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          vec2 xz = uCaja.xy + vUv * uCaja.zw;
          float despejado = 1.0;
          for (int i = 0; i < ${NUBES}; i++) {
            vec2 q = xz - uNubes[i].xy;
            float d = length(q) / uNubes[i].z;
            float r = ruidoN(q * 0.0007) * 0.6 + ruidoN(q * 0.0022) * 0.4;
            despejado *= 1.0 - smoothstep(1.05, 0.2, d + (r - 0.5) * 0.7) * uNubes[i].w;
          }
          gl_FragColor = vec4(vec3(despejado), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    const escena = new THREE.Scene();
    const cuadro = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    cuadro.frustumCulled = false;
    escena.add(cuadro);
    this.pasoNubes = { escena, camara: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }

  /** Repinta la textura de sombras de nubes (cada dos cuadros: las nubes se mueven despacio). */
  private pintarNubes(): void {
    if ((this.cuadroNubes++ & 1) && this.cuadroNubes > 2) return;
    this.renderer.setRenderTarget(this.rtNubes);
    this.renderer.render(this.pasoNubes.escena, this.pasoNubes.camara);
    this.renderer.setRenderTarget(null);
  }

  /**
   * Recalcula las normales solo de las veredas que se movieron y de los vértices que las rodean, con el mismo
   * criterio de computeVertexNormals (suma de normales de las caras, ponderada por área).
   */
  private actualizarNormalesTerreno(): void {
    const filas = this.filasTerreno;
    const pos = this.capaTerreno.atributo.array as Float32Array;
    const normal = this.terreno.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const total = pos.length / 3, columnas = total / filas;
    const afectados = new Set<number>();
    for (const id of this.piezasMovidas) {
      for (const k of this.capaTerreno.porPieza[id]) {
        const i = k % filas, j = Math.floor(k / filas);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (i + di >= 0 && i + di < filas && j + dj >= 0 && j + dj < columnas) afectados.add((j + dj) * filas + i + di);
          }
        }
      }
    }
    this.piezasMovidas.clear();
    const salida = normal.array as Float32Array;
    let nx = 0, ny = 0, nz = 0;
    // suma la normal de la cara (A, B, C), con el mismo orden de vértices que usa three.js
    const cara = (a: number, b: number, c: number) => {
      const ax = pos[a * 3] - pos[b * 3], ay = pos[a * 3 + 1] - pos[b * 3 + 1], az = pos[a * 3 + 2] - pos[b * 3 + 2];
      const cx = pos[c * 3] - pos[b * 3], cy = pos[c * 3 + 1] - pos[b * 3 + 1], cz = pos[c * 3 + 2] - pos[b * 3 + 2];
      nx += cy * az - cz * ay;
      ny += cz * ax - cx * az;
      nz += cx * ay - cy * ax;
    };
    for (const v of afectados) {
      const i = v % filas, j = Math.floor(v / filas);
      nx = ny = nz = 0;
      // cada celda (ci, cj) tiene las caras (a, c, b) y (b, c, d), con a = (ci, cj), b = a + 1, c = a + filas, d = c + 1
      for (let cj = j - 1; cj <= j; cj++) {
        for (let ci = i - 1; ci <= i; ci++) {
          if (ci < 0 || cj < 0 || ci >= filas - 1 || cj >= columnas - 1) continue;
          const a = cj * filas + ci, b = a + 1, c = a + filas, d = c + 1;
          if (v === a || v === c || v === b) cara(a, c, b);
          if (v === b || v === c || v === d) cara(b, c, d);
        }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      salida[v * 3] = nx / l;
      salida[v * 3 + 1] = ny / l;
      salida[v * 3 + 2] = nz / l;
    }
    normal.needsUpdate = true;
  }

  /**
   * De lejos cada tesela de árboles usa la versión simple; de cerca, la completa. Si ninguna tesela de un bloque puede
   * estar cerca (su punto más próximo queda más allá del umbral), el bloque entero se dibuja con una sola malla.
   */
  private actualizarArboles(): void {
    const cam = this.camara.position;
    for (const b of this.bloquesArboles) b.lejos.visible = cam.distanceTo(b.centro) - b.radio > DISTANCIA_ARBOL_SIMPLE;
    for (const t of this.teselasArboles) {
      if (t.bloque?.lejos.visible) { t.cerca.visible = t.lejos.visible = false; continue; }
      const lejos = cam.distanceTo(t.centro) > DISTANCIA_ARBOL_SIMPLE;
      t.cerca.visible = !lejos;
      t.lejos.visible = lejos;
    }
  }

  /** Repinta el mapa de sombras solo si hace falta; la malla fina del relieve se sustituye por la gruesa. */
  private renderizar(): void {
    this.pintarNubes();
    const repintar = this.sombraSucia;
    this.sombraSucia = false;
    this.renderer.shadowMap.needsUpdate = repintar;
    if (this.sombraTerreno) this.sombraTerreno.visible = repintar;
    this.renderer.render(this.escena, this.camara);
    if (this.sombraTerreno) this.sombraTerreno.visible = false;
    if (repintar && this.perf) this.perf.sombras++;
  }

  /**
   * Resolución dinámica: si la máquina no da abasto mientras la cámara se mueve, baja la densidad de píxeles
   * hasta que se detiene; en reposo siempre vuelve a la máxima, así la imagen quieta no pierde nitidez.
   */
  private ajustarResolucion(ahora: number, dt: number): void {
    if (this.ratioMax <= 1.25) return;
    this.promedioMs += (dt * 1000 - this.promedioMs) * 0.1;
    const moviendo = this.camara.position.distanceToSquared(this.camaraAnterior) > 1e-3
      || this.controles.target.distanceToSquared(this.objetivoAnterior) > 1e-3;
    this.camaraAnterior.copy(this.camara.position);
    this.objetivoAnterior.copy(this.controles.target);
    if (moviendo) {
      this.ultimoMovimiento = ahora;
      if (!this.degradado && this.promedioMs > 20) {
        this.degradado = true;
        this.renderer.setPixelRatio(1.25);
      }
    } else if (this.degradado && ahora - this.ultimoMovimiento > 250) {
      this.degradado = false;
      this.renderer.setPixelRatio(this.ratioMax);
    }
  }

  private crearPanelPerf(padre: HTMLElement): void {
    const el = document.createElement('pre');
    el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9999;margin:0;padding:6px 8px;font:11px/1.35 monospace;color:#9f9;background:rgba(0,0,0,.7);pointer-events:none;border-radius:4px';
    padre.appendChild(el);
    this.perf = { el, acumulado: 0, cuadros: 0, sombras: 0, msActualizar: 0, msRender: 0 };
  }

  private mostrarPerf(dt: number): void {
    const p = this.perf!;
    p.acumulado += dt;
    p.cuadros++;
    if (p.acumulado < 0.5) return;
    const i = this.renderer.info;
    // objetos visibles por tipo: de dónde salen las llamadas de dibujo
    const tipos: Record<string, number> = {};
    this.escena.traverseVisible(o => {
      const k = (o as THREE.Sprite).isSprite ? 'sprites' : (o as THREE.InstancedMesh).isInstancedMesh ? 'instanciadas'
        : (o as THREE.Mesh).isMesh ? 'mallas' : (o as THREE.Line).isLine ? 'líneas' : '';
      if (k) tipos[k] = (tipos[k] ?? 0) + 1;
    });
    // triángulos dibujados por capa (solo lo visible): dónde se va el trabajo de la GPU
    const capas = new Map<THREE.Object3D, string>();
    const marcar = (nombre: string, objs: Iterable<THREE.Object3D | null | undefined>) => { for (const o of objs) if (o) capas.set(o, nombre); };
    marcar('edificios', this.mallasEdificios);
    marcar('fachadas', this.mallasFachadas.map(f => f.malla));
    marcar('cercas', this.mallasCercas.map(f => f.malla));
    marcar('árboles', [...this.teselasArboles.flatMap(t => [t.cerca, t.lejos]), ...this.bloquesArboles.map(b => b.lejos)]);
    marcar('gente', this.mallasGente);
    marcar('tráfico', this.flota.flat());
    const porCapa: Record<string, number> = {};
    const sinCapa: { tris: number; txt: string }[] = [];
    this.escena.traverseVisible(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry;
      const base = (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3;
      const tris = base * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
      const nombre = capas.get(o) ?? 'otras';
      porCapa[nombre] = (porCapa[nombre] ?? 0) + tris;
      if (nombre === 'otras' && tris > 20000) sinCapa.push({ tris, txt: `${(o as THREE.InstancedMesh).isInstancedMesh ? 'inst' : 'malla'} ${((m.material as THREE.MeshStandardMaterial).color?.getHexString() ?? '-')} x${(o as THREE.InstancedMesh).count ?? 1}` });
    });
    sinCapa.sort((u, v) => v.tris - u.tris);
    p.el.textContent = [
      'triángulos por capa: ' + Object.entries(porCapa).sort((u, v) => v[1] - u[1]).map(([k, v]) => `${k} ${(v / 1000).toFixed(0)}k`).join(' · '),
      sinCapa.length ? 'mayores sin clasificar: ' + sinCapa.slice(0, 4).map(x => `${(x.tris / 1000).toFixed(0)}k ${x.txt}`).join(' | ') : '',
      Object.entries(tipos).map(([k, v]) => `${k} ${v}`).join(' · '),
      `${(p.cuadros / p.acumulado).toFixed(0)} fps · ${(p.acumulado / p.cuadros * 1000).toFixed(1)} ms/cuadro`,
      `CPU actualizar ${(p.msActualizar / p.cuadros).toFixed(2)} ms · render ${(p.msRender / p.cuadros).toFixed(2)} ms`,
      `llamadas ${i.render.calls} · triángulos ${(i.render.triangles / 1000).toFixed(0)} k`,
      `geometrías ${i.memory.geometries} · texturas ${i.memory.textures}`,
      `ratio ${this.renderer.getPixelRatio()}${this.degradado ? ' (bajado)' : ''} · mapas de sombra ${(p.sombras / p.acumulado).toFixed(1)}/s`,
    ].filter(Boolean).join('\n');
    p.acumulado = p.cuadros = p.sombras = p.msActualizar = p.msRender = 0;
  }

  /** Centro (x, z del modelo) de una zona por su nombre, o null si no existe. */
  private centroDe(nombre: string): { x: number; z: number } | null {
    const norma = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const pieza = this.piezas.find(p => norma(p.zona.n) === norma(nombre));
    const anillo = pieza?.geometria.map(g => g[0]).sort((u, v) => v.length - u.length)[0];
    if (!anillo?.length) return null;
    const lat = anillo.reduce((m, q) => m + q[0], 0) / anillo.length, lon = anillo.reduce((m, q) => m + q[1], 0) / anillo.length;
    return { x: this.aX(lon), z: this.aZ(lat) };
  }

  /**
   * Vista inicial: sobre Girardota, mirando hacia el este (el Río Medellín cruza de frente), con la cámara
   * baja (unos 32° sobre el horizonte) para que se lean el relieve y las veredas de ambos lados.
   */
  private posicionarCamara(): void {
    const c = this.centroDe('Girardota') ?? { x: 0, z: 0 };
    const suelo = this.alturaEn(this.lon0 + c.x / this.mLon, this.lat0 - c.z / this.mLat);
    const objetivo = new THREE.Vector3(c.x, suelo, c.z);
    const dist = 9500, polar = 58 * Math.PI / 180;
    const pos = objetivo.clone().add(new THREE.Vector3(-dist * Math.sin(polar), dist * Math.cos(polar), 0));
    this.camara.position.copy(pos);
    this.controles.target.copy(objetivo);
    this.controles.update();
    this.vistaInicial = { pos: pos.clone(), objetivo: objetivo.clone() };
  }

  // ───────────────────────── bucle e interacción ─────────────────────────

  private arrancar(): void {
    this.zona.runOutsideAngular(() => {
      let anterior = performance.now();
      let inicio = 0;   // se fija al terminar de construir la escena
      // con el lienzo fuera de la vista (página desplazada, otra pestaña del panel) no se dibuja nada
      const obs = new IntersectionObserver(([e]) => this.lienzoVisible = e.isIntersecting);
      obs.observe(this.lienzo.nativeElement);
      this.destroyRef.onDestroy(() => obs.disconnect());
      const bucle = (t: number) => {
        this.animacion = requestAnimationFrame(bucle);
        if (!this.lienzoVisible || !this.construido) return;
        // durante los primeros segundos la escena aún se completa (capas que llegan después): sombra siempre fresca
        if (!inicio) inicio = t;
        const cargando = t - inicio < 4000;
        if (cargando) this.sombraSucia = true;
        // ritmo: 60 cuadros por segundo como tope (en pantallas de 120–144 Hz no se dibuja de más) y 30 cuando nadie
        // toca el mapa desde hace un segundo; nubes, autos y gente se ven igual de fluidos y la GPU trabaja la mitad
        const camaraQuieta = this.camara.position.distanceToSquared(this.camaraRitmo) < 1e-4
          && this.controles.target.distanceToSquared(this.objetivoRitmo) < 1e-4;
        if (!camaraQuieta || this.vuelo || this.conduciendo() || this.moverPendiente || cargando) this.ultimaActividad = t;
        this.camaraRitmo.copy(this.camara.position);
        this.objetivoRitmo.copy(this.controles.target);
        const intervalo = t - this.ultimaActividad > 1000 ? 1000 / 30 : 1000 / 60;
        if (t + 2 < this.proximoCuadro) return;           // 2 ms de holgura: los cuadros de 60 Hz no llegan exactos
        this.proximoCuadro = t - this.proximoCuadro > intervalo ? t + intervalo : this.proximoCuadro + intervalo;
        this.atenderMover();
        const dt = Math.min(0.1, (t - anterior) / 1000);
        anterior = t;
        const t0 = this.perf ? performance.now() : 0;
        if (this.conduciendo()) this.conducirFotograma(dt);
        else {
          this.desplazarConFlechas(dt);
          if (this.vuelo) this.avanzarVuelo(t);
          this.aplicarGiroYZoom();
          this.controles.update();
          this.limitarDesplazamiento();
          this.mantenerSobreElRelieve();
        }
        this.ajustarPlanoCercano();
        this.ajustarAtmosfera();
        this.ajustarTiltShift(dt);
        this.animarAlzado();
        this.actualizarSombras();
        this.actualizarArboles();
        this.actualizarFachadas();
        this.actualizarCercas();
        this.animarNubes(dt);
        this.animarNiebla(dt);
        this.animarPajaros(dt);
        this.animarAvion(dt);
        this.animarEstela(dt);
        this.animarTrafico(dt);
        this.animarGente(dt);
        this.animarHumo();
        this.animarAuras(t / 1000);
        this.animarConfluencias();
        this.animarColorRio(dt);
        if (this.texturaRio) this.texturaRio.offset.y -= dt * VELOCIDAD_AGUA;   // la corriente avanza
        this.ajustarResolucion(t, dt);
        const t1 = this.perf ? performance.now() : 0;
        this.renderizar();
        if (this.perf) {
          this.perf.msActualizar += t1 - t0;
          this.perf.msRender += performance.now() - t1;
        }
        this.actualizarRotulos();
        if (this.perf) this.mostrarPerf(dt);
      };
      this.animacion = requestAnimationFrame(bucle);
    });
  }

  /**
   * Desplaza cámara y punto de mira sobre el suelo según las flechas, en el sentido en que mira la cámara (↑ avanza
   * hacia el fondo de la pantalla). La velocidad crece con la distancia al punto de mira, así de lejos se cruza el
   * municipio en pocos segundos y de cerca se recorre la cuadra con precisión; arranca y frena con suavidad.
   */
  private desplazarConFlechas(dt: number): void {
    const f = this.flechas;
    let ax = (f.has('ArrowRight') ? 1 : 0) - (f.has('ArrowLeft') ? 1 : 0);
    let ay = (f.has('ArrowUp') ? 1 : 0) - (f.has('ArrowDown') ? 1 : 0);
    if (ax && ay) { ax *= Math.SQRT1_2; ay *= Math.SQRT1_2; }
    const t = this.controles.target, p = this.camara.position;
    const rapidez = Math.max(60, p.distanceTo(t) * 0.5) * (this.flechaRapida ? 2.5 : 1);
    this.velFlechas.lerp(new THREE.Vector2(ax * rapidez, ay * rapidez), Math.min(1, dt * 8));
    if (this.velFlechas.lengthSq() < 1) { this.velFlechas.set(0, 0); return; }
    if (ax || ay) this.vuelo = null;   // tomar el mando corta un vuelo en curso
    // adelante = hacia donde mira la cámara, aplanado sobre el suelo; derecha = perpendicular
    const fx = t.x - p.x, fz = t.z - p.z, l = Math.hypot(fx, fz) || 1;
    const adX = fx / l, adZ = fz / l;
    const dx = (adX * this.velFlechas.y - adZ * this.velFlechas.x) * dt;
    const dz = (adZ * this.velFlechas.y + adX * this.velFlechas.x) * dt;
    t.x += dx; t.z += dz;
    p.x += dx; p.z += dz;
  }

  /** Gasta poco a poco el giro y el zoom acumulados por la rueda, para que se sienta suave. */
  private aplicarGiroYZoom(): void {
    if (Math.abs(this.giroPendiente) > 1e-4) {
      const a = this.giroPendiente * 0.2;
      this.giroPendiente -= a;
      // gira la cámara alrededor del eje vertical que pasa por el punto de mira: 360° sin tope
      const d = this.camara.position.clone().sub(this.controles.target);
      d.applyAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      this.camara.position.copy(this.controles.target).add(d);
    }
    if (Math.abs(this.inclinacionPendiente) > 1e-4) {
      const a = this.inclinacionPendiente * 0.2;
      this.inclinacionPendiente -= a;
      // sube o baja la cámara sobre su esfera: de mirar desde arriba hasta casi a ras del mapa, sin pasar por debajo
      const d = this.camara.position.clone().sub(this.controles.target);
      const r = d.length();
      const phi = Math.min(Math.PI / 2 - LIMITE_POLAR, Math.max(LIMITE_POLAR, Math.acos(d.y / r) - a));
      const theta = Math.atan2(d.x, d.z);
      d.set(r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.cos(theta));
      this.camara.position.copy(this.controles.target).add(d);
    }
    if (Math.abs(this.zoomPendiente) > 1e-4) {
      const a = this.zoomPendiente * 0.2;
      this.zoomPendiente -= a;
      this.acercar(Math.exp(a));
    }
  }

  /** Multiplica la distancia de la cámara al punto de mira (< 1 acerca, > 1 aleja), dentro de los límites. */
  acercar(factor: number): void {
    const d = this.camara.position.clone().sub(this.controles.target);
    const largo = Math.min(this.controles.maxDistance, Math.max(this.controles.minDistance, d.length() * factor));
    this.camara.position.copy(this.controles.target).add(d.setLength(largo));
  }

  /** Evita que el punto de mira se salga del terreno al desplazarse. */
  /**
   * La cámara nunca baja de la superficie del terreno que tiene debajo: se toma la cota más alta alrededor suyo
   * (para no rozar una loma de frente) y un margen que cubre las veredas levantadas. Si el usuario intenta bajar
   * más, la cámara se queda a ras de esa cota y sigue orbitando desde ahí.
   */
  private mantenerSobreElRelieve(): void {
    const p = this.camara.position;
    let techo = -Infinity;
    // el radio de muestreo y el margen se achican al acercarse, hasta casi la altura de una persona
    const dist = p.distanceTo(this.controles.target);
    const k = Math.min(1, dist / 6000);
    const radio = 400 * k, margen = 12 + (MARGEN_CAMARA_RELIEVE - 12) * k;
    for (const [cx, cz] of [[0, 0], [radio, 0], [-radio, 0], [0, radio], [0, -radio]]) {
      techo = Math.max(techo, this.alturaEn(this.lon0 + (p.x + cx) / this.mLon, this.lat0 - (p.z + cz) / this.mLat));
    }
    const minimo = techo + margen;
    let cambio = false;
    if (p.y < minimo) { p.y = minimo; cambio = true; }
    if (this.evitarEdificios(p)) cambio = true;
    if (cambio) this.camara.lookAt(this.controles.target);
  }

  /** El plano cercano baja con la distancia al punto de mira para poder acercarse mucho sin perder precisión de profundidad de lejos. */
  private ajustarPlanoCercano(): void {
    const near = Math.min(200, Math.max(1.5, this.camara.position.distanceTo(this.controles.target) / 25));
    if (Math.abs(near - this.camara.near) / near < 0.05) return;
    this.camara.near = near;
    this.camara.updateProjectionMatrix();
  }

  /**
   * Perspectiva atmosférica: con la cámara cerca del suelo la niebla empieza a pocos kilómetros, así las lomas
   * del otro lado del valle pierden contraste y se lee la distancia; al alejarse vuelve al rango de la vista
   * general. Solo mueve dos números de la niebla que ya existe: no añade pasadas ni cambia los materiales.
   */
  private ajustarAtmosfera(): void {
    const niebla = this.escena.fog as THREE.Fog;
    const d = this.camara.position.distanceTo(this.controles.target);
    if (!this.atmosfera) { niebla.near = 26000; niebla.far = 56000; return; }
    const s = THREE.MathUtils.smoothstep(d, 400, 12000);
    // de cerca la bruma empieza a 800 m; en la vista general, a 9 km (solo se aclaran las montañas del otro lado del valle)
    const near = 800 + 8200 * s, far = 14000 + 30000 * s;
    if (Math.abs(far - niebla.far) / far < 0.01) return;
    niebla.near = near;
    niebla.far = far;
  }

  /**
   * Tilt-shift tipo maqueta: entra al acercarse (pleno por debajo de 1,2 km del punto de mira, nada por encima de
   * 4,5 km) y solo con la cámara mirando hacia abajo; casi a ras del horizonte se desvanece. Mientras se inspecciona
   * algo (ficha abierta, capa encendida, vuelo, conducción) la imagen queda nítida. Las transiciones son suaves y el
   * CSS solo se toca cuando el desenfoque cambia de verdad.
   */
  private ajustarTiltShift(dt: number): void {
    const inspeccionando = !!this.vuelo || this.conduciendo() || !!this.seleccion() || !!this.pinFicha()
      || !!this.fabricaSeleccion() || !!this.rioSeleccion() || !!this.redSeleccion() || this.capasActivas().size > 0
      || this.sistemaHidrico() || this.nombresRios() || this.barriosVisibles() || this.flujoVisible() || this.subterraneo();
    let meta = 0;
    if (this.tiltShift && !inspeccionando) {
      const d = this.camara.position.distanceTo(this.controles.target);
      const polar = this.controles.getPolarAngle() * 180 / Math.PI;
      meta = (1 - THREE.MathUtils.smoothstep(d, 1200, 4500)) * (1 - THREE.MathUtils.smoothstep(polar, 66, 80));
    }
    this.tiltK += (meta - this.tiltK) * Math.min(1, dt * 5);
    const px = Math.round(this.tiltK * 3.5 * 10) / 10;
    if (px === this.tiltPx) return;
    this.tiltPx = px;
    const el = this.capaTilt.nativeElement;
    el.style.display = px > 0 ? 'block' : 'none';
    el.style.setProperty('--tilt', `${px}px`);
  }

  /** Si la cámara quedó dentro de un edificio (o más baja que su techo sobre él), la saca por el lado más cercano. */
  private evitarEdificios(p: THREE.Vector3): boolean {
    if (p.distanceTo(this.controles.target) > 3000) return false;
    const m = 6;
    let movido = false;
    const cx = Math.floor((p.x + this.ancho / 2) / TESELA), cz = Math.floor((p.z + this.alto / 2) / TESELA);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const c of this.cajasViv.get(cx + a + (cz + b) * 1000) ?? []) {
          const top = c.top + (this.alzado[c.id] ?? 0) + m;
          if (p.y >= top || p.x < c.x0 - m || p.x > c.x1 + m || p.z < c.z0 - m || p.z > c.z1 + m) continue;
          const dx0 = p.x - (c.x0 - m), dx1 = c.x1 + m - p.x, dz0 = p.z - (c.z0 - m), dz1 = c.z1 + m - p.z;
          const mn = Math.min(dx0, dx1, dz0, dz1);
          if (mn === dx0) p.x = c.x0 - m; else if (mn === dx1) p.x = c.x1 + m;
          else if (mn === dz0) p.z = c.z0 - m; else p.z = c.z1 + m;
          movido = true;
        }
      }
    }
    for (const e of this.cajasEquip) {
      const top = e.top + (this.alzado[e.id] ?? 0) + m, rr = e.r + m;
      const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
      if (p.y >= top || d >= rr) continue;
      const f = d < 1e-3 ? 1 : rr / d;
      p.x = e.x + (d < 1e-3 ? rr : dx * f);
      p.z = e.z + (d < 1e-3 ? 0 : dz * f);
      movido = true;
    }
    return movido;
  }

  /** La cámara de persecución no atraviesa edificios: si uno se interpone entre ella y el carro, se acerca hasta justo antes. */
  private acercarCamaraAlCarro(cam: THREE.Vector3, carro: THREE.Vector3): void {
    const PASOS = 16, m = 0.5;
    const dentro = (x: number, y: number, z: number): boolean => {
      const cx = Math.floor((x + this.ancho / 2) / TESELA), cz = Math.floor((z + this.alto / 2) / TESELA);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (const c of this.cajasViv.get(cx + a + (cz + b) * 1000) ?? []) {
            if (y >= c.top + (this.alzado[c.id] ?? 0) || x < c.x0 - m || x > c.x1 + m || z < c.z0 - m || z > c.z1 + m) continue;
            // dentro del contorno real (no de su caja envolvente)
            const q = c.poli;
            let en = false;
            for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) {
              if ((q[j + 1] > z) !== (q[i + 1] > z) && x < (q[i] - q[j]) * (z - q[j + 1]) / (q[i + 1] - q[j + 1]) + q[j]) en = !en;
            }
            if (en) return true;
          }
        }
      }
      return this.cajasEquip.some(e => y < e.top + (this.alzado[e.id] ?? 0) && Math.hypot(x - e.x, z - e.z) < e.r + m);
    };
    const dx = cam.x - carro.x, dy = cam.y - (carro.y + 2), dz = cam.z - carro.z;
    for (let i = 1; i <= PASOS; i++) {
      const t = i / PASOS;
      if (!dentro(carro.x + dx * t, carro.y + 2 + dy * t, carro.z + dz * t)) continue;
      const u = Math.max(0.3, (i - 1) / PASOS);
      cam.set(carro.x + dx * u, carro.y + 2 + dy * u + 1.5 * (1 - u), carro.z + dz * u);
      return;
    }
  }

  /** Saca al carro de conducción (círculo de radio `r`) de los edificios, equipamientos y fábricas que pisa; true si chocó. */
  private empujarCarro(p: THREE.Vector3, r: number): boolean {
    let choco = false;
    // los predios del catastro a veces se montan sobre la calzada: mientras el carro va por el asfalto solo cuenta lo que lo roza
    const enAsfalto = (this.holguraConduccion?.(p.x, p.z)[0] ?? 1) < -1.5;
    const cx = Math.floor((p.x + this.ancho / 2) / TESELA), cz = Math.floor((p.z + this.alto / 2) / TESELA);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const c of this.cajasViv.get(cx + a + (cz + b) * 1000) ?? []) {
          if (p.y >= c.top + (this.alzado[c.id] ?? 0) - 0.5 || p.x < c.x0 - r || p.x > c.x1 + r || p.z < c.z0 - r || p.z > c.z1 + r) continue;
          // contra el contorno real del edificio (la caja que lo envuelve sobra en las esquinas de los predios en diagonal)
          const q = c.poli;
          let minD = Infinity, qx = 0, qz = 0, dentro = false;
          for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) {
            const ax = q[j], az = q[j + 1], bx = q[i], bz = q[i + 1];
            if ((az > p.z) !== (bz > p.z) && p.x < (bx - ax) * (p.z - az) / (bz - az) + ax) dentro = !dentro;
            const sx = bx - ax, sz = bz - az, ll = sx * sx + sz * sz;
            const t = ll > 0 ? Math.min(1, Math.max(0, ((p.x - ax) * sx + (p.z - az) * sz) / ll)) : 0;
            const px = ax + sx * t, pz = az + sz * t, d = Math.hypot(p.x - px, p.z - pz);
            if (d < minD) { minD = d; qx = px; qz = pz; }
          }
          const rad = enAsfalto ? r * 0.4 : r;
          if (enAsfalto ? dentro || minD >= rad : !dentro && minD >= rad) continue;
          const ux = dentro ? qx - p.x : p.x - qx, uz = dentro ? qz - p.z : p.z - qz, ul = Math.hypot(ux, uz);
          if (ul < 1e-6) { p.x = qx + rad; } else { p.x = qx + ux / ul * rad; p.z = qz + uz / ul * rad; }
          choco = true;
        }
      }
    }
    const redondos = [...this.cajasEquip.map(e => ({ x: e.x, z: e.z, r: e.r, top: e.top + (this.alzado[e.id] ?? 0) })), ...this.fabricas.map(f => ({ x: f.x, z: f.z, r: f.r, top: Infinity }))];
    for (const e of redondos) {
      const rr = e.r + r, dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
      if (p.y >= e.top - 0.5 || d >= rr) continue;
      p.x = e.x + (d < 1e-3 ? rr : dx * rr / d);
      p.z = e.z + (d < 1e-3 ? 0 : dz * rr / d);
      choco = true;
    }
    return choco;
  }

  private limitarDesplazamiento(): void {
    const t = this.controles.target;
    const x = Math.min(this.ancho / 2, Math.max(-this.ancho / 2, t.x));
    const z = Math.min(this.alto / 2, Math.max(-this.alto / 2, t.z));
    if (x === t.x && z === t.z) return;
    this.camara.position.x += x - t.x;
    this.camara.position.z += z - t.z;
    t.x = x;
    t.z = z;
  }

  /**
   * Confluencias: donde un cauce termina contra el Río Medellín se pone una mancha que difumina el azul del afluente
   * en el café del río y, encima, una espuma de burbujas que se estira río abajo y titila. Se buscan los extremos de los
   * demás cauces que quedan a menos de ~48 m del eje del Medellín.
   */
  private construirConfluencias(med: [number, number][][], afluentes: { p: [number, number]; ancho: number }[]): void {
    if (!med.length || !afluentes.length) return;
    type Cand = { d: number; px: number; pz: number; tx: number; tz: number; ex: number; ez: number; ancho: number };
    const cand: Cand[] = [];
    for (const a of afluentes) {
      let mejor: Cand | null = null;
      for (const l of med) {
        for (let i = 1; i < l.length; i++) {
          const [ax, az] = l[i - 1], [bx, bz] = l[i];
          const sx = bx - ax, sz = bz - az, ll = sx * sx + sz * sz;
          if (ll < 1e-6) continue;
          const t = Math.min(1, Math.max(0, ((a.p[0] - ax) * sx + (a.p[1] - az) * sz) / ll));
          const px = ax + sx * t, pz = az + sz * t, d = Math.hypot(a.p[0] - px, a.p[1] - pz);
          if (!mejor || d < mejor.d) { const lg = Math.sqrt(ll); mejor = { d, px, pz, tx: sx / lg, tz: sz / lg, ex: a.p[0], ez: a.p[1], ancho: a.ancho }; }
        }
      }
      if (mejor && mejor.d < 48) cand.push(mejor);
    }
    cand.sort((u, v) => u.d - v.d);
    const elegidas: Cand[] = [];
    for (const c of cand) if (elegidas.every(o => Math.hypot(o.px - c.px, o.pz - c.pz) > 70)) elegidas.push(c);
    if (!elegidas.length) return;

    const lienzo = () => { const c = document.createElement('canvas'); c.width = c.height = 256; return c; };
    const ver = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this.texturasConfluencia.push(t); return t; };
    // mezcla: elipse que va del azul del afluente al café del río y se desvanece hacia el borde
    const cm = lienzo(), xm = cm.getContext('2d')!;
    xm.translate(128, 128);
    xm.scale(1, 0.62);
    const gm = xm.createRadialGradient(-20, 0, 0, 0, 0, 126);
    gm.addColorStop(0, 'rgba(77,179,230,.8)');         // el azul de siempre; hacia el borde solo se aclara y se desvanece
    gm.addColorStop(0.45, 'rgba(150,208,238,.42)');
    gm.addColorStop(1, 'rgba(190,225,245,0)');
    xm.fillStyle = gm;
    xm.fillRect(-128, -128, 256, 256);
    // espuma: burbujas blancas, más densas en la boca del afluente y esparcidas río abajo
    const ce = lienzo(), xe = ce.getContext('2d')!;
    const rnd = mulberry32(31337);
    // manchones de espuma blanda (se leen desde lejos) y, encima, las burbujas finas
    for (let i = 0; i < 46; i++) {
      const u = Math.pow(rnd(), 1.3), ang = rnd() * Math.PI * 2;
      const x = 128 + Math.cos(ang) * u * 90, y = 128 + Math.sin(ang) * u * 46, r = 12 + rnd() * 16;
      const g = xe.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.5 + rnd() * 0.3})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      xe.fillStyle = g;
      xe.beginPath();
      xe.arc(x, y, r, 0, Math.PI * 2);
      xe.fill();
    }
    for (let i = 0; i < 700; i++) {
      const u = Math.pow(rnd(), 1.6), ang = rnd() * Math.PI * 2;
      const x = 128 + Math.cos(ang) * u * 96, y = 128 + Math.sin(ang) * u * 52;
      const r = 3.5 + rnd() * (9 - u * 4);
      const g = xe.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.4 + rnd() * 0.35})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      xe.fillStyle = g;
      xe.beginPath();
      xe.arc(x, y, r, 0, Math.PI * 2);
      xe.fill();
    }
    // se desenfoca la espuma para que se funda con el agua en vez de verse como burbujas sueltas
    const cb = lienzo(), xb = cb.getContext('2d')!;
    xb.filter = 'blur(4px)';
    xb.drawImage(ce, 0, 0);
    xb.filter = 'none';
    const texMezcla = ver(cm), texEspuma = ver(cb);
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geosPajaros.push(geo);          // se libera junto con las demás geometrías sueltas
    const matriz = (map: THREE.Texture, alto: number) => {
      const m = new THREE.MeshBasicMaterial({
        map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 - alto, polygonOffsetUnits: -6 - alto,
      });
      this.materialesConfluencia.push(m);
      return m;
    };
    const matMezcla = matriz(texMezcla, 0), matEspuma = matriz(texEspuma, 1);
    for (const c of elegidas) {
      const largo = Math.min(190, 130 + c.ancho * 8), ancho = largo * 0.6;
      // la boca: justo donde termina el azul del afluente (su último punto)
      const bx = c.ex, bz = c.ez;
      // río abajo = hacia donde baja el terreno; la espuma se estira hacia allá
      const flujo = this.alturaXZ(c.px + c.tx * 80, c.pz + c.tz * 80) <= this.alturaXZ(c.px - c.tx * 80, c.pz - c.tz * 80) ? 1 : -1;
      const yaw = Math.atan2(-c.tz * flujo, c.tx * flujo);
      // la espuma se centra exactamente en la boca; solo su estela se orienta río abajo
      this.bocas.push({ x: bx, z: bz, dx: c.tx * flujo, dz: c.tz * flujo });
      const x = bx, z = bz;
      const y = this.alturaXZ(x, z) + 4;
      const mezcla = new THREE.Mesh(geo, matMezcla), espuma = new THREE.Mesh(geo, matEspuma);
      for (const [m, dy, o] of [[mezcla, 0, 3], [espuma, 0.4, 4]] as [THREE.Mesh, number, number][]) {
        m.position.set(x, y + dy, z);
        m.rotation.y = yaw;
        m.scale.set(largo, 1, ancho);
        m.renderOrder = o;
        this.escena.add(m);
      }
      this.confluencias.push({ espuma, fase: Math.random() * Math.PI * 2, largo });
    }
  }

  /** La espuma titila y se estira apenas río abajo; comparten material, así que pulsan juntas. */
  /** El color del Río Medellín pasa despacio de uno de sus tonos al siguiente (elegido al azar), con un reposo entre cambios. */
  private animarColorRio(dt: number): void {
    const c = this.colorRio, u = this.uniformsRio;
    u.uT.value += dt;
    c.t += dt / (CAMBIO_COLOR_RIO + REPOSO_COLOR_RIO);
    if (c.t >= 1) {
      c.t = 0;
      c.de = c.a;
      c.a = (c.a + 1 + Math.floor(Math.random() * (COLORES_MEDELLIN.length - 1))) % COLORES_MEDELLIN.length;
    }
    const k = Math.min(1, c.t * (CAMBIO_COLOR_RIO + REPOSO_COLOR_RIO) / CAMBIO_COLOR_RIO);
    u.uRio.value.set(COLORES_MEDELLIN[c.de]).lerp(new THREE.Color(COLORES_MEDELLIN[c.a]), k * k * (3 - 2 * k));
  }

  private animarConfluencias(): void {
    if (!this.confluencias.length) return;
    const t = performance.now() / 1000;
    (this.confluencias[0].espuma.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * Math.sin(t * 1.4);
    for (const c of this.confluencias) c.espuma.scale.x = c.largo * (1 + 0.05 * Math.sin(t * 0.9 + c.fase));
  }

  /**
   * Color propio del Río Medellín, #AF9447 (en lineal: 0.429, 0.296, 0.063), con las ondas de la corriente en azul. Cada
   * vértice de la cinta lleva un `tinte` 0–1; el shader mezcla la textura hacia ese color y sus hebras claras hacia el azul.
   */
  private teñirAgua(malla: THREE.Mesh, rangos: [number, number][]): void {
    if (!rangos.length) return;
    const pos = malla.geometry.getAttribute('position');
    const n = pos.count;
    const tinte = new Float32Array(n), esMedellin = new Uint8Array(n);
    for (const [a, b] of rangos) { tinte.fill(1, a, Math.min(n, b)); esMedellin.fill(1, a, Math.min(n, b)); }
    // degradado en cada confluencia: el Medellín se aclara hacia el azul justo después de la boca y recupera su café río
    // abajo; el afluente, a su vez, vira de azul a café en sus últimos ~100 m. La interpolación entre vértices lo suaviza.
    for (const b of this.bocas) {
      for (let i = 0; i < n; i++) {
        const rx = pos.getX(i) - b.x, rz = pos.getZ(i) - b.z, d = Math.hypot(rx, rz);
        if (d > 200) continue;
        if (esMedellin[i]) {
          const along = rx * b.dx + rz * b.dz;
          if (along < -25 || Math.abs(rx * b.dz - rz * b.dx) > 75) continue;      // aguas arriba de la boca sigue café
          const t = Math.min(1, (along + 25) / 190);
          tinte[i] = Math.min(tinte[i], 1 - 0.8 * Math.pow(1 - t, 1.4));
        } else if (d < 100) {
          tinte[i] = Math.max(tinte[i], Math.pow(1 - d / 100, 1.3));
        }
      }
    }
    malla.geometry.setAttribute('tinte', new THREE.BufferAttribute(tinte, 1));
    // vertimientos: cada industria a menos de ALCANCE_CERCA_RIO del Medellín deja una mancha (azul añil o rojo carmín) en
    // el tramo vecino, que aparece y se disipa sola. Por vértice: peso, tipo (0 añil · 1 carmín) y fase.
    const mancha = new Float32Array(n * 3);
    const rnd = mulberry32(8128);
    for (const f of this.fabricas) {
      let cerca = Infinity;
      for (let i = 0; i < n; i++) if (esMedellin[i]) cerca = Math.min(cerca, Math.hypot(pos.getX(i) - f.x, pos.getZ(i) - f.z));
      const tipo = rnd() < 0.6 ? 0 : 1, fase = rnd() * Math.PI * 2;
      if (cerca > ALCANCE_CERCA_RIO) continue;
      for (let i = 0; i < n; i++) {
        if (!esMedellin[i]) continue;
        const peso = Math.pow(Math.max(0, 1 - Math.hypot(pos.getX(i) - f.x, pos.getZ(i) - f.z) / (cerca + ALCANCE_MANCHA)), 1.3);
        if (peso > mancha[i * 3]) { mancha[i * 3] = peso; mancha[i * 3 + 1] = tipo; mancha[i * 3 + 2] = fase; }
      }
    }
    malla.geometry.setAttribute('mancha', new THREE.BufferAttribute(mancha, 3));
    (malla.material as THREE.MeshBasicMaterial).onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniformsRio);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float tinte;
          attribute vec3 mancha;
          varying float vTinte;
          varying vec3 vMancha;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vTinte = tinte;
          vMancha = mancha;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vTinte;
          varying vec3 vMancha;
          uniform vec3 uRio, uAnil, uCarmin;
          uniform float uT;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          // las hebras de la corriente son lo claro de la textura (mucho rojo); ahí el río va azul y en el resto, su color
          float onda = smoothstep(0.25, 0.7, diffuseColor.r);
          vec3 medellin = mix(uRio, vec3(0.06, 0.36, 0.78), onda * 0.7);
          float activa = smoothstep(-0.15, 0.6, sin(uT * 0.05 + vMancha.z));
          vec3 tinta = mix(uAnil, uCarmin, vMancha.y) * (0.85 + 0.3 * onda);
          medellin = mix(medellin, tinta, clamp(vMancha.x * 1.4, 0.0, 1.0) * activa * 0.92);
          diffuseColor.rgb = mix(diffuseColor.rgb, medellin, vTinte * ${TINTE_MEDELLIN.toFixed(2)});`);
    };
    (malla.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }

  /** Textura del agua: azul con corriente clara. Se repite a lo largo del cauce y se desplaza para animarla. */
  private texturaAgua(): THREE.CanvasTexture {
    const W = 64, H = 128;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#2c88c8');
    g.addColorStop(0.5, '#4db3e6');
    g.addColorStop(1, '#2c88c8');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,.85)';
    x.lineWidth = 4;
    x.lineCap = 'round';
    // hebras de corriente; las que cruzan el borde se dibujan también desplazadas para que el tramo repita sin costura
    for (const [px, py, l] of [[16, 6, 30], [46, 30, 26], [24, 56, 32], [50, 82, 28], [14, 104, 20]]) {
      for (const dy of [0, -H]) {
        x.beginPath();
        x.moveTo(px, py + dy);
        x.bezierCurveTo(px + 5, py + dy + l / 3, px - 5, py + dy + 2 * l / 3, px, py + dy + l);
        x.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  /**
   * Árboles repartidos según la foto satelital: donde el verde es oscuro hay bosque, donde es claro (potreros)
   * apenas unos pocos. Se evitan las vías, los cauces y los edificios. Van como una sola malla instanciada.
   */
  private construirVegetacion(vias: Compacto | null, edificios: Compacto | null, cauces: Cauces | null): void {
    if (!this.foto) return;
    const [o, s, e, n] = this.relieve.bbox;
    const W = 1536, H = Math.round(W * this.alto / this.ancho);
    const lienzo = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      return [c, c.getContext('2d', { willReadFrequently: true })!];
    };
    const aPx = (lon: number, lat: number): [number, number] => [(lon - o) / (e - o) * W, (n - lat) / (n - s) * H];

    const [, xf] = lienzo();
    xf.drawImage(this.foto, 0, 0, W, H);
    const foto = xf.getImageData(0, 0, W, H).data;

    // máscara de lo que no admite árboles: vías, cauces y edificios
    const [, xm] = lienzo();
    xm.fillStyle = xm.strokeStyle = '#fff';
    xm.lineCap = xm.lineJoin = 'round';
    for (const v of vias?.v ?? []) {
      if (v[0] === 2) continue;                          // senderos: pueden cruzar el bosque
      xm.lineWidth = [5, 4, 0][v[0]] ?? 0;
      xm.beginPath();
      this.desdeDeltas(v, vias!.k, 1).forEach(([lo, la], i) => { const [px, py] = aPx(lo, la); if (i) xm.lineTo(px, py); else xm.moveTo(px, py); });
      xm.stroke();
    }
    for (const c of [...(cauces?.c ?? []), ...(cauces?.i ?? [])]) {   // los cauces ocupan su ancho dibujado más un margen
      xm.lineWidth = Math.max(ANCHO_MIN_CAUCE, c[0] * FACTOR_ANCHO_CAUCE) / (this.ancho / W) + 3;
      xm.beginPath();
      this.desdeDeltas(c, cauces!.k, 2).forEach(([lo, la], i) => { const [px, py] = aPx(lo, la); if (i) xm.lineTo(px, py); else xm.moveTo(px, py); });
      xm.stroke();
    }
    for (const l of cauces?.l ?? []) {
      xm.lineWidth = 6;
      xm.beginPath();
      this.desdeDeltas(l, cauces!.k, 1).forEach(([lo, la], i) => { const [px, py] = aPx(lo, la); if (i) xm.lineTo(px, py); else xm.moveTo(px, py); });
      xm.closePath();
      xm.fill();
      xm.stroke();
    }
    xm.lineWidth = 3;
    for (const b of edificios?.e ?? []) {
      xm.beginPath();
      this.desdeDeltas(b, edificios!.k, 1).forEach(([lo, la], i) => { const [px, py] = aPx(lo, la); if (i) xm.lineTo(px, py); else xm.moveTo(px, py); });
      xm.closePath();
      xm.fill();
      xm.stroke();
    }
    for (const f of this.fabricas) {                          // ni árboles dentro de una fábrica
      const [px, py] = aPx(f.lon, f.lat);
      xm.beginPath();
      xm.arc(px, py, (f.r + 4) / (this.ancho / W), 0, Math.PI * 2);
      xm.fill();
    }
    for (const q of this.equipamientos) {                     // ni dentro de un equipamiento
      const [px, py] = aPx(q.lon, q.lat);
      xm.beginPath();
      xm.arc(px, py, (q.r + 3) / (this.ancho / W), 0, Math.PI * 2);
      xm.fill();
    }
    for (const h of this.huellasSub) {                        // ni árboles dentro del patio de una subestación (más un margen)
      xm.lineWidth = 8;
      xm.beginPath();
      h.forEach(([x, z], i) => { const [px, py] = aPx(this.lon0 + x / this.mLon, this.lat0 - z / this.mLat); if (i) xm.lineTo(px, py); else xm.moveTo(px, py); });
      xm.closePath();
      xm.fill();
      xm.stroke();
    }
    const urbano = xm.getImageData(0, 0, W, H).data;
    // zona de construcciones y su margen: los árboles que caen ahí se dibujan semitransparentes para no tapar edificios y casas
    const [, xc] = lienzo();
    xc.fillStyle = xc.strokeStyle = '#fff';
    xc.lineJoin = 'round';
    xc.lineWidth = 2 * MARGEN_TRANSPARENCIA / (this.ancho / W);
    for (const b of edificios?.e ?? []) {
      xc.beginPath();
      this.desdeDeltas(b, edificios!.k, 1).forEach(([lo, la], i) => { const [px, py] = aPx(lo, la); if (i) xc.lineTo(px, py); else xc.moveTo(px, py); });
      xc.closePath();
      xc.fill();
      xc.stroke();
    }
    for (const q of [...this.fabricas.map(f => ({ lon: f.lon, lat: f.lat, r: f.r })), ...this.equipamientos.map(e2 => ({ lon: e2.lon, lat: e2.lat, r: e2.r }))]) {
      const [px, py] = aPx(q.lon, q.lat);
      xc.beginPath();
      xc.arc(px, py, (q.r + MARGEN_TRANSPARENCIA) / (this.ancho / W), 0, Math.PI * 2);
      xc.fill();
    }
    const junto = xc.getImageData(0, 0, W, H).data;
    // tinte de cada árbol según el verde de la foto satelital en su sitio: más oscuro y azulado donde el bosque es denso, más claro y amarillento en potreros y rastrojo
    const tinteFoto = (lon: number, lat: number): [number, number, number] => {
      const [px, py] = aPx(lon, lat);
      if (px < 0 || py < 0 || px >= W || py >= H) return [1, 1, 1];
      const q = (Math.floor(py) * W + Math.floor(px)) * 4;
      const r = foto[q], g = foto[q + 1], b = foto[q + 2];
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      const claro = Math.min(1, Math.max(0, (lum - 55) / 90));                 // 0 bosque denso … 1 vegetación clara
      const amarillo = Math.min(1, Math.max(0, (r / (g + 1) - 0.62) / 0.3));  // 0 verde puro … 1 verde amarillento
      const brillo = 0.72 + claro * 0.5;
      return [brillo * (0.88 + amarillo * 0.32), brillo * (1 + claro * 0.04), brillo * (0.95 - amarillo * 0.25)];
    };
    const cercaDeConstruccion = (lon: number, lat: number): boolean => {
      const [px, py] = aPx(lon, lat);
      return px >= 0 && py >= 0 && px < W && py < H && junto[(Math.floor(py) * W + Math.floor(px)) * 4 + 3] > 0;
    };

    // colocación
    let semilla = 20251028;
    const azar = () => {            // mulberry32: mismo bosque en cada carga
      semilla = (semilla + 0x6D2B79F5) | 0;
      let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const lista: { x: number; y: number; z: number; sxz: number; sy: number; tono: number; id: number; peso: number; elev: number; especie: number; junto?: boolean; tinte?: [number, number, number] }[] = [];
    for (let zm = -this.alto / 2; zm < this.alto / 2; zm += PASO_ARBOLES) {
      for (let xm2 = -this.ancho / 2; xm2 < this.ancho / 2; xm2 += PASO_ARBOLES) {
        const x = xm2 + (azar() - 0.5) * PASO_ARBOLES * 0.9, z = zm + (azar() - 0.5) * PASO_ARBOLES * 0.9;
        const lon = this.lon0 + x / this.mLon, lat = this.lat0 - z / this.mLat;
        const [px, py] = aPx(lon, lat);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const q = (Math.floor(py) * W + Math.floor(px)) * 4;
        if (urbano[q + 3] > 0) continue;
        const r = foto[q], g = foto[q + 1], b = foto[q + 2];
        if (!(g > r + 6 && g > b + 8)) continue;       // no es vegetación
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        if (azar() > (lum < 78 ? 1 : lum < 120 ? 0.35 : 0.08)) continue;
        const id = this.idEn(lon, lat);
        lista.push({
          x, z, y: this.alturaEn(lon, lat) - 1, sxz: 10 + azar() * 6, sy: 17 + azar() * 9, tono: azar(),
          id, peso: id >= 0 ? this.pesoBorde(lon, lat, id) : 0,
          elev: this.alturaEn(lon, lat) / EXAGERACION + this.relieve.min, especie: 0, junto: cercaDeConstruccion(lon, lat), tinte: tinteFoto(lon, lat),
        });
      }
    }
    if (!lista.length) return;

    // biomas por altitud: el pino (especie 0) manda en lo alto y se va entremezclando hacia abajo; en las zonas bajas se
    // revuelven samán (1), yarumo (2) y ceiba (3), y entre ellos van exactamente GUAYACANES guayacanes amarillos (4)
    const bajos: number[] = [];
    lista.forEach((a, i) => {
      const pino = a.elev >= PINO_TOTAL || (a.elev > PINO_DESDE && azar() < (a.elev - PINO_DESDE) / (PINO_TOTAL - PINO_DESDE));
      if (pino) return;
      a.especie = 1 + Math.floor(azar() * 3);
      if (a.elev < PINO_DESDE) bajos.push(i);
    });
    for (let k = bajos.length - 1; k > 0; k--) {                 // se sortean sin repetir con un barajado parcial
      const j = Math.floor(azar() * (k + 1));
      [bajos[k], bajos[j]] = [bajos[j], bajos[k]];
    }
    bajos.slice(0, GUAYACANES).forEach(i => lista[i].especie = 4);
    // árboles del casco urbano (patios y calles): más bajos que los del bosque; samán, yarumo y algún guayacán florecido (la ceiba, que es enorme, no)
    for (const u of this.arbolesUrbanos) {
      const id = this.idEn(u.lon, u.lat), r = azar();
      lista.push({
        x: u.x, z: u.z, y: this.alturaEn(u.lon, u.lat) - 1, sxz: 8, sy: 11 + azar() * 5, tono: azar(),
        id, peso: id >= 0 ? this.pesoBorde(u.lon, u.lat, id) : 0,
        elev: this.alturaEn(u.lon, u.lat) / EXAGERACION + this.relieve.min, especie: r < 0.4 ? 1 : r < 0.8 ? 2 : 4, junto: cercaDeConstruccion(u.lon, u.lat), tinte: tinteFoto(u.lon, u.lat),
      });
    }

    // árbol de dibujo animado: tronco y dos conos de copa, de altura unitaria ~1,9
    const parte = (g: THREE.BufferGeometry, y: number, color: string) => {
      g.translate(0, y, 0);
      const c = new THREE.Color(color), n2 = g.getAttribute('position').count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n2 }, () => [c.r, c.g, c.b]).flat(), 3));
      return g;
    };
    const arbol = mergeGeometries([
      parte(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 5), 0.25, '#6d4c33'),
      parte(new THREE.ConeGeometry(0.95, 1.15, 6), 0.35 + 0.575, '#4f9a45'),
      parte(new THREE.ConeGeometry(0.68, 0.95, 6), 0.98 + 0.475, '#5cae4d'),
    ])!;
    // versión simple para cuando se ve de lejos: un solo cono (de unos 3 píxeles no se distingue del dibujo completo)
    const simple = parte(new THREE.ConeGeometry(0.85, 1.6, 5, 1, true), 0.35 + 0.8, '#57a249');
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    // al levantar una vereda los árboles suben con ella: el desplazamiento se aplica en la GPU
    material.onBeforeCompile = shader => {
      shader.uniforms['uAlza'] = { value: this.alzadoGpu };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aZona;
          attribute float aPeso;
          uniform float uAlza[32];`)
        .replace('#include <project_vertex>', `vec4 mvPosition = vec4( transformed, 1.0 );
          mvPosition = instanceMatrix * mvPosition;
          mvPosition.y += uAlza[int(aZona + 0.5)] * aPeso;
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
    };
    // especies de zona baja: se arman con los mismos modelos del catálogo, ya a su altura de siembra (en metros)
    const materialBajas = material.clone();
    materialBajas.side = THREE.DoubleSide;                           // las copas son medias esferas abiertas por debajo
    materialBajas.onBeforeCompile = material.onBeforeCompile;
    // copias semitransparentes (alphaHash: punteado estocástico, sin ordenar ni perder el z-buffer) para los árboles junto a construcciones
    const velada = (m: THREE.MeshStandardMaterial) => { const v = m.clone(); v.alphaHash = true; v.opacity = OPACIDAD_ARBOLES; v.onBeforeCompile = m.onBeforeCompile; return v; };
    const especies: { cerca: THREE.BufferGeometry; lejos: THREE.BufferGeometry; material: THREE.Material; velado: THREE.Material }[] = [
      { cerca: arbol, lejos: simple, material, velado: velada(material) },
    ];
    for (const e of ESPECIES_BAJAS) {
      const m = modelarEquipamiento('naturaleza', 'Vegetación', e.nombre, () => 0.5);
      const partes = m.piezas.map(({ g, color }) => {
        const geo = g.index ? g.toNonIndexed() : g.clone();
        geo.deleteAttribute('uv');
        const c = new THREE.Color(color), cnt = geo.getAttribute('position').count;
        geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: cnt }, () => [c.r, c.g, c.b]).flat(), 3));
        g.dispose();
        return geo;
      });
      const completo = mergeGeometries(partes)!;
      partes.forEach(g => g.dispose());
      completo.computeBoundingBox();
      const caja = completo.boundingBox!, escala = e.alto / caja.max.y;
      completo.scale(escala, escala, escala);
      // versión lejana: una elipsoide baja con el color de la copa, sobre la parte alta del árbol
      const al = e.alto, ancho = (caja.max.x - caja.min.x) * escala;
      const copa = new THREE.SphereGeometry(0.5, 6, 4).scale(ancho * 0.9, al * 0.5, ancho * 0.9).translate(0, al * 0.65, 0).toNonIndexed();
      copa.deleteAttribute('uv');
      const cc = new THREE.Color(e.copa), n3 = copa.getAttribute('position').count;
      copa.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n3 }, () => [cc.r, cc.g, cc.b]).flat(), 3));
      especies.push({ cerca: completo, lejos: copa, material: materialBajas, velado: velada(materialBajas) });
    }

    // una malla instanciada por tesela, por especie y por nivel de detalle: la GPU descarta las que no se ven
    const porTesela = new Map<number, typeof lista>();
    for (const a of lista) {
      const celda = Math.floor((a.x + this.ancho / 2) / TESELA_ARBOL) + Math.floor((a.z + this.alto / 2) / TESELA_ARBOL) * 1000;
      const clave = (celda * 8 + a.especie) * 2 + (a.junto ? 1 : 0);
      if (!porTesela.has(clave)) porTesela.set(clave, []);
      porTesela.get(clave)!.push(a);
    }
    const m4 = new THREE.Matrix4(), color = new THREE.Color();
    const eje = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), p = new THREE.Vector3(), esc = new THREE.Vector3();
    this.teselasArboles = [];
    const porBloque = new Map<number, { geo: THREE.BufferGeometry; mat: THREE.Material; hijos: number[]; zona: Float32Array[]; peso: Float32Array[] }>();
    for (const grupo of porTesela.values()) {
      const sp = especies[grupo[0].especie];
      const aZona = new Float32Array(grupo.length), aPeso = new Float32Array(grupo.length);
      const mat = grupo[0].junto ? sp.velado : sp.material;
      const cerca = new THREE.InstancedMesh(compartirGeometria(sp.cerca), mat, grupo.length);
      grupo.forEach((a, i) => {
        // el pino conserva su escala; las demás especies se escalan parejo (con la variación de tamaño del pino)
        if (a.especie === 0) esc.set(a.sxz, a.sy, a.sxz); else esc.setScalar(a.sy / 21);
        m4.compose(p.set(a.x, a.y, a.z), q.setFromAxisAngle(eje, azar() * 6.28), esc);
        cerca.setMatrixAt(i, m4);
        // variación de verdes entre árboles (el guayacán se queda amarillo: sin tinte)
        cerca.setColorAt(i, a.especie === 4 ? color.setRGB(1, 1, 1) : color.setRGB(a.tinte![0] * (0.94 + a.tono * 0.12), a.tinte![1] * (0.96 + a.tono * 0.08), a.tinte![2] * (0.94 + (1 - a.tono) * 0.12)));
        aZona[i] = a.id >= 0 ? a.id : 31;
        aPeso[i] = a.peso;
      });
      const atributos = [new THREE.InstancedBufferAttribute(aZona, 1), new THREE.InstancedBufferAttribute(aPeso, 1)];
      cerca.geometry.setAttribute('aZona', atributos[0]);
      cerca.geometry.setAttribute('aPeso', atributos[1]);
      // la versión simple comparte matrices, colores y atributos con la completa
      const lejos = new THREE.InstancedMesh(compartirGeometria(sp.lejos), mat, grupo.length);
      lejos.instanceMatrix = cerca.instanceMatrix;
      lejos.instanceColor = cerca.instanceColor;
      lejos.geometry.setAttribute('aZona', atributos[0]);
      lejos.geometry.setAttribute('aPeso', atributos[1]);
      for (const m of [cerca, lejos]) {
        m.receiveShadow = true;
        m.computeBoundingSphere();
        m.boundingSphere!.radius += ALZA_ELEGIDA + 30;
        this.escena.add(m);
      }
      lejos.visible = false;
      this.teselasArboles.push({ cerca, lejos, centro: cerca.boundingSphere!.center.clone() });
      // la tesela cae entera dentro de un bloque (los dos parten del mismo borde y 3 km es múltiplo de 750 m)
      const tx = Math.floor((grupo[0].x + this.ancho / 2) / TESELA_ARBOL), tz = Math.floor((grupo[0].z + this.alto / 2) / TESELA_ARBOL);
      const claveBloque = ((Math.floor(tx / TESELAS_POR_BLOQUE) + Math.floor(tz / TESELAS_POR_BLOQUE) * 1000) * 8 + grupo[0].especie) * 2 + (grupo[0].junto ? 1 : 0);
      const b = porBloque.get(claveBloque) ?? porBloque.set(claveBloque, { geo: sp.lejos, mat, hijos: [], zona: [], peso: [] }).get(claveBloque)!;
      b.hijos.push(this.teselasArboles.length - 1);
      b.zona.push(aZona);
      b.peso.push(aPeso);
    }

    // bloques: copian (en orden) matrices, colores y atributos de sus teselas en una sola malla simple
    this.bloquesArboles = [];
    for (const b of porBloque.values()) {
      if (b.hijos.length < 2) continue;                    // un bloque de una sola tesela no ahorra nada
      const hijos = b.hijos.map(i => this.teselasArboles[i]);
      const total = hijos.reduce((s, t) => s + t.cerca.count, 0);
      const malla = new THREE.InstancedMesh(compartirGeometria(b.geo), b.mat, total);
      const matrices = malla.instanceMatrix.array as Float32Array;
      const colores = new Float32Array(total * 3), zona = new Float32Array(total), peso = new Float32Array(total);
      let k = 0;
      hijos.forEach((t, j) => {
        matrices.set(t.cerca.instanceMatrix.array as Float32Array, k * 16);
        colores.set(t.cerca.instanceColor!.array as Float32Array, k * 3);
        zona.set(b.zona[j], k);
        peso.set(b.peso[j], k);
        k += t.cerca.count;
      });
      malla.instanceColor = new THREE.InstancedBufferAttribute(colores, 3);
      malla.geometry.setAttribute('aZona', new THREE.InstancedBufferAttribute(zona, 1));
      malla.geometry.setAttribute('aPeso', new THREE.InstancedBufferAttribute(peso, 1));
      malla.receiveShadow = true;
      malla.computeBoundingSphere();
      malla.boundingSphere!.radius += ALZA_ELEGIDA + 30;
      malla.visible = false;
      this.escena.add(malla);
      const bloque: BloqueArboles = { lejos: malla, centro: malla.boundingSphere!.center.clone(), radio: malla.boundingSphere!.radius };
      for (const t of hijos) t.bloque = bloque;
      this.bloquesArboles.push(bloque);
    }
  }

  private liberar(): void {
    window.removeEventListener('keydown', this.alTeclaSalida);
    this.salirDeConducir();
    cancelAnimationFrame(this.animacion);
    this.controles?.dispose();
    this.renderer?.dispose();
    this.terreno?.geometry.dispose();
    for (const f of this.mallasCercas) f.malla.geometry.dispose();
    for (const f of this.mallasFachadas) f.malla.geometry.dispose();
    this.matCercas?.dispose(); this.texCercas?.dispose();
    this.matFachadas?.dispose(); this.atlasFachadas?.dispose();
    this.matTejado?.map?.dispose(); this.matTejado?.dispose();
    this.rtNubes?.dispose();
    this.texturasNubes.forEach(t => t.dispose());
    for (const n of this.nubes) for (const b of n.bocanadas) b.sprite.material.dispose();
    this.disco?.material.dispose();
    for (const n of this.nieblas) n.sprite.material.dispose();
    this.geoIndustrias?.dispose();
    this.matIndustrias?.dispose();
    this.geoEquip?.dispose();
    this.matEquip?.dispose();
    this.auraEquip?.dispose();
    this.auraIndustrias?.dispose();
    this.iconosEquip.forEach(ic => ic.dispose());
    this.agrupadorIconos?.dispose();
    this.humoInst?.malla.geometry.dispose();
    (this.humoInst?.malla.material as THREE.Material | undefined)?.dispose();
    this.geoAutos.forEach(g => g.dispose());
    this.matAutos.forEach(m => m.dispose());
    this.geoGente.forEach(g => g.dispose());
    this.matGente?.dispose();
    this.texturasConfluencia.forEach(t => t.dispose());
    this.materialesConfluencia.forEach(m => m.dispose());
    this.geosPajaros.forEach(g => g.dispose());
    this.materialesPajaros.forEach(m => m.dispose());
    this.avion?.grupo.traverse(o => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      else if (o instanceof THREE.Sprite) o.material.dispose();
    });
    this.brilloLuz?.dispose();
    for (const p of this.estela) p.sprite.material.dispose();
    for (const s of this.nubeAvion?.sprites ?? []) s.material.dispose();
  }

  /** Borde de la vereda elegida y de la que está bajo el cursor: el mismo muro translúcido con línea blanca que rodea el municipio. */
  private mostrarBordeHover(): void {
    const claves = `${this.elegida}|${this.hover}|${[...this.aisladas].join(',')}|${this.modoFoto()}`;
    if (claves === this.bordeClaves) return;
    this.bordeClaves = claves;
    for (const g of this.bordesHover.values()) g.visible = false;
    if (this.modoFoto()) return;
    for (const id of new Set([this.elegida, this.hover, ...this.aisladas])) if (id >= 0) this.bordeDe(id).visible = true;
  }

  private bordeDe(id: number): THREE.Group {
    let g = this.bordesHover.get(id);
    if (!g) {
      const pieza = this.piezas[id], v: number[] = [], linea: number[] = [];
      const ALTO = 140;
      for (const poligono of pieza.geometria) {
        const anillo = poligono[0];
        for (let i = 0; i < anillo.length; i++) {
          const [la, lo] = anillo[i], [lb, lob] = anillo[(i + 1) % anillo.length];
          const ya = this.alturaEn(lo, la), yb = this.alturaEn(lob, lb);
          const ax = this.aX(lo), az = this.aZ(la), bx = this.aX(lob), bz = this.aZ(lb);
          v.push(ax, ya, az, ax, ya + ALTO, az, bx, yb, bz, bx, yb, bz, ax, ya + ALTO, az, bx, yb + ALTO, bz);
          linea.push(ax, ya + ALTO, az, bx, yb + ALTO, bz);
        }
      }
      g = new THREE.Group();
      const m = new THREE.BufferGeometry();
      m.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.add(new THREE.Mesh(m, new THREE.MeshBasicMaterial({ color: pieza.color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })));
      const l = new THREE.BufferGeometry();
      l.setAttribute('position', new THREE.Float32BufferAttribute(linea, 3));
      g.add(new THREE.LineSegments(l, new THREE.LineBasicMaterial({ color: '#ffffff' })));
      g.traverse(o => { o.frustumCulled = false; });
      this.escena.add(g);
      this.bordesHover.set(id, g);
    }
    return g;
  }

  /** Acerca el levantamiento de cada vereda a su meta (hover o elegida) con una suave aceleración. */
  private animarAlzado(): void {
    this.mostrarBordeHover();
    let cambio = false;
    this.piezas.forEach((_, id) => {
      const meta = 0;
      const actual = this.alzado[id];
      if (actual === meta) return;
      const nuevo = Math.abs(meta - actual) < 0.5 ? meta : actual + (meta - actual) * 0.16;
      this.alzado[id] = nuevo;
      this.alzadoGpu[id] = nuevo;
      for (const capa of this.capas) {
        for (const k of capa.porPieza[id]) capa.atributo.setY(k, capa.base[k] + nuevo * capa.peso[k]);
      }
      cambio = true;
      this.normalesPendientes = true;
      this.piezasMovidas.add(id);
    });
    if (cambio) {
      this.sombraSucia = true;
      for (const capa of this.capas) capa.atributo.needsUpdate = true;
    } else if (this.normalesPendientes) {
      this.actualizarNormalesTerreno();
      this.normalesPendientes = false;
    }
  }

  private crearRotulos(): void {
    for (const p of this.piezas) {
      const el = document.createElement('div');
      el.className = p.zona.t === 'CM' ? 'rot cabecera' : 'rot';
      const punto = document.createElement('i');
      punto.style.background = p.color;
      const texto = document.createElement('span');
      texto.textContent = this.nombreLegible(p.zona.n);
      el.append(punto, texto);
      this.contenedorRotulos.nativeElement.appendChild(el);
      p.rotulo = el;
    }
  }

  /** "LOMA DE LOS OCHOA" / "Loma De Los Ochoa" → "Loma de los Ochoa". */
  private nombreLegible(n: string): string {
    const menores = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);
    return n.toLowerCase().split(' ').map((w, i) => (i && menores.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  }

  private actualizarRotulos(): void {
    const w = this.lienzo.nativeElement.clientWidth, h = this.lienzo.nativeElement.clientHeight;
    if (!this.rotulosCambiaron(w, h)) return;
    const ocupados: { x0: number; y0: number; x1: number; y1: number }[] = [];
    this.cajasRotulos = [];
    const v = new THREE.Vector3();
    // vista casi a ras del mapa: los nombres quedarían sobre la pared frontal de la maqueta, así que se ocultan
    const mira = this.miraTmp.copy(this.camara.position).sub(this.controles.target);
    if (Math.acos(mira.y / mira.length()) > ANGULO_OCULTAR_NOMBRES) {
      for (const p of this.piezas) p.rotulo!.style.display = 'none';
      if (this.rotuloRio) this.rotuloRio.style.display = 'none';
      for (const el of this.rotulosRios.values()) el.style.display = 'none';
      return;
    }
    // los rótulos se encogen al alejar la cámara para que quepan todos, y crecen al acercarse
    const dist = this.camara.position.distanceTo(this.controles.target);
    const escala = Math.min(1.25, Math.max(0.58, 1.25 - (dist - 3000) / 22000));
    const orden = this.piezas.map((_, i) => i).sort((a, b) => this.prioridad(b) - this.prioridad(a));
    for (const id of orden) {
      const p = this.piezas[id], el = p.rotulo!;
      const [lat, lon] = p.zona.p;
      v.set(this.aX(lon), this.alturaEn(lon, lat) + this.alzado[id] + 60, this.aZ(lat)).project(this.camara);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const activo = id === this.elegida || id === this.hover;
      // el tamaño de cada rótulo se lee una sola vez: leerlo en cada cuadro, tras cambiar estilos, obliga al navegador a recalcular el diseño
      let medida = this.medidasRotulos[id];
      if (!medida && el.offsetWidth) this.medidasRotulos[id] = medida = { w: el.offsetWidth, h: el.offsetHeight };
      const ancho = (medida?.w || p.zona.n.length * 6) * escala, alto = (medida?.h || 16) * escala;
      // el rótulo queda sobre el punto, con su colita apuntándolo
      const dentro = v.z < 1 && x > 0 && x < w && y > 0 && y < h;
      // si choca con otro rótulo, se prueba desplazarlo un poco hacia arriba o abajo antes de ocultarlo
      let dy = 0, caja = { x0: 0, y0: 0, x1: 0, y1: 0 }, libre = false;
      for (const k of [0, -1, 1, -2, 2]) {
        dy = k * (alto + 2);
        caja = { x0: x - ancho / 2, y0: y - alto - 8 + dy, x1: x + ancho / 2, y1: y - 6 + dy };
        libre = !ocupados.some(o => caja.x0 < o.x1 && caja.x1 > o.x0 && caja.y0 < o.y1 && caja.y1 > o.y0);
        if (libre || activo) break;
      }
      const visible = dentro && (libre || activo);
      el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      if (!medida && el.offsetWidth) this.medidasRotulos[id] = medida = { w: el.offsetWidth, h: el.offsetHeight };
      ocupados.push(caja);
      this.cajasRotulos.push({ id, ...caja });
      el.classList.toggle('activo', activo);
      el.style.transform = `translate(${x - (activo ? el.offsetWidth : medida?.w ?? 0) / 2}px, ${y - (activo ? el.offsetHeight : medida?.h ?? 0) - 8 + dy}px) scale(${escala})`;
    }
    this.actualizarNombresRios(w, h, Math.max(0.9, escala), ocupados);
    this.actualizarRotuloRio(w, h, Math.max(0.9, escala));
    this.actualizarRotuloFabrica(w, h, Math.max(0.9, escala));
    this.actualizarRotuloEquip(w, h, Math.max(0.9, escala));
  }

  /**
   * Con la cámara quieta y sin cambios de selección, los rótulos ya están donde deben: se salta ordenarlos, proyectarlos
   * y reescribir sus estilos. Durante el primer segundo se recalcula siempre, mientras se miden y se completa la escena.
   */
  private rotulosCambiaron(w: number, h: number): boolean {
    const f = this.firmaRotulos, m = this.camara.matrixWorld.elements, p = this.camara.projectionMatrix.elements;
    const estado = [w, h, p[0], p[5], this.elegida, this.hover, this.fabricaHover, this.equipHover, this.servicioHover, this.rioElegido, this.nombresRios() || this.sistemaHidrico() ? 1 : 0];
    let igual = this.cuadrosRotulos++ > 60 && f.length === 16 + estado.length;
    for (let i = 0; i < 16 && igual; i++) if (f[i] !== m[i]) igual = false;
    for (let i = 0; i < estado.length && igual; i++) if (f[16 + i] !== estado[i]) igual = false;
    if (igual) return false;
    for (let i = 0; i < 16; i++) f[i] = m[i];
    estado.forEach((v, i) => f[16 + i] = v);
    return true;
  }

  private actualizarRotuloFabrica(w: number, h: number, escala: number): void {
    const el = this.rotuloFabrica;
    if (!el) return;
    const f = this.fabricaHover >= 0 ? this.fabricas[this.fabricaHover] : null;
    if (!f) { el.style.display = 'none'; return; }
    const v = new THREE.Vector3(f.x, this.alturaXZ(f.x, f.z) + 130, f.z).project(this.camara);
    const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    const visible = v.z < 1 && x > 0 && x < w && y > 0 && y < h;
    el.style.display = visible ? '' : 'none';
    if (visible) el.style.transform = `translate(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight - 8}px) scale(${escala})`;
  }

  /** Con "Nombres de ríos" o "Ríos y quebradas" encendida, cada río con nombre lleva su rótulo (los más largos primero; si chocan, se omite el menor). */
  private actualizarNombresRios(w: number, h: number, escala: number, ocupados: { x0: number; y0: number; x1: number; y1: number }[]): void {
    if (!this.nombresRios() && !this.sistemaHidrico()) { for (const el of this.rotulosRios.values()) el.style.display = 'none'; return; }
    if (!this.rotulosRios.size) {
      for (const rio of this.riosConNombre()) {
        const el = document.createElement('div');
        el.className = 'rot agua';
        el.style.display = 'none';
        const nombre = document.createElement('span');
        nombre.textContent = rio.nombre;
        el.append(document.createElement('i'), nombre);
        this.contenedorRotulos.nativeElement.appendChild(el);
        this.rotulosRios.set(rio.clave, el);
      }
    }
    const v = new THREE.Vector3();
    for (const [clave, el] of this.rotulosRios) {
      const rio = this.rios.get(clave)!;
      if (clave === this.rioElegido) { el.style.display = 'none'; continue; }   // el río elegido ya lleva su propio rótulo
      const [lon, lat] = rio.ancla;
      const px = this.aX(lon), pz = this.aZ(lat);
      if (this.aisladas.size && !this.visibleEnXZ(px, pz)) { el.style.display = 'none'; continue; }
      const id = this.idEn(lon, lat);
      const alza = id >= 0 ? this.alzado[id] * this.pesoBorde(lon, lat, id) : 0;
      v.set(px, this.alturaEn(lon, lat) + alza + 30, pz).project(this.camara);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      if (!(v.z < 1 && x > 0 && x < w && y > 0 && y < h)) { el.style.display = 'none'; continue; }
      let m = this.medidasRios.get(clave);
      if (!m) {
        el.style.display = '';
        if (!el.offsetWidth) { el.style.display = 'none'; continue; }
        this.medidasRios.set(clave, m = { w: el.offsetWidth, h: el.offsetHeight });
      }
      const ancho = m.w * escala, alto = m.h * escala;
      const caja = { x0: x - ancho / 2, y0: y - alto - 8, x1: x + ancho / 2, y1: y - 6 };
      if (ocupados.some(o => caja.x0 < o.x1 && caja.x1 > o.x0 && caja.y0 < o.y1 && caja.y1 > o.y0)) { el.style.display = 'none'; continue; }
      ocupados.push(caja);
      el.style.display = '';
      el.style.transform = `translate(${x - m.w / 2}px, ${y - m.h - 8}px) scale(${escala})`;
    }
  }

  /** Nombre del río elegido: solo ese; los cauces no llevan rótulo mientras nadie los toca. */
  private actualizarRotuloRio(w: number, h: number, escala: number): void {
    const el = this.rotuloRio;
    if (!el) return;
    const rio = this.rioElegido ? this.rios.get(this.rioElegido) : null;
    if (!rio) { el.style.display = 'none'; return; }
    const [lon, lat] = rio.ancla;
    const id = this.idEn(lon, lat);
    const alza = id >= 0 ? this.alzado[id] * this.pesoBorde(lon, lat, id) : 0;
    const v = new THREE.Vector3(this.aX(lon), this.alturaEn(lon, lat) + alza + 30, this.aZ(lat)).project(this.camara);
    const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    const visible = v.z < 1 && x > 0 && x < w && y > 0 && y < h;
    el.style.display = visible ? '' : 'none';
    if (visible) el.style.transform = `translate(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight - 8}px) scale(${escala})`;
  }
  private prioridad(id: number): number {
    return id === this.elegida ? 3 : id === this.hover ? 2 : this.piezas[id].zona.t === 'CM' ? 1 : 0;
  }

  private idBajoCursor(ev: PointerEvent): number {
    if (!this.proxy) return -1;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camara);
    const hit = this.raycaster.intersectObject(this.proxy)[0];
    if (!hit?.uv) return -1;
    const x = Math.floor(hit.uv.x * this.lienzoIds.width), y = Math.floor((1 - hit.uv.y) * this.lienzoIds.height);
    const d = this.ctxIds.getImageData(x, y, 1, 1).data;
    if (d[1] || d[2] || d[0] % SALTO_ID) return this.hover;   // píxel de borde: conserva el anterior
    const id = d[0] / SALTO_ID - 1;
    return id < this.piezas.length ? id : -1;
  }

  /** Zona cuya cápsula de nombre está bajo el cursor (o -1). Los rótulos son HTML sin eventos, así que se buscan en pantalla. */
  private rotuloBajoCursor(ev: PointerEvent): number {
    const r = this.renderer.domElement.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const c = this.cajasRotulos.find(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
    return c ? c.id : -1;
  }

  /** Los pines flotan sobre la escena y no se pueden "tocar" con el rayo: se buscan en pantalla y tienen prioridad sobre lo que haya detrás. */
  private pinBajoCursor(ev: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return this.agrupadorIconos?.bajoCursor(this.camara, ev.clientX - r.left, ev.clientY - r.top, r.width, r.height) ?? null;
  }

  /** Llega fuera de Angular con cada evento del ratón; solo acumula. El hover se resuelve en el bucle, una vez por cuadro. */
  alMover(ev: PointerEvent): void {
    this.ultimaActividad = performance.now();
    if (this.conduciendo()) {                  // al conducir, arrastrar (cualquier botón) mira alrededor del carro
      if (ev.buttons) this.conduccion?.mirar(ev.movementX, ev.movementY);
      return;
    }
    if (ev.buttons & 4) {                      // rueda presionada: gira el mapa en horizontal (los giros se suman, no se descartan)
      this.vuelo = null;
      this.giroPendiente -= ev.movementX * 0.006;
      this.inclinacionPendiente += ev.movementY * 0.006;
      return;
    }
    if (ev.buttons) return;
    this.moverPendiente = ev;
  }

  /** Atiende el último movimiento del cursor dentro de Angular, para que la vista refleje el hover. */
  private atenderMover(): void {
    const ev = this.moverPendiente;
    if (!ev) return;
    this.moverPendiente = null;
    this.zona.run(() => { this.resolverHover(ev); this.actualizarTipRio(ev); });
  }

  /** Veredas por las que pasa un cauce, de la que más recorre a la que menos (se muestrea la línea y se guarda el resultado). */
  private veredasPorDondePasa(rio: Rio): string[] {
    const hecho = this.veredasDeRio.get(rio.clave);
    if (hecho) return hecho;
    const pos = this.aguaPos, cuenta = new Map<string, number>();
    if (pos) {
      for (const t of rio.tramos) {
        const paso = Math.max(1, Math.floor(t.n / 14));
        for (let p = 0; p < t.n; p += paso) {
          const k = 2 * (t.ini + p);
          const x = (pos.getX(k) + pos.getX(k + 1)) / 2, z = (pos.getZ(k) + pos.getZ(k + 1)) / 2;
          const id = this.idEn(this.lon0 + x / this.mLon, this.lat0 - z / this.mLat);
          if (id >= 0) { const n = this.piezas[id].zona.n; cuenta.set(n, (cuenta.get(n) ?? 0) + 1); }
        }
      }
    }
    const lista = [...cuenta].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    this.veredasDeRio.set(rio.clave, lista);
    return lista;
  }

  /** Muestra o esconde el tooltip del cauce bajo el cursor, con los datos que se recogieron de él. */
  private actualizarTipRio(ev: PointerEvent): void {
    const rio = this.rioHover ? this.rios.get(this.rioHover) : null;
    if (!rio || this.conduciendo()) { if (this.tipRio()) this.tipRio.set(null); return; }
    const caja = this.lienzo.nativeElement.getBoundingClientRect();
    const x = ev.clientX - caja.left, y = ev.clientY - caja.top;
    const previo = this.tipRio();
    if (previo && previo.nombre === rio.nombre && Math.abs(previo.x - x) < 2 && Math.abs(previo.y - y) < 2) return;
    const sinNombre = rio.nombre === 'Cauce sin nombre registrado';
    const veredas = this.veredasPorDondePasa(rio);
    const filas = [
      { k: 'Ancho', v: `≈ ${Math.round(rio.ancho)} m` },
      { k: 'Longitud en el mapa', v: `${(rio.largo / 1000).toFixed(1)} km` },
      { k: 'Pasa por', v: veredas.length ? veredas.slice(0, 3).join(', ') + (veredas.length > 3 ? ` y ${veredas.length - 3} más` : '') : '—' },
      { k: 'Fuente', v: rio.igac ? 'IGAC 1:100.000' : 'OpenStreetMap' },
    ];
    const nota = /medell/i.test(rio.nombre)
      ? 'Río principal del valle de Aburrá. Su color cambia junto a las industrias cercanas que vierten sobre él.'
      : rio.derivado ? 'El nombre se dedujo de la red de drenaje (afluente de otro cauce); no es un nombre oficial.'
      : sinNombre ? 'La fuente no registra un nombre para este cauce.' : 'Haz clic para seleccionarlo y ver su detalle completo.';
    this.tipRio.set({ x, y, izq: x > caja.width - 290, arriba: y > caja.height - 190, nombre: rio.nombre,
      tipo: /^r[ií]o/i.test(rio.nombre) ? 'Río' : /^(quebrada|arroyo|ca[ñn]o|zanj)/i.test(rio.nombre) ? 'Quebrada' : rio.ancho >= 10 ? 'Río' : 'Quebrada', filas, nota });
  }

  private resolverHover(ev: PointerEvent): void {
    const pin = this.pinBajoCursor(ev);
    if (pin) {                                           // un pin tapa todo lo que tenga detrás (ríos, veredas, edificios)
      const ref = pin.icono?.ref;
      const fab = ref?.tipo === 'fabrica' ? ref.i : -1, eq = ref?.tipo === 'equip' ? ref.i : -1;
      if (fab !== this.fabricaHover) this.marcarFabricaHover(fab);
      if (eq !== this.equipHover) this.marcarEquipHover(eq);
      const sv = ref?.tipo === 'servicio' ? ref.i : -1;
      if (sv !== this.servicioHover) this.marcarServicioHover(sv);
      if (this.hover !== -1) { this.hover = -1; this.pintarResalte(); }
      if (this.rioHover) { this.rioHover = null; this.pintarHalos(); }
      this.lienzo.nativeElement.style.cursor = 'pointer';
      return;
    }
    if (this.servicioHover >= 0) this.marcarServicioHover(-1);
    const rot = this.rotuloBajoCursor(ev);
    if (rot >= 0) {                                      // la cápsula de una zona tapa ríos y edificios que tenga detrás
      if (this.fabricaHover >= 0) this.marcarFabricaHover(-1);
      if (this.equipHover >= 0) this.marcarEquipHover(-1);
      if (this.rioHover) { this.rioHover = null; this.pintarHalos(); }
      if (rot !== this.hover) { this.hover = rot; this.pintarResalte(); }
      this.lienzo.nativeElement.style.cursor = 'pointer';
      return;
    }
    // las fábricas van primero: son pequeñas y están sobre las veredas y los cauces
    const ahora = performance.now();
    if (ahora - this.tFabricaHover > 40) {
      this.tFabricaHover = ahora;
      const fab = this.fabricaBajoCursor(ev);
      if (fab !== this.fabricaHover) this.marcarFabricaHover(fab);
    }
    if (this.fabricaHover >= 0) {
      if (this.hover !== -1) { this.hover = -1; this.pintarResalte(); }
      if (this.rioHover) { this.rioHover = null; this.pintarHalos(); }
      this.lienzo.nativeElement.style.cursor = 'pointer';
      return;
    }
    if (ahora - this.tEquipHover > 40) {
      this.tEquipHover = ahora;
      const eq = this.equipBajoCursor(ev);
      if (eq !== this.equipHover) this.marcarEquipHover(eq);
    }
    if (this.equipHover >= 0) {
      if (this.hover !== -1) { this.hover = -1; this.pintarResalte(); }
      if (this.rioHover) { this.rioHover = null; this.pintarHalos(); }
      this.lienzo.nativeElement.style.cursor = 'pointer';
      return;
    }
    // tuberías y líneas eléctricas, antes que los cauces y las veredas
    if (ahora - this.tRedHover > 40) {
      this.tRedHover = ahora;
      const red = this.redBajoCursor(ev);
      if (red !== this.redHover) { this.redHover = red; this.pintarHalosRed(); }
    }
    if (this.redHover) {
      if (this.hover !== -1) { this.hover = -1; this.pintarResalte(); }
      if (this.rioHover) { this.rioHover = null; this.pintarHalos(); }
      this.lienzo.nativeElement.style.cursor = 'pointer';
      return;
    }
    // los cauces tienen prioridad sobre la vereda que los rodea
    const rio = this.rioBajoCursor(ev);
    if (rio !== this.rioHover) { this.rioHover = rio; this.pintarHalos(); }
    if (rio) {
      if (this.hover !== -1) { this.hover = -1; this.pintarResalte(); }
      this.lienzo.nativeElement.style.cursor = 'pointer';
      return;
    }
    let id = this.idBajoCursor(ev);
    if (this.aisladas.size && !this.aisladas.has(id)) id = -1;
    if (id !== this.hover) { this.hover = id; this.pintarResalte(); }
    this.lienzo.nativeElement.style.cursor = id >= 0 ? 'pointer' : 'grab';
  }

  alSalir(): void {
    this.moverPendiente = null;                          // un movimiento atrasado no debe volver a encender el hover
    this.marcarServicioHover(-1);
    this.marcarFabricaHover(-1);
    this.marcarEquipHover(-1);
    this.hover = -1;
    this.rioHover = null;
    this.tipRio.set(null);
    if (this.redHover) { this.redHover = null; this.pintarHalosRed(); }
    this.pintarHalos();
    this.pintarResalte();
  }

  /** Evita el autodesplazamiento de la página al pulsar la rueda del ratón. */
  alRatonAbajo(ev: MouseEvent): void {
    if (ev.button === 1) ev.preventDefault();
  }

  alPulsar(ev: PointerEvent): void {
    this.pulsado = { x: ev.clientX, y: ev.clientY };
    this.vuelo = null;                                   // si el usuario toma el mapa, se cancela el vuelo
    this.lienzo.nativeElement.style.cursor = 'grabbing';
  }

  alSoltar(ev: PointerEvent): void {
    const p = this.pulsado;
    this.pulsado = null;
    this.lienzo.nativeElement.style.cursor = 'grab';
    if (!p || Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 5) return;
    if (this.eligiendoSalida()) {                        // eligiendo dónde conducir: el clic solo marca la salida
      const s = this.sueloBajoCursor(ev);
      if (s) { this.cancelarSalida(); this.empezarAConducir(s); }
      return;
    }
    // el segundo clic de un doble clic en una zona va primero: tras el primero la cámara vuela y lo que quede bajo el
    // cursor (un río, un pin) ya no es la zona
    const doble = this.zonaDobleClic(ev);
    if (doble >= 0) { this.alternarAislada(doble); return; }
    const pin = this.pinBajoCursor(ev);
    if (pin?.grupo) {                                    // clic en un grupo: la cámara se acerca para separarlo
      const objetivo = new THREE.Vector3(pin.x, this.alturaXZ(pin.x, pin.z) + 10, pin.z);
      const dir = this.camara.position.clone().sub(this.controles.target).normalize();
      const dist = Math.max(450, this.camara.position.distanceTo(objetivo) * 0.45);
      this.volarA(objetivo.clone().add(dir.multiplyScalar(dist)), objetivo);
      return;
    }
    if (pin?.icono?.ref) {                               // clic en un pin: se abre su panel y la cámara se acerca
      const ref = pin.icono.ref;
      this.abrirPin(ref);
      const q = this.posRef(ref);
      const objetivo = new THREE.Vector3(q.x, this.alturaXZ(q.x, q.z) + 10, q.z);
      this.volarA(objetivo.clone().add(this.camara.position.clone().sub(this.controles.target).normalize().multiplyScalar(ref.tipo === 'fabrica' ? 1200 : ref.tipo === 'servicio' ? 350 : 450)), objetivo);
      return;
    }
    const rot = this.rotuloBajoCursor(ev);
    if (rot >= 0) {                                      // clic en la cápsula de una zona: manda sobre lo que haya detrás
      this.seleccionarFabrica(-1);
      this.anotarClic(ev, rot);                          // por si llega el segundo clic de un doble clic
      // con zonas aisladas, un clic en la cápsula de una zona desvanecida espera al segundo clic
      if (this.aisladas.size && !this.aisladas.has(rot)) return;
      if (rot === this.elegida) { this.deseleccionar(); this.seleccionarRio(null); } else this.elegir(rot);
      return;
    }
    // clic en el edificio (no en su pin): abre el mismo panel y acerca la cámara
    const fab = this.fabricaBajoCursor(ev);
    if (fab >= 0) { this.irAPin({ tipo: 'fabrica', i: fab }); return; }
    const eq = this.equipBajoCursor(ev);
    if (eq >= 0) { this.irAPin({ tipo: 'equip', i: eq }); return; }
    const red = this.redBajoCursor(ev);
    if (red) {                                           // clic en una tubería o línea eléctrica: la elige; otro clic en la misma, la suelta
      this.seleccionarRed(red === this.redElegida ? null : red);
      return;
    }
    const rio = this.rioBajoCursor(ev);
    if (rio) {                                           // clic en un cauce: lo elige; otro clic en el mismo, lo suelta
      this.seleccionarRio(rio === this.rioElegido ? null : rio);
      return;
    }
    this.seleccionarFabrica(-1);
    this.soltarRed();
    const id = this.idBajoCursor(ev);
    this.anotarClic(ev, id);
    if (this.aisladas.size && !this.aisladas.has(id)) return;   // con zonas aisladas, lo desvanecido solo responde al doble clic
    // un clic en la zona ya elegida, o fuera de toda zona, la deselecciona y la baja
    if (id < 0 || id === this.elegida) {
      this.deseleccionar();
      this.seleccionarRio(null);
    } else {
      this.elegir(id);
    }
  }

  // ── Aislar zonas con doble clic (en su cápsula o en el terreno) ─────────────────────────────────────
  // Con alguna zona aislada, el resto del mapa se desvanece: el terreno, las vías y los cauces quedan como un velo claro, y
  // los edificios, árboles y demás piezas repetidas de afuera ni se dibujan (alivia la GPU). Las
  // cápsulas de todas las zonas siguen a la vista: doble clic en otra la suma, doble clic en una aislada la quita. La
  // máscara se evalúa en la GPU con el mismo croquis de identificadores que usa el cursor, así que no hay que tocar cada
  // capa por separado.
  private readonly aisladas = new Set<number>();
  private ultimoClic = { id: -1, t: 0, x: 0, y: 0 };

  /**
   * Si este clic completa un doble clic sobre una zona, devuelve la zona del primero (su cápsula pudo moverse entre
   * ambos, porque el primer clic elige la zona y la cámara vuela hacia ella); si no, devuelve -1.
   */
  private zonaDobleClic(ev: PointerEvent): number {
    const u = this.ultimoClic;
    this.ultimoClic = { id: -1, t: 0, x: 0, y: 0 };
    return u.id >= 0 && performance.now() - u.t < 500 && Math.hypot(ev.clientX - u.x, ev.clientY - u.y) < 14 ? u.id : -1;
  }

  /** Anota un clic sobre una zona (su cápsula o su terreno) para reconocer el doble clic. */
  private anotarClic(ev: PointerEvent, id: number): void {
    this.ultimoClic = { id, t: performance.now(), x: ev.clientX, y: ev.clientY };
  }
  private readonly uMascara = { uMasc: { value: null as THREE.Texture | null }, uMascCaja: { value: new THREE.Vector4() }, uMascOn: { value: 0 } };
  private readonly parcheados = new WeakSet<THREE.Material>();
  private teselas: { malla: THREE.Mesh; i0: number; i1: number; j0: number; j1: number }[] = [];

  /** ¿Lo que está en (x, z) del modelo se ve? Siempre, salvo que esté en una zona oculta por el aislamiento. */
  private visibleEnXZ(x: number, z: number): boolean {
    return !this.aisladas.size || this.aisladas.has(this.idEn(this.lon0 + x / this.mLon, this.lat0 - z / this.mLat));
  }

  private alternarAislada(id: number): void {
    if (this.aisladas.has(id)) {
      this.aisladas.delete(id);
      if (id === this.elegida) {
        const otra = this.aisladas.values().next().value;
        if (otra === undefined) { this.elegida = -1; this.seleccion.set(null); }
        else { this.elegida = otra; this.seleccion.set(this.piezas[otra].zona); }
      }
    } else {
      this.aisladas.add(id);
    }
    this.aplicarAislamiento();
    this.pintarResalte();
  }

  private aplicarAislamiento(): void {
    const activo = this.aisladas.size > 0;
    if (activo) this.prepararMascara();
    this.uMascara.uMascOn.value = activo ? 1 : 0;
    // la neblina de las cañadas no pasa por la máscara: sobre la bruma clara se vería como manchas grises
    for (const n of this.nieblas) n.sprite.visible = !activo;
    this.descartarFuera(activo);
    this.bordeClaves = '';
    this.sombraSucia = true;
  }

  /** Capa de la cámara que nunca se dibuja: ahí van los objetos que caen enteros fuera de las zonas aisladas. */
  private static readonly CAPA_FUERA = 5;
  private readonly descartados = new Set<THREE.Object3D>();
  private readonly zonasDeObjeto = new WeakMap<THREE.Object3D, Set<number>>();

  /**
   * Lo que cae entero fuera de las zonas aisladas (teselas de árboles, edificios, cercas, fachadas…) se pasa a una capa
   * que la cámara no ve: ni se envía a la GPU, ni proyecta sombra, ni se puede tocar con el cursor. Lo que cruza una zona
   * aislada se queda y la máscara del sombreado lava su parte de afuera. El terreno sigue como velo, y lo que se mueve
   * por todo el mapa (tráfico, gente, avión, pájaros, nubes) no se toca porque su caja de hoy no vale mañana.
   */
  private descartarFuera(activo: boolean): void {
    for (const o of this.descartados) o.layers.set(0);
    this.descartados.clear();
    if (!activo) return;
    const fijos = new Set<THREE.Object3D>();
    const todo = (o: THREE.Object3D | null | undefined) => o?.traverse(c => { fijos.add(c); });
    for (const t of this.teselas) fijos.add(t.malla);
    for (const m of this.flota.flat()) fijos.add(m);
    for (const m of this.mallasGente) if (m) fijos.add(m);
    for (const p of this.pajaros) todo(p.grupo);
    todo(this.avion?.grupo);
    todo(this.grupoBarrios);
    // nubes y disco solar cruzan todo el mapa; la neblina ya se apaga aparte. El humo de las chimeneas sí se descarta
    for (const nube of this.nubes) for (const b of nube.bocanadas) fijos.add(b.sprite);
    for (const n of this.nieblas) fijos.add(n.sprite);
    if (this.disco) fijos.add(this.disco);
    const caja = new THREE.Box3();
    this.escena.updateMatrixWorld();
    this.escena.traverse(o => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!g || fijos.has(o) || o.userData['sinMascara'] || !o.layers.isEnabled(0)) return;
      let zonas = this.zonasDeObjeto.get(o);
      if (!zonas) {
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh) {
          if (!im.count) return;
          im.computeBoundingBox();
          caja.copy(im.boundingBox!);
        } else {
          if (!g.boundingBox) g.computeBoundingBox();
          caja.copy(g.boundingBox!);
        }
        zonas = this.zonasEnCaja(caja.applyMatrix4(o.matrixWorld));
        this.zonasDeObjeto.set(o, zonas);
      }
      for (const z of zonas) if (this.aisladas.has(z)) return;
      o.layers.set(Mapa3dComponent.CAPA_FUERA);
      this.descartados.add(o);
    });
  }

  /** Zonas que toca una caja del modelo, leídas en el croquis de identificadores (a lo sumo unas 40 mil celdas). */
  private zonasEnCaja(caja: THREE.Box3): Set<number> {
    const [o, s, e, n] = this.relieve.bbox;
    const W = this.lienzoIds.width, H = this.lienzoIds.height;
    const px = (x: number) => (this.lon0 + x / this.mLon - o) / (e - o) * W;
    const py = (z: number) => (n - (this.lat0 - z / this.mLat)) / (n - s) * H;
    const x0 = Math.max(0, Math.floor(px(caja.min.x))), x1 = Math.min(W - 1, Math.ceil(px(caja.max.x)));
    const y0 = Math.max(0, Math.floor(py(caja.min.z))), y1 = Math.min(H - 1, Math.ceil(py(caja.max.z)));
    const zonas = new Set<number>();
    if (x1 < x0 || y1 < y0) return zonas;
    const paso = Math.max(1, Math.floor(Math.sqrt((x1 - x0 + 1) * (y1 - y0 + 1) / 40000)));
    for (let y = y0; y <= y1; y += paso) {
      for (let x = x0; x <= x1; x += paso) {
        const id = this.mapaIds[y * W + x] - 1;
        if (id >= 0) zonas.add(id);
      }
    }
    return zonas;
  }

  /** Textura de una banda con 255 donde hay una zona aislada (mismas filas que el croquis de identificadores) y parche de los materiales. */
  private prepararMascara(): void {
    const W = this.lienzoIds.width, H = this.lienzoIds.height;
    const tabla = new Uint8Array(257);
    for (const id of this.aisladas) tabla[id + 1] = 255;
    let tex = this.uMascara.uMasc.value as THREE.DataTexture | null;
    const datos = tex ? (tex.image.data as Uint8Array) : new Uint8Array(W * H);
    for (let q = 0; q < W * H; q++) datos[q] = tabla[this.mapaIds[q]];
    if (!tex) {
      tex = new THREE.DataTexture(datos, W, H, THREE.RedFormat, THREE.UnsignedByteType);
      tex.minFilter = tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.unpackAlignment = 1;
      this.uMascara.uMasc.value = tex;
    }
    tex.needsUpdate = true;
    this.uMascara.uMascCaja.value.set(-this.ancho / 2, -this.alto / 2, this.ancho, this.alto);
    // lo que marca (halos, anillos, muros de borde) se dibuja siempre
    for (const o of [this.anilloHover, this.anilloFabrica, this.haloHover, this.haloElegido, this.haloSistema, this.haloRed]) o?.traverse(c => { c.userData['sinMascara'] = true; });
    for (const g of this.bordesHover.values()) g.traverse(c => { c.userData['sinMascara'] = true; });
    this.escena.traverse(o => {
      if (o.userData['sinMascara'] || !(o instanceof THREE.Mesh || o instanceof THREE.Line)) return;
      const m = o.material as THREE.Material | THREE.Material[];
      for (const mat of Array.isArray(m) ? m : [m]) this.parchearMaterial(mat);
    });
  }

  /** Añade a un material (conservando su propio onBeforeCompile) el descarte por zona: por instancia en las mallas instanciadas, por fragmento en el resto. */
  private parchearMaterial(m: THREE.Material): void {
    if (this.parcheados.has(m)) return;
    this.parcheados.add(m);
    const tipo = m as unknown as { isShaderMaterial?: boolean; isSpriteMaterial?: boolean; isPointsMaterial?: boolean };
    if (tipo.isShaderMaterial || tipo.isSpriteMaterial || tipo.isPointsMaterial) return;
    const previo = m.onBeforeCompile, clavePrevia = m.customProgramCacheKey();
    const decl = `uniform sampler2D uMasc; uniform vec4 uMascCaja; uniform float uMascOn; varying vec3 vMascW;
      float mascaraEn(vec3 w) { return texture2D(uMasc, clamp((w.xz - uMascCaja.xy) / uMascCaja.zw, 0.0, 1.0)).r; }`;
    m.onBeforeCompile = (sh, r) => {
      previo.call(m, sh, r);
      // el material puede haber reescrito project_vertex (los árboles): entonces se ancla en la línea que fija gl_Position
      const ancla = sh.vertexShader.includes('#include <project_vertex>') ? '#include <project_vertex>' : 'gl_Position = projectionMatrix * mvPosition;';
      if (!sh.vertexShader.includes(ancla) || !sh.fragmentShader.includes('void main() {')) return;
      sh.uniforms['uMasc'] = this.uMascara.uMasc;
      sh.uniforms['uMascCaja'] = this.uMascara.uMascCaja;
      sh.uniforms['uMascOn'] = this.uMascara.uMascOn;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${decl}`)
        .replace(ancla, `${ancla}
          #ifdef USE_INSTANCING
            vMascW = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;   // la pieza entera según su centro
            // edificios, árboles y demás piezas repetidas de las zonas excluidas no se dibujan: es lo que más pesa en la GPU
            if (uMascOn > 0.5 && mascaraEn(vMascW) < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          #else
            vMascW = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${decl}`);
      // fuera de las zonas aisladas el terreno, las vías y los cauces se lavan hacia una bruma clara: queda un velo muy tenue del contexto
      const lavar = `if (uMascOn > 0.5 && mascaraEn(vMascW) < 0.5) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.93, 0.95, 0.97), 0.9);`;
      sh.fragmentShader = sh.fragmentShader.includes('#include <dithering_fragment>')
        ? sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${lavar}`)
        : sh.fragmentShader.replace('void main() {', 'void main() {\nif (uMascOn > 0.5 && mascaraEn(vMascW) < 0.5) discard;');
    };
    m.customProgramCacheKey = () => `${clavePrevia}|mascara3`;
    m.needsUpdate = true;
  }

  private deseleccionar(): void {
    if (this.elegida < 0) return;
    this.elegida = -1;
    this.seleccion.set(null);
    this.pintarResalte();
  }

  private elegir(id: number): void {
    this.soltarRed();
    this.seleccionarFabrica(-1, false);
    this.seleccionarRio(null, false);
    this.elegida = id;
    this.seleccion.set(this.piezas[id].zona);
    this.pintarResalte();
    const [lat, lon] = this.piezas[id].zona.p;
    const objetivo = new THREE.Vector3(this.aX(lon), this.alturaEn(lon, lat), this.aZ(lat));
    const dir = this.camara.position.clone().sub(this.controles.target).normalize();
    this.volarA(objetivo.clone().add(dir.multiplyScalar(5200)), objetivo);
  }

  /** Fábrica bajo el cursor (índice) o -1: se lanza un rayo contra la malla de industrias y se ubica el vértice golpeado. */
  private fabricaBajoCursor(ev: PointerEvent): number {
    const malla = this.mallaIndustrias;
    if (!malla) return -1;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camara);
    const hit = this.raycaster.intersectObject(malla)[0];
    if (!hit || hit.faceIndex == null) return -1;
    const v = hit.faceIndex * 3;
    let i = this.inicioFabrica.length - 1;
    while (i > 0 && this.inicioFabrica[i] > v) i--;
    const f = this.fabricas[i];
    return f && !this.visibleEnXZ(f.x, f.z) ? -1 : i;
  }

  /** Equipamiento bajo el cursor (índice) o -1, igual que con las fábricas. */
  private equipBajoCursor(ev: PointerEvent): number {
    const malla = this.mallaEquip;
    if (!malla) return -1;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camara);
    const hit = this.raycaster.intersectObject(malla)[0];
    if (!hit || hit.faceIndex == null) return -1;
    const v = hit.faceIndex * 3;
    let i = this.inicioEquip.length - 1;
    while (i > 0 && this.inicioEquip[i] > v) i--;
    // edificio compartido (Comfama): se abre la parte del piso tocado; si ninguna lo cubre, la de icono más cercano
    const sitio = this.equipamientos[i]?.sitio;
    if (sitio) {
      let d = Infinity;
      this.equipamientos.forEach((e, k) => {
        if (e.sitio !== sitio || !e.pin) return;
        const h = hit.point.y - (e.pin.base ?? hit.point.y), enPiso = e.pin.nivel && h >= e.pin.nivel[0] && h < e.pin.nivel[1];
        const dk = Math.hypot(e.pin.x - hit.point.x, e.pin.z - hit.point.z) - (enPiso ? 1e4 : 0);
        if (dk < d) { d = dk; i = k; }
      });
    }
    const q = this.equipamientos[i];
    return q && !this.visibleEnXZ(q.x, q.z) ? -1 : i;
  }

  /** Cápsula con el nombre del lugar y el color de su categoría sobre el equipamiento señalado. */
  private marcarEquipHover(i: number): void {
    this.equipHover = i;
    this.auraEquip?.resaltar(i);
    if (i < 0) {
      if (this.rotuloEquip) this.rotuloEquip.style.display = 'none';
      return;
    }
    if (!this.rotuloEquip) {
      this.rotuloEquip = document.createElement('div');
      this.rotuloEquip.className = 'rot fabrica';
      this.rotuloEquip.append(document.createElement('i'), document.createElement('span'));
      this.contenedorRotulos.nativeElement.appendChild(this.rotuloEquip);
    }
    const p = this.equipamientos[i].datos.p;
    (this.rotuloEquip.firstElementChild as HTMLElement).style.background = CATEGORIA.get(p.c)?.color ?? '';
    this.rotuloEquip.lastElementChild!.textContent = p.n;
    this.rotuloEquip.style.display = '';
  }

  private actualizarRotuloEquip(w: number, h: number, escala: number): void {
    const el = this.rotuloEquip;
    const q = this.equipHover >= 0 ? this.equipamientos[this.equipHover] : null;
    const sv = this.servicioHover >= 0 ? this.servicios[this.servicioHover] : null;
    if (!el) return;
    if (!q && !sv) { el.style.display = 'none'; return; }
    const v = (q ? new THREE.Vector3(q.x, this.alturaXZ(q.x, q.z) + q.r * 0.9, q.z) : sv!.pts[0].clone().add(new THREE.Vector3(0, sv!.pin!.alto, 0))).project(this.camara);
    const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    const visible = v.z < 1 && x > 0 && x < w && y > 0 && y < h;
    el.style.display = visible ? '' : 'none';
    if (visible) el.style.transform = `translate(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight - 8}px) scale(${escala})`;
  }

  /** Marca la fábrica bajo el cursor: anillo claro a su alrededor y una cápsula con el nombre de la empresa. */
  private marcarFabricaHover(i: number): void {
    this.fabricaHover = i;
    this.auraIndustrias?.resaltar(i);
    if (this.anilloHover) this.anilloHover.visible = false;
    if (i < 0) {
      if (this.rotuloFabrica) this.rotuloFabrica.style.display = 'none';
      return;
    }
    if (!this.anilloHover) {
      this.anilloHover = new THREE.Mesh(
        new THREE.RingGeometry(RADIO_FABRICA - 3, RADIO_FABRICA, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.anilloHover.renderOrder = 11;
      this.escena.add(this.anilloHover);
    }
    const f = this.fabricas[i];
    this.anilloHover.position.set(f.x, this.alturaXZ(f.x, f.z) + 5, f.z);
    this.anilloHover.scale.setScalar(f.esc);
    this.anilloHover.visible = true;
    if (!this.rotuloFabrica) {
      this.rotuloFabrica = document.createElement('div');
      this.rotuloFabrica.className = 'rot fabrica';
      this.rotuloFabrica.append(document.createElement('i'), document.createElement('span'));
      this.contenedorRotulos.nativeElement.appendChild(this.rotuloFabrica);
    }
    (this.rotuloFabrica.firstElementChild as HTMLElement).style.background = COLOR_INDUSTRIA;
    this.rotuloFabrica.lastElementChild!.textContent = f.datos.n;
    this.rotuloFabrica.style.display = '';
  }

  /** Elige (o suelta, con -1) una fábrica: muestra su ficha, la marca con un anillo y, si `volar`, encuadra la cámara. */
  private seleccionarFabrica(i: number, volar = true): void {
    this.fabricaElegida = i;
    if (this.anilloFabrica) this.anilloFabrica.visible = false;
    if (i < 0) { this.fabricaSeleccion.set(null); return; }
    this.deseleccionar();
    this.soltarRed();
    this.rioElegido = null;
    this.rioSeleccion.set(null);
    this.pintarHalos();
    const f = this.fabricas[i], d = f.datos;
    const num = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)).replace('.', ',');
    const lista = (a?: string[]) => (a?.length ? a.join(', ') : '');
    const emisiones = CONTAMINANTES.filter(([k]) => d.em?.[k]).map(([k, n]) => ({ k: n, v: `${num(d.em![k])} Mg/año` }));
    const flujos = Object.entries(d.kgh ?? {}).map(([k, v]) => `${k} ${num(v)} kg/h`).join(' · ');
    this.fabricaSeleccion.set({
      nombre: d.n,
      sector: SECTORES[d.c] ?? d.c,
      direccion: (d.dir ?? '').replace(/\s+/g, ' ').trim(),
      resumen: `${d.fuentes ?? 0} fuente${d.fuentes === 1 ? '' : 's'} fija${d.fuentes === 1 ? '' : 's'}${d.chimenea ? ` · chimenea hasta ${num(d.chimenea)} m` : ''}`,
      combustibles: lista(d.combustibles) || 'sin dato',
      control: lista(d.control) || 'sin sistema de control reportado',
      emisiones, flujos,
    });
    if (!this.anilloFabrica) {
      this.anilloFabrica = new THREE.Mesh(
        new THREE.RingGeometry(RADIO_FABRICA - 4, RADIO_FABRICA, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ffb81f', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.anilloFabrica.renderOrder = 12;
      this.escena.add(this.anilloFabrica);
    }
    this.anilloFabrica.position.set(f.x, this.alturaXZ(f.x, f.z) + 6, f.z);
    this.anilloFabrica.scale.setScalar(f.esc);
    this.anilloFabrica.visible = true;
    if (volar) {
      const objetivo = new THREE.Vector3(f.x, this.alturaXZ(f.x, f.z) + 40, f.z);
      this.volarA(objetivo.clone().add(this.camara.position.clone().sub(this.controles.target).normalize().multiplyScalar(1900)), objetivo);
    }
  }

  /** Al volver del mapa 2D (?punto=…&lat=…&lng=…) se abre el panel de ese punto y la cámara se acerca a él. */
  private abrirPuntoDeLaRuta(): void {
    const q = this.ruta.snapshot.queryParamMap, nombre = q.get('punto');
    if (!nombre) return;
    // el punto se abre una sola vez: la dirección queda limpia para que recargar la página muestre la vista normal
    this.enrutador.navigate([], { queryParams: {}, replaceUrl: true });
    const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
    let mejor = -1, dMejor = Infinity;
    this.equipamientos.forEach((e, i) => {
      if (e.n !== nombre) return;
      const d = Math.hypot(((e.datos.p.lat ?? e.lat) - lat) * this.mLat, ((e.datos.p.lng ?? e.lon) - lng) * this.mLon);
      if (d < dMejor) { dMejor = d; mejor = i; }
    });
    if (mejor < 0) return;
    this.abrirPin({ tipo: 'equip', i: mejor });
    const e = this.equipamientos[mejor];
    const objetivo = new THREE.Vector3(e.x, this.alturaXZ(e.x, e.z) + 10, e.z);
    this.volarA(objetivo.clone().add(this.camara.position.clone().sub(this.controles.target).normalize().multiplyScalar(450)), objetivo);
  }

  private infraPorZona = new Map<number, InfraZona>();

  /** Equipamientos e industrias cuya coordenada original cae dentro de la zona `id`, por categoría. */
  private infraDe(id: number): InfraZona {
    const guardada = this.infraPorZona.get(id);
    if (guardada) return guardada;
    const grupos = new Map<string, InfraZona['grupos'][number]>();
    const poner = (clave: string, nombre: string, color: string, glifo: string, n: string, ref: RefPin) => {
      const g = grupos.get(clave) ?? grupos.set(clave, { id: clave, nombre, color, glifo, items: [] }).get(clave)!;
      g.items.push({ n, ref });
    };
    this.equipamientos.forEach((e, i) => {
      const p = e.datos.p;
      if (this.idEn(p.lng ?? e.lon, p.lat ?? e.lat) !== id) return;
      const cat = CATEGORIA.get(p.c);
      poner(p.c, cat?.nombre ?? p.c, cat?.color ?? '#64748b', GLIFO[p.c], p.n, { tipo: 'equip', i });
    });
    this.fabricas.forEach((f, i) => {
      if (this.idEn(f.datos.lon, f.datos.lat) === id) poner('industria', 'Industrias', COLOR_INDUSTRIA, GLIFO.industria, f.n, { tipo: 'fabrica', i });
    });
    this.servicios.forEach((e, i) => {
      const c = e.pts[0];
      if (this.idEn(this.lon0 + c.x / this.mLon, this.lat0 - c.z / this.mLat) !== id) return;
      const info = SERVICIOS.find(x => x.id === e.pin!.cat)!;
      poner(info.id, info.nombre, info.color, info.glifo, e.nombre, { tipo: 'servicio', i });
    });
    const lista = [...grupos.values()].sort((a, b) => b.items.length - a.items.length || a.nombre.localeCompare(b.nombre, 'es'));
    lista.forEach(g => g.items.sort((a, b) => a.n.localeCompare(b.n, 'es')));
    const infra = { total: lista.reduce((t, g) => t + g.items.length, 0), grupos: lista };
    this.infraPorZona.set(id, infra);
    return infra;
  }

  /** Abre el panel de un pin desde la lista de la zona y acerca la cámara a él. */
  irAPin(ref: RefPin): void {
    this.abrirPin(ref);
    const q = this.posRef(ref);
    const objetivo = new THREE.Vector3(q.x, this.alturaXZ(q.x, q.z) + 10, q.z);
    this.volarA(objetivo.clone().add(this.camara.position.clone().sub(this.controles.target).normalize().multiplyScalar(ref.tipo === 'fabrica' ? 1200 : ref.tipo === 'servicio' ? 350 : 450)), objetivo);
  }

  cerrarZona(): void { this.deseleccionar(); }

  /** Indicadores del plan cuyo informe de seguimiento nombra esta zona (ver scripts/plan_desarrollo/zonas_indicadores.py). */
  proyectosDe(z: Zona): ProyectoZona[] {
    return this.zonasPlan?.zonas[z.n] ?? [];
  }

  /** Población y viviendas de una vereda en todos los años del estudio; null si la zona no tiene datos. */
  proyeccion(z: Zona): ProyeccionVereda | null {
    const anio = this.anio(), vista = this.anioVista() ?? anio;
    const ze = this.edad && (z.t === 'VE' || z.t === 'CM') ? this.zonaEdad(z.n, z.t === 'CM' ? 'cabecera' : 'vereda') : undefined;
    if (ze) return this.proyeccionEdad(z, ze, anio, vista);
    const datos = this.poblacion;
    if (!datos || z.t !== 'VE') return null;
    const norma = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const f = datos.features.find(x => norma(x.properties.nombre) === norma(z.n));
    if (!f) return null;
    const p = f.properties, base = Number(p['pob2018']);
    if (!(base > 0)) return null;
    const serie = ANIOS_POBLACION.map(anio => ({ anio, pob: Number(p[`pob${anio}`]) })).filter(a => Number.isFinite(a.pob));
    const maximo = Math.max(...serie.map(a => a.pob));
    const primero = serie[0], ultimo = serie[serie.length - 1];
    const cambio = (ultimo.pob - primero.pob) / primero.pob * 100;
    const pct = `${cambio >= 0 ? '+' : '−'}${Math.abs(cambio).toFixed(1).replace('.', ',')} %`;
    return {
      nombre: z.n, tipo: this.tipoDe(z),
      anios: serie.map(a => ({
        ...a, viv: Math.round(p.viv2018 * a.pob / base), alto: maximo > 0 ? Math.max(4, a.pob / maximo * 78) : 4, actual: a.anio === this.anio(),
        extrapolado: false,
      })),
      variacion: `Variación ${primero.anio}–${ultimo.anio}: ${pct} (${ultimo.pob - primero.pob >= 0 ? '+' : '−'}${Math.abs(ultimo.pob - primero.pob).toLocaleString('es-CO')} personas)`,
      fuente: datos.metadata?.fuente ?? 'DANE, Censo 2018 y proyecciones',
      infra: this.infraDe(this.piezas.findIndex(q => q.zona === z)),
      piramide: null, rango: null,
    };
  }

  /** Ficha de una vereda o de la cabecera con la proyección por sexo y edad. */
  private proyeccionEdad(z: Zona, ze: PoblacionEdad['zonas'][number], anio: number, vista: number): ProyeccionVereda {
    const m = this.edad!.metadata, cabecera = ze.tipo === 'cabecera';
    const f = cabecera ? undefined : this.poblacion?.features.find(x => this.zonaEdad(x.properties.nombre, 'vereda') === ze);
    const viv2018 = f ? Number(f.properties.viv2018) : NaN, base = this.totalEdad(ze, m.anios[0]);
    // la tabla muestra el año que se está viendo y, para comparar, el primero de la serie
    const lista = [...new Set([m.anios[0], vista])].filter(a => m.anios.includes(a)).sort((a, b) => a - b);
    const serie = lista.map(a => ({ anio: a, pob: this.totalEdad(ze, a) }));
    const maximo = Math.max(...serie.map(a => a.pob));
    const primero = { anio: m.anios[0], pob: base }, ultimo = { anio: m.anios[m.anios.length - 1], pob: this.totalEdad(ze, m.anios[m.anios.length - 1]) };
    const dif = ultimo.pob - primero.pob, cambio = dif / primero.pob * 100;
    const signo = (v: number) => (v >= 0 ? '+' : '−');
    return {
      nombre: cabecera ? 'Cabecera municipal' : z.n, tipo: this.tipoDe(z),
      anios: serie.map(a => ({
        ...a, viv: Number.isFinite(viv2018) && base > 0 ? Math.round(viv2018 * a.pob / base) : null,
        alto: maximo > 0 ? Math.max(4, a.pob / maximo * 78) : 4, actual: a.anio === vista, extrapolado: a.anio > m.oficial_hasta,
      })),
      variacion: `Variación ${primero.anio}–${ultimo.anio}: ${signo(cambio)}${Math.abs(cambio).toFixed(1).replace('.', ',')} % ` +
        `(${signo(dif)}${Math.abs(dif).toLocaleString('es-CO')} personas)`,
      fuente: `DANE, proyección municipal por sexo y edad hasta ${m.oficial_hasta} (la misma de la Gobernación de Antioquia); ` +
        `${cabecera ? '' : 'reparto por vereda con el Censo 2018 y las viviendas; '}después de ${m.oficial_hasta}, extrapolación con la ${m.referencia_2043_2050}.`,
      infra: this.infraDe(this.piezas.findIndex(q => q.zona === z)),
      piramide: this.piramideDe(ze, vista),
      rango: { desde: m.anios[0], hasta: m.anios[m.anios.length - 1], oficial: m.oficial_hasta },
    };
  }

  cerrarPin(): void { this.pinFicha.set(null); }

  /** Abre el panel lateral derecho con los datos del pin (equipamiento o industria). */
  private abrirPin(ref: RefPin): void {
    const capa: string = ref.tipo === 'fabrica' ? 'industria' : ref.tipo === 'servicio' ? this.servicios[ref.i].pin!.cat : this.equipamientos[ref.i].datos.p.c;
    if (!this.capasActivas().has(capa)) this.alternarCapa(capa);     // el pin que se abre debe verse
    if (ref.tipo === 'servicio') {
      const e = this.servicios[ref.i], p = e.pin!, info = SERVICIOS.find(x => x.id === p.cat)!;
      const filas = [
        { k: 'Tipo', v: p.tipo }, { k: 'Estado', v: p.estado },
        { k: 'Ubicación', v: p.aprox ? 'Aproximada (± 25 m, tomada del mapa del PBOT)' : '' },
        { k: 'Detalle', v: e.detalle },
      ].filter(f => f.v);
      this.pinFicha.set({ color: info.color, glifo: info.glifo, categoria: info.nombre, titulo: e.nombre, filas, fuente: p.fuente, mapa2d: null, aproximada: p.aprox });
      return;
    }
    if (ref.tipo === 'fabrica') {
      const d = this.fabricas[ref.i].datos;
      const num = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)).replace('.', ',');
      const filas = [
        { k: 'Sector', v: SECTORES[d.c] ?? d.c },
        { k: 'Dirección', v: (d.dir ?? '').replace(/\s+/g, ' ').trim() },
        { k: 'Fuentes fijas', v: `${d.fuentes ?? 0}${d.chimenea ? ` · chimenea hasta ${num(d.chimenea)} m` : ''}` },
        { k: 'Combustibles', v: d.combustibles?.join(', ') ?? '' },
        { k: 'Control de emisiones', v: d.control?.join(', ') ?? '' },
        { k: 'Emisiones estimadas', v: CONTAMINANTES.filter(([c]) => d.em?.[c]).map(([c, n]) => `${n} ${num(d.em![c])} Mg/año`).join(' · ') },
        { k: 'Medido en chimenea', v: Object.entries(d.kgh ?? {}).map(([c, v]) => `${c} ${num(v)} kg/h`).join(' · ') },
      ].filter(f => f.v);
      this.pinFicha.set({ color: COLOR_INDUSTRIA, glifo: GLIFO.industria, categoria: 'Industria', titulo: d.n, filas, fuente: 'Inventario de emisiones atmosféricas · Corantioquia 2021', mapa2d: null, aproximada: false });
      return;
    }
    const q = this.equipamientos[ref.i], p = q.datos.p, cat = CATEGORIA.get(p.c);
    const filas = [
      { k: 'Tipo', v: p.t }, { k: 'Dirección', v: p.d ?? '' }, { k: 'Vereda o zona', v: p.v ?? '' },
      { k: 'Teléfono', v: p.tel ?? '' }, { k: 'Correo', v: p.mail ?? '' }, { k: 'Web', v: p.web ?? '' },
      { k: 'Detalle', v: p.x ?? '' }, { k: 'Estado del dato', v: p.e ?? '' },
      { k: 'Ubicación', v: p.a ? 'Aproximada (centro de la vereda)' : p.g ? 'Estimada a partir de la dirección' : '' },
    ].filter(f => f.v);
    this.pinFicha.set({ color: cat?.color ?? '#64748b', glifo: GLIFO[p.c], categoria: cat?.nombre ?? p.c, titulo: p.n, filas, fuente: p.f, mapa2d: { punto: p.n, lat: p.lat ?? q.lat, lng: p.lng ?? q.lon, desde: '3d' }, aproximada: !!p.a || !!p.g });
  }

  vistaGeneral(): void {
    this.cerrarPin();
    this.seleccionarFabrica(-1, false);
    this.seleccionarRio(null, false);
    this.elegida = -1;
    this.seleccion.set(null);
    this.aisladas.clear();
    this.aplicarAislamiento();
    this.pintarResalte();
    this.volarA(this.vistaInicial.pos, this.vistaInicial.objetivo);
  }

  private volarA(pos: THREE.Vector3, objetivo: THREE.Vector3): void {
    this.vuelo = {
      t0: performance.now(), dur: 1100,
      p0: this.camara.position.clone(), p1: pos.clone(),
      o0: this.controles.target.clone(), o1: objetivo.clone(),
    };
  }

  private avanzarVuelo(ahora: number): void {
    const v = this.vuelo!;
    const t = Math.min((ahora - v.t0) / v.dur, 1);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.camara.position.lerpVectors(v.p0, v.p1, k);
    this.controles.target.lerpVectors(v.o0, v.o1, k);
    if (t >= 1) this.vuelo = null;
  }

  private pintarResalte(): void {
    const c = this.ctxResalte, w = this.lienzoResalte.width, h = this.lienzoResalte.height;
    c.clearRect(0, 0, w, h);
    c.lineJoin = 'round';
    const dibujar = (id: number, relleno: string, trazo: string, grosor: number) => {
      if (id < 0) return;
      this.trazar(c, this.piezas[id].geometria, w, h);
      c.fillStyle = relleno;
      c.fill('evenodd');
      // sin trazo grueso: sobre el borde levantado se estiraría como un muro
      c.lineWidth = grosor;
      c.strokeStyle = trazo;
      if (grosor) c.stroke();
    };
    if (this.modoFoto()) { this.texturaResalte.needsUpdate = true; return; }
    dibujar(this.elegida, 'rgba(255,200,60,.3)', 'rgba(255,190,30,1)', 0);
    for (const a of this.aisladas) if (a !== this.elegida) dibujar(a, 'rgba(255,200,60,.3)', 'rgba(255,190,30,1)', 0);
    if (this.hover !== this.elegida) dibujar(this.hover, 'rgba(255,255,255,.2)', 'rgba(255,255,255,1)', 0);
    this.texturaResalte.needsUpdate = true;
  }
}
