import { Directive, ElementRef, HostListener, inject } from '@angular/core';

/** Para un <details> que se despliega como lista: se cierra al hacer clic fuera de él o al pulsar Escape. */
@Directive({ selector: 'details[appCierraFuera]', standalone: true })
export class CierraFueraDirective {
  private readonly el = inject<ElementRef<HTMLDetailsElement>>(ElementRef).nativeElement;

  @HostListener('document:click', ['$event'])
  clic(e: Event): void {
    if (this.el.open && e.target instanceof Node && !this.el.contains(e.target)) this.el.open = false;
  }

  @HostListener('document:keydown.escape')
  escape(): void {
    this.el.open = false;
  }
}
