import { Component } from '@angular/core';
import { RouterModule, RouterOutlet } from '@angular/router';
import { SITE } from '../../data/site.data';

@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [RouterOutlet, RouterModule],
  templateUrl: './auth-layout.component.html',
  styleUrl: './auth-layout.component.scss',
})
export class AuthLayoutComponent {
  readonly site = SITE;
}