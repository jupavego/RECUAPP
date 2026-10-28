// Producción. Mismas claves que environment.ts pero del proyecto productivo.
export const environment = {
  production: true,
  supabaseUrl: 'https://udppzdmtxxipvfchpksl.supabase.co',
  supabaseAnonKey: 'sb_publishable_UQFcAbMVh6PZobTsqKn-Vg_8O6bXQjV',
  sentryDsn: '',          // DSN de Sentry (opcional)
  turnstileSiteKey: '',   // site key de Cloudflare Turnstile (recomendado en producción)
};
