import { Component, OnInit, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

const CONSENT_KEY = 'privacy_consent_v1';

@Component({
  selector: 'app-consent-banner',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './consent-banner.component.html',
  styleUrl: './consent-banner.component.scss',
})
export class ConsentBannerComponent implements OnInit {
  visible = signal(false);

  ngOnInit(): void {
    if (!localStorage.getItem(CONSENT_KEY)) {
      this.visible.set(true);
    }
  }

  accept(): void {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    this.visible.set(false);
  }
}
