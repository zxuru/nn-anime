/**
 * La búsqueda de una sola casilla contra AniList.
 *
 * El usuario escribe una cosa y de ahí salen dos filtros: los términos que empiezan por
 * `#` son **géneros** y el resto es el **título**. Aquí vive esa separación y la
 * traducción a los valores que viajan en la consulta, y vive en `core` porque son
 * funciones puras: las usa el servidor con la lista de géneros que trae de la API y la
 * interfaz con la que tenga a mano, y el contrato de lo que se pide no puede tener dos
 * versiones.
 *
 * Cuatro reglas que se ven en el código y que no son de estilo:
 *
 * 1. **La lista de géneros es un dato, nunca una constante.** Se pide a la API
 *    (`GenreCollection`) y llega aquí como argumento: un género que no esté en ella no se
 *    envía —su filtro sólo acepta sus nombres— y se devuelve para que la interfaz lo
 *    diga. Una tabla propia se queda vieja el día que AniList añade un género.
 * 2. **Lo que no se pide no se manda.** Sin título, la variable `search` **no existe**;
 *    sin géneros, `genres` tampoco. Una cadena vacía y una lista vacía no significan «sin
 *    filtro» para la API, y una consulta que las lleve se lee distinto de lo que se pidió.
 * 3. **La comparación de un género es exacta y por clave**, no por prefijo: `#act` no es
 *    `Action`, y decirlo así evita filtrar por algo que el usuario no escribió.
 * 4. **El orden de los géneros es el de la escritura**, sin repetir: la misma lista
 *    escrita de otra forma es la misma consulta, y la clave de caché no se duplica.
 */

/** El orden que se pide cuando hay título: el de la propia búsqueda. */
export const ANILIST_SORT_SEARCH = 'SEARCH_MATCH'
/** El orden que se pide cuando no lo hay: lo más popular, que es lo que hay que enseñar. */
export const ANILIST_SORT_POPULAR = 'POPULARITY_DESC'

export type AniListSearchSort = typeof ANILIST_SORT_SEARCH | typeof ANILIST_SORT_POPULAR

/** Una pantalla de rejilla. El tope de la API por página es 50. */
export const DEFAULT_PER_PAGE = 25
export const MAX_PER_PAGE = 50

/** Lo que la casilla escribió, ya separado en título y géneros. */
export interface AniListSearchInput {
  /** El título, tal y como se escribió. `null` cuando no hay ninguno. Nunca `''`. */
  readonly search: string | null
  /** Los géneros con el nombre canónico de AniList, sin repetir y en orden de escritura. */
  readonly genres: readonly string[]
  /** Lo que se escribió con `#` y no es un género suyo. Nunca viaja a la API. */
  readonly unknownGenres: readonly string[]
}

/** Los valores de una página: exactamente lo que la consulta puede pedir. */
export interface AniListSearchVariables {
  /** Sin título, esta clave **no está**. Ver la regla 2 del encabezado. */
  readonly search?: string
  /** Sin géneros, esta clave **no está**. */
  readonly genres?: readonly string[]
  readonly page: number
  readonly perPage: number
  readonly sort: readonly AniListSearchSort[]
}

/** Los tres nombres que publica AniList de una obra. */
export interface AniListTitles {
  readonly romaji: string | null
  readonly english: string | null
  readonly native: string | null
}

/**
 * La clave con la que se compara un género.
 *
 * Sin acentos, en minúsculas y con todo lo que no sea letra o número convertido en un
 * espacio: así `#sci_fi`, `#Sci-Fi` y `#sci fi` son el mismo género, y la comparación no
 * depende de cómo se escriba. Se conservan las letras de **cualquier** alfabeto —no se
 * reduce a `a-z`— porque lo que no se puede leer no se puede comparar, y una clave vacía
 * haría que todo casara con todo.
 */
export function genreKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Si el texto pide algún género.
 *
 * Es la regla que decide **quién contesta** a una búsqueda, y por eso vive aquí y no en
 * cada lado: un término con `#` no lo entiende ninguna fuente —buscan el texto literal, y
 * `#aventura` no es un título—, así que esa búsqueda la contesta el catálogo y no se
 * pregunta a los proveedores. Con el mismo criterio en el servidor y en la interfaz, la
 * pantalla y la petición no pueden discrepar.
 *
 * Un `#` suelto no cuenta: no pide ningún género y no hay nada que buscar por él.
 */
export function hasGenreToken(input: string): boolean {
  return input
    .normalize('NFC')
    .split(/\s+/)
    .some((token) => token.startsWith('#') && token.length > 1)
}

/**
 * Separa el texto de la casilla en título y géneros.
 *
 * `validGenres` es la lista que devuelve `GenreCollection`. Con la lista vacía —todavía
 * no ha llegado— **todo** género se cuenta como desconocido: quien llama tiene que
 * esperarla antes de pedir, o diría que un género válido no lo es.
 */
export function parseAniListInput(
  input: string,
  validGenres: readonly string[],
): AniListSearchInput {
  const porClave = new Map(validGenres.map((nombre) => [genreKey(nombre), nombre]))
  const titulos: string[] = []
  const generos: string[] = []
  const desconocidos: string[] = []
  const vistos = new Set<string>()
  const vistosDesconocidos = new Set<string>()

  for (const token of input.normalize('NFC').split(/\s+/)) {
    if (token === '') continue

    if (!token.startsWith('#')) {
      titulos.push(token)
      continue
    }

    // Se quita **un** `#`: `##action` se llama «#action» y no es el género `Action`. Un
    // `#` de más no se corrige solo, porque corregirlo es adivinar lo que se escribió.
    const nombre = token.slice(1).replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    const clave = nombre === '' || nombre.includes('#') ? '' : genreKey(nombre)
    const canonico = clave === '' ? undefined : porClave.get(clave)

    if (canonico === undefined) {
      // Un `#` suelto se informa como se escribió: no hay nombre que enseñar. Los que sí
      // lo tienen se agrupan por su clave, así que el mismo nombre mal escrito de dos
      // formas se dice una vez.
      const comoSeEscribio = nombre === '' ? token : nombre
      const claveDesconocida = clave === '' ? `!${comoSeEscribio}` : clave

      if (!vistosDesconocidos.has(claveDesconocida)) {
        vistosDesconocidos.add(claveDesconocida)
        desconocidos.push(comoSeEscribio)
      }
      continue
    }

    if (vistos.has(clave)) continue

    vistos.add(clave)
    generos.push(canonico)
  }

  return {
    search: titulos.length === 0 ? null : titulos.join(' '),
    genres: generos,
    unknownGenres: desconocidos,
  }
}

/**
 * Los valores de una página de la búsqueda.
 *
 * Las claves que no se piden **se omiten** en vez de viajar vacías o nulas: la consulta
 * declara `$search` y `$genres` como opcionales, y lo que no llega no filtra. El orden
 * —`SEARCH_MATCH` sólo con título, `POPULARITY_DESC` cuando no lo hay— es el que hace que
 * una casilla vacía enseñe algo en vez de nada.
 */
export function buildAniListVariables(
  parsed: AniListSearchInput,
  options: { readonly page?: number; readonly perPage?: number } = {},
): AniListSearchVariables {
  const perPage = Math.min(
    Math.max(Math.trunc(options.perPage ?? DEFAULT_PER_PAGE), 1),
    MAX_PER_PAGE,
  )
  const page = Math.max(Math.trunc(options.page ?? 1), 1)
  const sort: AniListSearchSort =
    parsed.search === null ? ANILIST_SORT_POPULAR : ANILIST_SORT_SEARCH

  return {
    ...(parsed.search === null ? {} : { search: parsed.search }),
    ...(parsed.genres.length === 0 ? {} : { genres: [...parsed.genres] }),
    page,
    perPage,
    sort: [sort],
  }
}

/**
 * El título que se enseña, y el segundo si hay dos que enseñar.
 *
 * El inglés manda cuando existe; si no, el romaji; si no, el nativo. El romaji se
 * devuelve como segunda línea **sólo cuando no es el que se enseña**: repetir el mismo
 * texto dos veces no informa de nada. Sin ninguno de los tres queda el id, que es lo
 * único que identifica a la obra y no se inventa un texto.
 */
export function displayTitleOf(
  titles: AniListTitles,
  fallbackId: number,
): { readonly title: string; readonly secondary?: string } {
  const limpio = (valor: string | null): string | undefined => {
    const texto = valor?.trim() ?? ''

    return texto === '' ? undefined : texto
  }

  const english = limpio(titles.english)
  const romaji = limpio(titles.romaji)
  const title = english ?? romaji ?? limpio(titles.native) ?? `#${fallbackId}`
  const secondary =
    title === english && romaji !== undefined && romaji !== title ? romaji : undefined

  return secondary === undefined ? { title } : { title, secondary }
}
