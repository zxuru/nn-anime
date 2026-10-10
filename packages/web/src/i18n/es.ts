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

  'search.title': 'Buscar',
  'search.field': 'Buscar por título',
  'search.placeholder': 'Escribe un título…',
  'search.results': 'Resultados',
  'search.empty': 'Nada coincide con «{query}». Prueba con menos palabras.',
  'search.emptyNoQuery': 'Escribe un título para empezar. Los resultados salen de cada proveedor.',
  'search.provider': 'Origen: {provider}',
  'search.year': '{year}',
  'search.loading': 'Buscando…',
  'search.resultsCount': '{count} resultados de {providers} proveedores.',
  'search.noProviders': 'No hay ningún proveedor activo para esta búsqueda.',
  'search.providerFailed': '{provider}: {message}',
  'search.failed': 'No se pudo buscar: {message}',
  'search.alsoIn': 'También en {count} proveedores',

  'reco.title': 'Recomendado para ti',
  'reco.loading': 'Buscando qué recomendarte…',
  'reco.error': 'No se pudieron cargar las recomendaciones: {message}',
  'reco.empty': 'Todavía no hay nada que recomendar. Busca algo y vuelve.',
  'reco.coldStart': 'Sin historial todavía: esto es lo más popular del catálogo.',
  'reco.personalized': 'Ordenado por lo que has visto y buscado.',
  'reco.showScore': 'Ver el detalle',
  'reco.hideScore': 'Ocultar el detalle',
  'reco.score': 'Puntuación: {score}',
  'player.label': 'Reproductor de video',
  'player.tracks': 'Subtítulos disponibles: {count}.',
  'player.mode': 'Modo',
  'player.mode.sub': 'Subtitulado',
  'player.mode.dub': 'Doblado',
  'player.play': 'Reproducir',
  'player.pause': 'Pausa',
  'player.back': 'Atrás 10 s',
  'player.forward': 'Adelante 10 s',
  'player.mute': 'Silenciar',
  'player.unmute': 'Quitar silencio',
  'player.fullscreen': 'Pantalla completa',
  'player.loading': 'Cargando el video…',
  'player.error': 'No se pudo reproducir: {message}',
  'player.shortcuts':
    'Espacio o Enter: pausa. Flechas: 10 s y volumen. M: silencio. F: pantalla completa.',
  'player.attribution': 'Reproducción HLS con hls.js (licencia Apache 2.0).',
  'detail.synopsis': 'Sinopsis',
  'detail.meta': 'Año {year} · {status}',
  'detail.status.airing': 'en emisión',
  'detail.status.finished': 'terminado',
  'detail.status.upcoming': 'próximamente',
  'detail.status.unknown': 'estado desconocido',
  'detail.genres': 'Géneros',
  'detail.studios': 'Estudios',
  'detail.episodes': 'Episodios',
  'detail.episode': 'Episodio {number}',
  'detail.mode.sub': 'subtitulado',
  'detail.mode.dub': 'doblado',
  'detail.mode.raw': 'original',
  'detail.modes': 'Modos disponibles',
  'detail.modeUnavailable': 'Este proveedor no ofrece {mode}.',
  'detail.noEpisodes': 'Este título no tiene episodios todavía.',
  'detail.favorite.add': 'Añadir a favoritos',
  'detail.favorite.remove': 'Quitar de favoritos',
  'detail.loading': 'Cargando la ficha…',
  'detail.error': 'No se pudo cargar la ficha: {message}',
  'detail.retry': 'Reintentar',
  'detail.notFound': 'Ese título no está en el proveedor.',
  'settings.pending': 'Aquí irán los proveedores, las rutas de datos y el tema.',

  'notFound.title': 'Esa ruta no existe',
  'notFound.body': 'La dirección {path} no corresponde a ninguna pantalla.',
  'notFound.back': 'Volver al inicio',
}
