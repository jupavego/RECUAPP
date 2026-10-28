-- ============================================================
-- 002_functions_triggers.sql
-- Funciones helper y triggers de seguridad.
-- ============================================================

-- ── get_my_role() ────────────────────────────────────────────
-- Rol del usuario autenticado, leído en vivo desde profiles.
-- SECURITY DEFINER evita la recursión infinita de RLS (la policy de
-- profiles puede llamarla sin disparar de nuevo la policy de profiles)
-- y, a diferencia de leer el JWT, un cambio de rol aplica de inmediato.
-- search_path fijo: evita ataques de search_path injection.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid();
$$;

-- ── handle_new_user ──────────────────────────────────────────
-- Crea el perfil al registrarse. SEC: el rol NUNCA se lee de
-- raw_user_meta_data — lo controla el cliente, y quien llame a la API de
-- Auth con data:{role:'admin'} se haría administrador (OWASP A01).
-- Todo registro nace como 'user'; el primer admin se asigna a mano
-- (ver seed.sql) y los demás los promueve un admin.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    'user',
    NEW.raw_user_meta_data ->> 'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── protect_profile_role ─────────────────────────────────────
-- Las policies RLS dejan que cada usuario actualice SU fila de profiles
-- (nombre, teléfono, avatar). Sin este trigger también podría hacer
-- UPDATE profiles SET role = 'admin' sobre sí mismo.
-- Solo un admin autenticado puede cambiar roles. Con auth.uid() NULL
-- (SQL Editor, service_role, migraciones) se permite: así se crea el
-- primer admin.
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND COALESCE(public.get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar roles'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_role ON public.profiles;
CREATE TRIGGER protect_profile_role
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_role();

-- ── audit_profile_role_change ────────────────────────────────
-- Deja rastro de cada cambio de rol en audit_logs.
CREATE OR REPLACE FUNCTION public.audit_profile_role_change()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      auth.uid(),
      'profile.role_change',
      'profile',
      NEW.id::text,
      jsonb_build_object('from', OLD.role, 'to', NEW.role)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_profile_role_change ON public.profiles;
CREATE TRIGGER audit_profile_role_change
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_profile_role_change();

-- ── set_updated_at ───────────────────────────────────────────
-- Genérico: manténlo en cada tabla con columna updated_at.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
