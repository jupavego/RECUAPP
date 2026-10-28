-- ============================================================
-- 003_rls_policies.sql
-- Row Level Security de las tablas base.
-- Regla de oro: TODA tabla nueva en public.* nace con
--   ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- y sus policies. Sin policies, nadie (salvo service_role) accede.
-- (select ...) alrededor de get_my_role()/auth.uid() hace que Postgres
-- lo evalúe una vez por consulta en lugar de una vez por fila.
-- ============================================================

ALTER TABLE public.profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ── profiles ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    OR (SELECT public.get_my_role()) = 'admin'
  );

-- INSERT: el trigger handle_new_user ya crea la fila. Esta policy solo
-- cubre el fallback de SessionService (OAuth sin perfil) y obliga rol 'user'.
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id AND role = 'user');

-- UPDATE: cada quien su fila; el admin cualquiera. El cambio de `role`
-- lo restringe el trigger protect_profile_role.
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    OR (SELECT public.get_my_role()) = 'admin'
  )
  WITH CHECK (
    (SELECT auth.uid()) = id
    OR (SELECT public.get_my_role()) = 'admin'
  );

-- DELETE: sin policy → nadie desde el cliente (solo service_role / dashboard).

-- ── audit_logs ───────────────────────────────────────────────
-- Solo admins leen. Inserta la base (triggers SECURITY DEFINER) o el
-- propio usuario a su nombre. Sin policies UPDATE/DELETE → inmutable.
DROP POLICY IF EXISTS "audit_logs_admin_select" ON public.audit_logs;
CREATE POLICY "audit_logs_admin_select"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING ((SELECT public.get_my_role()) = 'admin');

DROP POLICY IF EXISTS "audit_logs_insert_self" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_self"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = (SELECT auth.uid()));
