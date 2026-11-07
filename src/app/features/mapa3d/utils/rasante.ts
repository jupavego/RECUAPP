/**
 * Rasante de las vías principales y locales (scripts/asentar_vias_edificios.py → public/data/mapa3d/rasante-<id>.json):
 * cada vía densificada con, por punto, la media calzada y el borde de la acera a cada lado (dm) y la altura de esos bordes
 * (cm sobre el mínimo del relieve, sin exagerar), el primer punto absoluto y el resto como diferencias. Las calles caben entre las fachadas reales y no tapan las puertas.
 *
 * Lado «a» de un punto = (-tz, tx) en el modelo, con (tx, tz) el rumbo del trazado: el primer vértice de las cintas del mapa.
 */
export interface DatosRasante { k: number; v: number[][]; w: number[][]; y: number[][]; }

export interface TramoRasante {
  clase: number;
  /** puntos del eje en el modelo y lon/lat */
  x: number[]; z: number[]; lon: number[]; lat: number[];
  /** media calzada y borde de la acera a cada lado (m) */
  wa: number[]; wb: number[]; aa: number[]; ab: number[];
  /** altura en el modelo (ya exagerada) del borde de la calzada y de la acera a cada lado */
  ya: number[]; yb: number[]; yaa: number[]; yab: number[];
}

/** Punto de la vía más cercano: `d` = distancia al borde de la calzada (negativa encima), `s` = desvío con signo hacia el lado a. */
export interface ConsultaRasante {
  d: number; s: number; qx: number; qz: number; tx: number; tz: number;
  wa: number; wb: number; aa: number; ab: number; tramo: number; i: number; t: number;
}

const CELDA = 40;

export class Rasante {
  readonly tramos: TramoRasante[] = [];
  private readonly celdas = new Map<number, number[]>();   // celda → [tramo, segmento, tramo, segmento, ...]

  /** alto del bordillo en el modelo: la acera queda esto por encima de la calzada */
  readonly bordillo: number;

  constructor(readonly datos: DatosRasante, aX: (lon: number) => number, aZ: (lat: number) => number, exageracion: number) {
    const d = datos;
    this.bordillo = 0.15 * exageracion;
    d.v.forEach((v, n) => {
      const lon: number[] = [], lat: number[] = [];
      let px = v[1], pz = v[2];
      lon.push(px / d.k); lat.push(pz / d.k);
      for (let i = 3; i < v.length; i += 2) { px += v[i]; pz += v[i + 1]; lon.push(px / d.k); lat.push(pz / d.k); }
      const w = d.w[n], y = d.y[n];
      // cuatro columnas por punto; el primer punto absoluto y los demás como diferencias con el anterior
      const col = (a: number[], j: number, f: number) => { let acc = 0; return lon.map((_, i) => (acc += a[i * 4 + j]) * f); };
      const t: TramoRasante = {
        clase: v[0], lon, lat, x: lon.map(aX), z: lat.map(aZ),
        wa: col(w, 0, 0.1), wb: col(w, 1, 0.1), aa: col(w, 2, 0.1), ab: col(w, 3, 0.1),
        ya: col(y, 0, exageracion / 100), yb: col(y, 1, exageracion / 100), yaa: col(y, 2, exageracion / 100), yab: col(y, 3, exageracion / 100),
      };
      const k = this.tramos.push(t) - 1;
      for (let i = 1; i < t.x.length; i++) {
        const m = Math.max(t.aa[i], t.ab[i], t.aa[i - 1], t.ab[i - 1]) + 6;
        const i0 = Math.floor((Math.min(t.x[i - 1], t.x[i]) - m) / CELDA), i1 = Math.floor((Math.max(t.x[i - 1], t.x[i]) + m) / CELDA);
        const j0 = Math.floor((Math.min(t.z[i - 1], t.z[i]) - m) / CELDA), j1 = Math.floor((Math.max(t.z[i - 1], t.z[i]) + m) / CELDA);
        for (let a = i0; a <= i1; a++) {
          for (let b = j0; b <= j1; b++) {
            const c = a * 100003 + b;
            (this.celdas.get(c) ?? this.celdas.set(c, []).get(c)!).push(k, i - 1);
          }
        }
      }
    });
  }

  /** Tramo de vía más cercano a (x, z), entre los que pasan a menos de su acera + 6 m; null si no hay ninguno. */
  consultar(x: number, z: number): ConsultaRasante | null {
    const lista = this.celdas.get(Math.floor(x / CELDA) * 100003 + Math.floor(z / CELDA));
    if (!lista) return null;
    let mejor: ConsultaRasante | null = null;
    for (let q = 0; q < lista.length; q += 2) {
      const tr = this.tramos[lista[q]], i = lista[q + 1];
      const ax = tr.x[i], az = tr.z[i], sx = tr.x[i + 1] - ax, sz = tr.z[i + 1] - az, ll = sx * sx + sz * sz;
      const t = ll > 0 ? Math.min(1, Math.max(0, ((x - ax) * sx + (z - az) * sz) / ll)) : 0;
      const qx = ax + sx * t, qz = az + sz * t, l = Math.sqrt(ll) || 1, tx = sx / l, tz = sz / l;
      const s = (x - qx) * -tz + (z - qz) * tx;
      const wa = tr.wa[i] + (tr.wa[i + 1] - tr.wa[i]) * t, wb = tr.wb[i] + (tr.wb[i + 1] - tr.wb[i]) * t;
      const d = Math.hypot(x - qx, z - qz) - (s >= 0 ? wa : wb);
      if (!mejor || d < mejor.d) {
        mejor = { d, s, qx, qz, tx, tz, wa, wb, aa: tr.aa[i] + (tr.aa[i + 1] - tr.aa[i]) * t, ab: tr.ab[i] + (tr.ab[i + 1] - tr.ab[i]) * t, tramo: lista[q], i, t };
      }
    }
    return mejor;
  }

  /** Altura de la calzada o de la acera en (x, z); null si el punto no está sobre ninguna vía. */
  altura(x: number, z: number): number | null {
    const c = this.consultar(x, z);
    return c ? this.alturaEn(c) : null;
  }

  /** Altura del eje de la calzada (el promedio de sus dos bordes) en el punto consultado. */
  alturaEje(c: ConsultaRasante): number {
    const tr = this.tramos[c.tramo], i = c.i, t = c.t;
    return (tr.ya[i] + tr.yb[i]) / 2 * (1 - t) + (tr.ya[i + 1] + tr.yb[i + 1]) / 2 * t;
  }

  /** Altura de la superficie en el punto consultado (calzada inclinada de borde a borde, acera hasta su borde). */
  alturaEn(c: ConsultaRasante): number | null {
    const tr = this.tramos[c.tramo], i = c.i, t = c.t;
    const L = (a: number[]) => a[i] + (a[i + 1] - a[i]) * t;
    const ya = L(tr.ya), yb = L(tr.yb);
    if (c.s >= 0 ? c.s <= c.wa : -c.s <= c.wb) return yb + (ya - yb) * (c.s + c.wb) / Math.max(c.wa + c.wb, 1e-6);
    const [w, a, y, yAcera] = c.s >= 0 ? [c.wa, c.aa, ya, L(tr.yaa)] : [c.wb, c.ab, yb, L(tr.yab)];
    const fuera = Math.abs(c.s) - w;
    if (fuera > a - w + 0.01) return null;
    return y + this.bordillo + (yAcera - y - this.bordillo) * Math.min(1, fuera / Math.max(a - w, 1e-6));
  }

  /**
   * Media calzada y borde de acera a cada lado de un punto, vistos por quien recorre una polilínea con rumbo (tx, tz):
   * [calzada a su izquierda (-tz, tx), calzada al otro lado, acera a la izquierda, acera al otro lado]. null fuera de las vías.
   */
  anchos(x: number, z: number, tx: number, tz: number): [number, number, number, number] | null {
    const c = this.consultar(x, z);
    if (!c || c.d > 2) return null;
    return tx * c.tx + tz * c.tz >= 0 ? [c.wa, c.wb, c.aa, c.ab] : [c.wb, c.wa, c.ab, c.aa];
  }
}
