import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SITE } from '../../../data/site.data';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './privacy.component.html',
  styleUrl: './privacy.component.scss',
})
export class PrivacyComponent {
  readonly site = SITE;
  readonly year = new Date().getFullYear();
  readonly lastUpdated = 'Pendiente de definir';
}
