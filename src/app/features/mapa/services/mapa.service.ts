import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { GeometriaCodificada } from '../utils/polyline';

export interface Municipio {
  id: number;
  n: string;
  /** subregión */
  s: string;
  /** [oeste, sur, este, norte] */
  b: [number, number, number, number] | null;
  c: [number, number];
  /** ids de los municipios colindantes */
  vec: number[];
  g: GeometriaCodificada;
}

export interface MunicipiosData {
  fuente: string;
  bbox: [number, number, number, number];
  municipios: Municipio[];
}

export interface Zona {
  n: string;
  /** tipo de la zona veredal: VE vereda, CM cabecera municipal, CO centro poblado... (solo veredas) */
  t?: string;
  /** posición del corregimiento dentro del archivo del municipio (solo veredas) */
  cr?: number | null;
  p: [number, number];
  g: GeometriaCodificada;
}

export interface Territorio {
  c: Zona[];
  v: Zona[];
}

export type CategoriaPunto = 'educacion' | 'cultura' | 'patrimonio' | 'deporte' | 'justicia' | 'turismo' | 'salud';

export interface Punto {
  c: CategoriaPunto;
  /** tipo de lugar */
  t: string;
  n: string;
  /** dirección o referencia de ubicación */
  d?: string;
  tel?: string;
  mail?: string;
  web?: string;
  /** vereda o zona donde cae el punto (solo si la ubicación es exacta) */
  v?: string;
  /** descripción o detalle */
  x?: string;
  /** estado o validación del dato */
  e?: string;
  /** fuente del dato */
  f: string;
  lat?: number;
  lng?: number;
  /** la ubicación es aproximada (centro de la vereda) */
  a?: boolean;
  /** la ubicación se estimó a partir de la dirección (la fuente no trae coordenadas) */
  g?: boolean;
}

@Injectable({ providedIn: 'root' })
export class MapaService {
  private readonly http = inject(HttpClient);
  private readonly territorios = new Map<number, Observable<Territorio>>();

  readonly municipios$ = this.http
    .get<MunicipiosData>('data/mapa/municipios.json')
    .pipe(shareReplay(1));

  private readonly puntosMunicipio = new Map<number, Observable<Punto[]>>();

  /** Puntos de interés de un municipio; vacío si aún no se han cargado datos de ese municipio. */
  puntos(idMunicipio: number): Observable<Punto[]> {
    let obs = this.puntosMunicipio.get(idMunicipio);
    if (!obs) {
      obs = this.http.get<{ puntos: Punto[] }>(`data/mapa/puntos/${idMunicipio}.json`).pipe(
        map(d => d.puntos),
        catchError(() => of([] as Punto[])),
        shareReplay(1));
      this.puntosMunicipio.set(idMunicipio, obs);
    }
    return obs;
  }

  /** Corregimientos y veredas de un municipio; se piden al elegirlo y se memoizan. */
  territorio(idMunicipio: number): Observable<Territorio> {
    let obs = this.territorios.get(idMunicipio);
    if (!obs) {
      obs = this.http.get<Territorio>(`data/mapa/territorio/${idMunicipio}.json`).pipe(shareReplay(1));
      this.territorios.set(idMunicipio, obs);
    }
    return obs;
  }
}
