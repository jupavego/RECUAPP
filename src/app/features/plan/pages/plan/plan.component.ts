import { Component, HostBinding, computed, inject, signal } from '@angular/core';
import { CierraFueraDirective } from '../../../../shared/directives/cierra-fuera.directive';
import { TemaService } from '../../../../core/services/tema.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { Confianza, Dependencia, Funcionario, PlanEntidad, PlanService, ProductoPlan } from '../../services/plan.service';

/** Entidad que se abre cuando la ruta no trae código DANE (mientras dure el piloto). */
const ENTIDAD_PILOTO = '05308';

/** icono de cada ODS, por el nombre con que llega en el plan */
const ICONO_ODS: Record<string, string> = {
  'Fin de la pobreza': '01', 'Salud y bienestar': '03', 'Educación de calidad': '04', 'Igualdad de género': '05',
  'Agua limpia y saneamiento': '06', 'Energía asequible y no contaminante': '07', 'Trabajo decente y crecimiento económico': '08',
  'Industria, innovación e infraestructura': '09', 'Reducción de las desigualdades': '10', 'Ciudades y comunidades sostenibles': '11',
  'Producción y consumo responsables': '12', 'Acción por el clima': '13', 'Vida de ecosistemas terrestres': '15',
  'Paz, justicia e instituciones sólidas': '16', 'Alianzas para lograr los objetivos': '17', 'Sin ODS': 'sin-ods',
};

const POR_PAGINA = 25;

/** categoría del plan cuyos productos se están viendo en el visor de abajo */
export interface Grupo { tipo: 'linea' | 'sector' | 'programa' | 'ods'; valor: string; titulo: string; etiqueta: string }

type Tarjeta = 'lineas' | 'sectores' | 'programas' | 'resultado' | 'responsables' | 'ods' | 'financiacion' | 'calidad' | 'solopdf';

@Component({
  selector: 'app-plan',
  standalone: true,
  imports: [CierraFueraDirective],
  templateUrl: './plan.component.html',
  styleUrl: './plan.component.scss',
})
export class PlanComponent {
  private readonly servicio = inject(PlanService);
  private readonly ruta = inject(ActivatedRoute);

  /** undefined mientras carga, null si no hay datos de la entidad */
  readonly plan = toSignal<PlanEntidad | null | undefined>(
    this.ruta.paramMap.pipe(
      map(p => p.get('dane') ?? ENTIDAD_PILOTO),
      switchMap(d => this.servicio.entidad(d).pipe(catchError(() => of(null)))),
    ),
    { initialValue: undefined },
  );

  /** Modo opcional "Earthy Botanical": se elige con el botón, se recuerda en el navegador y ?tema=botanico|base lo fuerza. */
  private readonly tema = inject(TemaService);
  readonly botanicoOn = this.tema.botanico;

  @HostBinding('class.tema-botanico')
  get botanico(): boolean {
    return this.botanicoOn();
  }

  @HostBinding('class.tema-oscuro')
  get oscuro(): boolean {
    return this.tema.oscuro();
  }

  constructor() {
    const q = this.ruta.snapshot.queryParamMap.get('tema');
    if (q === 'botanico' || q === 'oscuro' || q === 'base') this.tema.fijar(q);
  }

  readonly abierta = signal<Tarjeta | null>(null);

  readonly dependencias = computed(() => new Map((this.plan()?.dependencias ?? []).map(d => [d.id, d])));
  /** icono de cada entidad responsable, por id de dependencia o por nombre de otra entidad */
  readonly icono = computed(() => {
    const p = this.plan();
    const m = new Map<string, string | null>();
    p?.dependencias.forEach(d => m.set(d.id, d.icono));
    p?.otras_entidades.forEach(o => m.set(o.nombre, o.icono));
    return m;
  });
  readonly nombresOtras = computed(() => (this.plan()?.otras_entidades ?? []).map(o => o.nombre).join(', '));
  readonly sectorDe = computed(() => new Map((this.plan()?.sectores ?? []).map(s => [s.cod, s.nombre])));

  readonly maxSector = computed(() => Math.max(1, ...(this.plan()?.sectores ?? []).map(s => s.productos)));
  readonly maxPrograma = computed(() => Math.max(1, ...(this.plan()?.programas ?? []).map(s => s.productos)));
  readonly maxLinea = computed(() => Math.max(1, ...(this.plan()?.lineas ?? []).map(s => s.productos)));
  /** dependencias sin padre; las subsecretarías se muestran debajo de la suya */
  readonly raices = computed(() => (this.plan()?.dependencias ?? []).filter(d => !d.padre));
  /** las dependencias de primer nivel, de la que más productos tiene a la que menos (el orden de la alcaldía desempata) */
  readonly raicesPorPeso = computed(() => [...this.raices()].sort((a, b) => this.totalDep(b.id) - this.totalDep(a.id)));

  /** productos con responsable según el PDF y productos que solo tienen uno sugerido por sector */
  readonly conteo = computed(() => {
    const ps = this.plan()?.productos ?? [];
    const alta = ps.filter(p => p.resp.some(r => r.conf === 'alta')).length;
    return { alta, sugerida: ps.filter(p => p.resp.length && !p.resp.some(r => r.conf === 'alta')).length };
  });

  // Visor de productos e indicadores de la categoría elegida (línea, sector, programa u ODS).
  readonly grupo = signal<Grupo | null>(null);
  readonly texto = signal('');
  readonly pagina = signal(0);

  readonly delGrupo = computed<ProductoPlan[]>(() => {
    const g = this.grupo();
    const ps = this.plan()?.productos ?? [];
    if (!g) return [];
    return ps.filter(x => g.tipo === 'linea' ? x.linea === g.valor : g.tipo === 'sector' ? x.sector === g.valor
      : g.tipo === 'programa' ? x.programa === g.valor : (x.ods || 'Sin ODS') === g.valor);
  });
  readonly filtrados = computed(() => {
    const q = this.texto().trim().toLowerCase();
    return q ? this.delGrupo().filter(x => (x.indicador + ' ' + x.producto + ' ' + x.detalle).toLowerCase().includes(q)) : this.delGrupo();
  });
  readonly visibles = computed(() => this.filtrados().slice(this.pagina() * POR_PAGINA, (this.pagina() + 1) * POR_PAGINA));
  readonly paginas = computed(() => Math.max(1, Math.ceil(this.filtrados().length / POR_PAGINA)));

  /** Abre el visor con los productos de una categoría y baja hasta él. */
  verGrupo(tipo: Grupo['tipo'], valor: string, titulo: string): void {
    const etiqueta = { linea: 'Línea estratégica', sector: 'Sector', programa: 'Programa', ods: 'ODS' }[tipo];
    this.grupo.set({ tipo, valor, titulo, etiqueta });
    this.texto.set('');
    this.pagina.set(0);
    setTimeout(() => document.getElementById('visor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  cerrarVisor(): void {
    this.grupo.set(null);
  }

  buscar(v: string): void {
    this.texto.set(v);
    this.pagina.set(0);
  }

  mover(d: number): void {
    this.pagina.set(Math.min(this.paginas() - 1, Math.max(0, this.pagina() + d)));
  }

  /** nombres de los responsables de un producto, con la confianza de cada asignación */
  respDe(x: ProductoPlan): { nombre: string; conf: Confianza }[] {
    const deps = this.dependencias();
    return x.resp.map(r => ({ nombre: deps.get(r.dep)?.nombre ?? r.dep, conf: r.conf }));
  }

  /** responsable (o subsecretaría) cuya subcápsula está abierta */
  readonly depAbierta = signal<string | null>(null);

  /** detalle de un producto flotando junto a su botón; va fuera de la lista porque la lista tiene scroll y recortaría la caja */
  readonly tip = signal<{ x: ProductoPlan; top: number; left: number; lado: 'izq' | 'abajo'; ancla: number } | null>(null);

  mostrarDetalle(ev: Event, x: ProductoPlan): void {
    this.conservarDetalle();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const ancho = Math.min(360, window.innerWidth - 24);
    // a la izquierda del botón, centrado con él y sin tapar la fila; si no cabe, debajo
    const aLaIzq = r.left - 14 - ancho >= 12;
    const left = aLaIzq ? r.left - 14 - ancho : Math.max(12, Math.min(r.right - ancho, window.innerWidth - ancho - 12));
    const mitad = 150; // alto aproximado de la mitad de la caja
    const top = aLaIzq ? Math.min(Math.max(r.top + r.height / 2, mitad + 12), window.innerHeight - mitad - 12) : r.bottom + 10;
    this.tip.set({ x, left, top, lado: aLaIzq ? 'izq' : 'abajo', ancla: r.top + r.height / 2 - (aLaIzq ? top : 0) });
  }

  private cierreDetalle: ReturnType<typeof setTimeout> | undefined;

  /** Cierra el detalle tras una pausa, para poder pasar el cursor a la caja y seleccionar o copiar su texto. */
  ocultarDetalle(): void {
    clearTimeout(this.cierreDetalle);
    this.cierreDetalle = setTimeout(() => this.tip.set(null), 350);
  }

  /** El cursor está sobre el botón o sobre la caja: no se cierra. */
  conservarDetalle(): void {
    clearTimeout(this.cierreDetalle);
  }

  alternarDep(id: string): void {
    this.depAbierta.set(this.depAbierta() === id ? null : id);
  }

  /** la secretaría de la subsecretaría abierta también se ve abierta */
  hijoAbierto(id: string): boolean {
    const a = this.depAbierta();
    return !!a && this.dependencias().get(a)?.padre === id;
  }

  /** productos de un responsable; una secretaría incluye los de sus subsecretarías */
  productosDe(id: string): ProductoPlan[] {
    const deps = this.dependencias();
    return (this.plan()?.productos ?? []).filter(x => x.resp.some(r => r.dep === id || deps.get(r.dep)?.padre === id));
  }

  /** equipo de un responsable; una secretaría incluye el de sus subsecretarías */
  equipoDe(id: string): Funcionario[] {
    const deps = this.plan()?.dependencias ?? [];
    return deps.filter(d => d.id === id || d.padre === id).flatMap(d => d.equipo ?? []);
  }

  confDe(x: ProductoPlan, id: string): Confianza {
    const deps = this.dependencias();
    return x.resp.find(r => r.dep === id || deps.get(r.dep)?.padre === id)?.conf ?? 'baja';
  }

  urlOds(nombre: string): string | null {
    const i = ICONO_ODS[nombre];
    return i ? `/img/ods/${i}.png` : null;
  }

  urlIcono(clave: string): string | null {
    const i = this.icono().get(clave);
    return i ? `/img/iconos/${i}.png` : null;
  }

  alternar(t: Tarjeta): void {
    this.abierta.set(this.abierta() === t ? null : t);
  }

  hijos(id: string): Dependencia[] {
    return (this.plan()?.dependencias ?? []).filter(d => d.padre === id);
  }

  /** productos de una dependencia, contando los de sus subsecretarías */
  totalDep(id: string): number {
    const d = this.dependencias().get(id);
    return d ? this.total(d.productos) + this.hijos(id).reduce((a, h) => a + this.total(h.productos), 0) : 0;
  }

  /** productos de una dependencia por confianza, contando los de sus subsecretarías */
  conf(id: string, c: 'alta' | 'sugerida'): number {
    const suma = (d?: Dependencia) => (!d ? 0 : c === 'alta' ? d.productos.alta : d.productos.media + d.productos.baja);
    return suma(this.dependencias().get(id)) + this.hijos(id).reduce((a, h) => a + suma(h), 0);
  }

  /** 0 a 1: peso de la dependencia frente a la que más productos tiene (los porcentajes son chicos, así que se escala al máximo) */
  intensidad(id: string): number {
    const max = Math.max(1, ...this.raices().map((r) => this.totalDep(r.id)));
    return Math.min(1, this.totalDep(id) / max);
  }

  /** verde normal para las que tienen pocos productos, verde fosforescente para las que más */
  colorDona(id: string): string {
    const t = this.intensidad(id);
    return `hsl(${Math.round(150 - 40 * t)}, ${Math.round(42 + 58 * t)}%, ${Math.round(32 + 24 * t)}%)`;
  }

  total(c: Record<Confianza, number>): number {
    return c.alta + c.media + c.baja;
  }

  sumaAnios(v: number[]): number {
    return v.reduce((a, b) => a + b, 0);
  }

  pct(n: number, d: number): number {
    return d ? Math.round((100 * n) / d) : 0;
  }

  /** $ en miles de millones, que es como se lee un presupuesto municipal */
  mm(v: number): string {
    return '$' + (v / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 0 }) + ' mil millones';
  }

  num(v: number | null): string {
    return v === null ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
  }

  etiquetaConf(c: Confianza): string {
    return c === 'alta' ? 'según el PDF' : 'sugerida por sector';
  }
}
