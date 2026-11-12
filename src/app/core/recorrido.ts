import { UrlMatchResult, UrlSegment } from '@angular/router';

/**
 * El recorrido: una sola página continua con las secciones del menú, en su mismo orden.
 * Cada sección conserva su ruta de siempre; todas abren esta misma página en su sección
 * (y al desplazarse, la ruta cambia sola a la de la sección visible).
 */
export interface SeccionRecorrido {
  /** ruta de la sección, sin la barra inicial ('' es el inicio) */
  ruta: string;
  /** id del elemento de la sección dentro de la página */
  id: string;
  nombre: string;
}

export const SECCIONES_RECORRIDO: SeccionRecorrido[] = [
  { ruta: '', id: 'sec-inicio', nombre: 'Inicio' },
  { ruta: 'mapa3d', id: 'sec-mapa3d', nombre: 'Mapa 3D' },
  { ruta: 'plan', id: 'sec-plan', nombre: 'El plan en claro' },
  { ruta: 'responsables', id: 'sec-responsables', nombre: 'Responsables' },
  { ruta: 'mapa', id: 'sec-mapa', nombre: 'Mapa territorial' },
  { ruta: 'quienes-somos', id: 'sec-nosotros', nombre: 'Quiénes somos' },
];

const RUTAS = new Set(SECCIONES_RECORRIDO.map(s => s.ruta));

/** la ruta de una url, sin barra inicial, consulta ni fragmento */
export const rutaDe = (url: string): string => url.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');

export const esRecorrido = (url: string): boolean => RUTAS.has(rutaDe(url));

export const seccionDe = (url: string): SeccionRecorrido | undefined =>
  SECCIONES_RECORRIDO.find(s => s.ruta === rutaDe(url));

/**
 * Un solo registro de ruta para todas las secciones: así Angular reutiliza la página al pasar
 * de una a otra (no la vuelve a crear ni recarga los mapas).
 */
export function recorridoMatcher(segmentos: UrlSegment[]): UrlMatchResult | null {
  return RUTAS.has(segmentos.map(s => s.path).join('/')) ? { consumed: segmentos } : null;
}
