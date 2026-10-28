import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation,
  inject,
  input,
  output,
} from '@angular/core';
import { environment } from '../../../../environments/environment';

declare const turnstile: {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
};

@Component({
  selector: 'app-turnstile',
  standalone: true,
  template: `<div #host></div>`,
  encapsulation: ViewEncapsulation.None,
})
export class TurnstileComponent implements OnInit, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  theme   = input<'light' | 'dark' | 'auto'>('auto');
  resolved = output<string>();   // emite el token cuando el usuario supera el challenge
  errored  = output<void>();

  private widgetId?: string;
  private el = inject(ElementRef);

  ngOnInit(): void {
    this.renderWhenReady();
  }

  ngOnDestroy(): void {
    if (this.widgetId) {
      try { turnstile.remove(this.widgetId); } catch { /* noop */ }
    }
  }

  private renderWhenReady(): void {
    if (typeof turnstile !== 'undefined') {
      this.render();
      return;
    }
    // El script de Turnstile se carga async — esperar a que esté listo
    const check = setInterval(() => {
      if (typeof turnstile !== 'undefined') {
        clearInterval(check);
        this.render();
      }
    }, 100);
    setTimeout(() => clearInterval(check), 10_000);
  }

  private render(): void {
    this.widgetId = turnstile.render(this.host.nativeElement, {
      sitekey:  environment.turnstileSiteKey,
      theme:    this.theme(),
      callback: (token: string) => this.resolved.emit(token),
      'error-callback': () => this.errored.emit(),
    });
  }
}
