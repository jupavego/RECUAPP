import { Municipio, Zona } from '../services/mapa.service';

// Croquis en pasteles: cada municipio tiene un tono propio —no el de su subregión— y se reparten
// de modo que municipios vecinos no compartan tono. Dentro de un municipio, cada segmento
// (vereda o zona) recibe un degradado del mismo tono para poder distinguirlos entre sí.

export const SUBREGIONES = [
  'Bajo Cauca', 'Magdalena Medio', 'Nordeste', 'Norte', 'Occidente',
  'Oriente', 'Suroeste', 'Urabá', 'Valle de Aburrá',
];

/** Tonos (grados HSL) disponibles para los municipios. */
const TONOS = [352, 18, 38, 52, 84, 130, 160, 184, 206, 232, 262, 292, 322];

export const OPACIDAD_MUNICIPIO = 0.8;
export const OPACIDAD_SEGMENTO = 0.85;

export interface ColorMunicipio {
  /** tono base, en grados */
  h: number;
  relleno: string;
  contorno: string;
}

/** Google Maps espera colores hexadecimales; la paleta se define en HSL por comodidad. */
export function hex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const sat = s / 100, lum = l / 100;
  const a = sat * Math.min(lum, 1 - lum);
  const canal = (n: number) => {
    const k = (n + hh / 30) % 12;
    const c = lum - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${canal(0)}${canal(8)}${canal(4)}`;
}

function seTocan(a: Municipio, b: Municipio): boolean {
  if (!a.b || !b.b) return false;
  return a.b[0] <= b.b[2] && b.b[0] <= a.b[2] && a.b[1] <= b.b[3] && b.b[1] <= a.b[3];
}

/**
 * Un tono por municipio, coloreando como un grafo: vecinos (aproximados por la superposición de sus
 * cajas) nunca repiten tono mientras alcance la paleta, y entre los libres se reparte parejo.
 */
export function coloresPorMunicipio(municipios: Municipio[]): Map<number, ColorMunicipio> {
  const vecinos = new Map<number, number[]>();
  municipios.forEach(m => vecinos.set(
    m.id, municipios.filter(o => o.id !== m.id && seTocan(m, o)).map(o => o.id)));

  const orden = [...municipios].sort((a, b) => vecinos.get(b.id)!.length - vecinos.get(a.id)!.length);
  const tono = new Map<number, number>();
  const uso = TONOS.map(() => 0);

  orden.forEach(m => {
    const prohibidos = new Set(vecinos.get(m.id)!.map(v => tono.get(v)).filter(t => t !== undefined));
    let elegido = -1;
    TONOS.forEach((_, i) => {
      if (prohibidos.has(i)) return;
      if (elegido < 0 || uso[i] < uso[elegido]) elegido = i;
    });
    if (elegido < 0) elegido = m.id % TONOS.length; // más vecinos distintos que tonos: repite el menos malo
    tono.set(m.id, elegido);
    uso[elegido]++;
  });

  const colores = new Map<number, ColorMunicipio>();
  municipios.forEach(m => {
    const h = TONOS[tono.get(m.id)!];
    colores.set(m.id, { h, relleno: hex(h, 68, 80), contorno: hex(h, 38, 38) });
  });
  return colores;
}

export interface ColorSegmento { relleno: string; seleccionado: string; }

/**
 * Degradado de los segmentos de un municipio: se ordenan siguiendo una diagonal del mapa para que el
 * cambio de tono fluya por el territorio, con una pequeña alternancia que separa a los vecinos.
 */
export function coloresDeSegmentos(h: number, zonas: Zona[]): ColorSegmento[] {
  const orden = zonas.map((z, i) => ({ i, k: z.p[0] * 0.8 - z.p[1] * 0.6 }))
    .sort((a, b) => a.k - b.k);
  const rango = new Map<number, number>();
  orden.forEach((o, r) => rango.set(o.i, orden.length > 1 ? r / (orden.length - 1) : 0.5));

  return zonas.map((_, i) => {
    const t = rango.get(i)!;
    const tono = h + (t - 0.5) * 26;
    const luz = 88 - t * 20 + ((i * 7) % 5 - 2) * 1.6;
    return { relleno: hex(tono, 66, luz), seleccionado: hex(tono, 62, 56) };
  });
}
