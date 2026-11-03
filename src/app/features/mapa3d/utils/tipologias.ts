import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Modelo } from './equipamientos';
import { EstiloFachada, Interior, NegocioDef, PlantaBaja, crearFachadas, fachadaNegocio } from './fachadas';

/**
 * Casas y edificios con fachada detallada, a partir de unos pocos patrones base de la arquitectura de la región: casas de teja de
 * barro con techo a dos aguas, fachadas claras con zócalo, puertas, ventanas y rejas pintados de colores vivos, balcones con
 * flores, locales con vitrina en el centro y edificios de varios pisos con balcones. Cada patrón es una gramática de reglas con
 * rangos: una semilla elige la paleta, el ancho, los pisos, la planta baja, el balcón, el techo y los remates, de modo que de
 * un mismo patrón salen casas parecidas pero nunca iguales.
 */
export interface TipologiaInfo { id: string; etiqueta: string }

type Balcon = 'ninguno' | 'individual' | 'corrido';
type Techo = 'dosAguas' | 'plano';
interface Paleta { pared: string; zocalo: string; marcos: string; puerta: string }

interface Patron {
  etiqueta: string;
  pisos: [number, number];
  ancho: [number, number];
  fondo: [number, number];
  altoPiso: number;
  /** ancho de cada hueco de fachada (m): define cuántas ventanas caben */
  bahia: [number, number];
  /** opciones (repetir una la hace más probable) */
  plantas: PlantaBaja[];
  balcones: Balcon[];
  techos: Techo[];
  paletas: Paleta[];
  reja: number; persiana: number; macetas: number; esquinas: boolean; medianeras: boolean;
  toldo: boolean; tanque: boolean;
  baranda: string[];
  /** corredor frontal de columnas de madera bajo un alero (casas de pueblo y de finca) */
  corredor?: boolean;
  /** local comercial con letrero: nombres posibles y cómo se ve el frente */
  negocio?: Plantilla;
  /** cumbrera paralela a la fachada, con alero ancho y cabrios de madera a la vista (casas coloniales del parque) */
  cumbreAlFrente?: boolean;
  /** color de las hojas de madera de ventanas y puertas balcón */
  vidrios?: string[];
}

/** Plantilla de un negocio típico: el nombre y los colores del letrero cambian con la semilla. */
interface Plantilla {
  nombres: string[];
  subtitulo: string;
  /** [fondo del letrero, color del texto] */
  letreros: [string, string][];
  frente: NegocioDef['frente'];
  interior: Interior;
  bandera: string;
  /** mesas con sombrilla en el andén */
  terraza?: boolean;
}

const CLARO = '#f1ede3';

/** Fachadas claras con zócalo, marcos y puertas de colores vivos (verde botella, añil, rojo teja, café de madera…). */
const PALETAS_TRADICIONALES: Paleta[] = [
  { pared: '#f3e6c8', zocalo: '#2f5d46', marcos: '#2f5d46', puerta: '#7a3b24' },
  { pared: '#f6f1e6', zocalo: '#25508a', marcos: '#25508a', puerta: '#1f3f6e' },
  { pared: '#f2dfa5', zocalo: '#a3382c', marcos: '#a3382c', puerta: '#5b3a22' },
  { pared: '#f1d6cf', zocalo: '#3d7a58', marcos: '#3d7a58', puerta: '#3d7a58' },
  { pared: '#ebdcc0', zocalo: '#6b4226', marcos: '#6b4226', puerta: '#6b4226' },
  { pared: '#f4efe4', zocalo: '#c4622d', marcos: '#c4622d', puerta: '#2f5d46' },
  { pared: '#d9e8ee', zocalo: '#27476b', marcos: '#27476b', puerta: '#27476b' },
];
const PALETAS_URBANAS: Paleta[] = [
  { pared: '#e6dcc6', zocalo: '#8a8f94', marcos: '#4b5563', puerta: '#374151' },
  { pared: '#dad4c6', zocalo: '#7a4b32', marcos: '#3f3a34', puerta: '#4b3426' },
  { pared: '#e9d3c0', zocalo: '#8c4a35', marcos: '#5a4a3f', puerta: '#4b5563' },
  { pared: '#cfd6d8', zocalo: '#6b7280', marcos: '#374151', puerta: '#2b3440' },
  { pared: '#efe4cf', zocalo: '#9a8f7f', marcos: '#6b4226', puerta: '#6b4226' },
];
const PALETAS_MODERNAS: Paleta[] = [
  { pared: '#f4f4f1', zocalo: '#4b5563', marcos: '#2b3440', puerta: '#8a5a35' },
  { pared: '#e4e1da', zocalo: '#6b7280', marcos: '#1f2937', puerta: '#374151' },
  { pared: '#d7dad9', zocalo: '#52585f', marcos: '#202833', puerta: '#8a5a35' },
];

/** Casonas coloniales del parque: cal blanca, zócalo de ladrillo, puertas y ventanas de madera ocre con marcos verdes o azules. */
const PALETAS_COLONIALES: Paleta[] = [
  { pared: '#fbfaf5', zocalo: '#a8553a', marcos: '#2f6b4a', puerta: '#d9a21b' },
  { pared: '#faf8f0', zocalo: '#9c4a30', marcos: '#2f6b4a', puerta: '#c98f17' },
  { pared: '#fbfaf5', zocalo: '#a8553a', marcos: '#25508a', puerta: '#d9a21b' },
  { pared: '#f7f3e6', zocalo: '#8f4a32', marcos: '#3b2a1c', puerta: '#b8741a' },
];
const MADERA_OCRE = ['#d9a21b', '#c98f17', '#cf9a22'];
/** Ladrillo a la vista y bloque sin pintar, típicos de la autoconstrucción de los barrios. */
const PALETAS_LADRILLO: Paleta[] = [
  { pared: '#b4583a', zocalo: '#7d7f82', marcos: '#2b3440', puerta: '#2b3440' },
  { pared: '#a64d2e', zocalo: '#6b4226', marcos: '#26282b', puerta: '#4b3426' },
  { pared: '#b8a58f', zocalo: '#7d7f82', marcos: '#374151', puerta: '#4b5563' },
  { pared: '#c46a45', zocalo: '#8a8f94', marcos: '#1f2937', puerta: '#2f5d46' },
];
/** Casas de finca y de campo: colores terrosos, verdes y madera. */
const PALETAS_CAMPESTRES: Paleta[] = [
  { pared: '#efe2c2', zocalo: '#7a4b32', marcos: '#5b3a22', puerta: '#5b3a22' },
  { pared: '#e8e3cf', zocalo: '#4a6b3a', marcos: '#4a6b3a', puerta: '#6b4226' },
  { pared: '#f3dcb0', zocalo: '#a3382c', marcos: '#2f5d46', puerta: '#2f5d46' },
  { pared: '#dde5d3', zocalo: '#3d7a58', marcos: '#5b3a22', puerta: '#5b3a22' },
];

const PATRONES: Record<string, Patron> = {
  'casa-corredor': {
    etiqueta: 'Casa de pueblo con corredor', pisos: [1, 1], ancho: [9, 12], fondo: [10, 13], altoPiso: 3.2, bahia: [3.0, 3.6],
    plantas: ['casa'], balcones: ['ninguno'], techos: ['dosAguas'], paletas: PALETAS_CAMPESTRES,
    reja: 0.2, persiana: 0, macetas: 0, esquinas: false, medianeras: false, toldo: false, tanque: false, baranda: [], corredor: true,
  },
  'casa-colonial': {
    etiqueta: 'Casa colonial del parque (1-2 pisos)', pisos: [1, 2], ancho: [11, 15], fondo: [9, 12], altoPiso: 3.6, bahia: [3.0, 3.8],
    plantas: ['casa'], balcones: ['corrido', 'individual'], techos: ['dosAguas'], paletas: PALETAS_COLONIALES,
    reja: 0.2, persiana: 0, macetas: 0.7, esquinas: false, medianeras: false, toldo: false, tanque: false, baranda: ['#2f5d58', '#25508a', '#2f6b4a'],
    cumbreAlFrente: true, vidrios: MADERA_OCRE,
  },
  'casona-balcon-corrido': {
    etiqueta: 'Casona de 2 pisos con balcón corrido', pisos: [2, 2], ancho: [11, 15], fondo: [12, 16], altoPiso: 3.5, bahia: [3.0, 3.8],
    plantas: ['casa', 'local'], balcones: ['corrido'], techos: ['dosAguas'], paletas: PALETAS_COLONIALES,
    reja: 0.1, persiana: 0, macetas: 0.8, esquinas: false, medianeras: false, toldo: false, tanque: false, baranda: ['#2f5d58', '#25508a', '#2f6b4a'],
    cumbreAlFrente: true, vidrios: MADERA_OCRE,
  },
  'casa-ladrillo': {
    etiqueta: 'Casa de ladrillo a la vista (1-2 pisos)', pisos: [1, 2], ancho: [5.5, 8], fondo: [9, 13], altoPiso: 2.8, bahia: [2.6, 3.2],
    plantas: ['casa', 'garaje'], balcones: ['ninguno', 'individual'], techos: ['plano', 'dosAguas'], paletas: PALETAS_LADRILLO,
    reja: 0.9, persiana: 0.1, macetas: 0.1, esquinas: false, medianeras: false, toldo: false, tanque: true, baranda: ['#26282b'],
  },
  'casa-lote-angosto': {
    etiqueta: 'Casa angosta de lote medianero (3 pisos)', pisos: [3, 3], ancho: [4.5, 6], fondo: [11, 15], altoPiso: 2.8, bahia: [2.2, 3.0],
    plantas: ['garaje', 'local', 'casa'], balcones: ['individual', 'corrido'], techos: ['plano'], paletas: [...PALETAS_URBANAS, ...PALETAS_LADRILLO],
    reja: 0.8, persiana: 0.3, macetas: 0.4, esquinas: false, medianeras: true, toldo: false, tanque: true, baranda: ['#26282b', '#6b4226'],
  },
  'torre-apartamentos': {
    etiqueta: 'Torre de apartamentos (7-9 pisos)', pisos: [7, 9], ancho: [13, 18], fondo: [14, 18], altoPiso: 2.9, bahia: [3.2, 4.0],
    plantas: ['local', 'garaje'], balcones: ['corrido', 'individual'], techos: ['plano'], paletas: PALETAS_MODERNAS,
    reja: 0.1, persiana: 0.7, macetas: 0.15, esquinas: true, medianeras: false, toldo: false, tanque: true, baranda: ['#2b3440', '#7a8088', '#374151'],
  },
  'edificio-oficinas': {
    etiqueta: 'Edificio de oficinas y comercio (5-6 pisos)', pisos: [5, 6], ancho: [14, 20], fondo: [14, 18], altoPiso: 3.3, bahia: [2.8, 3.4],
    plantas: ['local'], balcones: ['ninguno'], techos: ['plano'], paletas: [...PALETAS_MODERNAS, ...PALETAS_URBANAS],
    reja: 0, persiana: 0.8, macetas: 0, esquinas: true, medianeras: true, toldo: true, tanque: true, baranda: [],
  },
  'casa-campestre': {
    etiqueta: 'Casa campestre de finca (1-2 pisos)', pisos: [1, 2], ancho: [10, 14], fondo: [9, 12], altoPiso: 3.0, bahia: [3.2, 4.0],
    plantas: ['casa'], balcones: ['individual', 'corrido'], techos: ['dosAguas'], paletas: PALETAS_CAMPESTRES,
    reja: 0.15, persiana: 0.1, macetas: 0.9, esquinas: false, medianeras: false, toldo: false, tanque: false, baranda: ['#5b3a22', '#3b2a1c'], corredor: true,
  },
  'esquina-comercial': {
    etiqueta: 'Esquina comercial con toldo (2 pisos)', pisos: [2, 2], ancho: [9, 12], fondo: [10, 13], altoPiso: 3.4, bahia: [3.0, 3.6],
    plantas: ['local'], balcones: ['individual', 'corrido'], techos: ['plano', 'dosAguas'], paletas: [...PALETAS_TRADICIONALES, ...PALETAS_URBANAS],
    reja: 0.3, persiana: 0.7, macetas: 0.5, esquinas: true, medianeras: false, toldo: true, tanque: false, baranda: ['#26282b', '#25508a', '#a3382c'],
  },
  'posada-hotel': {
    etiqueta: 'Posada u hotel del pueblo (3 pisos)', pisos: [3, 3], ancho: [12, 16], fondo: [11, 15], altoPiso: 3.1, bahia: [2.8, 3.4],
    plantas: ['local', 'casa'], balcones: ['corrido', 'individual'], techos: ['dosAguas', 'plano'], paletas: [...PALETAS_COLONIALES, ...PALETAS_TRADICIONALES],
    reja: 0.2, persiana: 0.3, macetas: 1, esquinas: false, medianeras: false, toldo: true, tanque: true, baranda: ['#2f5d46', '#3b2a1c', '#25508a'],
  },
  'casa-obrera-adosada': {
    etiqueta: 'Casa de barrio obrero con antejardín (2 pisos)', pisos: [2, 2], ancho: [5, 7], fondo: [9, 12], altoPiso: 2.8, bahia: [2.4, 3.0],
    plantas: ['casa', 'garaje'], balcones: ['ninguno', 'individual'], techos: ['dosAguas', 'plano'], paletas: [...PALETAS_TRADICIONALES, ...PALETAS_MODERNAS],
    reja: 0.9, persiana: 0.1, macetas: 0.5, esquinas: false, medianeras: true, toldo: false, tanque: false, baranda: ['#26282b', '#6b4226'],
  },
  'casa-tradicional': {
    etiqueta: 'Casa tradicional (1 piso)', pisos: [1, 1], ancho: [6, 9], fondo: [10, 14], altoPiso: 3.1, bahia: [2.8, 3.4],
    plantas: ['casa'], balcones: ['ninguno'], techos: ['dosAguas'], paletas: PALETAS_TRADICIONALES,
    reja: 0.55, persiana: 0, macetas: 0, esquinas: false, medianeras: false, toldo: false, tanque: false, baranda: [],
  },
  'casa-balcon': {
    etiqueta: 'Casa de 2 pisos con balcón', pisos: [2, 2], ancho: [6.5, 9], fondo: [10, 14], altoPiso: 3.0, bahia: [2.6, 3.2],
    plantas: ['casa', 'casa', 'garaje'], balcones: ['individual', 'individual', 'corrido'], techos: ['dosAguas', 'dosAguas', 'plano'],
    paletas: PALETAS_TRADICIONALES, reja: 0.7, persiana: 0.2, macetas: 0.6, esquinas: false, medianeras: false, toldo: false, tanque: false,
    baranda: ['#6b4226', '#26282b', '#2f5d46'],
  },
  'edificio-residencial': {
    etiqueta: 'Edificio residencial (4-5 pisos)', pisos: [4, 5], ancho: [11, 15], fondo: [12, 16], altoPiso: 3.0, bahia: [3.0, 3.8],
    plantas: ['garaje', 'garaje', 'local'], balcones: ['individual', 'individual', 'corrido', 'ninguno'], techos: ['plano'],
    paletas: PALETAS_URBANAS, reja: 0.8, persiana: 0.6, macetas: 0.35, esquinas: true, medianeras: false, toldo: false, tanque: true,
    baranda: ['#26282b', '#4b5563', '#7a8088'],
  },
  'local-comercial': {
    etiqueta: 'Local comercial del centro (3 pisos)', pisos: [2, 3], ancho: [7, 10], fondo: [12, 16], altoPiso: 3.3, bahia: [3.0, 3.6],
    plantas: ['local'], balcones: ['individual', 'individual', 'ninguno'], techos: ['plano'], paletas: PALETAS_URBANAS,
    reja: 0.2, persiana: 0.5, macetas: 0.3, esquinas: false, medianeras: true, toldo: true, tanque: true, baranda: ['#26282b', '#6b4226'],
  },
  'casa-moderna': {
    etiqueta: 'Casa moderna de barrio (2 pisos)', pisos: [2, 3], ancho: [8, 11], fondo: [11, 14], altoPiso: 3.0, bahia: [3.2, 4.0],
    plantas: ['garaje', 'garaje', 'casa'], balcones: ['corrido', 'individual', 'ninguno'], techos: ['plano'], paletas: PALETAS_MODERNAS,
    reja: 0.5, persiana: 0.2, macetas: 0.15, esquinas: false, medianeras: false, toldo: false, tanque: false, baranda: ['#2b3440', '#374151'],
  },
};

/** Negocios típicos de un pueblo colombiano: local en la planta baja con letrero grande y, a veces, vivienda o bodega arriba. */
const NEGOCIOS: Record<string, [string, Plantilla]> = {
  'negocio-tienda': ['Tienda de barrio', {
    nombres: ['Tienda La Esperanza', 'Tienda Doña Rosa', 'Víveres El Vecino', 'Tienda Mi Barrio', 'Abarrotes San José'], subtitulo: 'Víveres · Abarrotes · Gaseosas',
    letreros: [['#d62828', '#ffffff'], ['#f4a300', '#2b1d00'], ['#1d6fb8', '#ffffff'], ['#2a9d8f', '#ffffff']], frente: 'reja', interior: 'viveres', bandera: 'TIENDA',
  }],
  'negocio-panaderia': ['Panadería', {
    nombres: ['Panadería El Trigal', 'Pan y Café La Abuela', 'Panadería San Antonio', 'Delicias del Horno'], subtitulo: 'Pan caliente · Pasteles · Café',
    letreros: [['#7a3b1d', '#ffe9b0'], ['#b5651d', '#fff3d6'], ['#2f5d46', '#ffe9b0']], frente: 'vitrina', interior: 'pan', bandera: 'PAN',
  }],
  'negocio-cantina': ['Cantina o bar con billar', {
    nombres: ['Cantina La Hamaca', 'Bar El Rincón Paisa', 'Taberna El Parche', 'Bar Los Arrieros', 'Estanco Donde Chucho'], subtitulo: 'Cerveza fría · Billar · Música',
    letreros: [['#1b1f3b', '#ffd23f'], ['#6a1b1b', '#ffe08a'], ['#14532d', '#ffd23f']], frente: 'abierto', interior: 'botellas', bandera: 'BAR', terraza: true,
  }],
  'negocio-drogueria': ['Droguería', {
    nombres: ['Droguería San Jorge', 'Droguería La Salud', 'Droguería Mi Salud', 'Droguería El Sol', 'Droguería Girardota'], subtitulo: 'Medicamentos · Cosméticos · Servicio 24 h',
    letreros: [['#ffffff', '#0b8f3c'], ['#e8f5e9', '#0b6e30'], ['#0b8f3c', '#ffffff']], frente: 'vitrina', interior: 'botica', bandera: 'DROGUERÍA',
  }],
  'negocio-ferreteria': ['Ferretería', {
    nombres: ['Ferretería El Tornillo', 'Ferretería Girardota', 'Ferretería La Obra', 'Depósito El Maestro'], subtitulo: 'Herramientas · Pinturas · Materiales',
    letreros: [['#f2b705', '#1a1a1a'], ['#e85d04', '#ffffff'], ['#1d3557', '#ffd23f']], frente: 'abierto', interior: 'herramientas', bandera: 'FERRETERÍA',
  }],
  'negocio-restaurante': ['Restaurante de corrientazo', {
    nombres: ['Restaurante Sabor Paisa', 'Corrientazo Doña Marta', 'Asadero El Fogón', 'Fonda La Antioqueña', 'Bandeja Paisa El Arriero'], subtitulo: 'Almuerzos · Bandeja paisa · Jugos naturales',
    letreros: [['#a3382c', '#ffe9b0'], ['#2f5d46', '#fff3c4'], ['#3b2a1c', '#ffd23f']], frente: 'vitrina', interior: 'mesas', bandera: 'COMIDA', terraza: true,
  }],
  'negocio-peluqueria': ['Peluquería o barbería', {
    nombres: ['Peluquería Estilo Paisa', 'Barbería El Corte', 'Salón de Belleza Luna', 'Barbería Los Patrones'], subtitulo: 'Corte · Barba · Manicure',
    letreros: [['#222222', '#f5c518'], ['#5b2a86', '#ffffff'], ['#0b6e99', '#ffffff']], frente: 'vitrina', interior: 'peluqueria', bandera: 'BARBERÍA',
  }],
  'negocio-carniceria': ['Carnicería', {
    nombres: ['Carnicería El Novillo', 'Carnes La Finca', 'Carnicería San Pedro', 'Carnes Frías Don Luis'], subtitulo: 'Res · Cerdo · Pollo · Embutidos',
    letreros: [['#b3261e', '#ffffff'], ['#7a1010', '#ffe9b0']], frente: 'abierto', interior: 'carne', bandera: 'CARNES',
  }],
  'negocio-fruver': ['Frutería y verduras', {
    nombres: ['Fruver La Cosecha', 'Frutas El Campo', 'Fruver Doña Lucía', 'Plaza Fresca'], subtitulo: 'Frutas · Verduras · Hortalizas',
    letreros: [['#2e8b3d', '#fff7b0'], ['#f28c28', '#ffffff']], frente: 'abierto', interior: 'frutas', bandera: 'FRUVER',
  }],
  'negocio-papeleria': ['Papelería y miscelánea', {
    nombres: ['Papelería El Estudiante', 'Miscelánea Mi Rincón', 'Variedades Sol', 'Internet y Papelería Giro'], subtitulo: 'Útiles · Fotocopias · Minutos · Internet',
    letreros: [['#1e88e5', '#ffffff'], ['#e91e63', '#ffffff'], ['#00897b', '#ffffff']], frente: 'vitrina', interior: 'papel', bandera: 'PAPELERÍA',
  }],
  'negocio-heladeria': ['Heladería y café', {
    nombres: ['Heladería Polo Norte', 'Café del Parque', 'Heladería Dulce Vida', 'Café y Arepas El Fogón'], subtitulo: 'Helados · Cafés · Postres',
    letreros: [['#f8bbd0', '#ad1457'], ['#4e342e', '#ffe0b2'], ['#80deea', '#00695c']], frente: 'vitrina', interior: 'helado', bandera: 'HELADOS', terraza: true,
  }],
  'negocio-licorera': ['Licorera o estanco', {
    nombres: ['Licorera La 20', 'Estanco El Trago', 'Licores Don Pepe', 'Licorera Los Amigos'], subtitulo: 'Aguardiente · Ron · Cerveza',
    letreros: [['#111111', '#ffcc00'], ['#0d3b66', '#faf0ca']], frente: 'reja', interior: 'licor', bandera: 'LICORES',
  }],
};
for (const [id, [etiqueta, negocio]] of Object.entries(NEGOCIOS)) {
  PATRONES[id] = {
    etiqueta: `Negocio: ${etiqueta}`, pisos: [1, 2], ancho: [8, 11], fondo: [11, 15], altoPiso: 3.7, bahia: [3.0, 3.6],
    plantas: ['local'], balcones: ['individual', 'ninguno'], techos: ['plano', 'plano', 'dosAguas'], paletas: [...PALETAS_URBANAS, ...PALETAS_TRADICIONALES],
    reja: 0.3, persiana: 0.5, macetas: 0.3, esquinas: false, medianeras: true, toldo: false, tanque: true, baranda: ['#26282b', '#6b4226', '#2f5d46'], negocio,
  };
}

export const TIPOLOGIAS: TipologiaInfo[] = Object.entries(PATRONES).map(([id, p]) => ({ id, etiqueta: p.etiqueta }));

function azarDe(semilla: number): () => number {
  let t = semilla >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const elegir = <T>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)];
const entre = (r: () => number, [a, b]: [number, number]): number => a + r() * (b - a);

type Pieza = Modelo['piezas'][number];

/** Acumula las piezas de un edificio y las funde por material al final (un puñado de mallas en vez de cientos). */
class Armador {
  readonly piezas: Pieza[] = [];

  caja(w: number, h: number, d: number, color: string, x: number, y: number, z: number): this {
    this.piezas.push({ g: new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), color });
    return this;
  }
  cilindro(r: number, h: number, color: string, x: number, y: number, z: number): this {
    this.piezas.push({ g: new THREE.CylinderGeometry(r, r, h, 14).translate(x, y + h / 2, z), color });
    return this;
  }
  /** Rectángulo vertical con textura; `rep` repite la textura hacia arriba (pisos). */
  plano(w: number, h: number, x: number, y: number, z: number, ry: number, mapa: THREE.Texture, repU = 1, repV = 1, color = '#ffffff', calado = false): this {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repU, uv.getY(i) * repV);
    g.rotateY(ry).translate(x, y + h / 2, z);
    this.piezas.push({ g, color, mapa, calado });
    return this;
  }
  /** Cuadrilátero libre (faldones del techo, toldo); la textura se mide en metros. */
  cuadro(a: number[], b: number[], c: number[], d: number[], mapa: THREE.Texture, metros: number, color = '#ffffff'): this {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / metros, ad = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) / metros;
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, ab, 0, ab, ad, 0, ad], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    this.piezas.push({ g, color, mapa });
    return this;
  }
  triangulo(a: number[], b: number[], c: number[], color: string): this {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    this.piezas.push({ g, color });
    return this;
  }

  fundir(): Pieza[] {
    const grupos = new Map<string, { g: THREE.BufferGeometry[]; muestra: Pieza }>();
    for (const p of this.piezas) {
      const clave = `${p.color}|${p.mapa?.uuid ?? ''}|${p.calado ? 1 : 0}`;
      const geo = p.g.index ? p.g.toNonIndexed() : p.g;
      for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(a)) geo.deleteAttribute(a);
      if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
      const g = grupos.get(clave) ?? grupos.set(clave, { g: [], muestra: p }).get(clave)!;
      g.g.push(geo);
    }
    return [...grupos.values()].map(({ g, muestra }) => ({ ...muestra, g: mergeGeometries(g)! }));
  }
}

/** Genera una casa o edificio del patrón `id`; la misma semilla da siempre el mismo edificio. */
export function tipologia(id: string, semilla: number): Modelo {
  const patron = PATRONES[id] ?? PATRONES['casa-tradicional'];
  const r = azarDe(semilla * 2654435761 + 11);

  // reglas: medidas, pisos, huecos, planta baja, balcón, techo y paleta
  const pisos = patron.pisos[0] + Math.floor(r() * (patron.pisos[1] - patron.pisos[0] + 1));
  const ancho = Math.round(entre(r, patron.ancho) * 2) / 2, fondo = Math.round(entre(r, patron.fondo) * 2) / 2;
  const bahias = Math.max(2, Math.round(ancho / entre(r, patron.bahia)));
  const planta = elegir(r, patron.plantas), balcon = elegir(r, patron.balcones), techo = elegir(r, patron.techos);
  const paleta = elegir(r, patron.paletas);
  const alto = pisos * patron.altoPiso, H = patron.altoPiso;
  const estilo: EstiloFachada = {
    ...paleta, reja: r() < patron.reja, persiana: r() < patron.persiana, vidrio: elegir(r, patron.vidrios ?? ['#8fb8d0', '#9cc4d8', '#7fa9c2']),
  };
  const conBalcon = balcon !== 'ninguno' && pisos > 1;
  const tex = crearFachadas(estilo, ancho, fondo, H, bahias, planta, conBalcon, Math.floor(r() * 1000), elegir(r, ['#c0392b', '#2f5d46', '#25508a', '#d68910']));

  // negocio: la planta baja se repinta con letrero, vitrina y mercancía
  let bandera: THREE.Texture | null = null;
  if (patron.negocio) {
    const n = patron.negocio, [fondoL, tinta] = elegir(r, n.letreros);
    const def: NegocioDef = { nombre: elegir(r, n.nombres), subtitulo: n.subtitulo, fondo: fondoL, tinta, frente: n.frente, interior: n.interior, bandera: n.bandera };
    const nt = fachadaNegocio(def, ancho, H, estilo, Math.floor(r() * 1000));
    tex.baja.dispose();
    tex.baja = nt.baja;
    bandera = nt.bandera;
  }

  const a = new Armador();
  // cuerpo y fachadas
  a.piezas.push({ g: new THREE.BoxGeometry(ancho, alto, fondo).translate(0, alto / 2, 0), color: '#ffffff', mapa: tex.ciego });
  const uvCuerpo = a.piezas[0].g.getAttribute('uv');
  const tile = 3, caras: [number, number][] = [[fondo, alto], [fondo, alto], [ancho, fondo], [ancho, fondo], [ancho, alto], [ancho, alto]];
  for (let c = 0; c < 6; c++) for (let v = 0; v < 4; v++) { const i = c * 4 + v; uvCuerpo.setXY(i, uvCuerpo.getX(i) * caras[c][0] / tile, uvCuerpo.getY(i) * caras[c][1] / tile); }
  const zf = fondo / 2 + 0.03;
  a.plano(ancho, H, 0, 0, zf, 0, tex.baja);
  if (pisos > 1) a.plano(ancho, H * (pisos - 1), 0, H, zf, 0, tex.alta, 1, pisos - 1);
  for (const lado of [-1, 1]) {
    if (patron.medianeras) a.plano(fondo, alto, lado * (ancho / 2 + 0.03), 0, 0, lado * Math.PI / 2, tex.ciego, fondo / tile, alto / tile);
    else a.plano(fondo, H * pisos, lado * (ancho / 2 + 0.03), 0, 0, lado * Math.PI / 2, tex.lateral, 1, pisos);
  }
  a.plano(ancho, alto, 0, 0, -zf, Math.PI, tex.ciego, ancho / tile, alto / tile);

  // remates de fachada: molduras entre pisos y esquinas
  for (let f = 1; f < pisos; f++) a.caja(ancho + 0.08, 0.12, 0.1, CLARO, 0, f * H - 0.06, fondo / 2 + 0.05);
  if (patron.esquinas) for (const x of [-1, 1]) a.caja(0.32, alto, 0.32, CLARO, x * ancho / 2, 0, fondo / 2);

  // balcones: losa, baranda calada y, a veces, macetero con flores
  if (conBalcon) {
    const colorBaranda = elegir(r, patron.baranda.length ? patron.baranda : ['#26282b']);
    const vuelo = balcon === 'corrido' ? 1.2 : 1.0;
    const huecos = balcon === 'corrido' ? [{ x: 0, w: ancho * 0.96 }] : tex.bahias.map(x => ({ x, w: Math.min(ancho / bahias * 0.8, 2.6) }));
    for (let f = 1; f < pisos; f++) {
      for (const { x, w } of huecos) {
        const y = f * H;
        a.caja(w, 0.14, vuelo, CLARO, x, y - 0.14, fondo / 2 + vuelo / 2);
        a.plano(w, 1.0, x, y, fondo / 2 + vuelo, 0, tex.baranda, w, 1, colorBaranda, true);
        for (const s of [-1, 1]) a.plano(vuelo, 1.0, x + s * w / 2, y, fondo / 2 + vuelo / 2, s * Math.PI / 2, tex.baranda, vuelo, 1, colorBaranda, true);
        if (r() < patron.macetas) {
          a.caja(w * 0.9, 0.2, 0.24, '#7a4a2b', x, y + 0.95, fondo / 2 + vuelo);
          a.caja(w * 0.86, 0.22, 0.2, '#3f8a3c', x, y + 1.15, fondo / 2 + vuelo);
          for (let k = 0; k < Math.floor(w * 3); k++) a.caja(0.12, 0.12, 0.12, elegir(r, ['#e53935', '#ec407a', '#fdd835', '#ff7043', '#f5f5f5']), x + (r() - 0.5) * w * 0.8, y + 1.35, fondo / 2 + vuelo + (r() - 0.5) * 0.1);
        }
      }
    }
  }

  // corredor: losa, columnas de madera y alero de teja delante de la fachada (sin balcones encima)
  if (patron.corredor && pisos === 1 && planta === 'casa') {
    const prof = 2.3, zc = fondo / 2 + prof, y = H - 0.15;
    a.caja(ancho, 0.12, prof, '#b9b3a6', 0, 0, fondo / 2 + prof / 2);
    const n = Math.max(3, Math.round(ancho / 2.6) + 1);
    for (let k = 0; k < n; k++) a.caja(0.22, y, 0.22, '#6b4226', -ancho / 2 + 0.3 + k * (ancho - 0.6) / (n - 1), 0, zc - 0.2);
    a.caja(ancho, 0.2, 0.24, '#5b3a22', 0, y, zc - 0.2);
    a.cuadro([-ancho / 2 - 0.3, y + 0.2, zc + 0.3], [ancho / 2 + 0.3, y + 0.2, zc + 0.3], [ancho / 2 + 0.3, H + 0.25, fondo / 2], [-ancho / 2 - 0.3, H + 0.25, fondo / 2], tex.teja, 0.9);
  }

  // bandera del negocio (perpendicular a la fachada, a la altura del letrero) y terraza con mesas y sombrillas en el andén
  let extra = 0;
  if (bandera && patron.negocio) {
    a.caja(0.05, 0.05, 0.9, '#26282b', ancho / 2 - 0.2, H - 0.3, fondo / 2 + 0.45);
    a.plano(1.1, 0.5, ancho / 2 - 0.2, H - 0.85, fondo / 2 + 0.6, Math.PI / 2, bandera);
    if (patron.negocio.terraza) {
      extra = 2;
      const colorSombrilla = elegir(r, ['#c0392b', '#f4a300', '#1d6fb8', '#2f5d46', '#f5f5f5']);
      const n = Math.max(2, Math.floor((ancho - 3) / 3));
      for (let k = 0; k < n; k++) {
        const mx = -ancho / 2 + 1.5 + k * ((ancho - 3) / Math.max(1, n - 1)), mz = fondo / 2 + 1.9;
        a.cilindro(0.45, 0.06, '#f1ede3', mx, 0.72, mz).cilindro(0.05, 0.72, '#6b7280', mx, 0, mz);
        for (const [dx, dz] of [[0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75]]) a.caja(0.4, 0.45, 0.4, '#8a5a35', mx + dx, 0, mz + dz);
        a.cilindro(0.04, 2.1, '#d1d5db', mx, 0, mz);
        a.piezas.push({ g: new THREE.ConeGeometry(1.15, 0.45, 12).translate(mx, 2.1 + 0.22, mz), color: colorSombrilla });
      }
    }
  }

  // toldo de los locales
  if (patron.toldo && planta === 'local') {
    const x0 = -ancho / 2 + 0.2, x1 = ancho / 2 - ancho / bahias - 0.1;
    a.cuadro([x0, H - 0.2, fondo / 2 + 0.05], [x1, H - 0.2, fondo / 2 + 0.05], [x1, 2.45, fondo / 2 + 1.25], [x0, 2.45, fondo / 2 + 1.25], tex.toldo, 2);
  }

  // techo
  if (techo === 'dosAguas' && patron.cumbreAlFrente) {
    // cumbrera paralela a la fachada, alero ancho con las puntas de los cabrios de madera a la vista
    const alero = 1.0, X2 = ancho / 2 + 0.4, D2 = fondo / 2 + alero, subida = fondo * 0.24;
    const y0 = alto - subida * alero / D2, yc = y0 + subida;
    a.cuadro([-X2, y0, D2], [X2, y0, D2], [X2, yc, 0], [-X2, yc, 0], tex.teja, 0.9);
    a.cuadro([X2, y0, -D2], [-X2, y0, -D2], [-X2, yc, 0], [X2, yc, 0], tex.teja, 0.9);
    const hf = subida * (fondo / 2) / D2;
    for (const s of [-1, 1]) a.triangulo([s * (ancho / 2 + 0.02), alto, -fondo / 2], [s * (ancho / 2 + 0.02), alto, fondo / 2], [s * (ancho / 2 + 0.02), alto + hf, 0], paleta.pared);
    a.caja(X2 * 2, 0.18, 0.2, '#7a3520', 0, yc - 0.05, 0);
    for (const s of [-1, 1]) {
      a.caja(X2 * 2, 0.08, 0.1, '#6b4226', 0, alto - 0.12, s * (fondo / 2 + alero * 0.97));
      for (let x = -X2 + 0.25; x < X2; x += 0.5) a.caja(0.07, 0.09, alero, '#8a5a32', x, alto - 0.2, s * (fondo / 2 + alero / 2));
    }
    // canoa de lámina en el borde del alero del frente y bajante blanca hasta el andén
    a.caja(X2 * 2, 0.1, 0.14, '#aeb4ba', 0, y0 - 0.1, D2 + 0.05);
    for (const s of [-1, 1]) a.cilindro(0.045, y0 - 0.1, '#e6e6e0', s * (ancho / 2 - 0.1), 0, fondo / 2 + 0.07);
  } else if (techo === 'dosAguas') {
    const alero = 0.6, extremo = 0.4, W2 = ancho / 2 + alero, L2 = fondo / 2 + extremo, subida = ancho * 0.26;
    const y0 = alto - subida * alero / W2, yc = y0 + subida;
    a.cuadro([-W2, y0, -L2], [-W2, y0, L2], [0, yc, L2], [0, yc, -L2], tex.teja, 0.9);
    a.cuadro([W2, y0, L2], [W2, y0, -L2], [0, yc, -L2], [0, yc, L2], tex.teja, 0.9);
    const hf = subida * (ancho / 2) / W2;
    for (const s of [-1, 1]) a.triangulo([-ancho / 2, alto, s * (fondo / 2 + 0.02)], [ancho / 2, alto, s * (fondo / 2 + 0.02)], [0, alto + hf, s * (fondo / 2 + 0.02)], paleta.pared);
    a.caja(0.2, 0.18, L2 * 2, '#7a3520', 0, yc - 0.05, 0);                 // cumbrera
    // canoas de lámina en los dos aleros y bajante blanca al frente
    for (const s of [-1, 1]) a.caja(0.14, 0.1, L2 * 2, '#aeb4ba', s * (W2 + 0.05), y0 - 0.1, 0);
    a.cilindro(0.045, y0 - 0.1, '#e6e6e0', ancho / 2 + 0.08, 0, fondo / 2 - 0.15);
  } else {
    const p = 0.85;
    a.caja(ancho + 0.1, p, 0.2, paleta.pared, 0, alto, fondo / 2).caja(ancho + 0.1, p, 0.2, paleta.pared, 0, alto, -fondo / 2)
      .caja(0.2, p, fondo, paleta.pared, ancho / 2, alto, 0).caja(0.2, p, fondo, paleta.pared, -ancho / 2, alto, 0);
    a.caja(ancho + 0.34, 0.2, 0.36, CLARO, 0, alto + p, fondo / 2).caja(ancho + 0.34, 0.2, 0.36, CLARO, 0, alto + p, -fondo / 2)
      .caja(0.36, 0.2, fondo, CLARO, ancho / 2, alto + p, 0).caja(0.36, 0.2, fondo, CLARO, -ancho / 2, alto + p, 0);
    a.caja(ancho - 0.2, 0.12, fondo - 0.2, '#8e959c', 0, alto, 0);
    // bajantes de PVC por las esquinas del frente y gárgolas por el antepecho
    for (const s of [-1, 1]) {
      a.cilindro(0.05, alto - 0.1, '#e6e6e0', s * (ancho / 2 - 0.08), 0, fondo / 2 + 0.08);
      a.caja(0.16, 0.12, 0.3, '#8e959c', s * (ancho / 2 - 0.08), alto + 0.05, fondo / 2 + 0.1);
    }
    // la placa de concreto lleva lo de siempre: tinaco negro sobre su base, antena de TV, varillas de la próxima planta y la salida de la escalera
    const tx = ancho * (r() < 0.5 ? -0.2 : 0.2), tz = -fondo * 0.2;
    if (!patron.tanque) a.cilindro(0.55, 1.1, '#1d1f22', tx, alto + 0.12, tz).cilindro(0.2, 0.12, '#1d1f22', tx, alto + 1.22, tz).caja(1.3, 0.12, 1.3, '#9aa0a6', tx, alto + 0.12, tz - 0.0).cilindro(0.04, 0.12, '#9aa0a6', tx, alto, tz);
    if (r() < 0.55) {
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const vx = dx * (ancho / 2 - 0.35), vz = dz * (fondo / 2 - 0.35);
        a.caja(0.5, 0.5, 0.5, '#8e8a84', vx, alto, vz);
        for (const [ox, oz] of [[-0.15, -0.15], [0.15, -0.15], [0.15, 0.15], [-0.15, 0.15]]) a.cilindro(0.015, 0.9, '#5a3a24', vx + ox, alto + 0.5, vz + oz);
      }
    }
    if (r() < 0.5) {
      const ax = -ancho * 0.3, az = fondo * 0.25;
      a.cilindro(0.025, 2.4, '#9aa0a6', ax, alto, az).caja(1.0, 0.04, 0.04, '#9aa0a6', ax, alto + 2.0, az).caja(0.7, 0.04, 0.04, '#9aa0a6', ax, alto + 1.6, az);
    }
    if (!patron.tanque && pisos > 1 && r() < 0.6) a.caja(1.6, 2.2, 1.8, paleta.pared, ancho * 0.25, alto, fondo * 0.22).caja(1.8, 0.14, 2.0, CLARO, ancho * 0.25, alto + 2.2, fondo * 0.22);
    if (patron.tanque) {
      a.cilindro(1.1, 1.9, '#2f6f9f', -ancho * 0.22, alto + 0.6, -fondo * 0.2);
      for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) a.caja(0.12, 0.6, 0.12, '#6b7280', -ancho * 0.22 + dx, alto, -fondo * 0.2 + dz);
      a.caja(2.8, 2.4, 3, paleta.pared, ancho * 0.22, alto, -fondo * 0.15).caja(3.1, 0.2, 3.3, CLARO, ancho * 0.22, alto + 2.4, -fondo * 0.15);
    }
  }

  return { piezas: a.fundir(), radio: Math.max(ancho, fondo) * 0.75 + 2 + extra, losa: [ancho + 2.5, fondo + 2.5 + extra * 2] };
}
