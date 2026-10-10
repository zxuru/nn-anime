/**
 * Catálogo español de la interfaz.
 *
 * Todo texto visible sale de aquí. Una cadena incrustada en un componente es un
 * error de revisión: impide añadir un idioma sin tocar el componente.
 */

import type { Messages } from '@nn-anime/core/i18n'

export const messages: Messages = {
  'app.name': 'nn-anime',

  'nav.home': 'Inicio',
  'nav.search': 'Buscar',
  'nav.settings': 'Ajustes',

  'home.title': 'Inicio',
  'home.pending': 'Aquí irán las recomendaciones, lo que estabas viendo y las tendencias.',

  'search.title': 'Buscar',
  'search.field': 'Buscar por título',
  'search.placeholder': 'Escribe un título…',
  'search.results': 'Resultados',
  'search.empty': 'Nada coincide con «{query}». Prueba con menos palabras.',
  'search.emptyNoQuery': 'Escribe un título para empezar. Los resultados salen de cada proveedor.',
  'search.provider': 'Origen: {provider}',
  'search.year': '{year}',
  'search.loading': 'Buscando…',

  'detail.pending': 'Aquí irá el detalle del título y su lista de episodios.',
  'watch.pending': 'Aquí irá el reproductor.',
  'settings.pending': 'Aquí irán los proveedores, las rutas de datos y el tema.',

  'notFound.title': 'Esa ruta no existe',
  'notFound.body': 'La dirección {path} no corresponde a ninguna pantalla.',
  'notFound.back': 'Volver al inicio',
}
