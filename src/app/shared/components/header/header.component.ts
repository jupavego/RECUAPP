import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SessionService } from '../../../core/services/session.service';
import { UserWidgetComponent } from '../user-widget/user-widget.component';
import { SITE } from '../../../data/site.data';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterModule, UserWidgetComponent],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent {
  readonly session = inject(SessionService);
  readonly site    = SITE;
}
