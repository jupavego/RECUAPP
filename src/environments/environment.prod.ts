// Producción. Mismas claves que environment.ts pero del proyecto productivo.
export const environment = {
  production: true,
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU_ANON_KEY',
  sentryDsn: '',          // DSN de Sentry (opcional)
  turnstileSiteKey: '',   // site key de Cloudflare Turnstile (recomendado en producción)
};
