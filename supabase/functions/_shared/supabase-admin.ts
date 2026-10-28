// Cliente de Supabase con service role — usado por send-upgrade-request
// y send-expiry-warning para operaciones que requieren privilegios
// (auth.admin.getUserById, RPCs restringidas a service_role).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function createAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}
