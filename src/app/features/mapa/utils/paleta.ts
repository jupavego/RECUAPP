import { Municipio } from '../services/mapa.service';

// Croquis por subregión: cada subregión tiene un tono propio y cada municipio una variación de
// luminosidad dentro de ese tono, con relleno translúcido y contorno oscuro del mismo tono.
export const TONO_SUBREGION: Record<string, number> = {
  'Valle de Aburrá': 48,
  'Magdalena Medio': 18,
  'Suroeste': 355,
  'Norte': 145,
  'Oriente': 85,
  'Bajo Cauca': 205,
  'Occidente': 250,
  'Urabá': 285,
  'Nordeste': 320,
};

export const OPACIDAD_RELLENO = 0.45;

export interface ColorMunicipio { relleno: string; contorno: string; }

/** Colores de cada municipio, repartiendo la luminosidad entre los de su misma subregión. */
export function coloresPorMunicipio(municipios: Municipio[]): Map<number, ColorMunicipio> {
  const porSubregion = new Map<string, Municipio[]>();
  municipios.forEach(m => porSubregion.set(m.s, [...(porSubregion.get(m.s) ?? []), m]));

  const colores = new Map<number, ColorMunicipio>();
  porSubregion.forEach((lista, subregion) => {
    const h = TONO_SUBREGION[subregion] ?? 200;
    lista.forEach((m, i) => {
      const t = lista.length > 1 ? i / (lista.length - 1) : 0;
      colores.set(m.id, {
        relleno: `hsl(${h} 62% ${50 + t * 20}%)`,
        contorno: `hsl(${h} 55% ${14 + t * 14}%)`,
      });
    });
  });
  return colores;
}

export function colorSubregion(subregion: string): string {
  return `hsl(${TONO_SUBREGION[subregion] ?? 200} 62% 56%)`;
}
