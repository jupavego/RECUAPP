// site.data.ts
// Datos editoriales del sitio — única fuente de verdad para textos, links y contacto.
// Modificar aquí propaga el cambio a footer y cualquier otro consumidor.

export const SITE = {
  name:        'RECUAPP',
  tagline:     'Edición Girardota',
  description: 'Descripción corta de la aplicación.',
  /** portada: la razón de ser del proyecto, sin tecnicismos */
  purpose: {
    lema:        'Un territorio se transforma cuando su gente conoce el camino.',
    descripcion: 'RECUAPP hace visible lo que se prometió para Girardota: qué se va a hacer, quién responde por ello y cómo avanza. Para que el plan de desarrollo deje de ser un documento y se vuelva algo que todos pueden leer, seguir y acompañar.',
  },

  contact: {
    email: '',   // ej: 'hola@miapp.com'
  },

  legal: {
    developer:    'Tu Estudio',
    developerUrl: '#',
  },
} as const;
