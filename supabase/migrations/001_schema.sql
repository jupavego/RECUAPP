-- ============================================================
-- 001_schema.sql
-- Esquema base del lienzo: roles, perfiles y bitácora de auditoría.
-- Ejecutar primero (Supabase Dashboard → SQL Editor, o `supabase db push`).
-- ============================================================

-- ── Roles ────────────────────────────────────────────────────
-- Para añadir roles: ALTER TYPE user_role ADD VALUE 'nuevo_rol';
-- y actualiza UserRole en src/app/core/models/profile.model.ts
-- y ROLE_ROUTES en src/app/core/services/auth.service.ts.
CREATE TYPE public.user_role AS ENUM ('user', 'admin');

-- ── profiles ─────────────────────────────────────────────────
-- Extiende auth.users con los datos del perfil. La fila se crea sola
-- por trigger al registrarse un usuario (ver 002_functions_triggers.sql).
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        public.user_role NOT NULL DEFAULT 'user',
  full_name   TEXT,
  avatar_url  TEXT,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- ── audit_logs ───────────────────────────────────────────────
-- Trazabilidad de acciones privilegiadas (cambios de rol, etc.).
-- OWASP A09: sin bitácora un incidente no se puede reconstruir.
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,   -- ej: 'profile.role_change'
  entity_type TEXT        NOT NULL,   -- ej: 'profile'
  entity_id   TEXT,                   -- PK del registro afectado
  metadata    JSONB,                  -- valores anteriores/nuevos, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_actor_idx  ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON public.audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_time_idx   ON public.audit_logs (created_at DESC);
