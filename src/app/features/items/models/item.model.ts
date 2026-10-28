// Entidad de ejemplo del CRUD. Para tu app real: renómbrala (p. ej. Product, Task)
// y ajusta campos aquí, en supabase/migrations/006_items_example.sql y en el formulario.
export interface Item {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ItemFormData {
  title: string;
  description: string;
  active: boolean;
}
