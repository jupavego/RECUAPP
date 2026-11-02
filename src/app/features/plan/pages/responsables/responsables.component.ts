import { Component, HostBinding, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { TemaService } from '../../../../core/services/tema.service';
import { AvanceDependencia, AvanceIndicador, Confianza, Dependencia, Funcionario, PlanEntidad, PlanService, ProductoPlan, ProyectoZona, Seguimiento, ZonasPlan } from '../../services/plan.service';

/** Entidad que se abre cuando la ruta no trae código DANE (mientras dure el piloto). */
const ENTIDAD_PILOTO = '05308';
const ANIOS = ['2024', '2025', '2026', '2027'];

export type Orden = 'productos' | 'avance' | 'nombre';
export type Pestana = 'panorama' | 'productos' | 'equipo';

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

/** Un resumen por dependencia de primer nivel (las externas, como el INDER, no suman a su secretaría). */
export function construirResumenes(p: PlanEntidad, seguimiento: Seguimiento | null): Resumen[] {
  const seg = seguimiento?.indicadores ?? {};
  const deps = new Map(p.dependencias.map(d => [d.id, d]));
  const raices = p.dependencias.filter(d => !d.padre && !d.vinculo);
  return raices.map(dep => {
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
  });
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

  @HostBinding('class.tema-botanico') get botanico(): boolean { return this.tema.botanico(); }
  @HostBinding('class.tema-oscuro') get oscuro(): boolean { return this.tema.oscuro(); }

  readonly orden = signal<Orden>('productos');
  readonly texto = signal('');
  /** responsable de la ruta /responsables/:dep; null en el listado */
  readonly depId = toSignal(this.ruta.paramMap.pipe(map(p => p.get('dep'))), { initialValue: this.ruta.snapshot.paramMap.get('dep') });
  readonly soloConAvance = signal(false);
  readonly pestana = signal<Pestana>('panorama');
  readonly anios = ANIOS;

  /** Un resumen por dependencia de primer nivel (las externas, como el INDER, no suman a su secretaría). */
  readonly resumenes = computed<Resumen[]>(() => {
    const p = this.plan();
    return p ? construirResumenes(p, this.seguimiento()) : [];
  });

  readonly lista = computed(() => {
    const q = this.sinTildes(this.texto().trim());
    const o = this.orden();
    const base = this.resumenes().filter(r => !q || this.sinTildes(r.dep.nombre + ' ' + (r.dep.responsable?.nombre ?? '')).includes(q));
    return [...base].sort((a, b) =>
      o === 'nombre' ? a.dep.nombre.localeCompare(b.dep.nombre, 'es')
      : o === 'avance' ? (b.avance ?? -1) - (a.avance ?? -1)
      : this.cantidad(b) - this.cantidad(a));
  });

  readonly actual = computed<Resumen | null>(() => this.resumenes().find(r => r.dep.id === this.depId()) ?? null);

  /** productos del responsable elegido, por código */
  readonly filasActual = computed(() => {
    const r = this.actual();
    if (!r) return [];
    const fs = this.soloConAvance() ? r.filas.filter(f => f.pct !== null) : r.filas;
    return [...fs].sort((a, b) => a.x.id.localeCompare(b.x.id, 'es', { numeric: true }));
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

  /** cifras de la vista general */
  readonly general = computed(() => {
    const rs = this.resumenes();
    const conInforme = new Set(rs.flatMap(r => r.filas).filter(f => f.pct !== null).map(f => f.x.id));
    return {
      responsables: rs.length,
      conPersona: rs.filter(r => r.dep.responsable).length,
      personas: rs.reduce((a, r) => a + r.equipo, 0),
      sinProductos: rs.filter(r => !r.filas.length).length,
      conSeguimiento: conInforme.size,
      maxProductos: Math.max(1, ...rs.map(r => this.cantidad(r))),
    };
  });

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
