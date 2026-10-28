import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SessionService } from '../../../core/services/session.service';
import { SITE } from '../../../data/site.data';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterModule],
  template: `
    <section class="home">
      <h1>{{ site.name }}</h1>
      <p>{{ site.description }}</p>
      <div class="home__actions">
        @if (session.isLoggedIn()) {
          <a routerLink="/app" class="btn-primary">Ir a mi espacio</a>
        } @else {
          <a routerLink="/auth/register" class="btn-primary">Crear cuenta</a>
          <a routerLink="/auth/login" class="btn-secondary">Ingresar</a>
        }
      </div>
    </section>
  `,
  styles: [`
    .home { max-width: 720px; margin: 0 auto; padding: 96px 16px; text-align: center; }
    .home h1 { font-size: 2.4rem; margin: 0 0 12px; }
    .home p { color: var(--neutral-600, #64748b); margin: 0 0 32px; }
    .home__actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  `],
})
export class HomeComponent {
  readonly session = inject(SessionService);
  readonly site    = SITE;
}
