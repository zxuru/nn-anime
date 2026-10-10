/**
 * Proxy de bytes.
 *
 * Reenvía el cuerpo del upstream **sin acumularlo**: se lee por trozos y se
 * escribe por trozos. Un `arrayBuffer()` aquí convertiría un episodio de dos
 * horas en dos horas de memoria, y el spec lo prohíbe expresamente. La prueba de
 * memoria del final del archivo mide justo eso.
 *
 * Cuatro cosas que se hacen y una que no:
 *
 * - Se reenvía `Range` y se respeta el 206 con su `Content-Range`; si el upstream
 *   no lo da, se degrada a 200 sin inventar rangos.
 * - Se fuerza `Accept-Encoding: identity`: con compresión, los rangos dejan de
 *   ser rangos y el reproductor pide el archivo entero otra vez.
 * - Se pasa al cliente **sólo** una lista blanca de cabeceras. Todo lo demás se
 *   descarta, y en particular `Set-Cookie`: las cookies ignoran el puerto, así
 *   que un upstream hostil podría escribir cookies para todo `127.0.0.1`.
 * - Al cortar el cliente se cancela el cuerpo del upstream, no se deja la
 *   conexión abierta contra un sitio de terceros.
 *
 * Y la que no se hace: no se decide **a dónde** se puede salir. Eso es la lista
 * blanca de destinos (T26a), y vive fuera de este archivo para que este se pueda
 * probar con un `fetch` de mentira.
 */

import { AppError } from '@nn-anime/core'

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

export type RangeOutcome =
  | { readonly ok: true; readonly range: string | undefined }
  | { readonly ok: false; readonly reason: string }

/** Un rango de bytes: `0-1023`, `1024-` o `-500`. Uno solo, del spec de HTTP. */
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/

/**
 * Valida el `Range` del cliente.
 *
 * Se rechaza lo que no se puede cumplir —varios rangos, un rango al revés, un
 * sufijo de cero bytes— **antes de salir a la red**: un 416 se responde sin
 * molestar al upstream, que es lo que el spec pide y lo que evita usar el proxy
 * como generador de tráfico.
 */
export function parseRange(header: string | undefined): RangeOutcome {
  if (header === undefined || header.trim() === '') return { ok: true, range: undefined }

  const limpio = header.trim()
  if (limpio.includes(',')) {
    return { ok: false, reason: 'no se admiten varios rangos en una petición' }
  }

  const match = SINGLE_RANGE.exec(limpio)
  if (match === null) return { ok: false, reason: 'el rango no tiene la forma `bytes=a-b`' }

  const desde = match[1] ?? ''
  const hasta = match[2] ?? ''
  if (desde === '' && hasta === '') return { ok: false, reason: 'el rango no dice qué bytes' }

  const numero = (valor: string): number | undefined => {
    if (!/^\d+$/.test(valor)) return undefined

    const parsed = Number(valor)
    if (!Number.isSafeInteger(parsed)) return undefined

    return parsed
  }

  if (desde === '') {
    const sufijo = numero(hasta)
    if (sufijo === undefined) return { ok: false, reason: 'el sufijo del rango no es un número' }
    if (sufijo === 0) return { ok: false, reason: 'un sufijo de cero bytes no pide nada' }

    return { ok: true, range: `bytes=-${sufijo}` }
  }

  const inicio = numero(desde)
  if (inicio === undefined) return { ok: false, reason: 'el inicio del rango no es un número' }

  if (hasta === '') return { ok: true, range: `bytes=${inicio}-` }

  const fin = numero(hasta)
  if (fin === undefined) return { ok: false, reason: 'el fin del rango no es un número' }
  if (fin < inicio) return { ok: false, reason: 'el fin del rango es anterior al inicio' }

  return { ok: true, range: `bytes=${inicio}-${fin}` }
}

/**
 * La firma de `fetch` que este módulo necesita.
 *
 * No es `typeof fetch` a propósito: el global lleva `preconnect` y otras
 * propiedades, y pedirlas obliga a cada prueba a fingir un objeto entero. Lo que
 * se usa es una función que recibe ruta y opciones y devuelve una respuesta.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ByteProxyRequest {
  readonly url: string
  /** Cabeceras que el proveedor declaró necesarias. Nunca salen del proceso. */
  readonly headers: Readonly<Record<string, string>>
  readonly range?: string | undefined
  readonly signal?: AbortSignal | undefined
  readonly fetchImpl?: FetchLike
}

function passthroughHeaders(upstream: Headers): Headers {
  const salida = new Headers()

  for (const nombre of ALLOWED_RESPONSE_HEADERS) {
    const valor = upstream.get(nombre)
    if (valor !== null) salida.set(nombre, valor)
  }

  salida.set('x-content-type-options', 'nosniff')

  return salida
}

/**
 * Pide al upstream y devuelve la respuesta ya lista para el cliente.
 *
 * El cuerpo se conecta con `pipeTo` y no se copia: cuando el cliente corta, el
 * `TransformStream` se queda sin lector, `pipeTo` rechaza y la fuente —el cuerpo
 * del upstream— se cancela. Es lo que cierra la conexión con el sitio de terceros
 * sin que nadie tenga que acordarse.
 */
export async function proxyBytes(request: ByteProxyRequest): Promise<Response> {
  const range = parseRange(request.range)
  if (!range.ok) {
    // Sin `Content-Range: bytes */N` porque el tamaño del archivo no se conoce
    // hasta preguntar al upstream, y preguntar es justo lo que este 416 evita.
    return new Response(null, {
      status: 416,
      headers: { 'x-content-type-options': 'nosniff' },
    })
  }

  const doFetch: FetchLike =
    request.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init))
  // Los headers se copian uno a uno y luego se **sobrescribe** el de codificación:
  // con un objeto plano, `Accept-Encoding` y `accept-encoding` son dos claves
  // distintas y `Headers` acaba uniendo las dos, así que la compresión del
  // cliente sobrevivía y los rangos dejaban de ser rangos.
  const cabeceras = new Headers(request.headers)
  cabeceras.set('accept-encoding', 'identity')
  if (range.range !== undefined) cabeceras.set('range', range.range)

  const upstream = await doFetch(request.url, {
    headers: cabeceras,
    // Los saltos de redirección se revalidan en T26a; aquí se sigue al upstream
    // para poder probar el reenvío de rangos sin montar un servidor.
    redirect: 'follow',
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })

  const cuerpo = upstream.body
  if (cuerpo === null) {
    return new Response(null, {
      status: upstream.status,
      headers: passthroughHeaders(upstream.headers),
    })
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  void cuerpo.pipeTo(writable).catch(() => {
    // El cliente se fue o el upstream cortó: no hay nada que contar aquí. El
    // `catch` existe para que el rechazo no salga como error no gestionado.
  })

  return new Response(readable, {
    status: upstream.status,
    headers: passthroughHeaders(upstream.headers),
  })
}

/** El error que se devuelve cuando el upstream no se puede alcanzar. */
export function upstreamFailure(url: string, cause: unknown): AppError {
  return new AppError({
    code: 'upstream',
    message: `el upstream no respondió: ${cause instanceof Error ? cause.message : String(cause)}`,
    // Ni la URL ni los headers: un error se registra, y esto no puede.
    context: { host: safeHost(url) },
    scope: 'media-proxy',
    op: 'proxyBytes',
    cause,
  })
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'desconocido'
  }
}
