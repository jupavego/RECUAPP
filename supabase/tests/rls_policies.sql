-- ============================================================
-- tests/rls_policies.sql
-- Verificaciones rápidas de seguridad. Ejecutar en el SQL Editor después
-- de aplicar las migraciones. Cada consulta debe devolver lo indicado.
-- ============================================================

-- 1. Toda tabla de public debe tener RLS activo → 0 filas esperadas.
SELECT tablename
FROM   pg_tables
WHERE  schemaname = 'public'
  AND  rowsecurity = FALSE;

-- 2. Policies por tabla (cada tabla debe tener al menos una).
SELECT tablename, policyname, cmd
FROM   pg_policies
WHERE  schemaname = 'public'
ORDER  BY tablename, cmd;

-- 3. Funciones SECURITY DEFINER sin search_path fijo → 0 filas esperadas.
SELECT p.proname
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.prosecdef
  AND  (p.proconfig IS NULL OR NOT EXISTS (
         SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'));

-- 4. Buckets: deben tener límite de tamaño y MIME → 0 filas esperadas.
SELECT id
FROM   storage.buckets
WHERE  file_size_limit IS NULL OR allowed_mime_types IS NULL;

-- 5. Prueba manual de escalación de privilegios (como usuario normal,
--    desde la app o con su JWT): esto DEBE fallar con 42501:
--    UPDATE public.profiles SET role = 'admin' WHERE id = auth.uid();
