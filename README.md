# Lienzo base — Angular 19 + Supabase

Punto de partida para una app nueva: autenticación completa, roles, panel admin, un CRUD de ejemplo y una capa de seguridad ya montada. Se extrajo del proyecto *Come en Girardota* quitando todo lo del dominio.

## Qué trae

- **Auth:** login, registro, recuperar y restablecer contraseña, confirmación de correo, Google OAuth opcional, Cloudflare Turnstile opcional.
- **Roles:** `user` y `admin`, con `authGuard`, `publicOnlyGuard` y `roleGuard` (`data: { roles: ['admin'] }`).
- **Panel admin:** dashboard con métricas y gestión de usuarios (cambio de rol).
- **CRUD de ejemplo:** `features/items` (servicio + página con formulario, lista, editar y borrar) respaldado por RLS.
- **Perfil:** edición de nombre, teléfono y avatar con compresión de imagen en el cliente.
- **Seguridad:** ver `docs/security/` y `supabase/README.md`.
- **Extras:** Sentry opcional, headers de seguridad y CSP en `vercel.json`, CI de seguridad (`npm audit`, Semgrep, Gitleaks), plantillas de correo.

## Empezar

```bash
npm install
```

1. Crea un proyecto en [Supabase](https://supabase.com).
2. Aplica `supabase/migrations/001…006` (ver `supabase/README.md`) y crea el primer admin con `supabase/seed.sql`.
3. Pon tu URL y anon key en `src/environments/environment.ts` y `environment.prod.ts`.
4. `npm start` → http://localhost:4200

| Variable (`environment*.ts`) | Dónde se obtiene | Obligatoria |
|---|---|---|
| `supabaseUrl`, `supabaseAnonKey` | Supabase → Project Settings → API | Sí |
| `turnstileSiteKey` | Cloudflare → Turnstile | No (sin ella no hay captcha) |
| `sentryDsn` | Sentry → Client Keys | No |

La anon key es pública por diseño; **nunca** pongas la `service_role` en el frontend.

## Estructura

```
src/app/
  core/       guards, interceptor, modelos, servicios (supabase, sesión, auth, storage)
  features/   admin, auth, client (perfil), items (CRUD de ejemplo)
  layouts/    auth-layout
  shared/     header, footer, user-widget, turnstile, consent-banner, páginas (home, 404, legales)
  data/       site.data.ts — nombre, descripción y contacto del sitio
supabase/     migraciones SQL, funciones edge, plantillas de correo, tests
docs/security/  arquitectura de seguridad, checklist mensual, runbook de incidentes, ADRs
```

## Convertirlo en tu app

1. **Renombra** el proyecto: `package.json`, `angular.json`, `.claude/launch.json` (busca `app-base`) y `src/data/site.data.ts`, `src/index.html`.
2. **Reemplaza `items`** por tu entidad: modelo, servicio, página, ruta en `app.routes.ts` y migración (`006_items_example.sql` es el molde).
3. **Añade roles** si los necesitas: ver comentario en `core/models/profile.model.ts`.
4. **Marca:** colores en `src/styles/_tokens.scss`, textos de `privacy.component.html` y de las plantillas de correo.
5. **Despliegue:** `vercel.json` ya trae HSTS, CSP y demás headers; si añades un servicio externo, agrégalo al `connect-src`/`script-src` de la CSP.

## Scripts

`npm start` · `npm run build` · `npm test`

## Pendiente de verificar

El SQL no se ha ejecutado contra una base real desde que se generó el lienzo y la app no se ha probado contra un proyecto Supabase vivo: haz una primera pasada en un proyecto de pruebas.
