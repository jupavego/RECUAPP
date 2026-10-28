import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { GeometriaCodificada } from '../utils/polyline';

export interface Municipio {
  id: number;
  n: string;
  /** subregión */
  s: string;
  /** [oeste, sur, este, norte] */
  b: [number, number, number, number] | null;
  c: [number, number];
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

@Injectable({ providedIn: 'root' })
export class MapaService {
  private readonly http = inject(HttpClient);
  private readonly territorios = new Map<number, Observable<Territorio>>();

  readonly municipios$ = this.http
    .get<MunicipiosData>('data/mapa/municipios.json')
    .pipe(shareReplay(1));

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
