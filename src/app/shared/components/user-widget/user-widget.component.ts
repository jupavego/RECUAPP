import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SessionService } from '../../../core/services/session.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-user-widget',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './user-widget.component.html',
  styleUrl: './user-widget.component.scss',
})
export class UserWidgetComponent {
  readonly session = inject(SessionService);
  private auth     = inject(AuthService);
  private el       = inject(ElementRef);

  menuOpen = signal(false);

  // Cierra el dropdown al hacer clic fuera del componente
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.el.nativeElement.contains(event.target)) {
      this.menuOpen.set(false);
    }
  }

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.update(v => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  get displayName(): string {
    const name = this.session.profile()?.full_name?.trim();
    if (!name) return 'Mi perfil';
    // Muestra hasta 3 tokens del nombre completo
    return name.split(/\s+/).slice(0, 3).join(' ');
  }

  async logout(): Promise<void> {
    this.menuOpen.set(false);
    await this.auth.logout();
  }
}