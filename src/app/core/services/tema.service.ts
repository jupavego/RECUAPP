import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { esRecorrido } from '../recorrido';

const CLAVE = 'plan-tema';

export type ModoTema = 'botanico' | 'oscuro';
const ORDEN: ModoTema[] = ['botanico', 'oscuro'];

/**
 * Modos de color de la app: "Earthy Botanical" (el claro, por defecto) y su variante oscura.
 * Se alternan con el botón de la cabecera y se recuerdan en el navegador.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  readonly modo = signal<ModoTema>(this.leer());
  /** la paleta botánica es la de siempre (en claro o en oscuro); se conserva por quienes la consultan */
  readonly botanico = computed(() => true);
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
    // los mapas viven ahora dentro del recorrido, junto a secciones que sí se tiñen: ahí el tema no cambia al pasar por ellos
    return /^\/mapa(3d)?([/?#]|$)/.test(url) && !esRecorrido(url);
  }

  /** botánico → botánico oscuro → botánico */
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
      return v === 'oscuro' ? v : 'botanico';
    } catch { return 'botanico'; }
  }
}
