import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

const CLAVE = 'plan-tema';

export type ModoTema = 'base' | 'botanico' | 'oscuro';
const ORDEN: ModoTema[] = ['base', 'botanico', 'oscuro'];

/**
 * Modos opcionales de color: la paleta de la app, "Earthy Botanical" y su variante oscura.
 * Se eligen con el botón de la cabecera y se recuerdan en el navegador.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  readonly modo = signal<ModoTema>(this.leer());
  /** el tema botánico está activo, en claro o en oscuro */
  readonly botanico = computed(() => this.modo() !== 'base');
  readonly oscuro = computed(() => this.modo() === 'oscuro');

  private readonly router = inject(Router);
  /** los mapas (2D y 3D) no se tiñen: allí el tema solo viste la cabecera y el pie */
  private readonly enMapa = signal(this.esMapa(this.router.url));

  constructor() {
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => this.enMapa.set(this.esMapa((e as NavigationEnd).urlAfterRedirects)));
    effect(() => {
      // <body> lo leen la cabecera y el pie; <html> lleva las variables de color del resto de la app, salvo en los mapas
      document.body.classList.toggle('tema-botanico', this.botanico());
      document.body.classList.toggle('tema-oscuro', this.oscuro());
      document.documentElement.classList.toggle('tema-botanico', this.botanico() && !this.enMapa());
      document.documentElement.classList.toggle('tema-oscuro', this.oscuro() && !this.enMapa());
    });
  }

  private esMapa(url: string): boolean {
    return /^\/mapa(3d)?([/?#]|$)/.test(url);
  }

  /** base → botánico → botánico oscuro → base */
  alternar(): void {
    this.fijar(ORDEN[(ORDEN.indexOf(this.modo()) + 1) % ORDEN.length]);
  }

  fijar(m: ModoTema): void {
    this.modo.set(m);
    try { localStorage.setItem(CLAVE, m); } catch { /* sin almacenamiento: solo dura esta visita */ }
  }

  private leer(): ModoTema {
    try {
      const v = localStorage.getItem(CLAVE);
      return v === 'botanico' || v === 'oscuro' ? v : 'base';
    } catch { return 'base'; }
  }
}
