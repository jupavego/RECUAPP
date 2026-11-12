import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { authGuard, publicOnlyGuard, roleGuard } from './core';
import { recorridoMatcher } from './core/recorrido';

export const routes: Routes = [

  // ── Público ──────────────────────────────────────────────────────────────
  // El recorrido: una sola página con las secciones del menú en su orden (inicio, mapa 3D, plan, responsables,
  // mapa territorial y quiénes somos). Cada sección conserva su ruta; todas abren esta página en
  // su sección y, al desplazarse, la ruta cambia a la de la sección visible (core/recorrido.ts).
  {
    matcher: recorridoMatcher,
    loadComponent: () =>
      import('./features/inicio/pages/inicio/inicio.component').then(m => m.InicioComponent),
  },

  // ── Plan de desarrollo por entidad (público; piloto) ─────────────────────
  { path: 'responsables/pueblo', redirectTo: 'responsables', pathMatch: 'full' },
  {
    path: 'responsables/:dep',
    loadComponent: () =>
      import('./features/plan/pages/responsables/responsables.component').then(m => m.ResponsablesComponent),
  },
  // el organigrama ahora vive debajo del pueblo de responsables; los enlaces viejos llevan a esa sección
  {
    path: 'plan/:dane/organigrama',
    redirectTo: () => inject(Router).createUrlTree(['/responsables'], { fragment: 'organigrama' }),
  },
  {
    path: 'plan/:dane',
    loadComponent: () =>
      import('./features/plan/pages/plan/plan.component').then(m => m.PlanComponent),
  },

  // ── Rutas viejas: documentos y biblioteca viven en Quiénes somos ──
  {
    path: 'documentos',
    redirectTo: () => inject(Router).createUrlTree(['/quienes-somos'], { fragment: 'documentos' }),
  },
  {
    path: 'biblioteca',
    redirectTo: () => inject(Router).createUrlTree(['/quienes-somos'], { fragment: 'biblioteca' }),
  },
  // el catálogo 3D es una subsección plegada de la biblioteca; la ruta vieja la abre
  {
    path: 'mapa3d/catalogo',
    redirectTo: () => inject(Router).createUrlTree(['/quienes-somos'], { fragment: 'catalogo' }),
  },

  // ── Área de usuario (cualquier rol logueado) ─────────────────────────────
  // Aquí viven las pantallas de tu app. 'items' es el CRUD de ejemplo.
  {
    path: 'app',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/items/pages/items-list/items-list.component')
            .then(m => m.ItemsListComponent),
      },
    ],
  },

  // ── Perfil personal ──────────────────────────────────────────────────────
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/client/pages/profile-edit/profile-edit.component')
        .then(m => m.ProfileEditComponent),
  },

  // ── Auth — layout propio, sin header global ──────────────────────────────
  {
    path: 'auth',
    loadComponent: () =>
      import('./layouts/auth-layout/auth-layout.component')
        .then(m => m.AuthLayoutComponent),
    children: [
      // Sin guard — Supabase establece sesión temporal con el token
      {
        path: 'reset-password',
        loadComponent: () =>
          import('./features/auth/pages/reset-password/reset-password.component')
            .then(m => m.ResetPasswordComponent),
      },
      // Callback de confirmación de email — también sin publicOnlyGuard
      {
        path: 'confirm',
        loadComponent: () =>
          import('./shared/pages/confirm/auth-confirm.component')
            .then(m => m.AuthConfirmComponent),
      },
      // Rutas solo para no logueados
      {
        path: '',
        canActivate: [publicOnlyGuard],
        children: [
          {
            path: 'login',
            loadComponent: () =>
              import('./features/auth/pages/login/login.component')
                .then(m => m.LoginComponent),
          },
          {
            path: 'register',
            loadComponent: () =>
              import('./features/auth/pages/register/register.component')
                .then(m => m.RegisterComponent),
          },
          {
            path: 'recover',
            loadComponent: () =>
              import('./features/auth/pages/recover/recover.component')
                .then(m => m.RecoverComponent),
          },
        ],
      },
    ],
  },

  // ── Panel admin ──────────────────────────────────────────────────────────
  {
    path: 'admin',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin'] },
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/admin/pages/admin-dashboard/admin-dashboard.component')
            .then(m => m.AdminDashboardComponent),
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./features/admin/pages/users-list/users-list.component')
            .then(m => m.UsersListComponent),
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },

  // ── Legal ────────────────────────────────────────────────────────────────
  {
    path: 'security',
    loadComponent: () =>
      import('./shared/pages/security-disclosure/security-disclosure.component')
        .then(m => m.SecurityDisclosureComponent),
  },
  {
    path: 'privacidad',
    loadComponent: () =>
      import('./shared/pages/privacy/privacy.component')
        .then(m => m.PrivacyComponent),
  },

  // ── 404 ──────────────────────────────────────────────────────────────────
  {
    path: '**',
    loadComponent: () =>
      import('./shared/pages/not-found/not-found.component')
        .then(m => m.NotFoundComponent),
  },
];
