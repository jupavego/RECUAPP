import { Component, computed, input, signal } from '@angular/core';
import { CATEGORIAS, CategoriaFuente, FUENTES, Fuente, citar } from '../../../data/biblioteca.data';

/** Minúsculas y sin tildes, para que «planeacion» encuentre «Planeación». */
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

@Component({
  selector: 'app-biblioteca',
  standalone: true,
  template: `
    <article class="bib">
      <header class="bib__head">
        @if (!incrustado()) { <h1>Biblioteca</h1> }
        <p>
          Las {{ total }} fuentes con las que se construyó RECUAPP: normas, guías oficiales, datos abiertos,
          cartografía y software. Cada una trae su enlace, su cita y para qué se usó.
        </p>
        <div class="bib__tools">
          <input type="search" class="bib__buscar" placeholder="Buscar por título, entidad o uso…"
                 aria-label="Buscar fuentes" [value]="q()" (input)="q.set($any($event.target).value)" />
          <button type="button" class="bib__copiar-todo" (click)="copiar(todasLasCitas(), 'todas')">
            {{ copiado() === 'todas' ? 'Copiado' : 'Copiar todas las citas' }}
          </button>
        </div>
        <div class="bib__chips" role="tablist" aria-label="Categorías">
          <button type="button" class="chip" [class.is-on]="cat() === 'todas'" (click)="cat.set('todas')">
            Todas <span>{{ total }}</span>
          </button>
          @for (c of categorias; track c.id) {
            <button type="button" class="chip" [class.is-on]="cat() === c.id" (click)="cat.set(c.id)">
              {{ c.nombre }} <span>{{ cuenta(c.id) }}</span>
            </button>
          }
        </div>
      </header>

      @for (g of grupos(); track g.cat.id) {
        <section class="bib__grupo">
          <h2>{{ g.cat.nombre }}</h2>
          <p class="bib__desc">{{ g.cat.desc }}</p>
          <ul class="bib__lista">
            @for (f of g.items; track f.id) {
              <li class="fuente" [id]="f.id">
                <h3>{{ f.titulo }}</h3>
                <p class="fuente__entidad">{{ f.entidad }}@if (f.anio) { · {{ f.anio }} }</p>
                <p class="fuente__uso">{{ f.uso }}</p>
                <blockquote class="fuente__cita">{{ cita(f) }}</blockquote>
                <div class="fuente__pie">
                  <a [href]="f.url" target="_blank" rel="noopener noreferrer">Abrir fuente ↗</a>
                  <button type="button" (click)="copiar(cita(f), f.id)">{{ copiado() === f.id ? 'Copiado' : 'Copiar cita' }}</button>
                  @if (f.licencia) { <span class="tag">{{ f.licencia }}</span> }
                  <span class="tag" [class.tag--ok]="f.verif === 'leida'"
                        [title]="f.verif === 'leida' ? 'Documento o servicio abierto y usado directamente' : 'Archivo descargado; no se halló una página pública del conjunto exacto, el enlace es el portal de la entidad'">
                    {{ f.verif === 'leida' ? 'Fuente directa' : 'Portal de la entidad' }}
                  </span>
                  @if (f.local) { <span class="fuente__local">{{ f.local }}</span> }
                </div>
              </li>
            }
          </ul>
        </section>
      } @empty {
        <p class="bib__vacio">Ninguna fuente coincide con la búsqueda.</p>
      }

      <p class="bib__nota">
        «Portal de la entidad» significa que el archivo se descargó de esa entidad y no se halló una página pública del conjunto exacto (datos.gov.co, PBOT, Encuentrala);
        confirmar antes de una cita formal. Para agregar una fuente: <code>src/app/data/biblioteca.data.ts</code>.
      </p>
    </article>
  `,
  styleUrl: './biblioteca.component.scss',
})
export class BibliotecaComponent {
  /** dentro de Quiénes somos la sección ya trae su título */
  readonly incrustado = input(false);
  readonly categorias = CATEGORIAS;
  readonly total = FUENTES.length;
  readonly q = signal('');
  readonly cat = signal<CategoriaFuente | 'todas'>('todas');
  readonly copiado = signal('');
  readonly cita = (f: Fuente) => citar(f);

  readonly grupos = computed(() => {
    const t = sinTildes(this.q().trim());
    const c = this.cat();
    return CATEGORIAS
      .filter(k => c === 'todas' || k.id === c)
      .map(k => ({
        cat: k,
        items: FUENTES.filter(f => f.cat === k.id &&
          (!t || sinTildes(`${f.titulo} ${f.entidad} ${f.uso} ${f.local ?? ''}`).includes(t))),
      }))
      .filter(g => g.items.length);
  });

  cuenta(id: CategoriaFuente): number {
    return FUENTES.filter(f => f.cat === id).length;
  }

  todasLasCitas(): string {
    return CATEGORIAS
      .flatMap(k => FUENTES.filter(f => f.cat === k.id))
      .map(f => citar(f))
      .join('\n\n');
  }

  async copiar(texto: string, id: string): Promise<void> {
    try { await navigator.clipboard.writeText(texto); } catch { return; }
    this.copiado.set(id);
    setTimeout(() => this.copiado.set(''), 1600);
  }
}
