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
