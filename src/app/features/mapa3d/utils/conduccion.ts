import * as THREE from 'three';
import { ESCALA_ACTIVOS } from './escala';

const GRAVEDAD = 22;
const DISTANCIA_EJES = 2.8;
const ESCALA = ESCALA_ACTIVOS;      // la misma que los autos del tráfico
const VELOCIDAD_MAX = 45;           // m/s (162 km/h)
const VELOCIDAD_TURBO = 120;
const VELOCIDAD_REVERSA = 15;
const CAIDA_TERMINAL = 160;
/** Por debajo de esta altura (el punto más bajo del mapa es 0) ya no hay nada que lo sostenga: se considera caído al vacío. */
export const ALTURA_ABISMO = -150;

/** Altura del suelo en (x, z) del mundo, o -Infinity fuera del territorio (ahí no hay nada que pise). */
export type FuncionSuelo = (x: number, z: number) => number;

/** Si el carro (círculo de `radio` m en `p`) topa con algo sólido, lo saca por el lado más corto y devuelve true. */
export type FuncionObstaculo = (p: THREE.Vector3, radio: number) => boolean;

/** Radio con el que el carro choca contra edificios y equipamientos (m del mundo). */
const RADIO_CHOQUE = 3;

/**
 * Carro de conducción libre: va sobre la calzada (el suelo que recibe ya la incluye), choca contra edificios y equipamientos
 * (rebota y pierde velocidad), sigue el relieve mientras haya terreno, sale disparado por las crestas y, si se sale del mapa
 * o se despeña, cae al vacío. Árboles y agua no estorban.
 */
export class Conduccion {
  readonly objeto = new THREE.Group();
  readonly teclas = new Set<string>();

  private readonly pos = new THREE.Vector3();
  private rumbo = 0;
  private velocidad = 0;
  private vy = 0;
  private enSuelo = true;
  private volante = 0;
  private cabeceo = 0;
  private alabeo = 0;
  private rumboCamara = 0;
  private readonly posCamara = new THREE.Vector3();
  private readonly inicio = new THREE.Vector3();
  private rumboInicio = 0;
  private camaraLista = false;
  /** mando de la cámara con el ratón: giro alrededor del carro, inclinación extra y alejamiento (1 = normal) */
  private giroMando = 0;
  private inclinacionMando = 0;
  private distanciaMando = 1;
  private ultimoMando = -Infinity;
  private recentrando = false;

  constructor(private readonly suelo: FuncionSuelo, private readonly obstaculo?: FuncionObstaculo) {
    this.objeto.add(this.construirCarro());
    this.objeto.scale.setScalar(ESCALA);
    this.objeto.visible = false;
  }

  get posicion(): THREE.Vector3 { return this.pos; }
  get kmh(): number { return Math.abs(this.velocidad) * 3.6; }
  get altura(): number { return this.pos.y; }
  get cayo(): boolean { return this.pos.y < ALTURA_ABISMO; }
  get volando(): boolean { return !this.enSuelo; }

  aparecer(x: number, z: number, rumbo: number): void {
    const g = this.suelo(x, z);
    this.pos.set(x, (Number.isFinite(g) ? g : 0) + 0.5, z);
    this.inicio.copy(this.pos);
    this.rumbo = this.rumboInicio = rumbo;
    this.velocidad = 0;
    this.vy = 0;
    this.enSuelo = true;
    this.volante = this.cabeceo = this.alabeo = 0;
    this.rumboCamara = rumbo;
    this.camaraLista = false;
    this.giroMando = this.inclinacionMando = 0;
    this.distanciaMando = 1;
    this.recentrando = false;
    this.objeto.visible = true;
    this.colocar();
  }

  reaparecer(): void { this.aparecer(this.inicio.x, this.inicio.z, this.rumboInicio); }

  ocultar(): void { this.objeto.visible = false; }

  actualizar(dt: number): void {
    const k = this.teclas;
    const acelera = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const frena = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const giro = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    const turbo = k.has('ShiftLeft') || k.has('ShiftRight');
    const freno = k.has('Space');

    // volante con retardo, y más cerrado a baja velocidad
    const tope = 0.6 / (1 + Math.abs(this.velocidad) / 22);
    this.volante += (giro * tope - this.volante) * (1 - Math.exp(-8 * dt));

    const sentido = this.enSuelo ? 1 : 0.15;
    if (this.enSuelo) {
      const vmax = turbo ? VELOCIDAD_TURBO : VELOCIDAD_MAX;
      const empuje = turbo ? 40 : 20;
      if (acelera && !frena) this.velocidad += (this.velocidad < 0 ? 40 : empuje) * dt;
      else if (frena && !acelera) this.velocidad -= (this.velocidad > 0 ? 40 : 14) * dt;
      else this.velocidad -= Math.sign(this.velocidad) * Math.min(Math.abs(this.velocidad), (3 + Math.abs(this.velocidad) * 0.12) * dt);
      if (freno) this.velocidad -= Math.sign(this.velocidad) * Math.min(Math.abs(this.velocidad), 45 * dt);
      this.velocidad = Math.min(vmax, Math.max(-VELOCIDAD_REVERSA, this.velocidad));
      // la pendiente frena en subida y empuja en bajada
      const p = this.pendiente(1);
      this.velocidad -= GRAVEDAD * p / Math.sqrt(1 + p * p) * 0.7 * dt;
    }
    this.rumbo += this.velocidad / DISTANCIA_EJES * Math.tan(this.volante) * dt * sentido;

    const dx = Math.sin(this.rumbo) * this.velocidad * dt, dz = Math.cos(this.rumbo) * this.velocidad * dt;
    const y0 = this.pos.y;
    this.pos.x += dx;
    this.pos.z += dz;
    if (this.obstaculo?.(this.pos, RADIO_CHOQUE)) {
      // choque: rebota un poco y pierde casi toda la velocidad
      if (Math.abs(this.velocidad) > 4) this.velocidad *= -0.3; else this.velocidad = 0;
    }
    const g = this.suelo(this.pos.x, this.pos.z);

    if (this.enSuelo) {
      // trayectoria libre de este fotograma: si el terreno se hunde más rápido que ella, el carro despega
      const yLibre = y0 + this.vy * dt - 0.5 * GRAVEDAD * dt * dt;
      if (!Number.isFinite(g) || (g < yLibre - 0.05 && Math.abs(this.velocidad) > 3)) {
        this.enSuelo = false;
        this.vy -= GRAVEDAD * dt;
        this.pos.y = yLibre;
      } else {
        this.pos.y = g + 0.02;
        this.vy = Math.min(60, Math.max(-60, (this.pos.y - y0) / dt));
      }
    } else {
      this.vy = Math.max(-CAIDA_TERMINAL, this.vy - GRAVEDAD * dt);
      this.pos.y += this.vy * dt;
      if (Number.isFinite(g) && this.pos.y <= g + 0.02 && this.vy <= 0) {
        this.pos.y = g + 0.02;
        this.enSuelo = true;
        this.vy = 0;
      }
    }

    // actitud: sigue la pendiente en el suelo; en el aire, la caída
    let cab: number, ala = 0;
    if (this.enSuelo) {
      const sF = this.suelo(this.pos.x + Math.sin(this.rumbo) * 1.8, this.pos.z + Math.cos(this.rumbo) * 1.8);
      const sA = this.suelo(this.pos.x - Math.sin(this.rumbo) * 1.8, this.pos.z - Math.cos(this.rumbo) * 1.8);
      const sI = this.suelo(this.pos.x + Math.cos(this.rumbo) * 1, this.pos.z - Math.sin(this.rumbo) * 1);
      const sD = this.suelo(this.pos.x - Math.cos(this.rumbo) * 1, this.pos.z + Math.sin(this.rumbo) * 1);
      cab = Number.isFinite(sF) && Number.isFinite(sA) ? -Math.atan2(sF - sA, 3.6) : 0;
      ala = Number.isFinite(sI) && Number.isFinite(sD) ? Math.atan2(sI - sD, 2) : 0;
    } else {
      cab = Math.atan2(-this.vy, Math.abs(this.velocidad) + 8) * 0.7;
    }
    const f = 1 - Math.exp(-(this.enSuelo ? 12 : 2.5) * dt);
    this.cabeceo += (cab - this.cabeceo) * f;
    this.alabeo += (ala - this.alabeo) * f;
    this.colocar();
  }

  /** Mirar alrededor arrastrando el ratón: dx gira la cámara en torno al carro, dy la sube o la baja (en píxeles). */
  mirar(dx: number, dy: number): void {
    this.giroMando -= dx * 0.006;
    this.inclinacionMando = Math.max(-0.3, Math.min(1, this.inclinacionMando + dy * 0.004));
    this.ultimoMando = performance.now();
    this.recentrando = false;
  }

  /** Rueda: f > 1 aleja la cámara del carro, f < 1 la acerca. */
  alejar(f: number): void {
    this.distanciaMando = Math.max(0.45, Math.min(3, this.distanciaMando * f));
  }

  /** Vuelve la cámara a su sitio de siempre: detrás del carro, a la altura y distancia normales. */
  recentrar(): void {
    this.recentrando = true;
  }

  /**
   * Cámara de persecución: detrás y arriba, suavizada, y sin meterse bajo el terreno. El ratón la gira e inclina
   * alrededor del carro; si va en marcha y nadie la toca en 2,5 s, vuelve sola detrás (como en los juegos).
   */
  seguir(camara: THREE.PerspectiveCamera, dt: number): void {
    let d = this.rumbo - this.rumboCamara;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.rumboCamara += d * (this.camaraLista ? 1 - Math.exp(-3.5 * dt) : 1);
    this.giroMando = Math.atan2(Math.sin(this.giroMando), Math.cos(this.giroMando));   // por el lado más corto
    const suelto = this.kmh > 8 && performance.now() - this.ultimoMando > 2500;
    if (this.recentrando || suelto) {
      const k = 1 - Math.exp(-(this.recentrando ? 6 : 1.8) * dt);
      this.giroMando -= this.giroMando * k;
      this.inclinacionMando -= this.inclinacionMando * k;
      if (this.recentrando) this.distanciaMando += (1 - this.distanciaMando) * k;
      if (this.recentrando && Math.abs(this.giroMando) + Math.abs(this.inclinacionMando) + Math.abs(this.distanciaMando - 1) < 0.01) {
        this.giroMando = this.inclinacionMando = 0;
        this.distanciaMando = 1;
        this.recentrando = false;
      }
    }
    const atras = 17 + Math.min(10, this.kmh / 12), arriba = 6.5 + this.kmh / 40;
    const radio = Math.hypot(atras, arriba) * this.distanciaMando;
    const inclinacion = Math.max(0.03, Math.min(1.35, Math.atan2(arriba, atras) + this.inclinacionMando));
    const rumbo = this.rumboCamara + this.giroMando, horizontal = radio * Math.cos(inclinacion);
    const deseada = new THREE.Vector3(
      this.pos.x - Math.sin(rumbo) * horizontal, this.pos.y + radio * Math.sin(inclinacion), this.pos.z - Math.cos(rumbo) * horizontal);
    const s = this.suelo(deseada.x, deseada.z);
    if (Number.isFinite(s)) deseada.y = Math.max(deseada.y, s + 2.5);
    if (this.camaraLista) this.posCamara.lerp(deseada, 1 - Math.exp(-7 * dt)); else this.posCamara.copy(deseada);
    this.camaraLista = true;
    camara.position.copy(this.posCamara);
    camara.lookAt(this.pos.x, this.pos.y + 2, this.pos.z);
  }

  /** Pendiente (Δaltura/Δdistancia) del terreno a lo largo del rumbo. */
  private pendiente(l: number): number {
    const a = this.suelo(this.pos.x + Math.sin(this.rumbo) * l, this.pos.z + Math.cos(this.rumbo) * l);
    const b = this.suelo(this.pos.x - Math.sin(this.rumbo) * l, this.pos.z - Math.cos(this.rumbo) * l);
    return Number.isFinite(a) && Number.isFinite(b) ? (a - b) / (2 * l) : 0;
  }

  private colocar(): void {
    this.objeto.position.copy(this.pos);
    this.objeto.rotation.set(this.cabeceo, this.rumbo, this.alabeo, 'YXZ');
  }

  private construirCarro(): THREE.Group {
    const g = new THREE.Group();
    const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...extra });
    const caja = (w: number, h: number, l: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
    };
    caja(1.9, 0.6, 4.4, mat('#d6402b'), 0, 0.75, 0);
    caja(1.65, 0.55, 2.2, mat('#2b3a47', { metalness: 0.6, roughness: 0.2 }), 0, 1.3, -0.2);
    const faro = mat('#fff3b0', { emissive: new THREE.Color('#ffe58a'), emissiveIntensity: 1.2 });
    caja(0.4, 0.2, 0.1, faro, 0.65, 0.85, 2.2);
    caja(0.4, 0.2, 0.1, faro, -0.65, 0.85, 2.2);
    const luz = mat('#ff2a2a', { emissive: new THREE.Color('#ff2a2a'), emissiveIntensity: 0.8 });
    caja(0.4, 0.15, 0.1, luz, 0.65, 0.85, -2.2);
    caja(0.4, 0.15, 0.1, luz, -0.65, 0.85, -2.2);
    const rueda = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14);
    rueda.rotateZ(Math.PI / 2);
    const goma = mat('#15181c', { roughness: 0.9, metalness: 0 });
    for (const x of [-0.95, 0.95]) for (const z of [-1.4, 1.4]) {
      const r = new THREE.Mesh(rueda, goma);
      r.position.set(x, 0.42, z);
      g.add(r);
    }
    return g;
  }
}
