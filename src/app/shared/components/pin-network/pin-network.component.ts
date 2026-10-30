import { AfterViewInit, Component, ElementRef, OnDestroy, computed, inject, signal } from '@angular/core';

export interface Pin {
  x: number;
  y: number;
  /** punta del pin: de aquí salen y llegan las conexiones */
  tipX: number;
  tipY: number;
  drawDelay: string;
  ojoDelay: string;
  puntaDelay: string;
}

export interface Enlace {
  d: string;
  delay: string;
}

const ESCALA = 2.4;
/** segundos que tarda cada pin en trazarse y luego su conexión con el anterior */
const T_PIN = 9.62;
const T_ENLACE = 12.15;

/**
 * Fondo de portada: los pines se dibujan uno tras otro y, al terminar cada uno, se tiende una conexión
 * de punta a punta con el anterior; luego aparece el siguiente y se conecta, y así hasta cubrir la sección.
 * Va dentro de un contenedor `position: relative`; tras generar la red todo es CSS.
 */
@Component({
  selector: 'app-pin-network',
  standalone: true,
  templateUrl: './pin-network.component.html',
  styleUrl: './pin-network.component.scss',
})
export class PinNetworkComponent implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private observador?: ResizeObserver;
  readonly escala = ESCALA;
  /** tamaño real de la sección en píxeles: el lienzo usa 1 unidad = 1 px, así todo cae en la zona visible */
  readonly tam = signal({ w: 0, h: 0 });
  private generadoPara = { w: 0, h: 0 };
  private readonly red = signal<{ pins: Pin[]; enlaces: Enlace[] }>({ pins: [], enlaces: [] });
  readonly pins = computed(() => this.red().pins);
  readonly enlaces = computed(() => this.red().enlaces);

  ngAfterViewInit(): void {
    const medir = () => {
      const { width: w, height: h } = this.host.getBoundingClientRect();
      if (w < 50 || h < 50) return;
      this.tam.set({ w, h });
      const g = this.generadoPara;
      // se genera la primera vez y de nuevo solo si la sección cambió mucho de tamaño
      if (!g.w || Math.abs(w - g.w) / g.w > 0.25 || Math.abs(h - g.h) / g.h > 0.25) {
        this.generadoPara = { w, h };
        this.red.set(this.construir(w, h, this.zonaTexto()));
      }
    };
    medir();
    this.observador = new ResizeObserver(medir);
    this.observador.observe(this.host);
  }

  ngOnDestroy(): void { this.observador?.disconnect(); }

  /** zona del texto de la portada (relativa a la red): ahí no se dibujan pines */
  private zonaTexto(): { x0: number; y0: number; x1: number; y1: number } | null {
    const texto = this.host.parentElement?.querySelector('.home__inner');
    if (!texto) return null;
    const t = texto.getBoundingClientRect(), h = this.host.getBoundingClientRect();
    const m = 14;
    return { x0: t.left - h.left - m, y0: t.top - h.top - m, x1: t.right - h.left + m, y1: t.bottom - h.top + m };
  }

  private construir(W: number, H: number, vetada: { x0: number; y0: number; x1: number; y1: number } | null): { pins: Pin[]; enlaces: Enlace[] } {
    const total = Math.max(6, Math.min(18, Math.round((W * H) / 30000)));
    const AN = 14 * ESCALA, AL = 22 * ESCALA;                       // caja del pin
    const x0 = 16, x1 = W - AN - 16, y0 = 12, y1 = H - AL - 12;      // el pin entero queda dentro de lo visible
    const sep = Math.min(130, Math.sqrt((W * H) / total) * 0.75);
    const pos: { x: number; y: number }[] = [];
    const lejos = (x: number, y: number) => pos.every(p => Math.hypot(p.x - x, p.y - y) >= sep);
    // el pin entero (su caja) no puede tocar la zona del texto
    const libreDeTexto = (x: number, y: number) =>
      !vetada || x + AN < vetada.x0 || x > vetada.x1 || y + AL < vetada.y0 || y > vetada.y1;
    const dentro = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && libreDeTexto(x, y);

    // paseo aleatorio: cada pin nuevo queda a una distancia media del anterior y lejos de los demás
    for (let k = 0; k < 400 && !pos.length; k++) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      if (dentro(x, y)) pos.push({ x, y });
    }
    if (!pos.length) return { pins: [], enlaces: [] };
    let intentos = 0;
    while (pos.length < total && intentos < 6000) {
      intentos++;
      const a = pos[pos.length - 1];
      const ang = Math.random() * Math.PI * 2;
      const dist = sep * (1.1 + Math.random() * 1.2);
      // de vez en cuando se salta a cualquier punto libre: así se cubren ambos lados del texto
      const salto = intentos % 4 === 0;
      const x = salto ? x0 + Math.random() * (x1 - x0) : a.x + Math.cos(ang) * dist;
      const y = salto ? y0 + Math.random() * (y1 - y0) : a.y + Math.sin(ang) * dist;
      if (dentro(x, y) && lejos(x, y)) pos.push({ x, y });
    }

    const ciclo = T_PIN + T_ENLACE;
    const pins: Pin[] = pos.map((p, i) => ({
      x: p.x, y: p.y,
      tipX: p.x + 12 * ESCALA, tipY: p.y + 22 * ESCALA,
      drawDelay: `${(i * ciclo).toFixed(2)}s`,
      ojoDelay: `${(i * ciclo + T_PIN * 0.7).toFixed(2)}s`,
      puntaDelay: `${(i * ciclo + T_PIN * 0.9).toFixed(2)}s`,
    }));
    // cada pin nuevo se conecta, al azar, con uno o dos de los ya dibujados (a menudo el anterior, no siempre)
    const enlaces: Enlace[] = [];
    // la conexión tampoco puede pasar por encima del texto: se muestrea la curva y se descarta si entra en la zona vetada
    const curva = (a: Pin, b: Pin): string | null => {
      const mx = (a.tipX + b.tipX) / 2, my = (a.tipY + b.tipY) / 2;
      const nx = -(b.tipY - a.tipY), ny = b.tipX - a.tipX; // perpendicular: curva suave tipo ruta
      const k = (Math.random() - 0.5) * 0.25;
      const cx = mx + nx * k, cy = my + ny * k;
      if (vetada) {
        for (let t = 0; t <= 1; t += 0.04) {
          const u = 1 - t;
          const x = u * u * a.tipX + 2 * u * t * cx + t * t * b.tipX, y = u * u * a.tipY + 2 * u * t * cy + t * t * b.tipY;
          if (x >= vetada.x0 && x <= vetada.x1 && y >= vetada.y0 && y <= vetada.y1) return null;
        }
      }
      return `M ${a.tipX.toFixed(1)} ${a.tipY.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.tipX.toFixed(1)} ${b.tipY.toFixed(1)}`;
    };
    for (let i = 1; i < pins.length; i++) {
      const destinos = new Set<number>([Math.random() < 0.55 ? i - 1 : Math.floor(Math.random() * i)]);
      if (i > 2 && Math.random() < 0.45) destinos.add(Math.floor(Math.random() * i));
      let n = 0, tendidas = 0;
      for (const j of destinos) {
        const d = curva(pins[j], pins[i]);
        if (d) { enlaces.push({ d, delay: `${(i * ciclo + T_PIN + n * 4.46).toFixed(2)}s` }); tendidas++; }
        n++;
      }
      // si todas cruzaban el texto, se busca otro pin con el que sí se pueda conectar
      for (let j = i - 1; j >= 0 && !tendidas; j--) {
        const d = curva(pins[j], pins[i]);
        if (d) { enlaces.push({ d, delay: `${(i * ciclo + T_PIN).toFixed(2)}s` }); tendidas++; }
      }
    }
    return { pins, enlaces };
  }
}
