import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';

export interface RegisterData {
  email: string;
  password: string;
  fullName: string;
}

export interface AuthResult {
  success: boolean;
  error?: string;
}

// Fuente única de verdad para rutas por rol.
// Guards y componentes la consumen via getRouteForRole()
// para no duplicar esta tabla en múltiples archivos.
const ROLE_ROUTES: Record<string, string> = {
  admin:    '/admin/dashboard',
  user:     '/app',
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private supabase = inject(SupabaseService);
  private router   = inject(Router);

  // F2.4 | SEC-011 | OWASP A02: Cryptographic Failures — Information Disclosure
  // Mapeo centralizado de errores de Supabase Auth a mensajes genéricos.
  // Ningún componente debe recibir ni mostrar error.message crudo del backend.
  private mapAuthError(message: string): string {
    if (message.includes('Invalid login credentials'))    return 'Correo o contraseña incorrectos';
    if (message.includes('Email not confirmed'))          return 'Debes confirmar tu correo antes de ingresar';
    if (message.includes('Too many requests'))            return 'Demasiados intentos. Espera unos minutos';
    if (message.includes('already registered'))           return 'Este correo ya está registrado';
    if (message.includes('Password should be'))           return 'La contraseña debe tener al menos 8 caracteres';
    if (message.includes('User not found'))               return 'No existe una cuenta con ese correo';
    if (message.includes('Auth session missing'))         return 'La sesión expiró. Solicita un nuevo enlace';
    if (message.includes('Token has expired'))            return 'El enlace expiró. Solicita uno nuevo';
    if (message.includes('New password should be'))       return 'La contraseña debe tener al menos 8 caracteres';
    if (message.includes('same password'))                return 'La nueva contraseña debe ser diferente a la actual';
    if (message.includes('Unable to validate'))           return 'No fue posible verificar tu identidad. Intenta de nuevo';
    if (message.includes('Email rate limit'))             return 'Demasiadas solicitudes de correo. Espera unos minutos';
    return 'Ocurrió un error inesperado. Intenta de nuevo';
  }

  async register(data: RegisterData): Promise<AuthResult> {
    const { error } = await this.supabase.auth.signUp({
      email:    data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.fullName,
        },
      },
    });

    if (error) return { success: false, error: this.mapAuthError(error.message) };
    return { success: true };
  }

  async loginWithGoogle(): Promise<void> {
    await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/',
      },
    });
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return { success: false, error: this.mapAuthError(error.message) };
    return { success: true };
  }

  async logout(): Promise<void> {
    try {
      await this.supabase.auth.signOut();
    } catch {
      // Ignorar errores del signOut — el token puede ya estar inválido.
      // El reload limpia el estado de todas formas.
    } finally {
      // Reload completo: limpia el estado Angular en memoria,
      // el lock de Supabase y cualquier subscripción activa.
      window.location.href = '/';
    }
  }

  async recoverPassword(email: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (error) return { success: false, error: this.mapAuthError(error.message) };
    return { success: true };
  }

  async resetPassword(newPassword: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) return { success: false, error: this.mapAuthError(error.message) };
    return { success: true };
  }

  async updateEmail(newEmail: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.updateUser({
      email: newEmail,
    });

    if (error) return { success: false, error: this.mapAuthError(error.message) };
    return { success: true };
  }

  // Redirige al panel correcto según el rol
  redirectByRole(role: string): void {
    this.router.navigate([ROLE_ROUTES[role] ?? '/']);
  }

  // Expuesto para que guards lo usen sin duplicar la tabla
  getRouteForRole(role: string): string {
    return ROLE_ROUTES[role] ?? '/';
  }
}