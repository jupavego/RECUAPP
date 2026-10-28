import { Component, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AdminService, AdminStats } from '../../services/admin.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class AdminDashboardComponent implements OnInit {
  private adminService = inject(AdminService);

  stats   = signal<AdminStats | null>(null);
  loading = signal(true);

  async ngOnInit(): Promise<void> {
    this.stats.set(await this.adminService.getStats());
    this.loading.set(false);
  }
}