import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type Confianza = 'alta' | 'media' | 'baja';

/** persona a cargo de una dependencia, según la página de la alcaldía */
/** funcionario del directorio de la alcaldía; el correo solo si es institucional */
export interface Funcionario {
  nombre: string;
  cargo: string | null;
  correo: string | null;
  telefono: string | null;
  extension: string | null;
}

export interface PersonaResponsable {
  cargo: string;
  nombre: string;
  /** página de la alcaldía de donde se tomó */
  url: string;
  /** del directorio de funcionarios de la alcaldía; faltan si no se encontró a la persona */
  correo?: string;
  telefono?: string;
  extension?: string;
}

export interface Dependencia {
  id: string;
  nombre: string;
  /** secretaría con la que se muestra la entidad externa (tercer nivel, sin sumar a sus productos); null si no aplica */
  vinculo?: string | null;
  tipo: 'secretaria' | 'oficina' | 'subsecretaria' | 'unidad' | 'entidad';
  url: string | null;
  /** dependencia de la que depende, si es subsecretaría */
  padre: string | null;
  /** false cuando el padre se supone por el nombre y falta confirmarlo */
  padre_confirmado: boolean | null;
  nota: string | null;
  /** nombre del archivo en /img/iconos, sin extensión; null si no hay icono para esta dependencia */
  icono: string | null;
  /** productos por confianza de la asignación: alta = lo dice el PDF; media y baja = pista por sector */
  productos: Record<Confianza, number>;
  /** quién la dirige hoy; null si el sitio de la alcaldía no la lista */
  responsable: PersonaResponsable | null;
  /** funcionarios de la dependencia según el directorio; vacío si no hay directorio */
  equipo: Funcionario[];
}

export interface ProductoPlan {
  id: string;
  linea: string;
  sector: string;
  programa: string;
  producto: string;
  indicador: string;
  detalle: string;
  unidad: string;
  meta: number | null;
  ods: string;
  /** programación física 2024–2027 */
  prog: (number | null)[];
  resp: { dep: string; conf: Confianza }[];
  /** responsables del PDF que no son una dependencia de la alcaldía (p. ej. el INDER) */
  fuera: string[];
  /** por qué se asignó a mano, cuando no lo dice el plan */
  nota?: string | null;
  pdf: { pagina: number | null; linea_base: string | null } | null;
}

export interface Inversion {
  fuente: string;
  anios: string[];
  total: number[];
  lineas: { id: string; nombre: string; anios: number[] }[];
  /** cuadra: el resumen del sector coincide con la suma de sus programas */
  sectores: { nombre: string; linea: string; anios: number[]; cuadra: boolean | null; suma_programas: number[] | null; pagina: number | null }[];
  programas: { sector: string; nombre: string; anios: number[] }[];
}

export interface PlanEntidad {
  dane: string;
  municipio: string;
  plan: string;
  fuente: { nombre: string; fecha: string };
  dependencias: Dependencia[];
  alcalde?: PersonaResponsable | null;
  responsables_fecha?: string | null;
  otras_entidades: { nombre: string; icono: string | null }[];
  lineas: { id: string; nombre: string; productos: number; programas: number }[];
  sectores: { cod: string; nombre: string; productos: number; programas: number }[];
  programas: { cod: string; nombre: string; sector: string; productos: number }[];
  resultado: { id: string; linea: string; indicador: string; meta: string }[];
  ods: { nombre: string; productos: number }[];
  /** plan plurianual de inversiones del PDF; null si la entidad aún no lo tiene leído */
  financiacion: Inversion | null;
  productos: ProductoPlan[];
  solo_pdf: { nombre: string; pagina: number | null; responsable: string | null }[];
  calidad: {
    productos: number; indicadores_pdf: number; con_pdf: number; resp_pdf: number;
    resp_pista: number; resp_otra_entidad: number; sin_resp: number; atipico: number;
  };
}

/** avance físico de un indicador en un informe de seguimiento del municipio */
export interface AvanceAnio {
  programada: number | null;
  avance: number | null;
  /** % de avance sobre lo programado del año; puede pasar de 100 */
  pct: number | null;
  /** 'tabla' = tabla resumen del informe; 'ficha' = ficha del indicador */
  fuente: 'tabla' | 'ficha';
  /** si la ficha dice otra cosa que la tabla resumen, lo que dice la ficha */
  ficha?: { programada: number | null; avance: number | null; pct: number | null };
}

export interface AvanceIndicador {
  /** valores del último año informado */
  programada: number | null;
  avance: number | null;
  pct: number | null;
  acumulacion: string | null;
  por_anio: Record<string, AvanceAnio>;
  /** texto con que el informe explica lo ejecutado, por año */
  narrativas?: Record<string, string | null>;
  proyecto?: string | null;
  bpin?: string | null;
  /** id de la dependencia bajo la que el informe presenta el indicador, por año */
  informe_dep?: Record<string, string | null>;
}

/** cuadros oficiales del informe para una dependencia, por año */
export interface AvanceDependencia {
  metas: number | null;
  /** avance al cuatrienio; los informes de 2024 no lo traen por dependencia */
  cuatrienio: number | null;
  plan_accion: number | null;
}

export interface AvanceNivel {
  nivel: string;
  nombre: string;
  cuatrienio: number | null;
  plan_accion: number | null;
}

/** indicador cuyo informe de seguimiento nombra una vereda; generado por scripts/plan_desarrollo/zonas_indicadores.py */
export interface ProyectoZona {
  ip: string;
  indicador: string;
  dep: string | null;
  dep_nombre: string | null;
  pct: number | null;
  anio_pct: number | null;
  menciones: { anio: string; texto: string }[];
}

export interface ZonasPlan {
  fuente: string;
  zonas: Record<string, ProyectoZona[]>;
}

/** seguimiento por id de producto (IP-xx); generado por scripts/plan_desarrollo/seguimiento_json.py */
export interface Seguimiento {
  /** último año informado */
  anio: number;
  anios: string[];
  fuente: string;
  /** fichas del último año que no se pudieron cruzar con un producto */
  sin_codigo: number;
  sin_codigo_por_anio: Record<string, number>;
  indicadores: Record<string, AvanceIndicador>;
  dependencias: Record<string, Record<string, AvanceDependencia>>;
  /** global y por línea estratégica, por año */
  global: Record<string, AvanceNivel[]>;
}

@Injectable({ providedIn: 'root' })
export class PlanService {
  private readonly http = inject(HttpClient);

  /** Datos de una entidad, generados por scripts/plan_desarrollo/tarjetas_app.py. */
  entidad(dane: string): Observable<PlanEntidad> {
    return this.http.get<PlanEntidad>(`/data/plan/${dane}.json`);
  }

  /** Veredas nombradas en los informes de seguimiento; falla (404) si la entidad no las tiene. */
  zonas(dane: string): Observable<ZonasPlan> {
    return this.http.get<ZonasPlan>(`/data/plan/${dane}-zonas.json`);
  }

  /** Seguimiento del último año informado; falla (404) si la entidad aún no tiene informe. */
  seguimiento(dane: string): Observable<Seguimiento> {
    return this.http.get<Seguimiento>(`/data/plan/${dane}-seguimiento.json`);
  }
}
