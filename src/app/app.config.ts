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
      withInMemoryScrolling({ scrollPositionRestoration: 'top' })
    ),
    provideHttpClient(withInterceptors([errorInterceptor])),
    // Reporta a Sentry cualquier error no capturado (bugs de runtime,
    // no solo errores HTTP). Si Sentry no está inicializado (sin DSN),
    // este handler simplemente no tiene a dónde reportar y no hace nada.
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler() },
  ],
};
