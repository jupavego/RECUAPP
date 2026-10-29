import * as THREE from 'three';
import { CategoriaPunto } from '../../mapa/services/mapa.service';

/** Símbolo de cada tipo de infraestructura, para el icono flotante. */
const GLIFO: Record<CategoriaPunto, string> = {
  educacion: '🎓', cultura: '🎭', salud: '🏥', turismo: '🧭', deporte: '⚽', justicia: '🛡️', patrimonio: '🏺',
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
  dispose(): void;
}

/** Medallón redondo del color de la categoría con su símbolo en el centro. */
export function texturaIcono(cat: CategoriaPunto, color: string): THREE.CanvasTexture {
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

/**
 * Icono flotante sobre un edificio: sprite con el medallón de su tipo. Siempre queda por encima del edificio y, cuanto más
 * se mira desde arriba, se sube y se corre hacia el fondo de la vista para no taparlo; flota despacio.
 */
export function crearIcono(cat: CategoriaPunto, color: string, x: number, cima: number, z: number): { sprite: THREE.Sprite; animar(t: number, camara: THREE.Camera): void; dispose(): void } {
  const tex = texturaIcono(cat, color);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.renderOrder = 12;
  const cima3 = new THREE.Vector3(x, cima, z);
  return {
    sprite,
    animar: (t, camara) => {
      const cam = camara.position, d = Math.max(cam.distanceTo(cima3), 1);
      const tam = Math.min(40, Math.max(6, d * 0.05));                      // se lee igual de cerca y de lejos, sin crecer sin fin
      sprite.material.opacity = Math.min(1, Math.max(0, (6500 - d) / 2500));  // de muy lejos se apagan para no amontonarse
      const picado = Math.min(1, Math.max(0, (cam.y - cima) / d));          // 0 = vista de lado, 1 = vista desde arriba
      let dx = x - cam.x, dz = z - cam.z;
      const h = Math.hypot(dx, dz) || 1;
      dx /= h; dz /= h;
      const corrimiento = tam * 1.1 * picado * picado;                      // hacia el fondo, que en pantalla es "arriba"
      sprite.scale.set(tam, tam, 1);
      sprite.position.set(x + dx * corrimiento, cima + tam * (0.8 + 0.9 * picado) + tam * 0.1 * Math.sin(t * 1.6), z + dz * corrimiento);
    },
    dispose: () => { tex.dispose(); sprite.material.dispose(); },
  };
}
