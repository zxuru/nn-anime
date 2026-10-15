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

  // El tipo de contenido: la mitad de la aplicación que se está mirando. El
  // vocabulario del contrato es `anime` / `movies` / `both`, y `movies` es «lo que
  // no es anime» —películas, series y doramas—, que es la partición que hacen las
  // fuentes: la etiqueta dice «Películas» porque es lo que el usuario busca.
  'media.anime': 'Anime',
  'media.movies': 'Películas',
  'media.both': 'Anime y películas',
  'media.switch': 'Tipo de contenido',
  'media.empty.movies': 'Ningún proveedor instalado sirve películas todavía.',
  'media.empty.anime': 'Ningún proveedor instalado sirve anime todavía.',
  'media.empty.hint': 'Añade uno en Ajustes o cambia de pestaña.',

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
  'home.top': 'Top',
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
  'home.recommended': 'Recomendado para ti',
  'home.recommended.meta': 'Lo que el motor cree que va contigo',
  // Los tres renglones de la nota de un tramo: el titular, la etiqueta y la cuenta.
  'home.count': '{count} títulos',
  'home.countOne': '1 título',
  'home.countMore': '{count} títulos · y {more} más',
  'home.genres.count': '{count} géneros',
  'home.genres.countOne': '1 género',
  // La pieza: el mando que abre su panel y lo que ofrece el asomo.
  'home.pieza.abrir': 'Ver más de {title}',
  'home.pieza.ficha': 'Ver ficha',
  'home.pieza.reproducir': 'Reproducir',
  'home.panel.cerrar': 'Cerrar',
  'home.panel.asa': 'Cerrar el panel',
  'home.continue': 'Continuar viendo',
  'home.continue.empty': 'Nada a medias. Lo que empieces aparecerá aquí.',
  'home.favorites': 'Tus favoritos',
  'home.favorites.empty':
    'Todavía no has marcado ninguno. La estrella está en la ficha de cada título.',
  'home.feed': 'Novedades',
  'home.feed.meta': 'Lo último que publica la fuente',
  'home.feed.empty': 'Ningún proveedor activo publica novedades.',
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
  'settings.register.media': 'Qué sirve',
  'settings.register.mediaHint': 'en qué pestaña aparece: anime, películas o las dos',
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
  'settings.repos': 'Proveedores de un repositorio',
  'settings.repos.body':
    'Pega la dirección de un repositorio público de GitHub. Se descarga, se miran sus archivos y eliges cuáles se activan: hasta que no marques uno, no se ejecuta nada.',
  'settings.repos.url': 'Dirección del repositorio',
  'settings.repos.urlHint': 'github.com/usuario/repo, con rama y carpeta si hacen falta',
  'settings.repos.install': 'Añadir o actualizar',
  'settings.repos.installing': 'Descargando…',
  'settings.repos.installed': 'Repositorio descargado: marca qué proveedores se activan.',
  'settings.repos.warning':
    'Activar un proveedor ejecuta el código del repositorio sin sandbox, con tus permisos: es el mismo aviso de arriba, y aquí es donde se toma la decisión.',
  'settings.repos.loading': 'Mirando qué repositorios hay…',
  'settings.repos.failed': 'No se pudo leer la lista: {message}',
  'settings.repos.empty': 'No hay ningún repositorio instalado.',
  'settings.repos.missing': 'Falta el contenido descargado: vuelve a añadir el repositorio.',
  'settings.repos.none': 'El escáner no reconoció ningún proveedor en este repositorio.',
  'settings.repos.detected':
    'El identificador y el nombre salen de leer el texto, sin ejecutarlo: el que vale es el que diga el plugin al cargarse.',
  'settings.repos.ref': 'rama {ref}',
  'settings.repos.files': '{files} archivos descargados',
  'settings.repos.selected': '{selected} de {total} activos',
  'settings.repos.candidate': 'Activar {path}',
  'settings.repos.save': 'Guardar selección',
  'settings.repos.saving': 'Guardando…',
  'settings.repos.saved': 'Selección guardada: {count} activos.',
  'settings.repos.unchanged': 'No hay cambios que guardar.',
  'settings.repos.update': 'Actualizar',
  'settings.repos.remove': 'Quitar',
  'settings.repos.removeConfirm':
    'Quitar {repo} borra la copia descargada y desactiva sus proveedores. ¿Seguir?',
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
  // El nombre del grupo de los dos modos de audio. Antes era «Modo», que no decía
  // de qué se estaba hablando: el modo compatible también es un modo.
  'player.audio': 'Audio',
  'player.episodes': 'Episodios',
  // El regreso a la ficha: la pantalla de reproducción es un callejón sin salida
  // sin este enlace, porque la cabecera lleva a la home y no al título.
  'player.backToDetail': 'Volver a la ficha',
  'player.previousEpisode': 'Episodio anterior',
  'player.nextEpisode': 'Episodio siguiente',
  // El rótulo corto de las flechas, que ahora van en una fila compacta bajo el
  // video. El nombre largo sigue existiendo como `title` y como nombre accesible:
  // «Anterior» a secas depende de un contexto que el ojo tiene delante.
  'player.previous': 'Anterior',
  'player.next': 'Siguiente',
  'player.firstEpisode': 'Este es el primer episodio: no hay anterior.',
  'player.lastEpisode': 'Este es el último episodio: no hay siguiente.',
  // El episodio en una sola línea, con el número una sola vez: el episodio, de
  // cuántos es —si el proveedor lo dijo— y, si lo trae, su título. Antes eran dos
  // textos, «Episodio 3» encima y «Episodio 3 de 12» en medio de las flechas.
  'player.episodeOf': 'Episodio {number} de {total}',
  // La lista de la columna: se pide de cien en cien, así que tiene estados.
  'player.episodes.more': 'Ver más episodios',
  'player.episodes.loading': 'Cargando los episodios…',
  'player.episodes.error': 'No se pudieron cargar los episodios.',
  // El episodio, para el título de la pestaña y para el encabezado de la pantalla.
  'player.episode': 'Episodio {number}',
  'player.episodeNamed': 'Episodio {number} · {title}',
  'player.mode.sub': 'Subtitulado',
  'player.mode.dub': 'Doblado',
  // Los mandos de la barra. Con iconos, estos textos son el **nombre accesible**
  // y el `title`: lo que se ve es el dibujo, así que el nombre tiene que decir el
  // estado entero —«Pausar», no «Pausa»— y no depender del contexto.
  'player.play': 'Reproducir',
  'player.pause': 'Pausar',
  'player.back': 'Retroceder 10 segundos',
  'player.forward': 'Adelantar 10 segundos',
  // Lo que se ve dentro de los dos botones de salto, al lado de la flecha.
  'player.seek.step': '10',
  'player.mute': 'Silenciar',
  // El mando de volumen. La barra no lleva rótulo a la vista, así que este es su
  // nombre accesible: sin él, un lector de pantalla lee un «deslizador» y nada más.
  'player.volume': 'Volumen',
  'player.unmute': 'Activar sonido',
  'player.fullscreen': 'Pantalla completa',
  'player.fullscreen.exit': 'Salir de pantalla completa',
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
  // que es: teclas que se pueden pulsar. Ahora viven en un diálogo, y se abre
  // desde los ajustes o con la tecla `?`.
  'player.keys': 'Teclado',
  'player.keys.open': 'Atajos de teclado',
  'player.keys.close': 'Cerrar la ayuda',
  // El menú de ajustes: el mando y lo que hay dentro.
  'player.settings': 'Ajustes',
  // La elección de subtítulos del propio reproductor. Va aparte de los modos de
  // audio: son dos cosas distintas y se eligen por separado.
  'player.tracks.pick': 'Subtítulos',
  'player.tracks.none': 'Ninguno',
  // El episodio siguiente, que empieza solo si nadie lo para.
  'player.autoplay': 'Reproducción automática',
  'player.next.in': 'Siguiente episodio en {seconds} s',
  'player.next.now': 'Reproducir ahora',
  'player.next.cancel': 'Cancelar',
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
  // Con total y sin él, porque el proveedor no siempre dice de cuántos: un «de 26»
  // inventado es peor que sólo el número.
  'detail.episodeOf': 'Episodio {number} de {total}',
  'detail.episode.watched': 'visto',
  'detail.episode.progress': 'Visto al {percent} %',
  'detail.episodes.loading': 'Cargando los episodios…',
  'detail.episodes.error': 'No se pudieron cargar los episodios.',
  // Los mandos de la lista por páginas. El rótulo de las flechas es también su
  // nombre accesible: son botones con texto, no iconos.
  'detail.page.previous': 'Página anterior',
  'detail.page.next': 'Página siguiente',
  'detail.page.label': 'Página {page}',
  'detail.latest': 'Último episodio',
  'detail.latest.error': 'No se pudo abrir el último episodio.',
  'detail.latest.failed': 'No se pudo abrir el último episodio: {message}',
  // El salto por número pregunta al servidor: si contesta que no está, se dice
  // eso y no un error, porque no hay ningún fallo. Cuando sí falla —el plugin real
  // contesta 502 con el motivo, porque no puede construir un 404—, el texto del
  // servidor se enseña dentro del aviso: es lo único que explica qué pasó.
  'detail.jump.notFound': 'El episodio {number} no está en este título.',
  'detail.jump.failed': 'No se pudo buscar el episodio: {message}',
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
  // Una película no tiene capítulos: su bloque se titula por lo que es —no
  // «Episodios»— y ofrece verla en vez de numerar un «Episodio 1» que nadie puede
  // elegir. Los textos de carga y error van aparte por lo mismo: decir que se
  // están cargando episodios es anunciar algo que no existe.
  'detail.movie': 'Película',
  'detail.movie.watch': 'Ver película',
  'detail.movie.loading': 'Cargando la película…',
  'detail.movie.error': 'No se pudo cargar la película.',
  'detail.movie.missing': 'Esta película no tiene nada que reproducir todavía.',
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
  'detail.season.count': '{count} episodios',
  'detail.seasons': 'Temporadas',

  'notFound.title': 'Esa ruta no existe',
  'notFound.body': 'La dirección {path} no corresponde a ninguna pantalla.',
  'notFound.back': 'Volver al inicio',
}
