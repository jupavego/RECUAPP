import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../../app/core/services/supabase.service';
import { SessionService } from '../../../../app/core/services/session.service';
import { StorageService } from '../../../../app/core/services/storage.service';
import { Profile } from '../../../../app/core/models/profile.model';

export interface ProfileFormData {
  full_name: string;
  phone: string;
}

export interface ProfileResult {
  success: boolean;
  data?: Profile;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private supabase = inject(SupabaseService);
  private session  = inject(SessionService);
  private storage  = inject(StorageService);

  async update(formData: ProfileFormData): Promise<ProfileResult> {
    const userId = this.session.user()?.id;
    if (!userId) return { success: false, error: 'No autenticado' };

    const { data, error } = await this.supabase
      .from('profiles')
      .update(formData)
      .eq('id', userId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    this.session.updateProfileLocally(formData);
    return { success: true, data: data as Profile };
  }

  async updateAvatar(file: File): Promise<ProfileResult> {
    const userId = this.session.user()?.id;
    if (!userId) return { success: false, error: 'No autenticado' };

    // Subir imagen al storage
    const upload = await this.storage.uploadImage('avatars', file, 'avatar.jpg');
    if (!upload.success || !upload.url) {
      return { success: false, error: upload.error ?? 'Error al subir la imagen' };
    }

    // Guardar URL en la tabla profiles
    const { data, error } = await this.supabase
      .from('profiles')
      .update({ avatar_url: upload.url })
      .eq('id', userId)
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    // Actualizar estado local con la URL limpia (sin cache-buster)
    // El componente agrega el cache-buster para el display
    this.session.updateProfileLocally({ avatar_url: upload.url });

    return { success: true, data: data as Profile };
  }
}