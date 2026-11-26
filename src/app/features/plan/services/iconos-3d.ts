/** Dependencias de primer nivel que tienen icono 3D en /img/responsables-3d/<id>.svg. */
export const ICONOS_3D = new Set(['agri', 'amb', 'gob', 'hac', 'inf', 'pla', 'sal', 'adm', 'tra', 'edu', 'com', 'jur', 'cid', 'cia', 'des']);

/** Ruta del icono 3D de una dependencia, o null si no tiene (entonces se usa su icono de siempre). */
export function icono3d(id: string): string | null {
  return ICONOS_3D.has(id) ? `/img/responsables-3d/${id}.svg` : null;
}
