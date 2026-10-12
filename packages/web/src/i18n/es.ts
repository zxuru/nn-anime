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

  // Lo que va en el título de la pestaña mientras no hay dato que poner.
  'title.loading': 'Cargando…',
  'title.error': 'No se pudo cargar',

  /*
   * Cómo se cuenta un fallo de red.
   *
   * La clase la decide `api/fallo.ts` —sin conexión, el proveedor no responde, la
   * sesión no vale— y el texto vive aquí, con el resto de la interfaz. Antes esto
   * era una sola línea con el mensaje del cliente —«GET /api/anime/… respondió
   * 502»—, que nombra el método, la ruta y el código, y ninguna de las tres cosas
   * explica qué pasó ni qué hacer.
   *
   * Cada clase tiene **título** —qué pasó— y **cuerpo** —qué hacer—. El resumen es
   * la frase corta para los sitios donde no cabe un aviso entero, como la línea
   * del anuncio de la búsqueda.
   */
  'error.retry': 'Reintentar',
  'error.technical': 'Detalles técnicos',
  'error.title.sinConexion': 'Sin conexión con nn-anime',
  'error.body.sinConexion':
    'El navegador no pudo hablar con el servidor. Comprueba que nn-anime siga abierto y vuelve a intentarlo.',
  'error.summary.sinConexion': 'sin conexión con el servidor',
  'error.title.lento': 'El servidor tardó demasiado',
  'error.body.lento':
    'La petición pasó del tiempo límite. Puede ser la red o el proveedor, que va lento. Reintentar suele bastar.',
  'error.summary.lento': 'el servidor tardó demasiado',
  'error.title.sesion': 'La sesión de este navegador no vale',
  'error.body.sesion':
    'Entra por la dirección de arranque que imprime el CLI. La sesión viaja en una cookie que no se hereda entre navegadores.',
  'error.summary.sesion': 'la sesión de este navegador no vale',
  'error.title.noExiste': 'Ese título no está',
  'error.body.noExiste':
    'El proveedor no conoce esta referencia. Puede que la haya retirado o que le haya cambiado el nombre.',
  'error.summary.noExiste': 'el proveedor no conoce esa referencia',
  'error.title.proveedor': 'El proveedor no responde',
  'error.body.proveedor':
    'nn-anime está bien: es el sitio de origen el que falló o no contestó. Reintenta en un momento.',
  'error.summary.proveedor': 'el proveedor no respondió',
  'error.title.servidor': 'Fallo del servidor',
  'error.body.servidor':
    'nn-anime no pudo completar la operación. Reintenta; si sigue igual, los detalles técnicos dicen dónde mirar.',
  'error.summary.servidor': 'el servidor falló',
  'error.title.peticion': 'La petición no valía',
  'error.body.peticion':
    'El servidor la rechazó. Si el mensaje de abajo no lo explica, es un fallo de la aplicación.',
  'error.summary.peticion': 'la petición no valía',
  'error.title.forma': 'Respuesta inesperada',
  'error.body.forma':
    'El servidor contestó algo que la interfaz no entiende. Suele pasar cuando un proveedor cambia su web.',
  'error.summary.forma': 'la respuesta no tenía la forma esperada',
  'error.title.desconocido': 'Algo falló',
  'error.body.desconocido':
    'No se pudo completar la operación. Reintenta; si vuelve a pasar, los detalles técnicos ayudan a mirarlo.',
  'error.summary.desconocido': 'algo falló',

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
  'search.resultsCountOne': '1 resultado de {providers} proveedores.',
  'search.noProviders': 'No hay ningún proveedor activo para esta búsqueda.',
  'search.providerFailed': '{provider}: {message}',
  'search.failed': 'No se pudo buscar: {message}',
  'search.alsoIn': 'También en',
  'search.alsoInItem': '{title} en {provider}',

  'home.loading': 'Cargando tu inicio…',
  'home.refreshing': 'Actualizando…',
  'home.refreshedNow': 'Actualizado ahora mismo',
  'home.refreshed': 'Actualizado hace {minutes} min',
  'home.ticker': 'Lo más visto ahora',
  'home.featured.tag': 'Destacado',
  'home.featured.play': 'Reproducir el episodio {number}',
  'home.top': 'Top de la fuente',
  'home.top.meta': 'El orden de la fuente',
  'home.top.more': 'Mostrar más',
  'home.top.empty': 'Ningún proveedor activo publica un top.',
  'home.continue.meta': 'Retoma donde lo dejaste',
  'home.episode': 'Ep. {number}',
  'home.remaining': 'Quedan {time}',
  'home.favorites.meta': 'Lo que guardaste',
  'home.genres': 'Explorar por género',
  'home.genres.meta': 'Del catálogo que tienes',
  'home.genres.empty': 'Todavía no hay géneros: aparecen cuando se cachean títulos.',
  'home.explain': '¿Por qué estas recomendaciones?',
  'home.continue': 'Continuar viendo',
  'home.continue.empty': 'Nada a medias. Lo que empieces aparecerá aquí.',
  'home.favorites': 'Tus favoritos',
  'home.favorites.empty':
    'Todavía no has marcado ninguno. La estrella está en la ficha de cada título.',
  'home.feed': 'Novedades',
  'home.feed.meta': 'Lo último que publica la fuente',
  'home.feed.empty': 'Ningún proveedor activo publica novedades.',
  'home.recent': 'Último añadido',
  'home.recent.meta': 'Lo último que conoce esta aplicación',
  'home.recent.empty':
    'Todavía no hay nada: aparece lo que busques y lo que abras. Un proveedor con novedades llena esta fila solo.',
  'home.more': 'y {count} más',
  'home.resume': 'Seguir en {time}',
  'settings.title': 'Ajustes',
  'settings.loading': 'Cargando los ajustes…',
  'settings.security.title': 'Antes de copiar un plugin, lee esto',
  'settings.security.body':
    'Los plugins se ejecutan sin sandbox, con tus permisos. Un plugin puede leer y escribir lo mismo que tú. Cópialos sólo si sabes de dónde vienen.',
  'settings.security.open': 'Leer el aviso de seguridad',
  'settings.security.close': 'Cerrar',
  'settings.security.raw': 'Ver SECURITY.md entero',
  'settings.security.loading': 'Cargando el aviso de seguridad…',
  'settings.providers': 'Proveedores',
  'settings.providers.empty': 'No hay ningún proveedor instalado.',
  'settings.provider.active': 'activo',
  'settings.provider.rejected': 'rechazado',
  'settings.provider.preferred': 'preferido',
  'settings.priority.body':
    'Cuando la misma obra está en varios, la tarjeta de la búsqueda lleva al primero de la lista. El orden se guarda solo.',
  'settings.priority.up': 'Subir {provider}',
  'settings.priority.down': 'Bajar {provider}',
  'settings.priority.moveUp': 'Subir',
  'settings.priority.moveDown': 'Bajar',
  'settings.cap.search': 'búsqueda',
  'settings.cap.sub': 'subtitulado',
  'settings.cap.dub': 'doblado',
  'settings.cap.trending': 'tendencias',
  'settings.cap.feed': 'novedades',
  'settings.cap.none': 'sin capacidades',
  'settings.register.title': 'Registrar un proveedor',
  'settings.register.body':
    'Rellena la dirección del sitio y sus rutas. nn-anime escribe el plugin, lo carga y lo deja activo al guardar, sin reiniciar.',
  'settings.register.identity': 'Quién es',
  'settings.register.id': 'Identificador',
  'settings.register.idHint': 'minúsculas y guiones; será el nombre del archivo',
  'settings.register.name': 'Nombre visible',
  'settings.register.baseUrl': 'Dirección base',
  'settings.register.endpoints': 'Rutas del sitio',
  'settings.register.endpointsHint':
    'Relativas a la dirección base. {query} es lo que se busca y {ref} el título o el episodio.',
  'settings.register.endpoint.search': 'Búsqueda',
  'settings.register.endpoint.anime': 'Detalle',
  'settings.register.endpoint.episodes': 'Episodios',
  'settings.register.endpoint.stream': 'Reproducción',
  'settings.register.endpoint.trending': 'Tendencias (opcional)',
  'settings.register.capabilities': 'Qué sabe hacer',
  'settings.register.cap.sub': 'Subtitulado',
  'settings.register.cap.dub': 'Doblado',
  'settings.register.advanced': 'Dónde está cada dato (avanzado)',
  'settings.register.advancedHint':
    'Rutas con puntos dentro del JSON de la respuesta. Se dejan como están si el sitio usa los nombres habituales.',
  'settings.register.field.searchItems': 'Lista de resultados',
  'settings.register.field.searchId': 'Identificador del título',
  'settings.register.field.searchTitle': 'Título',
  'settings.register.field.animeTitle': 'Título, en el detalle',
  'settings.register.field.animeGenres': 'Géneros',
  'settings.register.field.animeStudios': 'Estudios',
  'settings.register.field.episodeItems': 'Lista de episodios',
  'settings.register.field.episodeNumber': 'Número de episodio',
  'settings.register.field.episodeTitle': 'Título del episodio',
  'settings.register.field.streamUrl': 'URL del vídeo',
  'settings.register.submit': 'Guardar proveedor',
  'settings.register.saving': 'Guardando…',
  'settings.register.ok': '«{name}» guardado y activo.',
  'settings.register.failed': 'No se pudo guardar: {message}',
  'settings.paths': 'Dónde vive cada cosa',
  'settings.paths.data': 'Datos',
  'settings.paths.config': 'Configuración',
  'settings.paths.cache': 'Caché',
  'settings.mpv': 'Reproductor externo',
  'settings.mpv.yes': 'mpv disponible, versión {version}.',
  'settings.mpv.no': 'No se encontró mpv: se reproduce en el navegador.',
  'settings.theme': 'Tema',
  'settings.theme.system': 'El del sistema',
  'settings.theme.dark': 'Oscuro',
  'settings.theme.light': 'Claro',
  'reco.title': 'Recomendado para ti',
  'reco.loading': 'Buscando qué recomendarte…',
  'reco.empty': 'Todavía no hay nada que recomendar. Busca algo y vuelve.',
  'reco.coldStart': 'Sin historial todavía: esto es lo más popular del catálogo.',
  'reco.personalized': 'Ordenado por lo que has visto y buscado.',
  'reco.showScore': 'Ver el detalle',
  'reco.hideScore': 'Ocultar el detalle',
  'reco.score': 'Puntuación: {score}',
  'player.label': 'Reproductor de video',
  'player.tracks': 'Subtítulos disponibles: {count}.',
  'player.mode': 'Modo',
  'player.episodes': 'Episodios',
  // El regreso a la ficha: la pantalla de reproducción es un callejón sin salida
  // sin este enlace, porque la cabecera lleva a la home y no al título.
  'player.backToDetail': 'Volver a la ficha',
  'player.previousEpisode': 'Episodio anterior',
  'player.nextEpisode': 'Episodio siguiente',
  'player.firstEpisode': 'Este es el primer episodio: no hay anterior.',
  'player.lastEpisode': 'Este es el último episodio: no hay siguiente.',
  'player.episodeOf': 'Episodio {number} de {total}',
  // El episodio, para el título de la pestaña y para el encabezado de la pantalla.
  'player.episode': 'Episodio {number}',
  'player.episodeNamed': 'Episodio {number} · {title}',
  'player.mode.sub': 'Subtitulado',
  'player.mode.dub': 'Doblado',
  'player.play': 'Reproducir',
  'player.pause': 'Pausa',
  'player.back': 'Atrás 10 s',
  'player.forward': 'Adelante 10 s',
  'player.mute': 'Silenciar',
  // El mando de volumen. La barra no lleva rótulo a la vista, así que este es su
  // nombre accesible: sin él, un lector de pantalla lee un «deslizador» y nada más.
  'player.volume': 'Volumen',
  'player.unmute': 'Quitar silencio',
  'player.fullscreen': 'Pantalla completa',
  'player.seek': 'Posición del video',
  'player.mpv': 'Ver en mpv',
  'player.mpv.opened': 'Se abrió en el reproductor externo.',
  'player.mpv.error': 'No se pudo abrir mpv: {message}',
  'player.sinImagen':
    'El audio suena y la imagen no llega: el navegador no está decodificando el video. Prueba con «Ver en mpv».',
  // El modo compatible: cuando el navegador decodifica pero su GPU no pinta el
  // cuadro de video —Wayland con NVIDIA, con el VA-API descartado por el propio
  // Chromium—, el reproductor pinta los fotogramas él mismo. El texto dice qué
  // se está haciendo, porque el precio es CPU.
  'player.compat': 'Modo compatible',
  'player.compat.on':
    'Modo compatible: los fotogramas los pinta la CPU, porque tu navegador no los pinta con la GPU.',
  'player.loading': 'Cargando el video…',
  // El aviso de que el elemento ya reprodujo y se ha quedado sin datos. Va
  // aparte de `player.loading` porque son dos esperas distintas: una al
  // principio y otra a mitad, y decir «cargando» en la segunda parece que se
  // perdió lo visto.
  'player.buffering': 'Almacenando en búfer…',
  'player.error': 'No se pudo reproducir: {message}',
  // El proveedor contestó, pero sin ninguna fuente para ese episodio. No es un
  // fallo de red y no se cuenta como tal: es que ese sitio no tiene el episodio.
  'player.noSource': 'el proveedor no dio ninguna fuente para este episodio',
  // Los atajos, en dos piezas: la tecla —que se pinta como una tecla— y lo que
  // hace. Antes eran una sola frase en la parte de abajo y no se leía como lo
  // que es: teclas que se pueden pulsar.
  'player.keys': 'Teclado',
  'player.key.toggle': 'Pausa y reanudar',
  'player.key.seek': 'Retroceder o avanzar 10 s',
  'player.key.volume': 'Bajar o subir el volumen',
  'player.key.mute': 'Silenciar',
  'player.key.fullscreen': 'Pantalla completa',
  'player.key.space': 'Espacio',
  'player.key.enter': 'Enter',
  'player.key.k': 'K',
  'player.key.left': '←',
  'player.key.right': '→',
  'player.key.up': '↑',
  'player.key.down': '↓',
  'player.key.m': 'M',
  'player.key.f': 'F',
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
  'detail.episode.watched': 'visto',
  'detail.episode.progress': 'Visto al {percent} %',
  'detail.window.previous': 'Anteriores',
  'detail.window.next': 'Siguientes',
  'detail.window.range': 'Episodios {from}–{to}',
  'detail.window.jump': 'Ir al episodio',
  'detail.window.go': 'Ir',
  'detail.window.watched': '{seen} de {total} vistos',
  'detail.mode.sub': 'subtitulado',
  'detail.mode.dub': 'doblado',
  'detail.mode.raw': 'original',
  'detail.modes': 'Modos disponibles',
  'detail.modeUnavailable': 'Este proveedor no ofrece {mode}.',
  'detail.sources': 'También en',
  'detail.sourcesItem': '{title} en {provider}',
  'detail.noEpisodes': 'Este título no tiene episodios todavía.',
  'detail.favorite.add': 'Añadir a favoritos',
  'detail.favorite.remove': 'Quitar de favoritos',
  'detail.loading': 'Cargando la ficha…',
  'detail.notFound': 'Ese título no está en el proveedor.',
  'detail.related.year': 'Año {year}',
  'detail.related.none': 'No hay más títulos de esta saga en el catálogo local.',
  'detail.related.seasons': 'Temporadas',
  'detail.related.movies': 'Películas y especiales',
  'detail.related.franchise': 'Más de esta franquicia',
  'detail.related.current': 'viendo',
  'detail.season': 'Temporada {number}',

  'notFound.title': 'Esa ruta no existe',
  'notFound.body': 'La dirección {path} no corresponde a ninguna pantalla.',
  'notFound.back': 'Volver al inicio',
}
