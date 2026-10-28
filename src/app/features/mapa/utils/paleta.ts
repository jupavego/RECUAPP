import { Municipio, Zona } from '../services/mapa.service';

// Croquis en pasteles: cada municipio tiene un tono propio —no el de su subregión— y se reparten
// de modo que municipios vecinos no compartan tono. Dentro de un municipio, cada segmento
// (vereda o zona) recibe un degradado del mismo tono para poder distinguirlos entre sí.

export const SUBREGIONES = [
  'Bajo Cauca', 'Magdalena Medio', 'Nordeste', 'Norte', 'Occidente',
  'Oriente', 'Suroeste', 'Urabá', 'Valle de Aburrá',
];

/** Tonos (grados HSL) disponibles para los municipios. */
const TONOS = [350, 16, 40, 58, 90, 140, 170, 195, 220, 255, 285, 320];

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

function distanciaTono(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

/**
 * Un tono por municipio, coloreando como un grafo con los vecinos reales (`vec`): dos municipios
 * colindantes nunca comparten tono, y entre los tonos libres se elige el más distinto al de sus
 * vecinos ya coloreados para que tampoco se confundan por parecidos.
 */
export function coloresPorMunicipio(municipios: Municipio[]): Map<number, ColorMunicipio> {
  const orden = [...municipios].sort((a, b) => b.vec.length - a.vec.length);
  const tono = new Map<number, number>();
  const uso = TONOS.map(() => 0);

  orden.forEach(m => {
    const tonosVecinos = m.vec.map(v => tono.get(v)).filter((t): t is number => t !== undefined);
    let mejor = -1, mejorDist = -1;
    TONOS.forEach((h, i) => {
      if (tonosVecinos.includes(i)) return;
      // lejanía al vecino más parecido; a igualdad, el tono menos usado en el departamento
      const dist = Math.min(180, ...tonosVecinos.map(t => distanciaTono(h, TONOS[t])));
      if (dist > mejorDist || (dist === mejorDist && uso[i] < uso[mejor])) { mejor = i; mejorDist = dist; }
    });
    if (mejor < 0) mejor = m.id % TONOS.length; // más vecinos distintos que tonos: no debería pasar
    tono.set(m.id, mejor);
    uso[mejor]++;
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
