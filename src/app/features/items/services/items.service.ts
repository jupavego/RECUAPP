import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { SessionService } from '../../../core/services/session.service';
import { Item, ItemFormData } from '../models/item.model';

export interface ItemResult {
  success: boolean;
  data?: Item;
  error?: string;
}

// Todas las operaciones pasan por RLS: un usuario solo ve y modifica lo suyo,
// el admin ve todo. Aquí no se filtra por owner para "asegurar" nada: la
// seguridad vive en la base de datos, no en el cliente.
@Injectable({ providedIn: 'root' })
export class ItemsService {
  private supabase = inject(SupabaseService);
  private session  = inject(SessionService);

  async list(): Promise<Item[]> {
    const { data, error } = await this.supabase
      .from('items')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) { console.error('Error al listar items:', error.message); return []; }
    return data as Item[];
  }

  async create(form: ItemFormData): Promise<ItemResult> {
    const ownerId = this.session.user()?.id;
    if (!ownerId) return { success: false, error: 'No autenticado' };

    const { data, error } = await this.supabase
      .from('items')
      .insert({ ...form, owner_id: ownerId })
      .select()
      .single();

    if (error) return { success: false, error: 'No se pudo crear el registro' };
    return { success: true, data: data as Item };
  }

  async update(id: string, form: ItemFormData): Promise<ItemResult> {
    const { data, error } = await this.supabase
      .from('items')
      .update(form)
      .eq('id', id)
      .select()
      .single();

    if (error) return { success: false, error: 'No se pudo actualizar el registro' };
    return { success: true, data: data as Item };
  }

  async remove(id: string): Promise<boolean> {
    const { error } = await this.supabase.from('items').delete().eq('id', id);
    return !error;
  }
}
