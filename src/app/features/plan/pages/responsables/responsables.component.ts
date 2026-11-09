import { Component, HostBinding, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { TemaService } from '../../../../core/services/tema.service';
import { AvanceDependencia, AvanceIndicador, Confianza, Dependencia, Funcionario, PlanAccion, PlanAccionDependencia, PlanEntidad, PlanService, ProductoPlan, ProyectoPlanAccion, ProyectoZona, Seguimiento, ZonasPlan } from '../../services/plan.service';

/** Entidad que se abre cuando la ruta no trae código DANE (mientras dure el piloto). */
const ENTIDAD_PILOTO = '05308';
const ANIOS = ['2024', '2025', '2026', '2027'];
/** año de los planes de acción publicados que se muestran en la ficha */
const ANIO_PLAN_ACCION = 2026;

export type Pestana = 'panorama' | 'plan' | 'productos' | 'equipo';
/** estado de un producto en el informe: cumplido, en curso, con menos de 50 % o sin informe */
export type EstadoProducto = 'ok' | 'medio' | 'bajo' | 'nd';

/** Pestañas de la vista, en el orden de las tarjetas de la portada; el equipo se abre desde la tarjeta del secretario. */
const SECCIONES: { p: Pestana; pestana: string; color: string; d: string }[] = [
  { p: 'panorama', pestana: 'Panorama', color: 'v-vigilar', d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { p: 'productos', pestana: 'Productos', color: 'v-entender', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { p: 'plan', pestana: 'Plan ' + ANIO_PLAN_ACCION, color: 'v-seguir', d: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h3M8 17h6' },
  { p: 'equipo', pestana: 'Equipo', color: 'v-conocer',
    d: 'M9 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM3 20c.6-3.4 3-5.4 6-5.4s5.4 2 6 5.4M17 11.4a2.4 2.4 0 1 0 0-4.8M16 14.6c2.6.1 4.4 1.9 5 4.4' },
];

/** Dependencias con retrato de quien la dirige en /img/retratos/<dane>/<id>.webp (fotos oficiales de la alcaldía). */
const RETRATOS = new Set(['des', 'agri', 'amb', 'gob', 'hac', 'inf', 'pla', 'sal', 'adm', 'tra', 'edu', 'com', 'jur', 'cid', 'cia',
  'sub_cul', 'sub_part', 'sub_prot', 'sub_seg', 'sub_dec']);

/** fuentes de financiación del plan de acción, en el orden del formato de la alcaldía */
const FUENTES_PA = [
  { k: 'propios', n: 'Recursos propios' },
  { k: 'sgp', n: 'SGP' },
  { k: 'regalias', n: 'Regalías' },
  { k: 'cofinanciacion', n: 'Cofinanciación' },
  { k: 'otros', n: 'Otros' },
] as const;

/** plan de acción de una dependencia del grupo del responsable */
export interface PlanAccionDe {
  dep: Dependencia;
  pa: PlanAccionDependencia;
}

/** Circunferencia del anillo de avance (radio 52 del viewBox). */
const ANILLO = 2 * Math.PI * 52;

/** Un producto del plan visto desde un responsable, con su avance en el informe de seguimiento. */
export interface FilaProducto {
  x: ProductoPlan;
  /** dependencia concreta (puede ser una subsecretaría de la que se está viendo) */
  dep: Dependencia;
  conf: Confianza;
  pct: number | null;
  programada: number | null;
  avance: number | null;
  /** todo lo que el informe dice del indicador (años, narrativa, proyecto); null si no aparece */
  s: AvanceIndicador | null;
}

/** Resumen de un responsable de primer nivel, con lo de sus subsecretarías. */
export interface Resumen {
  dep: Dependencia;
  /** la dependencia y sus subsecretarías */
  grupo: Dependencia[];
  filas: FilaProducto[];
  alta: number;
  sugerida: number;
  conSeguimiento: number;
  /** promedio del % de avance (cada indicador topado en 100); null si ningún producto tiene informe */
  avance: number | null;
  cumplidos: number;
  atrasados: number;
  equipo: number;
  /** cuadros oficiales del informe para esta dependencia, por año (plan de acción y avance al cuatrienio) */
  oficial: Record<string, AvanceDependencia> | null;
}

/** Matiz (70–160: del lima al verde azulado) estable por dependencia, compartido con el pueblo 3D. */
export function matizDe(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 70 + (h % 90);
}

/**
 * Atmósfera de color de cada dependencia: tres matices (0–360) que tiñen las curvas de nivel y el velo de su portada.
 * Salen del icono y del oficio de cada una (el bus azul y ámbar de Tránsito, el escudo azul y dorado de Gobierno…).
 */
const ATMOSFERAS: Record<string, [number, number, number]> = {
  agri: [92, 42, 150],   // verde cultivo, ocre, hoja
  amb: [152, 186, 96],   // esmeralda, agua, brote
  gob: [224, 44, 258],   // azul escudo, dorado, índigo
  hac: [40, 152, 18],    // oro, verde billete, cobre
  inf: [20, 204, 38],    // terracota, acero, arena
  pla: [190, 84, 232],   // cian, lima, azul plano
  sal: [352, 176, 18],   // rosa, verde quirófano, coral
  adm: [212, 174, 250],  // pizarra, aguamarina, lavanda
  tra: [216, 40, 190],   // azul bus, ámbar semáforo, cian
  edu: [228, 272, 44],   // azul birrete, violeta, dorado
  com: [12, 328, 42],    // coral, ciruela, miel
  jur: [345, 32, 220],   // vino, arena, tinta
  cid: [262, 300, 200],  // violeta, magenta, azul
  cia: [170, 208, 140],  // turquesa, azul, verde
  des: [44, 140, 205],   // dorado, verde, cielo
};

export function atmosferaDe(id: string): [number, number, number] {
  if (ATMOSFERAS[id]) return ATMOSFERAS[id];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360;
  return [a, (a + 140) % 360, (a + 50) % 360];
}

/** Resumen de una dependencia cualquiera: ella y sus subdependencias directas (una subsecretaría, solo ella). */
export function construirResumen(p: PlanEntidad, seguimiento: Seguimiento | null, dep: Dependencia): Resumen {
  const seg = seguimiento?.indicadores ?? {};
  const deps = new Map(p.dependencias.map(d => [d.id, d]));
  const grupo = [dep, ...p.dependencias.filter(d => d.padre === dep.id)];
  const filas: FilaProducto[] = [];
  for (const x of p.productos) {
    for (const r of x.resp) {
      const d = deps.get(r.dep);
      if (!d || !grupo.includes(d)) continue;
      const s = seg[x.id];
      filas.push({ x, dep: d, conf: r.conf, pct: s?.pct ?? null, programada: s?.programada ?? null, avance: s?.avance ?? null, s: s ?? null });
    }
  }
  // un producto con dos subsecretarías del mismo grupo cuenta una vez
  const unicos = [...new Map(filas.map(f => [f.x.id, f])).values()];
  const con = unicos.filter(f => f.pct !== null);
  return {
    dep, grupo, filas,
    alta: unicos.filter(f => f.conf === 'alta').length,
    sugerida: unicos.filter(f => f.conf !== 'alta').length,
    conSeguimiento: con.length,
    avance: con.length ? con.reduce((a, f) => a + Math.min(100, f.pct!), 0) / con.length : null,
    cumplidos: con.filter(f => f.pct! >= 100).length,
    atrasados: con.filter(f => f.pct! < 50).length,
    equipo: grupo.reduce((a, d) => a + (d.equipo?.length ?? 0), 0),
    oficial: seguimiento?.dependencias[dep.id] ?? null,
  };
}

/** Un resumen por dependencia de primer nivel (las externas, como el INDER, no suman a su secretaría). */
export function construirResumenes(p: PlanEntidad, seguimiento: Seguimiento | null): Resumen[] {
  return p.dependencias.filter(d => !d.padre && !d.vinculo).map(dep => construirResumen(p, seguimiento, dep));
}

@Component({
  selector: 'app-responsables',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './responsables.component.html',
  styleUrl: './responsables.component.scss',
})
export class ResponsablesComponent {
  private readonly servicio = inject(PlanService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly tema = inject(TemaService);

  /** undefined mientras carga, null si no hay datos de la entidad */
  readonly plan = toSignal<PlanEntidad | null | undefined>(
    this.ruta.paramMap.pipe(
      map(p => p.get('dane') ?? ENTIDAD_PILOTO),
      switchMap(d => this.servicio.entidad(d).pipe(catchError(() => of(null)))),
    ),
    { initialValue: undefined },
  );

  /** null si la entidad no tiene informe de seguimiento */
  readonly seguimiento = toSignal<Seguimiento | null>(
    this.ruta.paramMap.pipe(
      map(p => p.get('dane') ?? ENTIDAD_PILOTO),
      switchMap(d => this.servicio.seguimiento(d).pipe(catchError(() => of(null)))),
    ),
    { initialValue: null },
  );

  /** null si la entidad no tiene veredas nombradas en sus informes */
  readonly zonas = toSignal<ZonasPlan | null>(
    this.ruta.paramMap.pipe(
      map(p => p.get('dane') ?? ENTIDAD_PILOTO),
      switchMap(d => this.servicio.zonas(d).pipe(catchError(() => of(null)))),
    ),
    { initialValue: null },
  );

  /** null si la entidad no tiene planes de acción del año cargados */
  readonly planAccion = toSignal<PlanAccion | null>(
    this.ruta.paramMap.pipe(
      map(p => p.get('dane') ?? ENTIDAD_PILOTO),
      switchMap(d => this.servicio.planAccion(d, ANIO_PLAN_ACCION).pipe(catchError(() => of(null)))),
    ),
    { initialValue: null },
  );

  @HostBinding('class.tema-botanico') get botanico(): boolean { return this.tema.botanico(); }
  @HostBinding('class.tema-oscuro') get oscuro(): boolean { return this.tema.oscuro(); }

  /** responsable de la ruta /responsables/:dep */
  readonly depId = toSignal(this.ruta.paramMap.pipe(map(p => p.get('dep'))), { initialValue: this.ruta.snapshot.paramMap.get('dep') });
  readonly pestana = signal<Pestana>('panorama');
  readonly anios = ANIOS;

  // ── filtros de la pestaña Productos ──
  /** texto libre: código (IP-23), indicador, producto, detalle, sector o subdependencia; sin importar tildes ni mayúsculas */
  readonly busca = signal('');
  readonly fEstado = signal<EstadoProducto | null>(null);
  readonly fLinea = signal('');
  readonly fSector = signal('');
  readonly fOrigen = signal<'' | 'alta' | 'sugerida'>('');
  readonly fDep = signal('');
  readonly hayFiltros = computed(() => !!(this.busca().trim() || this.fEstado() || this.fLinea() || this.fSector() || this.fOrigen() || this.fDep()));

  limpiarFiltros(): void {
    this.busca.set(''); this.fEstado.set(null); this.fLinea.set(''); this.fSector.set(''); this.fOrigen.set(''); this.fDep.set('');
  }

  // ── portada ──
  readonly secciones = SECCIONES;
  constructor() {
    // al cambiar de dependencia se vuelve al panorama y los filtros arrancan limpios
    effect(() => { this.depId(); untracked(() => { this.pestana.set('panorama'); this.limpiarFiltros(); }); });
  }
  private readonly poco = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** abre una pestaña; desde una tarjeta de la portada además baja hasta las pestañas */
  abrir(p: Pestana, bajar = false): void {
    this.pestana.set(p);
    if (bajar) setTimeout(() => document.getElementById('secciones')?.scrollIntoView({ behavior: this.poco ? 'auto' : 'smooth', block: 'start' }));
  }

  /** retrato de quien dirige la dependencia, o null si no hay foto */
  retrato(d: Dependencia): string | null {
    return RETRATOS.has(d.id) ? `/img/retratos/${this.plan()?.dane ?? ENTIDAD_PILOTO}/${d.id}.webp` : null;
  }

  /** iniciales para cuando no hay foto */
  iniciales(nombre: string): string {
    return nombre.split(/\s+/).filter(w => w.length > 2).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  /** atmósfera de color: la propia, o para una subdependencia la de su secretaría girada un poco (se reconoce la familia) */
  atmosfera(d: Dependencia): [number, number, number] {
    const pid = d.padre ?? d.vinculo;
    if (!pid) return atmosferaDe(d.id);
    const [a, b, c] = atmosferaDe(pid);
    const giro = 18 + (matizDe(d.id) % 4) * 8;
    return [(a + giro) % 360, (b + 360 - giro) % 360, (c + giro * 2) % 360];
  }

  /** cuadro oficial más reciente del informe para el responsable */
  ultimoOficial(r: Resumen): { anio: string; plan: number | null; cuatrienio: number | null } | null {
    const a = this.aniosOficiales(r)[0];
    if (!a) return null;
    const o = r.oficial![a];
    return { anio: a, plan: o.plan_accion, cuatrienio: o.cuatrienio };
  }

  /** productos por estado en el informe: color + símbolo + texto, y «sin informe» aparte (nunca 0 %) */
  estados(r: Resumen): { k: string; n: number; g: string; t: string }[] {
    const total = this.cantidad(r);
    const enCurso = r.conSeguimiento - r.cumplidos - r.atrasados;
    return [
      { k: 'ok', n: r.cumplidos, g: '✓', t: r.cumplidos === 1 ? 'cumplido' : 'cumplidos' },
      { k: 'medio', n: enCurso, g: '◐', t: 'en curso' },
      { k: 'bajo', n: r.atrasados, g: '!', t: 'con menos de 50 %' },
      { k: 'nd', n: total - r.conSeguimiento, g: '○', t: 'sin informe' },
    ];
  }

  estadosTexto(r: Resumen): string {
    return 'Productos: ' + this.estados(r).map(e => e.n + ' ' + e.t).join(', ');
  }

  /** Un resumen por dependencia de primer nivel (las externas, como el INDER, no suman a su secretaría). */
  readonly resumenes = computed<Resumen[]>(() => {
    const p = this.plan();
    return p ? construirResumenes(p, this.seguimiento()) : [];
  });

  /** la dependencia de la ruta: una de primer nivel o una subdependencia / entidad vinculada con su propia vista */
  readonly actual = computed<Resumen | null>(() => {
    const id = this.depId();
    const p = this.plan();
    if (!id || !p) return null;
    const raiz = this.resumenes().find(r => r.dep.id === id);
    if (raiz) return raiz;
    const d = p.dependencias.find(x => x.id === id);
    return d ? construirResumen(p, this.seguimiento(), d) : null;
  });

  /** secretaría de la que depende (padre) o a la que está vinculada (entidad externa) */
  readonly padreActual = computed<Dependencia | null>(() => {
    const d = this.actual()?.dep;
    const pid = d?.padre ?? d?.vinculo;
    return pid ? this.plan()?.dependencias.find(x => x.id === pid) ?? null : null;
  });

  /** subdependencias y entidades vinculadas de la dependencia, cada una con su resumen propio */
  readonly subsActual = computed<Resumen[]>(() => {
    const r = this.actual();
    const p = this.plan();
    if (!r || !p) return [];
    return p.dependencias.filter(d => d.padre === r.dep.id || d.vinculo === r.dep.id)
      .map(d => construirResumen(p, this.seguimiento(), d))
      .sort((a, b) => Number(!!a.dep.vinculo) - Number(!!b.dep.vinculo) || this.cantidad(b) - this.cantidad(a));
  });

  /** estado de un producto en el informe más reciente (el mismo criterio de las tarjetas) */
  estadoDe(f: FilaProducto): EstadoProducto {
    return f.pct === null ? 'nd' : f.pct >= 100 ? 'ok' : f.pct >= 50 ? 'medio' : 'bajo';
  }

  /** texto en el que busca la barra, normalizado una sola vez por responsable */
  private readonly textoBusqueda = computed(() => {
    const m = new Map<FilaProducto, string>();
    for (const f of this.actual()?.filas ?? []) {
      m.set(f, this.sinTildes([f.x.id, f.x.indicador, f.x.producto, f.x.detalle ?? '', this.sectorNombre(f.x.sector), f.dep.nombre, f.x.ods ?? ''].join(' ')));
    }
    return m;
  });

  /** productos del responsable que pasan los filtros, por código */
  readonly filasActual = computed(() => {
    const r = this.actual();
    if (!r) return [];
    const palabras = this.sinTildes(this.busca().trim()).split(/\s+/).filter(Boolean);
    const textos = this.textoBusqueda();
    const e = this.fEstado(), l = this.fLinea(), s = this.fSector(), o = this.fOrigen(), d = this.fDep();
    const fs = r.filas.filter(f =>
      (!e || this.estadoDe(f) === e) &&
      (!l || f.x.linea === l) &&
      (!s || f.x.sector === s) &&
      (!o || (o === 'alta' ? f.conf === 'alta' : f.conf !== 'alta')) &&
      (!d || f.dep.id === d) &&
      // cada palabra debe aparecer en algún campo del producto
      palabras.every(w => textos.get(f)!.includes(w)));
    return [...fs].sort((a, b) => a.x.id.localeCompare(b.x.id, 'es', { numeric: true }));
  });

  /** cuántos productos hay en cada estado (sobre todos los del responsable) */
  readonly cuentaEstados = computed(() => {
    const c: Record<EstadoProducto, number> = { ok: 0, medio: 0, bajo: 0, nd: 0 };
    for (const f of this.actual()?.filas ?? []) c[this.estadoDe(f)]++;
    return c;
  });

  readonly estadosFiltro: { k: EstadoProducto; t: string; g: string }[] = [
    { k: 'ok', t: 'Cumplidos', g: '✓' },
    { k: 'medio', t: 'En curso', g: '◐' },
    { k: 'bajo', t: 'Menos de 50 %', g: '!' },
    { k: 'nd', t: 'Sin informe', g: '○' },
  ];

  /** líneas y sectores presentes en los productos del responsable, para las listas de los filtros */
  readonly opcionesLinea = computed(() => {
    const ids = new Set((this.actual()?.filas ?? []).map(f => f.x.linea));
    return (this.plan()?.lineas ?? []).filter(l => ids.has(l.id));
  });
  readonly opcionesSector = computed(() => {
    const ids = new Set((this.actual()?.filas ?? []).map(f => f.x.sector));
    return (this.plan()?.sectores ?? []).filter(s => ids.has(s.cod)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  });

  /** reparto de los productos del responsable por línea estratégica */
  readonly porLinea = computed(() => {
    const r = this.actual();
    const p = this.plan();
    if (!r || !p) return [];
    const ids = this.agrupar(r, f => f.x.linea);
    return p.lineas.map(l => ({ nombre: l.nombre, n: ids.get(l.id)?.size ?? 0 })).filter(l => l.n).sort((a, b) => b.n - a.n);
  });

  readonly porSector = computed(() => {
    const r = this.actual();
    const p = this.plan();
    if (!r || !p) return [];
    const nombres = new Map(p.sectores.map(s => [s.cod, s.nombre]));
    return [...this.agrupar(r, f => f.x.sector)].map(([c, s]) => ({ nombre: nombres.get(c) ?? c, n: s.size })).sort((a, b) => b.n - a.n);
  });

  /** veredas que el informe nombra al hablar de los indicadores del responsable, con esos indicadores */
  readonly veredasActual = computed(() => {
    const r = this.actual();
    const z = this.zonas();
    if (!r || !z) return [];
    const ids = new Set(r.filas.map(f => f.x.id));
    const porVereda: { vereda: string; proyectos: ProyectoZona[] }[] = [];
    for (const [vereda, lista] of Object.entries(z.zonas)) {
      const proyectos = lista.filter(p => ids.has(p.ip));
      if (proyectos.length) porVereda.push({ vereda, proyectos });
    }
    return porVereda.sort((a, b) => b.proyectos.length - a.proyectos.length || a.vereda.localeCompare(b.vereda, 'es'));
  });

  /** indicadores distintos del responsable que el informe ubica en alguna vereda */
  readonly indicadoresConVereda = computed(() => new Set(this.veredasActual().flatMap(v => v.proyectos.map(p => p.ip))).size);

  /** planes de acción del año de la dependencia y sus subsecretarías (solo las que lo publicaron) */
  readonly planesActual = computed<PlanAccionDe[]>(() => {
    const r = this.actual();
    const pa = this.planAccion();
    if (!r || !pa) return [];
    return r.grupo.filter(d => pa.dependencias[d.id]).map(d => ({ dep: d, pa: pa.dependencias[d.id] }));
  });

  /** cifras del plan de acción sumadas para el grupo: presupuesto (sin valores por revisar), por fuente y por trimestre */
  readonly planResumen = computed(() => {
    const planes = this.planesActual();
    if (!planes.length) return null;
    const proyectos = planes.flatMap(p => p.pa.proyectos);
    const validos = proyectos.filter(p => !p.revisar);
    const total = validos.reduce((a, p) => a + p.presupuesto.total, 0);
    const fuentes = FUENTES_PA.map(f => ({ nombre: f.n, valor: validos.reduce((a, p) => a + p.presupuesto[f.k], 0) }))
      .filter(f => f.valor > 0);
    const acciones = proyectos.flatMap(p => p.indicadores.flatMap(i => i.acciones));
    const trimestres = [0, 1, 2, 3].map(t => acciones.filter(a => (a.trimestres[t] ?? 0) > 0).length);
    return {
      total,
      fuentes,
      sumaFuentes: fuentes.reduce((a, f) => a + f.valor, 0),
      proyectos: proyectos.length,
      indicadores: planes.reduce((a, p) => a + p.pa.indicadores, 0),
      cruzados: planes.reduce((a, p) => a + p.pa.cruzados, 0),
      acciones: acciones.length,
      trimestres,
      maxTrimestre: Math.max(1, ...trimestres),
      revisar: proyectos.filter(p => p.revisar).length,
    };
  });

  /** productos del plan (IP-xx) que aparecen en el plan de acción del año, con su meta del año */
  readonly metaPlanAccion = computed(() => {
    const m = new Map<string, number | null>();
    for (const p of this.planesActual()) for (const pr of p.pa.proyectos) for (const i of pr.indicadores) if (i.ip) m.set(i.ip, i.meta_anio);
    return m;
  });

  readonly anioPlanAccion = ANIO_PLAN_ACCION;

  /** acciones de un proyecto */
  accionesDe(pr: ProyectoPlanAccion): number {
    return pr.indicadores.reduce((a, i) => a + i.acciones.length, 0);
  }

  /** abre un producto del plan desde el plan de acción */
  verProducto(ip: string): void {
    this.limpiarFiltros();
    this.abrir('productos');
    setTimeout(() => document.getElementById('prod-' + ip)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  /** pesos en millones, con un decimal cuando hace falta */
  millones(v: number): string {
    const m = v / 1e6;
    return m.toLocaleString('es-CO', { maximumFractionDigits: m < 100 ? 1 : 0 }) + ' M';
  }

  /** productos distintos del responsable */
  cantidad(r: Resumen): number {
    return r.alta + r.sugerida;
  }

  pct(n: number, d: number): number {
    return d ? Math.round((100 * n) / d) : 0;
  }

  esSub(r: Resumen, d: Dependencia): boolean {
    return d.id !== r.dep.id;
  }

  equipoDe(r: Resumen): { dep: Dependencia; gente: Funcionario[] }[] {
    return r.grupo.filter(d => d.equipo?.length).map(d => ({ dep: d, gente: d.equipo }));
  }

  externas(r: Resumen): Dependencia[] {
    return (this.plan()?.dependencias ?? []).filter(d => d.vinculo === r.dep.id);
  }

  urlIcono(d: Dependencia): string | null {
    return d.icono ? `/img/iconos/${d.icono}.png` : null;
  }

  /** años con informe, del más reciente al más antiguo */
  readonly aniosInforme = computed(() => [...(this.seguimiento()?.anios ?? [])].reverse());

  /** global del plan en un año (la fila 'global' de los cuadros del informe) */
  globalDe(anio: string): { cuatrienio: number | null; plan_accion: number | null } | null {
    return this.seguimiento()?.global[anio]?.find(n => n.nivel === 'global') ?? null;
  }

  /** años del informe en que el responsable tiene cuadro oficial, del más reciente al más antiguo */
  aniosOficiales(r: Resumen): string[] {
    return this.aniosInforme().filter(a => r.oficial?.[a]);
  }

  /** narrativas del informe de un producto, de la más reciente a la más antigua */
  /** nombre del sector de un producto, por su código */
  sectorNombre(cod: string): string {
    return this.plan()?.sectores.find(x => x.cod === cod)?.nombre ?? cod;
  }

  narrativas(f: FilaProducto): { anio: string; texto: string }[] {
    const n = f.s?.narrativas ?? {};
    return this.aniosInforme().filter(a => n[a]).map(a => ({ anio: a, texto: n[a]! }));
  }

  /** ¿la ficha del informe y su tabla resumen dicen cosas distintas de este indicador? */
  hayDiferencia(f: FilaProducto): boolean {
    return Object.values(f.s?.por_anio ?? {}).some(a => !!a.ficha);
  }

  /** matiz estable por dependencia (verdes y dorados del tema), para que héroe, anillo y acentos compartan identidad */
  acentoH(id: string): number {
    return matizDe(id);
  }

  /** desplazamiento del trazo del anillo para un % de avance (topado en 100) */
  anilloOffset(p: number | null): number {
    return ANILLO * (1 - Math.min(100, Math.max(0, p ?? 0)) / 100);
  }

  claseAvance(p: number | null): string {
    return p === null ? 'av--nd' : p >= 100 ? 'av--ok' : p >= 50 ? 'av--medio' : 'av--bajo';
  }

  num(v: number | null): string {
    return v === null ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
  }

  entero(v: number | null): string {
    return v === null ? '—' : Math.round(v).toLocaleString('es-CO');
  }

  private agrupar(r: Resumen, clave: (f: FilaProducto) => string): Map<string, Set<string>> {
    const m = new Map<string, Set<string>>();
    for (const f of r.filas) {
      const k = clave(f);
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(f.x.id);
    }
    return m;
  }

  private sinTildes(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
}
