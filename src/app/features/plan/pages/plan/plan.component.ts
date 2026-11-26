import { Component, HostBinding, computed, effect, inject, signal } from '@angular/core';
import { TemaService } from '../../../../core/services/tema.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { matizDe } from '../responsables/responsables.component';
import { icono3d as rutaIcono3d } from '../../services/iconos-3d';
import { CargadorComponent } from '../../../../shared/components/cargador/cargador.component';
import { Confianza, Dependencia, PlanEntidad, PlanService, ProductoPlan } from '../../services/plan.service';

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

/** ícono de trazo fino (Tabler, /img/trazo) de cada subsecretaría o unidad: más abstracto y sin ruido junto a los íconos de las secretarías */
const TRAZO_SUB: Record<string, string> = {
  sub_cul: 'palette', sub_seg: 'shield-check', uni_com: 'users', uni_ins: 'scale',
  sub_prot: 'heart-handshake', inder: 'run', sub_part: 'speakerphone', sub_dec: 'chart-line', sub_tec: 'bulb',
};

type Tarjeta = 'lineas' | 'sectores' | 'programas' | 'resultado' | 'responsables' | 'ods' | 'financiacion' | 'calidad' | 'solopdf';

@Component({
  selector: 'app-plan',
  standalone: true,
  imports: [CargadorComponent],
  templateUrl: './plan.component.html',
  styleUrl: './plan.component.scss',
})
export class PlanComponent {
  private readonly servicio = inject(PlanService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

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
    if (q === 'botanico' || q === 'oscuro') this.tema.fijar(q);
    // al cargar el plan, deja el icono de la tarjeta inicial en el centro de la tira
    effect(() => { if (this.ordenCarrusel().length) setTimeout(() => this.centrarIcono(), 120); });
  }

  readonly abierta = signal<Tarjeta | null>(null);

  // Sectores en mosaico: del que más productos tiene al que menos
  readonly sectoresOrden = computed(() => [...(this.plan()?.sectores ?? [])].sort((a, b) => b.productos - a.productos));
  matizSector(i: number): number {
    const n = Math.max(1, this.sectoresOrden().length - 1);
    return 150 - Math.round((i * 110) / n);
  }

  // Programas agrupados por línea estratégica (la línea se deduce de los productos del programa)
  readonly buscaProg = signal('');
  private readonly gruposProg = signal<string[] | null>(null);
  readonly lineaDePrograma = computed(() => {
    const m = new Map<string, string>();
    for (const x of this.plan()?.productos ?? []) if (x.programa && !m.has(x.programa)) m.set(x.programa, x.linea);
    return m;
  });
  readonly programasPorLinea = computed(() => {
    const p = this.plan();
    if (!p) return [];
    const q = this.buscaProg().trim().toLowerCase();
    const de = this.lineaDePrograma();
    return p.lineas.map((l, i) => {
      const items = p.programas.filter(g => de.get(g.cod) === l.id && (!q || g.nombre.toLowerCase().includes(q)))
        .sort((a, b) => b.productos - a.productos);
      return { id: l.id, n: i + 1, nombre: l.nombre, matiz: this.matiz(i), items, total: items.reduce((a, g) => a + g.productos, 0) };
    }).filter(g => g.items.length);
  });
  // Programas por eje: pestañas para elegir el eje y lista de sus programas
  private readonly ejeElegido = signal<string | null>(null);
  /** eje que se está viendo: el elegido, o el primero que tenga programas (con una búsqueda, el primero que coincida) */
  readonly ejeActivo = computed(() => {
    const gs = this.programasPorLinea();
    return gs.find(g => g.id === this.ejeElegido()) ?? gs[0] ?? null;
  });
  /** programas del eje activo con más productos: sirve de escala a las barras de esa lista */
  readonly ejeMax = computed(() => Math.max(1, ...(this.ejeActivo()?.items ?? []).map(x => x.productos)));

  elegirEje(id: string): void {
    this.ejeElegido.set(id);
  }

  /** flechas del teclado entre pestañas: elige el eje vecino y le pasa el foco */
  moverEje(d: number, ev: Event): void {
    ev.preventDefault();
    const gs = this.programasPorLinea();
    const i = gs.findIndex(g => g.id === this.ejeActivo()?.id);
    const sig = gs[(i + d + gs.length) % gs.length];
    if (!sig) return;
    this.ejeElegido.set(sig.id);
    setTimeout(() => document.getElementById('eje-tab-' + sig.id)?.focus());
  }

  sectorNombre(cod: string): string {
    return this.sectorDe().get(cod) ?? '';
  }

  // Indicadores de resultado: todos a la vista (dos columnas con desplazamiento propio) y un buscador
  readonly buscaRes = signal('');
  readonly resultadoVisible = computed(() => {
    const todos = this.plan()?.resultado ?? [];
    const q = this.buscaRes().trim().toLowerCase();
    return q ? todos.filter(r => r.indicador.toLowerCase().includes(q)) : todos;
  });
  matizLinea(id: string): number {
    return this.matiz(Math.max(0, (this.plan()?.lineas ?? []).findIndex(l => l.id === id)));
  }

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
  readonly raices = computed(() => (this.plan()?.dependencias ?? []).filter(d => !d.padre && !d.vinculo));
  /** las dependencias de primer nivel, de la que más productos tiene a la que menos (el orden de la alcaldía desempata) */
  readonly raicesPorPeso = computed(() => [...this.raices()].sort((a, b) => this.totalDep(b.id) - this.totalDep(a.id)));

  // ── Carrusel de responsables: la tarjeta del centro es la activa; el selector de iconos y las flechas la cambian ──
  /** cuatrienio del plan: del 1 de enero de 2024 al 31 de diciembre de 2027, y cuánto va a la fecha de hoy */
  readonly cuatrienio = (() => {
    const anios = [2024, 2025, 2026, 2027];
    const ini = new Date(anios[0], 0, 1).getTime();
    const fin = new Date(anios[3] + 1, 0, 1).getTime();
    const hoy = new Date();
    const avance = Math.round(100 * Math.min(1, Math.max(0, (hoy.getTime() - ini) / (fin - ini))));
    const fecha = hoy.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
    const texto = hoy.getTime() >= fin ? 'El cuatrienio ya terminó.'
      : hoy.getTime() < ini ? 'El cuatrienio aún no empieza.'
      : `Va el ${avance} % del cuatrienio, a ${fecha}.`;
    return { anios, anio: hoy.getFullYear(), avance, texto };
  })();

  /** desde el encabezado: baja a Programas con la línea elegida */
  irEje(id: string): void {
    this.elegirEje(id);
    document.getElementById('programas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** orden del carrusel: por peso, con el Despacho del Alcalde en el centro, que es la tarjeta con la que abre */
  readonly ordenCarrusel = computed(() => {
    const todas = this.raicesPorPeso();
    const des = todas.find(d => d.id === 'des');
    if (!des) return todas;
    const otras = todas.filter(d => d !== des);
    otras.splice(Math.floor(todas.length / 2), 0, des);
    return otras;
  });
  private readonly elegida = signal<number | null>(null);
  /** tarjeta del centro: la que se eligió, o la de la mitad de la lista mientras no se elija otra */
  readonly activo = computed(() => this.elegida() ?? Math.floor(this.ordenCarrusel().length / 2));
  private xToque = 0;

  /** iconos 3D de las dependencias de primer nivel (public/img/responsables-3d/<id>.svg); el resto usa el icono de siempre */
  icono3d(id: string): string | null {
    return rutaIcono3d(id) ?? this.urlIcono(id);
  }

  ir(i: number): void {
    const n = this.ordenCarrusel().length;
    this.elegida.set(Math.min(n - 1, Math.max(0, i)));
    this.centrarIcono();
  }

  paso(d: number, ev?: Event): void {
    ev?.preventDefault();
    this.ir(this.activo() + d);
  }

  absoluto(i: number): number {
    return Math.abs(i - this.activo());
  }

  signo(i: number): number {
    return Math.sign(i - this.activo());
  }

  /** más allá de tres tarjetas del centro ya no se dibujan */
  lejos(i: number): boolean {
    return this.absoluto(i) > 3;
  }

  tocar(ev: TouchEvent, inicio: boolean): void {
    const x = ev.changedTouches[0].clientX;
    if (inicio) { this.xToque = x; return; }
    const dif = this.xToque - x;
    if (Math.abs(dif) > 40) this.paso(dif > 0 ? 1 : -1);
  }

  /** deja el icono activo en el centro de la tira, sin mover la página */
  private centrarIcono(): void {
    setTimeout(() => {
      const el = document.getElementById('cf-ico-' + this.activo());
      const tira = el?.parentElement;
      if (!el || !tira) return;
      const suave = typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      tira.scrollTo({ left: el.offsetLeft - tira.clientWidth / 2 + el.clientWidth / 2, behavior: suave ? 'smooth' : 'auto' });
    });
  }

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

  /** Abre la ficha independiente del responsable; una subsecretaría o entidad externa abre la de su secretaría. */
  irFicha(id: string): void {
    const d = this.dependencias().get(id);
    this.router.navigate(['/responsables', d?.padre ?? d?.vinculo ?? id]);
  }

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

  urlOds(nombre: string): string | null {
    const i = ICONO_ODS[nombre];
    return i ? `/img/ods/${i}.png` : null;
  }

  trazoSub(id: string): string | null {
    return TRAZO_SUB[id] ?? null;
  }

  urlIcono(clave: string): string | null {
    const i = this.icono().get(clave);
    return i ? `/img/iconos/${i}.png` : null;
  }

  alternar(t: Tarjeta): void {
    this.abierta.set(this.abierta() === t ? null : t);
  }

  /** entidades externas que se muestran en un tercer nivel bajo esta dependencia */
  externas(id: string): Dependencia[] {
    return (this.plan()?.dependencias ?? []).filter(d => d.vinculo === id);
  }

  hijos(id: string): Dependencia[] {
    return (this.plan()?.dependencias ?? []).filter(d => d.padre === id);
  }

  /** productos de una dependencia, contando los de sus subsecretarías */
  totalDep(id: string): number {
    const d = this.dependencias().get(id);
    return d ? this.total(d.productos) + this.hijos(id).reduce((a, h) => a + this.total(h.productos), 0) : 0;
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

  /** matiz de cada eje, dentro de la gama verde-lima-dorado del tema */
  matiz(i: number): number {
    return [150, 120, 88, 46][i % 4];
  }

  /** matiz estable de cada responsable, el mismo de su ficha */
  matizDep(id: string): number {
    return matizDe(id);
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
