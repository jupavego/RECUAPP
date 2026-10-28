import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';

// Espera a que SessionService tenga usuario Y perfil completamente cargados.
// Timeout de 5s como red de seguridad ante mala conexión.
async function waitForInit(session: SessionService): Promise<void> {
  // initialized se setea en true solo cuando fetchProfile ya terminó
  if (session.initialized()) return;

  return new Promise(resolve => {
    const interval = setInterval(() => {
      if (session.initialized()) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, 5000);
  });
}

// Protege rutas que requieren estar logueado
export const authGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router  = inject(Router);

  await waitForInit(session);

  if (session.isLoggedIn()) return true;

  return router.createUrlTree(['/auth/login']);
};

// Protege rutas de auth — redirige si ya está logueado
export const publicOnlyGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const auth    = inject(AuthService);
  const router  = inject(Router);

  await waitForInit(session);

  if (!session.isLoggedIn()) return true;

  // Usa AuthService como fuente única de verdad para rutas por rol
  return router.createUrlTree([auth.getRouteForRole(session.role() ?? '')]);
};