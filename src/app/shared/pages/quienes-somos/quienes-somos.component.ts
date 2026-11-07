import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { HomeComponent } from '../home/home.component';
import { BibliotecaComponent } from '../biblioteca/biblioteca.component';
import { DocumentosComponent } from '../../../features/documentos/pages/documentos/documentos.component';

/**
 * Quiénes somos: la presentación de RECUAPP (lo que antes era el inicio) y, debajo, las dos secciones de confianza:
 * el sistema documental y la biblioteca de fuentes. El inicio de la app ahora es el mapa 3D.
 */
@Component({
  selector: 'app-quienes-somos',
  standalone: true,
  imports: [RouterModule, HomeComponent, BibliotecaComponent, DocumentosComponent],
  template: `
    <app-home />

    <nav class="saltos" aria-label="Secciones de Quiénes somos">
      <a routerLink="/quienes-somos" fragment="documentos" style="--c:#B0549A">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>Documentos
      </a>
      <a routerLink="/quienes-somos" fragment="biblioteca" style="--c:#D35C37">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6a2 2 0 012 2v13a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v13a2 2 0 012-2h6z"/></svg>Biblioteca
      </a>
    </nav>

    <section class="sec" id="documentos" aria-labelledby="sec-doc-t" style="--c:#B0549A; --c2:#D98BC4">
      <header class="sec__cab">
        <span class="sec__insignia" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>
        </span>
        <div>
          <span class="sec__ojo">Lo que proponemos, por escrito</span>
          <h2 id="sec-doc-t">Documentos</h2>
        </div>
        <span class="sec__rama" aria-hidden="true"></span>
      </header>
      <app-documentos class="sec__doc" />
    </section>

    <section class="sec" id="biblioteca" aria-labelledby="sec-bib-t" style="--c:#D35C37; --c2:#EFA07F">
      <header class="sec__cab">
        <span class="sec__insignia" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 5h6a2 2 0 012 2v13a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v13a2 2 0 012-2h6z"/></svg>
        </span>
        <div>
          <span class="sec__ojo">De dónde sale cada dato</span>
          <h2 id="sec-bib-t">Biblioteca</h2>
        </div>
        <span class="sec__rama" aria-hidden="true"></span>
      </header>
      <app-biblioteca [incrustado]="true" />
    </section>
  `,
  styles: [`
    :host { display: block; }
    /* accesos a las secciones, al pie de la presentación */
    .saltos { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin: -72px auto 0; padding: 0 16px 24px;
      position: relative; z-index: 2; }
    .saltos a { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 16px; border-radius: 999px;
      font-weight: 700; font-size: .88rem; text-decoration: none; color: var(--c);
      background: color-mix(in srgb, var(--c) 10%, rgba(255,255,255,.75)); border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
      backdrop-filter: blur(6px); transition: transform .2s cubic-bezier(.3,1.6,.5,1), background .2s; }
    .saltos a:hover { transform: translateY(-2px); background: color-mix(in srgb, var(--c) 18%, #fff); }
    .saltos svg, .sec__insignia svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }

    .sec { padding: 40px 8px 24px; scroll-margin-top: var(--alto-barra, 0px); }
    .sec__cab { display: flex; align-items: center; gap: 16px; padding: 0 16px 12px; max-width: 1180px; margin: 0 auto; }
    /* insignia en hoja, como la del organigrama, en el color de cada sección */
    .sec__insignia { flex: none; width: 54px; height: 54px; display: grid; place-items: center; color: #fff;
      border-radius: 6px 50% 50% 50%; background: linear-gradient(140deg, var(--c2), var(--c) 70%);
      box-shadow: 0 8px 20px color-mix(in srgb, var(--c) 35%, transparent), inset 0 -3px 0 rgba(0,0,0,.08);
      transition: transform .35s cubic-bezier(.3,1.6,.5,1); }
    .sec__insignia svg { width: 26px; height: 26px; }
    .sec__cab:hover .sec__insignia { transform: rotate(-8deg) scale(1.05); }
    .sec__ojo { display: block; font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--c); }
    .sec h2 { margin: 2px 0 0; font-size: clamp(1.3rem, 2.6vw, 1.8rem); line-height: 1.15; color: #243746; }
    .sec__rama { flex: 1; align-self: center; height: 2px; margin-left: 8px; border-radius: 2px; position: relative;
      background: linear-gradient(90deg, var(--c), color-mix(in srgb, var(--c) 35%, transparent) 40%, transparent); }
    .sec__rama::after { content: ''; position: absolute; left: 34%; top: -9px; width: 10px; height: 16px; border-radius: 0 100% 0 100%;
      background: var(--c2); opacity: .7; transform: rotate(-20deg); }
    .sec__doc { display: block; border-radius: 16px; overflow: hidden; margin: 0 8px; box-shadow: 0 6px 24px rgba(30,50,40,.12); }
    :host-context(body.tema-oscuro) .sec h2 { color: #eaf3e4; }
    :host-context(body.tema-oscuro) .saltos a { background: color-mix(in srgb, var(--c) 18%, rgba(20,30,24,.7)); }
    @media (max-width: 640px) { .sec__rama { display: none; } }
  `],
})
export class QuienesSomosComponent {}
