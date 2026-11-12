import { Component, afterNextRender, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import { HomeComponent } from '../home/home.component';
import { BibliotecaComponent } from '../biblioteca/biblioteca.component';
import { DocumentosComponent } from '../../../features/documentos/pages/documentos/documentos.component';
import { CatalogoEdificiosComponent } from '../../../features/mapa3d/pages/catalogo-edificios/catalogo-edificios.component';
import { CargadorComponent } from '../../components/cargador/cargador.component';

/**
 * Quiénes somos: la presentación de RECUAPP (lo que antes era el inicio) y, debajo, las dos secciones de confianza:
 * el sistema documental y la biblioteca de fuentes. El inicio de la app es la portada (features/inicio) y el mapa 3D vive en /mapa3d.
 */
@Component({
  selector: 'app-quienes-somos',
  standalone: true,
  imports: [RouterModule, HomeComponent, BibliotecaComponent, DocumentosComponent, CatalogoEdificiosComponent, CargadorComponent],
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
      <button type="button" class="sec__cab" [attr.aria-expanded]="docAbierto()" aria-controls="doc-cuerpo" (click)="docAbierto.set(!docAbierto())">
        <span class="sec__insignia" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>
        </span>
        <span class="sec__tit">
          <span class="sec__ojo">Lo que proponemos, por escrito</span>
          <h2 id="sec-doc-t">Documentos</h2>
        </span>
        <span class="sec__rama" aria-hidden="true"></span>
        <span class="sec__accion">{{ docAbierto() ? 'Cerrar' : 'Abrir' }}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
      </button>
      @if (docAbierto()) { <app-documentos id="doc-cuerpo" class="sec__doc" /> }
    </section>

    <section class="sec" id="biblioteca" aria-labelledby="sec-bib-t" style="--c:#D35C37; --c2:#EFA07F">
      <button type="button" class="sec__cab" [attr.aria-expanded]="bibAbierta()" aria-controls="bib-cuerpo" (click)="bibAbierta.set(!bibAbierta())">
        <span class="sec__insignia" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 5h6a2 2 0 012 2v13a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v13a2 2 0 012-2h6z"/></svg>
        </span>
        <span class="sec__tit">
          <span class="sec__ojo">De dónde sale cada dato</span>
          <h2 id="sec-bib-t">Biblioteca</h2>
        </span>
        <span class="sec__rama" aria-hidden="true"></span>
        <span class="sec__accion">{{ bibAbierta() ? 'Cerrar' : 'Abrir' }}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
      </button>
      @if (bibAbierta()) {
      <div id="bib-cuerpo">
      <app-biblioteca [incrustado]="true" />

      <!-- Catálogo 3D: subsección de la biblioteca, cerrada; el visor 3D solo se crea (y se carga) al abrirla y se libera al cerrarla -->
      <details class="cat3d" id="catalogo" [open]="catAbierto()" (toggle)="catAbierto.set($any($event.target).open)">
        <summary>
          <span class="sec__insignia cat3d__insig" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>
          </span>
          <span class="sec__tit">
            <span class="sec__ojo">Los modelos del mapa 3D, uno a la vez y a escala real</span>
            <h3 class="cat3d__h">Catálogo 3D</h3>
          </span>
          <span class="sec__rama" aria-hidden="true"></span>
          <span class="sec__accion">{{ catAbierto() ? 'Cerrar' : 'Abrir' }}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
        </summary>
        @if (catAbierto()) {
          @defer (on immediate) { <app-catalogo-edificios class="cat3d__visor" /> }
          @loading (minimum 400ms) { <app-cargador class="cat3d__espera" tipo="catalogo" /> }
        }
      </details>
      </div>
      }
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
    .sec__cab { width: 100%; background: none; border: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 16px; padding: 0 16px 12px; max-width: 1180px; margin: 0 auto; }
    /* insignia en hoja, como la del organigrama, en el color de cada sección */
    .sec__insignia { flex: none; width: 54px; height: 54px; display: grid; place-items: center; color: #fff;
      border-radius: 6px 50% 50% 50%; background: linear-gradient(140deg, var(--c2), var(--c) 70%);
      box-shadow: 0 8px 20px color-mix(in srgb, var(--c) 35%, transparent), inset 0 -3px 0 rgba(0,0,0,.08);
      transition: transform .35s cubic-bezier(.3,1.6,.5,1); }
    .sec__insignia svg { width: 26px; height: 26px; }
    .sec__tit { display: block; }
    .sec__cab:focus-visible { outline: 2px solid var(--c); outline-offset: 2px; border-radius: 16px; }
    .sec__accion { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 999px;
      font-size: .82rem; font-weight: 700; color: var(--c); background: color-mix(in srgb, var(--c) 10%, transparent); }
    .sec__accion svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; transition: transform .25s; }
    .sec__cab[aria-expanded="true"] .sec__accion svg { transform: rotate(180deg); }
    .sec__cab:hover .sec__insignia { transform: rotate(-8deg) scale(1.05); }
    .sec__ojo { display: block; font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--c); }
    .sec h2 { margin: 2px 0 0; font-size: clamp(1.3rem, 2.6vw, 1.8rem); line-height: 1.15; color: #243746; }
    .sec__rama { flex: 1; align-self: center; height: 2px; margin-left: 8px; border-radius: 2px; position: relative;
      background: linear-gradient(90deg, var(--c), color-mix(in srgb, var(--c) 35%, transparent) 40%, transparent); }
    .sec__rama::after { content: ''; position: absolute; left: 34%; top: -9px; width: 10px; height: 16px; border-radius: 0 100% 0 100%;
      background: var(--c2); opacity: .7; transform: rotate(-20deg); }
    .sec__doc { display: block; border-radius: 16px; overflow: hidden; margin: 0 8px; box-shadow: 0 6px 24px rgba(30,50,40,.12); }
    /* catálogo 3D: subsección de la biblioteca con el mismo lenguaje del título de sección (insignia en hoja, ojo, título y rama) */
    .cat3d { --c: #7B68C8; --c2: #AB9DE6; max-width: 1180px; margin: 28px auto 0; padding: 0 8px; }
    .cat3d summary { list-style: none; display: flex; align-items: center; gap: 16px; padding: 0 8px 12px; cursor: pointer; }
    .cat3d summary::-webkit-details-marker { display: none; }
    .cat3d summary:focus-visible { outline: 2px solid var(--c); outline-offset: 2px; border-radius: 16px; }
    .cat3d__insig { width: 46px; height: 46px; }
    .cat3d__insig svg { width: 22px; height: 22px; }
    .cat3d summary:hover .cat3d__insig { transform: rotate(-8deg) scale(1.05); }
    .cat3d__h { margin: 2px 0 0; font-size: clamp(1.15rem, 2.2vw, 1.5rem); line-height: 1.15; color: #243746; }
    .cat3d[open] .sec__accion svg { transform: rotate(180deg); }
    .cat3d__visor { display: block; height: min(78dvh, 720px) !important; min-height: 480px; border-radius: 16px; overflow: hidden;
      box-shadow: 0 6px 24px rgba(30,50,40,.12); }
    .cat3d__espera { display: block; height: min(78dvh, 720px); }
    :host-context(body.tema-oscuro) .cat3d__h { color: #eaf3e4; }
    @media (prefers-reduced-motion: reduce) { .sec__insignia, .sec__accion svg { transition: none; } }
    @media (max-width: 640px) { .cat3d { margin: 20px 0 0; padding: 0; } .cat3d .sec__ojo { display: none; } }
    :host-context(body.tema-oscuro) .sec h2 { color: #eaf3e4; }
    :host-context(body.tema-oscuro) .saltos a { background: color-mix(in srgb, var(--c) 18%, rgba(20,30,24,.7)); }
    @media (max-width: 640px) { .sec__rama { display: none; } }
  `],
})
export class QuienesSomosComponent {
  private readonly router = inject(Router);
  /** catálogo 3D abierto: arranca cerrado salvo que la url apunte a él (/quienes-somos#catalogo o la ruta vieja) */
  readonly catAbierto = signal(this.pideCatalogo(this.router.url));
  /** documentos y biblioteca arrancan plegados; el menú o un enlace con #documentos / #biblioteca / #catalogo los abre */
  readonly docAbierto = signal(this.fragmento(this.router.url) === 'documentos');
  readonly bibAbierta = signal(['biblioteca', 'catalogo'].includes(this.fragmento(this.router.url)));

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(e => {
        const f = this.fragmento(e.urlAfterRedirects);
        if (f === 'documentos') { this.docAbierto.set(true); this.bajarA('documentos'); }
        else if (f === 'biblioteca') { this.bibAbierta.set(true); this.bajarA('biblioteca'); }
        else if (f === 'catalogo') { this.bibAbierta.set(true); this.catAbierto.set(true); this.mostrarCatalogo(); }
      });
    // esta vista se carga tarde dentro del recorrido: si la url pedía el catálogo, se baja hasta él cuando ya existe
    if (this.catAbierto()) afterNextRender(() => this.mostrarCatalogo());
  }

  private mostrarCatalogo(): void {
    setTimeout(() => document.getElementById('catalogo')?.scrollIntoView({ block: 'start', behavior: 'instant' }), 60);
  }

  private pideCatalogo(url: string): boolean {
    return this.fragmento(url) === 'catalogo';
  }

  private fragmento(url: string): string {
    return url.split('#')[1] ?? '';
  }

  private bajarA(id: string): void {
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  }
}
