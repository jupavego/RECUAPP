import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  AfterViewInit, Component, DestroyRef, ElementRef, NgZone, ViewChild, inject, signal,
} from '@angular/core';
import { Observable, catchError, forkJoin, of } from 'rxjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MapaService, Municipio, Punto, Zona } from '../../../mapa/services/mapa.service';
import { CATEGORIA } from '../../../mapa/utils/puntos';
import { Modelo, modelarEquipamiento } from '../../utils/equipamientos';
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
const CONTORNO_ZONA_GROSOR = 9.6;
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
const ANIOS_POBLACION = [2018, 2025, 2030, 2035];
const ANIO_INICIAL = 2025;
/** Margen (+15 %) sobre las viviendas estimadas por vereda: solo cambia cuántas se dibujan; los datos no se alteran. */
const FACTOR_VIVIENDAS = 1.15;
/** Huellas (m²) que cuentan como vivienda; las menores son casetas y las mayores, bodegas, que se dejan tal cual. */
const AREA_VIVIENDA: [number, number] = [30, 250];
/** Los edificios son diminutos frente al municipio: se agrandan en vertical para que se lean. */
const ESCALA_EDIFICIOS = 3.2;
/** lado (m) de las teselas en que se parten edificios, árboles y terreno para descartar lo que no se ve */
const TESELA = 1500;
/** celdas (de unos 23 m) por lado de cada tesela del terreno */
const TESELA_TERRENO = 64;
/** de más lejos que esto los árboles se dibujan con una versión simple (a esa distancia miden ~3 píxeles) */
const DISTANCIA_ARBOL_SIMPLE = 10000;
/** Ancho dibujado de las vías por clase (principal, local, sendero), en metros del modelo. */
const ANCHO_VIA = [34, 17, 8];
/** Los cauces se dibujan a su ancho real × este factor (el Río Medellín: 30 m → 66 m), con un mínimo para que se lean. */
const FACTOR_ANCHO_CAUCE = 2.2;
const ANCHO_MIN_CAUCE = 6;
/** Puentes: solo donde el cauce dibujado mide al menos esto (metros del modelo); tablero, barandas y su amarillo. */
const ANCHO_MIN_PUENTE = 20;
const COLOR_BARANDA = '#f6c312';
/** Cuánto vira el agua del Río Medellín a su color propio, #AF9447 con ondas azules (0 = azul, 1 = pleno). */
const TINTE_MEDELLIN = 1.0;
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
const INDUSTRIA_SEPARACION = 2 * RADIO_FABRICA + 6;
const HUMO_BOCANADAS = 28;
const HUMO_CICLO = 34;
const HUMO_ALTURA = 140;
const HUMO_DERIVA = 9;
const HUMO_AUREOLA = 100;
const HUMO_OPACIDAD = 0.7;
/** Tráfico de la doble calzada: velocidad de los autos (m/s del modelo), metros entre autos por calzada y su paleta. */
const TRAFICO_VELOCIDAD = [45, 80];
const TRAFICO_ESPACIO = 150;
/** Pueblo: radio (m) alrededor del centro de Girardota donde las vías forman una red, y metros de vía por auto. */
const RADIO_PUEBLO = 2600;
const TRAFICO_ESPACIO_PUEBLO = 170;
const COLORES_AUTOS = ['#ff2d2d', '#ff8a00', '#ffd400', '#00d26a', '#00c2ff', '#2f6bff', '#e040fb', '#ff4fa3'];
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
/** Cuánto se levanta (metros del modelo) una vereda al pasar el cursor y al elegirla. */
const ALZA_HOVER = 90;
const ALZA_ELEGIDA = 170;

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
  features: { properties: { nombre: string; viv2018: number } & Record<string, number | string> }[];
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

interface Calzada { x: number[]; z: number[]; y: number[]; cum: number[]; largo: number; }
interface Auto { calzada: number; s: number; i: number; v: number; carril: number; }
/** Tramo de vía entre dos cruces de la red del pueblo; `unico` = solo se circula de `ini` a `fin`. */
interface Arista extends Calzada { unico: boolean; vf: number; ini: string; fin: string; }
interface AutoRed { arista: number; s: number; i: number; dir: 1 | -1; v: number; carril: number; }

interface Industria {
  n: string; ciiu: number | null; c: string; dir?: string; lat: number; lon: number;
  fuentes?: number; combustibles?: string[]; equipos?: string[]; chimenea?: number | null; control?: string[];
  /** emisiones anuales estimadas (Mg/año) y flujos medidos en chimenea (kg/h), por contaminante */
  em?: Record<string, number>; kgh?: Record<string, number>;
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

/** El panel recuerda si el usuario lo dejó contraído (comodidad por navegador). */
const CLAVE_PANEL = 'mapa3d.panelAbierto';
function leerPanelAbierto(): boolean {
  try { return localStorage.getItem(CLAVE_PANEL) !== '0'; } catch { return true; }
}

const TIPOS_ZONA: Record<string, string> = {
  VE: 'Vereda', CM: 'Cabecera municipal', CO: 'Centro poblado', CA: 'Caserío', IN: 'Inspección',
};

@Component({
  selector: 'app-mapa3d',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div #lienzo class="lienzo"
         (pointermove)="alMover($event)" (mousedown)="alRatonAbajo($event)" (pointerdown)="alPulsar($event)" (pointerup)="alSoltar($event)"
         (pointerleave)="alSalir()"></div>

    @if (cargando()) { <div class="estado">Levantando el territorio…</div> }
    @if (error()) { <div class="estado error">{{ error() }}</div> }

    <div #rotulos class="rotulos"></div>

    <div class="panel" [class.cerrado]="!panelAbierto()">
      <div class="cabecera">
        <h1>Girardota <small>en 3D · prueba de concepto</small></h1>
        <button type="button" class="plegar" (click)="alternarPanel()"
                [attr.aria-expanded]="panelAbierto()" [attr.aria-label]="panelAbierto() ? 'Contraer panel' : 'Expandir panel'">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      @if (panelAbierto()) {
        @if (fabricaSeleccion(); as f) {
          <div class="ficha fab">
            <span class="tipo">Industria · {{ f.sector }}</span>
            <strong>{{ f.nombre }}</strong>
            @if (f.direccion) { <span class="dato">{{ f.direccion }}</span> }
            <span class="dato">{{ f.resumen }}</span>
            <span class="dato"><b>Combustibles:</b> {{ f.combustibles }}</span>
            <span class="dato"><b>Control de emisiones:</b> {{ f.control }}</span>
            @if (f.emisiones.length) {
              <div class="emisiones">
                <span class="tipo">Emisiones estimadas</span>
                @for (e of f.emisiones; track e.k) { <div><span>{{ e.k }}</span><b>{{ e.v }}</b></div> }
              </div>
            } @else {
              <span class="dato">Sin emisiones estimadas en el inventario.</span>
            }
            @if (f.flujos) { <span class="dato"><b>Medido en chimenea:</b> {{ f.flujos }}</span> }
            <span class="dato fuente">Inventario de emisiones atmosféricas · Corantioquia 2021</span>
          </div>
        } @else {
        @if (rioSeleccion(); as r) {
          <div class="ficha">
            <span class="tipo">{{ r.detalle }}</span>
            <strong>{{ r.nombre }}</strong>
          </div>
        } @else {
          @if (seleccion(); as z) {
            <div class="ficha">
              <span class="tipo">{{ tipoDe(z) }}</span>
              <strong>{{ z.n }}</strong>
              @if (datosDe(z); as d) {
                <span class="dato">{{ d.pob | number:'1.0-0' }} personas · {{ d.viv | number:'1.0-0' }} viviendas ({{ anio() }})</span>
              }
            </div>
          } @else {
            <p>Pasa el cursor sobre una vereda o un río y haz clic para seleccionarlo.</p>
          }
        }
        }
        @if (hayPoblacion() && !fabricaSeleccion()) {
          <div class="anios" role="group" aria-label="Año de la población">
            <span>Año</span>
            @for (a of aniosPoblacion; track a) {
              <button type="button" [class.activo]="a === anio()" [attr.aria-pressed]="a === anio()" (click)="cambiarAnio(a)">{{ a }}</button>
            }
          </div>
        }
        <button type="button" (click)="vistaGeneral()">Vista general</button>
        <p class="ayuda">Arrastra para desplazarte · rueda para acercar · rueda presionada para girar e inclinar · clic derecho para inclinar</p>
      } @else if (fabricaSeleccion() || rioSeleccion() || seleccion()) {
        <p class="resumen">{{ fabricaSeleccion()?.nombre ?? rioSeleccion()?.nombre ?? seleccion()!.n }}</p>
      }
    </div>

    <p class="creditos">Datos: © colaboradores de OpenStreetMap · Overture Maps · IGAC (drenajes 1:100.000) · Sentinel-2 © EOX</p>

    <div class="zoom">
      <button type="button" (click)="acercar(0.75)" aria-label="Acercar">+</button>
      <button type="button" (click)="acercar(1.33)" aria-label="Alejar">−</button>
    </div>
  `,
  styles: [`
    :host { position: relative; display: block; height: calc(100dvh - 64px); min-height: 520px;
      background: linear-gradient(#8ec8f2, #e4f2fb 70%); overflow: hidden; }
    .lienzo { position: absolute; inset: 0; }
    .estado { position: absolute; inset: 0; display: grid; place-items: center; font: 600 1.1rem system-ui;
      color: #36556b; pointer-events: none; }
    .estado.error { color: #b91c1c; }
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
    .rotulos ::ng-deep .rot.fabrica i { background: #6b7280; }
    .creditos { position: absolute; left: 16px; bottom: 8px; margin: 0; max-width: calc(100% - 90px); pointer-events: none;
      font: 600 10px/1.3 system-ui; color: rgba(255,255,255,.92); text-shadow: 0 1px 3px rgba(0,0,0,.7); }
    .zoom { position: absolute; z-index: 10; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 6px; }
    .zoom button { width: 38px; height: 38px; padding: 0; border-radius: 12px; font: 700 1.3rem/1 system-ui;
      background: rgba(255,255,255,.9); color: #26425a; box-shadow: 0 3px 12px rgba(30,60,90,.25); }
    .zoom button:hover { background: #fff; }
    .panel { position: absolute; z-index: 10; top: 16px; left: 16px; width: 260px; padding: 14px 16px; border-radius: 16px;
      background: rgba(255,255,255,.82); backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgba(30,60,90,.2);
      font: .9rem system-ui; color: #26425a; }
    .panel .cabecera { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .panel.cerrado { width: auto; min-width: 190px; padding-bottom: 10px; }
    .panel.cerrado .cabecera { margin-bottom: 0; }
    .panel .resumen { margin: 6px 0 0; font-weight: 700; }
    .panel .plegar { flex: none; width: 28px; height: 28px; padding: 0; display: grid; place-items: center;
      border-radius: 50%; background: rgba(38,66,90,.1); color: #26425a; transition: transform .2s; }
    .panel .plegar:hover { background: rgba(38,66,90,.2); }
    .panel.cerrado .plegar { transform: rotate(180deg); }
    .panel h1 { margin: 0; font-size: 1.15rem; }
    .panel h1 small { display: block; font-weight: 500; font-size: .75rem; color: #6b8294; }
    .panel p { margin: 0 0 10px; }
    .panel .ayuda { font-size: .72rem; color: #6b8294; margin: 10px 0 0; }
    .ficha { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
    .ficha .tipo { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: #6b8294; }
    .ficha strong { font-size: 1.1rem; }
    .ficha.fab { max-height: 46dvh; overflow: auto; padding-right: 4px; }
    .ficha .emisiones { display: grid; gap: 1px; margin: 4px 0 2px; font-size: .78rem; }
    .ficha .emisiones div { display: flex; justify-content: space-between; gap: 10px; }
    .ficha .emisiones b { font-weight: 700; color: #26425a; }
    .ficha .dato b { font-weight: 700; color: #26425a; }
    .ficha .dato.fuente { font-size: .66rem; color: #8aa0b0; margin-top: 4px; }
    .ficha .dato { font-size: .78rem; color: #4d6a80; }
    .anios { display: flex; align-items: center; gap: 4px; margin-bottom: 10px; font-size: .78rem; color: #6b8294; }
    .anios span { margin-right: 2px; }
    .anios button { padding: 4px 9px; font-size: .75rem; background: rgba(38,66,90,.12); color: #26425a; }
    .anios button:hover { background: rgba(38,66,90,.22); }
    .anios button.activo { background: #26425a; color: #fff; }
    button { border: 0; border-radius: 10px; padding: 7px 14px; background: #26425a; color: #fff;
      font: 600 .82rem system-ui; cursor: pointer; }
    button:hover { background: #35597a; }
  `],
})
export class Mapa3dComponent implements AfterViewInit {
  @ViewChild('lienzo', { static: true }) private lienzo!: ElementRef<HTMLDivElement>;
  @ViewChild('rotulos', { static: true }) private contenedorRotulos!: ElementRef<HTMLDivElement>;

  private readonly http = inject(HttpClient);
  private readonly mapa = inject(MapaService);
  private readonly zona = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  readonly cargando = signal(true);
  readonly error = signal('');
  readonly seleccion = signal<Zona | null>(null);
  readonly anio = signal(ANIO_INICIAL);
  readonly hayPoblacion = signal(false);
  readonly aniosPoblacion = ANIOS_POBLACION;

  private renderer!: THREE.WebGLRenderer;
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
  private lienzoIds!: HTMLCanvasElement;
  private ctxIds!: CanvasRenderingContext2D;
  private lienzoResalte!: HTMLCanvasElement;
  private ctxResalte!: CanvasRenderingContext2D;
  private texturaResalte!: THREE.CanvasTexture;
  private hover = -1;
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
  // resolución dinámica: baja mientras la cámara se mueve y la máquina no da abasto
  private ratioMax = 1;
  private degradado = false;
  private ultimoMovimiento = 0;
  private promedioMs = 16;
  private camaraAnterior = new THREE.Vector3();
  private objetivoAnterior = new THREE.Vector3();
  private perf: { el: HTMLElement; acumulado: number; cuadros: number; sombras: number; msActualizar: number; msRender: number } | null = null;
  private nubes: Nube[] = [];
  private nieblas: Neblina[] = [];
  private calzadas: Calzada[] = [];
  private autos: Auto[] = [];
  private fabricas: { x: number; z: number; lon: number; lat: number; n: string; datos: Industria }[] = [];
  private mallaIndustrias: THREE.Mesh | null = null;
  private inicioFabrica: number[] = [];
  private anilloFabrica: THREE.Mesh | null = null;
  private fabricaElegida = -1;
  private fabricaHover = -1;
  /** Puntos de interés (colegios, hospitales, canchas...) con el edificio que los representa. */
  private equipamientos: { x: number; z: number; lon: number; lat: number; n: string; r: number; datos: { p: Punto; modelo: Modelo } }[] = [];
  private mallaEquip: THREE.Mesh | null = null;
  private geoEquip: THREE.BufferGeometry | null = null;
  private matEquip: THREE.Material | null = null;
  private inicioEquip: number[] = [];
  private equipHover = -1;
  private rotuloEquip: HTMLElement | null = null;
  private tFabricaHover = 0;
  private tEquipHover = 0;
  private anilloHover: THREE.Mesh | null = null;
  private rotuloFabrica: HTMLElement | null = null;
  readonly fabricaSeleccion = signal<FichaFabrica | null>(null);
  private humos: Humo[] = [];
  /** todas las bocanadas de humo de las chimeneas: una sola llamada de dibujo en vez de una por bocanada */
  private humoInst?: { malla: THREE.Mesh; pos: Float32Array; esc: Float32Array; rot: Float32Array; col: Float32Array; op: Float32Array; atributos: THREE.InstancedBufferAttribute[]; rotAcum: Float32Array };
  private geoIndustrias: THREE.BufferGeometry | null = null;
  private matIndustrias: THREE.Material | null = null;
  private aristas: Arista[] = [];
  private nodos = new Map<string, number[]>();
  private autosRed: AutoRed[] = [];
  private mallaAutos: THREE.InstancedMesh[] = [];
  private geoAutos: THREE.BufferGeometry[] = [];
  private matAutos: THREE.Material[] = [];
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
  // edificios dibujados según la población del año elegido
  private edificiosBase: Compacto | null = null;
  private poblacion: PoblacionVeredas | null = null;
  private capasEdificios: Capa[] = [];
  /** vereda (índice) → población y viviendas del año elegido */
  private datosPorVereda = new Map<number, { pob: number; viv: number }>();
  /** un grupo por tesela: con detalle completo y con la versión simple que se usa de lejos */
  private teselasArboles: { cerca: THREE.InstancedMesh; lejos: THREE.InstancedMesh; centro: THREE.Vector3 }[] = [];
  private texturaRio: THREE.CanvasTexture | null = null;
  private readonly rios = new Map<string, Rio>();
  private aguaPos: THREE.BufferAttribute | null = null;
  private haloHover: THREE.Mesh | null = null;
  private haloElegido: THREE.Mesh | null = null;
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
    forkJoin({
      relieve: this.http.get<Relieve>(`data/mapa3d/relieve-${ID_MUNICIPIO}.json`),
      muni: this.mapa.municipios$,
      terr: this.mapa.territorio(ID_MUNICIPIO),
      foto: this.cargarImagen(`data/mapa3d/ortofoto-${ID_MUNICIPIO}.jpg`),
      vias: this.http.get<Compacto>(`data/mapa3d/vias-${ID_MUNICIPIO}.json`).pipe(catchError(() => of(null))),
      edificios: this.http.get<Compacto>(`data/mapa3d/edificios-${ID_MUNICIPIO}.json`).pipe(catchError(() => of(null))),
      cauces: this.http.get<Cauces>(`data/mapa3d/cauces-${ID_MUNICIPIO}.json`).pipe(catchError(() => of(null))),
      industrias: this.http.get<Industria[]>(`data/mapa3d/industrias-${ID_MUNICIPIO}.json`).pipe(catchError(() => of([] as Industria[]))),
      poblacion: this.http.get<PoblacionVeredas>(`data/mapa/poblacion/veredas-${CODIGO_DANE}.geojson`).pipe(catchError(() => of(null))),
      puntos: this.mapa.puntos(ID_MUNICIPIO),
    }).subscribe({
      next: ({ relieve, muni, terr, foto, vias, edificios, cauces, poblacion, industrias, puntos }) => {
        try {
          this.foto = foto;
          this.construir(relieve, muni.municipios, terr.v);
          this.fabricas = this.ubicarIndustrias(industrias, vias);
          this.equipamientos = this.ubicarEquipamientos(puntos, vias);
          if (vias?.v) this.construirVias(vias);
          if (cauces?.c) this.construirCauces(cauces);
          if (vias?.v && cauces?.c) this.construirPuentes(vias, cauces);
          if (cauces?.c) this.construirPajaros(cauces);
          if (vias?.v) this.construirTrafico(vias);
          this.construirIndustrias();
          this.construirEquipamientos();          this.edificiosBase = this.sinIndustrias(edificios);
          this.poblacion = poblacion;
          this.hayPoblacion.set(!!(edificios?.e && poblacion));
          const dibujados = this.edificiosParaAnio(this.anio());
          if (dibujados?.e) this.construirEdificios(dibujados);
          this.construirVegetacion(vias, dibujados, cauces);
        } catch (e) {
          console.error(e);
          this.error.set('No se pudo iniciar la vista 3D en este navegador.');
        }
        this.cargando.set(false);
      },
      error: () => { this.error.set('No se pudieron cargar los datos del territorio.'); this.cargando.set(false); },
    });
    this.destroyRef.onDestroy(() => this.liberar());
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

  readonly panelAbierto = signal(leerPanelAbierto());

  alternarPanel(): void {
    this.panelAbierto.update(v => !v);
    try { localStorage.setItem(CLAVE_PANEL, this.panelAbierto() ? '1' : '0'); } catch { /* sin almacenamiento: no pasa nada */ }
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.ratioMax = Math.min(window.devicePixelRatio, 2);
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
    this.controles.minDistance = 1500;
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
      this.vuelo = null;
      this.zoomPendiente += ev.deltaY * 0.0022;
    };
    this.renderer.domElement.addEventListener('wheel', rueda, { passive: false });
    this.destroyRef.onDestroy(() => this.renderer.domElement.removeEventListener('wheel', rueda));

    const redim = () => {
      this.renderer.setSize(el.clientWidth, el.clientHeight);
      this.camara.aspect = el.clientWidth / el.clientHeight;
      this.camara.updateProjectionMatrix();
    };
    window.addEventListener('resize', redim);
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', redim));
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
  private agregarCinta(g: GrupoCinta, linea: [number, number][], ancho: number, periodo: number): void {
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
      const y = this.alturaEn(q[0], q[1]) + 3;
      const id = this.idEn(q[0], q[1]);
      g.pos.push(xs[i] - dz * mitad, y, zs[i] + dx * mitad, xs[i] + dz * mitad, y, zs[i] - dx * mitad);
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
  private construirVias(d: Compacto): void {
    const grupos = [this.nuevoGrupo(), this.nuevoGrupo(), this.nuevoGrupo()];
    for (const v of d.v!) {
      if (v[0] > 2) continue;
      this.agregarCinta(grupos[v[0]], this.desdeDeltas(v, d.k, 1), ANCHO_VIA[v[0]], ANCHO_VIA[v[0]] * 1.8);
    }
    const [principal, local, sendero] = grupos;
    // acera / cuneta: la misma cinta, más ancha y apenas por debajo, en gris claro
    this.crearCinta({ ...principal, pos: this.ensanchar(principal.pos, 1.3) }, '#a9aaa8', 1, 0);
    this.crearCinta({ ...local, pos: this.ensanchar(local.pos, 1.35) }, '#b4b5b2', 1, 0);
    // asfalto con sus rayas
    this.crearCinta(principal, '', 0, 1, this.texturaVia('principal'));
    this.crearCinta(local, '', 0, 1, this.texturaVia('local'));
    this.crearCinta(sendero, '#a98f66', 0, 1);
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
      const y0 = suelo[0] + 3.2, y1 = suelo[n - 1] + 3.2;
      let perfil = pts.map((_, k) => Math.max(y0 + (y1 - y0) * (arco[k] / arco[n - 1]), suelo[k] + 3.2 + 2.5 * Math.sin(Math.PI * arco[k] / arco[n - 1])));
      for (let pasada = 0; pasada < 4; pasada++) {
        const previo = perfil;
        perfil = previo.map((v, k) => (k < 2 || k > n - 3) ? v : (previo[k - 1] + 2 * v + previo[k + 1]) / 4);
      }
      perfil = perfil.map((v, k) => (k < 2 || k > n - 3) ? suelo[k] + 3.2 : Math.max(v, suelo[k] + 3.2));

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
    if (clave) this.seleccionarFabrica(-1, false);
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
  private ajustarAPoblacion(edificios: number[][], k: number, datos: PoblacionVeredas, anio: number): number[][] {
    const norma = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const cupo = new Map<number, number>();
    this.datosPorVereda.clear();
    for (const f of datos.features) {
      const p = f.properties, id = this.piezas.findIndex(z => z.zona.t === 'VE' && norma(z.zona.n) === norma(p.nombre));
      const actual = Number(p[`pob${anio}`]), base = Number(p['pob2018']);
      if (id < 0 || !(base > 0) || !Number.isFinite(actual)) continue;
      const estimadas = Math.round(p.viv2018 * actual / base);
      cupo.set(id, Math.round(estimadas * FACTOR_VIVIENDAS));
      this.datosPorVereda.set(id, { pob: actual, viv: estimadas });   // la ficha muestra la estimación, sin el margen
    }
    const candidatas = new Map<number, [number, number][]>();   // vereda → [orden aleatorio, índice]
    const quitar = new Set<number>();
    edificios.forEach((e, n) => {
      const anillo = this.desdeDeltas(e, k, 1);
      if (anillo.length < 3) return;
      const lon = anillo.reduce((a, q) => a + q[0], 0) / anillo.length, lat = anillo.reduce((a, q) => a + q[1], 0) / anillo.length;
      const id = this.idEn(lon, lat);
      if (!cupo.has(id)) return;
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
    return edificios.filter((_, n) => !quitar.has(n));
  }

  /** Edificios del año elegido (los originales si no hay datos de población). */
  private edificiosParaAnio(anio: number): Compacto | null {
    const base = this.edificiosBase;
    if (!base?.e || !this.poblacion) return base;
    return { ...base, e: this.ajustarAPoblacion(base.e, base.k, this.poblacion, anio) };
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
    const PAREDES = ['#f3e8d6', '#efe0c9', '#f6f0e6', '#ead7bd'].map(c => new THREE.Color(c));
    const TECHOS = ['#c8704f', '#b9825f', '#d6cfc0', '#a3a9ae', '#c98f6a'].map(c => new THREE.Color(c));
    // una malla por tesela: así la GPU descarta las que quedan fuera de cámara y solo proyectan sombra las del recuadro de la luz
    type Tesela = { pos: number[]; col: number[]; idx: number[]; ids: number[]; pesos: number[] };
    const teselas = new Map<number, Tesela>();
    d.e!.forEach((e, n) => {
      const ring = this.desdeDeltas(e, d.k, 1);
      if (ring.length < 3) return;
      const hash = (((n + 1) * 2654435761) >>> 0) % 1000 / 1000;
      const h = (e[0] || 4.5 + hash * 4) * ESCALA_EDIFICIOS;
      const xs = ring.map(q => this.aX(q[0])), zs = ring.map(q => this.aZ(q[1]));
      const suelo = Math.min(...ring.map(q => this.alturaEn(q[0], q[1]))) - 4, techo = suelo + 4 + h;
      const cLon = ring.reduce((a, q) => a + q[0], 0) / ring.length, cLat = ring.reduce((a, q) => a + q[1], 0) / ring.length;
      const id = this.idEn(cLon, cLat);
      const peso = id >= 0 ? this.pesoBorde(cLon, cLat, id) : 0;
      const pared = PAREDES[n % PAREDES.length], tejado = TECHOS[(n * 7 + Math.floor(hash * 10)) % TECHOS.length];
      const clave = this.claveTesela(this.aX(cLon), this.aZ(cLat));
      let t = teselas.get(clave);
      if (!t) teselas.set(clave, t = { pos: [], col: [], idx: [], ids: [], pesos: [] });
      const { pos, col, idx, ids, pesos } = t;
      const poner = (x: number, y: number, z: number, c: THREE.Color) => {
        pos.push(x, y, z);
        col.push(c.r, c.g, c.b);
        ids.push(id);
        pesos.push(peso);
        return pos.length / 3 - 1;
      };
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        const a = poner(xs[i], suelo, zs[i], pared), b = poner(xs[j], suelo, zs[j], pared);
        const c = poner(xs[j], techo, zs[j], pared), dd = poner(xs[i], techo, zs[i], pared);
        idx.push(a, b, c, a, c, dd);
      }
      const base = pos.length / 3;
      ring.forEach((_, i) => poner(xs[i], techo, zs[i], tejado));
      const contorno = ring.map((_, i) => new THREE.Vector2(xs[i], zs[i]));
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contorno, [])) idx.push(base + a, base + b, base + c);
    });
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
    this.escena.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL((((tono % 360) + 360) % 360) / 360, 0.65, 0.5),
      transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    })));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linea, 3));
    this.escena.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#ffffff' })));
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
   *    sentido de marcha). Fuera del pueblo los autos dan vueltas por cada calzada, uno cada ~150 m, en tres carriles.
   *  - Pueblo: en un radio alrededor de Girardota las vías forman una red (se parten en los puntos que comparten). Cada
   *    auto avanza por una arista y, al llegar a un cruce, elige por dónde seguir; en la doble calzada solo en su sentido,
   *    y en las demás vías en ambos, por el carril derecho. Así entran desde la autopista y recorren las calles.
   * Todo va en dos mallas instanciadas (carrocería de color y techo gris claro).
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
        x.push(px); z.push(pz); y.push(this.alturaXZ(px, pz) + 3); cum.push(recorrido);
      };
      agregar(l[0][0], l[0][1]);
      for (let i = 1; i < l.length; i++) {
        const n = Math.max(1, Math.ceil(Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]) / 15));
        for (let j = 1; j <= n; j++) agregar(l[i - 1][0] + (l[i][0] - l[i - 1][0]) * j / n, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * j / n);
      }
      return { x, z, y, cum, largo: recorrido };
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
        this.aristas.push({ ...d, unico: r.unico, vf: r.vf, ini, fin });
        for (const k of new Set([ini, fin])) (this.nodos.get(k) ?? this.nodos.set(k, []).get(k)!).push(idx);
      }
    }

    // ── autos ──
    const rnd = mulberry32(900);
    // fuera del pueblo, las calzadas dobles dan vueltas por su propio tramo
    const enRed = new Set(red.filter(r => r.poli >= 0).map(r => r.poli));
    for (const p of dobles) {
      if (enRed.has(p)) continue;
      const d = densificar(polis[p]);
      if (d.largo < 150) continue;
      this.calzadas.push(d);
      const n = Math.max(1, Math.round(d.largo / TRAFICO_ESPACIO));
      for (let a = 0; a < n; a++) {
        this.autos.push({
          calzada: this.calzadas.length - 1, s: rnd() * d.largo, i: 0,
          v: TRAFICO_VELOCIDAD[0] + rnd() * (TRAFICO_VELOCIDAD[1] - TRAFICO_VELOCIDAD[0]),
          carril: [-8, 0, 8][Math.floor(rnd() * 3)],
        });
      }
    }
    // en el pueblo, autos repartidos por las aristas según su largo
    const total = this.aristas.reduce((t, e) => t + e.largo, 0);
    const nRed = Math.round(total / TRAFICO_ESPACIO_PUEBLO);
    const acumulado: number[] = [];
    this.aristas.reduce((t, e, i) => (acumulado[i] = t + e.largo), 0);
    for (let a = 0; a < nRed; a++) {
      const q = rnd() * total;
      const arista = Math.max(0, acumulado.findIndex(c => c >= q));
      const e = this.aristas[arista];
      this.autosRed.push({
        arista, s: rnd() * e.largo, i: 0, dir: e.unico || rnd() < 0.5 ? 1 : -1,
        v: TRAFICO_VELOCIDAD[0] + rnd() * (TRAFICO_VELOCIDAD[1] - TRAFICO_VELOCIDAD[0]), carril: [-8, 0, 8][Math.floor(rnd() * 3)],
      });
    }
    const cuenta = this.autos.length + this.autosRed.length;
    if (!cuenta) return;

    // carrocería (toma el color de cada auto) y techo gris claro (igual en todos): dos mallas que comparten las matrices
    const cuerpo = new THREE.BoxGeometry(15, 4, 6.5).translate(0, 2, 0);
    const techo = new THREE.BoxGeometry(8, 3.2, 5.8).translate(-1, 5.6, 0);
    this.geoAutos = [cuerpo, techo];
    this.matAutos = [
      new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ color: '#d3d8dd', roughness: 0.5, metalness: 0.1 }),
    ];
    const hacer = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const malla = new THREE.InstancedMesh(g, m, cuenta);
      malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      malla.frustumCulled = false;
      this.escena.add(malla);
      return malla;
    };
    const malla = hacer(cuerpo, this.matAutos[0]);
    this.mallaAutos = [malla, hacer(techo, this.matAutos[1])];
    const color = new THREE.Color();
    for (let i = 0; i < cuenta; i++) malla.setColorAt(i, color.set(COLORES_AUTOS[Math.floor(rnd() * COLORES_AUTOS.length)]));
    this.animarTrafico(0);
  }

  private animarTrafico(dt: number): void {
    if (!this.mallaAutos.length) return;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qz = new THREE.Quaternion();
    const arriba = new THREE.Vector3(0, 1, 0), lateral = new THREE.Vector3(0, 0, 1);
    const pos = new THREE.Vector3(), escala = new THREE.Vector3(1, 1, 1);
    /** Coloca el auto n sobre la polilínea `c` a `s` metros, mirando en el sentido `dir`, a `carril` metros a su derecha. */
    const colocar = (n: number, c: { x: number[]; z: number[]; y: number[]; cum: number[] }, indice: number, s: number, dir: number, carril: number): number => {
      let i = indice;
      while (i > 0 && s < c.cum[i]) i--;
      while (i < c.cum.length - 2 && s > c.cum[i + 1]) i++;
      const seg = c.cum[i + 1] - c.cum[i] || 1, t = Math.min(1, Math.max(0, (s - c.cum[i]) / seg));
      const tx = dir * (c.x[i + 1] - c.x[i]) / seg, tz = dir * (c.z[i + 1] - c.z[i]) / seg;
      const x = c.x[i] + (c.x[i + 1] - c.x[i]) * t - tz * carril, z = c.z[i] + (c.z[i + 1] - c.z[i]) * t + tx * carril;
      let y = c.y[i] + (c.y[i + 1] - c.y[i]) * t;
      // si la vereda se levanta, el auto sube con ella
      const lon = this.lon0 + x / this.mLon, lat = this.lat0 - z / this.mLat, id = this.idEn(lon, lat);
      if (id >= 0 && this.alzado[id] > 0.5) y += this.alzado[id] * this.pesoBorde(lon, lat, id);
      q.setFromAxisAngle(arriba, Math.atan2(-tz, tx)).multiply(qz.setFromAxisAngle(lateral, Math.atan(dir * (c.y[i + 1] - c.y[i]) / seg)));
      m4.compose(pos.set(x, y, z), q, escala);
      for (const malla of this.mallaAutos) malla.setMatrixAt(n, m4);
      return i;
    };

    this.autos.forEach((a, n) => {
      const c = this.calzadas[a.calzada];
      a.s += a.v * dt;
      if (a.s >= c.largo) { a.s -= c.largo; a.i = 0; }
      a.i = colocar(n, c, a.i, a.s, 1, a.carril);
    });

    const base = this.autos.length;
    this.autosRed.forEach((a, k) => {
      let e = this.aristas[a.arista];
      a.s += a.dir * a.v * e.vf * dt;
      if (a.s > e.largo || a.s < 0) {
        // llegó a un cruce: elige entre las vías que salen de él (en la doble calzada, solo en su sentido)
        const nodo = a.s > e.largo ? e.fin : e.ini;
        const opciones: [number, 1 | -1][] = [];
        for (const j of this.nodos.get(nodo) ?? []) {
          if (j === a.arista) continue;
          const o = this.aristas[j];
          if (o.ini === nodo) opciones.push([j, 1]);
          if (o.fin === nodo && !o.unico) opciones.push([j, -1]);
        }
        if (opciones.length) {
          const [j, d] = opciones[Math.floor(Math.random() * opciones.length)];
          a.arista = j;
          a.dir = d;
          a.s = d > 0 ? 0 : this.aristas[j].largo;
          a.i = 0;
          a.carril = [-8, 0, 8][Math.floor(Math.random() * 3)];
        } else if (!e.unico) {
          a.dir = a.dir > 0 ? -1 : 1;                       // calle sin salida: da la vuelta
          a.s = Math.min(e.largo, Math.max(0, a.s));
        } else {
          a.arista = Math.floor(Math.random() * this.aristas.length);   // calzada que se acaba: reaparece en otra vía
          a.dir = 1;
          a.s = 0;
          a.i = 0;
        }
        e = this.aristas[a.arista];
      }
      // en las vías de doble sentido va por el carril derecho; en la doble calzada, en el que le tocó
      a.i = colocar(base + k, e, a.i, a.s, a.dir, e.unico ? a.carril : (e.vf < 1 ? 5 : 8));
    });
    for (const malla of this.mallaAutos) malla.instanceMatrix.needsUpdate = true;
  }

  /**
   * Fábricas del inventario de emisiones de Corantioquia (insumos/ambiente/Base_Datos_Inventario-2021.xlsx, filtradas a
   * Girardota en public/data/mapa3d/industrias-49.json). Se descartan las que caen fuera del mapa o sin coordenadas, y
   * las que quedan a menos de INDUSTRIA_SEPARACION de otra ya puesta (varias comparten predio).
   */
  private ubicarIndustrias(lista: Industria[], vias: Compacto | null): { x: number; z: number; lon: number; lat: number; n: string; datos: Industria }[] {
    const holgura = this.holguraVias(vias);
    const intentos: [number, number][] = [[0, 0]];
    for (const r of [25, 50, 75, 100, 130, 160]) for (let k = 0; k < 12; k++) intentos.push([Math.cos(k * Math.PI / 6) * r, Math.sin(k * Math.PI / 6) * r]);
    const out: { x: number; z: number; lon: number; lat: number; n: string; datos: Industria }[] = [];
    for (const f of lista) {
      const x0 = this.aX(f.lon), z0 = this.aZ(f.lat);
      for (const [dx, dz] of intentos) {
        const x = x0 + dx, z = z0 + dz;
        if (Math.abs(x) > this.ancho / 2 - 150 || Math.abs(z) > this.alto / 2 - 150) continue;
        // sin pisar a otra fábrica ni una vía: se corre hasta encontrar un sitio libre cerca del punto del inventario
        if (holgura(x, z) < RADIO_FABRICA || !out.every(o => Math.hypot(o.x - x, o.z - z) > INDUSTRIA_SEPARACION)) continue;
        out.push({ x, z, lon: this.lon0 + x / this.mLon, lat: this.lat0 - z / this.mLat, n: f.n, datos: f });
        break;
      }
    }
    return out;
  }

  /**
   * Puntos de interés de Girardota (colegios, salud, canchas, sitios arqueológicos...), cada uno con su edificio. Se corren
   * hasta un sitio libre cerca de su coordenada: sin pisar una vía, una fábrica ni otro equipamiento.
   */
  private ubicarEquipamientos(lista: Punto[], vias: Compacto | null): typeof this.equipamientos {
    const holgura = this.holguraVias(vias);
    const intentos: [number, number][] = [[0, 0]];
    for (const r of [15, 30, 50, 75, 100, 130, 160]) for (let k = 0; k < 12; k++) intentos.push([Math.cos(k * Math.PI / 6) * r, Math.sin(k * Math.PI / 6) * r]);
    const out: typeof this.equipamientos = [];
    const previos = (x: number, z: number, r: number) =>
      this.fabricas.every(f => Math.hypot(f.x - x, f.z - z) > RADIO_FABRICA + r + 4) && out.every(o => Math.hypot(o.x - x, o.z - z) > o.r + r + 4);
    lista.forEach((p, i) => {
      if (p.lat == null || p.lng == null) return;
      const modelo = modelarEquipamiento(p.c, p.t, p.n, mulberry32(9100 + i));
      const x0 = this.aX(p.lng), z0 = this.aZ(p.lat);
      for (const [dx, dz] of intentos) {
        const x = x0 + dx, z = z0 + dz;
        if (Math.abs(x) > this.ancho / 2 - 150 || Math.abs(z) > this.alto / 2 - 150) continue;
        if (holgura(x, z) < modelo.radio * 0.7 || !previos(x, z, modelo.radio)) continue;
        out.push({ x, z, lon: this.lon0 + x / this.mLon, lat: this.lat0 - z / this.mLat, n: p.n, r: modelo.radio, datos: { p, modelo } });
        return;
      }
    });
    return out;
  }

  /** Función (x, z) → distancia al borde de la vía más cercana (principales y locales; los senderos no cuentan). */
  private holguraVias(vias: Compacto | null): (x: number, z: number) => number {
    const REJ = 200;
    const segs = new Map<number, number[][]>();
    for (const v of vias?.v ?? []) {
      if (v[0] > 1) continue;                      // principales y locales; los senderos no cuentan
      const l = this.desdeDeltas(v, vias!.k, 1).map(q => [this.aX(q[0]), this.aZ(q[1])]);
      for (let i = 1; i < l.length; i++) {
        const sg = [l[i - 1][0], l[i - 1][1], l[i][0], l[i][1], ANCHO_VIA[v[0]] / 2];
        const i0 = Math.floor(Math.min(sg[0], sg[2]) / REJ), i1 = Math.floor(Math.max(sg[0], sg[2]) / REJ);
        const j0 = Math.floor(Math.min(sg[1], sg[3]) / REJ), j1 = Math.floor(Math.max(sg[1], sg[3]) / REJ);
        for (let a = i0; a <= i1; a++) for (let c = j0; c <= j1; c++) (segs.get(a * 100003 + c) ?? segs.set(a * 100003 + c, []).get(a * 100003 + c)!).push(sg);
      }
    }
    return (x: number, z: number) => {
      let m = Infinity;
      const ci = Math.floor(x / REJ), cj = Math.floor(z / REJ);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (const [ax, az, bx, bz, mitad] of segs.get((ci + di) * 100003 + cj + dj) ?? []) {
            const sx = bx - ax, sz = bz - az, ll = sx * sx + sz * sz;
            const t = ll > 0 ? Math.min(1, Math.max(0, ((x - ax) * sx + (z - az) * sz) / ll)) : 0;
            m = Math.min(m, Math.hypot(x - ax - sx * t, z - az - sz * t) - mitad);
          }
        }
      }
      return m;
    };
  }

  /** Quita los edificios de OpenStreetMap que quedarían debajo de una fábrica o de un equipamiento (dentro de su radio). */
  private sinIndustrias(e: Compacto | null): Compacto | null {
    if (!e?.e || !(this.fabricas.length || this.equipamientos.length)) return e;
    const k = e.k;
    return {
      ...e,
      e: e.e.filter(b => {
        const q = this.desdeDeltas(b, k, 1);
        const lon = q.reduce((m, p) => m + p[0], 0) / q.length, lat = q.reduce((m, p) => m + p[1], 0) / q.length;
        const x = this.aX(lon), z = this.aZ(lat);
        return this.fabricas.every(f => Math.hypot(f.x - x, f.z - z) > RADIO_FABRICA + 5)
          && this.equipamientos.every(q => Math.hypot(q.x - x, q.z - z) > q.r + 3);
      }),
    };
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

    for (const q of this.equipamientos) {
      this.inicioEquip.push(ids.length);
      const { modelo } = q.datos;
      const yaw = rnd() * Math.PI * 2, cos = Math.cos(yaw), sin = Math.sin(yaw);
      const [lw, ld] = modelo.losa ?? [0, 0];
      const alturas = [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) =>
        this.alturaXZ(q.x + a * (lw / 2) * cos + b * (ld / 2) * sin, q.z - a * (lw / 2) * sin + b * (ld / 2) * cos));
      const base = (modelo.losa ? Math.max(...alturas) : alturas[0]) + 1, minimo = Math.min(...alturas);
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
      if (modelo.losa) {                                          // losa que se asienta en la ladera
        const prof = base - minimo + 2;
        poner(new THREE.BoxGeometry(lw, prof, ld).translate(0, -prof / 2, 0), losaColor);
      }
      for (const p of modelo.piezas) poner(p.g, new THREE.Color(p.color));
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

    this.fabricas.forEach((f, n) => {
      this.inicioFabrica.push(ids.length);
      const largo = 48 + rnd() * 20, fondo = 30 + rnd() * 10, alto = 13 + rnd() * 3;
      const yaw = rnd() * Math.PI * 2, cos = Math.cos(yaw), sin = Math.sin(yaw);
      const alturas = [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) => this.alturaXZ(f.x + (a * (largo / 2 + 20)) * cos + (b * (fondo / 2 + 15)) * sin, f.z - (a * (largo / 2 + 20)) * sin + (b * (fondo / 2 + 15)) * cos));
      const base = Math.max(...alturas) + 1, minimo = Math.min(...alturas);
      const id = this.idEn(f.lon, f.lat), peso = id >= 0 ? this.pesoBorde(f.lon, f.lat, id) : 0;
      const pared = paredes[Math.floor(rnd() * paredes.length)];
      /** Pone una pieza (centrada en su origen) en (lx, ly, lz) locales de la fábrica, con su color. */
      const poner = (g: THREE.BufferGeometry, color: string, lx: number, ly: number, lz: number) => {
        const geo = g.index ? g.toNonIndexed() : g;
        geo.translate(lx, ly, lz);
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
      poner(caja(largo + 14, losa, fondo + 12), '#9aa0a6', 0, -losa / 2, 0);                  // losa que se asienta en la ladera
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
      const ch = 55 + rnd() * 30, cx = -largo / 2 - 7, cz = -fondo / 2 + 6, bandas = 6, seg = ch / bandas;
      for (let k = 0; k < bandas; k++) {
        const r0 = 4.4 - 2 * (k / bandas), r1 = 4.4 - 2 * ((k + 1) / bandas);
        poner(new THREE.CylinderGeometry(r1, r0, seg, 14), k % 2 ? '#d8d8d8' : '#c4342d', cx, seg * (k + 0.5), cz);
      }
      poner(new THREE.CylinderGeometry(2.7, 2.4, 2, 14), '#2b2f36', cx, ch + 1, cz);
      const hx = f.x + cx * cos + cz * sin, hz = f.z - cx * sin + cz * cos;
      const fase = rnd();
      const puffs: Humo['puffs'] = [];
      for (let k = 0; k < HUMO_BOCANADAS; k++) {
        puffs.push({ tex: Math.floor(rnd() * 4), theta: rnd() * Math.PI * 2, giro: (rnd() - 0.5) * 0.3, tam: 0.8 + rnd() * 0.5, desv: rnd() });
      }
      this.humos.push({ x: hx, y: base + ch + 2, z: hz, fase, ini: this.humos.length * HUMO_BOCANADAS, puffs });
    });
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

    new GLTFLoader().load('data/mapa3d/boeing-787.glb', gltf => grupo.add(gltf.scene));
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
    const mitad = Math.min(11000, Math.max(2200, dist * 0.85));
    const c = this.sol.shadow.camera;
    c.left = -mitad; c.right = mitad; c.top = mitad; c.bottom = -mitad;
    c.updateProjectionMatrix();
    this.sol.target.position.copy(this.controles.target);
    this.sol.position.copy(this.controles.target).add(SOL_DIRECCION);
    this.sol.shadow.normalBias = (mitad * 2 / 4096) * 4;
    // los árboles y edificios solo proyectan sombra cuando se ven de cerca (ahorra mucho trabajo a la GPU)
    const cerca = dist < DISTANCIA_SOMBRAS;
    for (const m of this.mallasEdificios) m.castShadow = cerca;
    for (const t of this.teselasArboles) t.cerca.castShadow = t.lejos.castShadow = cerca;
    // el mapa de sombras solo se repinta si la luz se movió, cambió su alcance o algo que proyecta sombra se alzó
    const t = this.controles.target;
    const clave = `${t.x.toFixed(1)}|${t.y.toFixed(1)}|${t.z.toFixed(1)}|${mitad.toFixed(1)}|${cerca}`;
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

  /** De lejos cada tesela de árboles usa la versión simple; de cerca, la completa. */
  private actualizarArboles(): void {
    const cam = this.camara.position;
    for (const t of this.teselasArboles) {
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
    p.el.textContent = [
      Object.entries(tipos).map(([k, v]) => `${k} ${v}`).join(' · '),
      `${(p.cuadros / p.acumulado).toFixed(0)} fps · ${(p.acumulado / p.cuadros * 1000).toFixed(1)} ms/cuadro`,
      `CPU actualizar ${(p.msActualizar / p.cuadros).toFixed(2)} ms · render ${(p.msRender / p.cuadros).toFixed(2)} ms`,
      `llamadas ${i.render.calls} · triángulos ${(i.render.triangles / 1000).toFixed(0)} k`,
      `geometrías ${i.memory.geometries} · texturas ${i.memory.textures}`,
      `ratio ${this.renderer.getPixelRatio()}${this.degradado ? ' (bajado)' : ''} · mapas de sombra ${(p.sombras / p.acumulado).toFixed(1)}/s`,
    ].join('\n');
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
      const inicio = anterior;
      const bucle = (t: number) => {
        this.animacion = requestAnimationFrame(bucle);
        // durante los primeros segundos la escena aún se completa (capas que llegan después): sombra siempre fresca
        if (t - inicio < 4000) this.sombraSucia = true;
        const dt = Math.min(0.1, (t - anterior) / 1000);
        anterior = t;
        const t0 = this.perf ? performance.now() : 0;
        if (this.vuelo) this.avanzarVuelo(t);
        this.aplicarGiroYZoom();
        this.controles.update();
        this.limitarDesplazamiento();
        this.mantenerSobreElRelieve();
        this.animarAlzado();
        this.actualizarSombras();
        this.actualizarArboles();
        this.animarNubes(dt);
        this.animarNiebla(dt);
        this.animarPajaros(dt);
        this.animarAvion(dt);
        this.animarEstela(dt);
        this.animarTrafico(dt);
        this.animarHumo();
        this.animarConfluencias();
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
    for (const [cx, cz] of [[0, 0], [400, 0], [-400, 0], [0, 400], [0, -400]]) {
      techo = Math.max(techo, this.alturaEn(this.lon0 + (p.x + cx) / this.mLon, this.lat0 - (p.z + cz) / this.mLat));
    }
    const minimo = techo + MARGEN_CAMARA_RELIEVE;
    if (p.y >= minimo) return;
    p.y = minimo;
    this.camara.lookAt(this.controles.target);
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
    (malla.material as THREE.MeshBasicMaterial).onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float tinte;
          varying float vTinte;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vTinte = tinte;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vTinte;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          // las hebras de la corriente son lo claro de la textura (mucho rojo); ahí el río va azul y en el resto, su color
          float onda = smoothstep(0.25, 0.7, diffuseColor.r);
          vec3 medellin = mix(vec3(0.429, 0.296, 0.063), vec3(0.06, 0.36, 0.78), onda);
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
      xm.arc(px, py, (RADIO_FABRICA + 4) / (this.ancho / W), 0, Math.PI * 2);
      xm.fill();
    }
    for (const q of this.equipamientos) {                     // ni dentro de un equipamiento
      const [px, py] = aPx(q.lon, q.lat);
      xm.beginPath();
      xm.arc(px, py, (q.r + 3) / (this.ancho / W), 0, Math.PI * 2);
      xm.fill();
    }
    const urbano = xm.getImageData(0, 0, W, H).data;

    // colocación
    let semilla = 20251028;
    const azar = () => {            // mulberry32: mismo bosque en cada carga
      semilla = (semilla + 0x6D2B79F5) | 0;
      let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const lista: { x: number; y: number; z: number; sxz: number; sy: number; tono: number; id: number; peso: number }[] = [];
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
        });
      }
    }
    if (!lista.length) return;

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
    // una malla instanciada por tesela (y por nivel de detalle): la GPU descarta las que no se ven
    const porTesela = new Map<number, typeof lista>();
    for (const a of lista) {
      const clave = this.claveTesela(a.x, a.z);
      if (!porTesela.has(clave)) porTesela.set(clave, []);
      porTesela.get(clave)!.push(a);
    }
    const m4 = new THREE.Matrix4(), color = new THREE.Color();
    const eje = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), p = new THREE.Vector3(), esc = new THREE.Vector3();
    this.teselasArboles = [];
    for (const grupo of porTesela.values()) {
      const aZona = new Float32Array(grupo.length), aPeso = new Float32Array(grupo.length);
      const cerca = new THREE.InstancedMesh(arbol.clone(), material, grupo.length);
      grupo.forEach((a, i) => {
        m4.compose(p.set(a.x, a.y, a.z), q.setFromAxisAngle(eje, azar() * 6.28), esc.set(a.sxz, a.sy, a.sxz));
        cerca.setMatrixAt(i, m4);
        // variación de verdes entre árboles
        cerca.setColorAt(i, color.setRGB(0.82 + a.tono * 0.3, 0.9 + a.tono * 0.2, 0.78 + (1 - a.tono) * 0.2));
        aZona[i] = a.id >= 0 ? a.id : 31;
        aPeso[i] = a.peso;
      });
      const atributos = [new THREE.InstancedBufferAttribute(aZona, 1), new THREE.InstancedBufferAttribute(aPeso, 1)];
      cerca.geometry.setAttribute('aZona', atributos[0]);
      cerca.geometry.setAttribute('aPeso', atributos[1]);
      // la versión simple comparte matrices, colores y atributos con la completa
      const lejos = new THREE.InstancedMesh(simple.clone(), material, grupo.length);
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
    }
  }

  private liberar(): void {
    cancelAnimationFrame(this.animacion);
    this.controles?.dispose();
    this.renderer?.dispose();
    this.terreno?.geometry.dispose();
    this.rtNubes?.dispose();
    this.texturasNubes.forEach(t => t.dispose());
    for (const n of this.nubes) for (const b of n.bocanadas) b.sprite.material.dispose();
    this.disco?.material.dispose();
    for (const n of this.nieblas) n.sprite.material.dispose();
    this.geoIndustrias?.dispose();
    this.matIndustrias?.dispose();
    this.geoEquip?.dispose();
    this.matEquip?.dispose();
    this.humoInst?.malla.geometry.dispose();
    (this.humoInst?.malla.material as THREE.Material | undefined)?.dispose();
    this.geoAutos.forEach(g => g.dispose());
    this.matAutos.forEach(m => m.dispose());
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

  /** Acerca el levantamiento de cada vereda a su meta (hover o elegida) con una suave aceleración. */
  private animarAlzado(): void {
    let cambio = false;
    this.piezas.forEach((_, id) => {
      const meta = id === this.elegida ? ALZA_ELEGIDA : id === this.hover ? ALZA_HOVER : 0;
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
    const ocupados: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const v = new THREE.Vector3();
    // vista casi a ras del mapa: los nombres quedarían sobre la pared frontal de la maqueta, así que se ocultan
    const mira = this.camara.position.clone().sub(this.controles.target);
    if (Math.acos(mira.y / mira.length()) > ANGULO_OCULTAR_NOMBRES) {
      for (const p of this.piezas) p.rotulo!.style.display = 'none';
      if (this.rotuloRio) this.rotuloRio.style.display = 'none';
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
      const ancho = (el.offsetWidth || p.zona.n.length * 6) * escala, alto = (el.offsetHeight || 16) * escala;
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
      ocupados.push(caja);
      el.classList.toggle('activo', activo);
      el.style.transform = `translate(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight - 8 + dy}px) scale(${escala})`;
    }
    this.actualizarRotuloRio(w, h, Math.max(0.9, escala));
    this.actualizarRotuloFabrica(w, h, Math.max(0.9, escala));
    this.actualizarRotuloEquip(w, h, Math.max(0.9, escala));
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

  alMover(ev: PointerEvent): void {
    if (ev.buttons & 4) {                      // rueda presionada: gira el mapa en horizontal
      this.vuelo = null;
      this.giroPendiente -= ev.movementX * 0.006;
      this.inclinacionPendiente += ev.movementY * 0.006;
      return;
    }
    if (ev.buttons) return;
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
    // los cauces tienen prioridad sobre la vereda que los rodea
    const rio = this.rioBajoCursor(ev);
    if (rio !== this.rioHover) { this.rioHover = rio; this.pintarHalos(); }
    if (rio) {
      if (this.hover !== -1) { this.hover = -1; this.pintarResalte(); }
      this.lienzo.nativeElement.style.cursor = 'pointer';
      return;
    }
    const id = this.idBajoCursor(ev);
    if (id !== this.hover) { this.hover = id; this.pintarResalte(); }
    this.lienzo.nativeElement.style.cursor = id >= 0 ? 'pointer' : 'grab';
  }

  alSalir(): void {
    this.marcarFabricaHover(-1);
    this.marcarEquipHover(-1);
    this.hover = -1;
    this.rioHover = null;
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
    const fab = this.fabricaBajoCursor(ev);
    if (fab >= 0) {                                      // clic en una fábrica: la elige; otro clic en la misma, la suelta
      this.seleccionarFabrica(fab === this.fabricaElegida ? -1 : fab);
      return;
    }
    const eq = this.equipBajoCursor(ev);
    if (eq >= 0) {                                       // clic en un equipamiento: la cámara se acerca a él
      const q = this.equipamientos[eq];
      const objetivo = new THREE.Vector3(q.x, this.alturaXZ(q.x, q.z) + 10, q.z);
      this.volarA(objetivo.clone().add(this.camara.position.clone().sub(this.controles.target).normalize().multiplyScalar(450)), objetivo);
      return;
    }
    const rio = this.rioBajoCursor(ev);
    if (rio) {                                           // clic en un cauce: lo elige; otro clic en el mismo, lo suelta
      this.seleccionarRio(rio === this.rioElegido ? null : rio);
      return;
    }
    this.seleccionarFabrica(-1);
    const id = this.idBajoCursor(ev);
    // un clic en la zona ya elegida, o fuera de toda zona, la deselecciona y la baja
    if (id < 0 || id === this.elegida) {
      this.deseleccionar();
      this.seleccionarRio(null);
    } else {
      this.elegir(id);
    }
  }

  private deseleccionar(): void {
    if (this.elegida < 0) return;
    this.elegida = -1;
    this.seleccion.set(null);
    this.pintarResalte();
  }

  private elegir(id: number): void {
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
    return i;
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
    return i;
  }

  /** Cápsula con el nombre del lugar y el color de su categoría sobre el equipamiento señalado. */
  private marcarEquipHover(i: number): void {
    this.equipHover = i;
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
    if (!el) return;
    if (!q) { el.style.display = 'none'; return; }
    const v = new THREE.Vector3(q.x, this.alturaXZ(q.x, q.z) + q.r * 0.9, q.z).project(this.camara);
    const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    const visible = v.z < 1 && x > 0 && x < w && y > 0 && y < h;
    el.style.display = visible ? '' : 'none';
    if (visible) el.style.transform = `translate(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight - 8}px) scale(${escala})`;
  }

  /** Marca la fábrica bajo el cursor: anillo claro a su alrededor y una cápsula con el nombre de la empresa. */
  private marcarFabricaHover(i: number): void {
    this.fabricaHover = i;
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
    this.anilloHover.visible = true;
    if (!this.rotuloFabrica) {
      this.rotuloFabrica = document.createElement('div');
      this.rotuloFabrica.className = 'rot fabrica';
      this.rotuloFabrica.append(document.createElement('i'), document.createElement('span'));
      this.contenedorRotulos.nativeElement.appendChild(this.rotuloFabrica);
    }
    this.rotuloFabrica.lastElementChild!.textContent = f.datos.n;
    this.rotuloFabrica.style.display = '';
  }

  /** Elige (o suelta, con -1) una fábrica: muestra su ficha, la marca con un anillo y, si `volar`, encuadra la cámara. */
  private seleccionarFabrica(i: number, volar = true): void {
    this.fabricaElegida = i;
    if (this.anilloFabrica) this.anilloFabrica.visible = false;
    if (i < 0) { this.fabricaSeleccion.set(null); return; }
    this.deseleccionar();
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
    this.anilloFabrica.visible = true;
    if (volar) {
      const objetivo = new THREE.Vector3(f.x, this.alturaXZ(f.x, f.z) + 40, f.z);
      this.volarA(objetivo.clone().add(this.camara.position.clone().sub(this.controles.target).normalize().multiplyScalar(1900)), objetivo);
    }
  }

  vistaGeneral(): void {
    this.seleccionarFabrica(-1, false);
    this.seleccionarRio(null, false);
    this.elegida = -1;
    this.seleccion.set(null);
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
    dibujar(this.elegida, 'rgba(255,200,60,.3)', 'rgba(255,190,30,1)', 0);
    if (this.hover !== this.elegida) dibujar(this.hover, 'rgba(255,255,255,.2)', 'rgba(255,255,255,1)', 0);
    this.texturaResalte.needsUpdate = true;
  }
}
