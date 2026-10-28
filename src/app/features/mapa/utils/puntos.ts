import { CategoriaPunto } from '../services/mapa.service';

export interface InfoCategoria {
  id: CategoriaPunto;
  nombre: string;
  color: string;
  /** se muestra al abrir el municipio */
  visible: boolean;
}

export const CATEGORIAS: InfoCategoria[] = [
  { id: 'educacion', nombre: 'Instituciones educativas', color: '#1d4ed8', visible: true },
  { id: 'cultura', nombre: 'Cultura y bibliotecas', color: '#be185d', visible: true },
  { id: 'salud', nombre: 'Salud', color: '#0e7490', visible: true },
  { id: 'turismo', nombre: 'Turismo y sitios de interés', color: '#047857', visible: true },
  { id: 'deporte', nombre: 'Escenarios deportivos', color: '#4d7c0f', visible: true },
  { id: 'justicia', nombre: 'Justicia y seguridad', color: '#b91c1c', visible: true },
  { id: 'patrimonio', nombre: 'Patrimonio y arqueología', color: '#92400e', visible: false },
];

export const CATEGORIA = new Map(CATEGORIAS.map(c => [c.id, c]));
