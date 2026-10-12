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
import { fetchAllowed, type Resolver } from './destination-guard'
import { sanitizeHeaders } from './response-headers'

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

/** Tipos de imagen que se sirven. Un SVG es un documento con guiones dentro. */
export const RASTER_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]

/** Tope de una portada. */
export const MAX_COVER_BYTES = 5 * 1024 * 1024

/**
 * Segundos que se espera al upstream antes de darlo por perdido.
 *
 * **Es un plazo de inactividad, no un plazo total.** Un episodio de dos horas
 * tarda dos horas en llegar, y un plazo total mataría la reproducción a los
 * treinta segundos. Lo que se corta es un upstream que deja de responder, y por
 * eso el temporizador se rearma con cada trozo que llega.
 */
export const IDLE_TIMEOUT_MS = 30_000

export interface ByteProxyRequest {
  readonly url: string
  /** Cabeceras que el proveedor declaró necesarias. Nunca salen del proceso. */
  readonly headers: Readonly<Record<string, string>>
  readonly range?: string | undefined
  readonly signal?: AbortSignal | undefined
  /**
   * Inactividad tolerada antes de cortar la conexión con el upstream. Por
   * defecto, `IDLE_TIMEOUT_MS`. Cero o menos lo desactiva, que es lo que
   * necesita una prueba que quiere medir otra cosa.
   */
  readonly idleTimeoutMs?: number | undefined
  readonly fetchImpl?: FetchLike
  /**
   * Si se indica, sólo se sirven estos tipos. Lo que no esté en la lista se
   * rechaza con 415 **antes** de enviar un solo byte: un `image/svg+xml` servido
   * desde nuestro origen es un documento capaz de ejecutar guiones.
   */
  readonly acceptedTypes?: readonly string[] | undefined
  /** Tope de bytes. Por encima, 413 y no se envía nada. */
  readonly maxBytes?: number | undefined
  /** Resolutor del DNS, inyectable para probar sin red. */
  readonly resolver?: Resolver | undefined
  /** Excepción de loopback. Sólo para el e2e: ver `ALLOW_LOOPBACK_ENV`. */
  readonly allowLoopback?: boolean | undefined
  /**
   * Tipo que se impone en la respuesta, decidido por lo que se pidió. Un
   * upstream que declara `text/html` donde se pidió una playlist no cambia el
   * tipo servido.
   */
  readonly forceType?: string | undefined
}

function passthroughHeaders(upstream: Headers, forceType?: string): Headers {
  return sanitizeHeaders(upstream, forceType === undefined ? {} : { forceType })
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

  const maxBytes = request.maxBytes ?? Number.POSITIVE_INFINITY
  const idleTimeoutMs = request.idleTimeoutMs ?? IDLE_TIMEOUT_MS
  let visto = 0

  // El vigilante de inactividad. Sin él, un upstream que responde a cuentagotas
  // mantiene viva la conexión con el sitio de terceros mientras el cliente siga
  // ahí: el `Accept-Encoding: identity` y el `pipeTo` acotan la memoria, no el
  // tiempo.
  const controlador = new AbortController()
  let vigilante: ReturnType<typeof setTimeout> | undefined

  const desarmar = (): void => {
    if (vigilante !== undefined) {
      clearTimeout(vigilante)
      vigilante = undefined
    }
  }

  const rearmar = (): void => {
    desarmar()
    if (idleTimeoutMs <= 0) return

    vigilante = setTimeout(() => {
      controlador.abort(new Error('el upstream dejó de responder'))
    }, idleTimeoutMs)
  }

  // La señal que ve la salida a la red es la del cliente **y** la del vigilante:
  // si el cliente se va, se cancela; si el upstream se duerme, se aborta.
  const senal =
    request.signal === undefined
      ? controlador.signal
      : AbortSignal.any([request.signal, controlador.signal])

  const doFetch: FetchLike =
    request.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init))
  // Los headers se copian uno a uno y luego se **sobrescribe** el de codificación:
  // con un objeto plano, `Accept-Encoding` y `accept-encoding` son dos claves
  // distintas y `Headers` acaba uniendo las dos, así que la compresión del
  // cliente sobrevivía y los rangos dejaban de ser rangos.
  const cabeceras = new Headers(request.headers)
  cabeceras.set('accept-encoding', 'identity')
  // Los CDN de video protegen los segmentos contra el hotlinking y contestan 403
  // a quien no venga de su propio reproductor. Lo único que miran es esta
  // cabecera: con `same-origin` el segmento llega, y sin ella —o con `cross-site`,
  // que es lo que manda un navegador en otro origen— no. No la declara el
  // proveedor porque no depende del sitio, sino de que la petición sale del proxy
  // y no de una pestaña.
  cabeceras.set('sec-fetch-site', 'same-origin')
  if (range.range !== undefined) cabeceras.set('range', range.range)

  // La salida pasa por la lista blanca de destinos, salto a salto: una
  // redirección es la forma más fácil de saltarse una comprobación que sólo mira
  // la primera URL.
  let upstream: Response
  rearmar()

  try {
    upstream = await fetchAllowed({
      url: request.url,
      headers: Object.fromEntries(cabeceras.entries()),
      fetchImpl: doFetch,
      signal: senal,
      ...(request.resolver === undefined ? {} : { resolver: request.resolver }),
      ...(request.allowLoopback === undefined ? {} : { allowLoopback: request.allowLoopback }),
    })
  } catch (cause) {
    desarmar()

    // El cliente cerró la conexión antes de que el upstream contestara, y con él
    // se fue la petición. No es un fallo de nadie: el reproductor cambia de
    // nivel, salta de posición o descarta el búfer, y cancela lo que tenía en
    // vuelo. Sin esta rama, un cierre normal del cliente salía como un error del
    // servidor con su registro y su pila, que es lo que hacía ruido en cada
    // cambio de calidad.
    if (request.signal?.aborted === true) {
      return new Response(null, { status: 499, headers: { 'x-content-type-options': 'nosniff' } })
    }

    const error = upstreamFailure(request.url, cause)

    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
    })
  }

  const tipo = (upstream.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
  if (request.acceptedTypes !== undefined && !request.acceptedTypes.includes(tipo)) {
    desarmar()

    return new Response(null, { status: 415, headers: { 'x-content-type-options': 'nosniff' } })
  }

  const declarado = Number(upstream.headers.get('content-length') ?? '0')
  if (
    request.maxBytes !== undefined &&
    Number.isFinite(declarado) &&
    declarado > request.maxBytes
  ) {
    desarmar()

    return new Response(null, { status: 413, headers: { 'x-content-type-options': 'nosniff' } })
  }

  const cuerpo = upstream.body
  if (cuerpo === null) {
    desarmar()

    return new Response(null, {
      status: upstream.status,
      headers: passthroughHeaders(upstream.headers, request.forceType),
    })
  }

  // El tope se comprueba también mientras se transmite: un upstream puede no
  // declarar `content-length`, y entonces la única defensa es contar. El mismo
  // paso por donde se cuentan los bytes es donde se rearma el vigilante: cada
  // trozo que llega es una señal de vida del upstream.
  const vigilado = cuerpo.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        rearmar()

        visto += chunk.byteLength
        if (visto > maxBytes) {
          controller.error(new Error('el cuerpo supera el tope'))

          return
        }

        controller.enqueue(chunk)
      },
      // El cuerpo terminó: no queda nada que vigilar. La cancelación del cliente
      // la cubre el `finally` del `pipeTo`, que es donde se entera de las dos.
      flush: desarmar,
    }),
  )

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  void vigilado
    .pipeTo(writable)
    .catch(() => {
      // El cliente se fue o el upstream cortó: no hay nada que contar aquí. El
      // `catch` existe para que el rechazo no salga como error no gestionado.
    })
    .finally(desarmar)

  return new Response(readable, {
    status: upstream.status,
    headers: passthroughHeaders(upstream.headers, request.forceType),
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
