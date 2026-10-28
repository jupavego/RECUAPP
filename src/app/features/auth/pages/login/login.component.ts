import { Component, ViewEncapsulation, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { SessionService } from '../../../../core/services/session.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class LoginComponent {
  private fb      = inject(FormBuilder);
  private auth    = inject(AuthService);
  private session = inject(SessionService);

  loading      = signal(false);
  errorMessage = signal<string | null>(null);
  showPassword = signal(false);

  form = this.fb.group({
    email:    ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  get email()    { return this.form.controls.email; }
  get password() { return this.form.controls.password; }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const result = await this.auth.login(
      this.email.value!,
      this.password.value!
    );

    if (!result.success) {
      this.errorMessage.set(result.error ?? 'Error al iniciar sesión');
      this.loading.set(false);
      return;
    }

    // Espera a que SessionService tenga el perfil y el rol cargados
    // antes de redirigir — evita redirigir con role() === null
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (this.session.initialized() && this.session.role()) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
      setTimeout(() => { clearInterval(interval); resolve(); }, 5000);
    });

    this.auth.redirectByRole(this.session.role() ?? '');
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