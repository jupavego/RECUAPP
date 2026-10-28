// Los contornos vienen como "encoded polyline" con 4 decimales (~11 m): texto liviano que
// se decodifica por demanda. PRECISION tiene que coincidir con scripts/generar_mapa.py.
const PRECISION = 1e-4;

export type LatLon = [number, number];
/** Multipolígono: lista de polígonos, cada uno [anillo exterior, ...huecos] — la forma que entiende L.polygon. */
export type Geometria = LatLon[][][];
/** Lo mismo, pero con cada anillo aún codificado. */
export type GeometriaCodificada = string[][];

export function decodePolyline(str: string): LatLon[] {
  const pts: LatLon[] = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    let sh = 0, res = 0, b: number;
    do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
    lat += (res & 1) ? ~(res >> 1) : (res >> 1);
    sh = 0; res = 0;
    do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
    lon += (res & 1) ? ~(res >> 1) : (res >> 1);
    pts.push([lat * PRECISION, lon * PRECISION]);
  }
  return pts;
}

export function decodeGeometria(g: GeometriaCodificada): Geometria {
  return g.map(poligono => poligono.map(decodePolyline));
}
