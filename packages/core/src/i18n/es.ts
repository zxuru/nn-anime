/**
 * Catálogo en español. Es el idioma por defecto y el respaldo de todos los
 * demás: una clave que falte en otro catálogo se busca aquí.
 *
 * El tipo se importa con `import type`, así que no hay ciclo en tiempo de
 * ejecución entre este archivo y `i18n.ts`.
 */

import type { Messages } from '../i18n'

export const messages: Messages = {
  'app.name': 'nn-anime',
  'error.config.missingHome':
    'No se pudo determinar el directorio personal: falta HOME y no se indicó ruta para {dirs}.',
}
