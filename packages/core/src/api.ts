/**
 * Contrato HTTP: las formas que cruzan la frontera entre el server y la interfaz.
 *
 * Viven aquí, en `core`, y no en cada lado, porque son **la misma forma**. El
 * server las usa para construir y la interfaz para validar; con dos definiciones
 * paralelas, un campo renombrado en el server no da error de compilación —da un
 * `ApiShapeError` en el navegador, tres capas más lejos de la causa.
 *
 * Cada respuesta es estricta: una clave de más es un error, no algo que se
 * ignora. Un campo nuevo que nadie declaró es o un error del server o un cambio
 * de contrato, y en ambos casos conviene enterarse en la frontera.
 */

import { z } from 'zod'
import { ANILIST_RELATIONS } from './anilist'
import {
  githubRepoFromUrl,
  MAX_ENABLED_REPO_FILES,
  MAX_REPO_CANDIDATES,
  MAX_REPO_NAME_LENGTH,
  MAX_REPO_OWNER_LENGTH,
  MAX_REPO_PATH_LENGTH,
  MAX_REPO_REF_LENGTH,
  MAX_REPO_SUBDIR_LENGTH,
  MAX_REPO_URL_LENGTH,
} from './repos'
import {
  airingStatusSchema,
  animeDetailSchema,
  animeSummarySchema,
  episodeSchema,
  httpUrlSchema,
  modeSchema,
  providerCapabilitiesSchema,
  providerMediaSchema,
  providerRefSchema,
  searchResultSchema,
  streamRequestSchema,
  subtitleFormatSchema,
  titleKindSchema,
} from './schema'

/** Estado de carga de un plugin. */
export const providerStatusSchema = z.enum(['active', 'rejected'])

/**
 * Un proveedor tal como lo ve la interfaz.
 *
 * `capabilities` va entero aunque la interfaz hoy sólo mire `sub` y `dub`:
 * recortarlo obligaría a cambiar el contrato el día que la interfaz quiera
 * mostrar si un proveedor sabe buscar o traer tendencias.
 */
export const providerSummarySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  capabilities: providerCapabilitiesSchema,
  status: providerStatusSchema,
  /** Motivo del rechazo, sólo cuando no cargó. */
  reason: z.string().min(1).optional(),
})

/** Un rechazo, en una línea que la interfaz pueda mostrar. */
export const errorResponseSchema = z.strictObject({
  error: z.string().min(1),
})

export const healthResponseSchema = z.strictObject({
  version: z.string().min(1),
  port: z.number().int(),
  mpv: z.boolean(),
  providers: z.array(providerSummarySchema),
})

export const providersResponseSchema = z.strictObject({
  providers: z.array(providerSummarySchema),
})

/**
 * Ruta de un endpoint, dentro de un proveedor declarativo.
 *
 * Se exige que sea **relativa**: una ruta absoluta dentro de la plantilla
 * apuntaría a un sitio distinto del de la dirección base, y el formulario
 * dejaría de describir un proveedor para describir dos. Los caracteres de
 * control se rechazan aquí porque esta cadena acaba dentro de una URL y de un
 * archivo.
 */
const endpointTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !value.includes('://'), {
    message: 'la ruta tiene que ser relativa a la dirección base',
  })
  .refine((value) => !/[\r\n\0]/.test(value), {
    message: 'la ruta no admite caracteres de control',
  })

const queryTemplateSchema = endpointTemplateSchema.refine((value) => value.includes('{query}'), {
  message: 'falta el marcador {query}',
})

const refTemplateSchema = endpointTemplateSchema.refine((value) => value.includes('{ref}'), {
  message: 'falta el marcador {ref}',
})

/**
 * Dónde vive cada dato dentro del JSON del sitio.
 *
 * Es una ruta con puntos (`data.items`) y la cadena vacía significa «el valor
 * mismo»: la raíz, para una respuesta que ya es la lista. Se admiten estos
 * nombres y no un JSON Pointer porque lo que se escribe aquí lo teclea una
 * persona en un formulario.
 */
const fieldPathSchema = z.string().trim().max(200)

export const providerFieldMapSchema = z.strictObject({
  searchItems: fieldPathSchema.default(''),
  searchId: fieldPathSchema.default('id'),
  searchTitle: fieldPathSchema.default('title'),
  animeTitle: fieldPathSchema.default('title'),
  animeGenres: fieldPathSchema.default('genres'),
  animeStudios: fieldPathSchema.default('studios'),
  episodeItems: fieldPathSchema.default(''),
  episodeId: fieldPathSchema.default('id'),
  episodeNumber: fieldPathSchema.default('number'),
  episodeTitle: fieldPathSchema.default('title'),
  streamUrl: fieldPathSchema.default('url'),
  streamKind: fieldPathSchema.default('kind'),
})

/**
 * La descripción de un proveedor, tal como la manda el formulario.
 *
 * Esto **no** es un proveedor: es lo que basta para generar uno. La diferencia
 * importa: aquí no entra código, así que la interfaz puede aceptar esta forma
 * sin convertirse en un ejecutor de lo que le manden. El código lo escribe el
 * servidor, a partir de esta descripción, y por eso el archivo resultante es
 * siempre el mismo para la misma entrada.
 *
 * `id` es kebab-case porque es a la vez el nombre del archivo —tiene que ser un
 * nombre de archivo seguro, y validarlo aquí es lo que evita que lo sea por
 * accidente— y el identificador que viaja en las rutas.
 */
export const providerDraftSchema = z.strictObject({
  id: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'minúsculas, dígitos y guiones'),
  name: z.string().trim().min(1).max(80),
  baseUrl: httpUrlSchema,
  capabilities: providerCapabilitiesSchema,
  endpoints: z.strictObject({
    search: queryTemplateSchema,
    anime: refTemplateSchema,
    episodes: refTemplateSchema,
    stream: refTemplateSchema,
    trending: endpointTemplateSchema.optional(),
  }),
  /**
   * Se puede omitir entero: cada campo tiene su valor por defecto, y quien no
   * los conozca no tiene por qué mandarlos. El formulario los manda porque los
   * enseña, que no es lo mismo que hacerlos obligatorios.
   *
   * Es `prefault` y no `default` porque el valor que falta es del **entrante**:
   * `{}` todavía no es un mapa de campos, es lo que hay que pasar por el schema
   * para que los doce nombres aparezcan.
   */
  fields: providerFieldMapSchema.prefault({}),
})

/** Lo que devuelve registrar un proveedor: el que quedó cargado. */
export const providerRegisterResponseSchema = z.strictObject({
  provider: providerSummarySchema,
})

/**
 * La dirección de un repositorio de GitHub, tal como la escribe el usuario.
 *
 * Se admite lo que se copia del navegador y lo que se teclea a mano —con host o
 * sin él, con barra final, con `.git`— y el análisis vive en `repos.ts` porque lo
 * comparten el formulario y la ruta: si cada uno tuviera el suyo, la interfaz
 * aceptaría direcciones que el servidor rechaza, que es la peor forma de
 * rechazar algo.
 */
export const providerRepoUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => githubRepoFromUrl(value) !== undefined, {
    message: 'no es una dirección de repositorio de GitHub',
  })

/**
 * Un proveedor que un repositorio ofrece.
 *
 * `id` y `name` son **pistas**: salen de leer el texto sin ejecutarlo, y el
 * nombre de verdad lo dice el plugin cuando se carga. Van como opcionales porque
 * un archivo puede declararlos de una forma que el escaneo no sabe leer, y eso no
 * es un error: es un archivo que se puede marcar igual.
 */
export const providerRepoCandidateSchema = z.strictObject({
  /** Ruta dentro del repositorio, con `/` como separador. */
  path: z.string().min(1).max(MAX_REPO_PATH_LENGTH),
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120).optional(),
})

/** Un repositorio instalado. Es lo que se guarda en los ajustes. */
export const providerRepoRecordSchema = z.strictObject({
  /** La dirección normalizada: la misma entrada da siempre esta cadena. */
  url: z.string().min(1).max(MAX_REPO_URL_LENGTH),
  owner: z.string().min(1).max(MAX_REPO_OWNER_LENGTH),
  repo: z.string().min(1).max(MAX_REPO_NAME_LENGTH),
  ref: z.string().min(1).max(MAX_REPO_REF_LENGTH),
  subdir: z.string().min(1).max(MAX_REPO_SUBDIR_LENGTH).optional(),
  /** Cuándo se descargó, en ISO-8601. */
  fetchedAt: z.iso.datetime(),
  /**
   * Las rutas habilitadas, tal como las nombra el catálogo de candidatos.
   *
   * Se guarda la lista entera y no una marca por archivo: la lista es la fuente
   * de verdad de qué se carga, y una lista vacía es un repositorio instalado sin
   * nada activo, que es un estado legítimo.
   */
  enabled: z.array(z.string().min(1).max(MAX_REPO_PATH_LENGTH)).max(MAX_ENABLED_REPO_FILES),
  /** Cuántos archivos se descargaron. Se enseña; no decide nada. */
  files: z.number().int().nonnegative(),
})

/**
 * Un repositorio tal como lo ve la interfaz: lo guardado más lo que hay ahora.
 *
 * `candidates` se recalcula leyendo el disco en cada petición —el escaneo no
 * ejecuta nada— y `present` dice si el contenido sigue ahí: un repo borrado a
 * mano tiene que poder contarse en vez de desaparecer de la pantalla.
 */
export const providerRepoViewSchema = providerRepoRecordSchema.extend({
  candidates: z.array(providerRepoCandidateSchema).max(MAX_REPO_CANDIDATES),
  present: z.boolean(),
})

export const providerReposResponseSchema = z.strictObject({
  repos: z.array(providerRepoViewSchema),
})

export const providerRepoResponseSchema = z.strictObject({ repo: providerRepoViewSchema })

/** Instalar o actualizar: la dirección, y nada más. */
export const providerRepoRequestSchema = z.strictObject({ url: providerRepoUrlSchema })

/** Elegir qué se activa: la dirección y las rutas marcadas. */
export const providerRepoSelectionSchema = z.strictObject({
  url: providerRepoUrlSchema,
  enabled: z.array(z.string().min(1).max(MAX_REPO_PATH_LENGTH)).max(MAX_ENABLED_REPO_FILES),
})

/** Desinstalar: la dirección, como consulta de la ruta. */
export const providerRepoQuerySchema = z.strictObject({ url: providerRepoUrlSchema })

export const favoritesResponseSchema = z.strictObject({
  favorites: z.array(animeSummarySchema),
})

/** Alta o baja de un favorito. `value` dice en qué estado queda. */
export const favoriteRequestSchema = z.strictObject({
  ref: providerRefSchema,
  value: z.boolean(),
})

/**
 * La marca de «ya visto», como la lee el botón de la ficha.
 *
 * Misma forma que los favoritos y por el mismo motivo: el alta y la baja se hacen
 * con el mismo cuerpo, y `value` dice en qué estado queda la obra. La **fecha** de
 * la marca no viaja: la usa el motor para desempatar y la interfaz no la pinta.
 */
export const watchedTitlesResponseSchema = z.strictObject({
  items: z.array(animeSummarySchema),
})

/** Alta o baja de la marca de visto. `value` dice en qué estado queda. */
export const watchedTitleRequestSchema = z.strictObject({
  ref: providerRefSchema,
  value: z.boolean(),
})

/**
 * La marca de «quiero ver», como la lee y la escribe el botón de la ficha.
 *
 * Tercera marca del usuario y hermana de las otras dos: misma forma de petición
 * —un solo `POST` con `value`— y misma forma de lectura que los vistos. **Es
 * independiente de ellas**: marcar una obra como vista no la saca de «quiero
 * ver», y ponerla en «quiero ver» no la marca como vista. Son tres tablas y
 * ninguna escribe en otra.
 */
export const planToWatchResponseSchema = z.strictObject({
  items: z.array(animeSummarySchema),
})

/** Alta o baja de «quiero ver». `value` dice en qué estado queda. */
export const planToWatchRequestSchema = z.strictObject({
  ref: providerRefSchema,
  value: z.boolean(),
})

/**
 * Una pista de subtítulos tal y como la ve el cliente.
 *
 * La `url` es la ruta del proxy con su ticket, no la del upstream —igual que la
 * de la fuente—, y por eso aquí **no** vale `httpUrlSchema`: la dirección es
 * interna y relativa al origen. Y no basta con exigir una cadena cualquiera: el
 * prefijo se comprueba, porque «el cliente nunca ve la dirección del upstream» es
 * la regla que sostiene este contrato. Con `z.string()` a secas, una pista
 * declarada por el proveedor pasaba la validación con la dirección de terceros
 * dentro y el reproductor la descartaba después por no ser una ruta del proxy: la
 * pista llegaba al navegador y no se podía pintar, sin que nada avisara.
 */
export const publicSubtitleTrackSchema = z.strictObject({
  lang: z.string().min(1),
  label: z.string().min(1),
  url: z.string().regex(/^\/api\/subtitles\/[^/]+$/, 'la pista tiene que ser una ruta del proxy'),
  format: subtitleFormatSchema,
  default: z.boolean().optional(),
})

/**
 * Una fuente de reproducción tal y como la ve el cliente.
 *
 * `url` es la ruta del proxy con su ticket, no la del upstream: el tipo no
 * admite cabeceras, así que no hay forma de que se cuelen. Es la forma que
 * devuelve `toPublicStreamSource`.
 */
export const streamSourceResponseSchema = z.strictObject({
  url: z.string().min(1),
  kind: z.enum(['hls', 'file']),
  quality: z.string().min(1).optional(),
  subtitles: z.array(publicSubtitleTrackSchema).optional(),
})

export const streamResolveResponseSchema = z.strictObject({
  sources: z.array(streamSourceResponseSchema),
})

/**
 * Handoff al reproductor externo: `POST /api/play/mpv`.
 *
 * El cuerpo es el de resolver un stream más el segundo por el que empezar, y la
 * respuesta es el `pid` del proceso. Viven aquí y no en la ruta del server
 * porque la interfaz manda el cuerpo y lee la respuesta: dos definiciones
 * paralelas se separan en el primer campo que alguien renombre.
 */
export const mpvPlayRequestSchema = streamRequestSchema.extend({
  /** Segundo en el que empezar, para reanudar donde se dejó. */
  startAtS: z.number().min(0).optional(),
})

export const mpvPlayResponseSchema = z.strictObject({ pid: z.number().int().positive() })

export type MpvPlayRequest = z.infer<typeof mpvPlayRequestSchema>
export type MpvPlayResponse = z.infer<typeof mpvPlayResponseSchema>

/** Alta de un visionado: qué episodio, en qué modo y desde dónde. */
export const watchStartRequestSchema = z.strictObject({
  animeRef: providerRefSchema,
  episodeRef: providerRefSchema,
  mode: modeSchema,
  startAtS: z.number().nonnegative().optional(),
})

export const watchStartResponseSchema = z.strictObject({ id: z.number().int().positive() })

/** Avance de un visionado. La duración se manda porque sólo el reproductor la sabe. */
export const watchUpdateRequestSchema = z.strictObject({
  positionS: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
})

/**
 * Una recomendación, tal y como la ve el cliente.
 *
 * `components` **no está aquí**: es información de depuración y el spec prohíbe
 * exponerla por defecto. Si alguien la necesita, hay una opción explícita.
 */
export const recommendationSchema = z.strictObject({
  ref: providerRefSchema,
  title: z.string().min(1),
  coverUrl: httpUrlSchema.optional(),
  year: z.number().int().optional(),
  kind: titleKindSchema.optional(),
  score: z.number(),
  /**
   * Los géneros del título.
   *
   * Los lleva el motor —son sus características— y salen aquí porque la home los
   * necesita para el cartel de destacado y para la lista de géneros. Sin ellos
   * habría que pedir el detalle de cada título para pintar una fila.
   */
  tags: z.array(z.string().min(1)),
  reason: z.strictObject({
    kind: z.string().min(1),
    text: z.string().min(1),
  }),
  reasons: z.array(
    z.strictObject({
      kind: z.string().min(1),
      text: z.string().min(1),
    }),
  ),
})

export const recommendationsResponseSchema = z.strictObject({
  items: z.array(recommendationSchema),
  /** Sin historial: la interfaz lo usa para explicarse. */
  coldStart: z.boolean(),
})

/** Un visionado a medias, tal y como lo ve la fila «continuar viendo». */
export const continueWatchingItemSchema = z.strictObject({
  animeRef: providerRefSchema,
  title: z.string().min(1),
  coverUrl: httpUrlSchema.optional(),
  episodeRef: providerRefSchema,
  episodeNumber: z.number().int().nonnegative(),
  /** La temporada, si la fuente la declara. Es lo que distingue T1E1 de T2E1. */
  season: z.number().int().positive().optional(),
  mode: modeSchema,
  positionS: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  /** Cuánto se vio, de 0 a 1. Lo calcula el servidor para no repetirlo. */
  ratio: z.number().min(0).max(1),
  watchedAt: z.string().min(1),
})

export const continueWatchingResponseSchema = z.strictObject({
  items: z.array(continueWatchingItemSchema),
})

/**
 * Un visionado del historial: el de «continuar viendo» más si terminó.
 *
 * `continueWatchingItemSchema` no lleva `finished` porque esa fila se construye
 * descartando justo lo terminado. El historial sí lo enseña: una lista que no
 * distingue «lo dejé a la mitad» de «lo acabé» no cuenta lo que pasó y obliga a
 * abrir la ficha para saberlo.
 */
export const watchHistoryItemSchema = continueWatchingItemSchema.extend({
  /**
   * La fila de visionado, que es lo que identifica un renglón del historial.
   *
   * Hace falta y por eso está, aunque «continuar viendo» no lo lleve: esa fila se
   * agrupa por episodio, así que cada episodio sale una vez. El historial **no
   * agrupa** —el mismo episodio reproducido dos veces son dos renglones— y sin un
   * identificador propio la lista no tiene con qué distinguir dos filas idénticas.
   */
  id: z.number().int().positive(),
  finished: z.boolean(),
})

/**
 * Una página del historial.
 *
 * Misma convención que `episodesResponseSchema` —`page` base 1 y `hasMore`— porque
 * es la misma pregunta: qué hay en esta ventana y si queda algo detrás. El
 * historial no se sirve entero: crece con cada reproducción y nadie mira el año
 * pasado de una vez, así que pedirlo completo sería una respuesta que crece sin
 * tope.
 */
export const watchHistoryResponseSchema = z.strictObject({
  items: z.array(watchHistoryItemSchema),
  page: z.number().int().positive(),
  hasMore: z.boolean(),
})

/**
 * El Perfil: las listas del usuario en una sola respuesta.
 *
 * Es una lectura **agregada** a propósito. Con cuatro peticiones en paralelo, una
 * que falla deja la pantalla a medio pintar, y una pantalla que enseña el estado
 * del único usuario no puede callar una de sus partes sin decirlo: o están las
 * cuatro o el Perfil está en error y se puede reintentar.
 *
 * `history` lleva la forma paginada de su ruta —la página 1— y no una lista
 * suelta: el Perfil enseña el principio y enlaza al Historial, que habla el mismo
 * contrato. Dos formas para el mismo dato acaban diciendo cosas distintas.
 */
export const profileResponseSchema = z.strictObject({
  favorites: z.array(animeSummarySchema),
  watched: z.array(animeSummarySchema),
  planToWatch: z.array(animeSummarySchema),
  history: watchHistoryResponseSchema,
})

/** Una fila de tendencias. */
export const trendingResponseSchema = z.strictObject({
  items: z.array(animeSummarySchema),
})

/**
 * Los hermanos de saga que la base ya conoce.
 *
 * Misma forma que la fila de tendencias —son tarjetas— y por eso reusa
 * `animeSummarySchema`: la ficha no necesita el detalle de un relacionado para
 * pintar su tarjeta, y pedirlo sería una petición de red por cada uno.
 */
export const relatedResponseSchema = z.strictObject({
  items: z.array(animeSummarySchema),
})

/**
 * Las otras fuentes que tienen esta misma obra.
 *
 * Misma forma que `relatedResponseSchema` y, a propósito, **schema propio**:
 * significan cosas distintas —los hermanos de la saga contra la misma obra en otro
 * sitio— y compartir el tipo dejaría que un cambio en uno viajara al otro.
 */
export const sourcesResponseSchema = z.strictObject({
  items: z.array(animeSummarySchema),
})

/**
 * El estado de visionado de cada episodio de un título.
 *
 * `watchedAt` viaja como fecha ISO y no como epoch: es la misma forma que
 * `continueWatchingItemSchema`, y dos formas de fecha en la misma interfaz acaban
 * en una conversión olvidada.
 */
export const watchedEpisodeSchema = z.strictObject({
  number: z.number().nonnegative(),
  mode: modeSchema,
  positionS: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  ratio: z.number().min(0).max(1),
  finished: z.boolean(),
  watchedAt: z.iso.datetime(),
})

export const watchedResponseSchema = z.strictObject({
  episodes: z.array(watchedEpisodeSchema),
})

/**
 * Una novedad del feed, con su fecha.
 *
 * La fecha es opcional porque un feed puede no traerla —y entonces sólo ordena el
 * orden de la fuente—, pero cuando está es lo que permite decir qué es nuevo.
 */
export const feedItemSchema = animeSummarySchema.extend({
  publishedAt: z.iso.datetime().optional(),
  /**
   * Si **se sabe** que la obra es para adultos.
   *
   * Opcional y sólo verdadero: una entrada del feed viene de un plugin que no
   * publica la edad, así que lo único que se puede afirmar de ella es que se
   * comprobó que lo es. La ausencia significa «no consta»; un `false` diría que se
   * miró, y eso sería mentir en la marca.
   */
  adult: z.literal(true).optional(),
})

/** La fila de novedades: lo que publica la fuente, sin que nadie busque. */
export const feedResponseSchema = z.strictObject({
  items: z.array(feedItemSchema),
})

/** La fila «último añadido»: lo que la aplicación ya conoce, sin red. */
export const recentResponseSchema = z.strictObject({
  items: z.array(animeSummarySchema),
})

/**
 * Una pieza de las filas de descubrimiento: el top y las novedades.
 *
 * `cover` es una **ruta local** —`/api/anilist/image/cover/<id>`— y no la
 * dirección que publica AniList: el navegador sigue sin conocer ningún origen
 * remoto y la CSP no cambia, igual que con las portadas de proveedor.
 *
 * `ref` viaja sólo cuando la base ya conoce esa obra en alguna fuente. Es lo que
 * decide si la pieza abre una ficha o la búsqueda de su título, y por eso las dos
 * formas tienen que poder convivir en la misma fila.
 */
export const discoverItemSchema = z.strictObject({
  anilistId: z.number().int().positive(),
  title: z.string().min(1),
  cover: z.string().min(1),
  score: z.number().min(0).max(100).optional(),
  year: z.number().int().optional(),
  /**
   * Si AniList la marca para adultos. Es lo que pinta la marca `+18` y lo que la
   * frontera descarta cuando el ajuste está apagado.
   */
  adult: z.boolean(),
  kind: titleKindSchema.optional(),
  format: z.string().min(1).optional(),
  episodes: z.number().int().positive().optional(),
  ref: providerRefSchema.optional(),
})

export const discoverResponseSchema = z.strictObject({ items: z.array(discoverItemSchema) })

/**
 * Un episodio que se emite, o que se acaba de emitir.
 *
 * `airingAt` es la fecha del capítulo y no la de una entrada de catálogo: es el
 * dato que los proveedores no publican y por el que existen la parrilla y la fila
 * de novedades.
 */
export const airingItemSchema = z.strictObject({
  anilistId: z.number().int().positive(),
  title: z.string().min(1),
  cover: z.string().min(1),
  /** El capítulo. Una película no tiene: su cita es el estreno. */
  episode: z.number().int().positive().optional(),
  /**
   * Cuándo. **Opcional** porque AniList publica el estreno de muchas películas
   * con precisión de año y aquí no se inventa un día: sin fecha, la pieza lleva
   * el año y la parrilla no la coloca en el calendario.
   */
  airingAt: z.iso.datetime().optional(),
  year: z.number().int().optional(),
  /** Si AniList la marca para adultos. Ver `discoverItemSchema`. */
  adult: z.boolean(),
  kind: titleKindSchema.optional(),
  ref: providerRefSchema.optional(),
})

export const airingResponseSchema = z.strictObject({ items: z.array(airingItemSchema) })

/**
 * Lo que AniList sabe de una obra, ya saneado.
 *
 * La sinopsis llega como **texto plano** —la API la publica con etiquetas y se
 * limpia en `core`—, así que este contrato no puede llevar HTML ni por descuido.
 * `banner` es la imagen apaisada de la ficha, también por una ruta local.
 */
export const enrichmentSchema = z.strictObject({
  anilistId: z.number().int().positive(),
  cover: z.string().min(1),
  banner: z.string().min(1).optional(),
  synopsis: z.string().min(1).optional(),
  genres: z.array(z.string().min(1)),
  score: z.number().min(0).max(100).optional(),
  status: airingStatusSchema.optional(),
  year: z.number().int().optional(),
  format: z.string().min(1).optional(),
  episodes: z.number().int().positive().optional(),
  durationMin: z.number().int().positive().optional(),
  studios: z.array(z.string().min(1)),
  /** Si AniList la marca para adultos. Ver `discoverItemSchema`. */
  adult: z.boolean(),
  /** La ficha de la obra en AniList, para atribuir el dato. */
  siteUrl: httpUrlSchema,
  nextEpisode: z
    .strictObject({
      number: z.number().int().positive(),
      airingAt: z.iso.datetime(),
    })
    .optional(),
})

/** El enriquecimiento de una ficha. `null` es «no hay con qué», no un error. */
export const enrichmentResponseSchema = z.strictObject({
  enrichment: enrichmentSchema.nullable(),
})

/** Las referencias que la vitrina quiere emparejar de una vez. */
export const enrichmentBatchRequestSchema = z.strictObject({
  refs: z.array(providerRefSchema).min(1).max(24),
})

/**
 * El lote del motor: cada referencia con lo que se encontró, o sin ello.
 *
 * `enrichment` se omite cuando no hubo emparejamiento en vez de viajar como
 * `null`: en una lista de veinte, decir «esta no tiene» una vez por elemento es
 * ruido, y la ausencia ya significa exactamente eso.
 */
export const enrichmentBatchItemSchema = z.strictObject({
  ref: providerRefSchema,
  enrichment: enrichmentSchema.optional(),
})

export const enrichmentBatchResponseSchema = z.strictObject({
  items: z.array(enrichmentBatchItemSchema),
})

/**
 * Una relación de AniList, en la forma de esta aplicación.
 *
 * El motivo viaja como uno de los valores de `ANILIST_RELATIONS` y no con el
 * nombre que publica la API: la interfaz traduce una lista cerrada y no tiene por
 * qué saber que `SIDE_STORY` se escribe así.
 */
export const anilistRelationSchema = z.enum(ANILIST_RELATIONS)

/**
 * Una pieza del descubrimiento más el motivo por el que AniList la relaciona.
 *
 * Es la misma pieza que la del top y la parrilla —portada por la ruta local,
 * `kind`, año, nota y `ref`— porque la pinta el mismo componente, y el `ref`
 * decide lo mismo: con ficha local abre la ficha, sin ella la búsqueda.
 */
export const anilistRelatedItemSchema = discoverItemSchema.extend({
  relation: anilistRelationSchema,
})

export const anilistRelatedResponseSchema = z.strictObject({
  items: z.array(anilistRelatedItemSchema),
})

/**
 * El orden de preferencia de proveedores, del más prioritario al menos.
 *
 * Es una lista de ids y no un campo por proveedor porque el orden es el dato: la
 * misma obra puede estar en varias fuentes, y cuál se elige es la primera de la
 * lista que la tenga. Un id que ya no exista no estorba —nada lo iguala— y
 * volver a instalar el plugin recupera su sitio si se reordena.
 *
 * El tope de 64 es una defensa de la tabla de ajustes, que es texto libre: una
 * lista sin límite es una fila que crece con cada petición.
 */
const providerPrioritySchema = z.array(z.string().min(1)).max(64)

/** Ajustes que la interfaz puede leer y, en parte, cambiar. */
export const settingsResponseSchema = z.strictObject({
  theme: z.enum(['dark', 'light', 'system']),
  providerPriority: providerPrioritySchema,
  /**
   * Si la vitrina enseña también lo que AniList marca para adultos.
   *
   * Nace apagado, y es el ajuste del que cuelga todo lo demás: decide qué se pide
   * a AniList, qué se guarda y qué se sirve.
   */
  adultContent: z.boolean(),
  /**
   * Si esta instalación corre en modo restringido.
   *
   * No es un ajuste que el usuario cambie: lo fija `NN_ANIME_LOCKED` al
   * desplegar. La interfaz lo lee para no ofrecer botones que la API no
   * registra. Por defecto `false`, que es el modo local de siempre.
   */
  locked: z.boolean().default(false),
  paths: z.strictObject({
    data: z.string().min(1),
    config: z.string().min(1),
    cache: z.string().min(1),
  }),
  mpv: z.strictObject({
    available: z.boolean(),
    version: z.string().optional(),
  }),
  providers: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      capabilities: providerCapabilitiesSchema,
      status: z.enum(['active', 'rejected']),
      /** Por qué se rechazó, si se rechazó. */
      reason: z.string().optional(),
    }),
  ),
})

/**
 * Lo que un `PATCH /api/settings` puede cambiar.
 *
 * Los tres campos son opcionales y hace falta que venga uno: el parche cambia lo
 * que trae y deja lo demás como está. Exigir los tres obligaría a la interfaz a
 * mandar el tema cuando sólo quiere reordenar proveedores, y un `PATCH` vacío no
 * describe ningún cambio: es una petición mal escrita, no una escritura inútil.
 */
export const settingsPatchSchema = z
  .strictObject({
    theme: z.enum(['dark', 'light', 'system']).optional(),
    providerPriority: providerPrioritySchema.optional(),
    adultContent: z.boolean().optional(),
  })
  .refine(
    (parche) =>
      parche.theme !== undefined ||
      parche.providerPriority !== undefined ||
      parche.adultContent !== undefined,
    'el parche no cambia ningún ajuste',
  )

/** Detalle de un título. Es el mismo schema del dominio, no una copia. */
export const animeResponseSchema = animeDetailSchema

/**
 * Una temporada de un título, tal como la ve el selector.
 *
 * `count` es cuántos episodios tiene: sin el número, el botón de la temporada no
 * dice cuánto hay detrás y hay que entrar para saberlo.
 */
export const episodeSeasonSchema = z.strictObject({
  season: z.number().int().nonnegative(),
  count: z.number().int().positive(),
})

/**
 * Lista de episodios de un título, por páginas.
 *
 * `page` y `hasMore` van **con valor por defecto** y no obligatorios, por el
 * mismo motivo que `capabilities.feed`: el servidor aprendió a paginar después
 * que el cliente aprendiera a leer `episodes`, y un campo requerido nuevo
 * rompería a quien ya leía la respuesta. `total` es opcional porque hay fuentes
 * que no lo dicen: sin él, el selector numera el episodio y no promete un total.
 *
 * `seasons` es el índice de temporadas **del título**, y por eso no depende de
 * la página que se esté mirando: el selector tiene que poder ofrecer todas las
 * temporadas desde la primera página. Sólo viaja cuando la lista se puede
 * agrupar —todas las fuentes que marcan la temporada, y más de una—, así que su
 * ausencia no es un fallo: es una lista que se lee entera.
 */
export const episodesResponseSchema = z.strictObject({
  episodes: z.array(episodeSchema),
  page: z.number().int().positive().default(1),
  hasMore: z.boolean().default(false),
  total: z.number().int().nonnegative().optional(),
  seasons: z.array(episodeSeasonSchema).min(1).optional(),
})

/**
 * Un episodio suelto: el que se pidió por número, o el último del título.
 *
 * La misma forma para las dos rutas porque el cliente hace lo mismo con las dos
 * —abrir ese episodio—, y dos formas iguales acaban divergiendo.
 */
export const episodeResponseSchema = z.strictObject({
  episode: episodeSchema,
})

/**
 * Consulta de búsqueda.
 *
 * `provider` se repite en la dirección (`?provider=a&provider=b`), que es lo que
 * permite filtrar por varios sin inventar un separador dentro de un valor.
 *
 * `media` es el mismo filtro de tipo que el resto de lecturas y va **en la
 * petición, no sólo en la interfaz**: una búsqueda de películas no puede
 * preguntarle a las fuentes de anime. Filtrar los resultados al llegar dejaría el
 * gasto hecho —son sitios de terceros— y además el catálogo cacheado se filtra por
 * los proveedores seleccionados, así que la mitad de la base que no toca tampoco
 * aparecería.
 */
export const searchQuerySchema = z.strictObject({
  q: z.string().max(200).default(''),
  provider: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).default([]),
  media: providerMediaSchema.optional(),
})

/**
 * Un evento del flujo de búsqueda, tal como viaja por SSE.
 *
 * `anilist` es la búsqueda cruzada: lo que AniList tiene de ese término como
 * **estudio o como género**. Va con `discoverItemSchema` y no con `searchResultSchema`
 * porque una obra que ninguna fuente tiene no tiene referencia local que ofrecer
 * —lo que sí lleva es la de la ficha cuando la base ya la conoce, y eso es lo que
 * decide si la pieza abre una ficha o la búsqueda de su título—. Es un evento
 * propio porque sus piezas no son la respuesta de un proveedor: la interfaz las
 * pinta aparte y el recuento por proveedor sigue contando lo que es.
 */
export const searchEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('results'),
    providerId: z.string().min(1),
    results: z.array(searchResultSchema),
  }),
  z.strictObject({
    type: z.literal('anilist'),
    items: z.array(discoverItemSchema),
  }),
  z.strictObject({
    type: z.literal('error'),
    providerId: z.string().min(1),
    /**
     * Clasificación del fallo. Es texto y no una enumeración cerrada a
     * propósito: un tipo de fallo nuevo en el SDK no tiene que romper la
     * interfaz, que ya recibe el mensaje para mostrar.
     */
    kind: z.string().min(1),
    message: z.string().min(1),
  }),
  z.strictObject({ type: z.literal('done'), providers: z.number().int().nonnegative() }),
])

export type ErrorResponse = z.infer<typeof errorResponseSchema>
export type AnimeResponse = z.infer<typeof animeResponseSchema>
export type ContinueWatchingItem = z.infer<typeof continueWatchingItemSchema>
export type ContinueWatchingResponse = z.infer<typeof continueWatchingResponseSchema>
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
export type TrendingResponse = z.infer<typeof trendingResponseSchema>
export type FeedItem = z.infer<typeof feedItemSchema>
export type FeedResponse = z.infer<typeof feedResponseSchema>
export type RecentResponse = z.infer<typeof recentResponseSchema>
export type SettingsResponse = z.infer<typeof settingsResponseSchema>
export type RecommendationResponse = z.infer<typeof recommendationSchema>
export type RecommendationsResponse = z.infer<typeof recommendationsResponseSchema>
export type WatchStartRequest = z.infer<typeof watchStartRequestSchema>
export type WatchStartResponse = z.infer<typeof watchStartResponseSchema>
export type WatchUpdateRequest = z.infer<typeof watchUpdateRequestSchema>
export type StreamResolveResponse = z.infer<typeof streamResolveResponseSchema>
export type StreamSourceResponse = z.infer<typeof streamSourceResponseSchema>
export type FavoriteRequest = z.infer<typeof favoriteRequestSchema>
export type FavoritesResponse = z.infer<typeof favoritesResponseSchema>
export type WatchedTitleRequest = z.infer<typeof watchedTitleRequestSchema>
export type WatchedTitlesResponse = z.infer<typeof watchedTitlesResponseSchema>
export type PlanToWatchRequest = z.infer<typeof planToWatchRequestSchema>
export type PlanToWatchResponse = z.infer<typeof planToWatchResponseSchema>
export type WatchHistoryItem = z.infer<typeof watchHistoryItemSchema>
export type WatchHistoryResponse = z.infer<typeof watchHistoryResponseSchema>
export type ProfileResponse = z.infer<typeof profileResponseSchema>
export type EpisodesResponse = z.infer<typeof episodesResponseSchema>
export type EpisodeSeason = z.infer<typeof episodeSeasonSchema>
export type EpisodeResponse = z.infer<typeof episodeResponseSchema>
export type RelatedResponse = z.infer<typeof relatedResponseSchema>
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>
export type WatchedEpisodePayload = z.infer<typeof watchedEpisodeSchema>
export type WatchedResponse = z.infer<typeof watchedResponseSchema>
export type ProviderStatus = z.infer<typeof providerStatusSchema>
export type ProviderSummary = z.infer<typeof providerSummarySchema>
export type HealthResponse = z.infer<typeof healthResponseSchema>
export type ProvidersResponse = z.infer<typeof providersResponseSchema>
export type ProviderDraft = z.infer<typeof providerDraftSchema>
export type ProviderFieldMap = z.infer<typeof providerFieldMapSchema>
export type ProviderRegisterResponse = z.infer<typeof providerRegisterResponseSchema>
export type ProviderRepoCandidate = z.infer<typeof providerRepoCandidateSchema>
export type ProviderRepoRecord = z.infer<typeof providerRepoRecordSchema>
export type ProviderRepoSelection = z.infer<typeof providerRepoSelectionSchema>
export type ProviderRepoView = z.infer<typeof providerRepoViewSchema>
export type ProviderReposResponse = z.infer<typeof providerReposResponseSchema>
export type SearchQuery = z.infer<typeof searchQuerySchema>
export type SearchEventPayload = z.infer<typeof searchEventSchema>
export type DiscoverItem = z.infer<typeof discoverItemSchema>
export type DiscoverResponse = z.infer<typeof discoverResponseSchema>
export type AiringItem = z.infer<typeof airingItemSchema>
export type AiringResponse = z.infer<typeof airingResponseSchema>
export type Enrichment = z.infer<typeof enrichmentSchema>
export type EnrichmentResponse = z.infer<typeof enrichmentResponseSchema>
export type EnrichmentBatchRequest = z.infer<typeof enrichmentBatchRequestSchema>
export type EnrichmentBatchItem = z.infer<typeof enrichmentBatchItemSchema>
export type EnrichmentBatchResponse = z.infer<typeof enrichmentBatchResponseSchema>
export type AniListRelatedItem = z.infer<typeof anilistRelatedItemSchema>
export type AniListRelatedResponse = z.infer<typeof anilistRelatedResponseSchema>
