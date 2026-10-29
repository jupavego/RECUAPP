import * as THREE from 'three';
import { CategoriaPunto } from '../../mapa/services/mapa.service';

/** Un edificio listo para ponerse en el mapa: piezas con su color, en metros y con el origen en el suelo, en el centro. */
export interface Modelo {
  piezas: { g: THREE.BufferGeometry; color: string }[];
  /** radio que ocupa en planta (m) */
  radio: number;
  /** losa de cimentación [ancho, fondo] que se asienta en la ladera; sin ella el edificio se apoya en su centro */
  losa?: [number, number];
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

/** Sitios de interés: iglesia, kiosco de parque, mirador, pabellón de mercado o cabaña con estanque, según de qué se trate. */
function turismo(e: Ensamble, texto: string, rnd: () => number): Modelo {
  if (/arqueol|petrogl/.test(texto)) return patrimonio(e, 'sitio arqueológico', rnd);
  if (/religios|catedral|se[ñn]or|iglesia/.test(texto)) {
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

/** Escenarios deportivos: cancha de fútbol con graderías, placa cubierta con cubierta en arco, pista de patinaje o de bicrós. */
function deporte(e: Ensamble, tipo: string): Modelo {
  const linea = '#f5f5f4';
  if (/f[uú]tbol|sint[eé]tica/.test(tipo)) {
    const w = 62, d = 38;
    e.caja(w + 6, 0.3, d + 6, '#9aa0a6', 0, 0, 0).caja(w, 0.2, d, /sint/.test(tipo) ? '#2f9a4a' : '#4d9a3a', 0, 0.3, 0)
      .caja(w, 0.05, 0.4, linea, 0, 0.5, d / 2 - 0.2).caja(w, 0.05, 0.4, linea, 0, 0.5, -d / 2 + 0.2)
      .caja(0.4, 0.05, d, linea, w / 2 - 0.2, 0.5, 0).caja(0.4, 0.05, d, linea, -w / 2 + 0.2, 0.5, 0)
      .caja(0.3, 0.05, d, linea, 0, 0.5, 0).oval(4.5, 4.5, 0.05, linea, 0, 0.5, 0, 0.9)
      .caja(0.3, 0.05, 11, linea, w / 2 - 3, 0.5, 0).caja(0.3, 0.05, 11, linea, -w / 2 + 3, 0.5, 0);
    for (const s of [-1, 1]) {
      const x = s * (w / 2);
      e.caja(0.3, 2.4, 0.3, linea, x, 0.5, -3.7).caja(0.3, 2.4, 0.3, linea, x, 0.5, 3.7).caja(0.3, 0.3, 7.7, linea, x, 2.6, 0);
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

/** El edificio que representa a un punto de interés según su categoría y su tipo de lugar. */
export function modelarEquipamiento(c: CategoriaCatalogo, tipo: string, nombre: string, rnd: () => number): Modelo {
  const e = new Ensamble();
  const t = `${tipo} ${nombre}`.toLowerCase();
  switch (c) {
    case 'industria': return fabrica(e);
    case 'vivienda': return vivienda(e);
    case 'vehiculos': return /avi[oó]n/.test(t) ? { piezas: [], radio: 42 } : /moto/.test(t) ? moto(e) : auto(e);    // el avión es un modelo .glb que carga el catálogo
    case 'vias': return /puente/.test(t) ? puente(e, /principal/.test(t) ? 34 : 13) : tramo(e, /principal/.test(t) ? 'principal' : /local/.test(t) ? 'local' : 'sendero');
    case 'agua': return tramo(e, /quebrada/.test(t) ? 'quebrada' : 'rio');
    case 'naturaleza':
      if (/p[aá]jaro|garza/.test(t)) return pajaro(e);
      if (/sam[aá]n/.test(t)) return arbolRegional(e, 'saman');
      if (/guayac/.test(t)) return arbolRegional(e, 'guayacan');
      if (/yarumo/.test(t)) return arbolRegional(e, 'yarumo');
      if (/ceiba/.test(t)) return arbolRegional(e, 'ceiba');
      return arbol(e);
    case 'educacion': return escuela(e, /rural/i.test(tipo));
    case 'cultura': return cultura(e, t);
    case 'salud': return salud(e, t);
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

/** Vivienda típica del mapa: la huella del predio extruida, con paredes claras y un techo plano de color. */
function vivienda(e: Ensamble): Modelo {
  e.caja(10, 6, 8, '#f3e8d6', 0, 0, 0).caja(10.2, 0.5, 8.2, '#c8704f', 0, 6, 0);
  return { piezas: e.piezas, radio: 8, losa: [12, 10] };
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
function auto(e: Ensamble): Modelo {
  const ROJO = '#ff2d2d', GRIS = '#d3d8dd', OSCURO = '#2b2f36';
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
  return { piezas: e.piezas, radio: 10 };
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

export type CategoriaCatalogo = CategoriaPunto | 'industria' | 'vivienda' | 'vehiculos' | 'vias' | 'agua' | 'naturaleza';

/** Un ejemplo de cada edificio distinto, con un punto real de Girardota como muestra, para el catálogo. */
export interface Variante { categoria: CategoriaCatalogo; etiqueta: string; tipo: string; nombre: string; }
export const VARIANTES: Variante[] = [
  { categoria: 'industria', etiqueta: 'Fábrica', tipo: 'Industria', nombre: 'Fábrica' },
  { categoria: 'vivienda', etiqueta: 'Vivienda típica', tipo: 'Vivienda', nombre: 'Vivienda' },
  { categoria: 'vehiculos', etiqueta: 'Auto', tipo: 'Vehículo', nombre: 'Auto' },
  { categoria: 'vehiculos', etiqueta: 'Moto', tipo: 'Vehículo', nombre: 'Moto' },
  { categoria: 'vehiculos', etiqueta: 'Avión (Boeing 787)', tipo: 'Vehículo', nombre: 'Avión' },
  { categoria: 'vias', etiqueta: 'Vía principal', tipo: 'Vía', nombre: 'principal' },
  { categoria: 'vias', etiqueta: 'Vía local', tipo: 'Vía', nombre: 'local' },
  { categoria: 'vias', etiqueta: 'Sendero', tipo: 'Vía', nombre: 'sendero' },
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
  { categoria: 'educacion', etiqueta: 'Sede urbana', tipo: 'Sede educativa urbana', nombre: 'I. E. Colombia' },
  { categoria: 'educacion', etiqueta: 'Sede rural', tipo: 'Sede educativa rural', nombre: 'E R La Manga' },
  { categoria: 'cultura', etiqueta: 'Casa de la cultura', tipo: 'Casa de cultura', nombre: 'Pedrito Ruiz' },
  { categoria: 'cultura', etiqueta: 'Biblioteca', tipo: 'Biblioteca', nombre: 'Biblioteca pública' },
  { categoria: 'cultura', etiqueta: 'Escuela de música / escenario', tipo: 'Escuela de música', nombre: 'Escuela de música' },
  { categoria: 'cultura', etiqueta: 'Emisora', tipo: 'Emisora comunitaria', nombre: 'Radio Alternativa' },
  { categoria: 'salud', etiqueta: 'Hospital', tipo: 'Hospital / IPS pública', nombre: 'Hospital San Rafael' },
  { categoria: 'salud', etiqueta: 'Centro de salud', tipo: 'Optometría', nombre: 'Centro de salud' },
  { categoria: 'turismo', etiqueta: 'Iglesia', tipo: 'Patrimonio religioso / arquitectónico', nombre: 'Catedral' },
  { categoria: 'turismo', etiqueta: 'Parque', tipo: 'Espacio público / encuentro ciudadano', nombre: 'Parque principal' },
  { categoria: 'turismo', etiqueta: 'Mirador', tipo: 'Atractivo natural / ecoturismo', nombre: 'Cascada' },
  { categoria: 'turismo', etiqueta: 'Mercado', tipo: 'Economía campesina / mercado local', nombre: 'Mercado agroverde' },
  { categoria: 'turismo', etiqueta: 'Truchera', tipo: 'Turismo rural / pesca deportiva', nombre: 'Truchera' },
  { categoria: 'turismo', etiqueta: 'Petroglifos', tipo: 'Patrimonio arqueológico / cultural', nombre: 'Petroglifos' },
  { categoria: 'deporte', etiqueta: 'Cancha de fútbol', tipo: 'Cancha de fútbol', nombre: 'Cancha' },
  { categoria: 'deporte', etiqueta: 'Cancha sintética', tipo: 'Cancha sintética', nombre: 'Cancha' },
  { categoria: 'deporte', etiqueta: 'Placa polideportiva', tipo: 'Placa polideportiva', nombre: 'Placa' },
  { categoria: 'deporte', etiqueta: 'Pista de patinaje', tipo: 'Pista de patinaje', nombre: 'Pista' },
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
