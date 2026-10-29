import { CategoriaPunto } from '../services/mapa.service';

export interface InfoCategoria {
  id: CategoriaPunto;
  nombre: string;
  color: string;
  /** se muestra al abrir el municipio */
  visible: boolean;
}

export const CATEGORIAS: InfoCategoria[] = [
  { id: 'educacion', nombre: 'Instituciones educativas', color: '#2563eb', visible: true },
  { id: 'cultura', nombre: 'Cultura y bibliotecas', color: '#9333ea', visible: true },
  { id: 'salud', nombre: 'Salud', color: '#06b6d4', visible: true },
  { id: 'turismo', nombre: 'Turismo y sitios de interés', color: '#16a34a', visible: true },
  { id: 'deporte', nombre: 'Escenarios deportivos', color: '#eab308', visible: true },
  { id: 'justicia', nombre: 'Justicia y seguridad', color: '#dc2626', visible: true },
  { id: 'patrimonio', nombre: 'Patrimonio y arqueología', color: '#ec4899', visible: false },
];

export const CATEGORIA = new Map(CATEGORIAS.map(c => [c.id, c]));
