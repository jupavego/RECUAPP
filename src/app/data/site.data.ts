// site.data.ts
// Datos editoriales del sitio — única fuente de verdad para textos, links y contacto.
// Modificar aquí propaga el cambio a footer y cualquier otro consumidor.

export const SITE = {
  name:        'RECUAPP',
  tagline:     'Lienzo base',
  description: 'Descripción corta de la aplicación.',

  contact: {
    email: '',   // ej: 'hola@miapp.com'
  },

  legal: {
    developer:    'Tu Estudio',
    developerUrl: '#',
  },
} as const;
