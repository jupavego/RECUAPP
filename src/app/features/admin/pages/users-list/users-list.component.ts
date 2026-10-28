import { Component, OnInit, ViewEncapsulation, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AdminService } from '../../services/admin.service';
import { Profile, UserRole } from '../../../../core/models/profile.model';

@Component({
  selector: 'app-users-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './users-list.component.html',
  styleUrl: './users-list.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class UsersListComponent implements OnInit {
  private adminService = inject(AdminService);

  users      = signal<Profile[]>([]);
  loading    = signal(true);
  searchText = signal('');
  roleFilter = signal<UserRole | 'all'>('all');

  filtered = computed(() => {
    const text = this.searchText().toLowerCase().trim();
    const role = this.roleFilter();

    return this.users().filter(u => {
      const matchesRole = role === 'all' || u.role === role;
      const matchesText = !text ||
        u.full_name?.toLowerCase().includes(text) ||
        u.phone?.toLowerCase().includes(text);
      return matchesRole && matchesText;
    });
  });

  async ngOnInit(): Promise<void> {
    this.users.set(await this.adminService.getUsers());
    this.loading.set(false);
  }

  async onRoleChange(user: Profile, newRole: UserRole): Promise<void> {
    const ok = await this.adminService.updateUserRole(user.id, newRole);
    if (ok) {
      this.users.update(users =>
        users.map(u => u.id === user.id ? { ...u, role: newRole } : u)
      );
    }
  }

  roleBadgeClass(role: string): string {
    const map: Record<string, string> = {
      admin:    'badge--admin',
      user:     'badge--client',
    };
    return map[role] ?? '';
  }
}