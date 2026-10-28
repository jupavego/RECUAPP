import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Profile, UserRole } from '../../../core/models/profile.model';

export interface AdminStats {
  totalUsers: number;
  totalAdmins: number;
  totalItems: number;
}

const EMPTY_STATS: AdminStats = { totalUsers: 0, totalAdmins: 0, totalItems: 0 };

@Injectable({ providedIn: 'root' })
export class AdminService {
  private supabase = inject(SupabaseService);

  // get_admin_stats() hace los conteos en PostgreSQL (una sola round-trip)
  // y rechaza a quien no sea admin (ver 005_security.sql).
  async getStats(): Promise<AdminStats> {
    const { data, error } = await this.supabase.rpc('get_admin_stats');
    if (error) {
      console.error('Error fetching stats:', error.message);
      return EMPTY_STATS;
    }
    return data as AdminStats;
  }

  async getUsers(role?: UserRole): Promise<Profile[]> {
    let query = this.supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (role) query = query.eq('role', role);

    const { data, error } = await query;
    if (error) { console.error(error.message); return []; }
    return data as Profile[];
  }

  // La base de datos solo permite cambiar el rol si quien llama es admin
  // (trigger protect_profile_role). Este update desde el cliente no basta
  // por sí solo para escalar privilegios.
  async updateUserRole(userId: string, role: UserRole): Promise<boolean> {
    const { error } = await this.supabase
      .from('profiles')
      .update({ role })
      .eq('id', userId);
    return !error;
  }
}
