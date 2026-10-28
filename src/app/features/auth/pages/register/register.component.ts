import { Component, ViewEncapsulation, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { TurnstileService } from '../../../../core/services/turnstile.service';
import { TurnstileComponent } from '../../../../shared/components/turnstile/turnstile.component';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule, TurnstileComponent],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class RegisterComponent {
  private fb         = inject(FormBuilder);
  private auth       = inject(AuthService);
  private turnstile  = inject(TurnstileService);

  loading           = signal(false);
  errorMessage      = signal<string | null>(null);
  success           = signal(false);
  showPassword      = signal(false);
  turnstileToken    = signal<string | null>(null);
  readonly useTurnstile = environment.production && !!environment.turnstileSiteKey;

  form = this.fb.group(
    {
      fullName:        ['', [Validators.required, Validators.minLength(3)]],
      email:           ['', [Validators.required, Validators.email]],
      password:        ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: this.passwordMatch }
  );

  get fullName()        { return this.form.controls.fullName; }
  get email()           { return this.form.controls.email; }
  get password()        { return this.form.controls.password; }
  get confirmPassword() { return this.form.controls.confirmPassword; }

  private passwordMatch(control: AbstractControl): ValidationErrors | null {
    const pw  = control.get('password')?.value;
    const cpw = control.get('confirmPassword')?.value;
    return pw && cpw && pw !== cpw ? { passwordMismatch: true } : null;
  }

  onTurnstileResolved(token: string): void {
    this.turnstileToken.set(token);
  }

  onTurnstileError(): void {
    this.turnstileToken.set(null);
    this.errorMessage.set('Error en la verificación de seguridad. Recarga la página.');
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // En producción exigir token de Turnstile antes de llamar a Supabase
    if (this.useTurnstile) {
      const token = this.turnstileToken();
      if (!token) {
        this.errorMessage.set('Completa la verificación de seguridad para continuar.');
        return;
      }

      this.loading.set(true);
      this.errorMessage.set(null);

      const check = await this.turnstile.verify(token);
      if (!check.success) {
        this.errorMessage.set(check.error ?? 'Verificación fallida. Intenta de nuevo.');
        this.loading.set(false);
        this.turnstileToken.set(null);
        return;
      }
    } else {
      this.loading.set(true);
      this.errorMessage.set(null);
    }

    const result = await this.auth.register({
      email:    this.email.value!,
      password: this.password.value!,
      fullName: this.fullName.value!,
    });

    this.loading.set(false);

    if (!result.success) {
      this.errorMessage.set(result.error ?? 'Error al registrarse');
      this.turnstileToken.set(null);
      return;
    }

    this.success.set(true);
  }

  async loginWithGoogle(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    await this.auth.loginWithGoogle();
  }

  togglePassword(): void {
    this.showPassword.update(v => !v);
  }
}
