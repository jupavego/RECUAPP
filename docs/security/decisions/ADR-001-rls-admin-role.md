# ADR-001: Whitelist de roles en trigger de registro de usuarios

**Estado:** Aceptado
**Fecha:** 2026-04-26
**Autor:** Equipo de desarrollo
**Referencia:** SEC-001 | OWASP A01: Broken Access Control

---

## Contexto

La función `handle_new_user()` es un trigger PostgreSQL que se ejecuta automáticamente cada vez que un nuevo usuario se registra en la plataforma via Supabase Auth.

El trigger insertaba el perfil del nuevo usuario en `public.profiles`, tomando el valor del campo `role` directamente desde `raw_user_meta_data` (datos enviados por el cliente durante el registro):

```sql
-- Implementación original (vulnerable):
COALESCE(
  (NEW.raw_user_meta_data ->> 'role')::user_role,
  'client'
)
```

### El problema

La implementación original confiaba ciegamente en el valor de `role` enviado por el cliente. Aunque el formulario de registro en Angular solo mostraba los roles autoasignables, cualquier atacante podía realizar una llamada directa a la API de Supabase Auth con un rol arbitrario:

```bash
curl -X POST 'https://[proyecto].supabase.co/auth/v1/signup' \
  -H 'apikey: [anon-key]' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "attacker@evil.com",
    "password": "Test1234!",
    "data": { "role": "admin" }
  }'
```

Esto resultaba en la creación de una cuenta con `role = 'admin'` en `public.profiles`, otorgando acceso completo al panel de administración sin ninguna validación adicional.

**Clasificación OWASP:** A01:2021 — Broken Access Control
**Criticidad:** Alta

---

## Decisión

Implementar un whitelist explícito en el trigger que solo permita los roles autoasignables desde `raw_user_meta_data`. Cualquier otro valor (incluyendo `admin`) resulta en la asignación del rol por defecto `client`.

El rol `admin` solo puede ser asignado por:
1. Un administrador existente via el Supabase Dashboard
2. Un UPDATE directo via `service_role` key (backend privilegiado)

---

## Implementación

```sql
-- Migración: 002_functions_triggers.sql (handle_new_user)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    CASE
      WHEN NEW.raw_user_meta_data ->> 'role' (solo valores permitidos)
      THEN (NEW.raw_user_meta_data ->> 'role')::user_role
      ELSE 'client'  -- 'admin' nunca puede ser auto-asignado
    END,
    NEW.raw_user_meta_data ->> 'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
```

---

## Alternativas Consideradas

### Alternativa 1: Ignorar completamente el campo `role` en el signup

Siempre asignar `client` como rol por defecto, sin importar lo que envíe el cliente. Los usuarios `business` serían asignados manualmente por un admin después del registro.

**Rechazada porque:** El flujo actual de UX (seleccionar tipo de cuenta en registro) es importante para la experiencia del usuario y para el onboarding del negocio. Romper este flujo impacta negativamente la adopción.

### Alternativa 2: Mover la lógica de selección de rol a una Edge Function

Usar una Supabase Edge Function como intermediario que valide el rol antes de llamar a `auth.signUp`.

**Rechazada porque:** Agrega complejidad innecesaria. El trigger es el lugar correcto para esta validación ya que es la última línea de defensa antes de escribir en la base de datos, independientemente de cómo el cliente llame a la API.

### Alternativa 3 (elegida): Whitelist en el trigger

Simple, directo, y agnóstico al cliente. Funciona para cualquier método de registro (frontend, API directa, scripts de migración).

---

## Consecuencias

**Positivas:**
- Elimina completamente el vector de escalación de privilegios via registro
- La implementación es simple y fácil de auditar
- No rompe el flujo existente de registro de usuarios los roles autoasignables

**Negativas / Trade-offs:**
- Si se agrega un nuevo rol en el futuro, el whitelist debe actualizarse explícitamente (preferible — evita que nuevos roles sean auto-asignables por error)

---

## Verificación

Para confirmar que el fix funciona:

```bash
# Intentar registrar un usuario con role: 'admin' via API directa:
curl -X POST 'https://[proyecto].supabase.co/auth/v1/signup' \
  -H 'apikey: [anon-key]' \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@test.com","password":"Test12345!","data":{"role":"admin"}}'

# Verificar en la BD que el rol creado es 'client', no 'admin':
SELECT id, role FROM public.profiles WHERE id = '[uuid del usuario creado]';
-- Resultado esperado: role = 'client'
```

---

## Referencias

- [OWASP A01:2021 — Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/)
- [Supabase Auth — User Metadata](https://supabase.com/docs/guides/auth/managing-user-data)
- [PostgreSQL SECURITY DEFINER](https://www.postgresql.org/docs/current/sql-createfunction.html)


---

## Actualización en el lienzo base

(Este ADR conserva los nombres del proyecto de origen, donde los roles eran `client`, `business` y `admin`; el lienzo usa `user` y `admin`.)

La plantilla va un paso más allá: `handle_new_user()` **ignora por completo** el rol enviado por el cliente y siempre crea el perfil como `user`. Además, el trigger `protect_profile_role` impide que un usuario se auto-promueva con `UPDATE profiles SET role = ...` (las policies RLS permiten editar la propia fila, por lo que sin el trigger esa vía seguía abierta).
