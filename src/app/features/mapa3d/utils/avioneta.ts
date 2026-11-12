import * as THREE from 'three';
import { ESCALA_ACTIVOS } from './escala';
import { ALTURA_ABISMO, FuncionObstaculo, FuncionSuelo } from './conduccion';

const GRAVEDAD = 22;
const ESCALA = ESCALA_ACTIVOS;
const V_DESPEGUE = 22;          // m/s: a partir de aquí con el morro arriba se separa del suelo
const V_PERDIDA = 16;           // por debajo de esto el ala no sostiene y el avión se hunde
const V_MAX = 90;               // m/s (324 km/h)
const V_TURBO = 150;
const ALTURA_MAX = 3500;
const RADIO_CHOQUE = 5;

/**
 * Avión de vuelo libre, con la misma interfaz que el carro (`Conduccion`) para compartir el modo de conducción del mapa 3D.
 * Aparece en el aire sobre el sitio elegido (si aterriza, puede volver a despegar tirando del morro a ~80 km/h), vira inclinando las alas, pierde sustentación si
 * va muy lento y se estrella si toca el suelo muy fuerte, de lado o picado, o si choca contra un edificio.
 * Teclas: W/S empuje, ↑/↓ morro abajo/arriba, A/D (o ←/→) alabeo y viraje, Shift turbo, Espacio freno en tierra.
 */
export class Avioneta {
  readonly objeto = new THREE.Group();
  readonly teclas = new Set<string>();

  private readonly pos = new THREE.Vector3();
  private rumbo = 0;
  private asc = 0;            // cabeceo, + = morro arriba
  private banco = 0;          // alabeo, + = ala izquierda abajo (vira a la izquierda)
  private velocidad = 0;
  private empuje = 0;         // 0..1
  private enSuelo = true;
  private chocado = false;
  private agl_ = 0;
  private helice?: THREE.Object3D;
  private rumboCamara = 0;
  private readonly posCamara = new THREE.Vector3();
  private readonly inicio = new THREE.Vector3();
  private rumboInicio = 0;
  private camaraLista = false;
  private giroMando = 0;
  private inclinacionMando = 0;
  private distanciaMando = 1;
  private ultimoMando = -Infinity;
  private recentrando = false;

  constructor(private readonly suelo: FuncionSuelo, private readonly obstaculo?: FuncionObstaculo) {
    this.objeto.add(this.construir());
    this.objeto.scale.setScalar(ESCALA);
    this.objeto.visible = false;
  }

  get posicion(): THREE.Vector3 { return this.pos; }
  get kmh(): number { return Math.abs(this.velocidad) * 3.6; }
  get altura(): number { return this.pos.y; }
  /** metros sobre el suelo */
  get agl(): number { return this.agl_; }
  get cayo(): boolean { return this.chocado || this.pos.y < ALTURA_ABISMO; }
  get volando(): boolean { return !this.enSuelo; }

  aparecer(x: number, z: number, rumbo: number): void {
    const g = this.suelo(x, z);
    // las calles del casco urbano son cortas para despegar: aparece ya en el aire, en crucero, 150 m sobre el sitio elegido
    this.pos.set(x, (Number.isFinite(g) ? g : 0) + 150, z);
    this.inicio.copy(this.pos);
    this.rumbo = this.rumboInicio = rumbo;
    this.velocidad = 55;
    this.empuje = 0.6;
    this.asc = this.banco = 0;
    this.enSuelo = false;
    this.chocado = false;
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
    if (this.chocado) { this.colocar(); return; }
    const k = this.teclas;
    const w = k.has('KeyW'), s = k.has('KeyS');
    const cab = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);          // + = morro arriba
    const giro = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    const turbo = k.has('ShiftLeft') || k.has('ShiftRight');
    const freno = k.has('Space');

    if (w && !s) this.empuje = Math.min(1, this.empuje + 0.6 * dt);
    else if (s && !w) this.empuje = Math.max(0, this.empuje - 0.8 * dt);
    const vmax = turbo ? V_TURBO : V_MAX;
    const objetivo = this.empuje * vmax;
    const a = Math.max(-10, Math.min(turbo ? 30 : 20, (objetivo - this.velocidad) * 0.5));
    this.velocidad = Math.max(0, this.velocidad + a * dt);
    if (this.enSuelo && freno) this.velocidad = Math.max(0, this.velocidad - 45 * dt);
    if (this.enSuelo && this.empuje === 0) this.velocidad = Math.max(0, this.velocidad - 6 * dt);

    let g = 0;
    if (this.enSuelo) {
      this.banco = 0;
      this.rumbo += giro * 0.5 * Math.min(1, this.velocidad / 10) * dt;
      this.avanzar(dt, 1);
      g = this.suelo(this.pos.x, this.pos.z);
      this.pos.y = (Number.isFinite(g) ? g : this.pos.y) + 0.02;
      // sobre la pista sigue la pendiente; con velocidad suficiente el morro puede levantarse
      const sF = this.suelo(this.pos.x + Math.sin(this.rumbo) * 3, this.pos.z + Math.cos(this.rumbo) * 3);
      const sA = this.suelo(this.pos.x - Math.sin(this.rumbo) * 3, this.pos.z - Math.cos(this.rumbo) * 3);
      const pend = Number.isFinite(sF) && Number.isFinite(sA) ? Math.atan2(sF - sA, 6) : 0;
      if (cab > 0 && this.velocidad > V_DESPEGUE * 0.9) this.asc = Math.min(0.45, Math.max(this.asc, pend) + 0.5 * dt);
      else this.asc += (pend - this.asc) * (1 - Math.exp(-10 * dt));
      if (this.asc > 0.12 && this.velocidad > V_DESPEGUE && cab > 0) this.enSuelo = false;
    } else {
      // actitud
      this.asc += cab * 0.6 * dt;
      const perdida = this.velocidad < V_PERDIDA;
      if (perdida) this.asc += (-0.9 - this.asc) * (1 - Math.exp(-1.2 * dt));
      else if (!cab) this.asc *= Math.exp(-0.25 * dt);          // suelto el mando, el morro tiende a nivelarse poco a poco
      this.asc = Math.max(-0.9, Math.min(0.55, this.asc));
      this.velocidad = Math.max(0, this.velocidad - GRAVEDAD * Math.sin(this.asc) * 0.5 * dt);
      const objBanco = giro * 0.9;
      this.banco += (objBanco - this.banco) * (1 - Math.exp(-3 * dt));
      this.rumbo += Math.tan(this.banco) * GRAVEDAD / Math.max(this.velocidad, 25) * dt;
      this.avanzar(dt, Math.cos(this.asc));
      const hundimiento = perdida ? (V_PERDIDA - this.velocidad) * 1.2 : 0;
      const antes = this.pos.y;
      this.pos.y = Math.min(ALTURA_MAX, this.pos.y + (this.velocidad * Math.sin(this.asc) - hundimiento) * dt);
      const vy = (this.pos.y - antes) / Math.max(dt, 1e-3);
      g = this.suelo(this.pos.x, this.pos.z);
      if (Number.isFinite(g) && this.pos.y <= g + 0.3) {
        if (vy < -14 || Math.abs(this.banco) > 0.5 || this.asc < -0.35 || this.velocidad > V_MAX * 1.4) {
          this.chocado = true;
          this.velocidad = 0;
        } else {
          this.pos.y = g + 0.02;
          this.enSuelo = true;
          this.banco = 0;
        }
      }
    }
    this.agl_ = Number.isFinite(g) ? Math.max(0, this.pos.y - g) : this.pos.y;
    if (this.helice) this.helice.rotation.z += (6 + this.empuje * 60) * dt;
    this.colocar();
  }

  /** Avanza `f` (1 = todo) de la velocidad en el rumbo y choca contra edificios: en tierra rebota, en el aire se estrella. */
  private avanzar(dt: number, f: number): void {
    this.pos.x += Math.sin(this.rumbo) * this.velocidad * f * dt;
    this.pos.z += Math.cos(this.rumbo) * this.velocidad * f * dt;
    if (this.obstaculo?.(this.pos, this.enSuelo ? 3 : RADIO_CHOQUE)) {
      if (this.enSuelo) this.velocidad = this.velocidad > 4 ? this.velocidad * 0.3 : 0;
      else { this.chocado = true; this.velocidad = 0; }
    }
  }

  mirar(dx: number, dy: number): void {
    this.giroMando -= dx * 0.006;
    this.inclinacionMando = Math.max(-0.3, Math.min(1, this.inclinacionMando + dy * 0.004));
    this.ultimoMando = performance.now();
    this.recentrando = false;
  }

  alejar(f: number): void {
    this.distanciaMando = Math.max(0.45, Math.min(3, this.distanciaMando * f));
  }

  recentrar(): void { this.recentrando = true; }

  /** Cámara de persecución, más atrás y arriba que la del carro; el ratón la gira y vuelve sola detrás si no se toca. */
  seguir(camara: THREE.PerspectiveCamera, dt: number): void {
    let d = this.rumbo - this.rumboCamara;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.rumboCamara += d * (this.camaraLista ? 1 - Math.exp(-3 * dt) : 1);
    this.giroMando = Math.atan2(Math.sin(this.giroMando), Math.cos(this.giroMando));
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
    const atras = 34 + Math.min(16, this.kmh / 14), arriba = 11 + this.asc * 8;
    const radio = Math.hypot(atras, arriba) * this.distanciaMando;
    const inclinacion = Math.max(0.03, Math.min(1.35, Math.atan2(arriba, atras) + this.inclinacionMando));
    const rumbo = this.rumboCamara + this.giroMando, horizontal = radio * Math.cos(inclinacion);
    const deseada = new THREE.Vector3(
      this.pos.x - Math.sin(rumbo) * horizontal, this.pos.y + radio * Math.sin(inclinacion), this.pos.z - Math.cos(rumbo) * horizontal);
    const s = this.suelo(deseada.x, deseada.z);
    if (Number.isFinite(s)) deseada.y = Math.max(deseada.y, s + 3);
    if (this.camaraLista) this.posCamara.lerp(deseada, 1 - Math.exp(-6 * dt)); else this.posCamara.copy(deseada);
    this.camaraLista = true;
    camara.position.copy(this.posCamara);
    camara.lookAt(this.pos.x, this.pos.y + 2, this.pos.z);
  }

  private colocar(): void {
    this.objeto.position.copy(this.pos);
    this.objeto.rotation.set(-this.asc, this.rumbo, -this.banco, 'YXZ');
  }

  /** Avioneta de hélice, de ~8 m de largo y 11 m de envergadura, con las ruedas en y = 0 y el morro hacia +z. */
  private construir(): THREE.Group {
    const g = new THREE.Group();
    const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, ...extra });
    const blanco = mat('#f2f4f6'), rojo = mat('#d6402b'), oscuro = mat('#1d242b', { roughness: 0.8, metalness: 0.1 });
    const poner = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); g.add(m); return m; };

    const fus = new THREE.CylinderGeometry(0.55, 0.38, 5.2, 14);
    fus.rotateX(Math.PI / 2);
    poner(new THREE.Mesh(fus, blanco), 0, 1.35, -0.2);
    const nariz = new THREE.CylinderGeometry(0.38, 0.55, 1.1, 14);
    nariz.rotateX(Math.PI / 2);
    poner(new THREE.Mesh(nariz, rojo), 0, 1.35, 2.95);
    const cola = new THREE.ConeGeometry(0.38, 1.6, 12);
    cola.rotateX(-Math.PI / 2);
    poner(new THREE.Mesh(cola, blanco), 0, 1.4, -3.6);
    poner(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.4), mat('#2b3a47', { metalness: 0.6, roughness: 0.2 })), 0, 1.85, 0.9);

    poner(new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 1.7), blanco), 0, 1.75, 0.5);
    poner(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.13, 1.72), rojo), -4.6, 1.75, 0.5);
    poner(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.13, 1.72), rojo), 4.6, 1.75, 0.5);
    poner(new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 1), blanco), 0, 1.45, -3.7);
    poner(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 1.1), rojo), 0, 2.0, -3.7);

    const rueda = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 12);
    rueda.rotateZ(Math.PI / 2);
    for (const x of [-1.1, 1.1]) {
      poner(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), oscuro), x, 0.85, 1.1);
      poner(new THREE.Mesh(rueda, oscuro), x, 0.32, 1.1);
    }
    poner(new THREE.Mesh(rueda, oscuro), 0, 0.3, -3.3);

    const h = new THREE.Group();
    h.position.set(0, 1.35, 3.6);
    h.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.05), oscuro));
    h.add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.05), oscuro));
    g.add(h);
    this.helice = h;
    return g;
  }
}
