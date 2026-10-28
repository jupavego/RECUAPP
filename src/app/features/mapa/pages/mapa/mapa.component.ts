import {
  AfterViewInit, Component, DestroyRef, ElementRef, NgZone, OnDestroy, ViewChild,
  computed, effect, inject, signal, untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import * as L from 'leaflet';
import { MapaService, MunicipiosData, Municipio, Territorio } from '../../services/mapa.service';
import { ColorMunicipio, OPACIDAD_RELLENO, TONO_SUBREGION, coloresPorMunicipio, colorSubregion } from '../../utils/paleta';
import { decodeGeometria } from '../../utils/polyline';

const TIPOS_ZONA: Record<string, string> = {
  CM: 'cabecera municipal', CO: 'centro poblado', CA: 'caserío', IN: 'inspección',
};

interface Estado {
  data: MunicipiosData;
  sub: string | null;
  mid: number | null;
  terr: Territorio | null;
  ci: number | null;
  vi: number | null;
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
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('lienzo', { static: true }) private lienzo!: ElementRef<HTMLDivElement>;

  // ── Filtros ────────────────────────────────────────────────────────────────
  readonly data = signal<MunicipiosData | null>(null);
  readonly subregion = signal<string | null>(null);
  readonly muniId = signal<number | null>(null);
  readonly corrIdx = signal<number | null>(null);
  readonly verIdx = signal<number | null>(null);
  readonly territorio = signal<Territorio | null>(null);
  readonly cargandoTerritorio = signal(false);
  readonly error = signal<string | null>(null);
  private readonly listo = signal(false);

  readonly subregiones = computed(() => {
    const cuenta = new Map<string, number>();
    this.data()?.municipios.forEach(m => cuenta.set(m.s, (cuenta.get(m.s) ?? 0) + 1));
    return Object.keys(TONO_SUBREGION)
      .filter(n => cuenta.has(n))
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map(nombre => ({ nombre, n: cuenta.get(nombre)!, color: colorSubregion(nombre) }));
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

  // ── Mapa (Leaflet corre fuera de la zona de Angular) ───────────────────────
  private mapa?: L.Map;
  private lienzoCanvas?: L.Canvas;
  private observador?: ResizeObserver;
  private colores = new Map<number, ColorMunicipio>();
  private poligonosMunicipio = new Map<number, L.Polygon>();
  private capaTerritorio?: L.LayerGroup;
  private poligonosVereda: L.Polygon[] = [];
  private poligonosCorr: L.Polygon[] = [];
  private territorioPintado: Territorio | null = null;
  private encuadreClave = '';
  private ultimoEstado?: Estado;

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
        terr: this.territorio(), ci: this.corrIdx(), vi: this.verIdx(),
      };
      untracked(() => this.zone.runOutsideAngular(() => this.pintar(estado)));
    });
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      const mapa = L.map(this.lienzo.nativeElement, {
        zoomSnap: 0, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, minZoom: 6, maxZoom: 15,
      });
      mapa.attributionControl.setPrefix(false);
      mapa.attributionControl.addAttribution('Contornos: DAP · Gobernación de Antioquia');
      mapa.fitBounds([[5.52, -76.97], [9.24, -73.89]], { animate: false });
      this.mapa = mapa;
      this.lienzoCanvas = L.canvas({ padding: 0.3 });
      // El contenedor se mide después de crear el mapa: al cambiar de tamaño se recalcula y se re-encuadra.
      this.observador = new ResizeObserver(() => {
        mapa.invalidateSize({ animate: false });
        if (this.ultimoEstado) this.encuadrar(this.ultimoEstado, true);
      });
      this.observador.observe(this.lienzo.nativeElement);
    });
    this.listo.set(true);
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
    this.mapa?.remove();
  }

  // ── Acciones de los filtros ────────────────────────────────────────────────
  onSubregion(valor: string): void {
    const sub = valor || null;
    this.subregion.set(sub);
    const muni = this.municipio();
    if (muni && sub && muni.s !== sub) this.limpiarMunicipio();
  }

  onMunicipio(valor: string): void {
    if (valor === '') { this.limpiarMunicipio(); return; }
    const id = Number(valor);
    if (id === this.muniId()) return;
    const muni = this.data()?.municipios[id];
    if (!muni) return;
    this.subregion.set(muni.s);
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
  }

  private limpiarMunicipio(): void {
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
    this.pintarTerritorio(e);
    this.encuadrar(e);
  }

  private crearMunicipios(data: MunicipiosData): void {
    if (this.poligonosMunicipio.size || !this.mapa) return;
    data.municipios.forEach(m => {
      const poli = L.polygon(decodeGeometria(m.g), { renderer: this.lienzoCanvas, smoothFactor: 1.5 });
      poli.bindTooltip(`${m.n} · ${m.s}`, { sticky: true });
      poli.on('click', () => this.zone.run(() => this.onMunicipio(String(m.id))));
      poli.addTo(this.mapa!);
      this.poligonosMunicipio.set(m.id, poli);
    });
  }

  private estilarMunicipios({ data, sub, mid }: Estado): void {
    data.municipios.forEach(m => {
      const c = this.colores.get(m.id)!;
      const enSub = !sub || m.s === sub;
      const elegido = m.id === mid;
      this.poligonosMunicipio.get(m.id)?.setStyle({
        color: c.contorno, fillColor: c.relleno,
        weight: elegido ? 3 : 1.4,
        opacity: enSub ? 1 : 0.35,
        fillOpacity: mid != null ? (elegido ? 0.2 : enSub ? 0.25 : 0.06) : (enSub ? OPACIDAD_RELLENO : 0.08),
      });
      if (elegido) this.poligonosMunicipio.get(m.id)?.bringToFront();
    });
  }

  private pintarTerritorio(e: Estado): void {
    const { mid, terr, ci, vi } = e;
    const mapa = this.mapa!;

    if (terr !== this.territorioPintado) {
      this.capaTerritorio?.remove();
      this.capaTerritorio = undefined;
      this.poligonosVereda = [];
      this.poligonosCorr = [];
      this.territorioPintado = terr;

      if (terr && mid != null) {
        const grupo = L.layerGroup();
        terr.v.forEach((z, idx) => {
          const poli = L.polygon(decodeGeometria(z.g), { renderer: this.lienzoCanvas, smoothFactor: 1 });
          const corr = z.cr != null ? terr.c[z.cr]?.n : null;
          poli.bindTooltip(corr && corr !== z.n ? `${z.n} · ${corr}` : z.n, { sticky: true });
          poli.on('click', () => this.zone.run(() => {
            if (z.cr != null) this.corrIdx.set(z.cr);
            this.verIdx.set(idx);
          }));
          grupo.addLayer(poli);
          this.poligonosVereda.push(poli);
        });
        terr.c.forEach(z => {
          const poli = L.polygon(decodeGeometria(z.g), {
            renderer: this.lienzoCanvas, interactive: false, fill: false, smoothFactor: 1,
          });
          grupo.addLayer(poli);
          this.poligonosCorr.push(poli);
        });
        grupo.addTo(mapa);
        this.capaTerritorio = grupo;
      }
    }

    if (!terr || mid == null) return;
    const c = this.colores.get(mid)!;
    terr.v.forEach((z, idx) => {
      const enCorr = ci == null || z.cr === ci;
      const elegida = idx === vi;
      this.poligonosVereda[idx]?.setStyle({
        color: c.contorno, fillColor: c.relleno,
        weight: elegida ? 3 : 0.8,
        opacity: enCorr ? 1 : 0.25,
        fillOpacity: elegida ? 0.65 : enCorr ? 0.35 : 0.05,
      });
      if (elegida) this.poligonosVereda[idx]?.bringToFront();
    });
    terr.c.forEach((_, idx) => {
      const elegido = idx === ci;
      this.poligonosCorr[idx]?.setStyle({
        color: c.contorno, dashArray: '7 5',
        weight: elegido ? 2.8 : 1.8,
        opacity: ci == null || elegido ? 0.9 : 0.3,
      });
      if (elegido) this.poligonosCorr[idx]?.bringToFront();
    });
  }

  private encuadrar({ data, sub, mid, terr, ci, vi }: Estado, forzar = false): void {
    const clave = `${sub}|${mid}|${terr ? 't' : ''}|${ci}|${vi}`;
    if (clave === this.encuadreClave && !forzar) return;
    this.encuadreClave = clave;

    let limites: L.LatLngBounds | undefined;
    if (vi != null) limites = this.poligonosVereda[vi]?.getBounds();
    else if (ci != null) limites = this.poligonosCorr[ci]?.getBounds();
    else if (mid != null) limites = this.poligonosMunicipio.get(mid)?.getBounds();
    else if (sub) {
      data.municipios.filter(m => m.s === sub).forEach(m => {
        const b = this.poligonosMunicipio.get(m.id)?.getBounds();
        if (b) limites = limites ? limites.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
      });
    } else {
      const [o, s, es, n] = data.bbox;
      limites = L.latLngBounds([s, o], [n, es]);
    }
    if (limites?.isValid()) this.mapa!.fitBounds(limites, { padding: [24, 24], animate: !forzar });
  }
}
