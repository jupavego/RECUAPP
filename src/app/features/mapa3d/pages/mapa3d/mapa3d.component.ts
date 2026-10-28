import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  AfterViewInit, Component, DestroyRef, ElementRef, NgZone, ViewChild, inject, signal,
} from '@angular/core';
import { Observable, catchError, forkJoin, of } from 'rxjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MapaService, Municipio, Zona } from '../../../mapa/services/mapa.service';
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
/** Ancho dibujado de las vías por clase (principal, local, sendero), en metros del modelo. */
const ANCHO_VIA = [34, 17, 8];
/** Los cauces se dibujan a su ancho real × este factor (el Río Medellín: 30 m → 66 m), con un mínimo para que se lean. */
const FACTOR_ANCHO_CAUCE = 2.2;
const ANCHO_MIN_CAUCE = 6;
/** Puentes: solo donde el cauce dibujado mide al menos esto (metros del modelo); tablero, barandas y su amarillo. */
const ANCHO_MIN_PUENTE = 20;
const COLOR_BARANDA = '#f6c312';
/** Cuánto vira a café el agua del Río Medellín (0 = azul, 1 = café pleno). */
const TINTE_MEDELLIN = 0.9;
/** Bandada que cruza el Río Medellín de sur a norte: cuántos pájaros, velocidad (m/s del modelo), recorrido total y pausa entre pasadas. */
const PAJAROS = 11;
const VELOCIDAD_PAJAROS = 130;
const RECORRIDO_PAJAROS = 6800;
const PAUSA_PAJAROS = 14;
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
        @if (hayPoblacion()) {
          <div class="anios" role="group" aria-label="Año de la población">
            <span>Año</span>
            @for (a of aniosPoblacion; track a) {
              <button type="button" [class.activo]="a === anio()" [attr.aria-pressed]="a === anio()" (click)="cambiarAnio(a)">{{ a }}</button>
            }
          </div>
        }
        <button type="button" (click)="vistaGeneral()">Vista general</button>
        <p class="ayuda">Arrastra para desplazarte · rueda para acercar · rueda presionada para girar e inclinar · clic derecho para inclinar</p>
      } @else if (rioSeleccion() || seleccion()) {
        <p class="resumen">{{ rioSeleccion()?.nombre ?? seleccion()!.n }}</p>
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
      background: rgba(255,255,255,.95); color: #243746; box-shadow: 0 2px 8px rgba(15,35,55,.35);
      font: 800 10px/1.1 'Nunito', ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; letter-spacing: .01em; }
    .rotulos ::ng-deep .rot i { flex: none; width: 7px; height: 7px; border-radius: 50%;
      border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(36,55,70,.35); }
    .rotulos ::ng-deep .rot::after { content: ''; position: absolute; left: 50%; bottom: -3px; width: 6px; height: 6px;
      margin-left: -3px; background: inherit; transform: rotate(45deg); border-radius: 0 0 2px 0; }
    .rotulos ::ng-deep .rot.cabecera { font-size: 11.5px; padding: 3px 9px 3px 6px; }
    .rotulos ::ng-deep .rot.activo { font-size: 12.5px; padding: 4px 11px 4px 7px; background: #fff7e0;
      box-shadow: 0 0 0 2.5px #ffb81f, 0 6px 16px rgba(15,35,55,.4); z-index: 2; }
    .rotulos ::ng-deep .rot.activo i { width: 9px; height: 9px; }
    .rotulos ::ng-deep .rot.agua { background: rgba(222,242,253,.95); color: #0b4f7a; font-style: italic; }
    .rotulos ::ng-deep .rot.agua i { background: #2c88c8; }
    .creditos { position: absolute; left: 16px; bottom: 8px; margin: 0; max-width: calc(100% - 90px); pointer-events: none;
      font: 600 10px/1.3 system-ui; color: rgba(255,255,255,.92); text-shadow: 0 1px 3px rgba(0,0,0,.7); }
    .zoom { position: absolute; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 6px; }
    .zoom button { width: 38px; height: 38px; padding: 0; border-radius: 12px; font: 700 1.3rem/1 system-ui;
      background: rgba(255,255,255,.9); color: #26425a; box-shadow: 0 3px 12px rgba(30,60,90,.25); }
    .zoom button:hover { background: #fff; }
    .panel { position: absolute; top: 16px; left: 16px; width: 260px; padding: 14px 16px; border-radius: 16px;
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
  private nubes: Nube[] = [];
  private nieblas: Neblina[] = [];
  private pajaros: Pajaro[] = [];
  private bocas: { x: number; z: number; dx: number; dz: number }[] = [];
  private confluencias: { espuma: THREE.Mesh; fase: number; largo: number }[] = [];
  private texturasConfluencia: THREE.Texture[] = [];
  private materialesConfluencia: THREE.Material[] = [];
  private rutaPajaros: { x: number; z: number } | null = null;
  private tiempoPajaros = 0;
  private geosPajaros: THREE.BufferGeometry[] = [];
  private materialesPajaros: THREE.Material[] = [];
  private readonly vientoVista = new THREE.Vector3();
  private disco: THREE.Sprite | null = null;
  private texturasNubes: THREE.Texture[] = [];
  /** por nube: x, z de su sombra sobre el terreno, radio y opacidad (el shader del terreno los lee) */
  private readonly sombrasNubes = Array.from({ length: NUBES }, () => new THREE.Vector4(0, 0, 1, 0));
  private mallaEdificios: THREE.Mesh | null = null;
  // edificios dibujados según la población del año elegido
  private edificiosBase: Compacto | null = null;
  private poblacion: PoblacionVeredas | null = null;
  private capaEdificios: Capa | null = null;
  /** vereda (índice) → población y viviendas del año elegido */
  private datosPorVereda = new Map<number, { pob: number; viv: number }>();
  private mallaArboles: THREE.InstancedMesh | null = null;
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
      poblacion: this.http.get<PoblacionVeredas>(`data/mapa/poblacion/veredas-${CODIGO_DANE}.geojson`).pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ relieve, muni, terr, foto, vias, edificios, cauces, poblacion }) => {
        try {
          this.foto = foto;
          this.construir(relieve, muni.municipios, terr.v);
          if (vias?.v) this.construirVias(vias);
          if (cauces?.c) this.construirCauces(cauces);
          if (vias?.v && cauces?.c) this.construirPuentes(vias, cauces);
          if (cauces?.c) this.construirPajaros(cauces);
          this.edificiosBase = edificios;
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
    this.posicionarCamara();
    this.crearRotulos();
    this.arrancar();
  }

  private iniciarRender(): void {
    const el = this.lienzo.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(this.renderer.domElement);

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
    this.texturaResalte.colorSpace = THREE.SRGBColorSpace;
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
    const material = new THREE.MeshStandardMaterial({ map: this.texturaColor, roughness: 1, metalness: 0 });
    // Las caras casi verticales (el corte de una vereda levantada) se pintan de tierra con estratos en vez
    // de la foto estirada. La inclinación sale de las derivadas, así que no depende de normales desactualizadas.
    material.onBeforeCompile = shader => {
      shader.uniforms['uNubes'] = { value: this.sombrasNubes };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vPos;
          uniform vec4 uNubes[${NUBES}];
          float hashN(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float ruidoN(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hashN(i), hashN(i + vec2(1.0, 0.0)), f.x), mix(hashN(i + vec2(0.0, 1.0)), hashN(i + vec2(1.0, 1.0)), f.x), f.y);
          }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float inclinacion = abs(normalize(cross(dFdx(vPos), dFdy(vPos))).y);
          float roca = 1.0 - smoothstep(0.30, 0.55, inclinacion);
          float estrato = 0.5 + 0.5 * sin(vPos.y * 0.11);
          vec3 tierra = mix(vec3(0.40, 0.28, 0.18), vec3(0.60, 0.46, 0.30), estrato);
          diffuseColor.rgb = mix(diffuseColor.rgb, tierra, roca);
          // sombra de las nubes: manchas de borde difuso y irregular que viajan con cada nube
          float despejado = 1.0;
          for (int i = 0; i < ${NUBES}; i++) {
            vec2 q = vPos.xz - uNubes[i].xy;
            float d = length(q) / uNubes[i].z;
            float r = ruidoN(q * 0.0007) * 0.6 + ruidoN(q * 0.0022) * 0.4;
            despejado *= 1.0 - smoothstep(1.05, 0.2, d + (r - 0.5) * 0.7) * uNubes[i].w;
          }
          diffuseColor.rgb *= mix(vec3(${(1 - SOMBRA_NUBE).toFixed(2)}, ${(1 - SOMBRA_NUBE * 0.8).toFixed(2)}, ${(1 - SOMBRA_NUBE * 0.55).toFixed(2)}), vec3(1.0), despejado);`);
    };
    this.terreno = new THREE.Mesh(fino.g, material);
    this.terreno.receiveShadow = true;
    this.terreno.castShadow = true;
    this.escena.add(this.terreno);

    // resalte: misma geometría, capa transparente encima
    const capaResalte = new THREE.MeshBasicMaterial({
      map: this.texturaResalte, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    // el resalte no se pinta sobre las paredes verticales: ahí se vería la textura estirada
    capaResalte.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          if (abs(normalize(cross(dFdx(vPos), dFdy(vPos))).y) < 0.55) discard;`);
    };
    this.escena.add(new THREE.Mesh(fino.g, capaResalte));

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
    if (this.mallaEdificios) {
      this.escena.remove(this.mallaEdificios);
      this.mallaEdificios.geometry.dispose();
      (this.mallaEdificios.material as THREE.Material).dispose();
      this.capas = this.capas.filter(c => c !== this.capaEdificios);
    }
    this.construirEdificios(nuevos);
    // las veredas levantadas ya no están a ras de suelo: la malla nueva debe subir con ellas
    const capa = this.capaEdificios!;
    this.alzado.forEach((alto, id) => {
      for (const k of capa.porPieza[id]) capa.atributo.setY(k, capa.base[k] + alto * capa.peso[k]);
    });
    capa.atributo.needsUpdate = true;
  }

  /** Huellas extruidas. Las alturas casi nunca vienen en los datos: se estiman entre 4,5 y 8,5 m. */
  private construirEdificios(d: Compacto): void {
    const PAREDES = ['#f3e8d6', '#efe0c9', '#f6f0e6', '#ead7bd'].map(c => new THREE.Color(c));
    const TECHOS = ['#c8704f', '#b9825f', '#d6cfc0', '#a3a9ae', '#c98f6a'].map(c => new THREE.Color(c));
    const pos: number[] = [], col: number[] = [], idx: number[] = [], ids: number[] = [], pesos: number[] = [];
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.mallaEdificios = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide,
    }));
    this.mallaEdificios.receiveShadow = true;
    this.escena.add(this.mallaEdificios);
    this.registrarCapa(geo.getAttribute('position') as THREE.BufferAttribute, ids, pesos);
    this.capaEdificios = this.capas[this.capas.length - 1];
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
    for (const m of [this.mallaEdificios, this.mallaArboles]) if (m) m.castShadow = cerca;
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
      const bucle = (t: number) => {
        this.animacion = requestAnimationFrame(bucle);
        const dt = Math.min(0.1, (t - anterior) / 1000);
        anterior = t;
        if (this.vuelo) this.avanzarVuelo(t);
        this.aplicarGiroYZoom();
        this.controles.update();
        this.limitarDesplazamiento();
        this.mantenerSobreElRelieve();
        this.animarAlzado();
        this.actualizarSombras();
        this.animarNubes(dt);
        this.animarNiebla(dt);
        this.animarPajaros(dt);
        this.animarConfluencias();
        if (this.texturaRio) this.texturaRio.offset.y -= dt * VELOCIDAD_AGUA;   // la corriente avanza
        this.renderer.render(this.escena, this.camara);
        this.actualizarRotulos();
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
   * Tinte café para el Río Medellín (aguas turbias). Cada vértice de la cinta lleva un `tinte` 0–1; el shader mezcla el
   * color de la textura hacia un café que conserva la luminosidad de la corriente (las hebras siguen más claras).
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
          float luz = dot(diffuseColor.rgb, vec3(0.30, 0.59, 0.11));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.34, 0.14) * (1.0 + 0.7 * luz), vTinte * ${TINTE_MEDELLIN.toFixed(2)});`);
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
    const aZona = new Float32Array(lista.length), aPeso = new Float32Array(lista.length);
    const malla = new THREE.InstancedMesh(arbol, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1,
    }), lista.length);
    const m4 = new THREE.Matrix4(), color = new THREE.Color();
    lista.forEach((a, i) => {
      m4.compose(new THREE.Vector3(a.x, a.y, a.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), azar() * 6.28),
        new THREE.Vector3(a.sxz, a.sy, a.sxz));
      malla.setMatrixAt(i, m4);
      // variación de verdes entre árboles
      malla.setColorAt(i, color.setRGB(0.82 + a.tono * 0.3, 0.9 + a.tono * 0.2, 0.78 + (1 - a.tono) * 0.2));
      aZona[i] = a.id >= 0 ? a.id : 31;
      aPeso[i] = a.peso;
    });
    arbol.setAttribute('aZona', new THREE.InstancedBufferAttribute(aZona, 1));
    arbol.setAttribute('aPeso', new THREE.InstancedBufferAttribute(aPeso, 1));
    // al levantar una vereda los árboles suben con ella: el desplazamiento se aplica en la GPU
    (malla.material as THREE.MeshStandardMaterial).onBeforeCompile = shader => {
      shader.uniforms['uAlza'] = { value: this.alzadoGpu };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aZona;\nattribute float aPeso;\nuniform float uAlza[32];')
        .replace('#include <project_vertex>', `vec4 mvPosition = vec4( transformed, 1.0 );
          mvPosition = instanceMatrix * mvPosition;
          mvPosition.y += uAlza[int(aZona + 0.5)] * aPeso;
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
    };
    malla.frustumCulled = false;
    malla.receiveShadow = true;
    this.mallaArboles = malla;
    this.escena.add(malla);
  }

  private liberar(): void {
    cancelAnimationFrame(this.animacion);
    this.controles?.dispose();
    this.renderer?.dispose();
    this.terreno?.geometry.dispose();
    this.texturasNubes.forEach(t => t.dispose());
    for (const n of this.nubes) for (const b of n.bocanadas) b.sprite.material.dispose();
    this.disco?.material.dispose();
    for (const n of this.nieblas) n.sprite.material.dispose();
    this.texturasConfluencia.forEach(t => t.dispose());
    this.materialesConfluencia.forEach(m => m.dispose());
    this.geosPajaros.forEach(g => g.dispose());
    this.materialesPajaros.forEach(m => m.dispose());
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
    });
    if (cambio) {
      for (const capa of this.capas) capa.atributo.needsUpdate = true;
    } else if (this.normalesPendientes) {
      this.terreno.geometry.computeVertexNormals();
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
    const rio = this.rioBajoCursor(ev);
    if (rio) {                                           // clic en un cauce: lo elige; otro clic en el mismo, lo suelta
      this.seleccionarRio(rio === this.rioElegido ? null : rio);
      return;
    }
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
    this.seleccionarRio(null, false);
    this.elegida = id;
    this.seleccion.set(this.piezas[id].zona);
    this.pintarResalte();
    const [lat, lon] = this.piezas[id].zona.p;
    const objetivo = new THREE.Vector3(this.aX(lon), this.alturaEn(lon, lat), this.aZ(lat));
    const dir = this.camara.position.clone().sub(this.controles.target).normalize();
    this.volarA(objetivo.clone().add(dir.multiplyScalar(5200)), objetivo);
  }

  vistaGeneral(): void {
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
