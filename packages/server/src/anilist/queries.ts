/**
 * Las consultas de GraphQL, escritas una vez y con nombre.
 *
 * Los campos son los mismos en todas: lo que se guarda de una obra no depende de
 * por qué se preguntó. Cambiar de selección sin querer —que una fila traiga la
 * sinopsis y otra no— daría dos formas en la misma caché, y la que se leyera
 * primero sería la que manda.
 *
 * La búsqueda por lotes **se compone**: un alias de GraphQL por obra, con su
 * variable. Los alias y los nombres de variable los pone este archivo —`t0`,
 * `t1`…—, nunca el texto de un título: lo que el usuario o el catálogo digan va
 * en `variables`, que es lo que convierte una consulta en datos.
 *
 * **El filtro de adultos no puede ser una variable.** `isAdult: false` excluye y
 * `isAdult: true` significa «sólo adultos»: no hay valor que diga «sin filtro», así
 * que la única forma de pedir todo es **omitir el argumento**, y eso obliga a
 * construir la consulta. Las que sí pueden filtrar lo hacen; la parrilla no puede
 * —ver `AIRING_QUERY`— y su descarte va en la ruta.
 */

/**
 * El filtro de adultos, para pegar detrás del último argumento.
 *
 * Vacío cuando el interruptor está encendido, y con la coma delante cuando no: así
 * vale igual para una lista de argumentos en una línea que para una por línea, que
 * es como están escritas las de películas.
 */
function filtroDeAdultos(adultAllowed: boolean): string {
  return adultAllowed ? '' : ', isAdult: false'
}

/** Lo que se pide de una obra. */
export const MEDIA_FIELDS = `
  id
  title { romaji english native }
  synonyms
  format
  status
  isAdult
  startDate { year month day }
  episodes
  duration
  averageScore
  description(asHtml: false)
  genres
  studios(isMain: true) { nodes { name } }
  coverImage { extraLarge large }
  bannerImage
  siteUrl
  nextAiringEpisode { episode airingAt }
`

/**
 * El ranking de una mitad.
 *
 * Se filtra por formato en vez de por tipo: AniList llama «anime» a todo, música
 * incluida, y la mitad de películas de la interfaz es exactamente `MOVIE`.
 */
export function topQuery(adultAllowed: boolean): string {
  return `
  query ($perPage: Int, $formatos: [MediaFormat]) {
    Page(page: 1, perPage: $perPage) {
      media(type: ANIME, format_in: $formatos, sort: POPULARITY_DESC${filtroDeAdultos(adultAllowed)}) {
        ${MEDIA_FIELDS}
      }
    }
  }
`
}

/**
 * Lo que se emite entre dos fechas.
 *
 * **Esta no se puede filtrar**, y por eso está aquí y no en la familia de arriba:
 * cuelga de `Page.airingSchedules`, que no expone el argumento `isAdult`. La
 * parrilla y lo recién emitido son las dos únicas superficies donde el filtro no
 * viene de la consulta, así que el descarte de la obra marcada lo hace la ruta.
 */
export const AIRING_QUERY = `
  query ($desde: Int, $hasta: Int, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      airingSchedules(airingAt_greater: $desde, airingAt_lesser: $hasta, sort: TIME) {
        episode
        airingAt
        media { ${MEDIA_FIELDS} }
      }
    }
  }
`

/** Lo que se acaba de emitir, lo último primero. Sin filtro posible, como la parrilla. */
export const AIRED_QUERY = `
  query ($desde: Int, $hasta: Int, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      airingSchedules(airingAt_greater: $desde, airingAt_lesser: $hasta, sort: TIME_DESC) {
        episode
        airingAt
        media { ${MEDIA_FIELDS} }
      }
    }
  }
`

/**
 * Películas ya estrenadas, de la más reciente hacia atrás.
 *
 * Con **las dos cotas**. Medido contra la API: sin la inferior, el orden
 * descendente abre con las obras sin fecha —las que aún no la tienen anunciada—,
 * y la página entera se va en fichas que no se pueden situar en un día. La cota
 * inferior las deja fuera y trae estrenos de verdad.
 */
export function moviesReleasedQuery(adultAllowed: boolean): string {
  return `
  query ($desde: FuzzyDateInt, $hasta: FuzzyDateInt, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      media(
        type: ANIME
        format_in: [MOVIE]
        status: FINISHED
        startDate_greater: $desde
        startDate_lesser: $hasta
        sort: START_DATE_DESC${filtroDeAdultos(adultAllowed)}
      ) {
        ${MEDIA_FIELDS}
      }
    }
  }
`
}

/** Películas por estrenarse dentro de la ventana, la más próxima primero. */
export function moviesUpcomingQuery(adultAllowed: boolean): string {
  return `
  query ($desde: FuzzyDateInt, $hasta: FuzzyDateInt, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      media(
        type: ANIME
        format_in: [MOVIE]
        status: NOT_YET_RELEASED
        startDate_greater: $desde
        startDate_lesser: $hasta
        sort: START_DATE${filtroDeAdultos(adultAllowed)}
      ) {
        ${MEDIA_FIELDS}
      }
    }
  }
`
}

/**
 * Las relaciones de una obra, por su id.
 *
 * `relationType(version: 2)` no es un adorno: la versión 2 es la que publica los
 * nombres nuevos —medido contra la API el 2026-10-15—, y sin ella un tipo como
 * `SEQUEL` llega igual pero los que se descartan llegan con otro nombre, que es
 * justo lo que la lista blanca de `core` no puede leer.
 */
export const RELATED_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      relations {
        edges {
          relationType(version: 2)
          node { ${MEDIA_FIELDS} }
        }
      }
    }
  }
`

/**
 * La búsqueda de varias obras en **una** consulta.
 *
 * Es lo que hace que emparejar diez títulos no sean diez peticiones: el
 * presupuesto de la API se cuenta en peticiones, y una fila de la home puede
 * llevar veinte obras. Cada alias devuelve su propia página de candidatas y quien
 * llama elige la suya con la identidad de siempre.
 *
 * **No filtra, en ninguno de los dos estados del interruptor**, y es la pieza que
 * hace posible el filtro: el feed de una fuente no publica la edad de sus entradas,
 * así que la única forma de saber que una es para adultos es preguntar por ella. De
 * una obra marcada no se guarda nada —ni caché ni portada—; sólo la marca de su
 * referencia, y quien la sirve la descarta.
 */
export function matchQuery(alias: number): string {
  const variables = Array.from({ length: alias }, (_, indice) => `$q${indice}: String`).join(', ')
  const paginas = Array.from(
    { length: alias },
    (_, indice) => `
    t${indice}: Page(page: 1, perPage: 6) {
      media(search: $q${indice}, type: ANIME) { ${MEDIA_FIELDS} }
    }`,
  ).join('\n')

  return `query (${variables}) {${paginas}\n}`
}

/**
 * La búsqueda cruzada: el mismo término como estudio y como género.
 *
 * Las dos listas van en **una** consulta porque el presupuesto de AniList se
 * cuenta en peticiones y las dos son la misma pregunta: «¿qué más tiene esto?».
 * Cada alias devuelve su página y quien llama las une sin repetir.
 *
 * **El estudio se pide por `Page.studios`, no con `Media(studio:)`.** Ese argumento
 * no existe: los filtros de `Media` son `genre`, `tag`, `search`, `licensedBy`… y
 * ninguno es el estudio —medido en la referencia de la API el 2026-10-16—. Una consulta
 * que lo pedía la contestaba AniList con un error de validación **de la consulta
 * entera**, y con ella caía también la lista del género que viajaba al lado: el género
 * se quedaba sin resultados por un argumento que no era suyo. La forma que sí existe es
 * la de aquí: se busca el estudio por su nombre y cada estudio publica su conexión de
 * obras, filtrada por `isMain` —sus obras principales, las mismas que enseña una ficha—
 * y ordenada por popularidad.
 *
 * Esa conexión **no acepta `format_in` ni `isAdult`** —sus argumentos son `sort`,
 * `isMain`, `page`, `perPage` y `onList`—, así que la mitad y el interruptor de adultos
 * no se pueden filtrar en la consulta del estudio: los filtra `crossEntries` después,
 * sobre lo que llegue. La del género sí los lleva.
 *
 * **El género se omite cuando no lo es**, y ésa es la otra decisión que importa:
 * `genre:` sólo acepta un nombre de la lista cerrada de AniList —`ANILIST_GENRES`— y un
 * valor que no está en ella devuelve un error. Con `genero` sin definir, la consulta es
 * la del estudio y nada más.
 */
export function crossQuery(adultAllowed: boolean, genero: string | undefined): string {
  const filtro = filtroDeAdultos(adultAllowed)
  const variableGenero = genero === undefined ? '' : ', $genero: String'
  const paginaGenero =
    genero === undefined
      ? ''
      : `
    porGenero: Page(page: 1, perPage: $perPage) {
      media(type: ANIME, genre: $genero, format_in: $formatos, sort: POPULARITY_DESC${filtro}) {
        ${MEDIA_FIELDS}
      }
    }`

  return `
  query ($q: String, $estudios: Int, $porEstudio: Int, $perPage: Int, $formatos: [MediaFormat]${variableGenero}) {
    porEstudio: Page(page: 1, perPage: $estudios) {
      studios(search: $q) {
        name
        media(page: 1, perPage: $porEstudio, isMain: true, sort: POPULARITY_DESC) {
          nodes { ${MEDIA_FIELDS} }
        }
      }
    }${paginaGenero}
  }
`
}

/**
 * La búsqueda de una sola casilla: un título, unos géneros, o las dos cosas.
 *
 * Las variables las arma `buildAniListVariables` de `core` y **sólo viajan las que se
 * piden**: sin título, `$search` no existe en la petición —una cadena vacía filtraría por
 * la cadena vacía— y sin géneros tampoco `$genres`. La consulta declara las dos como
 * opcionales para que su ausencia sea «sin filtro» y no un valor.
 *
 * `isAdult: false` va **fijo**, como en el contrato de esta búsqueda: es una búsqueda de
 * catálogo general y no la vitrina, que sí mira el interruptor de adultos.
 *
 * `total` se pide porque la interfaz puede enseñarlo como aproximado, y la propia API
 * avisa de que no es exacto: la paginación se decide con `hasNextPage` y con nada más.
 */
export const SEARCH_QUERY = `
  query ($search: String, $genres: [String], $page: Int, $perPage: Int, $sort: [MediaSort]) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total currentPage hasNextPage }
      media(type: ANIME, search: $search, genre_in: $genres, sort: $sort, isAdult: false) {
        ${MEDIA_FIELDS}
      }
    }
  }
`

/**
 * La lista de géneros que acepta AniList.
 *
 * Es la única forma de saber cómo se llaman sus géneros, y por eso no hay ninguna lista
 * escrita a mano en el código: la que hubiera se quedaría vieja el día que añadan uno, y
 * un nombre que ya no exista no devuelve vacío, devuelve un error.
 */
export const GENRES_QUERY = `
  query {
    GenreCollection
  }
`
