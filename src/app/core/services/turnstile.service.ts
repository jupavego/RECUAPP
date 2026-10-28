import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface TurnstileResult {
  success: boolean;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class TurnstileService {
  private supabase = inject(SupabaseService);

  async verify(token: string): Promise<TurnstileResult> {
    try {
      const { data, error } = await this.supabase.client.functions.invoke('verify-turnstile', {
        body: { token },
      });

      if (error || !data?.success) {
        return { success: false, error: 'Verificación de seguridad fallida. Intenta de nuevo.' };
      }

      return { success: true };
    } catch {
      return { success: false, error: 'Error de conexión al verificar. Intenta de nuevo.' };
    }
  }
}
