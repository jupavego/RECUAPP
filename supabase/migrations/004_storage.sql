-- ============================================================
-- 004_storage.sql
-- Buckets de Storage con límites aplicados EN EL SERVIDOR.
-- La validación del navegador (storage.service.ts) es comodidad, no
-- seguridad: cualquiera puede llamar a la Storage API directamente.
-- file_size_limit y allowed_mime_types los impone Supabase antes de RLS.
--
-- Convención de rutas: {userId}/{archivo}  → la policy compara el primer
-- segmento con auth.uid().
-- ============================================================

-- avatars: fotos de perfil — lectura pública
-- uploads: archivos de usuario — PRIVADO (solo dueño y admin; usa
--          createSignedUrl en lugar de getPublicUrl para mostrarlos)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', TRUE,  5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('uploads', 'uploads', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "avatars_select_public" ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_own"    ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own"    ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_own"    ON storage.objects;
DROP POLICY IF EXISTS "uploads_select"        ON storage.objects;
DROP POLICY IF EXISTS "uploads_insert_own"    ON storage.objects;
DROP POLICY IF EXISTS "uploads_update_own"    ON storage.objects;
DROP POLICY IF EXISTS "uploads_delete"        ON storage.objects;

-- ── avatars ──────────────────────────────────────────────────
CREATE POLICY "avatars_select_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "avatars_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "avatars_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

-- ── uploads (privado) ────────────────────────────────────────
CREATE POLICY "uploads_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (
      (SELECT auth.uid())::text = (storage.foldername(name))[1]
      OR (SELECT public.get_my_role()) = 'admin'
    )
  );

CREATE POLICY "uploads_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'uploads'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "uploads_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "uploads_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (
      (SELECT auth.uid())::text = (storage.foldername(name))[1]
      OR (SELECT public.get_my_role()) = 'admin'
    )
  );
