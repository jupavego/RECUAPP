import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SITE } from '../../../data/site.data';

@Component({
  selector: 'app-security-disclosure',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './security-disclosure.component.html',
  styleUrl: './security-disclosure.component.scss',
})
export class SecurityDisclosureComponent {
  readonly site = SITE;
}
