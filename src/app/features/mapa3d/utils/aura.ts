import * as THREE from 'three';
import { CategoriaPunto } from '../../mapa/services/mapa.service';

/** Símbolo de cada tipo de infraestructura, para el icono flotante. */
/** Las industrias son una categoría más del mapa 3D, con su propio color, símbolo y neón. */
export type CategoriaIcono = CategoriaPunto | 'industria';
export const COLOR_INDUSTRIA = '#f97316';

export const GLIFO: Record<CategoriaIcono, string> = {
  educacion: '🎓', cultura: '🎭', salud: '🏥', turismo: '🧭', deporte: '⚽', justicia: '🛡️', patrimonio: '🏺', industria: '🏭',
};

/** Fracción de la altura del domo que sí lleva luz: solo el borde de abajo, sin techo. */
const FRACCION_DOMO = 0.3;

/** Borde de un domo de radio `radio` y altura `alto`: solo hasta FRACCION_DOMO de esa altura sobre la base, abierto arriba. */
function faldon(radio: number, alto: number): THREE.BufferGeometry {
  const tope = Math.asin(FRACCION_DOMO), pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 8; k++) {
    const a = tope * k / 8;
    pts.push(new THREE.Vector2(radio * Math.cos(a), alto * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, 72);
}

export interface Aura {
  grupo: THREE.Group;
  /** pulso suave del neón; `t` en segundos */
  animar(t: number): void;
  /** todos los aros quedan encendidos; el del edificio `i` (-1 = ninguno) brilla más */
  resaltar(i: number): void;
  dispose(): void;
}

/** Medallón redondo del color de la categoría con su símbolo en el centro. */
export function texturaIcono(cat: CategoriaIcono, color: string, cuenta = 0): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64, 64, 49, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.font = '56px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(GLIFO[cat], 64, 69);
  if (cuenta > 1) {                                              // grupo: insignia con el número de puntos
    ctx.beginPath();
    ctx.arc(100, 28, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${cuenta > 9 ? 26 : 32}px sans-serif`;
    ctx.fillText(String(cuenta), 100, 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function lienzo(tam: number, pintar: (ctx: CanvasRenderingContext2D, n: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = tam;
  pintar(c.getContext('2d')!, tam);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface ItemAura {
  x: number; y: number; z: number;
  /** radio del círculo exterior (m) */
  radio: number;
  /** altura del domo (m) */
  alto: number;
  color: string;
}

/**
 * Neón en el círculo exterior de uno o varios edificios: un aro brillante en el suelo cuyo resplandor se extiende hacia
 * afuera y hacia adentro, y un borde de domo (solo la franja de abajo, sin techo) que nace del aro y se apaga hacia arriba.
 * Cada uno del color de su tipo de infraestructura. Todo en dos mallas instanciadas, sea cual sea el número de edificios.
 */
export function crearAuras(items: ItemAura[]): Aura {
  const grupo = new THREE.Group();
  const alcance = 2.6;                                          // el resplandor llega hasta radio × alcance
  const texAro = lienzo(256, (ctx, n) => {
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2), k = 1 / alcance;
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(k * 0.7, 'rgba(255,255,255,0.04)');
    g.addColorStop(k * 0.93, 'rgba(255,255,255,0.3)');
    g.addColorStop(k, 'rgba(255,255,255,0.62)');
    g.addColorStop(k * 1.06, 'rgba(255,255,255,0.4)');
    g.addColorStop(k * 1.3, 'rgba(255,255,255,0.18)');
    g.addColorStop(k * 1.7, 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
  });
  const texCortina = lienzo(64, (ctx, n) => {
    const g = ctx.createLinearGradient(0, 0, 0, n);              // arriba del lienzo = borde superior del faldón, abajo = el aro
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
  });
  const mat = (map: THREE.Texture) => new THREE.MeshBasicMaterial({
    map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const matAro = mat(texAro), matCortina = mat(texCortina);
  const geoAro = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), geoCortina = faldon(1, 1);
  const aros = new THREE.InstancedMesh(geoAro, matAro, items.length);
  const cortinas = new THREE.InstancedMesh(geoCortina, matCortina, items.length);
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), esc = new THREE.Vector3(), giro = new THREE.Quaternion(), c = new THREE.Color();
  items.forEach((it, i) => {
    c.set(it.color);
    m.compose(pos.set(it.x, it.y + 0.25, it.z), giro, esc.set(it.radio * alcance * 2, 1, it.radio * alcance * 2));
    aros.setMatrixAt(i, m);
    aros.setColorAt(i, c);
    m.compose(pos.set(it.x, it.y, it.z), giro, esc.set(it.radio, it.alto, it.radio));
    cortinas.setMatrixAt(i, m);
    cortinas.setColorAt(i, c);
  });
  for (const o of [aros, cortinas]) { o.renderOrder = 5; o.frustumCulled = false; o.instanceMatrix.needsUpdate = true; }
  grupo.add(aros, cortinas);
  return {
    grupo,
    animar: t => {
      const pulso = 0.85 + 0.15 * Math.sin(t * 2.2);
      matAro.opacity = pulso;
      matCortina.opacity = 0.9 * pulso;
    },
    resaltar: i => {
      [aros, cortinas].forEach(o => {
        items.forEach((it, j) => o.setColorAt(j, c.set(it.color).multiplyScalar(j === i ? 2.2 : 1)));
        o.instanceColor!.needsUpdate = true;
      });
    },
    dispose: () => {
      aros.dispose(); cortinas.dispose(); geoAro.dispose(); geoCortina.dispose();
      matAro.dispose(); matCortina.dispose(); texAro.dispose(); texCortina.dispose();
    },
  };
}

/** El neón de un solo edificio centrado en el origen (catálogo). */
export function crearAura(radio: number, alto: number, color: string): Aura {
  return crearAuras([{ x: 0, y: 0, z: 0, radio, alto, color }]);
}

export interface Icono {
  sprite: THREE.Sprite;
  cat: CategoriaIcono; color: string;
  x: number; cima: number; z: number;
  /** a qué edificio pertenece (para el clic) */
  ref?: { tipo: 'equip' | 'fabrica'; i: number };
  /** pone el sprite sobre su edificio con el tamaño `tam` (m); `visible` false lo esconde */
  animar(t: number, camara: THREE.Camera, tam: number, visible: boolean): void;
  dispose(): void;
}

/** Tamaño (m) con que un icono se lee igual en pantalla a cualquier zoom: proporcional a su distancia a la cámara. */
export const tamanoIcono = (d: number): number => Math.min(420, Math.max(4, d * 0.04));

/** Sitúa un sprite sobre una cima: siempre por encima del edificio y, cuanto más se mira desde arriba, se sube y se
 *  corre hacia el fondo de la vista para no taparlo; flota despacio. */
function colocar(sprite: THREE.Sprite, x: number, cima: number, z: number, tam: number, t: number, cam: THREE.Vector3): void {
  const d = Math.max(cam.distanceTo(sprite.position.set(x, cima, z)), 1);
  const picado = Math.min(1, Math.max(0, (cam.y - cima) / d));          // 0 = vista de lado, 1 = vista desde arriba
  let dx = x - cam.x, dz = z - cam.z;
  const h = Math.hypot(dx, dz) || 1;
  dx /= h; dz /= h;
  const corrimiento = tam * 1.1 * picado * picado;                      // hacia el fondo, que en pantalla es "arriba"
  sprite.scale.set(tam, tam, 1);
  sprite.position.set(x + dx * corrimiento, cima + tam * (0.8 + 0.9 * picado) + tam * 0.1 * Math.sin(t * 1.6), z + dz * corrimiento);
}

/** Icono flotante sobre un edificio: sprite con el medallón de su tipo. */
export function crearIcono(cat: CategoriaIcono, color: string, x: number, cima: number, z: number): Icono {
  const tex = texturaIcono(cat, color);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.renderOrder = 12;
  return {
    sprite, cat, color, x, cima, z,
    animar: (t, camara, tam, visible) => {
      sprite.visible = visible;
      if (visible) colocar(sprite, x, cima, z, tam, t, camara.position);
    },
    dispose: () => { tex.dispose(); sprite.material.dispose(); },
  };
}

/** Lado (en coordenadas normalizadas de pantalla, 2 = toda la altura) de la celda en que se funden iconos del mismo tipo. */
const CELDA_PANTALLA = 0.15;

/**
 * Los iconos se mantienen legibles al alejar (tamaño constante en pantalla) y, cuando varios del mismo tipo caen en la
 * misma celda de la pantalla, se funden en uno solo con la cantidad; al acercarse se separan solos.
 */
export function crearAgrupador(iconos: Icono[], escena: THREE.Object3D) {
  const texturas = new Map<string, THREE.CanvasTexture>();
  const grupos: THREE.Sprite[] = [];
  const miembros: Icono[][] = [];
  const textura = (cat: CategoriaIcono, color: string, n: number) => {
    const k = `${cat}|${n}`;
    let t = texturas.get(k);
    if (!t) texturas.set(k, t = texturaIcono(cat, color, n));
    return t;
  };
  const sprite = (i: number) => {
    if (!grupos[i]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
      s.renderOrder = 12;
      escena.add(s);
      grupos[i] = s;
    }
    return grupos[i];
  };
  return {
    animar(t: number, camara: THREE.Camera): void {
      const cam = camara.position, v = new THREE.Vector3();
      const celdas = new Map<string, Icono[]>();
      const clave = new Map<Icono, string>();
      for (const ic of iconos) {
        v.set(ic.x, ic.cima, ic.z).project(camara);
        const k = `${ic.cat}|${Math.floor(v.x / CELDA_PANTALLA)}|${Math.floor(v.y / CELDA_PANTALLA)}`;
        clave.set(ic, k);
        const g = celdas.get(k);
        g ? g.push(ic) : celdas.set(k, [ic]);
      }
      let usados = 0;
      for (const ic of iconos) {
        const solo = celdas.get(clave.get(ic)!)!.length === 1;
        ic.animar(t, camara, tamanoIcono(Math.hypot(cam.x - ic.x, cam.y - ic.cima, cam.z - ic.z)), solo);
      }
      for (const g of celdas.values()) {
        if (g.length < 2) continue;
        let x = 0, z = 0, cima = 0;
        for (const ic of g) { x += ic.x; z += ic.z; cima = Math.max(cima, ic.cima); }
        x /= g.length; z /= g.length;
        const s = sprite(usados++);
        const mat = s.material as THREE.SpriteMaterial;
        mat.map = textura(g[0].cat, g[0].color, g.length);
        mat.needsUpdate = true;
        s.visible = true;
        miembros[usados - 1] = g;
        colocar(s, x, cima, z, tamanoIcono(Math.hypot(cam.x - x, cam.y - cima, cam.z - z)) * 1.15, t, cam);
      }
      for (let i = usados; i < grupos.length; i++) grupos[i].visible = false;
    },
    /** Pin bajo el puntero (px, py dentro de un lienzo w×h): un icono suelto o un grupo; el más cercano a la cámara gana. */
    bajoCursor(camara: THREE.Camera, px: number, py: number, w: number, h: number): { icono?: Icono; grupo?: Icono[]; x: number; z: number } | null {
      const p = new THREE.Vector3(), q = new THREE.Vector3();
      let mejor: { icono?: Icono; grupo?: Icono[]; x: number; z: number } | null = null, zMejor = Infinity;
      const probar = (s: THREE.Sprite, r: { icono?: Icono; grupo?: Icono[]; x: number; z: number }) => {
        if (!s.visible) return;
        p.copy(s.position).project(camara);
        if (p.z > 1) return;
        q.copy(s.position).add(new THREE.Vector3().setFromMatrixColumn(camara.matrixWorld, 1).multiplyScalar(s.scale.y / 2)).project(camara);
        const rad = Math.max(10, Math.abs(q.y - p.y) * h / 2);
        const sx = (p.x * 0.5 + 0.5) * w, sy = (-p.y * 0.5 + 0.5) * h;
        if (Math.hypot(px - sx, py - sy) <= rad && p.z < zMejor) { zMejor = p.z; mejor = r; }
      };
      for (const ic of iconos) probar(ic.sprite, { icono: ic, x: ic.x, z: ic.z });
      grupos.forEach((s, i) => {
        const g = miembros[i];
        if (g) probar(s, { grupo: g, x: g.reduce((a, c) => a + c.x, 0) / g.length, z: g.reduce((a, c) => a + c.z, 0) / g.length });
      });
      return mejor;
    },
    dispose(): void {
      for (const s of grupos) { escena.remove(s); s.material.dispose(); }
      texturas.forEach(t => t.dispose());
    },
  };
}
