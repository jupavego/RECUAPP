import { Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { TemaService } from '../../../core/services/tema.service';
import { SessionService } from '../../../core/services/session.service';
import { UserWidgetComponent } from '../user-widget/user-widget.component';
import { SITE } from '../../../data/site.data';

type Glifo = 'home' | 'plan' | 'users' | 'org' | 'pin' | 'cube' | 'grid' | 'db' | 'flag' | 'key' | 'shield' | 'login' | 'leaf' | 'nosotros';

interface ItemNav {
  t: string;
  r: string;
  /** color del módulo: paleta de jardín (helecho, caléndula, musgo, eucalipto, cielo, lavanda, terracota, orquídea) */
  c: string;
  g: Glifo;
  activo: (url: string) => boolean;
}

interface GrupoNav { nombre: string; items: ItemNav[]; }

const ruta = (u: string) => u.split(/[?#]/)[0];

const CLAVE_PLEGADO = 'nav-plegado';
const leerPlegado = () => { try { return localStorage.getItem(CLAVE_PLEGADO) === '1'; } catch { return false; } };

/**
 * Panel lateral de navegación (variante D «Maestro-detalle»): la lista de módulos a la izquierda
 * y la vista abierta a la derecha. «Inicio» abre la portada y «Mapa 3D», justo debajo, el modelo del municipio. Bajo 768px se vuelve barra superior.
 */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterModule, NgTemplateOutlet, UserWidgetComponent],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  host: { '[class.is-plegado]': 'plegado()', '(document:keydown.escape)': 'cerrarMenu()' },
})
export class HeaderComponent {
  readonly session = inject(SessionService);
  readonly site    = SITE;
  readonly tema    = inject(TemaService);
  private readonly router = inject(Router);

  readonly url = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(e => ruta((e as NavigationEnd).urlAfterRedirects))),
    { initialValue: ruta(this.router.url) },
  );

  // el inicio es la portada; el mapa 3D va justo debajo, con su sección propia
  readonly inicio: ItemNav = { t: 'Inicio', r: '/', c: '#4FA22E', g: 'home', activo: u => u === '/' };
  readonly mapa3d: ItemNav = { t: 'Mapa 3D', r: '/mapa3d', c: '#2E86C1', g: 'cube', activo: u => u === '/mapa3d' };

  readonly ingresar: ItemNav = { t: 'Ingresar', r: '/auth/login', c: '#6B7F6E', g: 'login', activo: () => false };

  readonly grupos: GrupoNav[] = [
    { nombre: 'Plan', items: [
      { t: 'El plan en claro', r: '/plan', c: '#4FA22E', g: 'plan', activo: u => /^\/plan(\/\d+)?$/.test(u) },
      { t: 'Responsables', r: '/responsables', c: '#D99A14', g: 'users', activo: u => u.startsWith('/responsables') },
    ] },
    { nombre: 'Territorio', items: [
      { t: 'Mapa territorial', r: '/mapa', c: '#16A085', g: 'pin', activo: u => u === '/mapa' },
    ] },
    // la presentacion de RECUAPP, con los documentos y la biblioteca
    { nombre: 'Nosotros', items: [
      { t: 'Quiénes somos', r: '/quienes-somos', c: '#2F7D45', g: 'nosotros', activo: u => u.startsWith('/quienes-somos') },
    ] },
  ];

  /** solo con sesión: el espacio propio y, para administradores, el panel */
  readonly cuenta = computed<ItemNav[]>(() => {
    if (!this.session.isLoggedIn()) return [];
    const it: ItemNav[] = [{ t: 'Mi espacio', r: '/app', c: '#5C6B5F', g: 'key', activo: u => u.startsWith('/app') }];
    if (this.session.isAdmin()) it.push({ t: 'Administración', r: '/admin/dashboard', c: '#5C6B5F', g: 'shield', activo: u => u.startsWith('/admin') });
    return it;
  });

  /** panel plegado a riel de íconos: la vista gana el ancho (se recuerda en el navegador) */
  readonly plegado = signal(leerPlegado());

  alternarPlegado(): void {
    this.plegado.update(v => !v);
    try { localStorage.setItem(CLAVE_PLEGADO, this.plegado() ? '1' : '0'); } catch { /* sin almacenamiento */ }
  }

  /** móvil: panel de módulos desplegado bajo la barra superior */
  readonly menuAbierto = signal(false);
  alternarMenu(): void { this.menuAbierto.update(v => !v); }
  cerrarMenu(): void { this.menuAbierto.set(false); }

  /** el módulo abierto, para mostrarlo en la barra superior de móvil */
  readonly actual = computed<ItemNav | null>(() => {
    const u = this.url();
    const todos = [this.inicio, this.mapa3d, ...this.grupos.flatMap(g => g.items), ...this.cuenta()];
    return todos.find(m => m.activo(u)) ?? null;
  });

  constructor() {
    // el ancho de la columna lo lee la rejilla de app.component (.shell)
    effect(() => document.documentElement.style.setProperty('--ancho-lado', this.plegado() ? '72px' : '264px'));

    // al navegar se cierra el panel de móvil
    effect(() => { this.url(); this.menuAbierto.set(false); });
  }
}
