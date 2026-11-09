import { AfterViewInit, Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CATEGORIAS } from '../../../mapa/utils/puntos';
import { VARIANTES, Variante, modelarEquipamiento } from '../../utils/equipamientos';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Aura, CategoriaIcono, COLOR_INDUSTRIA, SERVICIOS, SERVICIOS_GRUPO, crearAura, crearIcono, tamanoIcono } from '../../utils/aura';

/** Lo que no es un punto de interés ni una fábrica no lleva neón ni icono. */
const SIN_AURA: string[] = ['vivienda', 'vehiculos', 'vias', 'agua', 'naturaleza', 'gente'];

/** Catálogo de los edificios que representan los puntos de interés en el mapa 3D, uno a la vez y a escala real. */
@Component({
  selector: 'app-catalogo-edificios',
  standalone: true,
  template: `
    <div #lienzo class="lienzo"></div>

    <aside class="panel">
      <h1>Edificios del mapa 3D <small>catálogo · {{ total }} modelos</small></h1>
      @for (g of grupos; track g.id) {
        <div class="grupo">
          <span class="cat"><i [style.background]="g.color"></i>{{ g.nombre }}</span>
          @for (v of g.items; track v.etiqueta) {
            <button type="button" [class.activo]="v === actual()" (click)="elegir(v)">{{ v.etiqueta }}</button>
          }
        </div>
      }
      @if (actual().tipo === 'Tipología') {
        <button type="button" class="variar" (click)="variar()">🎲 Otra variación ({{ variacion() }})</button>
      }
      <label class="giro"><input type="checkbox" [checked]="girando()" (change)="alternarGiro()"> Girar solo</label>
      <label class="giro"><input type="checkbox" [checked]="conAura()" (change)="alternarAura()"> Aura de neón e icono</label>
    </aside>

    <div class="titulo">
      <strong>{{ actual().etiqueta }}</strong>
      <span>{{ categoriaDe(actual()) }} · {{ medida() }}</span>
    </div>
    <p class="ayuda">Arrastra para girar · rueda para acercar · clic derecho para desplazar</p>
  `,
  styles: [`
    :host { position: relative; display: block; height: calc(100dvh - var(--alto-barra)); min-height: 520px;
      background: linear-gradient(#8ec8f2, #e4f2fb 70%); overflow: hidden; }
    .lienzo { position: absolute; inset: 0; }
    .panel { position: absolute; top: 12px; left: 12px; max-height: calc(100% - 24px); overflow: auto; width: 230px;
      padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.88); backdrop-filter: blur(6px);
      box-shadow: 0 6px 20px rgba(15,35,55,.25); font: 600 13px/1.3 system-ui; color: #243746; }
    h1 { margin: 0 0 8px; font-size: 16px; }
    h1 small { display: block; font-weight: 600; font-size: 11px; color: #5b7284; }
    .grupo { display: flex; flex-direction: column; gap: 3px; margin-top: 10px; }
    .cat { display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: 12px; }
    .cat i { width: 9px; height: 9px; border-radius: 50%; }
    button { text-align: left; border: 0; border-radius: 8px; padding: 5px 9px; background: transparent;
      font: inherit; color: inherit; cursor: pointer; }
    button:hover { background: #e8f1f7; }
    button.activo { background: #243746; color: #fff; }
    button.variar { margin-top: 12px; background: #e8f1f7; font-weight: 800; }
    .giro { display: block; margin-top: 12px; font-size: 12px; }
    .titulo { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); text-align: center;
      padding: 8px 18px; border-radius: 14px; background: rgba(255,255,255,.88); box-shadow: 0 4px 14px rgba(15,35,55,.25);
      font: 600 12px system-ui; color: #5b7284; }
    .titulo strong { display: block; font-size: 16px; color: #243746; }
    .ayuda { position: absolute; left: 0; right: 0; bottom: 10px; margin: 0; text-align: center;
      font: 600 11px system-ui; color: #36556b; pointer-events: none; }
    @media (max-width: 640px) { .panel { width: 170px; font-size: 12px; } }
  `],
})
export class CatalogoEdificiosComponent implements AfterViewInit {
  @ViewChild('lienzo', { static: true }) private lienzo!: ElementRef<HTMLDivElement>;
  private readonly destroyRef = inject(DestroyRef);

  readonly total = VARIANTES.length;
  readonly grupos = [
    ...CATEGORIAS.map(c => ({ id: c.id as string, nombre: c.nombre, color: c.color })),
    { id: 'servicios', nombre: SERVICIOS_GRUPO.nombre, color: SERVICIOS_GRUPO.color },
    { id: 'industria', nombre: 'Industria', color: COLOR_INDUSTRIA },
    { id: 'vivienda', nombre: 'Viviendas', color: '#c8704f' },
    { id: 'vehiculos', nombre: 'Vehículos', color: '#ff2d2d' },
    { id: 'vias', nombre: 'Vías', color: '#55585d' },
    { id: 'agua', nombre: 'Ríos y quebradas', color: '#4db3e6' },
    { id: 'naturaleza', nombre: 'Árboles y aves', color: '#4f9a45' },
    { id: 'gente', nombre: 'Personas', color: '#f59e0b' },
  ].map(c => ({ ...c, items: VARIANTES.filter(v => v.categoria === c.id) })).filter(g => g.items.length);
  readonly actual = signal<Variante>(VARIANTES[0]);
  readonly girando = signal(true);
  readonly medida = signal('');
  readonly conAura = signal(true);
  readonly variacion = signal(1);

  private renderer!: THREE.WebGLRenderer;
  private escena = new THREE.Scene();
  private camara = new THREE.PerspectiveCamera(38, 1, 1, 3000);
  private controles!: OrbitControls;
  private modelo: THREE.Group | null = null;
  private animacion = 0;
  private aura: Aura | null = null;
  private icono: ReturnType<typeof crearIcono> | null = null;
  private reloj = new THREE.Clock();
  private sol!: THREE.DirectionalLight;
  private triangulos = 0;

  ngAfterViewInit(): void {
    const el = this.lienzo.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(this.renderer.domElement);

    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x88aa77, 1.15));
    const sol = new THREE.DirectionalLight(0xffffff, 2.4);
    sol.position.set(70, 110, 55);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    Object.assign(sol.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 400 });
    sol.shadow.bias = -0.0004;
    this.escena.add(sol);
    this.sol = sol;

    const suelo = new THREE.Mesh(new THREE.CircleGeometry(1500, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8fae78', roughness: 1 }));
    suelo.position.y = -0.4;
    suelo.receiveShadow = true;
    this.escena.add(suelo);

    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.enableDamping = true;
    this.controles.autoRotate = true;
    this.controles.autoRotateSpeed = 0.9;
    this.controles.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controles.minDistance = 12;
    this.controles.maxDistance = 600;

    const ajustar = () => {
      const { clientWidth: w, clientHeight: h } = el;
      this.renderer.setSize(w, h);
      this.camara.aspect = w / Math.max(h, 1);
      this.camara.updateProjectionMatrix();
    };
    const obs = new ResizeObserver(ajustar);
    obs.observe(el);
    ajustar();

    this.mostrar(this.actual());
    // fuera de la pantalla (página desplazada a otra sección) no se dibuja: ahorra CPU y batería
    let visible = true;
    const vista = new IntersectionObserver(([e]) => visible = e.isIntersecting);
    vista.observe(el);
    this.destroyRef.onDestroy(() => vista.disconnect());
    const bucle = () => {
      this.animacion = requestAnimationFrame(bucle);
      if (!visible) return;
      this.controles.update();
      this.animarAura();
      this.renderer.render(this.escena, this.camara);
    };
    bucle();

    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.animacion);
      obs.disconnect();
      this.controles.dispose();
      this.quitar();
      suelo.geometry.dispose();
      (suelo.material as THREE.Material).dispose();
      this.renderer.dispose();
    });
  }

  categoriaDe(v: Variante): string {
    return this.grupos.find(g => g.id === v.categoria)?.nombre ?? '';
  }

  elegir(v: Variante): void {
    this.actual.set(v);
    this.mostrar(v);
  }

  variar(): void {
    this.variacion.update(n => n + 1);
    this.mostrar(this.actual());
  }

  alternarGiro(): void {
    this.girando.update(g => !g);
    this.controles.autoRotate = this.girando();
  }

  alternarAura(): void {
    this.conAura.update(a => !a);
    this.mostrar(this.actual());
  }

  /** El neón pulsa y el icono flota sin tapar el edificio, con un tamaño que se lee igual a cualquier distancia. */
  private animarAura(): void {
    const t = this.reloj.getElapsedTime();
    this.aura?.animar(t);
    if (this.icono) this.icono.animar(t, this.camara, tamanoIcono(Math.hypot(this.camara.position.x - this.icono.x, this.camara.position.y - this.icono.cima, this.camara.position.z - this.icono.z)), true);
  }

  private quitar(): void {
    this.aura?.dispose();
    this.icono?.dispose();
    this.aura = this.icono = null;
    if (!this.modelo) return;
    this.escena.remove(this.modelo);
    this.modelo.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mat = o.material as THREE.MeshStandardMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    });
    this.modelo = null;
  }

  /** Arma el edificio sobre una plataforma de pasto y encuadra la cámara según su tamaño. */
  private mostrar(v: Variante): void {
    this.quitar();
    let semilla = 7 + this.variacion() * 7919;
    const m = modelarEquipamiento(v.categoria, v.tipo, v.nombre, () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647));
    const grupo = new THREE.Group();
    const r = m.radio + (m.radio < 4 ? 1.2 : 8);
    const plataforma = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 1.5, 1.2, 64).translate(0, -0.6, 0), new THREE.MeshStandardMaterial({ color: '#7fa468', roughness: 1 }));
    plataforma.receiveShadow = true;
    grupo.add(plataforma);
    if (m.losa) {
      const losa = new THREE.Mesh(new THREE.BoxGeometry(m.losa[0], 0.4, m.losa[1]).translate(0, 0.2, 0), new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.9 }));
      losa.receiveShadow = true;
      grupo.add(losa);
    }
    for (const p of m.piezas) {
      const malla = new THREE.Mesh(p.g, new THREE.MeshStandardMaterial({ color: p.color, map: p.mapa, alphaTest: p.calado ? 0.5 : 0, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }));
      malla.castShadow = true;
      malla.receiveShadow = true;
      grupo.add(malla);
    }
    const caja = new THREE.Box3();
    this.triangulos = 0;
    for (const p of m.piezas) { this.triangulos += (p.g.index?.count ?? p.g.attributes['position'].count) / 3; p.g.computeBoundingBox(); caja.union(p.g.boundingBox!); }
    const tam = caja.getSize(new THREE.Vector3());
    if (this.conAura() && !SIN_AURA.includes(v.categoria)) {
      const sv = SERVICIOS.find(x => x.id === v.srv);
      const color = sv?.color ?? this.grupos.find(g => g.id === v.categoria)!.color;
      this.aura = crearAura(r, tam.y * 1.15 + 4, color);
      grupo.add(this.aura.grupo);
      this.icono = crearIcono((sv?.id ?? v.categoria) as CategoriaIcono, color, 0, tam.y, 0);
      grupo.add(this.icono.sprite);
    }
    this.escena.add(grupo);
    this.modelo = grupo;
    this.encuadrar(tam);
    if (v.nombre === 'Avión') {
      // el Boeing 787 es un modelo .glb: se carga aparte y se deja en el aire, sobre la plataforma
      new GLTFLoader().load('data/mapa3d/boeing-787.glb', gltf => {
        if (this.modelo !== grupo) return;
        const caja = new THREE.Box3().setFromObject(gltf.scene);
        gltf.scene.position.y = 8 - caja.min.y;
        grupo.add(gltf.scene);
        this.encuadrar(caja.getSize(new THREE.Vector3()).setY(caja.getSize(new THREE.Vector3()).y + 8));
      });
    }
  }

  private encuadrar(tam: THREE.Vector3): void {
    const chico = tam.y < 4;
    const cm = (n: number) => (Math.round(n * 100) / 100).toString().replace('.', ',');
    this.medida.set(chico ? `${cm(tam.y)} m de alto · ${Math.round(this.triangulos)} triángulos` : `${Math.round(tam.x)} × ${Math.round(tam.z)} m, ${Math.round(tam.y)} m de alto`);
    // lo pequeño (una persona) pide cámara y sombras de cerca; lo demás conserva el encuadre de siempre
    this.camara.near = chico ? 0.1 : 1;
    this.camara.updateProjectionMatrix();
    this.controles.minDistance = chico ? 1.5 : 12;
    const sombra = this.sol.shadow.camera;
    Object.assign(sombra, chico ? { left: -4, right: 4, top: 4, bottom: -4 } : { left: -90, right: 90, top: 90, bottom: -90 });
    sombra.updateProjectionMatrix();
    const d = chico ? Math.max(tam.y * 2.6, 3) : Math.max(tam.x, tam.z, tam.y * 1.4, 18) * 1.7 + 14;
    this.controles.target.set(0, chico ? tam.y * 0.5 : Math.min(tam.y * 0.35, 14), 0);
    this.camara.position.set(d * 0.7, d * 0.5, d * 0.85);
    this.controles.update();
  }
}
