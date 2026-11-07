import { Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { Dependencia, PersonaResponsable, PlanEntidad, PlanService } from '../../services/plan.service';

/** Entidad que se abre cuando la ruta no trae código DANE (mientras dure el piloto). */
const ENTIDAD_PILOTO = '05308';
/** lienzo apaisado; cada nivel del organigrama es una fila */
export const ANCHO = 1800;
export const ALTO = 1000;
const MARGEN = 90;
const FILA = { alcalde: 110, oficinas: 310, secretarias: 570, subs: 850 };
const ANCHO_FICHA = 310;

/** vista de loto: el despacho al fondo y un cuenco por nivel (oficinas, secretarías, subsecretarías), vistos de lado */
const LOTO = {
  w: 1400, h: 870, cx: 700, cy: 300, ax: 700, ay: 165, boca: 190,
  anillos: [{ rx: 230, ry: 190 }, { rx: 460, ry: 330 }, { rx: 660, ry: 470 }],
};
const RADIO_OFICINA_LOTO = 140;

export interface Etiqueta { x: number; y: number; y2: number; texto: string; ancla: 'start' | 'end' }
export interface VistaLoto { nodos: Nodo[]; aristas: Arista[]; etiquetas: Etiqueta[] }

/** punto donde el rayo que sale del despacho con ese ángulo (grados, 0 = derecha, 90 = abajo) corta el cuenco */
function cortar(grados: number, a: { rx: number; ry: number }): { x: number; y: number } {
  const t = grados * Math.PI / 180;
  const dx = Math.cos(t), dy = Math.sin(t);
  const ox = LOTO.ax - LOTO.cx, oy = LOTO.ay - LOTO.cy;
  const A = dx * dx / a.rx ** 2 + dy * dy / a.ry ** 2;
  const B = 2 * (ox * dx / a.rx ** 2 + oy * dy / a.ry ** 2);
  const C = ox * ox / a.rx ** 2 + oy * oy / a.ry ** 2 - 1;
  const k = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
  const x = LOTO.ax + k * dx, y = LOTO.ay + k * dy;
  // por encima de la boca el cuenco sigue en vertical: el nodo sube por el costado
  if (y < LOTO.cy) return { x: LOTO.cx + Math.sign(dx) * a.rx, y: Math.max(y, LOTO.cy - LOTO.boca + 6) };
  return { x, y };
}
interface Trazo { pts: { x: number; y: number }[]; cum: number[]; L: number }
/** el cuenco como recorrido: costado izquierdo, media elipse por el fondo y costado derecho */
function trazo(a: { rx: number; ry: number }): Trazo {
  const pts: { x: number; y: number }[] = [{ x: LOTO.cx - a.rx, y: LOTO.cy - LOTO.boca }];
  for (let k = 0; k <= 120; k++) { const t = Math.PI * (1 - k / 120); pts.push({ x: LOTO.cx + a.rx * Math.cos(t), y: LOTO.cy + a.ry * Math.sin(t) }); }
  pts.push({ x: LOTO.cx + a.rx, y: LOTO.cy - LOTO.boca });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, L: cum[cum.length - 1] };
}
/** punto del recorrido a s unidades desde el borde izquierdo */
function enTrazo(t: Trazo, s: number): { x: number; y: number } {
  let i = 1;
  while (i < t.cum.length - 1 && t.cum[i] < s) i++;
  const f = (s - t.cum[i - 1]) / ((t.cum[i] - t.cum[i - 1]) || 1);
  return { x: t.pts[i - 1].x + f * (t.pts[i].x - t.pts[i - 1].x), y: t.pts[i - 1].y + f * (t.pts[i].y - t.pts[i - 1].y) };
}
const reducir = (a: { rx: number; ry: number }, f: number) => ({ rx: a.rx * f, ry: a.ry * f });

export interface Nodo {
  dep: Dependencia;
  x: number;
  y: number;
  r: number;
  productos: number;
}

export interface Arista { de: string; a: string; d: string; externa: boolean }

export interface Banda { y: number; texto: string }

const NOMBRE_TIPO: Record<Dependencia['tipo'], string> = {
  secretaria: 'Secretaría', oficina: 'Oficina', subsecretaria: 'Subsecretaría', unidad: 'Unidad', entidad: 'Entidad externa',
};

const RADIO_BASE: Record<Dependencia['tipo'], number> = { secretaria: 46, oficina: 42, subsecretaria: 38, unidad: 38, entidad: 42 };

/** de quién cuelga en el organigrama: su padre, o la dependencia a la que se vincula (entidad externa) */
const madre = (d: Dependencia): string | null | undefined => d.padre ?? d.vinculo;

@Component({
  selector: 'app-organigrama',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './organigrama.component.html',
  styleUrl: './organigrama.component.scss',
})
export class OrganigramaComponent {
  private readonly servicio = inject(PlanService);
  private readonly ruta = inject(ActivatedRoute);
  /** dentro de otra vista (Responsables): el título lo pone la sección que lo contiene */
  readonly incrustado = input(false);

  readonly dane = toSignal(this.ruta.paramMap.pipe(map(p => p.get('dane') ?? ENTIDAD_PILOTO)), { initialValue: ENTIDAD_PILOTO });
  /** undefined mientras carga, null si no hay datos de la entidad */
  readonly plan = toSignal<PlanEntidad | null | undefined>(
    this.ruta.paramMap.pipe(
      map(p => p.get('dane') ?? ENTIDAD_PILOTO),
      switchMap(d => this.servicio.entidad(d).pipe(catchError(() => of(null)))),
    ),
    { initialValue: undefined },
  );

  readonly ancho = ANCHO;
  readonly alto = ALTO;
  readonly alcalde = { x: ANCHO / 2, y: FILA.alcalde, r: 72 };
  readonly bandas: Banda[] = [
    { y: FILA.oficinas, texto: 'Oficinas asesoras y de control' },
    { y: FILA.secretarias, texto: 'Secretarías de despacho' },
    { y: FILA.subs, texto: 'Subsecretarías y unidades' },
  ];
  readonly sobre = signal<string | null>(null);
  readonly fijo = signal<string | null>(null);
  readonly cursor = signal({ x: 0, y: 0, ancho: 900 });

  readonly despacho = computed(() => this.plan()?.dependencias.find(d => d.id === 'des') ?? null);

  /**
   * Posición por nivel del organigrama: alcalde arriba; oficinas asesoras en una fila; secretarías en la
   * siguiente, cada una con ancho proporcional a sus subunidades, que cuelgan justo debajo de su padre
   * (el padre sale de `padre` en los datos, confirmado con el organigrama de la alcaldía).
   */
  readonly nodos = computed<Nodo[]>(() => {
    const deps = (this.plan()?.dependencias ?? []).filter(d => d.id !== 'des');
    const hijos = (id: string) => deps.filter(d => madre(d) === id);
    const oficinas = deps.filter(d => !d.padre && d.tipo === 'oficina');
    const secretarias = deps.filter(d => !d.padre && !d.vinculo && d.tipo !== 'oficina' && d.tipo !== 'entidad');
    const externas = deps.filter(d => !d.padre && !d.vinculo && d.tipo === 'entidad');
    const out: Nodo[] = [];

    const sitio = (d: Dependencia, x: number, y: number) => {
      const productos = d.productos.alta + d.productos.media + d.productos.baja;
      out.push({ dep: d, x, y, r: RADIO_BASE[d.tipo] + Math.min(10, Math.sqrt(productos) * 1.2), productos });
    };

    const pasoOficina = 240;
    oficinas.forEach((d, i) => sitio(d, ANCHO / 2 + (i - (oficinas.length - 1) / 2) * pasoOficina, FILA.oficinas));
    externas.forEach((d, i) => sitio(d, ANCHO - MARGEN - 60 - i * 200, FILA.alcalde));

    const columnas = secretarias.reduce((a, d) => a + Math.max(1, hijos(d.id).length), 0) || 1;
    const ancho = (ANCHO - 2 * MARGEN) / columnas;
    let col = 0;
    for (const d of secretarias) {
      const hs = hijos(d.id);
      const n = Math.max(1, hs.length);
      sitio(d, MARGEN + ancho * (col + n / 2), FILA.secretarias);
      hs.forEach((h, i) => sitio(h, MARGEN + ancho * (col + i + 0.5), FILA.subs));
      col += n;
    }
    return out;
  });

  readonly vista = signal<'loto' | 'arbol'>('loto');
  readonly lotoW = LOTO.w;
  readonly lotoH = LOTO.h;
  readonly lotoAlcalde = { x: LOTO.ax, y: LOTO.ay, r: 54 };

  /** cuenco i del loto como trazo abierto por arriba, más su relleno */
  arco(i: number, cerrar = false): string {
    const { rx, ry } = LOTO.anillos[i];
    const y0 = LOTO.cy - LOTO.boca;
    return `M ${LOTO.cx - rx} ${y0} V ${LOTO.cy} A ${rx} ${ry} 0 0 0 ${LOTO.cx + rx} ${LOTO.cy} V ${y0}${cerrar ? ' Z' : ''}`;
  }

  /**
   * Loto: oficinas en el cuenco interior, secretarías (y entidades externas, punteadas, junto a su dependencia)
   * en el siguiente, subsecretarías en el exterior. Cada nodo ocupa un rayo desde el despacho; las oficinas
   * van en rayos propios para que las uniones del despacho no pasen por encima de ellas.
   */
  readonly loto = computed<VistaLoto>(() => {
    const deps = (this.plan()?.dependencias ?? []).filter(d => d.id !== 'des');
    const nodos: Nodo[] = [], aristas: Arista[] = [], etiquetas: Etiqueta[] = [];
    const prod = (d: Dependencia) => d.productos.alta + d.productos.media + d.productos.baja;
    const poner = (d: Dependencia, x: number, y: number, r: number) => nodos.push({ dep: d, x, y, r, productos: prod(d) });
    const union = (de: string, a: string, x1: number, y1: number, x2: number, y2: number, externa: boolean) =>
      aristas.push({ de, a, externa, d: `M ${x1} ${y1} L ${x2} ${y2}` });

    const oficinas = deps.filter(d => !d.padre && !d.vinculo && d.tipo === 'oficina');
    const secs = deps.filter(d => !d.padre && !d.vinculo && d.tipo !== 'oficina' && d.tipo !== 'entidad');
    const ents = deps.filter(d => d.tipo === 'entidad');
    const ordenB = secs.flatMap(sec => [sec, ...ents.filter(e => e.vinculo === sec.id)]);
    ents.filter(e => !ordenB.includes(e)).forEach(e => ordenB.push(e));

    // las secretarías con más subunidades van hacia los extremos (donde sus hijas tienen más sitio)
    const nHijas = (d: Dependencia) => deps.filter(x => x.padre === d.id).length;
    const grupos = secs.map(sec => [sec, ...ents.filter(e => e.vinculo === sec.id)]).sort((a, b) => nHijas(b[0]) - nHijas(a[0]));
    const izq: Dependencia[][] = [], der: Dependencia[][] = [];
    grupos.forEach((g, i) => (i % 2 ? der : izq).push(g));
    const orden = [...izq, ...der.reverse()];
    ordenB.splice(0, ordenB.length, ...orden.flat(), ...ordenB.filter(d => !orden.flat().includes(d)));
    const centro = this.lotoAlcalde;
    const trB = trazo(LOTO.anillos[1]), trC = trazo(LOTO.anillos[2]);
    const MARGEN_S = 40;

    // secretarías y externas repartidas a distancias iguales a lo largo del cuenco, subiendo por los costados
    const posB = ordenB.map((d, i) => {
      const f = (i + 0.5) / ordenB.length;
      const tr = i % 2 ? trazo(reducir(LOTO.anillos[1], 0.86)) : trB;
      return { d, f, ...enTrazo(tr, MARGEN_S + (tr.L - 2 * MARGEN_S) * f) };
    });

    // oficinas: rayos libres, lo más lejos posible de las uniones que van a las secretarías
    const rayosB = posB.map(p => Math.atan2(p.y - centro.y, p.x - centro.x) * 180 / Math.PI);
    const elegidos: number[] = [];
    for (let j = 0; j < oficinas.length; j++) {
      let mejor = 90, puntaje = -1;
      for (let g = 8; g <= 172; g += 1) {
        if (elegidos.some(e => Math.abs(e - g) < 36)) continue;
        const sc = Math.min(...rayosB.map(r => Math.abs(r - g)), 99);
        if (sc > puntaje) { puntaje = sc; mejor = g; }
      }
      elegidos.push(mejor);
    }
    elegidos.sort((a, b) => a - b).forEach((g, j) => {
      const t = g * Math.PI / 180;
      poner(oficinas[j], centro.x + 185 * Math.cos(t), centro.y + RADIO_OFICINA_LOTO * Math.sin(t), 22);
      const n = nodos[nodos.length - 1];
      union('des', n.dep.id, centro.x, centro.y, n.x, n.y, false);
    });
    const fracB = new Map<string, number>();
    for (const p of posB) {
      fracB.set(p.d.id, p.f);
      poner(p.d, p.x, p.y, 30 + Math.min(8, Math.sqrt(prod(p.d))));
    }
    const enB = new Map(nodos.map(n => [n.dep.id, n]));
    for (const d of ordenB) {
      const n = enB.get(d.id)!;
      const padre = d.vinculo ? enB.get(d.vinculo) : undefined;
      if (padre) union(padre.dep.id, d.id, padre.x, padre.y, n.x, n.y, true);
      else union('des', d.id, centro.x, centro.y, n.x, n.y, d.tipo === 'entidad');
    }

    // subsecretarías: cerca de la posición de su padre en el cuenco exterior, con separación mínima entre vecinas
    const hijas = deps.filter(d => d.padre && fracB.has(d.padre) && d.tipo !== 'entidad');
    const deseo = hijas.map(h => {
      const hs = hijas.filter(x => x.padre === h.padre);
      return { d: h, s: fracB.get(h.padre!)! * trC.L + (hs.indexOf(h) - (hs.length - 1) / 2) * 60 };
    }).sort((a, b) => a.s - b.s);
    const GAP = 125;
    for (let i = 1; i < deseo.length; i++) deseo[i].s = Math.max(deseo[i].s, deseo[i - 1].s + GAP);
    for (let i = deseo.length - 1; i >= 0; i--) {
      const tope = i === deseo.length - 1 ? trC.L - MARGEN_S : deseo[i + 1].s - GAP;
      deseo[i].s = Math.min(deseo[i].s, tope);
    }
    for (const [i, { d, s }] of deseo.entries()) {
      const p = i % 2 ? ((tr) => enTrazo(tr, s / trC.L * tr.L))(trazo(reducir(LOTO.anillos[2], 0.9))) : enTrazo(trC, s);
      poner(d, p.x, p.y, 22 + Math.min(6, Math.sqrt(prod(d)) * 0.5));
      const padre = enB.get(d.padre!)!;
      union(padre.dep.id, d.id, padre.x, padre.y, p.x, p.y, false);
    }
    return { nodos, aristas, etiquetas };
  });

  readonly nodosVista = computed(() => this.vista() === 'loto' ? this.loto().nodos : this.nodos());
  readonly aristasVista = computed(() => this.vista() === 'loto' ? this.loto().aristas : this.aristas());

  readonly porId = computed(() => new Map(this.nodosVista().map(n => [n.dep.id, n])));

  /** conectores en ángulo recto, como en un organigrama */
  readonly aristas = computed<Arista[]>(() => {
    const m = this.porId();
    return this.nodos().map(n => {
      const mad = madre(n.dep);
      const p = mad ? m.get(mad) : this.alcalde;
      const origen = p ?? this.alcalde;
      const r0 = 'dep' in origen ? origen.r : this.alcalde.r;
      const ext = n.dep.tipo === 'entidad';
      if (ext && !mad) {
        return { de: 'des', a: n.dep.id, externa: true, d: `M ${this.alcalde.x + this.alcalde.r} ${this.alcalde.y} H ${n.x - n.r}` };
      }
      const y1 = origen.y + r0;
      const y2 = n.y - n.r;
      const ym = y2 - 46;
      return { de: mad ?? 'des', a: n.dep.id, externa: ext, d: `M ${origen.x} ${y1} V ${ym} H ${n.x} V ${y2}` };
    });
  });

  /** nodos que quedan visibles al señalar uno: él, su padre, sus hijos y el despacho */
  readonly foco = computed(() => {
    const id = this.sobre() ?? this.fijo();
    if (!id) return null;
    const s = new Set<string>([id, 'des']);
    const dep = this.porId().get(id)?.dep;
    if (dep && madre(dep)) s.add(madre(dep)!);
    this.nodosVista().forEach(n => { if (madre(n.dep) === id || (this.vista() === 'loto' && n.dep.tipo === 'oficina' && id === 'des')) s.add(n.dep.id); });
    return s;
  });

  /** dependencia cuya ficha se muestra (el despacho incluido, con los datos del alcalde) */
  readonly activa = computed<Dependencia | null>(() => {
    const id = this.sobre() ?? this.fijo();
    if (!id) return null;
    return id === 'des' ? this.despacho() : (this.porId().get(id)?.dep ?? null);
  });

  /** quién la dirige; en el despacho, el alcalde */
  resp(d: Dependencia): PersonaResponsable | null { return d.id === 'des' ? (this.plan()?.alcalde ?? null) : d.responsable; }
  tipo(d: Dependencia): string { return NOMBRE_TIPO[d.tipo]; }
  padre(d: Dependencia): string | null { return madre(d) ? (this.plan()?.dependencias.find(x => x.id === madre(d))?.nombre ?? null) : null; }
  icono(d: Dependencia | null): string | null { return d?.icono ? `/img/iconos/${d.icono}.png` : null; }
  atenuado(id: string): boolean { const f = this.foco(); return !!f && !f.has(id); }
  viva(a: Arista): boolean { const f = this.foco(); return !!f && f.has(a.a) && f.has(a.de); }

  /** nombre corto en hasta dos renglones bajo el nodo */
  lineas(nombre: string, max = 14, tope = 2): string[] {
    const base = nombre.replace(/^(Secretar[ií]a|Subsecretar[ií]a|Oficina Asesora|Oficina) (de |del )?/, '');
    const out: string[] = [];
    let actual = '';
    for (const w of base.split(' ')) {
      if ((actual + ' ' + w).trim().length > max && actual) { out.push(actual); actual = w; } else actual = (actual + ' ' + w).trim();
    }
    if (actual) out.push(actual);
    return out.length > tope ? [...out.slice(0, tope - 1), out[tope - 1] + '…'] : out;
  }

  mover(e: MouseEvent): void {
    const caja = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.cursor.set({ x: e.clientX - caja.left, y: e.clientY - caja.top, ancho: caja.width });
  }

  fijar(id: string): void { this.fijo.set(this.fijo() === id ? null : id); }

  /** la ficha va junto al cursor sin salirse del contenedor */
  izq(): number { const c = this.cursor(); return Math.max(8, Math.min(c.x + 16, c.ancho - ANCHO_FICHA - 8)); }
  arr(): number { return this.cursor().y + 14; }
}
