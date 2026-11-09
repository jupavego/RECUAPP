import { AfterViewInit, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { CargadorComponent } from '../../../../shared/components/cargador/cargador.component';
import { filter } from 'rxjs/operators';
import { SECCIONES_RECORRIDO, esRecorrido, rutaDe, seccionDe } from '../../../../core/recorrido';
import { PlanComponent } from '../../../plan/pages/plan/plan.component';
import { PuebloComponent } from '../../../plan/pages/pueblo/pueblo.component';
import { Mapa3dComponent } from '../../../mapa3d/pages/mapa3d/mapa3d.component';
import { MapaComponent } from '../../../mapa/pages/mapa/mapa.component';
import { CatalogoEdificiosComponent } from '../../../mapa3d/pages/catalogo-edificios/catalogo-edificios.component';
import { QuienesSomosComponent } from '../../../../shared/pages/quienes-somos/quienes-somos.component';

/** Una sección de la portada: a dónde lleva y cómo se dibuja. */
interface Seccion {
  id: 'plan' | 'resp' | 'm3d' | 'bib';
  t: string;
  d: string;
  r: string;
  frag?: string;
  c: string;
  g: 'plan' | 'users' | 'cube' | 'book';
}

/** Lo que la gente puede hacer y en qué secciones se hace. */
interface Verbo { v: string; boton: string; g: 'search' | 'users' | 'org' | 'cube'; c: string; ms: Seccion['id'][]; }

/** Proyección de población por edad (public/data/poblacion/05308-edad.json). */
interface ProyeccionEdad {
  metadata: { anios: number[] };
  municipio: Record<string, { H: number[][]; M: number[][] }>;
}

interface CortePob { anio: number; total: number; pir: [number, number][] }

const SECCIONES: Seccion[] = [
  { id: 'plan', t: 'El plan en claro', d: 'Lo que se prometió: programas, metas e inversión.', r: '/plan', c: 'var(--s-plan)', g: 'plan' },
  { id: 'resp', t: 'Responsables y organigrama', d: 'Quién dirige cada dependencia y cómo se organiza la alcaldía.', r: '/responsables', c: 'var(--s-resp)', g: 'users' },
  { id: 'm3d', t: 'Girardota en 3D', d: 'El municipio con sus edificios, redes y equipamientos.', r: '/mapa3d', c: 'var(--s-m3d)', g: 'cube' },
  { id: 'bib', t: 'Biblioteca', d: 'Las fuentes de cada dato, con su enlace y su cita.', r: '/quienes-somos', frag: 'biblioteca', c: 'var(--s-bib)', g: 'book' },
];

const VERBOS: Verbo[] = [
  { v: 'conocer', boton: 'Conocer', g: 'search', c: 'var(--v-conocer)', ms: ['plan', 'resp', 'm3d'] },
  { v: 'vigilar', boton: 'Vigilar', g: 'users', c: 'var(--v-vigilar)', ms: ['plan', 'resp', 'bib'] },
  { v: 'entender', boton: 'Entender', g: 'org', c: 'var(--v-entender)', ms: ['resp', 'bib'] },
  { v: 'interactuar con', boton: 'Interactuar', g: 'cube', c: 'var(--v-interactuar)', ms: ['m3d', 'plan'] },
];

/** años que recorre la cápsula de población */
const ANIOS_POB = [2018, 2025, 2030, 2035, 2042, 2050];

/**
 * Portada de RECUAPP (variante G de public/propuestas/home-creativas.html): un llamado a la acción
 * («El lugar para conocer / vigilar / entender / interactuar con tu administración y tu territorio»),
 * cuatro secciones iguales y la población aparte, como dato. Debajo siguen las vistas reales (plan, responsables,
 * mapa 3D y biblioteca), cargadas al acercarse; cada una conserva además su propia ruta.
 */
@Component({
  selector: 'app-inicio',
  standalone: true,
  // las vistas solo se usan dentro de @defer: Angular las separa en trozos que se descargan al llegar a ellas
  imports: [RouterLink, CargadorComponent, Mapa3dComponent, PlanComponent, PuebloComponent, MapaComponent, CatalogoEdificiosComponent, QuienesSomosComponent],
  templateUrl: './inicio.component.html',
  styleUrl: './inicio.component.scss',
})
export class InicioComponent implements OnInit, AfterViewInit {
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);

  /** el relieve arranca en un punto cualquiera de su recorrido (como en Quiénes somos) */
  readonly fase = -Math.random() * 360;
  readonly altura = Math.random() * 100;

  /** vista con la rueda activa (mapas, pueblo o catálogo): se activa con un clic y se suelta al salir el ratón */
  readonly activa = signal<'m3d' | 'resp' | 'mapa' | 'cat' | null>(null);

  private readonly router = inject(Router);
  /** ruta que puso el propio seguimiento al desplazarse (esa navegación no debe mover la página) */
  private puesta: string | null = null;
  /** mientras la página salta a una sección, el seguimiento no cambia la ruta */
  private saltandoHasta = 0;

  bajar(): void {
    document.getElementById('sec-mapa3d')?.scrollIntoView({ behavior: this.poco ? 'auto' : 'smooth', block: 'start' });
  }

  ngAfterViewInit(): void {
    // al llegar por una ruta (/plan, /mapa3d…), la página abre en esa sección
    this.irA(this.router.url);

    // el menú marca la sección visible: la que cruza la mitad de la pantalla pone su ruta (sin agregar historial)
    const obs = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && this.visible(e.target.id)),
      { rootMargin: '-45% 0px -54% 0px' });
    SECCIONES_RECORRIDO.forEach(s => { const el = document.getElementById(s.id); if (el) obs.observe(el); });

    // un clic en el menú (o en un enlace) hacia otra sección lleva la página hasta ella
    const sub = this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(e => {
      const url = e.urlAfterRedirects;
      if (!esRecorrido(url)) return;
      if (this.puesta !== null && rutaDe(url) === this.puesta && !url.includes('#')) { this.puesta = null; return; }
      this.irA(url);
    });
    this.destroy.onDestroy(() => { obs.disconnect(); sub.unsubscribe(); });
  }

  private visible(id: string): void {
    if (Date.now() < this.saltandoHasta) return;
    const s = SECCIONES_RECORRIDO.find(x => x.id === id);
    if (!s || rutaDe(this.router.url) === s.ruta) return;
    this.puesta = s.ruta;
    this.router.navigateByUrl('/' + s.ruta, { replaceUrl: true });
  }

  /** salta a la sección de la url (y a su ancla, si trae #…); el salto es directo para no cargar las vistas de en medio */
  private irA(url: string): void {
    const s = seccionDe(url);
    if (!s) return;
    const ancla = url.includes('#') ? decodeURIComponent(url.split('#')[1]) : '';
    // 'instant' a propósito: la app declara scroll-behavior: smooth en <html> y un salto largo pasaría por (y cargaría) todo lo de en medio
    const alinear = () => {
      if (s.ruta === '' && !ancla) window.scrollTo({ top: 0, behavior: 'instant' });
      else document.getElementById(s.id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    this.saltando(alinear);
    if (!ancla) return;
    // el ancla vive dentro de una vista que se carga al llegar: se espera a que aparezca
    let intentos = 0;
    const buscar = () => {
      const a = document.getElementById(ancla);
      if (a) { this.saltando(() => a.scrollIntoView({ block: 'start', behavior: 'instant' })); return; }
      if (++intentos < 50) this.relojes.push(setTimeout(buscar, 100));
    };
    buscar();
  }

  /**
   * Salta y vuelve a alinear un par de veces: las vistas que terminan de cargarse justo después del salto cambian de alto
   * y mueven el destino. Si la persona empieza a desplazarse por su cuenta, se le deja de corregir.
   */
  private saltando(alinear: () => void): void {
    this.cancelarAjuste?.();
    let vivo = true;
    const soltar = () => { vivo = false; this.saltandoHasta = 0; };
    const eventos = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    eventos.forEach(ev => window.addEventListener(ev, soltar, { once: true, passive: true }));
    this.cancelarAjuste = () => { vivo = false; eventos.forEach(ev => window.removeEventListener(ev, soltar)); };
    this.saltandoHasta = Date.now() + 1500;
    alinear();
    [150, 450, 900, 1400].forEach(ms => this.relojes.push(setTimeout(() => { if (vivo) alinear(); }, ms)));
    this.relojes.push(setTimeout(() => this.cancelarAjuste?.(), 1500));
  }
  private cancelarAjuste: (() => void) | null = null;

  readonly secciones = SECCIONES;
  readonly verbos = VERBOS;
  private readonly poco = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** texto que se escribe en el titular y su color */
  readonly escrito = signal(this.poco ? VERBOS[0].v : '');
  readonly colorEscrito = signal(VERBOS[0].c);
  /** verbo que resalta secciones: el que se está mostrando o el que la persona eligió */
  readonly activo = signal(-1);
  /** verbo elegido a mano (-1: ninguno) */
  readonly fijo = signal(-1);

  readonly verboActivo = computed(() => (this.activo() >= 0 ? VERBOS[this.activo()] : null));

  private cortes: CortePob[] = [];
  readonly pob = signal<CortePob | null>(null);
  readonly pobTexto = signal('—');

  private relojes: ReturnType<typeof setTimeout>[] = [];
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private auto = !this.poco;

  ngOnInit(): void {
    this.destroy.onDestroy(() => { this.relojes.forEach(clearTimeout); if (this.intervalo) clearInterval(this.intervalo); });
    this.escribir(0, 0, false);
    this.cargarPoblacion();
  }

  resaltada(id: Seccion['id']): boolean {
    const v = this.verboActivo();
    return !!v && v.ms.includes(id);
  }

  elegir(k: number): void {
    this.auto = false;
    this.relojes.forEach(clearTimeout);
    const nuevo = this.fijo() === k ? -1 : k; // tocar el mismo verbo otra vez lo suelta
    this.fijo.set(nuevo);
    this.activo.set(nuevo);
    const v = VERBOS[nuevo < 0 ? 0 : nuevo];
    this.escrito.set(v.v);
    this.colorEscrito.set(v.c);
  }

  /** máquina de escribir lenta: escribe el verbo, lo deja unos segundos resaltando sus secciones y pasa al siguiente */
  private escribir(i: number, j: number, borra: boolean): void {
    if (!this.auto) return;
    const f = VERBOS[i].v;
    j += borra ? -1 : 1;
    this.escrito.set(f.slice(0, j));
    this.colorEscrito.set(VERBOS[i].c);
    let espera = borra ? 55 : 120;
    if (!borra && j === f.length) { this.activo.set(i); borra = true; espera = 4200; }
    else if (borra && j === 0) { borra = false; this.activo.set(-1); i = (i + 1) % VERBOS.length; espera = 700; }
    this.relojes.push(setTimeout(() => this.escribir(i, j, borra), espera));
  }

  private cargarPoblacion(): void {
    this.http.get<ProyeccionEdad>('data/poblacion/05308-edad.json').subscribe({
      next: d => {
        const anios = d.metadata.anios;
        const zonas = Object.values(d.municipio);
        this.cortes = ANIOS_POB.filter(a => anios.includes(a)).map(a => {
          const k = anios.indexOf(a);
          const H = zonas[0].H[k].map((_, g) => zonas.reduce((s, z) => s + z.H[k][g], 0));
          const M = zonas[0].M[k].map((_, g) => zonas.reduce((s, z) => s + z.M[k][g], 0));
          return { anio: a, total: [...H, ...M].reduce((s, v) => s + v, 0), pir: H.map((h, g) => [h, M[g]] as [number, number]) };
        });
        if (!this.cortes.length) return;
        let k = Math.max(0, this.cortes.findIndex(c => c.anio === 2025));
        this.mostrar(k);
        if (!this.poco && this.cortes.length > 1) {
          this.intervalo = setInterval(() => { k = (k + 1) % this.cortes.length; this.mostrar(k); }, 5200);
        }
      },
      error: () => this.pob.set(null),
    });
  }

  /** ancho de cada barra de la pirámide, en % de su mitad */
  ancho(v: number): number {
    const p = this.pob();
    if (!p) return 0;
    const mx = Math.max(...p.pir.map(g => Math.max(g[0], g[1]))) || 1;
    return (v / mx) * 46;
  }

  private mostrar(k: number): void {
    const antes = this.pob()?.total ?? 0;
    const corte = this.cortes[k];
    this.pob.set(corte);
    if (this.poco || typeof requestAnimationFrame === 'undefined') { this.pobTexto.set(corte.total.toLocaleString('es-CO')); return; }
    const t0 = performance.now();
    const paso = (t: number) => {
      const f = Math.min(1, (t - t0) / 1400);
      this.pobTexto.set(Math.round(antes + (corte.total - antes) * f).toLocaleString('es-CO'));
      if (f < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
}
