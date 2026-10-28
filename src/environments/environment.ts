// Desarrollo. Completa con las claves de TU proyecto de Supabase
// (Dashboard → Project Settings → API). La anon key es pública por diseño:
// la seguridad real la dan las políticas RLS, nunca la ocultan las claves.
// NUNCA pongas aquí la service_role key.
export const environment = {
  production: false,
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU_ANON_KEY',
  sentryDsn: '',          // vacío en desarrollo — Sentry solo activo en producción
  turnstileSiteKey: '',   // clave pública de Cloudflare Turnstile (vacío = sin captcha)
};
