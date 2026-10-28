import { Component, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { SessionService } from '../../../../core/services/session.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class ResetPasswordComponent implements OnInit {
  private fb      = inject(FormBuilder);
  private auth    = inject(AuthService);
  private session = inject(SessionService);
  private router  = inject(Router);

  loading      = signal(false);
  sessionReady = signal(false);   // true cuando Supabase procesó el token
  errorMessage = signal<string | null>(null);
  success      = signal(false);
  showPassword = signal(false);

  form = this.fb.group(
    {
      password:        ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: this.passwordMatch }
  );

  get password()        { return this.form.controls.password; }
  get confirmPassword() { return this.form.controls.confirmPassword; }

  private passwordMatch(control: AbstractControl): ValidationErrors | null {
    const pw  = control.get('password')?.value;
    const cpw = control.get('confirmPassword')?.value;
    return pw && cpw && pw !== cpw ? { passwordMismatch: true } : null;
  }

  async ngOnInit(): Promise<void> {
    // Supabase procesa el token del hash de la URL automáticamente
    // porque tenemos detectSessionInUrl: true en supabase.service.ts.
    // Pero necesitamos esperar a que SessionService termine de inicializar
    // la sesión antes de permitir el submit — de lo contrario updateUser
    // falla con "Auth session missing".
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (this.session.initialized()) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
      // Timeout de 8s — el token puede tardar un poco en procesarse
      setTimeout(() => { clearInterval(interval); resolve(); }, 8000);
    });

    // Verificar que la sesión sea de tipo recovery
    if (!this.session.isLoggedIn()) {
      // El token expiró o es inválido — redirigir a recuperar contraseña
      this.errorMessage.set('El link expiró o ya fue usado. Solicitá uno nuevo.');
      return;
    }

    this.sessionReady.set(true);
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const result = await this.auth.resetPassword(this.password.value!);

    this.loading.set(false);

    if (!result.success) {
      this.errorMessage.set(result.error ?? 'Error al restablecer la contraseña');
      return;
    }

    this.success.set(true);
    // Cerrar sesión después de cambiar la contraseña para forzar
    // un login fresco con las nuevas credenciales.
    // auth.logout() hace signOut + window.location.href = '/'
    // lo que limpia el estado en memoria y redirige al home.
    setTimeout(() => this.auth.logout(), 3000);
  }

  togglePassword(): void {
    this.showPassword.update(v => !v);
  }
}