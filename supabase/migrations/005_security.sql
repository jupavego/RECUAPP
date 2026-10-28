-- ============================================================
-- 005_security.sql
-- Funciones RPC con role guard y rate limiting genérico.
-- ============================================================

-- ── get_admin_stats() — solo admin ───────────────────────────
-- Regla para toda función SECURITY DEFINER (corre con privilegios del
-- dueño, saltándose RLS): 1) role guard al inicio, 2) search_path fijo,
-- 3) REVOKE a anon. Sin esto, cualquier usuario podría leer datos ajenos.
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

  RETURN (
    SELECT json_build_object(
      'totalUsers',  COUNT(*),
      'totalAdmins', COUNT(*) FILTER (WHERE role = 'admin'),
      'totalItems',  0   -- 006_items_example.sql redefine esta función con el conteo real
    )
    FROM public.profiles
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;

-- ── enforce_insert_rate_limit() ──────────────────────────────
-- Trigger BEFORE INSERT reutilizable: limita cuántas filas puede crear un
-- usuario por hora en una tabla. Requiere columnas owner_id y created_at.
-- Uso:
--   CREATE TRIGGER mitabla_rate_limit BEFORE INSERT ON public.mitabla
--     FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit(60);
-- Evita que un usuario autenticado (o un bot con cuenta) sature la tabla.
-- No aplica a service_role ni al SQL Editor (auth.uid() NULL).
CREATE OR REPLACE FUNCTION public.enforce_insert_rate_limit()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SET search_path = public
AS $$
DECLARE
  max_per_hour INT := COALESCE(TG_ARGV[0]::INT, 60);
  recent       INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT COUNT(*) FROM %I.%I WHERE owner_id = $1 AND created_at > NOW() - INTERVAL ''1 hour''',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
  ) INTO recent USING NEW.owner_id;

  IF recent >= max_per_hour THEN
    RAISE EXCEPTION 'Rate limit exceeded: máximo % inserciones por hora', max_per_hour
      USING ERRCODE = '54000';
  END IF;

  RETURN NEW;
END;
$$;
