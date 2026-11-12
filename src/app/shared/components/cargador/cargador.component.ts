import { Component, computed, input } from '@angular/core';

export type TipoCargador = 'mapa3d' | 'plan' | 'resp' | 'mapa' | 'catalogo' | 'nosotros';

/** cada sección con su dibujo, su color (el del menú) y su frase */
const CARGADORES: Record<TipoCargador, { c: string; texto: string }> = {
  mapa3d:   { c: '#2E86C1', texto: 'Levantando el relieve' },
  plan:     { c: '#4FA22E', texto: 'Ordenando el plan' },
  resp:     { c: '#D99A14', texto: 'Reuniendo a los responsables' },
  mapa:     { c: '#16A085', texto: 'Ubicando el territorio' },
  catalogo: { c: '#7B68C8', texto: 'Armando los edificios' },
  nosotros: { c: '#2F7D45', texto: 'Sembrando la confianza' },
};

/**
 * Cargador animado de cada sección del recorrido: un dibujo alusivo a lo que se está cargando
 * (relieve, lista de chequeo, pueblo, pin, bloques, brote). Solo CSS y SVG: no pesa ni pide nada a la red.
 */
@Component({
  selector: 'app-cargador',
  standalone: true,
  template: `
    <div class="cargador" role="status" [style.--c]="cfg().c">
      <div class="dibujo" aria-hidden="true">
        @switch (tipo()) {
          @case ('mapa3d') {
            <!-- curvas de nivel que se apilan hasta formar la montaña -->
            <svg viewBox="0 0 120 90" class="relieve">
              @for (n of [0, 1, 2, 3, 4]; track n) {
                <ellipse cx="60" [attr.cy]="74 - n * 11" [attr.rx]="52 - n * 10" [attr.ry]="13 - n * 2" [style.--i]="n"/>
              }
              <circle class="cima" cx="60" cy="22" r="3"/>
            </svg>
          }
          @case ('plan') {
            <!-- lista de chequeo: cada renglón se marca y su barra se llena -->
            <svg viewBox="0 0 120 90" class="lista">
              @for (n of [0, 1, 2]; track n) {
                <g [style.--i]="n">
                  <rect class="caja" x="14" [attr.y]="12 + n * 24" width="16" height="16" rx="4"/>
                  <path class="chulo" [attr.d]="'M18 ' + (20 + n * 24) + 'l3.5 3.5 6-7'" pathLength="1"/>
                  <rect class="pista" x="40" [attr.y]="17 + n * 24" width="66" height="6" rx="3"/>
                  <rect class="barra" x="40" [attr.y]="17 + n * 24" [attr.width]="[60, 44, 52][n]" height="6" rx="3"/>
                </g>
              }
            </svg>
          }
          @case ('resp') {
            <!-- el pueblo: casitas que brotan una tras otra -->
            <svg viewBox="0 0 120 90" class="pueblo">
              <path class="suelo" d="M8 76h104"/>
              @for (n of [0, 1, 2, 3]; track n) {
                <g class="casa" [style.--i]="n" [attr.transform]="'translate(' + (14 + n * 24) + ' ' + [40, 30, 44, 36][n] + ')'">
                  <rect x="2" y="14" width="18" [attr.height]="76 - 14 - [40, 30, 44, 36][n]" rx="2"/>
                  <path class="techo" d="M0 15 11 3l11 12z"/>
                  <rect class="puerta" x="8" [attr.y]="76 - 9 - [40, 30, 44, 36][n]" width="6" height="9" rx="1"/>
                </g>
              }
            </svg>
          }
          @case ('mapa') {
            <!-- un pin que cae sobre la ruta y deja ondas en el suelo -->
            <svg viewBox="0 0 120 90" class="pin">
              <path class="ruta" d="M10 78c18-14 34 6 52-6s30-16 48-8" pathLength="1"/>
              <ellipse class="onda" cx="60" cy="70" rx="14" ry="4"/>
              <ellipse class="onda o2" cx="60" cy="70" rx="14" ry="4"/>
              <g class="gota">
                <path d="M60 68s-13-13-13-23a13 13 0 0 1 26 0c0 10-13 23-13 23z"/>
                <circle cx="60" cy="45" r="5"/>
              </g>
            </svg>
          }
          @case ('catalogo') {
            <!-- bloques isométricos que se apilan como un edificio -->
            <svg viewBox="0 0 120 90" class="bloques">
              @for (n of [0, 1, 2]; track n) {
                <g class="bloque" [style.--i]="n" [attr.transform]="'translate(60 ' + (62 - n * 18) + ')'">
                  <path class="cara-arriba" d="M0 -10 22 1 0 12 -22 1z"/>
                  <path class="cara-izq" d="M-22 1 0 12 0 30 -22 19z"/>
                  <path class="cara-der" d="M22 1 0 12 0 30 22 19z"/>
                </g>
              }
            </svg>
          }
          @case ('nosotros') {
            <!-- un brote que crece hasta ser la hoja de la marca -->
            <svg viewBox="0 0 120 90" class="brote">
              <path class="tierra" d="M30 80h60"/>
              <path class="tallo" d="M60 80c0-14 1-26 0-38" pathLength="1"/>
              <path class="hoja h1" d="M60 56c-4-12-16-16-26-14 2 10 12 18 26 14z"/>
              <path class="hoja h2" d="M60 46c4-14 18-20 30-17-2 12-14 21-30 17z"/>
            </svg>
          }
        }
      </div>
      <p>{{ cfg().texto }}<span class="puntos"><i>.</i><i>.</i><i>.</i></span></p>
      @if (progreso() !== null) {
        <div class="avance" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="pct()">
          <i [style.width.%]="pct()"></i>
        </div>
        <b class="pct">{{ pct() }} %</b>
      }
    </div>
  `,
  styles: [`
    :host { display: grid; place-items: center; min-height: inherit; width: 100%; }
    .cargador { display: grid; justify-items: center; gap: 10px; padding: 24px; color: var(--c); }
    .dibujo svg { width: 150px; height: 112px; overflow: visible; }
    p { margin: 0; font: 600 14px/1.4 var(--font-body, Inter, system-ui, sans-serif); color: color-mix(in srgb, var(--c) 70%, #2a3a2e); letter-spacing: .01em; }
    :host-context(html.tema-oscuro) p { color: color-mix(in srgb, var(--c) 65%, #fff); }
    .avance { width: 150px; height: 5px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--c) 18%, transparent); }
    .avance i { display: block; height: 100%; border-radius: 3px; background: var(--c); transition: width .35s ease-out; }
    .pct { font: 700 13px/1 var(--font-body, Inter, system-ui, sans-serif); font-variant-numeric: tabular-nums; color: var(--c); }
    .puntos i { font-style: normal; animation: punto 1.4s infinite; opacity: .2; }
    .puntos i:nth-child(2) { animation-delay: .2s; } .puntos i:nth-child(3) { animation-delay: .4s; }
    @keyframes punto { 40% { opacity: 1; } }

    /* relieve: cada curva sube a su lugar y respira */
    .relieve ellipse { fill: color-mix(in srgb, var(--c) calc(8% + var(--i) * 9%), transparent); stroke: var(--c); stroke-width: 1.4;
      transform-box: fill-box; transform-origin: center; opacity: 0; animation: curva 2.8s ease-in-out infinite; animation-delay: calc(var(--i) * .22s); }
    @keyframes curva { 0% { opacity: 0; transform: translateY(10px) scale(.92); } 25%, 75% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-4px); } }
    .relieve .cima { fill: var(--c); animation: cima 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
    @keyframes cima { 0%, 35% { opacity: 0; transform: scale(0); } 50%, 75% { opacity: 1; transform: scale(1.4); } 100% { opacity: 0; } }

    /* lista: casilla, chulo y barra en secuencia */
    .lista .caja { fill: color-mix(in srgb, var(--c) 12%, transparent); stroke: var(--c); stroke-width: 1.4; }
    .lista .pista { fill: color-mix(in srgb, var(--c) 12%, transparent); }
    .lista .barra { fill: var(--c); transform-box: fill-box; transform-origin: left; transform: scaleX(0); animation: barra 3s ease-in-out infinite; animation-delay: calc(var(--i) * .45s); }
    .lista .chulo { fill: none; stroke: var(--c); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1;
      animation: chulo 3s ease-in-out infinite; animation-delay: calc(var(--i) * .45s + .35s); }
    @keyframes barra { 0% { transform: scaleX(0); } 30%, 80% { transform: scaleX(1); } 100% { transform: scaleX(0); } }
    @keyframes chulo { 0% { stroke-dashoffset: 1; } 15%, 75% { stroke-dashoffset: 0; } 90%, 100% { stroke-dashoffset: 1; } }

    /* pueblo: las casas brotan desde el suelo */
    .pueblo .suelo { stroke: color-mix(in srgb, var(--c) 45%, transparent); stroke-width: 2; stroke-linecap: round; }
    .pueblo .casa { transform-box: fill-box; }
    .pueblo .casa > * { transform-box: view-box; }
    .pueblo .casa rect:first-child { fill: color-mix(in srgb, var(--c) 22%, transparent); stroke: var(--c); stroke-width: 1.2; }
    .pueblo .techo { fill: var(--c); }
    .pueblo .puerta { fill: color-mix(in srgb, var(--c) 70%, #000); }
    .pueblo .casa { animation: brota 2.8s cubic-bezier(.3, 1.5, .5, 1) infinite; animation-delay: calc(var(--i) * .25s); opacity: 0; }
    @keyframes brota { 0% { opacity: 0; translate: 0 14px; } 25%, 80% { opacity: 1; translate: 0 0; } 100% { opacity: 0; translate: 0 0; } }

    /* pin: cae, rebota y deja ondas; la ruta se traza debajo */
    .pin .ruta { fill: none; stroke: color-mix(in srgb, var(--c) 55%, transparent); stroke-width: 2.2; stroke-linecap: round; stroke-dasharray: .04 .03;
      animation: ruta 2.4s linear infinite; }
    @keyframes ruta { to { stroke-dashoffset: -.14; } }
    .pin .gota path { fill: var(--c); } .pin .gota circle { fill: #fff; }
    .pin .gota { animation: cae 2.4s cubic-bezier(.5, 0, .5, 1) infinite; }
    @keyframes cae { 0% { translate: 0 -26px; opacity: 0; } 25% { translate: 0 0; opacity: 1; } 35% { translate: 0 -6px; } 45%, 85% { translate: 0 0; opacity: 1; } 100% { opacity: 0; } }
    .pin .onda { fill: none; stroke: var(--c); stroke-width: 1.4; transform-box: fill-box; transform-origin: center; opacity: 0; animation: onda 2.4s ease-out infinite; animation-delay: .55s; }
    .pin .o2 { animation-delay: .95s; }
    @keyframes onda { 0% { opacity: .8; transform: scale(.3); } 60%, 100% { opacity: 0; transform: scale(2); } }

    /* bloques: tres pisos que bajan y se apilan */
    .bloques .cara-arriba { fill: color-mix(in srgb, var(--c) 35%, #fff); }
    .bloques .cara-izq { fill: var(--c); }
    .bloques .cara-der { fill: color-mix(in srgb, var(--c) 75%, #000); }
    .bloques .bloque path { stroke: color-mix(in srgb, var(--c) 40%, #fff); stroke-width: .6; stroke-linejoin: round; }
    .bloques .bloque { opacity: 0; animation: apila 3s cubic-bezier(.3, 1.4, .5, 1) infinite; animation-delay: calc(var(--i) * .35s); }
    @keyframes apila { 0% { opacity: 0; translate: 0 -22px; } 20%, 80% { opacity: 1; translate: 0 0; } 100% { opacity: 0; translate: 0 0; } }

    /* brote: el tallo crece y se abren las dos hojas */
    .brote .tierra { stroke: color-mix(in srgb, var(--c) 45%, transparent); stroke-width: 2.4; stroke-linecap: round; }
    .brote .tallo { fill: none; stroke: var(--c); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: tallo 3s ease-in-out infinite; }
    .brote .hoja { fill: color-mix(in srgb, var(--c) 85%, #99CC33); transform-box: fill-box; transform: scale(0); animation: hoja 3s cubic-bezier(.3, 1.5, .5, 1) infinite; }
    .brote .h1 { transform-origin: 100% 100%; animation-delay: .7s; fill: color-mix(in srgb, var(--c) 55%, #99CC33); }
    .brote .h2 { transform-origin: 0% 100%; animation-delay: 1s; }
    @keyframes tallo { 0% { stroke-dashoffset: 1; } 30%, 85% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 1; } }
    @keyframes hoja { 0%, 10% { transform: scale(0); } 35%, 75% { transform: scale(1) rotate(0deg); } 55% { transform: scale(1) rotate(-4deg); } 90%, 100% { transform: scale(0); } }

    @media (prefers-reduced-motion: reduce) {
      * { animation: none !important; opacity: 1 !important; transform: none !important; translate: none !important; stroke-dashoffset: 0 !important; }
    }
  `],
})
export class CargadorComponent {
  readonly tipo = input.required<TipoCargador>();
  /** avance de 0 a 100; si no se pasa, el cargador solo anima (sin barra ni porcentaje) */
  readonly progreso = input<number | null>(null);
  readonly pct = computed(() => Math.max(0, Math.min(100, Math.round(this.progreso() ?? 0))));
  readonly cfg = computed(() => CARGADORES[this.tipo()]);
}
