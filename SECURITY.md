# Política de Seguridad — Comer en

## Versiones Soportadas

| Versión | Soporte de seguridad |
| ------- | -------------------- |
| Latest (`main`) | ✅ Activa |
| Ramas `security/**` | ✅ En revisión |
| Versiones anteriores | ❌ Sin soporte |

## Reporte de Vulnerabilidades (Responsible Disclosure)

**No publiques vulnerabilidades de seguridad como issues públicos de GitHub.**

Si descubres una vulnerabilidad de seguridad, por favor:

1. **Envía un reporte privado** usando [GitHub Private Security Advisories](https://github.com/tu-org/tu-repo/security/advisories/new) o envía un email al equipo de seguridad.
2. **Incluye en tu reporte:**
   - Descripción detallada de la vulnerabilidad
   - Pasos para reproducir el problema
   - Impacto potencial estimado
   - Versión o commit afectado
   - (Opcional) Sugerencia de mitigación

## Compromisos de Respuesta (SLA)

| Severidad | Acuse de recibo | Evaluación inicial | Resolución objetivo |
|-----------|----------------|-------------------|-------------------|
| Crítica | < 24 horas | < 48 horas | < 7 días |
| Alta | < 48 horas | < 5 días | < 30 días |
| Media | < 72 horas | < 10 días | < 60 días |
| Baja | < 1 semana | < 30 días | Próxima release |

## Alcance

Las siguientes superficies están **dentro del alcance** de reportes de seguridad:

- Aplicación web (`comer.en` / dominio de producción)
- API de Supabase y políticas RLS
- Flujos de autenticación (login, registro, OAuth)
- Panel de administración
- Formularios y carga de archivos

Las siguientes superficies están **fuera del alcance**:

- Infraestructura de Supabase (reportar directamente a [Supabase Security](https://supabase.com/docs/support))
- Servicios de terceros (Google OAuth, Cloudflare)
- Ataques de tipo DoS/DDoS
- Ingeniería social

## Safe Harbor

Nos comprometemos a no emprender acciones legales contra investigadores de seguridad que:

- Actúen de buena fe y sigan este proceso de divulgación responsable
- No accedan ni modifiquen datos de usuarios sin autorización
- No interrumpan o degraden el servicio
- Reporten la vulnerabilidad antes de hacerla pública

## Stack Tecnológico (para contexto de reportes)

- **Frontend:** Angular 19 (SPA)
- **Backend:** Supabase (PostgreSQL + Auth + Storage)
- **Autenticación:** Supabase Auth (JWT + Google OAuth)
- **Hosting:** [Hosting provider]

## Historial de Advisories

Esta plantilla ya incluye las mitigaciones aprendidas en el proyecto de origen (ver `docs/security/architecture.md`):

- Escalación de privilegios vía registro (whitelist de rol en `handle_new_user`)
- Escalación de privilegios vía `UPDATE profiles SET role` (trigger `protect_profile_role`)
- RPC `SECURITY DEFINER` solo con role guard y `search_path` fijo
- Límites de tamaño y MIME en buckets de Storage
- Rate limiting y audit log a nivel de base de datos

Registra aquí los advisories propios de tu proyecto (ID, severidad, estado, fecha).

## Recursos

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Supabase Security](https://supabase.com/docs/guides/platform/security)
- [Angular Security Guide](https://angular.dev/best-practices/security)
