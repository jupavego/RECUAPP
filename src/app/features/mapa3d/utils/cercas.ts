import * as THREE from 'three';

/**
 * Cercas típicas de los linderos de los predios, pintadas en una sola textura con fondo transparente (se dibujan con recorte
 * por transparencia, sin geometría de postes ni barrotes). La textura se repite a lo largo del lindero cada PERIODO_CERCA metros;
 * cada tipo ocupa una fila.
 */
export const PERIODO_CERCA = 8;
export const TIPOS_CERCA = ['muroReja', 'muro', 'reja', 'porton', 'alambre', 'madera', 'malla', 'viva'] as const;
const W = 512, H = 128;

const hash = (n: number): number => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

/** Rango vertical (v0 abajo, v1 arriba) de un tipo en la textura, con un píxel de margen. */
export function filaCerca(tipo: number): [number, number] {
  const T = H * TIPOS_CERCA.length;
  return [1 - ((tipo + 1) * H - 1) / T, 1 - (tipo * H + 1) / T];
}

function pilastra(x: CanvasRenderingContext2D, px: number, y0: number): void {
  x.fillStyle = '#e9e4d8'; x.fillRect(px - 9, y0, 18, H - y0);
  x.fillStyle = 'rgba(0,0,0,0.16)'; x.fillRect(px + 4, y0, 5, H - y0);
  x.fillStyle = '#cfc9bb'; x.fillRect(px - 12, y0 - 5, 24, 6);
}

function muroLiso(x: CanvasRenderingContext2D, y0: number): void {
  x.fillStyle = '#f2efe6'; x.fillRect(0, y0, W, H - y0);
  x.fillStyle = 'rgba(0,0,0,0.07)';
  for (let i = 0; i < 70; i++) x.fillRect(hash(i) * W, y0 + hash(i * 3) * (H - y0), 2 + hash(i * 7) * 20, 1.5);   // manchas del repello
  x.fillStyle = '#cfc9bb'; x.fillRect(0, y0, W, 7);                                                              // remate
  x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, H - 16, W, 16);                                               // zócalo
}

function barrotes(x: CanvasRenderingContext2D, desde: number, hasta: number, y0: number, y1: number, punta: boolean): void {
  x.fillStyle = '#26282b';
  for (let bx = desde; bx < hasta; bx += 14) {
    x.fillRect(bx, y0, 4, y1 - y0);
    if (punta) { x.beginPath(); x.moveTo(bx - 2, y0 + 1); x.lineTo(bx + 2, y0 - 9); x.lineTo(bx + 6, y0 + 1); x.fill(); }
  }
  x.fillRect(desde - 2, y0, hasta - desde + 4, 5);
  x.fillRect(desde - 2, y1 - 12, hasta - desde + 4, 4);
}

const PINTORES: ((x: CanvasRenderingContext2D) => void)[] = [
  // muro bajo con reja de hierro arriba, entre pilastras
  x => {
    x.fillStyle = '#f2efe6'; x.fillRect(0, 74, W, 54);
    x.fillStyle = '#cfc9bb'; x.fillRect(0, 74, W, 6);
    x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, H - 14, W, 14);
    for (const px of [0, 128, 256, 384]) barrotes(x, px + 14, px + 114, 22, 74, true);
    for (const px of [0, 128, 256, 384, 512]) pilastra(x, px === 0 ? 9 : px === 512 ? W - 9 : px, 14);
  },
  // tapia alta de repello con pilastras
  x => { muroLiso(x, 20); for (const px of [9, 256, W - 9]) pilastra(x, px, 12); },
  // reja de hierro sobre un zócalo bajo
  x => {
    x.fillStyle = '#f2efe6'; x.fillRect(0, 108, W, 20);
    x.fillStyle = '#cfc9bb'; x.fillRect(0, 108, W, 4);
    for (const px of [0, 256]) barrotes(x, px + 12, px + 244, 16, 108, true);
    for (const px of [9, 256, W - 9]) pilastra(x, px, 10);
  },
  // tapia con portón metálico de garaje en el centro
  x => {
    muroLiso(x, 20);
    x.fillStyle = '#4a5560'; x.fillRect(164, 34, 184, 94);
    x.fillStyle = 'rgba(0,0,0,0.28)'; for (let ly = 44; ly < 126; ly += 9) x.fillRect(164, ly, 184, 2);
    x.fillStyle = '#2b333a'; x.fillRect(160, 30, 192, 6); x.fillRect(160, 30, 6, 98); x.fillRect(346, 30, 6, 98);
    x.fillStyle = '#e6c04a'; x.fillRect(250, 80, 12, 4);
    for (const px of [9, 146, 366, W - 9]) pilastra(x, px, 12);
  },
  // alambre de púas entre postes de madera
  x => {
    x.fillStyle = '#9aa0a6';
    for (const wy of [38, 60, 82, 104]) {
      x.fillRect(0, wy, W, 2.5);
      x.fillStyle = '#6b7075'; for (let bx = 8; bx < W; bx += 24) { x.fillRect(bx, wy - 3, 2, 8); x.fillRect(bx - 3, wy, 8, 2); }
      x.fillStyle = '#9aa0a6';
    }
    for (const px of [10, 138, 266, 394]) {
      x.fillStyle = '#6b4a2c'; x.fillRect(px - 6, 24, 12, H - 24);
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(px - 6, 24, 3, H - 24);
      x.fillStyle = '#4e351f'; x.fillRect(px - 6, 24, 12, 4);
    }
  },
  // cerca rústica de postes y tres tablas de madera
  x => {
    for (const [y0, y1] of [[34, 50], [62, 78], [90, 106]]) {
      x.fillStyle = '#8a5a32'; x.fillRect(0, y0, W, y1 - y0);
      x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(0, y1 - 3, W, 3);
      x.fillStyle = 'rgba(60,35,15,0.35)'; for (let gx = 0; gx < W; gx += 22) x.fillRect(gx + hash(gx + y0) * 12, y0 + 3 + hash(gx) * 8, 14, 1.5);
    }
    for (const px of [10, 266]) { x.fillStyle = '#6b4226'; x.fillRect(px - 8, 24, 16, H - 24); x.fillStyle = '#4e2f1a'; x.fillRect(px - 8, 24, 16, 5); }
  },
  // malla eslabonada con postes y travesaño
  x => {
    x.strokeStyle = 'rgba(150,158,165,0.85)'; x.lineWidth = 1.6;
    for (let gx = -H; gx < W + H; gx += 12) {
      x.beginPath(); x.moveTo(gx, 24); x.lineTo(gx + (H - 24), H); x.stroke();
      x.beginPath(); x.moveTo(gx + (H - 24), 24); x.lineTo(gx, H); x.stroke();
    }
    x.fillStyle = '#7d848a'; x.fillRect(0, 22, W, 5); x.fillRect(0, H - 6, W, 5);
    for (const px of [8, 264]) { x.fillStyle = '#6f777d'; x.fillRect(px - 5, 14, 10, H - 14); }
  },
  // cerca viva: seto denso y desigual
  x => {
    for (let i = 0; i < 520; i++) {
      const cx = hash(i * 1.7) * W, cy = 36 + hash(i * 2.9) * (H - 36), r = 9 + hash(i * 4.3) * 11;
      const g = 90 + Math.floor(hash(i * 5.1) * 70);
      x.fillStyle = `rgb(${40 + Math.floor(hash(i) * 30)},${g},${40 + Math.floor(hash(i * 6.7) * 25)})`;
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = 'rgb(46,110,48)'; x.fillRect(0, H - 40, W, 40);
  },
];

export function crearTexturaCercas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W; c.height = H * TIPOS_CERCA.length;
  const x = c.getContext('2d')!;
  PINTORES.forEach((pintar, t) => {
    x.save();
    x.translate(0, t * H);
    x.beginPath(); x.rect(0, 0, W, H); x.clip();
    pintar(x);
    x.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
