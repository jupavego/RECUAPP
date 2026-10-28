# Arquitectura de seguridad

## Modelo de confianza

El navegador **no es de fiar**. Toda regla que importa se impone en PostgreSQL (RLS, triggers, CHECK) y en Storage; los guards de Angular solo mejoran la experiencia.

```
Navegador (Angular)  ──anon key + JWT──►  Supabase API  ──►  PostgreSQL (RLS, triggers)
                                                      └──►  Storage (límites + policies)
                                                      └──►  Edge Functions (service role)
```

## Roles

| Rol | Cómo se obtiene | Puede |
|-----|-----------------|-------|
| `user` | Todo registro (siempre) | Gestionar sus propios datos |
| `admin` | Lo asigna un admin o el SQL Editor | Ver/gestionar todo, cambiar roles |

Reglas:
1. `handle_new_user()` **ignora** cualquier `role` enviado por el cliente → siempre `user`.
2. `protect_profile_role` impide que un usuario cambie su propio rol (las policies le dejan editar su fila).
3. Cada cambio de rol queda en `audit_logs`.
4. `get_my_role()` lee `profiles` en vivo con `SECURITY DEFINER` y `search_path` fijo (sin recursión de RLS, sin depender de claims del JWT).

## Capas

| Capa | Mecanismo | Archivo |
|------|-----------|---------|
| Rutas | `authGuard`, `publicOnlyGuard`, `roleGuard` | `core/guards/` |
| Datos | RLS en toda tabla, `CHECK` de longitudes | `supabase/migrations/003`, `006` |
| RPC | Role guard + `search_path` + `REVOKE` a anon | `005_security.sql` |
| Abuso | Rate limit por usuario/hora en INSERT | `enforce_insert_rate_limit` |
| Archivos | 5 MB y MIME whitelist en el bucket; carpeta = `auth.uid()` | `004_storage.sql` |
| Registro | Turnstile verificado en Edge Function | `verify-turnstile` |
| Errores auth | Mensajes genéricos (no filtrar detalles del backend) | `AuthService.mapAuthError` |
| Transporte | HSTS, CSP, X-Frame-Options, etc. | `vercel.json` |
| Trazabilidad | `audit_logs` inmutable, solo lectura admin | `001`, `003` |
| Supply chain | `npm audit`, Semgrep, Gitleaks, Dependabot | `.github/` |

## Reglas para código nuevo

- Tabla nueva → RLS activo + policies + `owner_id` + rate limit (checklist en `supabase/README.md`).
- Función `SECURITY DEFINER` → role guard, `SET search_path = public`, `REVOKE` a `PUBLIC, anon`.
- Nunca confíes en datos de `raw_user_meta_data` para autorizar.
- Nunca pongas `service_role` ni secretos en el frontend; usa `supabase secrets set` para Edge Functions.
- Mensajes de error al usuario: genéricos; el detalle va a Sentry/console.
- Si añades un servicio externo, actualiza la CSP de `vercel.json`.

## Limitaciones conocidas

- El `role` por defecto de OAuth (Google) también es `user`.
- Rate limiting solo cubre INSERT por usuario autenticado; los intentos de login los limita Supabase Auth.
- Los buckets públicos (`avatars`) sirven los archivos a cualquiera que tenga la URL.
