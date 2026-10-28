import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(
      environment.supabaseUrl,
      environment.supabaseAnonKey,
      {
        auth: {
          // Desactiva el lock de navegador que causa el error
          // "lock was released because another request stole it"
          // LockFunc recibe (name, acquireTimeout, fn) => fn()
          lock: (_name, _acquireTimeout, fn) => fn(),
          persistSession:     true,
          detectSessionInUrl: true,
        },
      }
    );
  }

  from(table: string) {
    return this.client.from(table);
  }

  get auth() {
    return this.client.auth;
  }

  get storage() {
    return this.client.storage;
  }

  get functions() {
    return this.client.functions;
  }

  rpc(fn: string, params?: Record<string, unknown>) {
    return this.client.rpc(fn, params);
  }
}