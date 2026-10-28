import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { SessionService } from './session.service';

export type StorageBucket = 'avatars' | 'uploads';

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

// Tope de entrada — generoso, para no rechazar fotos reales de celular
// antes de poder comprimirlas. La defensa real de tamaño va después.
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

// Red de seguridad tras comprimir — a calidad 80% y 1600px de lado
// más largo, una foto normal cae muy por debajo de esto.
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const MAX_DIMENSION = 1600; // px, lado más largo
const WEBP_QUALITY   = 0.8;

@Injectable({ providedIn: 'root' })
export class StorageService {
  private supabase = inject(SupabaseService);
  private session  = inject(SessionService);

  // SEC-009 | OWASP A05: Security Misconfiguration
  // Valida extensión y MIME type. El tamaño de entrada es solo un
  // tope amplio — la validación real de peso ocurre tras comprimir.
  private validateImageFile(file: File): string | null {
    const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Formato no permitido. Usa: ${ALLOWED_EXTENSIONS.join(', ')}`;
    }
    if (!file.type.startsWith('image/')) {
      return 'El archivo no es una imagen válida';
    }
    if (file.size > MAX_INPUT_BYTES) {
      return 'El archivo supera el tamaño máximo de 20 MB';
    }
    return null;
  }

  // Redimensiona al lado más largo (MAX_DIMENSION) y recodifica a WebP
  // calidad 80% — sin pérdida perceptible a simple vista, pero el peso
  // real baja drásticamente (una foto de 25 MB queda en ~150-400 KB).
  // Si el canvas falla por cualquier razón, sube el archivo original
  // tal cual en vez de bloquear la subida.
  private async compressImage(file: File): Promise<File> {
    try {
      const bitmap = await createImageBitmap(file);

      let { width, height } = bitmap;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height);
        width  = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY)
      );
      if (!blob) return file;

      const baseName = file.name.replace(/\.[^.]+$/, '');
      return new File([blob], `${baseName}.webp`, { type: 'image/webp' });
    } catch {
      return file;
    }
  }

  async uploadImage(
    bucket: StorageBucket,
    file: File,
    fileName?: string
  ): Promise<UploadResult> {
    const userId = this.session.user()?.id;
    if (!userId) return { success: false, error: 'No autenticado' };

    const validationError = this.validateImageFile(file);
    if (validationError) return { success: false, error: validationError };

    const compressed = await this.compressImage(file);
    if (compressed.size > MAX_OUTPUT_BYTES) {
      return { success: false, error: 'La imagen sigue siendo muy pesada después de comprimir' };
    }

    // El nombre pedido por el caller puede traer otra extensión
    // (ej. "logo.jpg") — siempre se sube como .webp, que es lo que
    // realmente se comprimió.
    const outExt   = compressed.name.split('.').pop();
    const baseName = fileName
      ? fileName.replace(/\.[^.]+$/, '')
      : `${Date.now()}`;
    const name     = `${baseName}.${outExt}`;
    const path     = `${userId}/${name}`;

    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(path, compressed, {
        contentType: compressed.type,
        upsert: true,
      });

    if (error) return { success: false, error: error.message };

    // Limpia versiones viejas del mismo nombre base con otra extensión
    // (ej. logo.jpg de antes de que empezáramos a subir en WebP) — si
    // no existen, remove() simplemente no encuentra nada y no falla.
    // No bloquea la respuesta al usuario: la subida ya fue exitosa.
    const staleExtensions = ['jpg', 'jpeg', 'png', 'webp'].filter(e => e !== outExt);
    void this.supabase.storage
      .from(bucket)
      .remove(staleExtensions.map(e => `${userId}/${baseName}.${e}`));

    // Agregar cache-buster a la URL pública para que todos los componentes
    // que lean esta URL desde Supabase obtengan siempre la imagen más reciente
    const baseUrl = this.getPublicUrl(bucket, path);
    const url = `${baseUrl}?t=${Date.now()}`;
    return { success: true, url };
  }

  getPublicUrl(bucket: StorageBucket, path: string): string {
    const { data } = this.supabase.storage
      .from(bucket)
      .getPublicUrl(path);
    return data.publicUrl;
  }

  async deleteImage(bucket: StorageBucket, path: string): Promise<void> {
    await this.supabase.storage.from(bucket).remove([path]);
  }

  // Extrae el path relativo desde una URL pública de Supabase
  extractPath(url: string, bucket: StorageBucket): string {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const idx    = url.indexOf(marker);
    return idx !== -1 ? url.substring(idx + marker.length) : url;
  }
}
