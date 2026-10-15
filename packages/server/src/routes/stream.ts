/**
 * Rutas de reproducción: resolver el stream y proxear sus bytes.
 *
 * `POST /api/stream/resolve` no devuelve la URL del upstream: emite un ticket por
 * cada fuente y devuelve la dirección del proxy. El cliente web nunca ve —ni
 * puede compartir— el enlace del sitio de terceros, y los headers que el upstream
 * exige se quedan en el proceso: `toPublicStreamSource` los quita por tipo, así
 * que no hay forma de que se cuelen.
 *
 * Las **pistas de subtítulos que declara el proveedor pasan por lo mismo**: cada
 * una sale como `/api/subtitles/:ticket`, no como la dirección del upstream. Sin
 * ese paso el reproductor descarta la pista —sólo acepta rutas internas— y el
 * selector de subtítulos se queda vacío aunque el proveedor los haya declarado.
 *
 * `GET /stream/:ticket` resuelve el ticket y reenvía los bytes con su `Range`. Un
 * ticket que no existe es 404 y uno vencido es 410: la diferencia importa al
 * depurar, y son dos cosas distintas.
 *
 * Si lo que llega es una **playlist**, no se reenvía: se reescribe para que cada
 * segmento, cada sub-playlist y cada clave apunten a `/stream/:ticket/seg/:index`
 * y `/stream/:ticket/key/:index`. Sin esa reescritura el reproductor saldría a
 * pedir las direcciones del upstream directamente —se salta el proxy y, lo que
 * importa, el navegador lo bloquea por CORS—, que es el fallo que tiene esta ruta
 * cuando se deja pasar el texto tal cual.
 */

import {
  errorResponseSchema,
  type PublicStreamSource,
  type StreamSource,
  streamRequestSchema,
  streamResolveResponseSchema,
  toPublicStreamSource,
} from '@nn-anime/core'
import {
  contentTypeFor,
  type FetchLike,
  isPlaylist,
  MAX_PLAYLIST_BYTES,
  playlistTooLarge,
  proxyBytes,
  type Resolver,
  resourceKind,
  rewritePlaylist,
} from '@nn-anime/media-proxy'
import type { CallOptions, Provider } from '@nn-anime/provider-sdk'
import type { Hono } from 'hono'
import type { ServerContainer } from '../container'
import { findProvider } from './anime'
import { subtitlesPath } from './subtitles'

export interface StreamRouteOptions {
  readonly providers: readonly Provider[]
  readonly container: ServerContainer
  readonly timeoutMs?: number
  /** Se inyecta en los tests para no salir a la red al proxear. */
  readonly fetchImpl?: FetchLike
  /** Resolutor del DNS, inyectable para probar sin red. */
  readonly resolver?: Resolver
  /** Excepción de loopback, sólo para el e2e. */
  readonly allowLoopback?: boolean
}

const DEFAULT_TIMEOUT_MS = 8000

/** La dirección con la que el cliente pide los bytes: el ticket, no la URL. */
export function ticketPath(ticket: string): string {
  return `/stream/${ticket}`
}

/**
 * Las pistas de subtítulos del proveedor, una por ticket.
 *
 * Una pista declarada trae la dirección del upstream igual que la fuente, y el
 * cliente no puede pedirla: el reproductor sólo acepta rutas del proxy —lo
 * comprueba antes de pintar nada— y el contrato de la respuesta exige que
 * `subtitles` sean rutas internas. Sin este paso la pista llegaba al navegador
 * con la dirección de terceros dentro y se descartaba en silencio: el selector de
 * subtítulos existía y nunca tenía nada que ofrecer.
 *
 * El ticket guarda las **mismas cabeceras que el video**, que son las que el
 * sitio exige: un subtítulo servido sin el `Referer` de la ficha es un 403.
 */
function subtitlesWithTickets(
  options: StreamRouteOptions,
  source: StreamSource,
): PublicStreamSource['subtitles'] {
  const pistas = source.subtitles
  if (pistas === undefined) return undefined

  return pistas.map((pista) => ({
    ...pista,
    url: subtitlesPath(
      options.container.tickets.issue({ url: pista.url, headers: source.headers ?? {} }),
    ),
  }))
}

/**
 * Lee el cuerpo de una respuesta con un tope de bytes.
 *
 * Se lee por trozos y no con `arrayBuffer()` porque el tope tiene que cortar
 * **mientras** llega: confiar en el `content-length` deja pasar a quien no lo
 * declara, y una playlist de un upstream hostil no puede convertirse en memoria
 * del proceso.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<
  { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly seen: number }
> {
  const lector = response.body?.getReader()
  if (lector === undefined) return { ok: true, bytes: new Uint8Array(0) }

  const trozos: Uint8Array[] = []
  let visto = 0

  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    if (value === undefined) continue

    visto += value.byteLength
    if (visto > maxBytes) {
      await lector.cancel().catch(() => {})

      return { ok: false, seen: visto }
    }

    trozos.push(value)
  }

  const bytes = new Uint8Array(visto)
  let offset = 0

  for (const trozo of trozos) {
    bytes.set(trozo, offset)
    offset += trozo.byteLength
  }

  return { ok: true, bytes }
}

/**
 * Reescribe una playlist y la sirve.
 *
 * El ticket con el que se reescribe es el que va a resolver después
 * `seg/:index`, y la base de las URIs relativas es **la URL de la playlist**, no
 * la del proxy: una sub-playlist vive en otra carpeta y sus segmentos son
 * relativos a ella.
 */
async function servePlaylist(
  options: StreamRouteOptions,
  response: Response,
  ticket: string,
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  let leida: Awaited<ReturnType<typeof readCapped>>

  try {
    leida = await readCapped(response, MAX_PLAYLIST_BYTES)
  } catch (cause) {
    // Igual que en el proxy de bytes: si el cliente cerró la conexión mientras
    // se leía la playlist, no hay nada que servir ni que registrar.
    if (signal.aborted) {
      return new Response(null, { status: 499, headers: { 'x-content-type-options': 'nosniff' } })
    }

    return Response.json(
      errorResponseSchema.parse({
        error: cause instanceof Error ? cause.message : String(cause),
      }),
      { status: 502, headers: { 'x-content-type-options': 'nosniff' } },
    )
  }

  if (!leida.ok) {
    return Response.json(
      errorResponseSchema.parse({ error: playlistTooLarge(leida.seen).message }),
      { status: 502, headers: { 'x-content-type-options': 'nosniff' } },
    )
  }

  let reescrita: ReturnType<typeof rewritePlaylist>

  try {
    reescrita = rewritePlaylist(new TextDecoder().decode(leida.bytes), { ticket, baseUrl: url })
  } catch (cause) {
    return Response.json(
      errorResponseSchema.parse({
        error: cause instanceof Error ? cause.message : String(cause),
      }),
      { status: 502, headers: { 'x-content-type-options': 'nosniff' } },
    )
  }

  options.container.playlists.set(ticket, {
    text: reescrita.text,
    uris: reescrita.uris,
    keys: reescrita.keys,
  })

  return new Response(reescrita.text, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.apple.mpegurl',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  })
}

/** Las cabeceras de un ticket, o la respuesta que dice por qué no vale. */
function contentsOf(
  options: StreamRouteOptions,
  ticket: string,
):
  | { readonly ok: true; readonly url: string; readonly headers: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly response: Response } {
  const salida = options.container.tickets.resolve(ticket)

  if (!salida.ok) {
    return {
      ok: false,
      response: Response.json(
        errorResponseSchema.parse({
          error:
            salida.kind === 'expired'
              ? 'el ticket caducó; vuelve a resolver el stream'
              : 'ese ticket no existe',
        }),
        { status: salida.kind === 'expired' ? 410 : 404 },
      ),
    }
  }

  return { ok: true, url: salida.contents.url, headers: salida.contents.headers }
}

/**
 * Registra una ruta hija de una playlist: segmento, sub-playlist o clave.
 *
 * Las dos rutas son la misma cosa —un índice contra una lista ya parseada— así
 * que el único parámetro que cambia es de qué lista se saca. Un índice fuera de
 * rango es 404 **sin tocar el upstream**: la lista ya está en memoria.
 */
function registerPlaylistChild(
  app: Hono,
  options: StreamRouteOptions,
  path: string,
  pick: (entrada: {
    readonly uris: readonly string[]
    readonly keys: readonly string[]
  }) => readonly string[],
): void {
  app.get(path, async (c) => {
    // La ruta llega como cadena, así que Hono no puede deducir el parámetro y lo
    // tipa como opcional. Una cadena vacía no resuelve ningún ticket y acaba en
    // el mismo 404 que una que no existe.
    const ticket = c.req.param('ticket') ?? ''
    const index = Number(c.req.param('index'))

    if (!Number.isInteger(index) || index < 0) {
      return c.json(errorResponseSchema.parse({ error: 'ese índice no es válido' }), 404)
    }

    const entrada = options.container.playlists.get(ticket)
    if (entrada === undefined) {
      // La playlist se cachea 10 s y el ticket vive 600: que no esté no es un
      // fallo del reproductor, es que hay que volver a pedir la lista.
      return c.json(
        errorResponseSchema.parse({ error: 'la playlist ya no está; vuelve a pedirla' }),
        404,
      )
    }

    const url = pick(entrada)[index]
    if (url === undefined) {
      return c.json(
        errorResponseSchema.parse({ error: `la playlist no tiene el índice ${index}` }),
        404,
      )
    }

    const contents = contentsOf(options, ticket)
    if (!contents.ok) return contents.response

    const tipo = contentTypeFor(resourceKind(url))
    const respuesta = await proxyBytes({
      url,
      headers: contents.headers,
      range: c.req.header('range'),
      signal: c.req.raw.signal,
      ...(tipo === undefined ? {} : { forceType: tipo }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
      ...(options.allowLoopback === undefined ? {} : { allowLoopback: options.allowLoopback }),
    })

    // Una sub-playlist anidada se reescribe igual, pero con un ticket propio: su
    // índice es otro y compartir el del padre haría que `seg/0` significara dos
    // cosas distintas según quién preguntara.
    if (respuesta.ok && isPlaylist(url, respuesta.headers.get('content-type') ?? undefined)) {
      const propio = options.container.tickets.issue({ url, headers: contents.headers })

      return await servePlaylist(options, respuesta, propio, url, c.req.raw.signal)
    }

    return respuesta
  })
}

export function registerStreamRoutes(app: Hono, options: StreamRouteOptions): void {
  app.post('/api/stream/resolve', async (c) => {
    let crudo: unknown
    try {
      crudo = await c.req.json()
    } catch {
      return c.json(errorResponseSchema.parse({ error: 'el cuerpo no es JSON válido' }), 400)
    }

    const parsed = streamRequestSchema.safeParse(crudo)
    if (!parsed.success) {
      return c.json(
        errorResponseSchema.parse({ error: `petición inválida: ${parsed.error.message}` }),
        400,
      )
    }

    const provider = findProvider(options.providers, parsed.data.episodeRef.providerId)
    if (provider === undefined) {
      return c.json(
        errorResponseSchema.parse({
          error: `no hay ningún proveedor llamado ${parsed.data.episodeRef.providerId}`,
        }),
        404,
      )
    }

    const callOptions: CallOptions = {
      signal: c.req.raw.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }
    const resultado = await options.container.resolveStream(provider, parsed.data, callOptions)

    if (!resultado.ok) {
      return c.json(
        errorResponseSchema.parse({ error: resultado.error.message }),
        resultado.error.context.estado === 404 ? 404 : 502,
      )
    }

    // Cada fuente se convierte en un ticket: la URL del upstream se queda aquí.
    // Y cada pista de subtítulos, en otro: la pista no es la fuente, y una
    // reproducción pide las dos cosas por caminos distintos.
    const sources = resultado.value.value.map((source) => {
      const ticket = options.container.tickets.issue({
        url: source.url,
        headers: source.headers ?? {},
      })
      const subtitles = subtitlesWithTickets(options, source)

      return toPublicStreamSource({
        ...source,
        url: ticketPath(ticket),
        ...(subtitles === undefined ? {} : { subtitles }),
      })
    })

    c.header('X-Cache', resultado.value.source)

    return c.json(streamResolveResponseSchema.parse({ sources }))
  })

  app.get('/stream/:ticket', async (c) => {
    const ticket = c.req.param('ticket')
    const contents = contentsOf(options, ticket)

    if (!contents.ok) return contents.response

    // El tipo se decide por lo que se pidió, no por lo que diga el upstream: una
    // playlist servida como `text/html` es la forma más simple de convertir un
    // proxy en un XSS. Un archivo progresivo es la excepción, porque su
    // contenedor real sólo lo sabe el upstream.
    const tipo = contentTypeFor(resourceKind(contents.url))

    const respuesta = await proxyBytes({
      url: contents.url,
      headers: contents.headers,
      range: c.req.header('range'),
      signal: c.req.raw.signal,
      ...(tipo === undefined ? {} : { forceType: tipo }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
      ...(options.allowLoopback === undefined ? {} : { allowLoopback: options.allowLoopback }),
    })

    // Sólo se lee el cuerpo cuando lo que llega es una playlist: un segmento o un
    // archivo progresivo se reenvía en streaming, y leerlo aquí sería acumular un
    // episodio entero en memoria, que es justo lo que este módulo no hace.
    if (
      !respuesta.ok ||
      !isPlaylist(contents.url, respuesta.headers.get('content-type') ?? undefined)
    ) {
      return respuesta
    }

    return await servePlaylist(options, respuesta, ticket, contents.url, c.req.raw.signal)
  })

  registerPlaylistChild(app, options, '/stream/:ticket/seg/:index', (entrada) => entrada.uris)
  registerPlaylistChild(app, options, '/stream/:ticket/key/:index', (entrada) => entrada.keys)
}
