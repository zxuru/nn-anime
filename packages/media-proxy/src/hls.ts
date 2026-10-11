/**
 * Reescritura de playlists HLS.
 *
 * Una playlist apunta a segmentos y a otras playlists con direcciones del
 * upstream. Si se le entrega tal cual al reproductor, el navegador sale a pedir
 * los segmentos directamente al sitio de terceros: se salta el proxy, la lista
 * blanca de destinos y —lo que importa— deja al descubierto la dirección del
 * upstream. Aquí cada URI se cambia por una ruta del proxy con su índice.
 *
 * Tres reglas que no son negociables:
 *
 * - **La resolución es contra la URL base de la playlist**, no contra la del
 *   ticket. Una sub-playlist vive en otra carpeta y sus segmentos son relativos a
 *   ella; resolverlos contra el nivel de arriba da 404 en todos.
 * - **El orden se conserva.** Las líneas que no son URIs se copian **tal cual**,
 *   incluidas las etiquetas con atributos: `#EXT-X-STREAM-INF` lleva el ancho de
 *   banda y el códec, y reescribirla a mano es la forma de perderlos.
 * - **Se rechaza antes de parsear** si la playlist pasa de 4 MB. Parsear primero
 *   y comprobar después es gastar memoria en algo que se va a descartar.
 *
 * La caché en memoria es de 10 s: una playlist en vivo cambia, y una de video
 * bajo demanda no. Diez segundos bastan para que pedir el mismo master dos veces
 * seguidas no vuelva a bajar 200 KB, y no tanto como para servir una lista de
 * segmentos que ya no existe.
 */

import { AppError } from '@nn-anime/core'

/** Tope de una playlist, del spec. */
export const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024

/**
 * Vida de una playlist en la caché de memoria.
 *
 * Es la **frescura del texto**: una lista en vivo cambia, y volver a servir la
 * misma diez segundos después ya no es servir lo que hay. El índice de segmentos
 * que sale de ella es otra cosa y vive más, porque una reproducción entera se
 * sirve contra él: ver `createPlaylistCache`.
 */
export const PLAYLIST_TTL_MS = 10_000

/**
 * Tope de líneas.
 *
 * Una playlist de verdad tiene decenas o cientos de líneas; cinco mil ya es un
 * archivo que nadie escribió a mano. El tope se comprueba **antes** de reescribir
 * porque el coste está en recorrer las líneas, no en leerlas.
 */
export const MAX_PLAYLIST_LINES = 5000

/** Detección por extensión o por tipo declarado. */
export function isPlaylist(url: string, contentType?: string | undefined): boolean {
  if (contentType !== undefined) {
    const tipo = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
    if (
      tipo === 'application/vnd.apple.mpegurl' ||
      tipo === 'application/x-mpegurl' ||
      tipo === 'audio/mpegurl' ||
      tipo === 'audio/x-mpegurl'
    ) {
      return true
    }
  }

  const ruta = ((): string => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()

  return ruta.endsWith('.m3u8')
}

export interface RewriteOptions {
  /** Ticket de la playlist que se está reescribiendo. */
  readonly ticket: string
  /** URL desde la que se cargó la playlist: la base de sus URIs relativas. */
  readonly baseUrl: string
  /** Plantilla de la ruta del proxy para segmentos. Por defecto, `/stream/:ticket/seg/:index`. */
  readonly segPath?: (ticket: string, index: number) => string
  /**
   * Plantilla para claves e inicializadores (`#EXT-X-KEY`, `#EXT-X-MAP`).
   * Por defecto, `/stream/:ticket/key/:index`.
   */
  readonly keyPath?: (ticket: string, index: number) => string
}

export interface RewrittenPlaylist {
  readonly text: string
  /** Las URIs originales, en orden: es el índice que resuelve `/seg/:index`. */
  readonly uris: readonly string[]
  /**
   * Las URIs de claves e inicializadores, en orden de aparición.
   *
   * Van en una lista propia porque su índice es otro: `/key/:index`. Y van
   * juntas —clave y mapa— porque para pedir los bytes dan igual: las dos son un
   * recurso más del upstream que tiene que pasar por el proxy.
   */
  readonly keys: readonly string[]
}

/** La ruta del proxy para un segmento o sub-playlist. */
export function defaultSegPath(ticket: string, index: number): string {
  return `/stream/${ticket}/seg/${index}`
}

/** La ruta del proxy para una clave o un inicializador. */
export function defaultKeyPath(ticket: string, index: number): string {
  return `/stream/${ticket}/key/${index}`
}

/** Etiquetas cuyos atributos `URI` apuntan a un recurso que hay que proxear. */
const URI_TAGS: readonly string[] = ['#EXT-X-KEY:', '#EXT-X-MAP:']

/** El atributo `URI`, con comillas dobles o simples. */
const URI_ATTRIBUTE = /URI=("([^"]*)"|'([^']*)')/g

function resolveUri(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).href
  } catch {
    return uri
  }
}

/**
 * Reescribe una playlist y devuelve también las URIs originales.
 *
 * Se separan las dos cosas porque el proxy necesita las dos: el texto que se le
 * da al reproductor y la lista ordenada para resolver `seg/:index` sin volver a
 * parsear nada.
 */
export function rewritePlaylist(text: string, options: RewriteOptions): RewrittenPlaylist {
  const segPath = options.segPath ?? defaultSegPath
  const keyPath = options.keyPath ?? defaultKeyPath
  const lineas = text.split('\n')

  if (lineas.length > MAX_PLAYLIST_LINES) throw playlistTooManyLines(lineas.length)

  const salida: string[] = []
  const uris: string[] = []
  const keys: string[] = []

  for (const linea of lineas) {
    const limpia = linea.trim()

    // Una etiqueta con atributos `URI` —clave o inicializador— se reescribe sólo
    // en esos atributos: el resto de la línea (`METHOD`, `IV`, `BYTERANGE`) es
    // del upstream y se copia sin tocar.
    if (URI_TAGS.some((etiqueta) => limpia.startsWith(etiqueta))) {
      salida.push(
        linea.replace(URI_ATTRIBUTE, (_todo, _comillas, dobles: string, simples: string) => {
          // El grupo que no participa llega como `undefined`, no como cadena
          // vacía: comparar contra `''` dejaba pasar el `undefined` y la clave
          // acababa resolviéndose como «undefined». Lo encontró la prueba de las
          // comillas simples.
          const original = dobles !== undefined && dobles !== '' ? dobles : (simples ?? '')
          keys.push(resolveUri(original, options.baseUrl))

          return `URI="${keyPath(options.ticket, keys.length - 1)}"`
        }),
      )
      continue
    }

    // Las demás etiquetas y las líneas vacías se copian tal cual.
    if (limpia === '' || limpia.startsWith('#')) {
      salida.push(linea)
      continue
    }

    const resuelta = resolveUri(limpia, options.baseUrl)
    uris.push(resuelta)
    // Se conserva el sangrado original de la línea, si lo hubiera: una playlist
    // con espacios sigue siendo válida, y reescribirla no es reformatearla.
    salida.push(linea.replace(limpia, segPath(options.ticket, uris.length - 1)))
  }

  return { text: salida.join('\n'), uris, keys }
}

/** Error de una playlist con demasiadas líneas, antes de reescribirla. */
export function playlistTooManyLines(lines: number): AppError {
  return new AppError({
    code: 'upstream',
    message: `la playlist tiene más de ${MAX_PLAYLIST_LINES} líneas`,
    context: { lines, max: MAX_PLAYLIST_LINES },
    scope: 'media-proxy',
    op: 'rewritePlaylist',
  })
}

/** Error de una playlist demasiado grande, antes de parsearla. */
export function playlistTooLarge(bytes: number): AppError {
  return new AppError({
    code: 'upstream',
    message: `la playlist supera el tope de ${MAX_PLAYLIST_BYTES} bytes`,
    context: { bytes, max: MAX_PLAYLIST_BYTES },
    scope: 'media-proxy',
    op: 'readPlaylist',
  })
}

export interface PlaylistEntry {
  readonly text: string
  readonly uris: readonly string[]
  readonly keys: readonly string[]
  readonly at: number
}

export interface PlaylistCache {
  get(ticket: string): PlaylistEntry | undefined
  set(
    ticket: string,
    entry: { text: string; uris: readonly string[]; keys: readonly string[] },
  ): void
  /** Cuántas playlists vivas hay. */
  size(): number
  /** Quita las vencidas y devuelve cuántas quitó. */
  prune(): number
}

/**
 * Caché de playlists en memoria.
 *
 * El tope de entradas no está en el spec porque el de tickets (500) ya acota
 * cuántas playlists pueden existir: una por ticket vivo como mucho.
 *
 * **Resolver rejuvenece la entrada.** Lo que se guarda no es sólo el texto: es el
 * índice con el que se contestan `seg/:index` y `key/:index`, y una reproducción
 * entera se sirve contra él. Con una vida fija desde que se guardó, un episodio
 * de veinte minutos se quedaba sin índice a los pocos segundos de la última
 * petición de la lista y **todos** los segmentos pasaban a ser 404: se oía lo ya
 * cargado y la reproducción se paraba. Mientras la lista se use, vive; cuando
 * nadie la pide, vence, que es lo que hace el ticket que la acompaña.
 *
 * Por eso el proxy la crea con la vida del ticket y no con `PLAYLIST_TTL_MS`:
 * diez segundos son la frescura del texto de una lista en vivo, no la vida del
 * índice de una reproducción.
 */
export function createPlaylistCache(
  options: { readonly ttlMs?: number; readonly now?: () => number } = {},
): PlaylistCache {
  const ttl = options.ttlMs ?? PLAYLIST_TTL_MS
  const now = options.now ?? Date.now
  const entradas = new Map<string, PlaylistEntry>()

  const vencida = (entrada: PlaylistEntry, at: number): boolean => entrada.at + ttl <= at

  return {
    get(ticket) {
      const entrada = entradas.get(ticket)
      if (entrada === undefined) return undefined

      const at = now()
      if (vencida(entrada, at)) {
        entradas.delete(ticket)

        return undefined
      }

      entradas.set(ticket, { ...entrada, at })

      return entrada
    },
    set(ticket, entrada) {
      entradas.set(ticket, { ...entrada, at: now() })
    },
    size: () => entradas.size,
    prune() {
      const at = now()
      let quitadas = 0

      for (const [ticket, entrada] of entradas) {
        if (vencida(entrada, at)) {
          entradas.delete(ticket)
          quitadas += 1
        }
      }

      return quitadas
    },
  }
}
