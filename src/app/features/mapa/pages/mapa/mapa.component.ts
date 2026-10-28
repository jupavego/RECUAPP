import {
  AfterViewInit, Component, DestroyRef, ElementRef, NgZone, OnDestroy, ViewChild,
  computed, effect, inject, signal, untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { GoogleMapsLoaderService } from '../../../../core/services/google-maps-loader.service';
import { MapaService, MunicipiosData, Municipio, Territorio, Zona } from '../../services/mapa.service';
import {
  ColorMunicipio, ColorSegmento, OPACIDAD_MUNICIPIO, OPACIDAD_SEGMENTO, SUBREGIONES,
  coloresDeSegmentos, coloresPorMunicipio,
} from '../../utils/paleta';
import { decodeGeometria } from '../../utils/polyline';

const TIPOS_ZONA: Record<string, string> = {
  CM: 'cabecera municipal', CO: 'centro poblado', CA: 'caserío', IN: 'inspección',
};

/** Estilo del mapa base: atenuado y sin comercios ni transporte, para que el croquis sea lo que se lea. */
const ESTILO_BASE: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'all', stylers: [{ saturation: -55 }, { lightness: 8 }] },
];

/** Corregimientos y veredas de un municipio, dibujados solo como contexto al filtrar por subregión. */
interface ContextoSubregion { id: number; t: Territorio; }

interface Estado {
  data: MunicipiosData;
  sub: string | null;
  mid: number | null;
  terr: Territorio | null;
  ctx: ContextoSubregion[];
  ci: number | null;
  vi: number | null;
}

type Ruta = google.maps.LatLngLiteral[];

/** Multipolígono con huecos -> rutas de Google (anillos sueltos; rellena par/impar). */
function rutasDe(z: { g: Zona['g'] }): Ruta[] {
  return decodeGeometria(z.g).flatMap(poligono =>
    poligono.map(anillo => anillo.map(([lat, lng]) => ({ lat, lng }))));
}

function limitesDe(rutas: Ruta[]): google.maps.LatLngBounds {
  const b = new google.maps.LatLngBounds();
  rutas.forEach(r => r.forEach(p => b.extend(p)));
  return b;
}

@Component({
  selector: 'app-mapa',
  standalone: true,
  templateUrl: './mapa.component.html',
  styleUrl: './mapa.component.scss',
})
export class MapaComponent implements AfterViewInit, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly api = inject(MapaService);
  private readonly loader = inject(GoogleMapsLoaderService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('lienzo', { static: true }) private lienzo!: ElementRef<HTMLDivElement>;
  @ViewChild('pista', { static: true }) private pista!: ElementRef<HTMLDivElement>;

  // ── Filtros ────────────────────────────────────────────────────────────────
  readonly data = signal<MunicipiosData | null>(null);
  readonly subregion = signal<string | null>(null);
  readonly muniId = signal<number | null>(null);
  readonly corrIdx = signal<number | null>(null);
  readonly verIdx = signal<number | null>(null);
  readonly territorio = signal<Territorio | null>(null);
  readonly contexto = signal<ContextoSubregion[]>([]);
  readonly cargandoTerritorio = signal(false);
  readonly error = signal<string | null>(null);
  private readonly listo = signal(false);

  readonly subregiones = computed(() => {
    const cuenta = new Map<string, number>();
    this.data()?.municipios.forEach(m => cuenta.set(m.s, (cuenta.get(m.s) ?? 0) + 1));
    return SUBREGIONES
      .filter(n => cuenta.has(n))
      .map(nombre => ({ nombre, n: cuenta.get(nombre)! }));
  });

  readonly municipios = computed(() => {
    const sub = this.subregion();
    return (this.data()?.municipios ?? [])
      .filter(m => !sub || m.s === sub)
      .sort((a, b) => a.n.localeCompare(b.n, 'es'));
  });

  readonly municipio = computed<Municipio | null>(() => {
    const id = this.muniId();
    return id == null ? null : this.data()?.municipios[id] ?? null;
  });

  readonly corregimientos = computed(() =>
    (this.territorio()?.c ?? [])
      .map((z, idx) => ({ idx, n: z.n }))
      .sort((a, b) => a.n.localeCompare(b.n, 'es')));

  readonly veredas = computed(() => {
    const ci = this.corrIdx();
    return (this.territorio()?.v ?? [])
      .map((z, idx) => ({
        idx, cr: z.cr ?? null,
        n: z.n + (z.t && z.t !== 'VE' ? ` · ${TIPOS_ZONA[z.t] ?? 'zona'}` : ''),
      }))
      .filter(z => ci == null || z.cr === ci)
      .sort((a, b) => a.n.localeCompare(b.n, 'es'));
  });

  readonly nombreCorr = computed(() => {
    const ci = this.corrIdx();
    return ci == null ? null : this.territorio()?.c[ci]?.n ?? null;
  });
  readonly nombreVereda = computed(() => {
    const vi = this.verIdx();
    return vi == null ? null : this.territorio()?.v[vi]?.n ?? null;
  });
  readonly hayFiltro = computed(() => this.subregion() != null || this.muniId() != null);

  // ── Mapa (Google Maps corre fuera de la zona de Angular) ───────────────────
  private mapa?: google.maps.Map;
  private colores = new Map<number, ColorMunicipio>();
  private poligonosMunicipio = new Map<number, google.maps.Polygon>();
  private limitesMunicipio = new Map<number, google.maps.LatLngBounds>();
  private poligonosVereda: google.maps.Polygon[] = [];
  private limitesVereda: google.maps.LatLngBounds[] = [];
  private coloresVereda: ColorSegmento[] = [];
  private poligonosCorr: google.maps.Polygon[] = [];
  private limitesCorr: google.maps.LatLngBounds[] = [];
  private territorioPintado: Territorio | null = null;
  private capaContexto: google.maps.Polygon[] = [];
  private contextoPintado: ContextoSubregion[] = [];
  private encuadreClave = '';
  private ultimoEstado?: Estado;
  private observador?: ResizeObserver;

  constructor() {
    this.api.municipios$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: d => { this.colores = coloresPorMunicipio(d.municipios); this.data.set(d); },
      error: () => this.error.set('No se pudieron cargar los contornos del mapa.'),
    });

    effect(() => {
      const data = this.data();
      if (!this.listo() || !data) return;
      const estado: Estado = {
        data, sub: this.subregion(), mid: this.muniId(),
        terr: this.territorio(), ctx: this.contexto(), ci: this.corrIdx(), vi: this.verIdx(),
      };
      untracked(() => this.zone.runOutsideAngular(() => this.pintar(estado)));
    });
  }

  ngAfterViewInit(): void {
    this.loader.load().then(() => this.zone.runOutsideAngular(() => {
      this.mapa = new google.maps.Map(this.lienzo.nativeElement, {
        center: { lat: 7.0, lng: -75.5 }, zoom: 7, minZoom: 6, maxZoom: 17,
        mapTypeControl: false, streetViewControl: false, clickableIcons: false,
        gestureHandling: 'greedy', styles: ESTILO_BASE,
      });
      // El contenedor puede cambiar de tamaño tras crear el mapa: se re-encuadra al medirse.
      this.observador = new ResizeObserver(() => {
        if (this.ultimoEstado) this.encuadrar(this.ultimoEstado, true);
      });
      this.observador.observe(this.lienzo.nativeElement);
      // El primer encuadre ocurre antes de que el mapa conozca su tamaño real: se repite al quedar listo.
      google.maps.event.addListenerOnce(this.mapa, 'idle', () => {
        if (this.ultimoEstado) this.encuadrar(this.ultimoEstado, true);
      });
      this.listo.set(true);
    })).catch(() => this.error.set(
      'No se pudo cargar Google Maps. Revisa la clave (googleMapsApiKey) y que su restricción permita este dominio.'));
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
  }

  // ── Acciones de los filtros ────────────────────────────────────────────────
  onSubregion(valor: string): void {
    const sub = valor || null;
    this.subregion.set(sub);
    const muni = this.municipio();
    if (muni && sub && muni.s !== sub) this.limpiarMunicipio();
    this.cargarContexto();
  }

  onMunicipio(valor: string): void {
    if (valor === '') { this.limpiarMunicipio(); return; }
    const id = Number(valor);
    if (id === this.muniId()) return;
    const muni = this.data()?.municipios[id];
    if (!muni) return;
    this.subregion.set(muni.s);
    this.contexto.set([]);
    this.muniId.set(id);
    this.corrIdx.set(null);
    this.verIdx.set(null);
    this.territorio.set(null);
    this.cargandoTerritorio.set(true);
    this.api.territorio(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: t => {
        if (this.muniId() !== id) return; // se eligió otro municipio mientras cargaba
        this.territorio.set(t);
        this.cargandoTerritorio.set(false);
      },
      error: () => {
        this.cargandoTerritorio.set(false);
        this.error.set('No se pudieron cargar los corregimientos y veredas de este municipio.');
      },
    });
  }

  onCorregimiento(valor: string): void {
    this.corrIdx.set(valor === '' ? null : Number(valor));
    this.verIdx.set(null);
  }

  onVereda(valor: string): void {
    this.verIdx.set(valor === '' ? null : Number(valor));
  }

  limpiar(): void {
    this.subregion.set(null);
    this.limpiarMunicipio();
    this.cargarContexto();
  }

  /** Con solo una subregión filtrada se dibujan los corregimientos y veredas de todos sus municipios. */
  private cargarContexto(): void {
    const sub = this.subregion();
    if (!sub || this.muniId() != null) { this.contexto.set([]); return; }
    const ids = (this.data()?.municipios ?? []).filter(m => m.s === sub).map(m => m.id);
    forkJoin(ids.map(id => this.api.territorio(id))).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ts => {
        if (this.subregion() !== sub || this.muniId() != null) return; // el filtro cambió mientras cargaba
        this.contexto.set(ts.map((t, i) => ({ id: ids[i], t })));
      },
      error: () => this.error.set('No se pudieron cargar los corregimientos y veredas de la subregión.'),
    });
  }

  private limpiarMunicipio(): void {
    this.contexto.set([]);
    this.muniId.set(null);
    this.corrIdx.set(null);
    this.verIdx.set(null);
    this.territorio.set(null);
    this.cargandoTerritorio.set(false);
  }

  // ── Dibujo ─────────────────────────────────────────────────────────────────
  private pintar(e: Estado): void {
    if (!this.mapa) return;
    this.ultimoEstado = e;
    this.crearMunicipios(e.data);
    this.estilarMunicipios(e);
    this.pintarContexto(e);
    this.pintarTerritorio(e);
    this.encuadrar(e);
  }

  /** Rótulo flotante que sigue al cursor sobre un polígono. */
  private rotular(poli: google.maps.Polygon, texto: string): void {
    const pista = this.pista.nativeElement;
    poli.addListener('mousemove', (ev: google.maps.PolyMouseEvent) => {
      const dom = ev.domEvent as MouseEvent | undefined;
      if (!dom) return;
      const caja = this.lienzo.nativeElement.getBoundingClientRect();
      pista.textContent = texto;
      pista.style.left = `${dom.clientX - caja.left + 12}px`;
      pista.style.top = `${dom.clientY - caja.top + 12}px`;
      pista.hidden = false;
    });
    poli.addListener('mouseout', () => { pista.hidden = true; });
  }

  private crearMunicipios(data: MunicipiosData): void {
    if (this.poligonosMunicipio.size || !this.mapa) return;
    data.municipios.forEach(m => {
      const paths = rutasDe(m);
      const poli = new google.maps.Polygon({ paths, map: this.mapa, strokeWeight: 1.4 });
      this.rotular(poli, `${m.n} · ${m.s}`);
      poli.addListener('click', () => this.zone.run(() => this.onMunicipio(String(m.id))));
      this.poligonosMunicipio.set(m.id, poli);
      this.limitesMunicipio.set(m.id, limitesDe(paths));
    });
  }

  private estilarMunicipios({ data, sub, mid }: Estado): void {
    data.municipios.forEach(m => {
      const c = this.colores.get(m.id)!;
      const enSub = !sub || m.s === sub;
      const elegido = m.id === mid;
      this.poligonosMunicipio.get(m.id)?.setOptions({
        strokeColor: c.contorno, fillColor: c.relleno,
        strokeWeight: elegido ? 3 : 1.4,
        strokeOpacity: enSub ? 1 : 0.35,
        fillOpacity: mid != null ? (elegido ? 0.25 : enSub ? 0.45 : 0.12) : (enSub ? OPACIDAD_MUNICIPIO : 0.2),
        zIndex: elegido ? 2 : 1,
      });
    });
  }

  /** Corregimientos y veredas de toda la subregión: un polígono sin relleno por municipio y tipo. */
  private pintarContexto({ ctx }: Estado): void {
    if (ctx === this.contextoPintado) return;
    this.contextoPintado = ctx;
    this.capaContexto.forEach(p => p.setMap(null));
    this.capaContexto = [];
    ctx.forEach(({ id, t }) => {
      const color = this.colores.get(id)!.contorno;
      const base = { map: this.mapa, clickable: false, fillOpacity: 0, strokeColor: color, zIndex: 3 };
      this.capaContexto.push(
        new google.maps.Polygon({ ...base, paths: t.v.flatMap(rutasDe), strokeWeight: 0.8, strokeOpacity: 0.75 }),
        new google.maps.Polygon({ ...base, paths: t.c.flatMap(rutasDe), strokeWeight: 2, strokeOpacity: 0.95 }),
      );
    });
  }

  private pintarTerritorio(e: Estado): void {
    const { mid, terr, ci, vi } = e;

    if (terr !== this.territorioPintado) {
      [...this.poligonosVereda, ...this.poligonosCorr].forEach(p => p.setMap(null));
      this.poligonosVereda = []; this.limitesVereda = []; this.coloresVereda = [];
      this.poligonosCorr = []; this.limitesCorr = [];
      this.territorioPintado = terr;

      if (terr && mid != null) {
        this.coloresVereda = coloresDeSegmentos(this.colores.get(mid)!.h, terr.v);
        terr.v.forEach((z, idx) => {
          const paths = rutasDe(z);
          const poli = new google.maps.Polygon({ paths, map: this.mapa, strokeWeight: 1 });
          const corr = z.cr != null ? terr.c[z.cr]?.n : null;
          this.rotular(poli, corr && corr !== z.n ? `${z.n} · ${corr}` : z.n);
          poli.addListener('click', () => this.zone.run(() => {
            if (z.cr != null) this.corrIdx.set(z.cr);
            this.verIdx.set(idx);
          }));
          this.poligonosVereda.push(poli);
          this.limitesVereda.push(limitesDe(paths));
        });
        terr.c.forEach(z => {
          const paths = rutasDe(z);
          this.poligonosCorr.push(new google.maps.Polygon({
            paths, map: this.mapa, clickable: false, fillOpacity: 0, zIndex: 4,
          }));
          this.limitesCorr.push(limitesDe(paths));
        });
      }
    }

    if (!terr || mid == null) return;
    const c = this.colores.get(mid)!;
    terr.v.forEach((z, idx) => {
      const enCorr = ci == null || z.cr === ci;
      const elegida = idx === vi;
      this.poligonosVereda[idx]?.setOptions({
        strokeColor: c.contorno,
        fillColor: elegida ? this.coloresVereda[idx].seleccionado : this.coloresVereda[idx].relleno,
        strokeWeight: elegida ? 3 : 1,
        strokeOpacity: enCorr ? 0.9 : 0.25,
        fillOpacity: elegida ? 0.95 : enCorr ? OPACIDAD_SEGMENTO : 0.25,
        zIndex: elegida ? 5 : 3,
      });
    });
    terr.c.forEach((_, idx) => {
      const elegido = idx === ci;
      this.poligonosCorr[idx]?.setOptions({
        strokeColor: c.contorno, strokeWeight: elegido ? 3 : 2,
        strokeOpacity: ci == null || elegido ? 0.95 : 0.3,
      });
    });
  }

  private encuadrar({ data, sub, mid, terr, ci, vi }: Estado, forzar = false): void {
    const clave = `${sub}|${mid}|${terr ? 't' : ''}|${ci}|${vi}`;
    if (clave === this.encuadreClave && !forzar) return;
    this.encuadreClave = clave;

    let limites: google.maps.LatLngBounds | undefined;
    if (vi != null) limites = this.limitesVereda[vi];
    else if (ci != null) limites = this.limitesCorr[ci];
    else if (mid != null) limites = this.limitesMunicipio.get(mid);
    else if (sub) {
      limites = new google.maps.LatLngBounds();
      data.municipios.filter(m => m.s === sub).forEach(m => limites!.union(this.limitesMunicipio.get(m.id)!));
    } else {
      const [o, s, es, n] = data.bbox;
      limites = new google.maps.LatLngBounds({ lat: s, lng: o }, { lat: n, lng: es });
    }
    if (limites) this.mapa!.fitBounds(limites, 24);
  }
}
