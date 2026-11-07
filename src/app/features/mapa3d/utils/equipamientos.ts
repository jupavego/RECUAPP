import * as THREE from 'three';
import { CategoriaPunto } from '../../mapa/services/mapa.service';
import { TIPOLOGIAS, tipologia } from './tipologias';
import { ESCALA_ACTIVOS, LARGO_REAL } from './escala';

/** Un edificio listo para ponerse en el mapa: piezas con su color, en metros y con el origen en el suelo, en el centro. */
export interface Modelo {
  /** `mov` (solo la gente): [sentido del vaivén (0 = fija), altura de la articulación (m), amplitud (rad)] */
  piezas: { g: THREE.BufferGeometry; color: string; mov?: [number, number, number]; mapa?: THREE.Texture; calado?: boolean }[];
  /** radio que ocupa en planta (m) */
  radio: number;
  /** losa de cimentación [ancho, fondo] que se asienta en la ladera; sin ella el edificio se apoya en su centro */
  losa?: [number, number];
  /** huella real [ancho, fondo] que ocupa en el terreno: las construcciones del catastro que caen dentro de ella se reemplazan por el modelo */
  huella?: [number, number];
}

const AZUL = '#1d4ed8', ROSA = '#be185d', CIAN = '#0e7490', VERDE = '#047857', LIMA = '#4d7c0f', ROJO = '#b91c1c', CAFE = '#92400e';
const VIDRIO = '#6aa6c9', CONCRETO = '#c9ced3', TEJA = '#b5532f';

/** Arma un edificio pieza por pieza: todas las medidas son el ancho (x), el alto (y) y el fondo (z), y `y` es la cara de abajo. */
class Ensamble {
  readonly piezas: Modelo['piezas'] = [];

  private poner(g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, ry = 0): this {
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.piezas.push({ g, color });
    return this;
  }
  caja(w: number, h: number, d: number, color: string, x: number, y: number, z: number, ry = 0): this {
    return this.poner(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color, x, y, z, ry);
  }
  cil(rArriba: number, rAbajo: number, h: number, color: string, x: number, y: number, z: number, seg = 14): this {
    return this.poner(new THREE.CylinderGeometry(rArriba, rAbajo, h, seg).translate(0, h / 2, 0), color, x, y, z);
  }
  cono(r: number, h: number, color: string, x: number, y: number, z: number, seg = 14): this {
    return this.poner(new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0), color, x, y, z);
  }
  /** Techo a dos aguas: `w` es el ancho de la base, `d` el largo de la cumbrera (a lo largo de z; `ry` lo gira). */
  dosAguas(w: number, h: number, d: number, color: string, x: number, y: number, z: number, ry = 0): this {
    const perfil = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
    return this.poner(new THREE.ExtrudeGeometry(perfil, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2), color, x, y, z, ry);
  }
  /** Techo a cuatro aguas sobre una base de w × d. */
  cuatroAguas(w: number, h: number, d: number, color: string, x: number, y: number, z: number): this {
    return this.poner(new THREE.ConeGeometry(1, h, 4).rotateY(Math.PI / 4).scale(w / Math.SQRT2, 1, d / Math.SQRT2).translate(0, h / 2, 0), color, x, y, z);
  }
  /** Montículo de tierra: media esfera achatada. */
  monticulo(r: number, h: number, color: string, x: number, y: number, z: number): this {
    return this.poner(new THREE.SphereGeometry(r, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, h / r, 1), color, x, y, z);
  }
  /** Anillo plano (pista, estanque): óvalo de semiejes a × b, con hueco si `hueco` > 0 (fracción del tamaño). */
  oval(a: number, b: number, grosor: number, color: string, x: number, y: number, z: number, hueco = 0): this {
    const forma = new THREE.Shape();
    forma.absellipse(0, 0, a, b, 0, Math.PI * 2, false, 0);
    if (hueco > 0) {
      const h = new THREE.Path();
      h.absellipse(0, 0, a * hueco, b * hueco, 0, Math.PI * 2, true, 0);
      forma.holes.push(h);
    }
    return this.poner(new THREE.ExtrudeGeometry(forma, { depth: grosor, bevelEnabled: false, curveSegments: 28 }).rotateX(-Math.PI / 2), color, x, y, z);
  }
  /** Franja de ventanas a lo largo de una fachada que da a +z (o -z con `atras`). */
  ventanas(ancho: number, alto: number, color: string, x: number, y: number, zFachada: number, atras = false): this {
    return this.caja(ancho, alto, 0.3, color, x, y, zFachada + (atras ? -0.1 : 0.1));
  }
  mastil(h: number, x: number, z: number, bandera: string): this {
    return this.cil(0.15, 0.2, h, '#e5e7eb', x, 0, z, 6).caja(3, 1.8, 0.1, bandera, x + 1.6, h - 1.9, z);
  }
  /** Árbol redondo, para dar escala. */
  arbol(x: number, z: number, h = 7): this {
    return this.cil(0.3, 0.4, h * 0.45, '#6b4423', x, 0, z, 6).cono(h * 0.28, h * 0.62, '#2f7d3a', x, h * 0.4, z, 8);
  }
}

/** Torre de celosía de cuatro patas (afinada hacia arriba) con dos pares de crucetas trianguladas y cadenas de aisladores colgantes. */
function torreAltaTension(e: Ensamble): Modelo {
  const acero = '#d9dde0', H = 38, base = 4.4, cima = 0.7;
  const barra = (a: THREE.Vector3, b: THREE.Vector3, r = 0.14, color = acero) => {
    const dir = b.clone().sub(a), l = dir.length();
    const g = new THREE.CylinderGeometry(r, r, l, 5).rotateX(Math.PI / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    g.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    e.piezas.push({ g, color });
  };
  const ancho = (y: number) => base + (cima - base) * Math.min(y / H, 1);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const esquinas = (y: number) => { const w = ancho(y); return [V(-w, y, -w), V(w, y, -w), V(w, y, w), V(-w, y, w)]; };
  const niveles = 10;
  for (let k = 0; k < niveles; k++) {
    const y0 = H * k / niveles, y1 = H * (k + 1) / niveles, c0 = esquinas(y0), c1 = esquinas(y1);
    for (let i = 0; i < 4; i++) {
      barra(c0[i], c1[i], 0.26);                                       // patas
      const j = (i + 1) % 4;
      barra(c1[i], c1[j], 0.12);                                       // anillos horizontales
      barra(c0[i], c1[j], 0.09); barra(c0[j], c1[i], 0.09);             // diagonales en X
    }
  }
  // crucetas: armadura triangular a cada lado en dos niveles, con una cadena de aisladores en cada punta
  for (const [y, largo] of [[H * 0.68, 8.4], [H * 0.84, 7.2]] as const) {
    const w = ancho(y);
    for (const lado of [-1, 1]) {
      const punta = V(lado * (w + largo), y + 0.4, 0), arriba = V(lado * w, y + 3.2, 0), abajo = V(lado * w, y - 0.8, 0);
      barra(abajo, punta, 0.16); barra(arriba, punta, 0.16); barra(arriba, abajo, 0.12);
      for (let t = 1; t < 4; t++) {
        const f = t / 4, ps = V(lado * (w + largo * f), y + 0.4 * f + (3.2 - 3.2 * f) * 0.0 - 0.8 * (1 - f) , 0), pa = V(lado * (w + largo * f), y + 3.2 - 2.8 * f, 0);
        barra(ps, pa, 0.09);
      }
      barra(V(lado * w, y, 1.2), V(lado * w, y, -1.2), 0.12);
      for (const dz of [-1, 1]) barra(V(lado * w, y - 0.8, dz * w * 0.9), punta.clone().setZ(0), 0.07);
      e.cil(0.2, 0.2, 2.6, '#c8b79b', punta.x, punta.y - 2.9, 0, 6);        // cadena de aisladores
      e.cil(0.5, 0.5, 0.5, '#5b6168', punta.x, punta.y - 3.3, 0, 6);        // grapa y conductor
    }
  }
  // cabeza con el cable de guarda
  barra(V(0, H, 0), V(0, H + 3.5, 0), 0.16);
  barra(V(-5.5, H - 1, 0), V(0, H + 3.5, 0), 0.08); barra(V(5.5, H - 1, 0), V(0, H + 3.5, 0), 0.08);
  return { piezas: e.piezas, radio: 16 };
}

/** Servicios públicos: subestación, torre de alta tensión, central, bocatoma, tratamiento, tanque, PTAR y ECA (proyectos como huella). */
function servicio(e: Ensamble, t: string): Modelo {
  const concreto = '#c9ccc9', metal = '#8d949b', loza = '#a8a393';
  if (/subestaci/.test(t)) {
    const w = 70, d = 48;
    e.caja(w, 0.3, d, loza, 0, 0, 0).caja(13, 5.5, 30, '#e6e3da', -w / 2 + 9, 0.3, 0).caja(13.8, 0.6, 30.8, '#b4b8ba', -w / 2 + 9, 5.8, 0)
      .caja(7, 4, 7, '#e0ddd2', -w / 2 + 9, 0.3, 19).caja(7.6, 0.5, 7.6, '#b4b8ba', -w / 2 + 9, 4.3, 19);
    for (let k = 0; k < 5; k++) {
      const x = -w / 2 + 22 + k * 7;
      for (const z of [-14, 0, 14]) {
        if (k % 3 === 0) e.caja(0.95, 12, 0.95, concreto, x, 0.3, z - 5).caja(0.95, 12, 0.95, concreto, x, 0.3, z + 5).caja(0.9, 0.8, 11, metal, x, 12, z);
        else if (k % 3 === 1) for (const dz of [-3.5, 0, 3.5]) e.cil(0.3, 0.35, 4.2, '#cdb9a3', x, 0.3, z + dz, 8).caja(1.8, 1.2, 1.4, '#7c8a96', x, 0.3, z + dz);
        else e.caja(0.35, 0.35, 11, metal, x, 6.4, z).caja(0.6, 6, 0.6, concreto, x, 0.3, z - 5).caja(0.6, 6, 0.6, concreto, x, 0.3, z + 5);
      }
    }
    for (const z of [-15, 0, 15]) {
      e.caja(7, 5.5, 5, '#6d7f8c', w / 2 - 9, 0.3, z).caja(1.4, 4.5, 4.4, '#5d6e7a', w / 2 - 13.4, 0.3, z).caja(1.4, 4.5, 4.4, '#5d6e7a', w / 2 - 4.6, 0.3, z);
      for (const dz of [-1.6, 0, 1.6]) e.cil(0.3, 0.38, 2.6, '#cdb9a3', w / 2 - 9, 5.8, z + dz, 8);
    }
    for (const x of [-w / 2, w / 2]) for (let z = -d / 2; z <= d / 2; z += 6) e.caja(0.16, 2.5, 0.16, '#595f66', x, 0.3, z);
    for (const z of [-d / 2, d / 2]) for (let x = -w / 2; x <= w / 2; x += 6) e.caja(0.16, 2.5, 0.16, '#595f66', x, 0.3, z);
    return { piezas: e.piezas, radio: 46, losa: [w + 4, d + 4] };
  }
  if (/torre/.test(t)) return torreAltaTension(e);
  if (/central/.test(t)) {
    e.caja(60, 0.3, 40, loza, 0, 0, 0).caja(46, 12, 20, '#d6d3ca', 0, 0.3, 0).caja(47.5, 0.8, 21.5, '#4f6f8a', 0, 12.3, 0)
      .caja(46.2, 1.4, 20.2, '#7b9db8', 0, 8, 0);
    e.cil(1.8, 1.8, 30, '#6b7480', -14, 12, -12, 12).caja(5, 3, 5, concreto, -14, 0.3, -12);       // tubería forzada
    for (const x of [-12, 0, 12]) e.cil(2.2, 2.2, 3, '#4aa3a8', x, 12.3, 5, 16);
    for (const x of [-14, 14]) e.caja(8, 6, 6, '#e0ddd2', x, 0.3, 17);
    return { piezas: e.piezas, radio: 40, losa: [60, 40] };
  }
  if (/bocatoma/.test(t)) {
    e.cil(8, 8, 0.5, '#ffd23f', 0, 0, 0, 28).cil(8.5, 8.5, 0.25, '#2f8fff', 0, 0.5, 0, 28).caja(4, 2.4, 3.2, concreto, 0, 0.5, 0).caja(4.6, 0.4, 3.8, '#7d6f63', 0, 2.9, 0)
      .cil(0.35, 0.35, 14, '#2f8fff', 0, 0.5, 0, 8);
    return { piezas: e.piezas, radio: 9 };
  }
  if (/tratamiento/.test(t)) {
    for (const x of [-5.5, 5.5]) e.cil(4, 4, 3, '#4aa3a8', x, 0, 0, 20);
    e.caja(5, 3.4, 4, '#d9d4c7', 0, 0, 7).caja(5.6, 0.5, 4.6, '#7d6f63', 0, 3.4, 7).cil(0.35, 0.35, 12, '#4aa3a8', 0, 0, -6, 8);
    return { piezas: e.piezas, radio: 12 };
  }
  if (/tanque/.test(t)) {
    e.cil(5, 5, 7, '#dfe6ea', 0, 0, 0, 24).cil(5.2, 5.2, 0.5, '#9aa4ad', 0, 7, 0, 24).caja(1.4, 2.4, 1.4, concreto, 6.5, 0, 0);
    return { piezas: e.piezas, radio: 9 };
  }
  // proyectos aún sin construir: huella translúcida simulada con losa y borde
  const color = /eca/.test(t) ? '#e0903f' : '#2bb3bf';
  e.cil(26, 26, 0.5, color, 0, 0, 0, 40).cil(26.5, 26.5, 0.9, '#ffffff', 0, 0, 0, 40).cil(25.5, 25.5, 1.1, color, 0, 0, 0, 40);
  return { piezas: e.piezas, radio: 28 };
}

/** Escuela o colegio: urbano en L de dos pisos con patio y bandera; rural de un piso con techo a dos aguas. */
function escuela(e: Ensamble, rural: boolean): Modelo {
  if (rural) {
    e.caja(24, 4, 8, '#f0e6d0', 0, 0, -3)
      .dosAguas(10, 2.8, 26, TEJA, 0, 4, -3, Math.PI / 2)
      .caja(24.4, 0.6, 8.4, AZUL, 0, 3.2, -3)
      .ventanas(20, 1.3, VIDRIO, 0, 1.4, 1).ventanas(20, 1.3, VIDRIO, 0, 1.4, -7, true)
      .caja(2, 2.6, 0.3, AZUL, 8, 0, 1.1)
      .caja(26, 0.2, 12, CONCRETO, 0, 0, 7)
      .caja(0.3, 1.2, 8, '#374151', 8, 0, 8).caja(0.3, 1.2, 8, '#374151', -8, 0, 8)
      .mastil(9, 11, 11, AZUL).arbol(-13, 10, 8);
    return { piezas: e.piezas, radio: 22, losa: [32, 26] };
  }
  e.caja(36, 8, 12, '#f1e7cf', 0, 0, -6)
    .caja(36.4, 0.9, 12.4, AZUL, 0, 7.1, -6)
    .caja(37, 0.7, 13, '#b0413e', 0, 8, -6)
    .caja(12, 8, 14, '#f1e7cf', -12, 0, 7)
    .caja(12.4, 0.9, 14.4, AZUL, -12, 7.1, 7)
    .caja(13, 0.7, 15, '#b0413e', -12, 8, 7)
    .ventanas(34, 1.5, VIDRIO, 0, 1.6, 0).ventanas(34, 1.5, VIDRIO, 0, 5, 0)
    .ventanas(34, 1.5, VIDRIO, 0, 1.6, -12, true).ventanas(34, 1.5, VIDRIO, 0, 5, -12, true)
    .ventanas(8, 1.5, VIDRIO, -12, 1.6, 14).ventanas(8, 1.5, VIDRIO, -12, 5, 14)
    .caja(7, 0.5, 4, AZUL, 8, 3.6, 2).caja(0.4, 3.6, 0.4, '#e5e7eb', 5, 0, 3.6).caja(0.4, 3.6, 0.4, '#e5e7eb', 11, 0, 3.6)
    .caja(3, 3.2, 0.3, '#374151', 8, 0, 0.1)
    .caja(26, 0.2, 14, CONCRETO, 9, 0, 14)
    .caja(0.2, 0.2, 14, '#fff', 9, 0.2, 14).caja(10, 0.2, 0.2, '#fff', 9, 0.2, 14)
    .mastil(12, 24, 6, AZUL).arbol(-22, 18, 8).arbol(22, 18, 7);
  return { piezas: e.piezas, radio: 32, losa: [50, 32] };
}

/**
 * I. E. Colombia: ala larga de aulas de dos pisos con techo de teja a lo largo de la calle 5 (+z), una segunda ala
 * perpendicular en un extremo, y entre ambas el patio de concreto con cancha pintada, mástil y árboles. Frente hacia −z.
 */
function colegioUrbano(e: Ensamble, [W, D]: [number, number]): Modelo {
  const MURO = '#efe2c6', LADRILLO = '#a8553a';
  e.caja(W, 0.2, D, '#d2d5d8', 0, 0, 0);
  const largo = W - 4, ala = D - 6;
  e.caja(largo, 9, 11, MURO, 0, 0.2, D / 2 - 7).caja(largo + 0.8, 0.8, 11.8, LADRILLO, 0, 9.2, D / 2 - 7).dosAguas(13, 3.4, largo + 1, TEJA, 0, 10, D / 2 - 7, Math.PI / 2);
  e.ventanas(largo - 4, 1.5, VIDRIO, 0, 1.8, D / 2 - 12.5, true).ventanas(largo - 4, 1.5, VIDRIO, 0, 5.8, D / 2 - 12.5, true);
  e.caja(11, 9, ala, MURO, -W / 2 + 7, 0.2, -3).caja(11.8, 0.8, ala + 0.8, LADRILLO, -W / 2 + 7, 9.2, -3).dosAguas(12, 3.4, ala + 1, TEJA, -W / 2 + 7, 10, -3);
  for (let k = 0; k < 4; k++) e.caja(0.3, 1.6, 3.2, VIDRIO, -W / 2 + 12.7, 2.2, -12 + k * 6).caja(0.3, 1.6, 3.2, VIDRIO, -W / 2 + 12.7, 6, -12 + k * 6);
  e.caja(34, 0.25, 15, '#c4c9ce', 10, 0.2, -2).caja(28, 0.1, 11, '#3b6ea8', 10, 0.45, -2)                         // patio con cancha pintada
    .caja(0.25, 0.05, 11, '#f5f5f4', 10, 0.55, -2).oval(2.4, 2.4, 0.05, '#f5f5f4', 10, 0.55, -2, 0.9);
  e.caja(4, 3, 0.4, '#374151', -W / 2 + 13, 0.2, D / 2 - 12.7).caja(8, 0.5, 3, AZUL, -W / 2 + 13, 3.4, D / 2 - 14);   // portería de acceso
  e.mastil(12, W / 2 - 6, -D / 2 + 5, AZUL).arbol(W / 2 - 4, -D / 2 + 3, 8).arbol(-4, -D / 2 + 2, 7).arbol(W / 2 - 3, 4, 7);
  return { piezas: e.piezas, radio: Math.max(W, D) / 2, losa: [W, D], huella: [W, D] };
}

/**
 * Casa de la cultura: casona en U de un piso alrededor de un patio con fuente, techos de teja, corredor de postes de madera,
 * puerta rosada y un mural de colores en la pared lateral.
 */
function casaCultura(e: Ensamble): Modelo {
  const muro = '#f3ead8', madera = '#7c5a3a';
  e.caja(36, 5, 9, muro, 0, 0, -8).cuatroAguas(38, 3.4, 11, TEJA, 0, 5, -8)
    .caja(9, 5, 17, muro, -13.5, 0, 0.5).cuatroAguas(11, 3.4, 19, TEJA, -13.5, 5, 0.5)
    .caja(9, 5, 17, muro, 13.5, 0, 0.5).cuatroAguas(11, 3.4, 19, TEJA, 13.5, 5, 0.5)
    .caja(18, 0.15, 16, '#d8cdb8', 0, 0, 0.5)
    .cil(2.3, 2.5, 0.9, '#9ca3af', 0, 0.15, 2, 16).cil(1.8, 1.8, 0.5, '#7fc4e3', 0, 0.9, 2, 16).cil(0.3, 0.3, 2, '#cbd5e1', 0, 0.9, 2, 8)
    .caja(18, 0.3, 2.4, madera, 0, 3.7, -4.7);
  for (const x of [-8, -4, 0, 4, 8]) e.cil(0.2, 0.2, 3.7, madera, x, 0, -3.6, 6);
  e.caja(2.6, 3.2, 0.3, ROSA, 0, 0, -3.45).caja(6, 0.9, 0.3, '#fff', 0, 4.1, -3.4)
    .ventanas(2.4, 1.7, VIDRIO, -7, 1.3, -3.5).ventanas(2.4, 1.7, VIDRIO, 7, 1.3, -3.5)
    .ventanas(2.4, 1.7, VIDRIO, -12, 1.3, -3.5).ventanas(2.4, 1.7, VIDRIO, 12, 1.3, -3.5)
    .ventanas(2.4, 1.7, VIDRIO, -9, 1.3, -12.5, true).ventanas(2.4, 1.7, VIDRIO, 9, 1.3, -12.5, true);
  // mural en la pared exterior del ala izquierda
  ['#f59e0b', '#be185d', '#1d4ed8', '#16a34a'].forEach((c, k) => e.caja(0.25, 3.2, 3.6, c, -18.2, 0.9, -5.5 + k * 4.2));
  e.caja(0.4, 0.4, 3.2, madera, -10.2, 3.8, 9.6).caja(0.4, 0.4, 3.2, madera, 10.2, 3.8, 9.6)
    .mastil(11, 8, 12, ROSA).arbol(-20, 12, 8).arbol(20, 12, 8).arbol(0, 14, 7);
  return { piezas: e.piezas, radio: 26, losa: [42, 34] };
}

/**
 * Biblioteca: edificio moderno de dos pisos, planta baja de vidrio, piso alto en voladizo con aletas rosadas contra el sol,
 * terraza de lectura con bancas y una pila de libros a la entrada.
 */
function biblioteca(e: Ensamble): Modelo {
  e.caja(26, 4, 13, '#f4f1ec', 0, 0, -4)
    .caja(22, 3, 0.3, '#8fd0e8', 0, 0.5, 2.6)
    .caja(30, 4.6, 16, '#f4f1ec', 0, 4, -3)
    .caja(26, 2.6, 0.3, VIDRIO, 0, 4.9, 5.1)
    .caja(31, 0.6, 17, '#6b7280', 0, 8.6, -3)
    .caja(14, 0.4, 8, '#9ca3af', -6, 9.2, -6)
    .caja(31, 0.15, 16, '#e5e7eb', 0, 0, 0);
  for (let k = 0; k < 8; k++) e.caja(0.5, 4.6, 0.7, ROSA, -14 + k * 4, 4, 5.4);
  e.caja(7, 0.4, 3.4, ROSA, -6, 3.5, 3.4).caja(0.3, 3.5, 0.3, '#e5e7eb', -9, 0, 4.8).caja(0.3, 3.5, 0.3, '#e5e7eb', -3, 0, 4.8)
    .caja(2.4, 3, 0.3, '#374151', -6, 0, 2.7)
    .caja(24, 0.3, 4.4, '#d9d2c3', 0, 0, 7).caja(22, 0.3, 2.4, '#e3dccf', 0, 0.3, 9.4)
    .caja(2.6, 0.5, 0.8, '#7c5a3a', -6, 0.6, 9).caja(2.6, 0.5, 0.8, '#7c5a3a', 6, 0.6, 9)
    .caja(3, 0.6, 2, '#dc2626', 15, 0, 9).caja(2.6, 0.6, 1.8, '#2563eb', 15.1, 0.6, 9).caja(2.8, 0.6, 2, '#f59e0b', 14.9, 1.2, 9).caja(2.2, 0.6, 1.6, '#16a34a', 15, 1.8, 9)
    .mastil(10, -17, 8, ROSA).arbol(-19, 12, 8).arbol(20, 4, 8);
  return { piezas: e.piezas, radio: 25, losa: [38, 28] };
}

/** Escuela de música o escenario cultural: fachada clásica con pórtico de columnas, frontón y gradas. Emisora: caseta con mástil. */
function cultura(e: Ensamble, tipo: string): Modelo {
  if (/casa de (la )?cultura/.test(tipo)) return casaCultura(e);
  if (/biblioteca/.test(tipo)) return biblioteca(e);
  if (/emisora/.test(tipo)) {
    e.caja(12, 4, 9, '#e5e7eb', 0, 0, 0).caja(12.4, 0.6, 9.4, ROSA, 0, 4, 0).ventanas(8, 1.2, VIDRIO, 0, 1.6, 4.5)
      .caja(4, 0.4, 4, CONCRETO, 12, 0, 0);
    const bandas = 8, seg = 46 / bandas;
    for (let k = 0; k < bandas; k++) e.cil(0.45 - 0.3 * ((k + 1) / bandas), 0.45 - 0.3 * (k / bandas), seg, k % 2 ? '#e5e7eb' : '#c4342d', 12, seg * k, 0, 6);
    e.caja(3, 0.3, 3, '#e5e7eb', 12, 30, 0).arbol(-9, 6, 7);
    return { piezas: e.piezas, radio: 18, losa: [32, 16] };
  }
  e.caja(30, 8, 15, '#efe3d0', 0, 0, -3)
    .dosAguas(17, 5, 31, '#9d174d', 0, 8, -3, Math.PI / 2)
    .caja(32, 1, 17, '#d9c9ae', 0, 7.2, -3)
    .caja(24, 0.8, 4, '#d9c9ae', 0, 7, 9.5)
    .dosAguas(5, 3.4, 26, ROSA, 0, 7.8, 9.5, Math.PI / 2)
    .caja(26, 0.6, 3.2, '#d9c9ae', 0, 0.9, 10)
    .caja(26, 0.6, 3, '#e3d6bf', 0, 0.3, 11.4)
    .caja(5, 5.8, 0.4, '#5b3a29', 0, 0.9, 4.6);
  for (let k = 0; k < 6; k++) e.cil(0.7, 0.8, 6, '#f5ecd9', -10 + k * 4, 1.5, 10, 12);
  e.ventanas(5, 3, VIDRIO, -9.5, 2, 4.5).ventanas(5, 3, VIDRIO, 9.5, 2, 4.5).arbol(-19, 14, 8).arbol(19, 14, 8);
  return { piezas: e.piezas, radio: 28, losa: [36, 30] };
}

/** Hospital o centro de salud: bloque blanco con franja cian, cruz roja en la fachada, marquesina de urgencias y helipuerto. */
function salud(e: Ensamble, tipo: string): Modelo {
  const grande = /hospital|integral|especializada/.test(tipo);
  if (!grande) {
    e.caja(18, 6, 10, '#f4f6f8', 0, 0, -3)
      .caja(19, 0.7, 11, '#9ca3af', 0, 6, -3)
      .caja(18.4, 0.9, 10.4, CIAN, 0, 4.6, -3)
      .ventanas(14, 1.5, VIDRIO, 0, 1.6, 2).ventanas(14, 1.5, VIDRIO, 0, 1.6, -8, true)
      .caja(7, 0.4, 4, CIAN, -5, 3.4, 4).caja(0.3, 3.4, 0.3, '#e5e7eb', -8, 0, 5.6).caja(0.3, 3.4, 0.3, '#e5e7eb', -2, 0, 5.6)
      .caja(1, 3.6, 0.3, '#d11f2e', 6.5, 6.7, 2.1).caja(3.6, 1, 0.3, '#d11f2e', 6.5, 8, 2.1)
      .caja(20, 0.2, 8, CONCRETO, 0, 0, 7).arbol(-12, 9, 7).arbol(12, 9, 6);
    return { piezas: e.piezas, radio: 18, losa: [26, 22] };
  }
  e.caja(30, 12, 14, '#f4f6f8', 0, 0, -7)
    .caja(12, 9, 14, '#f4f6f8', -21, 0, -7)
    .caja(31, 0.8, 15, '#9ca3af', 0, 12, -7).caja(13, 0.8, 15, '#9ca3af', -21, 9, -7)
    .caja(30.4, 1.1, 14.4, CIAN, 0, 10.4, -7)
    .caja(18, 7, 0.6, '#e0f2f6', 4, 0.6, 0.2);
  for (const y of [1.4, 4.6, 7.8]) e.ventanas(26, 1.5, VIDRIO, 0, y, 0).ventanas(26, 1.5, VIDRIO, 0, y, -14, true);
  for (const y of [1.4, 4.6]) e.ventanas(8, 1.5, VIDRIO, -21, y, 0);
  e.caja(1.6, 6, 0.3, '#d11f2e', 0, 4.8, 0.45).caja(6, 1.6, 0.3, '#d11f2e', 0, 7, 0.45)
    .caja(14, 0.5, 8, CIAN, 10, 4.4, 4).caja(0.4, 4.4, 0.4, '#e5e7eb', 4, 0, 7.6).caja(0.4, 4.4, 0.4, '#e5e7eb', 16, 0, 7.6)
    .cil(5, 5, 0.3, '#374151', -21, 9.8, -7, 20).caja(0.8, 0.1, 4, '#fff', -21, 10.15, -7).caja(4, 0.1, 0.8, '#fff', -21, 10.15, -7)
    .caja(4, 1.6, 3, '#d1d5db', 6, 12.8, -9)
    .caja(34, 0.2, 10, CONCRETO, 4, 0, 9).arbol(-14, 14, 8).arbol(24, 14, 8);
  return { piezas: e.piezas, radio: 34, losa: [58, 34] };
}

/**
 * Sede Comfama Girardota (carrera 18 # 5A-65): un bloque de 3 pisos con un servicio por piso — 1.º la piscina (vestuarios y acceso, con la
 * lámina descubierta al lado del bloque), 2.º el centro integral de salud y 3.º el colegio — medido sobre el catastro (predios 0110-00013
 * y 0110-00014) y la imagen satelital. Ejes de la cuadrícula del casco: x a lo largo de la carrera 18 Bis (hacia el noreste) y el frente
 * (−z) sobre ella. Al noreste de la piscina, el edificio de atención de 2 pisos. Huella de 59 × 27 m, sin tocar las vías del mapa (que se
 * dibujan más anchas que las reales). En `PARTES_COMFAMA`, dónde va el icono de cada servicio y entre qué alturas queda su piso.
 */
const PISO_COMFAMA = 3.6;
export const PARTES_COMFAMA: Record<'piscina' | 'salud' | 'colegio', { x: number; z: number; alto: number; nivel: [number, number] }> = {
  piscina: { x: 8, z: 3, alto: 1, nivel: [-5, 0.2 + PISO_COMFAMA] },
  salud: { x: -22, z: -14, alto: 0.2 + PISO_COMFAMA * 1.5, nivel: [0.2 + PISO_COMFAMA, 0.2 + PISO_COMFAMA * 2] },
  colegio: { x: -6, z: -14, alto: 0.2 + PISO_COMFAMA * 2.5, nivel: [0.2 + PISO_COMFAMA * 2, 30] },
};
function sedeComfama(e: Ensamble): Modelo {
  const MAGENTA = '#d6197a', MURO = '#f1ece2', TECHO = '#b98a63', AGUA = '#38bdf8', BORDE = '#f1f5f9', LOSA = '#cfd3d8';
  const P = PISO_COMFAMA, y1 = 0.2, y2 = y1 + P, y3 = y2 + P, cima = y3 + P;
  const BX = -13.75, BW = 31.5, BZ = -2.25, BD = 22.5, frente = BZ - BD / 2, fondo = BZ + BD / 2;
  e.caja(59, 0.2, 27, '#d2d5d8', 0, 0, 0);
  // piso 1, piscina: vestuarios y acceso con fachada de vidrio hacia la lámina y franja cian
  e.caja(BW, P, BD, '#e6f4f8', BX, y1, BZ).caja(BW + 0.2, 0.5, BD + 0.2, CIAN, BX, y2 - 0.6, BZ)
    .caja(0.3, 2.6, BD - 4, VIDRIO, BX + BW / 2 + 0.1, y1 + 0.4, BZ)
    .ventanas(BW - 6, 1.6, VIDRIO, BX, y1 + 1, frente, true).caja(4, 2.8, 0.3, '#374151', BX + 6, y1, frente - 0.1);
  // piso 2, salud: blanco con franja cian, cruz roja hacia la carrera
  e.caja(BW + 0.6, 0.35, BD + 0.6, LOSA, BX, y2, BZ).caja(BW, P - 0.35, BD, '#f7f8fa', BX, y2 + 0.35, BZ)
    .ventanas(BW - 4, 1.4, VIDRIO, BX, y2 + 1, frente, true).ventanas(BW - 4, 1.4, VIDRIO, BX, y2 + 1, fondo)
    .caja(1.1, 2.6, 0.3, '#d11f2e', BX - BW / 2 + 4, y2 + 0.5, frente - 0.3).caja(2.6, 1.1, 0.3, '#d11f2e', BX - BW / 2 + 4, y2 + 1.25, frente - 0.3);
  // piso 3, colegio: paneles de colores (preescolar), cubierta y letrero Comfama
  e.caja(BW + 0.6, 0.35, BD + 0.6, LOSA, BX, y3, BZ).caja(BW, P - 0.35, BD, MURO, BX, y3 + 0.35, BZ)
    .ventanas(BW - 4, 1.4, VIDRIO, BX, y3 + 1, frente, true).ventanas(BW - 4, 1.4, VIDRIO, BX, y3 + 1, fondo);
  ['#f59e0b', '#16a34a', MAGENTA, '#0ea5e9', '#f59e0b'].forEach((c, k) => e.caja(2.2, P - 0.6, 0.25, c, BX - 12 + k * 6, y3 + 0.4, frente - 0.25));
  e.caja(BW + 0.6, 0.6, BD + 0.6, TECHO, BX, cima, BZ).caja(11, 1.4, 0.3, MAGENTA, BX + 8, cima + 0.6, frente - 0.1)
    .caja(3, 1.2, 2, '#d1d5db', BX - 8, cima + 0.6, BZ).caja(3, 1.2, 2, '#d1d5db', BX - 2, cima + 0.6, BZ)
    .caja(8, 0.4, 2.4, MAGENTA, BX + 6, y2 - 0.4, frente - 1.3);                                   // marquesina de la entrada
  // patio infantil del colegio detrás del bloque
  e.caja(BW, 0.15, 4.3, '#7cc47f', BX, 0.2, 11.3);
  for (const [x, c] of [[-25, '#ef4444'], [-18, '#f59e0b'], [-11, '#0ea5e9']] as const) e.caja(2, 1.3, 2, c, x, 0.35, 11.3);
  // piscina descubierta al lado del bloque, al nivel del primer piso: lámina de 7 × 16 m, carriles, piscina infantil con sombrío
  e.caja(12, 0.35, 26, '#e8e2d4', 8.5, 0.2, 0)
    .caja(7, 0.5, 16, AGUA, 8, 0.4, 3)
    .caja(8.4, 0.6, 0.7, BORDE, 8, 0.4, 11.35).caja(8.4, 0.6, 0.7, BORDE, 8, 0.4, -5.35)
    .caja(0.7, 0.6, 16, BORDE, 4.15, 0.4, 3).caja(0.7, 0.6, 16, BORDE, 11.85, 0.4, 3);
  for (const x of [6.25, 8, 9.75]) e.caja(0.15, 0.05, 15, '#1d4ed8', x, 0.92, 3);
  e.caja(5, 0.55, 4, BORDE, 8, 0.4, -9.5).caja(4.2, 0.6, 3.2, '#67e8f9', 8, 0.4, -9.5).caja(6.5, 0.25, 5, MAGENTA, 8, 3.2, -9.5);
  for (const [x, z] of [[5, -11.8], [11, -11.8], [5, -7.2], [11, -7.2]]) e.cil(0.12, 0.12, 2.8, '#9ca3af', x, 0.55, z, 6);
  for (let k = 0; k < 3; k++) e.caja(1.4, 0.5, 3.4, '#fef3c7', 13.2, 0.55, -1 + k * 4);
  // edificio de atención al noreste (2 pisos), con tanque en la azotea
  e.caja(14, 7.2, 22.5, '#f4f6f8', 22.5, 0.2, -2.25).caja(14.5, 0.6, 23, '#9ca3af', 22.5, 7.4, -2.25)
    .caja(14.2, 0.8, 22.7, MAGENTA, 22.5, 5.6, -2.25);
  for (const y of [1.4, 4]) e.ventanas(11, 1.4, VIDRIO, 22.5, y, -13.5, true).ventanas(11, 1.4, VIDRIO, 22.5, y, 9);
  e.caja(3, 2.8, 0.3, '#374151', 20, 0.2, -13.6).cil(2, 2, 2.6, '#374151', 26.5, 8, 4, 16)
    .caja(14, 0.15, 4.3, '#9aa0a6', 22.5, 0.2, 11.3).arbol(17, 12, 6).arbol(28, 12, 6);
  return { piezas: e.piezas, radio: 32, losa: [59, 27], huella: [59, 27] };
}

/** Sitios de interés: iglesia, kiosco de parque, mirador, pabellón de mercado o cabaña con estanque, según de qué se trate. */
function turismo(e: Ensamble, texto: string, rnd: () => number): Modelo {
  if (/plaza de mercado/.test(texto)) return plazaMercado(e);
  if (/centro comercial/.test(texto)) return centroComercial(e, [44, 36]);
  if (/parqueadero santa ana/.test(texto)) return parqueaderoPublico(e, [56, 46], rnd);
  if (/central de transporte|parqueadero de buses/.test(texto)) return centralVeredal(e, /parqueadero/.test(texto) ? [60, 44] : [40, 36], rnd);
  if (/arqueol|petrogl/.test(texto)) return patrimonio(e, 'sitio arqueológico', rnd);
  if (/catedral/.test(texto)) return catedral(e);
  if (/parque principal/.test(texto)) return parquePrincipal(e, rnd);
  if (/religios|se[ñn]or|iglesia/.test(texto)) {
    const mayor = /catedral/.test(texto);
    e.caja(14, 10, 30, '#efe6d6', 0, 0, 4)
      .dosAguas(16, 5.5, 31, TEJA, 0, 10, 4)
      .caja(8, 22, 8, '#efe6d6', 0, 0, -15)
      .caja(8.8, 1, 8.8, '#d9c9ae', 0, 15, -15)
      .caja(4, 4, 0.3, '#2b2f36', 0, 16, -19.1).caja(0.3, 4, 4, '#2b2f36', 4.1, 16, -15).caja(0.3, 4, 4, '#2b2f36', -4.1, 16, -15)
      .cuatroAguas(9.5, 10, 9.5, '#8b3a1f', 0, 20, -15)
      .caja(0.4, 3.6, 0.4, '#e5e7eb', 0, 29, -15).caja(2, 0.4, 0.4, '#e5e7eb', 0, 31, -15)
      .caja(3.6, 5.6, 0.4, '#5b3a29', 0, 0, -19.2)
      .caja(5, 0.4, 2.4, '#d9c9ae', 0, 0, -20.4).caja(10, 0.2, 14, CONCRETO, 0, 0, -26)
      .caja(1.8, 3.2, 0.3, VIDRIO, 7.1, 3.5, 4).caja(1.8, 3.2, 0.3, VIDRIO, -7.1, 3.5, 4)
      .arbol(-14, -24, 9).arbol(14, -24, 9);
    return { piezas: e.piezas, radio: mayor ? 32 : 28, losa: [26, 50] };
  }
  if (/parque|espacio p[uú]blico|encuentro/.test(texto)) {
    e.cil(8, 8.4, 0.5, CONCRETO, 0, 0, 0, 8);
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      e.cil(0.25, 0.25, 4.2, '#f5ecd9', Math.cos(a) * 6.8, 0.5, Math.sin(a) * 6.8, 6);
    }
    e.cono(9.6, 3.4, VERDE, 0, 4.7, 0, 8).cil(0.2, 0.2, 2, '#e5e7eb', 0, 8, 0, 6)
      .cil(2.4, 2.6, 0.8, '#9ca3af', 15, 0, 6, 16).cil(2, 2, 0.5, '#7fc4e3', 15, 0.5, 6, 16).cil(0.4, 0.4, 2, '#cbd5e1', 15, 0.5, 6, 8)
      .caja(2.4, 0.5, 0.8, '#7c5a3a', 8, 0, 14).caja(2.4, 0.5, 0.8, '#7c5a3a', -6, 0, 14)
      .arbol(-14, -4, 9).arbol(-12, 8, 8).arbol(18, -8, 9).arbol(8, -14, 8);
    return { piezas: e.piezas, radio: 24, losa: [34, 34] };
  }
  if (/mercado|educaci[oó]n|innova/.test(texto)) {
    const colores = ['#dc2626', '#f59e0b', '#16a34a', '#2563eb'];
    e.caja(30, 0.4, 18, CONCRETO, 0, 0, 0);
    for (const [x, z] of [[-14, -8], [14, -8], [-14, 8], [14, 8], [0, -8], [0, 8]]) e.cil(0.3, 0.3, 5, '#6b7280', x, 0.4, z, 6);
    e.dosAguas(20, 3, 31, VERDE, 0, 5.4, 0, Math.PI / 2);
    colores.forEach((c, k) => e.caja(5, 1.3, 2.4, c, -10.5 + k * 7, 0.4, -4).caja(5.4, 0.2, 3, '#fff', -10.5 + k * 7, 2.6, -4));
    e.caja(24, 0.8, 0.3, '#fff', 0, 3.4, 9.2).arbol(-19, 12, 8).arbol(19, 12, 8);
    return { piezas: e.piezas, radio: 24, losa: [34, 24] };
  }
  if (/truchera|pesca/.test(texto)) {
    e.caja(9, 3.4, 7, '#a9763f', 0, 0, -6).dosAguas(10, 2.8, 9.4, TEJA, 0, 3.4, -6, Math.PI / 2)
      .caja(1.6, 2.4, 0.3, '#5b3a29', 2, 0, -2.4).caja(2.4, 1.2, 0.3, VIDRIO, -2.4, 1.2, -2.4)
      .oval(11, 7, 0.4, '#4aa3c7', 0, 0, 10).oval(11.8, 7.8, 0.2, '#9a8f7a', 0, 0, 10, 0.92)
      .caja(1.4, 0.3, 8, '#7c5a3a', 6, 0.4, 9).arbol(-12, -4, 8).arbol(12, -8, 8);
    return { piezas: e.piezas, radio: 20, losa: [28, 26] };
  }
  // mirador: torre de madera con cabina cubierta, para cascadas, cuevas, rutas y atractivos naturales
  e.cil(0.3, 0.3, 11, '#7c5a3a', -3, 0, -3, 6).cil(0.3, 0.3, 11, '#7c5a3a', 3, 0, -3, 6).cil(0.3, 0.3, 11, '#7c5a3a', -3, 0, 3, 6).cil(0.3, 0.3, 11, '#7c5a3a', 3, 0, 3, 6)
    .caja(6.6, 0.4, 0.3, '#7c5a3a', 0, 3, 3).caja(6.6, 0.4, 0.3, '#7c5a3a', 0, 3, -3).caja(0.3, 0.4, 6.6, '#7c5a3a', 3, 3, 0).caja(0.3, 0.4, 6.6, '#7c5a3a', -3, 3, 0)
    .caja(7.6, 0.5, 7.6, '#a9763f', 0, 10.5, 0)
    .caja(7.6, 1, 0.2, '#a9763f', 0, 11, 3.7).caja(7.6, 1, 0.2, '#a9763f', 0, 11, -3.7).caja(0.2, 1, 7.6, '#a9763f', 3.7, 11, 0).caja(0.2, 1, 7.6, '#a9763f', -3.7, 11, 0)
    .cuatroAguas(9.6, 3.2, 9.6, VERDE, 0, 14.2, 0)
    .caja(7, 0.4, 1.4, '#a9763f', 0, 5, 4.6).mastil(5, 4.2, -4.2, VERDE).arbol(-9, 6, 9).arbol(9, 4, 8)
    .monticulo(8, 2.4, '#7a8b5a', 0, 0, 0);
  return { piezas: e.piezas, radio: 14 };
}

/**
 * Catedral Nuestra Señora del Rosario de Girardota, a la medida de su huella en el catastro (24 × 59 m). La fachada, con las gradas del
 * atrio, da hacia −z (el parque principal); la torre del reloj, con su remate verde de cobre, queda en el extremo +x de la fachada.
 */
function catedral(e: Ensamble): Modelo {
  const ladrillo = '#b0654a', claro = '#e3d3b4', oscuro = '#3b2a1f', cobre = '#6aa38f';
  const disco = (r: number, color: string, x: number, y: number, z: number) =>
    e.piezas.push({ g: new THREE.CylinderGeometry(r, r, 0.3, 18).rotateX(Math.PI / 2).translate(x, y, z), color });
  // nave central con naves laterales más bajas, techos de teja
  e.caja(15, 13, 52, ladrillo, 0, 0, 3.5).dosAguas(16.6, 6.2, 52, TEJA, 0, 13, 3.5);
  for (const s of [-1, 1]) {
    e.caja(4.6, 8, 52, ladrillo, s * 9.9, 0, 3.5).dosAguas(5, 1.8, 52, TEJA, s * 9.9, 8, 3.5);
    for (let k = 0; k < 6; k++) e.caja(0.3, 3.4, 1.4, oscuro, s * 12.25, 2.6, -14 + k * 8);
  }
  // cuerpo de la fachada con su frontón y cornisa
  e.caja(24.4, 16, 6, ladrillo, 0, 0, -25.5).dosAguas(24.4, 6, 6, ladrillo, 0, 16, -25.5).caja(25.2, 0.5, 6.8, claro, 0, 15.6, -25.5);
  disco(1.5, claro, -4.2, 17.6, -28.55);
  disco(1.1, oscuro, -4.2, 17.6, -28.6);
  // dos portadas en arco, la de la derecha bajo la torre
  for (const x of [-4.2, 7.4]) {
    e.caja(3.8, 5.4, 0.4, claro, x, 0, -28.5).caja(2.8, 5, 0.5, oscuro, x, 0, -28.6);
    disco(1.9, claro, x, 5.4, -28.5);
    disco(1.4, oscuro, x, 5.4, -28.6);
  }
  // torre del reloj: fuste, cornisa, campanario con arcos, pirámide verde y cruz
  e.caja(9.2, 31, 9.2, ladrillo, 7.4, 0, -25).caja(9.8, 0.6, 9.8, claro, 7.4, 22, -25)
    .caja(8, 7, 8, ladrillo, 7.4, 31, -25).caja(8.8, 0.5, 8.8, claro, 7.4, 38, -25)
    .cuatroAguas(9.6, 10, 9.6, cobre, 7.4, 38.5, -25)
    .cil(0.2, 0.2, 3, '#d4d4d8', 7.4, 48.5, -25, 6).caja(1.6, 0.3, 0.3, '#d4d4d8', 7.4, 50.3, -25);
  for (const x of [5.7, 9.1]) e.caja(1.5, 4, 0.3, oscuro, x, 31.8, -29.05);
  e.caja(0.3, 4, 1.5, oscuro, 11.95, 31.8, -25).caja(0.3, 4, 1.5, oscuro, 2.85, 31.8, -25)
    .caja(1.4, 3.6, 0.3, oscuro, 7.4, 11, -29.65).caja(1.4, 3.6, 0.3, oscuro, 7.4, 16.5, -29.65);
  disco(1.7, '#f5f5f4', 7.4, 26.5, -29.65);
  // gradas del atrio, que bajan hasta la plaza
  for (let k = 0; k < 4; k++) e.caja(30, 3 - 0.25 * k - 0.15, 1, '#c8b99c', 0, -3, -30.2 - k);
  return { piezas: e.piezas, radio: 34, losa: [26, 62], huella: [26, 62] };
}

/**
 * Centro comercial de la manzana del parque: un volumen de dos pisos con cubierta plana blanca y antepecho, vitrinas corridas en la planta baja,
 * franja de ventanas arriba, marquesina de acceso sobre la carrera (−z), aviso, y equipos de aire y escalera en la azotea.
 */
function centroComercial(e: Ensamble, [W, D]: [number, number]): Modelo {
  const MURO = '#e9e6df', ANTEPECHO = '#f5f5f4', OSCURO = '#2b2f36';
  e.caja(W, 0.2, D, '#b9bcc0', 0, 0, 0);
  e.caja(W - 2, 13, D - 2, MURO, 0, 0.2, 0);                                                  // dos pisos (exagerados como el resto de edificios)
  e.caja(W - 1.2, 0.9, D - 1.2, ANTEPECHO, 0, 13.2, 0);                                       // cubierta plana blanca con antepecho
  e.caja(W - 4, 0.15, D - 4, '#fafafa', 0, 14.1, 0);
  for (let k = 0; k < 8; k++) {                                                               // vitrinas de la planta baja y ventanas del segundo piso
    const x = -W / 2 + 4 + k * ((W - 8) / 7);
    e.caja(4, 4.2, 0.3, VIDRIO, x, 0.8, -D / 2 + 0.05).caja(4, 3.2, 0.3, VIDRIO, x, 7.6, -D / 2 + 0.05);
    e.caja(4.4, 0.7, 0.9, ['#dc2626', '#2563eb', '#f59e0b', '#16a34a'][k % 4], x, 5.2, -D / 2 - 0.3);   // rótulos de los locales
  }
  for (let k = 0; k < 5; k++) e.caja(0.3, 3.2, 4, VIDRIO, W / 2 - 0.9, 7.6, -D / 2 + 5 + k * 6);
  e.caja(10, 0.5, 4.5, OSCURO, 0, 5.8, -D / 2 - 2.2);                                         // marquesina de acceso
  for (const x of [-4.4, 4.4]) e.cil(0.25, 0.25, 5.6, '#6b7280', x, 0.2, -D / 2 - 4, 6);
  e.caja(14, 2.2, 0.5, '#2563eb', 0, 15.2, -D / 2 + 1.2);                                     // aviso en la azotea
  e.caja(5, 2.4, 4, '#cbd5e1', -W / 4, 14.2, 4).caja(4, 2, 3, '#cbd5e1', W / 4, 14.2, -3).caja(3, 3.2, 3, MURO, W / 2 - 5, 14.2, D / 2 - 5);   // aire acondicionado y salida de escalera
  return { piezas: e.piezas, radio: Math.max(W, D) / 2, losa: [W, D], huella: [W, D] };
}

/**
 * Parqueadero público a cielo abierto (el Santa Ana de la carrera 16): lote asfaltado con bahías en dos hileras a los lados de un pasillo
 * central, autos estacionados a la escala de los del tráfico, portón con cerca amarilla y negra y aviso amarillo sobre la carrera 16 (−z).
 */
function parqueaderoPublico(e: Ensamble, [W, D]: [number, number], rnd: () => number): Modelo {
  const COLORES = ['#e5e7eb', '#9ca3af', '#1f2937', '#b91c1c', '#1d4ed8', '#f1f5f9', '#6b7280', '#a16207'];
  e.caja(W, 0.12, D, '#5f656d', 0, 0, 0);
  const L = 4.5 * ESCALA_ACTIVOS, A = 1.9 * ESCALA_ACTIVOS;
  const auto = (x: number, z: number, color: string, giro: number): void => {
    const c = (lx: number, ly: number, lz: number, w: number, h: number, d: number, col: string): void => {
      const gx = x + lx * Math.cos(giro) + lz * Math.sin(giro), gz = z - lx * Math.sin(giro) + lz * Math.cos(giro);
      e.piezas.push({ g: new THREE.BoxGeometry(w, h, d).rotateY(giro).translate(gx, ly + h / 2, gz), color: col });
    };
    c(0, 0.5, 0, L, 1.6, A, color);
    c(-0.4, 2.1, 0, L * 0.5, 1.4, A * 0.92, VIDRIO);
    c(-0.4, 3.5, 0, L * 0.46, 0.15, A * 0.9, color);
  };
  const filas = [-D / 2 + 9, D / 2 - 9], porFila = Math.floor((W - 8) / (A + 0.9));
  for (const z of filas) for (let k = 0; k < porFila; k++) {
    const x = -W / 2 + 5 + k * (A + 0.9);
    e.caja(0.2, 0.15, L + 0.6, '#e5e7eb', x + (A + 0.9) / 2, 0.12, z);
    if (rnd() < 0.66) auto(x, z, COLORES[Math.floor(rnd() * COLORES.length)], Math.PI / 2 + (rnd() - 0.5) * 0.06);
  }
  for (let k = 0; k < 6; k++) if (rnd() < 0.7) auto(-W / 2 + 7 + k * 8, 0, COLORES[Math.floor(rnd() * COLORES.length)], rnd() < 0.5 ? 0 : Math.PI);
  for (let k = -3; k <= 3; k++) if (k) e.caja(0.5, 1.4, 0.5, k % 2 ? '#facc15' : '#1f2937', k * 3.6, 0.12, -D / 2 + 0.6);    // cerca amarilla y negra
  e.caja(0.6, 5.2, 0.6, '#facc15', -3.2, 0.12, -D / 2 + 0.4).caja(0.6, 5.2, 0.6, '#facc15', 3.2, 0.12, -D / 2 + 0.4);   // postes del portón
  e.caja(16, 3.4, 0.4, '#facc15', 0, 5.4, -D / 2 + 0.3).caja(13, 1.2, 0.5, '#1f2937', 0, 6.6, -D / 2 + 0.3);           // aviso
  e.caja(4, 3, 3, '#e5e7eb', W / 2 - 4, 0.12, -D / 2 + 4).caja(4.4, 0.3, 3.4, '#8b3a1f', W / 2 - 4, 3.12, -D / 2 + 4);   // caseta del cuidandero
  return { piezas: e.piezas, radio: Math.max(W, D) / 2, losa: [W, D], huella: [W, D] };
}

/** Colores de la carrocería de los camperos veredales (el rojo con techo blanco es el de las rutas de Girardota). */
export const COLORES_RURALES = ['#b91c1c', '#b91c1c', '#b91c1c', '#1d4ed8', '#15803d', '#c2410c', '#a16207'];

/**
 * Plaza de mercado de Girardota: la manzana entre la carrera 16, la calle 6 y la calle 5B (62 × 58 m). Ala blanca de locales de cubierta
 * plana a lo largo de la carrera 16 (−z), galpón central de lámina acanalada sobre columnas con los puestos abiertos, y el edificio
 * grande de cubierta gris hacia la calle 6 (+z, −x).
 */
function plazaMercado(e: Ensamble): Modelo {
  const W = 62, D = 58, GRIS = '#9aa3ad', BLANCO = '#e8ebee';
  e.caja(W, 0.2, D, '#b8bcc2', 0, 0, 0);
  e.caja(W - 4, 8.5, 15, BLANCO, 0, 0.2, -D / 2 + 9).caja(W - 3.4, 0.6, 15.6, '#cfd4d9', 0, 8.7, -D / 2 + 9);       // ala de locales sobre la carrera 16
  for (let k = 0; k < 7; k++) e.caja(5.6, 3.4, 0.3, VIDRIO, -24 + k * 8, 1.2, -D / 2 + 1.4).caja(5.8, 0.5, 1.6, ['#dc2626', '#f59e0b', '#16a34a', '#2563eb'][k % 4], -24 + k * 8, 4.8, -D / 2 + 1.9);
  e.caja(25, 11, 26, '#c7ccd2', -17, 0.2, 14).caja(25.6, 0.7, 26.6, '#aeb4bb', -17, 11.2, 14);                       // edificio grande de cubierta gris
  e.caja(0.3, 3, 20, VIDRIO, -4.3, 2, 14).caja(8, 2.2, 0.3, '#2b2f36', -17, 0.2, 27.2);
  const px = 16, pz = 6;                                                                                            // galpón central abierto
  for (const x of [-12, -4, 4, 12]) for (const z of [-9, 9]) e.cil(0.28, 0.28, 5.6, '#6b7280', px + x, 0.2, pz + z, 6);
  e.dosAguas(31, 3.6, 22, GRIS, px, 5.6, pz, Math.PI / 2);
  ['#dc2626', '#f59e0b', '#16a34a', '#2563eb', '#dc2626', '#f59e0b', '#16a34a', '#2563eb'].forEach((c, k) => {      // puestos con toldo
    const x = px - 11 + (k % 4) * 7.4, z = pz - 5 + Math.floor(k / 4) * 10;
    e.caja(5.4, 1.1, 2.2, '#e5e7eb', x, 0.2, z).caja(5.8, 0.2, 2.8, c, x, 2.7, z);
  });
  e.caja(14, 0.8, 0.4, '#fff', -17, 12.3, 27).caja(2.4, 1.2, 8, '#f1f5f9', 26, 0.2, -4);
  return { piezas: e.piezas, radio: 36, losa: [W, D], huella: [W, D] };
}

/** Un campero veredal estacionado (caja simplificada del FJ): carrocería de color, techo blanco, vidrios y parrilla de techo. Mira hacia +x. */
function jeepVeredal(e: Ensamble, x: number, z: number, color: string, giro = 0): void {
  const c = Math.cos(giro), s = Math.sin(giro);
  const r = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const pieza = (w: number, h: number, d: number, col: string, lx: number, y: number, lz: number): void => {
    const [wx, wz] = r(lx, lz);
    const g = new THREE.BoxGeometry(w, h, d).rotateY(giro).translate(wx, y + h / 2, wz);
    e.piezas.push({ g, color: col });
  };
  pieza(7.5, 1.8, 3.2, color, 0, 0.7, 0);
  pieza(2.4, 0.3, 3.2, color, 2.6, 2.5, 0);
  pieza(5.2, 1.7, 3.0, VIDRIO, -0.8, 2.5, 0);
  pieza(5.8, 0.25, 3.2, '#f1f5f9', -0.8, 4.2, 0);
  pieza(0.2, 0.9, 2.6, '#2b2f36', 3.8, 1.0, 0);
  for (const dx of [-2.4, 2.4]) for (const dz of [-1.6, 1.6]) pieza(1.0, 1.0, 0.4, '#1f2328', dx, 0, dz);
}

/**
 * Central de transporte veredal: lote pavimentado con bahías pintadas, cubierta metálica con taquilla y camperos de ruta en fila
 * (rojos con techo blanco y otros colores), más algún bus de línea. Los camperos de la simulación salen de aquí hacia las veredas.
 */
function centralVeredal(e: Ensamble, [W, D]: [number, number], rnd: () => number): Modelo {
  e.caja(W, 0.15, D, '#6b7078', 0, 0, 0);
  e.caja(W - 3, 0.2, 0.25, '#e5e7eb', 0, 0.15, -D / 2 + 1.6).caja(W - 3, 0.2, 0.25, '#e5e7eb', 0, 0.15, D / 2 - 1.6);
  const filas = D > 40 ? 3 : 2, porFila = Math.floor((W - 12) / 8.6);
  for (let f = 0; f < filas; f++) for (let k = 0; k < porFila; k++) {
    const x = -W / 2 + 8 + k * 8.6, z = -D / 2 + 7 + f * ((D - 18) / Math.max(1, filas - 1)) + (filas === 2 ? f * 2 : 0);
    e.caja(0.2, 0.2, 4.4, '#e5e7eb', x + 4.3, 0.15, z);
    if (rnd() < 0.78) jeepVeredal(e, x, z, COLORES_RURALES[Math.floor(rnd() * COLORES_RURALES.length)], Math.PI / 2 * (f % 2 ? 1 : -1) + (rnd() - 0.5) * 0.08);
  }
  e.caja(W - 14, 0.3, 6, '#2563eb', 0, 5.2, D / 2 - 5);                                   // cubierta metálica de la zona de espera
  for (const x of [-(W - 18) / 2, 0, (W - 18) / 2]) e.cil(0.2, 0.2, 5, '#6b7280', x, 0.15, D / 2 - 7.6, 6).cil(0.2, 0.2, 5, '#6b7280', x, 0.15, D / 2 - 2.4, 6);
  e.caja(4, 2.6, 3, '#f1f5f9', -W / 2 + 5, 0.15, D / 2 - 5).caja(4.4, 0.25, 3.4, '#b91c1c', -W / 2 + 5, 2.75, D / 2 - 5);   // taquilla
  e.caja(5, 0.5, 1.2, '#7c5a3a', 2, 0.15, D / 2 - 4).caja(5, 0.5, 1.2, '#7c5a3a', -6, 0.15, D / 2 - 4);
  return { piezas: e.piezas, radio: Math.max(W, D) / 2, losa: [W, D], huella: [W, D] };
}

/**
 * Parque principal de Girardota: la manzana entera entre las calles 6 y 7 y las carreras 16 y 15 (75 × 77 m). Jardín arbolado hacia la
 * calle 7 y el lado noroeste (−z), plaza adoquinada con palmas y fuente hacia la carrera 15 (+z), y dentro de ella los toldos del
 * mercado agroverde, el kiosco del café y la cubierta del costado este.
 */
function parquePrincipal(e: Ensamble, rnd: () => number): Modelo {
  const W = 75, D = 77.5, camino = '#d3c5aa';
  const copas = ['#2f7d3a', '#3f8f45', '#256b34', '#4b9a4a'];
  e.caja(W, 0.15, D, '#c4b49a', 0, 0, 0);
  e.caja(44, 0.3, 54, '#5d9648', -14.5, 0.1, -10.5);                       // jardín
  e.caja(2.8, 0.4, 54, camino, -14.5, 0.1, -10.5).caja(44, 0.4, 2.8, camino, -14.5, 0.1, -10.5);
  for (let k = 0; k < 40; k++) {                                           // arbolado del jardín
    const x = -35.5 + rnd() * 42, z = -36.5 + rnd() * 52;
    if (Math.abs(x + 14.5) < 2.6 || Math.abs(z + 10.5) < 2.6) continue;
    const h = 9 + rnd() * 6;
    e.cil(0.3, 0.45, h * 0.6, '#6b4423', x, 0, z, 6);
    e.piezas.push({ g: new THREE.SphereGeometry(h * 0.34, 8, 6).scale(1, 0.85, 1).translate(x, h * 0.72, z), color: copas[Math.floor(rnd() * copas.length)] });
  }
  for (const x of [6, 13, 20, 27, 34]) e.cil(0.25, 0.35, 9, '#8a7355', x, 0, 20, 6).cono(3, 1.6, '#3a8f3f', x, 8.6, 20, 7);   // palmas
  e.cil(3.2, 3.4, 0.7, '#9ca3af', 20, 0.15, 6, 16).cil(2.6, 2.6, 0.4, '#7fc4e3', 20, 0.85, 6, 16).cil(0.4, 0.4, 2.4, '#cbd5e1', 20, 0.85, 6, 8);
  e.caja(11, 3.4, 7, '#e8dcc3', 22, 0, -31).caja(12.4, 0.4, 8.4, '#8b3a1f', 22, 3.4, -31);        // kiosco del café y el turismo
  ['#dc2626', '#f59e0b', '#16a34a', '#2563eb', '#dc2626', '#f59e0b'].forEach((c, k) => {          // toldos del mercado agroverde
    const x = 6 + k * 5.2, z = 28;
    e.caja(3.8, 0.25, 3, c, x, 2.9, z).caja(3.2, 1.1, 1.2, '#e5e7eb', x, 0.15, z + 0.4)
      .cil(0.08, 0.08, 2.8, '#6b7280', x - 1.7, 0.15, z - 1.3, 5).cil(0.08, 0.08, 2.8, '#6b7280', x + 1.7, 0.15, z - 1.3, 5);
  });
  for (const x of [-4, 4]) for (const z of [-4, 4]) e.cil(0.25, 0.25, 4.4, '#6b7280', 31 + x * 1.4, 0.15, 6 + z * 1.4, 6);   // cubierta metálica del costado este
  e.caja(10, 0.35, 8, '#64748b', 31, 4.5, 6);
  for (const [x, z] of [[-14.5, -20], [-14.5, 0], [5, -10.5], [-25, -10.5], [20, 14], [34, 6]]) e.caja(2.2, 0.5, 0.7, '#7c5a3a', x, 0.15, z).caja(2.2, 0.5, 0.15, '#7c5a3a', x, 0.65, z - 0.3);
  for (const [x, z] of [[-14.5, -10.5], [0, 0], [20, 0], [20, 22], [-14.5, 12], [-30, -10.5], [36, 20]]) e.cil(0.12, 0.12, 4.5, '#374151', x, 0.15, z, 5).caja(0.5, 0.35, 0.5, '#fde68a', x, 4.6, z);
  e.caja(0.9, 0.8, 70, '#9c8a6e', -36.8, 0.15, 0);                         // jardinera de piedra sobre la calle 7
  return { piezas: e.piezas, radio: 32, losa: [W, D], huella: [W, D] };
}

/** Escenarios deportivos: cancha de fútbol con graderías, placa cubierta con cubierta en arco, pista de patinaje o de bicrós. */
function deporte(e: Ensamble, tipo: string): Modelo {
  const linea = '#f5f5f4';
  if (/coliseo/.test(tipo)) {
    // coliseo cubierto: caja con zócalo y franja azul, cubierta metálica en arco con testeros, acceso con pórtico y ventanería
    const w = 54, d = 34, h = 9, r = d / 2 + 1, alto = r * 0.5;
    e.caja(w + 8, 0.3, d + 10, '#9aa0a6', 0, 0, 0).caja(w, h, d, '#d9dde1', 0, 0.3, 0).caja(w + 0.4, 1.2, d + 0.4, '#6b7280', 0, 0.3, 0)
      .caja(w + 0.2, 1, d + 0.2, '#1f6f8b', 0, h - 1.4, 0);
    const arco = new THREE.CylinderGeometry(r, r, w + 2, 20, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI / 2);
    arco.scale(1, 0.5, 1).translate(0, h + 0.3, 0);
    e.piezas.push({ g: arco, color: '#8e99a4' });
    for (const s of [-1, 1]) {
      const testero = new THREE.Shape();
      testero.absellipse(0, 0, r, alto, 0, Math.PI, false, 0);
      e.piezas.push({ g: new THREE.ExtrudeGeometry(testero, { depth: 0.4, bevelEnabled: false }).translate(0, 0, -0.2).rotateY(Math.PI / 2).translate(s * (w / 2 + 1), h + 0.3, 0), color: '#cfd5da' });
      e.caja(0.3, 4.5, d - 8, VIDRIO, s * (w / 2 + 0.1), 2.6, 0);
    }
    e.caja(w - 10, 1.8, 0.3, VIDRIO, 0, 3.4, d / 2 + 0.1).caja(w - 10, 1.8, 0.3, VIDRIO, 0, 3.4, -d / 2 - 0.1)
      .caja(14, 6, 4, '#e5e7eb', 0, 0.3, d / 2 + 2).caja(15, 0.5, 5, '#1f6f8b', 0, 6.3, d / 2 + 2.2).caja(8, 3.6, 0.3, '#2b4c5c', 0, 0.3, d / 2 + 4.1)
      .arbol(-w / 2 - 2, d / 2 + 5, 8).arbol(w / 2 + 2, d / 2 + 5, 8);
    return { piezas: e.piezas, radio: 38, losa: [w + 8, d + 10] };
  }
  if (/f[uú]tbol|sint[eé]tica/.test(tipo)) {
    const est = /engramada/.test(tipo), w = est ? 88 : 62, d = est ? 46 : 38;
    e.caja(w + 6, 0.3, d + 6, '#9aa0a6', 0, 0, 0).caja(w, 0.2, d, /sint/.test(tipo) ? '#2f9a4a' : '#4d9a3a', 0, 0.3, 0)
      .caja(w, 0.05, 0.4, linea, 0, 0.5, d / 2 - 0.2).caja(w, 0.05, 0.4, linea, 0, 0.5, -d / 2 + 0.2)
      .caja(0.4, 0.05, d, linea, w / 2 - 0.2, 0.5, 0).caja(0.4, 0.05, d, linea, -w / 2 + 0.2, 0.5, 0)
      .caja(0.3, 0.05, d, linea, 0, 0.5, 0).oval(4.5, 4.5, 0.05, linea, 0, 0.5, 0, 0.9)
      .caja(0.3, 0.05, 11, linea, w / 2 - 3, 0.5, 0).caja(0.3, 0.05, 11, linea, -w / 2 + 3, 0.5, 0);
    for (const s of [-1, 1]) {
      const x = s * (w / 2);
      e.caja(0.3, 2.4, 0.3, linea, x, 0.5, -3.7).caja(0.3, 2.4, 0.3, linea, x, 0.5, 3.7).caja(0.3, 0.3, 7.7, linea, x, 2.6, 0);
    }
    if (/engramada/.test(tipo)) {
      // estadio: graderío de 6 filas a lo largo del costado, con cubierta azul sobre columnas
      for (let k = 0; k < 6; k++) e.caja(w - 4, 0.9, 1.7, k % 2 ? '#d4d4d8' : '#a8afb7', 0, 0.3 + k * 0.9, -d / 2 - 3 - k * 1.7);
      e.caja(w - 2, 0.35, 11, '#2563eb', 0, 7.4, -d / 2 - 8);
      for (const x of [-w / 2 + 2, -w / 4, 0, w / 4, w / 2 - 2]) e.caja(0.4, 7.1, 0.4, '#6b7280', x, 0.3, -d / 2 - 12.5);
      return { piezas: e.piezas, radio: 40, losa: [w + 8, d + 24] };
    }
    for (let k = 0; k < 3; k++) e.caja(40, 0.7, 1.6, '#9ca3af', 0, 0.3 + k * 0.7, -d / 2 - 3 - k * 1.6);
    e.caja(42, 0.25, 6, LIMA, 0, 4.2, -d / 2 - 5.6).caja(0.3, 3.9, 0.3, '#6b7280', -19, 0.3, -d / 2 - 8).caja(0.3, 3.9, 0.3, '#6b7280', 19, 0.3, -d / 2 - 8);
    return { piezas: e.piezas, radio: 40, losa: [w + 8, d + 20] };
  }
  if (/polideportiva|placa/.test(tipo)) {
    e.caja(32, 0.3, 20, '#9aa0a6', 0, 0, 0).caja(28, 0.2, 16, '#3b6ea8', 0, 0.3, 0)
      .caja(0.3, 0.05, 16, linea, 0, 0.5, 0).caja(28, 0.05, 0.3, linea, 0, 0.5, 8).caja(28, 0.05, 0.3, linea, 0, 0.5, -8)
      .caja(0.3, 0.05, 16, linea, 14, 0.5, 0).caja(0.3, 0.05, 16, linea, -14, 0.5, 0).oval(3, 3, 0.05, linea, 0, 0.5, 0, 0.9);
    for (const s of [-1, 1]) e.caja(0.3, 3, 0.3, '#6b7280', s * 13.6, 0.5, 0).caja(0.3, 0.3, 2.4, '#e5e7eb', s * 13.6, 3.2, 0);
    for (const x of [-14, 0, 14]) for (const z of [-9, 9]) e.cil(0.3, 0.3, 6.5, '#6b7280', x, 0.3, z, 6);
    const arco = new THREE.CylinderGeometry(11, 11, 31, 18, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI / 2);
    arco.scale(1, 0.38, 1).translate(0, 6.8, 0);
    e.piezas.push({ g: arco, color: '#cbd5e1' });
    e.caja(32, 0.3, 0.3, '#6b7280', 0, 6.7, 9).caja(32, 0.3, 0.3, '#6b7280', 0, 6.7, -9)
      .caja(26, 0.7, 1.4, '#9ca3af', 0, 0.3, -11.5).arbol(-16, 12, 8);
    return { piezas: e.piezas, radio: 22, losa: [34, 24] };
  }
  if (/patinaje/.test(tipo)) {
    e.oval(22, 13, 0.3, '#9aa0a6', 0, 0, 0).oval(19.5, 10.5, 0.1, '#d4d4d8', 0, 0.3, 0, 0.58).oval(8, 4.2, 0.2, '#4d9a3a', 0, 0.3, 0)
      .oval(19.6, 10.6, 1, '#e5e7eb', 0, 0.3, 0, 0.97).oval(8.3, 4.5, 0.6, '#e5e7eb', 0, 0.3, 0, 0.96)
      .caja(10, 2.6, 5, '#e5e7eb', 0, 0, -18).caja(10.6, 0.4, 5.6, LIMA, 0, 2.6, -18)
      .arbol(-20, 14, 7).arbol(20, 14, 7);
    return { piezas: e.piezas, radio: 26, losa: [48, 36] };
  }
  if (/piscina/.test(tipo)) {
    // piscina con borde, carriles, escaleras, piscina infantil, sillas de sol y una cubierta con sombra
    const w = 46, d = 24, AGUA = '#38bdf8', BORDE = '#f1f5f9';
    e.caja(w + 18, 0.3, d + 20, '#d9d3c4', 0, 0, 0)
      .caja(w + 3, 0.8, 1.5, BORDE, 0, 0.3, d / 2 + 0.75).caja(w + 3, 0.8, 1.5, BORDE, 0, 0.3, -d / 2 - 0.75)
      .caja(1.5, 0.8, d, BORDE, w / 2 + 0.75, 0.3, 0).caja(1.5, 0.8, d, BORDE, -w / 2 - 0.75, 0.3, 0)
      .caja(w, 0.65, d, AGUA, 0, 0.3, 0);
    for (let k = -2; k <= 2; k++) e.caja(w - 4, 0.05, 0.3, '#1d4ed8', 0, 0.96, k * 4.4);
    for (const s of [-1, 1]) e.cil(0.25, 0.25, 2, '#c5cbd1', s * (w / 2 - 3), 0.3, d / 2 + 0.2, 6).cil(0.25, 0.25, 2, '#c5cbd1', s * (w / 2 - 6), 0.3, d / 2 + 0.2, 6);
    e.caja(0.3, 0.05, d, '#e5e7eb', -w / 2 + 2, 0.96, 0)                                      // línea de la zona de salida
      .caja(16, 0.8, 12, BORDE, w / 2 + 18, 0.3, -4).caja(14, 0.9, 10, '#67e8f9', w / 2 + 18, 0.3, -4);  // piscina infantil
    for (let k = 0; k < 6; k++) e.caja(2.2, 0.7, 5, '#fef3c7', -w / 2 + 4 + k * 4, 0.3, d / 2 + 6.5).caja(2.2, 1.3, 1, '#fef3c7', -w / 2 + 4 + k * 4, 0.8, d / 2 + 9);
    for (const x of [-12, 12]) for (const z of [-d / 2 - 7, -d / 2 - 12]) e.cil(0.3, 0.3, 6, '#6b7280', x, 0.3, z, 6);
    e.caja(28, 0.3, 7.5, '#ef4444', 0, 6.2, -d / 2 - 9.5).arbol(-w / 2 - 6, -d / 2 - 6, 8).arbol(w / 2 + 6, d / 2 + 8, 8);
    return { piezas: e.piezas, radio: 40, losa: [w + 22, d + 22] };
  }
  // bicrós: óvalo de tierra con una fila de lomos y rampa de partida
  e.oval(28, 16, 0.3, '#9aa0a6', 0, 0, 0).oval(24, 12, 0.25, '#a8774a', 0, 0.3, 0, 0.62);
  for (let k = 0; k < 7; k++) e.monticulo(2.8, 1.6, '#8a5f36', -16 + k * 5.4, 0.3, -10);
  for (let k = 0; k < 5; k++) e.monticulo(2.6, 1.4, '#8a5f36', 14 - k * 5.4, 0.3, 10);
  e.caja(8, 3.4, 5, '#6b7280', -22, 0.3, 0).caja(8.4, 0.3, 5.4, LIMA, -22, 3.7, 0).caja(0.3, 1.6, 12, '#c4342d', -26, 0.3, 0)
    .caja(18, 0.5, 5, '#9ca3af', 0, 0.3, 19).arbol(-24, 14, 7);
  return { piezas: e.piezas, radio: 32, losa: [60, 38] };
}

/** Estación de policía (bloque con franja verde, torre de comunicaciones y patio de vehículos) o personería (edificio cívico con columnas). */
function justicia(e: Ensamble, tipo: string): Modelo {
  if (/polic/.test(tipo)) {
    e.caja(24, 7, 12, '#e8eaed', 0, 0, -4)
      .caja(24.4, 1.4, 12.4, '#1b5e3b', 0, 4.6, -4)
      .caja(25, 0.7, 13, '#6b7280', 0, 7, -4)
      .ventanas(18, 1.5, VIDRIO, 0, 1.4, 2).ventanas(18, 1.5, VIDRIO, 0, 1.4, -10, true)
      .caja(3, 3.2, 0.3, '#1e3a5f', 8, 0, 2.1).caja(8, 0.5, 4, '#1b5e3b', 8, 3.8, 4)
      .caja(0.4, 3.8, 0.4, '#e5e7eb', 4.4, 0, 5.6).caja(0.4, 3.8, 0.4, '#e5e7eb', 11.6, 0, 5.6)
      .caja(6, 2.6, 6, '#e8eaed', -9, 7.7, -8).caja(6.6, 0.5, 6.6, '#1b5e3b', -9, 10.3, -8)
      .cil(0.2, 0.3, 14, '#9ca3af', -9, 10.8, -8, 6).caja(1.4, 0.6, 1.4, '#2563eb', -9, 24.8, -8)
      .caja(26, 0.2, 14, '#6b7280', 4, 0, 11).caja(5, 1.5, 2.2, '#f5f5f4', -6, 0.2, 11).caja(5, 1.5, 2.2, '#f5f5f4', 2, 0.2, 11)
      .caja(5, 0.35, 2.2, '#1b5e3b', -6, 1, 11).caja(5, 0.35, 2.2, '#1b5e3b', 2, 1, 11)
      .mastil(10, 17, 4, '#1b5e3b').arbol(-16, 8, 7);
    return { piezas: e.piezas, radio: 24, losa: [38, 28] };
  }
  e.caja(22, 8, 12, '#ece6da', 0, 0, -3)
    .caja(24, 0.9, 14, '#c9bda5', 0, 8, -3)
    .caja(22.4, 0.8, 12.4, ROJO, 0, 6.8, -3)
    .ventanas(18, 1.5, VIDRIO, 0, 1.6, 3).ventanas(18, 1.5, VIDRIO, 0, 4.6, 3)
    .caja(18, 0.6, 3.4, '#c9bda5', 0, 5.8, 5.2)
    .caja(18, 0.6, 3.6, '#e3d6bf', 0, 0, 5.2);
  for (let k = 0; k < 5; k++) e.cil(0.6, 0.7, 5.4, '#f5ecd9', -8 + k * 4, 0.6, 5.2, 12);
  e.caja(3.4, 3.6, 0.3, '#5b3a29', 0, 0.6, 3.1).mastil(11, 14, 8, ROJO).arbol(-16, 8, 7);
  return { piezas: e.piezas, radio: 22, losa: [32, 24] };
}

/**
 * Patrimonio: la estación del ferrocarril (edificio de andén con alero, reloj y vías), un yacimiento (foso y carpa),
 * un punto de hallazgo (mojón de piedras con estaca) o un sitio arqueológico (montículo con círculo de piedras).
 */
function patrimonio(e: Ensamble, tipo: string, rnd: () => number): Modelo {
  if (/inter[eé]s cultural/.test(tipo)) {
    e.caja(30, 6, 8, '#e0cfa5', 0, 0, -4)
      .cuatroAguas(34, 3, 12, TEJA, 0, 6, -4)
      .caja(8, 9, 8, '#e0cfa5', -10, 0, -4).cuatroAguas(9.6, 3, 9.6, TEJA, -10, 9, -4)
      .cil(1.2, 1.2, 0.3, '#f5f5f4', -10, 6.2, 0.1, 16)
      .caja(26, 0.4, 5, '#9a8f7a', 0, 0, 4.5).caja(26, 0.3, 5.4, CAFE, 0, 3.8, 5)
      .ventanas(3, 3.4, '#5b3a29', -6, 0.4, 0).ventanas(3, 3.4, '#5b3a29', 0, 0.4, 0).ventanas(3, 3.4, '#5b3a29', 6, 0.4, 0);
    for (const x of [-12, -4, 4, 12]) e.cil(0.25, 0.25, 3.4, '#374151', x, 0.4, 7, 6);
    e.caja(46, 0.12, 0.25, '#4b5563', 0, 0.5, 12).caja(46, 0.12, 0.25, '#4b5563', 0, 0.5, 13.5);
    for (let k = 0; k < 22; k++) e.caja(0.4, 0.15, 2.4, '#5b3a29', -22.5 + k * 2.1, 0.3, 12.75);
    e.arbol(18, -10, 8);
    return { piezas: e.piezas, radio: 30, losa: [50, 30] };
  }
  const piedra = ['#8d8a82', '#a09c92', '#7c7a74'];
  if (/hallazgo/.test(tipo)) {
    e.monticulo(3, 0.8, '#8a6a3f', 0, 0, 0);
    for (let k = 0; k < 5; k++) {
      const a = k * 1.26 + rnd() * 0.4;
      e.caja(0.8 + rnd() * 0.5, 0.6 + rnd() * 0.5, 0.7 + rnd() * 0.4, piedra[k % 3], Math.cos(a) * 1.8, 0, Math.sin(a) * 1.8, rnd() * 3);
    }
    e.cil(0.06, 0.06, 2.2, '#e5e7eb', 3.4, 0, 1.4, 5).caja(0.7, 0.45, 0.05, '#f97316', 3.7, 1.7, 1.4);
    return { piezas: e.piezas, radio: 6 };
  }
  if (/yacimiento/.test(tipo)) {
    e.caja(10, 0.25, 7, '#8a6a3f', 0, 0, 0).caja(8, 0.3, 5, '#5b4430', 0, 0.05, 0)
      .caja(0.2, 1, 7, '#c4a574', 5, 0, 0).caja(0.2, 1, 7, '#c4a574', -5, 0, 0).caja(10, 1, 0.2, '#c4a574', 0, 0, 3.5).caja(10, 1, 0.2, '#c4a574', 0, 0, -3.5)
      .dosAguas(5, 2.4, 6, '#e8e0cc', 11, 0, 0, Math.PI / 2).monticulo(3.4, 1.4, '#8a6a3f', -9, 0, 3);
    return { piezas: e.piezas, radio: 16 };
  }
  // sitio arqueológico: montículo central, círculo de piedras erguidas y un letrero
  e.monticulo(8, 2.6, '#8a6a3f', 0, 0, 0);
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = k * (Math.PI * 2 / n) + rnd() * 0.2, r = 10 + rnd() * 1.2;
    e.caja(0.9 + rnd() * 0.4, 1.8 + rnd() * 1.8, 0.7 + rnd() * 0.3, piedra[k % 3], Math.cos(a) * r, 0, Math.sin(a) * r, rnd() * 2);
  }
  e.caja(0.2, 1.6, 0.2, '#6b4423', 8, 0, 12).caja(2, 1.2, 0.15, CAFE, 8, 1.5, 12).arbol(-14, -8, 8);
  return { piezas: e.piezas, radio: 16 };
}

/** Lleva el modelo a `largoReal` × ESCALA_ACTIVOS de largo (eje x): los modelos se dibujaron a ojo, entre 3 y 5 veces más grandes que el vehículo real. */
function aEscalaReal(m: Modelo, largoReal: number): Modelo {
  const caja = new THREE.Box3();
  for (const p of m.piezas) { p.g.computeBoundingBox(); caja.union(p.g.boundingBox!); }
  const f = largoReal * ESCALA_ACTIVOS / (caja.max.x - caja.min.x);
  for (const p of m.piezas) p.g.scale(f, f, f);
  return { ...m, radio: m.radio * f };
}

/** El vehículo del catálogo según su nombre (el auto rojo es el de siempre), a la escala común de los activos. */
function vehiculo(e: Ensamble, t: string): Modelo {
  if (/moto/.test(t)) return aEscalaReal(moto(e), LARGO_REAL.moto);
  if (/taxi/.test(t)) return aEscalaReal(taxi(e), LARGO_REAL.taxi);
  if (/\bfj\b/.test(t)) return aEscalaReal(fj80(e), LARGO_REAL.campero);
  if (/\bbus\b/.test(t)) return aEscalaReal(bus(e), LARGO_REAL.bus);
  if (/cami[oó]n|tr[aá]iler/.test(t)) return aEscalaReal(camion(e), LARGO_REAL.camion);
  return aEscalaReal(auto(e), LARGO_REAL.auto);
}

/** El edificio que representa a un punto de interés según su categoría y su tipo de lugar. */
export function modelarEquipamiento(c: CategoriaCatalogo, tipo: string, nombre: string, rnd: () => number): Modelo {
  const e = new Ensamble();
  const t = `${tipo} ${nombre}`.toLowerCase();
  switch (c) {
    case 'servicios': return servicio(e, t);
    case 'industria': return /parque/.test(t) ? parqueIndustrial() : fabrica(e);
    case 'vivienda':
      if (tipo === 'Tipología') return tipologia(nombre, Math.floor(rnd() * 1e9));
      return /edificio/.test(t) ? edificioUrbano(e) : vivienda(e);
    case 'vehiculos': return /avi[oó]n/.test(t) ? { piezas: [], radio: 42 } : vehiculo(e, t);    // el avión es un modelo .glb que carga el catálogo
    case 'vias':
      for (const k of ['autopista', 'troncal', 'secundaria', 'mixta', 'afirmada', 'carreteable', 'restringida'] as const) if (t.includes(k)) return carretera(e, k);
      return /puente/.test(t) ? puente(e, /principal/.test(t) ? 34 : 13) : tramo(e, /principal/.test(t) ? 'principal' : /local/.test(t) ? 'local' : 'sendero');
    case 'agua': return tramo(e, /quebrada/.test(t) ? 'quebrada' : 'rio');
    case 'naturaleza':
      if (/p[aá]jaro|garza/.test(t)) return pajaro(e);
      if (/sam[aá]n/.test(t)) return arbolRegional(e, 'saman');
      if (/guayac/.test(t)) return arbolRegional(e, 'guayacan');
      if (/yarumo/.test(t)) return arbolRegional(e, 'yarumo');
      if (/ceiba/.test(t)) return arbolRegional(e, 'ceiba');
      return arbol(e);
    case 'gente': return persona(e, t);
    case 'educacion': return /i\. e\. colombia/.test(t) ? colegioUrbano(e, [68, 30]) : escuela(e, /rural/i.test(tipo));
    case 'cultura': return cultura(e, t);
    case 'salud': return /comfama/.test(t) ? sedeComfama(e) : salud(e, t);
    case 'turismo': return turismo(e, t, rnd);
    case 'deporte': return deporte(e, t);
    case 'justicia': return justicia(e, t);
    case 'patrimonio': return patrimonio(e, tipo.toLowerCase(), rnd);
  }
}

/**
 * Fábrica del inventario de emisiones, tal como se arma en el mapa (mapa3d.component, construirIndustrias): nave con techo en
 * diente de sierra, oficinas, portones, silos y chimenea con bandas rojas y blancas. Aquí con las medidas medias.
 */
function fabrica(e: Ensamble): Modelo {
  const largo = 56, fondo = 34, alto = 14.5;
  e.caja(largo, alto, fondo, '#d9d2c3', 0, 0, 0);
  const dientes = Math.max(3, Math.round(fondo / 9)), w = fondo / dientes, h = 6;
  for (let k = 0; k < dientes; k++) {
    const perfil = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(w, 0), new THREE.Vector2(w, h), new THREE.Vector2(0, h * 0.3)]);
    const g = new THREE.ExtrudeGeometry(perfil, { depth: largo, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-largo / 2, alto, fondo / 2 - k * w);
    e.piezas.push({ g, color: '#8e9aa4' });
    e.caja(largo - 3, h * 0.7, 0.5, '#8fc4e3', 0, alto + h * 0.15, fondo / 2 - (k + 1) * w - 0.2);
  }
  const of = { w: 18, h: alto + 6, d: 24 }, ox = largo / 2 + of.w / 2, oz = fondo / 2 - of.d / 2;
  e.caja(of.w, of.h, of.d, '#e9e5dc', ox, 0, oz).caja(of.w + 0.4, 5, of.d + 0.4, '#7fb7d6', ox, of.h - 8.5, oz)
    .caja(of.w + 1.6, 1.2, of.d + 1.6, '#6b7280', ox, of.h, oz);
  for (let k = 0; k < 3; k++) e.caja(8, 8, 0.7, '#4b5563', -largo / 2 + 10 + k * 14, 0, fondo / 2 + 0.4);
  for (let k = 0; k < 2; k++) {
    const sx = -largo / 2 + 8 + k * 11, sz = -fondo / 2 - 8, sh = 23;
    e.cil(4.2, 4.2, sh, '#cfd4d9', sx, 0, sz).cono(4.4, 4, '#9aa3ab', sx, sh, sz);
  }
  const ch = 70, cx = -largo / 2 - 7, cz = -fondo / 2 + 6, bandas = 6, seg = ch / bandas;
  for (let k = 0; k < bandas; k++) e.cil(4.4 - 2 * ((k + 1) / bandas), 4.4 - 2 * (k / bandas), seg, k % 2 ? '#d8d8d8' : '#c4342d', cx, seg * k, cz);
  e.cil(2.7, 2.4, 2, '#2b2f36', cx, ch, cz);
  return { piezas: e.piezas, radio: 52, losa: [largo + 14, fondo + 12] };
}

/** Medidas y colores de una unidad de parque industrial (bodega modular). */
export interface UnidadParque { largo: number; fondo: number; alto: number; pared: string; acento: string; ch: number; porteria?: boolean; }
/** Posición de la chimenea de una unidad de parque, en coordenadas locales. */
export const chimeneaParque = (u: Pick<UnidadParque, 'largo' | 'fondo'>) => ({ cx: -u.largo / 2 + 4, cz: -u.fondo / 2 - 1.5 });
const PAREDES_PARQUE = ['#e3e0d8', '#d9d2c3', '#cfd8de', '#e1e4e7'];
const ACENTOS_PARQUE = ['#c4342d', '#1f6f8b', '#e0a526', '#3f7d4e', '#6b4fa0'];
/** Pared y color de acento de una unidad de parque, por un número cualquiera (cada unidad lleva su color corporativo). */
export const colorParque = (n: number) => ({ pared: PAREDES_PARQUE[n % PAREDES_PARQUE.length], acento: ACENTOS_PARQUE[(n * 3 + 1) % ACENTOS_PARQUE.length] });

/**
 * Unidad de un parque industrial: bodega modular de lámina con cubierta a dos aguas, franja de color corporativo, portones
 * enrollables con muelle, franja de ventanas de oficina, chimenea corta, parqueadero con rayas, luminarias y árboles. Con
 * `porteria`, la unidad lleva además el pórtico de entrada del parque con garita y pluma. Centrada en el origen; la fachada
 * con portones da a +z. Es la misma pieza que usa el mapa 3D para las fábricas que comparten predio.
 */
export function unidadParque(u: UnidadParque): Modelo['piezas'] {
  const e = new Ensamble(), { largo, fondo, alto } = u, { cx, cz } = chimeneaParque(u);
  e.caja(largo, alto, fondo, u.pared, 0, 0, 0)
    .dosAguas(fondo + 1.2, 3.2, largo + 1.2, '#8a949e', 0, alto, 0, Math.PI / 2)
    .caja(largo + 0.4, 1.5, fondo + 0.4, u.acento, 0, alto - 2.4, 0);               // franja de color de la empresa
  const n = Math.max(3, Math.round(largo / 12)), w = largo / n;
  for (let k = 0; k < n; k++) {
    const x = -largo / 2 + w * (k + 0.5);
    e.caja(w * 0.62, 5.2, 0.5, '#cdd5da', x, 0, fondo / 2 + 0.2).caja(w * 0.7, 0.5, 0.6, '#4b5563', x, 5.2, fondo / 2 + 0.25)
      .caja(w * 0.7, 0.9, 2, '#9aa0a6', x, 0, fondo / 2 + 1.3);                     // portón y muelle de carga
  }
  e.caja(largo - 4, 1.8, 0.3, '#7fb7d6', 0, 6.4, fondo / 2 + 0.1);                  // oficinas sobre los portones
  e.cil(1.1, 1.3, u.ch, '#8d949b', cx, 0, cz, 10).cil(1.6, 1.6, 0.8, '#2b2f36', cx, u.ch, cz, 10);
  for (let k = 0; k < 6; k++) e.caja(0.35, 0.12, 4.2, '#f3f4f6', -largo / 2 + 3 + k * (largo - 6) / 5, 0.02, fondo / 2 + 6.5);
  for (const sx of [-1, 1]) {
    e.cil(0.25, 0.3, 9, '#4b5563', sx * (largo / 2 - 1), 0, fondo / 2 + 10, 6).caja(2.2, 0.35, 0.7, '#f5e6a8', sx * (largo / 2 - 1), 9, fondo / 2 + 10);
    e.arbol(sx * (largo / 2 + 3), fondo / 2 + 5, 6);
  }
  if (u.porteria) {
    const z = fondo / 2 + 11;
    for (const sx of [-1, 1]) e.caja(1.6, 7, 1.6, '#9aa0a6', sx * 7, 0, z);
    e.caja(16.4, 2.2, 1.4, '#1f4e79', 0, 7, z).caja(11, 0.6, 1.5, '#f3f4f6', 0, 7.8, z)
      .caja(6, 0.35, 0.35, '#c4342d', -3.6, 1.2, z).caja(3.6, 3, 3.6, '#e9e5dc', 10.5, 0, z).caja(4.6, 0.4, 4.6, '#6b7280', 10.5, 3, z);
  }
  return e.piezas;
}

/** Parque industrial del catálogo: tres bodegas modulares en hilera sobre una plataforma de asfalto, con su pórtico de entrada. */
function parqueIndustrial(): Modelo {
  const largo = 54, fondo = 32, paso = largo + 12, piezas: Modelo['piezas'] = [];
  [-1, 0, 1].forEach((k, i) => {
    const c = colorParque(i + 2);
    for (const p of unidadParque({ largo, fondo, alto: 11, pared: c.pared, acento: c.acento, ch: 28 + i * 4, porteria: k === 0 })) {
      p.g.translate(k * paso, 0, 0);
      piezas.push(p);
    }
  });
  return { piezas, radio: paso * 1.5, losa: [paso * 3 + 4, fondo + 24] };
}

/**
 * Vivienda típica de la región: muros de ladrillo de barro pegado con cemento sobre un zócalo de concreto, techo a dos aguas
 * de teja de barro en V (canales y cubiertas alternadas), puerta y ventanas de madera y alero amplio.
 */
function vivienda(e: Ensamble): Modelo {
  const ladrillo = '#b9603e', cemento = '#d6cbb8', madera = '#6b4a2f', paredes = 4.2;
  const ancho = 10, fondo = 8, vuelo = 0.8, subida = 3, medio = fondo / 2 + vuelo;
  // zócalo, muros y juntas de cemento (una losa fina por hilada, se ve en las cuatro caras)
  e.caja(ancho + 0.4, 0.5, fondo + 0.4, '#9ca3af', 0, 0, 0).caja(ancho, paredes, fondo, ladrillo, 0, 0.5, 0);
  for (let y = 0.95; y < paredes + 0.4; y += 0.45) e.caja(ancho + 0.06, 0.08, fondo + 0.06, cemento, 0, y, 0);
  // frontón de ladrillo en los extremos
  const alto = paredes + 0.5;
  for (const sx of [-1, 1]) e.dosAguas(fondo, subida - 0.5, 0.3, ladrillo, sx * (ancho / 2 + vuelo), alto, 0, Math.PI / 2);
  // techo: faldones de teja y cumbrera; las canales (claras) y las cubiertas (oscuras) forman las V
  e.dosAguas(medio * 2, subida, ancho + vuelo * 2, '#9e4527', 0, alto, 0, Math.PI / 2);
  const inclinado = Math.atan2(subida, medio), largo = Math.hypot(medio, subida);
  for (const lado of [-1, 1]) {
    for (let x = -ancho / 2 - vuelo + 0.3; x <= ancho / 2 + vuelo - 0.2; x += 0.55) {
      const g = new THREE.BoxGeometry(0.24, 0.16, largo).rotateX(lado * inclinado).translate(x, alto + subida / 2 + 0.1, lado * medio / 2);
      e.piezas.push({ g, color: '#c6683c' });
    }
  }
  e.caja(ancho + vuelo * 2 + 0.3, 0.3, 0.7, '#7a3520', 0, alto + subida - 0.1, 0);
  // fachada (+z): puerta y dos ventanas con marco de madera, escalón de cemento
  e.caja(1.5, 2.6, 0.35, madera, 0, 0.5, fondo / 2 + 0.05).caja(0.12, 0.2, 0.1, '#e5c04a', 0.5, 1.7, fondo / 2 + 0.28)
    .caja(2.6, 0.2, 1.1, '#b5b0a6', 0, 0, fondo / 2 + 0.5);
  for (const x of [-3, 3]) {
    e.caja(2, 1.6, 0.3, madera, x, 1.9, fondo / 2 + 0.05).ventanas(1.6, 1.2, VIDRIO, x, 2.1, fondo / 2 + 0.05)
      .caja(0.1, 1.2, 0.1, madera, x, 2.1, fondo / 2 + 0.3);
  }
  e.caja(2, 1.6, 0.3, madera, 0, 1.9, -fondo / 2 - 0.05).ventanas(1.6, 1.2, VIDRIO, 0, 2.1, -fondo / 2 - 0.05, true);
  return { piezas: e.piezas, radio: 8, losa: [13, 11] };
}

/**
 * Edificio del casco urbano: cinco pisos de concreto con fachada pintada y franjas de ladrillo, local comercial con vitrina y
 * toldo en la planta baja, balcones con baranda en cada piso, y terraza con tanque de agua y cuarto de máquinas.
 */
function edificioUrbano(e: Ensamble): Modelo {
  const ancho = 14, fondo = 12, piso = 3.2, pisos = 5, alto = piso * pisos;
  const pared = '#ece3d0', ladrillo = '#b9603e', concreto = '#a8aeb5', oscuro = '#374151';
  e.caja(ancho, alto, fondo, pared, 0, 0, 0)
    .caja(ancho + 0.4, 0.3, fondo + 0.4, concreto, 0, alto, 0)           // placa de cubierta
    .caja(ancho + 0.2, 0.9, 0.3, concreto, 0, alto + 0.3, fondo / 2).caja(ancho + 0.2, 0.9, 0.3, concreto, 0, alto + 0.3, -fondo / 2)
    .caja(0.3, 0.9, fondo, concreto, ancho / 2, alto + 0.3, 0).caja(0.3, 0.9, fondo, concreto, -ancho / 2, alto + 0.3, 0); // antepecho
  // columnas de ladrillo a vista en las esquinas de la fachada
  for (const x of [-ancho / 2, ancho / 2]) e.caja(1.2, alto, 1.2, ladrillo, x, 0, fondo / 2 - 0.2);
  // planta baja: local comercial con vitrina, puerta del portal y toldo
  e.caja(ancho - 3, 2.4, 0.3, VIDRIO, -0.8, 0.5, fondo / 2 + 0.05).caja(2.4, 2.8, 0.3, oscuro, 4.8, 0, fondo / 2 + 0.1)
    .caja(ancho - 3, 0.6, 2.2, '#c0392b', -0.8, 3, fondo / 2 + 1);
  // pisos altos: ventanas y balcones con baranda
  for (let k = 1; k < pisos; k++) {
    const y = piso * k;
    e.caja(ancho + 0.3, 0.25, 0.3, concreto, 0, y, fondo / 2)                // losa vista
      .caja(ancho - 4, 2, 0.3, VIDRIO, 0, y + 0.8, fondo / 2 + 0.05)
      .caja(ancho - 3, 0.2, 1.6, concreto, 0, y, fondo / 2 + 0.8).caja(ancho - 3, 1, 0.1, oscuro, 0, y + 0.2, fondo / 2 + 1.5)
      .ventanas(ancho - 4, 1.6, VIDRIO, 0, y + 1, -fondo / 2, true);
    for (const z of [-3, 3]) e.caja(0.3, 1.6, 2.2, VIDRIO, ancho / 2 + 0.05, y + 1, z).caja(0.3, 1.6, 2.2, VIDRIO, -ancho / 2 - 0.05, y + 1, z);
  }
  // terraza: tanque de agua y cuarto de máquinas
  e.cil(1.4, 1.4, 2.2, '#2f6f9f', -3.5, alto + 0.3, -2, 14).caja(0.3, 1.4, 0.3, concreto, -4.4, alto + 0.3, -2).caja(4, 2.6, 3.4, pared, 3, alto + 0.3, -2)
    .caja(4.4, 0.3, 3.8, concreto, 3, alto + 2.9, -2);
  return { piezas: e.piezas, radio: 12, losa: [18, 16] };
}

/** Rueda con el eje a lo largo de z: llanta oscura, rin claro y tapa central. `y` es el suelo. */
function rueda(e: Ensamble, r: number, ancho: number, x: number, y: number, z: number): void {
  const eje = (rad: number, a: number, color: string, dz = 0) =>
    e.piezas.push({ g: new THREE.CylinderGeometry(rad, rad, a, 18).rotateX(Math.PI / 2).translate(x, y + r, z + dz), color });
  eje(r, ancho, '#1f2328');
  eje(r * 0.6, ancho + 0.1, '#c5cbd1');
  eje(r * 0.22, ancho + 0.2, '#6b7280');
}

/** Auto del tráfico: carrocería de color (frente hacia +x), cabina con vidrios, techo gris claro, ruedas y luces. */
function auto(e: Ensamble, cuerpo = '#ff2d2d', techo = '#d3d8dd', taxi = false): Modelo {
  const ROJO = cuerpo, GRIS = techo, OSCURO = '#2b2f36';
  e.caja(15, 0.5, 6.2, OSCURO, 0, 0.6, 0)                                   // chasis
    .caja(15, 2.2, 6.5, ROJO, 0, 1.0, 0)                                    // carrocería baja
    .caja(4.2, 0.45, 6.2, ROJO, 5, 3.2, 0).caja(2.6, 0.45, 6.2, ROJO, -5.7, 3.2, 0) // capó y maletero
    .caja(0.6, 2.5, 5.7, ROJO, -1, 3.2, 0)                                  // pilar central
    .caja(5.8, 0.35, 5.9, GRIS, -1, 5.7, 0)                                 // techo
    .caja(0.7, 0.9, 6.6, OSCURO, 7.6, 0.8, 0).caja(0.7, 0.9, 6.6, OSCURO, -7.6, 0.8, 0) // parachoques
    .caja(0.2, 0.5, 1.4, '#fff3b0', 7.5, 2.4, 2.1).caja(0.2, 0.5, 1.4, '#fff3b0', 7.5, 2.4, -2.1) // faros
    .caja(0.2, 0.5, 1.4, '#b91c1c', -7.5, 2.4, 2.1).caja(0.2, 0.5, 1.4, '#b91c1c', -7.5, 2.4, -2.1) // luces traseras
    .caja(0.9, 0.3, 0.8, OSCURO, -1.5, 5.9, 0);                              // antena de aleta
  // cabina acristalada: perfil de lado con parabrisas y vidrio trasero inclinados, extruido a lo ancho
  const perfil = new THREE.Shape([new THREE.Vector2(3, 3.2), new THREE.Vector2(1.6, 5.7), new THREE.Vector2(-3.6, 5.7), new THREE.Vector2(-5, 3.2)]);
  e.piezas.push({ g: new THREE.ExtrudeGeometry(perfil, { depth: 5.6, bevelEnabled: false }).translate(0, 0, -2.8), color: VIDRIO });
  for (const x of [-4.6, 4.6]) for (const z of [-3.15, 3.15]) rueda(e, 1.5, 1.1, x, 0, z);
  if (taxi) {
    e.caja(8, 0.35, 6.6, '#111827', -1, 1.9, 0).caja(2.6, 0.9, 1.6, '#fff8dc', -1, 6.05, 0).caja(2.7, 0.25, 1.7, '#111827', -1, 6.0, 0); // franja y aviso
  }
  return { piezas: e.piezas, radio: 10 };
}

/** Taxi amarillo: el auto con franja negra y aviso en el techo. */
function taxi(e: Ensamble): Modelo {
  return auto(e, '#f5c400', '#f5c400', true);
}

/** Cilindro horizontal a lo largo de x, centrado en (x, y, z): tanques, escapes, repuesto. */
function ejeX(e: Ensamble, r: number, largo: number, color: string, x: number, y: number, z: number): void {
  e.piezas.push({ g: new THREE.CylinderGeometry(r, r, largo, 14).rotateZ(Math.PI / 2).translate(x, y, z), color });
}

/** Campero de los años 80 (tipo Toyota FJ60): caja cuadrada, techo blanco, parrilla, farolas redondas y repuesto atrás. */
function fj80(e: Ensamble): Modelo {
  const CUERPO = '#d8c9a0', OSCURO = '#2b2f36';
  e.caja(15.5, 0.5, 5.8, OSCURO, 0, 0.9, 0)                                         // chasis
    .caja(15.5, 2.6, 6.2, CUERPO, 0, 1.4, 0)                                         // carrocería baja
    .caja(4.4, 0.5, 6.0, CUERPO, 5.5, 4.0, 0)                                        // capó plano
    .caja(11, 2.6, 5.7, VIDRIO, -1.5, 4.0, 0)                                        // cabina acristalada
    .caja(0.5, 2.6, 0.5, CUERPO, 4.0, 4.0, 2.9).caja(0.5, 2.6, 0.5, CUERPO, 4.0, 4.0, -2.9)       // parantes delanteros
    .caja(0.5, 2.6, 0.5, CUERPO, -7.0, 4.0, 2.9).caja(0.5, 2.6, 0.5, CUERPO, -7.0, 4.0, -2.9)     // parantes traseros
    .caja(0.6, 2.6, 5.9, CUERPO, -1.5, 4.0, 0).caja(0.6, 2.6, 5.9, CUERPO, -4.2, 4.0, 0)          // parantes centrales
    .caja(11.6, 0.45, 6.2, '#f1f5f9', -1.5, 6.6, 0)                                  // techo blanco
    .caja(9, 0.2, 5.4, OSCURO, -1.5, 7.05, 0)                                        // parrilla de techo
    .caja(0.3, 1.8, 4.6, OSCURO, 7.8, 2.2, 0)                                        // parrilla frontal
    .caja(0.8, 0.7, 6.8, '#9ca3af', 8.0, 1.1, 0).caja(0.8, 0.7, 6.8, '#9ca3af', -7.9, 1.1, 0)     // parachoques cromados
    .caja(0.2, 1.1, 1.1, '#fff3b0', 7.8, 2.5, 2.6).caja(0.2, 1.1, 1.1, '#fff3b0', 7.8, 2.5, -2.6) // farolas
    .caja(0.2, 0.5, 1.0, '#b91c1c', -7.85, 2.6, 2.4).caja(0.2, 0.5, 1.0, '#b91c1c', -7.85, 2.6, -2.4); // luces traseras
  e.piezas.push({ g: new THREE.CylinderGeometry(1.5, 1.5, 0.9, 18).rotateZ(Math.PI / 2).translate(-8.5, 3.9, 0), color: '#1f2328' });  // repuesto
  e.piezas.push({ g: new THREE.CylinderGeometry(0.9, 0.9, 0.95, 14).rotateZ(Math.PI / 2).translate(-8.5, 3.9, 0), color: '#c5cbd1' });
  for (const x of [-4.8, 4.8]) for (const z of [-3.3, 3.3]) rueda(e, 1.8, 1.4, x, 0, z);
  return { piezas: e.piezas, radio: 11 };
}

/** Bus blanco: dos líneas verdes degradadas en los laterales, ventanas corridas, puerta delantera y aire en el techo. */
function bus(e: Ensamble): Modelo {
  const L = 40, OSCURO = '#2b2f36';
  e.caja(L, 9.8, 8.2, '#f8fafc', 0, 1.4, 0)                                          // carrocería
    .caja(L - 6, 3.4, 8.5, VIDRIO, -1.5, 6.0, 0)                                     // ventanas laterales corridas
    .caja(0.3, 4.2, 7.4, VIDRIO, L / 2 + 0.05, 6.4, 0).caja(0.3, 3.4, 7.0, VIDRIO, -L / 2 - 0.05, 6.4, 0) // parabrisas y vidrio trasero
    .caja(0.6, 3.4, 8.55, '#f8fafc', -9, 6.0, 0).caja(0.6, 3.4, 8.55, '#f8fafc', 0, 6.0, 0).caja(0.6, 3.4, 8.55, '#f8fafc', 9, 6.0, 0) // parantes
    .caja(4, 6.2, 8.4, '#2b4c5c', 14.5, 1.9, 0)                                      // puerta delantera
    .caja(L, 0.5, 8.4, '#e2e8f0', 0, 11.2, 0).caja(8, 1.2, 4.5, '#cbd5e1', -8, 11.7, 0)  // techo y equipo de aire
    .caja(0.8, 1.0, 8.5, OSCURO, L / 2, 1.2, 0).caja(0.8, 1.0, 8.5, OSCURO, -L / 2, 1.2, 0) // parachoques
    .caja(0.2, 0.7, 1.4, '#fff3b0', L / 2 + 0.05, 2.8, 3).caja(0.2, 0.7, 1.4, '#fff3b0', L / 2 + 0.05, 2.8, -3)
    .caja(0.2, 0.7, 1.2, '#b91c1c', -L / 2 - 0.05, 2.8, 3).caja(0.2, 0.7, 1.2, '#b91c1c', -L / 2 - 0.05, 2.8, -3);
  // dos líneas verdes en cada lado, que van de verde oscuro (atrás) a verde claro (adelante)
  const n = 20, seg = L / n, oscuro = new THREE.Color('#14532d'), claro = new THREE.Color('#86efac');
  for (let k = 0; k < n; k++) {
    const color = '#' + oscuro.clone().lerp(claro, k / (n - 1)).getHexString();
    for (const lado of [1, -1]) for (const y of [2.5, 3.8]) e.caja(seg, 0.8, 0.2, color, -L / 2 + seg * (k + 0.5), y, lado * 4.2);
  }
  for (const x of [-12, 13]) for (const z of [-4.3, 4.3]) rueda(e, 1.8, 1.7, x, 0, z);
  return { piezas: e.piezas, radio: 26 };
}

/** Tractocamión con tráiler (frente hacia +x): cabina sobre el motor, tanques, escapes, plataforma y furgón con franja azul. */
function camion(e: Ensamble): Modelo {
  const CABINA = '#1e40af', OSCURO = '#2b2f36', ACERO = '#aeb6bf';
  e.caja(60, 0.9, 5.6, OSCURO, 0, 2.0, 0)                                            // chasis
    .caja(10, 8, 7, CABINA, 25, 2.9, 0)                                              // cabina
    .caja(0.3, 3.2, 6.4, VIDRIO, 30.05, 6.4, 0).caja(5.5, 2.6, 7.1, VIDRIO, 26.5, 6.6, 0)  // parabrisas y ventanas
    .caja(4.5, 2.4, 6.6, '#e5e7eb', 21, 10.9, 0)                                     // deflector del techo
    .caja(0.9, 1.4, 7.4, OSCURO, 30.2, 1.8, 0).caja(0.3, 1.8, 5.2, OSCURO, 30.15, 3.3, 0)   // parachoques y parrilla
    .caja(0.2, 0.8, 1.4, '#fff3b0', 30.1, 4.6, 2.6).caja(0.2, 0.8, 1.4, '#fff3b0', 30.1, 4.6, -2.6)
    .caja(8, 0.6, 6.4, OSCURO, 14, 3.0, 0)                                           // quinta rueda
    .caja(42, 0.7, 6.8, OSCURO, -9, 2.9, 0)                                          // plataforma del tráiler
    .caja(48, 10, 7.6, '#f1f5f9', -6, 3.6, 0)                                        // furgón
    .caja(48, 1.4, 7.7, CABINA, -6, 6.3, 0)                                          // franja azul
    .caja(0.3, 8.6, 6.8, '#cbd5e1', -30.1, 4.2, 0)                                   // puertas traseras
    .caja(0.7, 0.8, 7.2, '#b91c1c', -30.4, 2.4, 0);                                  // defensa trasera
  for (const z of [3.4, -3.4]) {
    ejeX(e, 1.0, 5.5, ACERO, 17, 3.0, z * 1.05);                                     // tanque de combustible
    e.cil(0.35, 0.35, 11, ACERO, 19, 2.4, z * 0.97, 8);                              // escape vertical
  }
  for (const x of [26.5]) for (const z of [-3.3, 3.3]) rueda(e, 2.1, 1.7, x, 0, z);        // eje delantero
  for (const x of [14, 10.8, -22, -25.4, -28.8]) for (const z of [-3.3, 3.3]) rueda(e, 2.1, 2.0, x, 0, z); // tracción y tráiler
  return { piezas: e.piezas, radio: 34 };
}

/** Moto de calle (frente hacia +x): ruedas con rin, horquilla, tanque, asiento, motor, escape, manubrio y farola. */
function moto(e: Ensamble): Modelo {
  const NEGRO = '#1f2328', ROJO = '#d62828', ACERO = '#aeb6bf';
  const barra = (a: [number, number, number], b: [number, number, number], r: number, color: string) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), largo = d.length();
    e.piezas.push({
      g: new THREE.CylinderGeometry(r, r, largo, 8).translate(0, largo / 2, 0)
        .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(...a), color,
    });
  };
  const R = 1.55;
  for (const x of [3.3, -3.3]) {
    e.piezas.push({ g: new THREE.TorusGeometry(R - 0.3, 0.3, 8, 24).translate(x, R, 0), color: NEGRO });  // llanta
    e.piezas.push({ g: new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.15, 16).rotateX(Math.PI / 2).translate(x, R, 0), color: '#c5cbd1' });
    e.piezas.push({ g: new THREE.CylinderGeometry(0.28, 0.28, 0.6, 10).rotateX(Math.PI / 2).translate(x, R, 0), color: '#6b7280' });
  }
  barra([3.3, R, 0.45], [2.2, 4.9, 0.45], 0.14, ACERO); barra([3.3, R, -0.45], [2.2, 4.9, -0.45], 0.14, ACERO);   // horquilla
  barra([-3.3, R, 0.4], [-0.8, 1.9, 0.4], 0.14, NEGRO); barra([-3.3, R, -0.4], [-0.8, 1.9, -0.4], 0.14, NEGRO);   // brazo trasero
  barra([2.2, 4.9, 0], [2.0, 5.5, 0], 0.18, NEGRO);                                                              // cuello
  barra([2.0, 5.5, -1.7], [2.0, 5.5, 1.7], 0.11, NEGRO);                                                         // manubrio
  e.caja(0.5, 0.35, 0.5, NEGRO, 2.0, 5.55, 1.9).caja(0.5, 0.35, 0.5, NEGRO, 2.0, 5.55, -1.9)                    // puños
    .caja(0.7, 0.8, 1.0, '#fff3b0', 2.9, 4.5, 0)                                                                 // farola
    .caja(0.8, 0.5, 0.9, ROJO, 2.1, 5.2, 0)                                                                      // tablero
    .caja(2.2, 1.1, 1.2, ROJO, 0.7, 3.3, 0)                                                                      // tanque
    .caja(3.2, 0.5, 1.1, NEGRO, -1.6, 3.2, 0)                                                                    // asiento
    .caja(1.1, 0.5, 1.2, ROJO, -3.4, 3.1, 0)                                                                     // cola
    .caja(0.2, 0.4, 0.8, '#b91c1c', -4.0, 3.2, 0)                                                                // luz trasera
    .caja(2.6, 1.6, 1.3, '#4b5563', 0.3, 1.2, 0).caja(1.2, 1.3, 1.5, '#6b7280', 0.5, 1.4, 0)                      // motor
    .caja(3.4, 0.35, 0.5, ACERO, -1.8, 1.0, 0.8)                                                                 // escape
    .caja(0.9, 0.5, 0.6, '#374151', -3.6, 1.0, 0.8)                                                              // silenciador
    .caja(3.0, 0.15, 0.8, ROJO, 3.3, R * 2 - 0.1, 0);                                                            // guardabarros delantero
  // piloto: torso inclinado hacia el manubrio, brazos, piernas sobre los estribos y casco con visera
  const CHAQUETA = '#2563eb', PANTALON = '#1f2937';
  barra([-1.3, 3.8, 0], [0.6, 6.3, 0], 0.8, CHAQUETA);
  e.piezas.push({ g: new THREE.SphereGeometry(0.75, 14, 10).translate(0.95, 7.2, 0), color: '#111827' });
  e.caja(0.3, 0.4, 0.95, '#9ec5e8', 1.55, 6.95, 0);
  for (const z of [0.9, -0.9]) {
    barra([0.4, 6.0, z * 0.8], [2.0, 5.65, z * 1.6], 0.3, CHAQUETA);              // brazo
    barra([-1.3, 3.9, z * 0.65], [0.9, 3.3, z], 0.42, PANTALON);                  // muslo
    barra([0.9, 3.3, z], [-0.1, 1.5, z * 0.95], 0.36, PANTALON);                  // pierna
    e.caja(1.1, 0.45, 0.55, NEGRO, -0.4, 1.05, z * 0.95);                         // bota
    e.caja(0.45, 0.4, 0.45, '#f1f5f9', 2.0, 5.3, z * 1.9);                        // guante
  }
  return { piezas: e.piezas, radio: 8 };
}

/** Árbol del bosque: tronco y dos conos de copa, con el tamaño medio del mapa (13 m de copa, 21 de escala vertical). */
function arbol(e: Ensamble): Modelo {
  e.cil(1.3, 1.8, 10.5, '#6d4c33', 0, 0, 0, 5).cono(12.4, 24.2, '#4f9a45', 0, 7.35, 0, 6).cono(8.8, 20, '#5cae4d', 0, 20.6, 0, 6);
  return { piezas: e.piezas, radio: 14 };
}

type Especie = 'saman' | 'guayacan' | 'yarumo' | 'ceiba';

/** Árboles típicos de Girardota, a escala real y con la silueta que los distingue de lejos. */
function arbolRegional(e: Ensamble, especie: Especie): Modelo {
  /** Rama: cilindro delgado de `a` a `b`. */
  const rama = (a: [number, number, number], b: [number, number, number], r0: number, r1: number, color: string) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), largo = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, largo, 6).translate(0, largo / 2, 0)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(...a);
    e.piezas.push({ g, color });
  };
  const CORTEZA = '#7a5f45';
  switch (especie) {
    case 'saman':
      e.cil(1.2, 1.9, 9, CORTEZA, 0, 0, 0, 8);
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.5; rama([0, 8, 0], [Math.cos(a) * 9, 14, Math.sin(a) * 9], 0.8, 0.4, CORTEZA); }
      e.monticulo(20, 10, '#3f8a3c', 0, 11, 0).monticulo(14, 6, '#4f9a45', 2, 17, -2).monticulo(10, 4, '#5cae4d', -5, 18, 5);
      return { piezas: e.piezas, radio: 22 };
    case 'guayacan':
      e.cil(0.7, 1.1, 11, '#6b5a48', 0, 0, 0, 7);
      rama([0, 9, 0], [-5, 15, 1], 0.5, 0.25, '#6b5a48');
      rama([0, 9, 0], [5, 14, -2], 0.5, 0.25, '#6b5a48');
      e.monticulo(8, 6, '#f2c316', 0, 12, 0).monticulo(6.5, 5, '#e8b40f', -6, 13, 2).monticulo(6, 5, '#f7d23a', 6, 12.5, -3)
        .monticulo(5, 4, '#f2c316', 1, 16, 4).oval(10, 10, 0.05, '#f2c316', 0, 0.05, 0, 0.35);        // flores caídas
      return { piezas: e.piezas, radio: 14 };
    case 'yarumo':
      e.cil(0.5, 0.8, 15, '#8a7a66', 0, 0, 0, 6);
      [[7, 0], [5, 4.5], [-2, 7], [-6, 3], [-6, -3], [0, -7], [5, -5]].forEach(([x, z], k) => {
        const y = 15 + (k % 2) * 3.5;
        rama([0, 12 + (k % 3), 0], [x, y, z], 0.3, 0.2, '#8a7a66');
        e.cil(5.2, 5.2, 0.5, '#86b56f', x, y, z, 9).cil(4.6, 4.6, 0.3, '#d5ddd2', x, y - 0.3, z, 9);  // hoja palmeada: verde arriba, plateada abajo
      });
      return { piezas: e.piezas, radio: 14 };
    case 'ceiba':
      e.cil(2.4, 4.4, 20, '#9a8f7a', 0, 0, 0, 10);
      for (let k = 0; k < 4; k++) e.caja(0.7, 7, 5, '#9a8f7a', Math.cos(k * Math.PI / 2 + 0.4) * 3.2, 0, Math.sin(k * Math.PI / 2 + 0.4) * 3.2, Math.PI / 2 - (k * Math.PI / 2 + 0.4));   // aletones
      for (let k = 0; k < 5; k++) { const a = k * 1.26; rama([0, 18, 0], [Math.cos(a) * 12, 26, Math.sin(a) * 12], 1.4, 0.6, '#9a8f7a'); }
      e.monticulo(17, 7, '#3f8a3c', 0, 24, 0).monticulo(12, 5, '#4f9a45', 0, 29, 0).monticulo(8, 4, '#5cae4d', 4, 33, -2);
      return { piezas: e.piezas, radio: 20 };
  }
}

/** Un tramo recto de vía (a lo largo de z) con su acera y sus rayas, o de cauce con su orilla clara. Anchos del mapa. */
function tramo(e: Ensamble, tipo: 'principal' | 'local' | 'sendero' | 'rio' | 'quebrada'): Modelo {
  const L = 80;
  const raya = (ancho: number, color: string, x: number) => { for (let z = -L / 2 + 8; z < L / 2 - 8; z += 24) e.caja(ancho, 0.05, 20, color, x, 0.3, z); };
  switch (tipo) {
    case 'principal':
      e.caja(34 * 1.3, 0.2, L, '#a9aaa8', 0, 0, 0).caja(34, 0.3, L, '#3e4146', 0, 0, 0)
        .caja(1.6, 0.05, L, '#f5f5f4', -14.1, 0.3, 0).caja(1.6, 0.05, L, '#f5f5f4', 14.1, 0.3, 0);
      raya(1.6, '#f2c230', 0);
      break;
    case 'local':
      e.caja(13 * 1.35, 0.2, L, '#b4b5b2', 0, 0, 0).caja(13, 0.3, L, '#55585d', 0, 0, 0);
      raya(0.5, '#d4d4d4', 0);
      break;
    case 'sendero':
      e.caja(6, 0.3, L, '#a98f66', 0, 0, 0);
      break;
    case 'rio':       // Río Medellín: 30 m reales × 2,2
      e.caja(66 * 1.35, 0.15, L, '#d3e2a6', 0, 0, 0).caja(66, 0.2, L, '#4db3e6', 0, 0, 0);
      break;
    case 'quebrada':
      e.caja(8 * 1.35, 0.15, L, '#d3e2a6', 0, 0, 0).caja(8, 0.2, L, '#4db3e6', 0, 0, 0);
      break;
  }
  return { piezas: e.piezas, radio: 46 };
}

/**
 * Carreteras según la red vial oficial (IGAC): tipo de vía y estado de la superficie. Mismos anchos de mapa que `tramo`
 * (≈ 2,2 unidades por metro real) y el mismo largo, para que se comparen lado a lado.
 *   autopista   doble calzada pavimentada, con separador y barandas     pavimentada
 *   troncal     dos carriles con doble línea amarilla                    pavimentada (troncal y transversal)
 *   secundaria  dos carriles con línea central discontinua               pavimentada
 *   mixta       placa huella: rieles de concreto con piedra y grava      código IGAC 3306 (afirmada / mixta)
 *   afirmada    afirmado (grava) con huellas y cunetas                   carretera terciaria
 *   carreteable tierra de un carril, con pasto al centro y charcos       sin pavimentar (código 3350)
 *   restringida afirmada con talanquera                                  acceso restringido (accesibilidad 3600)
 */
function carretera(e: Ensamble, tipo: 'autopista' | 'troncal' | 'secundaria' | 'mixta' | 'afirmada' | 'carreteable' | 'restringida'): Modelo {
  const L = 80, asfalto = '#3e4146', berma = '#a9aaa8', blanco = '#f5f5f4', amarillo = '#f2c230';
  const dash = (ancho: number, color: string, x: number) => { for (let z = -L / 2 + 8; z < L / 2 - 8; z += 24) e.caja(ancho, 0.05, 12, color, x, 0.3, z); };
  const huellas = (x: number, color: string, ancho = 1.8) => { e.caja(ancho, 0.05, L, color, -x, 0.3, 0).caja(ancho, 0.05, L, color, x, 0.3, 0); };
  const cunetas = (x: number) => { for (const s of [-1, 1]) e.caja(2.2, 0.06, L, '#7d8a63', s * x, 0.02, 0); };
  switch (tipo) {
    case 'autopista':
      e.caja(37, 0.2, L, berma, 0, 0, 0)
        .caja(14, 0.3, L, asfalto, -10, 0, 0).caja(14, 0.3, L, asfalto, 10, 0, 0)
        .caja(6, 0.4, L, '#7fa468', 0, 0, 0).caja(0.8, 1.1, L, '#c9c7c0', -2.6, 0.4, 0).caja(0.8, 1.1, L, '#c9c7c0', 2.6, 0.4, 0);   // separador y barandas
      for (const s of [-1, 1]) { e.caja(0.5, 0.05, L, amarillo, s * 3.6, 0.3, 0).caja(0.5, 0.05, L, blanco, s * 16.2, 0.3, 0); dash(0.4, blanco, s * 10); }
      break;
    case 'troncal':
      e.caja(19, 0.2, L, berma, 0, 0, 0).caja(16, 0.3, L, asfalto, 0, 0, 0)
        .caja(0.4, 0.05, L, amarillo, -0.5, 0.3, 0).caja(0.4, 0.05, L, amarillo, 0.5, 0.3, 0)
        .caja(0.5, 0.05, L, blanco, -7.2, 0.3, 0).caja(0.5, 0.05, L, blanco, 7.2, 0.3, 0);
      break;
    case 'secundaria':
      e.caja(16.5, 0.2, L, berma, 0, 0, 0).caja(14, 0.3, L, asfalto, 0, 0, 0)
        .caja(0.5, 0.05, L, blanco, -6.3, 0.3, 0).caja(0.5, 0.05, L, blanco, 6.3, 0.3, 0);
      dash(0.4, amarillo, 0);
      break;
    case 'mixta':
      // placa huella: dos rieles de concreto con piedra incrustada, sobre afirmado; grava entre los rieles y a los lados
      e.caja(14, 0.25, L, '#b8a47e', 0, 0, 0).caja(3, 0.28, L, '#c9b98f', 0, 0, 0);
      for (const s of [-1, 1]) {
        e.caja(4.6, 0.36, L, '#bdbbb4', s * 3.9, 0, 0);
        for (let z = -L / 2 + 2; z < L / 2; z += 4) e.caja(4.6, 0.02, 0.35, '#8f8d86', s * 3.9, 0.36, z);        // juntas de la placa
        for (let z = -L / 2 + 5; z < L / 2 - 2; z += 9) e.caja(0.9, 0.05, 0.9, '#8a8478', s * 3.9 + (z % 2 ? 1.1 : -1.1), 0.36, z);   // piedra incrustada
      }
      cunetas(8.2);
      break;
    case 'afirmada':
      e.caja(12, 0.25, L, '#b8a47e', 0, 0, 0).caja(2.6, 0.04, L, '#c8b88f', 0, 0.25, 0);
      huellas(3.2, '#9b8862');
      cunetas(7.4);
      break;
    case 'carreteable':
      e.caja(7, 0.2, L, '#8a6a45', 0, 0, 0).caja(1.6, 0.06, L, '#6f8f4e', 0, 0.2, 0);
      huellas(2.4, '#6e5233', 1.4);
      for (const [x, z, w, d] of [[-2.4, -20, 2.6, 7], [2.4, 14, 2.6, 9]] as const) e.caja(w, 0.03, d, '#5f5240', x, 0.21, z);   // charcos de barro
      break;
    case 'restringida':
      e.caja(12, 0.25, L, '#b8a47e', 0, 0, 0);
      huellas(3.2, '#9b8862');
      cunetas(7.4);
      for (const s of [-1, 1]) e.caja(1.2, 5, 1.2, '#8b8d90', s * 7.4, 0, 0);                                    // postes
      for (let i = 0; i < 6; i++) e.caja(2.4, 0.9, 1, i % 2 ? '#f5f5f4' : '#d32f2f', -7.4 + 1.2 + i * 2.4, 4.3, 0);   // brazo rayado cerrado
      break;
  }
  return { piezas: e.piezas, radio: 46 };
}

/**
 * Puente de una vía local sobre un cauce (como los del mapa): tablero de concreto con asfalto, aceras, pasamanos y travesaño
 * amarillos con postes, y los terraplenes de acceso. El cauce corre de lado a lado, por debajo.
 */
function puente(e: Ensamble, anchoVia = 13): Modelo {
  const L = 100, ancho = anchoVia * 1.15, acera = Math.max(2.4, ancho * 0.08), perfil = 7, kerb = 1.2, amarillo = '#f6c312';
  e.caja(70, 0.15, 54, '#d3e2a6', 0, 0, 0).caja(70, 0.2, 40, '#4db3e6', 0, 0, 0);
  for (const s of [-1, 1]) e.caja(ancho + 14, perfil, 28, '#7fa468', 0, 0, s * 36);                       // terraplenes de acceso
  e.caja(ancho, 4.75, L, '#c9c7c0', 0, perfil - 4.5, 0)                                                 // tablero y vigas
    .caja(ancho - 2 * acera, 0.05, L, '#55585d', 0, perfil + 0.25, 0);                                  // asfalto
  const lat = ancho / 2 - acera * 0.45;
  for (const s of [-1, 1]) {
    e.caja(acera, kerb - 0.25, L, '#c9c7c0', s * (ancho / 2 - acera / 2), perfil + 0.25, 0)
      .caja(2.4, 2.4, L, amarillo, s * lat, perfil + kerb + 7, 0).caja(1.8, 1.8, L, amarillo, s * lat, perfil + kerb + 3.3, 0);
    for (let z = -L / 2 + 2; z <= L / 2 - 2; z += 24) e.caja(2.6, 9.4, 2.6, amarillo, s * lat, perfil + kerb, z);
  }
  return { piezas: e.piezas, radio: 62 + (ancho > 20 ? 10 : 0) };
}

/** Garza de la bandada, con las alas abiertas: cuerpo, cabeza, pico, cola y alas de brazo y mano (como en el mapa). */
function pajaro(e: Ensamble): Modelo {
  const flat = (pts: [number, number][], lado: number, dx: number, dy: number) =>
    new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(lado * x, -z)))).rotateX(-Math.PI / 2).translate(dx, dy, 0);
  const brazo: [number, number][] = [[0, -9], [6, -10.5], [13, -10], [20, -7.5], [20, -1], [14, 2.5], [7, 4.5], [0, 5]];
  const mano: [number, number][] = [[0, -7.5], [8, -9.5], [17, -9], [26, -6], [34, -1.5], [37, 1.5], [31, 1], [29, 4.5], [23, 2.5], [21, 6], [15, 3.5], [12, 6.5], [6, 4], [0, 0.5]];
  const alto = 6;
  const p = e.piezas;
  p.push({ g: new THREE.SphereGeometry(1, 10, 8).scale(3.6, 3.2, 12).translate(0, alto, 0), color: '#f6f8fa' });
  p.push({ g: new THREE.SphereGeometry(2.7, 9, 7).translate(0, alto + 1.2, -12.5), color: '#f6f8fa' });
  p.push({ g: new THREE.ConeGeometry(1.1, 6.5, 6).rotateX(-Math.PI / 2).translate(0, alto + 0.7, -18.6), color: '#f2a73b' });
  p.push({ g: new THREE.ShapeGeometry(new THREE.Shape([[-2.5, 8], [-6.5, 21], [-3.5, 24], [0, 22], [3.5, 24], [6.5, 21], [2.5, 8]].map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2).translate(0, alto, 0), color: '#e7ecf1' });
  for (const lado of [-1, 1]) {
    p.push({ g: flat(brazo, lado, lado * 2.5, alto + 0.8), color: '#f6f8fa' });
    p.push({ g: flat(mano, lado, lado * 22.5, alto + 0.8), color: '#e7ecf1' });
  }
  return { piezas: p, radio: 42 };
}

/** Colores de la persona según su variante (hombre, mujer, niño escolar o campesino), compartidos por los dos estilos. */
function ropaPersona(t: string) {
  const nino = /ni[ñn]o|escolar/.test(t), mujer = /mujer/.test(t), campesino = /campesin/.test(t);
  return {
    nino, mujer, campesino, piel: '#d9a074', zapato: '#26262b',
    camisa: nino ? '#f4f4f4' : mujer ? '#c2410c' : campesino ? '#e8dcc0' : '#1d4ed8',
    pantalon: nino ? '#1e3a8a' : mujer ? '#7c2d12' : campesino ? '#5b4a36' : '#374151',
    pelo: mujer ? '#3b2314' : campesino ? '#5a5a5a' : '#1f1a17',
  };
}

/**
 * Persona de bajo polígono (unos 520 triángulos, 1,70 m): pensada para repetirse por cientos como InstancedMesh. Son pocas piezas
 * con colores planos (se funden en una sola geometría con color por vértice), sin esqueleto: parte de una pose a medio paso
 * y el mapa balancea piernas y brazos en el vértice (`mov` de cada pieza) y las mueve por trayectos. Variantes por nombre: mujer (falda y cabello largo), niño (escolar, 72 % de la talla)
 * y campesino (sombrero aguadeño y carriel).
 */
function persona(e: Ensamble, t: string): Modelo {
  if (/mu[ñn]eco/.test(t)) return personaMuneco(e, t);
  const { nino, mujer, campesino, piel, zapato, camisa, pantalon, pelo } = ropaPersona(t);
  const p = e.piezas;
  const pone = (g: THREE.BufferGeometry, color: string) => p.push({ g, color });
  /** Pieza que cuelga de una articulación (cadera u hombro): se mece en x y se abre en z. */
  const miembro = (g: THREE.BufferGeometry, color: string, x: number, y: number, rx: number, rz = 0, brazo = false) =>
    p.push({ g: g.rotateX(rx).rotateZ(rz).translate(x, y, 0), color, mov: [(x < 0 ? -1 : 1) * (brazo ? -1 : 1), y, brazo ? 0.6 : 0.5] });

  for (const lado of [-1, 1]) {
    const paso = lado * 0.16;
    // pierna (con zapato) colgando de la cadera, una adelante y otra atrás
    miembro(new THREE.CylinderGeometry(0.062, 0.05, 0.8, 6).translate(0, -0.4, 0), mujer ? piel : pantalon, lado * 0.09, 0.87, paso);
    miembro(new THREE.BoxGeometry(0.11, 0.07, 0.26).translate(0, -0.835, 0.04), zapato, lado * 0.09, 0.87, paso);
    // brazo: manga, antebrazo y mano, en contrafase con la pierna del mismo lado
    const hombro = 1.37, brazo = -paso * 1.8;
    miembro(new THREE.CylinderGeometry(0.05, 0.046, 0.3, 6).translate(0, -0.15, 0), camisa, lado * 0.225, hombro, brazo, lado * 0.07, true);
    miembro(new THREE.CylinderGeometry(0.042, 0.036, 0.27, 6).translate(0, -0.435, 0), piel, lado * 0.225, hombro, brazo, lado * 0.07, true);
    miembro(new THREE.BoxGeometry(0.06, 0.09, 0.04).translate(0, -0.62, 0), piel, lado * 0.225, hombro, brazo, lado * 0.07, true);
  }
  pone(new THREE.CylinderGeometry(0.17, 0.145, 0.55, 8).scale(1, 1, 0.62).translate(0, 1.125, 0), camisa);
  if (mujer) pone(new THREE.CylinderGeometry(0.16, 0.25, 0.4, 10).translate(0, 0.72, 0), pantalon);
  else pone(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 8).scale(1, 1, 0.66).translate(0, 0.89, 0), '#2b2118');   // cinturón
  pone(new THREE.CylinderGeometry(0.05, 0.055, 0.09, 6).translate(0, 1.42, 0), piel);
  pone(new THREE.SphereGeometry(0.115, 8, 6).scale(0.92, 1.12, 1).translate(0, 1.56, 0), piel);
  for (const lado of [-1, 1]) pone(new THREE.BoxGeometry(0.018, 0.024, 0.01).translate(lado * 0.04, 1.565, 0.106), '#1b1b1b');
  // cabello: flequillo y casquete arriba, y nuca (larga en la mujer)
  pone(new THREE.SphereGeometry(0.124, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(0.95, 1.12, 1.04).translate(0, 1.565, -0.008), pelo);
  pone(mujer
    ? new THREE.SphereGeometry(0.12, 8, 6).scale(1.05, 2.1, 0.7).translate(0, 1.42, -0.085)
    : new THREE.SphereGeometry(0.12, 8, 5).scale(0.95, 1, 0.62).translate(0, 1.54, -0.06), pelo);
  if (campesino) {
    pone(new THREE.CylinderGeometry(0.27, 0.27, 0.014, 12).translate(0, 1.655, 0), '#e9dcae');          // ala
    pone(new THREE.CylinderGeometry(0.1, 0.115, 0.1, 10).translate(0, 1.71, 0), '#e9dcae');             // copa
    pone(new THREE.CylinderGeometry(0.118, 0.118, 0.025, 10).translate(0, 1.678, 0), '#2b2b2b');         // cinta
    pone(new THREE.BoxGeometry(0.2, 0.2, 0.08).translate(-0.2, 0.93, 0.07), '#5a3a1e');                   // carriel
  }
  if (nino) pone(new THREE.BoxGeometry(0.26, 0.3, 0.12).translate(0, 1.13, -0.165), '#dc2626');         // maleta escolar
  if (nino) for (const pz of p) { pz.g.scale(0.72, 0.72, 0.72); if (pz.mov) pz.mov[1] *= 0.72; }
  return { piezas: p, radio: 0.9 };
}

/**
 * Persona estilo muñeco (unos 800 triángulos): cabeza grande y redonda, cuerpo de cápsula, piernas cortas, ojos grandes y mejillas.
 * Se lee mejor de lejos que la proporcionada y se instancia igual (piezas planas, sin esqueleto).
 */
function personaMuneco(e: Ensamble, t: string): Modelo {
  const { nino, mujer, campesino, piel, zapato, camisa, pantalon, pelo } = ropaPersona(t);
  const p = e.piezas;
  const pone = (g: THREE.BufferGeometry, color: string) => p.push({ g, color });
  const capsula = (r: number, largo: number) => new THREE.CapsuleGeometry(r, largo, 2, 6);

  for (const lado of [-1, 1]) {
    const paso = lado * 0.2;
    // zapato y pierna corta, una adelante y otra atrás
    pone(new THREE.SphereGeometry(0.085, 6, 4).scale(1, 0.6, 1.55).translate(0, -0.37, 0.04).rotateX(paso).translate(lado * 0.095, 0.41, 0), zapato);
    pone(capsula(0.065, 0.2).translate(0, -0.17, 0).rotateX(paso).translate(lado * 0.095, 0.41, 0), mujer ? piel : pantalon);
    // brazo redondo con manga y mano de bola, en contrafase
    const brazo = -paso * 1.5, rz = lado * 0.22;
    pone(capsula(0.05, 0.14).translate(0, -0.14, 0).rotateX(brazo).rotateZ(rz).translate(lado * 0.2, 0.98, 0), camisa);
    pone(new THREE.SphereGeometry(0.05, 5, 4).translate(0, -0.3, 0).rotateX(brazo).rotateZ(rz).translate(lado * 0.2, 0.98, 0), piel);
  }
  pone(capsula(0.17, 0.26).scale(1, 1, 0.85).translate(0, 0.72, 0), camisa);
  if (mujer) pone(new THREE.CylinderGeometry(0.17, 0.27, 0.3, 10).translate(0, 0.52, 0), pantalon);
  // cabeza grande
  pone(new THREE.SphereGeometry(0.24, 10, 7).scale(1, 0.95, 0.96).translate(0, 1.27, 0), piel);
  for (const lado of [-1, 1]) {
    pone(new THREE.SphereGeometry(0.03, 5, 4).scale(1, 1.25, 0.6).translate(lado * 0.085, 1.285, 0.212), '#1b1b1b');
    pone(new THREE.SphereGeometry(0.036, 5, 3).scale(1, 0.62, 0.3).translate(lado * 0.14, 1.215, 0.185), '#f08a8a');
  }
  pone(new THREE.BoxGeometry(0.06, 0.013, 0.012).translate(0, 1.18, 0.219), '#7a2e2e');
  // cabello: casquete con flequillo y nuca; coletas en la mujer
  pone(new THREE.SphereGeometry(0.25, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.4).scale(1, 0.96, 1.02).translate(0, 1.275, -0.005), pelo);
  pone(new THREE.SphereGeometry(0.245, 7, 4).scale(0.98, 0.95, 0.75).translate(0, 1.27, -0.06), pelo);
  if (mujer) for (const lado of [-1, 1]) pone(new THREE.SphereGeometry(0.075, 5, 4).translate(lado * 0.26, 1.16, -0.03), pelo);
  if (campesino) {
    pone(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 14).translate(0, 1.5, 0), '#e9dcae');          // ala
    pone(new THREE.CylinderGeometry(0.15, 0.17, 0.14, 10).translate(0, 1.58, 0), '#e9dcae');         // copa
    pone(new THREE.CylinderGeometry(0.175, 0.175, 0.03, 10).translate(0, 1.535, 0), '#2b2b2b');       // cinta
    pone(new THREE.BoxGeometry(0.18, 0.17, 0.08).translate(-0.17, 0.6, 0.12), '#5a3a1e');             // carriel
  }
  if (nino) {
    pone(new THREE.BoxGeometry(0.3, 0.36, 0.13).translate(0, 0.8, -0.2), '#dc2626');                 // maleta escolar
    for (const g of p) g.g.scale(0.8, 0.8, 0.8);
  }
  return { piezas: p, radio: 0.9 };
}

export type CategoriaCatalogo = CategoriaPunto | 'servicios' | 'industria' | 'vivienda' | 'vehiculos' | 'vias' | 'agua' | 'naturaleza' | 'gente';

/** Un ejemplo de cada edificio distinto, con un punto real de Girardota como muestra, para el catálogo. */
export interface Variante { categoria: CategoriaCatalogo; etiqueta: string; tipo: string; nombre: string; /** subtipo de servicio público (pin del mapa) */ srv?: string; }
export const VARIANTES: Variante[] = [
  { categoria: 'servicios', etiqueta: 'Subestación eléctrica (patio, caseta y transformadores)', tipo: 'Servicio', nombre: 'subestación', srv: 'srv-subestacion' },
  { categoria: 'servicios', etiqueta: 'Torre de alta tensión', tipo: 'Servicio', nombre: 'torre', srv: 'srv-subestacion' },
  { categoria: 'servicios', etiqueta: 'Central hidroeléctrica (casa de máquinas)', tipo: 'Servicio', nombre: 'central', srv: 'srv-central' },
  { categoria: 'servicios', etiqueta: 'Bocatoma de acueducto veredal', tipo: 'Servicio', nombre: 'bocatoma', srv: 'srv-bocatoma' },
  { categoria: 'servicios', etiqueta: 'Sistema de tratamiento de agua (rural)', tipo: 'Servicio', nombre: 'tratamiento', srv: 'srv-tratamiento' },
  { categoria: 'servicios', etiqueta: 'Tanque de agua', tipo: 'Servicio', nombre: 'tanque', srv: 'srv-tanque' },
  { categoria: 'servicios', etiqueta: 'PTAR urbana (proyecto)', tipo: 'Servicio', nombre: 'ptar', srv: 'srv-ptar' },
  { categoria: 'servicios', etiqueta: 'ECA: clasificación y aprovechamiento (proyecto)', tipo: 'Servicio', nombre: 'eca', srv: 'srv-eca' },
  { categoria: 'industria', etiqueta: 'Fábrica', tipo: 'Industria', nombre: 'Fábrica' },
  { categoria: 'industria', etiqueta: 'Parque industrial (unidades modulares)', tipo: 'Industria', nombre: 'Parque industrial' },
  { categoria: 'vivienda', etiqueta: 'Vivienda típica', tipo: 'Vivienda', nombre: 'Vivienda' },
  { categoria: 'vivienda', etiqueta: 'Edificio del casco urbano', tipo: 'Edificio', nombre: 'Edificio' },
  ...TIPOLOGIAS.map(t => ({ categoria: 'vivienda' as const, etiqueta: `${t.etiqueta} · fachada detallada`, tipo: 'Tipología', nombre: t.id })),
  { categoria: 'vehiculos', etiqueta: 'Auto', tipo: 'Vehículo', nombre: 'Auto' },
  { categoria: 'vehiculos', etiqueta: 'Moto', tipo: 'Vehículo', nombre: 'Moto' },
  { categoria: 'vehiculos', etiqueta: 'Taxi', tipo: 'Vehículo', nombre: 'Taxi' },
  { categoria: 'vehiculos', etiqueta: 'Campero FJ (años 80)', tipo: 'Vehículo', nombre: 'Campero FJ' },
  { categoria: 'vehiculos', etiqueta: 'Bus', tipo: 'Vehículo', nombre: 'Bus' },
  { categoria: 'vehiculos', etiqueta: 'Camión con tráiler', tipo: 'Vehículo', nombre: 'Camión con tráiler' },
  { categoria: 'vehiculos', etiqueta: 'Avión (Boeing 787)', tipo: 'Vehículo', nombre: 'Avión' },
  { categoria: 'vias', etiqueta: 'Vía principal', tipo: 'Vía', nombre: 'principal' },
  { categoria: 'vias', etiqueta: 'Vía local', tipo: 'Vía', nombre: 'local' },
  { categoria: 'vias', etiqueta: 'Sendero', tipo: 'Vía', nombre: 'sendero' },
  { categoria: 'vias', etiqueta: 'Autopista / doble calzada (pavimentada)', tipo: 'Vía', nombre: 'autopista' },
  { categoria: 'vias', etiqueta: 'Troncal / transversal (pavimentada)', tipo: 'Vía', nombre: 'troncal' },
  { categoria: 'vias', etiqueta: 'Carretera secundaria pavimentada', tipo: 'Vía', nombre: 'secundaria' },
  { categoria: 'vias', etiqueta: 'Carretera secundaria afirmada / mixta (placa huella)', tipo: 'Vía', nombre: 'mixta' },
  { categoria: 'vias', etiqueta: 'Carretera terciaria afirmada', tipo: 'Vía', nombre: 'afirmada' },
  { categoria: 'vias', etiqueta: 'Carreteable sin pavimentar', tipo: 'Vía', nombre: 'carreteable' },
  { categoria: 'vias', etiqueta: 'Vía con acceso restringido', tipo: 'Vía', nombre: 'restringida' },
  { categoria: 'vias', etiqueta: 'Puente (vía local)', tipo: 'Vía', nombre: 'puente' },
  { categoria: 'vias', etiqueta: 'Puente (vía principal)', tipo: 'Vía', nombre: 'puente principal' },
  { categoria: 'agua', etiqueta: 'Río (Medellín)', tipo: 'Cauce', nombre: 'río' },
  { categoria: 'agua', etiqueta: 'Quebrada', tipo: 'Cauce', nombre: 'quebrada' },
  { categoria: 'naturaleza', etiqueta: 'Samán', tipo: 'Vegetación', nombre: 'Samán' },
  { categoria: 'naturaleza', etiqueta: 'Guayacán amarillo', tipo: 'Vegetación', nombre: 'Guayacán' },
  { categoria: 'naturaleza', etiqueta: 'Yarumo', tipo: 'Vegetación', nombre: 'Yarumo' },
  { categoria: 'naturaleza', etiqueta: 'Ceiba', tipo: 'Vegetación', nombre: 'Ceiba' },
  { categoria: 'naturaleza', etiqueta: 'Árbol del bosque',tipo: 'Vegetación', nombre: 'Árbol' },
  { categoria: 'naturaleza', etiqueta: 'Pájaro (bandada)', tipo: 'Fauna', nombre: 'Pájaro' },
  { categoria: 'gente', etiqueta: 'Hombre', tipo: 'Persona', nombre: 'Hombre' },
  { categoria: 'gente', etiqueta: 'Mujer', tipo: 'Persona', nombre: 'Mujer' },
  { categoria: 'gente', etiqueta: 'Niño escolar', tipo: 'Persona', nombre: 'Niño escolar' },
  { categoria: 'gente', etiqueta: 'Campesino', tipo: 'Persona', nombre: 'Campesino' },
  { categoria: 'gente', etiqueta: 'Hombre (muñeco)', tipo: 'Persona', nombre: 'Hombre muñeco' },
  { categoria: 'gente', etiqueta: 'Mujer (muñeco)', tipo: 'Persona', nombre: 'Mujer muñeco' },
  { categoria: 'gente', etiqueta: 'Niño escolar (muñeco)', tipo: 'Persona', nombre: 'Niño escolar muñeco' },
  { categoria: 'gente', etiqueta: 'Campesino (muñeco)', tipo: 'Persona', nombre: 'Campesino muñeco' },
  { categoria: 'educacion', etiqueta: 'Sede urbana', tipo: 'Sede educativa urbana', nombre: 'I. E. Colombia' },
  { categoria: 'educacion', etiqueta: 'Sede rural', tipo: 'Sede educativa rural', nombre: 'E R La Manga' },
  { categoria: 'cultura', etiqueta: 'Casa de la cultura', tipo: 'Casa de cultura', nombre: 'Pedrito Ruiz' },
  { categoria: 'cultura', etiqueta: 'Biblioteca', tipo: 'Biblioteca', nombre: 'Biblioteca pública' },
  { categoria: 'cultura', etiqueta: 'Escuela de música / escenario', tipo: 'Escuela de música', nombre: 'Escuela de música' },
  { categoria: 'cultura', etiqueta: 'Emisora', tipo: 'Emisora comunitaria', nombre: 'Radio Alternativa' },
  { categoria: 'salud', etiqueta: 'Hospital', tipo: 'Hospital / IPS pública', nombre: 'Hospital San Rafael' },
  { categoria: 'salud', etiqueta: 'Centro de salud', tipo: 'Optometría', nombre: 'Centro de salud' },
  { categoria: 'salud', etiqueta: 'Sede Comfama (piscina, salud y colegio en 3 pisos)', tipo: 'Centro integral de salud / IPS', nombre: 'Comfama Girardota' },
  { categoria: 'turismo', etiqueta: 'Iglesia', tipo: 'Patrimonio religioso / arquitectónico', nombre: 'Catedral' },
  { categoria: 'turismo', etiqueta: 'Parque', tipo: 'Espacio público / encuentro ciudadano', nombre: 'Parque principal' },
  { categoria: 'turismo', etiqueta: 'Mirador', tipo: 'Atractivo natural / ecoturismo', nombre: 'Cascada' },
  { categoria: 'turismo', etiqueta: 'Mercado', tipo: 'Economía campesina / mercado local', nombre: 'Mercado agroverde' },
  { categoria: 'turismo', etiqueta: 'Plaza de mercado', tipo: 'Economía campesina / mercado local', nombre: 'Plaza de Mercado' },
  { categoria: 'turismo', etiqueta: 'Central de transporte veredal', tipo: 'Transporte público veredal', nombre: 'Central de transporte veredal' },
  { categoria: 'turismo', etiqueta: 'Truchera', tipo: 'Turismo rural / pesca deportiva', nombre: 'Truchera' },
  { categoria: 'turismo', etiqueta: 'Petroglifos', tipo: 'Patrimonio arqueológico / cultural', nombre: 'Petroglifos' },
  { categoria: 'deporte', etiqueta: 'Cancha de fútbol', tipo: 'Cancha de fútbol', nombre: 'Cancha' },
  { categoria: 'deporte', etiqueta: 'Coliseo', tipo: 'Coliseo', nombre: 'Coliseo Metropolitano' },
  { categoria: 'deporte', etiqueta: 'Cancha sintética', tipo: 'Cancha sintética', nombre: 'Cancha' },
  { categoria: 'deporte', etiqueta: 'Placa polideportiva', tipo: 'Placa polideportiva', nombre: 'Placa' },
  { categoria: 'deporte', etiqueta: 'Pista de patinaje', tipo: 'Pista de patinaje', nombre: 'Pista' },
  { categoria: 'deporte', etiqueta: 'Piscina', tipo: 'Piscina (OSM)', nombre: 'Piscina' },
  { categoria: 'deporte', etiqueta: 'Pista de bicicrós', tipo: 'Pista de bicicrós', nombre: 'Pista' },
  { categoria: 'justicia', etiqueta: 'Estación de policía', tipo: 'Estación de policía', nombre: 'Estación' },
  { categoria: 'justicia', etiqueta: 'Personería', tipo: 'Personería municipal', nombre: 'Personería' },
  { categoria: 'patrimonio', etiqueta: 'Estación del ferrocarril', tipo: 'Bien de interés cultural nacional', nombre: 'Estación' },
  { categoria: 'patrimonio', etiqueta: 'Sitio arqueológico', tipo: 'Sitio arqueológico', nombre: 'Sitio' },
  { categoria: 'patrimonio', etiqueta: 'Yacimiento', tipo: 'Sitio arqueológico · yacimiento', nombre: 'Yacimiento' },
  { categoria: 'patrimonio', etiqueta: 'Punto de hallazgo', tipo: 'Sitio arqueológico · punto de hallazgo', nombre: 'Hallazgo' },
];

export const COLOR_ACENTO: Record<CategoriaPunto, string> = {
  educacion: AZUL, cultura: ROSA, salud: CIAN, turismo: VERDE, deporte: LIMA, justicia: ROJO, patrimonio: CAFE,
};
