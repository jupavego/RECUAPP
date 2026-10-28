-- ============================================================
-- 006_items_example.sql
-- Tabla de EJEMPLO para el CRUD (features/items). Es el molde para tus
-- tablas reales: copia este archivo, renombra `items` y ajusta columnas.
-- Si no la necesitas, no ejecutes esta migración y borra features/items.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description TEXT        CHECK (description IS NULL OR char_length(description) <= 1000),
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_items_owner_id ON public.items(owner_id);

DROP TRIGGER IF EXISTS items_set_updated_at ON public.items;
CREATE TRIGGER items_set_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS items_rate_limit ON public.items;
CREATE TRIGGER items_rate_limit
  BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit(60);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "items_select" ON public.items;
CREATE POLICY "items_select"
  ON public.items FOR SELECT
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR (SELECT public.get_my_role()) = 'admin'
  );

DROP POLICY IF EXISTS "items_insert" ON public.items;
CREATE POLICY "items_insert"
  ON public.items FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "items_update" ON public.items;
CREATE POLICY "items_update"
  ON public.items FOR UPDATE
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR (SELECT public.get_my_role()) = 'admin'
  )
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    OR (SELECT public.get_my_role()) = 'admin'
  );

DROP POLICY IF EXISTS "items_delete" ON public.items;
CREATE POLICY "items_delete"
  ON public.items FOR DELETE
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR (SELECT public.get_my_role()) = 'admin'
  );

-- ── Estadísticas del panel admin (versión con conteo de items) ─
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSON
LANGUAGE PLPGSQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Access denied: admin role required' USING ERRCODE = '42501';
  END IF;

  RETURN json_build_object(
    'totalUsers',  (SELECT COUNT(*) FROM public.profiles),
    'totalAdmins', (SELECT COUNT(*) FROM public.profiles WHERE role = 'admin'),
    'totalItems',  (SELECT COUNT(*) FROM public.items)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;
