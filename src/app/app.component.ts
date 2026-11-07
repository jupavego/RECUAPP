import { Component, HostBinding, computed, inject } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { HeaderComponent } from './shared/components/header/header.component';
import { FooterComponent } from './shared/components/footer/footer.component';
import { ConsentBannerComponent } from './shared/components/consent-banner/consent-banner.component';
import { CommonModule } from '@angular/common';
import { filter, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ConsentBannerComponent, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private router = inject(Router);

  private currentUrl = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(e => (e as NavigationEnd).urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  // Header y footer ocultos en /auth/*
  readonly showChrome = computed(() =>
    !this.currentUrl().startsWith('/auth')
  );

  // Quita el padding-top del host cuando no hay chrome (páginas auth)
  @HostBinding('class.no-chrome')
  get isNoChrome(): boolean { return !this.showChrome(); }
}