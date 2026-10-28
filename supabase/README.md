# Supabase — lienzo base

## Aplicar el esquema

En orden, desde **Dashboard → SQL Editor** (o `supabase db push`):

| # | Archivo | Qué hace |
|---|---------|----------|
| 1 | `001_schema.sql` | enum `user_role`, tablas `profiles` y `audit_logs` |
| 2 | `002_functions_triggers.sql` | `get_my_role()`, perfil automático al registrarse, protección contra auto-promoción, auditoría de cambios de rol |
| 3 | `003_rls_policies.sql` | RLS de `profiles` y `audit_logs` |
| 4 | `004_storage.sql` | buckets `avatars` (público) y `uploads` (privado) con límite 5 MB y MIME whitelist |
| 5 | `005_security.sql` | `get_admin_stats()` con role guard, trigger genérico de rate limiting |
| 6 | `006_items_example.sql` | tabla de ejemplo del CRUD (opcional — es el molde para tus tablas) |

Después: crea el primer admin siguiendo `seed.sql` y verifica con `tests/rls_policies.sql`.

## Matriz de permisos

### profiles
| Operación | user | admin |
|-----------|------|-------|
| SELECT | solo el propio | todos |
| INSERT | propio, rol `user` | — |
| UPDATE | solo el propio (el `role` no) | todos, incluido `role` |
| DELETE | NO | NO (solo service_role) |

### items (ejemplo)
| Operación | user | admin |
|-----------|------|-------|
| SELECT / UPDATE / DELETE | solo los propios | todos |
| INSERT | con `owner_id = auth.uid()`, máx. 60/hora | ídem |

### audit_logs
Solo admin lee. Nadie edita ni borra.

### storage
Ruta `{userId}/{archivo}`. `avatars`: lectura pública, escritura en la propia carpeta. `uploads`: privado, dueño y admin.

## Crear una tabla nueva (checklist)

1. `owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE` y `created_at`.
2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policies para cada operación que necesites.
3. `CHECK` de longitudes/valores en la propia tabla (no confíes solo en el formulario).
4. `enforce_insert_rate_limit(N)` si cualquier usuario puede insertar.
5. Toda función `SECURITY DEFINER`: role guard, `SET search_path = public`, `REVOKE ... FROM PUBLIC, anon`.

## Edge Functions

- `verify-turnstile` — valida el token de Cloudflare Turnstile en el servidor antes del registro.
  `supabase functions deploy verify-turnstile` y `supabase secrets set TURNSTILE_SECRET_KEY=...`
- `_shared/` — clientes compartidos (`supabase-admin.ts` con service role, `resend.ts` para correos).

## Plantillas de correo

`email-templates/` contiene confirmación de registro y recuperación de contraseña
(pega el HTML en Dashboard → Authentication → Email Templates). Cambia la marca y `TU-DOMINIO.com`.

## Notas

- `get_my_role()` lee `profiles` en vivo (no el JWT), así que un cambio de rol aplica de inmediato.
- El SQL de esta carpeta no se ha ejecutado contra una base real desde que se generó el lienzo: aplícalo primero en un proyecto de pruebas.
