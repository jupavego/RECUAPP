import { Municipio, Zona } from '../services/mapa.service';

// Croquis en pasteles: cada municipio tiene un tono propio —no el de su subregión— y se reparten
// de modo que municipios vecinos no compartan tono. Dentro de un municipio, cada segmento
// (vereda o zona) recibe un degradado del mismo tono para poder distinguirlos entre sí.

export const SUBREGIONES = [
  'Bajo Cauca', 'Magdalena Medio', 'Nordeste', 'Norte', 'Occidente',
  'Oriente', 'Suroeste', 'Urabá', 'Valle de Aburrá',
];

interface Pastel { h: number; s: number; l: number; }

/**
 * 36 pasteles: 12 tonos × 3 niveles de claridad (con un pequeño corrimiento de matiz por nivel).
 * Hacen falta más de 23 porque ningún municipio puede repetir color dentro de su subregión.
 */
const PASTELES: Pastel[] = [0, 1, 2].flatMap(nivel =>
  [350, 16, 40, 58, 90, 140, 170, 195, 220, 255, 285, 320].map(h =>
    ({ h: h + nivel * 9, s: [70, 62, 56][nivel], l: [84, 77, 70][nivel] })));

export const OPACIDAD_MUNICIPIO = 0.56;
export const OPACIDAD_SEGMENTO = 0.6;

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
 * Un color por municipio, con dos reglas: nunca repite el de otro municipio de su subregión ni el de
 * un colindante (`vec`). Entre los colores libres se elige el de tono más distinto al de sus vecinos
 * y, a igualdad, el menos usado en el departamento.
 */
export function coloresPorMunicipio(municipios: Municipio[]): Map<number, ColorMunicipio> {
  const orden = [...municipios].sort((a, b) => b.vec.length - a.vec.length);
  const asignado = new Map<number, number>();
  const usadosEnSubregion = new Map<string, Set<number>>();
  const uso = PASTELES.map(() => 0);

  orden.forEach(m => {
    const deSubregion = usadosEnSubregion.get(m.s) ?? new Set<number>();
    const vecinos = m.vec.map(v => asignado.get(v)).filter((c): c is number => c !== undefined);

    const candidatos = (estricto: boolean) => PASTELES.map((_, i) => i)
      .filter(i => !vecinos.includes(i) && (!estricto || !deSubregion.has(i)));
    let libres = candidatos(true);
    if (!libres.length) libres = candidatos(false); // subregión con más municipios que colores: no debería pasar

    let mejor = libres[0], mejorDist = -1;
    libres.forEach(i => {
      const dist = Math.min(180, ...vecinos.map(c => distanciaTono(PASTELES[i].h, PASTELES[c].h)));
      if (dist > mejorDist || (dist === mejorDist && uso[i] < uso[mejor])) { mejor = i; mejorDist = dist; }
    });

    asignado.set(m.id, mejor);
    deSubregion.add(mejor);
    usadosEnSubregion.set(m.s, deSubregion);
    uso[mejor]++;
  });

  const colores = new Map<number, ColorMunicipio>();
  asignado.forEach((i, id) => {
    const p = PASTELES[i];
    colores.set(id, { h: p.h, relleno: hex(p.h, p.s, p.l), contorno: hex(p.h, 38, 34) });
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
