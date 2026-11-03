/**
 * Escala de los activos del mapa 3D. Las huellas de las construcciones son las del catastro (1×) y sus pisos se agrandan 2,2×
 * (ESCALA_CATASTRO); las vías se dibujan ~1,9× más anchas que las reales. Personas y vehículos usan un único factor, cercano a
 * ese, para que sigan la proporción real entre sí y con la calle (un auto ocupa ~1/4 de una calle local, una persona la mitad
 * de un piso) en vez de crecer cada uno por su lado.
 */
export const ESCALA_ACTIVOS = 1.8;

/** Medidas reales (m) a las que se normalizan los modelos: se multiplican por ESCALA_ACTIVOS al dibujarlos. */
export const LARGO_REAL = { auto: 4.5, taxi: 4.5, campero: 4.7, bus: 12, camion: 18, moto: 2 } as const;
export const ALTO_PERSONA_REAL = 1.7;
