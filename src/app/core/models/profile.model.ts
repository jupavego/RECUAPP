// Para añadir roles: agrégalos aquí, en el enum SQL (supabase/migrations/001),
// en ROLE_ROUTES (auth.service.ts) y en la whitelist de handle_new_user().
export type UserRole = 'user' | 'admin';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  created_at: string;
}
