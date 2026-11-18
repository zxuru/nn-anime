/**
 * Las secciones de Ajustes.
 *
 * La página era una lista plana de doce bloques y el índice existía sólo en la
 * cabeza de quien la había escrito. Aquí vive la lista corta —ocho secciones— y
 * el nombre de cada una; el índice y las secciones se pintan de esta misma
 * fuente, así que un enlace no puede apuntar a un `id` que la página no declara.
 *
 * Los `id` son parte de la dirección: `#sistema` se puede guardar en un marcador o
 * enlazar desde otra pantalla. Por eso son cortos y no cambian con el texto del
 * título; el título sí, que vive en el catálogo de i18n.
 */

export interface SeccionAjustes {
  readonly id: string
  /** La clave del catálogo, no el texto: el idioma no se decide aquí. */
  readonly titulo: string
}

/**
 * Las ocho secciones, en el orden en que se leen.
 *
 * El orden va de lo que hace funcionar la aplicación a lo que sólo la explica:
 * primero las fuentes, luego cómo se ve un episodio, dónde se guarda lo que se
 * descarga, la copia del perfil, la apariencia, lo que se comparte fuera, las
 * rutas del disco y, al final, los tutoriales.
 */
export const SECCIONES = {
  fuentes: { id: 'fuentes', titulo: 'settings.section.fuentes' },
  reproduccion: { id: 'reproduccion', titulo: 'settings.section.reproduccion' },
  descargas: { id: 'descargas', titulo: 'settings.section.descargas' },
  perfil: { id: 'perfil', titulo: 'settings.section.perfil' },
  apariencia: { id: 'apariencia', titulo: 'settings.section.apariencia' },
  privacidad: { id: 'privacidad', titulo: 'settings.section.privacidad' },
  sistema: { id: 'sistema', titulo: 'settings.section.sistema' },
  guia: { id: 'guia', titulo: 'settings.section.guia' },
} as const satisfies Record<string, SeccionAjustes>

export type IdSeccion = (typeof SECCIONES)[keyof typeof SECCIONES]['id']

/** Las secciones en orden, para el índice y para recorrerlas. */
export const SECCIONES_AJUSTES = Object.values(SECCIONES)

/**
 * Sólo los ids, en el mismo orden que el índice.
 *
 * Es una constante de módulo y no se construye en cada render: el observador del
 * índice se monta una vez con esta lista, y una lista nueva en cada pintado lo
 * volvería a montar sin que nada haya cambiado.
 */
export const IDS_SECCIONES: readonly IdSeccion[] = SECCIONES_AJUSTES.map((seccion) => seccion.id)
