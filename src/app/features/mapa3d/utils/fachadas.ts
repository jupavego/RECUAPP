import * as THREE from 'three';

/** Píxeles de textura por metro de fachada. */
export const PX_POR_M = 64;

/** Cómo se pinta una fachada: colores y qué lleva cada planta. */
export interface EstiloFachada {
  pared: string;
  zocalo: string;
  /** color de marcos de ventanas y puertas */
  marcos: string;
  puerta: string;
  /** rejas de hierro en las ventanas de la planta baja */
  reja: boolean;
  /** persianas enrollables en las ventanas de los pisos altos */
  persiana: boolean;
  /** vidrio de las ventanas */
  vidrio: string;
}

const hash = (n: number): number => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

function lienzo(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(w));
  c.height = Math.max(8, Math.round(h));
  return [c, c.getContext('2d')!];
}

function aTextura(c: HTMLCanvasElement, repetir = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repetir) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Mezcla un color con negro (f < 0) o con blanco (f > 0). */
const matiz = (hex: string, f: number): string => {
  const c = new THREE.Color(hex);
  return `#${c.lerp(new THREE.Color(f < 0 ? '#000000' : '#ffffff'), Math.abs(f)).getHexString()}`;
};

/** Revoque: color liso con vetas de lluvia, manchas y un poco de grano. */
function revoque(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, semilla: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(60,40,20,0.10)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {                         // vetas verticales de agua
    const x = hash(semilla + i * 3.1) * w, largo = h * (0.2 + hash(semilla + i * 7.7) * 0.5);
    const v = ctx.createLinearGradient(0, 0, 0, largo);
    v.addColorStop(0, 'rgba(70,55,40,0.07)');
    v.addColorStop(1, 'rgba(70,55,40,0)');
    ctx.fillStyle = v;
    ctx.fillRect(x, 0, 2 + hash(semilla + i) * 5, largo);
  }
  for (let i = 0; i < w * h / 90; i++) {                 // grano
    ctx.fillStyle = hash(semilla + i * 1.7) > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(hash(semilla + i * 2.3) * w, hash(semilla + i * 5.9) * h, 1.5, 1.5);
  }
}

/** Ventana con marco, vidrio con reflejo, cruceta, antepecho y, si se pide, reja o persiana. */
function ventana(ctx: CanvasRenderingContext2D, cx: number, base: number, w: number, h: number, e: EstiloFachada, reja: boolean, persiana: boolean): void {
  const x = cx - w / 2, y = base - h, m = Math.max(3, w * 0.07);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';                    // sombra del hueco
  ctx.fillRect(x - 3, y - 3, w + 6, h + 4);
  ctx.fillStyle = e.marcos;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  const vid = ctx.createLinearGradient(x, y, x + w, y + h);
  vid.addColorStop(0, matiz(e.vidrio, 0.35));
  vid.addColorStop(0.55, e.vidrio);
  vid.addColorStop(1, matiz(e.vidrio, -0.45));
  ctx.fillStyle = vid;
  ctx.fillRect(x + m, y + m, w - 2 * m, h - 2 * m);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';              // reflejo en diagonal
  ctx.beginPath();
  ctx.moveTo(x + m, y + h * 0.55); ctx.lineTo(x + m + w * 0.5, y + m); ctx.lineTo(x + m + w * 0.72, y + m); ctx.lineTo(x + m, y + h * 0.85);
  ctx.fill();
  ctx.fillStyle = e.marcos;                              // cruceta y travesaño
  ctx.fillRect(cx - 1.5, y + m, 3, h - 2 * m);
  ctx.fillRect(x + m, y + h * 0.4, w - 2 * m, 3);
  if (persiana) {                                        // persiana a media altura
    ctx.fillStyle = matiz(e.pared, -0.18);
    ctx.fillRect(x + m, y + m, w - 2 * m, h * 0.28);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let k = 0; k < 6; k++) ctx.fillRect(x + m, y + m + k * (h * 0.28 / 6), w - 2 * m, 1.2);
  }
  ctx.fillStyle = matiz(e.pared, 0.42);                  // antepecho saliente
  ctx.fillRect(x - 5, base, w + 10, 5);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - 5, base + 5, w + 10, 2);
  if (reja) {                                            // reja de hierro con barrotes y travesaños
    ctx.fillStyle = '#26282b';
    for (let bx = x + 4; bx < x + w - 2; bx += 8) ctx.fillRect(bx, y - 1, 2, h + 2);
    ctx.fillRect(x - 2, y + h * 0.33, w + 4, 2.5);
    ctx.fillRect(x - 2, y + h * 0.7, w + 4, 2.5);
  }
}

/** Puerta-ventana que baja hasta el piso (la que da al balcón). */
function puertaBalcon(ctx: CanvasRenderingContext2D, cx: number, piso: number, w: number, h: number, e: EstiloFachada): void {
  const x = cx - w / 2, y = piso - h;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(x - 3, y - 3, w + 6, h + 3);
  ctx.fillStyle = e.marcos;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 2);
  const vid = ctx.createLinearGradient(x, y, x + w, y + h);
  vid.addColorStop(0, matiz(e.vidrio, 0.35));
  vid.addColorStop(1, matiz(e.vidrio, -0.4));
  ctx.fillStyle = vid;
  ctx.fillRect(x + 4, y + 4, w / 2 - 6, h - 8);
  ctx.fillRect(x + w / 2 + 2, y + 4, w / 2 - 6, h - 8);
  ctx.fillStyle = e.marcos;
  ctx.fillRect(x + 4, y + h * 0.62, w - 8, 3);
}

function puerta(ctx: CanvasRenderingContext2D, cx: number, piso: number, w: number, h: number, color: string, marco: string): void {
  const x = cx - w / 2, y = piso - h;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x - 4, y - 4, w + 8, h + 4);
  ctx.fillStyle = marco;
  ctx.fillRect(x - 3, y - 3, w + 6, h + 3);
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 2);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';                    // tableros
  for (const [px, py, pw, ph] of [[0.14, 0.08, 0.72, 0.36], [0.14, 0.52, 0.72, 0.4]]) ctx.strokeRect(x + w * px, y + h * py, w * pw, h * ph);
  ctx.fillStyle = '#e6c04a';
  ctx.beginPath(); ctx.arc(x + w * 0.82, y + h * 0.55, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b8b3a9';                              // escalón
  ctx.fillRect(x - 6, piso - 3, w + 12, 3);
}

function garaje(ctx: CanvasRenderingContext2D, cx: number, piso: number, w: number, h: number, color: string): void {
  const x = cx - w / 2, y = piso - h;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x - 4, y - 4, w + 8, h + 4);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let ly = y + 6; ly < piso; ly += 7) ctx.fillRect(x, ly, w, 1.5);
  ctx.fillStyle = 'rgba(180,215,235,0.55)';               // hilera de vidrios arriba
  for (let k = 0; k < 4; k++) ctx.fillRect(x + 6 + k * (w - 12) / 4, y + 5, (w - 12) / 4 - 4, 9);
}

function vitrina(ctx: CanvasRenderingContext2D, x: number, piso: number, w: number, h: number, e: EstiloFachada): void {
  ctx.fillStyle = '#2c2f33';
  ctx.fillRect(x - 3, piso - h - 3, w + 6, h + 3);
  const vid = ctx.createLinearGradient(x, piso - h, x + w, piso);
  vid.addColorStop(0, matiz(e.vidrio, 0.4));
  vid.addColorStop(1, matiz(e.vidrio, -0.35));
  ctx.fillStyle = vid;
  ctx.fillRect(x, piso - h, w, h);
  ctx.fillStyle = '#2c2f33';
  for (let k = 1; k < 3; k++) ctx.fillRect(x + k * w / 3 - 1.5, piso - h, 3, h);
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath(); ctx.moveTo(x, piso - h * 0.35); ctx.lineTo(x + w * 0.45, piso - h); ctx.lineTo(x + w * 0.62, piso - h); ctx.lineTo(x, piso - h * 0.08); ctx.fill();
  ctx.fillStyle = matiz(e.zocalo, -0.1);                  // base de la vitrina
  ctx.fillRect(x, piso - 14, w, 14);
}

/** Letrero del local: banda de color con bloques que imitan el texto. */
function letrero(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, semilla: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  let px = x + w * 0.12;
  for (let i = 0; px < x + w * 0.85; i++) {
    const lw = 6 + hash(semilla + i) * 14;
    ctx.fillRect(px, y + h * 0.28, lw, h * 0.44);
    px += lw + 4 + hash(semilla + i * 2) * 4;
  }
}

/** Planta baja de una casa, con garaje o con locales: una sola textura de lado a lado. */
export type PlantaBaja = 'casa' | 'garaje' | 'local';

export interface Fachadas {
  baja: THREE.CanvasTexture;
  alta: THREE.CanvasTexture;
  lateral: THREE.CanvasTexture;
  ciego: THREE.CanvasTexture;
  teja: THREE.CanvasTexture;
  baranda: THREE.CanvasTexture;
  toldo: THREE.CanvasTexture;
  /** posición de cada hueco de la fachada (m desde el centro), por si la geometría los necesita */
  bahias: number[];
}

/**
 * Pinta las texturas de un edificio de `ancho` × `fondo` m con `bahias` huecos por piso. La fachada baja y la alta ocupan todo el
 * ancho (no se repiten), de modo que la puerta y el garaje quedan en su sitio.
 */
/**
 * Teja de barro: hiladas de tejas curvas con el borde de abajo redondeado, cada una más clara en el lomo y oscura en los
 * costados, con sombra bajo la hilada de arriba. La hilada de arriba tapa a la de abajo, así que se pinta de abajo hacia arriba;
 * se pinta una hilada de más a cada lado para que la textura repita sin costura. El borde de abajo del lienzo es el alero.
 */
function pintarTeja(x: CanvasRenderingContext2D, T: number, semilla: number): void {
  const COLS = 3, w = T / COLS, paso = T / 3, largo = paso * 1.7;
  const azar = (i: number, j: number) => { const s = Math.sin((i * 12.9898 + j * 78.233 + semilla) * 43758.5453); return s - Math.floor(s); };
  const base = ['#c8683a', '#bf5d33', '#d07845', '#b85530', '#c9703f'];
  x.fillStyle = '#5a2412'; x.fillRect(0, 0, T, T);
  for (let fila = 4; fila >= -1; fila--) {
    const yFin = (fila + 1) * paso;                     // borde visible (abajo) de esta hilada
    for (let c = -1; c <= COLS; c++) {
      const x0 = c * w + w * 0.04, ancho = w * 0.92, y0 = yFin - largo, r = ancho / 2;
      const cc = ((c % COLS) + COLS) % COLS, ff = ((fila % 3) + 3) % 3;
      const color = base[Math.floor(azar(cc, ff) * base.length)];
      const forma = () => {
        x.beginPath();
        x.moveTo(x0, y0); x.lineTo(x0 + ancho, y0); x.lineTo(x0 + ancho, yFin - r);
        x.arc(x0 + r, yFin - r, r, 0, Math.PI);
        x.closePath();
      };
      x.save();
      x.shadowColor = 'rgba(40,12,4,0.55)'; x.shadowBlur = 5; x.shadowOffsetY = 3;
      forma();
      const g = x.createLinearGradient(x0, 0, x0 + ancho, 0);
      g.addColorStop(0, matiz(color, -0.38)); g.addColorStop(0.3, matiz(color, 0.12)); g.addColorStop(0.55, matiz(color, 0.2)); g.addColorStop(1, matiz(color, -0.4));
      x.fillStyle = g; x.fill();
      x.restore();
      forma();
      x.strokeStyle = 'rgba(60,20,8,0.45)'; x.lineWidth = 1.2; x.stroke();
      x.fillStyle = `rgba(${azar(cc + 3, ff) < 0.3 ? '90,70,40' : '255,235,200'},0.07)`;       // veladura de polvo o de sol
      x.fillRect(x0, y0, ancho, largo);
    }
  }
}

export function crearFachadas(e: EstiloFachada, ancho: number, fondo: number, altoPiso: number, bahias: number, planta: PlantaBaja, balcones: boolean, semilla: number, colorToldo = '#c0392b'): Fachadas {
  const W = ancho * PX_POR_M, H = altoPiso * PX_POR_M, bw = W / bahias;
  const cx = (i: number) => bw * (i + 0.5);
  const centros = Array.from({ length: bahias }, (_, i) => (i + 0.5) * ancho / bahias - ancho / 2);

  // planta baja
  const [cb, xb] = lienzo(W, H);
  revoque(xb, W, H, e.pared, semilla);
  xb.fillStyle = e.zocalo; xb.fillRect(0, H - 0.9 * PX_POR_M, W, 0.9 * PX_POR_M);   // zócalo pintado
  xb.fillStyle = 'rgba(0,0,0,0.18)'; xb.fillRect(0, H - 0.9 * PX_POR_M, W, 2);
  if (planta === 'casa') {
    const p = Math.floor(bahias / 2);
    for (let i = 0; i < bahias; i++) {
      if (i === p) puerta(xb, cx(i), H, 1.0 * PX_POR_M, 2.15 * PX_POR_M, e.puerta, e.marcos);
      else ventana(xb, cx(i), H - 0.95 * PX_POR_M, 1.15 * PX_POR_M, 1.3 * PX_POR_M, e, e.reja, false);
    }
  } else if (planta === 'garaje') {
    garaje(xb, cx(0), H, Math.min(2.8 * PX_POR_M, bw * 0.92), 2.2 * PX_POR_M, matiz(e.zocalo, 0.25));
    for (let i = 1; i < bahias - 1; i++) ventana(xb, cx(i), H - 0.95 * PX_POR_M, 1.15 * PX_POR_M, 1.3 * PX_POR_M, e, e.reja, false);
    puerta(xb, cx(bahias - 1), H, 1.1 * PX_POR_M, 2.2 * PX_POR_M, e.puerta, e.marcos);
  } else {
    const dentro = (i: number) => i < bahias - 1;
    for (let i = 0; i < bahias; i++) {
      if (dentro(i)) vitrina(xb, bw * i + bw * 0.06, H, bw * 0.88, 2.2 * PX_POR_M, e);
      else puerta(xb, cx(i), H, 1.05 * PX_POR_M, 2.2 * PX_POR_M, e.puerta, e.marcos);
    }
    for (let i = 0; i < bahias - 1; i++) letrero(xb, bw * i + bw * 0.06, H - 2.2 * PX_POR_M - 0.62 * PX_POR_M, bw * 0.88, 0.5 * PX_POR_M, matiz(e.zocalo, i % 2 ? 0.1 : -0.1), semilla + i * 9);
  }

  // pisos altos: una fila que se repite hacia arriba
  const [ca, xa] = lienzo(W, H);
  revoque(xa, W, H, e.pared, semilla + 50);
  for (let i = 0; i < bahias; i++) {
    if (balcones) puertaBalcon(xa, cx(i), H - 0.0 * PX_POR_M, Math.min(1.1 * PX_POR_M, bw * 0.5), 2.1 * PX_POR_M, e);
    else ventana(xa, cx(i), H - 0.95 * PX_POR_M, 1.15 * PX_POR_M, 1.35 * PX_POR_M, e, false, e.persiana);
  }
  xa.fillStyle = 'rgba(255,255,255,0.35)';                 // moldura que marca la losa
  xa.fillRect(0, 0, W, 4);

  // costado: ventanas pequeñas, una cada ~3 m
  const WL = fondo * PX_POR_M;
  const [cl, xl] = lienzo(WL, H);
  revoque(xl, WL, H, e.pared, semilla + 90);
  for (let k = 0; k < Math.floor(fondo / 3.4); k++) ventana(xl, (k + 0.5) * WL / Math.floor(fondo / 3.4), H - 1.0 * PX_POR_M, 1.0 * PX_POR_M, 1.2 * PX_POR_M, e, false, false);

  // muro ciego (para los cuerpos)
  const [cc, xc] = lienzo(256, 256);
  revoque(xc, 256, 256, e.pared, semilla + 130);

  // teja de barro: franjas de canal y cubierta con hiladas
  const [ct, xt] = lienzo(192, 192);
  pintarTeja(xt, 192, semilla);

  // baranda calada: barrotes y pasamanos sobre fondo transparente (se tiñe con el color de la pieza)
  const [cr, xr] = lienzo(128, 64);
  xr.fillStyle = '#ffffff';
  xr.fillRect(0, 2, 128, 6);                                // pasamanos
  xr.fillRect(0, 54, 128, 6);                               // base
  for (let x = 6; x < 128; x += 16) xr.fillRect(x, 8, 4, 46);
  xr.fillRect(0, 30, 128, 3);

  // toldo a rayas
  const [cd, xd] = lienzo(128, 64);
  for (let i = 0; i < 8; i++) { xd.fillStyle = i % 2 ? '#f3efe6' : colorToldo; xd.fillRect(i * 16, 0, 16, 64); }

  const t = {
    baja: aTextura(cb, false), alta: aTextura(ca), lateral: aTextura(cl, false), ciego: aTextura(cc), teja: aTextura(ct),
    baranda: aTextura(cr), toldo: aTextura(cd), bahias: centros,
  };
  t.alta.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

/** Qué se ve dentro del local por la vitrina o la puerta abierta. */
export type Interior = 'viveres' | 'botellas' | 'pan' | 'frutas' | 'carne' | 'botica' | 'herramientas' | 'peluqueria' | 'mesas' | 'papel' | 'helado' | 'licor';

/** Un negocio: lo que dice el letrero y cómo se ve el frente. */
export interface NegocioDef {
  nombre: string;
  subtitulo: string;
  fondo: string;
  tinta: string;
  frente: 'vitrina' | 'abierto' | 'reja';
  interior: Interior;
  /** texto corto de la bandera que sale perpendicular a la fachada */
  bandera: string;
}

const COLORES_PRODUCTO = ['#d93025', '#f9ab00', '#188038', '#1a73e8', '#f5f5f5', '#8e24aa'];

/** Estantes con la mercancía del local, en el hueco (x, y, w, h) de la vitrina. */
function mercancia(ctx: CanvasRenderingContext2D, tipo: Interior, x: number, y: number, w: number, h: number, s: number): void {
  const fondo = ctx.createLinearGradient(0, y, 0, y + h);
  fondo.addColorStop(0, '#3a2a1e'); fondo.addColorStop(1, '#1f1812');
  ctx.fillStyle = fondo; ctx.fillRect(x, y, w, h);
  const pintar = (filas: number, base: number, item: (px: number, py: number, k: number) => number) => {
    for (let f = 0; f < filas; f++) {
      const py = y + h * (base + (1 - base) * (f + 1) / filas) - 5;
      for (let px = x + 6, k = f * 40; px < x + w - 8; k++) px += item(px, py, k);
      ctx.fillStyle = '#6b4a2c'; ctx.fillRect(x, py, w, 4);
    }
  };
  switch (tipo) {
    case 'viveres': pintar(3, 0.05, (px, py, k) => { const bw = 9 + hash(s + k) * 9, bh = 12 + hash(s + k * 2) * 12; ctx.fillStyle = COLORES_PRODUCTO[Math.floor(hash(s + k * 3) * 6)]; ctx.fillRect(px, py - bh, bw, bh); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(px + 1, py - bh + 3, bw - 2, 3); return bw + 2; }); break;
    case 'botellas': case 'licor': pintar(tipo === 'licor' ? 4 : 3, 0.05, (px, py, k) => { const bh = 18 + hash(s + k * 2) * 12; ctx.fillStyle = ['#2e7d32', '#b26a00', '#c8e6c9', '#5d4037', '#d32f2f'][Math.floor(hash(s + k) * 5)]; ctx.fillRect(px, py - bh, 6, bh); ctx.fillRect(px + 2, py - bh - 7, 2, 7); return 9; }); break;
    case 'pan': pintar(3, 0.1, (px, py, k) => { ctx.fillStyle = ['#c68642', '#e0a458', '#a86a2c', '#f0c987'][Math.floor(hash(s + k) * 4)]; ctx.beginPath(); ctx.ellipse(px + 9, py - 6, 10, 6, 0, 0, Math.PI * 2); ctx.fill(); return 22; }); break;
    case 'frutas': pintar(2, 0.35, (px, py, k) => { ctx.fillStyle = ['#d32f2f', '#f57c00', '#7cb342', '#fdd835', '#6a1b9a', '#2e7d32'][Math.floor(hash(s + k) * 6)]; ctx.beginPath(); ctx.arc(px + 6, py - 6, 6, 0, Math.PI * 2); ctx.fill(); return 12; }); break;
    case 'carne':
      ctx.fillStyle = '#c9c9c9'; ctx.fillRect(x, y + h * 0.12, w, 3);
      for (let px = x + 10, k = 0; px < x + w - 10; px += 26, k++) { ctx.fillStyle = '#b3261e'; ctx.fillRect(px, y + h * 0.15, 14, 30 + hash(s + k) * 20); ctx.fillStyle = '#f2c8bf'; ctx.fillRect(px + 2, y + h * 0.15, 3, 26); }
      ctx.fillStyle = '#eceff1'; ctx.fillRect(x, y + h * 0.72, w, h * 0.28);
      break;
    case 'botica': pintar(3, 0.05, (px, py, k) => { const bw = 8 + hash(s + k) * 8; ctx.fillStyle = '#fafafa'; ctx.fillRect(px, py - 14, bw, 14); ctx.fillStyle = hash(s + k * 3) > 0.5 ? '#0b8f3c' : '#1a73e8'; ctx.fillRect(px, py - 9, bw, 4); return bw + 2; });
      ctx.fillStyle = '#0b8f3c'; ctx.fillRect(x + w * 0.5 - 4, y + h * 0.08, 8, 24); ctx.fillRect(x + w * 0.5 - 12, y + h * 0.08 + 8, 24, 8); break;
    case 'herramientas': pintar(3, 0.05, (px, py, k) => { ctx.fillStyle = ['#e85d04', '#9e9e9e', '#f9ab00', '#1565c0', '#212121'][Math.floor(hash(s + k) * 5)]; const bh = 10 + hash(s + k * 2) * 16; ctx.fillRect(px, py - bh, 5 + hash(s + k * 4) * 8, bh); return 12; }); break;
    case 'peluqueria':
      for (const mx of [0.18, 0.62]) { ctx.fillStyle = '#cfd8dc'; ctx.fillRect(x + w * mx, y + h * 0.12, w * 0.2, h * 0.5); ctx.fillStyle = '#90a4ae'; ctx.fillRect(x + w * mx + 3, y + h * 0.12 + 3, w * 0.2 - 6, h * 0.5 - 6); ctx.fillStyle = '#b71c1c'; ctx.fillRect(x + w * (mx + 0.05), y + h * 0.66, w * 0.1, h * 0.2); }
      break;
    case 'mesas':
      ctx.fillStyle = 'rgba(255,214,120,0.5)'; ctx.fillRect(x, y, w, h * 0.12);
      for (let px = x + w * 0.16, k = 0; px < x + w - 20; px += w * 0.3, k++) { ctx.fillStyle = k % 2 ? '#fafafa' : '#c62828'; ctx.fillRect(px - 16, y + h * 0.62, 32, 5); ctx.fillStyle = '#4e342e'; ctx.fillRect(px - 2, y + h * 0.62, 4, h * 0.3); ctx.fillRect(px - 22, y + h * 0.7, 5, h * 0.22); ctx.fillRect(px + 17, y + h * 0.7, 5, h * 0.22); }
      break;
    case 'papel': pintar(3, 0.05, (px, py, k) => { ctx.fillStyle = COLORES_PRODUCTO[Math.floor(hash(s + k) * 6)]; const bh = 14 + hash(s + k * 2) * 8; ctx.fillRect(px, py - bh, 11, bh); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(px + 2, py - bh + 3, 7, 5); return 13; }); break;
    case 'helado':
      ctx.fillStyle = '#eceff1'; ctx.fillRect(x, y + h * 0.55, w, h * 0.45);
      for (let px = x + 14, k = 0; px < x + w - 12; px += 24, k++) { ctx.fillStyle = ['#f48fb1', '#fff59d', '#a5d6a7', '#80deea', '#ffab91', '#ce93d8'][k % 6]; ctx.beginPath(); ctx.arc(px, y + h * 0.5, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#d7a86e'; ctx.beginPath(); ctx.moveTo(px - 6, y + h * 0.52); ctx.lineTo(px + 6, y + h * 0.52); ctx.lineTo(px, y + h * 0.52 + 16); ctx.fill(); }
      break;
  }
}

/**
 * Fachada comercial típica: letrero grande con el nombre y la línea de productos, vitrina o puerta abierta con la mercancía a la
 * vista, puerta y zócalo; más la bandera que sale a la calle. La planta baja ocupa todo el ancho.
 */
export function fachadaNegocio(n: NegocioDef, ancho: number, altoPiso: number, e: EstiloFachada, semilla: number): { baja: THREE.CanvasTexture; bandera: THREE.CanvasTexture } {
  const W = ancho * PX_POR_M, H = altoPiso * PX_POR_M;
  const [c, x] = lienzo(W, H);
  pintarFrenteNegocio(x, W, H, n, e, semilla);
  const [cb, xb] = lienzo(256, 96);
  xb.fillStyle = n.fondo; xb.fillRect(0, 0, 256, 96);
  xb.strokeStyle = n.tinta; xb.lineWidth = 5; xb.strokeRect(6, 6, 244, 84);
  xb.fillStyle = n.tinta; xb.textAlign = 'center'; xb.textBaseline = 'middle';
  let fs = 52; xb.font = `900 ${fs}px "Arial Black", Impact, sans-serif`;
  while (xb.measureText(n.bandera).width > 220 && fs > 10) { fs -= 2; xb.font = `900 ${fs}px "Arial Black", Impact, sans-serif`; }
  xb.fillText(n.bandera, 128, 50);
  return { baja: aTextura(c, false), bandera: aTextura(cb, false) };
}

/** Pinta en (0,0)-(W,H) del contexto el frente de un negocio: muro, letrero, vitrina con mercancía y puerta. */
function pintarFrenteNegocio(x: CanvasRenderingContext2D, W: number, H: number, n: NegocioDef, e: EstiloFachada, semilla: number): void {
  revoque(x, W, H, e.pared, semilla);
  x.fillStyle = e.zocalo; x.fillRect(0, H - 0.45 * PX_POR_M, W, 0.45 * PX_POR_M);

  const sx = 0.25 * PX_POR_M, sy = 0.12 * PX_POR_M, sw = W - 0.5 * PX_POR_M, sh = 0.85 * PX_POR_M;
  x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(sx + 3, sy + 5, sw, sh);
  x.fillStyle = n.fondo; x.fillRect(sx, sy, sw, sh);
  x.strokeStyle = n.tinta; x.lineWidth = 2.5; x.strokeRect(sx + 6, sy + 6, sw - 12, sh - 12);
  x.fillStyle = n.tinta; x.textAlign = 'center'; x.textBaseline = 'middle';
  const texto = (t: string, px: number, cy: number, peso: string, fam: string) => {
    let fs = px; x.font = `${peso} ${fs}px ${fam}`;
    while (x.measureText(t).width > sw * 0.88 && fs > 8) { fs -= 2; x.font = `${peso} ${fs}px ${fam}`; }
    x.fillText(t, sx + sw / 2, cy);
  };
  texto(n.nombre.toUpperCase(), sh * 0.5, sy + sh * 0.4, '900', '"Arial Black", Impact, sans-serif');
  texto(n.subtitulo, sh * 0.2, sy + sh * 0.76, '700', 'Arial, sans-serif');

  // frente: vitrina a la izquierda y puerta a la derecha
  const pw = 1.1 * PX_POR_M, wx = 0.35 * PX_POR_M, wy = sy + sh + 0.22 * PX_POR_M;
  const ww = W - pw - 0.35 * PX_POR_M - wx - 0.3 * PX_POR_M, wh = H - 0.45 * PX_POR_M - wy;
  x.fillStyle = '#2c2f33'; x.fillRect(wx - 4, wy - 4, ww + 8, wh + 4);
  mercancia(x, n.interior, wx, wy, ww, wh, semilla);
  if (n.frente === 'abierto') {
    x.fillStyle = '#8b9096'; x.fillRect(wx, wy, ww, wh * 0.16);                            // persiana enrollada arriba
    x.fillStyle = 'rgba(0,0,0,0.25)'; for (let ly = wy + 4; ly < wy + wh * 0.16; ly += 5) x.fillRect(wx, ly, ww, 1.2);
  } else {
    const vid = x.createLinearGradient(wx, wy, wx + ww, wy + wh);
    vid.addColorStop(0, 'rgba(190,225,245,0.35)'); vid.addColorStop(0.5, 'rgba(150,190,215,0.12)'); vid.addColorStop(1, 'rgba(60,90,115,0.3)');
    x.fillStyle = vid; x.fillRect(wx, wy, ww, wh);
    x.fillStyle = 'rgba(255,255,255,0.2)';
    x.beginPath(); x.moveTo(wx, wy + wh * 0.7); x.lineTo(wx + ww * 0.3, wy); x.lineTo(wx + ww * 0.42, wy); x.lineTo(wx, wy + wh * 0.95); x.fill();
    x.fillStyle = '#2c2f33'; const k = Math.max(2, Math.round(ww / (1.7 * PX_POR_M)));
    for (let i = 1; i < k; i++) x.fillRect(wx + i * ww / k - 1.5, wy, 3, wh);
    if (n.frente === 'reja') {                                                              // reja metálica de seguridad
      x.fillStyle = '#26282b';
      for (let bx = wx + 4; bx < wx + ww - 2; bx += 9) x.fillRect(bx, wy, 2, wh);
      x.fillRect(wx, wy + wh * 0.5, ww, 2.5);
    }
  }
  x.fillStyle = e.zocalo; x.fillRect(wx - 4, wy + wh - 2, ww + 8, 0.45 * PX_POR_M + 2);
  puerta(x, W - 0.3 * PX_POR_M - pw / 2, H, pw, H - wy, e.puerta, e.marcos);
}

/**
 * Atlas único con todas las fachadas del mapa: a la izquierda las celdas de un hueco (4,4 × 6,6 m, 128 × 192 px), una por tipo
 * y por paleta; a la derecha los frentes de negocio (8,8 × 6,6 m, 256 × 192 px) con letrero y mercancía. Todos los edificios
 * comparten esta textura, así que el costo es una sola imagen y una sola malla por tesela.
 */
const ESC_ATLAS = 1.5;                                  // píxeles reales por píxel de dibujo: celdas más nítidas sin cambiar los trazos
export const CELDA_W = 128 * ESC_ATLAS, CELDA_H = 192 * ESC_ATLAS, LOCAL_W = 256 * ESC_ATLAS;
export const ATLAS_W = 2048 * ESC_ATLAS, ATLAS_H = 1152 * ESC_ATLAS;
export const TIPOS_BAHIA = ['ventanaBaja', 'puerta', 'garaje', 'ventana', 'balcon', 'persiana', 'doble', 'ciego'] as const;
export const COLUMNAS_LOCAL = 4;
const X_LOCAL = 1024 * ESC_ATLAS;

/** Cinco paletas de la región: cal y ladrillo, añil, amarillo y rojo, rosa y verde, y gris de edificio. */
export const PALETAS_ATLAS: EstiloFachada[] = [
  { pared: '#fbfaf5', zocalo: '#a8553a', marcos: '#2f6b4a', puerta: '#d9a21b', reja: true, persiana: false, vidrio: '#d9a21b' },
  { pared: '#f6f0e2', zocalo: '#25508a', marcos: '#25508a', puerta: '#1f3f6e', reja: true, persiana: false, vidrio: '#8fb8d0' },
  { pared: '#f2dfa5', zocalo: '#a3382c', marcos: '#a3382c', puerta: '#5b3a22', reja: false, persiana: true, vidrio: '#9cc4d8' },
  { pared: '#f1d6cf', zocalo: '#3d7a58', marcos: '#3d7a58', puerta: '#3d7a58', reja: true, persiana: false, vidrio: '#8fb8d0' },
  { pared: '#dad4c6', zocalo: '#7a4b32', marcos: '#4b5563', puerta: '#374151', reja: false, persiana: true, vidrio: '#7fa9c2' },
];

/** Negocios del atlas: tipo, nombres posibles y colores. Cada tipo ocupa dos celdas con letreros distintos. */
export const NEGOCIOS_ATLAS: { frente: NegocioDef['frente']; interior: Interior; subtitulo: string; bandera: string; nombres: string[]; letreros: [string, string][] }[] = [
  { frente: 'reja', interior: 'viveres', subtitulo: 'Víveres · Abarrotes · Gaseosas', bandera: 'TIENDA', nombres: ['Tienda La Esperanza', 'Tienda Doña Rosa', 'Víveres El Vecino'], letreros: [['#d62828', '#ffffff'], ['#f4a300', '#2b1d00']] },
  { frente: 'vitrina', interior: 'pan', subtitulo: 'Pan caliente · Pasteles · Café', bandera: 'PAN', nombres: ['Panadería El Trigal', 'Pan y Café La Abuela', 'Delicias del Horno'], letreros: [['#7a3b1d', '#ffe9b0'], ['#2f5d46', '#ffe9b0']] },
  { frente: 'abierto', interior: 'botellas', subtitulo: 'Cerveza fría · Billar · Música', bandera: 'BAR', nombres: ['Cantina La Hamaca', 'Bar El Rincón Paisa', 'Taberna El Parche'], letreros: [['#1b1f3b', '#ffd23f'], ['#6a1b1b', '#ffe08a']] },
  { frente: 'vitrina', interior: 'botica', subtitulo: 'Medicamentos · Cosméticos · 24 h', bandera: 'DROGUERÍA', nombres: ['Droguería San Jorge', 'Droguería La Salud', 'Droguería Mi Salud'], letreros: [['#ffffff', '#0b8f3c'], ['#0b8f3c', '#ffffff']] },
  { frente: 'abierto', interior: 'herramientas', subtitulo: 'Herramientas · Pinturas · Materiales', bandera: 'FERRETERÍA', nombres: ['Ferretería El Tornillo', 'Ferretería La Obra', 'Depósito El Maestro'], letreros: [['#f2b705', '#1a1a1a'], ['#1d3557', '#ffd23f']] },
  { frente: 'vitrina', interior: 'mesas', subtitulo: 'Almuerzos · Bandeja paisa · Jugos', bandera: 'COMIDA', nombres: ['Restaurante Sabor Paisa', 'Corrientazo Doña Marta', 'Fonda La Antioqueña'], letreros: [['#a3382c', '#ffe9b0'], ['#2f5d46', '#fff3c4']] },
  { frente: 'vitrina', interior: 'peluqueria', subtitulo: 'Corte · Barba · Manicure', bandera: 'BARBERÍA', nombres: ['Peluquería Estilo Paisa', 'Barbería El Corte', 'Salón de Belleza Luna'], letreros: [['#222222', '#f5c518'], ['#5b2a86', '#ffffff']] },
  { frente: 'abierto', interior: 'carne', subtitulo: 'Res · Cerdo · Pollo · Embutidos', bandera: 'CARNES', nombres: ['Carnicería El Novillo', 'Carnes La Finca', 'Carnicería San Pedro'], letreros: [['#b3261e', '#ffffff'], ['#7a1010', '#ffe9b0']] },
  { frente: 'abierto', interior: 'frutas', subtitulo: 'Frutas · Verduras · Hortalizas', bandera: 'FRUVER', nombres: ['Fruver La Cosecha', 'Frutas El Campo', 'Fruver Doña Lucía'], letreros: [['#2e8b3d', '#fff7b0'], ['#f28c28', '#ffffff']] },
  { frente: 'vitrina', interior: 'papel', subtitulo: 'Útiles · Fotocopias · Minutos', bandera: 'PAPELERÍA', nombres: ['Papelería El Estudiante', 'Miscelánea Mi Rincón', 'Variedades Sol'], letreros: [['#1e88e5', '#ffffff'], ['#e91e63', '#ffffff']] },
  { frente: 'vitrina', interior: 'helado', subtitulo: 'Helados · Cafés · Postres', bandera: 'HELADOS', nombres: ['Heladería Polo Norte', 'Café del Parque', 'Heladería Dulce Vida'], letreros: [['#f8bbd0', '#ad1457'], ['#4e342e', '#ffe0b2']] },
  { frente: 'reja', interior: 'licor', subtitulo: 'Aguardiente · Ron · Cerveza', bandera: 'LICORES', nombres: ['Licorera La 20', 'Estanco El Trago', 'Licores Don Pepe'], letreros: [['#111111', '#ffcc00'], ['#0d3b66', '#faf0ca']] },
];

/** Rectángulo (u0, v0, u1, v1) de una celda de hueco en el atlas, con medio píxel de margen para que no se cuele la vecina. */
export function celdaBahia(tipo: number, paleta: number): [number, number, number, number] {
  const x0 = tipo * CELDA_W, y0 = paleta * CELDA_H, m = 1.5;
  return [(x0 + m) / ATLAS_W, 1 - (y0 + CELDA_H - m) / ATLAS_H, (x0 + CELDA_W - m) / ATLAS_W, 1 - (y0 + m) / ATLAS_H];
}

/** Rectángulo de un frente de negocio (índice 0..23: tipo × 2 + variante). */
export function celdaLocal(i: number): [number, number, number, number] {
  const x0 = X_LOCAL + (i % COLUMNAS_LOCAL) * LOCAL_W, y0 = Math.floor(i / COLUMNAS_LOCAL) * CELDA_H, m = 1.5;
  return [(x0 + m) / ATLAS_W, 1 - (y0 + CELDA_H - m) / ATLAS_H, (x0 + LOCAL_W - m) / ATLAS_W, 1 - (y0 + m) / ATLAS_H];
}

/** Textura de teja de barro que se repite sobre los techos del mapa (3 tejas por repetición). */
export function crearTexturaTeja(): THREE.CanvasTexture {
  const [c, x] = lienzo(288, 288);
  pintarTeja(x, 288, 7);
  const t = aTextura(c);
  t.anisotropy = 8;
  return t;
}

export function crearAtlasFachadas(): THREE.CanvasTexture {
  const [c, x] = lienzo(ATLAS_W, ATLAS_H);
  x.fillStyle = '#d8d2c4'; x.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const W = 128, H = 192;                                // tamaño de dibujo de una celda
  PALETAS_ATLAS.forEach((e, p) => {
    TIPOS_BAHIA.forEach((tipo, t) => {
      x.save();
      x.translate(t * CELDA_W, p * CELDA_H);
      x.scale(ESC_ATLAS, ESC_ATLAS);
      x.beginPath(); x.rect(0, 0, W, H); x.clip();
      revoque(x, W, H, e.pared, p * 17 + t * 5);
      const baja = tipo === 'ventanaBaja' || tipo === 'puerta' || tipo === 'garaje';
      if (baja) { x.fillStyle = e.zocalo; x.fillRect(0, H - 34, W, 34); x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, H - 34, W, 2); }
      else { x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(0, 0, W, 4); }      // moldura que marca la losa
      const cx = W / 2, piso = baja ? H : H - 6;
      switch (tipo) {
        case 'ventanaBaja': ventana(x, cx, H - 52, 56, 96, e, e.reja, false); break;
        case 'puerta': puerta(x, cx, H, 54, 128, e.puerta, e.marcos); break;
        case 'garaje': garaje(x, cx, H, 96, 118, matiz(e.zocalo, 0.25)); break;
        case 'ventana': ventana(x, cx, piso - 52, 56, 96, e, false, false); break;
        case 'persiana': ventana(x, cx, piso - 52, 56, 96, e, false, true); break;
        case 'doble': ventana(x, cx - 24, piso - 52, 34, 90, e, false, false); ventana(x, cx + 24, piso - 52, 34, 90, e, false, false); break;
        case 'balcon':
          puertaBalcon(x, cx, piso - 20, 64, 118, e);
          x.fillStyle = matiz(e.pared, 0.55); x.fillRect(4, piso - 22, W - 8, 8);          // losa del balcón
          x.fillStyle = e.marcos;
          x.fillRect(4, piso - 62, W - 8, 4);
          for (let bx = 8; bx < W - 6; bx += 10) x.fillRect(bx, piso - 62, 2.5, 42);
          break;
      }
      x.restore();
    });
  });
  NEGOCIOS_ATLAS.forEach((n, t) => {
    for (let v = 0; v < 2; v++) {
      const i = t * 2 + v, [fondo, tinta] = n.letreros[v];
      const e = PALETAS_ATLAS[(t + v * 2) % PALETAS_ATLAS.length];
      x.save();
      x.translate(X_LOCAL + (i % COLUMNAS_LOCAL) * LOCAL_W, Math.floor(i / COLUMNAS_LOCAL) * CELDA_H);
      x.scale(ESC_ATLAS, ESC_ATLAS);
      x.beginPath(); x.rect(0, 0, 256, 192); x.clip();
      pintarFrenteNegocio(x, 256, 192, { nombre: n.nombres[(t + v) % n.nombres.length], subtitulo: n.subtitulo, fondo, tinta, frente: n.frente, interior: n.interior, bandera: n.bandera }, e, t * 7 + v);
      x.restore();
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

export function liberarFachadas(f: Fachadas): void {
  for (const t of [f.baja, f.alta, f.lateral, f.ciego, f.teja, f.baranda, f.toldo]) t.dispose();
}
