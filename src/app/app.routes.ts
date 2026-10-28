import { Routes } from '@angular/router';
import { authGuard, publicOnlyGuard, roleGuard } from './core';

export const routes: Routes = [

  // ── Público ──────────────────────────────────────────────────────────────
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./shared/pages/home/home.component').then(m => m.HomeComponent),
  },

  // ── Mapa territorial (público) ───────────────────────────────────────────
  {
    path: 'mapa',
    loadComponent: () =>
      import('./features/mapa/pages/mapa/mapa.component').then(m => m.MapaComponent),
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
