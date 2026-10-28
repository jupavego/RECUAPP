import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ItemsService } from '../../services/items.service';
import { Item } from '../../models/item.model';

@Component({
  selector: 'app-items-list',
  standalone: true,
  imports: [ReactiveFormsModule, DatePipe],
  templateUrl: './items-list.component.html',
  styleUrl: './items-list.component.scss',
})
export class ItemsListComponent implements OnInit {
  private fb    = inject(FormBuilder);
  private items = inject(ItemsService);

  list      = signal<Item[]>([]);
  loading   = signal(true);
  saving    = signal(false);
  error     = signal<string | null>(null);
  editingId = signal<string | null>(null);   // null = creando uno nuevo

  form = this.fb.nonNullable.group({
    title:       ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', Validators.maxLength(1000)],
    active:      [true],
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.list.set(await this.items.list());
    this.loading.set(false);
  }

  edit(item: Item): void {
    this.editingId.set(item.id);
    this.form.setValue({
      title:       item.title,
      description: item.description ?? '',
      active:      item.active,
    });
  }

  cancel(): void {
    this.editingId.set(null);
    this.form.reset({ title: '', description: '', active: true });
    this.error.set(null);
  }

  async save(): Promise<void> {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    this.saving.set(true);
    this.error.set(null);

    const id     = this.editingId();
    const value  = this.form.getRawValue();
    const result = id ? await this.items.update(id, value) : await this.items.create(value);

    this.saving.set(false);
    if (!result.success) { this.error.set(result.error ?? 'Error al guardar'); return; }

    this.cancel();
    await this.load();
  }

  async remove(item: Item): Promise<void> {
    if (!confirm(`¿Eliminar "${item.title}"?`)) return;
    if (await this.items.remove(item.id)) {
      this.list.update(l => l.filter(i => i.id !== item.id));
    } else {
      this.error.set('No se pudo eliminar el registro');
    }
  }
}
