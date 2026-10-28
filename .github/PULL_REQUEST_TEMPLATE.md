## Descripción

<!-- Describe los cambios que introduce este PR y el problema que resuelve. -->

Fixes # (issue)

## Tipo de cambio

- [ ] Bug fix (cambio no disruptivo que resuelve un problema)
- [ ] Nueva feature (cambio no disruptivo que agrega funcionalidad)
- [ ] Breaking change (fix o feature que causaría que funcionalidad existente no funcione como se espera)
- [ ] Security fix (cierra una vulnerabilidad identificada)
- [ ] Refactor (cambio de código que no modifica comportamiento externo)
- [ ] Documentación

---

## Security Checklist

> Obligatorio para PRs que toquen autenticación, base de datos, APIs, o datos de usuarios.

### Código
- [ ] No hay secrets, API keys, o credenciales hardcodeadas en el código
- [ ] Los inputs de usuario están sanitizados antes de usarse en queries o templates
- [ ] El manejo de errores no expone información interna del sistema (stack traces, nombres de tablas, etc.)
- [ ] Los permisos de acceso a recursos son validados server-side (no solo en el cliente)
- [ ] Los archivos subidos por usuarios son validados (extensión, MIME type, tamaño)

### Base de datos (si aplica)
- [ ] Las nuevas tablas tienen RLS habilitado (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)
- [ ] Las políticas RLS siguen el patrón `get_my_role()` para verificar permisos
- [ ] Las funciones `SECURITY DEFINER` incluyen guard de rol al inicio
- [ ] No se aceptan roles privilegiados (`admin`) desde input de usuario

### Autenticación (si aplica)
- [ ] Los cambios de rol pasan por el trigger `handle_profile_role_change`
- [ ] Las rutas protegidas tienen `authGuard` + `roleGuard` configurados
- [ ] Los redirects de OAuth están en la allowlist del Supabase Dashboard

### OWASP Top 10 verificado
- [ ] A01 Broken Access Control — controles de acceso correctos
- [ ] A02 Cryptographic Failures — no se expone PII sin autorización
- [ ] A03 Injection — inputs sanitizados, no concatenación directa en queries
- [ ] A05 Security Misconfiguration — sin configuraciones por defecto inseguras
- [ ] A06 Vulnerable Components — `npm audit` limpio

---

## Cómo probar

<!-- Pasos para verificar que el cambio funciona correctamente. -->

1. ...
2. ...

## Capturas de pantalla (si aplica)

<!-- Agregar imágenes o GIFs de los cambios visuales. -->

---

> Para reportar una vulnerabilidad de seguridad de forma responsable, ver [SECURITY.md](../SECURITY.md).
