import { HttpClient } from '@angular/common/http';
import { TemaService } from '../../../../core/services/tema.service';
import { AfterViewInit, Component, DestroyRef, ElementRef, HostBinding, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Aura, crearAuras } from '../../../mapa3d/utils/aura';
import { CategoriaCatalogo, Modelo, modelarEquipamiento } from '../../../mapa3d/utils/equipamientos';
import { PlanEntidad, PlanService, Seguimiento } from '../../services/plan.service';
import { Resumen, construirResumenes, matizDe } from '../responsables/responsables.component';

const ENTIDAD_PILOTO = '05308';

/** Qué edificio del catálogo del mapa 3D representa a cada responsable de primer nivel. */
const EDIFICIOS: Record<string, { cat: CategoriaCatalogo; tipo: string; nombre: string }> = {
  des: { cat: 'cultura', tipo: 'Casa de cultura', nombre: 'Despacho' },
  edu: { cat: 'educacion', tipo: 'Sede educativa urbana', nombre: 'Educación' },
  sal: { cat: 'salud', tipo: 'Hospital / IPS pública', nombre: 'Hospital' },
  gob: { cat: 'justicia', tipo: 'Estación de policía', nombre: 'Estación' },
  jur: { cat: 'justicia', tipo: 'Personería municipal', nombre: 'Personería' },
  hac: { cat: 'vivienda', tipo: 'Edificio', nombre: 'Edificio' },
  pla: { cat: 'cultura', tipo: 'Biblioteca', nombre: 'Biblioteca' },
  inf: { cat: 'industria', tipo: 'Industria', nombre: 'Fábrica' },
  agri: { cat: 'turismo', tipo: 'Economía campesina / mercado local', nombre: 'Mercado' },
  amb: { cat: 'turismo', tipo: 'Atractivo natural / ecoturismo', nombre: 'Cascada' },
  tra: { cat: 'patrimonio', tipo: 'Bien de interés cultural nacional', nombre: 'Estación' },
  adm: { cat: 'vivienda', tipo: 'Edificio', nombre: 'Edificio' },
  com: { cat: 'cultura', tipo: 'Emisora comunitaria', nombre: 'Emisora' },
  cid: { cat: 'vivienda', tipo: 'Edificio', nombre: 'Edificio' },
  cia: { cat: 'cultura', tipo: 'Escuela de música', nombre: 'Escuela' },
};

/**
 * Casco urbano real de Girardota, extraído de los datos del mapa 3D (relieve del IGAC, vías, quebradas y huellas de edificios de OSM):
 * `alturas` es una malla de nx × nz celdas de `paso` m (m sobre el punto más bajo), x hacia el este y z hacia el sur desde el centro;
 * `vias`, `rios` y `casas` van en metros desde ese mismo centro; `sitios` son los puntos libres elegidos para cada responsable [x, z, giro].
 */
interface Diorama {
  centro: [number, number];
  ancho: number; fondo: number; paso: number; nx: number; nz: number;
  alturas: number[];
  sitios: Record<string, [number, number, number]>;
  vias: [number, number[]][];
  rios: [number, number[]][];
  casas: [number, number, number, number][];
}

/** Exageración vertical del relieve, para que las laderas se lean como montaña. */
const EXA = 2.3;
/** Fondo de la isla (m bajo el punto más bajo) y paleta alegre con la que se pintan casas y edificios. */
const FONDO = 90;
const PALETA = ['#f4c542', '#e86a5f', '#5aa9e6', '#f29ac0', '#8fd175', '#f59e42', '#9b8de0', '#4fc3b5', '#f3e3c3'];
const TEJAS = ['#b5532f', '#c26a45', '#9e4527', '#a9532f'];
/** ¿Es un color neutro y claro (paredes, concreto)? Esos son los que se repintan; ventanas, techos y vidrios se quedan. */
const esNeutro = (hex: string): boolean => { const c = new THREE.Color(hex), h = { h: 0, s: 0, l: 0 }; c.getHSL(h); return h.s < 0.3 && h.l > 0.45; };

const hash = (i: number, j: number): number => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function ruido(x: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * u, b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * u;
  return a + (b - a) * v;
}

let RELIEVE: Diorama | null = null;
/** Eje del río que serpentea por el norte del valle (z en función de x), y su ancho y hondura. */
const zRio = (x: number): number => -420 + 38 * Math.sin(x / 105) + 16 * Math.sin(x / 41 + 1.7);
const ANCHO_RIO = 26;
/** Radio (m) de la explanada de cada edificio y ancho del talud con el que se funde con la ladera. */
const PADS: Record<string, number> = { agri: 28, amb: 61, gob: 28, hac: 18, inf: 52, pla: 29, sal: 37, adm: 18, tra: 66, edu: 35, com: 23, jur: 27, cid: 18, cia: 32, des: 30 };
const TALUD = 18;
/** Explanadas aplanadas en el terreno: centro, radio y cota. */
let PLATAFORMAS: { x: number; z: number; r: number; y: number }[] = [];
/** Entorno de cada puente: ahí las explanadas no tocan el relieve, para que el tablero y sus rampas queden coherentes. */
let ZONAS_PUENTE: { x: number; z: number; r: number }[] = [];
const HONDO_RIO = 5;
/** Altura del terreno (exagerada) en x, z metros desde el centro del casco urbano. */
export function alturaTerreno(x: number, z: number, conPlataformas = true): number {
  const d = RELIEVE;
  if (!d) return 0;
  const fx = Math.min(Math.max((x + d.ancho / 2) / d.paso, 0), d.nx - 1.001), fz = Math.min(Math.max((z + d.fondo / 2) / d.paso, 0), d.nz - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const h = (a: number, b: number) => d.alturas[b * d.nx + a];
  const base = ((h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - tz) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * tz) * EXA;
  // cauce del río: una zanja suave a lo largo de su eje
  const t = Math.max(0, 1 - Math.abs(z - zRio(x)) / (ANCHO_RIO * 1.3));
  let alto = base - HONDO_RIO * t * t * (3 - 2 * t);
  if (conPlataformas) {
    // cada edificio asienta su explanada: dentro del radio el suelo es plano y alrededor baja (o sube) en un talud hasta la ladera
    for (const p of PLATAFORMAS) {
      const dist = Math.hypot(x - p.x, z - p.z);
      if (dist >= p.r + TALUD) continue;
      // la explanada no toca el cauce del río: ahí manda el relieve natural (puentes y orillas)
      const lejosRio = Math.min(1, Math.max(0, (Math.abs(z - zRio(x)) - ANCHO_RIO * 0.9) / 14));
      let lejosPuente = 1;
      for (const zn of ZONAS_PUENTE) lejosPuente = Math.min(lejosPuente, Math.max(0, (Math.hypot(x - zn.x, z - zn.z) - zn.r) / 16));
      const k = dist <= p.r ? 0 : (dist - p.r) / TALUD, w = (1 - k * k * (3 - 2 * k)) * lejosRio * lejosRio * (3 - 2 * lejosRio) * lejosPuente * lejosPuente * (3 - 2 * lejosPuente);
      alto = alto * (1 - w) + p.y * w;
    }
  }
  return alto;
}

/** Granja solar: filas de paneles inclinados sobre soportes, con una caseta de control e inversores. */
function granjaSolar(): Modelo {
  const piezas: Modelo['piezas'] = [];
  const caja = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, rx = 0): void => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    piezas.push({ g: g.translate(x, y, z), color });
  };
  const filas = 4, columnas = 5, ancho = 9, fondo = 5.2, paso = 13;
  for (let i = 0; i < filas; i++) {
    for (let j = 0; j < columnas; j++) {
      const x = (j - (columnas - 1) / 2) * (ancho + 1.2), z = (i - (filas - 1) / 2) * paso - 4;
      caja(ancho, 0.35, fondo, '#17306b', x, 3.4, z, -0.5);                       // panel
      caja(ancho + 0.3, 0.12, fondo + 0.3, '#cbd5e1', x, 3.34, z, -0.5);          // marco
      caja(0.4, 3, 0.4, '#8b949e', x - ancho / 3, 1.5, z + 1.2);                  // soportes
      caja(0.4, 3.9, 0.4, '#8b949e', x + ancho / 3, 1.95, z + 1.2);
    }
  }
  caja(10, 4.6, 7, '#e8eaed', -(columnas * (ancho + 1.2)) / 2 + 2, 0, 24);          // caseta de control
  caja(10.6, 0.5, 7.6, '#9aa0a6', -(columnas * (ancho + 1.2)) / 2 + 2, 4.6, 24);
  for (let k = 0; k < 3; k++) caja(1.6, 2.4, 1.2, '#f3f4f6', 8 + k * 2.6 - (columnas * (ancho + 1.2)) / 2 + 2, 0, 24);  // inversores
  caja(0.5, 9, 0.5, '#6b7280', 24, 0, 24);                                          // poste de la línea
  caja(5, 0.4, 0.4, '#6b7280', 24, 8.4, 24);
  // aerogenerador (el rotor gira aparte) y, a su lado, el edificio de monitoreo con antena y parabólica
  piezas.push({ g: new THREE.CylinderGeometry(0.9, 1.7, EOLICA.alto, 12).translate(EOLICA.x, EOLICA.alto / 2, EOLICA.z), color: '#e8ecef' });
  caja(3, 3, 8, '#dfe4e8', EOLICA.x, EOLICA.alto - 3, EOLICA.z - 0.5);
  caja(18, 0.5, 14, '#9aa0a6', EOLICA.x, 0, 10);
  caja(13, 5.4, 9, '#f1f3f5', EOLICA.x, 0.5, 10);
  caja(14, 0.6, 10, '#5f6b76', EOLICA.x, 5.9, 10);
  caja(11, 1.3, 0.2, '#2f4a5e', EOLICA.x, 2.4, 14.55);
  caja(1.4, 2.3, 0.2, '#3f5a48', EOLICA.x + 5, 0.5, 14.55);
  caja(0.3, 9, 0.3, '#6b7280', EOLICA.x - 4.5, 6.5, 8);
  caja(2.4, 0.2, 0.2, '#6b7280', EOLICA.x - 4.5, 14, 8);
  piezas.push({ g: new THREE.SphereGeometry(1.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2.6).translate(EOLICA.x + 3.5, 7.8, 9), color: '#f3f4f6' });
  caja(1.8, 1.2, 1.2, '#f3f4f6', EOLICA.x + 6.5, 0.5, 4.5);
  return { piezas, radio: 62, losa: [118, 62] };
}

/** Dónde queda el aerogenerador dentro de la granja (m del modelo). */
const EOLICA = { x: 44, z: -22, alto: 36 };

/** Un tramo de calle por el que circulan los vehículos y la gente: puntos [x, z…] con la distancia acumulada en cada uno. */
interface Ruta { pts: number[]; cum: number[]; total: number; clase: number; }
interface Agente { ruta: Ruta; s: number; dir: 1 | -1; vel: number; lado: number; i: number; }
/** Un tipo de vehículo o de persona: una malla instanciada por pieza del modelo, y quienes la usan. */
interface Flota { mallas: THREE.InstancedMesh[]; escala: number; eje: 'x' | 'z'; agentes: Agente[]; faros?: THREE.Points; colas?: THREE.Points; }

/** Alza de las calles sobre el relieve y ancho de cada clase de vía. */
const ALZA_CALLE = 2.4;
/** Velocidad de la bandada de pájaros (m/s). */
const VELOCIDAD_PAJAROS = 70;
const ANCHO_CALLE = [15, 9, 4];

/** Pájaro de la bandada: el cuerpo y los pivotes de hombros y codos que aletean, y su sitio dentro de la V. */
interface Pajaro {
  grupo: THREE.Group; izq: THREE.Object3D; der: THREE.Object3D; codoIzq: THREE.Object3D; codoDer: THREE.Object3D;
  ox: number; oz: number; oy: number; y: number; fase: number; ritmo: number;
}
/** Chimenea que echa humo: su boca y las bocanadas que suben, se ensanchan y se desvanecen. */
interface Humo { x: number; y: number; z: number; puffs: THREE.Sprite[]; }

/** Cúmulo del fondo: bocanadas con su sitio relativo, deriva con el viento y ciclo de vida (nace, se ve, se deshace). */
interface Nube {
  puffs: { sp: THREE.Sprite; dx: number; dy: number; dz: number; tam: number; op: number; claro: number }[];
  x: number; y: number; z: number; vx: number; vz: number; edad: number; vida: number; espera: number;
}

interface Edificio {
  r: Resumen;
  grupo: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  x: number; z: number; y: number; cima: number; radio: number;
  pin: Pin;
}
interface Pin { sprite: THREE.Sprite; aspecto: number; tex: THREE.CanvasTexture; }

/** Pueblo 3D: cada responsable de la alcaldía es un edificio sobre el casco urbano real de Girardota; se explora, se toca y se salta a su ficha. */
@Component({
  selector: 'app-pueblo',
  standalone: true,
  imports: [RouterLink],
  template: `
    <header class="titulo">
      <div class="titulo__txt">
        <span class="titulo__ojo">{{ plan()?.municipio ?? 'Girardota' }} · Plan de desarrollo 2024-2027</span>
        <h1>Conoce a los responsables del plan</h1>
        <p>Cada pin del pueblo es una dependencia de la alcaldía: pasa el cursor para ver quién la dirige y toca para abrir su ficha.</p>
      </div>
      <button type="button" class="titulo__ley" [class.on]="leyenda()" [attr.aria-expanded]="leyenda()" (click)="leyenda.set(!leyenda())">☰ {{ leyenda() ? 'Ocultar la lista' : 'Ver la lista de responsables' }}</button>
    </header>
    <div class="cuerpo" [class.cuerpo--ley]="leyenda()">
      @if (leyenda()) {
      <aside class="leyenda" aria-label="Leyenda de responsables">
      <h2>Responsables</h2>
      @for (r of resumenes(); track r.dep.id) {
        <button type="button" [class.on]="elegido()?.dep?.id === r.dep.id" [style.--h]="matiz(r.dep.id)" (click)="elegir(r.dep.id)" (mouseenter)="resaltar(r.dep.id)" (mouseleave)="resaltar(null)">
          @if (icono(r); as u) { <img [src]="u" alt="" width="26" height="26" /> } @else { <i>{{ r.dep.nombre.charAt(0) }}</i> }
          <span>{{ corto(r.dep.nombre) }}</span>
          <b>{{ r.avance !== null ? entero(r.avance) + '%' : '—' }}</b>
        </button>
      }
    </aside>
      }

      <div class="mapa">
        <div #lienzo class="lienzo" [class.lienzo--mano]="sobre()"></div>
        @for (t of tipLista(); track t.r.dep.id) {
      <div class="tip tarj" [style.left.px]="colocar(t.x, t.y).x" [style.top.px]="colocar(t.x, t.y).y" [style.--acento-h]="matiz(t.r.dep.id)" role="status">
        <span class="tarj__cielo" aria-hidden="true"></span>
        @if (icono(t.r); as u) { <img class="tarj__ico" [src]="u" alt="" width="84" height="84" /> } @else { <i class="tarj__vacio">{{ t.r.dep.nombre.charAt(0) }}</i> }
        <span class="tarj__anillo" [class]="'tarj__anillo ' + claseAvance(t.r.avance)" role="img" [attr.aria-label]="t.r.avance !== null ? entero(t.r.avance) + ' % de avance' : 'Sin indicadores en el informe'">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="tarj__pista" cx="60" cy="60" r="52" /><circle class="tarj__valor" cx="60" cy="60" r="52" [style.stroke-dashoffset]="anilloOffset(t.r.avance)" /></svg>
          <span class="tarj__pct">{{ t.r.avance !== null ? entero(t.r.avance) : '—' }}<small>{{ t.r.avance !== null ? '%' : '' }}</small></span>
        </span>
        <span class="tarj__nombre">{{ t.r.dep.nombre }}</span>
        <span class="tarj__quien">
          @if (t.r.dep.responsable; as q) { <b>{{ q.nombre }}</b><em>{{ q.cargo }}</em> } @else { <em>Persona a cargo sin identificar en el sitio</em> }
        </span>
        <span class="tarj__datos">
          <span><b>{{ t.r.alta + t.r.sugerida }}</b> productos</span>
          <span><b>{{ t.r.equipo }}</b> funcionarios</span>
          @if (t.r.grupo.length > 1) { <span><b>{{ t.r.grupo.length - 1 }}</b> {{ t.r.grupo.length === 2 ? 'subdependencia' : 'subdependencias' }}</span> }
        </span>
        <span class="tarj__reparto"><i class="alta" [style.width.%]="porcentaje(t.r.alta)"></i><i class="sug" [style.width.%]="porcentaje(t.r.sugerida)"></i></span>
        <span class="tarj__estado" [class]="'tarj__estado ' + claseAvance(t.r.avance)">
          @if (t.r.avance !== null) { {{ t.r.conSeguimiento }} con informe · {{ t.r.cumplidos }} cumplidos · {{ t.r.atrasados }} bajo 50 % } @else { Sin indicadores en el informe }
        </span>
      </div>
    }
        @if (elegido(); as r) {
      <aside class="ficha" [style.--h]="matiz(r.dep.id)" aria-live="polite">
        <button type="button" class="ficha__cerrar" aria-label="Cerrar" (click)="soltar()">×</button>
        <span class="ficha__tipo">{{ r.dep.tipo }}</span>
        <h2>{{ r.dep.nombre }}</h2>
        @if (r.dep.responsable; as q) { <p class="ficha__quien"><b>{{ q.nombre }}</b><span>{{ q.cargo }}</span></p> } @else { <p class="ficha__quien"><span>La alcaldía no publica quién la dirige.</span></p> }
        <dl>
          <div><dt>Productos</dt><dd>{{ r.alta + r.sugerida }}</dd></div>
          <div><dt>Equipo</dt><dd>{{ r.equipo }}</dd></div>
          <div><dt>Avance</dt><dd>{{ r.avance !== null ? entero(r.avance) + ' %' : '—' }}</dd></div>
        </dl>
        <span class="barra"><i [style.width.%]="r.avance ?? 0" [class]="clase(r.avance)"></i></span>
        <a class="ficha__ir" [routerLink]="['/responsables', r.dep.id]">Ver ficha completa →</a>
      </aside>
    }
        <div class="reloj" [class.abierto]="relojAbierto()" role="group" aria-label="Hora del día en la maqueta">
          <button type="button" class="reloj__h" (click)="relojAbierto.set(!relojAbierto())" [attr.aria-expanded]="relojAbierto()" aria-label="Cambiar la hora del día">{{ hora() }}</button>
          <span class="reloj__mando">
          <input type="range" min="0" max="24" step="0.25" [value]="horaSim" (input)="fijarHora($any($event.target).value)" aria-label="Elegir la hora del día" />
          <button type="button" (click)="alternarCiclo()" [attr.aria-label]="enPausa ? 'Reanudar el ciclo del día' : 'Pausar el ciclo del día'">{{ enPausa ? '▶' : '⏸' }}</button>
          </span>
        </div>
        <p class="ayuda">Arrastra para desplazar · clic derecho para girar · rueda para acercar</p>
      </div>
    </div>
  `,
  styles: [`
    :host {
      background: var(--color-page-bg, #f5f0ea); font-family: Inter, system-ui, sans-serif; color: #1f3326; }
        .titulo { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 20px 4px; }
    .titulo__ojo { font-size: .72rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #3D5C3D; }
    .titulo__ley { flex: none; min-height: 44px; padding: 0 16px; border: 1px solid #C8D9C0; border-radius: 999px; font: inherit; font-size: .85rem; font-weight: 700; cursor: pointer;
      background: #29422F; color: #fcf9f6; }
    .titulo__ley.on { background: #fcf9f6; color: #29422F; }
    .titulo__ley:focus-visible { outline: 3px solid #66AA33; outline-offset: 2px; }
    h1 { margin: 2px 0 0; font-size: clamp(1.25rem, 2.6vw, 1.75rem); line-height: 1.15; color: #243746; }
    .titulo p { margin: 2px 0 0; font-size: .82rem; color: #3D5C3D; }
    :host { display: flex; flex-direction: column; height: calc(100dvh - 64px); }
    .cuerpo { flex: 1; min-height: 420px; display: grid; grid-template-columns: 1fr; gap: 12px; padding: 12px 12px 0; }
    .cuerpo--ley { grid-template-columns: 280px 1fr; }
    .leyenda { min-height: 0; overflow-y: auto; padding: 2px 4px 2px 0; display: flex; flex-direction: column; gap: 2px; scrollbar-width: thin; }
    .leyenda h2 { margin: 0 6px 6px; font-size: .78rem; letter-spacing: .08em; text-transform: uppercase; color: #29422F; }
    .leyenda button { display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 4px 10px; border: 0; border-radius: 14px; background: transparent;
      font: inherit; font-size: .86rem; font-weight: 600; text-align: left; cursor: pointer; color: hsl(var(--h) 38% 20%); }
    .leyenda button img { width: 28px; height: 28px; object-fit: contain; }
    .leyenda button i { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; font-style: normal; background: hsl(var(--h) 45% 85%); }
    .leyenda button b { font-size: .76rem; color: hsl(var(--h) 38% 30%); font-variant-numeric: tabular-nums; }
    .leyenda button:hover { background: hsl(var(--h) 45% 92%); }
    .leyenda button.on { background: hsl(var(--h) 45% 88%); box-shadow: inset 3px 0 0 hsl(var(--h) 45% 38%); }
    .leyenda button:focus-visible { outline: 3px solid hsl(var(--h) 45% 45%); outline-offset: -2px; }
    .mapa { position: relative; min-width: 0; min-height: 0; border-radius: 24px; overflow: hidden; border: 1px solid #C8D9C0;
      background: linear-gradient(#a9cdee, #d4e6f5 70%, #e6eff7); }
    .lienzo { position: absolute; inset: 0; touch-action: none; }
    .lienzo { cursor: grab; } .lienzo:active { cursor: grabbing; }
    .lienzo--mano, .lienzo--mano:active { cursor: pointer; }
    .tip { position: absolute; z-index: 5; pointer-events: none; max-width: calc(100% - 16px); }
    .tarj { --acento: hsl(var(--acento-h, 110) 38% 30%); --acento-claro: hsl(var(--acento-h, 110) 45% 88%); --av: #cbd5c4;
      box-sizing: border-box; width: 330px; position: relative; overflow: hidden; isolation: isolate; display: grid; gap: 8px; align-content: start; padding: 112px 16px 16px;
      background: #FCF9F6; border: 1px solid #C8D9C0; border-radius: 28px; box-shadow: 0 14px 30px rgba(20, 40, 25, .28); color: #1A1A1A; }
    .tarj { transform-origin: 50% 0; animation: tarj-in .42s cubic-bezier(.2, 1.5, .4, 1) both; }
    .tarj::after { content: ''; position: absolute; inset: -20% auto -20% -60%; width: 40%; z-index: 2; pointer-events: none; transform: skewX(-18deg);
      background: linear-gradient(90deg, transparent, rgb(255 255 255 / .55), transparent); animation: tarj-brillo .9s .12s ease-out both; }
    .tarj__ico { animation: tarj-ico .6s .06s cubic-bezier(.3, 1.7, .5, 1) both, tarj-flota 3.2s .7s ease-in-out infinite; }
    .tarj__anillo { animation: tarj-ico .5s .14s cubic-bezier(.3, 1.6, .5, 1) both; }
    .tarj__valor { animation: tarj-trazo 1s .2s cubic-bezier(.3, .7, .2, 1) both; }
    .tarj__nombre, .tarj__quien, .tarj__datos, .tarj__estado { animation: tarj-sube .45s cubic-bezier(.2, .9, .3, 1) both; }
    .tarj__nombre { animation-delay: .12s; } .tarj__quien { animation-delay: .19s; } .tarj__datos { animation-delay: .26s; } .tarj__estado { animation-delay: .42s; }
    .tarj__reparto i { transform-origin: left; animation: tarj-crece .7s .34s cubic-bezier(.3, .7, .2, 1) both; }
    .tarj__cielo::after { animation: tarj-mancha 7s ease-in-out infinite alternate; }
    @keyframes tarj-in { from { opacity: 0; transform: translateY(16px) scale(.8) rotate(-2.5deg); } to { opacity: 1; transform: none; } }
    @keyframes tarj-brillo { from { left: -60%; opacity: 1; } to { left: 140%; opacity: 0; } }
    @keyframes tarj-ico { from { opacity: 0; transform: scale(.2) rotate(-30deg); } to { opacity: 1; transform: none; } }
    @keyframes tarj-flota { 0%, 100% { translate: 0 0; } 50% { translate: 0 -3px; } }
    @keyframes tarj-trazo { from { stroke-dashoffset: 326.73; } }
    @keyframes tarj-sube { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    @keyframes tarj-crece { from { transform: scaleX(0); } to { transform: none; } }
    @keyframes tarj-mancha { from { transform: rotate(0) scale(1); } to { transform: rotate(24deg) scale(1.18); } }
    @media (prefers-reduced-motion: reduce) { .tarj, .tarj *, .tarj::after { animation: none !important; } }
    .tarj__cielo { position: absolute; inset: 0 0 auto 0; height: 104px; z-index: -1; background: linear-gradient(135deg, var(--acento-claro), transparent 85%); }
    .tarj__cielo::after { content: ''; position: absolute; right: -30px; top: -50px; width: 150px; height: 150px; border-radius: 62% 38% 70% 30% / 50% 60% 40% 50%; background: var(--acento); opacity: .14; }
    .tarj__ico { position: absolute; left: 16px; top: 14px; width: 84px; height: 84px; object-fit: contain; filter: drop-shadow(0 5px 8px rgb(0 0 0 / .22)); }
    .tarj__vacio { position: absolute; left: 16px; top: 14px; display: grid; place-items: center; width: 76px; height: 76px; border-radius: 22px; font-size: 1.8rem; font-style: normal; font-weight: 600; background: #FCF9F6; color: var(--acento); }
    .tarj__anillo { position: absolute; right: 14px; top: 14px; width: 72px; height: 72px; }
    .tarj__anillo.av--ok { --av: #2F7A3A; } .tarj__anillo.av--medio { --av: #66AA33; } .tarj__anillo.av--bajo { --av: #b5523b; }
    .tarj__anillo svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .tarj__anillo circle { fill: none; stroke-width: 12; stroke-linecap: round; }
    .tarj__pista { stroke: #E0EAD8; }
    .tarj__valor { stroke: var(--av); stroke-dasharray: 326.73; }
    .tarj__pct { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; font-weight: 700; font-size: 1.05rem; font-variant-numeric: tabular-nums; }
    .tarj__pct small { font-size: .6rem; margin-left: 1px; align-self: center; }
    .tarj__nombre { font-weight: 600; font-size: 1.05rem; line-height: 1.25; }
    .tarj__quien { display: grid; gap: 1px; font-size: .85rem; }
    .tarj__quien b { color: #1A1A1A; }
    .tarj__quien em { font-style: normal; font-size: .76rem; color: #3D5C3D; }
    .tarj__datos { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .78rem; color: #3D5C3D; }
    .tarj__datos b { font-size: 1.05rem; color: var(--acento); }
    .tarj__reparto { display: flex; height: 6px; border-radius: 999px; overflow: hidden; background: #E0EAD8; }
    .tarj__reparto i { display: block; height: 100%; }
    .tarj__reparto .alta { background: #29422F; } .tarj__reparto .sug { background: #99CC33; }
    .tarj__estado { font-size: .74rem; padding-left: 8px; border-left: 3px solid var(--av); color: #3D5C3D; }
    .tarj__estado.av--ok { --av: #2F7A3A; } .tarj__estado.av--medio { --av: #66AA33; } .tarj__estado.av--bajo { --av: #b5523b; }
    .ficha { position: absolute; top: 12px; right: 12px; width: min(320px, calc(100% - 24px)); padding: 16px 18px 14px; border-radius: 22px;
      background: rgba(252, 249, 246, .94); backdrop-filter: blur(6px); box-shadow: 0 8px 26px rgba(20, 40, 25, .28); border-top: 5px solid hsl(var(--h) 45% 38%); }
    .ficha__cerrar { position: absolute; top: 8px; right: 10px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; font-size: 1.4rem; cursor: pointer; color: #3D5C3D; }
    .ficha__tipo { font-size: .7rem; letter-spacing: .05em; text-transform: uppercase; color: hsl(var(--h) 38% 30%); }
    .ficha h2 { margin: 2px 24px 6px 0; font-size: 1.1rem; line-height: 1.2; color: #1A1A1A; }
    .ficha__quien { margin: 0 0 10px; display: grid; font-size: .85rem; }
    .ficha__quien span { color: #3D5C3D; }
    .ficha dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0 0 10px; }
    .ficha dt { font-size: .7rem; color: #3D5C3D; }
    .ficha dd { margin: 0; font-size: 1.35rem; font-weight: 700; color: hsl(var(--h) 38% 28%); font-variant-numeric: tabular-nums; }
    .barra { display: block; height: 8px; border-radius: 999px; background: #E0EAD8; overflow: hidden; }
    .barra i { display: block; height: 100%; border-radius: 999px; background: #66AA33; }
    .barra i.bajo { background: #b5523b; } .barra i.ok { background: #2F7A3A; }
    .ficha__ir { display: inline-block; margin-top: 12px; font-weight: 600; font-size: .88rem; color: #29422F; }
    .reloj { position: absolute; left: 12px; top: 12px; z-index: 6; display: flex; align-items: center; border-radius: 999px; font-size: .74rem; font-weight: 700; font-variant-numeric: tabular-nums;
      background: rgba(252, 249, 246, .72); color: #29422F; backdrop-filter: blur(4px); box-shadow: 0 2px 8px rgba(20, 40, 25, .16); }
    .reloj__h { padding: 5px 11px; border: 0; border-radius: 999px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .reloj__mando { display: none; align-items: center; gap: 6px; padding: 0 4px 0 0; }
    .reloj.abierto .reloj__mando, .reloj:hover .reloj__mando { display: flex; }
    .reloj input { width: 110px; accent-color: #29422F; cursor: pointer; }
    .reloj__mando button { width: 24px; height: 24px; border: 0; border-radius: 50%; background: #29422F; color: #fcf9f6; font-size: .65rem; cursor: pointer; }
    .reloj button:focus-visible, .reloj input:focus-visible { outline: 3px solid #66AA33; outline-offset: 2px; }
    .ayuda { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); max-width: calc(100% - 24px); margin: 0; padding: 5px 14px; border-radius: 999px; text-align: center; font-size: .72rem; font-weight: 600; color: #29422F; background: rgba(252, 249, 246, .88); box-shadow: 0 2px 8px rgba(20, 40, 25, .2); pointer-events: none; }
    :host(.tema-oscuro) h1 { color: #eaf3e4; }
    :host(.tema-oscuro) .titulo__ojo { color: #a9cf8f; }
    :host(.tema-oscuro) .titulo p { color: #b9c9b3; }
    :host(.tema-oscuro) .titulo__ley { background: #66AA33; color: #10200f; border-color: #66AA33; }
    :host(.tema-oscuro) .titulo__ley.on { background: transparent; color: #eaf3e4; border-color: #7fae63; }
    :host(.tema-oscuro) .leyenda h2 { color: #a9cf8f; }
    :host(.tema-oscuro) .leyenda button { color: hsl(var(--h) 40% 86%); }
    :host(.tema-oscuro) .leyenda button b { color: hsl(var(--h) 40% 74%); }
    :host(.tema-oscuro) .leyenda button:hover { background: hsl(var(--h) 25% 22%); }
    :host(.tema-oscuro) .leyenda button.on { background: hsl(var(--h) 28% 26%); box-shadow: inset 3px 0 0 hsl(var(--h) 50% 60%); }
    :host(.tema-oscuro) .mapa { border-color: #2f4a35; }
    @media (max-width: 860px) {
      :host { height: auto; min-height: calc(100dvh - 64px); overflow: visible; }
      .titulo { flex-direction: column; align-items: flex-start; padding: 10px 14px 2px; }
      .titulo p { display: none; }
      .cuerpo { flex: none; }
      .cuerpo { height: auto; grid-template-rows: minmax(420px, 70dvh); }
      .cuerpo--ley { grid-template-columns: 1fr; grid-template-rows: auto minmax(420px, 70dvh); }
      .leyenda { flex-direction: row; overflow-x: auto; overflow-y: hidden; padding: 0 0 6px; }
      .leyenda h2 { display: none; }
      .leyenda button { flex: none; width: auto; grid-template-columns: 28px auto; }
      .leyenda button b { display: none; }
      .ficha { top: auto; bottom: 12px; }
    }
  `],
})
export class PuebloComponent implements AfterViewInit {
  @ViewChild('lienzo', { static: true }) private lienzo!: ElementRef<HTMLDivElement>;
  private readonly destroyRef = inject(DestroyRef);
  private readonly tema = inject(TemaService);
  @HostBinding('class.tema-oscuro') get oscuro(): boolean { return this.tema.oscuro(); }
  private readonly servicio = inject(PlanService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  readonly plan = toSignal<PlanEntidad | null | undefined>(
    this.ruta.paramMap.pipe(map(p => p.get('dane') ?? ENTIDAD_PILOTO), switchMap(d => this.servicio.entidad(d).pipe(catchError(() => of(null))))),
    { initialValue: undefined },
  );
  private readonly seguimiento = toSignal<Seguimiento | null>(
    this.ruta.paramMap.pipe(map(p => p.get('dane') ?? ENTIDAD_PILOTO), switchMap(d => this.servicio.seguimiento(d).pipe(catchError(() => of(null))))),
    { initialValue: null },
  );
  private readonly datos = toSignal<Diorama | null>(this.http.get<Diorama>('data/plan/girardota-diorama.json').pipe(catchError(() => of(null))), { initialValue: null });
  readonly resumenes = computed<Resumen[]>(() => {
    const p = this.plan();
    return p ? construirResumenes(p, this.seguimiento()).filter(r => EDIFICIOS[r.dep.id]) : [];
  });
  readonly elegido = signal<Resumen | null>(null);
  readonly sobre = signal(false);
  readonly hora = signal('☀ 10:00');
  readonly relojAbierto = signal(false);
  /** el tooltip como lista de uno: así cada pin nuevo vuelve a estrenar la animación de entrada */
  readonly tipLista = computed(() => { const t = this.tip(); return t ? [t] : []; });
  readonly leyenda = signal(false);
  readonly tip = signal<{ r: Resumen; x: number; y: number } | null>(null);

  private renderer!: THREE.WebGLRenderer;
  private readonly escena = new THREE.Scene();
  private readonly camara = new THREE.PerspectiveCamera(30, 1, 5, 7000);
  private controles!: OrbitControls;
  private sol!: THREE.DirectionalLight;
  private readonly reloj = new THREE.Clock();
  private readonly matCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly desechables: { dispose(): void }[] = [];
  private edificios: Edificio[] = [];
  private aura: Aura | null = null;
  private nubes: Nube[] = [];
  private rotores: THREE.Object3D[] = [];
  /** farolas sueltas (las del parqueadero): puntos de luz xyz y charcos de luz sobre el asfalto */
  private lucesExtra: number[] = [];
  private charcosExtra: { x: number; z: number; hx: number; hz: number; y?: number }[] = [];
  private nieblas: { sprite: THREE.Sprite; x: number; z: number; x0: number; z0: number; dy: number; y: number; ancho: number; fase: number }[] = [];
  private listo = false;
  private vistaPuesta = false;
  private construido = false;
  private animacion = 0;
  private vuelo: { t: number; de: THREE.Vector3; deObj: THREE.Vector3; a: THREE.Vector3; aObj: THREE.Vector3 } | null = null;
  private semilla = 11;
  /** celdas de 24 m con lo que ya está construido (casas, calles, edificios): sirve para no sembrar árboles encima */
  private readonly ocupado = new Set<string>();

  constructor() {
    effect(() => {
      this.resumenes(); this.datos();
      untracked(() => this.intentar());
    });
  }

  /** ayudas de la tarjeta que aparece al pasar el cursor: tamaños relativos, anillo de avance y sitio dentro del mapa */
  private maxProductos = computed(() => Math.max(1, ...this.resumenes().map(r => r.alta + r.sugerida)));
  porcentaje(n: number): number { return Math.round(100 * n / this.maxProductos()); }
  anilloOffset(p: number | null): number { return 326.73 * (1 - Math.min(100, Math.max(0, p ?? 0)) / 100); }
  claseAvance(p: number | null): string { return p === null ? 'av--nd' : p >= 100 ? 'av--ok' : p >= 50 ? 'av--medio' : 'av--bajo'; }
  /**
   * Dónde poner la tarjeta junto al cursor para que se vea completa dentro del mapa: a la derecha si cabe, si no a la izquierda,
   * y si el mapa es angosto, centrada; en vertical se centra en el cursor sin salirse por arriba ni por abajo.
   */
  colocar(x: number, y: number): { x: number; y: number } {
    const mapa = this.lienzo.nativeElement, W = mapa.clientWidth, H = mapa.clientHeight;
    const el = mapa.parentElement?.querySelector('.tip') as HTMLElement | null;
    const w = Math.min(el?.offsetWidth || 330, W - 16), h = Math.min(el?.offsetHeight || 310, H - 16), m = 8, sep = 18;
    let left = x + sep;
    if (left + w > W - m) left = x - sep - w;
    left = Math.max(m, Math.min(W - w - m, left));
    const top = Math.max(m, Math.min(H - h - m, y - h / 2));
    return { x: Math.round(left), y: Math.round(top) };
  }

  matiz(id: string): number { return matizDe(id); }
  corto(n: string): string { return n.split(',')[0].replace(/^(Secretar[ií]a|Oficina|Despacho)( Asesora)?( de(l)?)? ?/i, m => (/^Despacho/i.test(m) ? 'Despacho ' : '')).replace(/^./, c => c.toUpperCase()); }
  entero(v: number): string { return Math.round(v).toLocaleString('es-CO'); }
  clase(v: number | null): string { return v === null ? '' : v >= 100 ? 'ok' : v < 50 ? 'bajo' : ''; }
  icono(r: Resumen): string | null { return r.dep.icono ? `/img/iconos/${r.dep.icono}.png` : null; }

  private flotas: Flota[] = [];
  private hemi!: THREE.HemisphereLight;
  private luna!: THREE.DirectionalLight;
  private matFarola: THREE.MeshStandardMaterial | null = null;
  private brillos: { pts: THREE.Points; max: number; px: number }[] = [];
  private estrellas: THREE.Points | null = null;
  private horaMostrada = -1;
  private fondoMapa: HTMLElement | null = null;
  /** ventanas encendidas de las casas: x, y, z de cada una */
  private ventanas: number[] = [];
  private ventanasEd: number[] = [];
  private pajaros: Pajaro[] = [];
  private humos: Humo[] = [];
  private tiempoPajaros = 0;
  /** tramos de calle y quebrada por celdas de 40 m: [x0, z0, x1, z1, mitad del ancho] */
  private readonly segmentos = new Map<string, number[][]>();

  private rnd = (): number => (this.semilla = (this.semilla * 16807) % 2147483647) / 2147483647;

  ngAfterViewInit(): void {
    const el = this.lienzo.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(this.renderer.domElement);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x88aa77, 1.2);
    this.escena.add(this.hemi);
    this.luna = new THREE.DirectionalLight(0x9db4ff, 0);
    this.luna.position.set(-300, 500, -200);
    this.escena.add(this.luna);
    const sol = new THREE.DirectionalLight(0xfff4e0, 2.6);
    sol.position.set(320, 520, 240);
    sol.castShadow = true;
    sol.shadow.mapSize.set(4096, 4096);
    Object.assign(sol.shadow.camera, { left: -820, right: 820, top: 820, bottom: -820, near: 10, far: 2200 });
    sol.shadow.bias = -0.0004;
    this.escena.add(sol);
    this.sol = sol;
    this.construirNubes();

    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.enableDamping = true;
    this.controles.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controles.minDistance = 90;
    this.controles.autoRotate = false;
    // igual que en el mapa 3D: la manito arrastra y desplaza, el clic derecho inclina y gira, y la rueda acerca con suavidad
    this.controles.screenSpacePanning = false;
    this.controles.mouseButtons = { LEFT: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controles.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controles.enableZoom = false;
    this.controles.target.set(0, 40, 0);
    this.camara.position.set(1190, 720, 1300);
    this.controles.addEventListener('start', () => { this.controles.autoRotate = false; this.vuelo = null; this.tip.set(null); this.movido = Infinity; });
    this.controles.addEventListener('end', () => { this.movido = performance.now(); });

    const ajustar = () => {
      const { clientWidth: w, clientHeight: h } = el;
      this.renderer.setSize(w, h);
      this.camara.aspect = w / Math.max(h, 1);
      // la vista inicial es también lo más lejos que se puede alejar; en recuadros más cuadrados se aleja un poco más para que la maqueta entre igual de ancha
      const dist = 1401 * Math.pow(Math.max(1, 2.35 / this.camara.aspect), 1.1);
      this.controles.maxDistance = dist;
      if (!this.vistaPuesta) {
        this.vistaPuesta = true;
        this.camara.position.copy(this.controles.target).addScaledVector(new THREE.Vector3(0.476, 0.191, -0.859).normalize(), dist);
      } else if (this.camara.position.distanceTo(this.controles.target) > dist) {
        this.camara.position.sub(this.controles.target).setLength(dist).add(this.controles.target);
      }
      this.camara.updateProjectionMatrix();
    };
    const obs = new ResizeObserver(ajustar);
    obs.observe(el);
    ajustar();

    const dom = this.renderer.domElement;
    const rueda = (e: WheelEvent) => {
      e.preventDefault();
      this.vuelo = null;
      this.tip.set(null);
      this.zoomPendiente += e.deltaY * 0.0022;
    };
    dom.addEventListener('wheel', rueda, { passive: false });
    const medio = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    dom.addEventListener('mousedown', medio);
    let abajo: { x: number; y: number } | null = null;
    const alBajar = (e: PointerEvent) => { abajo = { x: e.clientX, y: e.clientY }; };
    const alSubir = (e: PointerEvent) => {
      if (!abajo || Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y) > 5) return;
      const id = this.buscar(e);
      if (id) this.elegir(id); else this.soltar();
    };
    const alMover = (e: PointerEvent) => {
      if (e.buttons & 4) {                      // rueda presionada: gira el mapa en horizontal y lo inclina
        this.vuelo = null;
        this.giroPendiente -= e.movementX * 0.006;
        this.inclinacionPendiente += e.movementY * 0.006;
      }
      if (e.buttons) { this.tip.set(null); return; }
      const id = this.buscar(e);
      this.sobre.set(!!id);
      this.resaltar(id);
      const b = id ? this.edificios.find(x => x.r.dep.id === id) : null;
      const caja = this.lienzo.nativeElement.getBoundingClientRect();
      this.tip.set(b ? { r: b.r, x: e.clientX - caja.left, y: e.clientY - caja.top } : null);
    };
    const alSalir = () => { this.tip.set(null); this.sobre.set(false); this.resaltar(null); };
    dom.addEventListener('pointerdown', alBajar);
    dom.addEventListener('pointerup', alSubir);
    dom.addEventListener('pointermove', alMover);
    dom.addEventListener('pointerleave', alSalir);

    this.listo = true;
    this.intentar();

    const bucle = () => {
      this.animacion = requestAnimationFrame(bucle);
      const dt = Math.min(this.reloj.getDelta(), 0.1);
      this.animar(dt, this.reloj.elapsedTime);
      this.aplicarGiroYZoom();
      this.controles.update();
      this.mantenerEnElMapa();
      this.renderer.render(this.escena, this.camara);
    };
    bucle();

    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.animacion);
      obs.disconnect();
      dom.removeEventListener('wheel', rueda);
      dom.removeEventListener('mousedown', medio);
      dom.removeEventListener('pointerdown', alBajar);
      dom.removeEventListener('pointerup', alSubir);
      dom.removeEventListener('pointermove', alMover);
      dom.removeEventListener('pointerleave', alSalir);
      this.controles.dispose();
      this.aura?.dispose();
      for (const e of this.edificios) { e.pin.tex.dispose(); e.pin.sprite.material.dispose(); }
      this.escena.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) o.geometry.dispose(); });
      for (const m of this.matCache.values()) m.dispose();
      for (const d of this.desechables) d.dispose();
      this.renderer.dispose();
      RELIEVE = null;
      PLATAFORMAS = [];
      ZONAS_PUENTE = [];
    });
  }

  private zoomPendiente = 0;
  private giroPendiente = 0;
  private inclinacionPendiente = 0;
  private limite: [number, number] = [650, 500];
  /** instante en que el usuario soltó el mapa (Infinity mientras lo arrastra) y altura de la mira sobre el suelo */
  private movido = 0;
  private alzaMira = 40;

  /** Gasta poco a poco el giro, la inclinación y el zoom acumulados por la rueda, para que se sienta suave. */
  private aplicarGiroYZoom(): void {
    const mira = this.controles.target, cam = this.camara.position;
    if (Math.abs(this.giroPendiente) > 1e-4) {
      const a = this.giroPendiente * 0.2;
      this.giroPendiente -= a;
      const girado = cam.clone().sub(mira).applyAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      cam.copy(mira).add(girado);
    }
    if (Math.abs(this.inclinacionPendiente) > 1e-4) {
      const a = this.inclinacionPendiente * 0.2;
      this.inclinacionPendiente -= a;
      const d = cam.clone().sub(mira), r = d.length();
      const phi = Math.min(Math.PI / 2 - 0.04, Math.max(0.05, Math.acos(Math.min(1, Math.max(-1, d.y / r))) - a)), theta = Math.atan2(d.x, d.z);
      cam.copy(mira).add(d.set(r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.cos(theta)));
    }
    if (Math.abs(this.zoomPendiente) > 1e-4) {
      const a = this.zoomPendiente * 0.2;
      this.zoomPendiente -= a;
      const d = cam.clone().sub(mira);
      cam.copy(mira).add(d.setLength(Math.min(this.controles.maxDistance, Math.max(this.controles.minDistance, d.length() * Math.exp(a)))));
    }
  }

  /** El punto de mira no se sale del terreno y sigue su relieve al desplazarse; la cámara nunca baja del suelo que tiene debajo. */
  private mantenerEnElMapa(): void {
    const t = this.controles.target, c = this.camara.position;
    const x = Math.min(this.limite[0], Math.max(-this.limite[0], t.x)), z = Math.min(this.limite[1], Math.max(-this.limite[1], t.z));
    if (x !== t.x || z !== t.z) { c.x += x - t.x; c.z += z - t.z; t.x = x; t.z = z; }
    if (!this.vuelo && performance.now() - this.movido < 1500) {
      const dy = (alturaTerreno(t.x, t.z) + this.alzaMira - t.y) * 0.12;
      t.y += dy; c.y += dy;
    }
    const piso = alturaTerreno(c.x, c.z) + 14;
    if (c.y < piso) c.y = piso;
  }

  /** Arma el pueblo cuando ya están el plan y los datos del casco urbano. */
  private intentar(): void {
    const d = this.datos(), rs = this.resumenes();
    if (!this.listo || this.construido || !d || !rs.length) return;
    this.construido = true;
    RELIEVE = d;
    this.limite = [d.ancho / 2 * 0.85, d.fondo / 2 * 0.85];
    this.alzaMira = 40 - alturaTerreno(0, 0);
    this.indexarCaminos(d);
    this.reubicarSitios(d);
    this.crearAccesos(d);
    ZONAS_PUENTE = this.crucesDeRio(d).map(c => ({ x: c.x, z: c.z, r: c.largo / 2 + 34 }));
    this.construirTerreno(d);
    this.construirCamino(d);
    this.construirPuentes(d);
    this.construirCasas(d);
    this.armarPueblo(rs, d);
    this.sembrarArboles(d);
    this.construirMovimiento(d);
    this.construirPajaros(d);
    this.construirFarolas(d);
    this.construirEstrellas();
    this.construirNiebla(d);
  }

  private material(color: string): THREE.MeshStandardMaterial {
    let m = this.matCache.get(color);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }); this.matCache.set(color, m); }
    return m;
  }

  private marcar(x: number, z: number): void { this.ocupado.add(`${Math.floor(x / 24)},${Math.floor(z / 24)}`); }
  private estaOcupado(x: number, z: number): boolean { return this.ocupado.has(`${Math.floor(x / 24)},${Math.floor(z / 24)}`); }

  /** Isla de maqueta: el relieve real del casco urbano, cortado en bloque, con paredes de tierra por estratos y un fondo que se angosta. */
  private construirTerreno(d: Diorama): void {
    const W = d.ancho, H = d.fondo;
    const g = new THREE.PlaneGeometry(W, H, Math.ceil(W / 6), Math.ceil(H / 6)).rotateX(-Math.PI / 2);
    const pos = g.attributes['position'] as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), pasto = new THREE.Color('#8fd175'), monte = new THREE.Color('#5aa84a'), pizarra = new THREE.Color('#8fa35a'), roca = new THREE.Color('#b0a088'), tierra = new THREE.Color('#d9772e');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = alturaTerreno(x, z);
      pos.setY(i, h);
      const v = 0.94 + 0.12 * ruido(x * 0.05, z * 0.05);
      if (h < 30) c.copy(pasto);
      else if (h < 120) c.copy(pasto).lerp(monte, (h - 30) / 90);
      else if (h < 230) c.copy(monte).lerp(pizarra, (h - 120) / 110);
      else c.copy(pizarra).lerp(roca, Math.min(1, (h - 230) / 120));
      // talud: donde la explanada cortó o rellenó la ladera queda tierra naranja
      const cambio = Math.abs(h - alturaTerreno(x, z, false));
      if (cambio > 0.15) c.lerp(tierra, Math.min(1, cambio / 2.2));
      col.set([c.r * v, c.g * v, c.b * v], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const cesped = this.texturaCesped();
    cesped.repeat.set(W / 22, H / 22);
    const matTierra = new THREE.MeshStandardMaterial({ vertexColors: true, map: cesped, roughness: 1, flatShading: true });
    const malla = new THREE.Mesh(g, matTierra);
    malla.receiveShadow = true;
    this.escena.add(malla);

    // paredes: cada columna del borde baja del relieve a la tierra y de ahí al fondo, que se angosta como una roca flotante
    const filas = [[0, '#6fb04f'], [5, '#9a6a45'], [FONDO * 0.45, '#7c5238'], [FONDO, '#3b2f2a']] as const;
    const borde: [number, number][] = [];
    const paso = d.paso;
    for (let x = -W / 2; x < W / 2; x += paso) borde.push([x, -H / 2]);
    for (let z = -H / 2; z < H / 2; z += paso) borde.push([W / 2, z]);
    for (let x = W / 2; x > -W / 2; x -= paso) borde.push([x, H / 2]);
    for (let z = H / 2; z > -H / 2; z -= paso) borde.push([-W / 2, z]);
    borde.push(borde[0]);
    const pw: number[] = [], cw: number[] = [], iw: number[] = [];
    const cc = new THREE.Color();
    borde.forEach(([x, z], k) => {
      const h = alturaTerreno(x, z);
      filas.forEach(([baja, color], r) => {
        const encoge = r === 3 ? 0.86 : r === 2 ? 0.95 : 1;
        pw.push(x * encoge, r === 0 ? h : r === 1 ? h - baja : -baja, z * encoge);
        cc.set(color); cw.push(cc.r, cc.g, cc.b);
      });
      if (k) for (let r = 0; r < 3; r++) { const a0 = (k - 1) * 4 + r, a1 = k * 4 + r; iw.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1); }
    });
    const gw = new THREE.BufferGeometry();
    gw.setAttribute('position', new THREE.Float32BufferAttribute(pw, 3));
    gw.setAttribute('color', new THREE.Float32BufferAttribute(cw, 3));
    gw.setIndex(iw);
    gw.computeVertexNormals();
    const matPared = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const paredes = new THREE.Mesh(gw, matPared);
    paredes.receiveShadow = true; paredes.castShadow = true;
    this.escena.add(paredes);
    const fondo = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.86, H * 0.86).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3b2f2a', roughness: 1 }));
    fondo.position.y = -FONDO;
    this.escena.add(fondo);
    this.desechables.push(matTierra, matPared, gw, fondo.geometry, fondo.material as THREE.Material);
  }

  /** Cinta que sigue el relieve a lo largo de una línea (calle o quebrada), partida donde sale del recuadro; `vRep` m de largo por vuelta de textura. */
  private cinta(d: Diorama, pts: number[], ancho: number, alza: number, vRep = 24): THREE.BufferGeometry | null {
    const dentro = (x: number, z: number) => Math.abs(x) < d.ancho / 2 - 2 && Math.abs(z) < d.fondo / 2 - 2;
    const tramos: { x: number; z: number; s: number }[][] = [];
    let tramo: { x: number; z: number; s: number }[] = [];
    let acum = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const [x0, z0, x1, z1] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
      const largo = Math.hypot(x1 - x0, z1 - z0);
      if (largo < 0.01) continue;
      const pasos = Math.max(1, Math.ceil(largo / 5));
      for (let k = i === 0 ? 0 : 1; k <= pasos; k++) {
        const t = k / pasos, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        if (!dentro(x, z)) { if (tramo.length > 1) tramos.push(tramo); tramo = []; continue; }
        this.marcar(x, z);
        tramo.push({ x, z, s: acum + largo * t });
      }
      acum += largo;
    }
    if (tramo.length > 1) tramos.push(tramo);
    const pos: number[] = [], idx: number[] = [], uv: number[] = [];
    for (const tr of tramos) {
      const base = pos.length / 3;
      tr.forEach((q, j) => {
        const a = tr[Math.max(j - 1, 0)], c = tr[Math.min(j + 1, tr.length - 1)];
        const tx = c.x - a.x, tz = c.z - a.z, l = Math.hypot(tx, tz) || 1;
        const nx = -tz / l, nz = tx / l, y = alturaTerreno(q.x, q.z) + alza, v = q.s / vRep;
        pos.push(q.x + nx * ancho / 2, y, q.z + nz * ancho / 2, q.x - nx * ancho / 2, y, q.z - nz * ancho / 2);
        uv.push(0, v, 1, v);
        if (j) { const k = base + j * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
      });
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /** Textura de calle (u cruza la vía, v la recorre): asfalto con grano, bordillos blancos y raya central discontinua; o acera de concreto con juntas. */
  private texturaVia(clase: 'asfalto' | 'local' | 'sendero' | 'acera'): THREE.CanvasTexture {
    const W = 64, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const base = { asfalto: '#50565c', local: '#6f757b', sendero: '#c9b68a', acera: '#d8d3c8' }[clase];
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 520; i++) {
      const v = this.rnd();
      g.fillStyle = v < 0.5 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.09)';
      g.fillRect(this.rnd() * W, this.rnd() * H, 1 + this.rnd() * 2, 1 + this.rnd() * 2);
    }
    if (clase === 'asfalto' || clase === 'local') {
      g.fillStyle = '#f4f1e6';
      g.fillRect(3, 0, 2, H); g.fillRect(W - 5, 0, 2, H);                 // delineado de borde
      g.fillStyle = clase === 'asfalto' ? '#f2c230' : '#f4f1e6';
      for (const y of [6, 70]) g.fillRect(W / 2 - 1, y, 2, 40);          // raya central discontinua
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.fillRect(0, 0, 2, H); g.fillRect(W - 2, 0, 2, H);                 // sombra del bordillo
    } else if (clase === 'acera') {
      g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, 0, 2, H); g.fillRect(W - 2, 0, 2, H);
      g.fillRect(0, 0, W, 1); g.fillRect(0, H / 2, W, 1);                 // juntas de las losas
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(2, 0, 1, H); g.fillRect(W - 3, 0, 1, H);
    } else {
      g.fillStyle = 'rgba(90,70,40,.25)'; g.fillRect(W / 2 - 6, 0, 3, H); g.fillRect(W / 2 + 3, 0, 3, H);   // huellas del sendero
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    this.desechables.push(tex);
    return tex;
  }

  /** Césped: fondo claro con briznas más oscuras y más claras, para que el color del relieve lo tiña sin perder el grano. */
  private texturaCesped(): THREE.CanvasTexture {
    const N = 256;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    g.fillStyle = '#e9efe2'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 2600; i++) {
      const x = this.rnd() * N, y = this.rnd() * N, l = 3 + this.rnd() * 6, a = (this.rnd() - 0.5) * 0.9;
      g.strokeStyle = this.rnd() < 0.55 ? `rgba(60,110,50,${0.18 + this.rnd() * 0.2})` : `rgba(255,255,230,${0.2 + this.rnd() * 0.25})`;
      g.lineWidth = 1 + this.rnd();
      for (const dx of [0, -N, N]) for (const dy of [0, -N, N]) { g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.sin(a) * l, y + dy - Math.cos(a) * l); g.stroke(); }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    this.desechables.push(tex);
    return tex;
  }

  /** Agua del río: más oscura y honda al centro, con espuma en las orillas y vetas que corren con la corriente. */
  private texturaAgua(): THREE.CanvasTexture {
    const W = 64, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, '#9fe0f5'); gr.addColorStop(0.16, '#4fb6e0'); gr.addColorStop(0.5, '#1f7fb8'); gr.addColorStop(0.84, '#4fb6e0'); gr.addColorStop(1, '#9fe0f5');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      const x = 8 + this.rnd() * (W - 16), y = this.rnd() * H, l = 8 + this.rnd() * 22;
      g.fillStyle = `rgba(255,255,255,${0.16 + this.rnd() * 0.22})`;
      for (const dy of [0, -H, H]) g.fillRect(x, y + dy, 1 + this.rnd() * 2, l);
    }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(0, 0, 3, H); g.fillRect(W - 3, 0, 3, H);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapT = THREE.RepeatWrapping;
    this.desechables.push(tex);
    return tex;
  }
  private texAgua: THREE.CanvasTexture | null = null;
  /** puentes ya puestos: centro, radio de influencia y altura de su tablero (para que el tráfico los cruce por encima) */
  private puentes: { x: number; z: number; r: number; y: number }[] = [];

  /** Altura a la que circula el tráfico en un punto: sobre el terreno, o sobre el tablero si hay un puente. */
  private nivel(x: number, z: number): number {
    let y = alturaTerreno(x, z) + ALZA_CALLE + 0.3;
    for (const b of this.puentes) if (Math.abs(x - b.x) < b.r && Math.abs(z - b.z) < b.r && Math.hypot(x - b.x, z - b.z) < b.r) y = Math.max(y, b.y);
    return y;
  }

  /** Un puente del catálogo del mapa 3D en cada cruce de una vía principal o local con el río o una quebrada ancha. */
  /** Dónde una vía importante cruza el río o un cauce ancho, sin dos puentes a menos de 55 m. */
  private crucesDeRio(d: Diorama) {
    const cauces: { pts: number[]; ancho: number }[] = [];
    const eje: number[] = [];
    for (let x = -d.ancho / 2 + 2; x <= d.ancho / 2 - 2; x += 14) eje.push(x, zRio(x));
    cauces.push({ pts: eje, ancho: ANCHO_RIO });
    for (const [w, pts] of d.rios) cauces.push({ pts, ancho: Math.max(6, w * 1.4) });
    const inter = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) => {
      const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
      if (Math.abs(den) < 1e-9) return null;
      const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
      return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
    };
    const cruces: { x: number; z: number; dx: number; dz: number; via: number; rio: number; largo: number }[] = [];
    for (const [clase, pts] of d.vias) {
      const k = Math.min(clase, 2);
      if (k > 1) continue;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const [x0, z0, x1, z1] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
        for (const c of cauces) {
          if (c.ancho < 9) continue;      // las quebradas angostas se cruzan sin puente
          for (let j = 0; j + 3 < c.pts.length; j += 2) {
            const [a0, b0, a1, b1] = [c.pts[j], c.pts[j + 1], c.pts[j + 2], c.pts[j + 3]];
            if (Math.max(x0, x1) < Math.min(a0, a1) - 1 || Math.min(x0, x1) > Math.max(a0, a1) + 1 || Math.max(z0, z1) < Math.min(b0, b1) - 1 || Math.min(z0, z1) > Math.max(b0, b1) + 1) continue;
            const t = inter(x0, z0, x1, z1, a0, b0, a1, b1);
            if (t === null) continue;
            const l = Math.hypot(x1 - x0, z1 - z0) || 1;
            const lr = Math.hypot(a1 - a0, b1 - b0) || 1;
            const sen = Math.abs(((x1 - x0) / l) * ((b1 - b0) / lr) - ((z1 - z0) / l) * ((a1 - a0) / lr));
            if (sen < 0.45) continue;      // una vía casi paralela al cauce no lo cruza: lo bordea
            cruces.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, dx: (x1 - x0) / l, dz: (z1 - z0) / l, via: ANCHO_CALLE[k], rio: c.ancho, largo: c.ancho / sen + 20 });
          }
        }
      }
    }
    cruces.sort((a, b) => b.rio - a.rio);
    const hechos: typeof cruces = [];
    for (const c of cruces) {
      if (Math.abs(c.x) > d.ancho / 2 - 60 || Math.abs(c.z) > d.fondo / 2 - 60) continue;
      if (hechos.some(o => Math.hypot(o.x - c.x, o.z - c.z) < 55)) continue;
      hechos.push(c);
    }
    return hechos;
  }

  private construirPuentes(d: Diorama): void {
    const hechos = this.crucesDeRio(d);
    const modelo = modelarEquipamiento('vias', 'Vía', 'puente', this.rnd);
    // se descartan del modelo el suelo y el agua de su maqueta, y los terraplenes: el relieve y el río ya están
    const piezas = modelo.piezas.filter(p => !['#d3e2a6', '#4db3e6', '#7fa468'].includes(p.color));
    for (const c of hechos) {
      const sz = c.largo / 100, sx = (c.via + 6) / 14.95, mitad = sz * 50;
      const yIn = alturaTerreno(c.x - c.dx * mitad, c.z - c.dz * mitad), yOut = alturaTerreno(c.x + c.dx * mitad, c.z + c.dz * mitad);
      const cabeceo = Math.max(-0.22, Math.min(0.22, Math.atan2(yOut - yIn, 2 * mitad)));
      const banco = (yIn + yOut) / 2;
      const g = new THREE.Group();
      g.position.set(c.x, banco + ALZA_CALLE - 7.3, c.z);
      g.rotation.order = 'YXZ';
      g.rotation.y = Math.atan2(c.dx, c.dz);
      g.rotation.x = -cabeceo;                  // el tablero sigue la pendiente entre las dos orillas
      g.scale.set(sx, 1, sz);
      for (const pz of piezas) {
        const m = new THREE.Mesh(pz.g, this.material(pz.color));
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
      }
      // el puente cuenta como vía: ni casas ni árboles debajo
      for (let k = -mitad; k <= mitad; k += 12) {
        const px = c.x + c.dx * k, pz = c.z + c.dz * k, clave = `${Math.floor(px / 40)},${Math.floor(pz / 40)}`;
        const seg = [px, pz, px + c.dx * 12, pz + c.dz * 12, (c.via + 6) / 2 + 3];
        const l = this.segmentos.get(clave);
        if (l) l.push(seg); else this.segmentos.set(clave, [seg]);
      }
      this.escena.add(g);
      this.puentes.push({ x: c.x, z: c.z, r: mitad * 0.95, y: banco + ALZA_CALLE + 0.3 });
    }
  }

  /** Calles con acera, bordillo y raya central, y el río y las quebradas con agua que corre, tal como están en los datos del mapa. */
  private construirCamino(d: Diorama): void {
    const clases = [{ ancho: 15, tex: 'asfalto' as const }, { ancho: 9, tex: 'local' as const }, { ancho: 4, tex: 'sendero' as const }];
    const acera = this.texturaVia('acera');
    const matAcera = new THREE.MeshStandardMaterial({ map: acera, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide });
    this.desechables.push(matAcera);
    clases.forEach((cl, k) => {
      const mat = new THREE.MeshStandardMaterial({ map: this.texturaVia(cl.tex), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
      this.desechables.push(mat);
      for (const [clase, pts] of d.vias) {
        if (Math.min(clase, 2) !== k) continue;
        if (k < 2) {
          const ga = this.cinta(d, pts, cl.ancho + 6, 2.1 + (2 - k) * 0.25, 6);
          if (ga) { const m = new THREE.Mesh(ga, matAcera); m.receiveShadow = true; this.escena.add(m); this.desechables.push(ga); }
        }
        const g = this.cinta(d, pts, cl.ancho, 2.2 + (2 - k) * 0.25);
        if (g) { const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.escena.add(m); this.desechables.push(g); }
      }
    });
    // el río y las quebradas: orilla de barro, y encima el agua con su corriente
    this.texAgua = this.texturaAgua();
    this.texAgua.repeat.set(1, 1);
    const agua = new THREE.MeshStandardMaterial({ map: this.texAgua, roughness: 0.2, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide });
    const barro = new THREE.MeshStandardMaterial({ color: '#7a6a48', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    this.desechables.push(agua, barro);
    const poner = (pts: number[], ancho: number, alza: number) => {
      const orilla = this.cinta(d, pts, ancho + 7, alza - 0.5, 30);
      if (orilla) { this.escena.add(new THREE.Mesh(orilla, barro)); this.desechables.push(orilla); }
      const rio = this.cinta(d, pts, ancho, alza, 30);
      if (rio) { this.escena.add(new THREE.Mesh(rio, agua)); this.desechables.push(rio); }
    };
    const eje: number[] = [];
    for (let x = -d.ancho / 2 + 2; x <= d.ancho / 2 - 2; x += 14) eje.push(x, zRio(x));
    poner(eje, ANCHO_RIO, 1.1);
    for (const [ancho, pts] of d.rios) poner(pts, Math.max(6, ancho * 1.4), 1.8);
  }

  /** Indexa los tramos de calle y de quebrada para saber rápido si un punto cae encima de uno. */
  private indexarCaminos(d: Diorama): void {
    const ancho = [15, 9, 4];
    const agregar = (pts: number[], mitad: number) => {
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const seg = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3], mitad];
        const largo = Math.hypot(seg[2] - seg[0], seg[3] - seg[1]), n = Math.max(1, Math.ceil(largo / 20));
        const vistos = new Set<string>();
        for (let k = 0; k <= n; k++) {
          const x = seg[0] + (seg[2] - seg[0]) * k / n, z = seg[1] + (seg[3] - seg[1]) * k / n, clave = `${Math.floor(x / 40)},${Math.floor(z / 40)}`;
          if (vistos.has(clave)) continue;
          vistos.add(clave);
          const l = this.segmentos.get(clave);
          if (l) l.push(seg); else this.segmentos.set(clave, [seg]);
        }
      }
    };
    for (const [clase, pts] of d.vias) agregar(pts, ancho[Math.min(clase, 2)] / 2);
    for (const [w, pts] of d.rios) agregar(pts, Math.max(6, w * 1.4) / 2);
  }

  /** ¿Cae el punto sobre una calle, una quebrada o el río (o a menos de `margen` m de su orilla)? */
  private sobreCamino(x: number, z: number, margen: number): boolean {
    if (Math.abs(z - zRio(x)) * 0.8 < ANCHO_RIO / 2 + margen) return true;
    const cx = Math.floor(x / 40), cz = Math.floor(z / 40);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = this.segmentos.get(`${cx + a},${cz + b}`);
      if (!l) continue;
      for (const [x0, z0, x1, z1, mitad] of l) {
        const dx = x1 - x0, dz = z1 - z0, L = dx * dx + dz * dz;
        const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L));
        if (Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz)) < mitad + margen) return true;
      }
    }
    return false;
  }

  /** Si la explanada de un responsable quedó sobre una calle o el río, lo corre al sitio libre más cercano. */
  private reubicarSitios(d: Diorama): void {
    const ids = Object.keys(d.sitios);
    const ok = (id: string, x: number, z: number) => {
      if (Math.abs(x) > d.ancho / 2 - 70 || Math.abs(z) > d.fondo / 2 - 70) return false;
      if (this.sobreCamino(x, z, id === 'inf' ? 44 : Math.max(30, (PADS[id] ?? 30) * 0.8))) return false;
      if (this.cercaDeAgua(d, x, z, (PADS[id] ?? 30) + 4)) return false;      // la explanada nunca tapa el río ni las quebradas
      if (ids.some(o => o !== id && Math.hypot(x - d.sitios[o][0], z - d.sitios[o][1]) < 190)) return false;
      let lo = Infinity, hi = -Infinity;
      for (const [a, b] of [[-14, -14], [14, -14], [-14, 14], [14, 14], [0, 0]]) { const h = alturaTerreno(x + a, z + b); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      return hi - lo <= 14;
    };
    for (const id of ids) {
      const [x, z] = d.sitios[id];
      if (ok(id, x, z)) continue;
      let puesto = false;
      for (let r = 12; r <= 280 && !puesto; r += 12) {
        for (let k = 0; k < 360 && !puesto; k += 20) {
          const px = x + r * Math.cos(k * Math.PI / 180), pz = z + r * Math.sin(k * Math.PI / 180);
          if (ok(id, px, pz)) { d.sitios[id][0] = Math.round(px); d.sitios[id][1] = Math.round(pz); puesto = true; }
        }
      }
    }
    // servicios administrativos y agricultura intercambian de lugar
    if (d.sitios['adm'] && d.sitios['agri']) [d.sitios['adm'], d.sitios['agri']] = [d.sitios['agri'], d.sitios['adm']];
    PLATAFORMAS = Object.entries(d.sitios).map(([id, [x, z]]) => ({ x, z, r: PADS[id] ?? 30, y: alturaTerreno(x, z, false) - 0.1 }));
  }

  /** ¿Está el punto sobre el río o una quebrada, o a menos de `margen` m de su orilla? */
  private cercaDeAgua(d: Diorama, x: number, z: number, margen: number): boolean {
    if (Math.abs(z - zRio(x)) * 0.8 < ANCHO_RIO / 2 + margen) return true;
    for (const [w, pts] of d.rios) {
      const mitad = Math.max(6, w * 1.4) / 2 + margen;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const dx = pts[i + 2] - pts[i], dz = pts[i + 3] - pts[i + 1], L = dx * dx + dz * dz;
        const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((x - pts[i]) * dx + (z - pts[i + 1]) * dz) / L));
        if (Math.hypot(x - (pts[i] + t * dx), z - (pts[i + 1] + t * dz)) < mitad) return true;
      }
    }
    return false;
  }

  /** Cada edificio de responsable sale de su explanada con una vía de acceso hasta el punto más cercano de la red vial. */
  private crearAccesos(d: Diorama): void {
    const nuevas: [number, number[]][] = [];
    for (const [id, [x, z]] of Object.entries(d.sitios)) {
      // candidatos: el punto más cercano de cada tramo de calle; se toma el primero cuyo recorrido no cruce ni bordee el agua
      const cand: { dist: number; px: number; pz: number }[] = [];
      for (const [, pts] of d.vias) {
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const dx = pts[i + 2] - pts[i], dz = pts[i + 3] - pts[i + 1], L = dx * dx + dz * dz;
          const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((x - pts[i]) * dx + (z - pts[i + 1]) * dz) / L));
          const qx = pts[i] + t * dx, qz = pts[i + 1] + t * dz;
          cand.push({ dist: Math.hypot(x - qx, z - qz), px: qx, pz: qz });
        }
      }
      cand.sort((p, q) => p.dist - q.dist);
      const sinAgua = (c: { dist: number; px: number; pz: number }) => {
        const n = Math.ceil(c.dist / 8);
        for (let k = 0; k <= n; k++) if (this.cercaDeAgua(d, x + (c.px - x) * k / n, z + (c.pz - z) * k / n, 10)) return false;
        return true;
      };
      const elegido = cand.slice(0, 80).find(sinAgua) ?? cand[0];
      const mejor = elegido ? elegido.dist : Infinity, px = elegido?.px ?? 0, pz = elegido?.pz ?? 0;
      const salida = (PADS[id] ?? 30) * 0.5;
      if (!isFinite(mejor) || mejor <= salida + 4) continue;           // ya hay una calle pegada al edificio
      const ux = (px - x) / mejor, uz = (pz - z) / mejor, pts: number[] = [];
      const n = Math.max(2, Math.ceil((mejor - salida) / 15));
      for (let k = 0; k <= n; k++) { const e = salida + (mejor - salida) * k / n; pts.push(x + ux * e, z + uz * e); }
      nuevas.push([1, pts]);
    }
    if (!nuevas.length) return;
    d.vias.push(...nuevas);
    this.segmentos.clear();
    this.indexarCaminos(d);
  }

  /** Las casas y edificios reales del casco urbano, uno por huella, con paredes de colores alegres y techo de teja. */
  private construirCasas(d: Diorama): void {
    const sitios = Object.entries(d.sitios);
    const lejos = (x: number, z: number) => sitios.every(([id, s]) => Math.hypot(x - s[0], z - s[1]) > Math.max(52, (PADS[id] ?? 30) + TALUD + 4));
    const medio = (area: number) => Math.min(16, Math.max(4.5, Math.sqrt(area / 1.35))) / 2 + 1;
    const lista = d.casas.filter(c => lejos(c[0], c[1]) && !this.sobreCamino(c[0], c[1], medio(c[2])));
    const caja = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const techo = new THREE.CylinderGeometry(0, Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    this.desechables.push(caja, techo);
    const blanco = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
    this.desechables.push(blanco);
    const paredes = new THREE.InstancedMesh(caja, blanco, lista.length);
    const techos = new THREE.InstancedMesh(techo, blanco, lista.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), eje = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    lista.forEach(([x, z, area, ry], i) => {
      const h = hash(i * 3.7, 11), alto = area > 380 ? 12 + 6 * h : area > 160 ? 6.5 + 3 * h : 4.5 + 2 * h;
      const corto = Math.min(16, Math.max(4.5, Math.sqrt(area / 1.35))), largo = Math.min(26, Math.max(corto, area / corto));
      const y = alturaTerreno(x, z) - 0.3;
      this.marcar(x, z);
      q.setFromAxisAngle(eje, ry);
      paredes.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(corto, alto, largo)));
      paredes.setColorAt(i, c.set(PALETA[Math.floor(hash(i * 1.3, 5) * PALETA.length)]));
      const grande = area > 380;
      if (hash(i * 5.3, 17) < 0.22) this.ventanas.push(x + Math.cos(ry) * (corto / 2 + 0.5), y + alto * 0.45, z - Math.sin(ry) * (corto / 2 + 0.5));
      techos.setMatrixAt(i, m.compose(p.set(x, y + alto, z), q, s.set(corto * 1.12, grande ? 0.8 : Math.min(corto * 0.42, 3.6), largo * 1.08)));
      techos.setColorAt(i, c.set(grande ? '#8b9096' : TEJAS[Math.floor(hash(i * 2.1, 9) * TEJAS.length)]));
    });
    for (const im of [paredes, techos]) { im.castShadow = true; im.receiveShadow = true; this.escena.add(im); }
    this.detallarCasas(lista);
    this.brillo(this.ventanas, '#ffc566', 3.6, 0.65);
  }

  /** Zócalo, puerta con escalón, ventanas con marco por piso y alguna chimenea: todo se reparte en mallas instanciadas sobre la misma huella de cada casa. */
  private detallarCasas(lista: number[][]): void {
    type Pieza = { m: THREE.Matrix4; c: string };
    const g: Record<'zocalo' | 'puerta' | 'marco' | 'vidrio' | 'chimenea', Pieza[]> = { zocalo: [], puerta: [], marco: [], vidrio: [], chimenea: [] };
    const q = new THREE.Quaternion(), eje = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3(), v = new THREE.Vector3();
    lista.forEach(([x, z, area, ry], i) => {
      const h = hash(i * 3.7, 11), alto = area > 380 ? 12 + 6 * h : area > 160 ? 6.5 + 3 * h : 4.5 + 2 * h;
      const corto = Math.min(16, Math.max(4.5, Math.sqrt(area / 1.35))), largo = Math.min(26, Math.max(corto, area / corto));
      const y = alturaTerreno(x, z) - 0.3, grande = area > 380;
      q.setFromAxisAngle(eje, ry);
      const poner = (k: keyof typeof g, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, c: string) => {
        pos.copy(v.set(lx, ly, lz).applyQuaternion(q)).add(sc.set(x, y, z));
        g[k].push({ m: new THREE.Matrix4().compose(pos, q, sc.set(sx, sy, sz)), c });
      };
      poner('zocalo', 0, 0, 0, corto + 0.3, 0.75, largo + 0.3, grande ? '#6f7378' : '#8d8478');
      const pisos = Math.max(1, Math.round(alto / 3.3)), hp = alto / pisos;
      const puerta = !grande && corto >= 4.5;
      for (let f = 0; f < pisos; f++) {
        const yv = f * hp + hp * 0.5 + 0.1, hv = Math.min(1.5, hp * 0.46);
        const nz = Math.floor((largo - 1.6) / 3.4);
        for (const lado of [-1, 1]) {
          for (let k = 0; k < nz; k++) {
            if (hash(i * 7.1 + f * 3 + k, lado + 40) < 0.1) continue;
            const lz = (k - (nz - 1) / 2) * 3.4;
            poner('marco', lado * (corto / 2 + 0.03), yv, lz, 0.16, hv + 0.34, 1.34, '#f3efe6');
            poner('vidrio', lado * (corto / 2 + 0.1), yv, lz, 0.1, hv, 1.0, hash(i + k * 1.7, 55 + f) < 0.5 ? '#5f7f95' : '#7396ab');
          }
        }
        const nx = Math.floor((corto - 1.4) / 3.2);
        for (const cara of [-1, 1]) {
          if (cara === 1 && f === 0 && puerta) continue;
          for (let k = 0; k < nx; k++) {
            const lx = (k - (nx - 1) / 2) * 3.2;
            poner('marco', lx, yv, cara * (largo / 2 + 0.03), 1.34, hv + 0.34, 0.16, '#f3efe6');
            poner('vidrio', lx, yv, cara * (largo / 2 + 0.1), 1.0, hv, 0.1, '#6a8aa0');
          }
        }
      }
      if (puerta) {
        poner('puerta', 0, 0.1, largo / 2 + 0.1, 1.2, 2.3, 0.22, hash(i * 1.9, 3) < 0.5 ? '#6b4a32' : '#3f5a48');
        poner('zocalo', 0, 0, largo / 2 + 0.55, 2.2, 0.28, 1.1, '#b9b2a6');
      }
      if (!grande && hash(i * 4.1, 29) < 0.28) poner('chimenea', corto * 0.22, alto + 0.2, -largo * 0.18, 0.9, 2.8, 0.9, '#a3836f');
    });
    const caja = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.desechables.push(caja);
    const vidrio = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.18, metalness: 0.35, emissive: '#2a3a46', emissiveIntensity: 0.15 });
    const mate = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
    this.desechables.push(vidrio, mate);
    const color = new THREE.Color();
    for (const k of Object.keys(g) as (keyof typeof g)[]) {
      const piezas = g[k];
      if (!piezas.length) continue;
      const im = new THREE.InstancedMesh(caja, k === 'vidrio' ? vidrio : mate, piezas.length);
      piezas.forEach((u, i) => { im.setMatrixAt(i, u.m); im.setColorAt(i, color.set(u.c)); });
      im.castShadow = k === 'chimenea'; im.receiveShadow = true;
      this.escena.add(im);
    }
  }

  private instanciar(modelo: Modelo, puestos: { x: number; y: number; z: number; ry: number; s: number }[]): void {
    const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), eje = new THREE.Vector3(0, 1, 0);
    for (const pieza of modelo.piezas) {
      const im = new THREE.InstancedMesh(pieza.g, this.material(pieza.color), puestos.length);
      puestos.forEach((u, i) => {
        q.setFromAxisAngle(eje, u.ry);
        mat.compose(p.set(u.x, u.y, u.z), q, s.set(u.s, u.s, u.s));
        im.setMatrixAt(i, mat);
      });
      im.castShadow = true; im.receiveShadow = true;
      this.escena.add(im);
    }
  }

  /** Bosque en las laderas y árboles sueltos por el pueblo: todos los del catálogo (samán, guayacán amarillo, yarumo, ceiba y el del bosque). */
  private sembrarArboles(d: Diorama): void {
    for (const [id, s] of Object.entries(d.sitios)) {
      const n = Math.ceil(((PADS[id] ?? 30) + TALUD) / 24);
      for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) this.marcar(s[0] + a * 24, s[1] + b * 24);
    }
    const especies = [
      { nombre: 'Árbol', peso: 4 }, { nombre: 'Samán', peso: 1.5 }, { nombre: 'Guayacán', peso: 2.5 }, { nombre: 'Yarumo', peso: 2 }, { nombre: 'Ceiba', peso: 1.2 },
    ];
    const total = especies.reduce((a, e) => a + e.peso, 0);
    const porEspecie = new Map<string, { x: number; y: number; z: number; ry: number; s: number }[]>(especies.map(e => [e.nombre, []]));
    let n = 0, intentos = 0;
    while (n < 1500 && intentos++ < 30000) {
      const x = (this.rnd() - 0.5) * (d.ancho - 20), z = (this.rnd() - 0.5) * (d.fondo - 20);
      const h = alturaTerreno(x, z);
      if (this.sobreCamino(x, z, 3)) continue;
      const enPueblo = this.estaOcupado(x, z);
      if (enPueblo && this.rnd() > 0.18) continue;       // dentro del casco urbano solo unos pocos, entre las casas
      if (!enPueblo && h < 40 && this.rnd() > 0.5) continue;
      let t = this.rnd() * total, esp = especies[0].nombre;
      for (const e of especies) { if ((t -= e.peso) <= 0) { esp = e.nombre; break; } }
      porEspecie.get(esp)!.push({ x, y: h, z, ry: this.rnd() * 6.28, s: (enPueblo ? 0.45 : h < 40 ? 0.6 : 1.0) * (0.75 + this.rnd() * 0.5) });
      n++;
    }
    for (const e of especies) this.instanciar(modelarEquipamiento('naturaleza', 'Vegetación', e.nombre, this.rnd), porEspecie.get(e.nombre)!);
  }

  /** Tramos de calle dentro del recuadro, partidos donde la vía sale de él. */
  private rutasDe(d: Diorama, clases: number[]): Ruta[] {
    const rutas: Ruta[] = [];
    const dentro = (x: number, z: number) => Math.abs(x) < d.ancho / 2 - 6 && Math.abs(z) < d.fondo / 2 - 6;
    for (const [clase, pts] of d.vias) {
      const k = Math.min(clase, 2);
      if (!clases.includes(k)) continue;
      let tramo: number[] = [];
      const cerrar = () => {
        if (tramo.length >= 4) {
          const cum = [0];
          for (let i = 2; i < tramo.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(tramo[i] - tramo[i - 2], tramo[i + 1] - tramo[i - 1]));
          if (cum[cum.length - 1] > 50) rutas.push({ pts: tramo, cum, total: cum[cum.length - 1], clase: k });
        }
        tramo = [];
      };
      for (let i = 0; i + 1 < pts.length; i += 2) { if (dentro(pts[i], pts[i + 1])) tramo.push(pts[i], pts[i + 1]); else cerrar(); }
      cerrar();
    }
    return rutas;
  }

  /** Tráfico por las calles principales y locales, y gente por las aceras, con los modelos del catálogo del mapa 3D. */
  private construirMovimiento(d: Diorama): void {
    const elegir = (rutas: Ruta[]) => {
      const total = rutas.reduce((a, r) => a + r.total, 0);
      return () => { let t = this.rnd() * total; for (const r of rutas) if ((t -= r.total) <= 0) return r; return rutas[0]; };
    };
    const calles = this.rutasDe(d, [0, 1]), aceras = this.rutasDe(d, [1, 2]);
    const autos = elegir(calles), peatones = elegir(aceras);
    const colores = ['#ff2d2d', '#ff8a00', '#ffd400', '#00d26a', '#00c2ff', '#2f6bff', '#e040fb', '#ff4fa3'];
    const c = new THREE.Color();
    const crear = (modelo: Modelo, n: number, escala: number, eje: 'x' | 'z', pintar: boolean, ruta: () => Ruta, vel: [number, number], lado: (r: Ruta) => number): void => {
      const mallas = modelo.piezas.map(p => {
        const cuerpo = pintar && p.color === '#ff2d2d';
        const im = new THREE.InstancedMesh(p.g, this.material(cuerpo ? '#ffffff' : p.color), n);
        im.frustumCulled = false;
        im.castShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (cuerpo) for (let i = 0; i < n; i++) im.setColorAt(i, c.set(colores[Math.floor(this.rnd() * colores.length)]));
        this.escena.add(im);
        return im;
      });
      const agentes: Agente[] = [];
      for (let i = 0; i < n; i++) {
        const r = ruta();
        agentes.push({ ruta: r, s: this.rnd() * r.total, dir: this.rnd() < 0.5 ? 1 : -1, vel: vel[0] + this.rnd() * (vel[1] - vel[0]), lado: lado(r), i });
      }
      const flota: Flota = { mallas, escala, eje, agentes };
      if (eje === 'x') {
        // dos faros delanteros y dos luces traseras por vehículo, que se encienden de noche
        const cero = new Array(n * 6).fill(0);
        flota.faros = this.brillo(cero, '#fff1c0', 5.5, 0.8) ?? undefined;
        flota.colas = this.brillo([...cero], '#ff3b2f', 3.4, 0.7) ?? undefined;
        for (const pt of [flota.faros, flota.colas]) (pt?.geometry.attributes['position'] as THREE.BufferAttribute | undefined)?.setUsage(THREE.DynamicDrawUsage);
      }
      this.flotas.push(flota);
    };
    const carril = (r: Ruta) => ANCHO_CALLE[r.clase] * 0.25;
    const flota: [string, number, [number, number]][] = [['Auto', 46, [18, 30]], ['Taxi', 18, [18, 30]], ['Campero FJ', 11, [16, 26]], ['Bus', 8, [12, 18]], ['Camión con tráiler', 6, [10, 16]], ['Moto', 22, [22, 34]]];
    for (const [nombre, n, vel] of flota) {
      const escala = nombre === 'Bus' || nombre.startsWith('Camión') ? 0.5 : 0.55;
      crear(modelarEquipamiento('vehiculos', 'Vehículo', nombre, this.rnd), n, escala, 'x', nombre === 'Auto', autos, vel, carril);
    }
    for (const nombre of ['Hombre', 'Mujer', 'Niño escolar', 'Campesino']) {
      crear(modelarEquipamiento('gente', 'Persona', nombre, this.rnd), 44, 3.4, 'z', false, peatones, [3, 6], r => (this.rnd() < 0.5 ? 1 : -1) * (ANCHO_CALLE[r.clase] / 2 + 2.2));
    }
  }

  /** Avanza vehículos y gente por su tramo; al llegar a un extremo dan la vuelta. */
  private moverGente(dt: number): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), eje = new THREE.Vector3(0, 1, 0);
    for (const f of this.flotas) {
      for (const a of f.agentes) {
        const r = a.ruta;
        a.s += a.dir * a.vel * dt;
        if (a.s < 0) { a.s = 0; a.dir = 1; } else if (a.s > r.total) { a.s = r.total; a.dir = -1; }
        let lo = 0, hi = r.cum.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r.cum[mid] <= a.s) lo = mid; else hi = mid; }
        const x0 = r.pts[2 * lo], z0 = r.pts[2 * lo + 1], x1 = r.pts[2 * hi], z1 = r.pts[2 * hi + 1];
        const largo = r.cum[hi] - r.cum[lo] || 1, t = (a.s - r.cum[lo]) / largo;
        let hx = (x1 - x0) / largo, hz = (z1 - z0) / largo;
        if (a.dir < 0) { hx = -hx; hz = -hz; }
        const x = x0 + (x1 - x0) * t - hz * a.lado, z = z0 + (z1 - z0) * t + hx * a.lado;
        q.setFromAxisAngle(eje, f.eje === 'x' ? Math.atan2(-hz, hx) : Math.atan2(hx, hz));
        const yv = this.nivel(x, z);
        m.compose(p.set(x, yv, z), q, sc.setScalar(f.escala));
        if (f.faros && f.colas && f.faros.visible) {
          const pf = f.faros.geometry.attributes['position'] as THREE.BufferAttribute, pc = f.colas.geometry.attributes['position'] as THREE.BufferAttribute;
          for (const lado of [-1, 1]) {
            const k = a.i * 2 + (lado > 0 ? 1 : 0), lx = -hz * lado * 0.8, lz = hx * lado * 0.8;
            pf.setXYZ(k, x + hx * 2.9 + lx, yv + 1.1, z + hz * 2.9 + lz);
            pc.setXYZ(k, x - hx * 2.9 + lx, yv + 1.2, z - hz * 2.9 + lz);
          }
        }
        for (const im of f.mallas) im.setMatrixAt(a.i, m);
      }
      for (const im of f.mallas) im.instanceMatrix.needsUpdate = true;
      if (f.faros && f.colas && f.faros.visible) { (f.faros.geometry.attributes['position'] as THREE.BufferAttribute).needsUpdate = true; (f.colas.geometry.attributes['position'] as THREE.BufferAttribute).needsUpdate = true; }
    }
  }

  /** Puntos de luz que se encienden de noche (aureolas aditivas, sin luces reales): ventanas, farolas. */
  private brillo(pos: number[], color: string, tam: number, max: number): THREE.Points | null {
    if (!pos.length) return null;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: tex, color, size: tam, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    pts.renderOrder = 9;
    this.escena.add(pts);
    this.desechables.push(tex, geo, mat);
    this.brillos.push({ pts, max, px: tam });
    return pts;
  }

  /** Postes de luz a lo largo de las calles principales y locales, alternando de lado; su lámpara se enciende al anochecer. */
  private construirFarolas(d: Diorama): void {
    const postes: { x: number; z: number; ry: number; y: number }[] = [];
    const luces: number[] = [];
    const charcos: { x: number; z: number; hx: number; hz: number }[] = [];
    const lejosDeSitios = (x: number, z: number) => Object.values(d.sitios).every(s => Math.hypot(x - s[0], z - s[1]) > 48);
    let alterna = 0;
    for (const r of this.rutasDe(d, [0, 1])) {
      const paso = r.clase === 0 ? 40 : 54, lado = ANCHO_CALLE[r.clase] / 2 + 2.2;
      for (let s = paso / 2; s < r.total; s += paso) {
        let lo = 0, hi = r.cum.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= s) lo = m; else hi = m; }
        const x0 = r.pts[2 * lo], z0 = r.pts[2 * lo + 1], x1 = r.pts[2 * hi], z1 = r.pts[2 * hi + 1];
        const largo = r.cum[hi] - r.cum[lo] || 1, t = (s - r.cum[lo]) / largo;
        const tx = (x1 - x0) / largo, tz = (z1 - z0) / largo;
        const sig = (alterna++ % 2) ? 1 : -1;
        const nx = -tz * sig, nz = tx * sig;                            // hacia afuera de la vía
        const x = x0 + (x1 - x0) * t + nx * lado, z = z0 + (z1 - z0) * t + nz * lado;
        if (!lejosDeSitios(x, z) || Math.abs(z - zRio(x)) * 0.8 < ANCHO_RIO / 2 + 6) continue;
        if (this.puentes.some(b => Math.hypot(x - b.x, z - b.z) < b.r + 6)) continue;
        postes.push({ x, z, ry: Math.atan2(nz, -nx), y: alturaTerreno(x, z) + 2.3 });      // el brazo apunta hacia la vía
        luces.push(x - nx * 3.1, alturaTerreno(x, z) + 2.3 + 10.4, z - nz * 3.1);
        charcos.push({ x: x - nx * 5.5, z: z - nz * 5.5, hx: x - nx * 3.1, hz: z - nz * 3.1 });
      }
    }
    if (!postes.length) return;
    const palo = new THREE.CylinderGeometry(0.45, 0.7, 11, 6).translate(0, 5.5, 0);
    const brazo = new THREE.BoxGeometry(3.4, 0.45, 0.45).translate(-1.5, 10.8, 0);
    const cabeza = new THREE.BoxGeometry(2.2, 0.5, 1.1).translate(-3.1, 10.5, 0);
    this.matFarola = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffd986', emissiveIntensity: 0, roughness: 0.5 });
    const gris = new THREE.MeshStandardMaterial({ color: '#4b5560', roughness: 0.7 });
    this.desechables.push(palo, brazo, cabeza, this.matFarola, gris);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), eje = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    [[palo, gris], [brazo, gris], [cabeza, this.matFarola]].forEach(([g, mt]) => {
      const im = new THREE.InstancedMesh(g as THREE.BufferGeometry, mt as THREE.Material, postes.length);
      postes.forEach((u, i) => { q.setFromAxisAngle(eje, u.ry); im.setMatrixAt(i, m.compose(p.set(u.x, u.y, u.z), q, sc)); });
      im.castShadow = true;
      this.escena.add(im);
    });
    luces.push(...this.lucesExtra);
    charcos.push(...this.charcosExtra);
    this.brillo(luces, '#ffe2a0', 9, 0.7);
    this.estelasDeLuz(charcos);
  }

  /** Cada farola ilumina la vía: un charco de luz cálida sobre el asfalto y un cono tenue que baja desde la lámpara. */
  private estelasDeLuz(pts: { x: number; z: number; hx: number; hz: number; y?: number }[]): void {
    if (!pts.length) return;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,226,160,1)'); gr.addColorStop(0.35, 'rgba(255,205,120,.55)'); gr.addColorStop(0.7, 'rgba(255,190,100,.18)'); gr.addColorStop(1, 'rgba(255,190,100,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const charco = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    const haz = new THREE.MeshBasicMaterial({ color: '#ffd68a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const plano = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const cono = new THREE.ConeGeometry(7.5, 10.4, 14, 1, true).translate(0, -5.2, 0);
    const suelo = new THREE.InstancedMesh(plano, charco, pts.length), conos = new THREE.InstancedMesh(cono, haz, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    pts.forEach((u, i) => {
      suelo.setMatrixAt(i, m.compose(p.set(u.x, u.y ?? alturaTerreno(u.x, u.z) + 2.75, u.z), q, sc.set(38, 1, 38)));
      conos.setMatrixAt(i, m.compose(p.set(u.hx, alturaTerreno(u.hx, u.hz) + 2.3 + 10.4, u.hz), q, sc.set(1, 1, 1)));
    });
    for (const im of [suelo, conos]) { im.frustumCulled = false; im.visible = false; im.renderOrder = 4; this.escena.add(im); }
    this.desechables.push(tex, charco, haz, plano, cono);
    this.estelas = [{ obj: suelo, mat: charco, max: 0.85 }, { obj: conos, mat: haz, max: 0.1 }];
  }
  private estelas: { obj: THREE.Object3D; mat: THREE.Material; max: number }[] = [];

  /** Estrellas sobre el horizonte, que solo se ven de noche: muchas pequeñas y unas pocas más grandes que titilan. */
  private construirEstrellas(): void {
    const capa = (n: number, size: number): THREE.Points => {
      const pos: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = this.rnd() * Math.PI * 2, e = 0.03 + Math.pow(this.rnd(), 0.8) * 1.4, r = 3600;
        pos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: '#ffffff', size: size * Math.min(devicePixelRatio, 2), sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      this.escena.add(pts);
      this.desechables.push(geo, mat);
      return pts;
    };
    this.estrellas = capa(1800, 1.6);
    this.estrellasGrandes = capa(220, 3);
  }
  private estrellasGrandes: THREE.Points | null = null;

  /** Un día de 24 h en 3 min: el sol cruza el cielo, el cielo y las luces cambian, y al anochecer se encienden farolas y ventanas. */
  /** hora simulada (0–24): avanza sola, un día en 3 minutos, salvo que se pause o se elija a mano */
  horaSim = 10;
  enPausa = false;

  fijarHora(v: string): void {
    this.horaSim = Math.min(24, Math.max(0, Number(v))) % 24;
    this.enPausa = true;
  }

  alternarCiclo(): void { this.enPausa = !this.enPausa; }

  private animarCiclo(t: number, dt: number): void {
    if (!this.enPausa) this.horaSim = (this.horaSim + dt * 24 / 180) % 24;
    const hh = this.horaSim;
    const a = (hh - 6) / 12 * Math.PI, alto = Math.sin(a);                 // alto > 0: de día
    const dia = THREE.MathUtils.smoothstep(alto, -0.3, 0.12), noche = 1 - dia;
    // las luces artificiales se encienden a las 17:00 y se apagan a las 6:00 (con una rampa corta)
    const rampa = (v: number) => { const u = Math.min(1, Math.max(0, v)); return u * u * (3 - 2 * u); };
    const luz = hh >= 12 ? rampa((hh - 16.8) / 0.5) : 1 - rampa((hh - 5.8) / 0.5);
    const ocaso = Math.exp(-Math.pow(alto / 0.22, 2));                       // tinte cálido al amanecer y al atardecer
    const mezcla = (d: string, o: string, n: string) => new THREE.Color(d).lerp(new THREE.Color(o), ocaso * dia + ocaso * noche * 0.5).lerp(new THREE.Color(n), noche);
    this.sol.position.set(Math.cos(a) * 640, Math.max(alto, 0.05) * 560 + 30, 230);
    this.sol.intensity = 2.6 * dia;
    this.sol.color.set('#fff4e0').lerp(new THREE.Color('#ff9a55'), ocaso);
    this.luna.intensity = 0.55 * noche;
    this.luna.position.set(-Math.cos(a) * 500, 420, -240);
    this.hemi.intensity = 0.5 + 0.7 * dia;
    this.hemi.color.set('#8fa3d8').lerp(new THREE.Color('#ffffff'), dia);
    this.hemi.groundColor.set('#222a3a').lerp(new THREE.Color('#88aa77'), dia);
    if (this.matFarola) this.matFarola.emissiveIntensity = 1.6 * luz;
    // los edificios de los responsables se iluminan por dentro (salvo el que está resaltado, que ya brilla)
    const activo = this.elegido()?.dep.id;
    for (const b of this.edificios) {
      if (b.r.dep.id === this.resaltando || b.r.dep.id === activo) continue;
      for (const mt of b.mats) { mt.emissive.set('#ffb35a'); mt.emissiveIntensity = 0.05 * luz; }
    }
    // el tamaño en pantalla de las luces crece poco al acercarse, para que se vean de lejos sin volverse manchas de cerca
    const zoom = Math.min(1.5, Math.max(0.6, Math.sqrt(1400 / this.camara.position.distanceTo(this.controles.target)))) * Math.min(devicePixelRatio, 2);
    for (const e of this.estelas) { e.obj.visible = luz > 0.02; e.mat.opacity = e.max * luz; }
    for (const b of this.brillos) { const mt = b.pts.material as THREE.PointsMaterial; b.pts.visible = luz > 0.02; mt.opacity = b.max * luz; mt.size = b.px * zoom; }
    const brilloEstrella = Math.max(0, noche - 0.35) * 1.5;
    for (const [capa, vivo] of [[this.estrellas, 0], [this.estrellasGrandes, 1]] as const) {
      if (!capa) continue;
      capa.visible = noche > 0.4;
      (capa.material as THREE.PointsMaterial).opacity = Math.min(1, brilloEstrella) * (vivo ? 0.65 + 0.35 * Math.sin(t * 2.3) : 0.85);
    }
    for (const ro of this.rotores) ro.rotation.z += dt * 1.1;
    this.animarNubes(dt, dia, ocaso);
    this.animarNiebla(dt, dia);
    // el cielo es el degradado del recuadro del mapa
    const arriba = mezcla('#a9cdee', '#e9936a', '#0a1230'), abajo = mezcla('#e6eff7', '#f7c98b', '#222f5a');
    if (!this.fondoMapa) this.fondoMapa = this.lienzo.nativeElement.parentElement;
    if (this.fondoMapa) this.fondoMapa.style.background = `linear-gradient(#${arriba.getHexString()}, #${abajo.getHexString()})`;
    const hora = Math.floor(hh);
    if (hora !== this.horaMostrada) {
      this.horaMostrada = hora;
      this.hora.set(`${dia > 0.5 ? '☀' : '🌙'} ${String(hora).padStart(2, '0')}:00`);
    }
  }

  /** Bocanadas de humo grises que nacen en la boca de la chimenea, suben con el viento, se ensanchan y se desvanecen. */
  private crearHumo(x: number, y: number, z: number): void {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.desechables.push(tex);
    const puffs = Array.from({ length: 18 }, () => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.renderOrder = 8;
      this.escena.add(sp);
      this.desechables.push(sp.material);
      return sp;
    });
    this.humos.push({ x, y, z, puffs });
  }

  private animarHumo(t: number): void {
    for (const h of this.humos) {
      h.puffs.forEach((sp, i) => {
        const p = ((t / 9) + i / h.puffs.length) % 1;
        sp.position.set(h.x + p * 95 + Math.sin(t * 0.7 + i) * 3, h.y + p * 125, h.z + p * 32);
        const e = 9 + p * 36;
        sp.scale.set(e, e, 1);
        sp.material.opacity = Math.min(p / 0.08, 1) * (1 - p) * 0.75;
        sp.material.color.setScalar(0.32 + 0.6 * p);
      });
    }
  }

  /** Bandada en V que cruza el pueblo de sur a norte, con las alas aleteando (las mismas aves del mapa 3D). */
  private construirPajaros(d: Diorama): void {
    const plano = (pts: [number, number][], lado: number) => {
      const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(lado * x, -z))));
      g.rotateX(-Math.PI / 2);
      this.desechables.push(g);
      return g;
    };
    const brazo: [number, number][] = [[0, -9], [6, -10.5], [13, -10], [20, -7.5], [20, -1], [14, 2.5], [7, 4.5], [0, 5]];
    const mano: [number, number][] = [[0, -7.5], [8, -9.5], [17, -9], [26, -6], [34, -1.5], [37, 1.5], [31, 1], [29, 4.5], [23, 2.5], [21, 6], [15, 3.5], [12, 6.5], [6, 4], [0, 0.5]];
    const forma = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0) => { g.translate(x, y, z); this.desechables.push(g); return g; };
    const cuerpo = forma(new THREE.SphereGeometry(1, 10, 8).scale(3.6, 3.2, 12));
    const cabeza = forma(new THREE.SphereGeometry(2.7, 9, 7), 0, 1.2, -12.5);
    const pico = forma(new THREE.ConeGeometry(1.1, 6.5, 6).rotateX(-Math.PI / 2), 0, 0.7, -18.6);
    const cola = forma(new THREE.ShapeGeometry(new THREE.Shape([[-2.5, 8], [-6.5, 21], [-3.5, 24], [0, 22], [3.5, 24], [6.5, 21], [2.5, 8]].map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2));
    const blanco = new THREE.MeshLambertMaterial({ color: '#f6f8fa', emissive: '#7a8490', side: THREE.DoubleSide });
    const plumas = new THREE.MeshLambertMaterial({ color: '#e7ecf1', emissive: '#6b7480', side: THREE.DoubleSide });
    const amarillo = new THREE.MeshLambertMaterial({ color: '#f2a73b', emissive: '#6b4a14' });
    this.desechables.push(blanco, plumas, amarillo);
    const alaGeos = [-1, 1].map(lado => ({ brazo: plano(brazo, lado), mano: plano(mano, lado) }));
    for (let i = 0; i < 9; i++) {
      const fila = Math.ceil(i / 2), lado = i % 2 ? 1 : -1;
      const grupo = new THREE.Group();
      grupo.add(new THREE.Mesh(cuerpo, blanco), new THREE.Mesh(cabeza, blanco), new THREE.Mesh(pico, amarillo), new THREE.Mesh(cola, plumas));
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
      grupo.visible = false;
      this.escena.add(grupo);
      this.pajaros.push({
        grupo, izq: izq.hombro, der: der.hombro, codoIzq: izq.codo, codoDer: der.codo,
        ox: i ? lado * fila * 75 + (this.rnd() - 0.5) * 40 : 0, oz: i ? fila * 85 + (this.rnd() - 0.5) * 50 : 0, oy: (this.rnd() - 0.5) * 40,
        y: 200, fase: this.rnd() * Math.PI * 2, ritmo: 7 + this.rnd() * 3,
      });
    }
    this.recorridoPajaros = d.fondo + 600;
    this.tiempoPajaros = (this.recorridoPajaros / VELOCIDAD_PAJAROS) * 0.28;
  }
  private recorridoPajaros = 1700;

  private animarPajaros(dt: number, t: number): void {
    if (!this.pajaros.length) return;
    this.tiempoPajaros += dt;
    const duracion = this.recorridoPajaros / VELOCIDAD_PAJAROS;
    const fase = this.tiempoPajaros % (duracion + 7);
    const volando = fase < duracion, avance = fase / duracion;
    const suave = (v: number) => { const u = Math.min(1, Math.max(0, v / 0.06)); return u * u * (3 - 2 * u); };
    const escala = 0.5 * suave(avance) * suave(1 - avance);
    const zGuia = this.recorridoPajaros / 2 - avance * this.recorridoPajaros;     // de sur (+z) a norte (-z)
    for (const b of this.pajaros) {
      b.grupo.visible = volando && escala > 0.01;
      if (!b.grupo.visible) continue;
      const x = -120 + b.ox + Math.sin(t * 0.6 + b.fase) * 14, z = zGuia + b.oz;
      const objetivo = Math.max(alturaTerreno(Math.max(-690, Math.min(690, x)), Math.max(-540, Math.min(540, z))), 0) + 150 + b.oy + Math.sin(t * 1.1 + b.fase) * 8;
      b.y += (objetivo - b.y) * Math.min(1, dt * 1.5);
      b.grupo.position.set(x, b.y, z);
      b.grupo.scale.setScalar(escala);
      const a = Math.sin(t * b.ritmo + b.fase) * 0.55, m = Math.sin(t * b.ritmo + b.fase - 0.9) * 0.55;
      b.izq.rotation.z = a; b.der.rotation.z = -a;
      b.codoIzq.rotation.z = m; b.codoDer.rotation.z = -m;
    }
  }

  /** Bocanada de nube del mapa 3D: ruido fractal con borde que se desvanece y sombreado hacia la luz horneado en la textura. */
  private texturaBocanada(semilla: number): THREE.CanvasTexture {
    const N = 160;
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
      let a = 0.5, s2 = 0, f = 1;
      for (let o = 0; o < 5; o++) { s2 += a * valor(x * f, y * f); f *= 2.03; a *= 0.5; }
      return s2;
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
        const d = dens[j * N + i], hacia = dens[Math.max(0, j - 6) * N + Math.max(0, i - 4)];
        const lum = Math.min(1.05, Math.max(0.74, 0.9 + (d - hacia) * 1.4)), k = (j * N + i) * 4;
        img.data[k] = Math.min(255, 255 * lum * (0.93 + 0.07 * lum));
        img.data[k + 1] = Math.min(255, 255 * lum * (0.96 + 0.04 * lum));
        img.data[k + 2] = Math.min(255, 255 * lum);
        img.data[k + 3] = 255 * d;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.desechables.push(t);
    return t;
  }

  /** Cúmulos que aparecen al azar en el cielo del fondo durante el día, derivan con el viento y se deshacen. */
  private construirNubes(): void {
    const texturas = [11, 23, 37, 51].map(sm => this.texturaBocanada(sm));
    for (let i = 0; i < 4; i++) {
      const puffs: Nube['puffs'] = [];
      for (let k = 0; k < 15; k++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturas[Math.floor(this.rnd() * 4)], transparent: true, depthWrite: false, opacity: 0, fog: false }));
        sp.renderOrder = 3;
        sp.visible = false;
        this.escena.add(sp);
        this.desechables.push(sp.material);
        puffs.push({ sp, dx: 0, dy: 0, dz: 0, tam: 1, op: 0.4, claro: 0.8 });
      }
      this.nubes.push({ puffs, x: 0, y: 0, z: 0, vx: 0, vz: 0, edad: 0, vida: 1, espera: this.rnd() * 14 });
    }
  }

  /** Coloca una nube en el cielo que se ve tras la maqueta: según desde dónde mira la cámara ahora, a poca altura sobre el horizonte. */
  private sembrarNube(n: Nube): void {
    const cam = this.camara.position;
    // un punto del cielo visible: arriba en el cuadro, donde queda el cielo tras la maqueta
    this.camara.updateMatrixWorld();
    const rayo = new THREE.Vector3((this.rnd() * 2 - 1) * 0.95, 0.45 + this.rnd() * 0.5, 0.5).unproject(this.camara).sub(cam).normalize();
    if (rayo.y < 0.012) { rayo.y = 0.012; rayo.normalize(); }
    const dist = 3300 + this.rnd() * 2200;
    const az = Math.atan2(rayo.x, rayo.z);
    const radio = dist * (0.03 + this.rnd() * 0.03);
    n.x = cam.x + rayo.x * dist; n.z = cam.z + rayo.z * dist; n.y = cam.y + rayo.y * dist;
    n.vx = 10 + this.rnd() * 8; n.vz = 3 + this.rnd() * 3;
    n.vida = 35 + this.rnd() * 35; n.edad = 0;
    const lat = new THREE.Vector2(Math.cos(az), -Math.sin(az)), hacia = new THREE.Vector2(Math.sin(az), Math.cos(az));
    const sol = new THREE.Vector2(-1, -1).normalize();
    n.puffs.forEach(pf => {
      const ang = this.rnd() * Math.PI * 2, r = Math.sqrt(this.rnd());
      const ox = Math.cos(ang) * r * radio * 1.35, oz = Math.sin(ang) * r * radio * 0.7;
      const alto = (1 - r * r) * radio * 0.34 * (0.35 + this.rnd() * 0.9);
      pf.dx = lat.x * ox + hacia.x * oz; pf.dz = lat.y * ox + hacia.y * oz; pf.dy = alto - radio * 0.08;
      pf.tam = radio * (0.75 + this.rnd() * 0.7) * (1.15 - r * 0.45) * 2.2;
      pf.op = 0.4 + this.rnd() * 0.3;
      pf.claro = Math.min(1, Math.max(0, 0.62 + 0.3 * Math.min(1, alto / (radio * 0.34)) + 0.15 * Math.max(-1, Math.min(1, (ox * sol.x + oz * sol.y) / (radio * 1.35)))));
    });
  }

  /** Bandas de niebla muy tenues y dispersas, a ras del terreno: se juntan en lo bajo (cerca del río y los hundimientos), derivan con el viento y se funden al irse. */
  private construirNiebla(d: Diorama): void {
    const tex = [5, 17, 29, 43].map(sm => this.texturaBocanada(sm));
    const cand: { x: number; z: number; h: number }[] = [];
    for (let x = -d.ancho / 2 + 60; x <= d.ancho / 2 - 60; x += 70) {
      for (let z = -d.fondo / 2 + 60; z <= d.fondo / 2 - 60; z += 70) {
        const h = alturaTerreno(x, z);
        let ent = 0;
        for (let k = 0; k < 8; k++) ent += alturaTerreno(x + Math.cos(k * 0.785) * 180, z + Math.sin(k * 0.785) * 180);
        cand.push({ x, z, h: ent / 8 - h });
      }
    }
    cand.sort((a, b) => b.h - a.h);
    const puestos: typeof cand = [];
    for (const c of cand.slice(0, 160)) {
      if (puestos.length >= 5) break;
      if (puestos.every(e => Math.hypot(e.x - c.x, e.z - c.z) > 230)) puestos.push(c);
    }
    for (const c of puestos) {
      for (let k = 0; k < 3; k++) {
        const mat = new THREE.SpriteMaterial({ map: tex[Math.floor(this.rnd() * 4)], color: '#f1f6fc', transparent: true, depthWrite: false, opacity: 0, fog: false });
        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 4;
        this.escena.add(sprite);
        this.desechables.push(mat);
        const x = c.x + (this.rnd() - 0.5) * 220, z = c.z + (this.rnd() - 0.5) * 220, dy = 8 + this.rnd() * 22;
        this.nieblas.push({ sprite, x, z, x0: x, z0: z, dy, y: alturaTerreno(x, z) + dy, ancho: 260 + this.rnd() * 220, fase: this.rnd() * 6.28 });
      }
    }
  }

  private animarNiebla(dt: number, dia: number): void {
    const t = this.reloj.elapsedTime, cam = this.camara.position;
    const color = new THREE.Color('#f1f6fc').lerp(new THREE.Color('#5a6f93'), 1 - dia);
    for (const n of this.nieblas) {
      n.x += 2.6 * dt; n.z += 0.9 * dt;
      const lejos = Math.hypot(n.x - n.x0, n.z - n.z0);
      if (lejos > 300) { n.x = n.x0; n.z = n.z0; }
      const h = alturaTerreno(n.x, n.z);
      n.y += (h + n.dy - n.y) * Math.min(1, dt * 2);
      n.sprite.position.set(n.x + Math.sin(t * 0.05 + n.fase) * 14, n.y, n.z + Math.cos(t * 0.04 + n.fase) * 10);
      n.sprite.scale.set(n.ancho, n.ancho * 0.4, 1);
      const respira = 0.7 + 0.3 * Math.sin(t * 0.12 + n.fase * 2);
      const ciclo = 1 - Math.min(1, Math.max(0, (lejos - 190) / 110)), nace = Math.min(1, 0.35 + lejos / 70);
      const cerca = Math.min(1, Math.max(0, (cam.distanceTo(n.sprite.position) - 220) / 500));
      const mt = n.sprite.material as THREE.SpriteMaterial;
      mt.opacity = 0.4 * respira * ciclo * nace * cerca * (0.55 + 0.45 * dia);
      mt.color.copy(color);
    }
  }

  private animarNubes(dt: number, dia: number, ocaso: number): void {
    if (!this.vistaPuesta) return;
    const base = new THREE.Color('#c4dcf5'), blanco = new THREE.Color('#fffdf9'), calido = new THREE.Color('#ffc59a'), c = new THREE.Color();
    for (const n of this.nubes) {
      if (n.espera > 0) { n.espera -= dt; if (n.espera <= 0) this.sembrarNube(n); else continue; }
      n.edad += dt;
      n.x += n.vx * dt; n.z += n.vz * dt;
      if (n.edad >= n.vida) { n.espera = this.rnd() * 12; for (const pf of n.puffs) pf.sp.visible = false; continue; }
      const t = n.edad / n.vida, env = Math.min(1, t / 0.2, (1 - t) / 0.25) * dia;
      for (const pf of n.puffs) {
        pf.sp.visible = env > 0.01;
        if (!pf.sp.visible) continue;
        pf.sp.position.set(n.x + pf.dx, n.y + pf.dy, n.z + pf.dz);
        pf.sp.scale.set(pf.tam, pf.tam, 1);
        const mt = pf.sp.material;
        mt.opacity = pf.op * env;
        c.copy(base).lerp(blanco, pf.claro).lerp(calido, Math.min(1, ocaso * 0.8));
        mt.color.copy(c);
      }
    }
  }

  /** Un edificio por responsable, en el sitio libre que le tocó dentro del casco urbano y de cara a la calle más cercana. */
  private armarPueblo(rs: Resumen[], d: Diorama): void {
    const itemsAura: { x: number; y: number; z: number; radio: number; alto: number; color: string }[] = [];
    for (const r of rs) {
      const def = EDIFICIOS[r.dep.id], sitio = d.sitios[r.dep.id];
      if (!def || !sitio) continue;
      const [x, z, ry] = sitio;
      const m = r.dep.id === 'amb' ? granjaSolar() : modelarEquipamiento(def.cat, def.tipo, def.nombre, this.rnd);
      let faroPq: [number, number][] = [];
      const fijas = r.dep.id === 'tra'
        ? (() => {
          const res = this.agregarParqueadero(m, (lx, lz) => this.sobreCamino(x + (lx * Math.cos(ry) + lz * Math.sin(ry)) * 0.85, z + (-lx * Math.sin(ry) + lz * Math.cos(ry)) * 0.85, 4) ? 1 : 0);
          faroPq = res.faroles;
          return res.fijas;
        })()
        : new Set<THREE.BufferGeometry>();
      const ESC = 0.85;
      const y0 = alturaTerreno(x, z);
      for (const [lx, lz] of faroPq) {
        const wx = x + (lx * Math.cos(ry) + lz * Math.sin(ry)) * ESC, wz = z + (-lx * Math.sin(ry) + lz * Math.cos(ry)) * ESC;
        this.lucesExtra.push(wx, y0 + 0.3 + 10 * ESC, wz);
        this.charcosExtra.push({ x: wx, z: wz, hx: wx, hz: wz, y: y0 + 0.3 + 0.3 * ESC + 0.5 });
      }
      const grupo = new THREE.Group();
      grupo.position.set(x, y0 + 0.3, z);
      const radio = PADS[r.dep.id] ?? m.radio * ESC + 8;
      // explanada que asienta el edificio en la ladera
      const base = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio + 3, 14, 40).translate(0, -7, 0), new THREE.MeshStandardMaterial({ color: '#d7dcc0', roughness: 1 }));
      base.receiveShadow = true;
      this.desechables.push(base.geometry, base.material as THREE.Material);
      grupo.add(base);
      const cuerpo = new THREE.Group();
      cuerpo.rotation.y = ry;
      cuerpo.scale.setScalar(ESC);
      const mats: THREE.MeshStandardMaterial[] = [];
      const caja = new THREE.Box3();
      const tinte = PALETA[rs.indexOf(r) % PALETA.length];
      for (const p of m.piezas) {
        const mt = new THREE.MeshStandardMaterial({ color: r.dep.id !== 'amb' && !fijas.has(p.g) && esNeutro(p.color) ? tinte : p.color, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
        mats.push(mt);
        const malla = new THREE.Mesh(p.g, mt);
        malla.castShadow = true; malla.receiveShadow = true;
        cuerpo.add(malla);
        p.g.computeBoundingBox();
        caja.union(p.g.boundingBox!);
      }
      grupo.add(cuerpo);
      if (r.dep.id === 'amb') {
        const rotor = new THREE.Group();
        rotor.position.set(EOLICA.x, EOLICA.alto - 3, EOLICA.z - 5);
        const aspa = new THREE.BoxGeometry(1.2, 17, 0.35).translate(0, 9.5, 0), buje = new THREE.SphereGeometry(1.5, 12, 8);
        const blanco = new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.6 });
        this.desechables.push(aspa, buje, blanco);
        for (let k = 0; k < 3; k++) { const a = new THREE.Mesh(aspa, blanco); a.rotation.z = k * Math.PI * 2 / 3; a.castShadow = true; rotor.add(a); }
        rotor.add(new THREE.Mesh(buje, blanco));
        cuerpo.add(rotor);
        this.rotores.push(rotor);
      }
      if (r.dep.id !== 'amb') {
        // ventanas encendidas repartidas por las fachadas del edificio
        const bb = new THREE.Box3();
        for (const pz of m.piezas) { if (fijas.has(pz.g)) continue; pz.g.computeBoundingBox(); bb.union(pz.g.boundingBox!); }
        const cs = Math.cos(ry), sn = Math.sin(ry);
        for (let k = 0; k < 9; k++) {
          const cara = Math.floor(this.rnd() * 4);
          const lx = cara < 2 ? (cara ? bb.max.x + 0.5 : bb.min.x - 0.5) : bb.min.x + this.rnd() * (bb.max.x - bb.min.x);
          const lz = cara >= 2 ? (cara === 3 ? bb.max.z + 0.5 : bb.min.z - 0.5) : bb.min.z + this.rnd() * (bb.max.z - bb.min.z);
          const ly = 2.5 + this.rnd() * Math.max(2, bb.max.y * 0.75 - 2.5);
          this.ventanasEd.push(x + (lx * cs + lz * sn) * ESC, y0 + 0.3 + ly * ESC, z + (-lx * sn + lz * cs) * ESC);
        }
      }
      if (def.nombre === 'Fábrica') {
        // la chimenea del modelo está en (-35, 70, -11) de la fábrica
        const boca = new THREE.Vector3(-35 * ESC, 72 * ESC, -11 * ESC).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        this.crearHumo(x + boca.x, y0 + 0.3 + boca.y, z + boca.z);
      }
      grupo.userData['id'] = r.dep.id;
      const alto = caja.max.y * ESC;
      const pin = this.crearPin(r);
      pin.sprite.userData['id'] = r.dep.id;
      this.escena.add(grupo, pin.sprite);
      this.edificios.push({ r, grupo, mats, x, z, y: y0 + 0.3, cima: alto, radio, pin });
      itemsAura.push({ x, y: y0 + 0.3, z, radio: radio + 2, alto: alto * 1.1 + 4, color: new THREE.Color().setHSL(matizDe(r.dep.id) / 360, 0.6, 0.5).getStyle() });
    }
    this.brillo(this.ventanasEd, '#ffd08a', 4.2, 0.75);
    this.aura = crearAuras(itemsAura);
    this.escena.add(this.aura.grupo);
  }

  /** Parqueadero junto a la estación: asfalto con borde y vehículos del catálogo (autos, taxis, camperos, motos, buses y camiones), fundidos por color para no multiplicar mallas. */
  private agregarParqueadero(m: Modelo, penal: (lx: number, lz: number) => number): { fijas: Set<THREE.BufferGeometry>; faroles: [number, number][] } {
    const porColor = new Map<string, THREE.BufferGeometry[]>();
    const poner = (g: THREE.BufferGeometry, color: string) => {
      const n = g.index ? g.toNonIndexed() : g.clone();
      n.deleteAttribute('uv');
      if (!n.attributes['normal']) n.computeVertexNormals();
      if (!porColor.has(color)) porColor.set(color, []);
      porColor.get(color)!.push(n);
    };
    const caja = (w: number, h: number, d: number, color: string, x: number, y: number, z: number) => poner(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
    const cx = m.radio + 22, zc = 1, ancho = 44, fondo = 40;
    caja(ancho, 0.3, fondo, '#4a4f55', cx, 0.15, zc);
    for (const dz of [-1, 1]) caja(ancho + 0.8, 0.4, 0.6, '#d6d3c8', cx, 0.2, zc + dz * fondo / 2);
    for (const dx of [-1, 1]) caja(0.6, 0.4, fondo, '#d6d3c8', cx + dx * ancho / 2, 0.2, zc);
    const pintura = ['#e63946', '#f4c542', '#2a6fdb', '#f4f4f2', '#2f2f33', '#2e9e5b', '#f08a24', '#9aa3ad'];
    const vehiculo = (nombre: string, escala: number, ry: number): { ancho: number; poner: (x: number, z: number) => void } => {
      const mod = modelarEquipamiento('vehiculos', 'Vehículo', nombre, this.rnd);
      const bb = new THREE.Box3();
      for (const pz of mod.piezas) { pz.g.computeBoundingBox(); bb.union(pz.g.boundingBox!); }
      const cenX = (bb.min.x + bb.max.x) / 2, cenZ = (bb.min.z + bb.max.z) / 2, col = pintura[Math.floor(this.rnd() * pintura.length)];
      const lateral = bb.max.z - bb.min.z;
      return {
        ancho: lateral * escala,
        poner: (x, z) => {
          const M = new THREE.Matrix4().makeTranslation(x, 0.3, z).multiply(new THREE.Matrix4().makeRotationY(ry)).multiply(new THREE.Matrix4().makeScale(escala, escala, escala)).multiply(new THREE.Matrix4().makeTranslation(-cenX, 0, -cenZ));
          for (const pz of mod.piezas) poner(pz.g.clone().applyMatrix4(M), pz.color === '#ff2d2d' ? col : pz.color);
        },
      };
    };
    const fila = (z: number, ry: number, nombres: string[]) => {
      let x = cx - ancho / 2 + 2;
      for (let k = 0; k < 40; k++) {
        const nombre = nombres[Math.floor(this.rnd() * nombres.length)];
        const v = vehiculo(nombre, nombre === 'Bus' || nombre.startsWith('Camión') ? 0.59 : 0.65, ry);
        if (x + v.ancho > cx + ancho / 2 - 1) break;
        v.poner(x + v.ancho / 2, z);
        x += v.ancho + 1.1;
      }
    };
    fila(-14, -Math.PI / 2, ['Auto', 'Auto', 'Taxi', 'Campero FJ']);
    fila(-5.5, Math.PI / 2, ['Auto', 'Auto', 'Taxi', 'Campero FJ']);
    fila(0.2, Math.PI / 2, ['Moto']);
    fila(11, -Math.PI / 2, ['Bus', 'Camión con tráiler', 'Bus']);
    // postes de luz en el borde y en el medio de los costados largos, con el brazo hacia el lote
    const postes: [number, number][] = [[cx - ancho / 2 + 1.5, zc - fondo / 2 + 1.5], [cx + ancho / 2 - 1.5, zc - fondo / 2 + 1.5], [cx - ancho / 2 + 1.5, zc + fondo / 2 - 1.5], [cx + ancho / 2 - 1.5, zc + fondo / 2 - 1.5], [cx, zc - fondo / 2 + 1.5], [cx, zc + fondo / 2 - 1.5]];
    const cabezas: [number, number][] = [];
    for (const [px, pz] of postes) {
      const dx = px === cx ? 0 : Math.sign(cx - px), dz = px === cx ? Math.sign(zc - pz) : 0;
      caja(0.4, 10, 0.4, '#6b7280', px, 0.3, pz);
      caja(dx ? 2.4 : 0.3, 0.3, dz ? 2.4 : 0.3, '#6b7280', px + dx * 1.2, 10.1, pz + dz * 1.2);
      caja(1.1, 0.35, 0.7, '#f5e9c8', px + dx * 2.4, 9.95, pz + dz * 2.4);
      cabezas.push([px + dx * 2.4, pz + dz * 2.4]);
    }
    // el lote se gira alrededor de la estación hacia el lado más libre de quebradas y calles
    let giro = 0, peor = Infinity;
    for (let k = 0; k < 16; k++) {
      const th = k * Math.PI / 8;
      let malo = 0;
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        const px = cx + i * (ancho / 6), pz = zc + j * (fondo / 6);
        malo += penal(px * Math.cos(th) + pz * Math.sin(th), -px * Math.sin(th) + pz * Math.cos(th));
      }
      if (malo < peor) { peor = malo; giro = th; }
    }
    const fijas = new Set<THREE.BufferGeometry>();
    for (const [color, gs] of porColor) {
      const g = mergeGeometries(gs, false);
      if (!g) continue;
      g.rotateY(giro);
      m.piezas.push({ g, color });
      fijas.add(g);
    }
    m.radio = cx + 24;
    return { fijas, faroles: cabezas.map(([hx, hz]) => [hx * Math.cos(giro) + hz * Math.sin(giro), -hx * Math.sin(giro) + hz * Math.cos(giro)] as [number, number]) };
  }

  /** Pin de mapa con el icono del responsable adentro; la punta queda sobre el techo del edificio. */
  private crearPin(r: Resumen): Pin {
    const ancho = 200, alto = 260;
    const c = document.createElement('canvas');
    c.width = ancho; c.height = alto;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const h = matizDe(r.dep.id);
    const dibujar = (ico: HTMLImageElement | null) => {
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, ancho, alto);
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
      ctx.beginPath();
      ctx.moveTo(100, 250);
      ctx.bezierCurveTo(70, 205, 18, 150, 18, 92);
      ctx.arc(100, 92, 82, Math.PI, 0, false);
      ctx.bezierCurveTo(182, 150, 130, 205, 100, 250);
      ctx.closePath();
      ctx.fillStyle = `hsl(${h} 50% 38%)`;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 7; ctx.strokeStyle = '#fcf9f6'; ctx.stroke();
      ctx.beginPath(); ctx.arc(100, 92, 60, 0, Math.PI * 2); ctx.fillStyle = '#fcf9f6'; ctx.fill();
      if (ico) ctx.drawImage(ico, 56, 48, 88, 88);
      else { ctx.fillStyle = `hsl(${h} 45% 30%)`; ctx.font = '700 64px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(r.dep.nombre.charAt(0), 100, 96); }
      tex.needsUpdate = true;
    };
    dibujar(null);
    if (r.dep.icono) {
      const img = new Image();
      img.onload = () => dibujar(img);
      img.src = `/img/iconos/${r.dep.icono}.png`;
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 12;
    return { sprite, aspecto: ancho / alto, tex };
  }

  private rayo = new THREE.Raycaster();
  private buscar(e: PointerEvent): string | null {
    const caja = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - caja.left) / caja.width) * 2 - 1, -((e.clientY - caja.top) / caja.height) * 2 + 1);
    this.rayo.setFromCamera(p, this.camara);
    const objetos: THREE.Object3D[] = [];
    for (const b of this.edificios) objetos.push(b.grupo, b.pin.sprite);
    const hit = this.rayo.intersectObjects(objetos, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData['id']) o = o.parent;
    return o ? (o.userData['id'] as string) : null;
  }

  private resaltando: string | null = null;
  resaltar(id: string | null): void {
    if (id === this.resaltando) return;
    this.resaltando = id;
    for (const b of this.edificios) {
      const on = b.r.dep.id === id || b.r.dep.id === this.elegido()?.dep.id;
      for (const m of b.mats) { m.emissive.set(on ? '#44552a' : '#000000'); m.emissiveIntensity = on ? 0.55 : 0; }
    }
    this.aura?.resaltar(this.edificios.findIndex(b => b.r.dep.id === (id ?? this.elegido()?.dep.id)));
  }

  elegir(id: string): void {
    const b = this.edificios.find(e => e.r.dep.id === id);
    if (!b) return;
    this.elegido.set(b.r);
    this.tip.set(null);
    this.resaltando = null;
    this.resaltar(id);
    this.controles.autoRotate = false;
    // la cámara se acerca conservando el rumbo desde el que se estaba mirando
    const dir = this.camara.position.clone().sub(this.controles.target).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const dist = Math.max(b.radio * 3.4, 150);
    const aObj = new THREE.Vector3(b.x, b.y + Math.min(b.cima * 0.4, 14), b.z);
    const a = aObj.clone().add(dir.multiplyScalar(dist)).setY(b.y + dist * 0.6 + 10);
    this.vuelo = { t: 0, de: this.camara.position.clone(), deObj: this.controles.target.clone(), a, aObj };
  }

  soltar(): void {
    this.elegido.set(null);
    this.resaltando = null;
    this.resaltar(null);
  }

  private animar(dt: number, t: number): void {
    this.aura?.animar(t);
    this.moverGente(dt);
    this.animarHumo(t);
    this.animarCiclo(t, dt);
    if (this.texAgua) this.texAgua.offset.y = -t * 0.35;     // la corriente corre a lo largo del cauce
    this.animarPajaros(dt, t);
    if (this.vuelo) {
      this.vuelo.t = Math.min(1, this.vuelo.t + dt / 1.4);
      const k = 1 - Math.pow(1 - this.vuelo.t, 3);
      this.camara.position.lerpVectors(this.vuelo.de, this.vuelo.a, k);
      this.controles.target.lerpVectors(this.vuelo.deObj, this.vuelo.aObj, k);
      if (this.vuelo.t >= 1) this.vuelo = null;
    }
    // los pines mantienen casi el mismo tamaño en pantalla sin importar la distancia
    const activo = this.elegido()?.dep.id;
    for (const b of this.edificios) {
      const s = b.pin.sprite;
      s.position.set(b.x, b.y + b.cima + 4 + Math.sin(t * 1.6 + b.x) * 1.2, b.z);
      const d = this.camara.position.distanceTo(s.position);
      const grande = b.r.dep.id === this.resaltando || b.r.dep.id === activo ? 1.3 : 1;
      const alto = Math.min(150, Math.max(12, d * 0.09)) * grande;
      s.scale.set(alto * b.pin.aspecto, alto, 1);
    }
  }
}
