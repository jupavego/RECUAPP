---
name: Reporte de vulnerabilidad de seguridad
about: Reportar una vulnerabilidad de forma responsable (Responsible Disclosure)
title: '[SECURITY] '
labels: security, needs-triage
assignees: ''
---

> **IMPORTANTE:** Si la vulnerabilidad es crítica (acceso a datos de usuarios, escalación de privilegios, exposición de credenciales), **NO uses este template público**. Envía un email directamente a la dirección de contacto en [SECURITY.md](../../SECURITY.md).

---

## Descripción de la vulnerabilidad

<!-- Describe el problema de seguridad de forma clara y concisa. -->

## Tipo de vulnerabilidad

- [ ] Broken Access Control (OWASP A01)
- [ ] Cryptographic Failure / Exposición de datos (OWASP A02)
- [ ] Injection (SQL, XSS, etc.) (OWASP A03)
- [ ] Security Misconfiguration (OWASP A05)
- [ ] Autenticación / Sesión (OWASP A07)
- [ ] Otro: ___________

## Pasos para reproducir

1. ...
2. ...
3. ...

## Impacto potencial

<!-- ¿Qué puede hacer un atacante si explota esta vulnerabilidad? -->

## Severidad estimada

- [ ] Crítica — explotación remota sin autenticación, impacto total
- [ ] Alta — explotación requiere autenticación o condiciones específicas, impacto alto
- [ ] Media — impacto limitado o explotación compleja
- [ ] Baja — impacto menor, difícil de explotar

## Entorno

- Navegador/cliente: 
- URL afectada (no incluir datos sensibles):
- Fecha de descubrimiento:

## Evidencia

<!-- Capturas de pantalla, logs, o PoC (proof of concept). Censurar cualquier dato de usuarios reales. -->

## Propuesta de mitigación (opcional)

<!-- Si tienes una sugerencia de cómo resolver el problema. -->

---

Gracias por contribuir a la seguridad de la plataforma. Nos comprometemos a responder en menos de 72 horas según nuestra política en [SECURITY.md](../../SECURITY.md).
