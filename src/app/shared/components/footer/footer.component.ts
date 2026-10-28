import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SITE } from '../../../data/site.data';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
})
export class FooterComponent {
  readonly year = new Date().getFullYear();
  readonly site = SITE;
}