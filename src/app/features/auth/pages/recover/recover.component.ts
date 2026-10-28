import { Component, ViewEncapsulation, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-recover',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule],
  templateUrl: './recover.component.html',
  styleUrl: './recover.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class RecoverComponent {
  private fb   = inject(FormBuilder);
  private auth = inject(AuthService);

  loading      = signal(false);
  errorMessage = signal<string | null>(null);
  success      = signal(false);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  get email() { return this.form.controls.email; }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const result = await this.auth.recoverPassword(this.email.value!);

    this.loading.set(false);

    if (!result.success) {
      this.errorMessage.set(result.error ?? 'Error al enviar el correo');
      return;
    }

    this.success.set(true);
  }
}