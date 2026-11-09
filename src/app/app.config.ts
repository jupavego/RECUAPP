import {
  ApplicationConfig,
  ErrorHandler,
  provideZoneChangeDetection,
} from '@angular/core';
import * as Sentry from '@sentry/angular';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { errorInterceptor } from './core/interceptors/error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      // anchorScrolling: un enlace con fragmento (p. ej. /quienes-somos#biblioteca) baja hasta esa sección.
      // La subida al inicio en cada navegación la hace app.component, salvo dentro del recorrido (core/recorrido.ts),
      // que se desplaza a la sección pedida en vez de saltar arriba.
      withInMemoryScrolling({ scrollPositionRestoration: 'disabled', anchorScrolling: 'enabled' })
    ),
    provideHttpClient(withInterceptors([errorInterceptor])),
    // Reporta a Sentry cualquier error no capturado (bugs de runtime,
    // no solo errores HTTP). Si Sentry no está inicializado (sin DSN),
    // este handler simplemente no tiene a dónde reportar y no hace nada.
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler() },
  ],
};
