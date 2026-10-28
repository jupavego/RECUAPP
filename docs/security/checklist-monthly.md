# Checklist Operativo Mensual de Seguridad

> Ejecutar el primer lunes de cada mes. Documentar resultados en la tabla de historial al final.
>
> **Responsable:** Desarrollador principal
> **Tiempo estimado:** 45-60 minutos

---

## 1. Dependencias y Vulnerabilidades (15 min)

```bash
# Ejecutar desde la raíz del proyecto:
npm audit --audit-level=moderate
```

- [ ] **npm audit** — sin vulnerabilidades HIGH o CRITICAL
- [ ] Revisar dependencias con actualizaciones de seguridad pendientes
- [ ] Actualizar dependencias con CVEs conocidos (PR separado con tests)

**Herramientas adicionales:**
- [Snyk](https://snyk.io) — escaneo de dependencias con más contexto
- [Socket.dev](https://socket.dev) — detección de supply chain attacks

---

## 2. Revisión de Accesos (10 min)

**Supabase Dashboard → Authentication → Users:**

- [ ] Revisar lista de usuarios con rol `admin` — ¿todos son legítimos?
- [ ] Verificar que no hay cuentas `admin` creadas fuera del proceso establecido
- [ ] Confirmar que el MFA está activo en la cuenta de admin principal

**Supabase Dashboard → Settings → API:**

- [ ] Confirmar que las API keys no han sido expuestas (buscar en GitHub con `site:github.com [project-ref]`)
- [ ] Verificar que el `service_role` key nunca está en código fuente

---

## 3. Revisión de Logs de Autenticación (10 min)

**Supabase Dashboard → Logs → Auth:**

- [ ] Revisar intentos de login fallidos en volumen inusual (posible brute force)
- [ ] Verificar IPs de acceso admin — ¿son consistentes con el equipo?
- [ ] Buscar patrones: muchos registros desde la misma IP, emails similares (spam bots)
- [ ] Revisar errores de OAuth (Google) — ¿hay intentos de redirect manipulation?

---

## 4. Revisión de Datos (5 min)

**Supabase Dashboard → Table Editor → audit_logs:**

- [ ] Revisar cambios de rol (`profile.role_change`): ¿todos fueron autorizados?
- [ ] Revisar volumen anormal de registros en tus tablas (posible flooding o bots)

---

## 5. Security Headers y Configuración de Hosting (5 min)

- [ ] Verificar score en [securityheaders.com](https://securityheaders.com) para el dominio de producción — objetivo: **A o superior**
- [ ] Confirmar que HTTPS está forzado (redirect de HTTP a HTTPS)
- [ ] Verificar que el certificado TLS no está próximo a vencer

---

## 6. Pipeline de CI/CD (5 min)

- [ ] Revisar el último run de GitHub Actions — ¿todos los jobs pasaron?
- [ ] Verificar que no hay PRs mergeados que hayan omitido el pipeline de seguridad
- [ ] Confirmar que los secrets de GitHub Actions (`SEMGREP_APP_TOKEN`, etc.) están configurados

---

## 7. Revisión de Código Reciente (10 min)

Revisar los commits del último mes en busca de:

- [ ] Strings que parecen API keys, passwords, o tokens hardcodeados
- [ ] Nuevos endpoints de RPC o Edge Functions sin validación de rol
- [ ] Nuevas tablas sin RLS habilitado
- [ ] Políticas RLS que usan `WITH CHECK (true)` sin restricciones adicionales
- [ ] Inputs de usuario interpolados directamente en queries

---

## KPIs de Seguridad

| Métrica | Objetivo | Mes actual |
|---------|----------|------------|
| Vulnerabilidades críticas abiertas | 0 | |
| Vulnerabilidades altas abiertas | 0 | |
| npm audit clean | ✅ | |
| MFA admin activo | ✅ | |
| Security headers score | A+ | |
| CI pipeline passing | ✅ | |
| Días desde último pentest/revisión | < 365 | |
| Incidentes en el mes | 0 objetivo | |

---

## Historial de Ejecuciones

| Mes | Ejecutado por | KPI Score | Hallazgos | Acciones tomadas |
|-----|---------------|-----------|-----------|------------------|
| 2026-04 | | | Baseline — Phase 1 implementada | Ver commits `security/phase-1` |
| | | | | |

---

## Recursos

- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [Supabase Security Checklist](https://supabase.com/docs/guides/platform/security)
- [Angular Security Best Practices](https://angular.dev/best-practices/security)
- [Have I Been Pwned](https://haveibeenpwned.com) — verificar emails del equipo en brechas conocidas
