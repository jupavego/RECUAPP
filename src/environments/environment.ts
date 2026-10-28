// Desarrollo. Completa con las claves de TU proyecto de Supabase
// (Dashboard → Project Settings → API). La anon key es pública por diseño:
// la seguridad real la dan las políticas RLS, nunca la ocultan las claves.
// NUNCA pongas aquí la service_role key.
export const environment = {
  production: false,
  supabaseUrl: 'https://udppzdmtxxipvfchpksl.supabase.co',
  supabaseAnonKey: 'sb_publishable_UQFcAbMVh6PZobTsqKn-Vg_8O6bXQjV',
  sentryDsn: '',          // vacío en desarrollo — Sentry solo activo en producción
  turnstileSiteKey: '',   // clave pública de Cloudflare Turnstile (vacío = sin captcha)
  googleMapsApiKey: 'AIzaSyDbJTm65fipASI_Q93Y_qo3DGIqKhbIoco',   // Maps JavaScript API (clave de Comeren) — restringida a localhost:* en Google Cloud Console
};
