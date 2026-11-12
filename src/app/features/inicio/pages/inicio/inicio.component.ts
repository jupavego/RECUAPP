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
import { QuienesSomosComponent } from '../../../../shared/pages/quienes-somos/quienes-somos.component';

/** Una sección de la portada: a dónde lleva y cómo se dibuja. */
interface Seccion {
  id: 'plan' | 'resp' | 'm3d' | 'bib';
  n: string;
  s: string;
  r: string;
  frag?: string;
  g: 'plan' | 'users' | 'cube' | 'book';
}

/** Lo que la gente puede hacer y en qué secciones se hace. */
interface Verbo { v: string; c: string; ms: Seccion['id'][]; }

/** Una escena del fondo: toma real del visor 3D con sus capas y su ángulo. */
interface Escena { id: string; n: string; f: string; t: string; }

/** Proyección de población por edad (public/data/poblacion/05308-edad.json). */
interface ProyeccionEdad {
  metadata: { anios: number[] };
  municipio: Record<string, { H: number[][]; M: number[][] }>;
}

interface CortePob { anio: number; total: number; pir: [number, number][] }

const SECCIONES: Seccion[] = [
  { id: 'plan', n: 'El plan en claro', s: 'Programas, metas e inversión', r: '/plan', g: 'plan' },
  { id: 'resp', n: 'Responsables', s: 'Quién dirige cada dependencia', r: '/responsables', g: 'users' },
  { id: 'm3d', n: 'Girardota en 3D', s: 'Explorar el mapa completo', r: '/mapa3d', g: 'cube' },
  { id: 'bib', n: 'Biblioteca', s: 'Las fuentes de cada dato', r: '/quienes-somos', frag: 'biblioteca', g: 'book' },
];

const VERBOS: Verbo[] = [
  { v: 'conocer', c: 'var(--v-conocer)', ms: ['plan', 'resp', 'm3d'] },
  { v: 'vigilar', c: 'var(--v-vigilar)', ms: ['plan', 'resp', 'bib'] },
  { v: 'entender', c: 'var(--v-entender)', ms: ['resp', 'bib'] },
  { v: 'interactuar con', c: 'var(--v-interactuar)', ms: ['m3d', 'plan'] },
];

/** Escenas del fondo (capturas del visor 3D en public/img/portada): cada una mira el municipio desde un ángulo y con capas distintas. */
const ESCENAS: Escena[] = [
  { id: 'instituciones', n: 'Instituciones', f: '/img/portada/instituciones.jpg', t: 'Educación, cultura, salud, turismo, deporte, justicia y patrimonio.' },
  { id: 'industrias', n: 'Industrias', f: '/img/portada/industrias.jpg', t: 'Empresas con fuentes fijas de emisión, según Corantioquia 2021. Vista a lo largo del valle.' },
  { id: 'agua', n: 'Agua', f: '/img/portada/agua.jpg', t: 'Ríos y quebradas, bocatomas, tratamiento, tanques y PTAR. Vista sobre el cauce del río.' },
  { id: 'zonas', n: 'Zonas', f: '/img/portada/zonas.jpg', t: 'Veredas y cabecera con sus nombres y límites. Panorámica del municipio entero.' },
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
  imports: [RouterLink, CargadorComponent, Mapa3dComponent, PlanComponent, PuebloComponent, MapaComponent, QuienesSomosComponent],
  templateUrl: './inicio.component.html',
  styleUrl: './inicio.component.scss',
})
export class InicioComponent implements OnInit, AfterViewInit {
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);

  /** escena del fondo y si la portada está a la vista (fuera de pantalla la deriva se detiene) */
  readonly escenas = ESCENAS;
  readonly escena = signal(0);
  readonly heroVisible = signal(true);

  /** vista con la rueda activa (mapas, pueblo o catálogo): se activa con un clic y se suelta al salir el ratón */
  readonly activa = signal<'m3d' | 'resp' | 'mapa' | null>(null);

  private readonly router = inject(Router);
  /** ruta que puso el propio seguimiento al desplazarse (esa navegación no debe mover la página) */
  private puesta: string | null = null;
  /** mientras la página salta a una sección, el seguimiento no cambia la ruta */
  private saltandoHasta = 0;

  bajar(): void {
    document.getElementById('sec-mapa3d')?.scrollIntoView({ behavior: this.poco ? 'auto' : 'smooth', block: 'start' });
  }

  /**
   * Activa la rueda de una vista y, si la sección no está completa en pantalla, la centra: la deja justo debajo de la barra
   * para que el mapa quede entero en el viewport. Si ya está alineada no se mueve.
   */
  activar(clave: 'm3d' | 'resp' | 'mapa', id: string): void {
    this.activa.set(clave);
    const el = document.getElementById(id);
    if (!el) return;
    const barra = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (Math.abs(el.getBoundingClientRect().top - barra) < 2) return;
    this.saltandoHasta = Date.now() + 1200;   // mientras baja, el seguimiento no cambia la ruta
    el.scrollIntoView({ block: 'start', behavior: this.poco ? 'auto' : 'smooth' });
  }

  elegirEscena(k: number): void { this.escena.set(k); }

  ngAfterViewInit(): void {
    const hero = document.getElementById('sec-inicio');
    const obsHero = hero ? new IntersectionObserver(es => this.heroVisible.set(es.some(e => e.isIntersecting))) : null;
    if (hero) obsHero?.observe(hero);
    this.destroy.onDestroy(() => obsHero?.disconnect());

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

  /** verbo que muestra el titular; cada vez que cambia (o se vuelve a elegir) la franja de escáner lo revela de nuevo */
  readonly mostrado = signal(0);
  /** contador de pasadas: recrea la palabra para que su animación de entrada vuelva a correr */
  readonly pasada = signal(0);
  /** la palabra se está disolviendo para dar paso a la siguiente */
  readonly saliendo = signal(false);
  /** verbo que resalta secciones: el que se está mostrando o el que la persona eligió */
  readonly activo = signal(-1);
  readonly verboActivo = computed(() => (this.activo() >= 0 ? VERBOS[this.activo()] : null));

  private cortes: CortePob[] = [];
  readonly pob = signal<CortePob | null>(null);
  readonly pobTexto = signal('—');

  private relojes: ReturnType<typeof setTimeout>[] = [];
  private intervalo: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.destroy.onDestroy(() => { this.relojes.forEach(clearTimeout); if (this.intervalo) clearInterval(this.intervalo); });
    if (!this.poco) this.mostrar(0);
    this.cargarPoblacion();
  }

  resaltada(id: Seccion['id']): boolean {
    const v = this.verboActivo();
    return !!v && v.ms.includes(id);
  }

  /**
   * Holograma: una franja de escáner recorre el verbo y lo deja escrito, tenue y con leve brillo; tras unos segundos
   * resaltando sus secciones, se disuelve y entra el siguiente.
   */
  private mostrar(i: number): void {
    this.saliendo.set(false);
    this.mostrado.set(i);
    this.pasada.update(n => n + 1);
    this.relojes.push(
      setTimeout(() => this.activo.set(i), 900),
      setTimeout(() => { this.saliendo.set(true); this.activo.set(-1); }, 5100),
      setTimeout(() => this.mostrar((i + 1) % VERBOS.length), 5650),
    );
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
        this.mostrarCorte(k);
        if (!this.poco && this.cortes.length > 1) {
          this.intervalo = setInterval(() => { k = (k + 1) % this.cortes.length; this.mostrarCorte(k); }, 5200);
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

  private mostrarCorte(k: number): void {
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
