/**
 * Saneamiento de las cabeceras de respuesta.
 *
 * Nada de lo que devuelve el upstream llega al cliente sin pasar por aquí. Un
 * `Set-Cookie` de un sitio de terceros es la razón más clara: las cookies ignoran
 * el puerto, así que un upstream hostil puede escribir cookies para todo
 * `127.0.0.1` y contaminar otros servicios locales del usuario. Lo demás es
 * superficie: `server`, `x-powered-by` y compañía cuentan cosas que no hacen
 * falta para reproducir un video.
 *
 * Y el tipo de contenido **no se copia cuando se puede decidir**: una playlist,
 * un segmento y un subtítulo son lo que el proxy dice que son, aunque el upstream
 * mienta. Un `text/html` servido donde el reproductor espera una playlist es la
 * forma más simple de convertir un proxy en un XSS.
 *
 * Un archivo progresivo (`file`) es la excepción: el contenedor real lo sabe el
 * upstream —mp4, webm, mkv— y la extensión no es autoridad. Ahí se copia, dentro
 * de la lista blanca.
 */

/** Cabeceras del upstream que sí llegan al cliente. */
export const ALLOWED_RESPONSE_HEADERS: readonly string[] = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
]

/** Lo que el proxy sabe que está sirviendo. */
export type ResourceKind = 'playlist' | 'segment' | 'subtitle' | 'progressive' | 'image'

const TYPES: Readonly<Record<ResourceKind, string | undefined>> = {
  playlist: 'application/vnd.apple.mpegurl',
  segment: 'video/mp2t',
  subtitle: 'text/vtt',
  // Del archivo progresivo no decide el proxy: lo sabe el upstream.
  progressive: undefined,
  // De la imagen tampoco: un png no es un webp, y la lista blanca ya acota.
  image: undefined,
}

/** El tipo que corresponde a lo pedido, o `undefined` si lo decide el upstream. */
export function contentTypeFor(kind: ResourceKind): string | undefined {
  return TYPES[kind]
}

/** El tipo de recurso que se deduce de una dirección. */
export function resourceKind(url: string): ResourceKind {
  const ruta = ((): string => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()

  if (ruta.endsWith('.m3u8')) return 'playlist'
  if (ruta.endsWith('.ts') || ruta.endsWith('.m4s') || ruta.endsWith('.m4v')) return 'segment'
  if (ruta.endsWith('.vtt') || ruta.endsWith('.srt') || ruta.endsWith('.ass')) return 'subtitle'
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(ruta)) return 'image'

  return 'progressive'
}

export interface SanitizeOptions {
  /**
   * El tipo que el proxy **impone**, decidido por lo que se pidió. Si no se
   * indica, se copia el del upstream (ya filtrado por la lista blanca).
   */
  readonly forceType?: string | undefined
}

/**
 * Deja pasar sólo la lista blanca y fuerza el tipo si toca.
 *
 * Se construye una cabecera nueva en lugar de borrar las que sobran: una lista
 * de prohibiciones se queda corta en cuanto el upstream inventa una cabecera
 * nueva, y una de permitidos no.
 */
export function sanitizeHeaders(upstream: Headers, options: SanitizeOptions = {}): Headers {
  const salida = new Headers()

  for (const nombre of ALLOWED_RESPONSE_HEADERS) {
    const valor = upstream.get(nombre)
    if (valor !== null) salida.set(nombre, valor)
  }

  if (options.forceType !== undefined) salida.set('content-type', options.forceType)

  salida.set('x-content-type-options', 'nosniff')

  return salida
}
