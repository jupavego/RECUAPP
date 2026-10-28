import { Component, OnInit, ViewEncapsulation, inject, signal, computed } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SessionService } from '../../../../core/services/session.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ProfileService } from '../../services/profile.service';

export type ProfileSection = 'personal' | 'password';

const SECTION_FIELDS: Record<ProfileSection, string[]> = {
  personal: ['full_name', 'phone'],
  password: ['newPassword', 'confirmPassword'],
};

@Component({
  selector: 'app-profile-edit',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './profile-edit.component.html',
  styleUrl: './profile-edit.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class ProfileEditComponent implements OnInit {
  readonly session = inject(SessionService);
  private fb       = inject(FormBuilder);
  private profile  = inject(ProfileService);
  private auth     = inject(AuthService);

  saving          = signal(false);
  uploadingAvatar = signal(false);
  successMsg      = signal<string | null>(null);
  errorMsg        = signal<string | null>(null);

  avatarUrl = signal<string | null>(
    this.session.profile()?.avatar_url ?? null
  );

  activeSections = signal<Set<ProfileSection>>(new Set());

  isEditing(section: ProfileSection): boolean {
    return this.activeSections().has(section);
  }

  toggleSection(section: ProfileSection): void {
    const current = new Set(this.activeSections());

    if (current.has(section)) {
      current.delete(section);
      this.disableSectionFields(section);
      if (section === 'personal') this.resetPersonalFields();
      if (section === 'password') this.passwordForm.reset();
    } else {
      current.add(section);
      this.enableSectionFields(section);
    }

    this.activeSections.set(current);
    this.successMsg.set(null);
    this.errorMsg.set(null);
  }

  private enableSectionFields(section: ProfileSection): void {
    for (const field of SECTION_FIELDS[section]) {
      if (section === 'password') {
        this.passwordForm.get(field)?.enable();
      } else {
        this.form.get(field)?.enable();
      }
    }
  }

  private disableSectionFields(section: ProfileSection): void {
    for (const field of SECTION_FIELDS[section]) {
      if (section === 'password') {
        this.passwordForm.get(field)?.disable();
      } else {
        this.form.get(field)?.disable();
      }
    }
  }

  private resetPersonalFields(): void {
    const p = this.session.profile();
    this.form.patchValue({
      full_name: p?.full_name ?? '',
      phone:     p?.phone ?? '',
    });
  }

  form = this.fb.group({
    full_name: [
      this.session.profile()?.full_name ?? '',
      [Validators.required, Validators.minLength(3)],
    ],
    phone: [this.session.profile()?.phone ?? ''],
  });

  passwordForm = this.fb.group({
    newPassword:     ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', Validators.required],
  });

  get fullName()        { return this.form.get('full_name')!; }
  get phone()           { return this.form.get('phone')!; }
  get newPassword()     { return this.passwordForm.get('newPassword')!; }
  get confirmPassword() { return this.passwordForm.get('confirmPassword')!; }

  get passwordMismatch(): boolean {
    return (
      this.passwordForm.touched &&
      this.newPassword.value !== this.confirmPassword.value
    );
  }

  ngOnInit(): void {
    // Deshabilitar todos los campos al inicio — ninguna sección activa
    this.form.disable();
    this.passwordForm.disable();

    // Sincronizar avatar en caso de que el perfil cargue después del constructor
    const avatarFromSession = this.session.profile()?.avatar_url ?? null;
    if (avatarFromSession && !this.avatarUrl()) {
      this.avatarUrl.set(avatarFromSession);
    }
  }

  async onAvatarChange(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    // Preview inmediato con base64
    const reader = new FileReader();
    reader.onload = e => this.avatarUrl.set(e.target?.result as string);
    reader.readAsDataURL(file);

    this.uploadingAvatar.set(true);
    this.errorMsg.set(null);

    const result = await this.profile.updateAvatar(file);
    this.uploadingAvatar.set(false);

    if (!result.success) {
      this.avatarUrl.set(this.session.profile()?.avatar_url ?? null);
      this.errorMsg.set(result.error ?? 'Error al subir la foto');
      return;
    }

    const freshUrl = result.data?.avatar_url
      ? `${result.data.avatar_url}?t=${Date.now()}`
      : this.session.profile()?.avatar_url ?? null;

    this.avatarUrl.set(freshUrl);
    this.successMsg.set('Foto actualizada correctamente');
    setTimeout(() => this.successMsg.set(null), 3000);
  }

  async onSaveProfile(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMsg.set(null);
    this.successMsg.set(null);

    const result = await this.profile.update({
      full_name: this.fullName.value!,
      phone:     this.phone.value ?? '',
    });

    this.saving.set(false);

    if (!result.success) {
      this.errorMsg.set(result.error ?? 'Error al guardar');
      return;
    }

    // Cerrar sección tras guardar
    this.toggleSection('personal');
    this.successMsg.set('Perfil actualizado correctamente');
    setTimeout(() => this.successMsg.set(null), 3000);
  }

  async onChangePassword(): Promise<void> {
    if (this.passwordForm.invalid || this.passwordMismatch) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMsg.set(null);

    const result = await this.auth.resetPassword(this.newPassword.value!);
    this.saving.set(false);

    if (!result.success) {
      this.errorMsg.set(result.error ?? 'Error al cambiar la contraseña');
      return;
    }

    // Cerrar sección tras guardar
    this.toggleSection('password');
    this.successMsg.set('Contraseña actualizada correctamente');
    setTimeout(() => this.successMsg.set(null), 3000);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }
}