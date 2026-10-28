import { Component, OnInit, signal, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SessionService } from '../../../../app/core/services/session.service';
import { AuthService } from '../../../../app/core/services/auth.service';

@Component({
  selector: 'app-auth-confirm',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './auth-confirm.component.html',
  styleUrl: './auth-confirm.component.scss',
})
export class AuthConfirmComponent implements OnInit {
  private session = inject(SessionService);
  private auth    = inject(AuthService);

  error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    // Esperar a que Supabase procese el token de confirmación de la URL
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (this.session.initialized()) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
      setTimeout(() => { clearInterval(interval); resolve(); }, 6000);
    });

    if (!this.session.isLoggedIn()) {
      this.error.set('El link de confirmación expiró o ya fue usado.');
      return;
    }

    // Confirmación exitosa — redirigir al panel correspondiente
    setTimeout(() => {
      this.auth.redirectByRole(this.session.role() ?? '');
    }, 2000);
  }
}