import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SessionService } from '../../../core/services/session.service';
import { SITE } from '../../../data/site.data';
import { PinNetworkComponent } from '../../components/pin-network/pin-network.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterModule, PinNetworkComponent],
  template: `
    <section class="home">
      <div class="home__relieve" aria-hidden="true" [style.animation-delay.s]="faseInicial" [style.--rel-y.%]="alturaInicial"></div>
      <app-pin-network />
      <div class="home__inner">
      <h1>{{ site.name }}</h1>
      <p class="home__lema">{{ site.purpose.lema }}</p>
      <p>{{ site.purpose.descripcion }}</p>
      <div class="home__actions">
        @if (session.isLoggedIn()) {
          <a routerLink="/app" class="btn-primary">Ir a mi espacio</a>
        } @else {
          <a routerLink="/auth/register" class="btn-primary">Crear cuenta</a>
          <a routerLink="/auth/login" class="btn-secondary">Ingresar</a>
        }
      </div>
      </div>
    </section>
  `,
  styles: [`
    .home { position: relative; overflow: hidden; text-align: center; padding: 96px 16px; }
    /* Relieve de Girardota en un solo plano que deriva despacio: de lado, arriba y abajo, y con zoom (profundidad).
       Una sola animación con transform, para que funcione igual en todos los navegadores. */
    .home__relieve {
      position: absolute; inset: -25% -20%; pointer-events: none; opacity: .55; background: #4F8A2E; will-change: transform;
      -webkit-mask: url('/img/relieve-49.svg') 50% var(--rel-y, 50%) / cover no-repeat; mask: url('/img/relieve-49.svg') 50% var(--rel-y, 50%) / cover no-repeat;
      animation: relieve-deriva 320s ease-in-out infinite;
    }
    @keyframes relieve-deriva {
      0%, 100% { transform: translate3d(-6%, -5%, 0) scale(1.02) rotate(-1deg); }
      25%      { transform: translate3d(5%, -3%, 0) scale(1.12) rotate(.5deg); }
      50%      { transform: translate3d(7%, 6%, 0) scale(1.24) rotate(1.5deg); }
      75%      { transform: translate3d(-4%, 7%, 0) scale(1.1) rotate(0deg); }
    }
    @media (prefers-reduced-motion: reduce) { .home__relieve { animation: none; } }
    :host-context(body.tema-oscuro) .home__relieve { background: #99CC33; opacity: .22; }
    .home__inner { position: relative; z-index: 1; max-width: 720px; margin: 0 auto; }
    .home h1 { font-size: 2.4rem; margin: 0 0 12px; }
    .home p { color: var(--neutral-600, #64748b); margin: 0 auto 32px; max-width: 78ch; line-height: 1.7; }
    .home .home__lema { font-family: var(--font-heading); font-size: 1.35rem; font-weight: 600; line-height: 1.4; color: #29422F; margin-bottom: 16px; }
    :host-context(body.tema-oscuro) .home .home__lema { color: #99CC33; text-shadow: 0 0 18px rgba(153, 204, 51, .35); }
    .home__actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  `],
})
export class HomeComponent {
  readonly session = inject(SessionService);
  readonly site    = SITE;
  /** la «cámara» del relieve arranca en un punto cualquiera de la fotografía: fase al azar del recorrido y altura al azar */
  readonly faseInicial = -Math.random() * 320;
  readonly alturaInicial = Math.random() * 100;
}
