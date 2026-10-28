# Runbook de Respuesta a Incidentes de Seguridad

> **Versión:** 1.1 | **Última actualización:** 2026-04-26

---

## ⚡ Tarjeta de referencia rápida — leer primero si hay un incidente activo

```
1. CALMA — no borres logs ni evidencia todavía

2. CONTÉN antes de remediar:
   - Cuenta comprometida  → Supabase Dashboard → Authentication → Users → Ban user
   - API key expuesta     → Supabase Dashboard → Settings → API → Regenerate anon key
   - Secret expuesto      → Terminal:
       supabase secrets set NOMBRE=NUEVO_VALOR --project-ref <TU_PROJECT_REF>
   - Turnstile comprometido → Cloudflare Dashboard → Turnstile → Rotate secret key

3. DOCUMENTA mientras actúas:
   - Fecha y hora exacta de detección
   - Qué viste / qué alertó
   - Qué acciones tomaste y cuándo

4. NOTIFICA si hay datos personales afectados (Ley 1581):
   - Usuarios afectados: aviso por correo
   - SIC si es breach significativo: www.sic.gov.co

5. RESTAURA desde backup si hay corrupción de datos:
   - Supabase Dashboard → Database → Backups
   - O desde último dump manual guardado localmente

6. POST-MORTEM dentro de 5 días hábiles (template al final de este doc)
```

---
>
> Este documento define el proceso estándar para detectar, contener, remediar y documentar incidentes de seguridad en la plataforma "Comer en".

---

## Clasificación de Incidentes

| Nivel | Criterio | Ejemplo | Tiempo de respuesta |
|-------|----------|---------|---------------------|
| **P1 — Crítico** | Impacto en producción activo, datos comprometidos, sistema inaccesible | Compromiso de cuenta admin, dump de BD, defacement | < 1 hora |
| **P2 — Alto** | Vulnerabilidad confirmada y explotable, sin evidencia de explotación activa | Broken access control, PII expuesta, credenciales filtradas | < 4 horas |
| **P3 — Medio** | Vulnerabilidad identificada, baja probabilidad de explotación inmediata | Misconfiguration, weak password policy | < 24 horas |
| **P4 — Bajo** | Hallazgo de auditoría, mejora de hardening | Header faltante, log verboso | < 1 semana |

---

## Proceso Estándar de Respuesta

### Fase 1 — Detección

**Fuentes de detección:**
- Reporte de usuario o investigador externo (via SECURITY.md)
- Alerta del pipeline CI (Gitleaks, Semgrep, npm audit)
- Revisión de logs en Supabase Dashboard → Logs → Auth / API
- Comportamiento anómalo detectado manualmente

**Al detectar un incidente:**
1. No borrar logs ni evidencia
2. Documentar: fecha/hora, fuente de detección, descripción inicial
3. Clasificar severidad (tabla arriba)
4. Notificar al responsable técnico inmediatamente para P1/P2

---

### Fase 2 — Contención

**Para P1 (Crítico):**
- [ ] Deshabilitar cuenta comprometida en Supabase Dashboard → Authentication → Users
- [ ] Revocar sesiones activas si es posible (Supabase Auth → Sign out all users)
- [ ] Revocar API keys expuestas (Supabase Dashboard → Settings → API → Regenerar keys)
- [ ] Habilitar modo de mantenimiento si el impacto es sistémico
- [ ] Preservar logs antes de cualquier acción que los modifique

**Para P2 (Alto):**
- [ ] Evaluar si el vector de ataque está siendo explotado activamente
- [ ] Implementar mitigación temporal (deshabilitar feature, agregar check manual)
- [ ] Comunicar internamente la situación y el plan

**Para P3/P4:**
- [ ] Abrir issue interno con etiqueta `security`
- [ ] Asignar a la siguiente iteración de desarrollo

---

### Fase 3 — Análisis

**Herramientas de investigación:**

```bash
# Ver logs de autenticación en Supabase Dashboard:
# Dashboard → Logs → Auth Logs

# Buscar intentos de login fallidos:
# Filtrar por: "Invalid login credentials" o "Too many requests"

# Ver llamadas a RPC sospechosas:
# Dashboard → Logs → API Logs → filtrar por /rest/v1/rpc/

# Ver uploads recientes a Storage:
# Dashboard → Storage → [bucket] → ordenar por fecha
```

**Preguntas clave a responder:**
1. ¿Cuándo comenzó el incidente?
2. ¿Qué IPs/usuarios estuvieron involucrados?
3. ¿Qué datos fueron accedidos o modificados?
4. ¿Cuál fue el vector de entrada?
5. ¿Se propagó el acceso a otros recursos?

---

### Fase 4 — Remediación

1. Desarrollar el fix en rama `security/hotfix-[descripcion]`
2. Peer review del fix (al menos una persona adicional si es posible)
3. Escribir o actualizar la migración SQL correspondiente con comentario OWASP
4. Ejecutar la migración en Supabase SQL Editor
5. Deployar el fix al ambiente de producción
6. Verificar que el vector de ataque ya no es explotable
7. Monitorear logs por 24-48 horas post-fix

---

### Fase 5 — Notificación

**¿Cuándo notificar a usuarios afectados?**

Según la Ley 1581 de 2012 (Colombia — Protección de Datos Personales), se debe notificar a los titulares de datos cuando:
- Hay acceso no autorizado a datos personales
- Los datos pueden haber sido usados de forma indebida

**Contenido de la notificación:**
- Qué ocurrió (sin revelar detalles técnicos que expongan el sistema)
- Qué datos podrían estar afectados
- Qué acciones tomamos
- Qué deben hacer los usuarios (cambiar contraseña, etc.)
- Contacto para preguntas

---

### Fase 6 — Post-Mortem

Completar dentro de los 5 días hábiles posteriores al cierre del incidente.

**Template de Post-Mortem:**

```markdown
## Post-Mortem: [Nombre del Incidente]

**Fecha del incidente:** YYYY-MM-DD
**Severidad:** P1/P2/P3/P4
**Duración:** [tiempo entre detección y resolución]
**Autor del post-mortem:** [nombre]

### Resumen ejecutivo
[1-2 párrafos describiendo qué pasó y cómo se resolvió]

### Línea de tiempo
| Hora | Evento |
|------|--------|
| HH:MM | Detección del incidente |
| HH:MM | Contención inicial |
| HH:MM | Fix implementado |
| HH:MM | Verificación completada |

### Causa raíz
[Descripción técnica de qué causó el incidente]

### Impacto
- Usuarios afectados: [número o "desconocido"]
- Datos expuestos: [descripción o "ninguno"]
- Tiempo de inactividad: [si aplica]

### Acciones tomadas
[Lista de acciones durante el incidente]

### Acciones preventivas (evitar recurrencia)
| Acción | Responsable | Fecha límite |
|--------|-------------|--------------|
| | | |

### Lecciones aprendidas
[Qué funcionó bien, qué no, qué cambiaríamos]
```

---

## Contactos de Escalación

| Rol | Responsabilidad |
|-----|----------------|
| Desarrollador principal | Primera línea técnica |
| (Agregar contactos del equipo) | |

---

## Herramientas de Referencia

- **Supabase Dashboard:** https://supabase.com/dashboard
- **Supabase Auth Logs:** Dashboard → Logs → Auth
- **Supabase API Logs:** Dashboard → Logs → API
- **npm audit:** `npm audit --audit-level=high`
- **OWASP Incident Response:** https://owasp.org/www-project-incident-response/
