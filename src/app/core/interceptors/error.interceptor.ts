import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SessionService } from '../services/session.service';

export const errorInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const router  = inject(Router);
  const session = inject(SessionService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      switch (error.status) {
        case 401:
          // Token expirado o inválido — esperado, no es un bug
          router.navigate(['/auth/login']);
          break;

        case 403:
          // Sin permiso para este recurso — esperado, no es un bug
          router.navigate(['/']);
          break;

        case 0:
          // Sin conexión — esperado (usuario con mal señal), no se reporta
          // a Sentry: console.warn no lo captura la integración de consola
          // (solo escucha 'error'), evita ruido por algo fuera de nuestro control.
          console.warn('Sin conexión al servidor');
          break;

        default:
          // 5xx, 4xx inesperados — esto sí es un bug real. console.error ya
          // se reporta solo a Sentry (captureConsoleIntegration en main.ts).
          console.error(`Error ${error.status}:`, error.message);
      }

      return throwError(() => error);
    })
  );
};