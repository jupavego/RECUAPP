import { Component } from '@angular/core';

/** Sistema documental de RECUAPP (pitch deck, canvas, blueprint, memorandum y one-pager): vive en public/sistema-documental.html. */
@Component({
  selector: 'app-documentos',
  standalone: true,
  template: `<iframe class="documentos" src="/sistema-documental.html" title="Sistema documental de RECUAPP"></iframe>`,
  styles: [`
    :host { display: block; }
    .documentos { display: block; width: 100%; height: calc(100vh - 64px); min-height: 480px; border: 0; background: var(--color-page-bg, #F5F0EA); }
  `],
})
export class DocumentosComponent {}
